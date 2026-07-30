/**
 * The isolate-scoped budget tracker.
 *
 * Module scope is the point: a per-request tracker would start from "no signal"
 * every time and never notice the shared Companies House budget running down.
 * The consequence — one 429 locks this isolate out for the whole window — is the
 * intended production behaviour, and it is also why tests call `resetBudget`.
 *
 * Trackers are keyed, and in development the key is the forced fixture scenario.
 * Without that, a single `curl -H 'X-Fixture-Scenario: 429'` would lock the whole
 * development server out for five minutes, and every subsequent request — a
 * different scenario, a plain lookup, a search — would return a budget error with
 * no visible cause. Simulating an outage should not cause one. In production the
 * scenario is always `ok`, so there is exactly one tracker and the behaviour is
 * unchanged.
 */

import { BudgetTracker } from './governor.js';

const trackers = new Map<string, BudgetTracker>();

export function budgetTracker(key = 'live'): BudgetTracker {
  const existing = trackers.get(key);
  if (existing !== undefined) return existing;

  const tracker = new BudgetTracker();
  trackers.set(key, tracker);
  return tracker;
}

/** Tests only. Isolates do this by dying. */
export function resetBudget(): void {
  trackers.clear();
}
