import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAppStore, undo } from '../store';
import { AGENT_INSTRUCTIONS, buildAgentRequest } from './agentPrompt';
import { buildExchange, parseExchange, planHasChanges, planImport, type ImportData } from './exchange';
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
});
