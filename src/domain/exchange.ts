import { z } from 'zod';
import { canConnect, ruleKindOf } from './dfdRules';
import { COMPLEXITY_LABELS, DEV_TYPE_LABELS, FUNCTION_KIND_LABELS } from './fpTables';
import { featurePathLabel, featuresInOrder, getFeaturePath, refName, softwareIdOfFeature } from './queries';
import type { Complexity, DataFunctionKind, DfdNode, FpDocument, Id, NodeRefType, TransactionKind } from './types';

/**
 * AI エージェント（Microsoft Copilot など）と DFD をやり取りする交換形式（FR-IO-01〜03）。
 * 1 つの機能の DFD を「完成形」で受け渡す。エージェントは同じ形式で完成形を返し、取り込み時に差分を計算する。
 * 要素はキー（DF-001 などの表示番号、非計上プロセスは NCP-<ID>、新しい要素はエージェントが付ける任意の文字列）で識別する。
 */
export const EXCHANGE_FORMAT = 'fp-dfd-exchange';
export const EXCHANGE_VERSION = 1;

export interface ExchangeElement {
  key: string;
  name: string;
  description: string;
}
export interface ExchangeDataFunction extends ExchangeElement {
  kind: DataFunctionKind;
  complexity: Complexity;
}
export interface ExchangeTransaction extends ExchangeElement {
  kind: TransactionKind;
  complexity: Complexity;
}
export interface ExchangeFlow {
  from: string;
  to: string;
  label: string;
}
export interface ExchangeDfd {
  externalEntities: ExchangeElement[];
  dataFunctions: ExchangeDataFunction[];
  transactionFunctions: ExchangeTransaction[];
  nonCountedProcesses: ExchangeElement[];
  dataFlows: ExchangeFlow[];
}

const ncpKey = (id: Id) => `NCP-${id}`;

/** 交換データに含める、エージェント向けの作業ルール（プロンプトを渡さなくても読めるように） */
const RULES = {
  purpose:
    'この JSON は FP 法（ファンクションポイント法）で見積もるための DFD（データフロー図）1 機能分です。dfd を編集し、同じ形式の JSON（format・version・feature.key・dfd を含む）で完成形を返してください。',
  elementKinds: {
    externalEntities: '外部エンティティ。利用者や外部システムなど、システムの外にあるデータの出どころ・行き先',
    dataFunctions: 'データファンクション（データストア）。ILF=この機能を含むシステム内で維持するファイル、EIF=他システムが維持し参照するだけのファイル',
    transactionFunctions: 'トランザクションファンクション（プロセス）。EI=外部入力（データを受け取り ILF を更新する等）、EO=外部出力（計算・加工を伴う出力）、EQ=外部照会（加工のない参照・照会）',
    nonCountedProcesses: 'FP に計上しないプロセス（内部の中継処理など）',
  },
  complexity: 'complexity は low（低）・medium（中）・high（高）のいずれか',
  keys:
    '既存の要素は key を変えないこと。新しい要素には他と重ならない任意の key（例: NEW-1）を付ける。catalog にある外部エンティティ・データファンクションを使う場合は、その key をそのまま dfd に書く（参照として配置される）',
  dataFlows:
    'dataFlows の from / to は dfd 内の要素の key。外部エンティティ同士、データファンクション同士、外部エンティティとデータファンクションは直接つなげない（必ずプロセスを介する）。label には流れるデータの名称を書く',
  description: '各要素の description には、その要素を置いた理由や FP の判断根拠を簡潔に書く',
  output: '返答の JSON は 1 つのコードブロック（```json）にまとめる。説明文はコードブロックの外に書いてよい',
} as const;

/** 機能の DFD を交換形式にする */
export function buildExchange(doc: FpDocument, featureId: Id) {
  const path = getFeaturePath(doc, featureId);
  const swId = softwareIdOfFeature(doc, featureId);
  if (!path || !swId) throw new Error(`feature not found: ${featureId}`);
  const f = path.feature;
  const nodes = f.dfd.nodes;
  const placed = (refType: NodeRefType, refId: Id) => nodes.some((n) => n.refType === refType && n.refId === refId);

  const keyOfNode = (n: DfdNode) => entityKey(doc, n.refType, n.refId);
  // DFD に置いた要素と、この機能に属する未配置の要素
  const dfd: ExchangeDfd = {
    externalEntities: uniq(nodes.filter((n) => n.refType === 'externalEntity').map((n) => n.refId))
      .map((id) => doc.externalEntities[id]).filter(Boolean)
      .map((e) => ({ key: e.displayNo, name: e.name, description: e.description })),
    dataFunctions: Object.values(doc.dataFunctions)
      .filter((d) => d.softwareId === swId && (placed('dataFunction', d.id) || d.ownerFeatureId === featureId))
      .map((d) => ({ key: d.displayNo, name: d.name, kind: d.kind, complexity: d.complexity, description: d.description })),
    transactionFunctions: Object.values(doc.transactionFunctions)
      .filter((t) => t.featureId === featureId)
      .map((t) => ({ key: t.displayNo, name: t.name, kind: t.kind, complexity: t.complexity, description: t.description })),
    nonCountedProcesses: Object.values(doc.nonCountedProcesses)
      .filter((p) => p.featureId === featureId)
      .map((p) => ({ key: ncpKey(p.id), name: p.name, description: p.description })),
    dataFlows: f.dfd.edges.flatMap((e) => {
      const a = nodes.find((n) => n.id === e.sourceNodeId);
      const b = nodes.find((n) => n.id === e.targetNodeId);
      return a && b ? [{ from: keyOfNode(a), to: keyOfNode(b), label: e.label }] : [];
    }),
  };

  return {
    format: EXCHANGE_FORMAT,
    version: EXCHANGE_VERSION,
    rules: RULES,
    software: { name: doc.softwares[swId].name },
    feature: {
      key: f.id,
      path: featurePathLabel(doc, featureId),
      name: f.name,
      description: f.description,
      devType: DEV_TYPE_LABELS[f.devType],
    },
    dfd,
    catalog: {
      note: '同じソフトウェアにある既存の外部エンティティとデータファンクション。DFD で使う場合は key をそのまま書く。他の機能が所有するデータファンクションは参照として置かれ、この機能の FP には計上されない',
      externalEntities: Object.values(doc.externalEntities)
        .filter((e) => e.softwareId === swId)
        .map((e) => ({ key: e.displayNo, name: e.name, description: e.description })),
      dataFunctions: Object.values(doc.dataFunctions)
        .filter((d) => d.softwareId === swId)
        .map((d) => ({
          key: d.displayNo, name: d.name, kind: d.kind, kindLabel: FUNCTION_KIND_LABELS[d.kind], complexity: d.complexity,
          owner: d.ownerFeatureId === featureId ? 'この機能' : d.ownerFeatureId ? featurePathLabel(doc, d.ownerFeatureId) : '未設定',
        })),
      otherFeatures: featuresInOrder(doc, swId).filter((x) => x.id !== featureId).map((x) => featurePathLabel(doc, x.id)),
    },
  };
}

export type Exchange = ReturnType<typeof buildExchange>;

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

/** 要素のキー（交換形式での識別子） */
export function entityKey(doc: FpDocument, refType: NodeRefType, refId: Id): string {
  switch (refType) {
    case 'dataFunction':
      return doc.dataFunctions[refId]?.displayNo ?? refId;
    case 'transactionFunction':
      return doc.transactionFunctions[refId]?.displayNo ?? refId;
    case 'externalEntity':
      return doc.externalEntities[refId]?.displayNo ?? refId;
    case 'nonCountedProcess':
      return ncpKey(refId);
  }
}

// ---------- 取り込み ----------

const text = z.preprocess((v) => (v === null || v === undefined ? '' : String(v)), z.string());
const key = z.preprocess((v) => (typeof v === 'number' ? String(v) : v), z.string().trim().min(1, 'key がありません'));
const complexity = z.preprocess((v) => {
  const s = String(v ?? '').trim().toLowerCase();
  if (['low', '低', 'l'].includes(s)) return 'low';
  if (['medium', 'average', 'avg', 'mid', 'middle', '中', 'm'].includes(s)) return 'medium';
  if (['high', '高', 'h'].includes(s)) return 'high';
  return s;
}, z.enum(['low', 'medium', 'high'], { message: 'complexity は low・medium・high のいずれかです' }));
const upper = (v: unknown) => String(v ?? '').trim().toUpperCase();
const element = z.object({ key, name: z.string().trim().min(1, 'name がありません'), description: text });
const importSchema = z.object({
  format: z.literal(EXCHANGE_FORMAT, { message: `format が "${EXCHANGE_FORMAT}" ではありません` }).optional(),
  feature: z.object({ key: text }).partial().optional(),
  dfd: z.object({
    externalEntities: z.array(element).default([]),
    dataFunctions: z.array(element.extend({ kind: z.preprocess(upper, z.enum(['ILF', 'EIF'], { message: 'データファンクションの kind は ILF か EIF です' })), complexity })).default([]),
    transactionFunctions: z.array(element.extend({ kind: z.preprocess(upper, z.enum(['EI', 'EO', 'EQ'], { message: 'トランザクションの kind は EI・EO・EQ のいずれかです' })), complexity })).default([]),
    nonCountedProcesses: z.array(element).default([]),
    dataFlows: z.array(z.object({ from: key, to: key, label: text })).default([]),
  }),
});

export type ImportData = z.infer<typeof importSchema>;

/**
 * エージェントの返答から交換データを取り出す。```json のコードブロック、または最初の { から最後の } までを JSON として読む。
 */
export function parseExchange(input: string): { ok: true; data: ImportData; featureKey: string | null } | { ok: false; message: string } {
  const fenced = [...input.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((m) => m[1]).find((b) => b.trim().startsWith('{'));
  const start = input.indexOf('{');
  const body = fenced ?? (start >= 0 ? input.slice(start, input.lastIndexOf('}') + 1) : '');
  if (!body.trim()) return { ok: false, message: 'JSON が見つかりません。エージェントの返答の JSON 部分を貼り付けてください。' };
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch (e) {
    return { ok: false, message: `JSON として読めません（${(e as Error).message}）。` };
  }
  const r = importSchema.safeParse(raw);
  if (!r.success) {
    const issue = r.error.issues[0];
    return { ok: false, message: `形式が正しくありません: ${issue.path.join('.') || '(ルート)'} — ${issue.message}` };
  }
  return { ok: true, data: r.data, featureKey: r.data.feature?.key || null };
}

export type PlanTarget = { refType: NodeRefType; refId: Id } | { refType: NodeRefType; newKey: string };

export interface ImportPlan {
  errors: string[];
  warnings: string[];
  /** 新しく作る要素 */
  creates: { refType: NodeRefType; key: string; name: string; kind?: DataFunctionKind | TransactionKind; complexity?: Complexity; description: string }[];
  /** 既存の要素の変更 */
  updates: { refType: NodeRefType; refId: Id; key: string; name: string; changes: string[]; patch: Partial<{ name: string; kind: string; complexity: Complexity; description: string }> }[];
  /** この DFD に新しく置く既存の要素（catalog から参照など） */
  places: { refType: NodeRefType; refId: Id; key: string; name: string }[];
  /** 取り込み後の DFD にあるすべての要素（キー → 実体） */
  elements: { key: string; target: PlanTarget }[];
  edgeAdds: { from: string; to: string; label: string }[];
  edgeLabelUpdates: { edgeId: Id; from: string; to: string; before: string; label: string }[];
  edgeRemovals: { edgeId: Id; from: string; to: string; label: string }[];
  /** 出力に含まれない要素（removeMissing のときだけ処理する）。delete は実体ごと、unplace は DFD から外すだけ */
  removals: { refType: NodeRefType; refId: Id; key: string; name: string; mode: 'delete' | 'unplace' }[];
}

const LIST_TYPES: [keyof ImportData['dfd'] & string, NodeRefType, string][] = [
  ['externalEntities', 'externalEntity', '外部エンティティ'],
  ['dataFunctions', 'dataFunction', 'データファンクション'],
  ['transactionFunctions', 'transactionFunction', 'トランザクションファンクション'],
  ['nonCountedProcesses', 'nonCountedProcess', '非計上プロセス'],
];

/** 交換データとの差分を計算する（純粋関数）。removeMissing なら出力にない要素・データフローを削除対象にする */
export function planImport(doc: FpDocument, featureId: Id, data: ImportData, options: { removeMissing: boolean }): ImportPlan {
  const plan: ImportPlan = { errors: [], warnings: [], creates: [], updates: [], places: [], elements: [], edgeAdds: [], edgeLabelUpdates: [], edgeRemovals: [], removals: [] };
  const f = doc.features[featureId];
  const swId = softwareIdOfFeature(doc, featureId);
  if (!f || !swId) {
    plan.errors.push('取り込み先の機能が見つかりません。');
    return plan;
  }
  const nodes = f.dfd.nodes;
  const isPlaced = (refType: NodeRefType, refId: Id) => nodes.some((n) => n.refType === refType && n.refId === refId);

  /** キーから既存の実体を探す */
  const findExisting = (k: string): { refType: NodeRefType; refId: Id } | null => {
    const d = Object.values(doc.dataFunctions).find((x) => x.softwareId === swId && x.displayNo === k);
    if (d) return { refType: 'dataFunction', refId: d.id };
    const t = Object.values(doc.transactionFunctions).find((x) => x.displayNo === k && softwareIdOfFeature(doc, x.featureId) === swId);
    if (t) return { refType: 'transactionFunction', refId: t.id };
    const e = Object.values(doc.externalEntities).find((x) => x.softwareId === swId && x.displayNo === k);
    if (e) return { refType: 'externalEntity', refId: e.id };
    if (k.startsWith('NCP-') && doc.nonCountedProcesses[k.slice(4)]) return { refType: 'nonCountedProcess', refId: k.slice(4) };
    return null;
  };

  const keyType = new Map<string, NodeRefType>();
  const used = new Set<string>(); // 出力に含まれる既存の実体（refType:refId）
  for (const [list, refType, label] of LIST_TYPES) {
    for (const item of data.dfd[list] as (ExchangeElement & { kind?: string; complexity?: Complexity })[]) {
      const k = item.key;
      if (keyType.has(k)) {
        plan.errors.push(`key「${k}」が重複しています。`);
        continue;
      }
      keyType.set(k, refType);
      const ex = findExisting(k);
      if (ex && ex.refType !== refType) {
        plan.errors.push(`「${k}」は${LIST_TYPES.find((x) => x[1] === ex.refType)![2]}の key です。${label}の一覧には書けません。`);
        continue;
      }
      if (!ex) {
        plan.creates.push({ refType, key: k, name: item.name, kind: item.kind as DataFunctionKind | TransactionKind | undefined, complexity: item.complexity, description: item.description });
        plan.elements.push({ key: k, target: { refType, newKey: k } });
        continue;
      }
      // 他の機能のトランザクション・非計上プロセスは参照できない
      if (refType === 'transactionFunction' && doc.transactionFunctions[ex.refId].featureId !== featureId) {
        plan.errors.push(`「${k}」は別の機能のトランザクションファンクションです。この機能で使う場合は新しい key を付けてください。`);
        continue;
      }
      if (refType === 'nonCountedProcess' && doc.nonCountedProcesses[ex.refId].featureId !== featureId) {
        plan.errors.push(`「${k}」は別の機能の非計上プロセスです。`);
        continue;
      }
      used.add(`${ex.refType}:${ex.refId}`);
      plan.elements.push({ key: k, target: ex });
      if (!isPlaced(ex.refType, ex.refId)) plan.places.push({ ...ex, key: k, name: refName(doc, ex.refType, ex.refId) });

      // 変更点
      const cur = currentOf(doc, ex.refType, ex.refId);
      const patch: ImportPlan['updates'][number]['patch'] = {};
      const changes: string[] = [];
      if (item.name !== cur.name) { patch.name = item.name; changes.push(`名称「${cur.name}」→「${item.name}」`); }
      if (item.kind && item.kind !== cur.kind) { patch.kind = item.kind; changes.push(`種別 ${cur.kind} → ${item.kind}`); }
      if (item.complexity && item.complexity !== cur.complexity) { patch.complexity = item.complexity; changes.push(`複雑度 ${COMPLEXITY_LABELS[cur.complexity!]} → ${COMPLEXITY_LABELS[item.complexity]}`); }
      if (item.description !== cur.description && item.description !== '') { patch.description = item.description; changes.push('説明'); }
      if (!changes.length) continue;
      const df = ex.refType === 'dataFunction' ? doc.dataFunctions[ex.refId] : null;
      if (df && df.ownerFeatureId !== featureId) {
        plan.warnings.push(`「${k} ${cur.name}」は他の機能が所有するデータファンクションのため、変更（${changes.join('、')}）は取り込みません。`);
        continue;
      }
      if (ex.refType === 'externalEntity') plan.warnings.push(`外部エンティティ「${k}」の変更はソフトウェア全体に反映されます（${changes.join('、')}）。`);
      plan.updates.push({ ...ex, key: k, name: cur.name, changes, patch });
    }
  }

  // データフロー
  const nodeKey = (id: Id) => {
    const n = nodes.find((x) => x.id === id);
    return n ? entityKey(doc, n.refType, n.refId) : '';
  };
  const existingEdges = f.dfd.edges.map((e) => ({ e, from: nodeKey(e.sourceNodeId), to: nodeKey(e.targetNodeId), matched: false }));
  for (const flow of data.dfd.dataFlows) {
    const a = keyType.get(flow.from);
    const b = keyType.get(flow.to);
    if (!a || !b) {
      plan.errors.push(`データフロー ${flow.from} → ${flow.to}: dfd にない key「${!a ? flow.from : flow.to}」を指しています。`);
      continue;
    }
    if (flow.from === flow.to) {
      plan.errors.push(`データフロー ${flow.from} → ${flow.to}: 同じ要素同士はつなげません。`);
      continue;
    }
    const rule = canConnect(ruleKindOf(a), ruleKindOf(b));
    if (!rule.ok) {
      plan.errors.push(`データフロー ${flow.from} → ${flow.to}: ${rule.reason}`);
      continue;
    }
    // 同じ向きの既存のデータフローと対応づける（ラベルが同じものを優先）
    const same = existingEdges.filter((x) => !x.matched && x.from === flow.from && x.to === flow.to);
    const hit = same.find((x) => x.e.label === flow.label) ?? same[0];
    if (hit) {
      hit.matched = true;
      if (hit.e.label !== flow.label) plan.edgeLabelUpdates.push({ edgeId: hit.e.id, from: flow.from, to: flow.to, before: hit.e.label, label: flow.label });
    } else {
      plan.edgeAdds.push(flow);
    }
  }

  if (options.removeMissing) {
    for (const x of existingEdges) if (!x.matched) plan.edgeRemovals.push({ edgeId: x.e.id, from: x.from, to: x.to, label: x.e.label });
    const seen = new Set<string>();
    const candidates: { refType: NodeRefType; refId: Id }[] = [
      ...nodes.map((n) => ({ refType: n.refType, refId: n.refId })),
      ...Object.values(doc.transactionFunctions).filter((t) => t.featureId === featureId).map((t) => ({ refType: 'transactionFunction' as const, refId: t.id })),
      ...Object.values(doc.nonCountedProcesses).filter((p) => p.featureId === featureId).map((p) => ({ refType: 'nonCountedProcess' as const, refId: p.id })),
      ...Object.values(doc.dataFunctions).filter((d) => d.ownerFeatureId === featureId).map((d) => ({ refType: 'dataFunction' as const, refId: d.id })),
    ];
    for (const c of candidates) {
      const id = `${c.refType}:${c.refId}`;
      if (used.has(id) || seen.has(id)) continue;
      seen.add(id);
      const owned =
        c.refType === 'transactionFunction' || c.refType === 'nonCountedProcess' ||
        (c.refType === 'dataFunction' && doc.dataFunctions[c.refId]?.ownerFeatureId === featureId);
      plan.removals.push({ ...c, key: entityKey(doc, c.refType, c.refId), name: refName(doc, c.refType, c.refId), mode: owned ? 'delete' : 'unplace' });
    }
  }

  if (data.dfd.transactionFunctions.length + data.dfd.dataFunctions.length + data.dfd.externalEntities.length + data.dfd.nonCountedProcesses.length === 0) {
    plan.errors.push('dfd に要素がありません。');
  }
  return plan;
}

function currentOf(doc: FpDocument, refType: NodeRefType, refId: Id): { name: string; kind?: string; complexity?: Complexity; description: string } {
  switch (refType) {
    case 'dataFunction': {
      const d = doc.dataFunctions[refId];
      return { name: d.name, kind: d.kind, complexity: d.complexity, description: d.description };
    }
    case 'transactionFunction': {
      const t = doc.transactionFunctions[refId];
      return { name: t.name, kind: t.kind, complexity: t.complexity, description: t.description };
    }
    case 'nonCountedProcess': {
      const p = doc.nonCountedProcesses[refId];
      return { name: p.name, description: p.description };
    }
    case 'externalEntity': {
      const e = doc.externalEntities[refId];
      return { name: e.name, description: e.description };
    }
  }
}

/** プランに変更があるか */
export function planHasChanges(p: ImportPlan): boolean {
  return !!(p.creates.length || p.updates.length || p.places.length || p.edgeAdds.length || p.edgeLabelUpdates.length || p.edgeRemovals.length || p.removals.length);
}
