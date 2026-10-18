import { createI18n } from '@arabat/i18n';
import { linksAr } from './ar.js';
import { linksEn } from './en.js';

export const NAMESPACE = 'links';
export const resources = { ar: linksAr, en: linksEn };
export const i18n = createI18n({ namespace: NAMESPACE, resources });
