import { calcFeatureResultFor, countedFunctions } from './calc';
import { softwareIdOfFeature } from './queries';
import type { FpDocument, FunctionKind, Id } from './types';

export const LEGEND_KINDS: FunctionKind[] = ['EI', 'EO', 'EQ', 'ILF', 'EIF'];

export interface DfdLegend {
  /** 種別ごとの計上件数（FP の計上と同じ数え方） */
  counts: Record<FunctionKind, number>;
  total: number;
  unadjustedFp: number;
  /** 他機能が所有し、この DFD に参照配置しているデータファンクションの数（計上外） */
  referenceCount: number;
  /** 計上しているが DFD に配置していないファンクションの数 */
  unplacedCount: number;
}

/** DFD の凡例に出す集計（FR-DF-17）。画面と SVG 出力で共用する */
export function buildDfdLegend(doc: FpDocument, featureId: Id): DfdLegend | null {
  const feature = doc.features[featureId];
  const swId = softwareIdOfFeature(doc, featureId);
  if (!feature || !swId) return null;
  const r = calcFeatureResultFor(doc, featureId, swId);
  const placed = new Set(feature.dfd.nodes.map((n) => `${n.refType}:${n.refId}`));

  let unplacedCount = 0;
  for (const df of Object.values(doc.dataFunctions)) {
    if (df.ownerFeatureId === featureId && !placed.has(`dataFunction:${df.id}`)) unplacedCount++;
  }
  for (const tf of Object.values(doc.transactionFunctions)) {
    if (tf.featureId === featureId && !placed.has(`transactionFunction:${tf.id}`)) unplacedCount++;
  }
  const referenceCount = feature.dfd.nodes.filter(
    (n) => n.refType === 'dataFunction' && doc.dataFunctions[n.refId]?.ownerFeatureId !== featureId,
  ).length;

  return {
    counts: r.counts,
    total: countedFunctions(doc, featureId).length,
    unadjustedFp: r.unadjustedFp,
    referenceCount,
    unplacedCount,
  };
}
