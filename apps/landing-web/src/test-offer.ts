import type { PublicSiteApps, PublicTrialOffer, SiteAppIcon } from '@arabat/contracts';
import { vi } from 'vitest';

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
    systemNameAr: 'نظام عربات POS',
    systemNameEn: 'Arabat POS system',
    systemPrice: { amount: '99.000', currency: 'KWD' },
    devices: [device('t', true), device('p', false)],
    ...overrides,
  };
}

/** "Our apps" menu used by the tests (stands in for GET /api/v1/public/site/apps). */
export function siteApps(): PublicSiteApps {
  const app = (id: string, nameAr: string, nameEn: string, url: string, icon: SiteAppIcon) => ({
    id,
    nameAr,
    nameEn,
    descriptionAr: `وصف ${nameAr}`,
    descriptionEn: `About ${nameEn}`,
    url,
    icon,
    openInNewTab: url.startsWith('http'),
  });
  return {
    apps: [
      app('m', 'لوحة الإدارة', 'Management dashboard', '/manager/', 'dashboard'),
      app('p', 'الكاشير', 'Till', '/pos/', 'till'),
      app('i', 'تطبيق آيفون', 'iPhone app', 'https://apps.apple.com/kw/app/arabat', 'phone'),
    ],
  };
}

/** Routes a stubbed `fetch` by URL: the trial offer, the apps menu, and whatever else is given. */
export function publicFetch(
  other: (url: string, init?: RequestInit) => Response | undefined = () => undefined,
  apps: PublicSiteApps = siteApps(),
) {
  return vi.fn((url: string, init?: RequestInit) => {
    const special = other(url, init);
    if (special) return Promise.resolve(special);
    if (url === '/api/v1/public/site/apps')
      return Promise.resolve(new Response(JSON.stringify(apps), { status: 200 }));
    if (url === '/api/v1/public/trial')
      return Promise.resolve(new Response(JSON.stringify(trialOffer()), { status: 200 }));
    return Promise.resolve(new Response(null, { status: 404 }));
  });
}
