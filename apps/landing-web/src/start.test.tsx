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

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const json = (body: unknown, status = 200) =>
      Promise.resolve(new Response(body === null ? null : JSON.stringify(body), { status }));
    if (init?.method !== 'POST') return json(trialOffer());
    if (url.endsWith('/start')) return json({ signupId: 'sid', email: 'f@example.com' }, 201);
    if (url.endsWith('/verify'))
      return json({ trialDays: 7, devices: 'waitlist', redirectTo: '/manager/' });
    return json(null, 204);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('StartPage (free-trial funnel)', () => {
  it('goes business → demo sale with e-mailed receipt → devices → account → code → trial', async () => {
    const user = userEvent.setup();
    render(<StartPage />);
    await user.click(await screen.findByRole('button', { name: /كافيه/ }));

    // Demo till with café products; totals in fils.
    await user.click(screen.getByRole('button', { name: /^لاتيه/ }));
    await user.click(screen.getByRole('button', { name: /^لاتيه/ }));
    expect(screen.getAllByText('3.000').length).toBeGreaterThan(0);
    await user.click(screen.getAllByRole('button', { name: 'ادفع' })[0]!);
    await user.type(screen.getByPlaceholderText('إيميلك'), 'f@example.com');
    await user.click(screen.getByRole('button', { name: 'أرسل' }));
    expect(await screen.findByText('أرسلنا الإيصال إلى f@example.com')).toBeInTheDocument();
    expect(posted('/demo-receipt')[0]).toMatchObject({
      email: 'f@example.com',
      businessType: 'cafe',
      lines: [{ key: 'latte', quantity: 2 }],
    });
    await user.click(screen.getByRole('button', { name: 'التالي' }));

    // Devices: one available, one not (waiting list message).
    expect(screen.getByRole('heading', { name: 'جهّز محلك' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /أبي أجهزة للتجربة/ }));
    const unavailable = screen.getByText('جهاز p').closest('li')!;
    expect(within(unavailable).getByText('غير متاح حالياً')).toBeInTheDocument();
    await user.click(within(unavailable).getByRole('button', { name: '+ أضف' }));
    expect(screen.getByRole('status')).toHaveTextContent('أضفناك لقائمة الانتظار');
    await user.click(screen.getByRole('button', { name: 'التالي' }));

    // Account: the e-mail from the receipt is kept; the trial length is the device one.
    expect(screen.getByRole('heading', { name: 'خطوة أخيرة وتبدأ تجربتك' })).toBeInTheDocument();
    expect(screen.getByLabelText('إيميلك')).toHaveValue('f@example.com');
    expect(screen.getByText(/تجربة مجانية 7 يوم، بدون بطاقة/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('اسمك'), 'فاطمة');
    await user.type(screen.getByLabelText('الرقم السري'), 'Strong-Pass-2026');
    await user.click(screen.getByRole('button', { name: 'أنشئ حسابي' }));
    expect(posted('/start')[0]).toMatchObject({
      fullName: 'فاطمة',
      email: 'f@example.com',
      businessType: 'cafe',
      devices: [{ itemId: 'p', quantity: 1 }],
    });

    expect(await screen.findByRole('heading', { name: 'تأكد من إيميلك' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('الرمز'), '123456');
    await user.click(screen.getByRole('button', { name: 'تأكيد' }));
    expect(posted('/verify')[0]).toEqual({ signupId: 'sid', code: '123456' });
    expect(
      await screen.findByRole('heading', { name: 'مبروك! تجربتك المجانية 7 يوم بدأت.' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/قائمة الانتظار للأجهزة/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ادخل لوحة التحكم' })).toHaveAttribute(
      'href',
      '/manager/',
    );
    // Anonymous funnel steps were counted.
    expect(posted('/events').map((e) => e.step)).toEqual(['business', 'demo', 'devices']);
  });

  it('starts on own devices and skips the demo', async () => {
    const user = userEvent.setup();
    render(<StartPage />);
    await user.click(await screen.findByRole('button', { name: /محل/ }));
    await user.click(screen.getByRole('button', { name: 'تخطَّ' }));
    await user.click(screen.getByRole('button', { name: /عندي أجهزتي/ }));
    await user.click(screen.getByRole('button', { name: 'التالي' }));
    expect(screen.getByText(/تجربة مجانية 14 يوم، بدون بطاقة/)).toBeInTheDocument();
  });

  it('points to sign-in when the e-mail is already registered', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      Promise.resolve(
        init?.method === 'POST' && url.endsWith('/start')
          ? new Response(JSON.stringify({ code: 'EMAIL_ALREADY_REGISTERED' }), { status: 409 })
          : new Response(init?.method === 'POST' ? null : JSON.stringify(trialOffer()), {
              status: init?.method === 'POST' ? 204 : 200,
            }),
      ),
    );
    const user = userEvent.setup();
    render(<StartPage />);
    await user.click(await screen.findByRole('button', { name: /مطعم/ }));
    await user.click(screen.getByRole('button', { name: 'تخطَّ' }));
    await user.click(screen.getByRole('button', { name: /عندي أجهزتي/ }));
    await user.click(screen.getByRole('button', { name: 'التالي' }));
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
