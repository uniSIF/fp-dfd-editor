import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Select from '@mui/material/Select';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { FP_WEIGHTS } from '../../domain/fpTables';
import { dataFunctionsOwnedBy, featureIdsUnder } from '../../domain/queries';
import type { Id } from '../../domain/types';
import { useStore, type DataFunctionDisposition } from '../../store';
import { tokens } from '../app/theme';
import { ellipsis } from '../common/ellipsis';
import { KindBadge } from '../common/KindBadge';

/**
 * 機能・分類の削除の確認（FR-CT-04、FR-CT-06）。削除する機能が所有するデータファンクションの扱いを選べる。
 * 「削除する」を選んだとき、残る機能が参照しているものは、その機能へ所有を移すか、参照ごと削除するかを選ぶ。
 */
export function DeleteFeaturesDialog({ node, details, onClose }: {
  node: { kind: 'category1' | 'category2' | 'feature'; id: Id; name: string };
  details: string[];
  onClose: () => void;
}) {
  const doc = useStore((s) => s.doc);
  const owned = dataFunctionsOwnedBy(doc, featureIdsUnder(doc, node.id));
  const [mode, setMode] = useState<'keep' | 'delete'>('keep');
  // 参照されているものの既定は、最初に参照している機能へ所有を移す
  const [choice, setChoice] = useState<Record<Id, string>>(() =>
    Object.fromEntries(owned.filter((o) => o.referencedBy.length).map((o) => [o.dataFunction.id, o.referencedBy[0].id])),
  );

  const submit = () => {
    const disposition: DataFunctionDisposition = {};
    if (mode === 'delete') {
      for (const o of owned) {
        const c = choice[o.dataFunction.id];
        disposition[o.dataFunction.id] = o.referencedBy.length && c && c !== 'delete' ? { transferTo: c } : 'delete';
      }
    }
    const s = useStore.getState();
    if (node.kind === 'feature') s.removeFeature(node.id, disposition);
    else s.removeCategory(node.id, disposition);
    const transferred = Object.values(disposition).filter((x) => x !== 'delete').length;
    const deleted = Object.values(disposition).filter((x) => x === 'delete').length;
    s.notify(
      `「${node.name}」を削除しました${mode === 'delete' ? `（データファンクション: 削除 ${deleted} 件${transferred ? `・所有を移動 ${transferred} 件` : ''}）` : ''}`,
      'success',
    );
    onClose();
  };

  return (
    <Dialog open onClose={onClose} maxWidth={false} slotProps={{ paper: { sx: { width: 600 } } }}>
      <DialogTitle sx={ellipsis()}>「{node.name}」を削除しますか</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {details.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: 18, color: tokens.textSecondary, fontSize: 12 }}>
            {details.map((d) => <li key={d}>{d}</li>)}
          </ul>
        )}
        <Box>
          <Typography sx={{ fontSize: 13, fontWeight: 600, mb: '2px' }}>
            {node.kind === 'feature' ? 'この機能' : '削除する機能'}が所有するデータファンクション（{owned.length} 件）
          </Typography>
          <RadioGroup value={mode} onChange={(e) => setMode(e.target.value as 'keep' | 'delete')}>
            <FormControlLabel value="keep" control={<Radio size="small" />} label={<span style={{ fontSize: 13 }}>残す（所有機能を「未設定」にする。FP はどの機能にも計上されない）</span>} />
            <FormControlLabel value="delete" control={<Radio size="small" />} label={<span style={{ fontSize: 13 }}>削除する（ほかの機能が参照しているものは、所有を移すか削除するかを選ぶ）</span>} />
          </RadioGroup>
        </Box>
        <Box role="list" aria-label="所有するデータファンクション" sx={{ border: `1px solid ${tokens.border}`, borderRadius: '3px', maxHeight: 260, overflow: 'auto', opacity: mode === 'delete' ? 1 : 0.6 }}>
          {owned.map(({ dataFunction: df, referencedBy }) => (
            <Box key={df.id} role="listitem" sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 3, minHeight: 40, borderBottom: `1px solid ${tokens.border}`, '&:last-child': { borderBottom: 0 }, fontSize: 13 }}>
              <span style={{ flexShrink: 0, width: 52, fontSize: 12, color: tokens.textSecondary }}>{df.displayNo}</span>
              <KindBadge kind={df.kind} />
              <span style={ellipsis({ flex: 1 })} title={df.name}>{df.name}</span>
              <span style={{ flexShrink: 0, fontSize: 12, color: tokens.textSecondary }}>{FP_WEIGHTS[df.kind][df.complexity]} FP</span>
              {mode === 'keep' ? (
                <span style={{ flexShrink: 0, width: 220, fontSize: 12, color: tokens.textSecondary }}>残す（所有機能 未設定）</span>
              ) : referencedBy.length ? (
                <Select
                  value={choice[df.id] ?? 'delete'}
                  onChange={(e) => setChoice({ ...choice, [df.id]: e.target.value })}
                  sx={{ flexShrink: 0, width: 220, height: 28, fontSize: 12 }}
                  inputProps={{ 'aria-label': `${df.name} の扱い` }}
                >
                  {referencedBy.map((f) => <MenuItem key={f.id} value={f.id} dense>所有を「{f.name}」に移す</MenuItem>)}
                  <MenuItem value="delete" dense>削除する（{referencedBy.map((f) => f.name).join('・')} の DFD からも外す）</MenuItem>
                </Select>
              ) : (
                <span style={{ flexShrink: 0, width: 220, fontSize: 12, color: tokens.error }}>削除する（参照している機能なし）</span>
              )}
            </Box>
          ))}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 6, pb: 4 }}>
        <Button onClick={onClose}>キャンセル</Button>
        <Button variant="contained" color="error" onClick={submit}>削除</Button>
      </DialogActions>
    </Dialog>
  );
}
