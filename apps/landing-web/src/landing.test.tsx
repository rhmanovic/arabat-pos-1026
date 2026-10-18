import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { LandingPage } from './landing.js';

describe('LandingPage', () => {
  beforeEach(() => localStorage.clear());

  it('opens in Arabic (RTL) with sign-up and sign-in links to the manager app', () => {
    render(<LandingPage />);
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    const hero = document.getElementById('home')!;
    expect(within(hero).getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(within(hero).getByRole('link', { name: 'أنشئ حساب شركتك' })).toHaveAttribute(
      'href',
      '/manager/register',
    );
    expect(within(hero).getByRole('link', { name: 'تسجيل الدخول' })).toHaveAttribute(
      'href',
      '/manager/',
    );
    expect(screen.getByRole('link', { name: 'شاشة الكاشير' })).toHaveAttribute('href', '/pos/');
    expect(screen.getAllByRole('link', { name: 'info@arabatapp.com' })[0]).toHaveAttribute(
      'href',
      'mailto:info@arabatapp.com',
    );
  });

  it('shows the sections the navigation points to', () => {
    render(<LandingPage />);
    for (const id of ['home', 'features', 'why', 'start']) {
      expect(document.getElementById(id)).not.toBeNull();
    }
  });

  it('switches to English (LTR) and remembers the choice', async () => {
    const { unmount } = render(<LandingPage />);
    await userEvent.click(screen.getAllByRole('button', { name: 'English' })[0]!);
    expect(document.documentElement).toHaveAttribute('dir', 'ltr');
    expect(screen.getAllByRole('link', { name: 'Create your company account' })).not.toHaveLength(
      0,
    );
    unmount();
    render(<LandingPage />);
    expect(screen.getAllByRole('button', { name: 'العربية' })).not.toHaveLength(0);
  });
});
