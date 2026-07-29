/**
 * The ruleset against the fixtures, with "now" frozen.
 *
 * Freezing the clock is what stops these tests rotting: real filing deadlines
 * roll forward, and a company that is eleven months old today is thirteen months
 * old next spring. Every expectation below is therefore a statement about a
 * fixed moment, and a failure means the rules changed rather than the calendar.
 *
 * It also checks each fixture still exercises what `fixtures/README.md` claims.
 * A fixture whose data drifts away from its stated purpose is worse than no
 * fixture, because the suite still passes and the coverage is imaginary.
 */

import { describe, expect, it } from 'vitest';
import { getCompanyFixture } from '@ltdlens/fixtures';
import { composeSnapshot } from '../src/normalise/snapshot.js';
import type { SourceResult } from '../src/normalise/snapshot.js';
import { evaluateSnapshotAt } from '../src/flags/engine.js';
import type { CompanySnapshot } from '../src/types/snapshot.js';
import type { FlagId } from '../src/types/flags.js';

const NOW = new Date('2026-07-29T10:00:00Z');

function snapshotOf(number: string): CompanySnapshot {
  const fixture = getCompanyFixture(number);
  if (!fixture) throw new Error(`No fixture for ${number}`);
  const optional = <T>(data: T | undefined): SourceResult<T> =>
    data === undefined ? { status: 'not-applicable' } : { status: 'ok', data };

  return composeSnapshot({
    profile: fixture.profile,
    officers: optional(fixture.officers),
    charges: optional(fixture.charges),
    filings: optional(fixture.filings),
    fetchedAt: NOW,
  });
}

const verdictOf = (number: string) => evaluateSnapshotAt(snapshotOf(number), NOW);
const idsOf = (number: string): FlagId[] => verdictOf(number).flags.map((flag) => flag.id);

describe('00445790 TESCO PLC', () => {
  it('gets a clean, established all-clear', () => {
    const verdict = verdictOf('00445790');
    expect(verdict.overall).toBe('green');
    expect(verdict.partial).toBe(false);
    expect(verdict.flags.find((flag) => flag.id === 'all-clear')?.params).toEqual({
      established: 'established',
    });
  });

  it('shows its outstanding charge as information, not as a warning', () => {
    expect(idsOf('00445790')).toEqual(['charges-outstanding', 'all-clear']);
  });
});

describe('99000001 DISTRESSED TRADING LIMITED', () => {
  const verdict = verdictOf('99000001');

  it('raises exactly the flags the fixture exists to exercise, in reading order', () => {
    // Within a severity level the ruleset's own order governs, so an imminent
    // strike-off is read before overdue accounts: a company about to leave the
    // register is the more urgent fact.
    expect(verdict.flags.map((flag) => flag.id)).toEqual([
      'strike-off',
      'accounts-overdue',
      'cs-overdue',
      'officer-churn',
      'charges-outstanding',
    ]);
  });

  it('reads red, and withholds the all-clear', () => {
    expect(verdict.overall).toBe('red');
    expect(verdict.flags.map((flag) => flag.id)).not.toContain('all-clear');
  });

  it('counts the two director resignations and ignores the secretary who also left', () => {
    expect(verdict.flags.find((flag) => flag.id === 'officer-churn')?.params).toEqual({ count: 2 });
  });

  it('is not partial — everything was checked, and everything was bad', () => {
    expect(verdict.partial).toBe(false);
    expect(verdict.notChecked).toEqual([]);
  });
});

describe('99000002 CEASED HOLDINGS LIMITED', () => {
  const verdict = verdictOf('99000002');

  it('reads red on its terminal status', () => {
    expect(verdict.overall).toBe('red');
    expect(verdict.flags.map((flag) => flag.id)).toContain('status-terminal');
    expect(verdict.flags.find((flag) => flag.id === 'status-terminal')?.params).toEqual({
      status: 'liquidation',
    });
  });

  it('does not raise a stale name change from 2021', () => {
    expect(verdict.flags.map((flag) => flag.id)).not.toContain('name-change');
  });

  it('is not partial, even though it has no charges to fetch', () => {
    // `not-applicable` is an answer. Marking it partial would train users to
    // ignore the badge that matters.
    expect(verdict.partial).toBe(false);
  });
});

describe('99000003 NEWCO VENTURES LIMITED', () => {
  const verdict = verdictOf('99000003');

  it('raises both young-company flags together', () => {
    expect(verdict.flags.map((flag) => flag.id)).toEqual([
      'young-no-accounts',
      'recent-move-young',
    ]);
    expect(verdict.overall).toBe('amber');
  });

  it('reports its age, so the message can be specific', () => {
    // Incorporated 16 February 2026, frozen "now" is 29 July 2026.
    expect(verdict.flags.find((flag) => flag.id === 'young-no-accounts')?.params).toEqual({
      months: 5,
    });
  });

  it('does not treat having filed nothing as being overdue', () => {
    expect(verdict.flags.map((flag) => flag.id)).not.toContain('accounts-overdue');
  });
});

describe('a partial fetch on the healthiest company in the set', () => {
  it('withholds the all-clear and says which check was skipped', () => {
    // The point of running this against Tesco: even the company with nothing
    // whatsoever against it must not be reported as clear when a check did not
    // run. That is the whole safety property, tested where it is least likely
    // to be noticed if it broke.
    const fixture = getCompanyFixture('00445790')!;
    const snapshot = composeSnapshot({
      profile: fixture.profile,
      officers: { status: 'failed' },
      charges: { status: 'ok', data: fixture.charges! },
      filings: { status: 'ok', data: fixture.filings! },
      fetchedAt: NOW,
    });
    const verdict = evaluateSnapshotAt(snapshot, NOW);

    expect(verdict.flags.map((flag) => flag.id)).not.toContain('all-clear');
    expect(verdict.notChecked).toContain('officer-churn');
    expect(verdict.notChecked).toContain('all-clear');
    expect(verdict.partial).toBe(true);
    // Everything that could be checked still is.
    expect(verdict.flags.map((flag) => flag.id)).toContain('charges-outstanding');
  });
});
