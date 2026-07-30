/**
 * Wire contract shared by the Worker and the extension: paths, header names and
 * freshness vocabulary. Both sides import these rather than repeating strings,
 * so a rename is a compile error instead of a silent mismatch.
 */

import type { CompanySnapshot } from '../types/snapshot.js';
import type { SearchHit } from '../types/search.js';
import type { RatePeriod } from '../rates/table.js';

export const API_VERSION = 'v1';

export const PATHS = {
  search: `/${API_VERSION}/search`,
  company: `/${API_VERSION}/company`,
  rates: `/${API_VERSION}/rates/late-payment`,
  health: `/${API_VERSION}/health`,
} as const;

/** How old the served snapshot is, and how it should be presented. */
export type Freshness =
  /** Under twelve hours. Serve without comment. */
  | 'fresh'
  /** Twelve to twenty-four hours. Served immediately, refreshed in background. */
  | 'stale'
  /**
   * Older than a day, served only because upstream is unavailable or the
   * governor is locked out. The interface must show the age prominently — a
   * three-week-old report is far better than an error screen, but only if the
   * reader knows how old it is.
   */
  | 'emergency';

export const HEADERS = {
  /** Age of the served snapshot, in seconds. */
  snapshotAge: 'X-Snapshot-Age',
  /** One of the `Freshness` values. */
  snapshotFresh: 'X-Snapshot-Fresh',
  /** `live` or `fixture`. Makes it impossible to mistake demo data for real. */
  upstream: 'X-LtdLens-Upstream',
  /** Set on a request to force a fixture scenario in development. */
  fixtureScenario: 'X-Fixture-Scenario',
} as const;

export interface SearchResponseBody {
  hits: SearchHit[];
  totalResults: number;
  fetchedAt: string;
}

export type CompanyResponseBody = CompanySnapshot;

export interface RatesResponseBody {
  /** Every six-month period, so the client can price historical debts offline. */
  periods: RatePeriod[];
  /** Eight percentage points, in basis points. */
  marginBp: number;
  /** Last day the table covers. Beyond it the client must refuse to calculate. */
  coversTo: string;
  fetchedAt: string;
}

export interface HealthResponseBody {
  ok: true;
  environment: string;
  upstream: 'live' | 'fixture';
  schema: string;
  rulesetVersion: string;
}
