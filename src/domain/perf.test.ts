import { describe, expect, it } from 'vitest';
import { calcSoftwareTotals } from './calc';
import { buildCsv } from './csvExport';
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
});
