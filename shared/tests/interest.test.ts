import { describe, expect, it } from 'vitest';
import {
  RECOVERY_LIMIT_YEARS,
  calculateStatutoryInterest,
  compensationFor,
} from '../src/rates/calculator.js';
import { RATE_PERIODS, ratePeriodFor, statutoryRateBp } from '../src/rates/table.js';
import type { CalendarDate } from '../src/normalise/dates.js';

const d = (year: number, month: number, day: number): CalendarDate => ({ year, month, day });
const pounds = (value: number) => Math.round(value * 100);

/** Convenience for the common case: assert a successful calculation. */
function calc(input: Parameters<typeof calculateStatutoryInterest>[0]) {
  const result = calculateStatutoryInterest(input);
  if (result.status !== 'ok') throw new Error(`Expected ok, got ${result.status}`);
  return result;
}

describe('the rate table', () => {
  it('has no gaps or overlaps between consecutive periods', () => {
    for (let index = 1; index < RATE_PERIODS.length; index += 1) {
      const previous = RATE_PERIODS[index - 1]!;
      const current = RATE_PERIODS[index]!;
      const dayAfterPrevious = new Date(
        Date.UTC(previous.endsOn.year, previous.endsOn.month - 1, previous.endsOn.day + 1),
      );
      expect({
        year: dayAfterPrevious.getUTCFullYear(),
        month: dayAfterPrevious.getUTCMonth() + 1,
        day: dayAfterPrevious.getUTCDate(),
      }).toEqual(current.startsOn);
    }
  });

  it('takes each period from the fixing immediately before it', () => {
    // First half of a year reads the previous 31 December; second half reads
    // that year's 30 June. Getting this backwards is the classic error.
    const h1of2026 = ratePeriodFor(d(2026, 3, 15))!;
    expect(h1of2026.fixedOn).toEqual(d(2025, 12, 31));

    const h2of2026 = ratePeriodFor(d(2026, 9, 15))!;
    expect(h2of2026.fixedOn).toEqual(d(2026, 6, 30));
  });

  it('carries the rates verified against published tables', () => {
    // Spot checks across the range, cross-verified against two independent
    // published tables and, for 2020 and 2025-26, against MPC summaries.
    expect(statutoryRateBp(ratePeriodFor(d(2021, 3, 1))!)).toBe(810); // 0.10% + 8%
    expect(statutoryRateBp(ratePeriodFor(d(2022, 9, 1))!)).toBe(925); // 1.25% + 8%
    expect(statutoryRateBp(ratePeriodFor(d(2024, 3, 1))!)).toBe(1325); // 5.25% + 8%
    expect(statutoryRateBp(ratePeriodFor(d(2026, 3, 1))!)).toBe(1175); // 3.75% + 8%
  });

  it('does not cover dates before the regime took its current form', () => {
    expect(ratePeriodFor(d(2002, 8, 6))).toBeUndefined();
    expect(ratePeriodFor(d(2002, 8, 7))).toBeDefined();
  });
});

describe('the period is chosen by when interest starts to run, not when the debt fell due', () => {
  // This is the correction to the project's concept document, and it is not
  // cosmetic: at the June 2023 boundary the two readings differ by 1.5
  // percentage points, in a figure the user pastes into a demand letter.

  it('a debt due on 30 June takes the 30 June rate, not the previous December', () => {
    // Due 30 June 2023 → interest starts 1 July 2023 → H2 2023 → 5.00% + 8%.
    const result = calc({
      amountPence: pounds(10_000),
      dueDate: d(2023, 6, 30),
      paidDate: d(2023, 8, 1),
      asAt: d(2023, 8, 1),
    });
    expect(result.statutoryRateBp).toBe(1300);
    expect(result.period.fixedOn).toEqual(d(2023, 6, 30));
  });

  it('a debt due one day earlier takes the previous December rate', () => {
    // Due 29 June 2023 → interest starts 30 June 2023 → H1 2023 → 3.50% + 8%.
    const result = calc({
      amountPence: pounds(10_000),
      dueDate: d(2023, 6, 29),
      paidDate: d(2023, 8, 1),
      asAt: d(2023, 8, 1),
    });
    expect(result.statutoryRateBp).toBe(1150);
    expect(result.period.fixedOn).toEqual(d(2022, 12, 31));
  });

  it('holds the same boundary at the turn of the year', () => {
    // Due 31 December 2022 → interest starts 1 January 2023 → H1 2023.
    const newYear = calc({
      amountPence: pounds(5_000),
      dueDate: d(2022, 12, 31),
      paidDate: d(2023, 3, 1),
      asAt: d(2023, 3, 1),
    });
    expect(newYear.statutoryRateBp).toBe(1150); // 3.50% + 8%

    // Due 30 December 2022 → interest starts 31 December 2022 → H2 2022.
    const oldYear = calc({
      amountPence: pounds(5_000),
      dueDate: d(2022, 12, 30),
      paidDate: d(2023, 3, 1),
      asAt: d(2023, 3, 1),
    });
    expect(oldYear.statutoryRateBp).toBe(925); // 1.25% + 8%
  });
});

describe('the rate is fixed for the life of the debt', () => {
  it('does not follow base rate movements across a period boundary', () => {
    // Interest starts 2 January 2024 (H1 2024, 5.25% + 8% = 13.25%) and runs
    // for over a year, through H2 2024 and into H1 2025 when the reference rate
    // had fallen to 4.75%. The debt keeps its original rate throughout.
    const result = calc({
      amountPence: pounds(10_000),
      dueDate: d(2024, 1, 1),
      paidDate: d(2025, 3, 1),
      asAt: d(2025, 3, 1),
    });
    expect(result.statutoryRateBp).toBe(1325);
    expect(result.daysLate).toBe(425);
    // £10,000 × 13.25% ÷ 365 × 425 = £1,542.81
    expect(result.interestPence).toBe(154_281);
  });
});

describe('counting days', () => {
  it('runs from the day after the due date to the day of payment, both included', () => {
    // Due on the 31st, paid on the 1st: interest ran on exactly one day.
    const result = calc({
      amountPence: pounds(1_000),
      dueDate: d(2026, 1, 31),
      paidDate: d(2026, 2, 1),
      asAt: d(2026, 2, 1),
    });
    expect(result.interestFrom).toEqual(d(2026, 2, 1));
    expect(result.daysLate).toBe(1);
  });

  it('rolls the start date over a month end and a year end', () => {
    expect(
      calc({
        amountPence: pounds(1_000),
        dueDate: d(2025, 12, 31),
        paidDate: d(2026, 1, 5),
        asAt: d(2026, 1, 5),
      }).interestFrom,
    ).toEqual(d(2026, 1, 1));

    expect(
      calc({
        amountPence: pounds(1_000),
        dueDate: d(2024, 2, 28),
        paidDate: d(2024, 3, 5),
        asAt: d(2024, 3, 5),
      }).interestFrom,
    ).toEqual(d(2024, 2, 29)); // 2024 is a leap year
  });

  it('runs to today when the debt is still unpaid', () => {
    const result = calc({
      amountPence: pounds(1_000),
      dueDate: d(2026, 1, 1),
      asAt: d(2026, 7, 29),
    });
    expect(result.interestTo).toEqual(d(2026, 7, 29));
    expect(result.daysLate).toBe(209);
  });

  it('divides by 365 even in a leap year', () => {
    // The Act and gov.uk's worked example both use 365; there is no 366-day
    // variant, and inventing one would produce figures nobody can reconcile.
    const result = calc({
      amountPence: pounds(36_500),
      dueDate: d(2023, 12, 31),
      paidDate: d(2024, 12, 30),
      asAt: d(2024, 12, 30),
    });
    expect(result.daysLate).toBe(365); // 2024 is a leap year, but 365 days elapsed
    // £36,500 at 13.25% for exactly a year of 365 days = £4,836.25
    expect(result.interestPence).toBe(483_625);
  });
});

describe('nothing is owed when nothing is late', () => {
  it('reports a debt that is not yet due', () => {
    const result = calculateStatutoryInterest({
      amountPence: pounds(1_000),
      dueDate: d(2026, 12, 1),
      asAt: d(2026, 7, 29),
    });
    expect(result.status).toBe('nothing-owed');
    expect(result.warnings).toContain('not-yet-due');
  });

  it('reports a debt paid on the due date itself', () => {
    // Interest starts the day *after* the due date, so paying on the day owes
    // nothing.
    const result = calculateStatutoryInterest({
      amountPence: pounds(1_000),
      dueDate: d(2026, 3, 1),
      paidDate: d(2026, 3, 1),
      asAt: d(2026, 7, 29),
    });
    expect(result.status).toBe('nothing-owed');
    expect(result.warnings).toContain('paid-on-time');
  });

  it('reports a debt paid early', () => {
    const result = calculateStatutoryInterest({
      amountPence: pounds(1_000),
      dueDate: d(2026, 3, 1),
      paidDate: d(2026, 2, 20),
      asAt: d(2026, 7, 29),
    });
    expect(result.status).toBe('nothing-owed');
    expect(result.warnings).toContain('paid-on-time');
  });

  it('rejects a zero, negative or fractional amount', () => {
    for (const amountPence of [0, -100, 10.5]) {
      expect(
        calculateStatutoryInterest({ amountPence, dueDate: d(2026, 1, 1), asAt: d(2026, 7, 29) })
          .status,
      ).toBe('nothing-owed');
    }
  });
});

describe('fixed compensation', () => {
  it('applies the statutory bands at their exact edges', () => {
    expect(compensationFor(pounds(999.99))).toBe(pounds(40));
    expect(compensationFor(pounds(1_000))).toBe(pounds(70));
    expect(compensationFor(pounds(9_999.99))).toBe(pounds(70));
    expect(compensationFor(pounds(10_000))).toBe(pounds(100));
    expect(compensationFor(pounds(1_000_000))).toBe(pounds(100));
  });

  it('is a single penny below a band edge', () => {
    expect(compensationFor(99_999)).toBe(pounds(40)); // £999.99
    expect(compensationFor(100_000)).toBe(pounds(70)); // £1,000.00
    expect(compensationFor(999_999)).toBe(pounds(70)); // £9,999.99
    expect(compensationFor(1_000_000)).toBe(pounds(100)); // £10,000.00
  });

  it('is nothing on a debt of nothing', () => {
    expect(compensationFor(0)).toBe(0);
    expect(compensationFor(-1)).toBe(0);
  });

  it('is added to the total alongside interest', () => {
    const result = calc({
      amountPence: pounds(5_000),
      dueDate: d(2026, 1, 31),
      paidDate: d(2026, 3, 2),
      asAt: d(2026, 3, 2),
    });
    expect(result.compensationPence).toBe(pounds(70));
    expect(result.totalPence).toBe(pounds(5_000) + result.interestPence + pounds(70));
  });
});

describe('arithmetic', () => {
  it('computes at full precision rather than summing a rounded daily figure', () => {
    // gov.uk's worked example: £1,000 at 8.5% for 50 days. It rounds the daily
    // figure to 23p and reaches £11.50. Rounding once at the end gives £11.64,
    // and the creditor is entitled to the arithmetic — the published example is
    // illustrative, not a day-count convention.
    const result = calc({
      amountPence: pounds(1_000),
      dueDate: d(2015, 1, 31),
      paidDate: d(2015, 3, 22),
      asAt: d(2015, 3, 22),
    });
    expect(result.statutoryRateBp).toBe(850); // 0.50% + 8%
    expect(result.daysLate).toBe(50);
    expect(result.dailyInterestPence).toBe(23); // matches gov.uk's daily figure
    expect(result.interestPence).toBe(1_164); // £11.64, not £11.50
  });

  it('does not drift over a long period', () => {
    // A rounded daily figure summed over 1,000 days would be out by pounds.
    const result = calc({
      amountPence: pounds(12_345.67),
      dueDate: d(2024, 1, 1),
      paidDate: d(2026, 6, 30),
      asAt: d(2026, 6, 30),
    });
    const exact = (pounds(12_345.67) * result.statutoryRateBp * result.daysLate) / (10_000 * 365);
    expect(result.interestPence).toBe(Math.round(exact));
    expect(Number.isInteger(result.interestPence)).toBe(true);
  });

  it('keeps every money figure a whole number of pence', () => {
    const result = calc({
      amountPence: 333_333,
      dueDate: d(2026, 1, 1),
      paidDate: d(2026, 5, 17),
      asAt: d(2026, 5, 17),
    });
    for (const value of [
      result.interestPence,
      result.compensationPence,
      result.totalPence,
      result.dailyInterestPence,
    ]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });
});

describe('the calculator refuses rather than guesses', () => {
  it('will not extrapolate beyond the rate table', () => {
    // The next fixing is 31 December 2026. What the Monetary Policy Committee
    // does before then is not something the table can know, and a wrong figure
    // in a demand letter is worse than no figure.
    const result = calculateStatutoryInterest({
      amountPence: pounds(1_000),
      dueDate: d(2027, 3, 1),
      paidDate: d(2027, 5, 1),
      asAt: d(2027, 5, 1),
    });
    expect(result.status).toBe('unavailable');
    expect(result.warnings).toContain('rate-table-out-of-date');
  });

  it('will not invent a rate for a debt older than the regime', () => {
    const result = calculateStatutoryInterest({
      amountPence: pounds(1_000),
      dueDate: d(1999, 1, 1),
      paidDate: d(1999, 6, 1),
      asAt: d(2026, 7, 29),
    });
    expect(result.status).toBe('unavailable');
    expect(result.warnings).toContain('rate-unavailable');
  });
});

describe('the six-year recovery limit', () => {
  it('warns once interest has been running longer than the limit', () => {
    const result = calc({
      amountPence: pounds(1_000),
      dueDate: d(2019, 1, 1),
      asAt: d(2026, 7, 29),
    });
    expect(result.warnings).toContain('beyond-recovery-limit');
    // The arithmetic is still shown: what is recoverable is the user's call,
    // with advice, not something this calculator decides for them.
    expect(result.interestPence).toBeGreaterThan(0);
  });

  it('does not warn inside the limit', () => {
    const result = calc({
      amountPence: pounds(1_000),
      dueDate: d(2025, 1, 1),
      asAt: d(2026, 7, 29),
    });
    expect(result.warnings).not.toContain('beyond-recovery-limit');
  });

  it('holds the boundary at exactly six years', () => {
    // Interest from 2 January 2020; six years later is 2 January 2026.
    const dayBefore = calc({
      amountPence: pounds(1_000),
      dueDate: d(2020, 1, 1),
      asAt: d(2026, 1, 1),
    });
    expect(dayBefore.warnings).not.toContain('beyond-recovery-limit');

    const onTheDay = calc({
      amountPence: pounds(1_000),
      dueDate: d(2020, 1, 1),
      asAt: d(2026, 1, 2),
    });
    expect(onTheDay.warnings).toContain('beyond-recovery-limit');
    expect(RECOVERY_LIMIT_YEARS).toBe(6);
  });
});

describe('a worked example a user could check by hand', () => {
  it('£5,000 invoice, due 31 January 2026, paid 30 April 2026', () => {
    const result = calc({
      amountPence: pounds(5_000),
      dueDate: d(2026, 1, 31),
      paidDate: d(2026, 4, 30),
      asAt: d(2026, 4, 30),
    });

    // Interest ran from 1 February to 30 April inclusive: 28 + 31 + 30 = 89 days.
    expect(result.daysLate).toBe(89);
    // H1 2026 takes the 31 December 2025 fixing of 3.75%, so 11.75%.
    expect(result.statutoryRateBp).toBe(1175);
    // £5,000 × 11.75% ÷ 365 × 89 = £143.2534 → £143.25
    expect(result.interestPence).toBe(14_325);
    // £1,000–£9,999.99 band.
    expect(result.compensationPence).toBe(pounds(70));
    // £5,000.00 + £143.25 + £70.00
    expect(result.totalPence).toBe(521_325);
    expect(result.warnings).toEqual([]);
  });
});
