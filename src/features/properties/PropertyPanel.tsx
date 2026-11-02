import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import { COMPLEXITIES, COMPLEXITY_LABELS, FP_WEIGHTS } from '../../domain/fpTables';
import { featurePathLabel, featuresInOrder, refName, softwareIdOfFeature } from '../../domain/queries';
import type { Complexity, FpDocument, Id } from '../../domain/types';
import { useStore } from '../../store';
import { selectDfdNodes, selectFeatureResult, selectWarnings } from '../../store/selectors';
import { requestDeleteSelection } from '../app/commands';
import { tokens } from '../app/theme';
import { CommitTextField } from '../common/CommitTextField';
import { formatNumber } from '../common/format';
import { KindBadge } from '../common/KindBadge';
import { WarningIcon } from '../common/WarningIcon';
import { nodeSize } from '../../domain/dfdGeometry';
import { CharacteristicsEditor } from '../functions/CharacteristicsEditor';
import { ConnectDialog } from '../functions/ConnectDialog';
import { useState } from 'react';

/** プロパティパネル（ui-design.md 4.7） */
export function PropertyPanel() {
  const doc = useStore((s) => s.doc);
  const featureId = useStore((s) => s.selectedFeatureId);
  const target = useStore((s) => s.propertyTarget);
  const nodeIds = useStore((s) => s.selectedNodeIds);
  const edgeId = useStore((s) => s.selectedEdgeId);
  const feature = featureId ? doc.features[featureId] : null;

  if (!feature || !featureId) {
    return (
      <Box sx={{ p: 4, color: tokens.textSecondary, fontSize: 13 }}>機能を選ぶと、ここにプロパティが表示されます。</Box>
    );
  }
  const validNodes = nodeIds.filter((id) => feature.dfd.nodes.some((n) => n.id === id));
  const edge = edgeId ? feature.dfd.edges.find((e) => e.id === edgeId) : undefined;
  if (target === 'node' && validNodes.length === 1) return <NodeProperties doc={doc} featureId={featureId} nodeId={validNodes[0]} />;
  if (target === 'node' && validNodes.length > 1) {
    return (
      <Panel header={<span style={{ fontWeight: 600 }}>{validNodes.length} 件を選択中</span>} featureId={featureId}>
        <Section>
          <Button variant="outlined" color="error" onClick={requestDeleteSelection}>選択した要素を削除…</Button>
        </Section>
      </Panel>
    );
  }
  if (target === 'node' && edge) {
    const nodes = feature.dfd.nodes;
    const name = (id: Id) => {
      const n = nodes.find((x) => x.id === id);
      return n ? refName(doc, n.refType, n.refId) : '';
    };
    return (
      <Panel header={<span style={{ fontWeight: 600 }}>データフロー</span>} featureId={featureId}>
        <Section title="基本">
          <Field label="ラベル（流れるデータの名称）">
            <CommitTextField fullWidth value={edge.label} onCommit={(v) => useStore.getState().updateEdgeLabel(featureId, edge.id, v.trim())} slotProps={{ htmlInput: { 'aria-label': 'ラベル' } }} />
          </Field>
          <Field label="入力元 → 出力先">
            <Typography>{name(edge.sourceNodeId)} → {name(edge.targetNodeId)}</Typography>
          </Field>
        </Section>
        <Section>
          <Button variant="outlined" color="error" onClick={() => useStore.getState().removeEdges(featureId, [edge.id])}>データフローを削除</Button>
        </Section>
      </Panel>
    );
  }
  // 機能のプロパティ表示中でも選択が残っていれば、見出しから選択中の要素へ戻れるようにする
  let backLabel: string | undefined;
  if (validNodes.length === 1) {
    const n = feature.dfd.nodes.find((x) => x.id === validNodes[0])!;
    backLabel = refName(doc, n.refType, n.refId) || '選択中の要素';
  } else if (validNodes.length > 1) {
    backLabel = `選択中の ${validNodes.length} 件`;
  } else if (edge) {
    backLabel = edge.label ? `データフロー「${edge.label}」` : 'データフロー';
  }
  return <FeatureProperties doc={doc} featureId={featureId} backLabel={backLabel} />;
}

function Panel({ header, featureId, backLabel, children }: { header: ReactNode; featureId: Id; backLabel?: string; children: ReactNode }) {
  const target = useStore((s) => s.propertyTarget);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box sx={{ height: 40, px: 3, display: 'flex', alignItems: 'center', gap: 2, borderBottom: `1px solid ${tokens.border}`, flex: 'none', minWidth: 0, whiteSpace: 'nowrap', '& > span': { flex: 'none' }, '& > span:last-of-type': { flex: '0 1 auto', overflow: 'hidden', textOverflow: 'ellipsis' } }}>
        {header}
        {target === 'node' && featureId && (
          <Link component="button" sx={{ ml: 'auto', fontSize: 12, whiteSpace: 'nowrap' }} onClick={() => useStore.getState().setPropertyTarget('feature')}>機能のプロパティ</Link>
        )}
        {target === 'feature' && backLabel && (
          <Link
            component="button"
            title={`${backLabel} のプロパティに戻る`}
            aria-label={`${backLabel} のプロパティに戻る`}
            sx={{ ml: 'auto', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160, flex: '0 1 auto' }}
            onClick={() => useStore.getState().setPropertyTarget('node')}
          >
            ◀ {backLabel}
          </Link>
        )}
      </Box>
      <Box sx={{ overflow: 'auto', px: 3, pb: 4, flex: 1 }}>{children}</Box>
    </Box>
  );
}

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <Box sx={{ py: 3, borderBottom: `1px solid ${tokens.border}`, '&:last-child': { borderBottom: 0 } }}>
      {title && <Typography component="h3" sx={{ fontSize: 12, fontWeight: 600, color: tokens.textSecondary, mb: 2 }}>{title}</Typography>}
      {children}
    </Box>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ mb: 2 }}>
      <Typography component="div" sx={{ fontSize: 12, color: tokens.textSecondary, mb: '2px' }}>{label}</Typography>
      {children}
    </Box>
  );
}

function WarningBox({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ background: tokens.warningSoft, borderLeft: `3px solid ${tokens.warning}`, p: '8px 12px', fontSize: 12, display: 'flex', gap: 2, mt: 3 }}>
      <Box sx={{ mt: '2px' }}><WarningIcon size={12} /></Box>
      <div>{children}</div>
    </Box>
  );
}

function ReadOnly({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ minHeight: 28, border: `1px solid ${tokens.border}`, borderRadius: '3px', px: 2, display: 'flex', alignItems: 'center', background: tokens.headerBg, color: tokens.textSecondary }}>
      {children}
    </Box>
  );
}

function NodeProperties({ doc, featureId, nodeId }: { doc: FpDocument; featureId: Id; nodeId: Id }) {
  const view = selectDfdNodes(doc, featureId).find((v) => v.nodeId === nodeId);
  const [connecting, setConnecting] = useState(false);
  const s = useStore.getState();
  if (!view) return null;
  const feature = doc.features[featureId];
  const { refType, refId } = view;
  const update = (patch: { name?: string; description?: string; kind?: string; complexity?: Complexity; ownerFeatureId?: Id | null }) => {
    if (refType === 'dataFunction') s.updateDataFunction(refId, patch as Parameters<typeof s.updateDataFunction>[1]);
    else if (refType === 'transactionFunction') s.updateTransactionFunction(refId, patch as Parameters<typeof s.updateTransactionFunction>[1]);
    else if (refType === 'nonCountedProcess') s.updateNonCountedProcess(refId, { name: patch.name, description: patch.description });
    else s.updateExternalEntity(refId, { name: patch.name, description: patch.description });
  };
  const header =
    refType === 'nonCountedProcess' ? <><KindBadge kind="NCP" /><span style={{ fontWeight: 600 }}>非計上プロセス</span></>
      : refType === 'externalEntity' ? <><KindBadge kind="EE" /><span style={{ color: tokens.textSecondary }}>{view.displayNo}</span><span style={{ fontWeight: 600 }}>外部エンティティ</span></>
      : <><KindBadge kind={view.kind!} /><span style={{ color: tokens.textSecondary }}>{view.displayNo}</span><span style={{ fontWeight: 600 }}>{refType === 'dataFunction' ? 'データ' : 'トランザクション'}</span></>;
  const connections = feature.dfd.edges.filter((e) => e.sourceNodeId === nodeId || e.targetNodeId === nodeId);
  const other = (e: (typeof connections)[number]) => feature.dfd.nodes.find((n) => n.id === (e.sourceNodeId === nodeId ? e.targetNodeId : e.sourceNodeId));
  const df = refType === 'dataFunction' ? doc.dataFunctions[refId] : null;
  const readonly = view.isReference;
  const result = selectFeatureResult(doc, featureId);

  return (
    <Panel header={header} featureId={featureId}>
      {view.warning && (
        <WarningBox>
          {view.warning === '未接続' ? 'このノードはどこにも接続されていません。データフローでつなぐか、不要なら削除します。' : 'このデータファンクションの所有機能が未設定です。FP がどの機能にも計上されていません。'}
        </WarningBox>
      )}
      <Section title="基本">
        <Field label="名称">
          <CommitTextField fullWidth required value={view.name} onCommit={(v) => update({ name: v.trim() })} disabled={readonly} slotProps={{ htmlInput: { 'aria-label': '名称' } }} />
        </Field>
        {view.kind && (
          <Field label="種別">
            <ToggleButtonGroup exclusive fullWidth size="small" value={view.kind} disabled={readonly} onChange={(_, v) => v && update({ kind: v })} aria-label="種別">
              {(refType === 'dataFunction' ? ['ILF', 'EIF'] : ['EI', 'EO', 'EQ']).map((k) => <ToggleButton key={k} value={k}>{k}</ToggleButton>)}
            </ToggleButtonGroup>
          </Field>
        )}
        {view.complexity && (
          <Field label="複雑度">
            <ToggleButtonGroup exclusive fullWidth size="small" value={view.complexity} disabled={readonly} onChange={(_, v) => v && update({ complexity: v })} aria-label="複雑度">
              {COMPLEXITIES.map((c) => <ToggleButton key={c} value={c}>{COMPLEXITY_LABELS[c]}</ToggleButton>)}
            </ToggleButtonGroup>
          </Field>
        )}
        {view.kind && view.complexity && (
          <Field label="FP">
            <ReadOnly>
              {view.isReference ? `この機能には計上されません（所有: ${view.ownerName}）` : `${FP_WEIGHTS[view.kind][view.complexity]}（${view.kind}・${COMPLEXITY_LABELS[view.complexity]}）`}
            </ReadOnly>
          </Field>
        )}
      </Section>
      <Section title="説明">
        <CommitTextField
          fullWidth multiline minRows={2} maxRows={6} value={view.description} onCommit={(v) => update({ description: v })}
          placeholder={refType === 'externalEntity' ? 'この外部エンティティの役割や補足' : 'このファンクションを配置した理由や補足'}
          slotProps={{ htmlInput: { 'aria-label': '説明' } }}
        />
      </Section>
      <Section title={refType === 'dataFunction' ? '所有' : refType === 'externalEntity' ? '配置先' : '所属'}>
        {df ? (
          <Field label="所有機能（FP を計上する機能）">
            <Select
              fullWidth value={df.ownerFeatureId ?? ''} displayEmpty
              onChange={(e) => s.updateDataFunction(df.id, { ownerFeatureId: (e.target.value as string) || null })}
              sx={{ height: 28 }} inputProps={{ 'aria-label': '所有機能' }}
            >
              <MenuItem value="" dense>未設定</MenuItem>
              {featuresInOrder(doc, df.softwareId).map((f) => <MenuItem key={f.id} value={f.id} dense>{featurePathLabel(doc, f.id)}</MenuItem>)}
            </Select>
          </Field>
        ) : (
          <Field label="機能"><ReadOnly>{featurePathLabel(doc, featureId)}</ReadOnly></Field>
        )}
      </Section>
      <Section title="接続">
        {connections.length === 0 && <Typography sx={{ color: tokens.textSecondary, fontSize: 12 }}>接続はありません。</Typography>}
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {connections.map((e) => {
            const o = other(e);
            if (!o) return null;
            return (
              <Box component="li" key={e.id} sx={{ height: 28, display: 'flex', alignItems: 'center', gap: 2 }}>
                <span style={{ color: tokens.textDisabled, width: 14, textAlign: 'center' }}>{e.sourceNodeId === nodeId ? '→' : '←'}</span>
                <Link component="button" onClick={() => s.setSelection([o.id], null)}>{refName(doc, o.refType, o.refId)}</Link>
                {e.label && <span style={{ fontSize: 12, color: tokens.textSecondary }}>{e.label}</span>}
              </Box>
            );
          })}
        </Box>
        <Button size="small" sx={{ mt: 1, ml: -1 }} onClick={() => setConnecting(true)}>＋ 接続を追加</Button>
        {refType === 'externalEntity' && (
          <Box sx={{ mt: 2, pt: 2, borderTop: `1px dashed ${tokens.border}` }}>
            <Typography sx={{ fontSize: 12, color: tokens.textSecondary, mb: 1 }}>
              入力元と出力先を別のノードに分けると、矢印を戻さずに左から右へ一方向に描けます。
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <Button
                variant="outlined"
                color="inherit"
                sx={{ borderColor: tokens.borderStrong }}
                disabled={!connections.some((e) => e.sourceNodeId === nodeId) || !connections.some((e) => e.targetNodeId === nodeId)}
                title="このノードへ入ってくるデータフローを、右端に置く同じ外部エンティティへ付け替えます"
                onClick={() => {
                  const st = useStore.getState();
                  const r = st.splitExternalEntityNode(featureId, nodeId);
                  if (!r.ok) st.notify(r.reason, 'error');
                  else st.notify('入力側と出力側に分けました', 'success');
                }}
              >
                入力側と出力側に分ける
              </Button>
              <Button
                color="inherit"
                onClick={() => {
                  const st = useStore.getState();
                  const right = Math.max(...feature.dfd.nodes.map((n) => n.x + nodeSize(n.refType).width));
                  const self = feature.dfd.nodes.find((n) => n.id === nodeId)!;
                  const r = st.placeNode(featureId, 'externalEntity', refId, { x: right + 80, y: self.y });
                  if (r.ok && r.id) st.setSelection([r.id], null);
                }}
              >
                もう 1 つ配置
              </Button>
            </Box>
            {view.duplicate && (
              <Typography sx={{ fontSize: 11, color: tokens.textSecondary, mt: 1 }}>
                この外部エンティティはこの DFD に複数配置されています（左上の斜線が印）。
              </Typography>
            )}
          </Box>
        )}
        {connecting && <ConnectDialog featureId={featureId} from={{ refType, refId }} onClose={() => setConnecting(false)} />}
      </Section>
      {result && <ResultSection doc={doc} featureId={featureId} />}
      <Section>
        <Button variant="outlined" color="error" onClick={requestDeleteSelection}>削除…</Button>
      </Section>
    </Panel>
  );
}

function ResultSection({ doc, featureId }: { doc: FpDocument; featureId: Id }) {
  const r = selectFeatureResult(doc, featureId);
  if (!r) return null;
  const vendor = r.vendorId ? doc.vendors[r.vendorId]?.name : '未選択';
  const rows: [string, string][] = [
    ['未調整FP', String(r.unadjustedFp)],
    ['調整係数', r.vaf.toFixed(2)],
    ['調整済FP', String(r.adjustedFp)],
    ['開発工数', `${formatNumber(r.effortHours)} H`],
    [`社内 / 外注（${vendor}）`, `${formatNumber(r.inHouseHours)} H / ${formatNumber(r.outsourceHours)} H`],
  ];
  return (
    <Section title="機能の計算結果">
      <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 12px', fontSize: 12, m: 0, fontVariantNumeric: 'tabular-nums' }}>
        {rows.map(([k, v]) => (
          <Box key={k} sx={{ display: 'contents' }}>
            <Box component="dt" sx={{ color: tokens.textSecondary }}>{k}</Box>
            <Box component="dd" sx={{ m: 0, textAlign: 'right' }}>{v}</Box>
          </Box>
        ))}
        <Box component="dt" sx={{ fontWeight: 600, fontSize: 13, borderTop: `1px solid ${tokens.border}`, pt: 1 }}>開発単価</Box>
        <Box component="dd" sx={{ m: 0, textAlign: 'right', fontWeight: 600, fontSize: 13, borderTop: `1px solid ${tokens.border}`, pt: 1 }}>{formatNumber(r.cost)} 円</Box>
      </Box>
    </Section>
  );
}

function FeatureProperties({ doc, featureId, backLabel }: { doc: FpDocument; featureId: Id; backLabel?: string }) {
  const f = doc.features[featureId];
  const s = useStore.getState();
  const swId = softwareIdOfFeature(doc, featureId);
  const sw = swId ? doc.softwares[swId] : null;
  const warnings = swId ? selectWarnings(doc, swId).filter((w) => w.featureId === featureId) : [];
  return (
    <Panel header={<span style={{ fontWeight: 600 }}>機能のプロパティ</span>} featureId={featureId} backLabel={backLabel}>
      {warnings.length > 0 && (
        <WarningBox>
          {warnings.map((w, i) => <div key={i}>{w.message}</div>)}
        </WarningBox>
      )}
      <Section title="基本">
        <Field label="名称">
          <CommitTextField fullWidth required value={f.name} onCommit={(v) => s.updateFeature(featureId, { name: v.trim() })} slotProps={{ htmlInput: { 'aria-label': '機能名' } }} />
        </Field>
        <Field label="開発区分">
          <ToggleButtonGroup exclusive fullWidth size="small" value={f.devType} onChange={(_, v) => v && s.updateFeature(featureId, { devType: v })} aria-label="開発区分">
            <ToggleButton value="new">新規</ToggleButton>
            <ToggleButton value="modification">改修</ToggleButton>
          </ToggleButtonGroup>
        </Field>
        <Field label="外注業者">
          <Select fullWidth value={f.vendorId ?? ''} displayEmpty onChange={(e) => s.updateFeature(featureId, { vendorId: (e.target.value as string) || null })} sx={{ height: 28 }} inputProps={{ 'aria-label': '外注業者' }}>
            <MenuItem value="" dense>未選択</MenuItem>
            {sw?.vendorIds.map((id) => <MenuItem key={id} value={id} dense>{doc.vendors[id]?.name}</MenuItem>)}
          </Select>
        </Field>
      </Section>
      <Section title="説明">
        <CommitTextField fullWidth multiline minRows={2} maxRows={6} value={f.description} onCommit={(v) => s.updateFeature(featureId, { description: v })} placeholder="この機能の概要" slotProps={{ htmlInput: { 'aria-label': '機能の説明' } }} />
      </Section>
      <Section title="システム特性 C1〜C14">
        <Box sx={{ '& > div': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr)) !important' } }}>
          <CharacteristicsEditor value={f.characteristics} onChange={(v) => s.updateFeature(featureId, { characteristics: v })} />
        </Box>
        <Button variant="outlined" color="inherit" sx={{ mt: 2, borderColor: tokens.borderStrong }} onClick={() => s.resetCharacteristics(featureId)}>既定値で上書き</Button>
      </Section>
      <ResultSection doc={doc} featureId={featureId} />
    </Panel>
  );
}
