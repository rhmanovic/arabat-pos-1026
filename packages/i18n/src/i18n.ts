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

const ARABIC_PLURAL_FORMS = ['zero', 'two', 'few', 'many'] as const;

/**
 * Arabic has six plural categories; i18next looks up exactly one (`key_zero` for 0, `key_two`
 * for 2, `key_few` for 3–10, `key_many` for 11–99) and, when it is missing, falls back to the
 * English string rather than to `key_other`. Strings written with only `_one` and `_other`
 * therefore showed up in English for 0, 2, 3… items. Every missing category is completed
 * from `_other` here; a string that spells a category out keeps it.
 */
export function completeArabicPlurals<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) out[key] = completeArabicPlurals(child);
  for (const key of Object.keys(out)) {
    if (!key.endsWith('_other')) continue;
    const base = key.slice(0, -'_other'.length);
    for (const form of ARABIC_PLURAL_FORMS) out[`${base}_${form}`] ??= out[key];
  }
  return out as T;
}

/** Creates an isolated i18next instance with the shared "common" namespace plus the app's own. */
export function createI18n(options: CreateI18nOptions): I18nInstance {
  const resources: Resource = {
    ar: completeArabicPlurals({ common: commonAr, [options.namespace]: options.resources.ar }),
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
