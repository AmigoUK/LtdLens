/**
 * Fans out to Companies House and composes a snapshot.
 *
 * Two things happen here that are worth stating plainly.
 *
 * **Depth follows the budget.** In brownout only the profile is fetched, so a
 * cold check costs one upstream call instead of four. The report still arrives,
 * honestly marked partial, and the flag engine already knows how to say "not
 * checked" rather than "clear".
 *
 * **Every failure is recorded rather than swallowed.** `Promise.allSettled` is
 * used, but no rejection disappears into a default: each one becomes a
 * `SourceResult` that the composer turns into a `sources` entry. Defaulting a
 * failed officer call to zero officers would produce a snapshot that looks fine
 * and is a lie.
 */

import type { CompanySnapshot } from '@ltdlens/shared';
import { composeSnapshot, hasChargesLink } from '@ltdlens/shared';
import type { SourceResult } from '@ltdlens/shared';
import type { CompaniesHouseUpstream, UpstreamFailure, UpstreamResult } from './upstream/types.js';
import type { GovernorState } from './governor.js';

export type AggregateOutcome =
  { ok: true; snapshot: CompanySnapshot } | { ok: false; failure: UpstreamFailure };

/** Turns an upstream result into the composer's source vocabulary. */
function toSource<T>(result: UpstreamResult<T> | undefined, skipped: boolean): SourceResult<T> {
  if (skipped) return { status: 'skipped' };
  if (result === undefined) return { status: 'failed' };
  if (result.ok) return { status: 'ok', data: result.data };
  // A 404 on a sub-resource means there is nothing there — no officers filed,
  // no charges registered. That is an answer, not a gap.
  return result.failure.kind === 'not-found' ? { status: 'not-applicable' } : { status: 'failed' };
}

export interface AggregateOptions {
  upstream: CompaniesHouseUpstream;
  number: string;
  state: GovernorState;
  now: Date;
}

export async function aggregateCompany(options: AggregateOptions): Promise<AggregateOutcome> {
  const { upstream, number, state, now } = options;

  // The profile is mandatory and is fetched first: without it there is no
  // company, and there is no point spending three more calls to find out.
  const profile = await upstream.profile(number);
  if (!profile.ok) return { ok: false, failure: profile.failure };

  // In brownout the optional depth is shed. This is a deliberate, reported
  // degradation rather than a silent one.
  const shedOptional = state === 'brownout' || state === 'lockout';

  // Only ask for charges when the profile says there are any. Saves a call on
  // most companies, and gives an honest `not-applicable` rather than an empty
  // list that reads the same as "we did not look".
  const chargesApplicable = hasChargesLink(profile.data);

  const [officers, charges, filings] = shedOptional
    ? [undefined, undefined, undefined]
    : await Promise.all([
        upstream.officers(number).catch(() => undefined),
        chargesApplicable ? upstream.charges(number).catch(() => undefined) : undefined,
        upstream.filings(number).catch(() => undefined),
      ]);

  const snapshot = composeSnapshot({
    profile: profile.data,
    officers: toSource(officers, shedOptional),
    charges: chargesApplicable ? toSource(charges, shedOptional) : { status: 'not-applicable' },
    filings: toSource(filings, shedOptional),
    fetchedAt: now,
  });

  return { ok: true, snapshot };
}
