/**
 * In-flight request coalescing.
 *
 * When two requests for the same cold company arrive together, only one should
 * reach Companies House. This keeps a map of in-flight promises keyed by cache
 * key and hands the second caller the first caller's promise.
 *
 * Be honest about what this is: isolates are ephemeral and per-colo, so it is
 * **best-effort**, not a guarantee. It is still the right trade. The case it
 * protects against — somebody mashing Enter, or a burst on one company after a
 * forum post — lands in one colo and usually one isolate. The edge cache is
 * checked first, so this only matters for the first couple of hundred
 * milliseconds of a cold company's life. The only genuinely correct alternative
 * is a Durable Object per company number, which costs a stateful primitive and,
 * at volume, money, to improve a path that is already cache-dominated. Recorded
 * as the upgrade path if upstream volume ever justifies it.
 */

const inFlight = new Map<string, Promise<unknown>>();

/**
 * Runs `work` unless an identical key is already running, in which case the
 * existing promise is returned.
 *
 * The entry is deleted in `finally`. Leaving a rejected promise in the map would
 * poison that key for the isolate's lifetime, serving the same failure to every
 * subsequent caller — this is the bug everyone writes first.
 */
export function coalesce<T>(key: string, work: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing !== undefined) return existing as Promise<T>;

  const promise = work().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, promise);
  return promise;
}

/** Number of in-flight operations. Exposed for tests. */
export function inFlightCount(): number {
  return inFlight.size;
}

/** Clears the map. Tests only — isolates do this by dying. */
export function resetCoalescing(): void {
  inFlight.clear();
}
