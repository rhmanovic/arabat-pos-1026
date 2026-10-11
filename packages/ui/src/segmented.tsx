import { cn } from './cn.js';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

/** Small exclusive toggle (e.g. language switch). Uses radio semantics for accessibility. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex rounded-md border border-border bg-surface p-0.5', className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-sm px-2.5 py-1 text-xs font-medium transition-colors',
            option.value === value ? 'bg-primary text-primary-fg' : 'text-fg-muted hover:text-fg',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
