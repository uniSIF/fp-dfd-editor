import { describe, expect, it } from 'vitest';
import type { DfdNode } from './types';
import { layoutDfd } from './autoLayout';
import { buildCsv, buildLedgerCsv, escapeCsv } from './csvExport';
import { canConnect, canConnectNodes, type NodeKindForRule } from './dfdRules';
import { clipToBoundary, countCrossings, edgeBias, edgeLabelLines, edgeLabelSize, nodeBox, pointOnRoute, routeDataflows, routeEdge, segmentsCross, wrapLabel, type Box, type EdgeRoute } from './dfdGeometry';
import { migrateAndValidate, parseDocumentJson } from './migrations';
import { refName } from './queries';
import { sampleDocument } from './sampleDocument';
import { createAppStore } from '../store';
import { buildAllDfdSvgs, buildDfdIndexTsv, buildDfdSvg } from './svgExport';
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
      '機能名（大分類）,機能名（中分類）,機能名（小分類）,ILF（低）,ILF（中）,ILF（高）,EIF（低）,EIF（中）,EIF（高）,EI（低）,EI（中）,EI（高）,EO（低）,EO（中）,EO（高）,EQ（低）,EQ（中）,EQ（高）,C1,C2,C3,C4,C5,C6,C7,C8,C9,C10,C11,C12,C13,C14,開発区分,未調整FP値,調整係数,調整済FP値,改修係数,開発工数,社内工数,外注工数（A社）,外注工数（B社）,開発単価,説明',
    );
    expect(lines[1]).toBe(
      '顧客管理,顧客情報,顧客登録,0,1,0,0,0,0,0,1,0,1,0,0,1,0,0,3,2,3,2,1,2,3,2,1,1,2,3,2,1,新規,21,0.93,19,1.00,152,60,92,,820000,顧客の新規登録。氏名、住所、連絡先を入力し顧客マスタに登録する',
    );
    expect(lines[2]).toBe(
      '顧客管理,顧客情報,顧客検索,0,0,0,0,0,0,0,0,0,0,0,0,2,0,0,3,2,3,2,1,2,3,2,1,1,2,3,2,1,改修,6,0.93,5,0.50,20,8,,12,108000,既存の検索画面に詳細照会を追加',
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
  it('すべての DFD を分類のパスで SVG にし、要素のない DFD は除き、同じパスには番号を付ける（FR-SVG-07）', () => {
    const doc = sampleDocument();
    const all = buildAllDfdSvgs(doc, 'sw1');
    // 顧客検索は DFD に要素がないため除く
    expect(all.map((f) => f.path)).toEqual(['顧客管理/顧客情報/顧客登録.svg', '商品管理/商品情報/商品登録.svg']);
    expect(all[0].svg).toBe(buildDfdSvg(doc, 'fReg'));
    expect(buildDfdIndexTsv(all)).toBe('パス\t大分類\t中分類\t機能名\r\n顧客管理/顧客情報/顧客登録.svg\t顧客管理\t顧客情報\t顧客登録\r\n商品管理/商品情報/商品登録.svg\t商品管理\t商品情報\t商品登録\r\n');
    doc.features.fSearch.name = '顧客登録';
    doc.features.fSearch.dfd.nodes = structuredClone(doc.features.fReg.dfd.nodes);
    expect(buildAllDfdSvgs(doc, 'sw1').map((f) => f.path)).toEqual(['顧客管理/顧客情報/顧客登録.svg', '顧客管理/顧客情報/顧客登録 (2).svg', '商品管理/商品情報/商品登録.svg']);
  });

  it('整形式で、ノードとエッジの要素を含み、ズームに依存しない viewBox を持つ', () => {
    const svg = buildDfdSvg(sampleDocument(), 'fReg');
    const dom = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(dom.getElementsByTagName('parsererror')).toHaveLength(0);
    const root = dom.documentElement;
    expect(root.getAttribute('viewBox')).toMatch(/^-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+$/);
    expect(root.getAttribute('font-family')).toContain('Hiragino Sans');
    expect(dom.getElementsByTagName('ellipse')).toHaveLength(3); // TF 3 件（名称が長いと横長になるので楕円）
    expect(dom.querySelectorAll('path[marker-end]')).toHaveLength(7);
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
  it('線分の交差は、端点以外の 1 点で交わるときだけ数える', () => {
    const P = (x: number, y: number) => ({ x, y });
    expect(segmentsCross(P(0, 0), P(10, 10), P(0, 10), P(10, 0))).toBe(true);
    expect(segmentsCross(P(0, 0), P(10, 0), P(0, 5), P(10, 5))).toBe(false); // 平行
    expect(segmentsCross(P(0, 0), P(10, 0), P(10, 0), P(20, 5))).toBe(false); // 端点を共有
  });

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

  it('データフローのラベルは 12 文字幅以内で行の幅をそろえて折り返し、省略しない', () => {
    expect(edgeLabelLines('')).toEqual([]);
    expect(edgeLabelLines('登録情報')).toEqual(['登録情報']);
    const lines = edgeLabelLines('顧客の氏名・住所・電話番号などの登録情報（必須項目を含む）');
    expect(lines.join('')).toBe('顧客の氏名・住所・電話番号などの登録情報（必須項目を含む）');
    expect(lines).toHaveLength(3);
    // 13 文字は 12 + 1 ではなく 7 + 6
    expect(edgeLabelLines('登録した顧客の番号と登録日')).toEqual(['登録した顧客の', '番号と登録日']);
    // 閉じ括弧・中点は行頭に、開き括弧は行末に置かない
    for (const text of ['登録する顧客データ（氏名・住所・電話番号・メール）', '登録完了のお知らせ（メール本文と宛先）', 'あいうえおかきくけこさしすせそたちつてと・なにぬ']) {
      for (const [i, line] of edgeLabelLines(text).entries()) {
        if (i > 0) expect(line).not.toMatch(/^[）・]/);
        expect(line).not.toMatch(/（$/);
      }
    }
    expect(edgeLabelSize('登録情報')).toEqual({ width: 4 * 12 + 8, height: 15 });
    expect(edgeLabelSize('')).toEqual({ width: 0, height: 0 });
  });

  it('データフローは、途中のノードを通らなければ直線、通るなら曲線で避ける', () => {
    const a = nodeBox('externalEntity', 0, 100);
    const mid = nodeBox('transactionFunction', 300, 86);
    const b = nodeBox('transactionFunction', 600, 86);
    expect(routeEdge(a, b, [a, b]).path).toMatch(/^M [\d.]+ [\d.]+ L /);
    const r = routeEdge(a, b, [a, mid, b]);
    expect(r.path).toContain(' Q ');
    // 曲線の中間点（ラベルの位置）は、真ん中のノードの外にある
    const c = { x: mid.x + mid.width / 2, y: mid.y + mid.height / 2 };
    expect(Math.hypot(r.label.x - c.x, r.label.y - c.y)).toBeGreaterThan(mid.width / 2);
    // 端点は両端の図形の境界上（矢印が図形に隠れない）
    expect(r.start.x).toBeCloseTo(a.x + a.width, 0);
  });

  it('短い線では、ラベルで矢じりや線が隠れないよう線の脇に置く', () => {
    const label = '受注明細の確認結果';
    const size = edgeLabelSize(label);
    // 線の長さがラベルの幅とほぼ同じ
    const a = nodeBox('externalEntity', 0, 0);
    const b = nodeBox('externalEntity', 140 + size.width + 10, 0);
    const boxes = new Map([['a', a], ['b', b]]);
    const r = routeDataflows(boxes, [{ id: 'e', sourceNodeId: 'a', targetNodeId: 'b', label }]).get('e')!;
    // ラベルの矩形が線（y = 30）に掛からない
    expect(Math.abs(r.label.y - 30)).toBeGreaterThanOrEqual(size.height / 2);
    // 長い線なら、これまでどおり線の上に置く
    const far = nodeBox('externalEntity', 140 + size.width + 120, 0);
    const r2 = routeDataflows(new Map([['a', a], ['b', far]]), [{ id: 'e', sourceNodeId: 'a', targetNodeId: 'b', label }]).get('e')!;
    expect(r2.label.y).toBeCloseTo(30, 0);
  });

  it('ラベルが両端のノードに重なる短い直線は、曲げてラベルを外に出す', () => {
    const a = nodeBox('transactionFunction', 0, 0);
    const b = nodeBox('transactionFunction', 120, 0);
    const size = edgeLabelSize('とても長いデータフローの説明');
    const r = routeEdge(a, b, [a, b], size);
    expect(r.path).toContain(' Q ');
    expect(Math.abs(r.label.y - 44)).toBeGreaterThanOrEqual(44 + size.height / 2 - 1);
  });

  it('ラベルは、ほかのデータフローの線・ラベルとシステム境界の線に重ならない位置に置く', () => {
    // 同じ 2 つのノードを結ぶ 3 本の線は、間隔 36px で並ぶ。長いラベルを線の上に置くと隣の線を隠す
    const ends = new Map<string, Box>([['a1', nodeBox('externalEntity', 0, 0)], ['b1', nodeBox('externalEntity', 700, 0)]]);
    const edges = [0, 1, 2].map((i) => ({ id: `e${i}`, sourceNodeId: 'a1', targetNodeId: 'b1', label: i === 1 ? '顧客の氏名・住所・電話番号などの登録情報' : `線${i}` }));
    const boundary = { x: 200, y: -200, width: 300, height: 400 };
    const routes = routeDataflows(ends, edges, boundary);
    const size = edgeLabelSize(edges[1].label);
    const label = routes.get('e1')!.label;
    const covers = (p: { x: number; y: number }) => Math.abs(p.x - label.x) < size.width / 2 && Math.abs(p.y - label.y) < size.height / 2;
    for (const id of ['e0', 'e2']) {
      const r = routes.get(id)!;
      for (let t = 0.02; t < 1; t += 0.02) expect(covers(pointOnRoute(r, t)), `${id} t=${t}`).toBe(false);
    }
    // 境界の左右の辺（x=200, 500）にも重ならない
    expect(label.x + size.width / 2 < 200 || label.x - size.width / 2 > 200).toBe(true);
    expect(label.x + size.width / 2 < 500 || label.x - size.width / 2 > 500).toBe(true);
    // ほかのラベルとも重ならない
    for (const id of ['e0', 'e2']) {
      const o = routes.get(id)!.label;
      const os = edgeLabelSize(edges[Number(id[1])].label);
      expect(Math.abs(o.x - label.x) >= (os.width + size.width) / 2 || Math.abs(o.y - label.y) >= (os.height + size.height) / 2).toBe(true);
    }
  });

  it('同じ 2 つのノードを往復するデータフローは反対側に膨らませる', () => {
    const edges = [{ id: 'x', sourceNodeId: 'p', targetNodeId: 'q' }, { id: 'y', sourceNodeId: 'q', targetNodeId: 'p' }, { id: 'z', sourceNodeId: 'p', targetNodeId: 'r' }];
    expect(edgeBias(edges, 'z')).toBe(0);
    const a = nodeBox('transactionFunction', 0, 0);
    const b = nodeBox('transactionFunction', 400, 0);
    const rx = routeEdge(a, b, [a, b], undefined, edgeBias(edges, 'x'));
    const ry = routeEdge(b, a, [a, b], undefined, edgeBias(edges, 'y'));
    expect(Math.sign(rx.label.y - 44)).toBe(-Math.sign(ry.label.y - 44));
    expect(Math.abs(rx.label.y - ry.label.y)).toBeGreaterThan(30);
  });

  it('ノードは名称が 2 行に収まるよう横に伸び、名称は省略しない（高さは固定）', async () => {
    const { nodeLayout, nodeSize, wrapLabel: wrap } = await import('./dfdGeometry');
    // 短い名称は既定の大きさ
    expect(nodeSize('transactionFunction', '顧客登録')).toEqual({ width: 88, height: 88 });
    expect(nodeSize('dataFunction', '顧客マスタ')).toEqual({ width: 180, height: 60 });
    expect(nodeSize('externalEntity', '利用者')).toEqual({ width: 140, height: 60 });
    for (const refType of ['transactionFunction', 'nonCountedProcess', 'dataFunction', 'externalEntity'] as const) {
      for (const name of ['顧客情報の新規登録画面からの入力受付と顧客情報の検証', 'Customer master (corporate and individual)', '在庫ｶﾅ混在の名称テスト']) {
        const l = nodeLayout(refType, name);
        const lines = wrap(name, l.lineUnits);
        expect(lines.length).toBeLessThanOrEqual(2);
        expect(lines.join('')).toBe(name);
        expect(l.height).toBe(nodeSize(refType).height);
        expect(l.width).toBeGreaterThanOrEqual(nodeSize(refType).width);
      }
      // 長い名称では既定より横に伸びる
      expect(nodeSize(refType, '顧客情報の新規登録画面からの入力受付と顧客情報の検証').width).toBeGreaterThan(nodeSize(refType).width);
    }
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

  it('1 つの外部エンティティから長いラベルのデータフローが何本も出ても、整列後のラベルはほかの線を隠さない', () => {
    const N = (id: string, refType: DfdNode['refType']): DfdNode => ({ id, refType, refId: id, x: 0, y: 0 });
    const nodes = [N('ee', 'externalEntity'), N('p1', 'transactionFunction'), N('p2', 'transactionFunction'), N('p3', 'transactionFunction'), N('p4', 'transactionFunction'), N('ilf', 'dataFunction')];
    const L = '顧客の氏名・住所・電話番号・メールアドレスなどの入力内容';
    const edges = [
      ...['p1', 'p2', 'p3', 'p4'].map((p, i) => ({ id: `in${i}`, sourceNodeId: 'ee', targetNodeId: p, label: `${L}${i}` })),
      ...['p1', 'p2', 'p3'].map((p, i) => ({ id: `w${i}`, sourceNodeId: p, targetNodeId: 'ilf', label: `更新する顧客データ（全項目）${i}` })),
      { id: 'r', sourceNodeId: 'ilf', targetNodeId: 'p4', label: '検索に一致した顧客の一覧' },
      { id: 'o', sourceNodeId: 'p4', targetNodeId: 'ee', label: '検索結果の一覧（氏名・住所・電話番号）' },
    ];
    const pos = new Map(layoutDfd(nodes, edges).map((p) => [p.nodeId, p]));
    const boxes = new Map<string, Box>(nodes.map((n) => [n.id, nodeBox(n.refType, pos.get(n.id)!.x, pos.get(n.id)!.y)]));
    const routes = routeDataflows(boxes, edges);
    const covered: string[] = [];
    for (const e of edges) {
      const l = routes.get(e.id)!.label;
      const size = edgeLabelSize(e.label);
      for (const o of edges.filter((x) => x.id !== e.id)) {
        for (let t = 0.02; t < 1; t += 0.02) {
          const p = pointOnRoute(routes.get(o.id)!, t);
          if (Math.abs(p.x - l.x) < size.width / 2 && Math.abs(p.y - l.y) < size.height / 2) {
            covered.push(`${e.id} のラベルが ${o.id} を隠す`);
            break;
          }
        }
      }
    }
    expect(covered).toEqual([]);
  });

  // 受注管理の DFD（外部エンティティ 3、プロセス 6、ILF 3、EIF 1）
  const orderDfd = () => {
    const N = (id: string, refType: DfdNode['refType']): DfdNode => ({ id, refType, refId: id, x: 0, y: 0 });
    const E = (s: string, t: string, label: string) => ({ id: `${s}>${t}`, sourceNodeId: s, targetNodeId: t, label });
    const nodes = [
      N('cust', 'externalEntity'), N('staff', 'externalEntity'), N('wms', 'externalEntity'),
      N('reg', 'transactionFunction'), N('upd', 'transactionFunction'), N('del', 'transactionFunction'), N('inq', 'transactionFunction'), N('ship', 'transactionFunction'), N('rep', 'transactionFunction'),
      N('order', 'dataFunction'), N('custm', 'dataFunction'), N('item', 'dataFunction'), N('stock', 'dataFunction'),
    ];
    const edges = [
      E('cust', 'reg', '注文内容'), E('reg', 'order', '受注データ'), E('custm', 'reg', '顧客情報'), E('item', 'reg', '商品情報'), E('reg', 'cust', '受付結果'),
      E('staff', 'upd', '変更内容'), E('upd', 'order', '受注データ'), E('staff', 'del', '取消指示'), E('del', 'order', '取消'),
      E('staff', 'inq', '検索条件'), E('order', 'inq', '受注一覧'), E('inq', 'staff', '検索結果'),
      E('staff', 'ship', '出荷指示'), E('order', 'ship', '受注'), E('stock', 'ship', '在庫'), E('ship', 'wms', '出荷データ'),
      E('staff', 'rep', '集計条件'), E('order', 'rep', '受注'), E('rep', 'staff', '月次集計表'),
    ];
    const kind = (n: DfdNode) => (n.id === 'stock' ? 'EIF' : 'ILF') as 'EIF' | 'ILF';
    const pos = new Map(layoutDfd(nodes, edges, kind).map((p) => [p.nodeId, p]));
    const boxes = new Map<string, Box>(nodes.map((n) => [n.id, nodeBox(n.refType, pos.get(n.id)!.x, pos.get(n.id)!.y)]));
    return { nodes, edges, boxes };
  };

  it('データファンクションから読むプロセスも、外部エンティティ → プロセス → データファンクションの順に左から並べる', () => {
    const { nodes, boxes } = orderDfd();
    const xs = (t: DfdNode['refType']) => nodes.filter((n) => n.refType === t && n.id !== 'stock' && n.id !== 'wms').map((n) => boxes.get(n.id)!.x);
    expect(Math.max(...xs('externalEntity'))).toBeLessThan(Math.min(...xs('transactionFunction')));
    expect(Math.max(...xs('transactionFunction'))).toBeLessThan(Math.min(...xs('dataFunction')));
  });

  it('自動整列と線の引き直しで、データフローの交差を減らす', () => {
    const { edges, boxes } = orderDfd();
    const routes = routeDataflows(boxes, edges);
    // 1 本ずつ引いた（交差を考えない）経路より少ない。並べ替え前の dagre の並びでは 7 か所交差していた
    const independent = new Map<string, EdgeRoute>(edges.map((e) => [e.id, routeEdge(boxes.get(e.sourceNodeId)!, boxes.get(e.targetNodeId)!, [...boxes.values()], edgeLabelSize(e.label), edgeBias(edges, e.id))]));
    expect(countCrossings(routes, edges)).toBeLessThan(countCrossings(independent, edges));
    expect(countCrossings(routes, edges)).toBeLessThanOrEqual(3);

    // サンプルの顧客登録は交差なく並ぶ
    const store = createAppStore(sampleDocument());
    store.getState().applyLayout('fReg');
    const doc = store.getState().doc;
    const dfd = doc.features.fReg.dfd;
    const sampleBoxes = new Map<string, Box>(dfd.nodes.map((n) => [n.id, nodeBox(n.refType, n.x, n.y, refName(doc, n.refType, n.refId))]));
    expect(countCrossings(routeDataflows(sampleBoxes, dfd.edges), dfd.edges)).toBe(0);
  });

  it('データフローのラベルが長いほど、ノードの間と境界の外の間隔を広げる', () => {
    const N = (id: string, refType: DfdNode['refType']) => ({ id, refType, refId: id, x: 0, y: 0 });
    const nodes = [N('ee', 'externalEntity'), N('p1', 'transactionFunction'), N('p2', 'transactionFunction')];
    const run = (label: string) => {
      const edges = [
        { id: 'a', sourceNodeId: 'ee', targetNodeId: 'p1', label },
        { id: 'b', sourceNodeId: 'p1', targetNodeId: 'p2', label },
      ];
      const pos = Object.fromEntries(layoutDfd(nodes, edges).map((p) => [p.nodeId, p]));
      return { eeToP1: pos.p1.x - (pos.ee.x + 140), p1ToP2: pos.p2.x - (pos.p1.x + 88) };
    };
    const short = run('');
    const long = run('顧客の氏名・住所・電話番号など');
    const w = edgeLabelSize('顧客の氏名・住所・電話番号など').width;
    expect(long.p1ToP2).toBeGreaterThan(short.p1ToP2);
    expect(long.p1ToP2).toBeGreaterThanOrEqual(w);
    expect(long.eeToP1).toBeGreaterThanOrEqual(w);
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
      { refType: 'dataFunction', kind: 'ILF', x: 400, y: 300 }, // 180x60
      { refType: 'dataFunction', kind: 'EIF', x: 900, y: 900 },
    ])!;
    expect(b).toEqual({ x: 168, y: 44, width: 612 - 168, height: 396 - 44 });
    expect(computeBoundary([{ refType: 'externalEntity', x: 0, y: 0 }])).toBeNull();
  });
});
