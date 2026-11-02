import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Popover from '@mui/material/Popover';
import { useState } from 'react';
import { useStore } from '../../store';
import { selectAllWarnings, selectIsDirty } from '../../store/selectors';
import { formatTime } from '../common/format';
import { WarningIcon } from '../common/WarningIcon';
import { tokens } from './theme';

/** ステータスバー（ui-design.md 4.9） */
export function StatusBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const lastSavedAt = useStore((s) => s.lastSavedAt);
  const lastBackupAt = useStore((s) => s.lastBackupAt);
  const dirty = useStore(selectIsDirty);
  const backupAvailable = useStore((s) => s.backupAvailable);
  const doc = useStore((s) => s.doc);
  const selectFeature = useStore((s) => s.selectFeature);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const setSelection = useStore((s) => s.setSelection);
  const warnings = selectAllWarnings(doc, null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  return (
    <Box component="footer" sx={{ height: 24, background: tokens.headerBg, borderTop: `1px solid ${tokens.border}`, display: 'flex', alignItems: 'center', px: 3, gap: 4, fontSize: 11, color: tokens.textSecondary, flex: 'none' }}>
      <span>最終保存 {lastSavedAt ? formatTime(lastSavedAt) : '未保存'}</span>
      <span>バックアップ {formatTime(lastBackupAt)}</span>
      {!backupAvailable && <span style={{ color: tokens.warning, fontWeight: 600 }}>自動バックアップ無効</span>}
      <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
        {dirty && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: tokens.text }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: tokens.primary }} />
            未保存の変更
          </span>
        )}
        <ButtonBase
          onClick={(e) => setAnchor(e.currentTarget)}
          disabled={!warnings.length}
          sx={{ fontSize: 11, color: warnings.length ? tokens.warning : tokens.textSecondary, fontWeight: 600, gap: '4px', px: 1 }}
        >
          {warnings.length > 0 && <WarningIcon />}警告 {warnings.length}
        </ButtonBase>
      </Box>
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'top', horizontal: 'right' }} transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 1, maxHeight: 320, overflow: 'auto', width: 420 }}>
          {warnings.map((w, i) => (
            <li key={i}>
              <ButtonBase
                sx={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left', gap: 2, p: '6px 8px', fontSize: 12, '&:hover': { background: tokens.hover } }}
                onClick={() => {
                  setAnchor(null);
                  if (w.kind === 'hoursPerFpUnset') return onOpenSettings();
                  if (w.featureId) {
                    selectFeature(w.featureId);
                    if (w.kind === 'unconnectedNode' && w.entityId) {
                      setActiveTab('dfd');
                      setSelection([w.entityId], null);
                    }
                  } else {
                    setActiveTab('ledger');
                  }
                }}
              >
                <WarningIcon />
                {w.message}
              </ButtonBase>
            </li>
          ))}
        </Box>
      </Popover>
    </Box>
  );
}
