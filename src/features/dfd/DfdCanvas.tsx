import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type IsValidConnection,
  type NodeChange,
  type OnConnectEnd,
  type Viewport,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { BADGE_COLORS, nodeSize } from '../../domain/dfdGeometry';
import { canConnectNodes } from '../../domain/dfdRules';
import type { Id } from '../../domain/types';
import { useStore } from '../../store';
import { selectDfdNodes } from '../../store/selectors';
import { tokens } from '../app/theme';
import { AddFunctionDialog, type AddKind, type AddRequest } from './AddFunctionDialog';
import { edgeTypes, type DataflowEdgeType } from './edges/DataflowEdge';
import { nodeTypes, type DfdRfNode } from './nodes/DfdNodes';
import { NodePalette, PALETTE_MIME } from './NodePalette';
import { ReferenceDialog } from './ReferenceDialog';
import { DfdLegendPanel } from './DfdLegend';
import { DFD_FIT_VIEW } from './fitView';
import { toRfEdges, toRfNodes, withBoundary } from './rfMapping';
import { softwareIdOfFeature } from '../../domain/queries';

/** 機能ごとのビューポート（UI 状態。保存・履歴の対象外、design.md 6.7） */
const viewports = new Map<Id, Viewport>();

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function DfdCanvas({ featureId }: { featureId: Id }) {
  const doc = useStore((s) => s.doc);
  const selectedNodeIds = useStore((s) => s.selectedNodeIds);
  const selectedEdgeId = useStore((s) => s.selectedEdgeId);
  const view = selectDfdNodes(doc, featureId);
  const dfdEdges = doc.features[featureId]?.dfd.edges;
  const rf = useReactFlow<DfdRfNode, DataflowEdgeType>();
  const wrapper = useRef<HTMLDivElement>(null);
  const [addRequest, setAddRequest] = useState<AddRequest | null>(null);
  const [refRequest, setRefRequest] = useState<{ position?: { x: number; y: number } } | null>(null);

  // ストアから React Flow のノードを導出し、ドラッグ中だけローカルに位置を持つ（design.md 6.1）
  const [nodes, setNodes] = useState<DfdRfNode[]>([]);
  useEffect(() => setNodes(toRfNodes(view, selectedNodeIds)), [view, selectedNodeIds]);

  const edges = useMemo(() => toRfEdges(dfdEdges ?? [], selectedEdgeId), [dfdEdges, selectedEdgeId]);
  const swId = softwareIdOfFeature(doc, featureId);
  const softwareName = swId ? doc.softwares[swId]?.name ?? '' : '';
  // ドラッグ中のローカル位置から境界を計算し直す（FR-DF-19）
  const displayNodes = useMemo(() => withBoundary(nodes, softwareName), [nodes, softwareName]);

  const onNodesChange = useCallback(
    (changes: NodeChange<DfdRfNode>[]) => {
      // 選択はストアが正。クリック・範囲選択による変更をストアへ反映する
      const sel = changes.filter((c) => c.type === 'select');
      if (sel.length) {
        const s = useStore.getState();
        const cur = new Set(s.selectedNodeIds);
        for (const c of sel) {
          if (c.selected) cur.add(c.id);
          else cur.delete(c.id);
        }
        const ids = [...cur];
        const edgeId = ids.length ? null : s.selectedEdgeId;
        if (!sameIds(ids, s.selectedNodeIds) || edgeId !== s.selectedEdgeId) s.setSelection(ids, edgeId);
      }
      // 位置と寸法はローカルに反映する
      const local = changes.filter((c) => c.type === 'position' || c.type === 'dimensions');
      if (local.length) setNodes((ns) => applyNodeChanges(local, ns));
      // ドラッグ終了・キーボード移動で確定（1 操作 = 1 履歴）
      const commits = changes.flatMap((c) =>
        c.type === 'position' && c.dragging === false && c.position ? [{ nodeId: c.id, x: c.position.x, y: c.position.y }] : [],
      );
      if (commits.length) useStore.getState().moveNodes(featureId, commits);
    },
    [featureId],
  );

  const onEdgesChange = useCallback((changes: EdgeChange<DataflowEdgeType>[]) => {
    const s = useStore.getState();
    for (const c of changes) {
      if (c.type !== 'select') continue;
      if (c.selected) s.setSelection([], c.id);
      else if (s.selectedEdgeId === c.id) s.setSelection(useStore.getState().selectedNodeIds, null);
    }
  }, []);

  const nodeRef = useCallback(
    (id: string) => useStore.getState().doc.features[featureId]?.dfd.nodes.find((n) => n.id === id),
    [featureId],
  );

  const isValidConnection = useCallback<IsValidConnection<Edge>>(
    (c) => {
      const a = nodeRef(c.source);
      const b = nodeRef(c.target);
      return !!a && !!b && canConnectNodes(a, b).ok;
    },
    [nodeRef],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      const s = useStore.getState();
      const r = s.addEdge(featureId, c.source, c.target);
      if (!r.ok) s.notify(r.reason, 'error');
    },
    [featureId],
  );

  /**
   * ハンドル以外（ノード本体）にドロップした場合も接続する。
   * 接続ルール違反なら理由を表示する（FR-DF-06）。
   */
  const onConnectEnd = useCallback<OnConnectEnd>(
    (event, state) => {
      if (state.isValid) return; // ハンドルに接続できた場合は onConnect で処理済み
      const fromId = state.fromNode?.id;
      if (!fromId) return;
      let toId = state.toNode?.id;
      if (!toId) {
        const pt = 'changedTouches' in event ? event.changedTouches[0] : event;
        const el = document.elementFromPoint(pt.clientX, pt.clientY);
        toId = el?.closest('.react-flow__node')?.getAttribute('data-id') ?? undefined;
      }
      if (!toId || toId === fromId) return;
      const s = useStore.getState();
      const r = s.addEdge(featureId, fromId, toId);
      if (!r.ok) s.notify(r.reason, 'error');
    },
    [featureId],
  );

  // 機能を切り替えたら、保存していたビューポートを復元するか全体表示する
  useEffect(() => {
    const vp = viewports.get(featureId);
    const id = requestAnimationFrame(() => {
      if (vp) void rf.setViewport(vp);
      else void rf.fitView(DFD_FIT_VIEW);
    });
    return () => cancelAnimationFrame(id);
  }, [featureId, rf]);

  const centerPosition = (kind: AddKind | 'REF') => {
    const rect = wrapper.current?.getBoundingClientRect();
    if (!rect) return undefined;
    const p = rf.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    const size = nodeSize(kind === 'TF' || kind === 'NCP' ? 'transactionFunction' : kind === 'EE' ? 'externalEntity' : 'dataFunction');
    return { x: p.x - size.width / 2, y: p.y - size.height / 2 };
  };

  const onDrop = (e: DragEvent) => {
    const kind = e.dataTransfer.getData(PALETTE_MIME) as AddKind | 'REF' | '';
    if (!kind) return;
    e.preventDefault();
    const position = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    if (kind === 'REF') setRefRequest({ position });
    else setAddRequest({ kind, position });
  };

  const requestAdd = (kind: AddKind | 'REF') => {
    if (kind === 'REF') setRefRequest({ position: centerPosition(kind) });
    else setAddRequest({ kind, position: centerPosition(kind) });
  };

  return (
    <Box
      ref={wrapper}
      sx={{ flex: 1, position: 'relative', minHeight: 0 }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(PALETTE_MIME)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={onDrop}
      data-testid="dfd-canvas"
    >
      <ReactFlow<DfdRfNode, DataflowEdgeType>
        nodes={displayNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        connectionMode={ConnectionMode.Loose}
        connectionLineStyle={{ stroke: tokens.primary, strokeWidth: 1.5 }}
        deleteKeyCode={null}
        selectionKeyCode="Shift"
        multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
        minZoom={0.2}
        maxZoom={2}
        onMoveEnd={(_, vp) => viewports.set(featureId, vp)}
        proOptions={{ hideAttribution: true }}
        fitViewOptions={DFD_FIT_VIEW}
        style={{ background: tokens.canvas }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color={tokens.border} />
        <Controls position="bottom-left" showInteractive aria-label="表示操作" />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          nodeColor={(n) => {
            if (n.type === 'boundary') return 'transparent';
            const d = (n as DfdRfNode).data;
            return d.kind ? BADGE_COLORS[d.kind] : tokens.border;
          }}
          style={{ width: 160, height: 100, border: `1px solid ${tokens.border}`, borderRadius: 6 }}
        />
      </ReactFlow>
      <NodePalette onRequest={requestAdd} />
      <DfdLegendPanel featureId={featureId} />
      {view.length === 0 && (
        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <Box sx={{ textAlign: 'center', pointerEvents: 'auto' }}>
            <Typography sx={{ fontSize: 16, fontWeight: 600, mb: 1 }}>ノードがありません</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>パレットから追加するか、ファンクション表で追加します。</Typography>
            <Button variant="contained" onClick={() => requestAdd('TF')}>トランザクションファンクションを追加</Button>
          </Box>
        </Box>
      )}
      {addRequest && (
        <AddFunctionDialog
          featureId={featureId}
          request={addRequest}
          onClose={() => setAddRequest(null)}
          onAdded={(refId) => {
            const n = useStore.getState().doc.features[featureId].dfd.nodes.find((x) => x.refId === refId);
            if (n) useStore.getState().setSelection([n.id], null);
          }}
        />
      )}
      {refRequest && <ReferenceDialog featureId={featureId} position={refRequest.position} onClose={() => setRefRequest(null)} />}
    </Box>
  );
}
