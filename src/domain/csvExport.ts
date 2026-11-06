import { calcFeatureResultFor, countedFunctions } from './calc';
import { COMPLEXITIES, COMPLEXITY_LABELS, DEV_TYPE_LABELS, FP_WEIGHTS } from './fpTables';
import { featurePathLabel, featuresInOrder, getFeaturePath, referencingFeatures } from './queries';
import type { FpDocument, FunctionKind, Id } from './types';

const BOM = '﻿';
const CRLF = '\r\n';

/** RFC 4180: カンマ・改行・ダブルクォート・前後の空白を含むセルはクォートする */
export function escapeCsv(value: string | number): string {
  const s = String(value);
  if (/[",\r\n]/.test(s) || s !== s.trim()) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: (string | number)[][]): string {
  return BOM + rows.map((r) => r.map(escapeCsv).join(',')).join(CRLF) + CRLF;
}

/** CSV の件数の列の並び: 種別ごとに複雑度の低・中・高（ILF（低）, ILF（中）, ILF（高）, EIF（低）, …） */
const COUNT_COLUMNS = (['ILF', 'EIF', 'EI', 'EO', 'EQ'] as FunctionKind[]).flatMap((kind) => COMPLEXITIES.map((complexity) => ({ kind, complexity })));

/** 一覧 CSV（FR-CSV-01〜05、requirements.md 4.7） */
export function buildCsv(doc: FpDocument, softwareId: Id): string {
  const sw = doc.softwares[softwareId];
  const vendors = sw.vendorIds.map((id) => doc.vendors[id]).filter(Boolean);
  const header = [
    '機能名（大分類）', '機能名（中分類）', '機能名（小分類）',
    ...COUNT_COLUMNS.map((c) => `${c.kind}（${COMPLEXITY_LABELS[c.complexity]}）`),
    ...Array.from({ length: 14 }, (_, i) => `C${i + 1}`),
    '開発区分', '未調整FP値', '調整係数', '調整済FP値', '改修係数', '開発工数', '社内工数',
    ...vendors.map((v) => `外注工数（${v.name}）`),
    '開発単価', '説明',
  ];
  const rows: (string | number)[][] = [header];
  for (const f of featuresInOrder(doc, softwareId)) {
    const p = getFeaturePath(doc, f.id)!;
    const r = calcFeatureResultFor(doc, f.id, softwareId);
    const fns = countedFunctions(doc, f.id);
    rows.push([
      p.category1.name, p.category2.name, f.name,
      ...COUNT_COLUMNS.map((c) => fns.filter((x) => x.kind === c.kind && x.complexity === c.complexity).length),
      ...f.characteristics,
      DEV_TYPE_LABELS[f.devType],
      r.unadjustedFp,
      r.vaf.toFixed(2),
      r.adjustedFp,
      r.modificationFactor.toFixed(2),
      r.effortHours,
      r.inHouseHours,
      ...vendors.map((v) => (r.vendorId === v.id ? r.outsourceHours : '')),
      r.cost,
      f.description,
    ]);
  }
  return toCsv(rows);
}

/** ファンクション台帳 CSV（FR-ID-06） */
export function buildLedgerCsv(doc: FpDocument, softwareId: Id): string {
  const rows: (string | number)[][] = [['No', '名称', '種別', '複雑度', 'FP', '所有／所属機能', '参照している機能', '説明']];
  const featureName = (id: Id) => doc.features[id]?.name ?? '';
  const dfs = Object.values(doc.dataFunctions)
    .filter((d) => d.softwareId === softwareId)
    .sort((a, b) => a.displayNo.localeCompare(b.displayNo));
  for (const d of dfs) {
    rows.push([
      d.displayNo, d.name, d.kind, COMPLEXITY_LABELS[d.complexity], FP_WEIGHTS[d.kind][d.complexity],
      d.ownerFeatureId ? featurePathLabel(doc, d.ownerFeatureId) : '未設定',
      referencingFeatures(doc, 'dataFunction', d.id).map(featureName).join(';'),
      d.description,
    ]);
  }
  const featureIds = new Set(featuresInOrder(doc, softwareId).map((f) => f.id));
  const tfs = Object.values(doc.transactionFunctions)
    .filter((t) => featureIds.has(t.featureId))
    .sort((a, b) => a.displayNo.localeCompare(b.displayNo));
  for (const t of tfs) {
    rows.push([
      t.displayNo, t.name, t.kind, COMPLEXITY_LABELS[t.complexity], FP_WEIGHTS[t.kind][t.complexity],
      featurePathLabel(doc, t.featureId), '', t.description,
    ]);
  }
  return toCsv(rows);
}

/** ファイル名に使えない文字を置換する */
export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\r\n]/g, '_').trim() || 'untitled';
}

export function timestampForFile(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
