import dagre from '@dagrejs/dagre';
import { BOUNDARY, computeBoundary, edgeLabelSize, nodeSize, segmentsCross } from './dfdGeometry';
import type { DfdEdge, DfdNode, FunctionKind, Id } from './types';

export interface LayoutPosition {
  nodeId: Id;
  x: number;
  y: number;
}

const ORIGIN = 40;
const GAP = 40;
/** システム境界と外側の要素の間隔（最小） */
const OUTSIDE_GAP = 56;
/** データフローのラベルの両側に空ける長さ（矢印の分を含む） */
const LABEL_MARGIN = 36;
/** 外部エンティティにラベル付きのデータフローが複数あるときに、境界との間隔を広げる倍率 */
const FAN_OUT_FACTOR = 1.6;
/** 交差を減らす並べ替えを行うデータフローの数の上限（多いと時間がかかるため） */
const MAX_EDGES_FOR_REORDER = 200;
/** 並べ替えで、要素を移す先の範囲（今の順番の前後）と、試す回数の上限 */
const MOVE_RANGE = 4;
const MAX_MOVE_TRIALS = 300;

type Pos = { x: number; y: number };

/**
 * DFD の自動整列（FR-DF-12、design.md 6.6）。
 *
 * 1. 接続された内部の要素（プロセス・ILF）を dagre の左→右の階層レイアウトで並べる。並べる向きは、データの向きにかかわらず
 *    外部エンティティ → プロセス → データファンクションにそろえる（読み出しの流れで並びが崩れて線が交差しないように）。
 * 2. 未接続の内部の要素は、その下段に並べる。
 * 3. 外部エンティティはシステム境界の外に、つながる要素の平均の高さに置く。入力元（出力を持つもの）は左外、
 *    出力先だけのものは右外（FR-DF-18、FR-DF-19）。
 * 4. EIF（外部インタフェースファイル）は境界の下の外側に、つながる要素の下あたりに並べる。
 * 5. dagre の段の中の並び順を、重心法（つながる要素の平均の高さの順）と 1 つずつの移動で変え、
 *    データフローの交差が最も少ない並びを採る。
 *
 * kindOf でデータファンクションの種別を渡すと ILF / EIF を区別する。省略時はすべて内部（ILF）扱い。
 * nameOf で名称を渡すと、名称の長さで変わるノードの大きさ（nodeLayout）を使って並べる。
 * データフローのラベルの大きさ（edgeLabelSize）の分だけノードの間を空け、ラベルがノードに重ならないようにする。
 * 戻り値はノード左上座標。
 */
export function layoutDfd(
  nodes: DfdNode[],
  edges: DfdEdge[],
  kindOf: (n: DfdNode) => FunctionKind | null | undefined = () => 'ILF',
  nameOf: (n: DfdNode) => string = () => '',
): LayoutPosition[] {
  const size = (n: DfdNode) => nodeSize(n.refType, nameOf(n));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
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
  // ラベルのある辺は dagre がラベル用の段を作るので、ranksep は段の間隔の 2 倍として効く
  g.setGraph({ rankdir: 'LR', nodesep: 48, edgesep: 24, ranksep: 80, ranker: 'network-simplex' });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) if (connected.has(n.id)) g.setNode(n.id, size(n));
  // 並べる向きは「外部エンティティ → プロセス → データファンクション」にそろえる。データの向きのままだと、
  // データファンクションから読むプロセスがデータファンクションより右に回り、外部エンティティからの線が図を横切って交差する
  const layer = (id: Id) => {
    const t = nodeById.get(id)?.refType;
    return t === 'externalEntity' ? 0 : t === 'dataFunction' ? 2 : 1;
  };
  edges.forEach((e, i) => {
    if (e.sourceNodeId !== e.targetNodeId && g.hasNode(e.sourceNodeId) && g.hasNode(e.targetNodeId)) {
      const { width, height } = edgeLabelSize(e.label);
      const [from, to] = layer(e.sourceNodeId) > layer(e.targetNodeId) ? [e.targetNodeId, e.sourceNodeId] : [e.sourceNodeId, e.targetNodeId];
      g.setEdge(from, to, { width: width + LABEL_MARGIN, height, labelpos: 'c' }, `e${i}`);
    }
  });
  dagre.layout(g);

  // dagre の結果（左上座標）。列の中の並び順を入れ替えるときは、ここに入れた中心の座標（want）を入れ替える
  const dagrePos = new Map<Id, Pos>();
  for (const n of nodes) {
    if (!connected.has(n.id)) continue;
    const p = g.node(n.id);
    const { width, height } = size(n);
    dagrePos.set(n.id, { x: p.x - width / 2, y: p.y - height / 2 });
  }
  /** 並び順を決める中心座標。内部の要素と外部エンティティは y、EIF は x */
  const want = new Map<Id, number>();
  for (const n of nodes) {
    const p = dagrePos.get(n.id);
    if (p) want.set(n.id, isEIF(n) ? p.x + size(n).width / 2 : p.y + size(n).height / 2);
  }

  const left: DfdNode[] = [];
  const right: DfdNode[] = [];
  for (const n of nodes.filter(isEE)) {
    if (connected.has(n.id) && hasIn.has(n.id) && !hasOut.has(n.id)) right.push(n);
    else left.push(n);
  }
  // dagre の同じ段（中心の x が同じ）に並ぶ、接続された内部の要素
  const ranks = new Map<number, DfdNode[]>();
  for (const n of nodes.filter((x) => isInside(x) && dagrePos.has(x.id))) {
    const cx = Math.round(dagrePos.get(n.id)!.x + size(n).width / 2);
    ranks.set(cx, [...(ranks.get(cx) ?? []), n]);
  }

  const leftW = Math.max(nodeSize('externalEntity').width, ...left.map((n) => size(n).width));
  /** 列の外部エンティティにつながるデータフローのラベルが、境界の内側の要素との間に収まる間隔 */
  /**
   * 1 つの外部エンティティからラベル付きのデータフローが何本も出入りするときは、線が根元で近づくので、
   * 線の間が開く先の方にラベルを置けるよう、さらに FAN_OUT_FACTOR 倍に広げる。
   */
  const gapFor = (list: DfdNode[]) => {
    const ids = new Set(list.map((n) => n.id));
    const labeled = edges.filter((e) => e.label && (ids.has(e.sourceNodeId) || ids.has(e.targetNodeId)));
    const widths = labeled.map((e) => edgeLabelSize(e.label).width);
    const fan = Math.max(0, ...list.map((n) => labeled.filter((e) => e.sourceNodeId === n.id || e.targetNodeId === n.id).length));
    const need = (Math.max(0, ...widths) + LABEL_MARGIN * 2) * (fan > 1 ? FAN_OUT_FACTOR : 1);
    return Math.max(OUTSIDE_GAP, need - BOUNDARY.marginX);
  };

  /** want の並び順から、すべての要素の位置を決める（手順 2〜4） */
  const place = (): Map<Id, Pos> => {
    const pos = new Map<Id, Pos>();
    // 1. 内部の要素は dagre の段ごとに、want の順に上から並べる。間隔は dagre の結果より詰めない
    for (const list of ranks.values()) {
      const sorted = [...list].sort((a, b) => want.get(a.id)! - want.get(b.id)!);
      let nextY = -Infinity;
      for (const n of sorted) {
        const { height: h } = size(n);
        const y = Math.max(want.get(n.id)! - h / 2, nextY);
        pos.set(n.id, { x: dagrePos.get(n.id)!.x, y });
        nextY = y + h + 48;
      }
    }
    const internalBox = () =>
      computeBoundary(nodes.filter((n) => isInside(n) && pos.has(n.id)).map((n) => ({ refType: n.refType, kind: kind.get(n.id), name: nameOf(n), ...pos.get(n.id)! })));

    // 2. 未接続の内部要素は、接続された内部要素の下段に並べる
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
    /** 外部エンティティの高さ（中心）。つながる内部の要素の中心の平均。なければ dagre の位置 */
    const eeCenter = (n: DfdNode) => {
      const ys = edges
        .flatMap((e) => (e.sourceNodeId === n.id ? [e.targetNodeId] : e.targetNodeId === n.id ? [e.sourceNodeId] : []))
        .filter((id) => pos.has(id))
        .map((id) => pos.get(id)!.y + size(nodeById.get(id)!).height / 2);
      return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : want.get(n.id);
    };
    /** x は列の基準。alignRight なら各ノードの右端を x に揃える（左外の列） */
    const placeColumn = (list: DfdNode[], x: number, alignRight = false) => {
      // つながる要素の高さの順に並べ、重ならないよう下へずらす
      const centers = new Map(list.map((n) => [n.id, eeCenter(n)]));
      const sorted = [...list].sort((a, b) => (centers.get(a.id) ?? Infinity) - (centers.get(b.id) ?? Infinity));
      let nextY = -Infinity;
      for (const n of sorted) {
        const { width: w, height: h } = size(n);
        const c = centers.get(n.id);
        const y = Math.max(c !== undefined ? c - h / 2 : box ? box.y + box.height : ORIGIN, nextY);
        pos.set(n.id, { x: alignRight ? x - w : x, y });
        nextY = y + h + GAP;
      }
    };
    if (box) {
      placeColumn(left, box.x - gapFor(left), true);
      placeColumn(right, box.x + box.width + gapFor(right));
    } else {
      placeColumn(left, ORIGIN + leftW, true);
      placeColumn(right, ORIGIN + leftW + Math.max(OUTSIDE_GAP * 2, gapFor([...left, ...right])));
    }

    // 4. EIF は境界の下の外側に、want（横の位置）の順に並べる。つながる要素があれば、その真下あたりに寄せる
    const eifs = nodes.filter(isEIF).sort((a, b) => (want.get(a.id) ?? Infinity) - (want.get(b.id) ?? Infinity));
    if (eifs.length) {
      let x = box ? box.x : ORIGIN;
      const y = box ? box.y + box.height + OUTSIDE_GAP : ORIGIN;
      for (const n of eifs) {
        const peers = edges.flatMap((e) => (e.sourceNodeId === n.id ? [e.targetNodeId] : e.targetNodeId === n.id ? [e.sourceNodeId] : [])).filter((id) => pos.has(id));
        const w = size(n).width;
        const under = peers.length ? peers.reduce((sum, id) => sum + pos.get(id)!.x + size(nodeById.get(id)!).width / 2, 0) / peers.length - w / 2 : x;
        const at = Math.max(x, under);
        pos.set(n.id, { x: at, y });
        x = at + w + GAP;
      }
    }
    return pos;
  };

  /** ノードの中心どうしを結んだ線で数えた、データフローの交差の数 */
  const flows = edges.filter((e) => e.sourceNodeId !== e.targetNodeId && nodeById.has(e.sourceNodeId) && nodeById.has(e.targetNodeId));
  const crossings = (pos: Map<Id, Pos>): number => {
    const center = new Map<Id, Pos>();
    for (const [id, p] of pos) {
      const { width, height } = size(nodeById.get(id)!);
      center.set(id, { x: p.x + width / 2, y: p.y + height / 2 });
    }
    const seg = flows.flatMap((e) => {
      const p = center.get(e.sourceNodeId);
      const q = center.get(e.targetNodeId);
      return p && q ? [{ a: e.sourceNodeId, b: e.targetNodeId, p, q, minX: Math.min(p.x, q.x), maxX: Math.max(p.x, q.x), minY: Math.min(p.y, q.y), maxY: Math.max(p.y, q.y) }] : [];
    });
    let n = 0;
    for (let i = 0; i < seg.length; i++) {
      const s1 = seg[i];
      for (let j = i + 1; j < seg.length; j++) {
        const s2 = seg[j];
        if (s1.minX > s2.maxX || s1.maxX < s2.minX || s1.minY > s2.maxY || s1.maxY < s2.minY) continue;
        // 同じノードにつながる線どうしは数えない
        if (s1.a === s2.a || s1.a === s2.b || s1.b === s2.a || s1.b === s2.b) continue;
        if (segmentsCross(s1.p, s1.q, s2.p, s2.q)) n++;
      }
    }
    return n;
  };

  // 5. dagre の段の中の並び順を変えて、データフローの交差を減らす（外部エンティティと EIF は、つながる要素に合わせて手順 3・4 で動く）。
  //    順番を変えても、段の中で使う位置（want の値の組）は変えない。
  //    まず各要素を、つながる要素の平均の高さの順に並べ直す（重心法）ことを繰り返し、最も交差が少ない並びを採る。
  //    次に、要素を 1 つずつ別の順番へ移し、交差が減るなら採る
  let pos = place();
  if (edges.length <= MAX_EDGES_FOR_REORDER) {
    const groups = [...ranks.values()].map((list) => list.map((n) => n.id)).filter((ids) => ids.length > 1);
    const yGroups = groups;
    const neighbors = new Map<Id, Id[]>();
    for (const e of edges) {
      if (e.sourceNodeId === e.targetNodeId) continue;
      neighbors.set(e.sourceNodeId, [...(neighbors.get(e.sourceNodeId) ?? []), e.targetNodeId]);
      neighbors.set(e.targetNodeId, [...(neighbors.get(e.targetNodeId) ?? []), e.sourceNodeId]);
    }
    let best = crossings(pos);
    let bestWant = new Map(want);
    for (let sweep = 0; sweep < 8 && best > 0; sweep++) {
      for (const ids of sweep % 2 ? [...yGroups].reverse() : yGroups) {
        const slots = ids.map((id) => want.get(id)!).sort((a, b) => a - b);
        const bary = (id: Id) => {
          const ys = (neighbors.get(id) ?? []).filter((n) => pos.has(n)).map((n) => pos.get(n)!.y + size(nodeById.get(n)!).height / 2);
          return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : want.get(id)!;
        };
        const keys = new Map(ids.map((id) => [id, bary(id)]));
        [...ids].sort((a, b) => keys.get(a)! - keys.get(b)! || want.get(a)! - want.get(b)!).forEach((id, k) => want.set(id, slots[k]));
        pos = place();
      }
      const c = crossings(pos);
      if (c < best) {
        best = c;
        bestWant = new Map(want);
      }
    }
    for (const [id, v] of bestWant) want.set(id, v);
    pos = place();
    // 移す先は今の順番の前後 MOVE_RANGE 以内、試す回数は MAX_MOVE_TRIALS まで（大きな DFD で時間がかからないように）
    let trials = 0;
    for (let round = 0; round < 4 && best > 0 && trials < MAX_MOVE_TRIALS; round++) {
      let improved = false;
      for (const ids of groups) {
        const slots = ids.map((id) => want.get(id)!).sort((a, b) => a - b);
        for (let i = 0; i < ids.length && best > 0; i++) {
          const order = [...ids].sort((a, b) => want.get(a)! - want.get(b)!);
          const saved = new Map(ids.map((id) => [id, want.get(id)!]));
          const from = order.indexOf(ids[i]);
          for (let to = Math.max(0, from - MOVE_RANGE); to <= Math.min(order.length - 1, from + MOVE_RANGE) && best > 0 && trials < MAX_MOVE_TRIALS; to++) {
            if (to === from) continue;
            trials++;
            const moved = [...order];
            moved.splice(to, 0, ...moved.splice(from, 1));
            moved.forEach((id, k) => want.set(id, slots[k]));
            const next = place();
            const c = crossings(next);
            if (c < best) {
              best = c;
              pos = next;
              improved = true;
              break;
            }
            for (const [id, v] of saved) want.set(id, v);
          }
        }
      }
      if (!improved) break;
    }
  }
  const internalBox = () =>
    computeBoundary(nodes.filter((n) => isInside(n) && pos.has(n.id)).map((n) => ({ refType: n.refType, kind: kind.get(n.id), name: nameOf(n), ...pos.get(n.id)! })));

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
