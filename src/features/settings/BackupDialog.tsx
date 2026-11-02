import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';
import { listBackups, readBackup } from '../../infra/backup';
import { useStore } from '../../store';
import { selectIsDirty } from '../../store/selectors';
import { tokens } from '../app/theme';
import { formatDateTime, formatTime } from '../common/format';
import { WarningIcon } from '../common/WarningIcon';
import { applyLoaded } from '../app/commands';

/** バックアップ一覧（FR-SV-05） */
export function BackupDialog({ onClose, onOpenFile }: { onClose: () => void; onOpenFile: () => void }) {
  const backups = useMemo(() => listBackups(), []);
  const [selected, setSelected] = useState<string | null>(backups[0]?.iso ?? null);
  const dirty = useStore(selectIsDirty);
  const lastSavedAt = useStore((s) => s.lastSavedAt);
  const interval = useStore((s) => s.doc.backupSettings);

  const load = () => {
    if (!selected) return;
    const r = readBackup(selected);
    const s = useStore.getState();
    if (!r.ok) {
      s.notify(r.error.message, 'error');
      return;
    }
    applyLoaded(r.value, 'バックアップを読み込みました');
    onClose();
  };

  return (
    <Dialog open onClose={onClose} maxWidth={false} slotProps={{ paper: { sx: { width: 480 } } }}>
      <DialogTitle>バックアップから読み込む</DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: 12, color: tokens.textSecondary, mb: 2 }}>
          {interval.intervalSec} 秒ごとに自動保存されたバックアップです。最大 {interval.generations} 世代を保持します。
        </Typography>
        {backups.length === 0 ? (
          <Box sx={{ border: `1px solid ${tokens.border}`, borderRadius: '3px', p: 4, textAlign: 'center' }}>
            <Typography sx={{ fontWeight: 600 }}>バックアップはまだありません</Typography>
            <Typography sx={{ fontSize: 12, color: tokens.textSecondary }}>編集を始めると自動で保存されます。</Typography>
          </Box>
        ) : (
          <Box role="listbox" aria-label="バックアップ" sx={{ border: `1px solid ${tokens.border}`, borderRadius: '3px', maxHeight: 260, overflow: 'auto' }}>
            {backups.map((b, i) => (
              <ButtonBase
                key={b.iso}
                role="option"
                aria-selected={selected === b.iso}
                onClick={() => setSelected(b.iso)}
                onDoubleClick={load}
                sx={{
                  width: '100%', height: 36, justifyContent: 'flex-start', gap: 2, px: 3, borderBottom: `1px solid ${tokens.border}`,
                  '&:last-child': { borderBottom: 0 }, background: selected === b.iso ? tokens.primarySoft : undefined, fontVariantNumeric: 'tabular-nums',
                }}
              >
                <span>{formatDateTime(b.iso)}</span>
                {i === 0 && <span style={{ fontSize: 12, color: tokens.textSecondary }}>最新</span>}
                <span style={{ marginLeft: 'auto', fontSize: 12, color: tokens.textSecondary }}>{Math.max(1, Math.round(b.size / 1024))} KB</span>
              </ButtonBase>
            ))}
          </Box>
        )}
        {dirty && backups.length > 0 && (
          <Box sx={{ background: tokens.warningSoft, borderLeft: `3px solid ${tokens.warning}`, p: '8px 12px', fontSize: 12, display: 'flex', gap: 2, mt: 3 }}>
            <Box sx={{ mt: '2px' }}><WarningIcon size={12} /></Box>
            <span>保存していない変更があります（最終保存 {lastSavedAt ? formatTime(lastSavedAt) : 'なし'}）。読み込むと現在の内容は失われます。</span>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 6, pb: 4 }}>
        <Button sx={{ mr: 'auto' }} onClick={() => { onClose(); onOpenFile(); }}>ファイルから開く…</Button>
        <Button onClick={onClose}>キャンセル</Button>
        <Button variant="contained" color={dirty ? 'error' : 'primary'} disabled={!selected} onClick={load}>読み込む</Button>
      </DialogActions>
    </Dialog>
  );
}
