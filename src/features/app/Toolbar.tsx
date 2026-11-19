import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
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
import ButtonGroup from '@mui/material/ButtonGroup';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import { useReactFlow } from '@xyflow/react';
import { useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useStore as useZustand } from 'zustand';
import { featuresInOrder } from '../../domain/queries';
import { useStore } from '../../store';
import { selectIsDirty } from '../../store/selectors';
import { CommitTextField } from '../common/CommitTextField';
import { doRedo, doUndo, exportAllSvgs, exportCsv, exportSvg, newDocument, openFile, openSample, saveDocument } from './commands';
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
  // React Flow が新しい位置を取り込んでから全体表示する（1 フレームでは整列前の位置で合わせてしまう）
  const fitAfterLayout = () => requestAnimationFrame(() => requestAnimationFrame(() => void rf.fitView({ ...DFD_FIT_VIEW, duration: 200 })));

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
          fitAfterLayout();
        }}
      >
        <AccountTreeOutlinedIcon fontSize="small" />
      </ToolButton>
      <LayoutMenu softwareId={softwareId} onDone={fitAfterLayout} />
      <Sep />
      <Button variant="outlined" color="inherit" startIcon={<FileDownloadOutlinedIcon />} onClick={() => exportCsv(softwareId)} disabled={!softwareId} sx={{ borderColor: tokens.borderStrong }}>
        CSV出力
      </Button>
      <SvgMenu softwareId={softwareId} featureId={featureId} />
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

/**
 * 自動整列の ▼ のメニュー。ソフトウェアのすべての DFD を一括で整列する（FR-DF-26）。
 * 手で整えた配置を置き換えるので、件数を示して確認する。1 回の Undo で戻せる。
 */
function LayoutMenu({ softwareId, onDone }: { softwareId: string | null; onDone: () => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const layoutAll = () => {
    setAnchor(null);
    if (!softwareId) return;
    const s = useStore.getState();
    const count = featuresInOrder(s.doc, softwareId).filter((f) => f.dfd.nodes.length > 0).length;
    if (!count) {
      s.notify('整列する DFD がありません。', 'info');
      return;
    }
    s.openConfirm({
      title: `すべての DFD（${count} 件）を自動整列しますか`,
      message: `「${s.doc.softwares[softwareId]?.name ?? ''}」の、要素のあるすべての機能の DFD を整列します。手で整えた配置は置き換わります。1 回の「元に戻す」で、すべて元の配置に戻せます。`,
      actions: [
        { label: 'キャンセル' },
        {
          label: '整列', variant: 'contained',
          onClick: () => {
            const n = useStore.getState().applyLayoutAll(softwareId);
            useStore.getState().notify(`${n} 件の DFD を自動整列しました。`, 'success');
            onDone();
          },
        },
      ],
    });
  };
  return (
    <>
      <Tooltip title="一括整列のメニュー">
        <span>
          <IconButton aria-label="一括整列のメニュー" aria-haspopup="menu" disabled={!softwareId} onClick={(e) => setAnchor(e.currentTarget)} sx={{ width: 18, height: 32, ml: -1, borderRadius: '3px', '&:hover': { background: tokens.primarySoft } }}>
            <ArrowDropDownIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        <MenuItem dense onClick={layoutAll}>すべての DFD を一括で整列…</MenuItem>
      </Menu>
    </>
  );
}

/** SVG 出力。ボタンは選択中の機能の DFD、▼ のメニューからすべての DFD を ZIP で出力する（FR-SVG-07） */
function SvgMenu({ softwareId, featureId }: { softwareId: string | null; featureId: string | null }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <ButtonGroup variant="outlined" color="inherit" sx={{ ml: 1, '& .MuiButtonGroup-grouped': { borderColor: tokens.borderStrong } }}>
        <Button startIcon={<FileDownloadOutlinedIcon />} onClick={() => exportSvg(featureId)} disabled={!featureId}>
          SVG出力
        </Button>
        <Button size="small" aria-label="SVG 出力のメニュー" aria-haspopup="menu" disabled={!softwareId} onClick={(e) => setAnchor(e.currentTarget)} sx={{ px: 0.5, minWidth: 0 }}>
          <ArrowDropDownIcon fontSize="small" />
        </Button>
      </ButtonGroup>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        <MenuItem dense disabled={!featureId} onClick={() => { setAnchor(null); exportSvg(featureId); }}>この機能の DFD を出力</MenuItem>
        <MenuItem dense onClick={() => { setAnchor(null); exportAllSvgs(softwareId); }}>すべての DFD を一括出力（ZIP）</MenuItem>
      </Menu>
    </>
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
