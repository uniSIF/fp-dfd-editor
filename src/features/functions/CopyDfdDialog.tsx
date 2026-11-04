import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Typography from '@mui/material/Typography';
import { useState, type ReactNode } from 'react';
import { featuresInOrder, getFeaturePath, softwareIdOfFeature } from '../../domain/queries';
import type { Id } from '../../domain/types';
import { useStore } from '../../store';
import { tokens } from '../app/theme';
import { ellipsis } from '../common/ellipsis';

/**
 * DFD を同じソフトウェア内の別の機能へコピーする（FR-DF-20）。
 * コピー後は、コピーで作ったファンクションだけを対象に文言置換ダイアログを開ける。
 */
export function CopyDfdDialog({ sourceFeatureId, onClose }: { sourceFeatureId: Id; onClose: () => void }) {
  const doc = useStore((s) => s.doc);
  const source = doc.features[sourceFeatureId];
  const swId = softwareIdOfFeature(doc, sourceFeatureId);
  const [targetId, setTargetId] = useState<Id | null>(null);
  const [dfMode, setDfMode] = useState<'reference' | 'duplicate'>('reference');
  const [thenReplace, setThenReplace] = useState(true);
  if (!source || !swId) return null;

  const nodes = source.dfd.nodes;
  const count = (refType: string) => nodes.filter((n) => n.refType === refType).length;
  const ownedDfs = nodes.filter((n) => n.refType === 'dataFunction' && doc.dataFunctions[n.refId]?.ownerFeatureId === sourceFeatureId).length;
  const refDfs = count('dataFunction') - ownedDfs;
  const candidates = featuresInOrder(doc, swId).filter((f) => f.id !== sourceFeatureId);

  const submit = () => {
    if (!targetId) return;
    const s = useStore.getState();
    const r = s.copyDfdToFeature(sourceFeatureId, targetId, { dataFunctions: dfMode });
    if (!r.ok) {
      s.notify(r.reason, 'error');
      return;
    }
    s.selectFeature(targetId);
    s.notify(`「${source.name}」の DFD を「${doc.features[targetId].name}」へコピーしました`, 'success');
    onClose();
    if (thenReplace) {
      s.setActiveTab('functions');
      s.openReplaceText({ featureId: targetId, refIds: r.created.map((c) => c.refId), edgeIds: r.edgeIds });
    } else {
      s.setActiveTab('dfd');
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth={false} slotProps={{ paper: { sx: { width: 520 } } }}>
      <DialogTitle>「{source.name}」の DFD を別の機能へコピー</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {nodes.length === 0 ? (
          <Typography sx={{ color: tokens.textSecondary }}>この機能の DFD にはノードがありません。</Typography>
        ) : (
          <>
            <Typography sx={{ fontSize: 12, color: tokens.textSecondary }}>
              トランザクション {count('transactionFunction')} 件・非計上プロセス {count('nonCountedProcess')} 件を複製し、
              外部エンティティ {count('externalEntity')} 件・データフロー {source.dfd.edges.length} 本とあわせてコピー先に追加します。
            </Typography>
            <Field label="コピー先の機能">
              <Box role="listbox" aria-label="コピー先の機能" sx={{ border: `1px solid ${tokens.border}`, borderRadius: '3px', maxHeight: 220, overflow: 'auto' }}>
                {candidates.length === 0 && <Typography sx={{ p: 3, fontSize: 12, color: tokens.textSecondary }}>同じソフトウェアにほかの機能がありません。</Typography>}
                {candidates.map((f) => {
                  const p = getFeaturePath(doc, f.id)!;
                  const hasDfd = f.dfd.nodes.length > 0;
                  return (
                    <ButtonBase
                      key={f.id}
                      role="option"
                      aria-selected={targetId === f.id}
                      aria-label={f.name}
                      onClick={() => setTargetId(f.id)}
                      sx={{
                        width: '100%', height: 36, justifyContent: 'flex-start', gap: 2, px: 3, borderBottom: `1px solid ${tokens.border}`,
                        '&:last-child': { borderBottom: 0 }, background: targetId === f.id ? tokens.primarySoft : undefined,
                        '&:hover': { background: targetId === f.id ? tokens.primarySoft : '#F8F9FB' },
                      }}
                    >
                      <span style={ellipsis({ flexShrink: 2, maxWidth: '45%', color: tokens.textSecondary, fontSize: 12 })} title={`${p.category1.name} / ${p.category2.name}`}>
                        {p.category1.name} / {p.category2.name} /
                      </span>
                      <span style={ellipsis({ flex: 1 })} title={f.name}>{f.name}</span>
                      {hasDfd && <span style={{ flexShrink: 0, fontSize: 12, color: tokens.textSecondary, whiteSpace: 'nowrap' }}>DFD あり（右側に追加）</span>}
                    </ButtonBase>
                  );
                })}
              </Box>
            </Field>
            {ownedDfs > 0 && (
              <Field label={`この機能が所有するデータファンクション（${ownedDfs} 件）の扱い`}>
                <RadioGroup value={dfMode} onChange={(e) => setDfMode(e.target.value as 'reference' | 'duplicate')}>
                  <FormControlLabel
                    value="reference"
                    control={<Radio size="small" />}
                    label={<Choice title="参照として配置" text="同じファイルを使う場合。FP はコピー元の機能にだけ計上します。" />}
                  />
                  <FormControlLabel
                    value="duplicate"
                    control={<Radio size="small" />}
                    label={<Choice title="複製してコピー先の所有にする" text="別のファイルとして扱う場合。コピー先の機能にも FP を計上します。" />}
                  />
                </RadioGroup>
              </Field>
            )}
            {refDfs > 0 && (
              <Typography sx={{ fontSize: 12, color: tokens.textSecondary }}>
                他の機能が所有するデータファンクション（{refDfs} 件）は、コピー先でも参照として配置します。
              </Typography>
            )}
            <FormControlLabel
              control={<Checkbox size="small" checked={thenReplace} onChange={(e) => setThenReplace(e.target.checked)} />}
              label={<span style={{ fontSize: 13 }}>コピー後に、コピーしたファンクションの文言を置換する</span>}
            />
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 6, pb: 4 }}>
        <Button onClick={onClose}>キャンセル</Button>
        <Button variant="contained" disabled={!targetId || nodes.length === 0} onClick={submit}>コピー</Button>
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

function Choice({ title, text }: { title: string; text: string }) {
  return (
    <Box sx={{ py: '2px' }}>
      <Box sx={{ fontSize: 13 }}>{title}</Box>
      <Box sx={{ fontSize: 12, color: tokens.textSecondary }}>{text}</Box>
    </Box>
  );
}
