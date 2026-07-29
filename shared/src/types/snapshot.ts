/**
 * `CompanySnapshot` is the contract between the Worker and the extension, and
 * every other decision in this project hangs off it.
 *
 * Two properties matter more than the field list:
 *
 * 1. **It carries facts, never judgements.** No flags, no severity, no score.
 *    The flag ruleset runs in the browser at render time. That means a rule fix
 *    ships with the extension and instantly corrects every cached report — no
 *    KV purge, no Worker redeploy — and it means a verdict about a named UK
 *    company is the user's reading of a public record rather than something
 *    attv.uk publishes from a server.
 *
 * 2. **It says what it does not know.** `sources` records how each upstream
 *    call went, and `partial` is true whenever any of them failed or was
 *    skipped. Rules declare the sources they need, so a rule whose input is
 *    missing reports "not checked" rather than "clear". Absence of evidence
 *    rendering as evidence of absence — a green pill on a company nobody
 *    actually checked — is the only genuinely dangerous output this product
 *    can produce.
 *
 * Adding a field a new rule needs is a schema bump (`SNAPSHOT_SCHEMA`), which
 * changes the cache key prefix and lets old entries age out. Never write a KV
 * migration.
 */

/** Bumped whenever the shape changes. Forms part of the cache key. */
export const SNAPSHOT_SCHEMA = 1;

/** The upstream calls a snapshot is assembled from. */
export type SnapshotSource = 'profile' | 'officers' | 'charges' | 'filings';

/**
 * - `ok` — fetched and parsed.
 * - `skipped` — deliberately not fetched, e.g. the Worker was in brownout and
 *   shed optional depth to stay inside the Companies House rate limit.
 * - `failed` — attempted and did not succeed.
 * - `not-applicable` — the profile says there is nothing to fetch, e.g. no
 *   `links.charges` means the company has no charges rather than unknown ones.
 */
export type SourceStatus = 'ok' | 'skipped' | 'failed' | 'not-applicable';

export interface RegisteredOffice {
  /**
   * Kept structured rather than flattened to a string. Flattening at the API
   * boundary throws away the postcode as a field and hardcodes one address
   * format; formatting belongs in the UI layer.
   */
  premises?: string;
  addressLine1?: string;
  addressLine2?: string;
  locality?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  /** Companies House flags addresses under challenge; worth surfacing. */
  inDispute: boolean;
  undeliverable: boolean;
}

export interface AccountsFacts {
  /** `true` only when Companies House says so. Never inferred from dates. */
  overdue: boolean;
  nextDue?: string;
  nextMadeUpTo?: string;
  lastPeriodEndOn?: string;
  lastType?: string;
  /**
   * Distinguishes "no accounts filed yet" from "we could not tell". A company
   * incorporated last month legitimately has none; that is a different fact
   * from a failed lookup.
   */
  hasEverFiled: boolean;
}

export interface ConfirmationStatementFacts {
  overdue: boolean;
  nextDue?: string;
  lastMadeUpTo?: string;
}

export interface OfficerFacts {
  activeCount: number;
  resignedCount: number;
  /** Counted against the snapshot's `fetchedAt`, not against the reader's clock. */
  appointedLast6m: number;
  resignedLast6m: number;
}

export interface ChargeFacts {
  outstanding: number;
  satisfied: number;
  partSatisfied: number;
  /** Most recent `created_on` among outstanding charges, if any. */
  mostRecentCreatedOn?: string;
}

export interface FilingSummary {
  date: string;
  category: string;
  description: string;
  type?: string;
}

export interface PreviousName {
  name: string;
  effectiveFrom?: string;
  ceasedOn?: string;
}

export interface CompanySnapshot {
  schema: typeof SNAPSHOT_SCHEMA;

  number: string;
  name: string;
  /** Raw Companies House value, e.g. `active`, `liquidation`, `dissolved`. */
  status: string;
  /** e.g. `active-proposal-to-strike-off`. Absent for most companies. */
  statusDetail?: string;
  type?: string;
  jurisdiction?: string;
  incorporatedOn?: string;
  cessationOn?: string;

  /** Codes only. Descriptions are resolved in the extension, offline. */
  sicCodes: string[];
  registeredOffice: RegisteredOffice;

  accounts: AccountsFacts;
  confirmationStatement: ConfirmationStatementFacts;
  officers: OfficerFacts;
  charges: ChargeFacts;

  recentFilings: FilingSummary[];
  previousNames: PreviousName[];
  /** Latest `change-of-name` filing date, if the company has been renamed. */
  nameChangedOn?: string;
  /** Latest `address` category filing date — the registered office moving. */
  registeredOfficeChangedOn?: string;

  /** Companies House holds insolvency filings for this company. */
  hasInsolvencyHistory: boolean;

  sources: Record<SnapshotSource, SourceStatus>;
  /** True when any source is `skipped` or `failed`. Never silently ignored. */
  partial: boolean;

  /** ISO timestamp. Freshness is decided from this, never from a cache TTL. */
  fetchedAt: string;
}
