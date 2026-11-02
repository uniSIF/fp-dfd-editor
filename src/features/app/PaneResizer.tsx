import Box from '@mui/material/Box';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { tokens } from './theme';

export const LEFT_PANE = { default: 280, min: 220, max: 560 } as const;
/** 中央の作業領域の最小幅（ui-design.md 2.1） */
const CENTER_MIN = 480;
const KEY = 'fpdfd.ui.leftPaneWidth';

function clamp(w: number, rightWidth: number): number {
  const byWindow = typeof window === 'undefined' ? LEFT_PANE.max : window.innerWidth - rightWidth - CENTER_MIN;
  return Math.round(Math.max(LEFT_PANE.min, Math.min(w, LEFT_PANE.max, byWindow)));
}

/** 左ペインの幅。ブラウザごとの利便設定として localStorage に保持する */
export function useLeftPaneWidth(rightWidth: number) {
  const [width, setWidth] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem(KEY));
      if (Number.isFinite(v) && v > 0) return v;
    } catch {
      // 読めなければ既定値
    }
    return LEFT_PANE.default;
  });
  const set = (w: number) => {
    const next = clamp(w, rightWidth);
    setWidth(next);
    try {
      localStorage.setItem(KEY, String(next));
    } catch {
      // 保存できなくても表示には影響しない
    }
  };
  // ウィンドウを狭めたときに中央領域を潰さない
  useEffect(() => {
    const onResize = () => setWidth((w) => clamp(w, rightWidth));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [rightWidth]);
  return [width, set] as const;
}

/**
 * ペインの境界をドラッグして幅を変えるつまみ（ui-design.md 2.1）。
 * ダブルクリックで既定幅、左右矢印キーで 16px ずつ（Shift で 48px）調整する。
 */
export function PaneResizer({ left, width, onResize, label }: { left: number; width: number; onResize: (w: number) => void; label: string }) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const [active, setActive] = useState(false);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    start.current = { x: e.clientX, w: width };
    e.currentTarget.setPointerCapture(e.pointerId);
    setActive(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (start.current) onResize(start.current.w + e.clientX - start.current.x);
  };
  const end = () => {
    start.current = null;
    setActive(false);
  };
  return (
    <Box
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={LEFT_PANE.min}
      aria-valuemax={LEFT_PANE.max}
      tabIndex={0}
      title="ドラッグで幅を変更（ダブルクリックで元の幅）"
      data-testid="left-pane-resizer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => onResize(LEFT_PANE.default)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 48 : 16;
        if (e.key === 'ArrowLeft') onResize(width - step);
        if (e.key === 'ArrowRight') onResize(width + step);
      }}
      sx={{
        position: 'absolute', top: 0, bottom: 0, left: left - 3, width: 7, cursor: 'col-resize', zIndex: 10, touchAction: 'none',
        '&::after': {
          content: '""', position: 'absolute', top: 0, bottom: 0, left: 2, width: 3,
          background: active ? tokens.primary : 'transparent', transition: 'background .1s',
        },
        '&:hover::after, &:focus-visible::after': { background: tokens.primary },
        '&:focus-visible': { outline: 'none', boxShadow: 'none' },
      }}
    />
  );
}
