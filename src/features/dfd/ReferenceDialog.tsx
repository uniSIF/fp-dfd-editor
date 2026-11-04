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
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { canPlaceMultiple } from '../../domain/dfdRules';
import { softwareIdOfFeature } from '../../domain/queries';
import type { Complexity, DataFunctionKind, Id, TransactionKind } from '../../domain/types';
import { useStore } from '../../store';
import { tokens } from '../app/theme';
import { ellipsis } from '../common/ellipsis';
import { KindBadge } from '../common/KindBadge';
import type { AddRequest } from './AddFunctionDialog';

type RefTab = 'dataFunction' | 'transactionFunction' | 'externalEntity';
const ADD_KIND = { dataFunction: 'DF', transactionFunction: 'TF', externalEntity: 'EE' } as const;

interface Item {
  id: Id;
  name: string;
  badge: DataFunctionKind | TransactionKind | 'EE';
  meta: string;
  warn: boolean;
  kind: DataFunctionKind | TransactionKind | null;
  complexity: Complexity | null;
  description: string;
}

/**
 * 既存のデータファンクション・外部エンティティを参照配置する（FR-DF-03、FR-FN-04）。
 * 「複製して配置」では、選んだ要素（トランザクションファンクションも可）の内容を初期値にした複製ダイアログを開き、別の ID で追加する（FR-DF-21）。
 */
export function ReferenceDialog({ featureId, position, onClose, onDuplicate }: {
  featureId: Id;
  position?: { x: number; y: number };
  onClose: () => void;
  /** 複製ダイアログを開く。未指定なら「複製して配置」を出さない */
  onDuplicate?: (request: AddRequest) => void;
}) {
  const doc = useStore((s) => s.doc);
  const [mode, setMode] = useState<'reference' | 'duplicate'>('reference');
  const [tab, setTab] = useState<RefTab>('dataFunction');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Id | null>(null);
  const swId = softwareIdOfFeature(doc, featureId);
  const duplicating = mode === 'duplicate';
  const placed = new Set(doc.features[featureId]?.dfd.nodes.filter((n) => n.refType === tab).map((n) => n.refId));

  const items: Item[] =
    tab === 'dataFunction'
      ? Object.values(doc.dataFunctions)
          .filter((d) => d.softwareId === swId)
          .sort((a, b) => a.displayNo.localeCompare(b.displayNo))
          .map((d) => ({
            id: d.id, name: d.name, badge: d.kind, kind: d.kind, complexity: d.complexity, description: d.description,
            meta: d.ownerFeatureId ? `所有: ${doc.features[d.ownerFeatureId]?.name ?? ''}` : '所有: 未設定',
            warn: d.ownerFeatureId === null,
          }))
      : tab === 'transactionFunction'
        ? Object.values(doc.transactionFunctions)
            .filter((t) => softwareIdOfFeature(doc, t.featureId) === swId)
            .sort((a, b) => a.displayNo.localeCompare(b.displayNo))
            .map((t) => ({
              id: t.id, name: t.name, badge: t.kind, kind: t.kind, complexity: t.complexity, description: t.description,
              meta: `所属: ${doc.features[t.featureId]?.name ?? ''}`, warn: false,
            }))
        : Object.values(doc.externalEntities)
            .filter((e) => e.softwareId === swId)
            .sort((a, b) => a.displayNo.localeCompare(b.displayNo))
            .map((e) => ({ id: e.id, name: e.name, badge: 'EE' as const, kind: null, complexity: null, description: e.description, meta: e.displayNo, warn: false }));
  const filtered = items.filter((i) => i.name.includes(q.trim()));

  const submit = (id: Id | null = selected) => {
    if (!id) return;
    if (duplicating) {
      const i = items.find((x) => x.id === id);
      if (!i || !onDuplicate) return;
      onClose();
      onDuplicate({ kind: ADD_KIND[tab], position, duplicateOf: { name: i.name, kind: i.kind, complexity: i.complexity, description: i.description } });
      return;
    }
    const r = useStore.getState().placeNode(featureId, tab as 'dataFunction' | 'externalEntity', id, position);
    if (!r.ok) useStore.getState().notify(r.reason, 'error');
    onClose();
  };

  const changeMode = (m: 'reference' | 'duplicate') => {
    setMode(m);
    setSelected(null);
    // トランザクションファンクションは参照配置できないため、参照に戻したらデータファンクションのタブへ
    if (m === 'reference' && tab === 'transactionFunction') setTab('dataFunction');
  };

  return (
    <Dialog open onClose={onClose} maxWidth={false} slotProps={{ paper: { sx: { width: 560 } } }}>
      <DialogTitle>既存の要素をこの DFD に配置</DialogTitle>
      <DialogContent>
        {onDuplicate && (
          <ToggleButtonGroup exclusive fullWidth size="small" value={mode} onChange={(_, v) => v && changeMode(v)} aria-label="配置のしかた" sx={{ mb: 1 }}>
            <ToggleButton value="reference">参照として配置</ToggleButton>
            <ToggleButton value="duplicate">複製して配置（別の ID）</ToggleButton>
          </ToggleButtonGroup>
        )}
        <Typography sx={{ fontSize: 12, color: tokens.textSecondary, mb: 1 }}>
          {duplicating
            ? '選んだ要素の内容をコピーして、新しい番号の要素として追加します。次の画面で名称などを変えられます。'
            : '同じ要素をこの DFD にも置きます。名称などの変更は、配置したすべての DFD に反映されます。'}
        </Typography>
        <Tabs value={tab} onChange={(_, v) => { setTab(v); setSelected(null); }} sx={{ borderBottom: `1px solid ${tokens.border}`, mb: 3 }}>
          <Tab value="dataFunction" label="データファンクション" />
          {duplicating && <Tab value="transactionFunction" label="トランザクション" />}
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
            // 外部エンティティは配置済みでも、入力側・出力側に分けるためにもう 1 つ置ける（FR-DF-18）。複製は常に置ける
            const blocked = !duplicating && isPlaced && !canPlaceMultiple(tab);
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
                <span style={ellipsis({ flex: 1 })} title={i.name}>{i.name}</span>
                <span style={ellipsis({ maxWidth: '45%', fontSize: 12, color: i.warn ? tokens.warning : tokens.textSecondary })} title={i.meta}>{i.meta}</span>
                {isPlaced && !duplicating && (
                  <span
                    title={blocked ? 'この DFD に配置済みです' : 'この DFD に配置済みです。入力側と出力側に分けるため、もう 1 つ置けます'}
                    style={{ flexShrink: 0, fontSize: 11, lineHeight: '16px', padding: '0 6px', borderRadius: 8, whiteSpace: 'nowrap', color: tokens.textSecondary, border: `1px solid ${tokens.border}` }}
                  >
                    {blocked ? '配置済み' : '配置済み・追加可'}
                  </span>
                )}
              </ButtonBase>
            );
          })}
        </Box>
        {tab === 'dataFunction' && (
          <Typography sx={{ fontSize: 12, color: tokens.textSecondary, mt: 2 }}>
            {duplicating ? '複製したデータファンクションはこの機能の所有になり、この機能に FP を計上します。' : '参照として配置した要素の FP は所有機能にのみ計上されます。'}
          </Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 6, pb: 4 }}>
        <Button onClick={onClose}>キャンセル</Button>
        <Button variant="contained" disabled={!selected} onClick={() => submit()}>{duplicating ? '複製…' : '配置'}</Button>
      </DialogActions>
    </Dialog>
  );
}
