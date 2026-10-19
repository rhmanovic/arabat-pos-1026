import type { PublicOffer } from '@arabat/contracts';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PricingPage } from './pricing.js';
import { publicFetch } from './test-offer.js';

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
let startResponse: () => Response;
beforeEach(() => {
  localStorage.clear();
  // jsdom has no layout; the page scrolls each new step into view.
  Element.prototype.scrollIntoView = vi.fn();
  startResponse = () =>
    new Response(JSON.stringify({ trialDays: 7, devices: 'pending', redirectTo: '/manager/' }), {
      status: 201,
    });
  fetchMock = publicFetch((url, init) => {
    if (init?.method === 'POST') {
      expect(url).toBe('/api/v1/public/trial/start');
      return startResponse();
    }
    if (url === '/api/v1/public/pricing')
      return new Response(JSON.stringify(offer), { status: 200 });
    return undefined;
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
const sent = () => {
  const [, init] = fetchMock.mock.calls.find(
    (c) => (c[1] as RequestInit | undefined)?.method === 'POST',
  )!;
  return JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
};

describe('PricingPage', () => {
  it('walks system → devices → account with exact totals, opens the trial and says مبروك', async () => {
    const user = userEvent.setup();
    render(<PricingPage />);
    expect(await screen.findByText('نظامك الكامل')).toBeInTheDocument();
    // Trial length from the platform under the first payment (own devices: 14 days).
    expect(await screen.findAllByText('✓ تجربة مجانية 14 يوم بدون بطاقة')).toHaveLength(1);

    // The business type comes first: going on without it says so.
    await user.click(screen.getAllByRole('button', { name: 'التالي: جهّز محلك' })[0]!);
    expect(screen.getByRole('alert')).toHaveTextContent('اختر نوع نشاطك');
    await user.click(screen.getByRole('button', { name: /كافيه/ }));
    await user.click(screen.getAllByRole('button', { name: 'التالي: جهّز محلك' })[0]!);
    const printer = screen.getByRole('heading', { name: 'جهاز p' }).closest('li')!;
    await user.click(within(printer).getByRole('button', { name: '+ أضف' }));
    const more = within(printer).getByRole('button', { name: 'زيادة جهاز p' });
    await user.click(more);
    // The device limit (2) disables "more".
    expect(more).toBeDisabled();
    // 99.000 + 2 × 35.250 = 169.500, computed in fils.
    expect(screen.getAllByText('169.500').length).toBeGreaterThan(0);
    // With devices the platform's device trial length applies (7 days).
    expect(screen.getAllByText('✓ تجربة مجانية 7 يوم بدون بطاقة')).toHaveLength(1);

    await user.click(screen.getAllByRole('button', { name: 'التالي: راجع طلبك' })[0]!);
    expect(screen.queryByLabelText(/ملاحظات/)).toBeNull();
    expect(screen.getByLabelText('اسم المحل (اختياري)')).not.toBeRequired();
    await user.type(screen.getByLabelText('اسمك'), 'فاطمة');
    await user.type(screen.getByLabelText('رقم الهاتف'), '+965 5555 1234');
    await user.type(screen.getByLabelText('البريد الإلكتروني'), 'f@example.com');
    await user.type(screen.getByLabelText('الرقم السري لحسابك'), 'Strong-Pass-2026');
    await user.click(screen.getByRole('button', { name: 'أرسل الطلب' }));

    expect(
      await screen.findByRole('heading', { name: 'مبروك! تجربتك المجانية 7 يوم بدأت.' }),
    ).toBeInTheDocument();
    // Only the congratulations card stays: no hero, steps or FAQ.
    expect(screen.queryByText(/سعر واحد واضح/)).toBeNull();
    expect(screen.queryByText('أسئلة شائعة')).toBeNull();
    expect(screen.getByRole('link', { name: 'ادخل لوحة التحكم' })).toHaveAttribute(
      'href',
      '/manager/',
    );
    expect(sent()).toMatchObject({
      fullName: 'فاطمة',
      email: 'f@example.com',
      password: 'Strong-Pass-2026',
      phone: '+965 5555 1234',
      businessType: 'cafe',
      companyName: '',
      language: 'ar',
      devices: [{ itemId: 'p', quantity: 2 }],
    });
  });

  it('points to sign-in when the e-mail is already registered', async () => {
    startResponse = () =>
      new Response(JSON.stringify({ code: 'EMAIL_ALREADY_REGISTERED' }), { status: 409 });
    const user = userEvent.setup();
    render(<PricingPage />);
    await user.click(await screen.findByRole('button', { name: /مطعم/ }));
    await user.click(screen.getAllByRole('button', { name: 'التالي: جهّز محلك' })[0]!);
    await user.click(screen.getByRole('button', { name: 'تخطَّ — عندي أجهزتي' }));
    await user.type(screen.getByLabelText('اسمك'), 'Ali');
    await user.type(screen.getByLabelText('رقم الهاتف'), '+965 5555 1234');
    await user.type(screen.getByLabelText('البريد الإلكتروني'), 'a@example.com');
    await user.type(screen.getByLabelText('الرقم السري لحسابك'), 'Strong-Pass-2026');
    await user.click(screen.getByRole('button', { name: 'أرسل الطلب' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('هذا الإيميل مسجّل عندنا');
    expect(within(alert).getByRole('link', { name: 'تسجيل الدخول' })).toHaveAttribute(
      'href',
      '/manager/',
    );
  });

  it('keeps what was typed in the form when going back to the devices', async () => {
    const user = userEvent.setup();
    render(<PricingPage />);
    await user.click(await screen.findByRole('button', { name: /كافيه/ }));
    await user.click(screen.getAllByRole('button', { name: 'التالي: جهّز محلك' })[0]!);
    await user.click(screen.getByRole('button', { name: 'تخطَّ — عندي أجهزتي' }));
    await user.type(screen.getByLabelText('اسم المحل (اختياري)'), 'مقهى السالمية');
    await user.type(screen.getByLabelText('البريد الإلكتروني'), 'f@example.com');
    await user.click(screen.getByRole('button', { name: 'رجوع للأجهزة' }));
    const printer = screen.getByRole('heading', { name: 'جهاز p' }).closest('li')!;
    await user.click(within(printer).getByRole('button', { name: '+ أضف' }));
    await user.click(screen.getAllByRole('button', { name: 'التالي: راجع طلبك' })[0]!);
    expect(screen.getByLabelText('اسم المحل (اختياري)')).toHaveValue('مقهى السالمية');
    expect(screen.getByLabelText('البريد الإلكتروني')).toHaveValue('f@example.com');
  });

  it('lets a shop skip the devices', async () => {
    const user = userEvent.setup();
    render(<PricingPage />);
    await user.click(await screen.findByRole('button', { name: /كافيه/ }));
    await user.click(screen.getAllByRole('button', { name: 'التالي: جهّز محلك' })[0]!);
    await user.click(screen.getByRole('button', { name: 'تخطَّ — عندي أجهزتي' }));
    expect(screen.getByRole('heading', { name: 'أرسل طلبك' })).toBeInTheDocument();
  });

  it('says so when prices cannot be loaded', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response('', { status: 500 })));
    render(<PricingPage />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('تعذّر تحميل الأسعار'));
  });
});
