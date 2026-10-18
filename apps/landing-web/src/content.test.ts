import { describe, expect, it } from 'vitest';
import { content } from './content.js';

describe('trial length in words', () => {
  it('uses weeks for whole weeks and days otherwise, with Arabic number agreement', () => {
    const ar = content.ar.trialLength;
    expect([1, 2, 3, 10, 11, 30].map(ar)).toEqual([
      'يوم واحد',
      'يومين',
      '3 أيام',
      '10 أيام',
      '11 يوم',
      '30 يوم',
    ]);
    expect([7, 14, 21, 70, 77].map(ar)).toEqual([
      'أسبوع',
      'أسبوعين',
      '3 أسابيع',
      '10 أسابيع',
      '11 أسبوع',
    ]);
    expect([1, 10, 7, 21].map(content.en.trialLength)).toEqual([
      '1 day',
      '10 days',
      '1 week',
      '3 weeks',
    ]);
  });
});
