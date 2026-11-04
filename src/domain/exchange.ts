import { z } from 'zod';
import { canConnect, ruleKindOf } from './dfdRules';
import { COMPLEXITY_LABELS, DEV_TYPE_LABELS, FUNCTION_KIND_LABELS } from './fpTables';
import { featurePathLabel, featuresInOrder, getFeaturePath, refName, softwareIdOfFeature } from './queries';
import type { Complexity, DataFunctionKind, DevType, DfdNode, FpDocument, Id, NodeRefType, TransactionKind } from './types';

/**
 * AI エージェント（Microsoft Copilot など）と DFD をやり取りする交換形式（FR-IO-01〜04）。
 * 1 つ以上の機能の DFD を「完成形」で受け渡す。エージェントは作った・変えた機能の完成形を同じ形式で返し、取り込み時に差分を計算する。
 * 要素はキー（DF-001 などの表示番号、非計上プロセスは NCP-<ID>、新しい要素はエージェントが付ける任意の文字列）で識別する。
 * 機能は内部 ID を key にし、新しい機能はエージェントが付ける任意の key と分類（大分類・中分類）で表す。
 */
export const EXCHANGE_FORMAT = 'fp-dfd-exchange';
export const EXCHANGE_VERSION = 2;

export interface ExchangeElement {
  key: string;
  name: string;
  description: string;
  /** DFD に置いていない要素（この機能に属するが未配置）だけ false を付ける */
  placed?: boolean;
}
export interface ExchangeDataFunction extends ExchangeElement {
  kind: DataFunctionKind;
  complexity: Complexity;
  /** 所有機能の key。この機能が所有するなら省略 */
  owner?: string;
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
    'この JSON は FP 法（ファンクションポイント法）で見積もるための DFD（データフロー図）です。features に 1 つ以上の機能の DFD が入っています。ユーザーの依頼に従って機能の DFD を作成・編集し、作成・変更した機能だけを同じ形式の JSON（format・version・features を含む）で、各機能の DFD の完成形として返してください。',
  elementKinds: {
    externalEntities: '外部エンティティ。利用者や外部システムなど、システムの外にあるデータの出どころ・行き先',
    dataFunctions: 'データファンクション（データストア）。ILF=このソフトウェアの中で維持するファイル、EIF=他システムが維持し参照するだけのファイル',
    transactionFunctions: 'トランザクションファンクション（プロセス）。EI=外部入力（データを受け取り ILF を更新する等）、EO=外部出力（計算・加工を伴う出力）、EQ=外部照会（加工のない参照・照会）',
    nonCountedProcesses: 'FP に計上しないプロセス（内部の中継処理など）',
  },
  complexity: 'complexity は low（低）・medium（中）・high（高）のいずれか',
  features:
    '既存の機能は key（feature の key）を変えない。新しい機能には他と重ならない key（例: NEW-F1）を付け、name・category1（大分類）・category2（中分類）を書く。分類は catalog.categories にあるものを使うのが基本で、ない名前を書くと新しく作られる',
  keys:
    '既存の要素は key を変えない。新しい要素には他と重ならない key（例: NEW-1）を付ける。catalog にある外部エンティティ・データファンクションを使う場合は、その key をそのまま書く（参照として配置される）。新しい外部エンティティ・データファンクションを複数の機能で使う場合は、同じ key を使う。トランザクションファンクションと非計上プロセスは機能ごとに別の key にする',
  owner:
    'データファンクションの owner は FP を計上する機能（所有機能）の key。新しいデータファンクションで省略すると、最初に書いた機能が所有する。既存のデータファンクションの所有機能は変わらない',
  dataFlows:
    'dataFlows の from / to は同じ機能の dfd 内の要素の key。外部エンティティ同士、データファンクション同士、外部エンティティとデータファンクションは直接つなげない（必ずプロセスを介する）。label には流れるデータの名称を書く',
  description: '各要素の description には、その要素を置いた理由や FP の判断根拠を簡潔に書く',
  placed: '"placed": false の要素は、機能に属するが DFD に置いていない要素。そのままにすれば置かれない。DFD に置くなら placed を消す',
  output: '返答の JSON は 1 つのコードブロック（```json）にまとめる。説明文はコードブロックの外に書いてよい',
} as const;

function featureDfd(doc: FpDocument, featureId: Id): ExchangeDfd {
  const f = doc.features[featureId];
  const swId = softwareIdOfFeature(doc, featureId)!;
  const nodes = f.dfd.nodes;
  const placed = (refType: NodeRefType, refId: Id) => nodes.some((n) => n.refType === refType && n.refId === refId);
  const keyOfNode = (n: DfdNode) => entityKey(doc, n.refType, n.refId);
  const flag = (refType: NodeRefType, refId: Id) => (placed(refType, refId) ? {} : { placed: false });
  // DFD に置いた要素と、この機能に属する未配置の要素（placed: false）
  return {
    externalEntities: uniq(nodes.filter((n) => n.refType === 'externalEntity').map((n) => n.refId))
      .map((id) => doc.externalEntities[id]).filter(Boolean)
      .map((e) => ({ key: e.displayNo, name: e.name, description: e.description })),
    dataFunctions: Object.values(doc.dataFunctions)
      .filter((d) => d.softwareId === swId && (placed('dataFunction', d.id) || d.ownerFeatureId === featureId))
      .map((d) => ({
        key: d.displayNo, name: d.name, kind: d.kind, complexity: d.complexity, description: d.description,
        ...(d.ownerFeatureId !== featureId ? { owner: d.ownerFeatureId ?? '' } : {}),
        ...flag('dataFunction', d.id),
      })),
    transactionFunctions: Object.values(doc.transactionFunctions)
      .filter((t) => t.featureId === featureId)
      .map((t) => ({ key: t.displayNo, name: t.name, kind: t.kind, complexity: t.complexity, description: t.description, ...flag('transactionFunction', t.id) })),
    nonCountedProcesses: Object.values(doc.nonCountedProcesses)
      .filter((p) => p.featureId === featureId)
      .map((p) => ({ key: ncpKey(p.id), name: p.name, description: p.description, ...flag('nonCountedProcess', p.id) })),
    dataFlows: f.dfd.edges.flatMap((e) => {
      const a = nodes.find((n) => n.id === e.sourceNodeId);
      const b = nodes.find((n) => n.id === e.targetNodeId);
      return a && b ? [{ from: keyOfNode(a), to: keyOfNode(b), label: e.label }] : [];
    }),
  };
}

/** 機能（1 つ以上、同じソフトウェア）の DFD を交換形式にする */
export function buildExchange(doc: FpDocument, featureIds: Id[]) {
  if (!featureIds.length) throw new Error('no features');
  const swId = softwareIdOfFeature(doc, featureIds[0]);
  if (!swId) throw new Error(`feature not found: ${featureIds[0]}`);
  // ツリーの並び順にそろえる
  const ordered = featuresInOrder(doc, swId).filter((f) => featureIds.includes(f.id));
  return {
    format: EXCHANGE_FORMAT,
    version: EXCHANGE_VERSION,
    rules: RULES,
    software: { name: doc.softwares[swId].name },
    features: ordered.map((f) => {
      const p = getFeaturePath(doc, f.id)!;
      return {
        key: f.id,
        name: f.name,
        category1: p.category1.name,
        category2: p.category2.name,
        description: f.description,
        devType: DEV_TYPE_LABELS[f.devType],
        dfd: featureDfd(doc, f.id),
      };
    }),
    catalog: {
      note: '同じソフトウェアにある既存の分類・機能・外部エンティティ・データファンクション。DFD で使う場合は key をそのまま書く。他の機能が所有するデータファンクションは参照として置かれ、その機能の FP には計上されない',
      categories: featuresInOrder(doc, swId).map((f) => getFeaturePath(doc, f.id)!).reduce<{ category1: string; category2: string }[]>((acc, p) => {
        if (!acc.some((c) => c.category1 === p.category1.name && c.category2 === p.category2.name)) acc.push({ category1: p.category1.name, category2: p.category2.name });
        return acc;
      }, []),
      features: featuresInOrder(doc, swId).map((f) => ({ key: f.id, path: featurePathLabel(doc, f.id), exported: featureIds.includes(f.id) })),
      externalEntities: Object.values(doc.externalEntities)
        .filter((e) => e.softwareId === swId)
        .map((e) => ({ key: e.displayNo, name: e.name, description: e.description })),
      dataFunctions: Object.values(doc.dataFunctions)
        .filter((d) => d.softwareId === swId)
        .map((d) => ({
          key: d.displayNo, name: d.name, kind: d.kind, kindLabel: FUNCTION_KIND_LABELS[d.kind], complexity: d.complexity,
          owner: d.ownerFeatureId ?? '', ownerPath: d.ownerFeatureId ? featurePathLabel(doc, d.ownerFeatureId) : '未設定',
        })),
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
const devType = z.preprocess((v) => {
  const s = String(v ?? '').trim().toLowerCase();
  if (['new', '新規'].includes(s)) return 'new';
  if (['modification', 'modify', 'mod', '改修'].includes(s)) return 'modification';
  return undefined;
}, z.enum(['new', 'modification']).optional());
const upper = (v: unknown) => String(v ?? '').trim().toUpperCase();
const element = z.object({ key, name: z.string().trim().min(1, 'name がありません'), description: text, placed: z.boolean().optional() });
const dfdSchema = z.object({
  externalEntities: z.array(element).default([]),
  dataFunctions: z.array(element.extend({
    kind: z.preprocess(upper, z.enum(['ILF', 'EIF'], { message: 'データファンクションの kind は ILF か EIF です' })),
    complexity,
    owner: z.preprocess((v) => (v === null || v === undefined || v === '' ? undefined : String(v)), z.string().optional()),
  })).default([]),
  transactionFunctions: z.array(element.extend({ kind: z.preprocess(upper, z.enum(['EI', 'EO', 'EQ'], { message: 'トランザクションの kind は EI・EO・EQ のいずれかです' })), complexity })).default([]),
  nonCountedProcesses: z.array(element).default([]),
  dataFlows: z.array(z.object({ from: key, to: key, label: text })).default([]),
});
const featureSchema = z.object({
  key: z.preprocess((v) => (v === null || v === undefined || v === '' ? undefined : String(v)), z.string().trim().optional()),
  name: text,
  category1: text,
  category2: text,
  /** 「大分類 / 中分類 / 機能」の形でも受け付ける */
  path: text,
  description: text,
  devType,
  dfd: dfdSchema,
});
const formatField = z.literal(EXCHANGE_FORMAT, { message: `format が "${EXCHANGE_FORMAT}" ではありません` }).optional();
const v2Schema = z.object({ format: formatField, features: z.array(featureSchema).min(1, 'features が空です') });
/** 版 1（1 機能: feature と dfd） */
const v1Schema = z.object({ format: formatField, feature: z.object({ key: text }).partial().optional(), dfd: dfdSchema });

export interface ImportFeature {
  key: string | null;
  name: string;
  category1: string;
  category2: string;
  description: string;
  devType?: DevType;
  dfd: z.infer<typeof dfdSchema>;
}
export interface ImportData {
  features: ImportFeature[];
}

/**
 * エージェントの返答から交換データを取り出す。```json のコードブロック、または最初の { から最後の } までを JSON として読む。
 * 版 2（features）と版 1（feature + dfd）のどちらも読む。
 */
export function parseExchange(input: string): { ok: true; data: ImportData } | { ok: false; message: string } {
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
  const isV1 = !!raw && typeof raw === 'object' && !('features' in raw) && 'dfd' in raw;
  const fail = (err: z.ZodError) => {
    const issue = err.issues[0];
    return { ok: false as const, message: `形式が正しくありません: ${issue.path.join('.') || '(ルート)'} — ${issue.message}` };
  };
  if (isV1) {
    const r = v1Schema.safeParse(raw);
    if (!r.success) return fail(r.error);
    return { ok: true, data: { features: [{ key: r.data.feature?.key || null, name: '', category1: '', category2: '', description: '', dfd: r.data.dfd }] } };
  }
  const r = v2Schema.safeParse(raw);
  if (!r.success) return fail(r.error);
  return {
    ok: true,
    data: {
      features: r.data.features.map((f) => {
        // path だけが書かれている場合は「大分類 / 中分類 / 機能」として分ける
        const parts = f.path.split('/').map((x) => x.trim()).filter(Boolean);
        return {
          key: f.key ?? null,
          name: f.name.trim() || (parts.length >= 3 ? parts[parts.length - 1] : ''),
          category1: f.category1.trim() || (parts.length >= 3 ? parts[0] : ''),
          category2: f.category2.trim() || (parts.length >= 3 ? parts[1] : ''),
          description: f.description,
          devType: f.devType,
          dfd: f.dfd,
        };
      }),
    },
  };
}

type Patch = Partial<{ name: string; kind: string; complexity: Complexity; description: string }>;

export interface FeaturePlan {
  /** 交換データ上の機能の key */
  key: string;
  /** 既存の機能の ID。新しい機能は null */
  featureId: Id | null;
  name: string;
  category1: string;
  category2: string;
  devType: DevType;
  description: string;
  /** 既存の機能の名称・説明の変更 */
  featurePatch: Partial<{ name: string; description: string }>;
  featureChanges: string[];
  /** この DFD に新しく置く既存の要素（catalog から参照など） */
  places: { refType: NodeRefType; refId: Id; key: string; name: string }[];
  /** 取り込み後の DFD にあるすべての要素の key（placed: false の要素は含めない） */
  elementKeys: string[];
  /** この機能で新しく作る要素の key（表示用） */
  createKeys: string[];
  edgeAdds: { from: string; to: string; label: string }[];
  edgeLabelUpdates: { edgeId: Id; from: string; to: string; before: string; label: string }[];
  edgeRemovals: { edgeId: Id; from: string; to: string; label: string }[];
  /** 出力に含まれない要素（removeMissing のときだけ）。delete は実体ごと、unplace は DFD から外すだけ */
  removals: { refType: NodeRefType; refId: Id; key: string; name: string; mode: 'delete' | 'unplace' }[];
}

export interface ImportPlan {
  errors: string[];
  warnings: string[];
  /** 新しく作る分類 */
  newCategories: { category1: string; category2: string; newCategory1: boolean }[];
  /** 新しく作る要素。TF・非計上プロセスは featureKey の機能に属し、DF は featureKey の機能が所有する */
  creates: { refType: NodeRefType; key: string; name: string; kind?: DataFunctionKind | TransactionKind; complexity?: Complexity; description: string; featureKey: string | null; ownerFeatureId?: Id }[];
  /** 既存の要素の変更 */
  updates: { refType: NodeRefType; refId: Id; key: string; name: string; changes: string[]; patch: Patch }[];
  features: FeaturePlan[];
}

const LIST_TYPES: [keyof ImportFeature['dfd'] & string, NodeRefType, string][] = [
  ['externalEntities', 'externalEntity', '外部エンティティ'],
  ['dataFunctions', 'dataFunction', 'データファンクション'],
  ['transactionFunctions', 'transactionFunction', 'トランザクションファンクション'],
  ['nonCountedProcesses', 'nonCountedProcess', '非計上プロセス'],
];
const typeLabel = (t: NodeRefType) => LIST_TYPES.find((x) => x[1] === t)![2];

/**
 * 交換データとの差分を計算する（純粋関数）。取り込み先はソフトウェア単位。
 * removeMissing なら、出力に含まれる既存の機能について、出力にない要素・データフローを削除対象にする。
 */
export function planImport(doc: FpDocument, softwareId: Id, data: ImportData, options: { removeMissing: boolean }): ImportPlan {
  const plan: ImportPlan = { errors: [], warnings: [], newCategories: [], creates: [], updates: [], features: [] };
  const sw = doc.softwares[softwareId];
  if (!sw) {
    plan.errors.push('取り込み先のソフトウェアが見つかりません。');
    return plan;
  }

  /** キーから既存の実体を探す */
  const findExisting = (k: string): { refType: NodeRefType; refId: Id } | null => {
    const d = Object.values(doc.dataFunctions).find((x) => x.softwareId === softwareId && x.displayNo === k);
    if (d) return { refType: 'dataFunction', refId: d.id };
    const t = Object.values(doc.transactionFunctions).find((x) => x.displayNo === k && softwareIdOfFeature(doc, x.featureId) === softwareId);
    if (t) return { refType: 'transactionFunction', refId: t.id };
    const e = Object.values(doc.externalEntities).find((x) => x.softwareId === softwareId && x.displayNo === k);
    if (e) return { refType: 'externalEntity', refId: e.id };
    if (k.startsWith('NCP-') && doc.nonCountedProcesses[k.slice(4)]) return { refType: 'nonCountedProcess', refId: k.slice(4) };
    return null;
  };

  // 1. 機能の対応づけ
  const featureKeys = new Set<string>();
  const outputFeatureKeys = new Set(data.features.map((f, i) => f.key ?? `#${i + 1}`));
  data.features.forEach((f, i) => {
    const k = f.key ?? `#${i + 1}`;
    const label = f.name || k;
    if (featureKeys.has(k)) {
      plan.errors.push(`機能の key「${k}」が重複しています。`);
      return;
    }
    featureKeys.add(k);
    const existing = doc.features[k];
    if (existing) {
      if (softwareIdOfFeature(doc, k) !== softwareId) {
        plan.errors.push(`機能「${label}」は別のソフトウェアの機能です。`);
        return;
      }
      const p = getFeaturePath(doc, k)!;
      const featurePatch: FeaturePlan['featurePatch'] = {};
      const featureChanges: string[] = [];
      if (f.name && f.name !== existing.name) { featurePatch.name = f.name; featureChanges.push(`機能名「${existing.name}」→「${f.name}」`); }
      if (f.description && f.description !== existing.description) { featurePatch.description = f.description; featureChanges.push('機能の説明'); }
      if ((f.category1 && f.category1 !== p.category1.name) || (f.category2 && f.category2 !== p.category2.name)) {
        plan.warnings.push(`機能「${existing.name}」の分類の変更は取り込みません（分類の移動はツリーで行います）。`);
      }
      plan.features.push(emptyFeaturePlan(k, k, existing.name, p.category1.name, p.category2.name, existing.devType, existing.description, featurePatch, featureChanges));
      return;
    }
    // 新しい機能
    if (!f.name) {
      plan.errors.push(`新しい機能（key「${k}」）の name がありません。既存の機能なら、書き出した feature の key をそのまま使ってください。`);
      return;
    }
    if (!f.category1 || !f.category2) {
      plan.errors.push(`新しい機能「${f.name}」の category1（大分類）と category2（中分類）を書いてください。`);
      return;
    }
    const c1 = sw.category1Ids.map((id) => doc.category1s[id]).find((c) => c?.name === f.category1);
    const c2 = c1?.category2Ids.map((id) => doc.category2s[id]).find((c) => c?.name === f.category2);
    if (!c2 && !plan.newCategories.some((c) => c.category1 === f.category1 && c.category2 === f.category2)) {
      plan.newCategories.push({ category1: f.category1, category2: f.category2, newCategory1: !c1 && !plan.newCategories.some((c) => c.category1 === f.category1) });
    }
    if (c2?.featureIds.some((id) => doc.features[id]?.name === f.name)) {
      plan.warnings.push(`「${f.category1} / ${f.category2}」には同じ名前の機能「${f.name}」がすでにあります（別の機能として追加します）。`);
    }
    plan.features.push(emptyFeaturePlan(k, null, f.name, f.category1, f.category2, f.devType ?? 'new', f.description, {}, []));
  });
  if (plan.errors.length) return plan;

  // 2. 要素の対応づけ（外部エンティティ・データファンクションはソフトウェア共通、TF・非計上プロセスは機能ごと）
  const keyTypes = new Map<string, { refType: NodeRefType; featureKey: string }>();
  const createdKeys = new Set<string>();
  const updatedRefs = new Set<string>();
  data.features.forEach((f, i) => {
    const fp = plan.features[i];
    const existingFeatureId = fp.featureId;
    const nodes = existingFeatureId ? doc.features[existingFeatureId].dfd.nodes : [];
    const isPlaced = (refType: NodeRefType, refId: Id) => nodes.some((n) => n.refType === refType && n.refId === refId);
    const localKeys = new Map<string, NodeRefType>();
    const used = new Set<string>();
    /** placed: false で残した既存の要素（データフローがつながれば置く） */
    const unplaced = new Map<string, { refType: NodeRefType; refId: Id }>();
    const where = `機能「${fp.name}」`;

    for (const [list, refType, label] of LIST_TYPES) {
      for (const item of f.dfd[list] as (ExchangeElement & { kind?: string; complexity?: Complexity; owner?: string })[]) {
        const k = item.key;
        if (localKeys.has(k)) {
          plan.errors.push(`${where}: key「${k}」が重複しています。`);
          continue;
        }
        localKeys.set(k, refType);
        const seen = keyTypes.get(k);
        if (seen && seen.refType !== refType) {
          plan.errors.push(`${where}: key「${k}」はほかの機能で${typeLabel(seen.refType)}として使われています。`);
          continue;
        }
        if (seen && (refType === 'transactionFunction' || refType === 'nonCountedProcess') && seen.featureKey !== fp.key) {
          plan.errors.push(`${where}: ${label}の key「${k}」はほかの機能でも使われています。機能ごとに別の key にしてください。`);
          continue;
        }
        if (!seen) keyTypes.set(k, { refType, featureKey: fp.key });
        const ex = findExisting(k);
        // placed: false は「この機能に属するが DFD に置かない」。既存で未配置の要素はそのまま残す
        const keepUnplaced = item.placed === false && !!ex && !isPlaced(ex.refType, ex.refId);
        if (!keepUnplaced) fp.elementKeys.push(k);
        else unplaced.set(k, ex);
        if (ex && ex.refType !== refType) {
          plan.errors.push(`${where}: 「${k}」は${typeLabel(ex.refType)}の key です。${label}の一覧には書けません。`);
          continue;
        }
        if (!ex) {
          if (createdKeys.has(k)) continue; // 別の機能で作る新しい外部エンティティ・データファンクションを共有する
          createdKeys.add(k);
          let ownerKey: string | null = fp.key;
          let ownerFeatureId: Id | undefined;
          if (refType === 'dataFunction' && item.owner) {
            if (outputFeatureKeys.has(item.owner)) ownerKey = item.owner;
            else if (doc.features[item.owner] && softwareIdOfFeature(doc, item.owner) === softwareId) { ownerKey = null; ownerFeatureId = item.owner; }
            else plan.warnings.push(`${where}: データファンクション「${item.name}」の owner「${item.owner}」が見つからないため、この機能の所有にします。`);
          }
          plan.creates.push({
            refType, key: k, name: item.name, kind: item.kind as DataFunctionKind | TransactionKind | undefined, complexity: item.complexity, description: item.description,
            featureKey: refType === 'externalEntity' ? null : ownerKey, ownerFeatureId,
          });
          fp.createKeys.push(k);
          continue;
        }
        // 他の機能のトランザクション・非計上プロセスは使えない
        if (refType === 'transactionFunction' && doc.transactionFunctions[ex.refId].featureId !== existingFeatureId) {
          plan.errors.push(`${where}: 「${k}」は別の機能のトランザクションファンクションです。この機能で使う場合は新しい key を付けてください。`);
          continue;
        }
        if (refType === 'nonCountedProcess' && doc.nonCountedProcesses[ex.refId].featureId !== existingFeatureId) {
          plan.errors.push(`${where}: 「${k}」は別の機能の非計上プロセスです。新しい key を付けてください。`);
          continue;
        }
        used.add(`${ex.refType}:${ex.refId}`);
        if (!keepUnplaced && !isPlaced(ex.refType, ex.refId)) fp.places.push({ ...ex, key: k, name: refName(doc, ex.refType, ex.refId) });

        // 変更点（同じ要素を複数の機能に書いた場合は最初のものだけ見る）
        const refKey = `${ex.refType}:${ex.refId}`;
        if (updatedRefs.has(refKey)) continue;
        updatedRefs.add(refKey);
        const cur = currentOf(doc, ex.refType, ex.refId);
        const patch: Patch = {};
        const changes: string[] = [];
        if (item.name !== cur.name) { patch.name = item.name; changes.push(`名称「${cur.name}」→「${item.name}」`); }
        if (item.kind && item.kind !== cur.kind) { patch.kind = item.kind; changes.push(`種別 ${cur.kind} → ${item.kind}`); }
        if (item.complexity && item.complexity !== cur.complexity) { patch.complexity = item.complexity; changes.push(`複雑度 ${COMPLEXITY_LABELS[cur.complexity!]} → ${COMPLEXITY_LABELS[item.complexity]}`); }
        if (item.description !== cur.description && item.description !== '') { patch.description = item.description; changes.push('説明'); }
        if (!changes.length) continue;
        const df = ex.refType === 'dataFunction' ? doc.dataFunctions[ex.refId] : null;
        if (df && (!existingFeatureId || df.ownerFeatureId !== existingFeatureId)) {
          const owner = df.ownerFeatureId ? doc.features[df.ownerFeatureId]?.name : '未設定';
          // 所有機能も出力に含まれ、そちらで変更していればそちらで扱う
          if (df.ownerFeatureId && outputFeatureKeys.has(df.ownerFeatureId)) { updatedRefs.delete(refKey); continue; }
          plan.warnings.push(`「${k} ${cur.name}」は機能「${owner}」が所有するデータファンクションのため、変更（${changes.join('、')}）は取り込みません。`);
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
    const existingEdges = (existingFeatureId ? doc.features[existingFeatureId].dfd.edges : []).map((e) => ({ e, from: nodeKey(e.sourceNodeId), to: nodeKey(e.targetNodeId), matched: false }));
    for (const flow of f.dfd.dataFlows) {
      const a = localKeys.get(flow.from);
      const b = localKeys.get(flow.to);
      const head = `${where}のデータフロー ${flow.from} → ${flow.to}`;
      if (!a || !b) {
        plan.errors.push(`${head}: この機能の dfd にない key「${!a ? flow.from : flow.to}」を指しています。`);
        continue;
      }
      if (flow.from === flow.to) {
        plan.errors.push(`${head}: 同じ要素同士はつなげません。`);
        continue;
      }
      const rule = canConnect(ruleKindOf(a), ruleKindOf(b));
      if (!rule.ok) {
        plan.errors.push(`${head}: ${rule.reason}`);
        continue;
      }
      for (const k of [flow.from, flow.to]) {
        const u = unplaced.get(k);
        if (!u) continue;
        unplaced.delete(k);
        fp.elementKeys.push(k);
        fp.places.push({ ...u, key: k, name: refName(doc, u.refType, u.refId) });
      }
      // 同じ向きの既存のデータフローと対応づける（ラベルが同じものを優先）
      const same = existingEdges.filter((x) => !x.matched && x.from === flow.from && x.to === flow.to);
      const hit = same.find((x) => x.e.label === flow.label) ?? same[0];
      if (hit) {
        hit.matched = true;
        if (hit.e.label !== flow.label) fp.edgeLabelUpdates.push({ edgeId: hit.e.id, from: flow.from, to: flow.to, before: hit.e.label, label: flow.label });
      } else {
        fp.edgeAdds.push(flow);
      }
    }

    if (existingFeatureId && options.removeMissing) {
      for (const x of existingEdges) if (!x.matched) fp.edgeRemovals.push({ edgeId: x.e.id, from: x.from, to: x.to, label: x.e.label });
      const seenRefs = new Set<string>();
      const candidates: { refType: NodeRefType; refId: Id }[] = [
        ...nodes.map((n) => ({ refType: n.refType, refId: n.refId })),
        ...Object.values(doc.transactionFunctions).filter((t) => t.featureId === existingFeatureId).map((t) => ({ refType: 'transactionFunction' as const, refId: t.id })),
        ...Object.values(doc.nonCountedProcesses).filter((p) => p.featureId === existingFeatureId).map((p) => ({ refType: 'nonCountedProcess' as const, refId: p.id })),
        ...Object.values(doc.dataFunctions).filter((d) => d.ownerFeatureId === existingFeatureId).map((d) => ({ refType: 'dataFunction' as const, refId: d.id })),
      ];
      for (const c of candidates) {
        const id = `${c.refType}:${c.refId}`;
        if (used.has(id) || seenRefs.has(id)) continue;
        seenRefs.add(id);
        const owned =
          c.refType === 'transactionFunction' || c.refType === 'nonCountedProcess' ||
          (c.refType === 'dataFunction' && doc.dataFunctions[c.refId]?.ownerFeatureId === existingFeatureId);
        fp.removals.push({ ...c, key: entityKey(doc, c.refType, c.refId), name: refName(doc, c.refType, c.refId), mode: owned ? 'delete' : 'unplace' });
      }
    }
    if (!fp.elementKeys.length) plan.errors.push(`${where}: dfd に要素がありません。`);
  });
  return plan;
}

function emptyFeaturePlan(
  key: string, featureId: Id | null, name: string, category1: string, category2: string, devType: DevType, description: string,
  featurePatch: FeaturePlan['featurePatch'], featureChanges: string[],
): FeaturePlan {
  return {
    key, featureId, name, category1, category2, devType, description, featurePatch, featureChanges,
    places: [], elementKeys: [], createKeys: [], edgeAdds: [], edgeLabelUpdates: [], edgeRemovals: [], removals: [],
  };
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

/** 機能ごとの変更の有無 */
export function featurePlanHasChanges(f: FeaturePlan): boolean {
  return !!(!f.featureId || f.featureChanges.length || f.createKeys.length || f.places.length || f.edgeAdds.length || f.edgeLabelUpdates.length || f.edgeRemovals.length || f.removals.length);
}

/** プランに変更があるか */
export function planHasChanges(p: ImportPlan): boolean {
  return !!(p.creates.length || p.updates.length || p.newCategories.length || p.features.some(featurePlanHasChanges));
}
