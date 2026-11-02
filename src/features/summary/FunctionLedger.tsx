import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import SearchIcon from '@mui/icons-material/Search';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import InputBase from '@mui/material/InputBase';
import Link from '@mui/material/Link';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import { useState } from 'react';
import { COMPLEXITY_LABELS } from '../../domain/fpTables';
import { featurePathLabel, featuresInOrder } from '../../domain/queries';
import type { Id } from '../../domain/types';
import { useStore } from '../../store';
import { selectLedger, type LedgerRow } from '../../store/selectors';
import { exportLedgerCsv } from '../app/commands';
import { tokens } from '../app/theme';
import { KindBadge } from '../common/KindBadge';
import { WarningChip, WarningIcon } from '../common/WarningIcon';
import { gridSx } from '../functions/FunctionTable';

const UNSET = '__unset__';

/** ファンクション台帳（FR-ID-05、FR-ID-06） */
export function FunctionLedger({ softwareId }: { softwareId: Id }) {
  const doc = useStore((s) => s.doc);
  const [type, setType] = useState<'data' | 'transaction'>('data');
  const [q, setQ] = useState('');
  const all = selectLedger(doc, softwareId);
  const rows = all.filter((r) => r.type === type && r.name.includes(q.trim()));
  const counts = { data: all.filter((r) => r.type === 'data').length, transaction: all.filter((r) => r.type === 'transaction').length };
  const ownerUnset = all.filter((r) => r.type === 'data' && r.ownerFeatureId === null).length;
  const featureOptions = [
    { value: UNSET, label: '未設定' },
    ...featuresInOrder(doc, softwareId).map((f) => ({ value: f.id, label: featurePathLabel(doc, f.id) })),
  ];
  const goto = (featureId: Id) => {
    const s = useStore.getState();
    s.selectFeature(featureId);
    s.setActiveTab('dfd');
  };

  const columns: GridColDef<LedgerRow>[] = [
    { field: 'displayNo', headerName: 'No', width: 80 },
    { field: 'name', headerName: '名称', width: 150 },
    { field: 'kind', headerName: '種別', width: 64, renderCell: ({ row }) => <KindBadge kind={row.kind} /> },
    { field: 'complexity', headerName: '複雑度', width: 64, valueFormatter: (v: LedgerRow['complexity']) => COMPLEXITY_LABELS[v] },
    { field: 'fp', headerName: 'FP', width: 52, align: 'right', headerAlign: 'right' },
    {
      field: 'ownerFeatureId', headerName: type === 'data' ? '所有機能' : '所属機能', width: 220,
      editable: type === 'data', type: 'singleSelect', valueOptions: featureOptions,
      valueGetter: (v: Id | null) => v ?? UNSET,
      renderCell: ({ row }) =>
        row.ownerFeatureId === null ? (
          <span style={{ color: tokens.warning, fontWeight: 600, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}><WarningIcon />未設定</span>
        ) : (
          <span>{row.ownerLabel}</span>
        ),
    },
    {
      field: 'referencingFeatures', headerName: '参照している機能', width: 140, sortable: false,
      renderCell: ({ row }) =>
        row.referencingFeatures.length ? (
          <span style={{ display: 'flex', gap: 6, overflow: 'hidden' }}>
            {row.referencingFeatures.map((f) => <Link key={f.id} component="button" onClick={() => goto(f.id)}>{f.name}</Link>)}
          </span>
        ) : (
          <span style={{ color: tokens.textSecondary }}>—</span>
        ),
    },
    {
      field: 'description', headerName: '説明', flex: 1, minWidth: 200, editable: true,
      renderCell: ({ row }) =>
        row.description ? (
          <Tooltip title={<span style={{ whiteSpace: 'pre-wrap' }}>{row.description}</span>}>
            <span style={{ fontSize: 12, color: tokens.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{row.description}</span>
          </Tooltip>
        ) : (
          <span style={{ fontSize: 12, color: tokens.textDisabled }}>説明を追加</span>
        ),
    },
    {
      field: 'warning', headerName: '', width: 40, sortable: false,
      renderCell: ({ row }) => row.warning && <Tooltip title={row.warning}><span style={{ display: 'inline-flex' }}><WarningIcon /></span></Tooltip>,
    },
  ];

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box sx={{ display: 'flex', gap: 2, p: '8px 12px', borderBottom: `1px solid ${tokens.border}`, alignItems: 'center' }}>
        <ToggleButtonGroup exclusive size="small" value={type} onChange={(_, v) => v && setType(v)} aria-label="台帳の種類">
          <ToggleButton value="data" sx={{ whiteSpace: 'nowrap' }}>データファンクション {counts.data}</ToggleButton>
          <ToggleButton value="transaction" sx={{ whiteSpace: 'nowrap' }}>トランザクション {counts.transaction}</ToggleButton>
        </ToggleButtonGroup>
        <Box sx={{ width: 180, height: 28, border: `1px solid ${tokens.border}`, borderRadius: '3px', px: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <SearchIcon sx={{ fontSize: 14, color: tokens.textDisabled }} />
          <InputBase placeholder="名称で絞り込み" value={q} onChange={(e) => setQ(e.target.value)} sx={{ fontSize: 13, flex: 1 }} inputProps={{ 'aria-label': '名称で絞り込み' }} />
        </Box>
        <Box sx={{ flex: 1 }} />
        {ownerUnset > 0 && <WarningChip count={ownerUnset} title={`所有機能未設定 ${ownerUnset} 件`} />}
        <Button variant="outlined" color="inherit" startIcon={<FileDownloadOutlinedIcon />} sx={{ borderColor: tokens.borderStrong, flex: 'none' }} onClick={() => exportLedgerCsv(softwareId)}>CSV出力</Button>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <DataGrid<LedgerRow>
          rows={rows}
          columns={columns}
          rowHeight={32}
          columnHeaderHeight={36}
          hideFooter
          disableColumnMenu
          disableRowSelectionOnClick
          getRowClassName={({ row }) => (row.warning ? 'row-warn' : '')}
          processRowUpdate={(next, prev) => {
            const s = useStore.getState();
            const owner = (next.ownerFeatureId as string) === UNSET ? null : next.ownerFeatureId;
            if (prev.type === 'data') {
              const patch: { ownerFeatureId?: Id | null; description?: string } = {};
              if (owner !== prev.ownerFeatureId) patch.ownerFeatureId = owner;
              if (next.description !== prev.description) patch.description = next.description;
              if (Object.keys(patch).length) s.updateDataFunction(prev.id, patch);
            } else if (next.description !== prev.description) {
              s.updateTransactionFunction(prev.id, { description: next.description });
            }
            // 所有機能ラベルや警告など派生値を含む最新の行をストアから返す
            return selectLedger(useStore.getState().doc, softwareId).find((r) => r.id === prev.id) ?? next;
          }}
          localeText={{ noRowsLabel: 'ファンクションがありません。' }}
          sx={gridSx}
        />
      </Box>
    </Box>
  );
}
