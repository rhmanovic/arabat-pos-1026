import type { InputHTMLAttributes, LabelHTMLAttributes, ReactNode } from 'react';
import { useId, useState } from 'react';
import { cn } from './cn.js';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg placeholder:text-fg-subtle',
        'focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:bg-surface-muted',
        'aria-invalid:border-danger',
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-sm font-medium text-fg', className)} {...props} />;
}

export interface FieldProps {
  label: ReactNode;
  error?: ReactNode;
  hint?: ReactNode;
  children: (props: {
    id: string;
    'aria-invalid'?: true;
    'aria-describedby'?: string;
  }) => ReactNode;
  className?: string;
}

/** Label + control + hint/error, wired up with ids for accessibility. */
export function Field({ label, error, hint, children, className }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        ...(error ? { 'aria-invalid': true } : {}),
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
      })}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-fg-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** `#abc`, `abc123`, ` #ABC123 ` → `#aabbcc` / `#abc123`; anything else → null. */
export function normalizeHexColor(raw: string): string | null {
  const v = raw.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{6}$/.test(v)) return `#${v}`;
  if (/^[0-9a-f]{3}$/.test(v))
    return `#${v
      .split('')
      .map((c) => c + c)
      .join('')}`;
  return null;
}

/**
 * A colour: the swatch opens the device's picker, and the code (`#1e3a8a`) can be typed or
 * pasted (phone pickers often have no field for it). The value changes only on a valid code.
 */
export function ColorInput({
  value,
  onChange,
  id,
  disabled,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
  /** Accessible name of the swatch and the code box. */
  label: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [shown, setShown] = useState(value);
  // A new value from outside (the swatch, a reset) replaces what is being typed.
  if (shown !== value) {
    setShown(value);
    setDraft(value);
  }
  const valid = normalizeHexColor(draft) !== null;
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <input
        type="color"
        aria-label={label}
        disabled={disabled}
        value={normalizeHexColor(value) ?? '#000000'}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-14 shrink-0 cursor-pointer rounded-md border border-border bg-surface p-1 disabled:cursor-not-allowed"
      />
      <Input
        id={id}
        dir="ltr"
        aria-label={`${label} (#rrggbb)`}
        aria-invalid={!valid || undefined}
        disabled={disabled}
        className="w-32 font-mono"
        maxLength={7}
        inputMode="text"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder="#1e3a8a"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          // Six digits while typing (three would cut a longer code short); three on leaving.
          if (/^\s*#?[0-9a-f]{6}\s*$/i.test(e.target.value))
            onChange(normalizeHexColor(e.target.value)!);
        }}
        onBlur={() => {
          const hex = normalizeHexColor(draft);
          if (hex && hex !== value) onChange(hex);
          setDraft(hex ?? value);
        }}
      />
    </div>
  );
}
