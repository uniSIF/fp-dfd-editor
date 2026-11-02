import { describe, expect, it } from 'vitest';
import {
  calcAdjustedFp,
  calcCost,
  calcEffort,
  calcFeatureResultFor,
  calcSoftwareTotals,
  calcSplit,
  calcUnadjustedFp,
  calcVaf,
} from './calc';
import { sampleDocument } from './sampleDocument';

describe('calc（requirements.md 4.6）', () => {
  it('要件 4.6.9 の計算例と一致する', () => {
    const r = calcFeatureResultFor(sampleDocument(), 'fReg', 'sw1');
    expect(r.counts).toEqual({ ILF: 1, EIF: 0, EI: 1, EO: 1, EQ: 1 });
    expect(r.unadjustedFp).toBe(21);
    expect(r.characteristicsSum).toBe(28);
    expect(r.vaf).toBe(0.93);
    expect(r.adjustedFp).toBe(19);
    expect(r.effortHours).toBe(152);
    expect(r.inHouseHours).toBe(60);
    expect(r.outsourceHours).toBe(92);
    expect(r.cost).toBe(820_000);
  });

  it('付録 10.1 の 2 行目（改修）と一致する', () => {
    const r = calcFeatureResultFor(sampleDocument(), 'fSearch', 'sw1');
    expect(r.unadjustedFp).toBe(6);
    expect(r.adjustedFp).toBe(5);
    expect(r.modificationFactor).toBe(0.5);
    expect(r.effortHours).toBe(20);
    expect(r.inHouseHours).toBe(8);
    expect(r.outsourceHours).toBe(12);
    expect(r.cost).toBe(108_000);
  });

  it('参照配置した DF は参照側の件数に含まれない', () => {
    // 顧客登録の DFD には商品マスタ（所有: 商品登録）が参照配置されている
    const r = calcFeatureResultFor(sampleDocument(), 'fReg', 'sw1');
    expect(r.counts.ILF).toBe(1);
    const item = calcFeatureResultFor(sampleDocument(), 'fItem', 'sw1');
    expect(item.counts.ILF).toBe(1);
    expect(item.unadjustedFp).toBe(10);
  });

  it('VAF の下限と上限', () => {
    expect(calcVaf(Array(14).fill(0))).toBe(0.65);
    expect(calcVaf(Array(14).fill(5))).toBe(1.35);
  });

  it('調整済み FP は浮動小数誤差なく切り捨てる', () => {
    expect(calcAdjustedFp(21, 0.93)).toBe(19);
    expect(calcAdjustedFp(100, 0.99)).toBe(99);
    expect(calcAdjustedFp(100, 1.0)).toBe(100);
    expect(calcAdjustedFp(7, 0.7)).toBe(4);
  });

  it('工数と配分の切り捨て', () => {
    expect(calcEffort(19, 1, 8)).toBe(152);
    expect(calcEffort(5, 0.5, 8)).toBe(20);
    expect(calcEffort(3, 1.1, 10)).toBe(33); // 32.999999… にならない
    expect(calcSplit(152, 0.4)).toEqual({ inHouse: 60, outsource: 92 });
    expect(calcSplit(20, 0.4)).toEqual({ inHouse: 8, outsource: 12 });
    expect(calcSplit(10, 1)).toEqual({ inHouse: 10, outsource: 0 });
  });

  it('未調整 FP は係数表を合計する', () => {
    expect(calcUnadjustedFp([
      { kind: 'ILF', complexity: 'high' },
      { kind: 'EIF', complexity: 'medium' },
      { kind: 'EO', complexity: 'high' },
    ])).toBe(15 + 7 + 7);
  });

  it('業者未選択で外注工数がある場合、外注分の費用は 0 で警告フラグが立つ', () => {
    const doc = sampleDocument();
    doc.features.fReg.vendorId = null;
    const r = calcFeatureResultFor(doc, 'fReg', 'sw1');
    expect(r.cost).toBe(60 * 6000);
    expect(r.vendorMissing).toBe(true);
    expect(calcCost(1, 100, 2, null)).toBe(100);
  });

  it('社内配分比率 1.0 では業者未選択でも警告しない（A-11）', () => {
    const doc = sampleDocument();
    doc.softwares.sw1.settings.inHouseRatio = 1;
    doc.features.fReg.vendorId = null;
    const r = calcFeatureResultFor(doc, 'fReg', 'sw1');
    expect(r.outsourceHours).toBe(0);
    expect(r.vendorMissing).toBe(false);
  });

  it('H/FP 未設定は 0 として計算し、フラグが立つ（A-04）', () => {
    const doc = sampleDocument();
    doc.softwares.sw1.settings.newDev.hoursPerFp = null;
    const r = calcFeatureResultFor(doc, 'fReg', 'sw1');
    expect(r.effortHours).toBe(0);
    expect(r.hoursPerFpUnset).toBe(true);
  });

  it('ソフトウェア合計', () => {
    const t = calcSoftwareTotals(sampleDocument(), 'sw1');
    expect(t.featureCount).toBe(3);
    expect(t.unadjustedFp).toBe(21 + 6 + 10);
    expect(t.adjustedFp).toBe(19 + 5 + 9);
    expect(t.effortHours).toBe(152 + 20 + 72);
    expect(t.inHouseHours).toBe(60 + 8 + 28);
    expect(t.outsourceHoursByVendor).toEqual({ vA: 92 + 44, vB: 12 });
    expect(t.cost).toBe(820_000 + 108_000 + 388_000);
  });
});
