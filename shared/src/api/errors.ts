/**
 * The error contract between the Worker and the extension.
 *
 * One body shape, always. The extension's side panel has a state for every code
 * below, so a new code is a deliberate change to both halves rather than
 * something that degrades into a generic "something went wrong".
 *
 * **There is no request identifier**, and that is not an oversight. There is no
 * request log to correlate one with. Saying so in `PRIVACY.md` is a stronger
 * claim than promising not to log.
 */

export type ApiErrorCode =
  /** Malformed company number or empty query. No point retrying. */
  | 'BAD_REQUEST'
  /** No company with that number on the register. */
  | 'COMPANY_NOT_FOUND'
  /** The Worker's own per-client throttle. */
  | 'TOO_MANY_REQUESTS'
  /** Governor lockout: the shared Companies House budget is spent. */
  | 'UPSTREAM_BUDGET_EXHAUSTED'
  /** Companies House returned 5xx or timed out, and nothing was cached. */
  | 'UPSTREAM_UNAVAILABLE'
  /** The owner has paused the service — see the kill switch. */
  | 'SERVICE_PAUSED'
  /** A route that does not exist. */
  | 'NOT_FOUND';

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    /** British English, addressed to the user, no jargon and no stack. */
    message: string;
    /** Seconds. Mirrors the `Retry-After` header, and is binding on the client. */
    retryAfter?: number;
    /**
     * The official Companies House record.
     *
     * Present on every error where a company number is known, and computed by
     * the Worker rather than the extension. Graceful degradation is then one
     * field to read instead of a branch in five components — and the promise
     * that a user is always one click from the official record becomes
     * something the contract carries rather than something the UI remembers.
     */
    fallbackUrl?: string;
  };
}

/** HTTP status each code is served with. */
export const ERROR_STATUS: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  COMPANY_NOT_FOUND: 404,
  TOO_MANY_REQUESTS: 429,
  UPSTREAM_BUDGET_EXHAUSTED: 503,
  UPSTREAM_UNAVAILABLE: 502,
  SERVICE_PAUSED: 503,
  NOT_FOUND: 404,
};

/** Default wording. The Worker may override it with something more specific. */
export const ERROR_MESSAGE: Record<ApiErrorCode, string> = {
  BAD_REQUEST: 'That does not look like a UK company number.',
  COMPANY_NOT_FOUND: 'There is no company with that number on the register.',
  TOO_MANY_REQUESTS: 'Steady on — too many lookups at once. Please try again shortly.',
  UPSTREAM_BUDGET_EXHAUSTED:
    'The free lookup service has reached its limit for the moment. Please try again shortly.',
  UPSTREAM_UNAVAILABLE: 'Companies House is not responding at the moment.',
  SERVICE_PAUSED: 'The lookup service is paused.',
  NOT_FOUND: 'No such endpoint.',
};

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const error = (value as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code in ERROR_STATUS;
}
