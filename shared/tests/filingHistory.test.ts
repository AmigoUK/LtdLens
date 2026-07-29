import { describe, expect, it } from 'vitest';
import type { ChFilingHistoryList } from '../src/types/companiesHouse.js';
import {
  RECENT_FILINGS_LIMIT,
  nameChangedOn,
  normaliseRecentFilings,
  registeredOfficeChangedOn,
} from '../src/normalise/filingHistory.js';

describe('normaliseRecentFilings', () => {
  it('returns the most recent filings first, regardless of upstream order', () => {
    const list: ChFilingHistoryList = {
      items: [
        {
          date: '2024-01-01',
          category: 'accounts',
          description: 'accounts-with-accounts-type-small',
        },
        {
          date: '2026-06-01',
          category: 'officers',
          description: 'appoint-person-director-company',
        },
        {
          date: '2025-03-01',
          category: 'address',
          description: 'change-registered-office-address',
        },
      ],
    };
    expect(normaliseRecentFilings(list).map((filing) => filing.date)).toEqual([
      '2026-06-01',
      '2025-03-01',
      '2024-01-01',
    ]);
  });

  it('caps the list', () => {
    const list: ChFilingHistoryList = {
      items: Array.from({ length: 25 }, (_, index) => ({
        date: `2026-01-${String(index + 1).padStart(2, '0')}`,
        category: 'accounts',
        description: 'accounts',
      })),
    };
    expect(normaliseRecentFilings(list)).toHaveLength(RECENT_FILINGS_LIMIT);
  });

  it('keeps the raw description template rather than resolving it', () => {
    // Resolving the template to English is the extension's job, offline. That
    // keeps the Worker dumb and the wording translatable.
    const list: ChFilingHistoryList = {
      items: [
        {
          date: '2026-06-01',
          category: 'address',
          description: 'change-registered-office-address-company-with-date-old-address-new-address',
          type: 'AD01',
        },
      ],
    };
    const [filing] = normaliseRecentFilings(list);
    expect(filing?.description).toBe(
      'change-registered-office-address-company-with-date-old-address-new-address',
    );
    expect(filing?.type).toBe('AD01');
  });

  it('drops filings with no usable date', () => {
    const list: ChFilingHistoryList = {
      items: [{ category: 'accounts', description: 'accounts' }, { date: 'n/a' }],
    };
    expect(normaliseRecentFilings(list)).toEqual([]);
  });

  it('defaults a missing category rather than dropping the filing', () => {
    const [filing] = normaliseRecentFilings({ items: [{ date: '2026-01-01' }] });
    expect(filing?.category).toBe('miscellaneous');
    expect(filing?.description).toBe('');
  });

  it('survives an absent list', () => {
    expect(normaliseRecentFilings(undefined)).toEqual([]);
  });
});

describe('registeredOfficeChangedOn', () => {
  it('reports the most recent registered office move', () => {
    const list: ChFilingHistoryList = {
      items: [
        { date: '2022-01-01', category: 'address', type: 'AD01', description: 'x' },
        { date: '2026-05-10', category: 'address', type: 'AD01', description: 'x' },
      ],
    };
    expect(registeredOfficeChangedOn(list)).toBe('2026-05-10');
  });

  it('ignores single alternative inspection location filings', () => {
    // AD02 and friends sit in the same `address` category but are not moves.
    // Counting them would fire the "recently moved" rule on paperwork nobody
    // would consider a move.
    const list: ChFilingHistoryList = {
      items: [
        { date: '2026-05-10', category: 'address', type: 'AD02', description: 'x' },
        { date: '2023-01-01', category: 'address', type: 'AD01', description: 'x' },
      ],
    };
    expect(registeredOfficeChangedOn(list)).toBe('2023-01-01');
  });

  it('falls back to the description on older records that carry no type', () => {
    const list: ChFilingHistoryList = {
      items: [
        {
          date: '2011-04-02',
          category: 'address',
          description: 'change-registered-office-address-company-with-date',
        },
      ],
    };
    expect(registeredOfficeChangedOn(list)).toBe('2011-04-02');
  });

  it('is undefined when the company has never moved', () => {
    expect(
      registeredOfficeChangedOn({ items: [{ date: '2024-01-01', category: 'accounts' }] }),
    ).toBeUndefined();
  });

  it('is undefined when filing history was not fetched', () => {
    // The caller records the source as skipped or failed; the rules that need
    // this then report "not checked" rather than "no recent move".
    expect(registeredOfficeChangedOn(undefined)).toBeUndefined();
  });
});

describe('nameChangedOn', () => {
  it('reports the most recent change of name', () => {
    const list: ChFilingHistoryList = {
      items: [
        { date: '2019-01-01', category: 'change-of-name', description: 'x' },
        { date: '2026-02-14', category: 'change-of-name', description: 'x' },
      ],
    };
    expect(nameChangedOn(list)).toBe('2026-02-14');
  });

  it('is undefined for a company that has never been renamed', () => {
    expect(
      nameChangedOn({ items: [{ date: '2024-01-01', category: 'accounts' }] }),
    ).toBeUndefined();
    expect(nameChangedOn(undefined)).toBeUndefined();
  });
});
