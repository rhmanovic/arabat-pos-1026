import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LandingPage } from './landing.js';
import { publicFetch } from './test-offer.js';

describe('LandingPage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', publicFetch());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists our apps from the platform in a navbar dropdown and in the phone menu (ADR-0117)', async () => {
    render(<LandingPage />);
    const nav = screen.getAllByRole('navigation', { name: 'primary' })[0]!;
    const toggle = await within(nav).findByRole('button', { name: 'تطبيقاتنا' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(nav).queryByRole('link', { name: /لوحة الإدارة/ })).toBeNull();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(nav).getByRole('link', { name: /لوحة الإدارة/ })).toHaveAttribute(
      'href',
      '/manager/',
    );
    const store = within(nav).getByRole('link', { name: /تطبيق آيفون/ });
    expect(store).toHaveAttribute('href', 'https://apps.apple.com/kw/app/arabat');
    expect(store).toHaveAttribute('target', '_blank');
    await userEvent.keyboard('{Escape}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(screen.getByRole('button', { name: 'فتح القائمة' }));
    const menu = screen.getByRole('dialog');
    expect(within(menu).getByText('تطبيقاتنا')).toBeInTheDocument();
    expect(within(menu).getByRole('link', { name: /الكاشير/ })).toHaveAttribute('href', '/pos/');
  });

  it('shows no apps menu when the platform lists none', async () => {
    vi.stubGlobal('fetch', publicFetch(undefined, { apps: [] }));
    render(<LandingPage />);
    await screen.findByText('99 د.ك سنوياً · تجربة مجانية 14 يوم بدون بطاقة');
    expect(screen.queryByRole('button', { name: 'تطبيقاتنا' })).toBeNull();
  });

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
