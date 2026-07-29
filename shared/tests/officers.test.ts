import { describe, expect, it } from 'vitest';
import type { ChOfficer, ChOfficerList } from '../src/types/companiesHouse.js';
import { isResponsibleOfficer, normaliseOfficers } from '../src/normalise/officers.js';

const NOW = { year: 2026, month: 7, day: 29 };

const officer = (overrides: Partial<ChOfficer> = {}): ChOfficer => ({
  name: 'SMITH, Jane',
  officer_role: 'director',
  appointed_on: '2020-01-01',
  ...overrides,
});

describe('isResponsibleOfficer', () => {
  it('counts directors, LLP members and managing officers', () => {
    for (const role of [
      'director',
      'corporate-director',
      'nominee-director',
      'llp-member',
      'llp-designated-member',
      'managing-officer',
      'judicial-factor',
    ]) {
      expect(isResponsibleOfficer(officer({ officer_role: role }))).toBe(true);
    }
  });

  it('excludes secretaries', () => {
    // A secretary changing is administrative noise. Counting it as churn would
    // flag ordinary housekeeping as a warning sign.
    expect(isResponsibleOfficer(officer({ officer_role: 'secretary' }))).toBe(false);
    expect(isResponsibleOfficer(officer({ officer_role: 'corporate-secretary' }))).toBe(false);
  });

  it('excludes receivers and liquidators', () => {
    // Their appointment is already reported far more directly by the company
    // status, which raises a red flag on its own.
    expect(isResponsibleOfficer(officer({ officer_role: 'receiver-and-manager' }))).toBe(false);
  });

  it('is case-insensitive and survives a missing role', () => {
    expect(isResponsibleOfficer(officer({ officer_role: 'DIRECTOR' }))).toBe(true);
    // The key is removed rather than set to undefined: with
    // exactOptionalPropertyTypes those are different types, and it is absence
    // we are testing for.
    const { officer_role: _role, ...roleless } = officer();
    expect(isResponsibleOfficer(roleless)).toBe(false);
  });
});

describe('normaliseOfficers', () => {
  it("trusts the response's own totals over counting items", () => {
    // The list is paginated at 35 by default. A company with 60 directors would
    // be undercounted by counting items — silently, and in the direction that
    // hides churn.
    const list: ChOfficerList = {
      active_count: 60,
      resigned_count: 12,
      items: [officer()],
    };
    const facts = normaliseOfficers(list, NOW);
    expect(facts.activeCount).toBe(60);
    expect(facts.resignedCount).toBe(12);
  });

  it('falls back to counting when the totals are absent', () => {
    const list: ChOfficerList = {
      items: [officer(), officer(), officer({ resigned_on: '2025-01-01' })],
    };
    const facts = normaliseOfficers(list, NOW);
    expect(facts.activeCount).toBe(2);
    expect(facts.resignedCount).toBe(1);
  });

  it('counts appointments and resignations inside the six-month window', () => {
    const list: ChOfficerList = {
      items: [
        officer({ resigned_on: '2026-06-01' }), // within
        officer({ resigned_on: '2026-02-01' }), // within
        officer({ resigned_on: '2025-12-01' }), // outside
        officer({ appointed_on: '2026-07-01' }), // within
        officer({ appointed_on: '2024-01-01' }), // outside
      ],
    };
    const facts = normaliseOfficers(list, NOW);
    expect(facts.resignedLast6m).toBe(2);
    expect(facts.appointedLast6m).toBe(1);
  });

  it('holds the six-month boundary exactly', () => {
    // 29 January 2026 is six months before 29 July 2026, so it is outside;
    // the 30th is inside. This boundary decides whether officer churn fires.
    expect(
      normaliseOfficers({ items: [officer({ resigned_on: '2026-01-30' })] }, NOW).resignedLast6m,
    ).toBe(1);
    expect(
      normaliseOfficers({ items: [officer({ resigned_on: '2026-01-29' })] }, NOW).resignedLast6m,
    ).toBe(0);
  });

  it('ignores movements of officers whose role does not carry responsibility', () => {
    const list: ChOfficerList = {
      items: [
        officer({ officer_role: 'secretary', resigned_on: '2026-06-01' }),
        officer({ officer_role: 'director', resigned_on: '2026-06-01' }),
      ],
    };
    expect(normaliseOfficers(list, NOW).resignedLast6m).toBe(1);
  });

  it('ignores dates that do not parse', () => {
    expect(
      normaliseOfficers({ items: [officer({ resigned_on: 'sometime last year' })] }, NOW)
        .resignedLast6m,
    ).toBe(0);
  });

  it('does not count future-dated movements as recent', () => {
    expect(
      normaliseOfficers({ items: [officer({ resigned_on: '2026-09-01' })] }, NOW).resignedLast6m,
    ).toBe(0);
  });

  it('returns zeroes for an absent list without throwing', () => {
    // Note this is only reached when the caller has already recorded the source
    // as skipped or failed; the zeroes are never presented as a clean result.
    expect(normaliseOfficers(undefined, NOW)).toEqual({
      activeCount: 0,
      resignedCount: 0,
      appointedLast6m: 0,
      resignedLast6m: 0,
    });
  });
});
