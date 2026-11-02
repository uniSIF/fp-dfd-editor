import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useRef, useState } from 'react';
import { COMPLEXITIES, COMPLEXITY_LABELS, FUNCTION_KIND_LABELS } from '../../domain/fpTables';
import { featurePathLabel, softwareIdOfFeature } from '../../domain/queries';
import type { Complexity, DataFunctionKind, Id, TransactionKind } from '../../domain/types';
import { findDuplicateName } from '../../domain/validation';
import { useStore } from '../../store';
import { tokens } from '../app/theme';
import { WarningIcon } from '../common/WarningIcon';

export type AddKind = 'TF' | 'NCP' | 'DF' | 'EE';

const TITLES: Record<AddKind, string> = {
  TF: 'トランザクションファンクションを追加',
  NCP: '非計上プロセスを追加',
  DF: 'データファンクションを追加',
  EE: '外部エンティティを追加',
};

export interface AddRequest {
  kind: AddKind;
  /** DFD 上の配置位置。未指定なら空き位置に自動配置 */
  position?: { x: number; y: number };
  /** 複製時の初期値（FR-FN-14）。指定すると「複製」ダイアログとして開く */
  duplicateOf?: { name: string; kind: TransactionKind | DataFunctionKind | null; complexity: Complexity | null; description: string };
}

const DUPLICATE_TITLES: Record<AddKind, string> = {
  TF: 'トランザクションファンクションを複製',
  NCP: '非計上プロセスを複製',
  DF: 'データファンクションを複製',
  EE: '外部エンティティを複製',
};

/** ノード追加ダイアログ（FR-DF-02、ui-design.md 4.10） */
export function AddFunctionDialog({ featureId, request, onClose, onAdded }: {
  featureId: Id;
  request: AddRequest;
  onClose: () => void;
  onAdded?: (refId: Id) => void;
}) {
  const doc = useStore((s) => s.doc);
  const { kind, duplicateOf: src } = request;
  const [name, setName] = useState(src ? `${src.name}（コピー）` : '');
  const [tKind, setTKind] = useState<TransactionKind>(kind === 'TF' && src?.kind ? (src.kind as TransactionKind) : 'EI');
  const [dKind, setDKind] = useState<DataFunctionKind>(kind === 'DF' && src?.kind ? (src.kind as DataFunctionKind) : 'ILF');
  const [complexity, setComplexity] = useState<Complexity>(src?.complexity ?? 'low');
  const [description, setDescription] = useState(src?.description ?? '');
  // 複製時は名称を 1 度だけ全選択する（ダイアログのフォーカス制御で onFocus が再発火しても入力を消さない）
  const selectedOnce = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  /**
   * 表のセルから開いた場合、DataGrid がダイアログより後にセルへフォーカスを戻すことがある。
   * 表示アニメーション完了時に名称欄へフォーカスを移し直す。
   */
  const focusName = () => {
    const el = nameRef.current;
    if (el && document.activeElement !== el) el.focus();
  };
  const swId = softwareIdOfFeature(doc, featureId);
  const fnKind = kind === 'TF' ? tKind : kind === 'DF' ? dKind : null;
  const dup = swId && fnKind ? findDuplicateName(doc, swId, fnKind, name) : null;

  const submit = () => {
    const n = name.trim();
    if (!n) return;
    const s = useStore.getState();
    const place = request.position ?? true;
    let id: Id;
    if (kind === 'TF') id = s.addTransactionFunction({ featureId, name: n, kind: tKind, complexity, description, place });
    else if (kind === 'DF') id = s.addDataFunction({ featureId, name: n, kind: dKind, complexity, description, place });
    else if (kind === 'NCP') id = s.addNonCountedProcess({ featureId, name: n, description, place });
    else id = s.addExternalEntity({ featureId, name: n, description, place });
    onAdded?.(id);
    onClose();
  };

  return (
    <Dialog open onClose={onClose} maxWidth={false} slotProps={{ paper: { sx: { width: 480 }, component: 'form', onSubmit: (e: React.FormEvent) => { e.preventDefault(); submit(); } } as object, transition: { onEntered: focusName } }}>
      <DialogTitle>{src ? DUPLICATE_TITLES[kind] : TITLES[kind]}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: '4px !important' }}>
        <Field label="名称">
          <TextField
            autoFocus fullWidth value={name} onChange={(e) => setName(e.target.value)}
            inputRef={nameRef}
            onFocus={(e) => {
              if (src && !selectedOnce.current) {
                selectedOnce.current = true;
                e.target.select();
              }
            }}
            slotProps={{ htmlInput: { 'aria-label': '名称' } }}
          />
        </Field>
        {kind === 'TF' && (
          <Field label="種別">
            <ToggleButtonGroup exclusive fullWidth size="small" value={tKind} onChange={(_, v) => v && setTKind(v)} aria-label="種別">
              {(['EI', 'EO', 'EQ'] as const).map((k) => (
                <ToggleButton key={k} value={k}>{k} {FUNCTION_KIND_LABELS[k]}</ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Field>
        )}
        {kind === 'DF' && (
          <Field label="種別">
            <ToggleButtonGroup exclusive fullWidth size="small" value={dKind} onChange={(_, v) => v && setDKind(v)} aria-label="種別">
              {(['ILF', 'EIF'] as const).map((k) => (
                <ToggleButton key={k} value={k}>{k} {FUNCTION_KIND_LABELS[k]}</ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Field>
        )}
        {(kind === 'TF' || kind === 'DF') && (
          <Field label="複雑度">
            <ToggleButtonGroup exclusive fullWidth size="small" value={complexity} onChange={(_, v) => v && setComplexity(v)} aria-label="複雑度">
              {COMPLEXITIES.map((c) => (
                <ToggleButton key={c} value={c}>{COMPLEXITY_LABELS[c]}</ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Field>
        )}
        <Field label="説明（任意）">
          <TextField
            fullWidth multiline minRows={2} maxRows={6} value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder={kind === 'EE' ? 'この外部エンティティの役割や補足' : 'このファンクションを配置した理由や補足'}
            slotProps={{ htmlInput: { 'aria-label': '説明' } }}
          />
        </Field>
        <Field label={kind === 'DF' ? '所有機能' : kind === 'EE' ? '配置先の機能' : '所属機能'}>
          <TextField fullWidth value={featurePathLabel(doc, featureId)} slotProps={{ input: { readOnly: true } }} sx={{ '& .MuiInputBase-root': { background: tokens.headerBg, color: tokens.textSecondary } }} />
        </Field>
        {dup && (
          <Box sx={{ background: tokens.warningSoft, borderLeft: `3px solid ${tokens.warning}`, p: '8px 12px', fontSize: 12, display: 'flex', gap: 2 }}>
            <Box sx={{ mt: '2px' }}><WarningIcon size={12} /></Box>
            <span>
              同じ名称・種別のファンクション「{name.trim()}（{fnKind}）」が機能「{dup.featureName}」にあります。二重計上になっていないか確認してください。
              {kind === 'DF' && ' 既存のデータファンクションを使う場合は「既存を参照」から配置します。'}
            </span>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 6, pb: 4 }}>
        <Button onClick={onClose}>キャンセル</Button>
        <Button type="submit" variant="contained" disabled={!name.trim()}>{src ? '複製して配置' : '追加して配置'}</Button>
      </DialogActions>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box>
      <Typography component="div" sx={{ fontSize: 12, color: tokens.textSecondary, mb: '2px' }}>{label}</Typography>
      {children}
    </Box>
  );
}
