import { MarkerType } from '@xyflow/react';
import { computeBoundary, nodeSize, routeDataflows, type Box, type EdgeRoute } from '../../domain/dfdGeometry';
import type { FlowFocus } from '../../domain/flowEmphasis';
import type { DfdEdge, Id } from '../../domain/types';
import type { DfdNodeView } from '../../store/selectors';
import { flowColor, type DataflowEdgeType } from './edges/DataflowEdge';
import type { DfdRfNode } from './nodes/DfdNodes';

/** ストアの DFD ノードを React Flow のノードにする（DFD タブとプレビューで共用） */
export function toRfNodes(view: DfdNodeView[], selectedNodeIds: Id[]): DfdRfNode[] {
  const sel = new Set(selectedNodeIds);
  return view.map((v) => {
    const size = nodeSize(v.refType, v.name);
    return {
      id: v.nodeId,
      type: v.refType,
      position: { x: v.x, y: v.y },
      data: v as DfdRfNode['data'],
      selected: sel.has(v.nodeId),
      width: size.width,
      height: size.height,
      ariaLabel: `${v.kind ?? ''} ${v.name}`.trim(),
    };
  });
}

/**
 * 作り直したノードに、前回のノードで React Flow が測った寸法（measured）を引き継ぐ。
 * measured のない新しいノードを渡すと、React Flow は測り直すまでそのノードにつながるデータフローを描かないため、
 * ラベルの編集や選択のたびに線が 1 フレーム消える。大きさが変わったノードは測り直させる。
 */
export function keepMeasured(prev: DfdRfNode[], next: DfdRfNode[]): DfdRfNode[] {
  const byId = new Map(prev.map((n) => [n.id, n]));
  return next.map((n) => {
    const p = byId.get(n.id);
    return p?.measured && p.width === n.width && p.height === n.height ? { ...n, measured: p.measured } : n;
  });
}

/**
 * データフローの経路とラベルの位置を、渡されたノードの現在位置（ドラッグ中を含む）から
 * すべてのデータフローをまとめて求める（ラベルがほかの線・ラベルを避けるため。design.md 9.2）。境界ノード（withBoundary）を含めて渡すと、境界の線も避ける。
 * 選択・ホバーでは変わらないので、強調の反映（toRfEdges）とは分けて計算する。
 */
export function routeRfEdges(edges: DfdEdge[], nodes: DfdRfNode[]): Map<string, EdgeRoute> {
  const boxes = new Map<string, Box>();
  let boundary: { x: number; y: number; width: number; height: number } | null = null;
  for (const n of nodes) {
    if (n.type === 'boundary') {
      boundary = { x: n.position.x, y: n.position.y, width: n.width ?? 0, height: n.height ?? 0 };
      continue;
    }
    const round = n.data.refType === 'transactionFunction' || n.data.refType === 'nonCountedProcess';
    boxes.set(n.id, { x: n.position.x, y: n.position.y, width: n.measured?.width ?? n.width ?? 0, height: n.measured?.height ?? n.height ?? 0, round });
  }
  return routeDataflows(boxes, edges, boundary);
}

/**
 * ストアのデータフローを React Flow のエッジにする。経路は routeRfEdges で求めたものを渡す。
 * focus（マウスを載せたノードや線。flowEmphasis）があれば、つながる線を強調してほかを薄くする。
 */
export function toRfEdges(edges: DfdEdge[], routes: Map<string, EdgeRoute>, selectedEdgeId: Id | null, focus: FlowFocus | null): DataflowEdgeType[] {
  return edges.map((e) => {
    const selected = e.id === selectedEdgeId;
    const emphasis = focus ? focus.edges.get(e.id) ?? 'dim' : undefined;
    return {
      id: e.id,
      source: e.sourceNodeId,
      target: e.targetNodeId,
      type: 'dataflow',
      data: { label: e.label, route: routes.get(e.id), emphasis },
      selected,
      className: emphasis === 'dim' ? DIM_CLASS : undefined,
      // 強調する線は、薄くした線の手前に描く
      zIndex: emphasis && emphasis !== 'dim' ? 1 : 0,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: flowColor(emphasis, selected) },
    };
  });
}

/** 薄くするノード・データフローに付けるクラス（styles.css） */
export const DIM_CLASS = 'dfd-dim';

/** focus があれば、強調する線につながらないノードを薄くする。システム境界は対象外 */
export function dimNodes(nodes: DfdRfNode[], focus: FlowFocus | null): DfdRfNode[] {
  if (!focus) return nodes;
  return nodes.map((n) => (n.type === 'boundary' || focus.nodes.has(n.id) ? n : { ...n, className: DIM_CLASS }));
}

export const BOUNDARY_NODE_ID = '__boundary__';

/**
 * システム境界のノードを先頭に足す（FR-DF-19）。
 * 渡されたノードの現在位置（ドラッグ中を含む）から計算するので、移動に追従する。
 * 境界は選択・ドラッグ・フォーカス・クリックの対象外。
 */
export function withBoundary(nodes: DfdRfNode[], softwareName: string): DfdRfNode[] {
  const b = computeBoundary(
    nodes.map((n) => ({ refType: n.data.refType, x: n.position.x, y: n.position.y, kind: n.data.kind, name: n.data.name })),
  );
  if (!b) return nodes;
  const boundary = {
    id: BOUNDARY_NODE_ID,
    type: 'boundary',
    position: { x: b.x, y: b.y },
    width: b.width,
    height: b.height,
    // 境界ノードは DfdNodeView を持たない。部品側は label だけを読む
    data: { label: `システム境界: ${softwareName}` } as unknown as DfdRfNode['data'],
    selectable: false,
    draggable: false,
    focusable: false,
    connectable: false,
    zIndex: -1,
    style: { pointerEvents: 'none' as const },
    ariaRole: 'presentation',
  } as DfdRfNode;
  return [boundary, ...nodes];
}
