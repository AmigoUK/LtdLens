/**
 * Statutory late-payment interest and fixed compensation.
 *
 * Late Payment of Commercial Debts (Interest) Act 1998, as amended. This is the
 * one part of LtdLens whose output a user pastes verbatim into a demand letter,
 * so it is written to be checkable line by line rather than clever.
 *
 * Money is handled in whole pence as integers throughout. £0.10 is not exactly
 * representable in binary floating point, and neither is a 3.75% rate; summing
 * a daily figure over a few hundred days would drift by pennies, and pennies in
 * a demand letter are an argument the creditor does not need to have.
 *
 * The period boundaries are the part most implementations get wrong. See
 * `table.ts` for the statutory wording; the short version is that the rate is
 * chosen by the day interest **starts to run**, which is the day *after* the due
 * date, and is then fixed for the life of that debt.
 */

import type { CalendarDate } from '../normalise/dates.js';
import { compareCalendarDates, daysBetween, monthsBetween } from '../normalise/dates.js';
import type { RatePeriod } from './table.js';
import { TABLE_COVERS_TO, ratePeriodFor, statutoryRateBp } from './table.js';

/**
 * Fixed compensation for the cost of recovering a late commercial debt,
 * per s.5A of the Act. Banded by the size of the debt, charged **per invoice**,
 * and payable in addition to interest.
 */
export const COMPENSATION_BANDS = [
  { belowPence: 100_000, compensationPence: 4_000 }, // under £1,000 → £40
  { belowPence: 1_000_000, compensationPence: 7_000 }, // £1,000–£9,999.99 → £70
  { belowPence: Number.POSITIVE_INFINITY, compensationPence: 10_000 }, // £10,000+ → £100
] as const;

/** The Small Business Commissioner's stated limit on how far back interest runs. */
export const RECOVERY_LIMIT_YEARS = 6;

export interface InterestInput {
  /**
   * The full invoice total in pence, **including VAT**. The Small Business
   * Commissioner is explicit: "use the total amount (including VAT)". No VAT is
   * chargeable on the interest itself.
   */
  amountPence: number;
  /** The day payment was contractually due. Interest starts the day after. */
  dueDate: CalendarDate;
  /** The day the debt was paid. Omit for a debt still outstanding. */
  paidDate?: CalendarDate;
  /** Today, for an unpaid debt. Always passed in; this module has no clock. */
  asAt: CalendarDate;
}

export type InterestWarning =
  /** The debt is not yet overdue, so nothing has accrued. */
  | 'not-yet-due'
  /** Paid on or before the due date. Nothing is owed. */
  | 'paid-on-time'
  /** Interest has been running for more than six years. */
  | 'beyond-recovery-limit'
  /** The statutory rate for this period is not in the table. */
  | 'rate-unavailable'
  /** The rate table ends before the period this debt needs. */
  | 'rate-table-out-of-date';

export type InterestResult =
  | {
      status: 'ok';
      /** Reference rate plus eight points, in basis points. */
      statutoryRateBp: number;
      referenceRateBp: number;
      /** Which six-month band governs this debt, and the fixing it came from. */
      period: RatePeriod;
      /** First day interest ran: the day after the due date. */
      interestFrom: CalendarDate;
      /** Last day counted: the payment date, or today if still unpaid. */
      interestTo: CalendarDate;
      daysLate: number;
      /**
       * Indicative daily figure, rounded, for display only. The total is NOT
       * computed from this — see `interestPence`.
       */
      dailyInterestPence: number;
      interestPence: number;
      compensationPence: number;
      totalPence: number;
      warnings: InterestWarning[];
    }
  | {
      status: 'nothing-owed';
      daysLate: 0;
      warnings: InterestWarning[];
    }
  | {
      status: 'unavailable';
      warnings: InterestWarning[];
    };

/** Fixed compensation for a debt of this size, per s.5A. */
export function compensationFor(amountPence: number): number {
  if (amountPence <= 0) return 0;
  for (const band of COMPENSATION_BANDS) {
    if (amountPence < band.belowPence) return band.compensationPence;
  }
  // Unreachable: the last band is unbounded. Present so the function is total.
  return COMPENSATION_BANDS[COMPENSATION_BANDS.length - 1]!.compensationPence;
}

/** The day after `date`, handling month and year ends. */
function nextDay(date: CalendarDate): CalendarDate {
  const utc = Date.UTC(date.year, date.month - 1, date.day + 1);
  const next = new Date(utc);
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

export function calculateStatutoryInterest(input: InterestInput): InterestResult {
  const { amountPence, dueDate, asAt } = input;
  const warnings: InterestWarning[] = [];

  if (!Number.isInteger(amountPence) || amountPence <= 0) {
    return { status: 'nothing-owed', daysLate: 0, warnings };
  }

  // Statutory interest starts to run on the day after the relevant day — s.4(2).
  const interestFrom = nextDay(dueDate);

  // The end of the period: the day of payment, or today for an unpaid debt.
  const interestTo = input.paidDate ?? asAt;

  if (compareCalendarDates(interestTo, interestFrom) < 0) {
    // Either not due yet, or settled on or before the due date. Both mean the
    // creditor is owed nothing, and the distinction is worth reporting.
    warnings.push(input.paidDate === undefined ? 'not-yet-due' : 'paid-on-time');
    return { status: 'nothing-owed', daysLate: 0, warnings };
  }

  const period = ratePeriodFor(interestFrom);
  if (period === undefined) {
    // Refuse rather than extrapolate. The most recent rate is not evidence about
    // a period the Monetary Policy Committee has not reached yet, and a wrong
    // figure in a demand letter is worse than no figure.
    warnings.push(
      compareCalendarDates(interestFrom, TABLE_COVERS_TO) > 0
        ? 'rate-table-out-of-date'
        : 'rate-unavailable',
    );
    return { status: 'unavailable', warnings };
  }

  // Inclusive of both ends: interest runs on the first day after the due date
  // and on the day of payment. `daysBetween(dueDate, interestTo)` gives exactly
  // that count — one day for a debt due on the 31st and paid on the 1st.
  const daysLate = daysBetween(dueDate, interestTo);

  const rateBp = statutoryRateBp(period);

  // Computed at full precision and rounded once, rather than by summing a
  // rounded daily figure. gov.uk's worked example rounds the daily amount to
  // the nearest penny first, which understates a £1,000 debt over 50 days by
  // about 14p; that example is illustrative, and the creditor is entitled to
  // the arithmetic.
  const interestPence = Math.round((amountPence * rateBp * daysLate) / (10_000 * 365));

  const dailyInterestPence = Math.round((amountPence * rateBp) / (10_000 * 365));
  const compensationPence = compensationFor(amountPence);

  if (monthsBetween(interestFrom, interestTo) >= RECOVERY_LIMIT_YEARS * 12) {
    // The Limitation Act caps recovery. We still show the full arithmetic —
    // deciding what is recoverable is the user's call, with advice — but the
    // figure must not be presented as straightforwardly claimable.
    warnings.push('beyond-recovery-limit');
  }

  return {
    status: 'ok',
    statutoryRateBp: rateBp,
    referenceRateBp: period.referenceRateBp,
    period,
    interestFrom,
    interestTo,
    daysLate,
    dailyInterestPence,
    interestPence,
    compensationPence,
    totalPence: amountPence + interestPence + compensationPence,
    warnings,
  };
}
