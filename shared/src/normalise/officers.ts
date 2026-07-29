/**
 * Officer list → counts.
 *
 * LtdLens reports how many officers there are and how much recent movement
 * there has been. It deliberately does not build a per-person view: Companies
 * House offers an appointments-by-officer endpoint, and using it would turn
 * "check a company" into "profile a person" — a different data protection
 * story, a different Chrome Web Store data declaration, and a different
 * product. Directors' names, months of birth and service addresses are third
 * party personal data; the counts below are the least of it we can work with.
 *
 * `activeCount` and `resignedCount` come from the response's own totals rather
 * than from counting `items`, because the list is paginated and a company with
 * more than 35 officers would otherwise be undercounted — silently, and in the
 * direction that hides churn.
 */

import type { ChOfficer, ChOfficerList } from '../types/companiesHouse.js';
import type { OfficerFacts } from '../types/snapshot.js';
import type { CalendarDate } from './dates.js';
import { isWithinMonths, parseCalendarDate } from './dates.js';

/** Officer roles that carry responsibility for the company's conduct. */
const RESPONSIBLE_ROLES = new Set([
  'director',
  'corporate-director',
  'nominee-director',
  'corporate-nominee-director',
  'llp-member',
  'llp-designated-member',
  'corporate-llp-member',
  'corporate-llp-designated-member',
  'judicial-factor',
  'manager',
  'managing-officer',
  'corporate-managing-officer',
]);

/**
 * True for an officer whose comings and goings say something about the
 * company's stability. Secretaries and receivers are excluded: a secretary
 * changing is administrative noise, and a receiver's appointment is already
 * reported far more directly by the company status.
 */
export function isResponsibleOfficer(officer: ChOfficer): boolean {
  const role = officer.officer_role?.trim().toLowerCase();
  return role !== undefined && RESPONSIBLE_ROLES.has(role);
}

function countWithin(
  officers: ChOfficer[],
  field: 'appointed_on' | 'resigned_on',
  now: CalendarDate,
  months: number,
): number {
  let count = 0;
  for (const officer of officers) {
    if (!isResponsibleOfficer(officer)) continue;
    const when = parseCalendarDate(officer[field]);
    if (when !== undefined && isWithinMonths(when, now, months)) count += 1;
  }
  return count;
}

export function normaliseOfficers(
  list: ChOfficerList | undefined,
  now: CalendarDate,
): OfficerFacts {
  const items = Array.isArray(list?.items) ? list.items : [];

  // Prefer the response's totals; fall back to counting only when they are
  // absent, which happens on some historic records.
  const activeCount =
    typeof list?.active_count === 'number'
      ? list.active_count
      : items.filter((officer) => officer.resigned_on === undefined).length;

  const resignedCount =
    typeof list?.resigned_count === 'number'
      ? list.resigned_count
      : items.filter((officer) => officer.resigned_on !== undefined).length;

  return {
    activeCount,
    resignedCount,
    appointedLast6m: countWithin(items, 'appointed_on', now, 6),
    resignedLast6m: countWithin(items, 'resigned_on', now, 6),
  };
}
