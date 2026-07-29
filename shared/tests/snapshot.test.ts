import { describe, expect, it } from 'vitest';
import type { ChCompanyProfile } from '../src/types/companiesHouse.js';
import {
  UnusableProfileError,
  composeSnapshot,
  normaliseSearch,
} from '../src/normalise/snapshot.js';
import type { SnapshotInputs } from '../src/normalise/snapshot.js';

const FETCHED_AT = new Date('2026-07-29T10:00:00Z');

const TESCO: ChCompanyProfile = {
  company_name: 'TESCO PLC',
  company_number: '00445790',
  company_status: 'active',
  type: 'plc',
  jurisdiction: 'england-wales',
  date_of_creation: '1947-11-27',
  sic_codes: ['47110'],
  registered_office_address: { address_line_1: 'Welwyn Garden City', postal_code: 'AL7 1GA' },
  accounts: {
    overdue: false,
    next_due: '2026-11-30',
    last_accounts: { period_end_on: '2026-02-28' },
  },
  confirmation_statement: { overdue: false, next_due: '2026-08-15' },
  links: { self: '/company/00445790' },
};

const inputs = (overrides: Partial<SnapshotInputs> = {}): SnapshotInputs => ({
  profile: TESCO,
  officers: { status: 'ok', data: { active_count: 12, resigned_count: 30, items: [] } },
  charges: { status: 'ok', data: { total_count: 0, items: [] } },
  filings: { status: 'ok', data: { items: [] } },
  fetchedAt: FETCHED_AT,
  ...overrides,
});

describe('composeSnapshot', () => {
  it('carries facts and no judgement', () => {
    const snapshot = composeSnapshot(inputs());
    expect(snapshot.name).toBe('TESCO PLC');
    expect(snapshot.number).toBe('00445790');
    expect(snapshot.status).toBe('active');
    expect(snapshot.incorporatedOn).toBe('1947-11-27');
    expect(snapshot.fetchedAt).toBe('2026-07-29T10:00:00.000Z');
    // No flags, no severity, no score anywhere in the contract.
    expect(snapshot).not.toHaveProperty('flags');
    expect(snapshot).not.toHaveProperty('severity');
    expect(snapshot).not.toHaveProperty('score');
  });

  it('normalises the company number, so a padded profile still keys correctly', () => {
    const snapshot = composeSnapshot(inputs({ profile: { ...TESCO, company_number: '445790' } }));
    expect(snapshot.number).toBe('00445790');
  });

  it('records every source and is not partial when all four succeeded', () => {
    const snapshot = composeSnapshot(inputs());
    expect(snapshot.sources).toEqual({
      profile: 'ok',
      officers: 'ok',
      charges: 'ok',
      filings: 'ok',
    });
    expect(snapshot.partial).toBe(false);
  });

  it('is partial when a source failed', () => {
    const snapshot = composeSnapshot(inputs({ officers: { status: 'failed' } }));
    expect(snapshot.sources.officers).toBe('failed');
    expect(snapshot.partial).toBe(true);
  });

  it('is partial when a source was deliberately skipped', () => {
    // The Worker sheds optional depth in brownout to stay inside the Companies
    // House rate limit. The reader is still less informed than they asked to be.
    const snapshot = composeSnapshot(inputs({ charges: { status: 'skipped' } }));
    expect(snapshot.sources.charges).toBe('skipped');
    expect(snapshot.partial).toBe(true);
  });

  it('is NOT partial when a source is not applicable', () => {
    // "This company has no charges" is a fact, not a gap. Marking it partial
    // would train users to ignore the partial badge.
    const snapshot = composeSnapshot(inputs({ charges: { status: 'not-applicable' } }));
    expect(snapshot.sources.charges).toBe('not-applicable');
    expect(snapshot.partial).toBe(false);
  });

  it('leaves zeroed counts behind a failed source rather than presenting them as fact', () => {
    // The counts are zero because there is nothing to count. What makes that
    // safe is `sources.officers`, which the flag engine reads before it will
    // say anything about officer churn.
    const snapshot = composeSnapshot(inputs({ officers: { status: 'failed' } }));
    expect(snapshot.officers).toEqual({
      activeCount: 0,
      resignedCount: 0,
      appointedLast6m: 0,
      resignedLast6m: 0,
    });
    expect(snapshot.sources.officers).toBe('failed');
  });

  it('derives the office move and rename dates from filing history', () => {
    const snapshot = composeSnapshot(
      inputs({
        filings: {
          status: 'ok',
          data: {
            items: [
              { date: '2026-05-10', category: 'address', type: 'AD01', description: 'x' },
              { date: '2025-02-14', category: 'change-of-name', description: 'x' },
            ],
          },
        },
      }),
    );
    expect(snapshot.registeredOfficeChangedOn).toBe('2026-05-10');
    expect(snapshot.nameChangedOn).toBe('2025-02-14');
  });

  it('omits both dates when filing history was not fetched', () => {
    const snapshot = composeSnapshot(inputs({ filings: { status: 'failed' } }));
    expect(snapshot.registeredOfficeChangedOn).toBeUndefined();
    expect(snapshot.nameChangedOn).toBeUndefined();
    expect(snapshot.sources.filings).toBe('failed');
  });

  it('carries the strike-off status detail through', () => {
    const snapshot = composeSnapshot(
      inputs({
        profile: {
          ...TESCO,
          company_status_detail: 'active-proposal-to-strike-off',
        },
      }),
    );
    expect(snapshot.statusDetail).toBe('active-proposal-to-strike-off');
  });

  it('omits optional fields entirely rather than setting them undefined', () => {
    const snapshot = composeSnapshot(inputs());
    // Matters because the snapshot is serialised into a cache; an explicit
    // undefined and an absent key are not the same thing after a round trip.
    expect('statusDetail' in snapshot).toBe(false);
    expect('cessationOn' in snapshot).toBe(false);
  });

  it('refuses a profile with no status rather than assuming active', () => {
    // Status drives the most severe flags there are. Defaulting it would be the
    // worst failure this code could have.
    const { company_status: _status, ...statusless } = TESCO;
    expect(() => composeSnapshot(inputs({ profile: statusless }))).toThrow(UnusableProfileError);
  });

  it('refuses a profile with no name or no usable number', () => {
    expect(() => composeSnapshot(inputs({ profile: { ...TESCO, company_name: '  ' } }))).toThrow(
      UnusableProfileError,
    );
    expect(() =>
      composeSnapshot(inputs({ profile: { ...TESCO, company_number: 'nonsense' } })),
    ).toThrow(UnusableProfileError);
  });

  it('counts officer movements against the fetch date, not the reader clock', () => {
    const snapshot = composeSnapshot(
      inputs({
        officers: {
          status: 'ok',
          data: {
            active_count: 2,
            resigned_count: 3,
            items: [
              { officer_role: 'director', resigned_on: '2026-06-01' },
              { officer_role: 'director', resigned_on: '2026-03-01' },
              { officer_role: 'director', resigned_on: '2024-01-01' },
            ],
          },
        },
      }),
    );
    expect(snapshot.officers.resignedLast6m).toBe(2);
  });
});

describe('normaliseSearch', () => {
  it('maps hits and normalises their numbers', () => {
    const response = normaliseSearch(
      {
        total_results: 2,
        items: [
          {
            company_number: '445790',
            title: 'TESCO PLC',
            company_status: 'active',
            company_type: 'plc',
            date_of_creation: '1947-11-27',
            address_snippet: 'Welwyn Garden City, AL7 1GA',
          },
          { company_number: 'SC1234', title: 'TESCO BANK', company_status: 'dissolved' },
        ],
      },
      FETCHED_AT,
    );

    expect(response.hits).toHaveLength(2);
    expect(response.hits[0]?.number).toBe('00445790');
    expect(response.hits[0]?.addressSnippet).toBe('Welwyn Garden City, AL7 1GA');
    expect(response.hits[1]?.number).toBe('SC001234');
    expect(response.totalResults).toBe(2);
  });

  it('never echoes the query back', () => {
    // A cached search response therefore contains no user input at all, which
    // is what makes caching search results a non-issue for privacy.
    const response = normaliseSearch({ items: [] }, FETCHED_AT);
    expect(JSON.stringify(response)).not.toContain('q=');
    expect(response).not.toHaveProperty('query');
  });

  it('drops hits that cannot be identified', () => {
    const response = normaliseSearch(
      { total_results: 3, items: [{ title: 'NO NUMBER LTD' }, { company_number: '00445790' }] },
      FETCHED_AT,
    );
    expect(response.hits).toEqual([]);
  });

  it('reports the upstream total even when it exceeds the hits returned', () => {
    const response = normaliseSearch(
      { total_results: 940, items: [{ company_number: '00445790', title: 'TESCO PLC' }] },
      FETCHED_AT,
    );
    expect(response.hits).toHaveLength(1);
    expect(response.totalResults).toBe(940);
  });

  it('survives an absent response', () => {
    expect(normaliseSearch(undefined, FETCHED_AT)).toEqual({
      hits: [],
      totalResults: 0,
      fetchedAt: '2026-07-29T10:00:00.000Z',
    });
  });
});
