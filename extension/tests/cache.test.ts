import { describe, expect, it } from 'vitest';
import { CACHE_CAP, ageSeconds, cacheKey, evictionPlan, freshnessOf } from '../lib/cache.js';
import type { CacheEntry } from '../lib/cache.js';

const NOW = new Date('2026-07-30T12:00:00Z');
const CONTRACT = 1;

const entry = (fetchedAt: string, contractVersion = CONTRACT): CacheEntry =>
  ({ snapshot: {}, fetchedAt, contractVersion }) as CacheEntry;

const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

describe('cacheKey', () => {
  it('namespaces by company number', () => {
    expect(cacheKey('00445790')).toBe('company:00445790');
  });
});

describe('ageSeconds', () => {
  it('measures age in whole seconds', () => {
    expect(ageSeconds(hoursAgo(2), NOW)).toBe(7200);
    expect(ageSeconds(NOW.toISOString(), NOW)).toBe(0);
  });

  it('treats an unparseable timestamp as infinitely old', () => {
    // Which makes it expired, so a corrupt entry is never served.
    expect(ageSeconds('not a date', NOW)).toBe(Number.POSITIVE_INFINITY);
  });

  it('never reports a negative age for a clock that moved backwards', () => {
    expect(ageSeconds(new Date(NOW.getTime() + 60_000).toISOString(), NOW)).toBe(0);
  });
});

describe('freshnessOf', () => {
  it('holds the freshness boundary at the configured TTL', () => {
    expect(freshnessOf(entry(hoursAgo(11)), NOW, 12, 30, CONTRACT)).toBe('fresh');
    expect(freshnessOf(entry(hoursAgo(13)), NOW, 12, 30, CONTRACT)).toBe('stale');
  });

  it('holds the retention boundary at the configured maximum age', () => {
    expect(freshnessOf(entry(daysAgo(29)), NOW, 12, 30, CONTRACT)).toBe('stale');
    expect(freshnessOf(entry(daysAgo(31)), NOW, 12, 30, CONTRACT)).toBe('expired');
  });

  it('expires an entry from a different contract version', () => {
    // It may be missing a field a rule needs, and a rule reading an absent field
    // would report "not checked" for every company.
    expect(freshnessOf(entry(NOW.toISOString(), CONTRACT - 1), NOW, 12, 30, CONTRACT)).toBe(
      'expired',
    );
  });

  it('expires an entry with an unreadable timestamp', () => {
    expect(freshnessOf(entry('rubbish'), NOW, 12, 30, CONTRACT)).toBe('expired');
  });
});

describe('evictionPlan', () => {
  it('evicts nothing while under the cap', () => {
    const entries = [{ key: 'a', fetchedAt: hoursAgo(1) }];
    expect(evictionPlan(entries, 10)).toEqual([]);
  });

  it('evicts the oldest first', () => {
    const entries = [
      { key: 'new', fetchedAt: hoursAgo(1) },
      { key: 'old', fetchedAt: daysAgo(10) },
      { key: 'middle', fetchedAt: daysAgo(2) },
    ];
    expect(evictionPlan(entries, 2)).toEqual(['old']);
  });

  it('evicts exactly enough to reach the cap', () => {
    const entries = Array.from({ length: 10 }, (_, index) => ({
      key: `k${index}`,
      fetchedAt: daysAgo(index),
    }));
    expect(evictionPlan(entries, 4)).toHaveLength(6);
  });

  it('has a cap that leaves plenty of room inside the storage quota', () => {
    // chrome.storage.local allows about 10 MB; a snapshot is roughly 30 KB. The
    // cap exists so a quota error cannot arrive mid-lookup, not to save space.
    expect(CACHE_CAP * 30_000).toBeLessThan(10 * 1024 * 1024);
  });
});
