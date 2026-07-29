/**
 * Charge list → counts.
 *
 * Charges are reported as information, never as a warning. A charge is a lender
 * taking security over company assets, which is what happens every time a
 * business takes a commercial loan, a mortgage or asset finance. Treating that
 * as a risk signal would flag most healthy trading companies in the country.
 * What is worth showing is the count and how recent the newest one is, so the
 * reader can judge for themselves.
 */

import type { ChCharge, ChChargeList } from '../types/companiesHouse.js';
import type { ChargeFacts } from '../types/snapshot.js';
import { parseCalendarDate } from './dates.js';

/** Charge statuses meaning the security is still in force. */
const OUTSTANDING = new Set(['outstanding', 'part-satisfied']);

function isOutstanding(charge: ChCharge): boolean {
  const status = charge.status?.trim().toLowerCase();
  return status !== undefined && OUTSTANDING.has(status);
}

export function normaliseCharges(list: ChChargeList | undefined): ChargeFacts {
  const items = Array.isArray(list?.items) ? list.items : [];

  const satisfied = typeof list?.satisfied_count === 'number' ? list.satisfied_count : 0;
  const partSatisfied =
    typeof list?.part_satisfied_count === 'number' ? list.part_satisfied_count : 0;

  // The API gives a total and a satisfied count but no outstanding count, so it
  // is derived. Note `part_satisfied` sits in both buckets upstream — a
  // partly-satisfied charge is still security over assets — so it is not
  // subtracted here.
  const total = typeof list?.total_count === 'number' ? list.total_count : items.length;
  const derived = Math.max(0, total - satisfied);

  // Prefer counting the items when the whole list is present; the totals are
  // authoritative for pagination but the items are authoritative for status.
  const countedOutstanding = items.filter(isOutstanding).length;
  const outstanding = items.length >= total ? countedOutstanding : derived;

  let mostRecentCreatedOn: string | undefined;
  for (const charge of items) {
    if (!isOutstanding(charge)) continue;
    const created = charge.created_on;
    if (parseCalendarDate(created) === undefined) continue;
    if (mostRecentCreatedOn === undefined || created! > mostRecentCreatedOn) {
      mostRecentCreatedOn = created!.trim();
    }
  }

  const facts: ChargeFacts = { outstanding, satisfied, partSatisfied };
  if (mostRecentCreatedOn !== undefined) facts.mostRecentCreatedOn = mostRecentCreatedOn;
  return facts;
}
