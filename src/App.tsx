import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { ReactFlowProvider } from '@xyflow/react';
import { AppShell } from './features/app/AppShell';
import { theme } from './features/app/theme';

export function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ReactFlowProvider>
        <AppShell />
      </ReactFlowProvider>
    </ThemeProvider>
  );
}
