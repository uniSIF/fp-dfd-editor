import Tooltip from '@mui/material/Tooltip';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo, type CSSProperties, type ReactNode } from 'react';
import { BADGE_COLORS, BOUNDARY, GEOMETRY, nodeLayout } from '../../../domain/dfdGeometry';
import { COMPLEXITY_LABELS } from '../../../domain/fpTables';
import type { DfdNodeView } from '../../../store/selectors';
import { tokens } from '../../app/theme';
import { WarningIcon } from '../../common/WarningIcon';

export type DfdRfNode = Node<DfdNodeView & Record<string, unknown>>;

/** 4 方向の接続ハンドル（ConnectionMode.Loose で source 同士も接続できる） */
function Handles() {
  return (
    <>
      <Handle type="source" position={Position.Top} id="t" className="dfd-handle" />
      <Handle type="source" position={Position.Right} id="r" className="dfd-handle" />
      <Handle type="source" position={Position.Bottom} id="b" className="dfd-handle" />
      <Handle type="source" position={Position.Left} id="l" className="dfd-handle" />
    </>
  );
}

function Badge({ kind, style }: { kind: keyof typeof BADGE_COLORS; style?: CSSProperties }) {
  return (
    <span
      style={{
        position: 'absolute', height: 16, padding: '0 5px', borderRadius: 3, background: BADGE_COLORS[kind], color: '#fff',
        fontSize: 11, fontWeight: 600, lineHeight: '16px', whiteSpace: 'nowrap', ...style,
      }}
    >
      {kind}
    </span>
  );
}

/** 説明ありノードのメモアイコン（FR-DF-16）。ホバーで説明全文 */
function MemoIcon({ text, style }: { text: string; style: CSSProperties }) {
  if (!text) return null;
  return (
    <Tooltip title={<span style={{ whiteSpace: 'pre-wrap' }}>{text}</span>}>
      <svg width="13" height="14" viewBox="0 0 13 14" style={{ position: 'absolute', ...style }} aria-label="説明あり" className="nodrag">
        <path d="M1 1h8l3 3v9H1z" fill="#fff" stroke={tokens.textSecondary} strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M9 1v3h3M3.5 7h5M3.5 10h5" fill="none" stroke={tokens.textSecondary} strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    </Tooltip>
  );
}

function WarningMark({ text, style }: { text: string | null; style: CSSProperties }) {
  if (!text) return null;
  return (
    <span style={{ position: 'absolute', display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: tokens.warning, whiteSpace: 'nowrap', ...style }}>
      <WarningIcon /> {text}
    </span>
  );
}

/**
 * 名称。nodeLayout が計算した 1 行の幅で 2 行に折り返す（ノードはその幅に合わせて横に伸びるので省略しない）。
 * 計算は概算なので、はみ出す場合に備えて行数の上限は残す
 */
function Label({ children, color = tokens.text, size = GEOMETRY.label.fontSize, lineUnits }: { children: ReactNode; color?: string; size?: number; lineUnits: number }) {
  return (
    <span
      style={{
        fontSize: size, color, lineHeight: 1.25, textAlign: 'center', display: '-webkit-box', maxWidth: lineUnits * size + 2,
        WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'break-all',
      }}
    >
      {children}
    </span>
  );
}

function outline(selected: boolean, warning: boolean, base: string = tokens.borderStrong): { border: string; boxShadow?: string } {
  if (selected) return { border: `2px solid ${tokens.primary}`, boxShadow: `0 0 0 4px ${tokens.primarySoft}` };
  if (warning) return { border: `2px solid ${tokens.warning}` };
  return { border: `1.5px solid ${base}` };
}

export const ProcessNode = memo(function ProcessNode({ data, selected }: NodeProps<DfdRfNode>) {
  const ncp = data.refType === 'nonCountedProcess';
  const o = outline(!!selected, !!data.warning);
  // 非計上プロセスは破線。border の一括指定に線種を含め、borderStyle と混在させない
  const dashed = ncp && !selected && !data.warning;
  const border = dashed ? o.border.replace('solid', 'dashed') : o.border;
  const { width, height, lineUnits, fontSize } = nodeLayout(data.refType, data.name);
  return (
    <div
      className="dfd-node"
      title={data.name}
      style={{
        width, height, borderRadius: '50%', boxSizing: 'border-box', background: ncp ? '#F1F3F5' : '#fff',
        border, boxShadow: o.boxShadow,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 3, position: 'relative',
      }}
    >
      {data.kind && <Badge kind={data.kind} style={{ top: -22, left: '50%', transform: 'translateX(-50%)' }} />}
      <Label color={ncp ? tokens.textSecondary : tokens.text} size={fontSize} lineUnits={lineUnits}>{data.name}</Label>
      {data.displayNo && (
        <span style={{ fontSize: 11, color: tokens.textSecondary, whiteSpace: 'nowrap' }}>
          {data.displayNo} · {data.complexity ? COMPLEXITY_LABELS[data.complexity] : ''}
        </span>
      )}
      <MemoIcon text={data.description} style={{ top: 2, right: 2 }} />
      <WarningMark text={data.warning} style={{ top: -20, left: -16 }} />
      <Handles />
    </div>
  );
});

export const DataStoreNode = memo(function DataStoreNode({ data, selected }: NodeProps<DfdRfNode>) {
  const { width, height, lineUnits } = nodeLayout('dataFunction', data.name);
  const color = selected ? tokens.primary : data.warning ? tokens.warning : tokens.borderStrong;
  const w = selected || data.warning ? 2 : 1.5;
  return (
    <div
      className="dfd-node"
      title={data.name}
      style={{
        width, height, boxSizing: 'border-box', background: '#fff', borderTop: `${w}px solid ${color}`, borderBottom: `${w}px solid ${color}`,
        boxShadow: selected ? `0 0 0 4px ${tokens.primarySoft}` : undefined,
        display: 'flex', alignItems: 'center', position: 'relative', paddingLeft: 42, paddingRight: 8,
      }}
    >
      {data.kind && <Badge kind={data.kind} style={{ left: 6, top: '50%', transform: 'translateY(-50%)' }} />}
      <span style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0 }}>
        <Label lineUnits={lineUnits}>{data.name}</Label>
        {data.displayNo && (
          <span style={{ fontSize: 11, color: tokens.textSecondary, whiteSpace: 'nowrap' }}>
            {data.displayNo} · {data.complexity ? COMPLEXITY_LABELS[data.complexity] : ''}
          </span>
        )}
      </span>
      {data.isReference && (
        <span style={{ position: 'absolute', top: height + 2, left: 0, right: 0, textAlign: 'center', fontSize: 11, color: data.ownerName === '未設定' ? tokens.warning : tokens.textSecondary, whiteSpace: 'nowrap' }}>
          所有: {data.ownerName}
        </span>
      )}
      <MemoIcon text={data.description} style={{ top: 4, right: 4 }} />
      <WarningMark text={data.warning} style={{ top: -18, left: 0 }} />
      <Handles />
    </div>
  );
});

export const ExternalEntityNode = memo(function ExternalEntityNode({ data, selected }: NodeProps<DfdRfNode>) {
  const { width, height, lineUnits } = nodeLayout('externalEntity', data.name);
  return (
    <div
      className="dfd-node"
      title={data.name}
      style={{
        width, height, boxSizing: 'border-box', background: '#fff', ...outline(!!selected, !!data.warning, tokens.text),
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 6, position: 'relative',
      }}
    >
      <Label lineUnits={lineUnits}>{data.name}</Label>
      {data.duplicate && <DuplicateMark />}
      <MemoIcon text={data.description} style={{ top: 3, right: 3 }} />
      <WarningMark text={data.warning} style={{ top: -18, left: 0 }} />
      <Handles />
    </div>
  );
});

/**
 * 同じ外部エンティティを複数配置したときの印（DFD の慣例どおり左上の角に斜線）。FR-DF-18
 */
function DuplicateMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" style={{ position: 'absolute', left: 0, top: 0 }} aria-label="同じ外部エンティティを複数配置">
      <path d="M0 12 L12 0" stroke={tokens.text} strokeWidth="1.5" />
    </svg>
  );
}

/**
 * システム境界（FR-DF-19）。選択・ドラッグ・クリックを受け付けない枠だけのノード。
 * 位置と大きさは rfMapping.withBoundary が内部の要素から計算する。
 */
export const BoundaryNode = memo(function BoundaryNode({ data }: NodeProps<DfdRfNode>) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: '100%', height: '100%', boxSizing: 'border-box', border: `2px solid ${BOUNDARY.color}`, borderRadius: BOUNDARY.radius,
        pointerEvents: 'none', position: 'relative',
      }}
    >
      <span style={{ position: 'absolute', left: 12, top: 6, fontSize: 12, fontWeight: 600, color: BOUNDARY.color, whiteSpace: 'nowrap' }}>
        {(data as unknown as { label: string }).label}
      </span>
    </div>
  );
});

export const nodeTypes = {
  boundary: BoundaryNode,
  transactionFunction: ProcessNode,
  nonCountedProcess: ProcessNode,
  dataFunction: DataStoreNode,
  externalEntity: ExternalEntityNode,
};
