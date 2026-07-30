/**
 * The real Companies House public data API.
 *
 * Written in v0.1.0 but unexercised until a key exists. Kept deliberately thin
 * for that reason: everything interesting happens downstream of the seam and is
 * already under test, so what remains here is authentication, URL construction
 * and status mapping.
 *
 * Two rules that matter more than the code:
 *
 * **Never retry a 429.** Companies House states that applications attempting to
 * bypass the rate limit may be banned without notice, and a retry is
 * indistinguishable from an attempt. The governor upstream of this module reads
 * the budget signal and stops asking; this module simply reports.
 *
 * **Identify honestly.** A real User-Agent naming the project, its repository
 * and a contact address means Companies House can email before it bans. That
 * courtesy is the cheapest insurance this project has.
 */

import type {
  ChChargeList,
  ChCompanyProfile,
  ChFilingHistoryList,
  ChOfficerList,
  ChSearchResponse,
} from '@ltdlens/shared';
import type {
  CompaniesHouseUpstream,
  RateLimitSignal,
  UpstreamFailure,
  UpstreamResult,
} from './types.js';

const BASE = 'https://api.company-information.service.gov.uk';

const USER_AGENT = 'LtdLens/0.1.0 (+https://github.com/AmigoUK/LtdLens; dev@attv.uk)';

/** How long to wait on Companies House before giving up. */
const TIMEOUT_MS = 8_000;

/**
 * Filing history is the one call that can return hundreds of kilobytes, which
 * matters because the free Workers plan allows 10ms of CPU. Only the categories
 * the ruleset actually reads are requested.
 */
const FILING_CATEGORIES = 'accounts,address,change-of-name,insolvency,mortgage,officers';

function readNumberHeader(headers: Headers, ...names: string[]): number | undefined {
  for (const name of names) {
    const raw = headers.get(name);
    if (raw === null) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

function readRateLimit(headers: Headers): RateLimitSignal {
  const signal: RateLimitSignal = {};
  // Both spellings, because neither is contractually documented.
  const remaining = readNumberHeader(headers, 'X-Ratelimit-Remain', 'X-Ratelimit-Remaining');
  if (remaining !== undefined) signal.remaining = remaining;
  const limit = readNumberHeader(headers, 'X-Ratelimit-Limit');
  if (limit !== undefined) signal.limit = limit;
  const reset = readNumberHeader(headers, 'X-Ratelimit-Reset');
  if (reset !== undefined) signal.resetAt = reset;
  return signal;
}

function failureFor(status: number, headers: Headers): UpstreamFailure {
  if (status === 404) return { kind: 'not-found' };
  if (status === 401 || status === 403) return { kind: 'unauthorised' };
  if (status === 429) {
    const retryAfter = readNumberHeader(headers, 'Retry-After');
    return retryAfter === undefined
      ? { kind: 'rate-limited' }
      : { kind: 'rate-limited', retryAfterSeconds: retryAfter };
  }
  return { kind: 'server-error', status };
}

export function createLiveUpstream(apiKey: string): CompaniesHouseUpstream {
  // Companies House uses HTTP Basic with the key as the username and an empty
  // password. The trailing colon is required.
  const authorisation = `Basic ${btoa(`${apiKey}:`)}`;
  let lastSignal: RateLimitSignal | undefined;

  async function get<T>(path: string): Promise<UpstreamResult<T>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(`${BASE}${path}`, {
        headers: {
          Authorization: authorisation,
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
        },
        signal: controller.signal,
      });

      const signal = readRateLimit(response.headers);
      if (Object.keys(signal).length > 0) lastSignal = signal;

      if (!response.ok) {
        return { ok: false, failure: failureFor(response.status, response.headers) };
      }

      try {
        return { ok: true, data: (await response.json()) as T };
      } catch {
        return { ok: false, failure: { kind: 'malformed' } };
      }
    } catch {
      // Covers both the abort and any transport failure. Deliberately not
      // logged: the path would identify which company someone looked up.
      return { ok: false, failure: { kind: 'network' } };
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    profile: (number) => get<ChCompanyProfile>(`/company/${number}`),
    officers: (number) =>
      get<ChOfficerList>(`/company/${number}/officers?items_per_page=100&register_view=false`),
    charges: (number) => get<ChChargeList>(`/company/${number}/charges?items_per_page=100`),
    filings: (number) =>
      get<ChFilingHistoryList>(
        `/company/${number}/filing-history?items_per_page=100&category=${FILING_CATEGORIES}`,
      ),
    search: (query) =>
      get<ChSearchResponse>(`/search/companies?q=${encodeURIComponent(query)}&items_per_page=20`),
    lastRateLimit: () => lastSignal,
  };
}
