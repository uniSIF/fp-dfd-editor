import { describe, expect, it } from 'vitest';
import { keepMeasured } from './rfMapping';
import type { DfdRfNode } from './nodes/DfdNodes';

const node = (id: string, width: number, measured?: { width: number; height: number }) =>
  ({ id, type: 'externalEntity', position: { x: 0, y: 0 }, data: {}, width, height: 60, ...(measured ? { measured } : {}) }) as unknown as DfdRfNode;

describe('keepMeasured', () => {
  it('作り直したノードに、前回測った寸法を引き継ぐ（データフローが 1 フレーム消えないように）', () => {
    const prev = [node('a', 140, { width: 140, height: 60 }), node('b', 140, { width: 140, height: 60 })];
    const next = keepMeasured(prev, [node('a', 140), node('b', 180), node('c', 140)]);
    expect(next[0].measured).toEqual({ width: 140, height: 60 });
    // 大きさが変わったノードと新しいノードは測り直させる
    expect(next[1].measured).toBeUndefined();
    expect(next[2].measured).toBeUndefined();
  });
});
