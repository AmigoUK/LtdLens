import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

/**
 * Tests run in real workerd, with real KV emulation and a real Cache API, rather
 * than against mocks. That matters more than usual here: the cache tiers, the
 * `waitUntil` behaviour and the header handling are exactly the parts most likely
 * to behave differently in production, and exactly what a mock would paper over.
 *
 * `@cloudflare/vitest-pool-workers` 0.19 exposes a Vite plugin — `cloudflareTest`
 * — rather than the `defineWorkersConfig` helper that older documentation and
 * blog posts show. Do not "fix" this back; that export no longer exists.
 *
 * Kept as its own config rather than folded into a root Vitest `projects` block.
 * Mixing the workerd pool with a node environment in one run is the configuration
 * that produces mystifying failures, and a solo project cannot afford an evening
 * spent debugging its test runner.
 */
export default defineConfig({
  // Mirrors the `define` in wrangler.jsonc. `worker/src/upstream/index.ts` reads
  // this identifier directly so esbuild can drop the fixture branch from a
  // production build; here it must be true, because the tests run against
  // fixtures. Set through Vite's own `define` rather than a pool option, which
  // the plugin's public type does not expose.
  define: { __FIXTURES_ENABLED__: 'true' },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        // Local KV, so nothing here needs a Cloudflare account.
        kvNamespaces: ['SNAPSHOTS'],
        bindings: {
          ENVIRONMENT: 'development',
          SNAPSHOT_SCHEMA: 'v1',
        },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
  },
});
