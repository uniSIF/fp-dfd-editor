import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useStore as useZustand } from 'zustand';
import { useStore } from '../../store';
import { doUndo, saveDocument } from './commands';
import { tokens } from './theme';

interface Props {
  /** 何の表示か（メッセージに使う。例: 「DFD」） */
  label: string;
  /** 値が変わったら、もう一度表示を試す（ドキュメントの版・選択中の機能・タブなど） */
  resetKey: unknown;
  canUndo: boolean;
  /** 画面全体を置き換える（最上位用）。ツールバーも出せないので、再読み込みのボタンを足す */
  fullScreen?: boolean;
  children: ReactNode;
}

/**
 * 表示中の例外で画面全体が真っ白になるのを防ぐ（design.md 8.6）。
 * 例外が起きた領域だけをメッセージに置き換え、ツールバー・ツリー・ほかのタブは使えるままにする。
 * データは失われていないので、元に戻す・保存する・別の機能を開く、のどれかで復帰できる。
 */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.label}の表示に失敗しました`, error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <Box role="alert" sx={{ flex: 1, minHeight: 0, height: this.props.fullScreen ? '100vh' : undefined, overflow: 'auto', p: 6, background: tokens.surface }} data-testid="render-error">
        <Typography sx={{ fontSize: 15, fontWeight: 600, mb: 2 }}>{this.props.label}を表示できませんでした</Typography>
        <Typography variant="body2" sx={{ color: tokens.textSecondary, mb: 4, maxWidth: 560 }}>
          データの一部が壊れている可能性があります。編集内容は失われていません。直前の操作が原因なら「元に戻す」で戻せます。
          ファイルに保存してから開き直すと、壊れた参照を取り除いて読み込みます。
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, mb: 4 }}>
          <Button variant="contained" disabled={!this.props.canUndo} onClick={doUndo}>元に戻す</Button>
          <Button variant="outlined" color="inherit" sx={{ borderColor: tokens.borderStrong }} onClick={saveDocument}>ファイルに保存</Button>
          <Button onClick={() => this.setState({ error: null })}>もう一度表示する</Button>
          {this.props.fullScreen && <Button onClick={() => window.location.reload()}>再読み込み（最新のバックアップを開く）</Button>}
        </Box>
        <Typography component="pre" sx={{ fontSize: 11, color: tokens.textSecondary, whiteSpace: 'pre-wrap', m: 0 }}>{String(error.message || error)}</Typography>
      </Box>
    );
  }
}

/** アプリ全体を包む最後の受け皿。ツリーやツールバーなど、領域ごとの受け皿の外で起きた例外でも真っ白にしない */
export function RootErrorBoundary({ children }: { children: ReactNode }) {
  const revision = useStore((s) => s.revision);
  const canUndo = useZustand(useStore.temporal, (s) => s.pastStates.length > 0);
  return <ErrorBoundary label="画面" resetKey={revision} canUndo={canUndo} fullScreen>{children}</ErrorBoundary>;
}
