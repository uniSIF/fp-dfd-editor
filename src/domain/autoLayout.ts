import dagre from '@dagrejs/dagre';
import { computeBoundary, nodeSize } from './dfdGeometry';
import type { DfdEdge, DfdNode, FunctionKind, Id } from './types';

export interface LayoutPosition {
  nodeId: Id;
  x: number;
  y: number;
}

const ORIGIN = 40;
const GAP = 40;
/** システム境界と外側の要素の間隔 */
const OUTSIDE_GAP = 56;

type Pos = { x: number; y: number };

/**
 * DFD の自動整列（FR-DF-12、design.md 6.6）。
 *
 * 1. 接続された内部の要素（プロセス・ILF）を dagre の左→右の階層レイアウトで並べる。
 * 2. 未接続の内部の要素は、その下段に並べる。
 * 3. 外部エンティティはシステム境界の外に置く。入力元（出力を持つもの）は左外、出力先だけのものは右外（FR-DF-18、FR-DF-19）。
 * 4. EIF（外部インタフェースファイル）は境界の下の外側に並べる。
 *
 * kindOf でデータファンクションの種別を渡すと ILF / EIF を区別する。省略時はすべて内部（ILF）扱い。
 * nameOf で名称を渡すと、名称の長さで変わるノードの大きさ（nodeLayout）を使って並べる。
 * 戻り値はノード左上座標。
 */
export function layoutDfd(
  nodes: DfdNode[],
  edges: DfdEdge[],
  kindOf: (n: DfdNode) => FunctionKind | null | undefined = () => 'ILF',
  nameOf: (n: DfdNode) => string = () => '',
): LayoutPosition[] {
  const size = (n: DfdNode) => nodeSize(n.refType, nameOf(n));
  const kind = new Map(nodes.map((n) => [n.id, n.refType === 'dataFunction' ? kindOf(n) ?? 'ILF' : null]));
  const isEE = (n: DfdNode) => n.refType === 'externalEntity';
  const isEIF = (n: DfdNode) => n.refType === 'dataFunction' && kind.get(n.id) === 'EIF';
  const isInside = (n: DfdNode) => !isEE(n) && !isEIF(n);

  const connected = new Set<Id>();
  const hasIn = new Set<Id>();
  const hasOut = new Set<Id>();
  for (const e of edges) {
    connected.add(e.sourceNodeId);
    connected.add(e.targetNodeId);
    hasOut.add(e.sourceNodeId);
    hasIn.add(e.targetNodeId);
  }

  // 1. 接続された要素全体を dagre で並べる（外部の要素も順序付けの手がかりとして入れる）
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 80, ranker: 'network-simplex' });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) if (connected.has(n.id)) g.setNode(n.id, size(n));
  edges.forEach((e, i) => {
    if (e.sourceNodeId !== e.targetNodeId && g.hasNode(e.sourceNodeId) && g.hasNode(e.targetNodeId)) {
      g.setEdge(e.sourceNodeId, e.targetNodeId, {}, `e${i}`);
    }
  });
  dagre.layout(g);

  const pos = new Map<Id, Pos>();
  for (const n of nodes) {
    if (!connected.has(n.id)) continue;
    const p = g.node(n.id);
    const { width, height } = size(n);
    pos.set(n.id, { x: p.x - width / 2, y: p.y - height / 2 });
  }

  // 2. 未接続の内部要素は、接続された内部要素の下段に並べる
  const internalBox = () =>
    computeBoundary(nodes.filter((n) => isInside(n) && pos.has(n.id)).map((n) => ({ refType: n.refType, kind: kind.get(n.id), name: nameOf(n), ...pos.get(n.id)! })));
  const connectedInternal = internalBox();
  const isolatedInternal = nodes.filter((n) => isInside(n) && !connected.has(n.id));
  if (isolatedInternal.length) {
    let x = connectedInternal ? connectedInternal.x + 32 : ORIGIN;
    const y = connectedInternal ? connectedInternal.y + connectedInternal.height + GAP : ORIGIN;
    for (const n of isolatedInternal) {
      pos.set(n.id, { x, y: y + (n.refType === 'dataFunction' ? 22 : 0) });
      x += size(n).width + GAP;
    }
  }

  // 3. 外部エンティティを境界の左外・右外へ
  const box = internalBox();
  const left: DfdNode[] = [];
  const right: DfdNode[] = [];
  for (const n of nodes.filter(isEE)) {
    if (connected.has(n.id) && hasIn.has(n.id) && !hasOut.has(n.id)) right.push(n);
    else left.push(n);
  }
  /** x は列の基準。alignRight なら各ノードの右端を x に揃える（左外の列） */
  const placeColumn = (list: DfdNode[], x: number, alignRight = false) => {
    // dagre の縦位置の順を保ち、重ならないよう下へずらす
    const sorted = [...list].sort((a, b) => (pos.get(a.id)?.y ?? Infinity) - (pos.get(b.id)?.y ?? Infinity));
    let nextY = -Infinity;
    for (const n of sorted) {
      const { width: w, height: h } = size(n);
      const y = Math.max(pos.get(n.id)?.y ?? (box ? box.y + box.height : ORIGIN), nextY);
      pos.set(n.id, { x: alignRight ? x - w : x, y });
      nextY = y + h + GAP;
    }
  };
  const leftW = Math.max(nodeSize('externalEntity').width, ...left.map((n) => size(n).width));
  if (box) {
    placeColumn(left, box.x - OUTSIDE_GAP, true);
    placeColumn(right, box.x + box.width + OUTSIDE_GAP);
  } else {
    placeColumn(left, ORIGIN + leftW, true);
    placeColumn(right, ORIGIN + leftW + OUTSIDE_GAP * 2);
  }

  // 4. EIF は境界の下の外側に並べる
  const eifs = nodes.filter(isEIF).sort((a, b) => (pos.get(a.id)?.x ?? Infinity) - (pos.get(b.id)?.x ?? Infinity));
  if (eifs.length) {
    let x = box ? box.x : ORIGIN;
    const y = box ? box.y + box.height + OUTSIDE_GAP : ORIGIN;
    for (const n of eifs) {
      pos.set(n.id, { x, y });
      x += size(n).width + GAP;
    }
  }

  // 左上を ORIGIN に揃える（境界の上余白も考慮）
  const all = [...pos.entries()];
  const finalBox = internalBox();
  const minX = Math.min(...all.map(([, p]) => p.x), finalBox?.x ?? Infinity);
  const minY = Math.min(...all.map(([, p]) => p.y), finalBox?.y ?? Infinity);
  return nodes.map((n) => {
    const p = pos.get(n.id) ?? { x: ORIGIN, y: ORIGIN };
    return { nodeId: n.id, x: p.x - minX + ORIGIN, y: p.y - minY + ORIGIN };
  });
}
