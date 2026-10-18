import { describe, expect, it } from 'vitest';
import { content } from './content.js';

describe('trial length', () => {
  it('reads as days, the way the owner writes it', () => {
    expect([1, 7, 14, 21].map(content.ar.trialLength)).toEqual([
      '1 يوم',
      '7 يوم',
      '14 يوم',
      '21 يوم',
    ]);
    expect([1, 14].map(content.en.trialLength)).toEqual(['1 day', '14 days']);
  });
});
