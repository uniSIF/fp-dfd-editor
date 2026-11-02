import type { Category1, Category2, Feature, FpDocument, Id, NodeRefType, Software } from './types';

export interface FeaturePath {
  software: Software;
  category1: Category1;
  category2: Category2;
  feature: Feature;
}

export function getFeaturePath(doc: FpDocument, featureId: Id): FeaturePath | null {
  const feature = doc.features[featureId];
  if (!feature) return null;
  const category2 = doc.category2s[feature.category2Id];
  const category1 = category2 && doc.category1s[category2.category1Id];
  const software = category1 && doc.softwares[category1.softwareId];
  if (!category2 || !category1 || !software) return null;
  return { software, category1, category2, feature };
}

export function softwareIdOfFeature(doc: FpDocument, featureId: Id): Id | null {
  return getFeaturePath(doc, featureId)?.software.id ?? null;
}

/** ツリーの表示順（大分類 → 中分類 → 機能）で機能を列挙する */
export function featuresInOrder(doc: FpDocument, softwareId: Id): Feature[] {
  const sw = doc.softwares[softwareId];
  if (!sw) return [];
  const out: Feature[] = [];
  for (const c1Id of sw.category1Ids) {
    const c1 = doc.category1s[c1Id];
    if (!c1) continue;
    for (const c2Id of c1.category2Ids) {
      const c2 = doc.category2s[c2Id];
      if (!c2) continue;
      for (const fId of c2.featureIds) {
        const f = doc.features[fId];
        if (f) out.push(f);
      }
    }
  }
  return out;
}

export function featurePathLabel(doc: FpDocument, featureId: Id | null): string {
  if (!featureId) return '';
  const p = getFeaturePath(doc, featureId);
  if (!p) return '';
  return `${p.category1.name} / ${p.category2.name} / ${p.feature.name}`;
}

/** 実体の名前を返す（DFD ノードや台帳の表示用） */
export function refName(doc: FpDocument, refType: NodeRefType, refId: Id): string {
  switch (refType) {
    case 'dataFunction':
      return doc.dataFunctions[refId]?.name ?? '';
    case 'transactionFunction':
      return doc.transactionFunctions[refId]?.name ?? '';
    case 'nonCountedProcess':
      return doc.nonCountedProcesses[refId]?.name ?? '';
    case 'externalEntity':
      return doc.externalEntities[refId]?.name ?? '';
  }
}

/** 実体を配置している機能 ID の一覧 */
export function featuresPlacing(doc: FpDocument, refType: NodeRefType, refId: Id): Id[] {
  return Object.values(doc.features)
    .filter((f) => f.dfd.nodes.some((n) => n.refType === refType && n.refId === refId))
    .map((f) => f.id);
}

/**
 * 所有機能以外で実体を参照配置している機能（実体削除の可否判定に使う）。
 * DF は所有機能、EE は所有の概念がないので配置しているすべての機能を返す。
 */
export function referencingFeatures(doc: FpDocument, refType: 'dataFunction' | 'externalEntity', refId: Id): Id[] {
  const placing = featuresPlacing(doc, refType, refId);
  if (refType === 'dataFunction') {
    const owner = doc.dataFunctions[refId]?.ownerFeatureId;
    return placing.filter((id) => id !== owner);
  }
  return placing;
}
