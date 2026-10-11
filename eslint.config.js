import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Physical left/right utilities break RTL. Use logical ones: ms/me, ps/pe, start/end, text-start.
const PHYSICAL_DIRECTION_CLASS =
  /(^|\s|:)-?(ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|text-left|text-right)-/;

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Money must never be converted to floating point (ADR-0005).
      'no-restricted-globals': [
        'error',
        { name: 'parseFloat', message: 'Use @arabat/money for amounts.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Number', property: 'parseFloat', message: 'Use @arabat/money for amounts.' },
      ],
    },
  },
  {
    // NestJS injects constructor dependencies through decorator metadata: those imports are
    // used at runtime and must stay value imports.
    files: ['apps/api/src/**/*.ts'],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
  {
    files: [
      'apps/*-web/src/**/*.{ts,tsx}',
      'packages/{ui,web-core,i18n,api-client}/src/**/*.{ts,tsx}',
    ],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-syntax': [
        'error',
        {
          selector: `Literal[value=${PHYSICAL_DIRECTION_CLASS}]`,
          message:
            'Use logical direction utilities (ms-, me-, ps-, pe-, start-, end-, text-start) for RTL support.',
        },
        {
          selector: `TemplateElement[value.raw=${PHYSICAL_DIRECTION_CLASS}]`,
          message:
            'Use logical direction utilities (ms-, me-, ps-, pe-, start-, end-, text-start) for RTL support.',
        },
      ],
    },
  },
);
