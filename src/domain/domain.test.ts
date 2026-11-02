import { describe, expect, it } from 'vitest';
import type { DfdNode } from './types';
import { layoutDfd } from './autoLayout';
import { buildCsv, buildLedgerCsv, escapeCsv } from './csvExport';
import { canConnect, canConnectNodes, type NodeKindForRule } from './dfdRules';
import { clipToBoundary, nodeBox, wrapLabel } from './dfdGeometry';
import { migrateAndValidate, parseDocumentJson } from './migrations';
import { sampleDocument } from './sampleDocument';
import { buildDfdSvg } from './svgExport';
import { findDuplicateName, validateSoftware } from './validation';

describe('dfdRules（FR-DF-06）', () => {
  const kinds: NodeKindForRule[] = ['process', 'dataStore', 'externalEntity'];
  it.each(kinds.flatMap((a) => kinds.map((b) => [a, b] as const)))('%s → %s', (a, b) => {
    const r = canConnect(a, b);
    expect(r.ok).toBe(a === 'process' || b === 'process');
  });
  it('拒否理由を返す', () => {
    const r = canConnect('externalEntity', 'dataStore');
    expect(r).toEqual({ ok: false, reason: '外部エンティティとデータストアは直接接続できません。プロセスを介してください。' });
    expect(canConnect('dataStore', 'dataStore')).toMatchObject({ reason: expect.stringContaining('データストア同士') });
  });
  it('自己接続は禁止', () => {
    expect(canConnectNodes({ id: 'a', refType: 'transactionFunction' }, { id: 'a', refType: 'transactionFunction' }).ok).toBe(false);
  });
});

describe('csvExport（FR-CSV）', () => {
  it('BOM、CRLF、ヘッダ、業者ごとの列、説明列', () => {
    const csv = buildCsv(sampleDocument(), 'sw1');
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe(
      '機能名（大分類）,機能名（中分類）,機能名（小分類）,ILF,EIF,EI,EO,EQ,C1,C2,C3,C4,C5,C6,C7,C8,C9,C10,C11,C12,C13,C14,開発区分,未調整FP値,調整係数,調整済FP値,改修係数,開発工数,社内工数,外注工数（A社）,外注工数（B社）,開発単価,説明',
    );
    expect(lines[1]).toBe(
      '顧客管理,顧客情報,顧客登録,1,0,1,1,1,3,2,3,2,1,2,3,2,1,1,2,3,2,1,新規,21,0.93,19,1.00,152,60,92,,820000,顧客の新規登録。氏名、住所、連絡先を入力し顧客マスタに登録する',
    );
    expect(lines[2]).toBe(
      '顧客管理,顧客情報,顧客検索,0,0,0,0,2,3,2,3,2,1,2,3,2,1,1,2,3,2,1,改修,6,0.93,5,0.50,20,8,,12,108000,既存の検索画面に詳細照会を追加',
    );
    expect(lines[4]).toBe('');
  });
  it('改行・カンマ・ダブルクォートを含む説明をクォートする', () => {
    const doc = sampleDocument();
    doc.features.fReg.description = '1行目,続き\n2行目 "引用"';
    const row = buildCsv(doc, 'sw1').split('\r\n')[1];
    expect(row.endsWith(',"1行目,続き\n2行目 ""引用"""')).toBe(true);
    expect(escapeCsv(' 前後空白 ')).toBe('" 前後空白 "');
    expect(escapeCsv('普通')).toBe('普通');
  });
  it('台帳 CSV（FR-ID-06）', () => {
    const lines = buildLedgerCsv(sampleDocument(), 'sw1').slice(1).split('\r\n');
    expect(lines[0]).toBe('No,名称,種別,複雑度,FP,所有／所属機能,参照している機能,説明');
    expect(lines[2]).toBe('DF-002,商品マスタ,ILF,低,7,商品管理 / 商品情報 / 商品登録,顧客登録,商品コード・名称・単価を保持する。');
    expect(lines[3].startsWith('TF-001,顧客登録入力,EI,中,4,顧客管理 / 顧客情報 / 顧客登録,,')).toBe(true);
  });
});

describe('svgExport（FR-SVG）', () => {
  it('整形式で、ノードとエッジの要素を含み、ズームに依存しない viewBox を持つ', () => {
    const svg = buildDfdSvg(sampleDocument(), 'fReg');
    const dom = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(dom.getElementsByTagName('parsererror')).toHaveLength(0);
    const root = dom.documentElement;
    expect(root.getAttribute('viewBox')).toMatch(/^-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+$/);
    expect(root.getAttribute('font-family')).toContain('Hiragino Sans');
    expect(dom.getElementsByTagName('circle')).toHaveLength(3); // TF 3 件
    expect(dom.querySelectorAll('line[marker-end]')).toHaveLength(7);
    expect(svg).toContain('所有: 商品登録'); // 参照補記
    expect(svg).toContain('顧客管理システム / 顧客管理 / 顧客情報 / 顧客登録'); // タイトル
  });
  it('凡例に種別ごとの件数・合計・参照を出し、ノードと重ならない（FR-DF-17）', () => {
    const svg = buildDfdSvg(sampleDocument(), 'fReg');
    const dom = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const legend = dom.querySelector('g[data-legend]')!;
    const texts = [...legend.querySelectorAll('text')].map((t) => t.textContent);
    expect(texts).toEqual(expect.arrayContaining(['外部入力', '1 件', '合計 4 件', '未調整FP 21', '参照（他機能所有・計上外） 1 件']));
    const legendX = Number(legend.querySelector('rect')!.getAttribute('x'));
    const maxNodeRight = Math.max(...sampleDocument().features.fReg.dfd.nodes.map((n) => n.x + (n.refType === 'dataFunction' ? 180 : 140)));
    expect(legendX).toBeGreaterThan(maxNodeRight);
    expect(buildDfdSvg(sampleDocument(), 'fReg', { legend: false })).not.toContain('data-legend');
  });
  it('システム境界を描き、外部エンティティは境界の外にある（FR-DF-19）', () => {
    const svg = buildDfdSvg(sampleDocument(), 'fReg');
    const dom = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const rect = dom.querySelector('g[data-boundary] rect')!;
    const bx = Number(rect.getAttribute('x'));
    expect(svg).toContain('システム境界: 顧客管理システム');
    // 利用者（x=60, 幅 140）は境界の左外
    expect(60 + 140).toBeLessThan(bx);
    expect(buildDfdSvg(sampleDocument(), 'fReg', { boundary: false })).not.toContain('data-boundary');
  });
  it('名称の特殊文字をエスケープする', () => {
    const doc = sampleDocument();
    doc.transactionFunctions.tf1.name = 'A<B&C';
    expect(buildDfdSvg(doc, 'fReg')).toContain('A&lt;B&amp;C');
  });
});

describe('dfdGeometry', () => {
  it('円と矩形の境界でクリップする', () => {
    const circle = nodeBox('transactionFunction', 0, 0); // 中心 (44,44)
    expect(clipToBoundary(circle, { x: 200, y: 44 })).toEqual({ x: 88, y: 44 });
    const rect = nodeBox('externalEntity', 0, 0); // 140x60、中心 (70,30)
    expect(clipToBoundary(rect, { x: 70, y: 300 })).toEqual({ x: 70, y: 60 });
  });
  it('ラベルを 2 行に折り返し、超過分は省略する', () => {
    expect(wrapLabel('顧客登録入力', 6)).toEqual(['顧客登録入力']);
    expect(wrapLabel('とても長い名前のプロセスです', 6)).toEqual(['とても長い名', '前のプロセ…']);
  });
});

describe('validation', () => {
  it('サンプルの警告: 商品登録の DFD ノードが未接続', () => {
    const w = validateSoftware(sampleDocument(), 'sw1');
    expect(w.map((x) => x.kind)).toEqual(['unconnectedNode']);
  });
  it('所有機能未設定・業者未選択・H/FP 未設定・同名', () => {
    const doc = sampleDocument();
    doc.dataFunctions.df1.ownerFeatureId = null;
    doc.features.fReg.vendorId = null;
    doc.softwares.sw1.settings.modDev.hoursPerFp = null;
    doc.transactionFunctions.tf5.name = '顧客照会';
    const kinds = validateSoftware(doc, 'sw1').map((x) => x.kind);
    expect(kinds).toContain('ownerUnset');
    expect(kinds).toContain('vendorMissing');
    expect(kinds).toContain('hoursPerFpUnset');
    expect(kinds.filter((k) => k === 'duplicateName')).toHaveLength(2);
  });
  it('findDuplicateName は同名・同種別の既存を返す', () => {
    expect(findDuplicateName(sampleDocument(), 'sw1', 'EO', '登録完了通知')).toEqual({ id: 'tf2', featureName: '顧客登録' });
    expect(findDuplicateName(sampleDocument(), 'sw1', 'EI', '登録完了通知')).toBeNull();
  });
});

describe('schema / migrations（FR-SV-02、FR-SV-07）', () => {
  it('保存したものを読み戻せる', () => {
    const doc = sampleDocument();
    const r = parseDocumentJson(JSON.stringify(doc));
    expect(r.ok && r.value).toEqual(doc);
  });
  it('対応外のバージョンを拒否する', () => {
    const r = migrateAndValidate({ ...sampleDocument(), schemaVersion: 2 });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('unsupportedVersion');
  });
  it('形式不正・JSON 不正・参照不整合', () => {
    const bad = { ...sampleDocument(), features: { x: { id: 'x' } } };
    expect(!migrateAndValidate(bad).ok && (migrateAndValidate(bad) as { error: { kind: string } }).error.kind).toBe('invalidFormat');
    const p = parseDocumentJson('{');
    expect(!p.ok && p.error.kind).toBe('parse');
    const doc = sampleDocument();
    doc.features.fReg.dfd.nodes[0].refId = 'missing';
    const r = migrateAndValidate(doc);
    expect(!r.ok && r.error.kind).toBe('brokenReference');
  });
  it('説明が無い古いデータは空文字で補う', () => {
    const doc = sampleDocument() as unknown as { features: Record<string, Record<string, unknown>> };
    delete doc.features.fItem.description;
    const r = migrateAndValidate(doc);
    expect(r.ok && r.value.features.fItem.description).toBe('');
  });
});

describe('autoLayout（FR-DF-12、FR-DF-19）', () => {
  it('外部エンティティと EIF をシステム境界の外、内部要素を内側に並べる', async () => {
    const { computeBoundary } = await import('./dfdGeometry');
    const N = (id: string, refType: DfdNode['refType']) => ({ id, refType, refId: id, x: 0, y: 0 });
    const nodes = [
      N('in', 'externalEntity'), N('p1', 'transactionFunction'), N('ilf', 'dataFunction'), N('p2', 'transactionFunction'),
      N('out', 'externalEntity'), N('eif', 'dataFunction'), N('src-ds', 'dataFunction'),
      N('iso-ee', 'externalEntity'), N('iso-p', 'nonCountedProcess'),
    ];
    const E = (s: string, t: string) => ({ id: `${s}-${t}`, sourceNodeId: s, targetNodeId: t, label: '' });
    const edges = [E('in', 'p1'), E('p1', 'ilf'), E('ilf', 'p2'), E('p2', 'out'), E('eif', 'p2'), E('src-ds', 'p2')];
    const kind = (n: DfdNode) => (n.id === 'eif' ? 'EIF' : 'ILF') as 'EIF' | 'ILF';
    const pos = Object.fromEntries(layoutDfd(nodes, edges, kind).map((p) => [p.nodeId, p]));
    expect(Object.keys(pos)).toHaveLength(nodes.length);
    const placed = nodes.map((n) => ({ ...n, ...pos[n.id], kind: kind(n) }));
    const b = computeBoundary(placed)!;
    const box = (id: string) => {
      const n = placed.find((x) => x.id === id)!;
      const w = n.refType === 'externalEntity' ? 140 : n.refType === 'dataFunction' ? 180 : 88;
      const h = n.refType === 'externalEntity' ? 60 : n.refType === 'dataFunction' ? 44 : 88;
      return { l: n.x, r: n.x + w, t: n.y, btm: n.y + h };
    };
    // 内部要素（未接続の非計上プロセス、出力だけのデータストアも含む）は境界の内側
    for (const id of ['p1', 'ilf', 'p2', 'src-ds', 'iso-p']) {
      const x = box(id);
      expect(x.l >= b.x && x.r <= b.x + b.width && x.t >= b.y && x.btm <= b.y + b.height).toBe(true);
    }
    // 入力元・未接続の外部エンティティは左外、出力先だけのものは右外、EIF は下外
    expect(box('in').r).toBeLessThan(b.x);
    expect(box('iso-ee').r).toBeLessThan(b.x);
    expect(box('out').l).toBeGreaterThan(b.x + b.width);
    expect(box('eif').t).toBeGreaterThan(b.y + b.height);
  });
});

describe('legend（FR-DF-17）', () => {
  it('種別ごとの計上件数・合計・参照・未配置を数える', async () => {
    const { buildDfdLegend } = await import('./legend');
    const doc = sampleDocument();
    const l = buildDfdLegend(doc, 'fReg')!;
    expect(l.counts).toEqual({ ILF: 1, EIF: 0, EI: 1, EO: 1, EQ: 1 });
    expect(l.total).toBe(4);
    expect(l.unadjustedFp).toBe(21);
    expect(l.referenceCount).toBe(1); // 商品マスタ（所有: 商品登録）
    expect(l.unplacedCount).toBe(0);
    // 顧客検索は TF 2 件とも DFD 未配置
    expect(buildDfdLegend(doc, 'fSearch')).toMatchObject({ total: 2, unplacedCount: 2, referenceCount: 0 });
  });
});

describe('システム境界（FR-DF-19）', () => {
  it('外部エンティティと EIF を除く要素を余白付きで囲む', async () => {
    const { computeBoundary } = await import('./dfdGeometry');
    const b = computeBoundary([
      { refType: 'externalEntity', x: 0, y: 0 },
      { refType: 'transactionFunction', x: 200, y: 100 }, // 88x88
      { refType: 'dataFunction', kind: 'ILF', x: 400, y: 300 }, // 180x44
      { refType: 'dataFunction', kind: 'EIF', x: 900, y: 900 },
    ])!;
    expect(b).toEqual({ x: 168, y: 44, width: 612 - 168, height: 380 - 44 });
    expect(computeBoundary([{ refType: 'externalEntity', x: 0, y: 0 }])).toBeNull();
  });
});
