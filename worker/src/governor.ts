/**
 * The Companies House budget governor.
 *
 * One key, 600 requests per five minutes, shared by every user of the free
 * lookup service. A cold company check costs four calls, so the ceiling is
 * roughly 150 cold checks per five minutes **for the entire user base**. Sharding
 * across multiple keys is explicitly forbidden — Companies House states that
 * applications attempting to bypass the limit may be banned without notice — so
 * the only defences available are behavioural.
 *
 * Three states rather than two. The obvious design is a single cutoff: below N
 * remaining, serve cache only. That wastes the budget between the cutoff and
 * zero, and it produces a cliff where the service works perfectly and then not
 * at all. Instead, degrade **depth** before **availability**: in brownout the
 * optional sources are dropped, so a cold check costs one call instead of four
 * and the report still arrives — honestly marked as partial, which the flag
 * engine already knows how to represent.
 *
 * State lives in the isolate and the Cache API, deliberately not in KV. A KV
 * write per rate-limit observation would be well over a thousand writes a day,
 * which is the entire free-tier write budget spent on telemetry about the thing
 * the budget is for. Each colo therefore undercounts independently, and
 * undercounting errs towards caution, which is the safe direction.
 */

import type { RateLimitSignal } from './upstream/types.js';

export type GovernorState =
  /** Full fan-out. */
  | 'normal'
  /** Optional sources dropped; snapshots come back partial. */
  | 'brownout'
  /** Cache only. Cold misses get 503 and a Retry-After. */
  | 'lockout';

/** Above this, spend freely. */
export const BROWNOUT_THRESHOLD = 150;
/** Below this, stop spending entirely. */
export const LOCKOUT_THRESHOLD = 50;

export interface Budget {
  state: GovernorState;
  remaining?: number;
  /** Unix seconds when the window resets, if upstream told us. */
  resetAt?: number;
}

export function stateFor(remaining: number | undefined): GovernorState {
  // No signal is not the same as no budget. Companies House does not document
  // these headers, so their absence must not lock the service out.
  if (remaining === undefined) return 'normal';
  if (remaining < LOCKOUT_THRESHOLD) return 'lockout';
  if (remaining < BROWNOUT_THRESHOLD) return 'brownout';
  return 'normal';
}

/**
 * Tracks the budget for the lifetime of one isolate.
 *
 * Best-effort by construction: isolates are ephemeral and per-colo. It is still
 * worth having, because the case it protects against — a burst on one company
 * after a forum post — lands in one colo and usually one isolate.
 */
export class BudgetTracker {
  #remaining: number | undefined;
  #resetAt: number | undefined;
  /** Set when upstream returns 429. Nothing is spent until the window resets. */
  #hardLockUntil: number | undefined;

  constructor(private readonly now: () => number = () => Date.now()) {}

  observe(signal: RateLimitSignal | undefined): void {
    if (signal === undefined) return;
    if (signal.remaining !== undefined) this.#remaining = signal.remaining;
    if (signal.resetAt !== undefined) this.#resetAt = signal.resetAt;
  }

  /** Companies House said 429. Never retry; wait for the window. */
  observeRateLimited(retryAfterSeconds: number | undefined): void {
    const seconds = retryAfterSeconds ?? 300;
    this.#hardLockUntil = Math.floor(this.now() / 1000) + seconds;
    this.#remaining = 0;
  }

  budget(): Budget {
    const nowSeconds = Math.floor(this.now() / 1000);

    if (this.#hardLockUntil !== undefined) {
      if (nowSeconds < this.#hardLockUntil) {
        return { state: 'lockout', remaining: 0, resetAt: this.#hardLockUntil };
      }
      // Window passed. Forget everything and let the next call re-measure.
      this.#hardLockUntil = undefined;
      this.#remaining = undefined;
    }

    // A stale reset time means the window rolled over while this isolate was
    // idle, so the remaining count we hold is no longer meaningful.
    if (this.#resetAt !== undefined && nowSeconds >= this.#resetAt) {
      this.#remaining = undefined;
      this.#resetAt = undefined;
    }

    const budget: Budget = { state: stateFor(this.#remaining) };
    if (this.#remaining !== undefined) budget.remaining = this.#remaining;
    if (this.#resetAt !== undefined) budget.resetAt = this.#resetAt;
    return budget;
  }

  /** Seconds until the budget window resets, for `Retry-After`. */
  retryAfterSeconds(): number {
    const nowSeconds = Math.floor(this.now() / 1000);
    const target = this.#hardLockUntil ?? this.#resetAt;
    if (target === undefined) return 60;
    return Math.max(1, target - nowSeconds);
  }
}
