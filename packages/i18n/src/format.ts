import { DEFAULT_CURRENCY, type Money } from '@arabat/money';

/**
 * Formats money for display without converting it to a floating-point number: the exact
 * decimal string is split and grouped. Digits are Latin by default (OQ-012).
 */
export function formatMoney(money: Money, language: string): string {
  const [intPart = '0', fracPart] = money.toDecimalString().replace('-', '').split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const amount = `${money.isNegative() ? '-' : ''}${grouped}${fracPart ? `.${fracPart}` : ''}`;
  const symbol =
    money.currency === DEFAULT_CURRENCY && language.startsWith('ar') ? 'د.ك' : money.currency;
  return language.startsWith('ar') ? `${amount} ${symbol}` : `${symbol} ${amount}`;
}
