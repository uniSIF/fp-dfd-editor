import { layoutDfd } from '../domain/autoLayout';
import { canConnect, canConnectNodes, canPlaceMultiple, ruleKindOf } from '../domain/dfdRules';
import { findFreePosition, nodeSize } from '../domain/dfdGeometry';
import { createSoftware, emptyDocument } from '../domain/emptyDocument';
import { formatDisplayNo, newId } from '../domain/ids';
import { refName, softwareIdOfFeature } from '../domain/queries';
import { replaceText } from '../domain/textReplace';
import { entityKey as entityKeyOnDraft, featurePlanHasChanges } from '../domain/exchange';
import type { DataFunctionKind, DfdNode, FpDocument, Id, NodeRefType, TransactionKind } from '../domain/types';
import type { ActionResult, AppState, DocumentSlice, EntityRef, PlaceOption } from './types';

export type ImmerSet = (fn: (s: AppState) => void) => void;
export type Get = () => AppState;

// ---------- ドラフト上で使う補助関数 ----------

function requireSoftwareId(doc: FpDocument, featureId: Id): Id {
  const id = softwareIdOfFeature(doc, featureId);
  if (!id) throw new Error(`feature ${featureId} is not attached to a software`);
  return id;
}

function nextDisplayNo(doc: FpDocument, softwareId: Id, prefix: 'DF' | 'TF' | 'EE'): string {
  const sw = doc.softwares[softwareId];
  const no = formatDisplayNo(prefix, sw.seq[prefix]);
  sw.seq[prefix] += 1;
  return no;
}

/** ノードの大きさは名称で変わる（nodeLayout）。配置計算に渡すため名称を添える */
function named(doc: FpDocument, nodes: DfdNode[]): (DfdNode & { name: string })[] {
  return nodes.map((n) => ({ ...n, name: refName(doc, n.refType, n.refId) }));
}

function sizeOf(doc: FpDocument, n: { refType: NodeRefType; refId: Id }): { width: number; height: number } {
  return nodeSize(n.refType, refName(doc, n.refType, n.refId));
}

/** 既存ノードと重ならない位置（置く要素の名称から大きさを求める） */
function freePosition(doc: FpDocument, nodes: DfdNode[], refType: NodeRefType, refId: Id, preferred?: { x: number; y: number }) {
  return findFreePosition(named(doc, nodes), refType, preferred, undefined, refName(doc, refType, refId));
}

/** 自動整列（FR-DF-12） */
function layoutOnDraft(d: FpDocument, featureId: Id): void {
  const dfd = d.features[featureId].dfd;
  const kindOf = (n: DfdNode) => (n.refType === 'dataFunction' ? d.dataFunctions[n.refId]?.kind : null);
  const nameOf = (n: DfdNode) => refName(d, n.refType, n.refId);
  const pos = new Map(layoutDfd(dfd.nodes, dfd.edges, kindOf, nameOf).map((p) => [p.nodeId, p]));
  for (const n of dfd.nodes) {
    const p = pos.get(n.id);
    if (p) {
      n.x = Math.round(p.x);
      n.y = Math.round(p.y);
    }
  }
}

function placeOnDraft(doc: FpDocument, featureId: Id, refType: NodeRefType, refId: Id, place: PlaceOption | undefined): void {
  if (!place) return;
  const dfd = doc.features[featureId].dfd;
  if (dfd.nodes.some((n) => n.refType === refType && n.refId === refId)) return;
  const pos = freePosition(doc, dfd.nodes, refType, refId, place === true ? undefined : place);
  dfd.nodes.push({ id: newId(), refType, refId, x: pos.x, y: pos.y });
}

/** ノードと、そのノードに接続するエッジを取り除く */
function removeNodesFromDfd(doc: FpDocument, featureId: Id, pred: (n: DfdNode) => boolean): void {
  const dfd = doc.features[featureId].dfd;
  const removed = new Set(dfd.nodes.filter(pred).map((n) => n.id));
  if (!removed.size) return;
  dfd.nodes = dfd.nodes.filter((n) => !removed.has(n.id));
  dfd.edges = dfd.edges.filter((e) => !removed.has(e.sourceNodeId) && !removed.has(e.targetNodeId));
}

function removeEverywhere(doc: FpDocument, refType: NodeRefType, refId: Id): void {
  for (const fid of Object.keys(doc.features)) removeNodesFromDfd(doc, fid, (n) => n.refType === refType && n.refId === refId);
}

/** 実体を削除できない理由（参照している機能名）。削除できるなら null */
function blockingReferences(doc: FpDocument, refType: NodeRefType, refId: Id, fromFeatureId?: Id): string[] | null {
  if (refType !== 'dataFunction' && refType !== 'externalEntity') return null;
  const allowed = new Set<Id | null | undefined>([fromFeatureId]);
  if (refType === 'dataFunction') allowed.add(doc.dataFunctions[refId]?.ownerFeatureId);
  const blockers = Object.values(doc.features)
    .filter((f) => !allowed.has(f.id) && f.dfd.nodes.some((n) => n.refType === refType && n.refId === refId))
    .map((f) => f.name);
  return blockers.length ? blockers : null;
}

function deleteEntityOnDraft(doc: FpDocument, refType: NodeRefType, refId: Id): void {
  removeEverywhere(doc, refType, refId);
  switch (refType) {
    case 'dataFunction': delete doc.dataFunctions[refId]; break;
    case 'transactionFunction': delete doc.transactionFunctions[refId]; break;
    case 'nonCountedProcess': delete doc.nonCountedProcesses[refId]; break;
    case 'externalEntity': delete doc.externalEntities[refId]; break;
  }
}

function deleteFeatureOnDraft(doc: FpDocument, featureId: Id): void {
  const f = doc.features[featureId];
  if (!f) return;
  for (const df of Object.values(doc.dataFunctions)) if (df.ownerFeatureId === featureId) df.ownerFeatureId = null;
  for (const tf of Object.values(doc.transactionFunctions)) if (tf.featureId === featureId) delete doc.transactionFunctions[tf.id];
  for (const p of Object.values(doc.nonCountedProcesses)) if (p.featureId === featureId) delete doc.nonCountedProcesses[p.id];
  const c2 = doc.category2s[f.category2Id];
  if (c2) c2.featureIds = c2.featureIds.filter((id) => id !== featureId);
  delete doc.features[featureId];
}

function deleteCategory2OnDraft(doc: FpDocument, id: Id): void {
  const c2 = doc.category2s[id];
  if (!c2) return;
  for (const fid of [...c2.featureIds]) deleteFeatureOnDraft(doc, fid);
  const c1 = doc.category1s[c2.category1Id];
  if (c1) c1.category2Ids = c1.category2Ids.filter((x) => x !== id);
  delete doc.category2s[id];
}

function deleteCategory1OnDraft(doc: FpDocument, id: Id): void {
  const c1 = doc.category1s[id];
  if (!c1) return;
  for (const c2 of [...c1.category2Ids]) deleteCategory2OnDraft(doc, c2);
  const sw = doc.softwares[c1.softwareId];
  if (sw) sw.category1Ids = sw.category1Ids.filter((x) => x !== id);
  delete doc.category1s[id];
}

function moveInArray<T>(arr: T[], item: T, newIndex: number): void {
  const i = arr.indexOf(item);
  if (i < 0) return;
  arr.splice(i, 1);
  arr.splice(Math.max(0, Math.min(newIndex, arr.length)), 0, item);
}

/** 並びが変わるか（変わらない・移動できない操作で履歴を積まないため） */
function changesOrder(list: Id[], id: Id, newIndex: number): boolean {
  const rest = list.filter((x) => x !== id);
  const at = Math.max(0, Math.min(newIndex, rest.length));
  return list.indexOf(id) !== at;
}

function canMoveCategory(doc: FpDocument, id: Id, newIndex: number, newParentId?: Id): boolean {
  const c1 = doc.category1s[id];
  if (c1) return changesOrder(doc.softwares[c1.softwareId].category1Ids, id, newIndex);
  const c2 = doc.category2s[id];
  if (!c2) return false;
  if (!newParentId || newParentId === c2.category1Id) return changesOrder(doc.category1s[c2.category1Id].category2Ids, id, newIndex);
  const to = doc.category1s[newParentId];
  return !!to && to.softwareId === doc.category1s[c2.category1Id]?.softwareId;
}

function canMoveFeature(doc: FpDocument, id: Id, category2Id: Id, newIndex: number): boolean {
  const f = doc.features[id];
  if (!f) return false;
  if (f.category2Id === category2Id) return changesOrder(doc.category2s[category2Id].featureIds, id, newIndex);
  const from = doc.category2s[f.category2Id];
  const to = doc.category2s[category2Id];
  return !!to && doc.category1s[to.category1Id]?.softwareId === doc.category1s[from.category1Id]?.softwareId;
}

// ---------- スライス ----------

export function createDocumentSlice(set: ImmerSet, get: Get, initial: FpDocument): DocumentSlice {
  /** ドキュメントを変更する操作。revision を進めて 1 件の履歴にする */
  const mutate = (fn: (doc: FpDocument, s: AppState) => void) =>
    set((s) => {
      fn(s.doc, s);
      s.revision += 1;
    });

  return {
    doc: initial,
    revision: 0,
    savedRevision: 0,
    backedUpRevision: 0,
    lastSavedAt: null,
    lastBackupAt: null,

    loadDocument: (doc) =>
      set((s) => {
        s.doc = doc;
        s.revision += 1;
        s.savedRevision = s.revision;
        s.backedUpRevision = s.revision;
        s.selectedSoftwareId = doc.project.softwareIds[0] ?? null;
        s.selectedFeatureId = null;
        s.selectedNodeIds = [];
        s.selectedEdgeId = null;
        s.propertyTarget = 'feature';
      }),
    markSaved: (revision, at = Date.now()) => set((s) => { s.savedRevision = revision; s.lastSavedAt = at; }),
    markBackedUp: (revision, at = Date.now()) => set((s) => { s.backedUpRevision = revision; s.lastBackupAt = at; }),
    renameProject: (name) => mutate((d) => { d.project.name = name; }),
    updateBackupSettings: (p) => mutate((d) => { Object.assign(d.backupSettings, p); }),

    addSoftware: (name) => {
      const sw = createSoftware(name);
      mutate((d, s) => {
        d.softwares[sw.id] = sw;
        d.project.softwareIds.push(sw.id);
        s.selectedSoftwareId = sw.id;
      });
      return sw.id;
    },
    renameSoftware: (id, name) => mutate((d) => { d.softwares[id].name = name; }),
    removeSoftware: (id) =>
      mutate((d, s) => {
        const sw = d.softwares[id];
        if (!sw) return;
        for (const c1 of [...sw.category1Ids]) deleteCategory1OnDraft(d, c1);
        for (const df of Object.values(d.dataFunctions)) if (df.softwareId === id) delete d.dataFunctions[df.id];
        for (const ee of Object.values(d.externalEntities)) if (ee.softwareId === id) delete d.externalEntities[ee.id];
        for (const v of sw.vendorIds) delete d.vendors[v];
        delete d.softwares[id];
        d.project.softwareIds = d.project.softwareIds.filter((x) => x !== id);
        if (s.selectedSoftwareId === id) s.selectedSoftwareId = d.project.softwareIds[0] ?? null;
        if (s.selectedFeatureId && !d.features[s.selectedFeatureId]) s.selectedFeatureId = null;
      }),
    updateSettings: (softwareId, patch) => mutate((d) => { Object.assign(d.softwares[softwareId].settings, patch); }),
    addVendor: (softwareId, name, rate) => {
      const id = newId();
      mutate((d) => {
        d.vendors[id] = { id, softwareId, name, rate };
        d.softwares[softwareId].vendorIds.push(id);
      });
      return id;
    },
    updateVendor: (id, patch) => mutate((d) => { Object.assign(d.vendors[id], patch); }),
    removeVendor: (id) =>
      mutate((d) => {
        const v = d.vendors[id];
        if (!v) return;
        for (const f of Object.values(d.features)) if (f.vendorId === id) f.vendorId = null;
        const sw = d.softwares[v.softwareId];
        if (sw) sw.vendorIds = sw.vendorIds.filter((x) => x !== id);
        delete d.vendors[id];
      }),

    applySoftwareSettings: (softwareId, { settings, vendors, backupSettings }) =>
      mutate((d) => {
        const sw = d.softwares[softwareId];
        sw.settings = settings;
        d.backupSettings = backupSettings;
        const keep = new Set(vendors.filter((v) => v.id).map((v) => v.id!));
        for (const vid of sw.vendorIds) {
          if (keep.has(vid)) continue;
          for (const f of Object.values(d.features)) if (f.vendorId === vid) f.vendorId = null;
          delete d.vendors[vid];
        }
        sw.vendorIds = vendors.map((v) => {
          const id = v.id && d.vendors[v.id] ? v.id : newId();
          d.vendors[id] = { id, softwareId, name: v.name, rate: v.rate };
          return id;
        });
      }),

    addCategory1: (softwareId, name) => {
      const id = newId();
      mutate((d) => {
        d.category1s[id] = { id, softwareId, name, category2Ids: [] };
        d.softwares[softwareId].category1Ids.push(id);
      });
      return id;
    },
    addCategory2: (category1Id, name) => {
      const id = newId();
      mutate((d) => {
        d.category2s[id] = { id, category1Id, name, featureIds: [] };
        d.category1s[category1Id].category2Ids.push(id);
      });
      return id;
    },
    renameCategory: (id, name) =>
      mutate((d) => {
        if (d.category1s[id]) d.category1s[id].name = name;
        else if (d.category2s[id]) d.category2s[id].name = name;
      }),
    removeCategory: (id) =>
      mutate((d, s) => {
        if (d.category1s[id]) deleteCategory1OnDraft(d, id);
        else deleteCategory2OnDraft(d, id);
        if (s.selectedFeatureId && !d.features[s.selectedFeatureId]) {
          s.selectedFeatureId = null;
          s.selectedNodeIds = [];
        }
      }),
    moveCategory: (id, newIndex, newParentId) => {
      if (!canMoveCategory(get().doc, id, newIndex, newParentId)) return;
      mutate((d) => {
        const c1 = d.category1s[id];
        if (c1) moveInArray(d.softwares[c1.softwareId].category1Ids, id, newIndex);
        const c2 = d.category2s[id];
        if (!c2) return;
        if (!newParentId || newParentId === c2.category1Id) {
          moveInArray(d.category1s[c2.category1Id].category2Ids, id, newIndex);
          return;
        }
        // 別の大分類へ。ソフトウェアをまたぐ移動は不可
        const from = d.category1s[c2.category1Id];
        const to = d.category1s[newParentId];
        if (!to || to.softwareId !== from.softwareId) return;
        from.category2Ids = from.category2Ids.filter((x) => x !== id);
        to.category2Ids.splice(Math.max(0, Math.min(newIndex, to.category2Ids.length)), 0, id);
        c2.category1Id = newParentId;
      });
    },
    addFeature: (category2Id, name) => {
      const id = newId();
      mutate((d, s) => {
        const c1 = d.category1s[d.category2s[category2Id].category1Id];
        const sw = d.softwares[c1.softwareId];
        d.features[id] = {
          id,
          category2Id,
          name,
          devType: 'new',
          characteristics: [...sw.settings.defaultCharacteristics],
          vendorId: null,
          description: '',
          dfd: { nodes: [], edges: [] },
        };
        d.category2s[category2Id].featureIds.push(id);
        s.selectedFeatureId = id;
        s.selectedSoftwareId = sw.id;
        s.selectedNodeIds = [];
        s.propertyTarget = 'feature';
      });
      return id;
    },
    updateFeature: (id, patch) => mutate((d) => { Object.assign(d.features[id], patch); }),
    removeFeature: (id) =>
      mutate((d, s) => {
        deleteFeatureOnDraft(d, id);
        if (s.selectedFeatureId === id) {
          s.selectedFeatureId = null;
          s.selectedNodeIds = [];
          s.selectedEdgeId = null;
        }
      }),
    moveFeature: (id, category2Id, newIndex) => {
      if (!canMoveFeature(get().doc, id, category2Id, newIndex)) return;
      mutate((d) => {
        const f = d.features[id];
        const from = d.category2s[f.category2Id];
        if (f.category2Id === category2Id) {
          moveInArray(from.featureIds, id, newIndex);
          return;
        }
        const to = d.category2s[category2Id];
        // ソフトウェアをまたぐ移動は不可（データファンクションや外注業者がソフトウェア単位のため）
        if (!to || d.category1s[to.category1Id]?.softwareId !== d.category1s[from.category1Id]?.softwareId) return;
        from.featureIds = from.featureIds.filter((x) => x !== id);
        to.featureIds.splice(Math.max(0, Math.min(newIndex, to.featureIds.length)), 0, id);
        f.category2Id = category2Id;
      });
    },
    resetCharacteristics: (id) =>
      mutate((d) => {
        const swId = requireSoftwareId(d, id);
        d.features[id].characteristics = [...d.softwares[swId].settings.defaultCharacteristics];
      }),

    addDataFunction: ({ featureId, name, kind, complexity, description = '', place }) => {
      const id = newId();
      mutate((d) => {
        const swId = requireSoftwareId(d, featureId);
        d.dataFunctions[id] = {
          id, softwareId: swId, displayNo: nextDisplayNo(d, swId, 'DF'), name, kind, complexity, ownerFeatureId: featureId, description,
        };
        placeOnDraft(d, featureId, 'dataFunction', id, place);
      });
      return id;
    },
    updateDataFunction: (id, patch) => mutate((d) => { Object.assign(d.dataFunctions[id], patch); }),
    addTransactionFunction: ({ featureId, name, kind, complexity, description = '', place }) => {
      const id = newId();
      mutate((d) => {
        const swId = requireSoftwareId(d, featureId);
        d.transactionFunctions[id] = { id, featureId, displayNo: nextDisplayNo(d, swId, 'TF'), name, kind, complexity, description };
        placeOnDraft(d, featureId, 'transactionFunction', id, place);
      });
      return id;
    },
    updateTransactionFunction: (id, patch) => mutate((d) => { Object.assign(d.transactionFunctions[id], patch); }),
    addNonCountedProcess: ({ featureId, name, description = '', place }) => {
      const id = newId();
      mutate((d) => {
        d.nonCountedProcesses[id] = { id, featureId, name, description };
        placeOnDraft(d, featureId, 'nonCountedProcess', id, place);
      });
      return id;
    },
    updateNonCountedProcess: (id, patch) => mutate((d) => { Object.assign(d.nonCountedProcesses[id], patch); }),
    addExternalEntity: ({ featureId, name, description = '', place }) => {
      const id = newId();
      mutate((d) => {
        const swId = requireSoftwareId(d, featureId);
        d.externalEntities[id] = { id, softwareId: swId, displayNo: nextDisplayNo(d, swId, 'EE'), name, description };
        placeOnDraft(d, featureId, 'externalEntity', id, place);
      });
      return id;
    },
    updateExternalEntity: (id, patch) => mutate((d) => { Object.assign(d.externalEntities[id], patch); }),
    removeEntity: (refType, refId, fromFeatureId) => {
      const blockers = blockingReferences(get().doc, refType, refId, fromFeatureId);
      if (blockers) {
        return { ok: false, reason: `機能「${blockers.join('」「')}」が参照しているため削除できません。先に参照を解除してください。` };
      }
      mutate((d) => deleteEntityOnDraft(d, refType, refId));
      return { ok: true };
    },

    placeNode: (featureId, refType, refId, position) => {
      const f = get().doc.features[featureId];
      if (!canPlaceMultiple(refType) && f.dfd.nodes.some((n) => n.refType === refType && n.refId === refId)) {
        return { ok: false, reason: 'この DFD に配置済みです。' };
      }
      const nodeId = newId();
      mutate((d) => {
        const dfd = d.features[featureId].dfd;
        const pos = freePosition(d, dfd.nodes, refType, refId, position);
        dfd.nodes.push({ id: nodeId, refType, refId, x: pos.x, y: pos.y });
      });
      return { ok: true, id: nodeId };
    },
    unplaceNode: (featureId, nodeId) => mutate((d) => removeNodesFromDfd(d, featureId, (n) => n.id === nodeId)),
    moveNodes: (featureId, positions) =>
      mutate((d) => {
        const byId = new Map(positions.map((p) => [p.nodeId, p]));
        for (const n of d.features[featureId].dfd.nodes) {
          const p = byId.get(n.id);
          if (p) {
            n.x = Math.round(p.x);
            n.y = Math.round(p.y);
          }
        }
      }),
    addEdge: (featureId, sourceNodeId, targetNodeId, label = '') => {
      const nodes = get().doc.features[featureId].dfd.nodes;
      const src = nodes.find((n) => n.id === sourceNodeId);
      const tgt = nodes.find((n) => n.id === targetNodeId);
      if (!src || !tgt) return { ok: false, reason: 'ノードが見つかりません。' };
      const check = canConnectNodes(src, tgt);
      if (!check.ok) return check;
      const id = newId();
      mutate((d) => { d.features[featureId].dfd.edges.push({ id, sourceNodeId, targetNodeId, label }); });
      return { ok: true, id };
    },
    connectEntities: (featureId, source, target, label = '') => {
      if (source.refType === target.refType && source.refId === target.refId) {
        return { ok: false, reason: '同じ要素同士は接続できません。' };
      }
      const check = canConnect(ruleKindOf(source.refType), ruleKindOf(target.refType));
      if (!check.ok) return check;
      const id = newId();
      mutate((d) => {
        const dfd = d.features[featureId].dfd;
        /**
         * 同じ外部エンティティが複数ある場合、入力元（source）には左端、出力先（target）には右端のノードを使う。
         * 左から右へ一方向に流れる図になるようにするため（FR-DF-18）。
         */
        const find = (r: { refType: NodeRefType; refId: Id }, role: 'source' | 'target' = 'source') => {
          const list = dfd.nodes.filter((n) => n.refType === r.refType && n.refId === r.refId);
          if (!list.length) return undefined;
          return list.reduce((a, b) => (role === 'source' ? (b.x < a.x ? b : a) : (b.x > a.x ? b : a)));
        };
        /** 未配置なら相手ノードの右隣（相手も未配置なら空き位置）に置く */
        const ensure = (r: { refType: NodeRefType; refId: Id }, role: 'source' | 'target', near?: DfdNode): DfdNode => {
          const existing = find(r, role);
          if (existing) return existing;
          const preferred = near ? { x: near.x + sizeOf(d, near).width + 80, y: near.y } : undefined;
          const pos = freePosition(d, dfd.nodes, r.refType, r.refId, preferred);
          const node = { id: newId(), refType: r.refType, refId: r.refId, x: pos.x, y: pos.y };
          dfd.nodes.push(node);
          return node;
        };
        const a = ensure(source, 'source', find(target, 'target'));
        const b = ensure(target, 'target', a);
        dfd.edges.push({ id, sourceNodeId: a.id, targetNodeId: b.id, label });
      });
      return { ok: true, id };
    },
    copyDfdToFeature: (sourceFeatureId, targetFeatureId, { dataFunctions }) => {
      const doc = get().doc;
      const source = doc.features[sourceFeatureId];
      const target = doc.features[targetFeatureId];
      if (!source || !target) return { ok: false, reason: '機能が見つかりません。' };
      if (sourceFeatureId === targetFeatureId) return { ok: false, reason: '同じ機能にはコピーできません。' };
      const swId = softwareIdOfFeature(doc, sourceFeatureId);
      if (!swId || swId !== softwareIdOfFeature(doc, targetFeatureId)) {
        return { ok: false, reason: '別のソフトウェアの機能へはコピーできません。' };
      }
      if (!source.dfd.nodes.length) return { ok: false, reason: 'コピー元の DFD にノードがありません。' };
      const created: EntityRef[] = [];
      const edgeIds: Id[] = [];
      mutate((d) => {
        const src = d.features[sourceFeatureId].dfd;
        const dst = d.features[targetFeatureId].dfd;
        // コピー先に既存のノードがあれば、その右側に並べる
        const srcMinX = Math.min(...src.nodes.map((n) => n.x));
        const srcMinY = Math.min(...src.nodes.map((n) => n.y));
        const dx = dst.nodes.length ? Math.max(...dst.nodes.map((n) => n.x + sizeOf(d, n).width)) + 160 - srcMinX : 0;
        const dy = dst.nodes.length ? Math.min(...dst.nodes.map((n) => n.y)) - srcMinY : 0;
        const nodeMap = new Map<Id, Id>();
        /** 複製したデータファンクション（同じ元から 1 つだけ作る） */
        const dfCopies = new Map<Id, Id>();
        for (const n of src.nodes) {
          let refId = n.refId;
          if (n.refType === 'transactionFunction') {
            const t = d.transactionFunctions[n.refId];
            if (!t) continue;
            refId = newId();
            d.transactionFunctions[refId] = { ...t, id: refId, featureId: targetFeatureId, displayNo: nextDisplayNo(d, swId, 'TF') };
            created.push({ refType: 'transactionFunction', refId });
          } else if (n.refType === 'nonCountedProcess') {
            const p = d.nonCountedProcesses[n.refId];
            if (!p) continue;
            refId = newId();
            d.nonCountedProcesses[refId] = { ...p, id: refId, featureId: targetFeatureId };
            created.push({ refType: 'nonCountedProcess', refId });
          } else if (n.refType === 'dataFunction') {
            const df = d.dataFunctions[n.refId];
            if (!df) continue;
            // コピー元が所有するものだけ、指定に応じて複製する。他機能所有のものは参照のまま
            if (dataFunctions === 'duplicate' && df.ownerFeatureId === sourceFeatureId) {
              refId = dfCopies.get(df.id) ?? newId();
              if (!dfCopies.has(df.id)) {
                dfCopies.set(df.id, refId);
                d.dataFunctions[refId] = { ...df, id: refId, ownerFeatureId: targetFeatureId, displayNo: nextDisplayNo(d, swId, 'DF') };
                created.push({ refType: 'dataFunction', refId });
              }
            }
            // データファンクションは 1 つの DFD に 1 回まで。配置済みなら既存ノードにつなぐ
            const existing = dst.nodes.find((m) => m.refType === 'dataFunction' && m.refId === refId);
            if (existing) {
              nodeMap.set(n.id, existing.id);
              continue;
            }
          } else if (!d.externalEntities[n.refId]) {
            continue;
          }
          const id = newId();
          nodeMap.set(n.id, id);
          dst.nodes.push({ id, refType: n.refType, refId, x: n.x + dx, y: n.y + dy });
        }
        for (const e of src.edges) {
          const a = nodeMap.get(e.sourceNodeId);
          const b = nodeMap.get(e.targetNodeId);
          if (!a || !b) continue;
          const id = newId();
          dst.edges.push({ id, sourceNodeId: a, targetNodeId: b, label: e.label });
          edgeIds.push(id);
        }
      });
      return { ok: true, created, edgeIds };
    },
    copyFunctions: ({ sourceFeatureId, targetFeatureId, refs, includeEdges, replace }) => {
      const doc = get().doc;
      if (!doc.features[sourceFeatureId] || !doc.features[targetFeatureId]) return { ok: false, reason: '機能が見つかりません。' };
      const swId = softwareIdOfFeature(doc, sourceFeatureId);
      if (!swId || swId !== softwareIdOfFeature(doc, targetFeatureId)) {
        return { ok: false, reason: '別のソフトウェアの機能へはコピーできません。' };
      }
      if (!refs.length) return { ok: false, reason: 'コピーするファンクションを選んでください。' };
      const rep = (text: string, on: boolean) => (on ? replaceText(text, replace.find, replace.replace) : text);
      const created: EntityRef[] = [];
      const nodeIds: Id[] = [];
      const edgeIds: Id[] = [];
      mutate((d) => {
        const src = d.features[sourceFeatureId].dfd;
        const dst = d.features[targetFeatureId].dfd;
        const key = (r: EntityRef) => `${r.refType}:${r.refId}`;
        const selected = new Set(refs.map(key));
        const srcNodes = src.nodes.filter((n) => selected.has(key(n)));
        // コピー元の並びを保ったまま、コピー先の既存ノードの右側に置く
        const dx = srcNodes.length && dst.nodes.length
          ? Math.max(...dst.nodes.map((n) => n.x + sizeOf(d, n).width)) + 160 - Math.min(...srcNodes.map((n) => n.x))
          : 0;
        const dy = srcNodes.length && dst.nodes.length ? Math.min(...dst.nodes.map((n) => n.y)) - Math.min(...srcNodes.map((n) => n.y)) : 0;

        /** コピー元の実体 → コピー先で使う実体（複製したものは新しい ID） */
        const refMap = new Map<string, EntityRef & { isNew: boolean }>();
        for (const r of refs) {
          let to: EntityRef & { isNew: boolean };
          if (r.refType === 'transactionFunction') {
            const t = d.transactionFunctions[r.refId];
            if (!t) continue;
            const id = newId();
            d.transactionFunctions[id] = {
              ...t, id, featureId: targetFeatureId, displayNo: nextDisplayNo(d, swId, 'TF'),
              name: rep(t.name, replace.name), description: rep(t.description, replace.description),
            };
            to = { refType: r.refType, refId: id, isNew: true };
          } else if (r.refType === 'nonCountedProcess') {
            const p = d.nonCountedProcesses[r.refId];
            if (!p) continue;
            const id = newId();
            d.nonCountedProcesses[id] = { ...p, id, featureId: targetFeatureId, name: rep(p.name, replace.name), description: rep(p.description, replace.description) };
            to = { refType: r.refType, refId: id, isNew: true };
          } else if (r.refType === 'dataFunction') {
            const df = d.dataFunctions[r.refId];
            if (!df) continue;
            if (df.ownerFeatureId === sourceFeatureId) {
              const id = newId();
              d.dataFunctions[id] = {
                ...df, id, ownerFeatureId: targetFeatureId, displayNo: nextDisplayNo(d, swId, 'DF'),
                name: rep(df.name, replace.name), description: rep(df.description, replace.description),
              };
              to = { refType: r.refType, refId: id, isNew: true };
            } else {
              to = { ...r, isNew: false };
            }
          } else {
            if (!d.externalEntities[r.refId]) continue;
            to = { ...r, isNew: false };
          }
          refMap.set(key(r), to);
          if (to.isNew) created.push({ refType: to.refType, refId: to.refId });
        }

        const place = (refType: NodeRefType, refId: Id, at?: { x: number; y: number }) => {
          const id = newId();
          const pos = at ?? freePosition(d, dst.nodes, refType, refId);
          dst.nodes.push({ id, refType, refId, x: pos.x, y: pos.y });
          nodeIds.push(id);
          return id;
        };
        /** コピー元ノード → コピー先ノード */
        const nodeMap = new Map<Id, Id>();
        for (const n of srcNodes) {
          const to = refMap.get(key(n));
          if (!to) continue;
          if (!to.isNew) {
            // 共有の要素は、コピー先に置いてあるノードを使う（同じ機能へのコピーならそのノード自身）
            const existing = sourceFeatureId === targetFeatureId ? n : dst.nodes.find((m) => m.refType === to.refType && m.refId === to.refId);
            nodeMap.set(n.id, existing ? existing.id : place(to.refType, to.refId, { x: n.x + dx, y: n.y + dy }));
            continue;
          }
          nodeMap.set(n.id, place(to.refType, to.refId, { x: n.x + dx, y: n.y + dy }));
        }
        // DFD に置いていなかった要素も、コピー先では空いている位置に置く
        for (const [k, to] of refMap) {
          if (srcNodes.some((n) => key(n) === k)) continue;
          if (!dst.nodes.some((m) => m.refType === to.refType && m.refId === to.refId)) place(to.refType, to.refId);
        }
        if (!includeEdges) return;
        const newNodes = new Set(nodeIds);
        for (const e of src.edges) {
          const a = nodeMap.get(e.sourceNodeId);
          const b = nodeMap.get(e.targetNodeId);
          // 共有の要素どうしの線は、同じ機能へのコピーで二重になるため作らない
          if (!a || !b || (!newNodes.has(a) && !newNodes.has(b) && sourceFeatureId === targetFeatureId)) continue;
          if (dst.edges.some((x) => x.sourceNodeId === a && x.targetNodeId === b && x.label === rep(e.label, replace.edgeLabels))) continue;
          const id = newId();
          dst.edges.push({ id, sourceNodeId: a, targetNodeId: b, label: rep(e.label, replace.edgeLabels) });
          edgeIds.push(id);
        }
      });
      return { ok: true, created, nodeIds, edgeIds };
    },
    applyImportPlan: (softwareId, plan, { layout }) => {
      if (plan.errors.length) return { ok: false, reason: plan.errors[0] };
      if (!get().doc.softwares[softwareId]) return { ok: false, reason: 'ソフトウェアが見つかりません。' };
      let created = 0;
      const featureIds: Id[] = [];
      mutate((d) => {
        // 1. 分類と新しい機能
        const sw = d.softwares[softwareId];
        const category2Of = (c1Name: string, c2Name: string): Id => {
          let c1 = sw.category1Ids.map((id) => d.category1s[id]).find((c) => c.name === c1Name);
          if (!c1) {
            const id = newId();
            c1 = d.category1s[id] = { id, softwareId, name: c1Name, category2Ids: [] };
            sw.category1Ids.push(id);
          }
          let c2 = c1.category2Ids.map((id) => d.category2s[id]).find((c) => c.name === c2Name);
          if (!c2) {
            const id = newId();
            c2 = d.category2s[id] = { id, category1Id: c1.id, name: c2Name, featureIds: [] };
            c1.category2Ids.push(id);
          }
          return c2.id;
        };
        const featureOf = new Map<string, Id>();
        for (const fp of plan.features) {
          if (fp.featureId) {
            featureOf.set(fp.key, fp.featureId);
            Object.assign(d.features[fp.featureId], fp.featurePatch);
            continue;
          }
          const id = newId();
          const category2Id = category2Of(fp.category1, fp.category2);
          d.features[id] = {
            id, category2Id, name: fp.name, devType: fp.devType, characteristics: [...sw.settings.defaultCharacteristics],
            vendorId: null, description: fp.description, dfd: { nodes: [], edges: [] },
          };
          d.category2s[category2Id].featureIds.push(id);
          featureOf.set(fp.key, id);
        }
        // 2. 出力にない要素・データフローの削除（削除を選んだときだけプランに入っている）
        for (const fp of plan.features) {
          if (!fp.featureId) continue;
          const g = d.features[fp.featureId].dfd;
          const removedEdges = new Set(fp.edgeRemovals.map((e) => e.edgeId));
          g.edges = g.edges.filter((e) => !removedEdges.has(e.id));
          for (const r of fp.removals) {
            // 他の機能も置いている DF は実体を残し、この DFD から外すだけにする
            if (r.mode === 'delete' && !blockingReferences(d, r.refType, r.refId, fp.featureId)) deleteEntityOnDraft(d, r.refType, r.refId);
            else removeNodesFromDfd(d, fp.featureId, (n) => n.refType === r.refType && n.refId === r.refId);
          }
        }
        // 3. 新しい要素
        const refOf = new Map<string, { refType: NodeRefType; refId: Id }>();
        for (const c of plan.creates) {
          const id = newId();
          const fid = c.featureKey ? featureOf.get(c.featureKey)! : null;
          if (c.refType === 'transactionFunction') {
            d.transactionFunctions[id] = { id, featureId: fid!, displayNo: nextDisplayNo(d, softwareId, 'TF'), name: c.name, kind: c.kind as TransactionKind, complexity: c.complexity!, description: c.description };
          } else if (c.refType === 'dataFunction') {
            d.dataFunctions[id] = {
              id, softwareId, displayNo: nextDisplayNo(d, softwareId, 'DF'), name: c.name, kind: c.kind as DataFunctionKind, complexity: c.complexity!,
              ownerFeatureId: fid ?? c.ownerFeatureId ?? null, description: c.description,
            };
          } else if (c.refType === 'nonCountedProcess') {
            d.nonCountedProcesses[id] = { id, featureId: fid!, name: c.name, description: c.description };
          } else {
            d.externalEntities[id] = { id, softwareId, displayNo: nextDisplayNo(d, softwareId, 'EE'), name: c.name, description: c.description };
          }
          refOf.set(c.key, { refType: c.refType, refId: id });
          created += 1;
        }
        // 4. 既存の要素の変更
        for (const u of plan.updates) {
          const target =
            u.refType === 'dataFunction' ? d.dataFunctions[u.refId]
              : u.refType === 'transactionFunction' ? d.transactionFunctions[u.refId]
                : u.refType === 'nonCountedProcess' ? d.nonCountedProcesses[u.refId]
                  : d.externalEntities[u.refId];
          if (target) Object.assign(target, u.patch);
        }
        // 5. 機能ごとに、要素を DFD に置いてデータフローでつなぐ
        for (const fp of plan.features) {
          const fid = featureOf.get(fp.key)!;
          const g = () => d.features[fid].dfd;
          const resolve = (k: string) => {
            if (refOf.has(k)) return refOf.get(k)!;
            const p = fp.places.find((x) => x.key === k);
            if (p) return { refType: p.refType, refId: p.refId };
            // 置いてある既存の要素
            const n = g().nodes.find((x) => entityKeyOnDraft(d, x.refType, x.refId) === k);
            return n ? { refType: n.refType, refId: n.refId } : null;
          };
          for (const k of fp.elementKeys) {
            const r = resolve(k);
            if (r && !g().nodes.some((n) => n.refType === r.refType && n.refId === r.refId)) {
              const pos = freePosition(d, g().nodes, r.refType, r.refId);
              g().nodes.push({ id: newId(), refType: r.refType, refId: r.refId, x: pos.x, y: pos.y });
            }
          }
          // 外部エンティティを複数置いている場合は、入力元は左端・出力先は右端のノードを使う
          const nodeFor = (k: string, role: 'source' | 'target') => {
            const r = resolve(k);
            const list = r ? g().nodes.filter((n) => n.refType === r.refType && n.refId === r.refId) : [];
            if (!list.length) return undefined;
            return list.reduce((a, b) => (role === 'source' ? (b.x < a.x ? b : a) : (b.x > a.x ? b : a)));
          };
          for (const u of fp.edgeLabelUpdates) {
            const e = g().edges.find((x) => x.id === u.edgeId);
            if (e) e.label = u.label;
          }
          for (const f of fp.edgeAdds) {
            const a = nodeFor(f.from, 'source');
            const b = nodeFor(f.to, 'target');
            if (a && b && a.id !== b.id) g().edges.push({ id: newId(), sourceNodeId: a.id, targetNodeId: b.id, label: f.label });
          }
          if (layout && featurePlanHasChanges(fp)) layoutOnDraft(d, fid);
          featureIds.push(fid);
        }
      });
      return { ok: true, created, featureIds };
    },
    placeReferences: (targetFeatureIds, refs) => {
      const doc = get().doc;
      const placed: Record<Id, number> = {};
      let skipped = 0;
      const shared = refs.filter((r) => r.refType === 'dataFunction' || r.refType === 'externalEntity');
      // 置くものを先に決める（何も置かないときは履歴を積まない）
      const todo: { featureId: Id; ref: EntityRef }[] = [];
      for (const fid of targetFeatureIds) {
        const f = doc.features[fid];
        if (!f) continue;
        const swId = softwareIdOfFeature(doc, fid);
        placed[fid] = 0;
        for (const r of shared) {
          const entity = r.refType === 'dataFunction' ? doc.dataFunctions[r.refId] : doc.externalEntities[r.refId];
          // 別のソフトウェアの要素と、置き済みの要素は飛ばす
          if (!entity || entity.softwareId !== swId || f.dfd.nodes.some((n) => n.refType === r.refType && n.refId === r.refId)) {
            skipped += 1;
            continue;
          }
          todo.push({ featureId: fid, ref: r });
          placed[fid] += 1;
        }
      }
      if (todo.length) {
        mutate((d) => {
          for (const { featureId, ref } of todo) {
            const nodes = d.features[featureId].dfd.nodes;
            const pos = freePosition(d, nodes, ref.refType, ref.refId);
            nodes.push({ id: newId(), refType: ref.refType, refId: ref.refId, x: pos.x, y: pos.y });
          }
        });
      }
      return { placed, skipped };
    },
    applyTextReplacements: (changes) => {
      if (!changes.length) return;
      mutate((d) => {
        for (const c of changes) {
          if (c.target === 'edge') {
            const e = d.features[c.featureId]?.dfd.edges.find((x) => x.id === c.edgeId);
            if (e) e.label = c.value;
            continue;
          }
          const table = {
            dataFunction: d.dataFunctions,
            transactionFunction: d.transactionFunctions,
            nonCountedProcess: d.nonCountedProcesses,
            externalEntity: d.externalEntities,
          }[c.refType] as Record<Id, { name: string; description: string }>;
          const entity = table[c.refId];
          if (entity) entity[c.field] = c.value;
        }
      });
    },
    splitExternalEntityNode: (featureId, nodeId) => {
      const dfd = get().doc.features[featureId]?.dfd;
      const node = dfd?.nodes.find((n) => n.id === nodeId);
      if (!dfd || !node || node.refType !== 'externalEntity') return { ok: false, reason: '外部エンティティを選んでください。' };
      const incoming = dfd.edges.filter((e) => e.targetNodeId === nodeId);
      const outgoing = dfd.edges.filter((e) => e.sourceNodeId === nodeId);
      if (!incoming.length || !outgoing.length) {
        return { ok: false, reason: '入力と出力の両方のデータフローがあるときに分けられます。' };
      }
      const newNodeId = newId();
      mutate((d) => {
        const g = d.features[featureId].dfd;
        const right = Math.max(...g.nodes.map((n) => n.x + sizeOf(d, n).width));
        const pos = freePosition(d, g.nodes, 'externalEntity', node.refId, { x: right + 80, y: node.y });
        g.nodes.push({ id: newNodeId, refType: 'externalEntity', refId: node.refId, x: pos.x, y: pos.y });
        const ids = new Set(incoming.map((e) => e.id));
        for (const e of g.edges) if (ids.has(e.id)) e.targetNodeId = newNodeId;
      });
      return { ok: true, id: newNodeId };
    },
    replaceWithReference: ({ featureId, nodeId, toRefId, scope, removeOriginal }) => {
      const doc = get().doc;
      const node = doc.features[featureId]?.dfd.nodes.find((n) => n.id === nodeId);
      if (!node || (node.refType !== 'dataFunction' && node.refType !== 'externalEntity')) {
        return { ok: false, reason: 'データファンクションか外部エンティティを選んでください。' };
      }
      const { refType, refId: fromRefId } = node;
      const swOf = (id: Id) => (refType === 'dataFunction' ? doc.dataFunctions[id]?.softwareId : doc.externalEntities[id]?.softwareId);
      if (fromRefId === toRefId || !swOf(toRefId) || swOf(toRefId) !== swOf(fromRefId)) {
        return { ok: false, reason: '同じソフトウェアの別の要素を選んでください。' };
      }
      let removed = false;
      mutate((d) => {
        const featureIds = scope === 'all' ? Object.keys(d.features) : [featureId];
        for (const fid of featureIds) {
          const dfd = d.features[fid].dfd;
          const targets = dfd.nodes.filter((n) => n.refType === refType && n.refId === fromRefId && (scope === 'all' || n.id === nodeId));
          const existing = dfd.nodes.find((n) => n.refType === refType && n.refId === toRefId);
          for (const n of targets) {
            if (canPlaceMultiple(refType) || !existing) {
              n.refId = toRefId;
              continue;
            }
            // データファンクションは置き換え先のノードへ統合する。自己ループと同じ向き・ラベルの重複は捨てる
            for (const e of dfd.edges) {
              if (e.sourceNodeId === n.id) e.sourceNodeId = existing.id;
              if (e.targetNodeId === n.id) e.targetNodeId = existing.id;
            }
            const seen = new Set<string>();
            dfd.edges = dfd.edges.filter((e) => {
              const key = `${e.sourceNodeId}>${e.targetNodeId}:${e.label}`;
              if (e.sourceNodeId === e.targetNodeId || seen.has(key)) return false;
              seen.add(key);
              return true;
            });
            dfd.nodes = dfd.nodes.filter((x) => x.id !== n.id);
          }
        }
        const stillPlaced = Object.values(d.features).some((f) => f.dfd.nodes.some((n) => n.refType === refType && n.refId === fromRefId));
        if (removeOriginal && !stillPlaced) {
          deleteEntityOnDraft(d, refType, fromRefId);
          removed = true;
        }
      });
      return { ok: true, removed };
    },
    updateEdgeLabel: (featureId, edgeId, label) =>
      mutate((d) => {
        const e = d.features[featureId].dfd.edges.find((x) => x.id === edgeId);
        if (e) e.label = label;
      }),
    removeEdges: (featureId, edgeIds) =>
      mutate((d) => {
        const ids = new Set(edgeIds);
        const dfd = d.features[featureId].dfd;
        dfd.edges = dfd.edges.filter((e) => !ids.has(e.id));
      }),
    applyLayout: (featureId) => mutate((d) => layoutOnDraft(d, featureId)),
    deleteSelection: (featureId, nodeIds, edgeIds, mode) => {
      const skipped: string[] = [];
      const state = get();
      const nodes = state.doc.features[featureId].dfd.nodes.filter((n) => nodeIds.includes(n.id));
      mutate((d, s) => {
        const dfd = d.features[featureId].dfd;
        const eids = new Set(edgeIds);
        dfd.edges = dfd.edges.filter((e) => !eids.has(e.id));
        for (const n of nodes) {
          if (n.refType === 'transactionFunction' || n.refType === 'nonCountedProcess') {
            deleteEntityOnDraft(d, n.refType, n.refId);
          } else if (mode === 'unplace') {
            removeNodesFromDfd(d, featureId, (x) => x.id === n.id);
          } else {
            const blockers = blockingReferences(d, n.refType, n.refId, featureId);
            if (blockers) {
              const name = n.refType === 'dataFunction' ? d.dataFunctions[n.refId]?.name : d.externalEntities[n.refId]?.name;
              skipped.push(name ?? '');
              removeNodesFromDfd(d, featureId, (x) => x.id === n.id);
            } else {
              deleteEntityOnDraft(d, n.refType, n.refId);
            }
          }
        }
        s.selectedNodeIds = [];
        s.selectedEdgeId = null;
      });
      return { skipped };
    },
    pasteNodes: (featureId, clipboard) => {
      const doc = get().doc;
      if (softwareIdOfFeature(doc, featureId) !== clipboard.softwareId) {
        return { ok: false, reason: '別のソフトウェアへは貼り付けできません。' };
      }
      const idMap = new Map<Id, Id>();
      mutate((d, s) => {
        const swId = clipboard.softwareId;
        const dfd = d.features[featureId].dfd;
        for (const n of clipboard.nodes) {
          let refId = n.refId;
          if (n.refType === 'transactionFunction') {
            const src = d.transactionFunctions[n.refId];
            if (!src) continue;
            refId = newId();
            d.transactionFunctions[refId] = { ...src, id: refId, featureId, displayNo: nextDisplayNo(d, swId, 'TF') };
          } else if (n.refType === 'nonCountedProcess') {
            const src = d.nonCountedProcesses[n.refId];
            if (!src) continue;
            refId = newId();
            d.nonCountedProcesses[refId] = { ...src, id: refId, featureId };
          } else if (!canPlaceMultiple(n.refType) && dfd.nodes.some((x) => x.refType === n.refType && x.refId === n.refId)) {
            continue; // DF は参照配置。配置済みならスキップ（外部エンティティは複数配置できる）
          } else if (n.refType === 'dataFunction' ? !d.dataFunctions[n.refId] : !d.externalEntities[n.refId]) {
            continue;
          }
          const nodeId = newId();
          idMap.set(n.id, nodeId);
          dfd.nodes.push({ id: nodeId, refType: n.refType, refId, x: n.x + 40, y: n.y + 40 });
        }
        for (const e of clipboard.edges) {
          const a = idMap.get(e.sourceNodeId);
          const b = idMap.get(e.targetNodeId);
          if (a && b) dfd.edges.push({ id: newId(), sourceNodeId: a, targetNodeId: b, label: e.label });
        }
        s.selectedNodeIds = [...idMap.values()];
      });
      return idMap.size ? { ok: true } : { ok: false, reason: '貼り付けられる要素がありません（配置済みの要素は貼り付けません）。' };
    },
  };
}

export function initialDocument(): FpDocument {
  return emptyDocument();
}

export type { ActionResult };
