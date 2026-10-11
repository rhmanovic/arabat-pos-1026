import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env['E2E_PORT'] ?? 3100);
const baseURL = `http://localhost:${PORT}`;

/**
 * End-to-end tests run against the production build: the API serves the three built SPAs
 * from one origin (SERVE_WEB=true) and talks to a real PostgreSQL database.
 * Prerequisites: `pnpm db:up && pnpm db:migrate && pnpm build`.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    ...(process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE']
      ? { launchOptions: { executablePath: process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE'] } }
      : {}),
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'tablet-touch', use: { ...devices['Galaxy Tab S4'] }, testMatch: /pos\.spec\.ts/ },
  ],
  webServer: {
    command: 'node --env-file-if-exists=.env --enable-source-maps apps/api/dist/main.js',
    url: `${baseURL}/api/v1/health/ready`,
    reuseExistingServer: !process.env['CI'],
    timeout: 30_000,
    env: {
      PORT: String(PORT),
      SERVE_WEB: 'true',
      LOG_LEVEL: 'warn',
      LOG_PRETTY: 'false',
      // Many sign-ins from one IP during the run; limits themselves are covered by integration tests.
      AUTH_RATE_LIMIT_SCALE: '50',
      PUBLIC_MANAGER_URL: `${baseURL}/manager`,
      PUBLIC_POS_URL: `${baseURL}/pos`,
    },
  },
});
