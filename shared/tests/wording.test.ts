import { describe, expect, it } from 'vitest';
import { calculateStatutoryInterest } from '../src/rates/calculator.js';
import {
  buildDemandParagraph,
  formatBritishDate,
  formatPence,
  formatRate,
} from '../src/rates/wording.js';
import type { CalendarDate } from '../src/normalise/dates.js';

const d = (year: number, month: number, day: number): CalendarDate => ({ year, month, day });
const pounds = (value: number) => Math.round(value * 100);

const UNPAID = calculateStatutoryInterest({
  amountPence: pounds(5_000),
  dueDate: d(2026, 1, 31),
  asAt: d(2026, 4, 30),
});

const SETTLED = calculateStatutoryInterest({
  amountPence: pounds(5_000),
  dueDate: d(2026, 1, 31),
  paidDate: d(2026, 4, 30),
  asAt: d(2026, 7, 29),
});

describe('formatPence', () => {
  it('always shows two decimal places', () => {
    expect(formatPence(500_000)).toBe('£5,000.00');
    expect(formatPence(14_325)).toBe('£143.25');
    expect(formatPence(7_000)).toBe('£70.00');
    expect(formatPence(5)).toBe('£0.05');
    expect(formatPence(0)).toBe('£0.00');
  });

  it('groups thousands', () => {
    expect(formatPence(123_456_789)).toBe('£1,234,567.89');
  });

  it('pads a single-digit pence value', () => {
    // £143.5 would be wrong in a demand letter; it must read £143.05.
    expect(formatPence(14_305)).toBe('£143.05');
  });
});

describe('formatRate', () => {
  it('renders a rate a reader can check against the published table', () => {
    expect(formatRate(1175)).toBe('11.75%');
    expect(formatRate(810)).toBe('8.1%');
    expect(formatRate(800)).toBe('8%');
    expect(formatRate(1325)).toBe('13.25%');
  });
});

describe('formatBritishDate', () => {
  it('uses the form found in British correspondence', () => {
    expect(formatBritishDate(d(2026, 3, 14))).toBe('14 March 2026');
    expect(formatBritishDate(d(2026, 1, 1))).toBe('1 January 2026');
    expect(formatBritishDate(d(2026, 12, 31))).toBe('31 December 2026');
  });
});

describe('buildDemandParagraph', () => {
  it('states the entitlement, the arithmetic and the total', () => {
    const paragraph = buildDemandParagraph({ result: UNPAID, amountPence: pounds(5_000) })!;

    expect(paragraph).toContain('Late Payment of Commercial Debts (Interest) Act 1998');
    expect(paragraph).toContain('11.75%');
    expect(paragraph).toContain('£5,000.00'); // the invoice
    expect(paragraph).toContain('£143.25'); // the interest
    expect(paragraph).toContain('£70.00'); // fixed compensation
    expect(paragraph).toContain('£5,213.25'); // the total
    expect(paragraph).toContain('89 days');
  });

  it('shows where the rate came from, so the reader can verify it', () => {
    // A debtor's accounts department that can check the figure pays it; one
    // that cannot check it escalates.
    const paragraph = buildDemandParagraph({ result: UNPAID, amountPence: pounds(5_000) })!;
    expect(paragraph).toContain('Bank of England base rate of 3.75%');
    expect(paragraph).toContain('31 December 2025');
    expect(paragraph).toContain('eight percentage points');
  });

  it('recovers the due date from the day interest started running', () => {
    // Interest starts 1 February, so the invoice fell due on 31 January.
    const paragraph = buildDemandParagraph({ result: UNPAID, amountPence: pounds(5_000) })!;
    expect(paragraph).toContain('31 January 2026');
  });

  it('names the invoice when a reference is given', () => {
    const paragraph = buildDemandParagraph({
      result: UNPAID,
      amountPence: pounds(5_000),
      invoiceReference: 'INV-2026-0412',
    })!;
    expect(paragraph).toContain('invoice INV-2026-0412');
  });

  it('falls back to "the invoice" rather than leaving a gap', () => {
    for (const invoiceReference of [undefined, '', '   ']) {
      const paragraph = buildDemandParagraph({
        result: UNPAID,
        amountPence: pounds(5_000),
        ...(invoiceReference === undefined ? {} : { invoiceReference }),
      })!;
      expect(paragraph).toContain('the invoice');
      expect(paragraph).not.toContain('invoice ,');
    }
  });

  it('writes a different letter once the invoice itself has been paid', () => {
    // Chasing an unpaid invoice and claiming interest on a settled one are
    // different asks. Sending the wrong one reads as sloppy or grasping.
    const paragraph = buildDemandParagraph({
      result: SETTLED,
      amountPence: pounds(5_000),
      settled: true,
    })!;

    expect(paragraph).toContain('was settled on 30 April 2026');
    // Only interest and compensation are still owed, not the invoice total.
    expect(paragraph).toContain('£213.25');
    expect(paragraph).not.toContain('£5,213.25');
    expect(paragraph).not.toContain('remains outstanding');
  });

  it('uses the singular for a single day late', () => {
    const oneDay = calculateStatutoryInterest({
      amountPence: pounds(1_000),
      dueDate: d(2026, 3, 1),
      paidDate: d(2026, 3, 2),
      asAt: d(2026, 3, 2),
    });
    const paragraph = buildDemandParagraph({ result: oneDay, amountPence: pounds(1_000) })!;
    expect(paragraph).toContain('1 day,');
    expect(paragraph).not.toContain('1 days');
  });

  it('offers no paragraph when there is nothing to claim', () => {
    // Returning undefined rather than an apologetic sentence is deliberate: if
    // the invoice is not yet overdue, offering wording invites sending it anyway.
    const notDue = calculateStatutoryInterest({
      amountPence: pounds(1_000),
      dueDate: d(2026, 12, 1),
      asAt: d(2026, 7, 29),
    });
    expect(buildDemandParagraph({ result: notDue, amountPence: pounds(1_000) })).toBeUndefined();

    const unavailable = calculateStatutoryInterest({
      amountPence: pounds(1_000),
      dueDate: d(1999, 1, 1),
      asAt: d(2026, 7, 29),
    });
    expect(
      buildDemandParagraph({ result: unavailable, amountPence: pounds(1_000) }),
    ).toBeUndefined();
  });

  it('leaves no unresolved placeholder or double space', () => {
    const paragraph = buildDemandParagraph({
      result: UNPAID,
      amountPence: pounds(5_000),
      invoiceReference: 'INV-1',
    })!;
    expect(paragraph).not.toMatch(/\{[a-zA-Z]+\}/);
    expect(paragraph).not.toMatch(/ {2}/);
    expect(paragraph).not.toContain('undefined');
    expect(paragraph).not.toContain('NaN');
  });

  it('reads as courteous rather than threatening', () => {
    // A demand that reads as aggressive gets forwarded to a solicitor; one that
    // reads as routine gets forwarded to accounts payable, which is where the
    // money is.
    const paragraph = buildDemandParagraph({ result: UNPAID, amountPence: pounds(5_000) })!;
    expect(paragraph).toContain('grateful');
    for (const word of ['legal action', 'court', 'immediately', 'failure to', 'demand']) {
      expect(paragraph.toLowerCase()).not.toContain(word);
    }
  });

  it('is written in British English regardless of interface language', () => {
    // Addressed to a UK debtor and citing UK legislation. A Polish-speaking
    // owner running a company in Birmingham still sends this in English.
    const paragraph = buildDemandParagraph({ result: UNPAID, amountPence: pounds(5_000) })!;
    expect(paragraph).toMatch(/^[\x20-\x7E£]+$/);
  });
});
