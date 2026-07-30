/**
 * The Worker's environment, and the single place that decides whether upstream
 * is the real Companies House API or the fixture replay.
 *
 * That decision is one line — no key, no live upstream — with three guards
 * around it so fixture data can never reach a real user:
 *
 *   1. `parseEnv` throws at boot when production has no key.
 *   2. Every fixture response carries `X-LtdLens-Upstream: fixture`.
 *   3. Production builds define `__FIXTURES_ENABLED__` false, so the fixture
 *      module and the fixture package are tree-shaken out of the bundle. CI
 *      greps the built output for the marker to prove it.
 */

/** Set by `define` in wrangler.jsonc. False in production builds. */
declare const __FIXTURES_ENABLED__: boolean;

export interface Env {
  /** Cache for company snapshots and the rate table. Never search queries. */
  SNAPSHOTS: KVNamespace;

  ENVIRONMENT: 'development' | 'staging' | 'production';
  SNAPSHOT_SCHEMA: string;

  /** Companies House REST API key. Absent in development. */
  CH_API_KEY?: string;
  /** Salt for the per-client throttle hash. Arrives with the throttle in v0.1.1. */
  IP_SALT?: string;
}

export type UpstreamMode = 'live' | 'fixture';

export interface Config {
  environment: Env['ENVIRONMENT'];
  upstream: UpstreamMode;
  schema: string;
  apiKey?: string;
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export function fixturesEnabled(): boolean {
  // Guarded because the define is absent when the module is loaded outside a
  // Worker build, e.g. by a unit test importing it directly.
  return typeof __FIXTURES_ENABLED__ === 'undefined' ? true : __FIXTURES_ENABLED__;
}

export function parseEnv(env: Env): Config {
  const environment = env.ENVIRONMENT ?? 'development';
  const key = env.CH_API_KEY?.trim();
  const hasKey = key !== undefined && key.length > 0;

  if (environment === 'production' && !hasKey) {
    // Refusing to boot is the point. A production Worker quietly serving
    // fixture data would be indistinguishable from working, and it would be
    // telling users things about companies that are not true.
    throw new ConfigurationError(
      'CH_API_KEY is required in production. Set it with `wrangler secret put CH_API_KEY --env production`.',
    );
  }

  if (hasKey) {
    return { environment, upstream: 'live', schema: env.SNAPSHOT_SCHEMA ?? 'v1', apiKey: key };
  }

  if (!fixturesEnabled()) {
    throw new ConfigurationError(
      'No CH_API_KEY and fixtures are compiled out of this build. There is no upstream to use.',
    );
  }

  return { environment, upstream: 'fixture', schema: env.SNAPSHOT_SCHEMA ?? 'v1' };
}
