import { describe, expect, it } from 'vitest';
import { BROWNOUT_THRESHOLD, BudgetTracker, LOCKOUT_THRESHOLD, stateFor } from '../src/governor.js';

describe('stateFor', () => {
  it('degrades depth before availability', () => {
    expect(stateFor(600)).toBe('normal');
    expect(stateFor(BROWNOUT_THRESHOLD)).toBe('normal');
    expect(stateFor(BROWNOUT_THRESHOLD - 1)).toBe('brownout');
    expect(stateFor(LOCKOUT_THRESHOLD)).toBe('brownout');
    expect(stateFor(LOCKOUT_THRESHOLD - 1)).toBe('lockout');
    expect(stateFor(0)).toBe('lockout');
  });

  it('treats no signal as normal, not as no budget', () => {
    // Companies House does not document these headers, so their absence must
    // never lock the service out. That would be a self-inflicted outage on the
    // strength of a header nobody promised us.
    expect(stateFor(undefined)).toBe('normal');
  });
});

describe('BudgetTracker', () => {
  const at = (seconds: number) => () => seconds * 1000;

  it('starts optimistic', () => {
    expect(new BudgetTracker().budget().state).toBe('normal');
  });

  it('follows the remaining count it is told about', () => {
    const tracker = new BudgetTracker(at(1000));
    tracker.observe({ remaining: 400 });
    expect(tracker.budget().state).toBe('normal');
    tracker.observe({ remaining: 120 });
    expect(tracker.budget().state).toBe('brownout');
    tracker.observe({ remaining: 10 });
    expect(tracker.budget().state).toBe('lockout');
  });

  it('ignores an absent signal rather than resetting', () => {
    const tracker = new BudgetTracker(at(1000));
    tracker.observe({ remaining: 10 });
    tracker.observe(undefined);
    tracker.observe({});
    expect(tracker.budget().state).toBe('lockout');
  });

  it('hard-locks on a 429 and never suggests retrying sooner', () => {
    let clock = 1000;
    const tracker = new BudgetTracker(() => clock * 1000);

    tracker.observeRateLimited(300);
    expect(tracker.budget().state).toBe('lockout');
    expect(tracker.retryAfterSeconds()).toBe(300);

    clock += 299;
    expect(tracker.budget().state).toBe('lockout');
    expect(tracker.retryAfterSeconds()).toBe(1);
  });

  it('re-measures once the rate-limit window passes', () => {
    let clock = 1000;
    const tracker = new BudgetTracker(() => clock * 1000);

    tracker.observeRateLimited(300);
    clock += 301;
    // The count it held is meaningless now, so it goes back to optimistic and
    // lets the next real call establish the truth.
    expect(tracker.budget().state).toBe('normal');
  });

  it('defaults the lockout to five minutes when Retry-After is absent', () => {
    const tracker = new BudgetTracker(at(1000));
    tracker.observeRateLimited(undefined);
    expect(tracker.retryAfterSeconds()).toBe(300);
  });

  it('forgets a remaining count once its window has rolled over', () => {
    let clock = 1000;
    const tracker = new BudgetTracker(() => clock * 1000);

    tracker.observe({ remaining: 5, resetAt: 1100 });
    expect(tracker.budget().state).toBe('lockout');

    clock = 1101;
    // The window reset while this isolate sat idle. Continuing to report
    // lockout would be an outage caused by stale bookkeeping.
    expect(tracker.budget().state).toBe('normal');
  });

  it('falls back to a minute when it has no window information at all', () => {
    expect(new BudgetTracker(at(1000)).retryAfterSeconds()).toBe(60);
  });
});
