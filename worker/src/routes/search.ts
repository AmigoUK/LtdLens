/**
 * `GET /v1/search?q=` — company name lookup.
 *
 * Cached at the edge only, never in KV. See `cache/keys.ts` for why: a durable
 * key containing what somebody typed would be a readable record of it, whereas
 * edge entries are colo-local, not enumerable, and evict themselves. The query
 * is hashed even for the edge key, and the response body never echoes it back —
 * so a cached search response contains no user input at all.
 */

import { HEADERS, normaliseSearch } from '@ltdlens/shared';
import { coalesce } from '../cache/coalesce.js';
import { edgeSearchUrl, hashQuery } from '../cache/keys.js';
import type { EdgeCache } from '../cache/store.js';
import type { BudgetTracker } from '../governor.js';
import { error, json } from '../http.js';
import type { CompaniesHouseUpstream } from '../upstream/types.js';
import { validateQuery } from '../validate.js';

/** Searches change slowly and cost one upstream call. An hour is plenty. */
const SEARCH_TTL_SECONDS = 3600;

export interface SearchRouteContext {
  upstream: CompaniesHouseUpstream;
  tracker: BudgetTracker;
  edge: EdgeCache;
  schema: string;
  upstreamMode: 'live' | 'fixture';
  now: () => Date;
}

export async function handleSearch(
  context: SearchRouteContext,
  rawQuery: string | null,
): Promise<Response> {
  const validation = validateQuery(rawQuery);
  if (!validation.ok) {
    const message =
      validation.reason === 'too-long'
        ? 'That search is too long to be a company name.'
        : 'Please enter at least two characters.';
    return error('BAD_REQUEST', { message });
  }

  const { query } = validation;
  const hash = await hashQuery(query);
  const url = edgeSearchUrl(context.schema, hash);

  const cached = await context.edge.match(url);
  if (cached !== undefined) {
    const body = await cached.text();
    return json(JSON.parse(body), {
      headers: {
        'Cache-Control': `public, max-age=${SEARCH_TTL_SECONDS}`,
        [HEADERS.upstream]: context.upstreamMode,
      },
    });
  }

  const budget = context.tracker.budget();
  if (budget.state === 'lockout') {
    // No cached answer and no budget. Search has no emergency tier — there is
    // no older result to fall back on, only the official search page.
    return error('UPSTREAM_BUDGET_EXHAUSTED', {
      retryAfterSeconds: context.tracker.retryAfterSeconds(),
    });
  }

  const result = await coalesce(`search:${context.schema}:${hash}`, async () => {
    const outcome = await context.upstream.search(query);
    context.tracker.observe(context.upstream.lastRateLimit());
    return outcome;
  });

  if (!result.ok) {
    if (result.failure.kind === 'rate-limited') {
      context.tracker.observeRateLimited(result.failure.retryAfterSeconds);
      return error('UPSTREAM_BUDGET_EXHAUSTED', {
        retryAfterSeconds: context.tracker.retryAfterSeconds(),
      });
    }
    if (result.failure.kind === 'not-found') {
      // Nothing matched. An empty list is the honest answer, not an error.
      return json({ hits: [], totalResults: 0, fetchedAt: context.now().toISOString() });
    }
    return error('UPSTREAM_UNAVAILABLE');
  }

  const body = normaliseSearch(result.data, context.now());

  await context.edge.put(
    url,
    new Response(JSON.stringify(body), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${SEARCH_TTL_SECONDS}`,
      },
    }),
  );

  return json(body, {
    headers: {
      'Cache-Control': `public, max-age=${SEARCH_TTL_SECONDS}`,
      [HEADERS.upstream]: context.upstreamMode,
    },
  });
}
