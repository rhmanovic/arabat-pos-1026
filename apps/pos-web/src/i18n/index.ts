import { createI18n } from '@arabat/i18n';
import { posAr } from './ar.js';
import { posEn } from './en.js';

export const NAMESPACE = 'pos';
export const resources = { ar: posAr, en: posEn };
export const i18n = createI18n({ namespace: NAMESPACE, resources });
