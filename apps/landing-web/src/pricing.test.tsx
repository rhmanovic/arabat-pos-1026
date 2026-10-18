import type { PublicOffer } from '@arabat/contracts';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PricingPage } from './pricing.js';

const item = (id: string, kind: 'system' | 'device', amount: string, max = 5) => ({
  id,
  kind,
  nameAr: kind === 'system' ? 'نظام عربات POS' : `جهاز ${id}`,
  nameEn: kind === 'system' ? 'Arabat POS system' : `Device ${id}`,
  descriptionAr: null,
  descriptionEn: null,
  price: { amount, currency: 'KWD' },
  icon: kind === 'system' ? ('system' as const) : ('printer' as const),
  imageUrl: null,
  maxQuantity: max,
});
const offer: PublicOffer = {
  system: item('sys', 'system', '99.000', 1),
  devices: [item('p', 'device', '35.250', 2), item('d', 'device', '18.000')],
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear();
  // jsdom has no layout; the page scrolls each new step into view.
  Element.prototype.scrollIntoView = vi.fn();
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === 'POST')
      return Promise.resolve(
        new Response(
          JSON.stringify({
            reference: 'Q-000042',
            system: { amount: '99.000', currency: 'KWD' },
            devices: { amount: '70.500', currency: 'KWD' },
            total: { amount: '169.500', currency: 'KWD' },
          }),
          { status: 201 },
        ),
      );
    expect(url).toBe('/api/v1/public/pricing');
    return Promise.resolve(new Response(JSON.stringify(offer), { status: 200 }));
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('PricingPage', () => {
  it('walks system → devices → request with exact totals and sends only ids and quantities', async () => {
    const user = userEvent.setup();
    render(<PricingPage />);
    expect(await screen.findByText('نظامك الكامل')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'التالي: جهّز محلك' })[0]!);
    const printer = screen.getByRole('heading', { name: 'جهاز p' }).closest('li')!;
    await user.click(within(printer).getByRole('button', { name: '+ أضف' }));
    const more = within(printer).getByRole('button', { name: 'زيادة جهاز p' });
    await user.click(more);
    // The device limit (2) disables "more".
    expect(more).toBeDisabled();
    // 99.000 + 2 × 35.250 = 169.500, computed in fils.
    expect(screen.getAllByText('169.500').length).toBeGreaterThan(0);

    await user.click(screen.getAllByRole('button', { name: 'التالي: راجع طلبك' })[0]!);
    await user.type(screen.getByLabelText('اسم الشركة أو المحل'), 'مقهى السالمية');
    await user.type(screen.getByLabelText('اسمك'), 'فاطمة');
    await user.type(screen.getByLabelText('رقم الهاتف'), '+965 5555 1234');
    await user.type(screen.getByLabelText('البريد الإلكتروني'), 'f@example.com');
    await user.click(screen.getByRole('button', { name: 'أرسل الطلب' }));

    expect(await screen.findByText('وصلنا طلبك!')).toBeInTheDocument();
    expect(screen.getByText(/Q-000042/)).toBeInTheDocument();
    const [, init] = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === 'POST',
    )!;
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      companyName: 'مقهى السالمية',
      language: 'ar',
      devices: [{ itemId: 'p', quantity: 2 }],
    });
  });

  it('lets a shop skip the devices', async () => {
    const user = userEvent.setup();
    render(<PricingPage />);
    await user.click((await screen.findAllByRole('button', { name: 'التالي: جهّز محلك' }))[0]!);
    await user.click(screen.getByRole('button', { name: 'تخطَّ — عندي أجهزتي' }));
    expect(screen.getByRole('heading', { name: 'أرسل طلبك' })).toBeInTheDocument();
  });

  it('says so when prices cannot be loaded', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response('', { status: 500 })));
    render(<PricingPage />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('تعذّر تحميل الأسعار'));
  });
});
