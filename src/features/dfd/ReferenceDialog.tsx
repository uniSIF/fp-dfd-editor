import SearchIcon from '@mui/icons-material/Search';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import InputBase from '@mui/material/InputBase';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { canPlaceMultiple } from '../../domain/dfdRules';
import { softwareIdOfFeature } from '../../domain/queries';
import type { Id } from '../../domain/types';
import { useStore } from '../../store';
import { tokens } from '../app/theme';
import { KindBadge } from '../common/KindBadge';

/** 既存のデータファンクション・外部エンティティを参照配置する（FR-DF-03、FR-FN-04） */
export function ReferenceDialog({ featureId, position, onClose }: { featureId: Id; position?: { x: number; y: number }; onClose: () => void }) {
  const doc = useStore((s) => s.doc);
  const [tab, setTab] = useState<'dataFunction' | 'externalEntity'>('dataFunction');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Id | null>(null);
  const swId = softwareIdOfFeature(doc, featureId);
  const placed = new Set(doc.features[featureId]?.dfd.nodes.filter((n) => n.refType === tab).map((n) => n.refId));

  const items =
    tab === 'dataFunction'
      ? Object.values(doc.dataFunctions)
          .filter((d) => d.softwareId === swId)
          .sort((a, b) => a.displayNo.localeCompare(b.displayNo))
          .map((d) => ({
            id: d.id, name: d.name, badge: d.kind,
            meta: d.ownerFeatureId ? `所有: ${doc.features[d.ownerFeatureId]?.name ?? ''}` : '所有: 未設定',
            warn: d.ownerFeatureId === null,
          }))
      : Object.values(doc.externalEntities)
          .filter((e) => e.softwareId === swId)
          .sort((a, b) => a.displayNo.localeCompare(b.displayNo))
          .map((e) => ({ id: e.id, name: e.name, badge: 'EE' as const, meta: e.displayNo, warn: false }));
  const filtered = items.filter((i) => i.name.includes(q.trim()));

  const submit = (id: Id | null = selected) => {
    if (!id) return;
    const r = useStore.getState().placeNode(featureId, tab, id, position);
    if (!r.ok) useStore.getState().notify(r.reason, 'error');
    onClose();
  };

  return (
    <Dialog open onClose={onClose} maxWidth={false} slotProps={{ paper: { sx: { width: 480 } } }}>
      <DialogTitle>既存の要素をこの DFD に配置</DialogTitle>
      <DialogContent>
        <Tabs value={tab} onChange={(_, v) => { setTab(v); setSelected(null); }} sx={{ borderBottom: `1px solid ${tokens.border}`, mb: 3 }}>
          <Tab value="dataFunction" label="データファンクション" />
          <Tab value="externalEntity" label="外部エンティティ" />
        </Tabs>
        <Box sx={{ height: 28, border: `1px solid ${tokens.border}`, borderRadius: '3px', px: 2, display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
          <SearchIcon sx={{ fontSize: 14, color: tokens.textDisabled }} />
          <InputBase autoFocus placeholder="名称で絞り込み" value={q} onChange={(e) => setQ(e.target.value)} sx={{ fontSize: 13, flex: 1 }} inputProps={{ 'aria-label': '名称で絞り込み' }} />
        </Box>
        <Box role="listbox" aria-label="配置する要素" sx={{ border: `1px solid ${tokens.border}`, borderRadius: '3px', maxHeight: 260, overflow: 'auto' }}>
          {filtered.length === 0 && <Typography sx={{ p: 3, color: tokens.textSecondary, fontSize: 12 }}>該当する要素がありません。</Typography>}
          {filtered.map((i) => {
            const isPlaced = placed.has(i.id);
            // 外部エンティティは配置済みでも、入力側・出力側に分けるためにもう 1 つ置ける（FR-DF-18）
            const blocked = isPlaced && !canPlaceMultiple(tab);
            return (
              <ButtonBase
                key={i.id}
                role="option"
                aria-selected={selected === i.id}
                disabled={blocked}
                onClick={() => setSelected(i.id)}
                onDoubleClick={() => submit(i.id)}
                sx={{
                  width: '100%', height: 36, justifyContent: 'flex-start', gap: 2, px: 3, borderBottom: `1px solid ${tokens.border}`,
                  '&:last-child': { borderBottom: 0 }, background: selected === i.id ? tokens.primarySoft : undefined,
                  '&:hover': { background: selected === i.id ? tokens.primarySoft : '#F8F9FB' },
                  '&.Mui-disabled': { color: tokens.textDisabled },
                }}
              >
                <KindBadge kind={i.badge} />
                <span>{i.name}</span>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: i.warn ? tokens.warning : tokens.textSecondary }}>
                  {i.meta}{isPlaced ? (blocked ? ' ・ 配置済み' : ' ・ 配置済み（もう 1 つ置く）') : ''}
                </span>
              </ButtonBase>
            );
          })}
        </Box>
        {tab === 'dataFunction' && (
          <Typography sx={{ fontSize: 12, color: tokens.textSecondary, mt: 2 }}>参照として配置した要素の FP は所有機能にのみ計上されます。</Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 6, pb: 4 }}>
        <Button onClick={onClose}>キャンセル</Button>
        <Button variant="contained" disabled={!selected} onClick={() => submit()}>配置</Button>
      </DialogActions>
    </Dialog>
  );
}
