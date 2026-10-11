import { Toast as T } from 'radix-ui';
import { type ReactNode, createContext, useCallback, useContext, useState } from 'react';
import { cn } from './cn.js';

type Tone = 'success' | 'danger' | 'info';
interface ToastItem {
  id: number;
  title: ReactNode;
  description?: ReactNode;
  tone: Tone;
}

const ToastContext = createContext<((toast: Omit<ToastItem, 'id'>) => void) | null>(null);

/** Notification toasts (announced to screen readers by Radix). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((toast: Omit<ToastItem, 'id'>) => {
    setItems((current) => [...current, { ...toast, id: Date.now() + Math.random() }]);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      <T.Provider swipeDirection="right" duration={4500}>
        {children}
        {items.map((item) => (
          <T.Root
            key={item.id}
            onOpenChange={(open) =>
              !open && setItems((current) => current.filter((i) => i.id !== item.id))
            }
            className={cn(
              'rounded-md border bg-surface p-4 shadow-lg',
              item.tone === 'success' && 'border-success/40',
              item.tone === 'danger' && 'border-danger/40',
              item.tone === 'info' && 'border-border',
            )}
            data-testid="toast"
          >
            <T.Title
              className={cn('text-sm font-semibold', item.tone === 'danger' && 'text-danger')}
            >
              {item.title}
            </T.Title>
            {item.description ? (
              <T.Description className="mt-1 text-sm text-fg-muted">
                {item.description}
              </T.Description>
            ) : null}
          </T.Root>
        ))}
        <T.Viewport className="fixed bottom-4 end-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" />
      </T.Provider>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  if (!push) throw new Error('useToast must be used inside <ToastProvider>');
  return {
    success: (title: ReactNode, description?: ReactNode) =>
      push({ title, description, tone: 'success' }),
    error: (title: ReactNode, description?: ReactNode) =>
      push({ title, description, tone: 'danger' }),
    info: (title: ReactNode, description?: ReactNode) => push({ title, description, tone: 'info' }),
  };
}
