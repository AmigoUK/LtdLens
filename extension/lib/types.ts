/**
 * Types shared across the extension's surfaces.
 *
 * Message contracts are discriminated unions rather than loose objects, so a
 * renamed field is a compile error in both the sender and the handler instead of
 * an `undefined` that shows up as an empty panel.
 */

import type { CompanySnapshot, SearchResponse } from '@ltdlens/shared';

/** Where a lookup came from. Useful for deciding what to do on failure. */
export type RequestSource = 'context-menu' | 'popup' | 'query-param' | 'onboarding';

export interface PanelRequest {
  /** Deduplicates across the open/broadcast race. See `platform/panel.ts`. */
  requestId: string;
  /** The user's selection, verbatim, for display while resolving. */
  raw: string;
  at: string;
  source: RequestSource;
}

export interface HistoryEntry {
  number: string;
  name: string;
  /** ISO timestamp of the most recent view. */
  at: string;
}

/** How a lookup was answered. Carried through to the interface. */
export type ResultSource = 'network' | 'cache' | 'demo';

export type ApiFailureKind =
  | 'offline'
  | 'timeout'
  | 'not-found'
  | 'bad-request'
  | 'rate-limited'
  | 'budget-exhausted'
  | 'paused'
  | 'upstream'
  | 'bad-response';

/**
 * The result of any lookup.
 *
 * A failure can still carry data: an expired cache entry is offered as
 * `fallback` so the panel can say "showing the report saved on 9 July" rather
 * than only "something went wrong". A three-week-old report is far better than
 * an error screen, provided its age is stated.
 */
export type ApiResult<T> =
  | {
      state: 'ok';
      data: T;
      source: ResultSource;
      fetchedAt: string;
      /** True when the data is past its freshness window but still usable. */
      stale: boolean;
    }
  | {
      state: 'error';
      kind: ApiFailureKind;
      message: string;
      retryAfterSeconds?: number;
      /** The official Companies House record, when a number is known. */
      fallbackUrl?: string;
      fallback?: { data: T; fetchedAt: string };
    };

/** Surfaces → background. */
export type BgRequest =
  | { type: 'company/search'; query: string }
  | { type: 'company/get'; number: string; refresh?: boolean }
  | { type: 'panel/pending' }
  | { type: 'history/list' }
  | { type: 'history/remove'; number: string }
  | { type: 'history/clear' }
  | { type: 'cache/clear' }
  | { type: 'settings/get' };

/** Background → surfaces. Broadcast; nobody may be listening yet. */
export type BgBroadcast =
  | { type: 'panel/request'; request: PanelRequest }
  | { type: 'panel/result'; requestId: string; result: ApiResult<CompanySnapshot> };

export type SearchResult = ApiResult<SearchResponse>;
export type CompanyResult = ApiResult<CompanySnapshot>;
