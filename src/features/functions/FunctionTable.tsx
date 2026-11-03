import AddLinkIcon from '@mui/icons-material/AddLink';
import CloseIcon from '@mui/icons-material/Close';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { DataGrid, type GridColDef, type GridRenderCellParams } from '@mui/x-data-grid';
import { useState } from 'react';
import { nodeSize } from '../../domain/dfdGeometry';
import { COMPLEXITIES, COMPLEXITY_LABELS } from '../../domain/fpTables';
import type { Complexity, DataFunctionKind, Id, NodeRefType, TransactionKind } from '../../domain/types';
import { useStore } from '../../store';
import { selectFeatureFunctions, selectFeatureResult, type FunctionRow } from '../../store/selectors';
import { tokens } from '../app/theme';
import { KindBadge } from '../common/KindBadge';
import { WarningIcon } from '../common/WarningIcon';
import { AddFunctionDialog, type AddKind, type AddRequest } from '../dfd/AddFunctionDialog';
import { ReferenceDialog } from '../dfd/ReferenceDialog';
import { ConnectDialog } from './ConnectDialog';
import { DfdPreview, usePreviewPrefs } from './DfdPreview';
import type { EntityRef } from '../../store';

function updateRow(row: FunctionRow, patch: Partial<{ name: string; kind: string; complexity: Complexity; description: string }>) {
  const s = useStore.getState();
  switch (row.refType) {
    case 'dataFunction':
      return s.updateDataFunction(row.refId, patch as { kind?: DataFunctionKind });
    case 'transactionFunction':
      return s.updateTransactionFunction(row.refId, patch as { kind?: TransactionKind });
    case 'nonCountedProcess':
      return s.updateNonCountedProcess(row.refId, { name: patch.name, description: patch.description });
    case 'externalEntity':
      return s.updateExternalEntity(row.refId, { name: patch.name, description: patch.description });
  }
}

function deleteRow(featureId: Id, row: FunctionRow) {
  const s = useStore.getState();
  if (row.isReference || row.refType === 'externalEntity') {
    if (row.nodeId) s.unplaceNode(featureId, row.nodeId);
    return;
  }
  s.openConfirm({
    title: `「${row.name}」を削除しますか`,
    message: row.refType === 'dataFunction' ? 'このデータファンクションを参照している DFD からも取り除かれます。' : 'ファンクションが削除され、FP の計上からも外れます。',
    actions: [
      { label: 'キャンセル' },
      {
        label: '削除', color: 'error', variant: 'contained',
        onClick: () => {
          const r = useStore.getState().removeEntity(row.refType, row.refId, featureId);
          if (!r.ok) useStore.getState().notify(r.reason, 'error');
        },
      },
    ],
  });
}

const ADD_KIND: Record<NodeRefType, AddKind> = {
  transactionFunction: 'TF',
  dataFunction: 'DF',
  nonCountedProcess: 'NCP',
  externalEntity: 'EE',
};

/** 複製リクエスト（FR-FN-14）。元のノードのすぐ下を配置の起点にする */
function duplicateRequest(featureId: Id, row: FunctionRow): AddRequest {
  const node = row.nodeId ? useStore.getState().doc.features[featureId].dfd.nodes.find((n) => n.id === row.nodeId) : undefined;
  return {
    kind: ADD_KIND[row.refType],
    position: node ? { x: node.x, y: node.y + nodeSize(node.refType).height + 64 } : undefined,
    duplicateOf: { name: row.name, kind: row.kind, complexity: row.complexity, description: row.description },
  };
}

const kindOptions = (row: FunctionRow) => (row.refType === 'dataFunction' ? ['ILF', 'EIF'] : ['EI', 'EO', 'EQ']);

/** ファンクション表タブ（FR-FN-01〜12、design.md 7.3） */
export function FunctionTable({ featureId }: { featureId: Id }) {
  const doc = useStore((s) => s.doc);
  const selectedNodeIds = useStore((s) => s.selectedNodeIds);
  const rows = selectFeatureFunctions(doc, featureId);
  const result = selectFeatureResult(doc, featureId);
  const [add, setAdd] = useState<AddRequest | null>(null);
  const [ref, setRef] = useState(false);
  const [connectFrom, setConnectFrom] = useState<EntityRef | null>(null);
  const [preview, setPreview] = usePreviewPrefs();
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
  const selectedRow = rows.find((r) => r.nodeIds.some((id) => selectedNodeIds.includes(id)))?.rowId;

  const editable = (row: FunctionRow, field: string) => {
    if (row.isReference) return false;
    if (field === 'kind' || field === 'complexity') return row.refType === 'dataFunction' || row.refType === 'transactionFunction';
    return true;
  };

  const columns: GridColDef<FunctionRow>[] = [
    { field: 'displayNo', headerName: 'No', width: 76, sortable: false },
    {
      field: 'section', headerName: '区分', width: 88, sortable: false,
      renderCell: ({ row }) => (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          {row.isReference ? <KindBadge kind="REF" /> : row.kind ? <KindBadge kind={row.kind} /> : row.refType === 'nonCountedProcess' ? <KindBadge kind="NCP" /> : <KindBadge kind="EE" />}
          {row.refType === 'dataFunction' && !row.isReference && <span>所有</span>}
        </Box>
      ),
    },
    {
      field: 'name', headerName: '名称', flex: 1, minWidth: 110, editable: true, sortable: false,
      renderCell: ({ row }) => (
        <span>
          {row.name}
          {row.isReference && <span style={{ fontSize: 12, marginLeft: 6 }}>所有: {row.ownerName ?? '未設定'}</span>}
        </span>
      ),
    },
    {
      field: 'kind', headerName: '種別', width: 64, editable: true, sortable: false, type: 'singleSelect',
      valueOptions: ({ row }) => (row ? kindOptions(row) : []),
      valueFormatter: (v) => v ?? '—',
    },
    {
      field: 'complexity', headerName: '複雑度', width: 64, editable: true, sortable: false, type: 'singleSelect',
      valueOptions: COMPLEXITIES.map((c) => ({ value: c, label: COMPLEXITY_LABELS[c] })),
      valueFormatter: (v: Complexity | null) => (v ? COMPLEXITY_LABELS[v] : '—'),
    },
    { field: 'fp', headerName: 'FP', width: 52, align: 'right', headerAlign: 'right', sortable: false, valueFormatter: (v: number | null) => (v === null ? '—' : String(v)) },
    {
      field: 'description', headerName: '説明', flex: 1, minWidth: 130, editable: true, sortable: false,
      renderCell: ({ row }: GridRenderCellParams<FunctionRow>) =>
        row.description ? (
          <Tooltip title={<span style={{ whiteSpace: 'pre-wrap' }}>{row.description}</span>}>
            <span style={{ fontSize: 12, color: tokens.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{row.description}</span>
          </Tooltip>
        ) : (
          !row.isReference && <span style={{ fontSize: 12, color: tokens.textDisabled }}>説明を追加</span>
        ),
    },
    {
      field: 'placed', headerName: '配置・接続', width: 84, sortable: false,
      renderCell: ({ row }) =>
        row.hasWarning ? (
          <span style={{ color: tokens.warning, fontWeight: 600, fontSize: 12, display: 'inline-flex', gap: 4, alignItems: 'center' }}><WarningIcon />{row.isReference && !row.ownerName ? '所有未設定' : '未接続'}</span>
        ) : row.placed ? (
          <Tooltip
            title={
              <span style={{ whiteSpace: 'pre-wrap' }}>
                {row.connections.map((c) => `${c.direction === 'out' ? '→' : '←'} ${c.name}${c.label ? `（${c.label}）` : ''}`).join('\n')}
              </span>
            }
          >
            <span style={{ color: tokens.textSecondary }}>接続 {row.connections.length}</span>
          </Tooltip>
        ) : (
          <Link component="button" onClick={(e) => { e.stopPropagation(); const r = useStore.getState().placeNode(featureId, row.refType, row.refId); if (!r.ok) useStore.getState().notify(r.reason, 'error'); }}>
            配置する
          </Link>
        ),
    },
    {
      field: 'actions', headerName: '', width: 100, sortable: false,
      renderCell: ({ row }) => (
        <>
        <IconButton
          size="small"
          title="接続を追加"
          aria-label={`${row.name} の接続を追加`}
          onClick={(e) => { e.stopPropagation(); setConnectFrom({ refType: row.refType, refId: row.refId }); }}
        >
          <AddLinkIcon sx={{ fontSize: 17 }} />
        </IconButton>
        <IconButton
          size="small"
          title={row.isReference ? '参照中の要素は複製できません（所有機能で複製します）' : '複製'}
          aria-label={`${row.name} を複製`}
          disabled={row.isReference}
          onClick={(e) => { e.stopPropagation(); setAdd(duplicateRequest(featureId, row)); }}
        >
          <ContentCopyIcon sx={{ fontSize: 15 }} />
        </IconButton>
        <IconButton
          size="small"
          title={row.isReference || row.refType === 'externalEntity' ? '配置を解除' : '削除'}
          aria-label={row.isReference || row.refType === 'externalEntity' ? `${row.name} の配置を解除` : `${row.name} を削除`}
          onClick={(e) => { e.stopPropagation(); deleteRow(featureId, row); }}
        >
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
        </>
      ),
    },
  ];

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box sx={{ display: 'flex', gap: 2, p: '8px 12px', borderBottom: `1px solid ${tokens.border}`, alignItems: 'center', flexWrap: 'nowrap', overflow: 'hidden' }}>
        <Button variant="outlined" color="inherit" sx={{ borderColor: tokens.borderStrong, flex: 'none' }} onClick={() => setAdd({ kind: 'TF' })}>＋ トランザクション</Button>
        <Button variant="outlined" color="inherit" sx={{ borderColor: tokens.borderStrong, flex: 'none' }} onClick={() => setAdd({ kind: 'DF' })}>＋ データファンクション</Button>
        <Button variant="outlined" color="inherit" sx={{ borderColor: tokens.borderStrong, flex: 'none' }} onClick={() => setAdd({ kind: 'NCP' })}>＋ 非計上プロセス</Button>
        <Button variant="outlined" color="inherit" sx={{ borderColor: tokens.borderStrong, flex: 'none' }} onClick={() => setRef(true)}>既存を参照…</Button>
        <IconButton aria-label="その他の操作（ファンクション表）" title="その他の操作" onClick={(e) => setMoreAnchor(e.currentTarget)} sx={{ flex: 'none' }}>
          <MoreHorizIcon fontSize="small" />
        </IconButton>
        <Menu anchorEl={moreAnchor} open={!!moreAnchor} onClose={() => setMoreAnchor(null)}>
          <MenuItem dense onClick={() => { setMoreAnchor(null); useStore.getState().openCopyDfd(featureId); }}>DFD を別の機能へコピー…</MenuItem>
          <MenuItem dense onClick={() => { setMoreAnchor(null); useStore.getState().openReplaceText({ featureId }); }}>文言を置換…</MenuItem>
        </Menu>
        <Box sx={{ flex: 1 }} />
        <Button
          color="inherit"
          size="small"
          aria-pressed={preview.open}
          sx={{ flex: 'none', color: tokens.textSecondary }}
          onClick={() => setPreview({ open: !preview.open })}
        >
          {preview.open ? 'DFD を隠す' : 'DFD を表示'}
        </Button>
        {result && (
          // 幅が足りないときは末尾から省略する（同じ値は費用サマリーと凡例でも確認できる）
          <Typography
            title={`未調整FP ${result.unadjustedFp} ・ 調整済FP ${result.adjustedFp}`}
            sx={{ color: tokens.textSecondary, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', flex: '0 1 auto' }}
          >
            未調整FP {result.unadjustedFp} ・ 調整済FP {result.adjustedFp}
          </Typography>
        )}
      </Box>
      {preview.open && <DfdPreview featureId={featureId} height={preview.height} onResize={(h) => setPreview({ height: h })} />}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <DataGrid<FunctionRow>
          rows={rows}
          columns={columns}
          getRowId={(r) => r.rowId}
          rowHeight={32}
          columnHeaderHeight={36}
          hideFooter
          disableColumnMenu
          disableRowSelectionOnClick
          isCellEditable={({ row, field }) => editable(row, field)}
          processRowUpdate={(next, prev) => {
            const patch: Record<string, unknown> = {};
            for (const k of ['name', 'kind', 'complexity', 'description'] as const) {
              if (next[k] !== prev[k]) patch[k] = k === 'name' ? String(next[k]).trim() || prev.name : next[k];
            }
            if (Object.keys(patch).length) updateRow(prev, patch);
            // DataGrid は戻り値で行を上書きするため、FP など派生値を含む最新の行をストアから返す
            return selectFeatureFunctions(useStore.getState().doc, featureId).find((r) => r.rowId === prev.rowId) ?? { ...prev, ...patch };
          }}
          onRowClick={({ row }) => {
            // 外部エンティティを入出力に分けている場合は、すべてのノードを選ぶ
            if (row.nodeIds.length) useStore.getState().setSelection(row.nodeIds, null);
          }}
          getRowClassName={({ row }) => [row.isReference ? 'row-ref' : '', row.hasWarning ? 'row-warn' : '', row.rowId === selectedRow ? 'row-selected' : ''].join(' ')}
          localeText={{ noRowsLabel: 'ファンクションがありません。上のボタンから追加します。' }}
          sx={gridSx}
        />
      </Box>
      {add && (
        <AddFunctionDialog
          featureId={featureId}
          request={add}
          onClose={() => setAdd(null)}
          onAdded={(refId) => {
            const n = useStore.getState().doc.features[featureId].dfd.nodes.find((x) => x.refId === refId);
            if (n) useStore.getState().setSelection([n.id], null);
          }}
        />
      )}
      {ref && <ReferenceDialog featureId={featureId} onClose={() => setRef(false)} />}
      {connectFrom && <ConnectDialog featureId={featureId} from={connectFrom} onClose={() => setConnectFrom(null)} />}
    </Box>
  );
}

export const gridSx = {
  border: 0,
  borderRadius: 0,
  fontSize: 13,
  '& .MuiDataGrid-columnHeaders, & .MuiDataGrid-columnHeader': { background: tokens.headerBg },
  '& .MuiDataGrid-columnHeaderTitle': { fontSize: 12, fontWeight: 600, color: tokens.textSecondary },
  '& .MuiDataGrid-cell': { display: 'flex', alignItems: 'center' },
  '& .MuiDataGrid-row:hover': { background: '#F8F9FB' },
  '& .row-ref': { color: tokens.textDisabled },
  '& .row-warn': { background: tokens.warningSoft },
  '& .row-warn:hover': { background: '#FFEDC9' },
  '& .row-selected, & .row-selected:hover': { background: tokens.primarySoft },
  '& .MuiDataGrid-cell--editable:hover': { boxShadow: `inset 0 0 0 1px ${tokens.border}` },
};
