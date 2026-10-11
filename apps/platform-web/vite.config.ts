import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig, loadEnv } from 'vite';

// Separate application served under /platform/ (ADR-0001). /api is proxied to the API in dev.
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
    base: '/platform/',
    plugins: [react(), tailwindcss()],
    resolve: { conditions: ['source', ...defaultClientConditions] },
    server: {
      port: 5175,
      strictPort: true,
      proxy: {
        '/api': {
          target: env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000',
          changeOrigin: false,
        },
      },
    },
    preview: { port: 5175, strictPort: true },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: true,
      // Fonts are always separate files: the CSP (font-src 'self') forbids data: URIs.
      assetsInlineLimit: (file: string) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
      rolldownOptions: {
        output: {
          // Long-term cacheable vendor chunks, separate from app code.
          codeSplitting: {
            groups: [
              { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
              { name: 'vendor', test: /node_modules[\\/]/ },
            ],
          },
        },
      },
    },
  };
});
