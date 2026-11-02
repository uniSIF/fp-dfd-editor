import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState, type ReactNode } from 'react';
import type { BackupSettings, Id, SoftwareSettings } from '../../domain/types';
import { useStore } from '../../store';
import { tokens } from '../app/theme';
import { CharacteristicsEditor } from '../functions/CharacteristicsEditor';

interface VendorDraft {
  key: string;
  id?: Id;
  name: string;
  rate: string;
}

type Errors = Record<string, string>;

function num(s: string): number | null {
  const t = s.trim().replace(/,/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

/** 設定ダイアログ（FR-PJ-04、FR-PJ-05、FR-SV-03） */
export function SettingsDialog({ softwareId, onClose }: { softwareId: Id; onClose: () => void }) {
  const doc = useStore((s) => s.doc);
  const sw = doc.softwares[softwareId];
  const [tab, setTab] = useState<'common' | 'vendors' | 'backup'>('common');
  const st = sw.settings;
  const [f, setF] = useState({
    newFactor: String(st.newDev.modificationFactor),
    newHours: st.newDev.hoursPerFp === null ? '' : String(st.newDev.hoursPerFp),
    modFactor: String(st.modDev.modificationFactor),
    modHours: st.modDev.hoursPerFp === null ? '' : String(st.modDev.hoursPerFp),
    ratio: String(Math.round(st.inHouseRatio * 1000) / 10),
    rate: String(st.inHouseRate),
    interval: String(doc.backupSettings.intervalSec),
    generations: String(doc.backupSettings.generations),
  });
  const [chars, setChars] = useState([...st.defaultCharacteristics]);
  const [vendors, setVendors] = useState<VendorDraft[]>(
    sw.vendorIds.map((id) => ({ key: id, id, name: doc.vendors[id].name, rate: String(doc.vendors[id].rate) })),
  );
  const [errors, setErrors] = useState<Errors>({});
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const save = () => {
    const e: Errors = {};
    const need = (k: keyof typeof f, min: number, max = Infinity, allowEmpty = false) => {
      const n = num(f[k]);
      if (n === null) {
        if (!allowEmpty) e[k] = '入力してください';
        return null;
      }
      if (Number.isNaN(n) || n < min || n > max) {
        e[k] = `${min}〜${max === Infinity ? '' : max} の数値を入力してください`;
        return null;
      }
      return n;
    };
    const newFactor = need('newFactor', 0);
    const newHours = need('newHours', 0, Infinity, true);
    const modFactor = need('modFactor', 0);
    const modHours = need('modHours', 0, Infinity, true);
    const ratio = need('ratio', 0, 100);
    const rate = need('rate', 0);
    const interval = need('interval', 10, 3600);
    const generations = need('generations', 1, 50);
    const vs = vendors.map((v) => {
      const r = num(v.rate);
      if (!v.name.trim()) e[`vn-${v.key}`] = '業者名を入力してください';
      if (r === null || Number.isNaN(r) || r < 0) e[`vr-${v.key}`] = '0 以上の数値';
      return { id: v.id, name: v.name.trim(), rate: r ?? 0 };
    });
    setErrors(e);
    if (Object.keys(e).length) {
      // 最初にエラーがあるタブを開く
      const keys = Object.keys(e);
      const backupKeys = ['interval', 'generations'];
      const isVendor = (k: string) => k.startsWith('vn-') || k.startsWith('vr-');
      if (keys.some((k) => !isVendor(k) && !backupKeys.includes(k))) setTab('common');
      else if (keys.some(isVendor)) setTab('vendors');
      else setTab('backup');
      return;
    }
    const settings: SoftwareSettings = {
      defaultCharacteristics: chars,
      newDev: { modificationFactor: newFactor!, hoursPerFp: newHours },
      modDev: { modificationFactor: modFactor!, hoursPerFp: modHours },
      inHouseRatio: ratio! / 100,
      inHouseRate: rate!,
    };
    const backupSettings: BackupSettings = { intervalSec: interval!, generations: generations! };
    useStore.getState().applySoftwareSettings(softwareId, { settings, vendors: vs, backupSettings });
    onClose();
  };

  const field = (k: keyof typeof f, label: string, unit?: string, placeholder?: string) => (
    <Box>
      <Typography component="label" htmlFor={`set-${k}`} sx={{ fontSize: 12, color: tokens.textSecondary, display: 'block', mb: '2px' }}>{label}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <TextField
          id={`set-${k}`} value={f[k]} onChange={set(k)} error={!!errors[k]} helperText={errors[k]} placeholder={placeholder}
          sx={{ width: 140 }} slotProps={{ htmlInput: { inputMode: 'decimal', style: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } } }}
        />
        {unit && <span style={{ fontSize: 12, color: tokens.textSecondary, whiteSpace: 'nowrap' }}>{unit}</span>}
      </Box>
    </Box>
  );

  return (
    <Dialog open onClose={onClose} maxWidth={false} slotProps={{ paper: { sx: { width: 640 } } }}>
      <DialogTitle>設定: {sw.name}</DialogTitle>
      <DialogContent sx={{ minHeight: 420 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: `1px solid ${tokens.border}`, mb: 3 }}>
          <Tab value="common" label="共通設定" />
          <Tab value="vendors" label="外注業者" />
          <Tab value="backup" label="バックアップ" />
        </Tabs>
        {tab === 'common' && (
          <>
            <Heading>工数の係数</Heading>
            <Grid2>
              {field('newFactor', '新規: 改修係数')}
              {field('newHours', '新規: FP単位工数', 'H/FP', '未設定')}
              {field('modFactor', '改修: 改修係数')}
              {field('modHours', '改修: FP単位工数', 'H/FP', '未設定')}
            </Grid2>
            <Heading>配分と単価</Heading>
            <Grid2>
              {field('ratio', '社内への配分比率', '%')}
              {field('rate', '社内の工数単価', '円/H')}
            </Grid2>
            <Heading>
              システム特性の既定値 <span style={{ fontWeight: 400 }}>（新しい機能に適用されます）</span>
            </Heading>
            <CharacteristicsEditor value={chars} onChange={setChars} />
          </>
        )}
        {tab === 'vendors' && (
          <>
            <Typography sx={{ fontSize: 12, color: tokens.textSecondary, mb: 2 }}>
              機能ごとに 1 社を選び、外注工数をその業者に配分します。削除した業者を選んでいた機能は「未選択」になります。
            </Typography>
            {vendors.map((v, i) => {
              const used = v.id ? Object.values(doc.features).filter((x) => x.vendorId === v.id).length : 0;
              return (
                <Box key={v.key} sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', mb: 2 }}>
                  <TextField
                    placeholder="業者名" value={v.name} error={!!errors[`vn-${v.key}`]} helperText={errors[`vn-${v.key}`]}
                    onChange={(e) => setVendors(vendors.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    sx={{ flex: 1 }} slotProps={{ htmlInput: { 'aria-label': `業者名 ${i + 1}` } }}
                  />
                  <TextField
                    value={v.rate} error={!!errors[`vr-${v.key}`]} helperText={errors[`vr-${v.key}`]}
                    onChange={(e) => setVendors(vendors.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))}
                    sx={{ width: 140 }} slotProps={{ htmlInput: { 'aria-label': `工数単価 ${i + 1}`, inputMode: 'decimal', style: { textAlign: 'right' } } }}
                  />
                  <span style={{ fontSize: 12, color: tokens.textSecondary, marginTop: 6 }}>円/H</span>
                  <IconButton
                    aria-label={`${v.name || '業者'} を削除`}
                    title={used ? `${used} 件の機能で使用中。削除するとそれらは未選択になります` : '削除'}
                    onClick={() => setVendors(vendors.filter((_, j) => j !== i))}
                  >
                    <CloseIcon sx={{ fontSize: 16, color: used ? tokens.warning : undefined }} />
                  </IconButton>
                </Box>
              );
            })}
            <Button startIcon={<AddIcon />} onClick={() => setVendors([...vendors, { key: `new-${Date.now()}`, name: '', rate: '0' }])}>業者を追加</Button>
          </>
        )}
        {tab === 'backup' && (
          <>
            <Typography sx={{ fontSize: 12, color: tokens.textSecondary, mb: 3 }}>
              編集内容をブラウザ内に定期的に自動保存します。起動時には最新のバックアップが読み込まれます。
            </Typography>
            <Grid2>
              {field('interval', '自動バックアップの間隔', '秒')}
              {field('generations', '保持する世代数', '世代')}
            </Grid2>
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 6, pb: 4 }}>
        <Button onClick={onClose}>キャンセル</Button>
        <Button variant="contained" onClick={save}>保存</Button>
      </DialogActions>
    </Dialog>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return <Typography component="h3" sx={{ fontSize: 12, fontWeight: 600, color: tokens.textSecondary, mt: 3, mb: 2 }}>{children}</Typography>;
}

function Grid2({ children }: { children: ReactNode }) {
  return <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>{children}</Box>;
}
