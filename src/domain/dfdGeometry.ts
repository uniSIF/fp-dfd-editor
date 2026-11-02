import type { FunctionKind, NodeRefType } from './types';

/** ノード寸法。画面のカスタムノードと SVG 出力で共有する（design.md 6.2） */
export const GEOMETRY = {
  process: { radius: 44 },
  dataStore: { width: 180, height: 44 },
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

export function nodeSize(refType: NodeRefType): { width: number; height: number } {
  switch (refType) {
    case 'transactionFunction':
    case 'nonCountedProcess':
      return { width: GEOMETRY.process.radius * 2, height: GEOMETRY.process.radius * 2 };
    case 'dataFunction':
      return { width: GEOMETRY.dataStore.width, height: GEOMETRY.dataStore.height };
    case 'externalEntity':
      return { width: GEOMETRY.externalEntity.width, height: GEOMETRY.externalEntity.height };
  }
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  round: boolean;
}

export function nodeBox(refType: NodeRefType, x: number, y: number): Box {
  const { width, height } = nodeSize(refType);
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
    const r = b.width / 2;
    const len = Math.hypot(dx, dy);
    return { x: c.x + (dx / len) * r, y: c.y + (dy / len) * r };
  }
  const hw = b.width / 2;
  const hh = b.height / 2;
  const scale = Math.min(dx !== 0 ? hw / Math.abs(dx) : Infinity, dy !== 0 ? hh / Math.abs(dy) : Infinity);
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}

/** 全角 1、半角 0.5 で文字幅を概算し、maxUnits に収まるよう 2 行まで折り返す */
export function wrapLabel(text: string, maxUnits: number, maxLines = 2): string[] {
  const lines: string[] = [];
  let cur = '';
  let units = 0;
  for (const ch of text) {
    const w = /[\x20-\x7e｡-ﾟ]/.test(ch) ? 0.5 : 1;
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
  existing: { refType: NodeRefType; x: number; y: number }[],
  refType: NodeRefType,
  preferred: { x: number; y: number } = { x: 40, y: 40 },
  rowWidth = 960,
): { x: number; y: number } {
  const size = nodeSize(refType);
  const margin = 24;
  const boxes = existing.map((n) => ({ ...nodeBox(n.refType, n.x, n.y) }));
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
  nodes: { refType: NodeRefType; x: number; y: number; kind?: FunctionKind | null }[],
): { x: number; y: number; width: number; height: number } | null {
  const inside = nodes.filter((n) => isInsideBoundary(n.refType, n.kind));
  if (!inside.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of inside) {
    const b = nodeBox(n.refType, n.x, n.y);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  const x = minX - BOUNDARY.marginX;
  const y = minY - BOUNDARY.marginTop;
  return { x, y, width: maxX + BOUNDARY.marginX - x, height: maxY + BOUNDARY.marginBottom - y };
}
