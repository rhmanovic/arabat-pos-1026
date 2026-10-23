import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defaultClientConditions, defineConfig, loadEnv } from 'vite';

// Public landing site (ADR-0113): the home page at / and the pricing page at /pricing (ADR-0114).
// No session; the pricing page reads the public pricing API. /api is proxied to the API in dev.
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, '../..', 'VITE_');
  // Vite copies NODE_ENV from .env files into process.env; a non-production value would
  // silently bundle React's development build. Never allow that for `vite build`.
  if (command === 'build' && process.env.NODE_ENV && process.env.NODE_ENV !== 'production') {
    throw new Error(
      `Refusing to build with NODE_ENV=${process.env.NODE_ENV}. Remove NODE_ENV from .env.`,
    );
  }
  return {
    base: '/',
    plugins: [react(), tailwindcss()],
    resolve: { conditions: ['source', ...defaultClientConditions] },
    server: {
      port: 5179,
      strictPort: true,
      proxy: {
        '/api': {
          target: env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000',
          changeOrigin: false,
        },
      },
    },
    preview: { port: 5179, strictPort: true },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: true,
      // Fonts are always separate files: the CSP (font-src 'self') forbids data: URIs.
      assetsInlineLimit: (file: string) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
      rolldownOptions: {
        input: {
          index: fileURLToPath(new URL('./index.html', import.meta.url)),
          pricing: fileURLToPath(new URL('./pricing.html', import.meta.url)),
          start: fileURLToPath(new URL('./start.html', import.meta.url)),
        },
        output: {
          codeSplitting: {
            groups: [{ name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ }],
          },
        },
      },
    },
  };
});
