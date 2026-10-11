import { type VariantProps, cva } from 'class-variance-authority';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn.js';

const alertVariants = cva('flex flex-col gap-1 rounded-md border p-4 text-sm', {
  variants: {
    tone: {
      info: 'border-primary/20 bg-primary-soft text-fg',
      success: 'border-success/30 bg-success-soft text-fg',
      warning: 'border-warning/40 bg-warning-soft text-fg',
      danger: 'border-danger/30 bg-danger-soft text-fg',
    },
  },
  defaultVariants: { tone: 'info' },
});

export interface AlertProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'title'>, VariantProps<typeof alertVariants> {
  title?: ReactNode;
}

export function Alert({ tone, title, className, children, ...props }: AlertProps) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(alertVariants({ tone }), className)}
      {...props}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className="text-fg-muted">{children}</div> : null}
    </div>
  );
}

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
  {
    variants: {
      tone: {
        neutral: 'bg-surface-muted text-fg-muted',
        primary: 'bg-primary-soft text-primary',
        success: 'bg-success-soft text-success',
        warning: 'bg-warning-soft text-fg',
        danger: 'bg-danger-soft text-danger',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ tone, className, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export function StatusDot({ tone }: { tone: 'success' | 'warning' | 'danger' | 'neutral' }) {
  const color = {
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
    neutral: 'bg-fg-subtle',
  }[tone];
  return <span aria-hidden className={cn('inline-block size-2 rounded-full', color)} />;
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong p-10 text-center',
        className,
      )}
    >
      <p className="text-base font-semibold text-fg">{title}</p>
      {description ? <p className="max-w-md text-sm text-fg-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
