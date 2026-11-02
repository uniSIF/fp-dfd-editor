import { BADGE_COLORS, BOUNDARY, COLORS, GEOMETRY, boxCenter, clipToBoundary, computeBoundary, nodeBox, wrapLabel, type Box } from './dfdGeometry';
import { COMPLEXITY_LABELS, FUNCTION_KIND_LABELS } from './fpTables';
import { LEGEND_KINDS, buildDfdLegend, type DfdLegend } from './legend';
import { getFeaturePath } from './queries';
import type { DfdNode, FpDocument, Id } from './types';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function text(x: number, y: number, s: string, attrs = ''): string {
  return `<text x="${r(x)}" y="${r(y)}" ${attrs}>${esc(s)}</text>`;
}

function r(n: number): string {
  return String(Math.round(n * 10) / 10);
}

function badge(cx: number, cy: number, kind: keyof typeof BADGE_COLORS): string {
  const w = kind.length * 8 + 10;
  const h = GEOMETRY.badge.height;
  return (
    `<rect x="${r(cx - w / 2)}" y="${r(cy - h / 2)}" width="${w}" height="${h}" rx="3" fill="${BADGE_COLORS[kind]}"/>` +
    text(cx, cy + 4, kind, `font-size="${GEOMETRY.badge.fontSize}" font-weight="600" fill="#fff" text-anchor="middle"`)
  );
}

function labelLines(cx: number, cy: number, lines: string[], attrs: string): string {
  const lh = GEOMETRY.label.fontSize + 3;
  const top = cy - ((lines.length - 1) * lh) / 2;
  return lines.map((l, i) => text(cx, top + i * lh + 4, l, attrs)).join('');
}

/** DFD を SVG 文字列にする（FR-SVG-01〜05、design.md 9.2） */
export function buildDfdSvg(doc: FpDocument, featureId: Id, options: { padding?: number; title?: boolean; legend?: boolean; boundary?: boolean } = {}): string {
  const padding = options.padding ?? 40;
  const withTitle = options.title ?? true;
  const legend = (options.legend ?? true) ? buildDfdLegend(doc, featureId) : null;
  const path = getFeaturePath(doc, featureId);
  if (!path) throw new Error(`feature not found: ${featureId}`);
  const { feature } = path;
  const nodes = feature.dfd.nodes;

  const boxes = new Map<Id, Box>();
  for (const n of nodes) boxes.set(n.id, nodeBox(n.refType, n.x, n.y));

  // 外接矩形（参照補記が下に出るデータストアは少し余裕を取る）
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of boxes.values()) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y - 12); // バッジ
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height + 16); // 参照補記
  }
  // システム境界（FR-DF-19）も描画範囲に含める
  const boundary = (options.boundary ?? true)
    ? computeBoundary(nodes.map((n) => ({ ...n, kind: n.refType === 'dataFunction' ? doc.dataFunctions[n.refId]?.kind : null })))
    : null;
  if (boundary) {
    minX = Math.min(minX, boundary.x);
    minY = Math.min(minY, boundary.y);
    maxX = Math.max(maxX, boundary.x + boundary.width);
    maxY = Math.max(maxY, boundary.y + boundary.height);
  }
  if (!nodes.length) { minX = 0; minY = 0; maxX = 320; maxY = 120; }
  // 凡例は図の右側に置き、ノードと重ならないよう描画範囲を広げる（FR-DF-17）
  const legendX = maxX + LEGEND_GAP;
  const legendY = minY;
  if (legend) {
    maxX = legendX + LEGEND_W;
    maxY = Math.max(maxY, legendY + legendHeight(legend));
  }
  const titleH = withTitle ? 32 : 0;
  const vx = minX - padding;
  const vy = minY - padding - titleH;
  const vw = maxX - minX + padding * 2;
  const vh = maxY - minY + padding * 2 + titleH;

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r(vx)} ${r(vy)} ${r(vw)} ${r(vh)}" width="${r(vw)}" height="${r(vh)}" font-family='${GEOMETRY.fontFamily}'>`);
  parts.push(`<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${COLORS.borderStrong}"/></marker></defs>`);
  parts.push(`<rect x="${r(vx)}" y="${r(vy)}" width="${r(vw)}" height="${r(vh)}" fill="#fff"/>`);
  if (withTitle) {
    const title = `${path.software.name} / ${path.category1.name} / ${path.category2.name} / ${feature.name}`;
    parts.push(text(vx + padding, vy + padding / 2 + 14, title, `font-size="14" font-weight="600" fill="${COLORS.text}"`));
  }

  if (boundary) {
    parts.push(
      `<g data-boundary="true"><rect x="${r(boundary.x)}" y="${r(boundary.y)}" width="${r(boundary.width)}" height="${r(boundary.height)}" rx="${BOUNDARY.radius}" fill="none" stroke="${BOUNDARY.color}" stroke-width="2"/>` +
        text(boundary.x + 14, boundary.y + 20, `システム境界: ${path.software.name}`, `font-size="12" font-weight="600" fill="${BOUNDARY.color}"`) +
        '</g>',
    );
  }

  // エッジ（直線。両端を図形境界でクリップ）
  for (const e of feature.dfd.edges) {
    const sb = boxes.get(e.sourceNodeId);
    const tb = boxes.get(e.targetNodeId);
    if (!sb || !tb) continue;
    const p1 = clipToBoundary(sb, boxCenter(tb));
    const p2 = clipToBoundary(tb, boxCenter(sb));
    parts.push(`<line x1="${r(p1.x)}" y1="${r(p1.y)}" x2="${r(p2.x)}" y2="${r(p2.y)}" stroke="${COLORS.borderStrong}" stroke-width="1.5" marker-end="url(#arrow)"/>`);
    if (e.label) {
      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2;
      parts.push(text(mx, my - 4, e.label, `font-size="12" fill="${COLORS.textSecondary}" text-anchor="middle" paint-order="stroke" stroke="#fff" stroke-width="5"`));
    }
  }

  for (const n of nodes) parts.push(renderNode(doc, n, boxes.get(n.id)!, featureId));
  if (legend) parts.push(renderLegend(legend, legendX, legendY));
  parts.push('</svg>');
  return parts.join('\n');
}

function renderNode(doc: FpDocument, n: DfdNode, b: Box, featureId: Id): string {
  const c = boxCenter(b);
  const nameAttrs = `font-size="${GEOMETRY.label.fontSize}" fill="${COLORS.text}" text-anchor="middle"`;
  const smallAttrs = `font-size="${GEOMETRY.label.smallFontSize}" fill="${COLORS.textSecondary}" text-anchor="middle"`;
  switch (n.refType) {
    case 'transactionFunction': {
      const tf = doc.transactionFunctions[n.refId];
      if (!tf) return '';
      return [
        `<circle cx="${r(c.x)}" cy="${r(c.y)}" r="${GEOMETRY.process.radius}" fill="#fff" stroke="${COLORS.borderStrong}" stroke-width="1.5"/>`,
        badge(c.x, b.y, tf.kind),
        labelLines(c.x, c.y - 6, wrapLabel(tf.name, 7), `font-size="12" fill="${COLORS.text}" text-anchor="middle"`),
        text(c.x, c.y + 20, `${tf.displayNo} · ${COMPLEXITY_LABELS[tf.complexity]}`, smallAttrs),
      ].join('');
    }
    case 'nonCountedProcess': {
      const p = doc.nonCountedProcesses[n.refId];
      if (!p) return '';
      return [
        `<circle cx="${r(c.x)}" cy="${r(c.y)}" r="${GEOMETRY.process.radius}" fill="${COLORS.ncpFill}" stroke="${COLORS.borderStrong}" stroke-width="1.5" stroke-dasharray="6 4"/>`,
        labelLines(c.x, c.y, wrapLabel(p.name, 7), `font-size="12" fill="${COLORS.textSecondary}" text-anchor="middle"`),
      ].join('');
    }
    case 'dataFunction': {
      const df = doc.dataFunctions[n.refId];
      if (!df) return '';
      const stroke = df.ownerFeatureId === null ? COLORS.warning : COLORS.borderStrong;
      const out = [
        `<rect x="${r(b.x)}" y="${r(b.y)}" width="${b.width}" height="${b.height}" fill="#fff"/>`,
        `<line x1="${r(b.x)}" y1="${r(b.y)}" x2="${r(b.x + b.width)}" y2="${r(b.y)}" stroke="${stroke}" stroke-width="1.5"/>`,
        `<line x1="${r(b.x)}" y1="${r(b.y + b.height)}" x2="${r(b.x + b.width)}" y2="${r(b.y + b.height)}" stroke="${stroke}" stroke-width="1.5"/>`,
        badge(b.x + 21, c.y, df.kind),
        labelLines(c.x + 18, c.y - 6, wrapLabel(df.name, 9, 1), nameAttrs),
        text(c.x + 18, c.y + 14, `${df.displayNo} · ${COMPLEXITY_LABELS[df.complexity]}`, smallAttrs),
      ];
      if (df.ownerFeatureId !== featureId) {
        const owner = df.ownerFeatureId ? doc.features[df.ownerFeatureId]?.name ?? '' : '未設定';
        out.push(text(c.x, b.y + b.height + 14, `所有: ${owner}`, smallAttrs));
      }
      return out.join('');
    }
    case 'externalEntity': {
      const ee = doc.externalEntities[n.refId];
      if (!ee) return '';
      // 同じ外部エンティティを複数配置している場合は左上の角に斜線を入れる（FR-DF-18）
      const duplicate = doc.features[featureId].dfd.nodes.filter((m) => m.refType === 'externalEntity' && m.refId === n.refId).length > 1;
      return [
        `<rect x="${r(b.x)}" y="${r(b.y)}" width="${b.width}" height="${b.height}" fill="#fff" stroke="${COLORS.text}" stroke-width="1.5"/>`,
        duplicate ? `<line data-duplicate="true" x1="${r(b.x)}" y1="${r(b.y + 12)}" x2="${r(b.x + 12)}" y2="${r(b.y)}" stroke="${COLORS.text}" stroke-width="1.5"/>` : '',
        labelLines(c.x, c.y, wrapLabel(ee.name, 9), nameAttrs),
      ].join('');
    }
  }
}

const LEGEND_W = 284;
const LEGEND_GAP = 48;
const ROW = 22;

function legendHeight(l: DfdLegend): number {
  return 34 + LEGEND_KINDS.length * ROW + 12 + ROW + (l.referenceCount ? 18 : 0) + (l.unplacedCount ? 18 : 0) + 8;
}

/** 種別ごとの計上件数の凡例（FR-DF-17） */
function renderLegend(l: DfdLegend, x: number, y: number): string {
  const h = legendHeight(l);
  const out = [
    `<g data-legend="true">`,
    `<rect x="${r(x)}" y="${r(y)}" width="${LEGEND_W}" height="${r(h)}" rx="6" fill="#fff" stroke="${COLORS.borderStrong}" stroke-width="1"/>`,
    text(x + 12, y + 22, '凡例（この機能に計上するファンクション）', `font-size="11" font-weight="600" fill="${COLORS.text}"`),
  ];
  let cy = y + 34;
  for (const k of LEGEND_KINDS) {
    out.push(badge(x + 12 + (k.length * 8 + 10) / 2, cy + ROW / 2, k));
    out.push(text(x + 52, cy + ROW / 2 + 4, FUNCTION_KIND_LABELS[k], `font-size="12" fill="${COLORS.text}"`));
    out.push(text(x + LEGEND_W - 12, cy + ROW / 2 + 4, `${l.counts[k]} 件`, `font-size="12" fill="${COLORS.text}" text-anchor="end"`));
    cy += ROW;
  }
  cy += 6;
  out.push(`<line x1="${r(x + 12)}" y1="${r(cy)}" x2="${r(x + LEGEND_W - 12)}" y2="${r(cy)}" stroke="${COLORS.borderStrong}" stroke-width="1"/>`);
  cy += 6;
  out.push(text(x + 12, cy + ROW / 2 + 4, `合計 ${l.total} 件`, `font-size="12" font-weight="600" fill="${COLORS.text}"`));
  out.push(text(x + LEGEND_W - 12, cy + ROW / 2 + 4, `未調整FP ${l.unadjustedFp}`, `font-size="12" font-weight="600" fill="${COLORS.text}" text-anchor="end"`));
  cy += ROW;
  const small = `font-size="11" fill="${COLORS.textSecondary}"`;
  if (l.referenceCount) {
    out.push(text(x + 12, cy + 12, `参照（他機能所有・計上外） ${l.referenceCount} 件`, small));
    cy += 18;
  }
  if (l.unplacedCount) {
    out.push(text(x + 12, cy + 12, `うち DFD 未配置 ${l.unplacedCount} 件`, small));
  }
  out.push('</g>');
  return out.join('');
}
