/**
 * ISO 4217 currencies supported by the platform, with their minor-unit exponent.
 * KWD (the default currency) has 3 decimal places: 1 KWD = 1000 fils.
 */
export const CURRENCIES = {
  KWD: { code: 'KWD', exponent: 3 },
  BHD: { code: 'BHD', exponent: 3 },
  OMR: { code: 'OMR', exponent: 3 },
  SAR: { code: 'SAR', exponent: 2 },
  AED: { code: 'AED', exponent: 2 },
  QAR: { code: 'QAR', exponent: 2 },
  USD: { code: 'USD', exponent: 2 },
  EUR: { code: 'EUR', exponent: 2 },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;

export const DEFAULT_CURRENCY: CurrencyCode = 'KWD';

export function isCurrencyCode(value: string): value is CurrencyCode {
  return Object.hasOwn(CURRENCIES, value);
}

export function currencyExponent(code: CurrencyCode): number {
  return CURRENCIES[code].exponent;
}
