/**
 * `GET /v1/company/{number}` — the aggregated snapshot.
 *
 * The path through the tiers, in order:
 *
 *   1. **L1 edge cache.** Fresh hit → serve. Stale hit → serve and refresh in the
 *      background. Emergency hit → held in reserve.
 *   2. **L2 KV.** Same classification. A hit here also warms L1.
 *   3. **Upstream**, coalesced, with depth governed by the remaining budget.
 *
 * When upstream cannot be reached, an emergency-aged snapshot is served with the
 * age stated in a header rather than an error. A three-week-old report labelled
 * "as at 9 July" is enormously better than an error screen — but only because the
 * age is impossible to miss.
 */

import type { CompanySnapshot, Freshness } from '@ltdlens/shared';
import { HEADERS } from '@ltdlens/shared';
import { aggregateCompany } from '../aggregate.js';
import type { BudgetTracker } from '../governor.js';
import { coalesce } from '../cache/coalesce.js';
import { cacheControlFor, classify } from '../cache/freshness.js';
import { edgeSnapshotUrl, snapshotKey } from '../cache/keys.js';
import type { EdgeCache, SnapshotStore } from '../cache/store.js';
import { error, json } from '../http.js';
import type { CompaniesHouseUpstream, UpstreamFailure } from '../upstream/types.js';
import { validateCompanyNumber } from '../validate.js';

export interface CompanyRouteContext {
  upstream: CompaniesHouseUpstream;
  tracker: BudgetTracker;
  edge: EdgeCache;
  store: SnapshotStore;
  schema: string;
  upstreamMode: 'live' | 'fixture';
  now: () => Date;
  /** Lets a background refresh outlive the response. */
  waitUntil: (promise: Promise<unknown>) => void;
}

interface Cached {
  snapshot: CompanySnapshot;
  freshness: Freshness | 'expired';
  ageSeconds: number;
  from: 'edge' | 'kv';
}

async function readEdge(context: CompanyRouteContext, number: string): Promise<Cached | undefined> {
  const response = await context.edge.match(edgeSnapshotUrl(context.schema, number));
  if (response === undefined) return undefined;
  try {
    const snapshot = await response.json<CompanySnapshot>();
    const aged = classify(snapshot.fetchedAt, context.now());
    return { snapshot, ...aged, from: 'edge' };
  } catch {
    return undefined;
  }
}

async function readKv(context: CompanyRouteContext, number: string): Promise<Cached | undefined> {
  const snapshot = await context.store.read(snapshotKey(context.schema, number));
  if (snapshot === undefined) return undefined;
  const aged = classify(snapshot.fetchedAt, context.now());
  return { snapshot, ...aged, from: 'kv' };
}

function serve(context: CompanyRouteContext, cached: Cached): Response {
  const aged = { freshness: cached.freshness, ageSeconds: cached.ageSeconds };
  return json(cached.snapshot, {
    headers: {
      'Cache-Control': cacheControlFor(aged),
      [HEADERS.snapshotAge]: String(cached.ageSeconds),
      [HEADERS.snapshotFresh]: cached.freshness,
      [HEADERS.upstream]: context.upstreamMode,
    },
  });
}

/** Writes through both tiers. KV decides for itself whether to persist. */
async function store(
  context: CompanyRouteContext,
  number: string,
  snapshot: CompanySnapshot,
): Promise<void> {
  const body = JSON.stringify(snapshot);
  await Promise.all([
    context.edge.put(
      edgeSnapshotUrl(context.schema, number),
      new Response(body, {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=86400',
        },
      }),
    ),
    context.store.write(snapshotKey(context.schema, number), snapshot),
  ]);
}

interface FetchFailed {
  failed: true;
  /** Distinguishes "no such company" from "we could not reach the register". */
  kind: UpstreamFailure['kind'];
  retryAfterSeconds: number;
}

async function fetchFresh(
  context: CompanyRouteContext,
  number: string,
): Promise<Cached | FetchFailed> {
  const budget = context.tracker.budget();

  const result = await coalesce(`company:${context.schema}:${number}`, async () => {
    const outcome = await aggregateCompany({
      upstream: context.upstream,
      number,
      state: budget.state,
      now: context.now(),
    });
    // Record the budget signal even when the call failed — especially then.
    context.tracker.observe(context.upstream.lastRateLimit());
    return outcome;
  });

  if (!result.ok) {
    if (result.failure.kind === 'rate-limited') {
      // Never retried. Companies House may ban an application that appears to
      // be working around the limit, and a retry is indistinguishable from one.
      context.tracker.observeRateLimited(result.failure.retryAfterSeconds);
    }
    return {
      failed: true,
      kind: result.failure.kind,
      retryAfterSeconds: context.tracker.retryAfterSeconds(),
    };
  }

  await store(context, number, result.snapshot);
  return { snapshot: result.snapshot, freshness: 'fresh', ageSeconds: 0, from: 'edge' };
}

export async function handleCompany(
  context: CompanyRouteContext,
  rawNumber: string,
): Promise<Response> {
  const number = validateCompanyNumber(rawNumber);
  if (number === undefined) return error('BAD_REQUEST');

  const cached = (await readEdge(context, number)) ?? (await readKv(context, number));

  if (cached !== undefined && cached.freshness === 'fresh') {
    return serve(context, cached);
  }

  if (cached !== undefined && cached.freshness === 'stale') {
    // Serve now, refresh behind the response. The reader gets an answer
    // immediately and the next reader gets a current one.
    context.waitUntil(fetchFresh(context, number).catch(() => undefined));
    return serve(context, cached);
  }

  const budget = context.tracker.budget();
  if (budget.state === 'lockout') {
    // Cache only. An emergency-aged snapshot beats an error, with its age stated.
    if (cached !== undefined && cached.freshness === 'emergency') {
      return serve(context, cached);
    }
    return error('UPSTREAM_BUDGET_EXHAUSTED', {
      retryAfterSeconds: context.tracker.retryAfterSeconds(),
      companyNumber: number,
    });
  }

  const fresh = await fetchFresh(context, number);

  if ('failed' in fresh) {
    if (fresh.kind === 'not-found') {
      // A well-formed number that is not on the register. Distinct from a
      // failure, and not something a cached snapshot should paper over.
      return error('COMPANY_NOT_FOUND', { companyNumber: number });
    }

    if (cached !== undefined && cached.freshness === 'emergency') {
      return serve(context, cached);
    }

    if (fresh.kind === 'rate-limited') {
      return error('UPSTREAM_BUDGET_EXHAUSTED', {
        retryAfterSeconds: fresh.retryAfterSeconds,
        companyNumber: number,
      });
    }

    // A cold miss with nothing to fall back on. Still not a dead end: the error
    // body carries the official Companies House record.
    return error('UPSTREAM_UNAVAILABLE', {
      retryAfterSeconds: fresh.retryAfterSeconds,
      companyNumber: number,
    });
  }

  return serve(context, fresh);
}
