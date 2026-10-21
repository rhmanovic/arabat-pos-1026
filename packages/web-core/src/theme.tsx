import { Icon, cn } from '@arabat/ui';
import { useCallback, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Light, dark or the device's choice (ADR-0127), shared by the online store console and
 * Business management (ADR-0131): one choice per browser for both, kept in localStorage.
 */
export type ThemeMode = 'light' | 'dark' | 'system';
const STORAGE_KEY = 'arabat.theme';
/** The online console's key before the choice was shared; still read once. */
const LEGACY_KEY = 'arabat.online.theme';
const listeners = new Set<() => void>();

function read(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Puts the mode on <html data-theme> (absent = follow the device). Call before rendering. */
export function applyTheme(mode: ThemeMode = read()) {
  const root = document.documentElement;
  if (mode === 'system') delete root.dataset['theme'];
  else root.dataset['theme'] = mode;
}

export function useThemeMode(): [ThemeMode, (mode: ThemeMode) => void] {
  const mode = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    read,
    () => 'system' as ThemeMode,
  );
  const set = useCallback((next: ThemeMode) => {
    try {
      localStorage.removeItem(LEGACY_KEY);
      if (next === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private windows may refuse storage; the choice then lasts for this visit only.
    }
    applyTheme(next);
    for (const l of listeners) l();
  }, []);
  return [mode, set];
}

/** Light, dark or the device's choice, as three small buttons (in the side menu). */
export function ThemeSwitch() {
  const { t } = useTranslation('common');
  const [mode, setMode] = useThemeMode();
  const options: { mode: ThemeMode; icon: 'sun' | 'moon' | 'system' }[] = [
    { mode: 'light', icon: 'sun' },
    { mode: 'dark', icon: 'moon' },
    { mode: 'system', icon: 'system' },
  ];
  return (
    <div
      role="group"
      aria-label={t('theme.label')}
      className="flex rounded-lg bg-surface-muted p-1"
    >
      {options.map((o) => (
        <button
          key={o.mode}
          type="button"
          aria-pressed={mode === o.mode}
          title={t(`theme.${o.mode}`)}
          onClick={() => setMode(o.mode)}
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors',
            mode === o.mode ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
          )}
        >
          <Icon name={o.icon} className="size-4" />
          <span>{t(`theme.${o.mode}`)}</span>
        </button>
      ))}
    </div>
  );
}

/** True while the media query matches (false where matchMedia is missing, e.g. tests). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = typeof window !== 'undefined' ? window.matchMedia?.(query) : undefined;
      list?.addEventListener('change', onChange);
      return () => list?.removeEventListener('change', onChange);
    },
    () => (typeof window !== 'undefined' && window.matchMedia?.(query).matches) === true,
    () => false,
  );
}
