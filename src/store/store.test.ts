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

  it('分類と機能の並べ替え・別の親への移動（FR-CT-02）', () => {
    const store = setup();
    // 大分類の並べ替え
    store.getState().moveCategory('c1b', 0);
    expect(store.getState().doc.softwares.sw1.category1Ids).toEqual(['c1b', 'c1a']);
    // 中分類を別の大分類へ
    store.getState().moveCategory('c2b', 0, 'c1a');
    let doc = store.getState().doc;
    expect(doc.category1s.c1a.category2Ids).toEqual(['c2b', 'c2a']);
    expect(doc.category1s.c1b.category2Ids).toEqual([]);
    expect(doc.category2s.c2b.category1Id).toBe('c1a');
    // 機能を同じ中分類内で並べ替え・別の中分類へ
    store.getState().moveFeature('fSearch', 'c2a', 0);
    expect(store.getState().doc.category2s.c2a.featureIds).toEqual(['fSearch', 'fReg']);
    store.getState().moveFeature('fReg', 'c2b', 1);
    doc = store.getState().doc;
    expect(doc.category2s.c2b.featureIds).toEqual(['fItem', 'fReg']);
    expect(doc.features.fReg.category2Id).toBe('c2b');
    // 1 回の Undo で 1 操作ずつ戻る
    undo(store);
    expect(store.getState().doc.features.fReg.category2Id).toBe('c2a');
  });

  it('別のソフトウェアへの分類・機能の移動はしない', () => {
    const store = setup();
    const sw2 = store.getState().addSoftware('別システム');
    const c1 = store.getState().addCategory1(sw2, '大');
    const c2 = store.getState().addCategory2(c1, '中');
    store.getState().moveCategory('c2a', 0, c1);
    store.getState().moveFeature('fReg', c2, 0);
    const doc = store.getState().doc;
    expect(doc.category2s.c2a.category1Id).toBe('c1a');
    expect(doc.features.fReg.category2Id).toBe('c2a');
    // 拒否した移動・並びが変わらない移動では履歴を積まない
    const before = store.temporal.getState().pastStates.length;
    store.getState().moveFeature('fReg', 'c2a', 0);
    store.getState().moveCategory('c1a', 0);
    expect(store.temporal.getState().pastStates.length).toBe(before);
  });

  it('copyDfdToFeature: TF は複製、DF は参照、外部エンティティは同じものを配置する（FR-DF-20）', () => {
    const store = setup();
    const r = store.getState().copyDfdToFeature('fReg', 'fSearch', { dataFunctions: 'reference' });
    expect(r.ok).toBe(true);
    const doc = store.getState().doc;
    const dfd = doc.features.fSearch.dfd;
    expect(dfd.nodes).toHaveLength(6);
    expect(dfd.edges).toHaveLength(7);
    // TF 3 件が新しい番号で fSearch に属する
    const tfs = Object.values(doc.transactionFunctions).filter((t) => t.featureId === 'fSearch');
    expect(tfs.map((t) => t.name).sort()).toEqual(['登録完了通知', '顧客検索', '顧客照会', '顧客登録入力', '顧客詳細照会'].sort());
    expect(tfs.find((t) => t.name === '顧客登録入力')!.displayNo).toBe('TF-007');
    // DF は参照（新しい DF を作らない）、外部エンティティは同じ実体
    expect(Object.keys(doc.dataFunctions)).toHaveLength(2);
    expect(dfd.nodes.filter((n) => n.refType === 'dataFunction').map((n) => n.refId).sort()).toEqual(['df1', 'df2']);
    expect(dfd.nodes.find((n) => n.refType === 'externalEntity')!.refId).toBe('ee1');
    expect(r.ok && r.created).toHaveLength(3);
    // 1 回の Undo で戻る
    expect(store.temporal.getState().pastStates).toHaveLength(1);
    undo(store);
    expect(store.getState().doc.features.fSearch.dfd.nodes).toHaveLength(0);
  });

  it('copyDfdToFeature: DF を複製するとコピー先が所有し、他機能所有の DF は参照のまま', () => {
    const store = setup();
    const r = store.getState().copyDfdToFeature('fReg', 'fSearch', { dataFunctions: 'duplicate' });
    const doc = store.getState().doc;
    const owned = Object.values(doc.dataFunctions).filter((d) => d.ownerFeatureId === 'fSearch');
    expect(owned.map((d) => [d.name, d.displayNo])).toEqual([['顧客マスタ', 'DF-003']]);
    // 商品マスタ（所有: 商品登録）は参照のまま
    expect(doc.features.fSearch.dfd.nodes.some((n) => n.refId === 'df2')).toBe(true);
    expect(r.ok && r.created.filter((c) => c.refType === 'dataFunction')).toHaveLength(1);
  });

  it('copyDfdToFeature: 既存ノードの右側に置き、別ソフトウェア・同じ機能・空の DFD は拒否する', () => {
    const store = setup();
    store.getState().copyDfdToFeature('fReg', 'fItem', { dataFunctions: 'reference' });
    const nodes = store.getState().doc.features.fItem.dfd.nodes;
    // 商品マスタは既に fItem に配置済みなので増やさない（1 + 5）
    expect(nodes).toHaveLength(6);
    const original = nodes.find((n) => n.id === 'm1')!;
    expect(Math.min(...nodes.filter((n) => n.id !== 'm1').map((n) => n.x))).toBeGreaterThan(original.x + 180);
    expect(store.getState().copyDfdToFeature('fReg', 'fReg', { dataFunctions: 'reference' }).ok).toBe(false);
    expect(store.getState().copyDfdToFeature('fSearch', 'fReg', { dataFunctions: 'reference' }).ok).toBe(false);
  });

  it('文言置換: 候補を作り、1 履歴で反映する（FR-FN-17）', async () => {
    const { planTextReplacements } = await import('../domain/textReplace');
    const store = setup();
    const r = store.getState().copyDfdToFeature('fReg', 'fSearch', { dataFunctions: 'reference' });
    const scope = r.ok ? { refIds: new Set(r.created.map((c) => c.refId)), edgeIds: new Set(r.edgeIds) } : undefined;
    const doc = store.getState().doc;
    const plan = planTextReplacements(doc, 'fSearch', '登録', '変更', { name: true, description: true, edgeLabels: true }, scope);
    // コピーで作ったものだけ（元からある「顧客照会」などは含まない）
    expect(plan.map((p) => [p.field, p.before, p.after])).toEqual(expect.arrayContaining([
      ['name', '顧客登録入力', '顧客変更入力'],
      ['name', '登録完了通知', '変更完了通知'],
      ['label', '登録情報', '変更情報'],
    ]));
    expect(plan.every((p) => p.after.indexOf('登録') === -1)).toBe(true);
    // 外部エンティティ・参照 DF は対象外
    expect(planTextReplacements(doc, 'fReg', '利用者', 'x', { name: true, description: false, edgeLabels: false })).toEqual([]);
    store.getState().applyTextReplacements(plan.map((p) =>
      p.target === 'edge'
        ? { target: 'edge' as const, featureId: 'fSearch', edgeId: p.edgeId!, value: p.after }
        : { target: 'entity' as const, refType: p.refType!, refId: p.refId!, field: p.field as 'name' | 'description', value: p.after }));
    const names = Object.values(store.getState().doc.transactionFunctions).filter((t) => t.featureId === 'fSearch').map((t) => t.name);
    expect(names).toContain('顧客変更入力');
    // コピー元は変わらない
    expect(store.getState().doc.transactionFunctions.tf1.name).toBe('顧客登録入力');
    undo(store);
    expect(Object.values(store.getState().doc.transactionFunctions).filter((t) => t.featureId === 'fSearch').map((t) => t.name)).toContain('顧客登録入力');
  });
  it('replaceWithReference: 重複した外部エンティティをすべての DFD で既存のものへ置き換え、元を削除する（FR-DF-22）', () => {
    const store = setup();
    const s = store.getState();
    // 誤って別 ID で追加した「利用者」を 2 つの機能に置く
    const dupId = s.addExternalEntity({ featureId: 'fReg', name: '利用者', place: true });
    const regNode = store.getState().doc.features.fReg.dfd.nodes.find((n) => n.refId === dupId)!;
    store.getState().addEdge('fReg', regNode.id, 'n4', '検索条件2');
    store.getState().placeNode('fItem', 'externalEntity', dupId);
    store.temporal.getState().clear();

    const r = store.getState().replaceWithReference({ featureId: 'fReg', nodeId: regNode.id, toRefId: 'ee1', scope: 'all', removeOriginal: true });
    expect(r).toEqual({ ok: true, removed: true });
    const doc = store.getState().doc;
    expect(doc.externalEntities[dupId]).toBeUndefined();
    // ノード ID とデータフローはそのまま、参照先だけが変わる
    expect(doc.features.fReg.dfd.nodes.find((n) => n.id === regNode.id)?.refId).toBe('ee1');
    expect(doc.features.fReg.dfd.edges.some((e) => e.sourceNodeId === regNode.id && e.label === '検索条件2')).toBe(true);
    expect(doc.features.fItem.dfd.nodes.filter((n) => n.refId === 'ee1')).toHaveLength(1);
    // 1 回の Undo で戻る
    undo(store);
    expect(store.getState().doc.externalEntities[dupId]).toBeDefined();
    expect(store.getState().doc.features.fItem.dfd.nodes.some((n) => n.refId === dupId)).toBe(true);
  });

  it('replaceWithReference: この DFD だけ置き換えると、他の DFD に残る元の要素は削除しない', () => {
    const store = setup();
    const dupId = store.getState().addExternalEntity({ featureId: 'fReg', name: '利用者', place: true });
    store.getState().placeNode('fItem', 'externalEntity', dupId);
    const nodeId = store.getState().doc.features.fReg.dfd.nodes.find((n) => n.refId === dupId)!.id;
    const r = store.getState().replaceWithReference({ featureId: 'fReg', nodeId, toRefId: 'ee1', scope: 'node', removeOriginal: true });
    expect(r).toEqual({ ok: true, removed: false });
    expect(store.getState().doc.externalEntities[dupId]).toBeDefined();
    expect(store.getState().doc.features.fItem.dfd.nodes.some((n) => n.refId === dupId)).toBe(true);
  });

  it('replaceWithReference: 配置済みのデータファンクションへはノードを統合し、FP の二重計上をなくす', () => {
    const store = setup();
    // fReg に「商品マスタ」を別 ID（fReg 所有）で追加してしまった
    const dupId = store.getState().addDataFunction({ featureId: 'fReg', name: '商品マスタ', kind: 'ILF', complexity: 'low', place: true });
    const dupNode = store.getState().doc.features.fReg.dfd.nodes.find((n) => n.refId === dupId)!;
    store.getState().addEdge('fReg', dupNode.id, 'n4', '商品情報'); // n6 → n4「商品情報」と重複
    store.getState().addEdge('fReg', 'n2', dupNode.id, '商品コード');
    const before = selectFeatureResult(store.getState().doc, 'fReg')!.unadjustedFp;

    const r = store.getState().replaceWithReference({ featureId: 'fReg', nodeId: dupNode.id, toRefId: 'df2', scope: 'all', removeOriginal: true });
    expect(r).toEqual({ ok: true, removed: true });
    const dfd = store.getState().doc.features.fReg.dfd;
    expect(dfd.nodes.some((n) => n.id === dupNode.id)).toBe(false);
    expect(dfd.nodes.filter((n) => n.refId === 'df2')).toHaveLength(1);
    expect(dfd.edges.filter((e) => e.sourceNodeId === 'n6' && e.targetNodeId === 'n4')).toHaveLength(1);
    expect(dfd.edges.some((e) => e.sourceNodeId === 'n2' && e.targetNodeId === 'n6' && e.label === '商品コード')).toBe(true);
    expect(selectFeatureResult(store.getState().doc, 'fReg')!.unadjustedFp).toBe(before - 7);
  });

  it('replaceWithReference: 自分自身・別種の要素、TF のノードは拒否する', () => {
    const store = setup();
    const s = store.getState();
    expect(s.replaceWithReference({ featureId: 'fReg', nodeId: 'n1', toRefId: 'ee1', scope: 'all', removeOriginal: true }).ok).toBe(false);
    expect(s.replaceWithReference({ featureId: 'fReg', nodeId: 'n1', toRefId: 'df1', scope: 'all', removeOriginal: true }).ok).toBe(false);
    expect(s.replaceWithReference({ featureId: 'fReg', nodeId: 'n2', toRefId: 'tf2', scope: 'all', removeOriginal: true }).ok).toBe(false);
  });
  const noReplace = { find: '', replace: '', name: true, description: false, edgeLabels: true };

  it('copyFunctions: 同じ機能へ選んだ要素を文言を置換して複製し、データフローも再現する（FR-FN-18）', () => {
    const store = setup();
    const r = store.getState().copyFunctions({
      sourceFeatureId: 'fReg', targetFeatureId: 'fReg', includeEdges: true,
      refs: [{ refType: 'externalEntity', refId: 'ee1' }, { refType: 'transactionFunction', refId: 'tf1' }, { refType: 'dataFunction', refId: 'df1' }],
      replace: { find: '顧客', replace: '取引先', name: true, description: false, edgeLabels: true },
    });
    if (!r.ok) throw new Error(r.reason);
    const doc = store.getState().doc;
    // TF と所有 DF は新しい番号で複製、外部エンティティは共有のまま
    expect(r.created.map((c) => c.refType).sort()).toEqual(['dataFunction', 'transactionFunction']);
    const tf = doc.transactionFunctions[r.created.find((c) => c.refType === 'transactionFunction')!.refId];
    expect(tf).toMatchObject({ name: '取引先登録入力', kind: 'EI', complexity: 'medium', featureId: 'fReg', displayNo: 'TF-007' });
    expect(tf.description).toBe(doc.transactionFunctions.tf1.description);
    const df = doc.dataFunctions[r.created.find((c) => c.refType === 'dataFunction')!.refId];
    expect(df).toMatchObject({ name: '取引先マスタ', ownerFeatureId: 'fReg', displayNo: 'DF-003' });
    expect(doc.externalEntities.ee1.name).toBe('利用者');
    // 新しいノードは 2 つ（外部エンティティは既存ノード n1 を使う）
    const dfd = doc.features.fReg.dfd;
    expect(r.nodeIds).toHaveLength(2);
    const tfNode = dfd.nodes.find((n) => n.refId === tf.id)!;
    const dfNode = dfd.nodes.find((n) => n.refId === df.id)!;
    // n1 → n2「登録情報」、n2 → n5「顧客データ」が新しいノードの間に再現される
    expect(dfd.edges.some((e) => e.sourceNodeId === 'n1' && e.targetNodeId === tfNode.id && e.label === '登録情報')).toBe(true);
    expect(dfd.edges.some((e) => e.sourceNodeId === tfNode.id && e.targetNodeId === dfNode.id && e.label === '取引先データ')).toBe(true);
    expect(r.edgeIds).toHaveLength(2);
    // 元の要素は変わらない。1 回の Undo で戻る
    expect(doc.transactionFunctions.tf1.name).toBe('顧客登録入力');
    undo(store);
    expect(store.getState().doc.transactionFunctions[tf.id]).toBeUndefined();
    expect(store.getState().doc.features.fReg.dfd.nodes).toHaveLength(6);
  });

  it('copyFunctions: 別の機能へコピーすると共有の要素はコピー先に置き、他機能所有の DF は参照のまま', () => {
    const store = setup();
    const r = store.getState().copyFunctions({
      sourceFeatureId: 'fReg', targetFeatureId: 'fSearch', includeEdges: false,
      refs: [{ refType: 'externalEntity', refId: 'ee1' }, { refType: 'dataFunction', refId: 'df2' }, { refType: 'transactionFunction', refId: 'tf3' }],
      replace: noReplace,
    });
    if (!r.ok) throw new Error(r.reason);
    const doc = store.getState().doc;
    expect(r.created).toHaveLength(1);
    expect(doc.dataFunctions.df2.ownerFeatureId).toBe('fItem');
    const refIds = doc.features.fSearch.dfd.nodes.map((n) => n.refId);
    expect(refIds).toContain('ee1');
    expect(refIds).toContain('df2');
    expect(refIds).toContain(r.created[0].refId);
    expect(doc.features.fSearch.dfd.edges).toHaveLength(0);
  });

  it('copyFunctions: 別のソフトウェア・空の選択は拒否する', () => {
    const store = setup();
    expect(store.getState().copyFunctions({ sourceFeatureId: 'fReg', targetFeatureId: 'fReg', refs: [], includeEdges: true, replace: noReplace }).ok).toBe(false);
    expect(store.getState().copyFunctions({ sourceFeatureId: 'fReg', targetFeatureId: 'nope', refs: [{ refType: 'transactionFunction', refId: 'tf1' }], includeEdges: true, replace: noReplace }).ok).toBe(false);
  });
  it('placeReferences: DF・外部エンティティを ID はそのままで複数の DFD に参照配置し、TF と配置済みは飛ばす（FR-FN-19）', () => {
    const store = setup();
    const refs = [
      { refType: 'externalEntity' as const, refId: 'ee1' },
      { refType: 'dataFunction' as const, refId: 'df2' },
      { refType: 'transactionFunction' as const, refId: 'tf1' },
    ];
    const r = store.getState().placeReferences(['fSearch', 'fItem'], refs);
    // fItem には df2 が配置済み
    expect(r).toEqual({ placed: { fSearch: 2, fItem: 1 }, skipped: 1 });
    const doc = store.getState().doc;
    expect(doc.features.fSearch.dfd.nodes.map((n) => n.refId).sort()).toEqual(['df2', 'ee1']);
    expect(doc.features.fItem.dfd.nodes.map((n) => n.refId).sort()).toEqual(['df2', 'ee1']);
    // 実体は増えず、所有機能も変わらない
    expect(Object.keys(doc.externalEntities)).toEqual(['ee1']);
    expect(doc.dataFunctions.df2.ownerFeatureId).toBe('fItem');
    expect(doc.features.fSearch.dfd.nodes.some((n) => n.refType === 'transactionFunction')).toBe(false);
    // 1 回の Undo で戻る。すべて配置済みなら履歴を積まない
    undo(store);
    expect(store.getState().doc.features.fSearch.dfd.nodes).toHaveLength(0);
    const rev = store.getState().revision;
    expect(store.getState().placeReferences(['fItem'], [{ refType: 'dataFunction', refId: 'df2' }])).toEqual({ placed: { fItem: 0 }, skipped: 1 });
    expect(store.getState().revision).toBe(rev);
  });
});
