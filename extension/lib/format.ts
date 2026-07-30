/**
 * Display formatting. Pure, and every function takes the reference date.
 */

import type { CalendarDate } from '@ltdlens/shared';
import { daysBetween, monthsBetween, parseCalendarDate, toCalendarDate } from '@ltdlens/shared';

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** `14 Mar 2026`. Compact enough for a 400-pixel panel. */
export function formatDate(iso: string | undefined): string {
  const date = parseCalendarDate(iso);
  if (date === undefined) return '—';
  return `${date.day} ${MONTHS_SHORT[date.month - 1]!} ${date.year}`;
}

/** `2 years 4 months`, or `4 months` under a year. */
export function formatAge(incorporatedOn: string | undefined, now: CalendarDate): string {
  const start = parseCalendarDate(incorporatedOn);
  if (start === undefined) return '—';

  const months = monthsBetween(start, now);
  if (months < 1) {
    const days = daysBetween(start, now);
    return days === 1 ? '1 day' : `${days} days`;
  }
  if (months < 12) return months === 1 ? '1 month' : `${months} months`;

  const years = Math.floor(months / 12);
  const rest = months % 12;
  const yearPart = years === 1 ? '1 year' : `${years} years`;
  if (rest === 0) return yearPart;
  return `${yearPart} ${rest === 1 ? '1 month' : `${rest} months`}`;
}

/** `overdue by 87 days`. Returns undefined when the date has not passed. */
export function formatOverdueBy(
  dueDate: string | undefined,
  now: CalendarDate,
): string | undefined {
  const due = parseCalendarDate(dueDate);
  if (due === undefined) return undefined;
  const days = daysBetween(due, now);
  if (days <= 0) return undefined;
  return days === 1 ? 'overdue by 1 day' : `overdue by ${days} days`;
}

/**
 * `just now`, `2 hours ago`, `yesterday`, `3 days ago`, then a date.
 *
 * Past a week an exact date is more useful than an ever-growing count of days:
 * "43 days ago" makes the reader do arithmetic, and this figure exists precisely
 * so somebody can judge whether a report is too old to rely on.
 */
export function formatRelative(iso: string, now: Date): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '—';

  const seconds = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (seconds < 90) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;

  return formatDate(toIsoDate(new Date(then)));
}

function toIsoDate(date: Date): string {
  const parts = toCalendarDate(date);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

/** Turns a Companies House status into a translation key. */
export function statusKey(status: string): string {
  const normalised = status.trim().toLowerCase();
  return normalised.length === 0 ? 'status.unknown' : `status.${normalised}`;
}

/** Presentable company number: `SC 123456`, `00445790`. */
export function formatCompanyNumber(number: string): string {
  const prefix = /^([A-Z]{1,2})(\d+)$/.exec(number);
  return prefix === null ? number : `${prefix[1]!} ${prefix[2]!}`;
}
