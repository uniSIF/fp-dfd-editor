import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from '@xyflow/react';
import { memo } from 'react';
import { EDGE_LABEL, edgeLabelLines, type EdgeRoute } from '../../../domain/dfdGeometry';
import { tokens } from '../../app/theme';

export type DataflowEdgeType = Edge<{ label: string; route?: EdgeRoute }, 'dataflow'>;

/**
 * データフロー。経路とラベルの位置は toRfEdges が routeDataflows でまとめて求めたものを使う（SVG 出力と同じ、design.md 9.2）。
 * 両端は図形境界でクリップし、途中のノードは曲線で避ける。ラベルはほかの線・ラベルを避けた位置に、折り返して表示する。
 */
export const DataflowEdge = memo(function DataflowEdge({ id, data, selected, markerEnd }: EdgeProps<DataflowEdgeType>) {
  const route = data?.route;
  if (!route) return null;
  const lines = edgeLabelLines(data.label);
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
