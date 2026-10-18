import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LandingPage } from './landing.js';
import { trialOffer } from './test-offer.js';

describe('LandingPage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(trialOffer()), { status: 200 }))),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('has one call to action, to the pricing page, with the price and trial from the platform', async () => {
    render(<LandingPage />);
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    const hero = document.getElementById('home')!;
    expect(within(hero).getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(within(hero).getByRole('link', { name: 'أنشئ حساب وجهّز محلك' })).toHaveAttribute(
      'href',
      '/pricing',
    );
    expect(
      await within(hero).findByText('99 د.ك سنوياً · تجربة مجانية 14 يوم بدون بطاقة'),
    ).toBeInTheDocument();
    // Every big button goes to the same place; sign-in stays a small link in the header.
    for (const link of screen.getAllByRole('link', { name: 'أنشئ حساب وجهّز محلك' }))
      expect(link).toHaveAttribute('href', '/pricing');
    expect(within(hero).queryByRole('link', { name: 'تسجيل الدخول' })).toBeNull();
    expect(screen.getAllByRole('link', { name: 'تسجيل الدخول' })[0]).toHaveAttribute(
      'href',
      '/manager/',
    );
    expect(screen.getAllByRole('link', { name: 'info@arabatapp.com' })[0]).toHaveAttribute(
      'href',
      'mailto:info@arabatapp.com',
    );
  });

  it('shows the steps right after the first section', () => {
    render(<LandingPage />);
    const sections = [...document.querySelectorAll('main > section')];
    expect(sections[0]!.id).toBe('home');
    expect(
      within(sections[1] as HTMLElement).getByRole('heading', { name: 'ابدأ في ثلاث خطوات' }),
    ).toBeInTheDocument();
    for (const id of ['features', 'why', 'start'])
      expect(document.getElementById(id)).not.toBeNull();
  });

  it('switches to English (LTR) and remembers the choice', async () => {
    const { unmount } = render(<LandingPage />);
    await userEvent.click(screen.getAllByRole('button', { name: 'English' })[0]!);
    expect(document.documentElement).toHaveAttribute('dir', 'ltr');
    expect(
      screen.getAllByRole('link', { name: 'Create an account and set up your shop' }),
    ).not.toHaveLength(0);
    unmount();
    render(<LandingPage />);
    expect(screen.getAllByRole('button', { name: 'العربية' })).not.toHaveLength(0);
  });
});
