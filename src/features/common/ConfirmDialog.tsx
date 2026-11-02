import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';
import { useStore } from '../../store';
import { tokens } from '../app/theme';

/** ストア駆動の汎用確認ダイアログ（design.md 11.1） */
export function ConfirmDialog() {
  const confirm = useStore((s) => s.confirm);
  const close = useStore((s) => s.closeConfirm);
  if (!confirm) return null;
  const run = (fn?: () => void) => {
    close();
    fn?.();
  };
  return (
    <Dialog open onClose={close} maxWidth={false} slotProps={{ paper: { sx: { width: 480 } } }}>
      <DialogTitle>{confirm.title}</DialogTitle>
      <DialogContent sx={{ pb: 1 }}>
        {confirm.message && (
          <Typography variant="body1" sx={{ mb: 2, whiteSpace: 'pre-wrap' }}>
            {confirm.message}
          </Typography>
        )}
        {confirm.details && confirm.details.length > 0 && (
          <ul style={{ margin: '0 0 12px', paddingLeft: 18, color: tokens.textSecondary, fontSize: 12 }}>
            {confirm.details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
        {confirm.choices?.map((c) => (
          <ButtonBase
            key={c.label}
            disabled={c.disabled}
            onClick={() => run(c.onClick)}
            sx={{
              display: 'block', width: '100%', textAlign: 'left', border: `1px solid ${tokens.border}`, borderRadius: '3px',
              p: '8px 12px', mb: 2, '&:hover': { borderColor: tokens.primary, background: tokens.primarySoft },
              '&.Mui-disabled': { background: tokens.headerBg, color: tokens.textDisabled },
              '&.Mui-focusVisible': { boxShadow: `0 0 0 2px #fff, 0 0 0 4px ${tokens.primary}` },
            }}
          >
            <Typography sx={{ fontWeight: 600, color: c.disabled ? tokens.textDisabled : c.color === 'error' ? tokens.error : 'inherit' }}>
              {c.label}
            </Typography>
            {c.description && (
              <Typography variant="body2" sx={{ color: c.disabled ? tokens.textDisabled : tokens.textSecondary }}>
                {c.description}
              </Typography>
            )}
          </ButtonBase>
        ))}
      </DialogContent>
      <DialogActions sx={{ px: 6, pb: 4 }}>
        {confirm.actions.map((a) => (
          <Button
            key={a.label}
            color={a.color ?? 'primary'}
            variant={a.variant ?? 'text'}
            disabled={a.disabled}
            onClick={() => run(a.onClick)}
          >
            {a.label}
          </Button>
        ))}
      </DialogActions>
    </Dialog>
  );
}
