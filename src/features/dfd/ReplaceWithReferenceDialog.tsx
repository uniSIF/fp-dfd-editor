import SearchIcon from '@mui/icons-material/Search';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputBase from '@mui/material/InputBase';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import type { Id } from '../../domain/types';
import { useStore } from '../../store';
import { tokens } from '../app/theme';
import { ellipsis } from '../common/ellipsis';
import { KindBadge } from '../common/KindBadge';

/**
 * データファンクション・外部エンティティのノードを、既存の同種の要素への参照に置き換える（FR-DF-22）。
 * 別 ID で重複して追加してしまった要素を、元からある要素にまとめるために使う。
 */
export function ReplaceWithReferenceDialog({ featureId, nodeId, onClose }: { featureId: Id; nodeId: Id; onClose: () => void }) {
  const doc = useStore((s) => s.doc);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Id | null>(null);
  const [scope, setScope] = useState<'all' | 'node'>('all');
  const [removeOriginal, setRemoveOriginal] = useState(true);
  const node = doc.features[featureId]?.dfd.nodes.find((n) => n.id === nodeId);
  if (!node || (node.refType !== 'dataFunction' && node.refType !== 'externalEntity')) return null;
  const isDf = node.refType === 'dataFunction';
  const self = isDf ? doc.dataFunctions[node.refId] : doc.externalEntities[node.refId];
  if (!self) return null;

  // 元の要素を置いている DFD（ノード単位）
  const placements = Object.values(doc.features).flatMap((f) =>
    f.dfd.nodes.filter((n) => n.refType === node.refType && n.refId === node.refId).map((n) => ({ feature: f, node: n })),
  );
  const otherPlacements = placements.filter((p) => p.node.id !== nodeId);
  const willRemain = scope === 'node' && otherPlacements.length > 0;
  const placedFeatureNames = [...new Set(placements.map((p) => p.feature.name))];

  const items = (isDf
    ? Object.values(doc.dataFunctions)
        .filter((d) => d.softwareId === self.softwareId && d.id !== self.id)
        .map((d) => ({ id: d.id, name: d.name, badge: d.kind, no: d.displayNo, meta: d.ownerFeatureId ? `所有: ${doc.features[d.ownerFeatureId]?.name ?? ''}` : '所有: 未設定' }))
    : Object.values(doc.externalEntities)
        .filter((e) => e.softwareId === self.softwareId && e.id !== self.id)
        .map((e) => ({ id: e.id, name: e.name, badge: 'EE' as const, no: e.displayNo, meta: '' }))
  )
    .sort((a, b) => Number(b.name === self.name) - Number(a.name === self.name) || a.no.localeCompare(b.no));
  const filtered = items.filter((i) => i.name.includes(q.trim()));
  
  const submit = (toRefId: Id | null = selected) => {
    if (!toRefId) return;
    const s = useStore.getState();
    const r = s.replaceWithReference({ featureId, nodeId, toRefId, scope, removeOriginal });
    if (!r.ok) {
      s.notify(r.reason, 'error');
      return;
    }
    s.notify(`「${self.name}」を「${items.find((i) => i.id === toRefId)?.name}」への参照に置き換えました${r.removed ? `（${self.displayNo} は削除）` : ''}`, 'success');
    onClose();
  };

  return (
    <Dialog open onClose={onClose} maxWidth={false} slotProps={{ paper: { sx: { width: 560 } } }}>
      <DialogTitle sx={ellipsis()}>「{self.name}」を既存の要素への参照に置き換え</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Typography sx={{ fontSize: 12, color: tokens.textSecondary }}>
          別の番号で重複して追加した{isDf ? 'データファンクション' : '外部エンティティ'}を、既存のものにまとめます。データフローはそのまま引き継ぎます。
        </Typography>
        <Box>
          <Typography component="div" sx={{ fontSize: 12, color: tokens.textSecondary, mb: '2px' }}>置き換え先（{self.displayNo}「{self.name}」と同種の要素）</Typography>
          <Box sx={{ height: 28, border: `1px solid ${tokens.border}`, borderRadius: '3px', px: 2, display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
            <SearchIcon sx={{ fontSize: 14, color: tokens.textDisabled }} />
            <InputBase autoFocus placeholder="名称で絞り込み" value={q} onChange={(e) => setQ(e.target.value)} sx={{ fontSize: 13, flex: 1 }} inputProps={{ 'aria-label': '名称で絞り込み' }} />
          </Box>
          <Box role="listbox" aria-label="置き換え先" sx={{ border: `1px solid ${tokens.border}`, borderRadius: '3px', maxHeight: 220, overflow: 'auto' }}>
            {filtered.length === 0 && <Typography sx={{ p: 3, color: tokens.textSecondary, fontSize: 12 }}>置き換えられる要素がありません。</Typography>}
            {filtered.map((i) => (
              <ButtonBase
                key={i.id}
                role="option"
                aria-selected={selected === i.id}
                aria-label={`${i.no} ${i.name}`}
                onClick={() => setSelected(i.id)}
                onDoubleClick={() => submit(i.id)}
                sx={{
                  width: '100%', height: 36, justifyContent: 'flex-start', gap: 2, px: 3, borderBottom: `1px solid ${tokens.border}`,
                  '&:last-child': { borderBottom: 0 }, background: selected === i.id ? tokens.primarySoft : undefined,
                  '&:hover': { background: selected === i.id ? tokens.primarySoft : '#F8F9FB' },
                }}
              >
                <KindBadge kind={i.badge} />
                <span style={{ flexShrink: 0, fontSize: 12, color: tokens.textSecondary }}>{i.no}</span>
                <span style={ellipsis({ flex: 1 })} title={i.name}>{i.name}</span>
                {i.name === self.name && <span style={{ flexShrink: 0, fontSize: 11, padding: '0 6px', borderRadius: 8, border: `1px solid ${tokens.border}`, color: tokens.textSecondary }}>同じ名称</span>}
                {i.meta && <span style={ellipsis({ maxWidth: '40%', fontSize: 12, color: tokens.textSecondary })} title={i.meta}>{i.meta}</span>}
              </ButtonBase>
            ))}
          </Box>
        </Box>
        <Box>
          <Typography component="div" sx={{ fontSize: 12, color: tokens.textSecondary, mb: '2px' }}>置き換える範囲</Typography>
          <RadioGroup value={scope} onChange={(e) => setScope(e.target.value as 'all' | 'node')}>
            <FormControlLabel
              value="all" control={<Radio size="small" />}
              label={<span style={{ fontSize: 13 }}>「{self.name}」を置いているすべての DFD（{placedFeatureNames.length} 機能・{placements.length} 箇所）</span>}
            />
            <FormControlLabel value="node" control={<Radio size="small" />} label={<span style={{ fontSize: 13 }}>選択中のノードだけ</span>} />
          </RadioGroup>
        </Box>
        <Box>
          <FormControlLabel
            disabled={willRemain}
            control={<Checkbox size="small" checked={removeOriginal && !willRemain} onChange={(e) => setRemoveOriginal(e.target.checked)} />}
            label={<span style={{ fontSize: 13 }}>置き換え後、元の {self.displayNo}「{self.name}」を削除する</span>}
          />
          <Typography sx={{ fontSize: 12, color: tokens.textSecondary, ml: '30px' }}>
            {willRemain
              ? 'ほかの DFD にも配置されているため、元の要素は残ります。'
              : isDf
                ? 'データファンクションは配置していなくても所有機能に FP を計上します。重複を解消するなら削除します。'
                : 'どの DFD にも配置されていない外部エンティティは不要なため、削除をおすすめします。'}
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 6, pb: 4 }}>
        <Button onClick={onClose}>キャンセル</Button>
        <Button variant="contained" disabled={!selected} onClick={() => submit()}>置き換え</Button>
      </DialogActions>
    </Dialog>
  );
}
