import type { NodeRefType } from './types';

/**
 * 同じ実体を 1 つの DFD に複数配置できるか（FR-DF-18）。
 * 外部エンティティは入力側と出力側に分けて置けるようにする。データファンクションは 1 回まで。
 */
export function canPlaceMultiple(refType: NodeRefType): boolean {
  return refType === 'externalEntity';
}

export type NodeKindForRule = 'process' | 'dataStore' | 'externalEntity';

export function ruleKindOf(refType: NodeRefType): NodeKindForRule {
  switch (refType) {
    case 'transactionFunction':
    case 'nonCountedProcess':
      return 'process';
    case 'dataFunction':
      return 'dataStore';
    case 'externalEntity':
      return 'externalEntity';
  }
}

const RULE_LABELS: Record<NodeKindForRule, string> = {
  process: 'プロセス',
  dataStore: 'データストア',
  externalEntity: '外部エンティティ',
};

export type ConnectResult = { ok: true } | { ok: false; reason: string };

/**
 * DFD の接続ルール（FR-DF-06）。プロセスを介さない接続
 * （外部エンティティ同士、データストア同士、外部エンティティとデータストア）を禁止する。
 */
export function canConnect(source: NodeKindForRule, target: NodeKindForRule): ConnectResult {
  if (source === 'process' || target === 'process') return { ok: true };
  const a = RULE_LABELS[source];
  const b = RULE_LABELS[target];
  const pair = a === b ? `${a}同士` : `${a}と${b}`;
  return { ok: false, reason: `${pair}は直接接続できません。プロセスを介してください。` };
}

export function canConnectNodes(
  source: { id: string; refType: NodeRefType },
  target: { id: string; refType: NodeRefType },
): ConnectResult {
  if (source.id === target.id) return { ok: false, reason: '同じノード同士は接続できません。' };
  return canConnect(ruleKindOf(source.refType), ruleKindOf(target.refType));
}
