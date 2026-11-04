import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { parseExchange, planHasChanges, planImport, type ImportPlan } from '../../domain/exchange';
import { featurePathLabel } from '../../domain/queries';
import type { Id, NodeRefType } from '../../domain/types';
import { useStore } from '../../store';
import { tokens } from '../app/theme';
import { ellipsis } from '../common/ellipsis';
import { WarningIcon } from '../common/WarningIcon';

const TYPE_LABELS: Record<NodeRefType, string> = {
  externalEntity: '外部エンティティ',
  dataFunction: 'データファンクション',
  transactionFunction: 'トランザクション',
  nonCountedProcess: '非計上プロセス',
};

/**
 * AI エージェント（Copilot）が返した JSON を取り込む（FR-IO-02）。
 * 貼り付けた内容から差分を計算し、追加・変更・削除を確認してから 1 履歴で反映する。
 */
export function AgentImportDialog({ featureId, onClose }: { featureId: Id; onClose: () => void }) {
  const doc = useStore((s) => s.doc);
  const [text, setText] = useState('');
  const [removeMissing, setRemoveMissing] = useState(false);
  const [layout, setLayout] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => (text.trim() ? parseExchange(text) : null), [text]);
  const plan = useMemo<ImportPlan | null>(
    () => (parsed?.ok ? planImport(doc, featureId, parsed.data, { removeMissing }) : null),
    [doc, featureId, parsed, removeMissing],
  );
  const feature = doc.features[featureId];
  if (!feature) return null;
  const otherFeature = parsed?.ok && parsed.featureKey && parsed.featureKey !== featureId ? doc.features[parsed.featureKey] : null;
  const canApply = !!plan && !plan.errors.length && planHasChanges(plan);

  const submit = () => {
    if (!plan) return;
    const s = useStore.getState();
    const r = s.applyImportPlan(featureId, plan, { layout });
    if (!r.ok) {
      s.notify(r.reason, 'error');
      return;
    }
    s.setActiveTab('dfd');
    s.notify(`Copilot の出力を取り込みました（追加 ${plan.creates.length + plan.places.length} 件・変更 ${plan.updates.length} 件・データフロー追加 ${plan.edgeAdds.length} 本）`, 'success');
    onClose();
  };

  return (
    <Dialog open onClose={onClose} maxWidth={false} slotProps={{ paper: { sx: { width: 680 } } }}>
      <DialogTitle>Copilot の出力を取り込む（{feature.name}）</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'flex-end', mb: '2px' }}>
            <Typography component="div" sx={{ fontSize: 12, color: tokens.textSecondary, flex: 1 }}>
              エージェントの返答を貼り付けます（説明文が混ざっていても、JSON のコードブロックだけを読みます）
            </Typography>
            <Button size="small" onClick={() => fileRef.current?.click()}>ファイルから読み込む…</Button>
            <input
              ref={fileRef} type="file" accept=".json,.txt,.md,application/json,text/plain" hidden data-testid="agent-import-file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void f.text().then(setText);
                e.target.value = '';
              }}
            />
          </Box>
          <TextField
            autoFocus fullWidth multiline minRows={5} maxRows={10} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={'```json\n{ "format": "fp-dfd-exchange", ... }\n```'}
            slotProps={{ htmlInput: { 'aria-label': 'エージェントの返答', style: { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 } } }}
          />
        </Box>

        {parsed && !parsed.ok && <Notice tone="error">{parsed.message}</Notice>}
        {otherFeature && (
          <Notice tone="warning">この JSON は別の機能「{featurePathLabel(doc, otherFeature.id)}」から書き出したものです。取り込み先は「{feature.name}」です。</Notice>
        )}
        {plan && plan.errors.length > 0 && (
          <Notice tone="error">
            取り込めません。エージェントに次の点を直すよう伝えてください。
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{plan.errors.map((e) => <li key={e}>{e}</li>)}</ul>
          </Notice>
        )}
        {plan && !plan.errors.length && (
          <Box>
            <Typography sx={{ fontSize: 12, color: tokens.textSecondary, mb: 1 }}>
              {planHasChanges(plan) ? '取り込むと、次のように変わります。' : '今の DFD と同じ内容です。取り込む変更はありません。'}
            </Typography>
            <Box role="list" aria-label="取り込む変更" sx={{ border: `1px solid ${tokens.border}`, borderRadius: '3px', maxHeight: 260, overflow: 'auto' }}>
              {plan.creates.map((c) => <Row key={`c:${c.key}`} tag="追加" color={tokens.primary} label={`${TYPE_LABELS[c.refType]}${c.kind ? `（${c.kind}）` : ''}`} text={c.name} />)}
              {plan.places.map((p) => <Row key={`p:${p.key}`} tag="配置" color={tokens.primary} label={`${TYPE_LABELS[p.refType]} ${p.key}`} text={`${p.name}（既存の要素を参照）`} />)}
              {plan.updates.map((u) => <Row key={`u:${u.key}`} tag="変更" color={tokens.warning} label={`${TYPE_LABELS[u.refType]} ${u.key}`} text={u.changes.join('、')} />)}
              {plan.edgeAdds.map((f, i) => <Row key={`ea:${i}`} tag="追加" color={tokens.primary} label="データフロー" text={`${f.from} → ${f.to}${f.label ? `「${f.label}」` : ''}`} />)}
              {plan.edgeLabelUpdates.map((f) => <Row key={`el:${f.edgeId}`} tag="変更" color={tokens.warning} label="データフロー" text={`${f.from} → ${f.to}: 「${f.before}」→「${f.label}」`} />)}
              {plan.removals.map((r) => <Row key={`r:${r.key}`} tag={r.mode === 'delete' ? '削除' : '外す'} color={tokens.error} label={`${TYPE_LABELS[r.refType]} ${r.key}`} text={r.name} />)}
              {plan.edgeRemovals.map((f) => <Row key={`er:${f.edgeId}`} tag="削除" color={tokens.error} label="データフロー" text={`${f.from} → ${f.to}${f.label ? `「${f.label}」` : ''}`} />)}
            </Box>
            {plan.warnings.length > 0 && (
              <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
                {plan.warnings.map((w) => <Notice key={w} tone="warning">{w}</Notice>)}
              </Box>
            )}
          </Box>
        )}

        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          <FormControlLabel
            control={<Checkbox size="small" checked={removeMissing} onChange={(e) => setRemoveMissing(e.target.checked)} />}
            label={<span style={{ fontSize: 13 }}>出力に含まれない要素とデータフローを削除する（この機能のトランザクション・非計上プロセス・所有するデータファンクションは削除、ほかは DFD から外す）</span>}
          />
          <FormControlLabel
            control={<Checkbox size="small" checked={layout} onChange={(e) => setLayout(e.target.checked)} />}
            label={<span style={{ fontSize: 13 }}>取り込んだあとに自動整列する</span>}
          />
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 6, pb: 4 }}>
        <Button onClick={onClose}>キャンセル</Button>
        <Button variant="contained" disabled={!canApply} onClick={submit}>取り込む</Button>
      </DialogActions>
    </Dialog>
  );
}

function Row({ tag, color, label, text }: { tag: string; color: string; label: string; text: string }) {
  return (
    <Box role="listitem" sx={{ display: 'grid', gridTemplateColumns: '44px 150px minmax(0, 1fr)', alignItems: 'center', gap: 2, px: 3, minHeight: 32, borderBottom: `1px solid ${tokens.border}`, '&:last-child': { borderBottom: 0 }, fontSize: 13 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color }}>{tag}</span>
      <span style={ellipsis({ fontSize: 12, color: tokens.textSecondary })} title={label}>{label}</span>
      <span style={ellipsis()} title={text}>{text}</span>
    </Box>
  );
}

function Notice({ tone, children }: { tone: 'error' | 'warning'; children: ReactNode }) {
  const color = tone === 'error' ? tokens.error : tokens.warning;
  return (
    <Box role={tone === 'error' ? 'alert' : undefined} sx={{ borderLeft: `3px solid ${color}`, background: tone === 'error' ? '#FDECEC' : tokens.warningSoft, p: '8px 12px', fontSize: 12, display: 'flex', gap: 2 }}>
      <Box sx={{ mt: '2px', flex: 'none' }}><WarningIcon size={12} /></Box>
      <div>{children}</div>
    </Box>
  );
}
