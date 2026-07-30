/**
 * The single response constructor.
 *
 * Every response the Worker emits goes through here, which is what makes the
 * CORS policy, the security headers and the error shape impossible to forget on
 * one route.
 *
 * **CORS is `*` with no credentials, and that is deliberate.** Locking the origin
 * to the extension's id is tempting and buys nothing: anyone can `curl` the
 * endpoint, there is no authentication, and the data is public. What it does buy
 * is breakage — a development build has a different extension id from the
 * published one, so it would need a manifest key and a maintained allow-list,
 * and anyone running a fork would be locked out for no reason. Recorded so it is
 * not later "hardened" by someone reading it as a bug.
 */

import type { ApiErrorBody, ApiErrorCode } from '@ltdlens/shared';
import { ERROR_MESSAGE, ERROR_STATUS, companyRecordUrl } from '@ltdlens/shared';

const BASE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Fixture-Scenario',
  'Access-Control-Max-Age': '86400',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  // There is nothing to frame and nothing to execute; say so.
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
};

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...BASE_HEADERS, ...init.headers },
  });
}

export interface ErrorOptions {
  /** Overrides the default wording for the code. */
  message?: string;
  retryAfterSeconds?: number;
  /** When known, the official record is always offered as a fallback. */
  companyNumber?: string;
}

export function error(code: ApiErrorCode, options: ErrorOptions = {}): Response {
  const body: ApiErrorBody = {
    error: {
      code,
      message: options.message ?? ERROR_MESSAGE[code],
    },
  };

  if (options.retryAfterSeconds !== undefined) {
    body.error.retryAfter = options.retryAfterSeconds;
  }
  if (options.companyNumber !== undefined) {
    // Computed here rather than in the extension, so graceful degradation is one
    // field to read instead of a branch in five components.
    body.error.fallbackUrl = companyRecordUrl(options.companyNumber);
  }

  const headers: Record<string, string> = {};
  if (options.retryAfterSeconds !== undefined) {
    headers['Retry-After'] = String(options.retryAfterSeconds);
  }

  return json(body, { status: ERROR_STATUS[code], headers });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: BASE_HEADERS });
}
