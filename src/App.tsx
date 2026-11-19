import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { ReactFlowProvider } from '@xyflow/react';
import { AppShell } from './features/app/AppShell';
import { RootErrorBoundary } from './features/app/ErrorBoundary';
import { theme } from './features/app/theme';

export function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <RootErrorBoundary>
        <ReactFlowProvider>
          <AppShell />
        </ReactFlowProvider>
      </RootErrorBoundary>
    </ThemeProvider>
  );
}
