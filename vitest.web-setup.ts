import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom has no scrolling; the routers' scroll restoration calls it on every page change.
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;

afterEach(() => {
  cleanup();
  // Per-tab state (assistant thread, chosen branch) must not leak between cases.
  sessionStorage.clear();
  localStorage.clear();
});
