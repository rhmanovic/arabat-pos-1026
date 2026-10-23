import { afterEach, describe, expect, it } from 'vitest';
import { hostStore, storePath } from './address.js';

describe('store addresses (ADR-0136)', () => {
  afterEach(() => document.head.querySelector('meta[name="arabat-store"]')?.remove());

  it('builds pages under /{slug} on the shared address', () => {
    expect(hostStore()).toBeNull();
    expect(storePath('store666')).toBe('/store666');
    expect(storePath('store666', '/products?q=a')).toBe('/store666/products?q=a');
  });

  it('builds pages at the root on the store’s own sub-domain', () => {
    const meta = document.createElement('meta');
    meta.name = 'arabat-store';
    meta.content = 'store666';
    document.head.append(meta);
    expect(hostStore()).toBe('store666');
    expect(storePath('store666')).toBe('/');
    expect(storePath('store666', '/cart')).toBe('/cart');
  });
});
