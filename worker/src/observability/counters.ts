/**
 * The only module in this package permitted to emit anything.
 *
 * ESLint sets `no-console: error` across `worker/src` and exempts this directory
 * alone; CI greps for violations. That is what makes "nothing is logged" a
 * property of the build rather than a promise in a document.
 *
 * What may be emitted is **aggregate counts and nothing else**. Never a URL,
 * never a company number, never an IP, never a query. The test is simple: could
 * the output tell anyone what a particular person looked up? If yes, it does not
 * belong here.
 *
 * Even these are off by default. `observability.enabled` is false in every
 * environment block of wrangler.jsonc, so in production nothing reaches
 * Cloudflare's logs at all. This exists so that if a diagnosis is ever
 * genuinely needed, the shape of what may be counted is already decided — and
 * decided while nobody is under pressure — rather than improvised at 3am into a
 * `console.log(request.url)`.
 */

/** Things worth counting. Deliberately coarse. */
export type Counter =
  | 'company.hit.fresh'
  | 'company.hit.stale'
  | 'company.hit.emergency'
  | 'company.miss'
  | 'company.partial'
  | 'search.hit'
  | 'search.miss'
  | 'upstream.ok'
  | 'upstream.rate-limited'
  | 'upstream.failed'
  | 'governor.brownout'
  | 'governor.lockout'
  | 'throttle.rejected'
  | 'control.paused';

const counts = new Map<Counter, number>();

export function count(counter: Counter): void {
  counts.set(counter, (counts.get(counter) ?? 0) + 1);
}

/** Totals for this isolate's lifetime. */
export function snapshotCounts(): Record<string, number> {
  return Object.fromEntries(counts);
}

export function resetCounts(): void {
  counts.clear();
}

/**
 * Prints the aggregate counts. Never called in normal operation — kept for a
 * deliberate diagnosis, and it is physically incapable of naming a company,
 * because it only has access to the counter map.
 */
export function emitCounts(): void {
  const totals = snapshotCounts();
  if (Object.keys(totals).length === 0) return;
  console.log(JSON.stringify({ counters: totals }));
}
