import { describe, expect, it } from 'vitest';
import {
  TRANSFER_COLUMNS,
  checkProductInput,
  newProductInput,
  readAmount,
  readProductRow,
  readYesNo,
} from './catalog-transfer.js';

const required = (kind: 'products' | 'categories') =>
  Object.fromEntries(TRANSFER_COLUMNS[kind].map((c) => [c.key, c.required]));

describe('Excel transfer columns (ADR-0132)', () => {
  it('takes the required columns from the save schemas, not from a hand-written list', () => {
    expect(required('products')).toMatchObject({
      id: 'no',
      nameAr: 'oneOf',
      nameEn: 'oneOf',
      category: 'no',
      price: 'yes',
      sku: 'no',
      barcodes: 'no',
      cost: 'no',
      visible: 'no',
    });
    expect(required('categories')).toMatchObject({
      nameAr: 'oneOf',
      nameEn: 'oneOf',
      parent: 'no',
      visible: 'no',
    });
  });

  it('reads amounts as KWD text with 3 decimals, yes/no in both languages', () => {
    expect(readAmount('1.25')).toBe('1.250');
    expect(readAmount('٢٫٥')).toBe('2.500');
    expect(readAmount('007')).toBe('7.000');
    expect(readAmount('1.2345')).toBeUndefined();
    expect(readAmount('')).toBeNull();
    expect(readYesNo('نعم')).toBe(true);
    expect(readYesNo('No')).toBe(false);
    expect(readYesNo('maybe')).toBeUndefined();
  });

  it('turns a row into the product the catalog saves, and its checks into cell issues', () => {
    const read = readProductRow({
      nameAr: 'قهوة',
      price: '2',
      barcodes: '1234567, 7654321',
      type: 'خدمة',
      maxPerOrder: '30',
    });
    expect(read.issues).toEqual([{ column: 'maxPerOrder', code: 'invalidNumber' }]);
    const input = newProductInput(read.values, null);
    // A service never tracks stock.
    expect(input).toMatchObject({ type: 'service', trackInventory: false });
    expect(input.variants[0]).toMatchObject({ price: '2.000', barcodes: ['1234567', '7654321'] });
    expect(checkProductInput(input)).toEqual([]);
    expect(checkProductInput(newProductInput(readProductRow({ price: '1' }).values, null))).toEqual(
      [expect.objectContaining({ column: 'nameAr', code: 'nameRequired' })],
    );
  });
});
