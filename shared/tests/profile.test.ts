import { describe, expect, it } from 'vitest';
import type { ChCompanyProfile } from '../src/types/companiesHouse.js';
import {
  hasChargesLink,
  hasInsolvencyHistory,
  normaliseAccounts,
  normaliseAddress,
  normaliseConfirmationStatement,
  normalisePreviousNames,
  normaliseRegisteredOffice,
} from '../src/normalise/profile.js';

describe('normaliseAddress', () => {
  it('maps the fields it uses and drops the rest', () => {
    expect(
      normaliseAddress({
        premises: '1',
        address_line_1: 'Newton Street',
        address_line_2: 'First Floor',
        locality: 'Manchester',
        region: 'Greater Manchester',
        postal_code: 'M1 1FT',
        country: 'United Kingdom',
        care_of: 'ignored',
        po_box: 'ignored',
      }),
    ).toEqual({
      premises: '1',
      addressLine1: 'Newton Street',
      addressLine2: 'First Floor',
      locality: 'Manchester',
      region: 'Greater Manchester',
      postalCode: 'M1 1FT',
      country: 'United Kingdom',
    });
  });

  it('omits empty and whitespace-only fields rather than storing blanks', () => {
    expect(normaliseAddress({ address_line_1: '  ', locality: 'Leeds' })).toEqual({
      locality: 'Leeds',
    });
  });

  it('survives a missing address entirely', () => {
    expect(normaliseAddress(undefined)).toEqual({});
  });
});

describe('normaliseRegisteredOffice', () => {
  it('surfaces the dispute and undeliverable flags', () => {
    const office = normaliseRegisteredOffice({
      registered_office_address: { locality: 'Cardiff' },
      registered_office_is_in_dispute: true,
      undeliverable_registered_office_address: true,
    });
    expect(office.inDispute).toBe(true);
    expect(office.undeliverable).toBe(true);
    expect(office.locality).toBe('Cardiff');
  });

  it('defaults both flags to false when absent', () => {
    const office = normaliseRegisteredOffice({});
    expect(office.inDispute).toBe(false);
    expect(office.undeliverable).toBe(false);
  });
});

describe('normaliseAccounts', () => {
  it('reports overdue when either place Companies House states it says so', () => {
    // The two fields can disagree while a filing is being processed.
    // Under-reporting "overdue" is the failure that costs a user money.
    expect(normaliseAccounts({ accounts: { overdue: true } }).overdue).toBe(true);
    expect(normaliseAccounts({ accounts: { next_accounts: { overdue: true } } }).overdue).toBe(
      true,
    );
    expect(
      normaliseAccounts({ accounts: { overdue: false, next_accounts: { overdue: true } } }).overdue,
    ).toBe(true);
  });

  it('never infers overdue from dates', () => {
    // next_due is years past, but Companies House does not say overdue —
    // filing extensions and grace periods are invisible to us, so we defer.
    expect(normaliseAccounts({ accounts: { next_due: '2020-01-01' } }).overdue).toBe(false);
  });

  it('is not overdue when Companies House is silent', () => {
    expect(normaliseAccounts({}).overdue).toBe(false);
    expect(normaliseAccounts({ accounts: {} }).overdue).toBe(false);
  });

  it('prefers period_end_on over the deprecated made_up_to', () => {
    expect(
      normaliseAccounts({
        accounts: { last_accounts: { period_end_on: '2025-07-31', made_up_to: '2025-01-01' } },
      }).lastPeriodEndOn,
    ).toBe('2025-07-31');
  });

  it('falls back to made_up_to on records that carry only that', () => {
    expect(
      normaliseAccounts({ accounts: { last_accounts: { made_up_to: '2025-01-01' } } })
        .lastPeriodEndOn,
    ).toBe('2025-01-01');
  });

  it('distinguishes "never filed" from "we could not tell"', () => {
    // A company incorporated last month legitimately has no accounts. That is a
    // fact the young-company rule depends on, not a gap in our knowledge.
    expect(normaliseAccounts({ accounts: {} }).hasEverFiled).toBe(false);
    expect(
      normaliseAccounts({ accounts: { last_accounts: { period_end_on: '2025-07-31' } } })
        .hasEverFiled,
    ).toBe(true);
    // A type with no date still proves something was filed.
    expect(
      normaliseAccounts({ accounts: { last_accounts: { type: 'micro-entity' } } }).hasEverFiled,
    ).toBe(true);
  });

  it('drops dates that do not parse instead of passing rubbish downstream', () => {
    expect(normaliseAccounts({ accounts: { next_due: 'not-a-date' } }).nextDue).toBeUndefined();
    expect(normaliseAccounts({ accounts: { next_due: '2026-02-30' } }).nextDue).toBeUndefined();
  });

  it('falls back to next_accounts.due_on when next_due is absent', () => {
    expect(
      normaliseAccounts({ accounts: { next_accounts: { due_on: '2026-10-23' } } }).nextDue,
    ).toBe('2026-10-23');
  });
});

describe('normaliseConfirmationStatement', () => {
  it('reads overdue and the dates', () => {
    const statement = normaliseConfirmationStatement({
      confirmation_statement: {
        overdue: true,
        next_due: '2026-07-06',
        last_made_up_to: '2025-06-22',
      },
    });
    expect(statement).toEqual({
      overdue: true,
      nextDue: '2026-07-06',
      lastMadeUpTo: '2025-06-22',
    });
  });

  it('is not overdue when absent', () => {
    expect(normaliseConfirmationStatement({}).overdue).toBe(false);
  });
});

describe('normalisePreviousNames', () => {
  it('orders most recently ceased first, so a rename reads off the head', () => {
    const names = normalisePreviousNames([
      { name: 'OLDEST LTD', ceased_on: '2015-01-01', effective_from: '2010-01-01' },
      { name: 'NEWEST LTD', ceased_on: '2024-06-01', effective_from: '2015-01-01' },
      { name: 'MIDDLE LTD', ceased_on: '2020-03-01', effective_from: '2015-01-01' },
    ]);
    expect(names.map((entry) => entry.name)).toEqual(['NEWEST LTD', 'MIDDLE LTD', 'OLDEST LTD']);
  });

  it('drops entries with no usable name', () => {
    expect(normalisePreviousNames([{ ceased_on: '2024-01-01' }, { name: '  ' }])).toEqual([]);
  });

  it('returns an empty list rather than undefined', () => {
    expect(normalisePreviousNames(undefined)).toEqual([]);
    expect(normalisePreviousNames([])).toEqual([]);
  });
});

describe('hasInsolvencyHistory', () => {
  it('reads the link, which supersedes the deprecated boolean', () => {
    const profile: ChCompanyProfile = { links: { insolvency: '/company/00000001/insolvency' } };
    expect(hasInsolvencyHistory(profile)).toBe(true);
  });

  it('still reads the deprecated boolean, for older recordings', () => {
    expect(hasInsolvencyHistory({ has_insolvency_history: true })).toBe(true);
  });

  it('is false when neither is present', () => {
    expect(hasInsolvencyHistory({})).toBe(false);
    expect(hasInsolvencyHistory({ links: {} })).toBe(false);
  });
});

describe('hasChargesLink', () => {
  it('reads the link or the deprecated boolean', () => {
    expect(hasChargesLink({ links: { charges: '/company/00000001/charges' } })).toBe(true);
    expect(hasChargesLink({ has_charges: true })).toBe(true);
    expect(hasChargesLink({})).toBe(false);
  });
});
