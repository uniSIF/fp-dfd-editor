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
