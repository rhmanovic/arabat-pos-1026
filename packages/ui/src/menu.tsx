import { DropdownMenu as M } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from './cn.js';

/** Dropdown menu (keyboard navigable, RTL aware through the Direction provider). */
export function Menu({
  trigger,
  children,
  align = 'end',
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'end';
}) {
  return (
    <M.Root>
      <M.Trigger asChild>{trigger}</M.Trigger>
      <M.Portal>
        <M.Content
          align={align}
          sideOffset={6}
          className="z-50 min-w-48 rounded-md border border-border bg-surface p-1 text-sm shadow-lg"
        >
          {children}
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}

export function MenuItem({
  children,
  onSelect,
  disabled,
  tone,
}: {
  children: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  tone?: 'danger';
}) {
  return (
    <M.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-sm px-3 py-2 outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-surface-muted',
        tone === 'danger' && 'text-danger',
      )}
    >
      {children}
    </M.Item>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <M.Label className="px-3 py-2 text-xs text-fg-muted">{children}</M.Label>;
}

export function MenuSeparator() {
  return <M.Separator className="my-1 h-px bg-border" />;
}
