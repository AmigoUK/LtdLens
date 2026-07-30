import { describe, expect, it } from 'vitest';
import {
  formatAge,
  formatCompanyNumber,
  formatDate,
  formatOverdueBy,
  formatRelative,
  statusKey,
} from '../lib/format.js';

const NOW_DATE = { year: 2026, month: 7, day: 30 };
const NOW = new Date('2026-07-30T12:00:00Z');

describe('formatDate', () => {
  it('renders compactly enough for a narrow panel', () => {
    expect(formatDate('2026-03-14')).toBe('14 Mar 2026');
    expect(formatDate('1947-11-27')).toBe('27 Nov 1947');
  });

  it('shows a dash rather than a broken date', () => {
    for (const value of [undefined, '', 'not a date', '2026-02-30']) {
      expect(formatDate(value)).toBe('—');
    }
  });
});

describe('formatAge', () => {
  it('reads naturally at every scale', () => {
    expect(formatAge('2026-07-29', NOW_DATE)).toBe('1 day');
    expect(formatAge('2026-07-01', NOW_DATE)).toBe('29 days');
    expect(formatAge('2026-06-30', NOW_DATE)).toBe('1 month');
    expect(formatAge('2026-02-16', NOW_DATE)).toBe('5 months');
    expect(formatAge('2025-07-30', NOW_DATE)).toBe('1 year');
    expect(formatAge('2024-03-30', NOW_DATE)).toBe('2 years 4 months');
  });

  it('omits a zero remainder rather than saying "2 years 0 months"', () => {
    expect(formatAge('2024-07-30', NOW_DATE)).toBe('2 years');
  });

  it('shows a dash when the register gives no date', () => {
    expect(formatAge(undefined, NOW_DATE)).toBe('—');
  });
});

describe('formatOverdueBy', () => {
  it('counts the days past a deadline', () => {
    expect(formatOverdueBy('2026-01-31', NOW_DATE)).toBe('overdue by 180 days');
    expect(formatOverdueBy('2026-07-29', NOW_DATE)).toBe('overdue by 1 day');
  });

  it('says nothing about a deadline that has not passed', () => {
    // A due date in the future is not late, and phrasing it as "overdue by -3
    // days" would be worse than silence.
    expect(formatOverdueBy('2026-08-30', NOW_DATE)).toBeUndefined();
    expect(formatOverdueBy('2026-07-30', NOW_DATE)).toBeUndefined();
    expect(formatOverdueBy(undefined, NOW_DATE)).toBeUndefined();
  });
});

describe('formatRelative', () => {
  const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

  it('describes recent times in words', () => {
    expect(formatRelative(ago(10_000), NOW)).toBe('just now');
    expect(formatRelative(ago(5 * 60_000), NOW)).toBe('5 minutes ago');
    expect(formatRelative(ago(60 * 60_000), NOW)).toBe('1 hour ago');
    expect(formatRelative(ago(5 * 3_600_000), NOW)).toBe('5 hours ago');
    expect(formatRelative(ago(26 * 3_600_000), NOW)).toBe('yesterday');
    expect(formatRelative(ago(3 * 86_400_000), NOW)).toBe('3 days ago');
  });

  it('switches to an exact date past a week', () => {
    // "43 days ago" makes the reader do arithmetic, and this figure exists so
    // somebody can judge whether a report is too old to rely on.
    expect(formatRelative(ago(30 * 86_400_000), NOW)).toBe('30 Jun 2026');
  });

  it('shows a dash for an unreadable timestamp', () => {
    expect(formatRelative('rubbish', NOW)).toBe('—');
  });
});

describe('statusKey', () => {
  it('maps a register status onto a translation key', () => {
    expect(statusKey('active')).toBe('status.active');
    expect(statusKey('ACTIVE')).toBe('status.active');
    expect(statusKey('voluntary-arrangement')).toBe('status.voluntary-arrangement');
  });

  it('has a key for an absent status', () => {
    expect(statusKey('')).toBe('status.unknown');
    expect(statusKey('   ')).toBe('status.unknown');
  });
});

describe('formatCompanyNumber', () => {
  it('spaces a register prefix for readability', () => {
    expect(formatCompanyNumber('SC123456')).toBe('SC 123456');
    expect(formatCompanyNumber('R0000123')).toBe('R 0000123');
  });

  it('leaves an all-digit number alone', () => {
    expect(formatCompanyNumber('00445790')).toBe('00445790');
  });
});
