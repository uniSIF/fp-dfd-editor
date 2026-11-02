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

  it('容量超過時は最古を消して再試行し、それでも失敗なら quota を返す', () => {
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
