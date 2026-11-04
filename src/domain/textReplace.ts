import type { FpDocument, Id, NodeRefType } from './types';

export interface ReplaceOptions {
  /** 名称を置換する */
  name: boolean;
  /** 説明を置換する */
  description: boolean;
  /** データフローのラベルを置換する */
  edgeLabels: boolean;
}

/** text 中の find をすべて replace に置き換える。find が空なら何もしない */
export function replaceText(text: string, find: string, replace: string): string {
  return find ? text.split(find).join(replace) : text;
}

export interface ReplaceCandidate {
  /** 行の一意キー */
  key: string;
  target: 'entity' | 'edge';
  refType?: NodeRefType;
  refId?: Id;
  edgeId?: Id;
  field: 'name' | 'description' | 'label';
  /** 表示用の分類（EI・ILF・非計上・データフロー など） */
  kindLabel: string;
  displayNo: string;
  before: string;
  after: string;
}

/**
 * 機能内の文言置換の候補（FR-FN-17）。検索語を含むものだけを返す。
 * 対象はこの機能に属する TF・非計上プロセスと、この機能が所有する DF、この機能の DFD のデータフロー。
 * 外部エンティティと他機能所有の DF は共有されているため対象外。
 * scope を渡すと、その実体・データフローだけに絞る（DFD のコピーで作ったものなど）。
 */
export function planTextReplacements(
  doc: FpDocument,
  featureId: Id,
  find: string,
  replace: string,
  options: ReplaceOptions,
  scope?: { refIds: Set<Id>; edgeIds: Set<Id> },
): ReplaceCandidate[] {
  const f = doc.features[featureId];
  if (!f || !find) return [];
  const out: ReplaceCandidate[] = [];
  const push = (base: Omit<ReplaceCandidate, 'key' | 'field' | 'before' | 'after'>, field: 'name' | 'description', value: string) => {
    if (!value.includes(find)) return;
    out.push({ ...base, key: `${base.refType}:${base.refId}:${field}`, field, before: value, after: value.split(find).join(replace) });
  };
  const entities: { refType: NodeRefType; refId: Id; kindLabel: string; displayNo: string; name: string; description: string }[] = [];
  for (const d of Object.values(doc.dataFunctions)) {
    if (d.ownerFeatureId === featureId) entities.push({ refType: 'dataFunction', refId: d.id, kindLabel: d.kind, displayNo: d.displayNo, name: d.name, description: d.description });
  }
  for (const t of Object.values(doc.transactionFunctions)) {
    if (t.featureId === featureId) entities.push({ refType: 'transactionFunction', refId: t.id, kindLabel: t.kind, displayNo: t.displayNo, name: t.name, description: t.description });
  }
  for (const p of Object.values(doc.nonCountedProcesses)) {
    if (p.featureId === featureId) entities.push({ refType: 'nonCountedProcess', refId: p.id, kindLabel: '非計上', displayNo: '—', name: p.name, description: p.description });
  }
  entities.sort((a, b) => a.displayNo.localeCompare(b.displayNo));
  for (const e of entities) {
    if (scope && !scope.refIds.has(e.refId)) continue;
    const base = { target: 'entity' as const, refType: e.refType, refId: e.refId, kindLabel: e.kindLabel, displayNo: e.displayNo };
    if (options.name) push(base, 'name', e.name);
    if (options.description) push(base, 'description', e.description);
  }
  if (options.edgeLabels) {
    for (const e of f.dfd.edges) {
      if (scope && !scope.edgeIds.has(e.id)) continue;
      if (!e.label.includes(find)) continue;
      out.push({
        key: `edge:${e.id}`, target: 'edge', edgeId: e.id, field: 'label', kindLabel: 'データフロー', displayNo: '—',
        before: e.label, after: e.label.split(find).join(replace),
      });
    }
  }
  return out;
}
