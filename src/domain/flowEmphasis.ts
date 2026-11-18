/**
 * 注目しているノード・データフローから見た、データフローの強調のしかた。
 * out: 注目ノードから出る線、in: 注目ノードに入る線、both: 両端とも注目ノード、self: 注目している線そのもの
 */
export type FlowEmphasis = 'out' | 'in' | 'both' | 'self';

export interface FlowFocus {
  /** 強調するデータフロー。ここにない線は薄くする */
  edges: Map<string, FlowEmphasis>;
  /** 強調する線の両端のノードと、注目ノード。ここにないノードは薄くする */
  nodes: Set<string>;
}

/**
 * 線が多い DFD で、どの線がどのノードから出ているかを追えるよう、注目対象（選択・ホバー）につながる線とノードを求める。
 * 注目対象がなければ null（すべて通常の表示）。画面だけで使い、SVG 出力には影響しない。
 */
export function flowEmphasis(
  edges: { id: string; sourceNodeId: string; targetNodeId: string }[],
  focusNodeIds: string[],
  focusEdgeId: string | null,
): FlowFocus | null {
  if (focusNodeIds.length) {
    const focus = new Set(focusNodeIds);
    const out: FlowFocus = { edges: new Map(), nodes: new Set(focus) };
    for (const e of edges) {
      const from = focus.has(e.sourceNodeId);
      const to = focus.has(e.targetNodeId);
      if (!from && !to) continue;
      out.edges.set(e.id, from && to ? 'both' : from ? 'out' : 'in');
      out.nodes.add(e.sourceNodeId);
      out.nodes.add(e.targetNodeId);
    }
    return out;
  }
  const e = focusEdgeId ? edges.find((x) => x.id === focusEdgeId) : undefined;
  if (!e) return null;
  return { edges: new Map([[e.id, 'self']]), nodes: new Set([e.sourceNodeId, e.targetNodeId]) };
}
