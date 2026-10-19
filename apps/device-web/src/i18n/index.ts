import { createI18n } from '@arabat/i18n';
import { deviceAr } from './ar.js';
import { deviceEn } from './en.js';

export const NAMESPACE = 'device';
export const resources = { ar: deviceAr, en: deviceEn };
export const i18n = createI18n({ namespace: NAMESPACE, resources });
