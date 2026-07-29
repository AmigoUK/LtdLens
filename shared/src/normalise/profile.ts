/**
 * Company profile → the facts LtdLens reports.
 *
 * The recurring decision here is what a missing field means. Companies House
 * omits plenty legitimately, so the rule throughout is: report absence as
 * absence, and never let a default stand in for a fact. `accounts.overdue` is
 * `true` only when Companies House says `true` — it is never inferred by
 * comparing `next_due` to today, because the register applies filing extensions
 * and grace periods we cannot see, and "overdue" is the single most consequential
 * word this product puts on screen.
 */

import type {
  ChAddress,
  ChCompanyProfile,
  ChPreviousCompanyName,
} from '../types/companiesHouse.js';
import type {
  AccountsFacts,
  ConfirmationStatementFacts,
  PreviousName,
  RegisteredOffice,
} from '../types/snapshot.js';
import { parseCalendarDate } from './dates.js';

/** Keeps a value only if it is a non-empty string once trimmed. */
function text(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** Keeps a date only if it parses as a real calendar date. */
function date(value: string | undefined): string | undefined {
  return parseCalendarDate(value) === undefined ? undefined : value!.trim();
}

/**
 * Assigns only defined values. Needed because `exactOptionalPropertyTypes`
 * distinguishes an absent property from one explicitly set to `undefined`, and
 * the distinction matters when a snapshot is serialised into a cache.
 */
function compact<T extends object>(source: { [K in keyof T]?: T[K] | undefined }): T {
  const result = {} as T;
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) (result as Record<string, unknown>)[key] = value;
  }
  return result;
}

export function normaliseAddress(
  address: ChAddress | undefined,
): Omit<RegisteredOffice, 'inDispute' | 'undeliverable'> {
  if (!address) return {};
  return compact({
    premises: text(address.premises),
    addressLine1: text(address.address_line_1),
    addressLine2: text(address.address_line_2),
    locality: text(address.locality),
    region: text(address.region),
    postalCode: text(address.postal_code),
    country: text(address.country),
  });
}

export function normaliseRegisteredOffice(profile: ChCompanyProfile): RegisteredOffice {
  return {
    ...normaliseAddress(profile.registered_office_address),
    inDispute: profile.registered_office_is_in_dispute === true,
    undeliverable: profile.undeliverable_registered_office_address === true,
  };
}

export function normaliseAccounts(profile: ChCompanyProfile): AccountsFacts {
  const accounts = profile.accounts;
  const last = accounts?.last_accounts;

  // Companies House reports overdue in two places and they can disagree while
  // a filing is being processed. Either saying so is enough: under-reporting
  // "overdue" is the failure that costs a user money.
  const overdue = accounts?.overdue === true || accounts?.next_accounts?.overdue === true;

  // `period_end_on` supersedes the deprecated `made_up_to`, but plenty of
  // records still carry only the latter.
  const lastPeriodEndOn = date(last?.period_end_on) ?? date(last?.made_up_to);

  // A company that has never filed accounts is a different fact from one whose
  // accounts we could not read — the young-company rule depends on telling them
  // apart, and `last_accounts` is absent entirely in the first case.
  const hasEverFiled = lastPeriodEndOn !== undefined || text(last?.type) !== undefined;

  return compact<AccountsFacts>({
    overdue,
    nextDue: date(accounts?.next_due) ?? date(accounts?.next_accounts?.due_on),
    nextMadeUpTo: date(accounts?.next_made_up_to) ?? date(accounts?.next_accounts?.period_end_on),
    lastPeriodEndOn,
    lastType: text(last?.type),
    hasEverFiled,
  });
}

export function normaliseConfirmationStatement(
  profile: ChCompanyProfile,
): ConfirmationStatementFacts {
  const statement = profile.confirmation_statement;
  return compact<ConfirmationStatementFacts>({
    overdue: statement?.overdue === true,
    nextDue: date(statement?.next_due),
    lastMadeUpTo: date(statement?.last_made_up_to),
  });
}

export function normalisePreviousNames(names: ChPreviousCompanyName[] | undefined): PreviousName[] {
  if (!Array.isArray(names)) return [];

  return (
    names
      .map((entry) => {
        const name = text(entry.name);
        if (name === undefined) return undefined;
        return compact<PreviousName>({
          name,
          effectiveFrom: date(entry.effective_from),
          ceasedOn: date(entry.ceased_on),
        });
      })
      .filter((entry): entry is PreviousName => entry !== undefined)
      // Most recently ceased first, so "renamed on" reads off the head.
      .sort((a, b) => (b.ceasedOn ?? '').localeCompare(a.ceasedOn ?? ''))
  );
}

/**
 * Whether Companies House holds insolvency filings.
 *
 * `has_insolvency_history` is deprecated in favour of `links.insolvency`, but
 * older recordings and some responses still carry only the boolean, so both
 * are read.
 */
export function hasInsolvencyHistory(profile: ChCompanyProfile): boolean {
  return profile.links?.insolvency !== undefined || profile.has_insolvency_history === true;
}

/** Whether the company has any charges to fetch at all. */
export function hasChargesLink(profile: ChCompanyProfile): boolean {
  return profile.links?.charges !== undefined || profile.has_charges === true;
}
