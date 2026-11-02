import TextField, { type TextFieldProps } from '@mui/material/TextField';
import { useEffect, useState } from 'react';

type Props = Omit<TextFieldProps, 'value' | 'onChange' | 'onBlur'> & {
  value: string;
  onCommit: (value: string) => void;
  /** 空文字を許可しない場合 true（空なら元の値に戻す） */
  required?: boolean;
};

/**
 * 入力中はローカルに保持し、フォーカスが外れたとき・Enter（複数行は Ctrl/Cmd+Enter）で確定する。
 * キー入力ごとに Undo 履歴が積まれないようにするため。
 */
export function CommitTextField({ value, onCommit, required, multiline, ...rest }: Props) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    const v = draft;
    if (required && !v.trim()) {
      setDraft(value);
      return;
    }
    if (v !== value) onCommit(v);
  };

  return (
    <TextField
      {...rest}
      multiline={multiline}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          commit();
          (e.target as HTMLElement).blur();
        } else if (e.key === 'Escape') {
          setDraft(value);
          (e.target as HTMLElement).blur();
        }
      }}
    />
  );
}

/** 数値入力。不正値は元に戻す */
export function CommitNumberField({
  value,
  onCommit,
  min,
  max,
  allowEmpty,
  ...rest
}: Omit<TextFieldProps, 'value' | 'onChange' | 'onBlur'> & {
  value: number | null;
  onCommit: (v: number | null) => void;
  min?: number;
  max?: number;
  allowEmpty?: boolean;
}) {
  return (
    <CommitTextField
      {...rest}
      value={value === null ? '' : String(value)}
      onCommit={(s) => {
        const t = s.trim().replace(/,/g, '');
        if (t === '' && allowEmpty) return onCommit(null);
        const n = Number(t);
        if (!Number.isFinite(n) || (min !== undefined && n < min) || (max !== undefined && n > max)) return;
        onCommit(n);
      }}
      slotProps={{ htmlInput: { inputMode: 'decimal', style: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } } }}
    />
  );
}
