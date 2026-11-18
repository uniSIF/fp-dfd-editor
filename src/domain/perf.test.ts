import { describe, expect, it } from 'vitest';
import { calcSoftwareTotals } from './calc';
import { layoutDfd } from './autoLayout';
import { buildCsv } from './csvExport';
import { nodeBox, routeDataflows } from './dfdGeometry';
import { createSoftware, emptyDocument } from './emptyDocument';
import { validateSoftware } from './validation';
import type { DfdNode, FpDocument } from './types';

/** NFR-02: 1 ソフトウェア 200 機能・1 DFD 100 ノード規模での計算時間 */
function largeDocument(): FpDocument {
  const doc = emptyDocument();
  const sw = createSoftware('大規模', 'sw');
  sw.settings.newDev.hoursPerFp = 8;
  doc.softwares.sw = sw;
  doc.project.softwareIds = ['sw'];
  doc.category1s.c1 = { id: 'c1', softwareId: 'sw', name: '大', category2Ids: ['c2'] };
  sw.category1Ids = ['c1'];
  doc.category2s.c2 = { id: 'c2', category1Id: 'c1', name: '中', featureIds: [] };
  for (let f = 0; f < 200; f++) {
    const fid = `f${f}`;
    doc.category2s.c2.featureIds.push(fid);
    const nodes: DfdNode[] = [];
    for (let i = 0; i < 100; i++) {
      const tid = `${fid}t${i}`;
      doc.transactionFunctions[tid] = { id: tid, featureId: fid, displayNo: tid, name: `T${i}`, kind: 'EI', complexity: 'low', description: '' };
      nodes.push({ id: `${tid}n`, refType: 'transactionFunction' as const, refId: tid, x: i * 10, y: 0 });
    }
    const edges = nodes.slice(1).map((n, i) => ({ id: `${n.id}e`, sourceNodeId: nodes[i].id, targetNodeId: n.id, label: '' }));
    doc.features[fid] = { id: fid, category2Id: 'c2', name: `機能${f}`, devType: 'new', characteristics: Array(14).fill(2), vendorId: null, description: '', dfd: { nodes, edges } };
  }
  return doc;
}

describe('性能（NFR-02、NFR-03）', () => {
  it('200 機能 × 100 ファンクションの合計・警告・CSV を 1 秒以内に計算する', () => {
    const doc = largeDocument();
    const t0 = performance.now();
    const totals = calcSoftwareTotals(doc, 'sw');
    validateSoftware(doc, 'sw');
    buildCsv(doc, 'sw');
    const ms = performance.now() - t0;
    expect(totals.featureCount).toBe(200);
    expect(ms).toBeLessThan(1000);
  });

  it('100 ノード・150 データフローの DFD で、すべての経路（ノードを避ける曲線）とラベルの位置を 500ms 以内に求める', () => {
    // 10 × 10 の格子に並べ、離れたノードどうしも結んで、途中のノードを避ける必要がある線を多く作る
    const boxes = new Map(Array.from({ length: 100 }, (_, i) => [`${i}`, nodeBox(i % 3 ? 'transactionFunction' : 'dataFunction', (i % 10) * 240, Math.floor(i / 10) * 160, `要素${i}`)]));
    const edges = Array.from({ length: 150 }, (_, i) => ({ id: `e${i}`, sourceNodeId: `${i % 100}`, targetNodeId: `${(i * 37 + 11) % 100}`, label: i % 2 ? '検索条件と検索結果の一覧' : '' }));
    const t0 = performance.now();
    const routes = routeDataflows(boxes, edges);
    const ms = performance.now() - t0;
    expect(routes.size).toBe(150);
    // 実測は温まった状態で約 180ms（20 ノード・30 データフローなら約 7ms）。初回の JIT と CI の負荷を見込む
    expect(ms).toBeLessThan(500);
  });

  it('100 ノード・150 データフローの DFD を 1 秒以内に自動整列する（交差を減らす並べ替えを含む）', () => {
    const nodes: DfdNode[] = Array.from({ length: 100 }, (_, i) => ({
      id: `n${i}`, refType: i % 10 === 0 ? 'externalEntity' : i % 3 === 0 ? 'dataFunction' : 'transactionFunction', refId: `n${i}`, x: 0, y: 0,
    }));
    const tf = nodes.filter((n) => n.refType === 'transactionFunction');
    const other = nodes.filter((n) => n.refType !== 'transactionFunction');
    const edges = Array.from({ length: 150 }, (_, i) => {
      const [a, b] = [tf[(i * 7) % tf.length].id, other[(i * 5 + 3) % other.length].id];
      return { id: `e${i}`, sourceNodeId: i % 2 ? a : b, targetNodeId: i % 2 ? b : a, label: '検索条件' };
    });
    const t0 = performance.now();
    expect(layoutDfd(nodes, edges)).toHaveLength(100);
    // 実測は約 170ms
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
