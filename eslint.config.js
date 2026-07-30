import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/**
 * Layer boundaries are enforced here, not by convention.
 *
 * `shared/` and `extension/lib/` hold pure logic: no platform globals, no I/O,
 * no ambient clock. That purity is what lets every interesting decision in this
 * product be unit-tested with plain Vitest and no Chrome mocking, and it is what
 * stops someone reaching for `chrome.storage` inside a normaliser and silently
 * breaking the Worker build a week later.
 *
 * `worker/` may not log. The privacy promise is that no request is recorded;
 * a stray `console.log(url)` would make that false, so the linter refuses it.
 */

/** Globals that must never appear in pure logic. */
const PLATFORM_GLOBALS = [
  {
    name: 'chrome',
    message: 'Pure logic must not touch chrome.* — put it in extension/platform/.',
  },
  {
    name: 'browser',
    message: 'Pure logic must not touch browser.* — put it in extension/platform/.',
  },
  { name: 'fetch', message: 'Pure logic must not perform I/O — inject a Transport instead.' },
  { name: 'window', message: 'Pure logic must not touch the DOM.' },
  { name: 'document', message: 'Pure logic must not touch the DOM.' },
  { name: 'localStorage', message: 'Pure logic must not touch storage — inject a store instead.' },
  { name: 'caches', message: 'Pure logic must not touch the Cache API.' },
  { name: 'navigator', message: 'Pure logic must not read the platform.' },
  { name: 'process', message: 'Pure logic must not read the environment.' },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.wxt/**',
      '**/.output/**',
      '**/.wrangler/**',
      'fixtures/src/companies-house/**',
      'worker/worker-configuration.d.ts',
    ],
  },

  // Node scripts and config files: plain JS rules only.
  {
    files: ['**/*.mjs', '**/*.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
  },

  // TypeScript everywhere, with type information.
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.ts', '**/*.tsx'],
  })),
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // TypeScript already catches undefined identifiers, and does it better.
      'no-undef': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // The purity boundary.
  {
    files: ['shared/src/**/*.ts', 'extension/lib/**/*.ts', 'extension/lib/**/*.tsx'],
    rules: {
      'no-restricted-globals': ['error', ...PLATFORM_GLOBALS],
    },
  },

  // The Worker keeps no record of what anyone looked up.
  {
    files: ['worker/src/**/*.ts'],
    languageOptions: { globals: globals.serviceworker },
    rules: {
      'no-console': 'error',
      // Reading a client IP is permitted in exactly one module. One careless
      // read in a log line would falsify the central claim in PRIVACY.md, so
      // this is a lint error rather than a review convention. CI greps for it
      // as well, because a lint rule can be disabled inline.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/CF-Connecting-IP/i]',
          message:
            'Client IPs may only be read in worker/src/security/throttle.ts, and only as a salted, daily-rotating hash.',
        },
      ],
    },
  },
  {
    // The one module permitted to read a client address.
    files: ['worker/src/security/throttle.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // The one module permitted to emit anything, and only aggregate counters.
    files: ['worker/src/observability/**/*.ts'],
    rules: { 'no-console': 'off' },
  },

  // Tests may reach for anything; they are the place that proves the rest cannot.
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/tests/**/*.ts'],
    rules: {
      'no-restricted-globals': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },

  prettier,
);
