/**
 * Pure logic shared by the extension and the Worker.
 *
 * Nothing in this package may touch a platform global — no `chrome`, no `fetch`,
 * no `window`, no ambient clock. Every function that needs "now" takes a `Date`;
 * every function that needs I/O takes an injected interface. ESLint enforces it.
 *
 * The normalisers live here, rather than in the Worker, for one reason: the
 * Worker aggregates for the shared-key path and the extension will aggregate for
 * the bring-your-own-key path. Duplicated, they would drift, and the symptom of
 * that drift is the same company showing different facts depending on a settings
 * toggle. On a product whose entire value is trust, that is indistinguishable
 * from dishonesty.
 */

/** Bumped when the wire format changes; part of every cache key. */
export const CONTRACT_VERSION = 1;

export type {
  ChAccounts,
  ChAddress,
  ChCharge,
  ChChargeList,
  ChCompanyLinks,
  ChCompanyProfile,
  ChConfirmationStatement,
  ChDate,
  ChFiling,
  ChFilingHistoryList,
  ChLastAccounts,
  ChNextAccounts,
  ChOfficer,
  ChOfficerList,
  ChPreviousCompanyName,
  ChSearchItem,
  ChSearchResponse,
} from './types/companiesHouse.js';

export type {
  AccountsFacts,
  ChargeFacts,
  CompanySnapshot,
  ConfirmationStatementFacts,
  FilingSummary,
  OfficerFacts,
  PreviousName,
  RegisteredOffice,
  SnapshotSource,
  SourceStatus,
} from './types/snapshot.js';
export { SNAPSHOT_SCHEMA } from './types/snapshot.js';

export type { SearchHit, SearchResponse } from './types/search.js';

export type { Flag, FlagEvaluation, FlagId, FlagLevel, Severity, Verdict } from './types/flags.js';

export type { CalendarDate } from './normalise/dates.js';
export {
  compareCalendarDates,
  daysBetween,
  daysInMonth,
  formatCalendarDate,
  isWithinMonths,
  monthsBetween,
  parseCalendarDate,
  toCalendarDate,
  toUtcDate,
} from './normalise/dates.js';

export {
  companyRecordUrl,
  companySearchUrl,
  isCompanyNumber,
  normaliseCompanyNumber,
} from './normalise/companyNumber.js';

export {
  hasChargesLink,
  hasInsolvencyHistory,
  normaliseAccounts,
  normaliseAddress,
  normaliseConfirmationStatement,
  normalisePreviousNames,
  normaliseRegisteredOffice,
} from './normalise/profile.js';

export { isResponsibleOfficer, normaliseOfficers } from './normalise/officers.js';
export { normaliseCharges } from './normalise/charges.js';
export {
  RECENT_FILINGS_LIMIT,
  nameChangedOn,
  normaliseRecentFilings,
  registeredOfficeChangedOn,
} from './normalise/filingHistory.js';

export type { SnapshotInputs, SourceResult } from './normalise/snapshot.js';
export { UnusableProfileError, composeSnapshot, normaliseSearch } from './normalise/snapshot.js';

export type { ApiErrorBody, ApiErrorCode } from './api/errors.js';
export { ERROR_MESSAGE, ERROR_STATUS, isApiErrorBody } from './api/errors.js';

export type {
  CompanyResponseBody,
  Freshness,
  HealthResponseBody,
  RatesResponseBody,
  SearchResponseBody,
} from './api/contract.js';
export { API_VERSION, HEADERS, PATHS } from './api/contract.js';

export type { RuleDefinition, RuleOutcome } from './flags/rules.js';
export { LEVEL_ORDER, RULES, RULES_BY_ID, RULESET_VERSION } from './flags/rules.js';
export {
  evaluateSnapshot,
  evaluateSnapshotAt,
  notCheckedDetail,
  overallSeverity,
} from './flags/engine.js';

export type { RatePeriod } from './rates/table.js';
export {
  RATE_PERIODS,
  STATUTORY_MARGIN_BP,
  TABLE_COVERS_TO,
  ratePeriodFor,
  statutoryRateBp,
} from './rates/table.js';

export type { InterestInput, InterestResult, InterestWarning } from './rates/calculator.js';
export {
  COMPENSATION_BANDS,
  RECOVERY_LIMIT_YEARS,
  calculateStatutoryInterest,
  compensationFor,
} from './rates/calculator.js';

export type { WordingInput } from './rates/wording.js';
export {
  buildDemandParagraph,
  formatBritishDate,
  formatPence,
  formatRate,
} from './rates/wording.js';
