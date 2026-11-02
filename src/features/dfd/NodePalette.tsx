import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import type { ReactNode } from 'react';
import { BADGE_COLORS } from '../../domain/dfdGeometry';
import { tokens } from '../app/theme';
import type { AddKind } from './AddFunctionDialog';

export const PALETTE_MIME = 'application/x-fpdfd-node';

const ITEMS: { kind: AddKind | 'REF'; label: string; title: string; icon: ReactNode }[] = [
  {
    kind: 'TF', label: 'トランザクション', title: 'トランザクションファンクションを追加',
    icon: <circle cx="10" cy="10" r="8" fill="#fff" stroke={BADGE_COLORS.EI} strokeWidth="1.5" />,
  },
  {
    kind: 'NCP', label: '非計上プロセス', title: '非計上プロセスを追加',
    icon: <circle cx="10" cy="10" r="8" fill="#F1F3F5" stroke={tokens.borderStrong} strokeWidth="1.5" strokeDasharray="3 2" />,
  },
  {
    kind: 'DF', label: 'データファンクション', title: 'データファンクションを追加',
    icon: <path d="M2 5h16M2 15h16" stroke={BADGE_COLORS.ILF} strokeWidth="1.5" />,
  },
  {
    kind: 'EE', label: '外部エンティティ', title: '外部エンティティを追加',
    icon: <rect x="2" y="4" width="16" height="12" fill="#fff" stroke={tokens.text} strokeWidth="1.5" />,
  },
];

/** DFD 左上のパレット。クリックでダイアログ、ドラッグでドロップ位置に追加（ui-design.md 4.4） */
export function NodePalette({ onRequest }: { onRequest: (kind: AddKind | 'REF') => void }) {
  const button = (kind: AddKind | 'REF', label: string, title: string, icon: ReactNode) => (
    <ButtonBase
      key={kind}
      title={title}
      aria-label={title}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(PALETTE_MIME, kind);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => onRequest(kind)}
      sx={{ height: 32, justifyContent: 'flex-start', gap: 2, px: '6px', borderRadius: '3px', '&:hover': { background: tokens.primarySoft } }}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" style={{ flex: 'none' }}>{icon}</svg>
      <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{label}</span>
    </ButtonBase>
  );
  return (
    <Box
      aria-label="ノードを追加"
      role="toolbar"
      sx={{
        position: 'absolute', left: 12, top: 12, display: 'flex', flexDirection: 'column', gap: '2px', background: tokens.surface,
        border: `1px solid ${tokens.border}`, borderRadius: '6px', p: 1, boxShadow: '0 1px 2px rgba(27,31,36,0.06)', zIndex: 5,
      }}
    >
      {ITEMS.map((i) => button(i.kind, i.label, i.title, i.icon))}
      <Box component="hr" sx={{ border: 0, borderTop: `1px solid ${tokens.border}`, my: '2px', mx: 1 }} />
      {button(
        'REF', '既存を参照', '既存のデータファンクション・外部エンティティを参照配置',
        <>
          <path d="M3 10h9m0 0-3-3m3 3-3 3" stroke={tokens.textSecondary} strokeWidth="1.5" fill="none" />
          <path d="M13 5h4v10h-4" stroke={tokens.textSecondary} strokeWidth="1.5" fill="none" />
        </>,
      )}
    </Box>
  );
}
