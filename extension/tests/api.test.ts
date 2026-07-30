/**
 * The API client, exercised through injected stubs.
 *
 * No msw, no service worker mock, no network. That is the entire payoff of taking
 * a `Transport` rather than calling `fetch`: the interesting behaviour of this
 * module is its error handling, and error handling that can only be reached by
 * unplugging a network cable does not get tested.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { PATHS } from '@ltdlens/shared';
import type { CompanySnapshot } from '@ltdlens/shared';
import { CONTRACT_VERSION, createApi } from '../lib/api.js';
import type { CacheStore } from '../lib/api.js';
import type { Transport, TransportResponse } from '../lib/transport.js';
import type { CacheEntry } from '../lib/cache.js';
import { cacheKey } from '../lib/cache.js';

const NOW = new Date('2026-07-30T12:00:00Z');

function snapshot(overrides: Partial<CompanySnapshot> = {}): CompanySnapshot {
  return {
    schema: 1,
    number: '00445790',
    name: 'TESCO PLC',
    status: 'active',
    sicCodes: [],
    registeredOffice: { inDispute: false, undeliverable: false },
    accounts: { overdue: false, hasEverFiled: true },
    confirmationStatement: { overdue: false },
    officers: { activeCount: 4, resignedCount: 0, appointedLast6m: 0, resignedLast6m: 0 },
    charges: { outstanding: 0, satisfied: 0, partSatisfied: 0 },
    recentFilings: [],
    previousNames: [],
    hasInsolvencyHistory: false,
    sources: { profile: 'ok', officers: 'ok', charges: 'ok', filings: 'ok' },
    partial: false,
    fetchedAt: NOW.toISOString(),
    ...overrides,
  };
}

/** An in-memory cache, so nothing here needs chrome.storage. */
function memoryCache(
  seed: Record<string, CacheEntry> = {},
): CacheStore & { data: Map<string, CacheEntry> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    get: (key) => Promise.resolve(data.get(key)),
    set: (key, entry) => {
      data.set(key, entry);
      return Promise.resolve();
    },
    keys: () =>
      Promise.resolve(
        [...data.entries()].map(([key, entry]) => ({ key, fetchedAt: entry.fetchedAt })),
      ),
    delete: (keys) => {
      for (const key of keys) data.delete(key);
      return Promise.resolve();
    },
  };
}

function transportOf(responses: TransportResponse | TransportResponse[] | Error): {
  transport: Transport;
  calls: string[];
} {
  const calls: string[] = [];
  const queue = Array.isArray(responses) ? [...responses] : undefined;

  const transport: Transport = (request) => {
    calls.push(request.path);
    if (responses instanceof Error) return Promise.reject(responses);
    const next = queue === undefined ? (responses as TransportResponse) : queue.shift();
    if (next === undefined) throw new Error('transport called more times than expected');
    return Promise.resolve(next);
  };

  return { transport, calls };
}

const ok = (body: unknown, headers: Record<string, string> = {}): TransportResponse => ({
  status: 200,
  body,
  headers,
});

function apiWith(
  transport: Transport,
  cache: CacheStore,
  overrides: { mode?: 'live' | 'demo'; ttlHours?: number; maxAgeDays?: number } = {},
) {
  return createApi({
    transport,
    cache,
    now: () => NOW,
    ttlHours: overrides.ttlHours ?? 12,
    maxAgeDays: overrides.maxAgeDays ?? 30,
    mode: overrides.mode ?? 'live',
  });
}

let cache: ReturnType<typeof memoryCache>;

beforeEach(() => {
  cache = memoryCache();
});

describe('company', () => {
  it('fetches and caches a snapshot', async () => {
    const { transport, calls } = transportOf(ok(snapshot()));
    const result = await apiWith(transport, cache).company('00445790');

    expect(result.state).toBe('ok');
    if (result.state !== 'ok') return;
    expect(result.data.name).toBe('TESCO PLC');
    expect(result.source).toBe('network');
    expect(calls).toEqual([`${PATHS.company}/00445790`]);
    expect(cache.data.get(cacheKey('00445790'))).toBeDefined();
  });

  it('normalises the number before asking', async () => {
    const { transport, calls } = transportOf(ok(snapshot()));
    await apiWith(transport, cache).company('445790');
    expect(calls).toEqual([`${PATHS.company}/00445790`]);
  });

  it('rejects an impossible number without a request', async () => {
    const { transport, calls } = transportOf(ok(snapshot()));
    const result = await apiWith(transport, cache).company('nonsense');

    expect(result.state).toBe('error');
    if (result.state !== 'error') return;
    expect(result.kind).toBe('bad-request');
    // No point spending a slice of a shared rate limit on something that cannot
    // be a company number.
    expect(calls).toEqual([]);
  });

  it('serves a fresh cache hit without touching the network', async () => {
    const seeded = memoryCache({
      [cacheKey('00445790')]: {
        snapshot: snapshot(),
        fetchedAt: NOW.toISOString(),
        contractVersion: CONTRACT_VERSION,
      },
    });
    const { transport, calls } = transportOf(ok(snapshot()));
    const result = await apiWith(transport, seeded).company('00445790');

    expect(result.state).toBe('ok');
    if (result.state === 'ok') expect(result.source).toBe('cache');
    expect(calls).toEqual([]);
  });

  it('refetches when explicitly refreshed', async () => {
    const seeded = memoryCache({
      [cacheKey('00445790')]: {
        snapshot: snapshot(),
        fetchedAt: NOW.toISOString(),
        contractVersion: CONTRACT_VERSION,
      },
    });
    const { transport, calls } = transportOf(ok(snapshot()));
    await apiWith(transport, seeded).company('00445790', { refresh: true });
    expect(calls).toHaveLength(1);
  });

  it('ignores a cache entry from an older contract', async () => {
    // An older snapshot may be missing a field a rule needs, and a rule reading an
    // absent field would report "not checked" for every company.
    const seeded = memoryCache({
      [cacheKey('00445790')]: {
        snapshot: snapshot(),
        fetchedAt: NOW.toISOString(),
        contractVersion: CONTRACT_VERSION - 1,
      },
    });
    const { transport, calls } = transportOf(ok(snapshot()));
    await apiWith(transport, seeded).company('00445790');
    expect(calls).toHaveLength(1);
  });

  it('reports a company that is not on the register', async () => {
    const { transport } = transportOf({
      status: 404,
      body: {
        error: {
          code: 'COMPANY_NOT_FOUND',
          message: 'There is no company with that number on the register.',
          fallbackUrl: 'https://example.invalid/company/99999999',
        },
      },
      headers: {},
    });

    const result = await apiWith(transport, cache).company('99999999');
    expect(result.state).toBe('error');
    if (result.state !== 'error') return;
    expect(result.kind).toBe('not-found');
    // Even a not-found leaves a way forward.
    expect(result.fallbackUrl).toBe('https://example.invalid/company/99999999');
  });

  it('carries a Retry-After through from the body or the header', async () => {
    const fromBody = await apiWith(
      transportOf({
        status: 503,
        body: { error: { code: 'UPSTREAM_BUDGET_EXHAUSTED', message: 'Busy.', retryAfter: 120 } },
        headers: {},
      }).transport,
      cache,
    ).company('00445790');
    expect(fromBody.state === 'error' && fromBody.retryAfterSeconds).toBe(120);

    const fromHeader = await apiWith(
      transportOf({
        status: 503,
        body: { error: { code: 'UPSTREAM_BUDGET_EXHAUSTED', message: 'Busy.' } },
        // Header casing is not guaranteed anywhere, so the read is insensitive.
        headers: { 'retry-after': '90' },
      }).transport,
      cache,
    ).company('00445790');
    expect(fromHeader.state === 'error' && fromHeader.retryAfterSeconds).toBe(90);
  });

  it('maps each Worker error code to a distinct kind', async () => {
    const cases: [string, string][] = [
      ['BAD_REQUEST', 'bad-request'],
      ['TOO_MANY_REQUESTS', 'rate-limited'],
      ['UPSTREAM_BUDGET_EXHAUSTED', 'budget-exhausted'],
      ['SERVICE_PAUSED', 'paused'],
      ['UPSTREAM_UNAVAILABLE', 'upstream'],
    ];

    for (const [code, kind] of cases) {
      const { transport } = transportOf({
        status: 500,
        body: { error: { code, message: 'x' } },
        headers: {},
      });
      const result = await apiWith(transport, memoryCache()).company('00445790');
      expect(result.state === 'error' && result.kind).toBe(kind);
    }
  });

  it('reports a transport rejection as offline', async () => {
    const { transport } = transportOf(new Error('network down'));
    const result = await apiWith(transport, cache).company('00445790');
    expect(result.state === 'error' && result.kind).toBe('offline');
  });

  it('reports an abort as a timeout rather than as offline', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    const { transport } = transportOf(abort);
    const result = await apiWith(transport, cache).company('00445790');
    expect(result.state === 'error' && result.kind).toBe('timeout');
  });

  it('offers a stale cache entry when the lookup fails', async () => {
    // The rule this whole module exists to implement: never leave the reader with
    // nothing. A three-week-old report beats an error screen, with its age shown.
    const twoDaysAgo = new Date(NOW.getTime() - 2 * 86_400_000).toISOString();
    const seeded = memoryCache({
      [cacheKey('00445790')]: {
        snapshot: snapshot({ fetchedAt: twoDaysAgo }),
        fetchedAt: twoDaysAgo,
        contractVersion: CONTRACT_VERSION,
      },
    });

    const { transport } = transportOf(new Error('network down'));
    const result = await apiWith(transport, seeded).company('00445790');

    expect(result.state).toBe('error');
    if (result.state !== 'error') return;
    expect(result.fallback?.fetchedAt).toBe(twoDaysAgo);
  });

  it('does not offer an expired entry as a fallback', async () => {
    // Past the retention window a snapshot is more likely to mislead than help.
    const ancient = new Date(NOW.getTime() - 60 * 86_400_000).toISOString();
    const seeded = memoryCache({
      [cacheKey('00445790')]: {
        snapshot: snapshot({ fetchedAt: ancient }),
        fetchedAt: ancient,
        contractVersion: CONTRACT_VERSION,
      },
    });

    const { transport } = transportOf(new Error('network down'));
    const result = await apiWith(transport, seeded).company('00445790');
    expect(result.state === 'error' && result.fallback).toBeUndefined();
  });

  it('rejects a malformed success body rather than caching rubbish', async () => {
    const { transport } = transportOf(ok({ unexpected: true }));
    const result = await apiWith(transport, cache).company('00445790');
    expect(result.state === 'error' && result.kind).toBe('bad-response');
    expect(cache.data.size).toBe(0);
  });

  it('handles a response nothing produced, such as a captive portal', async () => {
    const { transport } = transportOf({ status: 502, body: '<html>Proxy</html>', headers: {} });
    const result = await apiWith(transport, cache).company('00445790');
    expect(result.state === 'error' && result.kind).toBe('upstream');
  });

  it('labels demo results as demo, whichever tier answered', async () => {
    // The interface must never present sample data as live.
    const { transport } = transportOf(ok(snapshot()));
    const result = await apiWith(transport, cache, { mode: 'demo' }).company('00445790');
    expect(result.state === 'ok' && result.source).toBe('demo');
  });
});

describe('search', () => {
  it('returns hits', async () => {
    const { transport, calls } = transportOf(
      ok({ hits: [{ number: '00445790', name: 'TESCO PLC', status: 'active' }], totalResults: 1 }),
    );
    const result = await apiWith(transport, cache).search('tesco');

    expect(result.state).toBe('ok');
    if (result.state === 'ok') expect(result.data.hits).toHaveLength(1);
    expect(calls).toEqual([PATHS.search]);
  });

  it('treats a body without hits as malformed', async () => {
    const { transport } = transportOf(ok({ totalResults: 3 }));
    const result = await apiWith(transport, cache).search('tesco');
    expect(result.state === 'error' && result.kind).toBe('bad-response');
  });

  it('passes a rate limit through', async () => {
    const { transport } = transportOf({
      status: 429,
      body: { error: { code: 'TOO_MANY_REQUESTS', message: 'Steady on.', retryAfter: 30 } },
      headers: {},
    });
    const result = await apiWith(transport, cache).search('tesco');
    expect(result.state === 'error' && result.kind).toBe('rate-limited');
    expect(result.state === 'error' && result.retryAfterSeconds).toBe(30);
  });
});
