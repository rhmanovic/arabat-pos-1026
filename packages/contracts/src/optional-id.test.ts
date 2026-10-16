import { describe, expect, it } from 'vitest';
import { saveCategorySchema } from './catalog.js';

describe('optional references from a select', () => {
  it('reads the "—" option (empty value) as no parent category', () => {
    const v = saveCategorySchema.parse({ nameAr: 'شبسات', nameEn: 'chips', parentId: '' });
    expect(v.parentId).toBeNull();
  });

  it('still rejects a value that is not an id', () => {
    expect(
      saveCategorySchema.safeParse({ nameAr: 'شبسات', nameEn: '', parentId: 'chips' }).success,
    ).toBe(false);
  });

  it('keeps a real parent id and an omitted one', () => {
    const id = '0198f0a2-5c3e-7d41-9a3b-2f6c8e1d4b70';
    expect(saveCategorySchema.parse({ nameAr: 'أ', nameEn: '', parentId: id }).parentId).toBe(id);
    expect(saveCategorySchema.parse({ nameAr: 'أ', nameEn: '' }).parentId).toBeNull();
  });
});
