import { buildCsv, buildLedgerCsv, safeFileName, timestampForFile } from '../../domain/csvExport';
import { emptyDocument } from '../../domain/emptyDocument';
import type { LoadError, Result } from '../../domain/migrations';
import { FP_WEIGHTS, FUNCTION_KIND_LABELS } from '../../domain/fpTables';
import { featuresInOrder, softwareIdOfFeature } from '../../domain/queries';
import { sampleDocument } from '../../domain/sampleDocument';
import { buildDfdSvg } from '../../domain/svgExport';
import type { FpDocument, Id } from '../../domain/types';
import { readBackup } from '../../infra/backup';
import { downloadText } from '../../infra/download';
import { loadFromFile, saveToFile } from '../../infra/fileIo';
import { formatTime } from '../common/format';
import { redo, undo, useStore } from '../../store';
import { selectIsDirty } from '../../store/selectors';

/**
 * UI から呼ぶ操作。確認ダイアログやスナックバーを伴うものをここに集める。
 * ストアのアクションは純粋な状態変更、ここはユーザーとのやりとりを担当する。
 */
const get = () => useStore.getState();

export function saveDocument(): void {
  const s = get();
  const filename = saveToFile(s.doc);
  s.markSaved(s.revision);
  s.notify(`${filename} を保存しました`, 'success');
}

/** 未保存の変更があれば確認してから実行する（FR-SV-06） */
export function confirmIfDirty(title: string, actionLabel: string, run: () => void): void {
  const s = get();
  if (!selectIsDirty(s)) return run();
  s.openConfirm({
    title: '保存していない変更があります',
    message: `${title}と現在の内容は失われます。最終保存: ${formatTime(s.lastSavedAt)}`,
    actions: [
      { label: 'キャンセル' },
      { label: actionLabel, color: 'error', variant: 'contained', onClick: run },
    ],
  });
}

export function applyLoaded(doc: FpDocument, message: string): void {
  const s = get();
  s.loadDocument(doc);
  useStore.temporal.getState().clear();
  const first = doc.project.softwareIds[0];
  const firstFeature = first ? featuresInOrder(doc, first)[0] : undefined;
  if (firstFeature) s.selectFeature(firstFeature.id);
  s.notify(message, 'success');
}

function reportLoadResult(r: Result<FpDocument, LoadError>, okMessage: string): void {
  if (r.ok) applyLoaded(r.value, okMessage);
  else get().notify(r.error.message, 'error');
}

export function newDocument(): void {
  confirmIfDirty('新しいプロジェクトを作成する', '作成', () => {
    applyLoaded(emptyDocument(), '新しいプロジェクトを作成しました');
  });
}

export function openSample(): void {
  confirmIfDirty('サンプルを開く', '開く', () => applyLoaded(sampleDocument(), 'サンプルを開きました'));
}

export function openFile(file: File): void {
  confirmIfDirty('ファイルを読み込む', '読み込む', () => {
    void loadFromFile(file).then((r) => reportLoadResult(r, `${file.name} を読み込みました`));
  });
}

export function openBackup(iso: string): void {
  confirmIfDirty('バックアップを読み込む', '読み込む', () => reportLoadResult(readBackup(iso), 'バックアップを読み込みました'));
}

export function exportCsv(softwareId: Id | null): void {
  const s = get();
  if (!softwareId || !s.doc.softwares[softwareId]) return s.notify('ソフトウェアを選んでください', 'error');
  const sw = s.doc.softwares[softwareId];
  downloadText(`${safeFileName(sw.name)}_${timestampForFile()}.csv`, buildCsv(s.doc, softwareId), 'text/csv;charset=utf-8');
}

export function exportLedgerCsv(softwareId: Id | null): void {
  const s = get();
  if (!softwareId || !s.doc.softwares[softwareId]) return;
  const sw = s.doc.softwares[softwareId];
  downloadText(`${safeFileName(sw.name)}_台帳_${timestampForFile()}.csv`, buildLedgerCsv(s.doc, softwareId), 'text/csv;charset=utf-8');
}

export function exportSvg(featureId: Id | null): void {
  const s = get();
  if (!featureId || !s.doc.features[featureId]) return s.notify('機能を選んでください', 'error');
  const f = s.doc.features[featureId];
  const swId = s.selectedSoftwareId;
  const swName = swId ? s.doc.softwares[swId]?.name ?? '' : '';
  downloadText(`${safeFileName(swName)}_${safeFileName(f.name)}.svg`, buildDfdSvg(s.doc, featureId), 'image/svg+xml');
}

export function doUndo(): void {
  undo();
}

export function doRedo(): void {
  redo();
}

// ---------- DFD の削除・コピー・貼り付け（design.md 6.5、6.8） ----------

export function requestDeleteSelection(): void {
  const s = get();
  const featureId = s.selectedFeatureId;
  if (!featureId) return;
  const f = s.doc.features[featureId];
  if (!f) return;
  const nodes = f.dfd.nodes.filter((n) => s.selectedNodeIds.includes(n.id));
  const edgeIds = s.selectedEdgeId ? [s.selectedEdgeId] : [];
  if (!nodes.length) {
    if (edgeIds.length) s.removeEdges(featureId, edgeIds);
    return;
  }
  const doc = s.doc;
  const nameOf = (n: (typeof nodes)[number]) =>
    n.refType === 'dataFunction' ? doc.dataFunctions[n.refId]?.name
      : n.refType === 'externalEntity' ? doc.externalEntities[n.refId]?.name
      : n.refType === 'transactionFunction' ? doc.transactionFunctions[n.refId]?.name
      : doc.nonCountedProcesses[n.refId]?.name;
  const shared = nodes.filter((n) => n.refType === 'dataFunction' || n.refType === 'externalEntity');
  const owned = nodes.filter((n) => n.refType === 'transactionFunction' || n.refType === 'nonCountedProcess');
  const nodeIds = nodes.map((n) => n.id);
  const run = (mode: 'unplace' | 'delete') => {
    const r = get().deleteSelection(featureId, nodeIds, edgeIds, mode);
    if (r.skipped.length) {
      get().notify(`${r.skipped.join('、')} は他の機能が参照しているため配置の解除のみ行いました`, 'info');
    }
  };

  if (!shared.length) {
    s.openConfirm({
      title: owned.length === 1 ? `「${nameOf(owned[0])}」を削除しますか` : `${owned.length} 件を削除しますか`,
      message: 'ファンクションが削除され、FP の計上からも外れます。',
      details: owned.map((n) => nameOf(n) ?? ''),
      actions: [{ label: 'キャンセル' }, { label: '削除', color: 'error', variant: 'contained', onClick: () => run('unplace') }],
    });
    return;
  }

  // DF / EE を含む場合は「配置を解除」「実体を削除」を選ばせる
  let blockedReason: string | undefined;
  if (shared.length === 1 && !owned.length) {
    const n = shared[0];
    const allowed = new Set([featureId, n.refType === 'dataFunction' ? doc.dataFunctions[n.refId]?.ownerFeatureId : undefined]);
    const blockers = Object.values(doc.features)
      .filter((x) => !allowed.has(x.id) && x.dfd.nodes.some((m) => m.refType === n.refType && m.refId === n.refId))
      .map((x) => x.name);
    if (blockers.length) blockedReason = `機能「${blockers.join('」「')}」が参照しているため削除できません。先に参照を解除してください。`;
  }
  const single = shared.length === 1 && !owned.length;
  const df = single && shared[0].refType === 'dataFunction' ? doc.dataFunctions[shared[0].refId] : null;
  s.openConfirm({
    title: single ? `「${nameOf(shared[0])}」をどうしますか` : `${nodes.length} 件の要素をどうしますか`,
    message: df
      ? `${df.kind} ・ ${df.displayNo} ・ 所有機能: ${df.ownerFeatureId ? doc.features[df.ownerFeatureId]?.name : '未設定'}`
      : owned.length ? `トランザクションファンクションと非計上プロセス（${owned.length} 件）はどちらを選んでも削除されます。` : undefined,
    choices: [
      { label: 'この DFD から配置を解除', description: 'ファンクションは残り、FP の計上も変わりません。', onClick: () => run('unplace') },
      {
        label: 'ファンクションを削除',
        color: 'error',
        disabled: !!blockedReason,
        description: blockedReason ?? '他の機能が参照している要素は配置の解除のみ行います。',
        onClick: () => run('delete'),
      },
    ],
    actions: [{ label: 'キャンセル' }],
  });
}

export function copySelection(): void {
  const s = get();
  const featureId = s.selectedFeatureId;
  const swId = s.selectedSoftwareId;
  if (!featureId || !swId || !s.selectedNodeIds.length) return;
  const f = s.doc.features[featureId];
  const ids = new Set(s.selectedNodeIds);
  const nodes = f.dfd.nodes.filter((n) => ids.has(n.id));
  const edges = f.dfd.edges.filter((e) => ids.has(e.sourceNodeId) && ids.has(e.targetNodeId));
  s.setClipboard({ softwareId: swId, nodes, edges });
  s.notify(`${nodes.length} 件をコピーしました`);
}

export function pasteClipboard(): void {
  const s = get();
  if (!s.clipboard || !s.selectedFeatureId) return;
  const r = s.pasteNodes(s.selectedFeatureId, s.clipboard);
  if (!r.ok) s.notify(r.reason, 'error');
}

/**
 * データファンクションの所有（FP を計上する機能）を別の機能に移す（FR-ID-07）。
 * 元の所有機能の DFD には参照として残る。Undo で戻せる。
 */
export function transferDataFunctionOwner(dataFunctionId: Id, featureId: Id): void {
  const s = get();
  const df = s.doc.dataFunctions[dataFunctionId];
  const to = s.doc.features[featureId];
  if (!df || !to) return;
  if (df.ownerFeatureId === featureId) return;
  if (softwareIdOfFeature(s.doc, featureId) !== df.softwareId) return s.notify('別のソフトウェアの機能には移せません', 'error');
  const from = df.ownerFeatureId ? s.doc.features[df.ownerFeatureId]?.name : null;
  s.updateDataFunction(dataFunctionId, { ownerFeatureId: featureId });
  const fp = FP_WEIGHTS[df.kind][df.complexity];
  s.notify(
    `「${df.name}」の所有を「${to.name}」に移しました（${FUNCTION_KIND_LABELS[df.kind]} ${fp} FP の計上先が${from ? `「${from}」から` : ''}「${to.name}」に変わります）`,
    'success',
  );
}
