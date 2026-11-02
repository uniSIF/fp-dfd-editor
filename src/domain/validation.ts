import { calcFeatureResultFor } from './calc';
import { featuresInOrder, getFeaturePath, refName } from './queries';
import type { FpDocument, Id } from './types';

export type WarningKind = 'ownerUnset' | 'unconnectedNode' | 'vendorMissing' | 'hoursPerFpUnset' | 'duplicateName';

export interface Warning {
  kind: WarningKind;
  softwareId: Id;
  featureId?: Id;
  /** DF / TF の ID、または DFD ノードの ID（unconnectedNode） */
  entityId?: Id;
  message: string;
}

export function validateSoftware(doc: FpDocument, softwareId: Id): Warning[] {
  const sw = doc.softwares[softwareId];
  if (!sw) return [];
  const out: Warning[] = [];
  const features = featuresInOrder(doc, softwareId);

  // 所有機能未設定
  for (const df of Object.values(doc.dataFunctions)) {
    if (df.softwareId === softwareId && df.ownerFeatureId === null) {
      out.push({ kind: 'ownerUnset', softwareId, entityId: df.id, message: `${df.name}（${df.displayNo}）の所有機能が未設定です` });
    }
  }

  let newUnset = false;
  let modUnset = false;
  for (const f of features) {
    // 未接続ノード
    const connected = new Set<string>();
    for (const e of f.dfd.edges) {
      connected.add(e.sourceNodeId);
      connected.add(e.targetNodeId);
    }
    for (const n of f.dfd.nodes) {
      if (!connected.has(n.id)) {
        const name = refName(doc, n.refType, n.refId);
        out.push({ kind: 'unconnectedNode', softwareId, featureId: f.id, entityId: n.id, message: `${f.name}: ${name} が未接続です` });
      }
    }
    const r = calcFeatureResultFor(doc, f.id, softwareId);
    if (r.vendorMissing) {
      out.push({ kind: 'vendorMissing', softwareId, featureId: f.id, message: `${f.name}: 外注工数がありますが外注業者が未選択です` });
    }
    if (f.devType === 'new' && sw.settings.newDev.hoursPerFp === null) newUnset = true;
    if (f.devType === 'modification' && sw.settings.modDev.hoursPerFp === null) modUnset = true;
  }
  if (newUnset) out.push({ kind: 'hoursPerFpUnset', softwareId, message: '開発区分「新規」の FP 単位工数（H/FP）が未設定です' });
  if (modUnset) out.push({ kind: 'hoursPerFpUnset', softwareId, message: '開発区分「改修」の FP 単位工数（H/FP）が未設定です' });

  // 同名・同種別
  const seen = new Map<string, { id: Id; name: string }[]>();
  for (const df of Object.values(doc.dataFunctions)) {
    if (df.softwareId !== softwareId) continue;
    const key = `${df.kind}\u0000${df.name.trim()}`;
    seen.set(key, [...(seen.get(key) ?? []), { id: df.id, name: df.name }]);
  }
  const featureIds = new Set(features.map((f) => f.id));
  for (const tf of Object.values(doc.transactionFunctions)) {
    if (!featureIds.has(tf.featureId)) continue;
    const key = `${tf.kind}\u0000${tf.name.trim()}`;
    seen.set(key, [...(seen.get(key) ?? []), { id: tf.id, name: tf.name }]);
  }
  for (const [key, list] of seen) {
    if (list.length < 2) continue;
    const kind = key.split('\u0000')[0];
    for (const item of list) {
      out.push({ kind: 'duplicateName', softwareId, entityId: item.id, message: `同じ名称・種別のファンクションがあります: ${item.name}（${kind}）` });
    }
  }
  return out;
}

/**
 * 新規作成しようとしている名称・種別と重複する既存ファンクションを探す（FR-ID-04）。
 * 見つかった場合はその所有／所属機能名も返す。
 */
export function findDuplicateName(
  doc: FpDocument,
  softwareId: Id,
  kind: string,
  name: string,
): { id: Id; featureName: string } | null {
  const n = name.trim();
  if (!n) return null;
  for (const df of Object.values(doc.dataFunctions)) {
    if (df.softwareId === softwareId && df.kind === kind && df.name.trim() === n) {
      const p = df.ownerFeatureId ? getFeaturePath(doc, df.ownerFeatureId) : null;
      return { id: df.id, featureName: p?.feature.name ?? '所有機能未設定' };
    }
  }
  for (const tf of Object.values(doc.transactionFunctions)) {
    if (tf.kind !== kind || tf.name.trim() !== n) continue;
    const p = getFeaturePath(doc, tf.featureId);
    if (p && p.software.id === softwareId) return { id: tf.id, featureName: p.feature.name };
  }
  return null;
}
