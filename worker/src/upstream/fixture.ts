/**
 * Fixture replay, standing in for Companies House when there is no API key.
 *
 * This is not a stub that returns happy paths. It synthesises rate-limit headers
 * so the governor is genuinely exercised, adds a little latency so the cache and
 * coalescing paths behave as they will in production, and honours a scenario
 * header so every branch of the degradation ladder is reachable from `curl` with
 * no credentials at all:
 *
 *     curl 'localhost:8787/v1/company/00445790' -H 'X-Fixture-Scenario: 429'
 *
 * Tree-shaken out of production builds by the `__FIXTURES_ENABLED__` define.
 * CI greps the built bundle for `FIXTURES_MARKER` to prove it went.
 */

import { FIXTURES_MARKER, getCompanyFixture, getSearchFixture } from '@ltdlens/fixtures';
import type {
  ChChargeList,
  ChCompanyProfile,
  ChFilingHistoryList,
  ChOfficerList,
  ChSearchResponse,
} from '@ltdlens/shared';
import type {
  CompaniesHouseUpstream,
  FixtureScenario,
  RateLimitSignal,
  UpstreamResult,
} from './types.js';

/** Referenced so the marker survives into the bundle when fixtures are enabled. */
export const MARKER = FIXTURES_MARKER;

/** Companies House allows 600 requests per five minutes. */
const SYNTHETIC_LIMIT = 600;

export interface FixtureUpstreamOptions {
  scenario?: FixtureScenario;
  /**
   * Remaining budget to report. Lets a test drive the governor into brownout or
   * lockout without waiting for 450 real requests.
   */
  remaining?: number;
  /** Synthetic latency in milliseconds. Zero in tests, non-zero in dev. */
  latencyMs?: number;
  now?: () => number;
}

function delay(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

export function createFixtureUpstream(
  options: FixtureUpstreamOptions = {},
): CompaniesHouseUpstream {
  const scenario: FixtureScenario = options.scenario ?? 'ok';
  const latencyMs = options.latencyMs ?? 0;
  const now = options.now ?? (() => Date.now());

  let remaining = options.remaining ?? SYNTHETIC_LIMIT;
  let lastSignal: RateLimitSignal | undefined;

  function recordCall(): RateLimitSignal {
    remaining = Math.max(0, remaining - 1);
    const signal: RateLimitSignal = {
      remaining,
      limit: SYNTHETIC_LIMIT,
      resetAt: Math.floor(now() / 1000) + 300,
    };
    lastSignal = signal;
    return signal;
  }

  async function respond<T>(
    data: T | undefined,
    /** Sources the `partial` scenario deliberately fails. */
    optional = false,
  ): Promise<UpstreamResult<T>> {
    await delay(latencyMs);
    recordCall();

    switch (scenario) {
      case '429':
        return { ok: false, failure: { kind: 'rate-limited', retryAfterSeconds: 300 } };
      case '500':
        return { ok: false, failure: { kind: 'server-error', status: 503 } };
      case 'timeout':
        return { ok: false, failure: { kind: 'network' } };
      case 'not-found':
        return { ok: false, failure: { kind: 'not-found' } };
      case 'partial':
        // Only the optional sources fail, so the result is a snapshot that is
        // usable but honestly incomplete — the case the flag engine's
        // not-checked path exists for.
        if (optional) return { ok: false, failure: { kind: 'server-error', status: 502 } };
        break;
      case 'ok':
        break;
    }

    return data === undefined ? { ok: false, failure: { kind: 'not-found' } } : { ok: true, data };
  }

  return {
    profile: (number) => respond<ChCompanyProfile>(getCompanyFixture(number)?.profile),
    officers: (number) => respond<ChOfficerList>(getCompanyFixture(number)?.officers, true),
    charges: (number) => respond<ChChargeList>(getCompanyFixture(number)?.charges, true),
    filings: (number) => respond<ChFilingHistoryList>(getCompanyFixture(number)?.filings, true),
    search: (query) => respond<ChSearchResponse>(getSearchFixture(query)),
    lastRateLimit: () => lastSignal,
  };
}
