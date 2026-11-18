import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from '@xyflow/react';
import { memo } from 'react';
import { EDGE_LABEL, EDGE_START_DOT, edgeLabelLines, type EdgeRoute } from '../../../domain/dfdGeometry';
import type { FlowEmphasis } from '../../../domain/flowEmphasis';
import { tokens } from '../../app/theme';

/** 選択・ホバーしているノードや線から見た強調のしかた（flowEmphasis）。dim は薄くする線 */
export type EdgeEmphasis = FlowEmphasis | 'dim';

export type DataflowEdgeType = Edge<{ label: string; route?: EdgeRoute; emphasis?: EdgeEmphasis }, 'dataflow'>;

const isStrong = (emphasis: EdgeEmphasis | undefined, selected: boolean | undefined) => !!selected || (!!emphasis && emphasis !== 'dim');

/** 線・矢じり・始点の丸印の色。注目ノードに入る線だけ色を変えて、出る線と見分けられるようにする */
export function flowColor(emphasis: EdgeEmphasis | undefined, selected: boolean | undefined): string {
  if (emphasis === 'in' && !selected) return tokens.flowIn;
  return isStrong(emphasis, selected) ? tokens.primary : tokens.borderStrong;
}

/**
 * データフロー。経路とラベルの位置は routeRfEdges が routeDataflows でまとめて求めたものを使う（SVG 出力と同じ、design.md 9.2）。
 * 両端は図形境界でクリップし、途中のノードは曲線で避ける。ラベルはほかの線・ラベルを避けた位置に、折り返して表示する。
 * 始点には丸印を付ける。選択・ホバーしているノードにつながる線は強調し、ほかは薄くする（toRfEdges）。
 */
export const DataflowEdge = memo(function DataflowEdge({ id, data, selected, markerEnd }: EdgeProps<DataflowEdgeType>) {
  const route = data?.route;
  if (!route) return null;
  const lines = edgeLabelLines(data.label);
  const strong = isStrong(data.emphasis, selected);
  const color = flowColor(data.emphasis, selected);
  return (
    <>
      <BaseEdge
        id={id}
        path={route.path}
        markerEnd={markerEnd}
        interactionWidth={14}
        style={{ stroke: color, strokeWidth: strong ? 2 : 1.5 }}
      />
      <circle className="dfd-edge-dot" cx={route.dot.x} cy={route.dot.y} r={EDGE_START_DOT} fill={color} pointerEvents="none" />
      {lines.length > 0 && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: 'absolute', transform: `translate(-50%, -50%) translate(${route.label.x}px, ${route.label.y}px)`,
              fontSize: EDGE_LABEL.fontSize, lineHeight: `${EDGE_LABEL.lineHeight}px`, textAlign: 'center',
              color: strong ? color : tokens.textSecondary, background: tokens.canvas, padding: `0 ${EDGE_LABEL.padX}px`, borderRadius: 2,
              pointerEvents: 'none', whiteSpace: 'nowrap',
              // ラベルは線とは別の層に描かれるので、薄くする指定をここでも行う。強調する線のラベルは手前に出す
              opacity: data.emphasis === 'dim' ? 0.35 : 1, zIndex: strong ? 1 : 0, transition: 'opacity .12s',
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
