import { defineConfig, globalIgnores } from 'eslint/config'
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

export default defineConfig([
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'coverage/**',
    'node_modules/**',
    'next-env.d.ts',
    '.probe/**',
    'playwright-report/**',
    'test-results/**',
  ]),
  ...nextCoreWebVitals,
  ...nextTs,
  {
    // `eslint-plugin-react` resolves the React version by calling
    // `context.getFilename()`, which ESLint 10 removed — its "detect" path
    // therefore throws before any rule runs. Pinning the version explicitly
    // short-circuits detection and keeps the react/* rules working.
    settings: {
      react: { version: '19.3' },
    },
  },
  {
    rules: {
      // The API layer mirrors Technitium's own camelCase field names verbatim,
      // so forcing snake/kebab casing on those identifiers would only add noise.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Dev-only probe scripts are plain Node ESM, and the test trees need console
    // assertions plus JSX files that are never part of the app bundle.
    files: ['scripts/**/*.mjs', 'playwright/**/*.ts', 'e2e/**/*.ts', 'tests/**/*.ts', 'tests/**/*.tsx'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      // A test names its subject in prose; the react-hooks rules assume a
      // component body and produce noise on render helpers in `tests/dom/utils`.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
])
