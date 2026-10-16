import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
  // Per-tab state (assistant thread, chosen branch) must not leak between cases.
  sessionStorage.clear();
  localStorage.clear();
});
