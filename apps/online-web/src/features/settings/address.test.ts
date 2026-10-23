import { describe, expect, it } from 'vitest';
import { addressWithSlug } from './SettingsPage.js';

describe('store address preview (ADR-0136)', () => {
  it('changes the sub-domain of a store at its own host', () => {
    expect(addressWithSlug('https://store666.arabatapp.com', 'store666', 'alnoor')).toBe(
      'https://alnoor.arabatapp.com',
    );
    expect(addressWithSlug('http://shop1.localhost:3100', 'shop1', 'shop2')).toBe(
      'http://shop2.localhost:3100',
    );
  });

  it('changes the last part of the shared address', () => {
    expect(addressWithSlug('https://www.arabatapp.com/store/shop-', 'shop-', 'alnoor')).toBe(
      'https://www.arabatapp.com/store/alnoor',
    );
  });
});
