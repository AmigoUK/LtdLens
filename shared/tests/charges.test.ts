import { describe, expect, it } from 'vitest';
import type { ChChargeList } from '../src/types/companiesHouse.js';
import { normaliseCharges } from '../src/normalise/charges.js';

describe('normaliseCharges', () => {
  it('counts outstanding charges from their statuses', () => {
    const list: ChChargeList = {
      total_count: 3,
      satisfied_count: 1,
      items: [
        { charge_number: 1, status: 'outstanding', created_on: '2024-01-01' },
        { charge_number: 2, status: 'satisfied', created_on: '2020-01-01' },
        { charge_number: 3, status: 'outstanding', created_on: '2025-06-01' },
      ],
    };
    expect(normaliseCharges(list).outstanding).toBe(2);
  });

  it('counts a part-satisfied charge as outstanding', () => {
    // Partly satisfied still means a lender holds security over company assets.
    const list: ChChargeList = {
      total_count: 1,
      part_satisfied_count: 1,
      items: [{ charge_number: 1, status: 'part-satisfied', created_on: '2024-01-01' }],
    };
    const facts = normaliseCharges(list);
    expect(facts.outstanding).toBe(1);
    expect(facts.partSatisfied).toBe(1);
  });

  it('derives the count from totals when the item list is truncated', () => {
    // Charge lists paginate. If we hold fewer items than the total, counting
    // items would under-report.
    const list: ChChargeList = {
      total_count: 40,
      satisfied_count: 10,
      items: [{ charge_number: 1, status: 'outstanding', created_on: '2024-01-01' }],
    };
    expect(normaliseCharges(list).outstanding).toBe(30);
  });

  it('reports the most recent outstanding charge', () => {
    const list: ChChargeList = {
      total_count: 3,
      items: [
        { status: 'outstanding', created_on: '2024-01-01' },
        { status: 'outstanding', created_on: '2025-06-01' },
        { status: 'satisfied', created_on: '2026-01-01' },
      ],
    };
    // The 2026 charge is satisfied, so it is not the most recent *outstanding* one.
    expect(normaliseCharges(list).mostRecentCreatedOn).toBe('2025-06-01');
  });

  it('omits the date when nothing is outstanding', () => {
    const list: ChChargeList = {
      total_count: 1,
      satisfied_count: 1,
      items: [{ status: 'satisfied', created_on: '2020-01-01' }],
    };
    const facts = normaliseCharges(list);
    expect(facts.outstanding).toBe(0);
    expect(facts.mostRecentCreatedOn).toBeUndefined();
  });

  it('ignores unparseable creation dates', () => {
    const list: ChChargeList = {
      total_count: 1,
      items: [{ status: 'outstanding', created_on: 'unknown' }],
    };
    expect(normaliseCharges(list).mostRecentCreatedOn).toBeUndefined();
  });

  it('handles a company with no charges', () => {
    expect(normaliseCharges({ total_count: 0, items: [] })).toEqual({
      outstanding: 0,
      satisfied: 0,
      partSatisfied: 0,
    });
  });

  it('returns zeroes for an absent list without throwing', () => {
    expect(normaliseCharges(undefined)).toEqual({
      outstanding: 0,
      satisfied: 0,
      partSatisfied: 0,
    });
  });

  it('never reports a negative count', () => {
    // Companies House totals occasionally disagree with each other.
    const list: ChChargeList = { total_count: 1, satisfied_count: 5, items: [] };
    expect(normaliseCharges(list).outstanding).toBe(0);
  });
});
