import { Tabs as RTabs } from 'radix-ui';
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cn } from './cn.js';

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'min-h-20 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-primary focus:outline-none aria-invalid:border-danger',
        className,
      )}
      {...props}
    />
  );
}

/** Native select: fast, accessible and touch friendly on every device. */
export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg focus:border-primary focus:outline-none disabled:bg-surface-muted aria-invalid:border-danger',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Checkbox({
  label,
  description,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: ReactNode }) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 text-sm has-disabled:cursor-not-allowed has-disabled:opacity-60',
        className,
      )}
    >
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-primary" {...props} />
      <span>
        <span className="font-medium">{label}</span>
        {description ? <span className="block text-xs text-fg-muted">{description}</span> : null}
      </span>
    </label>
  );
}

export function Tabs({
  value,
  onValueChange,
  tabs,
  children,
}: {
  value: string;
  onValueChange: (value: string) => void;
  tabs: { value: string; label: ReactNode }[];
  children: ReactNode;
}) {
  return (
    <RTabs.Root value={value} onValueChange={onValueChange}>
      <RTabs.List className="mb-4 flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <RTabs.Trigger
            key={t.value}
            value={t.value}
            className="-mb-px border-b-2 border-transparent px-4 py-2 text-sm font-medium text-fg-muted data-[state=active]:border-primary data-[state=active]:text-primary"
          >
            {t.label}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
      {children}
    </RTabs.Root>
  );
}

export const TabPanel = RTabs.Content;
