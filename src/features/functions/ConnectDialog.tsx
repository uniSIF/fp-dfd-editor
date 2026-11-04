import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useState, type ReactNode } from 'react';
import { canConnect, ruleKindOf } from '../../domain/dfdRules';
import type { Id } from '../../domain/types';
import { useStore, type EntityRef } from '../../store';
import { selectFeatureFunctions, type FunctionRow } from '../../store/selectors';
import { tokens } from '../app/theme';
import { ellipsis } from '../common/ellipsis';
import { KindBadge } from '../common/KindBadge';

function badgeOf(r: FunctionRow) {
  if (r.isReference) return r.kind ? <KindBadge kind={r.kind} /> : <KindBadge kind="REF" />;
  if (r.kind) return <KindBadge kind={r.kind} />;
  return r.refType === 'nonCountedProcess' ? <KindBadge kind="NCP" /> : <KindBadge kind="EE" />;
}

/**
 * ファンクション表・プロパティパネルから接続（データフロー）を追加する（FR-FN-15）。
 * 相手は同じ機能のファンクション表に並ぶ要素。未配置なら接続時に自動配置する。
 */
export function ConnectDialog({ featureId, from, onClose }: { featureId: Id; from: EntityRef; onClose: () => void }) {
  const doc = useStore((s) => s.doc);
  const rows = selectFeatureFunctions(doc, featureId);
  const self = rows.find((r) => r.refType === from.refType && r.refId === from.refId);
  const [direction, setDirection] = useState<'out' | 'in'>('out');
  const [target, setTarget] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  if (!self) return null;

  const candidates = rows
    .filter((r) => r.rowId !== self.rowId)
    .map((r) => {
      const [a, b] = direction === 'out' ? [self, r] : [r, self];
      const check = canConnect(ruleKindOf(a.refType), ruleKindOf(b.refType));
      const already = self.connections.some((c) => c.direction === direction && c.name === r.name);
      return { row: r, reason: check.ok ? null : check.reason, already };
    });

  const submit = (rowId: string | null = target) => {
    const t = rows.find((r) => r.rowId === rowId);
    if (!t) return;
    const me: EntityRef = { refType: self.refType, refId: self.refId };
    const other: EntityRef = { refType: t.refType, refId: t.refId };
    const s = useStore.getState();
    const r = direction === 'out' ? s.connectEntities(featureId, me, other, label.trim()) : s.connectEntities(featureId, other, me, label.trim());
    if (!r.ok) s.notify(r.reason, 'error');
    else s.notify(direction === 'out' ? `${self.name} → ${t.name} を接続しました` : `${t.name} → ${self.name} を接続しました`, 'success');
    onClose();
  };

  return (
    <Dialog open onClose={onClose} maxWidth={false} slotProps={{ paper: { sx: { width: 480 } } }}>
      <DialogTitle>「{self.name}」の接続を追加</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: '4px !important' }}>
        <Field label="向き">
          <ToggleButtonGroup exclusive fullWidth size="small" value={direction} onChange={(_, v) => { if (v) { setDirection(v); setTarget(null); } }} aria-label="向き">
            <ToggleButton value="out">この要素から出力 →</ToggleButton>
            <ToggleButton value="in">← この要素へ入力</ToggleButton>
          </ToggleButtonGroup>
        </Field>
        <Field label={direction === 'out' ? '出力先' : '入力元'}>
          <Box role="listbox" aria-label={direction === 'out' ? '出力先' : '入力元'} sx={{ border: `1px solid ${tokens.border}`, borderRadius: '3px', maxHeight: 260, overflow: 'auto' }}>
            {candidates.length === 0 && <Typography sx={{ p: 3, fontSize: 12, color: tokens.textSecondary }}>接続できる要素がありません。先にファンクションを追加します。</Typography>}
            {candidates.map(({ row, reason, already }) => (
              <ButtonBase
                key={row.rowId}
                role="option"
                aria-selected={target === row.rowId}
                aria-label={row.name}
                disabled={!!reason}
                title={reason ?? undefined}
                onClick={() => setTarget(row.rowId)}
                onDoubleClick={() => submit(row.rowId)}
                sx={{
                  width: '100%', height: 36, justifyContent: 'flex-start', gap: 2, px: 3, borderBottom: `1px solid ${tokens.border}`, textAlign: 'left',
                  '&:last-child': { borderBottom: 0 }, background: target === row.rowId ? tokens.primarySoft : undefined,
                  '&:hover': { background: target === row.rowId ? tokens.primarySoft : '#F8F9FB' }, '&.Mui-disabled': { color: tokens.textDisabled },
                }}
              >
                {badgeOf(row)}
                <span style={ellipsis({ flex: 1 })} title={row.name}>{row.name}</span>
                <span style={{ flexShrink: 0, fontSize: 12, color: tokens.textSecondary, whiteSpace: 'nowrap' }}>
                  {reason ? '接続不可' : [already && '接続済み', !row.placed && '未配置（自動配置）'].filter(Boolean).join(' ・ ')}
                </span>
              </ButtonBase>
            ))}
          </Box>
          {candidates.some((c) => c.reason) && (
            <Typography sx={{ fontSize: 12, color: tokens.textSecondary, mt: 1 }}>
              外部エンティティ・データストア同士は直接接続できないため、選べません。
            </Typography>
          )}
        </Field>
        <Field label="ラベル（流れるデータの名称、任意）">
          <TextField fullWidth value={label} onChange={(e) => setLabel(e.target.value)} slotProps={{ htmlInput: { 'aria-label': 'ラベル' } }} />
        </Field>
      </DialogContent>
      <DialogActions sx={{ px: 6, pb: 4 }}>
        <Button onClick={onClose}>キャンセル</Button>
        <Button variant="contained" disabled={!target} onClick={() => submit()}>接続を追加</Button>
      </DialogActions>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box>
      <Typography component="div" sx={{ fontSize: 12, color: tokens.textSecondary, mb: '2px' }}>{label}</Typography>
      {children}
    </Box>
  );
}
