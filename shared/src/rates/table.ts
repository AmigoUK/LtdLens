/**
 * The statutory late-payment reference rate, by six-month period.
 *
 * Under the Late Payment of Commercial Debts (Interest) Act 1998, statutory
 * interest runs at eight percentage points over the Bank of England base rate.
 * Which base rate is a question with a precise legal answer, set out in
 * [SI 2002/1675 art. 4](https://www.legislation.gov.uk/uksi/2002/1675/article/4/made):
 *
 * > 8 per cent per annum over the official dealing rate in force on the 30th
 * > June (in respect of interest which starts to run between 1st July and 31st
 * > December) or the 31st December (in respect of interest which starts to run
 * > between 1st January and 30th June) immediately before the day on which
 * > statutory interest starts to run.
 *
 * Three consequences the concept document for this project got wrong or omitted:
 *
 * 1. The period is chosen by when interest **starts to run** — the day after the
 *    due date, per s.4(2) of the Act — not by when the debt fell due. A debt due
 *    on 30 June starts running on 1 July, so it falls in the July–December band
 *    and takes the 30 June rate, not the previous 31 December's.
 * 2. The rate is then **fixed for the life of that debt**. It does not follow
 *    later base rate movements, even across a period boundary.
 * 3. Each invoice therefore carries its own rate. A multi-invoice claim is a sum
 *    of independently rated lines, never one rate applied to a total.
 *
 * Rates are stored in **basis points** as integers, because 0.1% and 3.75% are
 * not exactly representable in binary floating point and this table feeds
 * figures into demand letters.
 *
 * Verified 29 July 2026 against two independent published tables that agree at
 * every overlapping point, cross-checked against Bank of England Monetary Policy
 * Committee summaries for the December 2025 and June 2026 fixings and against
 * Penningtons Manches Cooper for the 31 December 2020 fixing.
 */

import type { CalendarDate } from '../normalise/dates.js';
import { compareCalendarDates } from '../normalise/dates.js';

/** Eight percentage points, in basis points. Set by s.6 of the Act. */
export const STATUTORY_MARGIN_BP = 800;

export interface RatePeriod {
  /** First day interest may start running under this rate, inclusive. */
  startsOn: CalendarDate;
  /** Last day interest may start running under this rate, inclusive. */
  endsOn: CalendarDate;
  /** Bank of England base rate at the preceding fixing, in basis points. */
  referenceRateBp: number;
  /** The date the reference rate was read from — 30 June or 31 December. */
  fixedOn: CalendarDate;
}

const d = (year: number, month: number, day: number): CalendarDate => ({ year, month, day });

/** First half of a year: takes the previous 31 December fixing. */
const h1 = (year: number, referenceRateBp: number): RatePeriod => ({
  startsOn: d(year, 1, 1),
  endsOn: d(year, 6, 30),
  referenceRateBp,
  fixedOn: d(year - 1, 12, 31),
});

/** Second half of a year: takes that year's 30 June fixing. */
const h2 = (year: number, referenceRateBp: number): RatePeriod => ({
  startsOn: d(year, 7, 1),
  endsOn: d(year, 12, 31),
  referenceRateBp,
  fixedOn: d(year, 6, 30),
});

/**
 * Every period since the regime took its current form on 7 August 2002.
 *
 * Ordered oldest first. Deliberately explicit rather than derived from a list of
 * base rate changes: the derivation is where an off-by-one would hide, and this
 * table is checkable line by line against a published source.
 */
export const RATE_PERIODS: readonly RatePeriod[] = [
  {
    startsOn: d(2002, 8, 7),
    endsOn: d(2002, 12, 31),
    referenceRateBp: 400,
    fixedOn: d(2002, 6, 30),
  },
  h1(2003, 400),
  h2(2003, 375),
  h1(2004, 375),
  h2(2004, 450),
  h1(2005, 475),
  h2(2005, 475),
  h1(2006, 450),
  h2(2006, 450),
  h1(2007, 500),
  h2(2007, 550),
  h1(2008, 550),
  h2(2008, 500),
  h1(2009, 200),
  h2(2009, 50),
  h1(2010, 50),
  h2(2010, 50),
  h1(2011, 50),
  h2(2011, 50),
  h1(2012, 50),
  h2(2012, 50),
  h1(2013, 50),
  h2(2013, 50),
  h1(2014, 50),
  h2(2014, 50),
  h1(2015, 50),
  h2(2015, 50),
  h1(2016, 50),
  h2(2016, 50),
  h1(2017, 25),
  h2(2017, 25),
  h1(2018, 50),
  h2(2018, 50),
  h1(2019, 75),
  h2(2019, 75),
  h1(2020, 75),
  h2(2020, 10),
  h1(2021, 10),
  h2(2021, 10),
  h1(2022, 25),
  h2(2022, 125),
  h1(2023, 350),
  h2(2023, 500),
  h1(2024, 525),
  h2(2024, 525),
  h1(2025, 475),
  h2(2025, 425),
  h1(2026, 375),
  h2(2026, 375),
];

/**
 * The last day this table covers.
 *
 * Beyond it the calculator refuses to produce a figure rather than extrapolating
 * from the most recent rate. The next fixing is 31 December 2026, and whatever
 * the Monetary Policy Committee does before then is not something this table can
 * know. Guessing would put a wrong number in a demand letter, which is worse
 * than declining to answer.
 */
export const TABLE_COVERS_TO: CalendarDate = d(2026, 12, 31);

/** The period governing a debt whose interest starts running on `startDate`. */
export function ratePeriodFor(startDate: CalendarDate): RatePeriod | undefined {
  return RATE_PERIODS.find(
    (period) =>
      compareCalendarDates(startDate, period.startsOn) >= 0 &&
      compareCalendarDates(startDate, period.endsOn) <= 0,
  );
}

/** Total statutory rate in basis points: reference rate plus eight points. */
export function statutoryRateBp(period: RatePeriod): number {
  return period.referenceRateBp + STATUTORY_MARGIN_BP;
}
