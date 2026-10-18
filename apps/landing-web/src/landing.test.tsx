import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { LandingPage } from './landing.js';

describe('LandingPage', () => {
  beforeEach(() => localStorage.clear());

  it('opens in Arabic (RTL) with links to the two merchant apps', () => {
    render(<LandingPage />);
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('link', { name: 'لوحة الإدارة' })).toHaveAttribute('href', '/manager/');
    expect(screen.getByRole('link', { name: 'شاشة الكاشير' })).toHaveAttribute('href', '/pos/');
  });

  it('switches to English (LTR) and remembers the choice', async () => {
    const { unmount } = render(<LandingPage />);
    await userEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(document.documentElement).toHaveAttribute('dir', 'ltr');
    expect(screen.getByRole('link', { name: 'Management' })).toBeInTheDocument();
    unmount();
    render(<LandingPage />);
    expect(screen.getByRole('button', { name: 'العربية' })).toBeInTheDocument();
  });
});
