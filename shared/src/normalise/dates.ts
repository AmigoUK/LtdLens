/**
 * Date handling for register data.
 *
 * Companies House dates are calendar dates (`YYYY-MM-DD`) with no time and no
 * zone. Parsing them with `new Date('2024-03-14')` gives midnight UTC, which in
 * a browser east of Greenwich renders as the 14th and west of it as the 13th —
 * an off-by-one that would silently misreport "incorporated on" and, worse,
 * shift the boundaries the flag rules turn on. So calendar dates are handled as
 * calendar dates throughout: parsed into their parts, compared as parts, and
 * never round-tripped through a local-time `Date`.
 *
 * Every function takes the reference date explicitly. Nothing here reads a
 * clock — that is what makes the flag rules testable at their exact boundaries
 * and stops the test suite rotting as real filing deadlines roll forward.
 */

/** A calendar date with no time and no zone. */
export interface CalendarDate {
  year: number;
  month: number; // 1–12
  day: number; // 1–31
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days in a month, honouring the Gregorian leap-year rule. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/**
 * Parses `YYYY-MM-DD`. Returns undefined for anything else, including dates
 * that are well-formed but impossible (`2023-02-30`) and timestamps — the
 * caller must decide what a missing date means, and it is never our place to
 * guess one.
 */
export function parseCalendarDate(value: string | undefined | null): CalendarDate | undefined {
  if (typeof value !== 'string') return undefined;
  const match = ISO_DATE.exec(value.trim());
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12) return undefined;
  if (day < 1 || day > daysInMonth(year, month)) return undefined;

  return { year, month, day };
}

/** Formats back to `YYYY-MM-DD`. */
export function formatCalendarDate(date: CalendarDate): string {
  const month = String(date.month).padStart(2, '0');
  const day = String(date.day).padStart(2, '0');
  return `${String(date.year).padStart(4, '0')}-${month}-${day}`;
}

/** The calendar date a `Date` represents in UTC. */
export function toCalendarDate(date: Date): CalendarDate {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

/** Midnight UTC on that calendar date. */
export function toUtcDate(date: CalendarDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

/** Negative if `a` is earlier, positive if later, zero if the same day. */
export function compareCalendarDates(a: CalendarDate, b: CalendarDate): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

const MS_PER_DAY = 86_400_000;

/**
 * Whole days from `from` to `to`. Positive when `to` is later.
 * Exact because both ends are midnight UTC, so daylight saving cannot intrude.
 */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  return Math.round((toUtcDate(to).getTime() - toUtcDate(from).getTime()) / MS_PER_DAY);
}

/**
 * Whole months elapsed from `from` to `to`, counting a month as complete only
 * once the day-of-month is reached. Anchored to month ends: 31 January to 28
 * February is a whole month, because February has no 31st and the alternative
 * is to report a company as younger than it is.
 *
 * The flag rules turn on thresholds like "under 12 months old" and "moved
 * within 3 months", so this is where those boundaries are actually decided.
 */
export function monthsBetween(from: CalendarDate, to: CalendarDate): number {
  if (compareCalendarDates(from, to) > 0) return -monthsBetween(to, from);

  let months = (to.year - from.year) * 12 + (to.month - from.month);
  if (months === 0) return 0;

  const anchorDay = Math.min(from.day, daysInMonth(to.year, to.month));
  if (to.day < anchorDay) months -= 1;

  return months;
}

/** True when `date` falls within the last `months` months, inclusive of today. */
export function isWithinMonths(date: CalendarDate, now: CalendarDate, months: number): boolean {
  if (compareCalendarDates(date, now) > 0) return false;
  return monthsBetween(date, now) < months;
}

/** Convenience over `parseCalendarDate` for the many optional register fields. */
export function parseAndCompare(
  value: string | undefined,
  now: CalendarDate,
  predicate: (parsed: CalendarDate, now: CalendarDate) => boolean,
): boolean {
  const parsed = parseCalendarDate(value);
  return parsed === undefined ? false : predicate(parsed, now);
}
