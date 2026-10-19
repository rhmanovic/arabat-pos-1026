import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

/**
 * The local-first till inside the native Arabat app (ADR-0112). The bundle is downloaded by the
 * app from /device-app/ and served from arabat://app/, so every URL is relative (`base: './'`).
 */
export default defineConfig(({ command }) => {
  if (command === 'build' && process.env.NODE_ENV && process.env.NODE_ENV !== 'production') {
    throw new Error(
      `Refusing to build with NODE_ENV=${process.env.NODE_ENV}. Remove NODE_ENV from .env.`,
    );
  }
  return {
    base: './',
    plugins: [react(), tailwindcss()],
    resolve: { conditions: ['source', ...defaultClientConditions] },
    worker: { format: 'es' },
    server: { port: 5178, strictPort: true },
    preview: { port: 5178, strictPort: true },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: false,
      // Fonts are always separate files: the CSP (font-src 'self') forbids data: URIs.
      assetsInlineLimit: (file: string) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
    },
  };
});
