/**
 * The local cache policy. Pure: freshness, keys and eviction, with no storage.
 *
 * This tier is **not a mirror of the server cache**. It is the outage store, and
 * it deliberately keeps things far longer than the Worker would serve them —
 * thirty days by default. The Worker cannot serve a three-week-old snapshot as
 * though it were current; the extension can, because the extension can show the
 * reader exactly how old it is. At three in the morning with the lookup service
 * down, a report labelled "as at 9 July" is enormously more useful than an error.
 */

import type { CompanySnapshot } from '@ltdlens/shared';

/** What the store holds. Raw facts only — never the derived flags. */
export interface CacheEntry {
  snapshot: CompanySnapshot;
  fetchedAt: string;
  /** Bumped when the snapshot shape changes, so stale shapes are ignored. */
  contractVersion: number;
}

export type Freshness = 'fresh' | 'stale' | 'expired';

/**
 * Storing facts rather than flags is what lets a ruleset fix take effect
 * immediately: the next render re-evaluates every cached company under the new
 * rules, with no invalidation and no refetch.
 */
export function cacheKey(number: string): string {
  return `company:${number}`;
}

export function ageSeconds(fetchedAt: string, now: Date): number {
  const then = Date.parse(fetchedAt);
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((now.getTime() - then) / 1000));
}

export function freshnessOf(
  entry: CacheEntry,
  now: Date,
  ttlHours: number,
  maxAgeDays: number,
  contractVersion: number,
): Freshness {
  // A snapshot from an older contract may be missing fields a rule needs, and a
  // rule reading an absent field would report "not checked" for every company.
  // Treating it as expired is both simpler and more honest.
  if (entry.contractVersion !== contractVersion) return 'expired';

  const age = ageSeconds(entry.fetchedAt, now);
  if (age < ttlHours * 3600) return 'fresh';
  if (age < maxAgeDays * 86_400) return 'stale';
  return 'expired';
}

/**
 * Which keys to drop to get back under the cap, least recently fetched first.
 *
 * `chrome.storage.local` allows about 10 MB. At roughly 30 KB per snapshot the
 * cap is nowhere near it, but an unbounded cache eventually produces a quota
 * error, and it would arrive at the worst possible moment — mid-lookup, on a
 * company somebody is deciding about.
 */
export function evictionPlan(
  entries: readonly { key: string; fetchedAt: string }[],
  cap: number,
): string[] {
  if (entries.length <= cap) return [];

  return [...entries]
    .sort((a, b) => Date.parse(a.fetchedAt) - Date.parse(b.fetchedAt))
    .slice(0, entries.length - cap)
    .map((entry) => entry.key);
}

/** Maximum cached companies. Comfortably inside the storage quota. */
export const CACHE_CAP = 50;
