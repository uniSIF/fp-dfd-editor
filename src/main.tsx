import '@xyflow/react/dist/style.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { featuresInOrder } from './domain/queries';
import { repairSummary } from './features/app/commands';
import { isBackupAvailable, readLatestBackup } from './infra/backup';
import { useStore } from './store';

/** 起動シーケンス（FR-SV-04、design.md 8.4） */
function bootstrap() {
  const s = useStore.getState();
  if (!isBackupAvailable()) {
    s.setBackupAvailable(false);
    return;
  }
  const latest = readLatestBackup();
  if (!latest) return;
  if (latest.ok) {
    const repairs = s.loadDocument(latest.value);
    if (repairs.length) s.notify(repairSummary(repairs), 'info');
    // 読み込んだ内容はバックアップ済み。読み込み後の revision を使う（s は読み込み前の状態なので、
    // s.revision を渡すと未バックアップとみなされ、起動のたびに同じ内容の世代が 1 つ増える）
    // 壊れた参照を取り除いたときは、直した内容を次のバックアップで保存する
    if (!repairs.length) s.markBackedUp(useStore.getState().revision);
    const sw = latest.value.project.softwareIds[0];
    const first = sw ? featuresInOrder(useStore.getState().doc, sw)[0] : undefined;
    if (first) s.selectFeature(first.id);
  } else {
    s.notify(`バックアップを読み込めませんでした: ${latest.error.message} ツールバーの「開く」から別の世代を選べます。`, 'error');
  }
  useStore.temporal.getState().clear();
}

bootstrap();

if (import.meta.env.DEV) {
  // E2E テストとデバッグ用（本番ビルドには含まれない）
  (window as unknown as { __store: typeof useStore }).__store = useStore;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
