/**
 * Input validation. Fail closed: anything not recognised is rejected rather than
 * passed upstream, because an upstream call is a slice of a shared budget.
 */

import { normaliseCompanyNumber } from '@ltdlens/shared';

export const MAX_QUERY_LENGTH = 160;
export const MIN_QUERY_LENGTH = 2;

/** Canonical company number, or undefined if the input cannot be one. */
export function validateCompanyNumber(raw: string | undefined): string | undefined {
  return normaliseCompanyNumber(raw);
}

export type QueryValidation =
  { ok: true; query: string } | { ok: false; reason: 'empty' | 'too-short' | 'too-long' };

/**
 * Search queries are trimmed and collapsed, never rewritten. Guessing at what
 * somebody meant would spend a request from the shared budget on a search they
 * did not ask for.
 */
export function validateQuery(raw: string | null): QueryValidation {
  if (raw === null) return { ok: false, reason: 'empty' };

  const query = raw.replace(/\s+/g, ' ').trim();
  if (query.length === 0) return { ok: false, reason: 'empty' };
  if (query.length < MIN_QUERY_LENGTH) return { ok: false, reason: 'too-short' };
  if (query.length > MAX_QUERY_LENGTH) return { ok: false, reason: 'too-long' };

  return { ok: true, query };
}
