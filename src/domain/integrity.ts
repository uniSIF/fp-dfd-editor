import type { DfdNode, FpDocument } from './types';

/**
 * ドキュメントの中の壊れた参照（design.md 8.6）。
 * 形式（schema.ts）は正しくても、指している相手がないと、表示や計算の途中で例外になり画面が出なくなる。
 * Copilot の出力の取り込みや、手で直した保存ファイルで起こりうるので、読み込みと取り込みのあとに取り除く。
 */

/** ノードが指す実体（ファンクション・外部エンティティ）があるか */
export function entityExists(doc: FpDocument, n: Pick<DfdNode, 'refType' | 'refId'>): boolean {
  switch (n.refType) {
    case 'dataFunction': return !!doc.dataFunctions[n.refId];
    case 'transactionFunction': return !!doc.transactionFunctions[n.refId];
    case 'nonCountedProcess': return !!doc.nonCountedProcesses[n.refId];
    case 'externalEntity': return !!doc.externalEntities[n.refId];
  }
}

const TYPE_LABELS: Record<DfdNode['refType'], string> = {
  dataFunction: 'データファンクション',
  transactionFunction: 'トランザクションファンクション',
  nonCountedProcess: '非計上プロセス',
  externalEntity: '外部エンティティ',
};

/**
 * 壊れた参照を取り除く（doc を書き換える。ストアの draft か、複製したドキュメントに使う）。直した内容の説明を返す。
 * - 所属する機能がないトランザクションファンクション・非計上プロセスは削除する
 * - 実体のないノードと、両端のノードがそろわない・同じノードを結ぶデータフローは DFD から取り除く
 * - 存在しない機能を指すデータファンクションの所有機能と、存在しない外注業者は未設定にする
 */
export function repairReferencesInPlace(doc: FpDocument): string[] {
  const repairs: string[] = [];
  for (const t of Object.values(doc.transactionFunctions)) {
    if (doc.features[t.featureId]) continue;
    delete doc.transactionFunctions[t.id];
    repairs.push(`所属する機能がないトランザクションファンクション「${t.displayNo} ${t.name}」を削除`);
  }
  for (const p of Object.values(doc.nonCountedProcesses)) {
    if (doc.features[p.featureId]) continue;
    delete doc.nonCountedProcesses[p.id];
    repairs.push(`所属する機能がない非計上プロセス「${p.name}」を削除`);
  }
  for (const d of Object.values(doc.dataFunctions)) {
    if (d.ownerFeatureId === null || doc.features[d.ownerFeatureId]) continue;
    d.ownerFeatureId = null;
    repairs.push(`データファンクション「${d.displayNo} ${d.name}」の所有機能（存在しない機能）を未設定に変更`);
  }
  for (const f of Object.values(doc.features)) {
    if (f.vendorId !== null && !doc.vendors[f.vendorId]) {
      f.vendorId = null;
      repairs.push(`機能「${f.name}」の外注業者（存在しない業者）を未選択に変更`);
    }
    const missing = f.dfd.nodes.filter((n) => !entityExists(doc, n));
    if (missing.length) {
      const ids = new Set(missing.map((n) => n.id));
      f.dfd.nodes = f.dfd.nodes.filter((n) => !ids.has(n.id));
      for (const n of missing) repairs.push(`機能「${f.name}」の DFD から、実体のない${TYPE_LABELS[n.refType]}のノードを削除`);
    }
    const nodeIds = new Set(f.dfd.nodes.map((n) => n.id));
    const before = f.dfd.edges.length;
    f.dfd.edges = f.dfd.edges.filter((e) => e.sourceNodeId !== e.targetNodeId && nodeIds.has(e.sourceNodeId) && nodeIds.has(e.targetNodeId));
    if (f.dfd.edges.length < before) repairs.push(`機能「${f.name}」の DFD から、つなぐ先のないデータフローを ${before - f.dfd.edges.length} 本削除`);
  }
  return repairs;
}

/** 壊れた参照の一覧（doc は変えない）。なければ空 */
export function findBrokenReferences(doc: FpDocument): string[] {
  return repairReferencesInPlace(structuredClone(doc));
}

/** 壊れた参照を取り除いたドキュメントを返す（doc は変えない）。壊れていなければ doc をそのまま返す */
export function repairReferences(doc: FpDocument): { doc: FpDocument; repairs: string[] } {
  const copy = structuredClone(doc);
  const repairs = repairReferencesInPlace(copy);
  return repairs.length ? { doc: copy, repairs } : { doc, repairs };
}
