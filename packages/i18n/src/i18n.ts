import { type Language, SUPPORTED_LANGUAGES } from '@arabat/contracts';
import i18next, { type i18n as I18nInstance, type Resource } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { commonAr } from './locales/ar.js';
import { commonEn } from './locales/en.js';

export const LANGUAGE_STORAGE_KEY = 'arabat.language';
/** Engineering default pending owner decision OQ-001. */
export const DEFAULT_LANGUAGE: Language = 'ar';

export type Direction = 'rtl' | 'ltr';

export function directionOf(language: string): Direction {
  return language.startsWith('ar') ? 'rtl' : 'ltr';
}

export function isSupportedLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

export function readStoredLanguage(): Language {
  try {
    const stored = globalThis.localStorage?.getItem(LANGUAGE_STORAGE_KEY);
    return isSupportedLanguage(stored) ? stored : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

/** Sets `<html lang dir>` so the whole layout mirrors for Arabic (ADR-0014). */
export function applyDocumentLanguage(language: string): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = language;
  document.documentElement.dir = directionOf(language);
}

export interface CreateI18nOptions {
  /** App-specific namespace, e.g. "manager", with resources per language. */
  namespace: string;
  resources: Record<Language, Record<string, unknown>>;
  language?: Language;
}

/** Creates an isolated i18next instance with the shared "common" namespace plus the app's own. */
export function createI18n(options: CreateI18nOptions): I18nInstance {
  const resources: Resource = {
    ar: { common: commonAr, [options.namespace]: options.resources.ar },
    en: { common: commonEn, [options.namespace]: options.resources.en },
  };
  const instance = i18next.createInstance();
  const language = options.language ?? readStoredLanguage();
  void instance.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: 'en',
    supportedLngs: [...SUPPORTED_LANGUAGES],
    ns: ['common', options.namespace],
    defaultNS: options.namespace,
    fallbackNS: 'common',
    interpolation: { escapeValue: false },
    initAsync: false,
    returnNull: false,
  });
  applyDocumentLanguage(language);
  instance.on('languageChanged', (lng) => {
    applyDocumentLanguage(lng);
    try {
      globalThis.localStorage?.setItem(LANGUAGE_STORAGE_KEY, lng);
    } catch {
      // Storage may be unavailable (private mode); the language still applies for this session.
    }
  });
  return instance;
}

/** Recursively lists dotted keys, used to verify that both languages define the same strings. */
export function flattenKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    flattenKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}
