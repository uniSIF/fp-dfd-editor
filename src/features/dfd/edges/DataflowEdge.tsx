import { BaseEdge, EdgeLabelRenderer, useInternalNode, useNodes, type Edge, type EdgeProps, type Node } from '@xyflow/react';
import { memo, useMemo } from 'react';
import { EDGE_LABEL, edgeLabelLines, edgeLabelSize, routeEdge, type Box } from '../../../domain/dfdGeometry';
import type { NodeRefType } from '../../../domain/types';
import { tokens } from '../../app/theme';

export type DataflowEdgeType = Edge<{ label: string; bias?: number }, 'dataflow'>;

const isRound = (refType: NodeRefType | undefined) => refType === 'transactionFunction' || refType === 'nonCountedProcess';

function boxOf(node: ReturnType<typeof useInternalNode>): Box | null {
  if (!node) return null;
  const { x, y } = node.internals.positionAbsolute;
  const width = node.measured.width ?? node.width ?? 0;
  const height = node.measured.height ?? node.height ?? 0;
  return { x, y, width, height, round: isRound((node.data as { refType?: NodeRefType }).refType) };
}

/** 線が避けるノード（システム境界は除く） */
function obstacleBoxes(nodes: Node[]): Box[] {
  return nodes
    .filter((n) => n.type !== 'boundary')
    .map((n) => ({
      x: n.position.x,
      y: n.position.y,
      width: n.measured?.width ?? n.width ?? 0,
      height: n.measured?.height ?? n.height ?? 0,
      round: isRound((n.data as { refType?: NodeRefType }).refType),
    }));
}

/**
 * データフロー。両端を図形境界でクリップし、途中のノードやラベルの重なりは曲線で避ける（SVG 出力と同じ経路、design.md 9.2）。
 * 長いラベルは折り返して表示する。
 */
export const DataflowEdge = memo(function DataflowEdge({ id, source, target, data, selected, markerEnd }: EdgeProps<DataflowEdgeType>) {
  const sb = boxOf(useInternalNode(source));
  const tb = boxOf(useInternalNode(target));
  const nodes = useNodes();
  const obstacles = useMemo(() => obstacleBoxes(nodes), [nodes]);
  const label = data?.label ?? '';
  if (!sb || !tb) return null;
  const route = routeEdge(sb, tb, obstacles, edgeLabelSize(label), data?.bias ?? 0);
  const lines = edgeLabelLines(label);
  return (
    <>
      <BaseEdge
        id={id}
        path={route.path}
        markerEnd={markerEnd}
        interactionWidth={14}
        style={{ stroke: selected ? tokens.primary : tokens.borderStrong, strokeWidth: selected ? 2 : 1.5 }}
      />
      {lines.length > 0 && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: 'absolute', transform: `translate(-50%, -50%) translate(${route.label.x}px, ${route.label.y}px)`,
              fontSize: EDGE_LABEL.fontSize, lineHeight: `${EDGE_LABEL.lineHeight}px`, textAlign: 'center',
              color: selected ? tokens.primary : tokens.textSecondary, background: tokens.canvas, padding: `0 ${EDGE_LABEL.padX}px`, borderRadius: 2,
              pointerEvents: 'none', whiteSpace: 'nowrap',
            }}
          >
            {lines.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

export const edgeTypes = { dataflow: DataflowEdge };
