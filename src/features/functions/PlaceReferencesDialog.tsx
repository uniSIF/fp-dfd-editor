import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';
import { useState, type ReactNode } from 'react';
import { featuresInOrder, getFeaturePath, softwareIdOfFeature } from '../../domain/queries';
import type { Id } from '../../domain/types';
import { useStore } from '../../store';
import type { FunctionRow } from '../../store/selectors';
import { tokens } from '../app/theme';
import { ellipsis } from '../common/ellipsis';
import { KindBadge } from '../common/KindBadge';

const canReference = (r: FunctionRow) => r.refType === 'dataFunction' || r.refType === 'externalEntity';

/**
 * ファンクション表で選んだデータファンクション・外部エンティティを、ID はそのままで他の機能の DFD に参照として置く（FR-FN-19）。
 * トランザクション・非計上プロセスは機能に属するため参照できない（複製は「一括コピー」で行う）。
 */
export function PlaceReferencesDialog({ featureId, rows, onClose, onPlaced }: {
  featureId: Id;
  rows: FunctionRow[];
  onClose: () => void;
  onPlaced: () => void;
}) {
  const doc = useStore((s) => s.doc);
  const swId = softwareIdOfFeature(doc, featureId);
  const [targets, setTargets] = useState<Set<Id>>(new Set());
  if (!swId) return null;
  const refs = rows.filter(canReference);
  const others = rows.filter((r) => !canReference(r));
  const candidates = featuresInOrder(doc, swId).filter((f) => f.id !== featureId);
  /** その機能にまだ置いていない件数 */
  const newCount = (fid: Id) => refs.filter((r) => !doc.features[fid].dfd.nodes.some((n) => n.refType === r.refType && n.refId === r.refId)).length;
  const total = [...targets].reduce((n, fid) => n + newCount(fid), 0);
  const toggle = (id: Id) => setTargets((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const submit = () => {
    const s = useStore.getState();
    const r = s.placeReferences([...targets], refs.map((x) => ({ refType: x.refType, refId: x.refId })));
    const n = Object.values(r.placed).reduce((a, b) => a + b, 0);
    s.notify(`${Object.values(r.placed).filter(Boolean).length} 機能の DFD に、計 ${n} 件を参照として配置しました${r.skipped ? `（配置済みの ${r.skipped} 件は飛ばしました）` : ''}`, 'success');
    onPlaced();
    onClose();
  };

  return (
    <Dialog open onClose={onClose} maxWidth={false} slotProps={{ paper: { sx: { width: 600 } } }}>
      <DialogTitle>選択した要素を他の DFD に参照として配置</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Typography sx={{ fontSize: 12, color: tokens.textSecondary }}>
          番号（ID）はそのままで、選んだ機能の DFD にも同じ要素を置きます。名称などを変えると、置いたすべての DFD に反映されます。
          データファンクションの FP は所有機能にだけ計上されます。
        </Typography>
        <Field label={`配置する要素（${refs.length} 件）`}>
          <Box role="list" aria-label="配置する要素" sx={{ border: `1px solid ${tokens.border}`, borderRadius: '3px', maxHeight: 160, overflow: 'auto' }}>
            {refs.length === 0 && <Typography sx={{ p: 3, fontSize: 12, color: tokens.textSecondary }}>参照として配置できる要素（データファンクション・外部エンティティ）が選ばれていません。</Typography>}
            {refs.map((r) => (
              <Box key={r.rowId} role="listitem" sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 3, height: 32, borderBottom: `1px solid ${tokens.border}`, '&:last-child': { borderBottom: 0 }, fontSize: 13 }}>
                <span style={{ flexShrink: 0, width: 56, fontSize: 12, color: tokens.textSecondary }}>{r.displayNo}</span>
                <KindBadge kind={r.kind ?? 'EE'} />
                <span style={ellipsis({ flex: 1 })} title={r.name}>{r.name}</span>
                {r.ownerName && <span style={ellipsis({ maxWidth: '40%', fontSize: 12, color: tokens.textSecondary })}>所有: {r.ownerName}</span>}
              </Box>
            ))}
          </Box>
          {others.length > 0 && (
            <Typography sx={{ fontSize: 12, color: tokens.textSecondary, mt: 1 }}>
              トランザクション・非計上プロセス（{others.map((o) => o.name).join('、')}）は機能ごとの要素のため参照できません。ほかの機能でも使うときは「選択した件数をコピー」で複製します。
            </Typography>
          )}
        </Field>
        <Field label="配置先の機能">
          <Box role="list" aria-label="配置先の機能" sx={{ border: `1px solid ${tokens.border}`, borderRadius: '3px', maxHeight: 220, overflow: 'auto' }}>
            {candidates.length === 0 && <Typography sx={{ p: 3, fontSize: 12, color: tokens.textSecondary }}>同じソフトウェアにほかの機能がありません。</Typography>}
            {candidates.map((f) => {
              const p = getFeaturePath(doc, f.id)!;
              const n = newCount(f.id);
              return (
                <Box component="label" role="listitem" key={f.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 3, height: 32, borderBottom: `1px solid ${tokens.border}`, '&:last-child': { borderBottom: 0 }, cursor: 'pointer', '&:hover': { background: '#F8F9FB' } }}>
                  <Checkbox size="small" checked={targets.has(f.id)} onChange={() => toggle(f.id)} slotProps={{ input: { 'aria-label': f.name } }} />
                  <span style={ellipsis({ maxWidth: '45%', fontSize: 12, color: tokens.textSecondary })} title={`${p.category1.name} / ${p.category2.name}`}>{p.category1.name} / {p.category2.name} /</span>
                  <span style={ellipsis({ flex: 1 })} title={f.name}>{f.name}</span>
                  <span style={{ flexShrink: 0, fontSize: 11, color: tokens.textSecondary }}>
                    {refs.length && n === 0 ? 'すべて配置済み' : n < refs.length ? `${n} 件を配置（${refs.length - n} 件は配置済み）` : ''}
                  </span>
                </Box>
              );
            })}
          </Box>
        </Field>
      </DialogContent>
      <DialogActions sx={{ px: 6, pb: 4 }}>
        <Button onClick={onClose}>キャンセル</Button>
        <Button variant="contained" disabled={!total} onClick={submit}>{total ? `${total} 件を参照として配置` : '参照として配置'}</Button>
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
