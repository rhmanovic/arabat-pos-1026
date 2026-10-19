import { describe, expect, it } from 'vitest';
import { Money, normalizeAmountInput, parseQuantity } from './index.js';

describe('normalizeAmountInput (what people type at the till)', () => {
  it('accepts the point, the comma, Arabic digits and separators, spaces and currency words', () => {
    const cases: [string, string][] = [
      ['0.250', '0.250'],
      ['0,250', '0.250'],
      ['٠.٢٥٠', '0.250'],
      ['٠٫٢٥٠', '0.250'],
      ['۰٫۲۵۰', '0.250'],
      [' 0.250 ', '0.250'],
      ['0.250 KWD', '0.250'],
      ['0.250 د.ك', '0.250'],
      ['د.ك 0.250', '0.250'],
      ['‏0.250‎', '0.250'],
      ['1,250.500', '1250.500'],
      ['1٬250٫500', '1250.500'],
      ['.250', '0.250'],
      ['10', '10'],
      ['', ''],
    ];
    for (const [raw, expected] of cases) expect(normalizeAmountInput(raw), raw).toBe(expected);
    expect(Money.parseInput('٠.٢٥٠', 'KWD').minor).toBe(250n);
    expect(Money.parseInput('0,250', 'KWD').minor).toBe(250n);
    expect(parseQuantity(normalizeAmountInput('٢'))).toBe(2000n);
  });

  it('still refuses what is not an amount', () => {
    expect(() => Money.parseInput('abc', 'KWD')).toThrow(/Invalid amount/);
    expect(() => Money.parseInput('1.2.3', 'KWD')).toThrow(/Invalid amount/);
    expect(() => Money.parseInput('0.2505', 'KWD')).toThrow(/decimal places/);
  });
});
