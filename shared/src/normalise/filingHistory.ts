/**
 * Filing history → recent filings, plus two dates the company profile does not
 * expose at all.
 *
 * The profile tells you where a company's registered office is, but not when it
 * moved there; it lists previous names, but the rename date on those entries is
 * `ceased_on`, which is absent often enough to be unreliable. Both facts matter
 * — a young company that has just moved address, or just changed its name, is
 * worth a second look — and the only dependable source for either is the filing
 * history. That is why this module exists rather than reading the profile.
 */

import type { ChFiling, ChFilingHistoryList } from '../types/companiesHouse.js';
import type { FilingSummary } from '../types/snapshot.js';
import { parseCalendarDate } from './dates.js';

/** How many filings the side panel shows. */
export const RECENT_FILINGS_LIMIT = 10;

function isDated(filing: ChFiling): filing is ChFiling & { date: string } {
  return parseCalendarDate(filing.date) !== undefined;
}

/** Most recent first. Companies House usually returns this order; do not rely on it. */
function byDateDescending(a: ChFiling & { date: string }, b: ChFiling & { date: string }): number {
  return b.date.localeCompare(a.date);
}

function sortedFilings(list: ChFilingHistoryList | undefined): (ChFiling & { date: string })[] {
  const items = Array.isArray(list?.items) ? list.items : [];
  return items.filter(isDated).sort(byDateDescending);
}

export function normaliseRecentFilings(list: ChFilingHistoryList | undefined): FilingSummary[] {
  return sortedFilings(list)
    .slice(0, RECENT_FILINGS_LIMIT)
    .map((filing) => {
      const summary: FilingSummary = {
        date: filing.date.trim(),
        category: filing.category?.trim() ?? 'miscellaneous',
        // The raw description is a template key such as
        // `change-registered-office-address-company-with-date-old-address-new-address`.
        // Resolving it to English is the extension's job, offline; the Worker
        // stays dumb and the mapping stays translatable.
        description: filing.description?.trim() ?? '',
      };
      const type = filing.type?.trim();
      if (type !== undefined && type.length > 0) summary.type = type;
      return summary;
    });
}

/** Date of the most recent filing in a category, if any. */
function latestInCategory(
  list: ChFilingHistoryList | undefined,
  category: string,
): string | undefined {
  for (const filing of sortedFilings(list)) {
    if (filing.category?.trim().toLowerCase() === category) return filing.date.trim();
  }
  return undefined;
}

/**
 * When the registered office last moved.
 *
 * The `address` category also covers the single-alternative-inspection-location
 * filings, which are not moves. `type` distinguishes them: registered office
 * changes are `AD01` (and `AD01` variants), whereas SAIL filings are `AD02`
 * onwards. Filtering on type rather than category keeps the "recently moved"
 * rule from firing on paperwork nobody would consider a move.
 */
export function registeredOfficeChangedOn(
  list: ChFilingHistoryList | undefined,
): string | undefined {
  for (const filing of sortedFilings(list)) {
    if (filing.category?.trim().toLowerCase() !== 'address') continue;
    const type = filing.type?.trim().toUpperCase() ?? '';
    if (type.startsWith('AD01')) return filing.date.trim();
    // Older records carry no type; fall back to the description template.
    if (type === '' && filing.description?.includes('registered-office-address')) {
      return filing.date.trim();
    }
  }
  return undefined;
}

/** When the company was last renamed. */
export function nameChangedOn(list: ChFilingHistoryList | undefined): string | undefined {
  return latestInCategory(list, 'change-of-name');
}
