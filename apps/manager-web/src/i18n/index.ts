import { createI18n } from '@arabat/i18n';
import { managerAr } from './ar.js';
import { managerEn } from './en.js';

export const NAMESPACE = 'manager';
export const resources = { ar: managerAr, en: managerEn };
export const i18n = createI18n({ namespace: NAMESPACE, resources });
