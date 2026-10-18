import type { PublicTrialOffer } from '@arabat/contracts';

/** Trial offer used by the landing-page tests (stands in for GET /api/v1/public/trial). */
export function trialOffer(overrides: Partial<PublicTrialOffer> = {}): PublicTrialOffer {
  const device = (id: string, available: boolean) => ({
    id,
    kind: 'device' as const,
    nameAr: `جهاز ${id}`,
    nameEn: `Device ${id}`,
    descriptionAr: null,
    descriptionEn: null,
    price: { amount: '30.000', currency: 'KWD' },
    icon: 'tablet' as const,
    imageUrl: null,
    maxQuantity: 3,
    available,
  });
  return {
    trialDaysOwn: 14,
    trialDaysDevices: 7,
    waitlistEnabled: true,
    systemPrice: { amount: '99.000', currency: 'KWD' },
    devices: [device('t', true), device('p', false)],
    ...overrides,
  };
}
