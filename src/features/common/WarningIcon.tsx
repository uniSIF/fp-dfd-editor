import { tokens } from '../app/theme';

/** 警告の三角アイコン（色＋形＋文言で示すための形） */
export function WarningIcon({ size = 11, color = tokens.warning }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true" style={{ flex: 'none' }}>
      <path d="M12 3 2 20h20z" />
    </svg>
  );
}

export function WarningChip({ count, title }: { count?: number; title?: string }) {
  return (
    <span
      title={title}
      style={{
        fontSize: 11, color: tokens.warning, background: tokens.warningSoft, borderRadius: 10, padding: '0 6px', height: 16,
        display: 'inline-flex', alignItems: 'center', gap: 3, fontWeight: 600, whiteSpace: 'nowrap',
      }}
    >
      <WarningIcon />
      {count}
    </span>
  );
}
