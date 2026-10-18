import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

// Public landing page served at / (ADR-0113). It has no session and calls no API.
export default defineConfig(({ command }) => {
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
    server: { port: 5177, strictPort: true },
    preview: { port: 5177, strictPort: true },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: true,
      // Fonts are always separate files: the CSP (font-src 'self') forbids data: URIs.
      assetsInlineLimit: (file: string) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [{ name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ }],
          },
        },
      },
    },
  };
});
