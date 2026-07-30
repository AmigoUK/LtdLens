/**
 * The two server-side cache tiers.
 *
 * **L1, the Cache API** — per-colo, unmetered, holds everything including search.
 * Absorbs bursts.
 *
 * **L2, Workers KV** — global, durable, metered, holds snapshots and the rate
 * table only. Survives isolate death and serves other colos.
 *
 * The binding constraint on the free plan is **1,000 KV writes a day**, not the
 * request count, and exceeding it fails in the most damaging direction: writes
 * stop, so nothing persists, so every colo pays full upstream cost, so the
 * Companies House rate limit — the one that gets the key banned — comes into
 * play. A limit nobody watches detonates the limit that ends the project.
 *
 * Hence the write policy below: **KV is written on the second cold miss, not the
 * first.** The first miss populates L1 only. This drops the long tail of one-off
 * lookups out of the write budget entirely, while the second lookup of the same
 * company promotes it to KV. Roughly, it trades the Zipf tail for survival.
 */

import type { CompanySnapshot } from '@ltdlens/shared';
import { KV_TTL_SECONDS } from './freshness.js';

/** How long a "seen once" marker lives. Long enough to catch a repeat lookup. */
const SEEN_TTL_SECONDS = 60 * 60;

export interface EdgeCache {
  match(url: string): Promise<Response | undefined>;
  put(url: string, response: Response): Promise<void>;
}

/** The real Cache API, wrapped so tests can substitute a map. */
export function edgeCache(): EdgeCache {
  return {
    match(url) {
      return caches.default.match(new Request(url));
    },
    put(url, response) {
      return caches.default.put(new Request(url), response);
    },
  };
}

/** An in-memory stand-in. Used where `caches.default` is unavailable. */
export function memoryEdgeCache(): EdgeCache {
  const store = new Map<string, Response>();
  return {
    match(url) {
      const hit = store.get(url);
      return Promise.resolve(hit === undefined ? undefined : hit.clone());
    },
    put(url, response) {
      store.set(url, response.clone());
      return Promise.resolve();
    },
  };
}

export interface SnapshotStore {
  read(key: string): Promise<CompanySnapshot | undefined>;
  /** Returns true when the value was actually written to KV. */
  write(key: string, snapshot: CompanySnapshot): Promise<boolean>;
}

/**
 * The "seen once" marker lives in the **edge cache, not KV**.
 *
 * Putting it in KV would defeat the entire policy: the marker would itself be a
 * write, so a company looked up once would cost one write instead of one, and a
 * company looked up twice would cost two instead of one. Strictly worse. In the
 * edge cache the marker is unmetered, so a one-off lookup costs zero KV writes
 * and only a repeat lookup promotes the snapshot to KV.
 *
 * The marker is colo-local, which makes the heuristic approximate — a company
 * looked up once in each of five colos is never promoted. That is the intended
 * behaviour: five scattered one-off lookups are exactly the long tail this
 * policy exists to keep out of the write budget.
 */
export function kvSnapshotStore(kv: KVNamespace, markers: EdgeCache): SnapshotStore {
  const markerUrl = (key: string) =>
    `https://cache.ltdlens.internal/seen/${encodeURIComponent(key)}`;

  return {
    async read(key) {
      // `cacheTtl` makes the read itself colo-cached, which is why the 100,000
      // reads a day free allowance is effectively untouchable.
      const value = await kv.get(key, { type: 'json', cacheTtl: 3600 });
      return (value as CompanySnapshot | null) ?? undefined;
    },

    async write(key, snapshot) {
      const url = markerUrl(key);
      const seen = await markers.match(url);

      if (seen === undefined) {
        await markers.put(
          url,
          new Response('1', {
            headers: { 'Cache-Control': `public, max-age=${SEEN_TTL_SECONDS}` },
          }),
        );
        return false;
      }

      await kv.put(key, JSON.stringify(snapshot), { expirationTtl: KV_TTL_SECONDS });
      return true;
    },
  };
}
