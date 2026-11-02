import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { Background, BackgroundVariant, ConnectionMode, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { Id } from '../../domain/types';
import { useStore } from '../../store';
import { selectDfdNodes } from '../../store/selectors';
import { tokens } from '../app/theme';
import { edgeTypes, type DataflowEdgeType } from '../dfd/edges/DataflowEdge';
import { nodeTypes, type DfdRfNode } from '../dfd/nodes/DfdNodes';
import { toRfEdges, toRfNodes, withBoundary } from '../dfd/rfMapping';
import { softwareIdOfFeature } from '../../domain/queries';
import { DfdLegendInline } from '../dfd/DfdLegend';

const MIN_H = 120;
const MAX_H = 520;
const KEY = 'fpdfd.ui.functionPreview';

/** 表示状態と高さはこのブラウザだけの利便設定として保存する（保存ファイル・履歴の対象外） */
function loadPrefs(): { open: boolean; height: number } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '');
    if (typeof v?.open === 'boolean' && typeof v?.height === 'number') return { open: v.open, height: Math.min(MAX_H, Math.max(MIN_H, v.height)) };
  } catch {
    // 未保存・破損時は既定値
  }
  return { open: true, height: 240 };
}

function savePrefs(p: { open: boolean; height: number }) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // 保存できなくても表示には影響しない
  }
}

export function usePreviewPrefs() {
  const [prefs, setPrefs] = useState(loadPrefs);
  const update = (p: Partial<typeof prefs>) => {
    setPrefs((cur) => {
      const next = { ...cur, ...p };
      savePrefs(next);
      return next;
    });
  };
  return [prefs, update] as const;
}

/**
 * ファンクション表の上に置く DFD の縮小表示（FR-FN-16）。
 * 閲覧専用。ノードのクリックでファンクション表の行と選択を連動させる。
 */
export function DfdPreview({ featureId, height, onResize }: { featureId: Id; height: number; onResize: (h: number) => void }) {
  return (
    <Box sx={{ height, flex: 'none', position: 'relative', borderBottom: `1px solid ${tokens.border}` }} data-testid="dfd-preview">
      <ReactFlowProvider>
        <PreviewFlow featureId={featureId} height={height} />
      </ReactFlowProvider>
      <ResizeBar height={height} onResize={onResize} />
    </Box>
  );
}

function PreviewFlow({ featureId, height }: { featureId: Id; height: number }) {
  const doc = useStore((s) => s.doc);
  const selectedNodeIds = useStore((s) => s.selectedNodeIds);
  const selectedEdgeId = useStore((s) => s.selectedEdgeId);
  const view = selectDfdNodes(doc, featureId);
  const swId = softwareIdOfFeature(doc, featureId);
  const softwareName = swId ? doc.softwares[swId]?.name ?? '' : '';
  const nodes = useMemo(() => withBoundary(toRfNodes(view, selectedNodeIds), softwareName), [view, selectedNodeIds, softwareName]);
  const dfdEdges = doc.features[featureId]?.dfd.edges;
  const edges = useMemo(() => toRfEdges(dfdEdges ?? [], selectedEdgeId), [dfdEdges, selectedEdgeId]);
  const rf = useReactFlow<DfdRfNode, DataflowEdgeType>();

  // 機能・ノード数・高さが変わったら全体が収まるように表示し直す
  useEffect(() => {
    const id = requestAnimationFrame(() => void rf.fitView({ padding: 0.12, maxZoom: 0.9 }));
    return () => cancelAnimationFrame(id);
  }, [rf, featureId, view.length, height]);

  if (view.length === 0) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: tokens.canvas }}>
        <Typography sx={{ fontSize: 12, color: tokens.textSecondary }}>この機能の DFD にはまだノードがありません。</Typography>
      </Box>
    );
  }

  return (
    <>
      <ReactFlow<DfdRfNode, DataflowEdgeType>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        connectionMode={ConnectionMode.Loose}
        elementsSelectable
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        zoomOnDoubleClick={false}
        minZoom={0.1}
        maxZoom={1.5}
        onNodeClick={(_, n) => useStore.getState().setSelection([n.id], null)}
        onEdgeClick={(_, e) => useStore.getState().setSelection([], e.id)}
        onPaneClick={() => useStore.getState().setSelection([], null)}
        onNodeDoubleClick={(_, n) => {
          const s = useStore.getState();
          s.setSelection([n.id], null);
          s.setActiveTab('dfd');
        }}
        proOptions={{ hideAttribution: true }}
        style={{ background: tokens.canvas }}
        aria-label="DFD プレビュー"
        className="dfd-preview"
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color={tokens.border} />
      </ReactFlow>
      <Box sx={{ position: 'absolute', top: 6, right: 8, display: 'flex', gap: 2, alignItems: 'center', fontSize: 11, color: tokens.textSecondary, background: 'rgba(247,248,250,.9)', px: 1.5, borderRadius: '3px' }}>
        <DfdLegendInline featureId={featureId} />
        <Link component="button" sx={{ fontSize: 12 }} onClick={() => useStore.getState().setActiveTab('dfd')}>DFD タブで編集</Link>
      </Box>
    </>
  );
}

/** 下端のバーをドラッグして高さを変える */
function ResizeBar({ height, onResize }: { height: number; onResize: (h: number) => void }) {
  const start = useRef<{ y: number; h: number } | null>(null);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    start.current = { y: e.clientY, h: height };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    onResize(Math.min(MAX_H, Math.max(MIN_H, start.current.h + e.clientY - start.current.y)));
  };
  const onPointerUp = () => {
    start.current = null;
  };
  return (
    <Box
      role="separator"
      aria-orientation="horizontal"
      aria-label="DFD プレビューの高さ"
      aria-valuenow={height}
      aria-valuemin={MIN_H}
      aria-valuemax={MAX_H}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp') onResize(Math.max(MIN_H, height - 20));
        if (e.key === 'ArrowDown') onResize(Math.min(MAX_H, height + 20));
      }}
      sx={{
        position: 'absolute', left: 0, right: 0, bottom: -4, height: 8, cursor: 'row-resize', zIndex: 6,
        '&::after': { content: '""', position: 'absolute', left: '50%', top: 3, width: 32, height: 2, ml: '-16px', borderRadius: 1, background: tokens.borderStrong },
        '&:hover::after, &:focus-visible::after': { background: tokens.primary },
      }}
    />
  );
}
