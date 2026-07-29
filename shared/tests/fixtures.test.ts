/**
 * Runs every fixture through the real normalisers.
 *
 * This is the only thing standing between hand-authored payloads and code that
 * merely *looks* correct. It cannot prove the fixtures match what Companies
 * House actually returns — only re-recording against the live API can do that —
 * but it does prove the normalisers cope with the shapes we believe exist, and
 * that each fixture exercises what its README entry claims it does.
 */

import { describe, expect, it } from 'vitest';
import { getCompanyFixture, getSearchFixture, listCompanyFixtures } from '@ltdlens/fixtures';
import { composeSnapshot, normaliseSearch } from '../src/normalise/snapshot.js';
import type { SourceResult } from '../src/normalise/snapshot.js';
import type { CompanySnapshot } from '../src/types/snapshot.js';

/** Frozen so the tests do not rot as real deadlines roll forward. */
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

describe('every fixture composes into a usable snapshot', () => {
  for (const fixture of listCompanyFixtures()) {
    it(`${fixture.number} — ${fixture.name}`, () => {
      const snapshot = snapshotOf(fixture.number);
      expect(snapshot.number).toBe(fixture.number);
      expect(snapshot.name).toBe(fixture.name);
      expect(snapshot.status).toBeTruthy();
      expect(snapshot.sources.profile).toBe('ok');
      // Nothing was skipped or failed, so nothing is partial.
      expect(snapshot.partial).toBe(false);
    });
  }
});

describe('00445790 TESCO PLC — the all-clear baseline', () => {
  const snapshot = snapshotOf('00445790');

  it('is active with nothing overdue', () => {
    expect(snapshot.status).toBe('active');
    expect(snapshot.statusDetail).toBeUndefined();
    expect(snapshot.accounts.overdue).toBe(false);
    expect(snapshot.confirmationStatement.overdue).toBe(false);
  });

  it('is old enough to have a track record', () => {
    expect(snapshot.incorporatedOn).toBe('1947-11-27');
    expect(snapshot.accounts.hasEverFiled).toBe(true);
  });

  it('has one outstanding charge, which is information rather than a warning', () => {
    expect(snapshot.charges.outstanding).toBe(1);
    expect(snapshot.charges.mostRecentCreatedOn).toBe('2019-05-14');
  });

  it('has a stable board', () => {
    expect(snapshot.officers.activeCount).toBe(11);
    expect(snapshot.officers.resignedLast6m).toBe(0);
  });

  it('has not moved or been renamed recently', () => {
    expect(snapshot.registeredOfficeChangedOn).toBe('2011-04-02');
    expect(snapshot.nameChangedOn).toBeUndefined();
  });
});

describe('99000001 DISTRESSED TRADING — several red flags at once', () => {
  const snapshot = snapshotOf('99000001');

  it('is proposed for strike off while still nominally active', () => {
    expect(snapshot.status).toBe('active');
    expect(snapshot.statusDetail).toBe('active-proposal-to-strike-off');
  });

  it('has both filings overdue', () => {
    expect(snapshot.accounts.overdue).toBe(true);
    expect(snapshot.confirmationStatement.overdue).toBe(true);
  });

  it('has lost two directors in six months, ignoring the secretary who also left', () => {
    // Three people resigned; only the two directors count as churn.
    expect(snapshot.officers.resignedLast6m).toBe(2);
    expect(snapshot.officers.activeCount).toBe(1);
  });

  it('counts a part-satisfied charge as still outstanding', () => {
    expect(snapshot.charges.outstanding).toBe(2);
    expect(snapshot.charges.partSatisfied).toBe(1);
  });

  it('flags the registered office as undeliverable', () => {
    expect(snapshot.registeredOffice.undeliverable).toBe(true);
  });
});

describe('99000002 CEASED HOLDINGS — terminal status and a missing source', () => {
  const snapshot = snapshotOf('99000002');

  it('is in liquidation with insolvency filings on record', () => {
    expect(snapshot.status).toBe('liquidation');
    expect(snapshot.hasInsolvencyHistory).toBe(true);
  });

  it('treats absent charges as not applicable, not as a gap', () => {
    // The profile has no links.charges, so there is nothing to fetch. That is a
    // fact about the company, and marking it partial would train users to
    // ignore the partial badge.
    expect(snapshot.sources.charges).toBe('not-applicable');
    expect(snapshot.partial).toBe(false);
  });

  it('reports the rename from filing history', () => {
    expect(snapshot.nameChangedOn).toBe('2021-03-08');
    expect(snapshot.previousNames[0]?.name).toBe('BRIGHT FUTURE TRADING LIMITED');
  });
});

describe('99000003 NEWCO VENTURES — young, and recently moved', () => {
  const snapshot = snapshotOf('99000003');

  it('has never filed accounts, which is normal rather than concerning', () => {
    expect(snapshot.accounts.hasEverFiled).toBe(false);
    expect(snapshot.accounts.overdue).toBe(false);
  });

  it('was incorporated five months ago', () => {
    expect(snapshot.incorporatedOn).toBe('2026-02-16');
  });

  it('moved its registered office last month', () => {
    expect(snapshot.registeredOfficeChangedOn).toBe('2026-06-30');
  });
});

describe('a failed source never becomes a clean result', () => {
  it('records the failure and marks the snapshot partial', () => {
    const fixture = getCompanyFixture('00445790')!;
    const snapshot = composeSnapshot({
      profile: fixture.profile,
      officers: { status: 'failed' },
      charges: { status: 'ok', data: fixture.charges! },
      filings: { status: 'ok', data: fixture.filings! },
      fetchedAt: NOW,
    });

    expect(snapshot.sources.officers).toBe('failed');
    expect(snapshot.partial).toBe(true);
    // The counts are zero, but sources.officers is what the flag engine reads
    // before it will say anything about officer churn.
    expect(snapshot.officers.activeCount).toBe(0);
  });
});

describe('search fixtures', () => {
  it('returns disambiguation candidates for an ambiguous name', () => {
    const response = normaliseSearch(getSearchFixture('tesco'), NOW);
    expect(response.hits.length).toBeGreaterThanOrEqual(2);
    expect(response.hits[0]?.number).toBe('00445790');
    expect(response.totalResults).toBe(47);
  });

  it('matches on a prefix, so a fuller query still finds the fixture', () => {
    expect(getSearchFixture('Tesco PLC')).toBeDefined();
    expect(getSearchFixture('  TESCO  ')).toBeDefined();
  });

  it('carries a dissolved company, so the list must show status', () => {
    const response = normaliseSearch(getSearchFixture('tesco'), NOW);
    const dissolved = response.hits.find((hit) => hit.status === 'dissolved');
    expect(dissolved?.cessationOn).toBe('2015-03-10');
  });

  it('has no fixture for an unknown query', () => {
    expect(getSearchFixture('nothing like this')).toBeUndefined();
  });
});
