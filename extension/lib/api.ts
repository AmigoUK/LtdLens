/**
 * The API client.
 *
 * Everything is injected — transport, cache store, clock — so this file is pure
 * and every branch below is reachable from a unit test with a stub. That is not
 * tidiness for its own sake: the interesting behaviour of this module *is* its
 * error handling, and error handling that can only be exercised by unplugging a
 * network cable does not get exercised.
 *
 * The policy the whole thing exists to implement: **never leave the reader with
 * nothing.** A failure carries an expired cache entry when one exists, and an
 * error body carries the official Companies House record, so the panel can always
 * offer either the saved report or the source.
 */

import type { CompanySnapshot, SearchResponse } from '@ltdlens/shared';
import { PATHS, isApiErrorBody, normaliseCompanyNumber } from '@ltdlens/shared';
import type { ApiFailureKind, ApiResult } from './types.js';
import type { Transport } from './transport.js';
import { numericHeader } from './transport.js';
import type { CacheEntry, Freshness } from './cache.js';
import { CACHE_CAP, cacheKey, evictionPlan, freshnessOf } from './cache.js';

/** Bumped when `CompanySnapshot` changes shape. Invalidates the local cache. */
export const CONTRACT_VERSION = 1;

export interface CacheStore {
  get(key: string): Promise<CacheEntry | undefined>;
  set(key: string, entry: CacheEntry): Promise<void>;
  keys(): Promise<{ key: string; fetchedAt: string }[]>;
  delete(keys: string[]): Promise<void>;
}

export interface ApiDeps {
  transport: Transport;
  cache: CacheStore;
  now: () => Date;
  ttlHours: number;
  maxAgeDays: number;
  /** `demo` reports its results as such, so the interface can never imply live data. */
  mode: 'live' | 'demo';
}

/** Maps a Worker error code onto the kind the interface switches on. */
function kindForCode(code: string): ApiFailureKind {
  switch (code) {
    case 'COMPANY_NOT_FOUND':
      return 'not-found';
    case 'BAD_REQUEST':
      return 'bad-request';
    case 'TOO_MANY_REQUESTS':
      return 'rate-limited';
    case 'UPSTREAM_BUDGET_EXHAUSTED':
      return 'budget-exhausted';
    case 'SERVICE_PAUSED':
      return 'paused';
    default:
      return 'upstream';
  }
}

const MESSAGES: Record<ApiFailureKind, string> = {
  offline: 'No connection. Check your network and try again.',
  timeout: 'The lookup took too long. Please try again.',
  'not-found': 'There is no company with that number on the register.',
  'bad-request': 'That does not look like a UK company number.',
  'rate-limited': 'Too many lookups at once. Please try again shortly.',
  'budget-exhausted': 'The free lookup service is busy. Please try again shortly.',
  paused: 'The lookup service is paused.',
  upstream: 'Companies House could not be reached.',
  'bad-response': 'The lookup service returned something unexpected.',
};

interface Failure {
  kind: ApiFailureKind;
  message: string;
  retryAfterSeconds?: number;
  fallbackUrl?: string;
}

/** Interprets a non-2xx response, preferring the Worker's own wording. */
function failureFrom(status: number, body: unknown, headers: Record<string, string>): Failure {
  if (isApiErrorBody(body)) {
    const failure: Failure = {
      kind: kindForCode(body.error.code),
      message: body.error.message,
    };
    const retry = body.error.retryAfter ?? numericHeader(headers, 'Retry-After');
    if (retry !== undefined) failure.retryAfterSeconds = retry;
    if (body.error.fallbackUrl !== undefined) failure.fallbackUrl = body.error.fallbackUrl;
    return failure;
  }

  // A response the Worker did not produce — a captive portal, a proxy, a broken
  // deployment. Reporting it as an upstream problem is more honest than pretending
  // to understand it.
  const kind: ApiFailureKind = status === 404 ? 'not-found' : 'upstream';
  return { kind, message: MESSAGES[kind] };
}

function ok<T>(
  data: T,
  fetchedAt: string,
  mode: ApiDeps['mode'],
  from: 'network' | 'cache',
  stale: boolean,
): ApiResult<T> {
  return {
    state: 'ok',
    data,
    // Demo data is never reported as live, whichever tier answered.
    source: mode === 'demo' ? 'demo' : from,
    fetchedAt,
    stale,
  };
}

function errorResult<T>(failure: Failure, fallback?: CacheEntry): ApiResult<T> {
  const result: ApiResult<T> = {
    state: 'error',
    kind: failure.kind,
    message: failure.message,
  };
  if (failure.retryAfterSeconds !== undefined) {
    result.retryAfterSeconds = failure.retryAfterSeconds;
  }
  if (failure.fallbackUrl !== undefined) result.fallbackUrl = failure.fallbackUrl;
  if (fallback !== undefined) {
    result.fallback = { data: fallback.snapshot as unknown as T, fetchedAt: fallback.fetchedAt };
  }
  return result;
}

export interface ApiClient {
  search(query: string): Promise<ApiResult<SearchResponse>>;
  company(number: string, options?: { refresh?: boolean }): Promise<ApiResult<CompanySnapshot>>;
}

export function createApi(deps: ApiDeps): ApiClient {
  async function request(
    path: string,
    query?: Record<string, string>,
  ): Promise<
    { ok: true; body: unknown; headers: Record<string, string> } | { ok: false; failure: Failure }
  > {
    let response;
    try {
      response = await deps.transport({ path, ...(query === undefined ? {} : { query }) });
    } catch (cause) {
      // The transport only rejects when no request could be made at all.
      const kind: ApiFailureKind =
        cause instanceof Error && cause.name === 'AbortError' ? 'timeout' : 'offline';
      return { ok: false, failure: { kind, message: MESSAGES[kind] } };
    }

    if (response.status < 200 || response.status >= 300) {
      return { ok: false, failure: failureFrom(response.status, response.body, response.headers) };
    }

    return { ok: true, body: response.body, headers: response.headers };
  }

  async function evictIfNeeded(): Promise<void> {
    const keys = await deps.cache.keys();
    const doomed = evictionPlan(keys, CACHE_CAP);
    if (doomed.length > 0) await deps.cache.delete(doomed);
  }

  return {
    async search(query) {
      const result = await request(PATHS.search, { q: query });
      if (!result.ok) return errorResult(result.failure);

      const body = result.body as Partial<SearchResponse>;
      if (!Array.isArray(body.hits)) {
        return errorResult({ kind: 'bad-response', message: MESSAGES['bad-response'] });
      }

      return ok(
        body as SearchResponse,
        body.fetchedAt ?? deps.now().toISOString(),
        deps.mode,
        'network',
        false,
      );
    },

    async company(rawNumber, options = {}) {
      const number = normaliseCompanyNumber(rawNumber);
      if (number === undefined) {
        return errorResult({ kind: 'bad-request', message: MESSAGES['bad-request'] });
      }

      const key = cacheKey(number);
      const cached = await deps.cache.get(key);
      const freshness: Freshness | undefined =
        cached === undefined
          ? undefined
          : freshnessOf(cached, deps.now(), deps.ttlHours, deps.maxAgeDays, CONTRACT_VERSION);

      // A fresh hit answers without touching the network at all.
      if (cached !== undefined && freshness === 'fresh' && options.refresh !== true) {
        return ok(cached.snapshot, cached.fetchedAt, deps.mode, 'cache', false);
      }

      const result = await request(`${PATHS.company}/${number}`);

      if (!result.ok) {
        // Anything still usable is offered rather than discarded. `expired` is
        // excluded: past thirty days, or from an older contract, a snapshot is
        // more likely to mislead than to help.
        const usable = cached !== undefined && freshness === 'stale' ? cached : undefined;
        return errorResult(result.failure, usable);
      }

      const snapshot = result.body as Partial<CompanySnapshot>;
      if (typeof snapshot.number !== 'string' || typeof snapshot.fetchedAt !== 'string') {
        // Malformed, but a usable cache entry beats an error.
        const usable = cached !== undefined && freshness !== 'expired' ? cached : undefined;
        return errorResult({ kind: 'bad-response', message: MESSAGES['bad-response'] }, usable);
      }

      const entry: CacheEntry = {
        snapshot: snapshot as CompanySnapshot,
        fetchedAt: snapshot.fetchedAt,
        contractVersion: CONTRACT_VERSION,
      };
      await deps.cache.set(key, entry);
      await evictIfNeeded();

      return ok(entry.snapshot, entry.fetchedAt, deps.mode, 'network', false);
    },
  };
}
