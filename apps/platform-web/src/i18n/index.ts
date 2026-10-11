import { createI18n } from '@arabat/i18n';
import { platformAr } from './ar.js';
import { platformEn } from './en.js';

export const NAMESPACE = 'platform';
export const resources = { ar: platformAr, en: platformEn };
export const i18n = createI18n({ namespace: NAMESPACE, resources });
