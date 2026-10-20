import { useCallback, useSyncExternalStore } from 'react';

/** Light, dark or the device's choice (ADR-0127), remembered per browser. */
export type ThemeMode = 'light' | 'dark' | 'system';
const STORAGE_KEY = 'arabat.online.theme';
const listeners = new Set<() => void>();

function read(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Puts the mode on <html data-theme> (absent = follow the device). */
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
