import { Money } from '@arabat/money';
import { afterEach, describe, expect, it } from 'vitest';
import { commonAr, commonEn, createI18n, directionOf, flattenKeys, formatMoney } from './index.js';

afterEach(() => localStorage.clear());

describe('i18n', () => {
  it('defines the same common keys in Arabic and English', () => {
    expect(flattenKeys(commonAr).sort()).toEqual(flattenKeys(commonEn).sort());
  });

  it('maps languages to text direction', () => {
    expect(directionOf('ar')).toBe('rtl');
    expect(directionOf('en')).toBe('ltr');
  });

  it('applies lang/dir to the document and persists the choice', async () => {
    const i18n = createI18n({ namespace: 'test', resources: { ar: {}, en: {} }, language: 'ar' });
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
    await i18n.changeLanguage('en');
    expect(document.documentElement.dir).toBe('ltr');
    expect(localStorage.getItem('arabat.language')).toBe('en');
    expect(i18n.t('common:actions.retry')).toBe('Try again');
  });

  it('keeps Arabic for every plural category when only _one and _other are written', () => {
    const i18n = createI18n({
      namespace: 'test',
      resources: {
        ar: {
          sales_one: 'فاتورة واحدة',
          sales_other: '{{count}} فاتورة',
          seats_zero: 'لا مقاعد',
          seats_other: '{{count}} مقعد',
        },
        en: { sales_one: '1 sale', sales_other: '{{count}} sales' },
      },
      language: 'ar',
    });
    expect(i18n.t('sales', { count: 0 })).toBe('0 فاتورة');
    expect(i18n.t('sales', { count: 1 })).toBe('فاتورة واحدة');
    expect(i18n.t('sales', { count: 2 })).toBe('2 فاتورة');
    expect(i18n.t('sales', { count: 5 })).toBe('5 فاتورة');
    expect(i18n.t('sales', { count: 15 })).toBe('15 فاتورة');
    expect(i18n.t('seats', { count: 0 })).toBe('لا مقاعد');
  });

  it('falls back to the common namespace', () => {
    const i18n = createI18n({ namespace: 'test', resources: { ar: {}, en: {} }, language: 'ar' });
    expect(i18n.t('actions.retry')).toBe('إعادة المحاولة');
  });
});

describe('formatMoney', () => {
  it('formats KWD with three decimals without floats', () => {
    const amount = Money.parse('1234567.5', 'KWD');
    expect(formatMoney(amount, 'en')).toBe('KWD 1,234,567.500');
    expect(formatMoney(amount, 'ar')).toBe('1,234,567.500 د.ك');
    expect(formatMoney(Money.parse('-0.005', 'KWD'), 'en')).toBe('KWD -0.005');
  });
});
