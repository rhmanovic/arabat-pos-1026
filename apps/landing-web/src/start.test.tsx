import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StartPage } from './start.js';
import { trialOffer } from './test-offer.js';

let fetchMock: ReturnType<typeof vi.fn>;
const posted = (path: string) =>
  fetchMock.mock.calls
    .filter(
      (c) => String(c[0]).endsWith(path) && (c[1] as RequestInit | undefined)?.method === 'POST',
    )
    .map((c) => JSON.parse((c[1] as RequestInit).body as string));

function respond(start: () => Response) {
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method !== 'POST')
      return Promise.resolve(new Response(JSON.stringify(trialOffer()), { status: 200 }));
    if (url.endsWith('/start')) return Promise.resolve(start());
    return Promise.resolve(new Response(null, { status: 204 }));
  });
  vi.stubGlobal('fetch', fetchMock);
}

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  respond(
    () =>
      new Response(JSON.stringify({ trialDays: 7, devices: 'waitlist', redirectTo: '/manager/' }), {
        status: 201,
      }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('StartPage (free-trial funnel)', () => {
  it('goes business → choose devices → account, and opens the trial without a code', async () => {
    const user = userEvent.setup();
    render(<StartPage />);
    await user.click(await screen.findByRole('button', { name: /كافيه/ }));

    // Devices are offered straight away; "next" needs a choice, skipping is below it.
    expect(screen.getByRole('heading', { name: 'اختر أجهزتك' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'التالي' })).toBeDisabled();
    const unavailable = screen.getByRole('heading', { name: 'جهاز p' }).closest('li')!;
    expect(within(unavailable).getByText('غير متاح حالياً')).toBeInTheDocument();
    await user.click(within(unavailable).getByRole('button', { name: '+ أضف' }));
    expect(screen.getByRole('status')).toHaveTextContent('أضفناك لقائمة الانتظار');
    // The summary shows the real prices and the trial length, never a bare "free".
    const order = screen.getByRole('complementary');
    expect(within(order).getByText('نظام عربات POS')).toBeInTheDocument();
    expect(within(order).getByText('جهاز p')).toBeInTheDocument();
    expect(within(order).getByText('الأجهزة (مرة واحدة) · 1 جهاز')).toBeInTheDocument();
    expect(within(order).getByText('أسبوع')).toBeInTheDocument();
    expect(within(order).getByText('تبدأ من يوم استلام الأجهزة')).toBeInTheDocument();
    expect(within(order).getByText('129.000')).toBeInTheDocument();
    expect(within(order).queryByText('مجاناً')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'التالي' }));

    expect(screen.getByRole('heading', { name: 'خطوة أخيرة وتبدأ تجربتك' })).toBeInTheDocument();
    expect(screen.getByText(/تجربة مجانية أسبوع، بدون بطاقة/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('اسمك'), 'فاطمة');
    await user.type(screen.getByLabelText('إيميلك'), 'f@example.com');
    await user.type(screen.getByLabelText('الرقم السري'), 'Strong-Pass-2026');
    await user.click(screen.getByRole('button', { name: 'أنشئ حسابي' }));

    expect(posted('/start')[0]).toMatchObject({
      fullName: 'فاطمة',
      email: 'f@example.com',
      businessType: 'cafe',
      devices: [{ itemId: 'p', quantity: 1 }],
    });
    expect(
      await screen.findByRole('heading', { name: 'مبروك! تجربتك المجانية (أسبوع) بدأت.' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/قائمة الانتظار للأجهزة/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ادخل لوحة التحكم' })).toHaveAttribute(
      'href',
      '/manager/',
    );
    expect(posted('/events').map((e) => e.step)).toEqual(['business', 'devices']);
  });

  it('skips the devices for shops that have their own, and keeps the form when going back', async () => {
    const user = userEvent.setup();
    render(<StartPage />);
    await user.click(await screen.findByRole('button', { name: /محل/ }));
    await user.click(screen.getByRole('button', { name: 'تخطَّ، عندي أجهزتي' }));
    expect(screen.getByText(/تجربة مجانية أسبوعين، بدون بطاقة/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('اسمك'), 'Ali');
    await user.click(screen.getByRole('button', { name: 'رجوع' }));
    await user.click(screen.getByRole('button', { name: 'تخطَّ، عندي أجهزتي' }));
    expect(screen.getByLabelText('اسمك')).toHaveValue('Ali');
  });

  it('points to sign-in when the e-mail is already registered', async () => {
    respond(
      () => new Response(JSON.stringify({ code: 'EMAIL_ALREADY_REGISTERED' }), { status: 409 }),
    );
    const user = userEvent.setup();
    render(<StartPage />);
    await user.click(await screen.findByRole('button', { name: /مطعم/ }));
    await user.click(screen.getByRole('button', { name: 'تخطَّ، عندي أجهزتي' }));
    await user.type(screen.getByLabelText('اسمك'), 'Ali');
    await user.type(screen.getByLabelText('إيميلك'), 'ali@example.com');
    await user.type(screen.getByLabelText('الرقم السري'), 'Strong-Pass-2026');
    await user.click(screen.getByRole('button', { name: 'أنشئ حسابي' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('هذا الإيميل مسجّل عندنا');
    expect(within(alert).getByRole('link', { name: 'تسجيل الدخول' })).toHaveAttribute(
      'href',
      '/manager/',
    );
  });
});
