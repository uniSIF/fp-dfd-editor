import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleDocument } from '../domain/sampleDocument';
import { listBackups, readBackup, readLatestBackup, writeBackup } from './backup';

describe('backup（FR-SV-03〜05、FR-SV-09）', () => {
  beforeEach(() => localStorage.clear());

  it('世代数を超えた古い世代を削除し、最新を読み出せる', () => {
    const doc = sampleDocument();
    for (let i = 0; i < 4; i++) {
      doc.project.name = `v${i}`;
      expect(writeBackup(doc, 3, new Date(Date.UTC(2026, 10, 2, 10, i))).ok).toBe(true);
    }
    const list = listBackups();
    expect(list.map((b) => b.iso)).toEqual([
      '2026-11-02T10:03:00.000Z', '2026-11-02T10:02:00.000Z', '2026-11-02T10:01:00.000Z',
    ]);
    expect(localStorage.getItem('fpdfd.backup.2026-11-02T10:00:00.000Z')).toBeNull();
    const latest = readLatestBackup();
    expect(latest?.ok && latest.value.project.name).toBe('v3');
    const old = readBackup('2026-11-02T10:01:00.000Z');
    expect(old.ok && old.value.project.name).toBe('v1');
  });

  it('バックアップがなければ null', () => {
    expect(readLatestBackup()).toBeNull();
  });

  it('容量が足りないときは、書き込めるまで古い世代から削除して最新を残す', () => {
    const doc = sampleDocument();
    for (let i = 0; i < 4; i++) writeBackup(doc, 10, new Date(Date.UTC(2026, 0, 1 + i)));
    // 4 世代あるうち、2 世代まで減らさないと新しい世代が入らない保存領域
    const real = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k.startsWith('fpdfd.backup.2') && listBackups().length > 2) throw new DOMException('full', 'QuotaExceededError');
      real.call(this, k, v);
    });
    doc.project.name = '最新';
    const r = writeBackup(doc, 10, new Date(Date.UTC(2026, 0, 9)));
    spy.mockRestore();
    expect(r).toEqual({ ok: true, value: '2026-01-09T00:00:00.000Z', dropped: 2 });
    expect(listBackups().map((b) => b.iso)).toEqual(['2026-01-09T00:00:00.000Z', '2026-01-04T00:00:00.000Z', '2026-01-03T00:00:00.000Z']);
    const latest = readLatestBackup();
    expect(latest?.ok && latest.value.project.name).toBe('最新');
    // 足りていれば削除しない
    expect(writeBackup(doc, 10, new Date(Date.UTC(2026, 0, 10))).dropped).toBe(0);
  });

  it('すべての世代を削除しても書き込めなければ quota を返す', () => {
    const doc = sampleDocument();
    writeBackup(doc, 10, new Date(Date.UTC(2026, 0, 1)));
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const r = writeBackup(doc, 10, new Date(Date.UTC(2026, 0, 2)));
    spy.mockRestore();
    expect(r).toEqual({ ok: false, error: 'quota' });
    expect(listBackups()).toEqual([]);
  });
});
