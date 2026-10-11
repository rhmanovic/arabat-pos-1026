import { CURRENCIES } from '@arabat/money';
import { sql } from 'drizzle-orm';
import { currencies } from '../schema/currencies.schema.js';
import type { Seed } from './seed.types.js';

const NAMES: Record<keyof typeof CURRENCIES, { en: string; ar: string }> = {
  KWD: { en: 'Kuwaiti Dinar', ar: 'دينار كويتي' },
  BHD: { en: 'Bahraini Dinar', ar: 'دينار بحريني' },
  OMR: { en: 'Omani Rial', ar: 'ريال عماني' },
  SAR: { en: 'Saudi Riyal', ar: 'ريال سعودي' },
  AED: { en: 'UAE Dirham', ar: 'درهم إماراتي' },
  QAR: { en: 'Qatari Riyal', ar: 'ريال قطري' },
  USD: { en: 'US Dollar', ar: 'دولار أمريكي' },
  EUR: { en: 'Euro', ar: 'يورو' },
};

/** Reference data; safe to run in every environment and idempotent. */
export const currenciesSeed: Seed = {
  name: '001-currencies',
  environments: ['development', 'test', 'production'],
  async run(db) {
    const rows = Object.values(CURRENCIES).map((c) => ({
      code: c.code,
      exponent: c.exponent,
      nameEn: NAMES[c.code].en,
      nameAr: NAMES[c.code].ar,
    }));
    await db
      .insert(currencies)
      .values(rows)
      .onConflictDoUpdate({
        target: currencies.code,
        set: {
          exponent: sql`excluded.exponent`,
          nameEn: sql`excluded.name_en`,
          nameAr: sql`excluded.name_ar`,
        },
      });
    return `${rows.length} currencies upserted`;
  },
};
