import { parseDocumentJson, type LoadError, type Result } from '../domain/migrations';
import type { FpDocument } from '../domain/types';

/** localStorage の自動バックアップ（FR-SV-03〜05、FR-SV-09、design.md 8.3） */
export const INDEX_KEY = 'fpdfd.backup.index';
export const entryKey = (iso: string) => `fpdfd.backup.${iso}`;

export type BackupWriteError = 'quota' | 'unavailable';

export interface BackupInfo {
  iso: string;
  size: number;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** localStorage が使えるか（プライベートモードなどで例外になる環境を検知する） */
export function isBackupAvailable(): boolean {
  const ls = storage();
  if (!ls) return false;
  try {
    const k = 'fpdfd.probe';
    ls.setItem(k, '1');
    ls.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

function readIndex(ls: Storage): string[] {
  try {
    const raw = ls.getItem(INDEX_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function isQuotaError(e: unknown): boolean {
  return e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22 || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');
}

/** バックアップを 1 世代書き込み、generations を超えた古い世代を削除する */
export function writeBackup(doc: FpDocument, generations: number, now = new Date()): Result<string, BackupWriteError> {
  const ls = storage();
  if (!ls) return { ok: false, error: 'unavailable' };
  let iso = now.toISOString();
  const index = readIndex(ls);
  while (index.includes(iso)) iso = new Date(Date.parse(iso) + 1).toISOString();
  const data = JSON.stringify(doc);

  const tryWrite = (): boolean => {
    ls.setItem(entryKey(iso), data);
    return true;
  };
  try {
    tryWrite();
  } catch (e) {
    if (!isQuotaError(e)) return { ok: false, error: 'unavailable' };
    // 最古の世代を 1 つ削除して 1 回だけ再試行
    const oldest = index.shift();
    if (oldest) ls.removeItem(entryKey(oldest));
    try {
      tryWrite();
    } catch {
      try {
        ls.setItem(INDEX_KEY, JSON.stringify(index));
      } catch {
        // インデックスも書けない場合、削除済みの世代は listBackups で除外される
      }
      return { ok: false, error: 'quota' };
    }
  }
  index.push(iso);
  while (index.length > generations) {
    const old = index.shift()!;
    ls.removeItem(entryKey(old));
  }
  try {
    ls.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    return { ok: false, error: 'quota' };
  }
  return { ok: true, value: iso };
}

/** 新しい順のバックアップ一覧 */
export function listBackups(): BackupInfo[] {
  const ls = storage();
  if (!ls) return [];
  return readIndex(ls)
    .map((iso) => ({ iso, size: (ls.getItem(entryKey(iso)) ?? '').length * 2 }))
    .filter((b) => b.size > 0)
    .reverse();
}

export function readBackup(iso: string): Result<FpDocument, LoadError> {
  const ls = storage();
  const text = ls?.getItem(entryKey(iso));
  if (!text) return { ok: false, error: { kind: 'parse', message: 'バックアップが見つかりません。' } };
  return parseDocumentJson(text);
}

export function readLatestBackup(): Result<FpDocument, LoadError> | null {
  const latest = listBackups()[0];
  return latest ? readBackup(latest.iso) : null;
}
