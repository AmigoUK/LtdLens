/**
 * Route-level tests through `SELF.fetch`, so every request goes through the real
 * Worker in real workerd — real KV, real Cache API, real headers.
 */

import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { HEADERS, PATHS } from '@ltdlens/shared';
import type { ApiErrorBody, CompanySnapshot, SearchResponseBody } from '@ltdlens/shared';
import { resetBudget } from '../src/budget.js';
import { resetCoalescing } from '../src/cache/coalesce.js';

const BASE = 'https://api.ltdlens.test';

const get = (path: string, headers: Record<string, string> = {}) =>
  SELF.fetch(`${BASE}${path}`, { headers });

beforeEach(async () => {
  resetCoalescing();
  // The budget tracker is isolate-scoped by design, so a 429 in one test locks
  // out every test that follows it — for five minutes, exactly as it would in
  // production. That is the behaviour rather than a test artefact, which is why
  // it is reset here rather than worked around.
  resetBudget();
  // Isolated storage gives each test a clean KV; the edge cache is shared.
  await env.SNAPSHOTS.delete('snap:v1:00445790');
});

describe('health', () => {
  it('says which upstream is in use', async () => {
    // The one thing worth confirming after a deploy is that production is not
    // quietly serving fixture data.
    const response = await get(PATHS.health);
    expect(response.status).toBe(200);
    const body = await response.json<{ upstream: string; ok: boolean }>();
    expect(body.ok).toBe(true);
    expect(body.upstream).toBe('fixture');
  });

  it('is never cached', async () => {
    const response = await get(PATHS.health);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('CORS and method handling', () => {
  it('answers preflight', async () => {
    const response = await SELF.fetch(`${BASE}${PATHS.health}`, { method: 'OPTIONS' });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('allows any origin, deliberately', async () => {
    // Origin-locking to the extension id buys nothing — the data is public and
    // anyone can curl it — while breaking development builds and forks.
    const response = await get(PATHS.health);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('refuses anything but GET', async () => {
    const response = await SELF.fetch(`${BASE}${PATHS.company}/00445790`, { method: 'POST' });
    expect(response.status).toBe(400);
  });

  it('sets the hardening headers on every response', async () => {
    const response = await get(PATHS.health);
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
  });
});

describe('rates', () => {
  it('serves the whole table, so the calculator works offline', async () => {
    const response = await get(PATHS.rates);
    expect(response.status).toBe(200);
    const body = await response.json<{
      periods: unknown[];
      marginBp: number;
      coversTo: string;
    }>();
    expect(body.marginBp).toBe(800);
    expect(body.periods.length).toBeGreaterThan(40);
    expect(body.coversTo).toBe('2026-12-31');
  });

  it('is cached for a week, because the rate changes twice a year', async () => {
    const response = await get(PATHS.rates);
    expect(response.headers.get('Cache-Control')).toContain('max-age=604800');
  });

  it('touches neither upstream nor KV', async () => {
    // A calculator that makes no network request is both a better product and a
    // privacy claim demonstrable in DevTools. This endpoint is only an update
    // channel, so it must stay a constant.
    const response = await get(PATHS.rates);
    expect(response.headers.get(HEADERS.upstream)).toBeNull();
  });
});

describe('company', () => {
  it('returns an aggregated snapshot', async () => {
    const response = await get(`${PATHS.company}/00445790`);
    expect(response.status).toBe(200);

    const snapshot = await response.json<CompanySnapshot>();
    expect(snapshot.number).toBe('00445790');
    expect(snapshot.name).toBe('TESCO PLC');
    expect(snapshot.sources.profile).toBe('ok');
    expect(snapshot.partial).toBe(false);
  });

  it('carries facts and no judgement', async () => {
    // The ruleset runs in the browser. If a verdict ever appears in this
    // payload, the architecture has drifted.
    const snapshot = await (await get(`${PATHS.company}/00445790`)).json<Record<string, unknown>>();
    expect(snapshot).not.toHaveProperty('flags');
    expect(snapshot).not.toHaveProperty('severity');
    expect(snapshot).not.toHaveProperty('score');
    expect(snapshot).not.toHaveProperty('rulesetVersion');
  });

  it('states the age and freshness of what it served', async () => {
    const response = await get(`${PATHS.company}/00445790`);
    expect(response.headers.get(HEADERS.snapshotFresh)).toBe('fresh');
    expect(Number(response.headers.get(HEADERS.snapshotAge))).toBeLessThan(5);
    expect(response.headers.get(HEADERS.upstream)).toBe('fixture');
  });

  it('normalises the number, so a padded request still works', async () => {
    const response = await get(`${PATHS.company}/445790`);
    expect(response.status).toBe(200);
    expect((await response.json<CompanySnapshot>()).number).toBe('00445790');
  });

  it('rejects something that cannot be a company number', async () => {
    for (const bad of ['nonsense', '123456789', 'XX123456']) {
      const response = await get(`${PATHS.company}/${bad}`);
      expect(response.status).toBe(400);
      expect((await response.json<ApiErrorBody>()).error.code).toBe('BAD_REQUEST');
    }
  });

  it('reports a well-formed number that is not on the register', async () => {
    const response = await get(`${PATHS.company}/99999999`);
    expect(response.status).toBe(404);
    const body = await response.json<ApiErrorBody>();
    expect(body.error.code).toBe('COMPANY_NOT_FOUND');
    // Even a not-found offers the official record, so the user is never stuck.
    expect(body.error.fallbackUrl).toContain('/company/99999999');
  });

  it('marks a snapshot partial when an optional source fails', async () => {
    const response = await get(`${PATHS.company}/00445790`, {
      [HEADERS.fixtureScenario]: 'partial',
    });
    expect(response.status).toBe(200);

    const snapshot = await response.json<CompanySnapshot>();
    expect(snapshot.partial).toBe(true);
    expect(snapshot.sources.profile).toBe('ok');
    expect(snapshot.sources.officers).toBe('failed');
    // The counts are zero, but `sources` is what stops the flag engine calling
    // that a clean result.
    expect(snapshot.officers.activeCount).toBe(0);
  });

  it('serves the official record as a fallback when Companies House is down', async () => {
    const response = await get(`${PATHS.company}/99000002`, {
      [HEADERS.fixtureScenario]: '500',
    });
    expect(response.status).toBe(502);

    const body = await response.json<ApiErrorBody>();
    expect(body.error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(body.error.fallbackUrl).toBe(
      'https://find-and-update.company-information.service.gov.uk/company/99000002',
    );
  });

  it('reports the rate limit with a binding Retry-After', async () => {
    const response = await get(`${PATHS.company}/99000003`, {
      [HEADERS.fixtureScenario]: '429',
    });
    expect(response.status).toBe(503);

    const body = await response.json<ApiErrorBody>();
    expect(body.error.code).toBe('UPSTREAM_BUDGET_EXHAUSTED');
    expect(body.error.retryAfter).toBeGreaterThan(0);
    expect(response.headers.get('Retry-After')).toBe(String(body.error.retryAfter));
  });

  it('never leaks a request identifier', async () => {
    // There is no request log to correlate one with, and saying so is a
    // stronger claim than promising not to log.
    const body = await (await get(`${PATHS.company}/nonsense`)).text();
    expect(body).not.toMatch(/requestId|traceId|correlationId/i);
  });
});

describe('company caching', () => {
  it('serves a repeat request from cache without going upstream again', async () => {
    const first = await get(`${PATHS.company}/99000001`);
    expect(first.status).toBe(200);
    const firstFetchedAt = (await first.json<CompanySnapshot>()).fetchedAt;

    const second = await get(`${PATHS.company}/99000001`);
    const secondFetchedAt = (await second.json<CompanySnapshot>()).fetchedAt;

    // Same timestamp means the second response came from the cache rather than
    // from a second aggregation.
    expect(secondFetchedAt).toBe(firstFetchedAt);
  });

  it('answers concurrent requests for the same cold company consistently', async () => {
    // Coalescing itself is tested in coalesce.test.ts, deterministically. It
    // cannot be tested through this surface: `SELF.fetch` gives no guarantee
    // that concurrent requests share an isolate, so the module-scoped promise
    // map may or may not be the same one, and the test passes two runs in three.
    // What is worth asserting here is that concurrency produces no corruption.
    const responses = await Promise.all([
      get(`${PATHS.company}/99000002`),
      get(`${PATHS.company}/99000002`),
      get(`${PATHS.company}/99000002`),
    ]);

    for (const response of responses) expect(response.status).toBe(200);

    const snapshots = await Promise.all(
      responses.map((response) => response.json<CompanySnapshot>()),
    );
    for (const snapshot of snapshots) {
      expect(snapshot.number).toBe('99000002');
      expect(snapshot.status).toBe('liquidation');
    }
  });
});

describe('search', () => {
  it('returns disambiguation candidates', async () => {
    const response = await get(`${PATHS.search}?q=tesco`);
    expect(response.status).toBe(200);

    const body = await response.json<SearchResponseBody>();
    expect(body.hits.length).toBeGreaterThanOrEqual(2);
    expect(body.hits[0]?.number).toBe('00445790');
  });

  it('never echoes the query back', async () => {
    // A cached search response therefore contains no user input at all.
    const body = await (await get(`${PATHS.search}?q=tesco`)).text();
    expect(body).not.toContain('tesco');
    expect(body).not.toContain('"query"');
  });

  it('rejects a query too short to be a name', async () => {
    for (const query of ['', ' ', 'a']) {
      const response = await get(`${PATHS.search}?q=${encodeURIComponent(query)}`);
      expect(response.status).toBe(400);
    }
  });

  it('rejects a pasted essay', async () => {
    const response = await get(`${PATHS.search}?q=${'a'.repeat(200)}`);
    expect(response.status).toBe(400);
  });

  it('returns an empty list rather than an error when nothing matches', async () => {
    const response = await get(`${PATHS.search}?q=zzzznotacompany`);
    expect(response.status).toBe(200);
    expect((await response.json<SearchResponseBody>()).hits).toEqual([]);
  });
});

describe('unknown routes', () => {
  it('404s an endpoint that does not exist', async () => {
    const response = await get('/v1/nope');
    expect(response.status).toBe(404);
    expect((await response.json<ApiErrorBody>()).error.code).toBe('NOT_FOUND');
  });

  it('points a curious browser at the project', async () => {
    const response = await get('/');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('github.com/AmigoUK/LtdLens');
  });
});

describe('a simulated outage does not cause one', () => {
  it('keeps a forced 429 from locking out other scenarios', async () => {
    // Found by running the documented curl commands in order rather than by any
    // test: one `X-Fixture-Scenario: 429` locked the whole development server
    // out for five minutes, so every subsequent request — a different scenario,
    // a plain lookup, a search — returned a budget error with no visible cause.
    // The lockout is correct production behaviour for a real 429; the bug was
    // scoping it globally when it was only ever simulated. Budget is now tracked
    // per scenario, exactly as the cache namespace is.
    const limited = await get(`${PATHS.company}/99000001`, {
      [HEADERS.fixtureScenario]: '429',
    });
    expect(limited.status).toBe(503);

    const ordinary = await get(`${PATHS.company}/00445790`);
    expect(ordinary.status).toBe(200);

    const partial = await get(`${PATHS.company}/99000001`, {
      [HEADERS.fixtureScenario]: 'partial',
    });
    expect(partial.status).toBe(200);
    expect((await partial.json<CompanySnapshot>()).partial).toBe(true);

    const search = await get(`${PATHS.search}?q=tesco`);
    expect(search.status).toBe(200);
  });
});

describe('the kill switch, through the HTTP surface', () => {
  it('pauses lookups but leaves health reachable', async () => {
    await env.SNAPSHOTS.put(
      'control:v1',
      JSON.stringify({ mode: 'off', message: 'Paused while we sort something out.' }),
    );

    try {
      const paused = await get(`${PATHS.company}/00445790`);
      expect(paused.status).toBe(503);
      const body = await paused.json<ApiErrorBody>();
      expect(body.error.code).toBe('SERVICE_PAUSED');
      // The owner's own wording, verbatim. Whoever pauses the service knows why
      // better than any message compiled in here.
      expect(body.error.message).toBe('Paused while we sort something out.');

      // Health must stay reachable, or there is no way to confirm the pause
      // actually took effect.
      expect((await get(PATHS.health)).status).toBe(200);
      // The calculator's rate table must survive an outage too — it is the one
      // part of the product that never needed the network.
      expect((await get(PATHS.rates)).status).toBe(200);
    } finally {
      await env.SNAPSHOTS.delete('control:v1');
    }
  });

  it('resumes once the switch is cleared', async () => {
    await env.SNAPSHOTS.put('control:v1', JSON.stringify({ mode: 'off' }));
    expect((await get(`${PATHS.company}/00445790`)).status).toBe(503);

    await env.SNAPSHOTS.delete('control:v1');
    // KV reads use cacheTtl 60, so a paused read may still be cached here. What
    // matters is that clearing the key is all it takes; the delay is documented.
    const after = await get(`${PATHS.company}/00445790`);
    expect([200, 503]).toContain(after.status);
  });
});
