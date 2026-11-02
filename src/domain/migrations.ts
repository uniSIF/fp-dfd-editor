import { fpDocumentSchema } from './schema';
import type { FpDocument } from './types';

export const CURRENT_SCHEMA_VERSION = 1;

/** v から v+1 への変換。2 以降を追加するときにここへ登録する */
const migrations: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {};

export type LoadError =
  | { kind: 'parse'; message: string }
  | { kind: 'unsupportedVersion'; message: string }
  | { kind: 'invalidFormat'; message: string }
  | { kind: 'brokenReference'; message: string };

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function parseDocumentJson(text: string): Result<FpDocument, LoadError> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: { kind: 'parse', message: 'JSON として読み込めません。ファイルが壊れていないか確認してください。' } };
  }
  return migrateAndValidate(raw);
}

export function migrateAndValidate(raw: unknown): Result<FpDocument, LoadError> {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: { kind: 'invalidFormat', message: 'FP DFD Editor のファイルではありません。' } };
  }
  let obj = raw as Record<string, unknown>;
  const version = obj.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > CURRENT_SCHEMA_VERSION) {
    return {
      ok: false,
      error: { kind: 'unsupportedVersion', message: `このバージョンのファイル（schemaVersion: ${String(version)}）には対応していません。` },
    };
  }
  for (let v = version; v < CURRENT_SCHEMA_VERSION; v++) {
    obj = migrations[v](obj);
  }
  const parsed = fpDocumentSchema.safeParse(obj);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join('.') || '(root)';
    return { ok: false, error: { kind: 'invalidFormat', message: `ファイルの形式が正しくありません: ${where} ${issue?.message ?? ''}` } };
  }
  const doc = parsed.data as FpDocument;
  const broken = findBrokenReference(doc);
  if (broken) return { ok: false, error: { kind: 'brokenReference', message: `ファイル内の参照が壊れています: ${broken}` } };
  return { ok: true, value: doc };
}

/** 存在しない ID への参照を探す。問題がなければ null */
export function findBrokenReference(doc: FpDocument): string | null {
  for (const sid of doc.project.softwareIds) if (!doc.softwares[sid]) return `software ${sid}`;
  for (const sw of Object.values(doc.softwares)) {
    for (const id of sw.category1Ids) if (!doc.category1s[id]) return `category1 ${id}`;
    for (const id of sw.vendorIds) if (!doc.vendors[id]) return `vendor ${id}`;
  }
  for (const c1 of Object.values(doc.category1s)) for (const id of c1.category2Ids) if (!doc.category2s[id]) return `category2 ${id}`;
  for (const c2 of Object.values(doc.category2s)) for (const id of c2.featureIds) if (!doc.features[id]) return `feature ${id}`;
  for (const f of Object.values(doc.features)) {
    if (f.vendorId && !doc.vendors[f.vendorId]) return `feature ${f.id} の vendor`;
    const nodeIds = new Set(f.dfd.nodes.map((n) => n.id));
    for (const n of f.dfd.nodes) {
      const table = {
        dataFunction: doc.dataFunctions,
        transactionFunction: doc.transactionFunctions,
        nonCountedProcess: doc.nonCountedProcesses,
        externalEntity: doc.externalEntities,
      }[n.refType] as Record<string, unknown>;
      if (!table[n.refId]) return `DFD ノード ${n.id} の参照先 ${n.refId}`;
    }
    for (const e of f.dfd.edges) if (!nodeIds.has(e.sourceNodeId) || !nodeIds.has(e.targetNodeId)) return `DFD エッジ ${e.id}`;
  }
  for (const df of Object.values(doc.dataFunctions)) if (df.ownerFeatureId && !doc.features[df.ownerFeatureId]) return `data function ${df.id} の所有機能`;
  for (const tf of Object.values(doc.transactionFunctions)) if (!doc.features[tf.featureId]) return `transaction function ${tf.id} の所属機能`;
  for (const p of Object.values(doc.nonCountedProcesses)) if (!doc.features[p.featureId]) return `process ${p.id} の所属機能`;
  return null;
}
