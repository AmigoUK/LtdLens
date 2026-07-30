/**
 * Chooses the upstream.
 *
 * The condition below reads `__FIXTURES_ENABLED__` **directly**, not through a
 * helper, and that is load-bearing. esbuild replaces the identifier with a
 * literal at build time, sees `if (false)`, drops the branch, and with it the
 * only reference to `./fixture.js` — so the fixture module and the entire
 * fixture package, recorded company payloads included, leave the production
 * bundle.
 *
 * Routing the check through a function defeats it completely. A function
 * containing `typeof __FIXTURES_ENABLED__ === 'undefined' ? true : ...` is
 * opaque to the bundler, so the branch stays live, the import stays, and roughly
 * forty kilobytes of fixture data ships to users — a Worker that could serve
 * invented company data if anything else ever went wrong. This was caught by
 * grepping the built bundle rather than by any test, which is why CI now greps
 * it too.
 */

import type { Config } from '../env.js';
import { createLiveUpstream } from './live.js';
import { createFixtureUpstream } from './fixture.js';
import type { CompaniesHouseUpstream, FixtureScenario } from './types.js';

/**
 * Replaced by a literal via `define` in wrangler.jsonc, and by the `defines`
 * option in vitest.config.ts. Never read through a wrapper.
 */
declare const __FIXTURES_ENABLED__: boolean;

export interface UpstreamOptions {
  scenario?: FixtureScenario;
  remaining?: number;
  latencyMs?: number;
}

export function createUpstream(
  config: Config,
  options: UpstreamOptions = {},
): CompaniesHouseUpstream {
  if (config.upstream === 'live') {
    // `apiKey` is guaranteed present when upstream is 'live' — parseEnv is the
    // only producer of a Config and sets the two together.
    return createLiveUpstream(config.apiKey!);
  }

  if (__FIXTURES_ENABLED__) {
    return createFixtureUpstream(options);
  }

  // Unreachable in production: parseEnv already refuses to boot without a key
  // there. Present so the function is total, and so this file states plainly
  // what the absence of both a key and fixtures means.
  throw new Error('No Companies House key, and fixtures are not in this build.');
}

export type { CompaniesHouseUpstream, FixtureScenario } from './types.js';
