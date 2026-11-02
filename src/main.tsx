import '@xyflow/react/dist/style.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { featuresInOrder } from './domain/queries';
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
    s.loadDocument(latest.value);
    s.markBackedUp(s.revision);
    const sw = latest.value.project.softwareIds[0];
    const first = sw ? featuresInOrder(latest.value, sw)[0] : undefined;
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
