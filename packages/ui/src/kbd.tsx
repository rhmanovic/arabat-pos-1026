import type { ReactNode } from 'react';

/**
 * Keyboard shortcut hint inside a button. Shown only on wide screens and hidden from
 * assistive technology so the button's accessible name stays unchanged.
 */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd
      aria-hidden
      className="hidden rounded border border-current/30 px-1 font-sans text-[10px] leading-4 opacity-70 md:inline"
    >
      {children}
    </kbd>
  );
}
