import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState, type ReactNode } from 'react';
import { featurePathLabel, featuresInOrder, softwareIdOfFeature } from '../../domain/queries';
import { replaceText } from '../../domain/textReplace';
import type { Id } from '../../domain/types';
import { findDuplicateName } from '../../domain/validation';
import { useStore } from '../../store';
import type { FunctionRow } from '../../store/selectors';
import { tokens } from '../app/theme';
import { ellipsis } from '../common/ellipsis';
import { KindBadge } from '../common/KindBadge';
import { WarningIcon } from '../common/WarningIcon';
import { Highlight } from './ReplaceTextDialog';

/** 複製せず、コピー先でも同じものを使う行（外部エンティティ・他機能所有の DF） */
const isShared = (r: FunctionRow) => r.refType === 'externalEntity' || r.isReference;

function badgeOf(r: FunctionRow) {
  if (r.isReference) return <KindBadge kind="REF" />;
  if (r.kind) return <KindBadge kind={r.kind} />;
  return r.refType === 'nonCountedProcess' ? <KindBadge kind="NCP" /> : <KindBadge kind="EE" />;
}

/**
 * ファンクション表で選んだ要素をまとめてコピーする（FR-FN-18）。
 * コピーと同時に、複製する要素の名称・説明とデータフローのラベルの文言を置換できる。
 */
export function CopyFunctionsDialog({ featureId, rows, onClose, onCopied }: {
  featureId: Id;
  rows: FunctionRow[];
  onClose: () => void;
  onCopied: () => void;
}) {
  const doc = useStore((s) => s.doc);
  const swId = softwareIdOfFeature(doc, featureId);
  const [targetId, setTargetId] = useState<Id>(featureId);
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [options, setOptions] = useState({ name: true, description: false, edgeLabels: true });
  const [includeEdges, setIncludeEdges] = useState(true);
  if (!swId) return null;

  const source = doc.features[featureId];
  const nodeIds = new Set(rows.flatMap((r) => r.nodeIds));
  const edges = source.dfd.edges.filter((e) => nodeIds.has(e.sourceNodeId) && nodeIds.has(e.targetNodeId));
  const copies = rows.filter((r) => !isShared(r));
  const after = (r: FunctionRow) => (options.name ? replaceText(r.name, find, replace) : r.name);
  const edgeChanges = options.edgeLabels && find ? edges.filter((e) => e.label.includes(find)) : [];

  const submit = () => {
    const s = useStore.getState();
    const r = s.copyFunctions({
      sourceFeatureId: featureId, targetFeatureId: targetId, includeEdges,
      refs: rows.map((x) => ({ refType: x.refType, refId: x.refId })),
      replace: { find, replace, ...options },
    });
    if (!r.ok) {
      s.notify(r.reason, 'error');
      return;
    }
    if (targetId !== featureId) s.selectFeature(targetId);
    s.setSelection(r.nodeIds, null);
    s.notify(`${rows.length} 件をコピーしました（新しく作成 ${r.created.length} 件・データフロー ${r.edgeIds.length} 本）${targetId !== featureId ? `。「${doc.features[targetId].name}」を表示しています` : ''}`, 'success');
    onCopied();
    onClose();
  };

  return (
    <Dialog open onClose={onClose} maxWidth={false} slotProps={{ paper: { sx: { width: 640 } } }}>
      <DialogTitle>選択した {rows.length} 件のファンクションをコピー</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Field label="コピー先の機能">
          <Select fullWidth value={targetId} onChange={(e) => setTargetId(e.target.value)} sx={{ height: 32 }} inputProps={{ 'aria-label': 'コピー先の機能' }}>
            {featuresInOrder(doc, swId).map((f) => (
              <MenuItem key={f.id} value={f.id} dense>{f.id === featureId ? `この機能（${f.name}）` : featurePathLabel(doc, f.id)}</MenuItem>
            ))}
          </Select>
        </Field>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3 }}>
          <Field label="置換する文字列（任意）">
            <TextField autoFocus fullWidth value={find} onChange={(e) => setFind(e.target.value)} slotProps={{ htmlInput: { 'aria-label': '置換する文字列' } }} />
          </Field>
          <Field label="置換後の文字列">
            <TextField fullWidth value={replace} onChange={(e) => setReplace(e.target.value)} slotProps={{ htmlInput: { 'aria-label': '置換後の文字列' } }} />
          </Field>
        </Box>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: -2 }}>
          {([['name', '名称'], ['description', '説明'], ['edgeLabels', 'データフローのラベル']] as const).map(([k, label]) => (
            <FormControlLabel
              key={k}
              control={<Checkbox size="small" checked={options[k]} onChange={(e) => setOptions({ ...options, [k]: e.target.checked })} />}
              label={<span style={{ fontSize: 13 }}>{label}を置換</span>}
            />
          ))}
        </Box>
        <Box>
          <Typography sx={{ fontSize: 12, color: tokens.textSecondary, mb: 1 }}>
            新しい番号で複製 {copies.length} 件{rows.length - copies.length ? `・共有のまま使う ${rows.length - copies.length} 件` : ''}
            {edgeChanges.length ? `・ラベルを置換するデータフロー ${edgeChanges.length} 本` : ''}
          </Typography>
          <Box role="list" aria-label="コピーする要素" sx={{ border: `1px solid ${tokens.border}`, borderRadius: '3px', maxHeight: 260, overflow: 'auto' }}>
            {rows.map((r) => {
              const shared = isShared(r);
              const name = shared ? r.name : after(r);
              // 置換しないと元と同じ名称になる（FP の二重計上に気づけるよう印を出す）
              const dup = !shared && r.kind ? findDuplicateName(doc, swId, r.kind, name) : null;
              return (
                <Box
                  key={r.rowId}
                  role="listitem"
                  sx={{ display: 'grid', gridTemplateColumns: '64px 44px minmax(0, 1fr) auto', alignItems: 'center', gap: 2, px: 3, minHeight: 34, py: '4px', borderBottom: `1px solid ${tokens.border}`, '&:last-child': { borderBottom: 0 } }}
                >
                  <span style={ellipsis({ fontSize: 12, color: tokens.textSecondary })}>{r.displayNo}</span>
                  <span>{badgeOf(r)}</span>
                  <Box sx={{ minWidth: 0, fontSize: 13, lineHeight: '18px' }} title={shared ? r.name : `${r.name} → ${name}`}>
                    {shared || name === r.name ? (
                      <div style={ellipsis()}>{r.name}</div>
                    ) : (
                      <>
                        <div style={ellipsis()}><Highlight text={r.name} word={find} color="#FFE1E1" /></div>
                        <div style={ellipsis()}><span style={{ color: tokens.textDisabled, marginRight: 6 }}>→</span><Highlight text={name} word={replace} color="#DDF3E4" /></div>
                      </>
                    )}
                  </Box>
                  <span style={{ fontSize: 11, color: tokens.textSecondary, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
                    {shared ? '共有のまま使う' : dup ? <><WarningIcon size={12} />同じ名称あり</> : '新しい番号で複製'}
                  </span>
                </Box>
              );
            })}
          </Box>
          {rows.some(isShared) && (
            <Typography sx={{ fontSize: 11, color: tokens.textSecondary, mt: 1 }}>
              外部エンティティと他の機能が所有するデータファンクションは複製せず、コピー先でも同じものを使います（文言は置換しません）。
            </Typography>
          )}
        </Box>
        <FormControlLabel
          disabled={!edges.length}
          control={<Checkbox size="small" checked={includeEdges && edges.length > 0} onChange={(e) => setIncludeEdges(e.target.checked)} />}
          label={<span style={{ fontSize: 13 }}>選んだ要素どうしをつなぐデータフロー（{edges.length} 本）もコピーする</span>}
        />
      </DialogContent>
      <DialogActions sx={{ px: 6, pb: 4 }}>
        <Button onClick={onClose}>キャンセル</Button>
        <Button variant="contained" onClick={submit}>コピー</Button>
      </DialogActions>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box>
      <Typography component="div" sx={{ fontSize: 12, color: tokens.textSecondary, mb: '2px' }}>{label}</Typography>
      {children}
    </Box>
  );
}
