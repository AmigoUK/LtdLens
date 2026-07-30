/**
 * Freshness is decided from `fetchedAt` inside the payload, never from a cache
 * expiry.
 *
 * Carrying the timestamp buys three things for the price of one field:
 * stale-while-revalidate, stale-if-error, and an honest "as at" date the
 * interface can show. Leaning on KV's own TTL instead would give none of them —
 * and the Cache API explicitly does not support the `stale-while-revalidate` or
 * `stale-if-error` directives, so the behaviour has to be hand-rolled regardless.
 */

import type { Freshness } from '@ltdlens/shared';

export const FRESH_SECONDS = 12 * 60 * 60;
export const STALE_SECONDS = 24 * 60 * 60;
/** Beyond this, a snapshot is too old to serve even in an emergency. */
export const EMERGENCY_SECONDS = 30 * 24 * 60 * 60;

/** KV garbage-collects after a day; freshness is judged from the payload. */
export const KV_TTL_SECONDS = STALE_SECONDS;

export interface Aged {
  freshness: Freshness | 'expired';
  ageSeconds: number;
}

export function ageOf(fetchedAt: string, now: Date): number {
  const then = Date.parse(fetchedAt);
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((now.getTime() - then) / 1000));
}

export function classify(fetchedAt: string, now: Date): Aged {
  const ageSeconds = ageOf(fetchedAt, now);
  if (ageSeconds < FRESH_SECONDS) return { freshness: 'fresh', ageSeconds };
  if (ageSeconds < STALE_SECONDS) return { freshness: 'stale', ageSeconds };
  if (ageSeconds < EMERGENCY_SECONDS) return { freshness: 'emergency', ageSeconds };
  return { freshness: 'expired', ageSeconds };
}

/**
 * `Cache-Control` for a served snapshot.
 *
 * Fresh entries are cacheable for the remainder of their freshness window. Stale
 * and emergency entries get a short window, because a refresh is either already
 * in flight or wanted as soon as the service can afford one.
 */
export function cacheControlFor(aged: Aged): string {
  if (aged.freshness === 'fresh') {
    return `public, max-age=${Math.max(60, FRESH_SECONDS - aged.ageSeconds)}`;
  }
  return 'public, max-age=300';
}
