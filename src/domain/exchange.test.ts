import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AGENT_INSTRUCTIONS, buildAgentRequest } from './agentPrompt';
import { createAppStore, undo } from '../store';
import { buildExchange, parseExchange, planHasChanges, planImport, type ImportData } from './exchange';
import { sampleDocument } from './sampleDocument';

const parse = (text: string): ImportData => {
  const r = parseExchange(text);
  if (!r.ok) throw new Error(r.message);
  return r.data;
};

describe('AI エージェントとの交換形式（FR-IO）', () => {
  it('書き出した JSON をそのまま取り込むと変更なし', () => {
    const doc = sampleDocument();
    const ex = buildExchange(doc, 'fReg');
    expect(ex.format).toBe('fp-dfd-exchange');
    expect(ex.dfd.transactionFunctions.map((t) => t.key)).toEqual(['TF-001', 'TF-002', 'TF-003']);
    expect(ex.dfd.dataFlows).toContainEqual({ from: 'EE-001', to: 'TF-001', label: '登録情報' });
    // 他機能所有の DF も DFD に置いていれば含め、catalog で所有機能が分かる
    expect(ex.dfd.dataFunctions.map((d) => d.key)).toEqual(['DF-001', 'DF-002']);
    expect(ex.catalog.dataFunctions.find((d) => d.key === 'DF-002')?.owner).toBe('商品管理 / 商品情報 / 商品登録');
    const plan = planImport(doc, 'fReg', parse(JSON.stringify(ex)), { removeMissing: true });
    expect(plan.errors).toEqual([]);
    expect(planHasChanges(plan)).toBe(false);
  });

  it('コードブロック付きの返答を読み、日本語の複雑度や小文字の種別も受け付ける', () => {
    const reply = `DFD を作成しました。\n\n\`\`\`json\n${JSON.stringify({
      format: 'fp-dfd-exchange', version: 1, feature: { key: 'fSearch' },
      dfd: {
        externalEntities: [{ key: 'EE-001', name: '利用者' }],
        dataFunctions: [{ key: 'DF-001', name: '顧客マスタ', kind: 'ilf', complexity: '中' }],
        transactionFunctions: [{ key: 'NEW-1', name: '顧客一覧照会', kind: 'eq', complexity: 'average', description: '条件で一覧を表示' }],
        dataFlows: [{ from: 'EE-001', to: 'NEW-1', label: '検索条件' }, { from: 'DF-001', to: 'NEW-1', label: '顧客情報' }, { from: 'NEW-1', to: 'EE-001', label: '一覧' }],
      },
    })}\n\`\`\`\n以上です。`;
    const r = parseExchange(reply);
    if (!r.ok) throw new Error(r.message);
    expect(r.featureKey).toBe('fSearch');
    const doc = sampleDocument();
    const plan = planImport(doc, 'fSearch', r.data, { removeMissing: false });
    expect(plan.errors).toEqual([]);
    expect(plan.creates).toEqual([{ refType: 'transactionFunction', key: 'NEW-1', name: '顧客一覧照会', kind: 'EQ', complexity: 'medium', description: '条件で一覧を表示' }]);
    // 既存の外部エンティティと他機能所有の DF は参照として置く
    expect(plan.places.map((p) => p.key).sort()).toEqual(['DF-001', 'EE-001']);
    expect(plan.edgeAdds).toHaveLength(3);

    // 反映すると新しい番号で作られ、つながる。1 回の Undo で戻る
    const store = createAppStore(doc);
    store.temporal.getState().clear();
    const res = store.getState().applyImportPlan('fSearch', plan, { layout: true });
    expect(res).toEqual({ ok: true, created: 1 });
    const after = store.getState().doc;
    const tf = Object.values(after.transactionFunctions).find((t) => t.name === '顧客一覧照会')!;
    expect(tf).toMatchObject({ displayNo: 'TF-007', featureId: 'fSearch', kind: 'EQ' });
    expect(after.features.fSearch.dfd.nodes).toHaveLength(3);
    expect(after.features.fSearch.dfd.edges).toHaveLength(3);
    expect(after.dataFunctions.df1.ownerFeatureId).toBe('fReg');
    undo(store);
    expect(store.getState().doc.features.fSearch.dfd.nodes).toHaveLength(0);
  });

  it('変更・ラベル変更・出力にない要素の削除を差分にする', () => {
    const doc = sampleDocument();
    const ex = buildExchange(doc, 'fReg');
    const tf1 = ex.dfd.transactionFunctions.find((t) => t.key === 'TF-001')!;
    tf1.complexity = 'high';
    tf1.name = '顧客新規登録';
    ex.dfd.transactionFunctions = ex.dfd.transactionFunctions.filter((t) => t.key !== 'TF-003'); // 顧客検索を外す
    ex.dfd.dataFlows = ex.dfd.dataFlows.filter((f) => f.from !== 'TF-003' && f.to !== 'TF-003');
    ex.dfd.dataFlows.find((f) => f.label === '登録情報')!.label = '顧客登録情報';
    // 他機能所有の DF の名称変更は取り込まない
    ex.dfd.dataFunctions.find((d) => d.key === 'DF-002')!.name = '商品台帳';

    const keep = planImport(doc, 'fReg', parse(JSON.stringify(ex)), { removeMissing: false });
    expect(keep.removals).toEqual([]);
    expect(keep.edgeRemovals).toEqual([]);
    const plan = planImport(doc, 'fReg', parse(JSON.stringify(ex)), { removeMissing: true });
    expect(plan.errors).toEqual([]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]).toMatchObject({ key: 'TF-001', patch: { name: '顧客新規登録', complexity: 'high' } });
    expect(plan.warnings.some((w) => w.includes('DF-002'))).toBe(true);
    expect(plan.edgeLabelUpdates).toEqual([expect.objectContaining({ from: 'EE-001', to: 'TF-001', before: '登録情報', label: '顧客登録情報' })]);
    expect(plan.removals).toEqual([expect.objectContaining({ key: 'TF-003', mode: 'delete' })]);
    expect(plan.edgeRemovals.map((e) => e.label).sort()).toEqual(['商品情報', '検索条件', '顧客情報']);

    const store = createAppStore(doc);
    expect(store.getState().applyImportPlan('fReg', plan, { layout: false }).ok).toBe(true);
    const after = store.getState().doc;
    expect(after.transactionFunctions.tf3).toBeUndefined();
    expect(after.transactionFunctions.tf1).toMatchObject({ name: '顧客新規登録', complexity: 'high' });
    expect(after.dataFunctions.df2.name).toBe('商品マスタ');
    expect(after.features.fReg.dfd.edges.find((e) => e.label === '顧客登録情報')).toBeDefined();
  });

  it('接続ルール違反・未知の key・重複・種別違いはエラーにする', () => {
    const doc = sampleDocument();
    const data = parse(JSON.stringify({
      dfd: {
        externalEntities: [{ key: 'EE-001', name: '利用者' }, { key: 'X', name: '外部システム' }],
        dataFunctions: [{ key: 'DF-001', name: '顧客マスタ', kind: 'ILF', complexity: 'low' }],
        transactionFunctions: [{ key: 'EE-001', name: '誤り', kind: 'EI', complexity: 'low' }, { key: 'TF-004', name: '顧客照会', kind: 'EQ', complexity: 'low' }],
        dataFlows: [{ from: 'EE-001', to: 'DF-001' }, { from: 'X', to: 'EE-001' }, { from: 'EE-001', to: 'NOPE' }],
      },
    }));
    const plan = planImport(doc, 'fReg', data, { removeMissing: false });
    expect(plan.errors.join('\n')).toMatch(/「EE-001」が重複/);
    expect(plan.errors.join('\n')).toMatch(/TF-004.*別の機能/);
    expect(plan.errors.join('\n')).toMatch(/外部エンティティとデータストアは直接接続できません/);
    expect(plan.errors.join('\n')).toMatch(/外部エンティティ同士/);
    expect(plan.errors.join('\n')).toMatch(/NOPE/);
    const store = createAppStore(doc);
    expect(store.getState().applyImportPlan('fReg', plan, { layout: false }).ok).toBe(false);
  });

  it('JSON がない・壊れている・形式違いは理由を返す', () => {
    expect(parseExchange('こんにちは')).toMatchObject({ ok: false });
    expect(parseExchange('{ "dfd": ')).toMatchObject({ ok: false });
    const r = parseExchange(JSON.stringify({ dfd: { transactionFunctions: [{ key: 'A', name: 'x', kind: 'XX', complexity: 'low' }] } }));
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
