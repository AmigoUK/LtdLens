/**
 * Per-client throttling.
 *
 * **This is the only module in the project permitted to read a client IP
 * address.** ESLint forbids `CF-Connecting-IP` everywhere else and CI greps for
 * it, because one careless read in a log line would falsify the central claim in
 * PRIVACY.md.
 *
 * What the IP is turned into matters as much as where it is read. Never stored,
 * never logged, never used as a key on its own — it becomes a truncated HMAC over
 * a secret salt **plus the current UTC date**, so:
 *
 *   - The stored value is not reversible to an address.
 *   - The identifier changes at midnight, so nobody can be followed across days
 *     even by whoever holds the salt.
 *   - Truncating to 96 bits keeps collisions rare enough for rate limiting while
 *     making the value useless as an identifier.
 *
 * Counters live in the Cache API, not KV. A rate-limit counter in KV would be one
 * write per request — the entire free write budget spent on defending the free
 * write budget. Cache entries are colo-local, so a determined client could get
 * one bucket per colo; that is accepted, because the point is to stop a runaway
 * script rather than a motivated adversary, and the Companies House governor is
 * the real backstop.
 */

const WINDOW_SECONDS = 60;

/**
 * Requests per client per minute.
 *
 * Sized so a bookkeeper running fifty checks in an afternoon never notices, while
 * a script in a loop does. A cold check costs four upstream calls, so this is also
 * roughly the point past which one client could exhaust the shared budget alone.
 */
export const REQUESTS_PER_WINDOW = 40;

const COUNTER_ORIGIN = 'https://throttle.ltdlens.internal';

export interface ThrottleDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * A non-reversible, daily-rotating client identifier.
 *
 * Returns undefined when there is no salt or no address — in which case the
 * caller does not throttle. Failing open is deliberate: a missing salt is a
 * configuration problem, and denying every request over it would turn a
 * misconfiguration into an outage. The Companies House governor still protects
 * the thing that actually matters.
 */
async function clientHash(
  request: Request,
  salt: string | undefined,
  now: Date,
): Promise<string | undefined> {
  if (salt === undefined || salt.length === 0) return undefined;

  // The one permitted read.
  const address = request.headers.get('CF-Connecting-IP');
  if (address === null || address.length === 0) return undefined;

  // `now` is a parameter rather than a read of the clock, per the project rule
  // that pure logic never reads ambient time. That is not bookkeeping here: it is
  // the only way the daily rotation can be tested at all, and an untested
  // rotation is an unverified privacy claim.
  const day = now.toISOString().slice(0, 10);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`${salt}:${day}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(address));

  return [...new Uint8Array(signature)]
    .slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

interface CounterState {
  count: number;
  /** Unix seconds when this window ends. */
  expiresAt: number;
}

export interface ThrottleDeps {
  request: Request;
  salt: string | undefined;
  now: () => Date;
  /** Injected so tests need no Cache API. */
  cache: {
    match(url: string): Promise<Response | undefined>;
    put(url: string, response: Response): Promise<void>;
  };
}

export async function throttle(deps: ThrottleDeps): Promise<ThrottleDecision> {
  const hash = await clientHash(deps.request, deps.salt, deps.now());
  if (hash === undefined) return { allowed: true, retryAfterSeconds: 0 };

  const nowSeconds = Math.floor(deps.now().getTime() / 1000);
  const url = `${COUNTER_ORIGIN}/${hash}`;

  let state: CounterState = { count: 0, expiresAt: nowSeconds + WINDOW_SECONDS };

  const existing = await deps.cache.match(url);
  if (existing !== undefined) {
    try {
      const stored = await existing.json<CounterState>();
      // A window that has already ended is not a window. Starting fresh rather
      // than trusting the stored count avoids a client being punished for a
      // minute that finished while nobody was looking.
      if (typeof stored.count === 'number' && stored.expiresAt > nowSeconds) state = stored;
    } catch {
      // Unreadable counter: treat as absent rather than as a violation.
    }
  }

  state.count += 1;
  const remainingSeconds = Math.max(1, state.expiresAt - nowSeconds);

  await deps.cache.put(
    url,
    new Response(JSON.stringify(state), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${remainingSeconds}`,
      },
    }),
  );

  return state.count > REQUESTS_PER_WINDOW
    ? { allowed: false, retryAfterSeconds: remainingSeconds }
    : { allowed: true, retryAfterSeconds: 0 };
}
