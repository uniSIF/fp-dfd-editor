import CloseIcon from '@mui/icons-material/Close';
import IconButton from '@mui/material/IconButton';
import Snackbar from '@mui/material/Snackbar';
import SnackbarContent from '@mui/material/SnackbarContent';
import { useStore } from '../../store';
import { tokens } from '../app/theme';

/** ui-design.md 4.10。エラーは手動で閉じるまで残し、それ以外は 4 秒で消す */
export function AppSnackbar() {
  const snackbar = useStore((s) => s.snackbar);
  const close = useStore((s) => s.closeSnackbar);
  const bar = snackbar?.severity === 'error' ? tokens.error : snackbar?.severity === 'success' ? tokens.success : tokens.primary;
  return (
    <Snackbar
      key={snackbar?.key}
      open={!!snackbar}
      onClose={(_, reason) => reason !== 'clickaway' && close()}
      autoHideDuration={snackbar?.severity === 'error' ? null : 4000}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      sx={{ bottom: { xs: 40 } }}
    >
      <SnackbarContent
        role={snackbar?.severity === 'error' ? 'alert' : 'status'}
        message={snackbar?.message}
        sx={{ background: tokens.text, color: '#fff', fontSize: 13, borderLeft: `3px solid ${bar}`, maxWidth: 560, borderRadius: '3px' }}
        action={
          <IconButton aria-label="閉じる" size="small" sx={{ color: '#fff' }} onClick={close}>
            <CloseIcon fontSize="small" />
          </IconButton>
        }
      />
    </Snackbar>
  );
}
