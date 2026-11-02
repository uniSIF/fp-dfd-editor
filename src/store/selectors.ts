import { calcFeatureResultFor, calcProjectCost, calcSoftwareTotals, type FeatureResult, type SoftwareTotals } from '../domain/calc';
import { FP_WEIGHTS } from '../domain/fpTables';
import { featurePathLabel, featuresInOrder, getFeaturePath, referencingFeatures, refName, softwareIdOfFeature } from '../domain/queries';
import { validateSoftware, type Warning } from '../domain/validation';
import type {
  Complexity,
  FpDocument,
  FunctionKind,
  Id,
  NodeRefType,
} from '../domain/types';
import type { AppState } from './types';

/** ドキュメント参照ごとに結果をキャッシュする（immer により変更時は参照が変わる） */
function memoByDoc<K, V>(compute: (doc: FpDocument, key: K) => V): (doc: FpDocument, key: K) => V {
  const cache = new WeakMap<FpDocument, Map<K, V>>();
  return (doc, key) => {
    let m = cache.get(doc);
    if (!m) {
      m = new Map();
      cache.set(doc, m);
    }
    if (!m.has(key)) m.set(key, compute(doc, key));
    return m.get(key)!;
  };
}

export const selectFeatureResult = memoByDoc<Id, FeatureResult | null>((doc, featureId) => {
  const swId = softwareIdOfFeature(doc, featureId);
  return swId ? calcFeatureResultFor(doc, featureId, swId) : null;
});

export const selectSoftwareTotals = memoByDoc<Id, SoftwareTotals | null>((doc, softwareId) =>
  doc.softwares[softwareId] ? calcSoftwareTotals(doc, softwareId) : null,
);

export const selectProjectCost = memoByDoc<null, number>((doc) => calcProjectCost(doc));

export const selectWarnings = memoByDoc<Id, Warning[]>((doc, softwareId) => validateSoftware(doc, softwareId));

export const selectAllWarnings = memoByDoc<null, Warning[]>((doc) =>
  doc.project.softwareIds.flatMap((id) => validateSoftware(doc, id)),
);

export function selectIsDirty(s: AppState): boolean {
  return s.revision !== s.savedRevision;
}

// ---------- ツリー ----------

export interface TreeNode {
  id: Id;
  kind: 'software' | 'category1' | 'category2' | 'feature';
  name: string;
  children: TreeNode[];
  warningCount: number;
}

export const selectTree = memoByDoc<null, TreeNode[]>((doc) => {
  const warnings = selectAllWarnings(doc, null);
  const byFeature = new Map<Id, number>();
  for (const w of warnings) {
    if (w.featureId) byFeature.set(w.featureId, (byFeature.get(w.featureId) ?? 0) + 1);
  }
  return doc.project.softwareIds.map((sid) => {
    const sw = doc.softwares[sid];
    return {
      id: sid,
      kind: 'software' as const,
      name: sw.name,
      warningCount: 0,
      children: sw.category1Ids.map((c1Id) => {
        const c1 = doc.category1s[c1Id];
        return {
          id: c1Id,
          kind: 'category1' as const,
          name: c1.name,
          warningCount: 0,
          children: c1.category2Ids.map((c2Id) => {
            const c2 = doc.category2s[c2Id];
            return {
              id: c2Id,
              kind: 'category2' as const,
              name: c2.name,
              warningCount: 0,
              children: c2.featureIds.map((fid) => ({
                id: fid,
                kind: 'feature' as const,
                name: doc.features[fid].name,
                children: [],
                warningCount: byFeature.get(fid) ?? 0,
              })),
            };
          }),
        };
      }),
    };
  });
});

// ---------- ファンクション表 ----------

export type FunctionRowKind = 'dataFunction' | 'transactionFunction' | 'nonCountedProcess' | 'externalEntity';

export interface FunctionRow {
  /** 行 ID（refType:refId） */
  rowId: string;
  refType: FunctionRowKind;
  refId: Id;
  displayNo: string;
  name: string;
  kind: FunctionKind | null;
  complexity: Complexity | null;
  fp: number | null;
  description: string;
  /** 他機能所有の DF / 外部エンティティ */
  isReference: boolean;
  ownerName: string | null;
  placed: boolean;
  /** 最初のノード（外部エンティティは複数あり得る） */
  nodeId: Id | null;
  /** この実体のすべてのノード */
  nodeIds: Id[];
  hasWarning: boolean;
  /** DFD 上の接続（FR-FN-15） */
  connections: { direction: 'out' | 'in'; name: string; label: string }[];
}

export const selectFeatureFunctions = memoByDoc<Id, FunctionRow[]>((doc, featureId) => {
  const f = doc.features[featureId];
  if (!f) return [];
  const swId = softwareIdOfFeature(doc, featureId);
  const warnings = swId ? selectWarnings(doc, swId) : [];
  const warnNodes = new Set(warnings.filter((w) => w.featureId === featureId && w.kind === 'unconnectedNode').map((w) => w.entityId));
  const nodeOf = (refType: NodeRefType, refId: Id) => f.dfd.nodes.find((n) => n.refType === refType && n.refId === refId) ?? null;
  const rows: FunctionRow[] = [];
  const nodeName = (nodeId: Id) => {
    const n = f.dfd.nodes.find((x) => x.id === nodeId);
    return n ? refName(doc, n.refType, n.refId) : '';
  };
  const push = (r: Omit<FunctionRow, 'rowId' | 'placed' | 'nodeId' | 'nodeIds' | 'hasWarning' | 'connections'> & { extraWarn?: boolean }) => {
    const nodes = f.dfd.nodes.filter((n) => n.refType === r.refType && n.refId === r.refId);
    const ids = new Set(nodes.map((n) => n.id));
    const { extraWarn, ...rest } = r;
    // 接続はこの実体のすべてのノードについて数える（外部エンティティを入出力に分けた場合も 1 行にまとめる）
    const connections = f.dfd.edges.flatMap((e): FunctionRow['connections'] =>
      ids.has(e.sourceNodeId) ? [{ direction: 'out' as const, name: nodeName(e.targetNodeId), label: e.label }]
        : ids.has(e.targetNodeId) ? [{ direction: 'in' as const, name: nodeName(e.sourceNodeId), label: e.label }]
        : [],
    );
    rows.push({
      ...rest,
      rowId: `${r.refType}:${r.refId}`,
      placed: nodes.length > 0,
      nodeId: nodes[0]?.id ?? null,
      nodeIds: nodes.map((n) => n.id),
      hasWarning: !!extraWarn || nodes.some((n) => warnNodes.has(n.id)),
      connections,
    });
  };

  const dfs = Object.values(doc.dataFunctions).filter((d) => d.softwareId === swId);
  for (const d of dfs.filter((d) => d.ownerFeatureId === featureId).sort(byNo)) {
    push({ refType: 'dataFunction', refId: d.id, displayNo: d.displayNo, name: d.name, kind: d.kind, complexity: d.complexity,
      fp: FP_WEIGHTS[d.kind][d.complexity], description: d.description, isReference: false, ownerName: null });
  }
  for (const d of dfs.filter((d) => d.ownerFeatureId !== featureId && nodeOf('dataFunction', d.id)).sort(byNo)) {
    push({ refType: 'dataFunction', refId: d.id, displayNo: d.displayNo, name: d.name, kind: d.kind, complexity: d.complexity,
      fp: null, description: d.description, isReference: true,
      ownerName: d.ownerFeatureId ? doc.features[d.ownerFeatureId]?.name ?? '' : null, extraWarn: d.ownerFeatureId === null });
  }
  for (const t of Object.values(doc.transactionFunctions).filter((t) => t.featureId === featureId).sort(byNo)) {
    push({ refType: 'transactionFunction', refId: t.id, displayNo: t.displayNo, name: t.name, kind: t.kind, complexity: t.complexity,
      fp: FP_WEIGHTS[t.kind][t.complexity], description: t.description, isReference: false, ownerName: null });
  }
  for (const p of Object.values(doc.nonCountedProcesses).filter((p) => p.featureId === featureId)) {
    push({ refType: 'nonCountedProcess', refId: p.id, displayNo: '—', name: p.name, kind: null, complexity: null, fp: null,
      description: p.description, isReference: false, ownerName: null });
  }
  const eeIds = [...new Set(f.dfd.nodes.filter((n) => n.refType === 'externalEntity').map((n) => n.refId))];
  for (const n of eeIds.map((refId) => ({ refId }))) {
    const e = doc.externalEntities[n.refId];
    if (!e) continue;
    push({ refType: 'externalEntity', refId: e.id, displayNo: e.displayNo, name: e.name, kind: null, complexity: null, fp: null,
      description: e.description, isReference: false, ownerName: null });
  }
  return rows;
});

function byNo(a: { displayNo: string }, b: { displayNo: string }): number {
  return a.displayNo.localeCompare(b.displayNo);
}

// ---------- 台帳 ----------

export interface LedgerRow {
  id: Id;
  type: 'data' | 'transaction';
  displayNo: string;
  name: string;
  kind: FunctionKind;
  complexity: Complexity;
  fp: number;
  ownerFeatureId: Id | null;
  ownerLabel: string;
  referencingFeatures: { id: Id; name: string }[];
  description: string;
  warning: string | null;
}

export const selectLedger = memoByDoc<Id, LedgerRow[]>((doc, softwareId) => {
  const warnings = selectWarnings(doc, softwareId);
  const warnOf = (id: Id) => warnings.find((w) => w.entityId === id && (w.kind === 'ownerUnset' || w.kind === 'duplicateName'))?.message ?? null;
  const rows: LedgerRow[] = [];
  for (const d of Object.values(doc.dataFunctions).filter((d) => d.softwareId === softwareId).sort(byNo)) {
    rows.push({
      id: d.id, type: 'data', displayNo: d.displayNo, name: d.name, kind: d.kind, complexity: d.complexity,
      fp: FP_WEIGHTS[d.kind][d.complexity], ownerFeatureId: d.ownerFeatureId,
      ownerLabel: d.ownerFeatureId ? featurePathLabel(doc, d.ownerFeatureId) : '未設定',
      referencingFeatures: referencingFeatures(doc, 'dataFunction', d.id).map((id) => ({ id, name: doc.features[id].name })),
      description: d.description, warning: warnOf(d.id),
    });
  }
  const fids = new Set(featuresInOrder(doc, softwareId).map((f) => f.id));
  for (const t of Object.values(doc.transactionFunctions).filter((t) => fids.has(t.featureId)).sort(byNo)) {
    rows.push({
      id: t.id, type: 'transaction', displayNo: t.displayNo, name: t.name, kind: t.kind, complexity: t.complexity,
      fp: FP_WEIGHTS[t.kind][t.complexity], ownerFeatureId: t.featureId, ownerLabel: featurePathLabel(doc, t.featureId),
      referencingFeatures: [], description: t.description, warning: warnOf(t.id),
    });
  }
  return rows;
});

// ---------- DFD ビュー ----------

export interface DfdNodeView {
  nodeId: Id;
  refType: NodeRefType;
  refId: Id;
  x: number;
  y: number;
  name: string;
  displayNo: string | null;
  kind: FunctionKind | null;
  complexity: Complexity | null;
  ownerName: string | null;
  isReference: boolean;
  description: string;
  warning: string | null;
  /** 同じ実体がこの DFD に複数配置されている（外部エンティティの重複表示の印に使う） */
  duplicate: boolean;
}

export const selectDfdNodes = memoByDoc<Id, DfdNodeView[]>((doc, featureId) => {
  const f = doc.features[featureId];
  if (!f) return [];
  const swId = softwareIdOfFeature(doc, featureId);
  const warnings = swId ? selectWarnings(doc, swId) : [];
  const unconnected = new Set(warnings.filter((w) => w.kind === 'unconnectedNode' && w.featureId === featureId).map((w) => w.entityId));
  const placements = new Map<string, number>();
  for (const n of f.dfd.nodes) placements.set(`${n.refType}:${n.refId}`, (placements.get(`${n.refType}:${n.refId}`) ?? 0) + 1);
  return f.dfd.nodes.map((n): DfdNodeView => {
    const base = { nodeId: n.id, refType: n.refType, refId: n.refId, x: n.x, y: n.y, duplicate: (placements.get(`${n.refType}:${n.refId}`) ?? 0) > 1 };
    const unconnectedWarn = unconnected.has(n.id) ? '未接続' : null;
    switch (n.refType) {
      case 'transactionFunction': {
        const t = doc.transactionFunctions[n.refId];
        return { ...base, name: t?.name ?? '', displayNo: t?.displayNo ?? null, kind: t?.kind ?? null, complexity: t?.complexity ?? null,
          ownerName: null, isReference: false, description: t?.description ?? '', warning: unconnectedWarn };
      }
      case 'nonCountedProcess': {
        const p = doc.nonCountedProcesses[n.refId];
        return { ...base, name: p?.name ?? '', displayNo: null, kind: null, complexity: null, ownerName: null, isReference: false,
          description: p?.description ?? '', warning: unconnectedWarn };
      }
      case 'dataFunction': {
        const d = doc.dataFunctions[n.refId];
        const ownerUnset = d?.ownerFeatureId === null;
        const isRef = d?.ownerFeatureId !== featureId;
        return { ...base, name: d?.name ?? '', displayNo: d?.displayNo ?? null, kind: d?.kind ?? null, complexity: d?.complexity ?? null,
          ownerName: isRef ? (ownerUnset ? '未設定' : doc.features[d!.ownerFeatureId!]?.name ?? '') : null,
          isReference: isRef, description: d?.description ?? '', warning: ownerUnset ? '所有機能が未設定' : unconnectedWarn };
      }
      case 'externalEntity': {
        const e = doc.externalEntities[n.refId];
        return { ...base, name: e?.name ?? '', displayNo: e?.displayNo ?? null, kind: null, complexity: null, ownerName: null,
          isReference: false, description: e?.description ?? '', warning: unconnectedWarn };
      }
    }
  });
});

export { getFeaturePath, featuresInOrder };
