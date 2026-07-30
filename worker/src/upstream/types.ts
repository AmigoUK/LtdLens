/**
 * The upstream seam.
 *
 * Everything downstream of this interface — normalisation, caching, coalescing,
 * the rate governor, the error contract — is exercised from day one against
 * replayed fixtures. That is the whole point of putting the seam here rather
 * than at the extension's network boundary: the day the API key arrives, the
 * only untested code is the twenty lines that add an Authorization header.
 */

import type {
  ChChargeList,
  ChCompanyProfile,
  ChFilingHistoryList,
  ChOfficerList,
  ChSearchResponse,
} from '@ltdlens/shared';

/** Why a single upstream call did not produce data. */
export type UpstreamFailure =
  | { kind: 'not-found' }
  | { kind: 'rate-limited'; retryAfterSeconds?: number }
  | { kind: 'unauthorised' }
  | { kind: 'server-error'; status: number }
  | { kind: 'network' }
  | { kind: 'malformed' };

export type UpstreamResult<T> = { ok: true; data: T } | { ok: false; failure: UpstreamFailure };

/**
 * What Companies House tells us about our remaining budget.
 *
 * The header names are **not documented** by Companies House — the official
 * rate-limiting guide describes only the 429 status. Community reports give
 * `X-Ratelimit-Remain` on the main API and `X-Ratelimit-Remaining` on the
 * document API, so both are read, case-insensitively, and their absence is
 * treated as normal rather than as an error.
 */
export interface RateLimitSignal {
  remaining?: number;
  limit?: number;
  /** Unix seconds, when the window resets. */
  resetAt?: number;
}

export interface CompaniesHouseUpstream {
  profile(number: string): Promise<UpstreamResult<ChCompanyProfile>>;
  officers(number: string): Promise<UpstreamResult<ChOfficerList>>;
  charges(number: string): Promise<UpstreamResult<ChChargeList>>;
  filings(number: string): Promise<UpstreamResult<ChFilingHistoryList>>;
  search(query: string): Promise<UpstreamResult<ChSearchResponse>>;
  /** The most recent budget signal seen, if any. */
  lastRateLimit(): RateLimitSignal | undefined;
}

/** Scenarios the fixture upstream can be told to simulate, for development. */
export type FixtureScenario = 'ok' | '429' | '500' | 'timeout' | 'partial' | 'not-found';

export function parseFixtureScenario(value: string | null): FixtureScenario {
  switch (value) {
    case '429':
    case '500':
    case 'timeout':
    case 'partial':
    case 'not-found':
      return value;
    default:
      return 'ok';
  }
}
