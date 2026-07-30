import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Node environment, no jsdom, no Chrome mocking.
 *
 * That is possible because every decision lives in `lib/`, which is pure: no
 * `chrome.*`, no `fetch`, no ambient clock. ESLint enforces the boundary. The
 * `platform/` adapters are deliberately thin enough that there is nothing in them
 * worth a unit test — they are covered end to end instead.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
