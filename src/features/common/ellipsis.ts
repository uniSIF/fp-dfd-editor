import type { CSSProperties } from 'react';

/** 1 行に収めて「…」で省略する（ダイアログの一覧で行の高さを揃え、はみ出しを防ぐ）。flex 子要素で縮めるため minWidth: 0 を含む */
export const ellipsis = (extra: CSSProperties = {}): CSSProperties => ({
  minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left', ...extra,
});
