import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Drawer from '@mui/material/Drawer';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useEffect, useRef, useState } from 'react';
import { writeBackup } from '../../infra/backup';
import { useStore, type Tab as TabId } from '../../store';
import { selectIsDirty } from '../../store/selectors';
import { AppSnackbar } from '../common/AppSnackbar';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { useGlobalShortcuts } from '../common/useGlobalShortcuts';
import { DfdCanvas } from '../dfd/DfdCanvas';
import { FunctionTable } from '../functions/FunctionTable';
import { PropertyPanel } from '../properties/PropertyPanel';
import { BackupDialog } from '../settings/BackupDialog';
import { SettingsDialog } from '../settings/SettingsDialog';
import { FunctionLedger } from '../summary/FunctionLedger';
import { SummaryTable } from '../summary/SummaryTable';
import { FeatureTree } from '../tree/FeatureTree';
import { Breadcrumb } from './Breadcrumb';
import { openFile } from './commands';
import { StatusBar } from './StatusBar';
import { tokens } from './theme';
import { Toolbar } from './Toolbar';

/** 自動バックアップ（FR-SV-03、FR-SV-09、design.md 8.3） */
function useAutoBackup() {
  const intervalSec = useStore((s) => s.doc.backupSettings.intervalSec);
  const available = useStore((s) => s.backupAvailable);
  useEffect(() => {
    if (!available) return;
    const id = window.setInterval(() => {
      const s = useStore.getState();
      if (s.revision === s.backedUpRevision) return;
      const r = writeBackup(s.doc, s.doc.backupSettings.generations);
      if (r.ok) s.markBackedUp(s.revision);
      else if (r.error === 'quota') s.notify('バックアップに失敗しました。ブラウザの保存領域が不足しています。手動保存してください。', 'error');
      else {
        s.setBackupAvailable(false);
        s.notify('自動バックアップを利用できません。手動保存してください。', 'error');
      }
    }, intervalSec * 1000);
    return () => window.clearInterval(id);
  }, [intervalSec, available]);
}

/** 未保存のままタブを閉じようとしたら確認する（FR-SV-08） */
function useBeforeUnload() {
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!selectIsDirty(useStore.getState())) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);
}

export function AppShell() {
  useGlobalShortcuts();
  useAutoBackup();
  useBeforeUnload();
  const wide = useMediaQuery('(min-width:1280px)');
  const [propsOpen, setPropsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [backupsOpen, setBackupsOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const softwareId = useStore((s) => s.selectedSoftwareId);
  const featureId = useStore((s) => s.selectedFeatureId);
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const doc = useStore((s) => s.doc);
  const featureExists = !!featureId && !!doc.features[featureId];
  const softwareExists = !!softwareId && !!doc.softwares[softwareId];

  const needsFeature = activeTab === 'dfd' || activeTab === 'functions';
  let content;
  if (needsFeature && !featureExists) {
    content = <EmptyFeature />;
  } else if (!needsFeature && !softwareExists) {
    content = <EmptyFeature />;
  } else if (activeTab === 'dfd') {
    content = <DfdCanvas featureId={featureId!} />;
  } else if (activeTab === 'functions') {
    content = <FunctionTable featureId={featureId!} />;
  } else if (activeTab === 'summary') {
    content = <SummaryTable softwareId={softwareId!} />;
  } else {
    content = <FunctionLedger softwareId={softwareId!} />;
  }

  const properties = <PropertyPanel />;

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', minWidth: 1080, background: tokens.appBg }}>
      <Toolbar
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenBackups={() => setBackupsOpen(true)}
        onToggleProperties={() => setPropsOpen((v) => !v)}
        showPropertiesToggle={!wide}
      />
      <Box sx={{ flex: 1, display: 'grid', gridTemplateColumns: wide ? '280px minmax(0, 1fr) 320px' : '280px minmax(0, 1fr)', gap: '1px', minHeight: 0, background: tokens.border }}>
        <Box component="aside" aria-label="機能ツリー" sx={{ background: tokens.surface, minHeight: 0, overflow: 'hidden' }}>
          <FeatureTree />
        </Box>
        <Box component="main" sx={{ background: tokens.surface, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Breadcrumb />
          <Tabs value={activeTab} onChange={(_, v: TabId) => setActiveTab(v)} sx={{ borderBottom: `1px solid ${tokens.border}`, px: 2, flex: 'none' }}>
            <Tab value="dfd" label="DFD" />
            <Tab value="functions" label="ファンクション表" />
            <Tab value="summary" label="一覧" />
            <Tab value="ledger" label="台帳" />
          </Tabs>
          {content}
        </Box>
        {wide && (
          <Box component="aside" aria-label="プロパティ" sx={{ background: tokens.surface, minHeight: 0, overflow: 'hidden' }}>
            {properties}
          </Box>
        )}
      </Box>
      {!wide && (
        <Drawer anchor="right" open={propsOpen} onClose={() => setPropsOpen(false)} slotProps={{ paper: { sx: { width: 320 } } }}>
          {properties}
        </Drawer>
      )}
      <StatusBar onOpenSettings={() => setSettingsOpen(true)} />
      <ConfirmDialog />
      <AppSnackbar />
      {settingsOpen && softwareExists && <SettingsDialog softwareId={softwareId!} onClose={() => setSettingsOpen(false)} />}
      {backupsOpen && <BackupDialog onClose={() => setBackupsOpen(false)} onOpenFile={() => fileRef.current?.click()} />}
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) openFile(f);
          e.target.value = '';
        }}
      />
    </Box>
  );
}

function EmptyFeature() {
  const doc = useStore((s) => s.doc);
  const hasSoftware = doc.project.softwareIds.length > 0;
  const firstCategory2 = Object.keys(doc.category2s)[0];
  return (
    <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Box sx={{ textAlign: 'center', maxWidth: 360 }}>
        <Box sx={{ width: 64, height: 64, mx: 'auto', mb: 3, border: `1.5px dashed ${tokens.borderStrong}`, borderRadius: '50%' }} />
        {hasSoftware ? (
          <>
            <Typography sx={{ fontSize: 16, fontWeight: 600, mb: 1 }}>機能を選んでください</Typography>
            <Typography sx={{ color: tokens.textSecondary, mb: 4 }}>左のツリーから機能を選ぶか、新しい機能を追加します。</Typography>
            <Button variant="contained" disabled={!firstCategory2} onClick={() => firstCategory2 && useStore.getState().addFeature(firstCategory2, '新しい機能')}>
              機能を追加
            </Button>
            {!firstCategory2 && (
              <Typography sx={{ color: tokens.textSecondary, fontSize: 12, mt: 2 }}>先にツリーで大分類と中分類を追加します（行にマウスを重ねて＋）。</Typography>
            )}
          </>
        ) : (
          <>
            <Typography sx={{ fontSize: 16, fontWeight: 600, mb: 1 }}>ソフトウェアがありません</Typography>
            <Typography sx={{ color: tokens.textSecondary }}>見積もり対象のソフトウェアを左のツリーで追加して始めます。</Typography>
          </>
        )}
      </Box>
    </Box>
  );
}
