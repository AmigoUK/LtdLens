import { describe, expect, it } from 'vitest';
import {
  compareCalendarDates,
  daysBetween,
  daysInMonth,
  formatCalendarDate,
  isWithinMonths,
  monthsBetween,
  parseCalendarDate,
  toCalendarDate,
  toUtcDate,
} from '../src/normalise/dates.js';

const d = (year: number, month: number, day: number) => ({ year, month, day });

describe('parseCalendarDate', () => {
  it('parses the ISO dates Companies House returns', () => {
    expect(parseCalendarDate('2024-03-14')).toEqual(d(2024, 3, 14));
    expect(parseCalendarDate('1947-11-27')).toEqual(d(1947, 11, 27));
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseCalendarDate('  2024-03-14 ')).toEqual(d(2024, 3, 14));
  });

  it('rejects absence rather than guessing a date', () => {
    expect(parseCalendarDate(undefined)).toBeUndefined();
    expect(parseCalendarDate(null)).toBeUndefined();
    expect(parseCalendarDate('')).toBeUndefined();
  });

  it('rejects dates that are well-formed but impossible', () => {
    expect(parseCalendarDate('2023-02-29')).toBeUndefined();
    expect(parseCalendarDate('2024-02-30')).toBeUndefined();
    expect(parseCalendarDate('2024-13-01')).toBeUndefined();
    expect(parseCalendarDate('2024-00-10')).toBeUndefined();
    expect(parseCalendarDate('2024-04-31')).toBeUndefined();
  });

  it('accepts 29 February in a leap year', () => {
    expect(parseCalendarDate('2024-02-29')).toEqual(d(2024, 2, 29));
  });

  it('rejects timestamps and loose formats', () => {
    expect(parseCalendarDate('2024-03-14T00:00:00Z')).toBeUndefined();
    expect(parseCalendarDate('14/03/2024')).toBeUndefined();
    expect(parseCalendarDate('2024-3-4')).toBeUndefined();
  });
});

describe('daysInMonth', () => {
  it('applies the full Gregorian leap-year rule', () => {
    expect(daysInMonth(2024, 2)).toBe(29); // divisible by 4
    expect(daysInMonth(2023, 2)).toBe(28);
    expect(daysInMonth(1900, 2)).toBe(28); // century, not divisible by 400
    expect(daysInMonth(2000, 2)).toBe(29); // divisible by 400
  });

  it('knows the short months', () => {
    expect(daysInMonth(2024, 4)).toBe(30);
    expect(daysInMonth(2024, 6)).toBe(30);
    expect(daysInMonth(2024, 9)).toBe(30);
    expect(daysInMonth(2024, 11)).toBe(30);
    expect(daysInMonth(2024, 1)).toBe(31);
    expect(daysInMonth(2024, 12)).toBe(31);
  });
});

describe('formatCalendarDate', () => {
  it('round-trips through parseCalendarDate', () => {
    for (const iso of ['2024-03-14', '1999-12-31', '2000-01-01', '2024-02-29']) {
      expect(formatCalendarDate(parseCalendarDate(iso)!)).toBe(iso);
    }
  });

  it('pads single-digit components', () => {
    expect(formatCalendarDate(d(2024, 1, 5))).toBe('2024-01-05');
  });
});

describe('toCalendarDate / toUtcDate', () => {
  it('reads the UTC calendar date, not the local one', () => {
    // 23:30 UTC is already the next day in some zones and not in others.
    // Reading UTC keeps "incorporated on" stable wherever the user sits.
    expect(toCalendarDate(new Date('2024-03-14T23:30:00Z'))).toEqual(d(2024, 3, 14));
    expect(toCalendarDate(new Date('2024-03-14T00:30:00Z'))).toEqual(d(2024, 3, 14));
  });

  it('round-trips', () => {
    expect(toCalendarDate(toUtcDate(d(2024, 3, 14)))).toEqual(d(2024, 3, 14));
  });
});

describe('compareCalendarDates', () => {
  it('orders by year, then month, then day', () => {
    expect(compareCalendarDates(d(2023, 5, 1), d(2024, 5, 1))).toBeLessThan(0);
    expect(compareCalendarDates(d(2024, 6, 1), d(2024, 5, 1))).toBeGreaterThan(0);
    expect(compareCalendarDates(d(2024, 5, 2), d(2024, 5, 1))).toBeGreaterThan(0);
    expect(compareCalendarDates(d(2024, 5, 1), d(2024, 5, 1))).toBe(0);
  });
});

describe('daysBetween', () => {
  it('counts whole days', () => {
    expect(daysBetween(d(2024, 3, 1), d(2024, 3, 14))).toBe(13);
    expect(daysBetween(d(2024, 3, 14), d(2024, 3, 14))).toBe(0);
    expect(daysBetween(d(2024, 3, 14), d(2024, 3, 1))).toBe(-13);
  });

  it('counts across a leap day', () => {
    expect(daysBetween(d(2024, 2, 28), d(2024, 3, 1))).toBe(2);
    expect(daysBetween(d(2023, 2, 28), d(2023, 3, 1))).toBe(1);
  });

  it('counts across a year of 365 days, and a leap year of 366', () => {
    expect(daysBetween(d(2023, 1, 1), d(2024, 1, 1))).toBe(365);
    expect(daysBetween(d(2024, 1, 1), d(2025, 1, 1))).toBe(366);
  });

  it('is unaffected by British Summer Time starting between the dates', () => {
    // BST began on 31 March 2024. A local-time implementation loses an hour
    // here and rounds to the wrong number of days.
    expect(daysBetween(d(2024, 3, 30), d(2024, 4, 1))).toBe(2);
  });
});

describe('monthsBetween', () => {
  it('counts a month only once the day of month is reached', () => {
    expect(monthsBetween(d(2024, 1, 15), d(2024, 2, 14))).toBe(0);
    expect(monthsBetween(d(2024, 1, 15), d(2024, 2, 15))).toBe(1);
    expect(monthsBetween(d(2024, 1, 15), d(2024, 2, 16))).toBe(1);
  });

  it('anchors to the month end when the target month is shorter', () => {
    // 31 January to 28 February is a whole month: February has no 31st, and
    // the alternative reports a company as younger than it is.
    expect(monthsBetween(d(2023, 1, 31), d(2023, 2, 28))).toBe(1);
    expect(monthsBetween(d(2024, 1, 31), d(2024, 2, 29))).toBe(1);
    expect(monthsBetween(d(2023, 1, 31), d(2023, 2, 27))).toBe(0);
  });

  it('counts whole years', () => {
    expect(monthsBetween(d(2023, 3, 14), d(2024, 3, 14))).toBe(12);
    expect(monthsBetween(d(2023, 3, 14), d(2024, 3, 13))).toBe(11);
    expect(monthsBetween(d(2021, 3, 14), d(2024, 3, 14))).toBe(36);
    expect(monthsBetween(d(2021, 3, 14), d(2024, 3, 13))).toBe(35);
  });

  it('is negative when the order is reversed', () => {
    expect(monthsBetween(d(2024, 3, 14), d(2023, 3, 14))).toBe(-12);
  });

  it('is zero for the same day', () => {
    expect(monthsBetween(d(2024, 3, 14), d(2024, 3, 14))).toBe(0);
  });
});

describe('isWithinMonths', () => {
  const now = d(2026, 7, 29);

  it('holds at the boundaries the flag rules turn on', () => {
    // "under 12 months old"
    expect(isWithinMonths(d(2025, 7, 30), now, 12)).toBe(true);
    expect(isWithinMonths(d(2025, 7, 29), now, 12)).toBe(false);

    // "moved within the last 3 months"
    expect(isWithinMonths(d(2026, 4, 30), now, 3)).toBe(true);
    expect(isWithinMonths(d(2026, 4, 29), now, 3)).toBe(false);

    // "renamed in the last 6 months"
    expect(isWithinMonths(d(2026, 1, 30), now, 6)).toBe(true);
    expect(isWithinMonths(d(2026, 1, 29), now, 6)).toBe(false);
  });

  it('treats today as within any window', () => {
    expect(isWithinMonths(now, now, 1)).toBe(true);
  });

  it('rejects future dates rather than reporting them as recent', () => {
    // Companies House does publish future-dated events; a filing dated
    // tomorrow must not count as having happened in the last three months.
    expect(isWithinMonths(d(2026, 8, 1), now, 3)).toBe(false);
  });
});
