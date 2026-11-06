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
import { useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { featurePlanHasChanges, parseExchange, planHasChanges, planImport, type FeaturePlan, type ImportPlan } from '../../domain/exchange';
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
 * AI エージェント（Copilot）が返した JSON を取り込む（FR-IO-02、FR-IO-04）。
 * 貼り付けた内容から機能ごとの差分を計算し、新しい分類・機能・要素と変更・削除を確認してから 1 履歴で反映する。
 */
export function AgentImportDialog({ softwareId, onClose }: { softwareId: Id; onClose: () => void }) {
  const doc = useStore((s) => s.doc);
  const [text, setText] = useState('');
  const [removeMissing, setRemoveMissing] = useState(true);
  const [layout, setLayout] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  // ドラッグ中の表示。子要素に入るたびに dragenter / dragleave が来るので回数で数える
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const parsed = useMemo(() => (text.trim() ? parseExchange(text) : null), [text]);
  const plan = useMemo<ImportPlan | null>(
    () => (parsed?.ok ? planImport(doc, softwareId, parsed.data, { removeMissing }) : null),
    [doc, softwareId, parsed, removeMissing],
  );
  const sw = doc.softwares[softwareId];
  if (!sw) return null;

  /** ファイルの中身を貼り付け欄に読み込む（ファイル選択・ドラッグ＆ドロップ共通） */
  const loadFile = (f: File) => {
    setFileError(null);
    const textLike = /\.(json|txt|md)$/i.test(f.name) || f.type.startsWith('text/') || f.type === 'application/json';
    if (!textLike) {
      setFileError(`「${f.name}」は読み込めません。Copilot が出力した JSON（.json・.txt・.md）のファイルを選んでください。`);
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      setFileError(`「${f.name}」は大きすぎます（5 MB まで）。`);
      return;
    }
    void f.text().then((t) => {
      setText(t);
      setFileName(f.name);
    });
  };
  const hasFiles = (e: DragEvent) => [...e.dataTransfer.types].includes('Files');
  /** ダイアログを開いている間は、画面のどこに落としても受け取る（ブラウザがファイルを開いてしまわないように） */
  const dropHandlers = {
    onDragEnter: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    },
    onDragOver: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) loadFile(f);
    },
  };
  const canApply = !!plan && !plan.errors.length && planHasChanges(plan);
  const newFeatures = plan?.features.filter((f) => !f.featureId).length ?? 0;

  const submit = () => {
    if (!plan) return;
    const s = useStore.getState();
    const r = s.applyImportPlan(softwareId, plan, { layout });
    if (!r.ok) {
      s.notify(r.reason, 'error');
      return;
    }
    // 変更のあった最初の機能を開く
    const first = plan.features.findIndex(featurePlanHasChanges);
    if (first >= 0) s.selectFeature(r.featureIds[first]);
    s.setActiveTab('dfd');
    s.notify(`Copilot の出力を取り込みました（機能 ${plan.features.length} 件${newFeatures ? `・うち新しい機能 ${newFeatures} 件` : ''}・新しい要素 ${r.created} 件）`, 'success');
    onClose();
  };

  return (
    <Dialog open onClose={onClose} maxWidth={false} slotProps={{ paper: { sx: { width: 720, position: 'relative' } } }} {...dropHandlers}>
      {dragging && (
        <Box
          data-testid="agent-import-dropzone"
          sx={{
            position: 'absolute', inset: 8, zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
            border: `2px dashed ${tokens.primary}`, borderRadius: '6px', background: 'rgba(230, 238, 250, 0.92)', color: tokens.primary, fontSize: 14, fontWeight: 600,
          }}
        >
          ここにファイルをドロップして読み込む
        </Box>
      )}
      <DialogTitle>Copilot の出力を取り込む（{sw.name}）</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'flex-end', mb: '2px' }}>
            <Typography component="div" sx={{ fontSize: 12, color: tokens.textSecondary, flex: 1 }}>
              エージェントの返答を貼り付けるか、JSON ファイルをここにドラッグ＆ドロップします（説明文が混ざっていても、JSON のコードブロックだけを読みます）
            </Typography>
            <Button size="small" onClick={() => fileRef.current?.click()}>ファイルから読み込む…</Button>
            <input
              ref={fileRef} type="file" accept=".json,.txt,.md,application/json,text/plain" hidden data-testid="agent-import-file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) loadFile(f);
                e.target.value = '';
              }}
            />
          </Box>
          <TextField
            autoFocus fullWidth multiline minRows={4} maxRows={8} value={text} onChange={(e) => { setText(e.target.value); setFileName(null); }}
            placeholder={'```json\n{ "format": "fp-dfd-exchange", "features": [ ... ] }\n```'}
            slotProps={{ htmlInput: { 'aria-label': 'エージェントの返答', style: { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 } } }}
          />
        </Box>

        {fileName && !fileError && (
          <Typography sx={{ fontSize: 12, color: tokens.textSecondary, mt: -2 }}>ファイル「{fileName}」を読み込みました。</Typography>
        )}
        {fileError && <Notice tone="error">{fileError}</Notice>}
        {parsed && !parsed.ok && <Notice tone="error">{parsed.message}</Notice>}
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
            <Box role="list" aria-label="取り込む変更" sx={{ border: `1px solid ${tokens.border}`, borderRadius: '3px', maxHeight: 300, overflow: 'auto' }}>
              {plan.newCategories.map((c) => (
                <Row key={`cat:${c.category1}/${c.category2}`} tag="追加" color={tokens.primary} label={c.newCategory1 ? '大分類・中分類' : '中分類'} text={`${c.category1} / ${c.category2}`} />
              ))}
              {plan.updates.map((u) => <Row key={`u:${u.key}`} tag="変更" color={tokens.warning} label={`${TYPE_LABELS[u.refType]} ${u.key}`} text={u.changes.join('、')} />)}
              {plan.features.map((f) => <FeatureRows key={f.key} plan={plan} f={f} />)}
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
            label={<span style={{ fontSize: 13 }}>既存の機能の DFD を出力の内容で上書きする（出力にない要素とデータフローを削除する。その機能のトランザクション・非計上プロセス・所有するデータファンクションは削除、ほかは DFD から外す。外すと追加と変更だけを行う）</span>}
          />
          <FormControlLabel
            control={<Checkbox size="small" checked={layout} onChange={(e) => setLayout(e.target.checked)} />}
            label={<span style={{ fontSize: 13 }}>取り込んだあとに、変更した機能の DFD を自動整列する</span>}
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

/** 機能ごとの変更（見出し行と、その下の要素・データフロー） */
function FeatureRows({ plan, f }: { plan: ImportPlan; f: FeaturePlan }) {
  const changed = featurePlanHasChanges(f);
  const creates = plan.creates.filter((c) => f.createKeys.includes(c.key));
  return (
    <>
      <Box role="listitem" sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 3, minHeight: 32, background: tokens.headerBg, borderBottom: `1px solid ${tokens.border}`, fontSize: 13, fontWeight: 600 }}>
        <span style={ellipsis({ flex: 1 })} title={`${f.category1} / ${f.category2} / ${f.name}`}>
          <span style={{ fontWeight: 400, fontSize: 12, color: tokens.textSecondary }}>{f.category1} / {f.category2} / </span>{f.name}
        </span>
        <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, color: f.featureId ? (changed ? tokens.warning : tokens.textSecondary) : tokens.primary }}>
          {f.featureId ? (changed ? '既存の機能を変更' : '変更なし') : '新しい機能'}
        </span>
      </Box>
      {f.featureChanges.map((c) => <Row key={`fc:${c}`} tag={f.featureId ? '変更' : '設定'} color={f.featureId ? tokens.warning : tokens.primary} label="機能" text={c} />)}
      {creates.map((c) => <Row key={`c:${c.key}`} tag="追加" color={tokens.primary} label={`${TYPE_LABELS[c.refType]}${c.kind ? `（${c.kind}）` : ''}`} text={c.name} />)}
      {f.places.map((p) => <Row key={`p:${p.key}`} tag="配置" color={tokens.primary} label={`${TYPE_LABELS[p.refType]} ${p.key}`} text={`${p.name}（既存の要素を参照）`} />)}
      {f.splitKeys.map((k) => <Row key={`s:${k}`} tag="配置" color={tokens.primary} label={`外部エンティティ ${k}`} text="入力側（左）と出力側（右）の 2 か所に分けて置く" />)}
      {f.edgeAdds.map((e, i) => <Row key={`ea:${i}`} tag="追加" color={tokens.primary} label="データフロー" text={`${e.from} → ${e.to}${e.label ? `「${e.label}」` : ''}`} />)}
      {f.edgeLabelUpdates.map((e) => <Row key={`el:${e.edgeId}`} tag="変更" color={tokens.warning} label="データフロー" text={`${e.from} → ${e.to}: 「${e.before}」→「${e.label}」`} />)}
      {f.removals.map((r) => <Row key={`r:${r.key}`} tag={r.mode === 'delete' ? '削除' : '外す'} color={tokens.error} label={`${TYPE_LABELS[r.refType]} ${r.key}`} text={r.name} />)}
      {f.edgeRemovals.map((e) => <Row key={`er:${e.edgeId}`} tag="削除" color={tokens.error} label="データフロー" text={`${e.from} → ${e.to}${e.label ? `「${e.label}」` : ''}`} />)}
    </>
  );
}

function Row({ tag, color, label, text }: { tag: string; color: string; label: string; text: string }) {
  return (
    <Box role="listitem" sx={{ display: 'grid', gridTemplateColumns: '44px 190px minmax(0, 1fr)', alignItems: 'center', gap: 2, px: 3, minHeight: 32, borderBottom: `1px solid ${tokens.border}`, '&:last-child': { borderBottom: 0 }, fontSize: 13 }}>
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
