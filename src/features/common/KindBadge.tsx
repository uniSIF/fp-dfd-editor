import { BADGE_COLORS } from '../../domain/dfdGeometry';
import type { FunctionKind } from '../../domain/types';
import { tokens } from '../app/theme';

type BadgeKind = FunctionKind | 'NCP' | 'EE' | 'REF';

const LABELS: Record<BadgeKind, string> = {
  ILF: 'ILF', EIF: 'EIF', EI: 'EI', EO: 'EO', EQ: 'EQ', NCP: '非計上', EE: '外部', REF: '参照',
};

/** 種別バッジ。計上されるファンクションだけが色を持つ（ui-design.md 1 章） */
export function KindBadge({ kind }: { kind: BadgeKind }) {
  const base = {
    display: 'inline-flex', alignItems: 'center', height: 16, padding: '0 5px', borderRadius: 3,
    fontSize: 11, fontWeight: 600, lineHeight: 1, whiteSpace: 'nowrap' as const,
  };
  if (kind in BADGE_COLORS) {
    return <span style={{ ...base, background: BADGE_COLORS[kind as FunctionKind], color: '#fff' }}>{LABELS[kind]}</span>;
  }
  if (kind === 'NCP') {
    return <span style={{ ...base, background: '#F1F3F5', color: tokens.textSecondary, border: `1px dashed ${tokens.borderStrong}` }}>{LABELS[kind]}</span>;
  }
  if (kind === 'EE') {
    return <span style={{ ...base, background: '#fff', color: tokens.text, border: `1px solid ${tokens.text}` }}>{LABELS[kind]}</span>;
  }
  return <span style={{ ...base, background: '#fff', color: tokens.textSecondary, border: `1px solid ${tokens.borderStrong}`, fontWeight: 400 }}>{LABELS[kind]}</span>;
}
