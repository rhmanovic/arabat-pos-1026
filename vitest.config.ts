import react from '@vitejs/plugin-react';
import swc from 'unplugin-swc';
import { defaultClientConditions, defaultServerConditions, loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// NestJS needs decorator metadata, which only SWC emits during tests.
const nestSwc = () =>
  swc.vite({
    jsc: {
      parser: { syntax: 'typescript', decorators: true },
      transform: { legacyDecorator: true, decoratorMetadata: true },
      target: 'es2023',
    },
  });

export default defineConfig({
  test: {
    projects: [
      {
        // Node unit tests: shared packages and API (no database).
        plugins: [nestSwc()],
        resolve: { conditions: ['source', ...defaultServerConditions] },
        ssr: { resolve: { conditions: ['source', ...defaultServerConditions] } },
        test: {
          name: 'unit',
          environment: 'node',
          include: [
            'packages/{money,permissions,contracts}/src/**/*.test.ts',
            'apps/api/src/**/*.test.ts',
          ],
          exclude: ['**/*.int.test.ts', '**/node_modules/**'],
        },
      },
      {
        // API + PostgreSQL integration tests. Require TEST_DATABASE_URL (see docs/TESTING.md).
        plugins: [nestSwc()],
        resolve: { conditions: ['source', ...defaultServerConditions] },
        ssr: { resolve: { conditions: ['source', ...defaultServerConditions] } },
        test: {
          name: 'integration',
          environment: 'node',
          // TEST_DATABASE_* from .env (or the CI environment, which takes precedence).
          env: loadEnv('test', process.cwd(), 'TEST_'),
          include: ['apps/api/src/**/*.int.test.ts'],
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 30_000,
        },
      },
      {
        // Browser-like tests for the web apps and the shared web packages.
        plugins: [react()],
        resolve: { conditions: ['source', ...defaultClientConditions] },
        test: {
          name: 'web',
          environment: 'jsdom',
          setupFiles: ['./vitest.web-setup.ts'],
          include: [
            'apps/{manager,pos,platform,store}-web/src/**/*.test.{ts,tsx}',
            'packages/{ui,web-core,i18n,api-client}/src/**/*.test.{ts,tsx}',
          ],
        },
      },
    ],
  },
});
