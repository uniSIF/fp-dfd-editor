import { describe, expect, it } from 'vitest';
import { sampleDocument } from '../domain/sampleDocument';
import { createAppStore, redo, undo } from './index';
import { selectFeatureFunctions, selectFeatureResult, selectIsDirty } from './selectors';

function setup() {
  const store = createAppStore(sampleDocument());
  store.temporal.getState().clear();
  return store;
}

describe('store', () => {
  it('removeFeature: 所有 DF は所有機能未設定になり、他機能からの参照は残る（FR-CT-04）', () => {
    const store = setup();
    store.getState().removeFeature('fItem');
    const doc = store.getState().doc;
    expect(doc.features.fItem).toBeUndefined();
    expect(doc.dataFunctions.df2.ownerFeatureId).toBeNull();
    expect(doc.features.fReg.dfd.nodes.some((n) => n.refId === 'df2')).toBe(true);
    expect(doc.transactionFunctions.tf6).toBeUndefined();
    expect(doc.category2s.c2b.featureIds).toEqual([]);
  });

  it('removeVendor: 使用中の機能の業者を未選択にする（FR-PJ-05）', () => {
    const store = setup();
    store.getState().removeVendor('vA');
    const doc = store.getState().doc;
    expect(doc.features.fReg.vendorId).toBeNull();
    expect(doc.softwares.sw1.vendorIds).toEqual(['vB']);
  });

  it('Undo / Redo は doc と revision を戻し、UI 状態は戻さない（FR-DF-10）', () => {
    const store = setup();
    store.getState().selectFeature('fReg');
    store.getState().updateFeature('fReg', { name: '顧客新規登録' });
    expect(selectIsDirty(store.getState())).toBe(true);
    undo(store);
    expect(store.getState().doc.features.fReg.name).toBe('顧客登録');
    expect(store.getState().selectedFeatureId).toBe('fReg');
    expect(selectIsDirty(store.getState())).toBe(false);
    redo(store);
    expect(store.getState().doc.features.fReg.name).toBe('顧客新規登録');
  });

  it('UI 状態の変更は履歴に積まない', () => {
    const store = setup();
    store.getState().selectFeature('fReg');
    store.getState().setActiveTab('summary');
    expect(store.temporal.getState().pastStates).toHaveLength(0);
  });

  it('表で追加したファンクションは DFD に自動配置され、計算に反映される（FR-FN-09、FR-DF-09）', () => {
    const store = setup();
    const id = store.getState().addTransactionFunction({ featureId: 'fReg', name: '登録エラー通知', kind: 'EO', complexity: 'low', place: true });
    const s = store.getState();
    expect(s.doc.transactionFunctions[id].displayNo).toBe('TF-007');
    expect(s.doc.features.fReg.dfd.nodes.some((n) => n.refId === id)).toBe(true);
    expect(selectFeatureResult(s.doc, 'fReg')!.unadjustedFp).toBe(25);
    expect(selectFeatureFunctions(s.doc, 'fReg').some((r) => r.refId === id && r.placed)).toBe(true);
  });

  it('同じ実体を同一 DFD に二重配置できない（FR-DF-03）', () => {
    const store = setup();
    const r = store.getState().placeNode('fReg', 'dataFunction', 'df1');
    expect(r.ok).toBe(false);
    expect(store.getState().placeNode('fSearch', 'dataFunction', 'df1').ok).toBe(true);
  });

  it('接続ルール違反のエッジは作らない（FR-DF-06）', () => {
    const store = setup();
    const r = store.getState().addEdge('fReg', 'n1', 'n5'); // 外部エンティティ → データストア
    expect(r.ok).toBe(false);
    expect(store.getState().doc.features.fReg.dfd.edges).toHaveLength(7);
  });

  it('他機能から参照されている DF は削除できない（FR-DF-08）', () => {
    const store = setup();
    // df2（所有: 商品登録）は顧客登録から参照されている
    const r = store.getState().removeEntity('dataFunction', 'df2', 'fItem');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain('顧客登録');
    // 顧客登録から見た削除は自分の参照なので可能
    expect(store.getState().removeEntity('dataFunction', 'df2', 'fReg').ok).toBe(true);
    expect(store.getState().doc.features.fItem.dfd.nodes).toHaveLength(0);
  });

  it('deleteSelection は 1 履歴で、TF は実体ごと、DF は配置解除', () => {
    const store = setup();
    store.getState().deleteSelection('fReg', ['n2', 'n5'], [], 'unplace');
    const doc = store.getState().doc;
    expect(doc.transactionFunctions.tf1).toBeUndefined();
    expect(doc.dataFunctions.df1).toBeDefined();
    expect(doc.features.fReg.dfd.nodes.map((n) => n.id)).toEqual(['n1', 'n3', 'n4', 'n6']);
    expect(store.temporal.getState().pastStates).toHaveLength(1);
  });

  it('pasteNodes: TF は複製、DF は参照配置。別ソフトウェアは拒否', () => {
    const store = setup();
    const doc = store.getState().doc;
    const nodes = doc.features.fReg.dfd.nodes.filter((n) => n.id === 'n2' || n.id === 'n5');
    const edges = doc.features.fReg.dfd.edges.filter((e) => e.id === 'e2');
    const r = store.getState().pasteNodes('fSearch', { softwareId: 'sw1', nodes, edges });
    expect(r.ok).toBe(true);
    const after = store.getState().doc;
    expect(after.features.fSearch.dfd.nodes).toHaveLength(2);
    expect(after.features.fSearch.dfd.edges).toHaveLength(1);
    expect(Object.values(after.transactionFunctions).filter((t) => t.featureId === 'fSearch')).toHaveLength(3);
    expect(store.getState().pasteNodes('fSearch', { softwareId: 'other', nodes, edges }).ok).toBe(false);
  });

  it('addFeature はソフトウェアの既定値を C1〜C14 にコピーする（FR-CT-05）', () => {
    const store = setup();
    const id = store.getState().addFeature('c2a', '新機能');
    const f = store.getState().doc.features[id];
    expect(f.characteristics).toEqual([3, 2, 3, 2, 1, 2, 3, 2, 1, 1, 2, 3, 2, 1]);
    expect(f.devType).toBe('new');
    expect(store.getState().selectedFeatureId).toBe(id);
  });

  it('applyLayout は 1 回の Undo で元に戻る', () => {
    const store = setup();
    const before = store.getState().doc.features.fReg.dfd.nodes.map((n) => [n.x, n.y]);
    store.getState().applyLayout('fReg');
    undo(store);
    expect(store.getState().doc.features.fReg.dfd.nodes.map((n) => [n.x, n.y])).toEqual(before);
  });

  it('connectEntities: 未配置の実体は自動配置し、配置と接続を 1 履歴にする（FR-FN-15）', () => {
    const store = setup();
    // 顧客検索（fSearch）の DFD は空。TF-004 → TF-005 を接続
    const r = store.getState().connectEntities('fSearch', { refType: 'transactionFunction', refId: 'tf4' }, { refType: 'transactionFunction', refId: 'tf5' }, '照会結果');
    expect(r.ok).toBe(true);
    const dfd = store.getState().doc.features.fSearch.dfd;
    expect(dfd.nodes.map((n) => n.refId).sort()).toEqual(['tf4', 'tf5']);
    expect(dfd.edges).toHaveLength(1);
    expect(dfd.edges[0].label).toBe('照会結果');
    expect(store.temporal.getState().pastStates).toHaveLength(1);
    undo(store);
    expect(store.getState().doc.features.fSearch.dfd.nodes).toHaveLength(0);
  });

  it('connectEntities: 配置済みの実体は既存ノードを使い、接続ルール違反は拒否する', () => {
    const store = setup();
    const ok = store.getState().connectEntities('fReg', { refType: 'dataFunction', refId: 'df1' }, { refType: 'transactionFunction', refId: 'tf2' });
    expect(ok.ok).toBe(true);
    const dfd = store.getState().doc.features.fReg.dfd;
    expect(dfd.nodes).toHaveLength(6);
    expect(dfd.edges.at(-1)).toMatchObject({ sourceNodeId: 'n5', targetNodeId: 'n3' });
    const ng = store.getState().connectEntities('fReg', { refType: 'externalEntity', refId: 'ee1' }, { refType: 'dataFunction', refId: 'df1' });
    expect(ng.ok).toBe(false);
  });

  it('外部エンティティは同じ DFD に複数配置でき、表では 1 行にまとまる（FR-DF-18）', () => {
    const store = setup();
    expect(store.getState().placeNode('fReg', 'externalEntity', 'ee1').ok).toBe(true);
    const doc = store.getState().doc;
    expect(doc.features.fReg.dfd.nodes.filter((n) => n.refId === 'ee1')).toHaveLength(2);
    const rows = selectFeatureFunctions(doc, 'fReg').filter((r) => r.refId === 'ee1');
    expect(rows).toHaveLength(1);
    expect(rows[0].nodeIds).toHaveLength(2);
    // データファンクションはこれまでどおり 1 回まで
    expect(store.getState().placeNode('fReg', 'dataFunction', 'df1').ok).toBe(false);
  });

  it('splitExternalEntityNode: 入ってくるデータフローを右端の新しいノードへ付け替える（FR-DF-18）', () => {
    const store = setup();
    // 利用者(n1): 出力 e1(→n2)・e5(→n4)、入力 e4(n3→)
    const r = store.getState().splitExternalEntityNode('fReg', 'n1');
    expect(r.ok).toBe(true);
    const dfd = store.getState().doc.features.fReg.dfd;
    const added = dfd.nodes.find((n) => n.id === (r.ok && r.id))!;
    expect(added).toMatchObject({ refType: 'externalEntity', refId: 'ee1' });
    expect(added.x).toBeGreaterThan(Math.max(...dfd.nodes.filter((n) => n.id !== added.id).map((n) => n.x)));
    expect(dfd.edges.find((e) => e.id === 'e4')!.targetNodeId).toBe(added.id);
    expect(dfd.edges.filter((e) => e.sourceNodeId === 'n1').map((e) => e.id)).toEqual(['e1', 'e5']);
    expect(dfd.edges.some((e) => e.targetNodeId === 'n1')).toBe(false);
    expect(store.temporal.getState().pastStates).toHaveLength(1);
    // 入力または出力しかないノードは分けられない
    expect(store.getState().splitExternalEntityNode('fReg', added.id).ok).toBe(false);
  });

  it('connectEntities: 外部エンティティが複数あるとき、入力元は左端・出力先は右端のノードを使う', () => {
    const store = setup();
    const r = store.getState().splitExternalEntityNode('fReg', 'n1');
    const right = r.ok ? r.id! : '';
    store.getState().connectEntities('fReg', { refType: 'transactionFunction', refId: 'tf3' }, { refType: 'externalEntity', refId: 'ee1' }, '照会結果');
    store.getState().connectEntities('fReg', { refType: 'externalEntity', refId: 'ee1' }, { refType: 'transactionFunction', refId: 'tf2' }, '再送依頼');
    const edges = store.getState().doc.features.fReg.dfd.edges;
    expect(edges.find((e) => e.label === '照会結果')!.targetNodeId).toBe(right);
    expect(edges.find((e) => e.label === '再送依頼')!.sourceNodeId).toBe('n1');
  });
});
