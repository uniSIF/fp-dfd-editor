import { FP_WEIGHTS } from './fpTables';
import { featuresInOrder } from './queries';
import type { Complexity, FpDocument, FunctionKind, Id } from './types';

/** 浮動小数の誤差（19.529999…）で切り捨てが 1 ずれないよう、丸めてから切り捨てる */
function safeFloor(x: number): number {
  return Math.floor(Math.round(x * 1e6) / 1e6);
}

export interface FunctionCounts {
  ILF: number;
  EIF: number;
  EI: number;
  EO: number;
  EQ: number;
}

export function emptyCounts(): FunctionCounts {
  return { ILF: 0, EIF: 0, EI: 0, EO: 0, EQ: 0 };
}

export function calcUnadjustedFp(fns: { kind: FunctionKind; complexity: Complexity }[]): number {
  return fns.reduce((sum, f) => sum + FP_WEIGHTS[f.kind][f.complexity], 0);
}

/** 調整係数 = 0.65 + 0.01 × ΣC。整数演算で求める */
export function calcVaf(characteristics: number[]): number {
  const sum = characteristics.reduce((a, b) => a + b, 0);
  return (65 + sum) / 100;
}

/** 調整済み FP = 切り捨て(未調整 FP × 調整係数) */
export function calcAdjustedFp(unadjusted: number, vaf: number): number {
  // vaf は小数第2位までなので百分率の整数にして整数演算する
  const vafPercent = Math.round(vaf * 100);
  return Math.floor((unadjusted * vafPercent) / 100);
}

/** 開発工数 [H] = 切り捨て(調整済み FP × 改修係数 × FP 単位工数) */
export function calcEffort(adjustedFp: number, factor: number, hoursPerFp: number): number {
  return safeFloor(adjustedFp * factor * hoursPerFp);
}

/** 社内工数 = 切り捨て(開発工数 × 配分比率)、外注工数 = 残り */
export function calcSplit(effort: number, ratio: number): { inHouse: number; outsource: number } {
  const inHouse = safeFloor(effort * ratio);
  return { inHouse, outsource: effort - inHouse };
}

/** 開発単価 [円]。外注業者が未選択なら外注分は 0 */
export function calcCost(inHouse: number, inHouseRate: number, outsource: number, vendorRate: number | null): number {
  return Math.round(inHouse * inHouseRate + outsource * (vendorRate ?? 0));
}

export interface FeatureResult {
  counts: FunctionCounts;
  unadjustedFp: number;
  characteristicsSum: number;
  vaf: number;
  adjustedFp: number;
  modificationFactor: number;
  hoursPerFp: number;
  hoursPerFpUnset: boolean;
  effortHours: number;
  inHouseHours: number;
  outsourceHours: number;
  vendorId: Id | null;
  vendorMissing: boolean;
  cost: number;
}

type Counted = { kind: FunctionKind; complexity: Complexity }[];

/** 機能 ID → 計上ファンクションの索引。ドキュメントは不変なので参照ごとにキャッシュする */
const indexCache = new WeakMap<FpDocument, Map<Id, Counted>>();

function countedIndex(doc: FpDocument): Map<Id, Counted> {
  let idx = indexCache.get(doc);
  if (idx) return idx;
  idx = new Map();
  const push = (fid: Id, f: Counted[number]) => {
    const list = idx!.get(fid);
    if (list) list.push(f);
    else idx!.set(fid, [f]);
  };
  for (const df of Object.values(doc.dataFunctions)) if (df.ownerFeatureId) push(df.ownerFeatureId, df);
  for (const tf of Object.values(doc.transactionFunctions)) push(tf.featureId, tf);
  indexCache.set(doc, idx);
  return idx;
}

/** 機能に計上されるファンクション（DF は所有機能のみ、TF は所属機能のみ） */
export function countedFunctions(doc: FpDocument, featureId: Id): Counted {
  return countedIndex(doc).get(featureId) ?? [];
}

export function calcFeatureResultFor(doc: FpDocument, featureId: Id, softwareId: Id): FeatureResult {
  const feature = doc.features[featureId];
  const settings = doc.softwares[softwareId].settings;
  const fns = countedFunctions(doc, featureId);
  const counts = emptyCounts();
  for (const f of fns) counts[f.kind]++;

  const unadjustedFp = calcUnadjustedFp(fns);
  const characteristicsSum = feature.characteristics.reduce((a, b) => a + b, 0);
  const vaf = calcVaf(feature.characteristics);
  const adjustedFp = calcAdjustedFp(unadjustedFp, vaf);
  const devSettings = feature.devType === 'new' ? settings.newDev : settings.modDev;
  const hoursPerFp = devSettings.hoursPerFp ?? 0;
  const effortHours = calcEffort(adjustedFp, devSettings.modificationFactor, hoursPerFp);
  const { inHouse, outsource } = calcSplit(effortHours, settings.inHouseRatio);
  const vendor = feature.vendorId ? doc.vendors[feature.vendorId] : undefined;
  const cost = calcCost(inHouse, settings.inHouseRate, outsource, vendor ? vendor.rate : null);

  return {
    counts,
    unadjustedFp,
    characteristicsSum,
    vaf,
    adjustedFp,
    modificationFactor: devSettings.modificationFactor,
    hoursPerFp,
    hoursPerFpUnset: devSettings.hoursPerFp === null,
    effortHours,
    inHouseHours: inHouse,
    outsourceHours: outsource,
    vendorId: vendor ? vendor.id : null,
    vendorMissing: outsource > 0 && !vendor,
    cost,
  };
}

export interface SoftwareTotals {
  featureCount: number;
  counts: FunctionCounts;
  unadjustedFp: number;
  adjustedFp: number;
  effortHours: number;
  inHouseHours: number;
  /** 外注業者 ID ごとの外注工数 */
  outsourceHoursByVendor: Record<Id, number>;
  cost: number;
}

export function calcSoftwareTotals(doc: FpDocument, softwareId: Id): SoftwareTotals {
  const totals: SoftwareTotals = {
    featureCount: 0,
    counts: emptyCounts(),
    unadjustedFp: 0,
    adjustedFp: 0,
    effortHours: 0,
    inHouseHours: 0,
    outsourceHoursByVendor: {},
    cost: 0,
  };
  for (const f of featuresInOrder(doc, softwareId)) {
    const r = calcFeatureResultFor(doc, f.id, softwareId);
    totals.featureCount++;
    for (const k of Object.keys(totals.counts) as FunctionKind[]) totals.counts[k] += r.counts[k];
    totals.unadjustedFp += r.unadjustedFp;
    totals.adjustedFp += r.adjustedFp;
    totals.effortHours += r.effortHours;
    totals.inHouseHours += r.inHouseHours;
    if (r.vendorId) {
      totals.outsourceHoursByVendor[r.vendorId] = (totals.outsourceHoursByVendor[r.vendorId] ?? 0) + r.outsourceHours;
    }
    totals.cost += r.cost;
  }
  return totals;
}

export function calcProjectCost(doc: FpDocument): number {
  return doc.project.softwareIds.reduce((sum, id) => sum + calcSoftwareTotals(doc, id).cost, 0);
}
