/**
 * Assembles a `CompanySnapshot` from the four upstream calls.
 *
 * This is where partiality becomes structural. Each source arrives as a
 * `SourceResult` — present with a payload, deliberately skipped, failed, or not
 * applicable — and the composer records that verdict in `sources` rather than
 * quietly substituting zeros. A snapshot whose officer call failed reports
 * `officers: 'failed'`, and the flag engine then refuses to say anything about
 * officer churn instead of saying it is fine.
 *
 * The alternative — defaulting a failed call to empty counts — is what makes a
 * counterparty-risk tool dangerous. Nothing would look wrong: the panel would
 * show a green pill on a company nobody actually checked.
 */

import type {
  ChChargeList,
  ChCompanyProfile,
  ChFilingHistoryList,
  ChOfficerList,
  ChSearchItem,
  ChSearchResponse,
} from '../types/companiesHouse.js';
import type { CompanySnapshot, SnapshotSource, SourceStatus } from '../types/snapshot.js';
import { SNAPSHOT_SCHEMA } from '../types/snapshot.js';
import type { SearchHit, SearchResponse } from '../types/search.js';
import { normaliseCharges } from './charges.js';
import { normaliseCompanyNumber } from './companyNumber.js';
import type { CalendarDate } from './dates.js';
import { toCalendarDate } from './dates.js';
import {
  nameChangedOn as latestNameChange,
  normaliseRecentFilings,
  registeredOfficeChangedOn as latestOfficeMove,
} from './filingHistory.js';
import { normaliseOfficers } from './officers.js';
import {
  hasInsolvencyHistory,
  normaliseAccounts,
  normaliseConfirmationStatement,
  normalisePreviousNames,
  normaliseRegisteredOffice,
} from './profile.js';

/**
 * How one upstream call went. `ok` carries the payload; the others carry only
 * the reason, because there is nothing to carry.
 */
export type SourceResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'skipped' }
  | { status: 'failed' }
  | { status: 'not-applicable' };

export interface SnapshotInputs {
  /** The profile is mandatory: without it there is no company to describe. */
  profile: ChCompanyProfile;
  officers: SourceResult<ChOfficerList>;
  charges: SourceResult<ChChargeList>;
  filings: SourceResult<ChFilingHistoryList>;
  /** When the data was fetched. Freshness is judged from this, never a TTL. */
  fetchedAt: Date;
}

function statusOf<T>(result: SourceResult<T>): SourceStatus {
  return result.status;
}

function dataOf<T>(result: SourceResult<T>): T | undefined {
  return result.status === 'ok' ? result.data : undefined;
}

/** Thrown when the profile lacks the two fields that make it a company at all. */
export class UnusableProfileError extends Error {
  constructor(reason: string) {
    super(`Unusable company profile: ${reason}`);
    this.name = 'UnusableProfileError';
  }
}

export function composeSnapshot(inputs: SnapshotInputs): CompanySnapshot {
  const { profile } = inputs;

  const number = normaliseCompanyNumber(profile.company_number);
  if (number === undefined) throw new UnusableProfileError('no usable company_number');

  const name = profile.company_name?.trim();
  if (name === undefined || name.length === 0) {
    throw new UnusableProfileError('no company_name');
  }

  const status = profile.company_status?.trim();
  if (status === undefined || status.length === 0) {
    // Status drives the most severe flags there are. Guessing `active` because
    // the field is missing would be the worst possible failure mode.
    throw new UnusableProfileError('no company_status');
  }

  const now: CalendarDate = toCalendarDate(inputs.fetchedAt);
  const officerList = dataOf(inputs.officers);
  const chargeList = dataOf(inputs.charges);
  const filingList = dataOf(inputs.filings);

  const sources: Record<SnapshotSource, SourceStatus> = {
    profile: 'ok',
    officers: statusOf(inputs.officers),
    charges: statusOf(inputs.charges),
    filings: statusOf(inputs.filings),
  };

  // `not-applicable` is not partial: "this company has no charges" is a fact,
  // not a gap. Only a skipped or failed call leaves the reader less informed
  // than they asked to be.
  const partial = Object.values(sources).some((value) => value === 'skipped' || value === 'failed');

  const snapshot: CompanySnapshot = {
    schema: SNAPSHOT_SCHEMA,
    number,
    name,
    status,
    sicCodes: Array.isArray(profile.sic_codes)
      ? profile.sic_codes.filter((code): code is string => typeof code === 'string')
      : [],
    registeredOffice: normaliseRegisteredOffice(profile),
    accounts: normaliseAccounts(profile),
    confirmationStatement: normaliseConfirmationStatement(profile),
    officers: normaliseOfficers(officerList, now),
    charges: normaliseCharges(chargeList),
    recentFilings: normaliseRecentFilings(filingList),
    previousNames: normalisePreviousNames(profile.previous_company_names),
    hasInsolvencyHistory: hasInsolvencyHistory(profile),
    sources,
    partial,
    fetchedAt: inputs.fetchedAt.toISOString(),
  };

  const statusDetail = profile.company_status_detail?.trim();
  if (statusDetail !== undefined && statusDetail.length > 0) snapshot.statusDetail = statusDetail;

  const type = profile.type?.trim();
  if (type !== undefined && type.length > 0) snapshot.type = type;

  const jurisdiction = profile.jurisdiction?.trim();
  if (jurisdiction !== undefined && jurisdiction.length > 0) snapshot.jurisdiction = jurisdiction;

  if (profile.date_of_creation !== undefined) snapshot.incorporatedOn = profile.date_of_creation;
  if (profile.date_of_cessation !== undefined) snapshot.cessationOn = profile.date_of_cessation;

  // Both derived from filing history — see the note in filingHistory.ts on why
  // the profile cannot supply either reliably. When filings were not fetched,
  // these stay absent, and the rules that need them report "not checked".
  const officeMove = latestOfficeMove(filingList);
  if (officeMove !== undefined) snapshot.registeredOfficeChangedOn = officeMove;

  const nameChange = latestNameChange(filingList);
  if (nameChange !== undefined) snapshot.nameChangedOn = nameChange;

  return snapshot;
}

/** Search results. The query is deliberately not echoed back — see types/search.ts. */
export function normaliseSearch(
  response: ChSearchResponse | undefined,
  fetchedAt: Date,
): SearchResponse {
  const items = Array.isArray(response?.items) ? response.items : [];

  const hits = items
    .map((item) => toSearchHit(item))
    .filter((hit): hit is SearchHit => hit !== undefined);

  return {
    hits,
    totalResults:
      typeof response?.total_results === 'number' ? response.total_results : hits.length,
    fetchedAt: fetchedAt.toISOString(),
  };
}

function toSearchHit(item: ChSearchItem): SearchHit | undefined {
  const number = normaliseCompanyNumber(item.company_number);
  const name = item.title?.trim();
  if (number === undefined || name === undefined || name.length === 0) return undefined;

  const hit: SearchHit = {
    number,
    name,
    status: item.company_status?.trim() ?? 'unknown',
  };

  const type = item.company_type?.trim();
  if (type !== undefined && type.length > 0) hit.type = type;
  if (item.date_of_creation !== undefined) hit.incorporatedOn = item.date_of_creation;
  if (item.date_of_cessation !== undefined) hit.cessationOn = item.date_of_cessation;

  const snippet = item.address_snippet?.trim();
  if (snippet !== undefined && snippet.length > 0) hit.addressSnippet = snippet;

  return hit;
}
