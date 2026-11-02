import { nanoid } from 'nanoid';

export function newId(): string {
  return nanoid(12);
}

/** 表示用連番を "DF-001" 形式にする */
export function formatDisplayNo(prefix: 'DF' | 'TF' | 'EE', n: number): string {
  return `${prefix}-${String(n).padStart(3, '0')}`;
}
