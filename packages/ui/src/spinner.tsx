import { cn } from './cn.js';

const SIZES = { sm: 'size-4 border-2', md: 'size-6 border-2', lg: 'size-10 border-[3px]' } as const;

export function Spinner({
  size = 'md',
  className,
  label,
}: {
  size?: keyof typeof SIZES;
  className?: string;
  label?: string;
}) {
  return (
    <span
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        'inline-block animate-spin rounded-full border-current border-e-transparent',
        SIZES[size],
        className,
      )}
    />
  );
}
