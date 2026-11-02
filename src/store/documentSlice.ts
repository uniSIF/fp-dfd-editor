import { layoutDfd } from '../domain/autoLayout';
import { canConnect, canConnectNodes, canPlaceMultiple, ruleKindOf } from '../domain/dfdRules';
import { findFreePosition, nodeSize } from '../domain/dfdGeometry';
import { createSoftware, emptyDocument } from '../domain/emptyDocument';
import { formatDisplayNo, newId } from '../domain/ids';
import { softwareIdOfFeature } from '../domain/queries';
import type { DfdNode, FpDocument, Id, NodeRefType } from '../domain/types';
import type { ActionResult, AppState, DocumentSlice, PlaceOption } from './types';

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

function placeOnDraft(doc: FpDocument, featureId: Id, refType: NodeRefType, refId: Id, place: PlaceOption | undefined): void {
  if (!place) return;
  const dfd = doc.features[featureId].dfd;
  if (dfd.nodes.some((n) => n.refType === refType && n.refId === refId)) return;
  const pos = place === true ? findFreePosition(dfd.nodes, refType) : findFreePosition(dfd.nodes, refType, place);
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
        const pos = findFreePosition(dfd.nodes, refType, position);
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
          const preferred = near ? { x: near.x + nodeSize(near.refType).width + 80, y: near.y } : undefined;
          const pos = findFreePosition(dfd.nodes, r.refType, preferred);
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
        const right = Math.max(...g.nodes.map((n) => n.x + nodeSize(n.refType).width));
        const pos = findFreePosition(g.nodes, 'externalEntity', { x: right + 80, y: node.y });
        g.nodes.push({ id: newNodeId, refType: 'externalEntity', refId: node.refId, x: pos.x, y: pos.y });
        const ids = new Set(incoming.map((e) => e.id));
        for (const e of g.edges) if (ids.has(e.id)) e.targetNodeId = newNodeId;
      });
      return { ok: true, id: newNodeId };
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
    applyLayout: (featureId) =>
      mutate((d) => {
        const dfd = d.features[featureId].dfd;
        const kindOf = (n: DfdNode) => (n.refType === 'dataFunction' ? d.dataFunctions[n.refId]?.kind : null);
        const pos = new Map(layoutDfd(dfd.nodes, dfd.edges, kindOf).map((p) => [p.nodeId, p]));
        for (const n of dfd.nodes) {
          const p = pos.get(n.id);
          if (p) {
            n.x = Math.round(p.x);
            n.y = Math.round(p.y);
          }
        }
      }),
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
