import { BaseEdge, EdgeLabelRenderer, useInternalNode, type Edge, type EdgeProps } from '@xyflow/react';
import { memo } from 'react';
import { boxCenter, clipToBoundary, type Box } from '../../../domain/dfdGeometry';
import type { NodeRefType } from '../../../domain/types';
import { tokens } from '../../app/theme';

export type DataflowEdgeType = Edge<{ label: string }, 'dataflow'>;

function boxOf(node: ReturnType<typeof useInternalNode>): Box | null {
  if (!node) return null;
  const { x, y } = node.internals.positionAbsolute;
  const width = node.measured.width ?? node.width ?? 0;
  const height = node.measured.height ?? node.height ?? 0;
  const refType = (node.data as { refType?: NodeRefType }).refType;
  return { x, y, width, height, round: refType === 'transactionFunction' || refType === 'nonCountedProcess' };
}

/**
 * データフロー。ノード中心同士を結ぶ直線を図形境界でクリップする（SVG 出力と同じ見た目、design.md 9.2）。
 */
export const DataflowEdge = memo(function DataflowEdge({ id, source, target, data, selected, markerEnd }: EdgeProps<DataflowEdgeType>) {
  const sb = boxOf(useInternalNode(source));
  const tb = boxOf(useInternalNode(target));
  if (!sb || !tb) return null;
  const p1 = clipToBoundary(sb, boxCenter(tb));
  const p2 = clipToBoundary(tb, boxCenter(sb));
  const path = `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={14}
        style={{ stroke: selected ? tokens.primary : tokens.borderStrong, strokeWidth: selected ? 2 : 1.5 }}
      />
      {data?.label && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: 'absolute', transform: `translate(-50%, -50%) translate(${mx}px, ${my}px)`, fontSize: 12,
              color: selected ? tokens.primary : tokens.textSecondary, background: tokens.canvas, padding: '0 4px', borderRadius: 2,
              pointerEvents: 'none', whiteSpace: 'nowrap',
            }}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

export const edgeTypes = { dataflow: DataflowEdge };
