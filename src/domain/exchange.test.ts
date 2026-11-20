import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAppStore, undo } from '../store';
import { AGENT_INSTRUCTIONS, AGENTS, buildAgentInstructions, buildAgentRequest, FP_BOOST_INSTRUCTIONS } from './agentPrompt';
import { parseDocumentJson } from './migrations';
import { buildExchange, buildFixInstruction, featurePlanHasChanges, parseExchange, planHasChanges, planImport, type ImportData } from './exchange';
import { findBrokenReferences, repairReferences } from './integrity';
import { sampleDocument } from './sampleDocument';

const parse = (text: string): ImportData => {
  const r = parseExchange(text);
  if (!r.ok) throw new Error(r.message);
  return r.data;
};

describe('AI エージェントとの交換形式（FR-IO）', () => {
  it('複数の機能を書き出し、そのまま取り込むと変更なし', () => {
    const doc = sampleDocument();
    const ex = buildExchange(doc, ['fItem', 'fReg']);
    expect(ex).toMatchObject({ format: 'fp-dfd-exchange', version: 2 });
    // ツリーの順に並ぶ
    expect(ex.features.map((f) => f.key)).toEqual(['fReg', 'fItem']);
    const reg = ex.features[0];
    expect(reg).toMatchObject({ name: '顧客登録', category1: '顧客管理', category2: '顧客情報' });
    expect(reg.dfd.transactionFunctions.map((t) => t.key)).toEqual(['TF-001', 'TF-002', 'TF-003']);
    expect(reg.dfd.dataFlows).toContainEqual({ from: 'EE-001', to: 'TF-001', label: '登録情報' });
    // 他機能所有の DF には owner（所有機能の key）が付く
    expect(reg.dfd.dataFunctions.find((d) => d.key === 'DF-002')?.owner).toBe('fItem');
    expect(reg.dfd.dataFunctions.find((d) => d.key === 'DF-001')?.owner).toBeUndefined();
    expect(ex.catalog.categories).toEqual([{ category1: '顧客管理', category2: '顧客情報' }, { category1: '商品管理', category2: '商品情報' }]);
    expect(ex.catalog.features.map((f) => f.exported)).toEqual([true, false, true]);
    // DFD に置いていない TF は placed: false で書き出し、そのまま取り込んでも置かない
    const item = ex.features[1];
    expect(item.dfd.transactionFunctions).toEqual([expect.objectContaining({ key: 'TF-006', placed: false })]);
    const plan = planImport(doc, 'sw1', parse(JSON.stringify(ex)), { removeMissing: true });
    expect(plan.errors).toEqual([]);
    expect(planHasChanges(plan)).toBe(false);
    // データフローでつなげば置く
    item.dfd.dataFlows.push({ from: 'TF-006', to: 'DF-002', label: '商品データ' });
    const placed = planImport(doc, 'sw1', parse(JSON.stringify(ex)), { removeMissing: false });
    expect(placed.features[1].places.map((p) => p.key)).toEqual(['TF-006']);
    expect(placed.features[1].edgeAdds).toHaveLength(1);
  });

  it('参考にした機能をもとに、新しい分類・複数の新しい機能と共有の新しい DF を作れる', () => {
    const reply = `「顧客登録」「顧客検索」を参考に作りました。\n\n\`\`\`json\n${JSON.stringify({
      format: 'fp-dfd-exchange', version: 2,
      features: [
        {
          key: 'NEW-F1', name: '取引先登録', category1: '顧客管理', category2: '取引先情報', description: '取引先の新規登録', devType: '新規',
          dfd: {
            externalEntities: [{ key: 'EE-001', name: '利用者' }],
            dataFunctions: [{ key: 'NEW-1', name: '取引先マスタ', kind: 'ilf', complexity: '中', owner: 'NEW-F1' }],
            transactionFunctions: [{ key: 'NEW-2', name: '取引先登録入力', kind: 'ei', complexity: 'average', description: 'DET 12・FTR 1' }],
            dataFlows: [{ from: 'EE-001', to: 'NEW-2', label: '登録情報' }, { from: 'NEW-2', to: 'NEW-1', label: '取引先データ' }],
          },
        },
        {
          key: 'NEW-F2', path: '顧客管理 / 取引先情報 / 取引先検索',
          dfd: {
            externalEntities: [{ key: 'EE-001', name: '利用者' }],
            dataFunctions: [{ key: 'NEW-1', name: '取引先マスタ', kind: 'ILF', complexity: 'medium' }],
            transactionFunctions: [{ key: 'NEW-3', name: '取引先検索', kind: 'EQ', complexity: 'low' }],
            dataFlows: [{ from: 'EE-001', to: 'NEW-3', label: '検索条件' }, { from: 'NEW-1', to: 'NEW-3', label: '取引先情報' }, { from: 'NEW-3', to: 'EE-001', label: '検索結果' }],
          },
        },
      ],
    })}\n\`\`\``;
    const doc = sampleDocument();
    const plan = planImport(doc, 'sw1', parse(reply), { removeMissing: false });
    expect(plan.errors).toEqual([]);
    expect(plan.newCategories).toEqual([{ category1: '顧客管理', category2: '取引先情報', newCategory1: false }]);
    expect(plan.features.map((f) => [f.key, f.featureId, f.name, f.category2])).toEqual([['NEW-F1', null, '取引先登録', '取引先情報'], ['NEW-F2', null, '取引先検索', '取引先情報']]);
    // 共有の新しい DF は 1 つだけ作る
    expect(plan.creates.map((c) => c.key)).toEqual(['NEW-1', 'NEW-2', 'NEW-3']);
    expect(plan.features[0].places.map((p) => p.key)).toEqual(['EE-001']);

    const store = createAppStore(doc);
    store.temporal.getState().clear();
    const r = store.getState().applyImportPlan('sw1', plan, { layout: true });
    if (!r.ok) throw new Error(r.reason);
    const after = store.getState().doc;
    const [f1, f2] = r.featureIds.map((id) => after.features[id]);
    expect(f1).toMatchObject({ name: '取引先登録', devType: 'new', description: '取引先の新規登録' });
    expect(after.category2s[f1.category2Id].name).toBe('取引先情報');
    expect(f1.category2Id).toBe(f2.category2Id);
    expect(after.category1s[after.category2s[f1.category2Id].category1Id].name).toBe('顧客管理');
    const dfs = Object.values(after.dataFunctions).filter((d) => d.name === '取引先マスタ');
    expect(dfs).toHaveLength(1);
    expect(dfs[0]).toMatchObject({ ownerFeatureId: f1.id, kind: 'ILF', complexity: 'medium', displayNo: 'DF-003' });
    // 2 つ目の機能では参照として置かれる
    expect(f2.dfd.nodes.some((n) => n.refId === dfs[0].id)).toBe(true);
    expect(f1.dfd.edges).toHaveLength(2);
    expect(f2.dfd.edges).toHaveLength(3);
    expect(Object.values(after.transactionFunctions).find((t) => t.name === '取引先検索')?.featureId).toBe(f2.id);
    // 1 回の Undo で、分類・機能ごと戻る
    undo(store);
    expect(store.getState().doc.features[f1.id]).toBeUndefined();
    expect(Object.values(store.getState().doc.category2s).map((c) => c.name)).not.toContain('取引先情報');
  });

  it('既存の機能の変更・ラベル変更・出力にない要素の削除を差分にする', () => {
    const doc = sampleDocument();
    const ex = buildExchange(doc, ['fReg']);
    const f = ex.features[0];
    const tf1 = f.dfd.transactionFunctions.find((t) => t.key === 'TF-001')!;
    tf1.complexity = 'high';
    tf1.name = '顧客新規登録';
    f.dfd.transactionFunctions = f.dfd.transactionFunctions.filter((t) => t.key !== 'TF-003'); // 顧客検索を外す
    f.dfd.dataFlows = f.dfd.dataFlows.filter((x) => x.from !== 'TF-003' && x.to !== 'TF-003');
    f.dfd.dataFlows.find((x) => x.label === '登録情報')!.label = '顧客登録情報';
    // 他機能所有の DF の名称変更は取り込まない
    f.dfd.dataFunctions.find((d) => d.key === 'DF-002')!.name = '商品台帳';

    const keep = planImport(doc, 'sw1', parse(JSON.stringify(ex)), { removeMissing: false });
    expect(keep.features[0].removals).toEqual([]);
    expect(keep.features[0].edgeRemovals).toEqual([]);
    const plan = planImport(doc, 'sw1', parse(JSON.stringify(ex)), { removeMissing: true });
    expect(plan.errors).toEqual([]);
    expect(plan.updates).toEqual([expect.objectContaining({ key: 'TF-001', patch: { name: '顧客新規登録', complexity: 'high' } })]);
    expect(plan.warnings.some((w) => w.includes('DF-002'))).toBe(true);
    const fp = plan.features[0];
    expect(fp.edgeLabelUpdates).toEqual([expect.objectContaining({ from: 'EE-001', to: 'TF-001', before: '登録情報', label: '顧客登録情報' })]);
    expect(fp.removals).toEqual([expect.objectContaining({ key: 'TF-003', mode: 'delete' })]);
    expect(fp.edgeRemovals.map((e) => e.label).sort()).toEqual(['商品情報', '検索条件', '顧客情報']);

    const store = createAppStore(doc);
    expect(store.getState().applyImportPlan('sw1', plan, { layout: false }).ok).toBe(true);
    const after = store.getState().doc;
    expect(after.transactionFunctions.tf3).toBeUndefined();
    expect(after.transactionFunctions.tf1).toMatchObject({ name: '顧客新規登録', complexity: 'high' });
    expect(after.dataFunctions.df2.name).toBe('商品マスタ');
    expect(after.features.fReg.dfd.edges.find((e) => e.label === '顧客登録情報')).toBeDefined();
    // 出力に含まれない機能は変わらない
    expect(after.features.fItem).toEqual(doc.features.fItem);
  });

  it('データファンクションの所有機能の変更だけでも差分にして取り込み、Undo で戻る', () => {
    const doc = sampleDocument();
    // 両方の機能を書き出し、商品マスタ（fItem 所有）を顧客登録（fReg）の所有に変える
    const ex = buildExchange(doc, ['fReg', 'fItem']);
    delete ex.features[0].dfd.dataFunctions.find((d) => d.key === 'DF-002')!.owner;
    ex.features[1].dfd.dataFunctions.find((d) => d.key === 'DF-002')!.owner = 'fReg';
    const plan = planImport(doc, 'sw1', parse(JSON.stringify(ex)), { removeMissing: true });
    expect(plan.errors).toEqual([]);
    expect(plan.ownerChanges).toEqual([expect.objectContaining({ key: 'DF-002', fromFeatureId: 'fItem', toFeatureId: 'fReg', text: '所有機能「商品登録」→「顧客登録」' })]);
    expect(planHasChanges(plan)).toBe(true);
    // 所有を失う機能・得る機能のどちらも「変更なし」にしない
    expect(plan.features.map((f) => featurePlanHasChanges(f, plan))).toEqual([true, true]);
    // 所有機能の removeMissing で、所有を移した DF を削除しない
    expect(plan.features.flatMap((f) => f.removals)).toEqual([]);

    const store = createAppStore(doc);
    expect(store.getState().applyImportPlan('sw1', plan, { layout: false }).ok).toBe(true);
    expect(store.getState().doc.dataFunctions.df2.ownerFeatureId).toBe('fReg');
    undo(store);
    expect(store.getState().doc.dataFunctions.df2.ownerFeatureId).toBe('fItem');

    // 参照している機能だけを書き出し、owner を消しても所有の変更になる
    const one = buildExchange(doc, ['fReg']);
    delete one.features[0].dfd.dataFunctions.find((d) => d.key === 'DF-002')!.owner;
    expect(planImport(doc, 'sw1', parse(JSON.stringify(one)), { removeMissing: false }).ownerChanges).toEqual([expect.objectContaining({ toFeatureId: 'fReg' })]);

    // 元の所有機能の出力から外しても、所有を移す DF は削除しない（DFD から外すだけ）
    const moved = buildExchange(doc, ['fReg', 'fItem']);
    delete moved.features[0].dfd.dataFunctions.find((d) => d.key === 'DF-002')!.owner;
    moved.features[1].dfd.dataFunctions = moved.features[1].dfd.dataFunctions.filter((d) => d.key !== 'DF-002');
    moved.features[1].dfd.dataFlows = moved.features[1].dfd.dataFlows.filter((x) => x.from !== 'DF-002' && x.to !== 'DF-002');
    const movedPlan = planImport(doc, 'sw1', parse(JSON.stringify(moved)), { removeMissing: true });
    expect(movedPlan.ownerChanges).toHaveLength(1);
    expect(movedPlan.features[1].removals).toEqual([expect.objectContaining({ key: 'DF-002', mode: 'unplace' })]);
  });

  it('所有機能が機能によって食い違うときは変えずに警告し、所有機能なしの DF はそのまま返せば変更なし', () => {
    const doc = sampleDocument();
    const ex = buildExchange(doc, ['fReg', 'fItem']);
    delete ex.features[0].dfd.dataFunctions.find((d) => d.key === 'DF-002')!.owner; // 顧客登録が所有
    ex.features[1].dfd.dataFunctions.find((d) => d.key === 'DF-002')!.owner = ''; // 所有機能なし
    const plan = planImport(doc, 'sw1', parse(JSON.stringify(ex)), { removeMissing: false });
    expect(plan.ownerChanges).toEqual([]);
    expect(plan.warnings.some((w) => w.includes('DF-002') && w.includes('所有機能'))).toBe(true);

    const unowned = { ...doc, dataFunctions: { ...doc.dataFunctions, df2: { ...doc.dataFunctions.df2, ownerFeatureId: null } } };
    const round = buildExchange(unowned, ['fReg', 'fItem']);
    expect(round.features[0].dfd.dataFunctions.find((d) => d.key === 'DF-002')?.owner).toBe('');
    expect(planHasChanges(planImport(unowned, 'sw1', parse(JSON.stringify(round)), { removeMissing: true }))).toBe(false);
  });

  it('接続ルール違反・未知の key・重複・機能をまたぐ TF の key・分類のない新しい機能はエラーにする', () => {
    const doc = sampleDocument();
    const data = parse(JSON.stringify({
      features: [
        {
          key: 'fReg',
          dfd: {
            externalEntities: [{ key: 'EE-001', name: '利用者' }, { key: 'X', name: '外部システム' }],
            dataFunctions: [{ key: 'DF-001', name: '顧客マスタ', kind: 'ILF', complexity: 'low' }],
            transactionFunctions: [{ key: 'EE-001', name: '誤り', kind: 'EI', complexity: 'low' }, { key: 'TF-004', name: '顧客照会', kind: 'EQ', complexity: 'low' }, { key: 'NEW-T', name: '共有', kind: 'EI', complexity: 'low' }],
            dataFlows: [{ from: 'EE-001', to: 'DF-001' }, { from: 'X', to: 'EE-001' }, { from: 'EE-001', to: 'NOPE' }],
          },
        },
        { key: 'NEW-F1', name: '新機能', dfd: { transactionFunctions: [{ key: 'NEW-T', name: '共有', kind: 'EI', complexity: 'low' }] } },
      ],
    }));
    const plan = planImport(doc, 'sw1', data, { removeMissing: false });
    expect(plan.errors.join('\n')).toMatch(/新しい機能「新機能」の category1/);

    const data2 = { features: [data.features[0], { ...data.features[1], category1: '顧客管理', category2: '顧客情報' }] };
    const plan2 = planImport(doc, 'sw1', data2, { removeMissing: false });
    const errors = plan2.errors.join('\n');
    expect(errors).toMatch(/key「EE-001」が重複/);
    expect(errors).toMatch(/TF-004.*別の機能/);
    expect(errors).toMatch(/外部エンティティとデータストアは直接接続できません/);
    expect(errors).toMatch(/外部エンティティ同士/);
    expect(errors).toMatch(/NOPE/);
    expect(errors).toMatch(/NEW-T.*ほかの機能でも使われています/);
    const store = createAppStore(doc);
    expect(store.getState().applyImportPlan('sw1', plan2, { layout: false }).ok).toBe(false);
  });

  it('入力側と出力側に分けた外部エンティティは split で受け渡し、取り込みでも 2 か所に置く（FR-DF-18）', () => {
    const doc = sampleDocument();
    const store = createAppStore(doc);
    expect(store.getState().splitExternalEntityNode('fReg', 'n1').ok).toBe(true);
    const split = store.getState().doc;
    const ex = buildExchange(split, ['fReg']);
    expect(ex.features[0].dfd.externalEntities).toEqual([expect.objectContaining({ key: 'EE-001', split: true })]);
    // そのまま取り込むと変更なし
    expect(planHasChanges(planImport(split, 'sw1', parse(JSON.stringify(ex)), { removeMissing: true }))).toBe(false);

    // 流用して作った新しい機能でも 2 か所に置き、from は左・to は右のノードにつながる
    const body = {
      features: [{
        key: 'NEW-F1', name: '取引先登録', category1: '顧客管理', category2: '顧客情報',
        dfd: {
          externalEntities: [{ key: 'EE-001', name: '利用者', split: true }],
          transactionFunctions: [{ key: 'NEW-1', name: '取引先登録入力', kind: 'EI', complexity: 'low' }],
          dataFlows: [{ from: 'EE-001', to: 'NEW-1', label: '登録情報' }, { from: 'NEW-1', to: 'EE-001', label: '登録結果' }],
        },
      }],
    };
    const plan = planImport(split, 'sw1', parse(JSON.stringify(body)), { removeMissing: false });
    expect(plan.features[0].splitKeys).toEqual(['EE-001']);
    const r = store.getState().applyImportPlan('sw1', plan, { layout: true });
    if (!r.ok) throw new Error(r.reason);
    const f = store.getState().doc.features[r.featureIds[0]];
    const ees = f.dfd.nodes.filter((n) => n.refId === 'ee1');
    expect(ees).toHaveLength(2);
    const tf = f.dfd.nodes.find((n) => n.refType === 'transactionFunction')!;
    const [left, right] = [...ees].sort((a, b) => a.x - b.x);
    expect(left.x).toBeLessThan(tf.x);
    expect(right.x).toBeGreaterThan(tf.x);
    expect(f.dfd.edges.find((e) => e.label === '登録情報')?.sourceNodeId).toBe(left.id);
    expect(f.dfd.edges.find((e) => e.label === '登録結果')?.targetNodeId).toBe(right.id);

    // 既存の機能で 1 か所の外部エンティティに split を付けると、入ってくるデータフローを右側へ付け替える
    const ex2 = buildExchange(doc, ['fReg']);
    ex2.features[0].dfd.externalEntities[0].split = true;
    const store2 = createAppStore(doc);
    const plan2 = planImport(doc, 'sw1', parse(JSON.stringify(ex2)), { removeMissing: false });
    expect(plan2.features[0].splitKeys).toEqual(['EE-001']);
    expect(store2.getState().applyImportPlan('sw1', plan2, { layout: false }).ok).toBe(true);
    const g = store2.getState().doc.features.fReg.dfd;
    const added = g.nodes.find((n) => n.refId === 'ee1' && n.id !== 'n1')!;
    expect(g.edges.filter((e) => e.targetNodeId === added.id).map((e) => e.label)).toEqual(['完了通知']);
    expect(g.edges.filter((e) => e.sourceNodeId === 'n1').map((e) => e.label).sort()).toEqual(['検索条件', '登録情報']);
  });

  it('開発区分と外注業者を受け渡し、登録にない業者名は警告して反映しない', () => {
    const doc = sampleDocument();
    const ex = buildExchange(doc, ['fReg', 'fSearch']);
    expect(ex.features.map((f) => [f.devType, f.vendor])).toEqual([['新規', 'A社'], ['改修', 'B社']]);
    expect(ex.catalog.vendors).toEqual([{ name: 'A社' }, { name: 'B社' }]);
    const same = planImport(doc, 'sw1', parse(JSON.stringify(ex)), { removeMissing: false });
    expect(same.errors).toEqual([]); // DFD が空の機能（顧客検索）もそのまま返せる
    expect(planHasChanges(same)).toBe(false);

    // 既存の機能: 開発区分と外注業者を変える。vendor の項目がなければ外注業者は変えない
    ex.features[0].devType = '改修';
    ex.features[0].vendor = 'B社';
    delete (ex.features[1] as { vendor?: string }).vendor;
    const body = {
      features: [
        ...ex.features,
        {
          key: 'NEW-F1', name: '取引先登録', category1: '顧客管理', category2: '顧客情報', vendor: 'C社',
          dfd: { transactionFunctions: [{ key: 'NEW-1', name: '取引先登録入力', kind: 'EI', complexity: 'low' }] },
        },
        {
          key: 'NEW-F2', name: '取引先照会', category1: '顧客管理', category2: '顧客情報', devType: 'modification', vendor: ' a社 ',
          dfd: { transactionFunctions: [{ key: 'NEW-2', name: '取引先照会', kind: 'EQ', complexity: 'low' }] },
        },
        {
          key: 'NEW-F3', name: '取引先削除', category1: '顧客管理', category2: '顧客情報', devType: '保守',
          dfd: { transactionFunctions: [{ key: 'NEW-3', name: '取引先削除', kind: 'EI', complexity: 'low' }] },
        },
      ],
    };
    const plan = planImport(doc, 'sw1', parse(JSON.stringify(body)), { removeMissing: false });
    expect(plan.errors).toEqual([]);
    expect(plan.features[0].featurePatch).toEqual({ devType: 'modification', vendorId: 'vB' });
    expect(plan.features[0].featureChanges).toEqual(['開発区分 新規 → 改修', '外注業者 A社 → B社']);
    expect(plan.features[1].featurePatch).toEqual({});
    expect(plan.features.slice(2).map((f) => [f.devType, f.vendorId])).toEqual([['new', null], ['modification', 'vA'], ['new', null]]);
    expect(plan.warnings.join('\n')).toMatch(/外注業者「C社」は登録されていない/);
    expect(plan.warnings.join('\n')).toMatch(/開発区分「保守」は「新規」か「改修」ではない/);

    const store = createAppStore(doc);
    const r = store.getState().applyImportPlan('sw1', plan, { layout: false });
    if (!r.ok) throw new Error(r.reason);
    const after = store.getState().doc;
    expect(after.features.fReg).toMatchObject({ devType: 'modification', vendorId: 'vB' });
    expect(after.features.fSearch).toMatchObject({ devType: 'modification', vendorId: 'vB' });
    expect(after.features[r.featureIds[3]]).toMatchObject({ name: '取引先照会', devType: 'modification', vendorId: 'vA' });

    // 「未選択」で外注なしにできる
    const clear = planImport(after, 'sw1', parse(JSON.stringify({ features: [{ key: 'fReg', vendor: '未選択', dfd: buildExchange(after, ['fReg']).features[0].dfd }] })), { removeMissing: false });
    expect(clear.features[0].featurePatch).toEqual({ vendorId: null });
  });

  it('機能・要素の key が書き換えられていても、名前が同じ既存の機能・要素を上書きする', () => {
    const doc = sampleDocument();
    const ex = buildExchange(doc, ['fReg']);
    const f = ex.features[0];
    // エージェントが機能の key を付け直し、TF-001 と外部エンティティの key も付け直した
    f.key = 'NEW-F1';
    const tf1 = f.dfd.transactionFunctions.find((t) => t.key === 'TF-001')!;
    tf1.key = 'NEW-1';
    tf1.complexity = 'high';
    for (const flow of f.dfd.dataFlows) {
      if (flow.from === 'TF-001') flow.from = 'NEW-1';
      if (flow.to === 'TF-001') flow.to = 'NEW-1';
    }
    f.dfd.externalEntities[0].key = 'NEW-EE';
    for (const flow of f.dfd.dataFlows) {
      if (flow.from === 'EE-001') flow.from = 'NEW-EE';
      if (flow.to === 'EE-001') flow.to = 'NEW-EE';
    }
    const plan = planImport(doc, 'sw1', parse(JSON.stringify(ex)), { removeMissing: true });
    expect(plan.errors).toEqual([]);
    // 別の機能として追加せず、顧客登録を上書きする
    expect(plan.features[0].featureId).toBe('fReg');
    expect(plan.newCategories).toEqual([]);
    expect(plan.creates).toEqual([]);
    // 変わったのは複雑度だけ。データフローは既存のものに対応づき、増えも消えもしない
    expect(plan.updates).toEqual([expect.objectContaining({ key: 'TF-001', patch: { complexity: 'high' } })]);
    const fp = plan.features[0];
    expect([fp.edgeAdds, fp.edgeRemovals, fp.removals, fp.places]).toEqual([[], [], [], []]);
    expect(plan.warnings.join('\n')).toMatch(/名前が同じ既存の機能「顧客管理 \/ 顧客情報 \/ 顧客登録」を上書きします/);
    expect(plan.warnings.join('\n')).toMatch(/NEW-1.*TF-001 として扱います/);

    const store = createAppStore(doc);
    expect(store.getState().applyImportPlan('sw1', plan, { layout: false }).ok).toBe(true);
    const after = store.getState().doc;
    expect(Object.keys(after.features)).toHaveLength(3);
    expect(after.transactionFunctions.tf1.complexity).toBe('high');
    expect(after.features.fReg.dfd.edges).toHaveLength(doc.features.fReg.dfd.edges.length);

    // 同じ名前の機能が複数あるときは決められないので、新しい機能として追加する
    const store2 = createAppStore(sampleDocument());
    const c2 = store2.getState().doc.features.fReg.category2Id;
    store2.getState().addFeature(c2, '顧客検索');
    const amb = planImport(store2.getState().doc, 'sw1', parse(JSON.stringify({
      features: [{ key: 'X', name: '顧客検索', category1: '顧客管理', category2: '顧客情報', dfd: { externalEntities: [{ key: 'EE-001', name: '利用者' }] } }],
    })), { removeMissing: false });
    expect(amb.features[0].featureId).toBeNull();
    expect(amb.warnings.join('\n')).toMatch(/複数あるため/);
  });

  it('全機能の TF 名を catalog で渡し、取り込みで名前が重複する要素を警告する', () => {
    const doc = sampleDocument();
    const ex = buildExchange(doc, ['fReg']);
    // 書き出さない機能の TF も名前の一覧に入る
    expect(ex.catalog.transactionFunctions).toContainEqual({ key: 'TF-004', name: '顧客照会', kind: 'EQ', feature: '顧客検索' });
    const dfd = (tf: string, name: string) => ({
      externalEntities: [{ key: 'EE-001', name: '利用者' }],
      transactionFunctions: [{ key: tf, name, kind: 'EQ', complexity: 'low' }],
      dataFlows: [{ from: tf, to: 'EE-001', label: '結果' }],
    });
    const plan = planImport(doc, 'sw1', parse(JSON.stringify({
      features: [
        { key: 'NEW-F1', name: '取引先照会', category1: '顧客管理', category2: '顧客情報', dfd: dfd('NEW-1', '顧客照会') },
        { key: 'NEW-F2', name: '仕入先照会', category1: '顧客管理', category2: '顧客情報', dfd: dfd('NEW-2', '照会 ') },
        { key: 'NEW-F3', name: '外注先照会', category1: '顧客管理', category2: '顧客情報', dfd: dfd('NEW-3', '照会') },
      ],
    })), { removeMissing: false });
    expect(plan.errors).toEqual([]);
    expect(plan.warnings).toContainEqual(expect.stringContaining('名前「顧客照会」が重複します: TF-004（顧客検索）、NEW-1（取引先照会）'));
    expect(plan.warnings).toContainEqual(expect.stringContaining('NEW-2（仕入先照会）、NEW-3（外注先照会）'));
    // 既存どうしの重複や、そのまま返しただけでは警告しない
    const same = planImport(doc, 'sw1', parse(JSON.stringify(ex)), { removeMissing: false });
    expect(same.warnings.filter((w) => w.includes('重複'))).toEqual([]);
  });

  it('既存の機能から外したデータファンクションを新しい機能で使う出力でも、参照が壊れない', () => {
    const store = createAppStore(sampleDocument());
    const doc = store.getState().doc;
    const ex = JSON.parse(JSON.stringify(buildExchange(doc, ['fReg'])));
    // 顧客登録が所有する DF-001（顧客マスタ）を顧客登録の dfd から外し、新しい機能で owner を書かずに使う
    const reg = ex.features[0];
    const df = reg.dfd.dataFunctions.find((d: { key: string }) => d.key === 'DF-001');
    reg.dfd.dataFunctions = reg.dfd.dataFunctions.filter((d: { key: string }) => d.key !== 'DF-001');
    reg.dfd.dataFlows = reg.dfd.dataFlows.filter((f: { from: string; to: string }) => f.from !== 'DF-001' && f.to !== 'DF-001');
    ex.features.push({
      key: 'new-1', name: '顧客照会', category1: '顧客管理', category2: '顧客情報',
      dfd: {
        dataFunctions: [df],
        transactionFunctions: [{ key: 'T-NEW', name: '顧客照会', kind: 'EQ', complexity: 'low' }],
        dataFlows: [{ from: 'DF-001', to: 'T-NEW', label: '顧客情報' }],
      },
    });
    const plan = planImport(doc, 'sw1', parse(JSON.stringify(ex)), { removeMissing: true });
    expect(plan.errors).toEqual([]);
    // 削除ではなく、顧客登録の DFD から外すだけにする。所有機能をどうするかをエージェントに確かめる指示を出す
    expect(plan.features[0].removals).toContainEqual(expect.objectContaining({ key: 'DF-001', mode: 'unplace' }));
    expect(plan.warnings.join('\n')).toContain('DF-001 顧客マスタ');
    expect(plan.fixes.join('\n')).toContain('owner');
    const text = buildFixInstruction(plan)!;
    expect(text).toContain('JSON 全体をもう一度出力してください');
    expect(text).toContain('DF-001');

    const r = store.getState().applyImportPlan('sw1', plan, { layout: true });
    expect(r.ok).toBe(true);
    const after = store.getState().doc;
    expect(after.dataFunctions.df1).toBeDefined();
    expect(after.dataFunctions.df1.ownerFeatureId).toBe('fReg');
    expect(findBrokenReferences(after)).toEqual([]);
    const created = Object.values(after.features).find((f) => f.name === '顧客照会')!;
    expect(created.dfd.nodes.map((n) => n.refId)).toContain('df1');
    expect(created.dfd.edges).toHaveLength(1);
    expect(after.features.fReg.dfd.nodes.some((n) => n.refId === 'df1')).toBe(false);

    // owner を新しい機能にしていれば、所有を移す（修正指示は出さない）
    df.owner = 'new-1';
    const moved = planImport(doc, 'sw1', parse(JSON.stringify(ex)), { removeMissing: true });
    expect(moved.fixes).toEqual([]);
    expect(moved.ownerChanges).toHaveLength(1);
    expect(buildFixInstruction(moved)).toBeNull();
  });

  it('取り込めない出力には、エージェントへの修正指示を作る', () => {
    const doc = sampleDocument();
    const ex = JSON.parse(JSON.stringify(buildExchange(doc, ['fReg'])));
    ex.features[0].dfd.dataFlows.push({ from: 'TF-001', to: 'DF-999', label: '存在しない' });
    const plan = planImport(doc, 'sw1', parse(JSON.stringify(ex)), { removeMissing: false });
    expect(plan.errors).toHaveLength(1);
    const text = buildFixInstruction(plan)!;
    expect(text).toContain('DF-999');
    // 問題は 1 件（そのあとに、直すときの注意が続く）
    expect(text.slice(0, text.indexOf('直すときは')).split('\n').filter((l) => l.startsWith('- '))).toHaveLength(1);
    // JSON として読めない場合も、理由を添えた指示にする
    expect(buildFixInstruction(null, ['JSON として読めません（Unexpected token）。'])).toContain('JSON として読めません');
    // 問題がなければ指示は作らない
    expect(buildFixInstruction(planImport(doc, 'sw1', parse(JSON.stringify(buildExchange(doc, ['fReg']))), { removeMissing: false }))).toBeNull();
  });

  it('壊れた参照（実体のないノード・両端のないデータフローなど）を取り除いて、表示できる状態にする', () => {
    const doc = sampleDocument();
    expect(findBrokenReferences(doc)).toEqual([]);
    expect(repairReferences(doc)).toEqual({ doc, repairs: [] });
    const broken = JSON.parse(JSON.stringify(doc)) as typeof doc;
    delete broken.dataFunctions.df1; // n5 が指す実体がない
    broken.features.fReg.dfd.edges.push({ id: 'eX', sourceNodeId: 'n1', targetNodeId: 'gone', label: '' });
    broken.dataFunctions.df2.ownerFeatureId = 'noFeature';
    broken.transactionFunctions.tf1.featureId = 'noFeature';
    broken.features.fSearch.vendorId = 'noVendor';
    const found = findBrokenReferences(broken);
    expect(found.length).toBeGreaterThanOrEqual(5);
    const r = repairReferences(broken);
    expect(r.repairs).toEqual(found);
    expect(r.doc).not.toBe(broken);
    expect(findBrokenReferences(r.doc)).toEqual([]);
    expect(r.doc.features.fReg.dfd.nodes.some((n) => n.refId === 'df1' || n.refId === 'tf1')).toBe(false);
    expect(r.doc.features.fReg.dfd.edges.every((e) => ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'].includes(e.sourceNodeId))).toBe(true);
    expect(r.doc.dataFunctions.df2.ownerFeatureId).toBeNull();
    expect(r.doc.transactionFunctions.tf1).toBeUndefined();
    expect(r.doc.features.fSearch.vendorId).toBeNull();
    // 保存ファイルの形式としても正しい
    expect(parseDocumentJson(JSON.stringify(r.doc)).ok).toBe(true);
    // 読み込むときに直す
    const store = createAppStore(sampleDocument());
    expect(store.getState().loadDocument(broken)).toEqual(found);
    expect(findBrokenReferences(store.getState().doc)).toEqual([]);
  });

  it('システム特性の既定値のセットを書き出し、返された名前のセットを機能に適用する（FR-IO-11）', () => {
    const store = createAppStore(sampleDocument());
    const sw = store.getState().doc.softwares.sw1;
    const batch = { id: 'pBatch', name: 'バッチ処理', values: Array(14).fill(1) };
    store.getState().updateSettings('sw1', { characteristicPresets: [batch] });
    const doc = store.getState().doc;
    const standard = [...sw.settings.defaultCharacteristics];
    const ex = JSON.parse(JSON.stringify(buildExchange(doc, ['fReg', 'fSearch'])));
    // 機能ごとの適用中のセットと、選べるセットの一覧（値は C1〜C14 の順）を渡す
    expect(ex.features.map((f: { characteristicPreset: string }) => f.characteristicPreset)).toEqual(['標準', '標準']);
    expect(ex.catalog.characteristicPresets).toEqual([{ name: '標準', values: standard }, { name: 'バッチ処理', values: batch.values }]);
    expect(ex.catalog.characteristics).toHaveLength(14);
    expect(ex.catalog.characteristics[0]).toBe('C1 データ通信');
    // そのまま返せば変更なし
    expect(planHasChanges(planImport(doc, 'sw1', parse(JSON.stringify(ex)), { removeMissing: true }))).toBe(false);

    // 顧客検索だけ「バッチ処理」にし、新しい機能にも指定する。登録にない名前は警告して適用しない
    ex.features[1].characteristicPreset = 'バッチ処理';
    ex.features[0].characteristicPreset = '存在しないセット';
    ex.features.push({
      key: 'new-1', name: '夜間集計', category1: '顧客管理', category2: '顧客情報', characteristicPreset: 'バッチ処理',
      dfd: { transactionFunctions: [{ key: 'T-1', name: '夜間集計処理', kind: 'EO', complexity: 'low' }] },
    });
    ex.features.push({
      key: 'new-2', name: '標準の機能', category1: '顧客管理', category2: '顧客情報',
      dfd: { transactionFunctions: [{ key: 'T-2', name: '標準の処理', kind: 'EQ', complexity: 'low' }] },
    });
    const plan = planImport(doc, 'sw1', parse(JSON.stringify(ex)), { removeMissing: true });
    expect(plan.errors).toEqual([]);
    expect(plan.warnings.join('\n')).toContain('「存在しないセット」は登録されていない');
    expect(plan.features[0].featureChanges).toEqual([]);
    expect(plan.features[1].featureChanges).toEqual(['システム特性の既定値のセット 標準 → バッチ処理（C1〜C14 を上書き）']);
    expect(featurePlanHasChanges(plan.features[1], plan)).toBe(true);
    expect(plan.features[2].featureChanges).toContain('システム特性の既定値のセット バッチ処理');
    expect(plan.features[3].featureChanges).toContain('システム特性の既定値のセット 標準');

    expect(store.getState().applyImportPlan('sw1', plan, { layout: false }).ok).toBe(true);
    const after = store.getState().doc;
    const byName = (name: string) => Object.values(after.features).find((f) => f.name === name)!;
    expect(after.features.fSearch).toMatchObject({ characteristics: batch.values, characteristicPresetId: 'pBatch' });
    expect(after.features.fReg.characteristics).toEqual(standard);
    expect(byName('夜間集計')).toMatchObject({ characteristics: batch.values, characteristicPresetId: 'pBatch' });
    expect(byName('標準の機能').characteristics).toEqual(standard);
    // 1 回の Undo で戻る
    undo(store);
    expect(store.getState().doc.features.fSearch.characteristics).toEqual(standard);

    // 個別に変えた値は、同じセットの名前のまま返されても上書きしない。標準へ戻す指定は反映する
    store.getState().applyCharacteristicPreset('fSearch', 'pBatch');
    store.getState().updateFeature('fSearch', { characteristics: Array(14).fill(5) });
    const doc2 = store.getState().doc;
    const ex2 = JSON.parse(JSON.stringify(buildExchange(doc2, ['fSearch'])));
    expect(ex2.features[0].characteristicPreset).toBe('バッチ処理');
    expect(planHasChanges(planImport(doc2, 'sw1', parse(JSON.stringify(ex2)), { removeMissing: true }))).toBe(false);
    ex2.features[0].characteristicPreset = '標準';
    const back = planImport(doc2, 'sw1', parse(JSON.stringify(ex2)), { removeMissing: true });
    expect(back.features[0].characteristicPresetId).toBeNull();
    store.getState().applyImportPlan('sw1', back, { layout: false });
    expect(store.getState().doc.features.fSearch).toMatchObject({ characteristics: standard, characteristicPresetId: null });
    // 項目がなければ変えない
    delete ex2.features[0].characteristicPreset;
    expect(planImport(store.getState().doc, 'sw1', parse(JSON.stringify(ex2)), { removeMissing: true }).features[0].characteristicPresetId).toBeUndefined();
  });

  it('複雑度の推測を書き出し、返された内容を取り込む（FR-FN-20）', () => {
    const store = createAppStore(sampleDocument());
    store.getState().updateTransactionFunction('tf1', { complexityNote: 'DET 12・FTR 1 と推定し中' });
    const doc = store.getState().doc;
    const ex = JSON.parse(JSON.stringify(buildExchange(doc, ['fReg'])));
    const dfd = ex.features[0].dfd;
    expect(dfd.transactionFunctions.find((t: { key: string }) => t.key === 'TF-001').complexityNote).toBe('DET 12・FTR 1 と推定し中');
    expect(dfd.dataFunctions.find((d: { key: string }) => d.key === 'DF-001').complexityNote).toBe('');
    // そのまま返せば変更なし
    expect(planHasChanges(planImport(doc, 'sw1', parse(JSON.stringify(ex)), { removeMissing: true }))).toBe(false);

    // 既存の要素の推測を書き換え、新しい要素にも付ける。空で返したものは消さない
    dfd.dataFunctions.find((d: { key: string }) => d.key === 'DF-001').complexityNote = 'RET 2・DET 25 で中';
    dfd.transactionFunctions.find((t: { key: string }) => t.key === 'TF-001').complexityNote = '';
    dfd.transactionFunctions.push({ key: 'N-1', name: '顧客取込', kind: 'EI', complexity: 'high', complexityNote: 'DET 20・FTR 2 と推定し高', description: 'CSV を取り込む' });
    dfd.dataFlows.push({ from: 'N-1', to: 'DF-001', label: '顧客データ' });
    const plan = planImport(doc, 'sw1', parse(JSON.stringify(ex)), { removeMissing: true });
    expect(plan.errors).toEqual([]);
    expect(plan.updates).toEqual([expect.objectContaining({ key: 'DF-001', changes: ['複雑度の推測'], patch: { complexityNote: 'RET 2・DET 25 で中' } })]);
    store.getState().applyImportPlan('sw1', plan, { layout: false });
    const after = store.getState().doc;
    expect(after.dataFunctions.df1.complexityNote).toBe('RET 2・DET 25 で中');
    expect(after.transactionFunctions.tf1.complexityNote).toBe('DET 12・FTR 1 と推定し中');
    expect(Object.values(after.transactionFunctions).find((x) => x.name === '顧客取込')).toMatchObject({ complexity: 'high', complexityNote: 'DET 20・FTR 2 と推定し高', description: 'CSV を取り込む' });
    // 保存ファイルにも残り、項目のない古いファイルも読める
    const saved = parseDocumentJson(JSON.stringify(after));
    expect(saved.ok && saved.value.dataFunctions.df1.complexityNote).toBe('RET 2・DET 25 で中');
    expect(parseDocumentJson(JSON.stringify(sampleDocument())).ok).toBe(true);
  });

  it('版 1（1 機能）の JSON も読み、壊れた入力には理由を返す', () => {
    const v1 = parse(JSON.stringify({ format: 'fp-dfd-exchange', version: 1, feature: { key: 'fReg' }, dfd: { externalEntities: [{ key: 'EE-001', name: '利用者' }] } }));
    expect(v1.features).toHaveLength(1);
    expect(v1.features[0].key).toBe('fReg');
    expect(parseExchange('こんにちは')).toMatchObject({ ok: false });
    expect(parseExchange('{ "features": ')).toMatchObject({ ok: false });
    const r = parseExchange(JSON.stringify({ features: [{ key: 'fReg', dfd: { transactionFunctions: [{ key: 'A', name: 'x', kind: 'XX', complexity: 'low' }] } }] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/EI・EO・EQ/);
  });

  it('エージェント用の指示はドキュメントと同じ文面で、Copilot の指示欄の上限（8,000 文字）に収まる', () => {
    const md = readFileSync('doc/copilot-agent.md', 'utf-8');
    expect(md).toContain(AGENT_INSTRUCTIONS.trimEnd());
    expect(AGENT_INSTRUCTIONS.length).toBeLessThan(8000);
    const req = buildAgentRequest('{"a":1}', '', true);
    expect(req.startsWith('# 役割')).toBe(true);
    expect(req).toContain('```json\n{"a":1}\n```');
    expect(buildAgentRequest('{}', '一括登録を追加', false)).toContain('依頼: 一括登録を追加');
  });

  it('FP 拡充エージェントの指示もドキュメントと同じ文面で上限に収まり、共通のルールを含む（FR-IO-09）', () => {
    const md = readFileSync('doc/copilot-agent.md', 'utf-8');
    expect(md).toContain(FP_BOOST_INSTRUCTIONS.trimEnd());
    expect(FP_BOOST_INSTRUCTIONS.length).toBeLessThan(8000);
    for (const heading of ['# 受け取る JSON の読み方', '# 種別の判定基準', '# 複雑度の判定基準', '# key のルール', '# 数えてはいけないもの（過剰計上）', '# 返答の形式']) {
      expect(FP_BOOST_INSTRUCTIONS).toContain(heading);
    }
    expect(FP_BOOST_INSTRUCTIONS).toContain('受け取った JSON と同じ形');
    expect(buildAgentInstructions('', 'fpBoost')).toBe(FP_BOOST_INSTRUCTIONS);
    expect(buildAgentInstructions('- 帳票は EO', 'fpBoost')).toMatch(/^# 役割\nあなたは、FP 法（IFPUG ファンクションポイント法）の計測に詳しい[\s\S]*- 帳票は EO\n$/);
    const req = buildAgentRequest('{}', '', true, '', 'fpBoost');
    expect(req.startsWith(FP_BOOST_INSTRUCTIONS)).toBe(true);
    expect(req).toContain(`依頼: ${AGENTS.fpBoost.defaultRequest}`);
  });

  it('プロジェクト固有の補足情報を、指示の末尾と書き出す JSON に入れ、保存ファイルにも残す（FR-IO-07）', () => {
    const store = createAppStore(sampleDocument());
    const rev = store.getState().revision;
    store.getState().updateAgentNotes('sw1', '');
    expect(store.getState().revision).toBe(rev); // 変わらなければ履歴を積まない
    const notes = '- 「会員」は顧客マスタの別名\n- 帳票は EO・中 とする';
    store.getState().updateAgentNotes('sw1', notes);
    const doc = store.getState().doc;

    expect(buildAgentInstructions('')).toBe(AGENT_INSTRUCTIONS);
    const ins = buildAgentInstructions(`  ${notes}\n`);
    expect(ins.startsWith(AGENT_INSTRUCTIONS)).toBe(true);
    expect(ins).toContain('# プロジェクト固有の補足情報');
    expect(ins.trimEnd().endsWith('- 帳票は EO・中 とする')).toBe(true);
    expect(buildAgentRequest('{}', '', true, notes)).toContain('「会員」は顧客マスタの別名');

    expect(buildExchange(doc, ['fReg']).software).toEqual({ name: '顧客管理システム', notes });
    expect(buildExchange(sampleDocument(), ['fReg']).software).toEqual({ name: '顧客管理システム' });

    const loaded = parseDocumentJson(JSON.stringify(doc));
    if (!loaded.ok) throw new Error('load failed');
    expect(loaded.value.softwares.sw1.agentNotes).toBe(notes);
    undo(store);
    expect(store.getState().doc.softwares.sw1.agentNotes).toBeUndefined();
  });
});
