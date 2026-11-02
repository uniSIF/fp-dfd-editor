import { createTheme } from '@mui/material/styles';
import { GEOMETRY } from '../../domain/dfdGeometry';

/** ui-design.md 3 章のデザイントークン */
export const tokens = {
  appBg: '#EEF0F3',
  surface: '#FFFFFF',
  canvas: '#F7F8FA',
  border: '#D5D9E0',
  borderStrong: '#AEB5BF',
  text: '#1B1F24',
  textSecondary: '#5B6470',
  textDisabled: '#9AA3AE',
  primary: '#2457A5',
  primaryHover: '#1C4684',
  primarySoft: '#E6EEFA',
  warning: '#B4690E',
  warningSoft: '#FFF3DC',
  error: '#B3261E',
  success: '#2E7D4F',
  hover: '#F3F5F8',
  headerBg: '#F7F8FA',
  fontFamily: `${GEOMETRY.fontFamily}, system-ui`,
  rowHeight: 32,
  controlHeight: 28,
};

export const theme = createTheme({
  spacing: 4,
  shape: { borderRadius: 3 },
  palette: {
    mode: 'light',
    primary: { main: tokens.primary, dark: tokens.primaryHover, light: tokens.primarySoft },
    warning: { main: tokens.warning, light: tokens.warningSoft },
    error: { main: tokens.error },
    success: { main: tokens.success },
    background: { default: tokens.appBg, paper: tokens.surface },
    text: { primary: tokens.text, secondary: tokens.textSecondary, disabled: tokens.textDisabled },
    divider: tokens.border,
  },
  typography: {
    fontFamily: tokens.fontFamily,
    fontSize: 13,
    body1: { fontSize: 13, lineHeight: 1.45 },
    body2: { fontSize: 12, lineHeight: 1.45 },
    caption: { fontSize: 11 },
    button: { textTransform: 'none', fontWeight: 400, fontSize: 13 },
    fontWeightBold: 600,
  },
  components: {
    MuiButton: {
      defaultProps: { size: 'small', disableElevation: true },
      styleOverrides: { root: { minHeight: tokens.controlHeight, paddingTop: 2, paddingBottom: 2 } },
    },
    MuiIconButton: { defaultProps: { size: 'small' } },
    MuiTextField: { defaultProps: { size: 'small', variant: 'outlined' } },
    MuiSelect: { defaultProps: { size: 'small' } },
    MuiInputBase: { styleOverrides: { root: { fontSize: 13 } } },
    MuiTooltip: { defaultProps: { arrow: false, enterDelay: 400 }, styleOverrides: { tooltip: { fontSize: 12, maxWidth: 320 } } },
    MuiDialog: { styleOverrides: { paper: { borderRadius: 6, boxShadow: '0 4px 16px rgba(27,31,36,0.16)' } } },
    MuiDialogTitle: { styleOverrides: { root: { fontSize: 14, fontWeight: 600, padding: '16px 24px 8px' } } },
    MuiTab: { styleOverrides: { root: { minHeight: 36, textTransform: 'none', fontSize: 13, padding: '0 12px', minWidth: 0 } } },
    MuiTabs: { styleOverrides: { root: { minHeight: 36 } } },
    MuiToggleButton: { styleOverrides: { root: { textTransform: 'none', padding: '2px 10px', fontSize: 12 } } },
  },
});
