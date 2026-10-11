import { z } from 'zod';

/** The three separate applications (ADR-0001). */
export const APP_INTERFACES = ['manager', 'pos', 'platform'] as const;
export const appInterfaceSchema = z.enum(APP_INTERFACES);
export type AppInterface = z.infer<typeof appInterfaceSchema>;

export const SUPPORTED_LANGUAGES = ['ar', 'en'] as const;
export const languageSchema = z.enum(SUPPORTED_LANGUAGES);
export type Language = z.infer<typeof languageSchema>;
