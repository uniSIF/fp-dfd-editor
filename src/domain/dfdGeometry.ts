import type { FunctionKind, NodeRefType } from './types';

/** ノード寸法。画面のカスタムノードと SVG 出力で共有する（design.md 6.2） */
export const GEOMETRY = {
  process: { radius: 44 },
  dataStore: { width: 180, height: 60 },
  externalEntity: { width: 140, height: 60 },
  badge: { height: 16, fontSize: 11 },
  label: { fontSize: 13, smallFontSize: 11 },
  fontFamily: '"Hiragino Sans","Noto Sans JP","Yu Gothic UI","Meiryo",sans-serif',
} as const;

/** ui-design.md 3.2 の種別色 */
export const BADGE_COLORS: Record<FunctionKind, string> = {
  EI: '#2457A5',
  EO: '#2E7D4F',
  EQ: '#B4690E',
  ILF: '#6A3FB5',
  EIF: '#5B6470',
};

export const COLORS = {
  text: '#1B1F24',
  textSecondary: '#5B6470',
  borderStrong: '#AEB5BF',
  warning: '#B4690E',
  ncpFill: '#F1F3F5',
  primary: '#2457A5',
  primarySoft: '#E6EEFA',
} as const;

/** 文字幅の概算（全角 1・半角英数 0.6・半角カナ 0.5。フォントサイズを掛けると px） */
function charUnits(ch: string): number {
  if (/[｡-ﾟ]/.test(ch)) return 0.5;
  return /[\x20-\x7e]/.test(ch) ? 0.6 : 1;
}

export function textUnits(text: string): number {
  let u = 0;
  for (const ch of text) u += charUnits(ch);
  return u;
}

/**
 * ノードの寸法と名称の 1 行あたりの幅（文字幅の単位）。
 * 名称は 2 行に収め、省略しない。高さは種別ごとに 2 行が入る値で固定し、名称が長いほど横に伸ばす。
 * 画面のカスタムノード・SVG 出力・配置計算で共有する（design.md 6.2）。
 */
export function nodeLayout(refType: NodeRefType, name = ''): { width: number; height: number; lineUnits: number; fontSize: number } {
  // 2 行に分けたときの 1 行の幅。文字の途中で折り返すため 1 文字分の余裕を足す
  const needed = Math.ceil(textUnits(name) / 2) + 1;
  const round4 = (n: number) => Math.ceil(n / 4) * 4;
  /** 既定の大きさで 1 行に入る幅（baseUnits）までは大きさを変えない。超えたら 2 行に収まる幅まで横に伸ばす */
  const layout = (base: { width: number; height: number }, baseUnits: number, fontSize: number, widthFor: (units: number) => number) => {
    const lineUnits = Math.max(baseUnits, needed);
    return { width: needed > baseUnits ? Math.max(base.width, round4(widthFor(lineUnits))) : base.width, height: base.height, lineUnits, fontSize };
  };
  switch (refType) {
    case 'transactionFunction':
    case 'nonCountedProcess': {
      const d = GEOMETRY.process.radius * 2;
      // 楕円の中央付近に文字を置くので、横幅の 8 割を文字に使える
      return layout({ width: d, height: d }, 6, 12, (u) => (u * 12) / 0.8 + 12);
    }
    case 'dataFunction':
      // 左のバッジ 42px と右の余白・メモアイコン分
      return layout(GEOMETRY.dataStore, 8, GEOMETRY.label.fontSize, (u) => u * GEOMETRY.label.fontSize + 66);
    case 'externalEntity':
      return layout(GEOMETRY.externalEntity, 8, GEOMETRY.label.fontSize, (u) => u * GEOMETRY.label.fontSize + 28);
  }
}

export function nodeSize(refType: NodeRefType, name = ''): { width: number; height: number } {
  const { width, height } = nodeLayout(refType, name);
  return { width, height };
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  round: boolean;
}

export function nodeBox(refType: NodeRefType, x: number, y: number, name = ''): Box {
  const { width, height } = nodeSize(refType, name);
  const round = refType === 'transactionFunction' || refType === 'nonCountedProcess';
  return { x, y, width, height, round };
}

/** 参照として置いたデータファンクションの下に出す「所有: ○○」の補記（画面と SVG 出力で共通の位置・大きさ） */
export const OWNER_CAPTION = { fontSize: 11, gap: 2, height: 15 } as const;

export function ownerCaptionText(ownerName: string): string {
  return `所有: ${ownerName}`;
}

/**
 * 所有の補記が占める矩形。ノードの下に中央ぞろえで置く。
 * データフローの線とラベルがこの文字に重ならないよう、経路計算で障害物として扱う（routeDataflows の captions）。
 */
export function ownerCaptionBox(node: Box, ownerName: string): Box {
  const width = Math.ceil(textUnits(ownerCaptionText(ownerName)) * OWNER_CAPTION.fontSize) + 4;
  return { x: node.x + (node.width - width) / 2, y: node.y + node.height + OWNER_CAPTION.gap, width, height: OWNER_CAPTION.height, round: false };
}

export function boxCenter(b: Box): { x: number; y: number } {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** 中心から (dx, dy) 方向に伸ばした線が図形の境界と交わる点 */
export function clipToBoundary(b: Box, toward: { x: number; y: number }): { x: number; y: number } {
  const c = boxCenter(b);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  if (b.round) {
    // 円（名称が長いと横長の楕円）
    const t = 1 / Math.hypot(dx / (b.width / 2), dy / (b.height / 2));
    return { x: c.x + dx * t, y: c.y + dy * t };
  }
  const hw = b.width / 2;
  const hh = b.height / 2;
  const scale = Math.min(dx !== 0 ? hw / Math.abs(dx) : Infinity, dy !== 0 ? hh / Math.abs(dy) : Infinity);
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}

type Point = { x: number; y: number };

/** データフローのラベル。長い説明は折り返して、幅を抑える（省略しない） */
export const EDGE_LABEL = { fontSize: 12, lineHeight: 15, maxUnits: 12, padX: 4 } as const;

/** 行頭に来てはいけない文字（句読点・閉じ括弧・長音など） */
const NO_LINE_START = /[、。，．・：；？！）」』】〕〉》］｝ー〜…,.:;?!)\]}]/;
/** 行末に来てはいけない文字（開き括弧） */
const NO_LINE_END = /[（「『【〔〈《［｛([{]$/;

/**
 * 行の幅をそろえて折り返す（例: 13 文字なら 12 + 1 ではなく 7 + 6）。行頭に句読点・閉じ括弧が来るときは前の行に付け、
 * 行末の開き括弧は次の行に送る。
 */
export function edgeLabelLines(label: string): string[] {
  if (!label) return [];
  const total = textUnits(label);
  if (total <= EDGE_LABEL.maxUnits) return [label];
  const width = Math.ceil(total / Math.ceil(total / EDGE_LABEL.maxUnits));
  const lines: string[] = [];
  let cur = '';
  let units = 0;
  for (const ch of label) {
    const w = charUnits(ch);
    if (units + w > width && cur && !NO_LINE_START.test(ch)) {
      const carry = NO_LINE_END.test(cur) && cur.length > 1 ? cur.slice(-1) : '';
      lines.push(carry ? cur.slice(0, -1) : cur);
      cur = carry;
      units = carry ? charUnits(carry) : 0;
    }
    cur += ch;
    units += w;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** ラベルの外接矩形の大きさ（背景の余白を含む）。ラベルがなければ 0 */
export function edgeLabelSize(label: string): { width: number; height: number } {
  const lines = edgeLabelLines(label);
  if (!lines.length) return { width: 0, height: 0 };
  return { width: Math.ceil(Math.max(...lines.map(textUnits)) * EDGE_LABEL.fontSize) + EDGE_LABEL.padX * 2, height: lines.length * EDGE_LABEL.lineHeight };
}

/**
 * 同じ 2 つのノードを結ぶデータフローが複数あるとき（往復など）、重ならないよう膨らませる量。
 * 向きの逆な線は法線も逆になるので、同じ符号の量でも反対側に膨らむ。
 */
export function edgeBias(edges: { id: string; sourceNodeId: string; targetNodeId: string }[], id: string): number {
  const e = edges.find((x) => x.id === id);
  if (!e) return 0;
  const key = (x: typeof e) => [x.sourceNodeId, x.targetNodeId].sort().join('\n');
  const group = edges.filter((x) => key(x) === key(e));
  if (group.length < 2) return 0;
  const sign = e.sourceNodeId < e.targetNodeId ? 1 : -1;
  return (group.indexOf(e) - (group.length - 1) / 2) * 36 * sign;
}

export interface EdgeRoute {
  /** SVG の path（直線か 2 次ベジェ曲線） */
  path: string;
  start: Point;
  end: Point;
  /** 2 次ベジェ曲線の制御点。直線なら null */
  control: Point | null;
  /** 線を膨らませた量（直線は 0） */
  offset: number;
  /** ラベルの中心。routeEdge では線の中間点、routeDataflows では他の線・ラベルを避けた位置 */
  label: Point;
  /** 始点の丸印の中心。ノードに隠れないよう、始点から線に沿って少し進んだ位置 */
  dot: Point;
}

/** 始点の丸印の半径。どのノードから出る線かを、矢じりのない側でも見分けられるようにする */
export const EDGE_START_DOT = 3;

/** 両端と制御点（直線なら null）から経路を作る。ラベルは線の中間点に置く */
function makeRoute(start: Point, end: Point, control: Point | null, offset: number): EdgeRoute {
  const r: EdgeRoute = control
    ? {
        path: `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`,
        start,
        end,
        label: { x: 0.25 * start.x + 0.5 * control.x + 0.25 * end.x, y: 0.25 * start.y + 0.5 * control.y + 0.25 * end.y },
        control,
        offset,
        dot: start,
      }
    : { path: `M ${start.x} ${start.y} L ${end.x} ${end.y}`, start, end, control: null, offset, label: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, dot: start };
  const t = tangentOnRoute(r, 0);
  r.dot = { x: start.x + t.x * (EDGE_START_DOT + 1), y: start.y + t.y * (EDGE_START_DOT + 1) };
  return r;
}

/** 経路上の点（t は 0〜1） */
export function pointOnRoute(r: EdgeRoute, t: number): Point {
  const c = r.control;
  return c
    ? { x: (1 - t) ** 2 * r.start.x + 2 * (1 - t) * t * c.x + t ** 2 * r.end.x, y: (1 - t) ** 2 * r.start.y + 2 * (1 - t) * t * c.y + t ** 2 * r.end.y }
    : { x: r.start.x + (r.end.x - r.start.x) * t, y: r.start.y + (r.end.y - r.start.y) * t };
}

/** 経路の接線方向の単位ベクトル（t は 0〜1） */
function tangentOnRoute(r: EdgeRoute, t: number): Point {
  const c = r.control;
  const d = c
    ? { x: 2 * (1 - t) * (c.x - r.start.x) + 2 * t * (r.end.x - c.x), y: 2 * (1 - t) * (c.y - r.start.y) + 2 * t * (r.end.y - c.y) }
    : { x: r.end.x - r.start.x, y: r.end.y - r.start.y };
  const len = Math.hypot(d.x, d.y) || 1;
  return { x: d.x / len, y: d.y / len };
}

/** 経路を約 step px おきの点にする（両端を除く） */
function sampleRoute(r: EdgeRoute, step: number): Point[] {
  const n = Math.max(8, Math.ceil(Math.hypot(r.end.x - r.start.x, r.end.y - r.start.y) / step));
  const pts: Point[] = [];
  for (let i = 1; i < n; i++) pts.push(pointOnRoute(r, i / n));
  return pts;
}

/** 線分 a-b が矩形と交わるか（Liang–Barsky のクリッピング） */
function segmentHitsRect(a: Point, b: Point, r: { x1: number; y1: number; x2: number; y2: number }): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [[-dx, a.x - r.x1], [dx, r.x2 - a.x], [-dy, a.y - r.y1], [dy, r.y2 - a.y]]) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}

/** ラベルの矩形（中心 p）がノード（矩形・楕円）に重なるか。楕円は、矩形の中で楕円の中心に最も近い点が楕円の内側にあるかで調べる */
function labelHitsNode(p: Point, size: { width: number; height: number }, o: Box): boolean {
  const c = boxCenter(o);
  if (!o.round) return Math.abs(c.x - p.x) < (o.width + size.width) / 2 && Math.abs(c.y - p.y) < (o.height + size.height) / 2;
  const nearX = Math.min(Math.max(c.x, p.x - size.width / 2), p.x + size.width / 2);
  const nearY = Math.min(Math.max(c.y, p.y - size.height / 2), p.y + size.height / 2);
  return ((nearX - c.x) / (o.width / 2 + 2)) ** 2 + ((nearY - c.y) / (o.height / 2 + 2)) ** 2 < 1;
}

/** 点が図形（margin だけ膨らませた矩形・楕円）の中にあるか */
function inside(b: Box, p: Point, margin: number): boolean {
  const c = boxCenter(b);
  const rx = b.width / 2 + margin;
  const ry = b.height / 2 + margin;
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return b.round ? (dx / rx) ** 2 + (dy / ry) ** 2 < 1 : Math.abs(dx) < rx && Math.abs(dy) < ry;
}

const sameBox = (a: Box, b: Box) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * データフローの経路（design.md 9.2）。両端のノードの中心を結ぶ直線を基本とし、
 * 途中のノード（obstacles）を通る、またはラベルがノードに重なるときは、法線方向に膨らませた曲線で避ける。
 * 膨らませる量は bias（往復の線の振り分け）を起点に、小さい順に試す。避けきれなければ重なりが最も少ないものを使う。
 * 画面と SVG 出力で共有する。
 */
export function routeEdge(sb: Box, tb: Box, obstacles: Box[], labelSize: { width: number; height: number } = { width: 0, height: 0 }, bias = 0): EdgeRoute {
  const { build, hits } = edgeRouter(sb, tb, obstacles, labelSize);
  let best: { r: EdgeRoute; n: number } | null = null;
  for (let step = 0; step <= 30; step++) {
    for (const k of step === 0 ? [bias] : [bias + step * 15, bias - step * 15]) {
      const r = build(k);
      const n = hits(r, best ? best.n : Infinity);
      if (n === 0) return r;
      if (!best || n < best.n) best = { r, n };
    }
  }
  return best!.r;
}

/**
 * 2 つのノードを結ぶ経路の作り方（build: 膨らませる量 k から経路を作る）と、
 * 経路が通るノード・ラベルが重なるノードの数え方（hits）。routeEdge と、交差を減らす引き直し（routeDataflows）で使う。
 */
function edgeRouter(sb: Box, tb: Box, obstacles: Box[], labelSize: { width: number; height: number }) {
  const sc = boxCenter(sb);
  const tc = boxCenter(tb);
  const len = Math.hypot(tc.x - sc.x, tc.y - sc.y) || 1;
  const nx = -(tc.y - sc.y) / len;
  const ny = (tc.x - sc.x) / len;
  const others = obstacles.filter((o) => !sameBox(o, sb) && !sameBox(o, tb));

  const build = (k: number): EdgeRoute => {
    if (k === 0) return makeRoute(clipToBoundary(sb, tc), clipToBoundary(tb, sc), null, 0);
    // 中間点が k だけずれるよう、制御点は中心どうしの中点から 2k 離す
    const c = { x: (sc.x + tc.x) / 2 + nx * k * 2, y: (sc.y + tc.y) / 2 + ny * k * 2 };
    return makeRoute(clipToBoundary(sb, c), clipToBoundary(tb, c), c, k);
  };
  /** 線が通るノードと、ラベルが重なるノードの数。limit に達したら数えるのをやめる */
  const hits = (r: EdgeRoute, limit: number): number => {
    // 曲線上の点を約 8px おきに取り、点の外接矩形と重ならないノードは調べない
    const pts = sampleRoute(r, 8);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    let n = 0;
    for (const o of others) {
      if (o.x - 6 > maxX || o.x + o.width + 6 < minX || o.y - 6 > maxY || o.y + o.height + 6 < minY) continue;
      if (pts.some((p) => inside(o, p, 6))) n++;
      if (n >= limit) return n;
    }
    if (labelSize.width) {
      for (const o of [...others, sb, tb]) if (labelHitsNode(r.label, labelSize, o)) n++;
    }
    return n;
  };
  return { build, hits };
}

/** 線分 a-b と c-d が、端点以外の 1 点で交わるか */
export function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const side = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = side(c, d, a);
  const d2 = side(c, d, b);
  const d3 = side(a, b, c);
  const d4 = side(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** 交差を調べるための折れ線（約 12px おきの点）。8 区間ごとに外接矩形を付けて、遠い区間を飛ばす */
interface Polyline {
  pts: Point[];
  chunks: { from: number; to: number; minX: number; maxX: number; minY: number; maxY: number }[];
  /** 線全体の外接矩形 */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function toPolyline(r: EdgeRoute): Polyline {
  const pts = [r.start, ...sampleRoute(r, 12), r.end];
  const chunks: Polyline['chunks'] = [];
  for (let from = 0; from < pts.length - 1; from += 8) {
    const to = Math.min(from + 8, pts.length - 1);
    const part = pts.slice(from, to + 1);
    chunks.push({ from, to, minX: Math.min(...part.map((p) => p.x)), maxX: Math.max(...part.map((p) => p.x)), minY: Math.min(...part.map((p) => p.y)), maxY: Math.max(...part.map((p) => p.y)) });
  }
  return {
    pts,
    chunks,
    minX: Math.min(...chunks.map((c) => c.minX)),
    maxX: Math.max(...chunks.map((c) => c.maxX)),
    minY: Math.min(...chunks.map((c) => c.minY)),
    maxY: Math.max(...chunks.map((c) => c.maxY)),
  };
}

type FlowEnds = { sourceNodeId: string; targetNodeId: string };

/**
 * 2 本のデータフローの線が交わるか。同じノードにつながる端は、ノードの境界付近で線が近づくだけなので、
 * その端から 2 区間（約 24px）は調べない。
 */
function flowsCross(e: FlowEnds, a: Polyline, o: FlowEnds, b: Polyline): boolean {
  if (a.minX > b.maxX || a.maxX < b.minX || a.minY > b.maxY || a.maxY < b.minY) return false;
  const shared = (n: string, f: FlowEnds) => n === f.sourceNodeId || n === f.targetNodeId;
  const skipA = [shared(e.sourceNodeId, o), shared(e.targetNodeId, o)];
  const skipB = [shared(o.sourceNodeId, e), shared(o.targetNodeId, e)];
  const segA = a.pts.length - 1;
  const segB = b.pts.length - 1;
  const usable = (i: number, n: number, skip: boolean[]) => !(skip[0] && i < 2) && !(skip[1] && i >= n - 2);
  for (const ca of a.chunks) {
    for (const cb of b.chunks) {
      if (ca.minX > cb.maxX || ca.maxX < cb.minX || ca.minY > cb.maxY || ca.maxY < cb.minY) continue;
      for (let i = ca.from; i < ca.to; i++) {
        if (!usable(i, segA, skipA)) continue;
        for (let j = cb.from; j < cb.to; j++) {
          if (usable(j, segB, skipB) && segmentsCross(a.pts[i], a.pts[i + 1], b.pts[j], b.pts[j + 1])) return true;
        }
      }
    }
  }
  return false;
}

/** 交わっているデータフローの組の数 */
export function countCrossings(routes: Map<string, EdgeRoute>, edges: ({ id: string } & FlowEnds)[]): number {
  const list = edges.filter((e) => routes.has(e.id)).map((e) => ({ e, poly: toPolyline(routes.get(e.id)!) }));
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) if (flowsCross(list[i].e, list[i].poly, list[j].e, list[j].poly)) n++;
  }
  return n;
}

/** 交差を減らすために引き直しを試す経路の数の上限（routeDataflows） */
const MAX_REROUTE_TRIALS = 160;

/**
 * 線の上に置いたラベルで自分の線が隠れすぎないよう、ラベルの外に見えていてほしい長さ（px）。
 * 終点側は矢じり（約 16px）と、その手前の線が見える分をとる。
 */
const MIN_VISIBLE_LEAD = 16;
const MIN_VISIBLE_TAIL = 32;

/**
 * 中心 p のラベル（margin だけ膨らませた矩形）を経路の上に置いたとき、ラベルの外に見える線の長さ（始点側・終点側）。
 * ラベルが線に掛からなければ線全体の長さを返す。
 */
function visibleAroundLabel(r: EdgeRoute, p: Point, size: { width: number; height: number }, margin: number): { lead: number; tail: number } {
  const hw = size.width / 2 + margin;
  const hh = size.height / 2 + margin;
  const n = Math.max(16, Math.ceil(Math.hypot(r.end.x - r.start.x, r.end.y - r.start.y) / 4));
  let total = 0;
  let first = -1;
  let last = -1;
  let prev = r.start;
  for (let i = 0; i <= n; i++) {
    const q = i === 0 ? r.start : pointOnRoute(r, i / n);
    total += Math.hypot(q.x - prev.x, q.y - prev.y);
    prev = q;
    if (Math.abs(q.x - p.x) < hw && Math.abs(q.y - p.y) < hh) {
      if (first < 0) first = total;
      last = total;
    }
  }
  return first < 0 ? { lead: total, tail: total } : { lead: first, tail: total - last };
}

/** 同じノードにつながる線の端どうしを、ノードの縁に沿って離す間隔（px） */
export const MIN_END_GAP = 12;

/** 縁を一周する点の数（spreadEnds で縁に沿った距離を測る） */
const OUTLINE_STEPS = 72;

/**
 * 同じノードの縁の近い位置につながる線の端を、縁に沿って MIN_END_GAP ずつ離す（design.md 9.2）。
 * 線が根元で重なると、どの線がそのノードから出ているのか追えないため。
 * 縁の上の並び順は変えず、近すぎる端の集まりを、集まりの中心を動かさずに等間隔に広げる。
 * 線が多く一周に収まらないノードでは、間隔を「周の長さ / 本数」まで詰める。
 * 経路の制御点は変えず、端点だけを差し替える。ずらしたことでほかのノードを通るようになる線は、元のままにする。
 */
function spreadEnds(boxes: Map<string, Box>, edges: ({ id: string; label: string } & FlowEnds)[], routes: Map<string, EdgeRoute>, obstacles: Box[]): void {
  const ends = new Map<string, { id: string; side: 'start' | 'end'; p: Point }[]>();
  for (const e of edges) {
    const r = routes.get(e.id);
    if (!r || e.sourceNodeId === e.targetNodeId) continue;
    for (const [nodeId, side] of [[e.sourceNodeId, 'start'], [e.targetNodeId, 'end']] as const) {
      if (!ends.has(nodeId)) ends.set(nodeId, []);
      ends.get(nodeId)!.push({ id: e.id, side, p: r[side] });
    }
  }
  const moved = new Map<string, { start?: Point; end?: Point }>();
  for (const [nodeId, list] of ends) {
    const b = boxes.get(nodeId)!;
    if (list.length < 2 || !b.width || !b.height) continue;
    const c = boxCenter(b);
    // 縁を角度で等分した点と、そこまでの縁に沿った距離
    const outline: Point[] = [];
    const dist: number[] = [0];
    for (let i = 0; i <= OUTLINE_STEPS; i++) {
      const a = (i / OUTLINE_STEPS) * Math.PI * 2;
      outline.push(clipToBoundary(b, { x: c.x + Math.cos(a), y: c.y + Math.sin(a) }));
      if (i > 0) dist.push(dist[i - 1] + Math.hypot(outline[i].x - outline[i - 1].x, outline[i].y - outline[i - 1].y));
    }
    const perimeter = dist[OUTLINE_STEPS];
    const toDist = (p: Point) => {
      const a = (Math.atan2(p.y - c.y, p.x - c.x) + Math.PI * 2) % (Math.PI * 2);
      const f = (a / (Math.PI * 2)) * OUTLINE_STEPS;
      const i = Math.min(Math.floor(f), OUTLINE_STEPS - 1);
      return dist[i] + (dist[i + 1] - dist[i]) * (f - i);
    };
    const toPoint = (s: number) => {
      const d = ((s % perimeter) + perimeter) % perimeter;
      let i = 0;
      while (i < OUTLINE_STEPS - 1 && dist[i + 1] < d) i++;
      const f = (d - dist[i]) / (dist[i + 1] - dist[i] || 1);
      // 角の近くでは点どうしを結ぶ線分が縁の内側を通るので、縁の上に戻す
      return clipToBoundary(b, { x: outline[i].x + (outline[i + 1].x - outline[i].x) * f, y: outline[i].y + (outline[i + 1].y - outline[i].y) * f });
    };
    const sorted = list.map((x) => ({ ...x, s: toDist(x.p) })).sort((x, y) => x.s - y.s);
    const n = sorted.length;
    const gap = Math.min(MIN_END_GAP, perimeter / n);
    const gapAfter = (i: number) => (i === n - 1 ? sorted[0].s + perimeter - sorted[i].s : sorted[i + 1].s - sorted[i].s);
    if (sorted.every((_, i) => gapAfter(i) >= gap - 0.01)) continue;
    // 一周のうち最も空いているところで切り開いて、1 本の線の上の並びとして扱う
    let cut = 0;
    for (let i = 1; i < n; i++) if (gapAfter(i) > gapAfter(cut)) cut = i;
    const line = Array.from({ length: n }, (_, i) => {
      const j = (cut + 1 + i) % n;
      return { ...sorted[j], s: sorted[j].s + (j <= cut ? perimeter : 0) };
    });
    // i 番目から i * gap を引いた値が小さい順に並べば、間隔は gap 以上になる。
    // 並びが逆転しているところは、平均にまとめる（集まりの中心を保ったまま等間隔になる）
    const blocks: { sum: number; count: number }[] = [];
    line.forEach((x, i) => {
      blocks.push({ sum: x.s - i * gap, count: 1 });
      while (blocks.length > 1 && blocks[blocks.length - 2].sum / blocks[blocks.length - 2].count > blocks[blocks.length - 1].sum / blocks[blocks.length - 1].count) {
        const last = blocks.pop()!;
        blocks[blocks.length - 1].sum += last.sum;
        blocks[blocks.length - 1].count += last.count;
      }
    });
    let i = 0;
    for (const blk of blocks) {
      for (let k = 0; k < blk.count; k++, i++) {
        const s = blk.sum / blk.count + i * gap;
        if (Math.abs(s - line[i].s) < 0.01) continue;
        if (!moved.has(line[i].id)) moved.set(line[i].id, {});
        moved.get(line[i].id)![line[i].side] = toPoint(s);
      }
    }
  }
  for (const e of edges) {
    const m = moved.get(e.id);
    const cur = routes.get(e.id);
    if (!m || !cur) continue;
    const next = makeRoute(m.start ?? cur.start, m.end ?? cur.end, cur.control, cur.offset);
    const { hits } = edgeRouter(boxes.get(e.sourceNodeId)!, boxes.get(e.targetNodeId)!, obstacles, edgeLabelSize(e.label));
    if (hits(next, 1) > 0 && hits(cur, 1) === 0) continue;
    routes.set(e.id, next);
  }
}

/** ラベルを置く候補の位置（線の中間点から両端へ 0.06 刻み。0.14〜0.86） */
const LABEL_POSITIONS = [0.5, ...Array.from({ length: 6 }, (_, i) => [0.5 - (i + 1) * 0.06, 0.5 + (i + 1) * 0.06]).flat()];

/**
 * DFD のすべてのデータフローの経路とラベルの位置を求める（design.md 9.2）。画面と SVG 出力で共有する。
 * 経路は routeEdge で 1 本ずつ求めたあと、ほかの線と交わる線を、交わりが減る膨らませ方で引き直す（2 回まで）。
 * boundary を渡すと、システム境界の線にもラベルを重ねないようにする。
 * captions（ノードの外に出す文字の矩形。ownerCaptionBox）を渡すと、線とラベルがその文字に重ならないよう、ノードと同じく避ける。
 * 補記を持つノード自身につながる線も避けるので、補記のある側からは出入りしにくくなる。
 * 経路は routeEdge で 1 本ずつ求める。ラベルは、ほかのデータフローの線・ほかのラベル・ノードに重ならない位置を、
 * 線の中間点から両端へ向かって、線の上と線の両脇（線に沿わせて横にずらす）の順に探す。
 * 背景で線を隠さないよう、どこにも置けなければ重なりが最も少ない位置にする。大きいラベルから順に置く。
 */
export function routeDataflows(
  boxes: Map<string, Box>,
  edges: { id: string; sourceNodeId: string; targetNodeId: string; label: string }[],
  boundary: { x: number; y: number; width: number; height: number } | null = null,
  captions: Box[] = [],
): Map<string, EdgeRoute> {
  const obstacles = [...boxes.values(), ...captions];
  const routes = new Map<string, EdgeRoute>();
  for (const e of edges) {
    const sb = boxes.get(e.sourceNodeId);
    const tb = boxes.get(e.targetNodeId);
    if (sb && tb) routes.set(e.id, routeEdge(sb, tb, obstacles, edgeLabelSize(e.label), edgeBias(edges, e.id)));
  }
  // ほかの線と交わる線は、ノードを避けたまま膨らませ方を ±120px の範囲で変え、交わる本数が減るなら引き直す。
  // 試す経路は MAX_REROUTE_TRIALS 本まで（ノードのドラッグ中も毎回計算するため）
  let trials = 0;
  const polys = new Map([...routes].map(([id, r]) => [id, toPolyline(r)]));
  const crossingsOf = (e: (typeof edges)[number], poly: Polyline, limit = Infinity) => {
    let n = 0;
    for (const o of edges) {
      if (o.id === e.id || !polys.has(o.id)) continue;
      if (flowsCross(e, poly, o, polys.get(o.id)!)) n++;
      if (n >= limit) break;
    }
    return n;
  };
  for (let pass = 0; pass < 2; pass++) {
    let improved = false;
    for (const e of edges) {
      const cur = routes.get(e.id);
      if (!cur) continue;
      let bestC = crossingsOf(e, polys.get(e.id)!);
      if (bestC === 0) continue;
      const { build, hits } = edgeRouter(boxes.get(e.sourceNodeId)!, boxes.get(e.targetNodeId)!, obstacles, edgeLabelSize(e.label));
      let best = cur;
      for (let step = 1; step <= 8 && bestC > 0 && trials < MAX_REROUTE_TRIALS; step++) {
        for (const k of [cur.offset + step * 15, cur.offset - step * 15]) {
          trials++;
          const r = build(k);
          if (hits(r, 1) > 0) continue;
          const poly = toPolyline(r);
          const c = crossingsOf(e, poly, bestC);
          if (c < bestC) {
            bestC = c;
            best = r;
            if (c === 0) break;
          }
        }
      }
      if (best !== cur) {
        routes.set(e.id, best);
        polys.set(e.id, toPolyline(best));
        improved = true;
      }
    }
    if (!improved) break;
  }
  spreadEnds(boxes, edges, routes, obstacles);
  // ほかの線との重なりを調べるため、各線を約 12px おきの点を結ぶ折れ線にし、8 区間ずつ外接矩形を付けて分けておく
  const lines: { id: string; pts: Point[]; minX: number; maxX: number; minY: number; maxY: number }[] = [];
  for (const [id, r] of routes) {
    const all = [r.start, ...sampleRoute(r, 12), r.end];
    for (let i = 0; i < all.length - 1; i += 8) {
      const pts = all.slice(i, i + 9);
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      lines.push({ id, pts, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) });
    }
  }
  // システム境界の線も、ラベルで隠さないよう避ける（辺ごとに 1 本の線として扱う）
  if (boundary) {
    const { x, y, width: w, height: h } = boundary;
    const side = (id: string, a: Point, b: Point) => {
      lines.push({ id, pts: [a, b], minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) });
    };
    side('\u0000top', { x, y }, { x: x + w, y });
    side('\u0000bottom', { x, y: y + h }, { x: x + w, y: y + h });
    side('\u0000left', { x, y }, { x, y: y + h });
    side('\u0000right', { x: x + w, y }, { x: x + w, y: y + h });
  }
  const placed: { p: Point; size: { width: number; height: number } }[] = [];
  const labeled = edges
    .filter((e) => routes.has(e.id) && e.label)
    .map((e) => ({ e, size: edgeLabelSize(e.label) }))
    .sort((a, b) => b.size.width * b.size.height - a.size.width * a.size.height);
  const M = 3;
  for (const { e, size } of labeled) {
    const r = routes.get(e.id)!;
    const hw = size.width / 2 + M;
    const hh = size.height / 2 + M;
    const cost = (p: Point, limit: number, onLine: boolean): number => {
      let n = 0;
      // 線が短く、ラベルで矢じりやほとんどの線が隠れるときは、ほかの線に重なるより悪いとみなして線の脇を優先する
      if (onLine) {
        const v = visibleAroundLabel(r, p, size, M);
        if (v.lead < MIN_VISIBLE_LEAD || v.tail < MIN_VISIBLE_TAIL) n += 1.5;
      }
      for (const o of obstacles) if (labelHitsNode(p, size, o)) n += 2;
      if (n >= limit) return n;
      for (const q of placed) {
        if (Math.abs(q.p.x - p.x) < (q.size.width + size.width) / 2 + M && Math.abs(q.p.y - p.y) < (q.size.height + size.height) / 2 + M) n += 2;
      }
      if (n >= limit) return n;
      const rect = { x1: p.x - hw, y1: p.y - hh, x2: p.x + hw, y2: p.y + hh };
      const hit = new Set<string>();
      for (const l of lines) {
        if (l.id === e.id || hit.has(l.id) || l.minX > rect.x2 || l.maxX < rect.x1 || l.minY > rect.y2 || l.maxY < rect.y1) continue;
        for (let i = 1; i < l.pts.length; i++) {
          if (segmentHitsRect(l.pts[i - 1], l.pts[i], rect)) {
            hit.add(l.id);
            n++;
            break;
          }
        }
        if (n >= limit) return n;
      }
      return n;
    };
    let best = { p: r.label, n: Infinity };
    search: for (const t of LABEL_POSITIONS) {
      const on = pointOnRoute(r, t);
      const tan = tangentOnRoute(r, t);
      // 線の脇に置くときは、ラベルの矩形が線から離れる分だけ法線方向にずらす
      const nx = -tan.y;
      const ny = tan.x;
      const d = Math.abs(nx) * (size.width / 2) + Math.abs(ny) * (size.height / 2) + 4;
      for (const p of [on, { x: on.x + nx * d, y: on.y + ny * d }, { x: on.x - nx * d, y: on.y - ny * d }]) {
        // 線の上に置く案は自分の線を隠すが、ほかと重ならず線が十分見えれば最優先（見慣れた位置）
        const n = cost(p, best.n, p === on);
        if (n < best.n) best = { p, n };
        if (n === 0) break search;
      }
    }
    r.label = best.p;
    placed.push({ p: best.p, size });
  }
  return routes;
}

/** 文字幅を概算し（charUnits）、maxUnits に収まるよう maxLines 行まで折り返す。収まらなければ末尾を「…」にする */
export function wrapLabel(text: string, maxUnits: number, maxLines = 2): string[] {
  const lines: string[] = [];
  let cur = '';
  let units = 0;
  for (const ch of text) {
    const w = charUnits(ch);
    if (units + w > maxUnits && cur) {
      lines.push(cur);
      cur = '';
      units = 0;
      if (lines.length === maxLines) break;
    }
    cur += ch;
    units += w;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  const consumed = lines.join('').length;
  if (consumed < [...text].length && lines.length) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = last.slice(0, Math.max(0, last.length - 1)) + '…';
  }
  return lines;
}

/**
 * 既存ノードと重ならない左上座標を 40px 刻みで探す（design.md 6.4）。
 * preferred を起点に、右方向・下方向へ走査する。
 */
export function findFreePosition(
  existing: { refType: NodeRefType; x: number; y: number; name?: string }[],
  refType: NodeRefType,
  preferred: { x: number; y: number } = { x: 40, y: 40 },
  rowWidth = 960,
  name = '',
): { x: number; y: number } {
  const size = nodeSize(refType, name);
  const margin = 24;
  const boxes = existing.map((n) => ({ ...nodeBox(n.refType, n.x, n.y, n.name) }));
  const overlaps = (x: number, y: number) =>
    boxes.some(
      (b) => x < b.x + b.width + margin && x + size.width + margin > b.x && y < b.y + b.height + margin && y + size.height + margin > b.y,
    );
  const startX = Math.round(preferred.x / 40) * 40;
  const startY = Math.round(preferred.y / 40) * 40;
  for (let row = 0; row < 200; row++) {
    for (let col = 0; col * 40 < rowWidth; col++) {
      const x = startX + col * 40;
      const y = startY + row * 40;
      if (!overlaps(x, y)) return { x, y };
    }
  }
  return { x: startX, y: startY };
}

/** 境界の内側に置く（ソフトウェア内部の）要素か。外部エンティティと EIF は外側（FR-DF-19） */
export function isInsideBoundary(refType: NodeRefType, kind: FunctionKind | null | undefined): boolean {
  if (refType === 'externalEntity') return false;
  if (refType === 'dataFunction') return kind === 'ILF';
  return true;
}

export const BOUNDARY = {
  /** ノードの外接矩形からの余白 */
  marginX: 32,
  /** 上側はバッジ（約 22px）と境界ラベルの分を足す */
  marginTop: 56,
  /** 下側は参照補記（約 16px）の分を足す */
  marginBottom: 36,
  radius: 12,
  color: '#2457A5',
} as const;

/**
 * システム境界の矩形（FR-DF-19）。内部の要素の外接矩形に余白を足す。内部の要素がなければ null。
 */
export function computeBoundary(
  nodes: { refType: NodeRefType; x: number; y: number; kind?: FunctionKind | null; name?: string }[],
): { x: number; y: number; width: number; height: number } | null {
  const inside = nodes.filter((n) => isInsideBoundary(n.refType, n.kind));
  if (!inside.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of inside) {
    const b = nodeBox(n.refType, n.x, n.y, n.name);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  const x = minX - BOUNDARY.marginX;
  const y = minY - BOUNDARY.marginTop;
  return { x, y, width: maxX + BOUNDARY.marginX - x, height: maxY + BOUNDARY.marginBottom - y };
}
