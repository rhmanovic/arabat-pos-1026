import { createI18n } from '@arabat/i18n';
import { storeAr } from './ar.js';
import { storeEn } from './en.js';

export const NAMESPACE = 'store';
export const resources = { ar: storeAr, en: storeEn };
export const i18n = createI18n({ namespace: NAMESPACE, resources });
