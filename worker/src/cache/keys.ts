/**
 * The only place cache keys are constructed.
 *
 * **There is no search key.** Search results are cached at the edge but never in
 * KV, and that is a privacy decision before it is a cost one: a KV key holding
 * what somebody typed is a durable, enumerable record of it — the owner could
 * literally run `wrangler kv key list` and read the search history of every
 * user. Cache API entries are colo-local, not enumerable, and evict themselves.
 *
 * Company snapshots are different in kind, not degree. They are keyed by a
 * **public identifier** and contain **public register data**, so they are not
 * user data at all. That distinction is the whole architecture of the privacy
 * claim, and `PRIVACY.md` states it in these words.
 *
 * The schema version is part of the key. A contract change therefore invalidates
 * everything by making the old keys unreachable, and they age out on their own.
 * Never write a KV migration.
 */

const EDGE_ORIGIN = 'https://cache.ltdlens.internal';

/** KV key for a company snapshot. */
export function snapshotKey(schema: string, number: string): string {
  return `snap:${schema}:${number}`;
}

/** KV key for the statutory rate table. */
export function ratesKey(schema: string): string {
  return `rates:${schema}:late-payment`;
}

/** KV key for the kill switch. Read with a short cacheTtl, so it is nearly free. */
export function controlKey(): string {
  return 'control:v1';
}

/**
 * Edge cache key for a company snapshot.
 *
 * The Cache API keys on a Request, and it must be a URL on a host we control
 * rather than the incoming request — otherwise query strings and headers the
 * client happened to send would fragment the cache.
 */
export function edgeSnapshotUrl(schema: string, number: string): string {
  return `${EDGE_ORIGIN}/snapshot/${schema}/${number}`;
}

/**
 * Edge cache key for a search.
 *
 * The query is hashed rather than embedded. Cache API entries are not
 * enumerable, so this is belt and braces — but a cache key is still a string
 * that could end up in a diagnostic somewhere, and there is no reason for it to
 * be readable.
 */
export function edgeSearchUrl(schema: string, queryHash: string): string {
  return `${EDGE_ORIGIN}/search/${schema}/${queryHash}`;
}

/** Stable, non-reversible hash of a search query, for use in an edge cache key. */
export async function hashQuery(query: string): Promise<string> {
  const normalised = query.trim().toLowerCase();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalised));
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
