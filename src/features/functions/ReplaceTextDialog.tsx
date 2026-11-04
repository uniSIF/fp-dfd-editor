import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Link from '@mui/material/Link';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMemo, useState, type ReactNode } from 'react';
import { planTextReplacements, type ReplaceCandidate } from '../../domain/textReplace';
import type { Id } from '../../domain/types';
import { useStore, type TextChange } from '../../store';
import { tokens } from '../app/theme';
import { ellipsis } from '../common/ellipsis';

const FIELD_LABELS = { name: '名称', description: '説明', label: 'ラベル' } as const;

/** 検索語を強調して表示する */
export function Highlight({ text, word, color }: { text: string; word: string; color: string }) {
  if (!word) return <>{text}</>;
  const parts = text.split(word);
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 && <mark style={{ background: color, color: 'inherit', padding: '0 1px', borderRadius: 2 }}>{word}</mark>}
        </span>
      ))}
    </>
  );
}

/**
 * 機能内のファンクション名などの文言を一括置換する（FR-FN-17）。
 * 置換前後を一覧で確認し、行ごとに対象を外せる。
 */
export function ReplaceTextDialog({ featureId, refIds, edgeIds, onClose }: { featureId: Id; refIds?: Id[]; edgeIds?: Id[]; onClose: () => void }) {
  const doc = useStore((s) => s.doc);
  const feature = doc.features[featureId];
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [options, setOptions] = useState({ name: true, description: false, edgeLabels: true });
  const [scoped, setScoped] = useState(!!refIds);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const scope = useMemo(
    () => (scoped && refIds ? { refIds: new Set(refIds), edgeIds: new Set(edgeIds ?? []) } : undefined),
    [scoped, refIds, edgeIds],
  );
  const plan = useMemo(() => planTextReplacements(doc, featureId, find, replace, options, scope), [doc, featureId, find, replace, options, scope]);
  if (!feature) return null;
  const selected = plan.filter((p) => !excluded.has(p.key));

  const toggle = (key: string) =>
    setExcluded((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const submit = () => {
    const changes: TextChange[] = selected.map((p: ReplaceCandidate) =>
      p.target === 'edge'
        ? { target: 'edge', featureId, edgeId: p.edgeId!, value: p.after }
        : { target: 'entity', refType: p.refType!, refId: p.refId!, field: p.field as 'name' | 'description', value: p.after },
    );
    const s = useStore.getState();
    s.applyTextReplacements(changes);
    s.notify(`${changes.length} 件を置換しました`, 'success');
    onClose();
  };

  return (
    <Dialog open onClose={onClose} maxWidth={false} slotProps={{ paper: { sx: { width: 640 } } }}>
      <DialogTitle>文言を置換（{feature.name}）</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {refIds && (
          <Box sx={{ background: tokens.primarySoft, borderRadius: '3px', p: '8px 12px', fontSize: 12, display: 'flex', gap: 2, alignItems: 'center' }}>
            <span>{scoped ? 'DFD のコピーで追加したファンクションとデータフローだけが対象です。' : 'この機能のすべてのファンクションが対象です。'}</span>
            <Link component="button" sx={{ fontSize: 12, ml: 'auto', whiteSpace: 'nowrap' }} onClick={() => setScoped(!scoped)}>
              {scoped ? 'この機能のすべてを対象にする' : 'コピーで追加したものだけにする'}
            </Link>
          </Box>
        )}
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3 }}>
          <Field label="検索する文字列">
            <TextField autoFocus fullWidth value={find} onChange={(e) => { setFind(e.target.value); setExcluded(new Set()); }} slotProps={{ htmlInput: { 'aria-label': '検索する文字列' } }} />
          </Field>
          <Field label="置換後の文字列">
            <TextField fullWidth value={replace} onChange={(e) => setReplace(e.target.value)} slotProps={{ htmlInput: { 'aria-label': '置換後の文字列' } }} />
          </Field>
        </Box>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          {([['name', '名称'], ['description', '説明'], ['edgeLabels', 'データフローのラベル']] as const).map(([k, label]) => (
            <FormControlLabel
              key={k}
              control={<Checkbox size="small" checked={options[k]} onChange={(e) => setOptions({ ...options, [k]: e.target.checked })} />}
              label={<span style={{ fontSize: 13 }}>{label}</span>}
            />
          ))}
        </Box>
        <Box>
          <Typography sx={{ fontSize: 12, color: tokens.textSecondary, mb: 1 }}>
            {find ? `${plan.length} 件が見つかりました。置換しないものはチェックを外します。` : '検索する文字列を入力すると、置換前と置換後を一覧で確認できます。'}
          </Typography>
          {plan.length > 0 && (
            <Box role="list" aria-label="置換の候補" sx={{ border: `1px solid ${tokens.border}`, borderRadius: '3px', maxHeight: 280, overflow: 'auto' }}>
              {plan.map((p) => (
                <Box
                  key={p.key}
                  role="listitem"
                  sx={{ display: 'grid', gridTemplateColumns: '28px 88px 44px minmax(0, 1fr)', alignItems: 'center', gap: 2, px: 2, minHeight: 34, borderBottom: `1px solid ${tokens.border}`, '&:last-child': { borderBottom: 0 }, opacity: excluded.has(p.key) ? 0.5 : 1 }}
                >
                  <Checkbox size="small" checked={!excluded.has(p.key)} onChange={() => toggle(p.key)} slotProps={{ input: { 'aria-label': `${p.before} を置換する` } }} />
                  <span style={ellipsis({ fontSize: 12, color: tokens.textSecondary })} title={p.displayNo === '—' ? p.kindLabel : `${p.displayNo} ${p.kindLabel}`}>
                    {p.displayNo === '—' ? p.kindLabel : `${p.displayNo} ${p.kindLabel}`}
                  </span>
                  <span style={{ fontSize: 12, color: tokens.textSecondary }}>{FIELD_LABELS[p.field]}</span>
                  {/* 置換前と置換後を 2 段に分け、長い文言でも両方が見えるようにする */}
                  <Box sx={{ minWidth: 0, py: '4px', fontSize: 13, lineHeight: '18px' }} title={`${p.before} → ${p.after}`}>
                    <div style={ellipsis()}><Highlight text={p.before} word={find} color="#FFE1E1" /></div>
                    <div style={ellipsis()}>
                      <span style={{ color: tokens.textDisabled, marginRight: 6 }}>→</span>
                      <Highlight text={p.after} word={replace} color="#DDF3E4" />
                    </div>
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </Box>
        <Typography sx={{ fontSize: 11, color: tokens.textSecondary }}>
          外部エンティティと、他の機能が所有するデータファンクションは、ほかの機能と共有しているため対象外です。
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 6, pb: 4 }}>
        <Button onClick={onClose}>閉じる</Button>
        <Button variant="contained" disabled={!selected.length} onClick={submit}>
          {selected.length ? `${selected.length} 件を置換` : '置換'}
        </Button>
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
