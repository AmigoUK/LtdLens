/**
 * The paragraph a user pastes into a chasing email.
 *
 * **Always British English, regardless of the interface language.** This is not
 * an oversight in the i18n layer — it is the point. The text is addressed to a
 * UK debtor and cites UK legislation; a Polish-speaking owner running a company
 * in Birmingham still sends the demand in English. Translating it would produce
 * a letter nobody can act on. The surrounding UI is translated; this is not.
 *
 * The tone is deliberately courteous and factual. A demand that reads as
 * aggressive gets forwarded to a solicitor; one that reads as routine gets
 * forwarded to accounts payable, which is where the money is. It states the
 * entitlement, shows the arithmetic, and stops.
 */

import type { CalendarDate } from '../normalise/dates.js';
import type { InterestResult } from './calculator.js';

export interface WordingInput {
  result: InterestResult;
  /** The invoice total in pence, including VAT. */
  amountPence: number;
  /** Invoice reference, if the user supplied one. */
  invoiceReference?: string;
  /**
   * Whether the invoice itself has since been settled. Chasing an unpaid
   * invoice and claiming interest on one already paid are different letters:
   * the first asks for the lot, the second asks only for what late payment
   * cost. Sending the wrong one reads as either sloppy or grasping.
   */
  settled?: boolean;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** `14 March 2026` — the form used in British correspondence. */
export function formatBritishDate(date: CalendarDate): string {
  return `${date.day} ${MONTHS[date.month - 1]!} ${date.year}`;
}

/** `£1,234.56`, with thousands separators and always two decimal places. */
export function formatPence(pence: number): string {
  const negative = pence < 0;
  const absolute = Math.abs(pence);
  const units = Math.floor(absolute / 100);
  const remainder = absolute % 100;
  const grouped = units.toLocaleString('en-GB');
  return `${negative ? '-' : ''}£${grouped}.${String(remainder).padStart(2, '0')}`;
}

/** `11.75%`, trimming a trailing zero so 8.00% reads as 8%. */
export function formatRate(basisPoints: number): string {
  const percent = basisPoints / 100;
  return `${percent.toFixed(2).replace(/\.?0+$/, '')}%`;
}

/**
 * Builds the paragraph, or returns undefined when there is nothing to claim.
 *
 * Returning undefined rather than an apologetic sentence is deliberate: if the
 * invoice is not yet overdue there is no paragraph to write, and offering one
 * would invite the user to send it anyway.
 */
export function buildDemandParagraph(input: WordingInput): string | undefined {
  const { result } = input;
  if (result.status !== 'ok') return undefined;

  const invoice =
    input.invoiceReference === undefined || input.invoiceReference.trim().length === 0
      ? 'the invoice'
      : `invoice ${input.invoiceReference.trim()}`;

  const settled = input.settled === true;
  const dueDate = formatBritishDate(subtractOneDay(result.interestFrom));
  const sentences: string[] = [];

  sentences.push(
    settled
      ? `Our records show that ${invoice}, for ${formatPence(input.amountPence)}, ` +
          `fell due for payment on ${dueDate} and was settled on ` +
          `${formatBritishDate(result.interestTo)}.`
      : `Our records show that ${invoice}, for ${formatPence(input.amountPence)}, ` +
          `fell due for payment on ${dueDate} and remains outstanding as at ` +
          `${formatBritishDate(result.interestTo)}.`,
  );

  sentences.push(
    `Under the Late Payment of Commercial Debts (Interest) Act 1998 we are entitled to ` +
      `statutory interest at ${formatRate(result.statutoryRateBp)} per annum ` +
      `(the Bank of England base rate of ${formatRate(result.referenceRateBp)} ` +
      `in force on ${formatBritishDate(result.period.fixedOn)}, plus eight percentage points), ` +
      `together with fixed compensation of ${formatPence(result.compensationPence)} ` +
      `for the cost of recovering the debt.`,
  );

  const days = `${result.daysLate} ${result.daysLate === 1 ? 'day' : 'days'}`;

  sentences.push(
    settled
      ? `Interest accrued over ${days}, amounting to ${formatPence(result.interestPence)}. ` +
          `With the fixed compensation, the sum outstanding is ` +
          `${formatPence(result.interestPence + result.compensationPence)}.`
      : `Interest has accrued over ${days}, amounting to ` +
          `${formatPence(result.interestPence)}. ` +
          `The total now due is ${formatPence(result.totalPence)}.`,
  );

  sentences.push(
    settled
      ? `We would be grateful if this could be settled alongside your next payment run. ` +
          `If you would like us to raise a separate invoice for it, just say and we will send one.`
      : `We would be grateful for payment at your earliest convenience. ` +
          `If the invoice is in query, or if there is anything we can do to help settle it, ` +
          `please let us know and we will deal with it promptly.`,
  );

  return sentences.join(' ');
}

/** The due date, recovered from the day interest started running. */
function subtractOneDay(date: CalendarDate): CalendarDate {
  const previous = new Date(Date.UTC(date.year, date.month - 1, date.day - 1));
  return {
    year: previous.getUTCFullYear(),
    month: previous.getUTCMonth() + 1,
    day: previous.getUTCDate(),
  };
}
