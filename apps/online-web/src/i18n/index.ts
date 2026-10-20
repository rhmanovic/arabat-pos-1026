import { createI18n } from '@arabat/i18n';
import { onlineAr } from './ar.js';
import { onlineEn } from './en.js';

export const NAMESPACE = 'online';
export const resources = { ar: onlineAr, en: onlineEn };
export const i18n = createI18n({ namespace: NAMESPACE, resources });
