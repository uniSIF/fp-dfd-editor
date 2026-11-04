import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import NoteAddOutlinedIcon from '@mui/icons-material/NoteAddOutlined';
import RedoIcon from '@mui/icons-material/Redo';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import TuneIcon from '@mui/icons-material/Tune';
import UndoIcon from '@mui/icons-material/Undo';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import { useReactFlow } from '@xyflow/react';
import { useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useStore as useZustand } from 'zustand';
import { useStore } from '../../store';
import { selectIsDirty } from '../../store/selectors';
import { CommitTextField } from '../common/CommitTextField';
import { doRedo, doUndo, exportCsv, exportSvg, newDocument, openFile, openSample, saveDocument } from './commands';
import { tokens } from './theme';
import { DFD_FIT_VIEW } from '../dfd/fitView';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl+';

function ToolButton({ title, onClick, disabled, children }: { title: string; onClick: (e: MouseEvent<HTMLButtonElement>) => void; disabled?: boolean; children: ReactNode }) {
  return (
    <Tooltip title={title}>
      <span>
        <IconButton aria-label={title} onClick={onClick} disabled={disabled} sx={{ width: 32, height: 32, borderRadius: '3px', '&:hover': { background: tokens.primarySoft } }}>
          {children}
        </IconButton>
      </span>
    </Tooltip>
  );
}

const Sep = () => <Box sx={{ width: '1px', height: 24, background: tokens.border, mx: 2 }} />;

export function Toolbar({ onOpenSettings, onOpenBackups, onToggleProperties, showPropertiesToggle }: {
  onOpenSettings: () => void;
  onOpenBackups: () => void;
  onToggleProperties: () => void;
  showPropertiesToggle: boolean;
}) {
  const projectName = useStore((s) => s.doc.project.name);
  const renameProject = useStore((s) => s.renameProject);
  const dirty = useStore(selectIsDirty);
  const activeTab = useStore((s) => s.activeTab);
  const featureId = useStore((s) => s.selectedFeatureId);
  const softwareId = useStore((s) => s.selectedSoftwareId);
  const applyLayout = useStore((s) => s.applyLayout);
  const canUndo = useZustand(useStore.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useZustand(useStore.temporal, (s) => s.futureStates.length > 0);
  const fileRef = useRef<HTMLInputElement>(null);
  const [openAnchor, setOpenAnchor] = useState<HTMLElement | null>(null);
  const rf = useReactFlow();
  const dfdActive = activeTab === 'dfd' && !!featureId;

  return (
    <Box component="header" sx={{ height: 44, background: tokens.surface, borderBottom: `1px solid ${tokens.border}`, display: 'flex', alignItems: 'center', px: 3, gap: 2, flex: 'none' }}>
      <Box component="span" sx={{ fontSize: 12, color: tokens.textSecondary, whiteSpace: 'nowrap' }}>FP DFD Editor</Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mr: 3 }}>
        <CommitTextField
          value={projectName}
          onCommit={renameProject}
          required
          variant="standard"
          slotProps={{ htmlInput: { 'aria-label': 'プロジェクト名', style: { fontWeight: 600, fontSize: 13, width: Math.max(80, projectName.length * 14) } } , input: { disableUnderline: true } }}
          
        />
        {dirty && <Box title="未保存の変更があります" sx={{ width: 6, height: 6, borderRadius: '50%', background: tokens.primary }} />}
      </Box>
      <ToolButton title="新規" onClick={newDocument}><NoteAddOutlinedIcon fontSize="small" /></ToolButton>
      <ToolButton title="開く" onClick={(e) => setOpenAnchor(e.currentTarget)}>
        <FolderOpenOutlinedIcon fontSize="small" />
      </ToolButton>
      <Menu anchorEl={openAnchor} open={!!openAnchor} onClose={() => setOpenAnchor(null)}>
        <MenuItem dense onClick={() => { setOpenAnchor(null); fileRef.current?.click(); }}>ファイルから開く…</MenuItem>
        <MenuItem dense onClick={() => { setOpenAnchor(null); onOpenBackups(); }}>バックアップから開く…</MenuItem>
        <MenuItem dense onClick={() => { setOpenAnchor(null); openSample(); }}>サンプルを開く</MenuItem>
      </Menu>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        data-testid="open-file-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) openFile(f);
          e.target.value = '';
        }}
      />
      <ToolButton title={`保存 ${MOD}S`} onClick={saveDocument}><SaveOutlinedIcon fontSize="small" /></ToolButton>
      <Sep />
      <ToolButton title={`元に戻す ${MOD}Z`} onClick={doUndo} disabled={!canUndo}><UndoIcon fontSize="small" /></ToolButton>
      <ToolButton title={`やり直す ${isMac ? '⇧⌘Z' : 'Ctrl+Y'}`} onClick={doRedo} disabled={!canRedo}><RedoIcon fontSize="small" /></ToolButton>
      <Sep />
      <ToolButton
        title="自動整列"
        disabled={!dfdActive}
        onClick={() => {
          if (!featureId) return;
          applyLayout(featureId);
          requestAnimationFrame(() => void rf.fitView({ ...DFD_FIT_VIEW, duration: 200 }));
        }}
      >
        <AccountTreeOutlinedIcon fontSize="small" />
      </ToolButton>
      <Sep />
      <Button variant="outlined" color="inherit" startIcon={<FileDownloadOutlinedIcon />} onClick={() => exportCsv(softwareId)} disabled={!softwareId} sx={{ borderColor: tokens.borderStrong }}>
        CSV出力
      </Button>
      <Button variant="outlined" color="inherit" startIcon={<FileDownloadOutlinedIcon />} onClick={() => exportSvg(featureId)} disabled={!featureId} sx={{ borderColor: tokens.borderStrong, ml: 1 }}>
        SVG出力
      </Button>
      <AgentMenu softwareId={softwareId} featureId={featureId} />
      <Sep />
      <ToolButton title="設定" onClick={onOpenSettings} disabled={!softwareId}><SettingsOutlinedIcon fontSize="small" /></ToolButton>
      <Box sx={{ flex: 1 }} />
      {showPropertiesToggle && (
        <Button color="inherit" startIcon={<TuneIcon />} onClick={onToggleProperties}>プロパティ</Button>
      )}
    </Box>
  );
}

/** AI エージェント（Copilot）との連携（FR-IO）。選択中の機能の DFD を書き出す・取り込む */
function AgentMenu({ softwareId, featureId }: { softwareId: string | null; featureId: string | null }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = (mode: 'export' | 'import') => {
    setAnchor(null);
    if (softwareId) useStore.getState().openAgentExchange({ mode, softwareId, featureId });
  };
  return (
    <>
      <Button
        variant="outlined" color="inherit" startIcon={<AutoAwesomeOutlinedIcon />} disabled={!softwareId}
        onClick={(e) => setAnchor(e.currentTarget)} sx={{ borderColor: tokens.borderStrong, ml: 1 }}
        aria-haspopup="menu"
      >
        Copilot 連携
      </Button>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        <MenuItem dense onClick={() => open('export')}>Copilot 用に書き出す…</MenuItem>
        <MenuItem dense onClick={() => open('import')}>Copilot の出力を取り込む…</MenuItem>
      </Menu>
    </>
  );
}
