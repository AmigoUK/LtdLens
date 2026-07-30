/**
 * The Demo mode transport: bundled fixtures, no network.
 *
 * Shipped in production, deliberately. It costs about sixty kilobytes and buys
 * three things: a Chrome Web Store reviewer can see a working report without being
 * handed credentials or burning shared rate limit; onboarding can show a real
 * report rather than a screenshot that goes stale; and when the lookup service is
 * unreachable the extension degrades to something rather than nothing.
 *
 * Unlike the Worker's fixture upstream, this one composes snapshots locally
 * through the same `shared` normalisers, so Demo mode exercises the real code path
 * rather than replaying canned responses.
 */

import { getCompanyFixture, getSearchFixture, listCompanyFixtures } from '@ltdlens/fixtures';
import type { SourceResult } from '@ltdlens/shared';
import {
  PATHS,
  RATE_PERIODS,
  STATUTORY_MARGIN_BP,
  TABLE_COVERS_TO,
  composeSnapshot,
  formatCalendarDate,
  normaliseCompanyNumber,
  normaliseSearch,
} from '@ltdlens/shared';
import type { Transport, TransportResponse } from '../lib/transport.js';

/** Just enough delay that loading states are visible rather than a flash. */
const LATENCY_MS = 180;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonResponse(status: number, body: unknown): TransportResponse {
  return { status, body, headers: { 'content-type': 'application/json' } };
}

function notFound(number: string): TransportResponse {
  return jsonResponse(404, {
    error: {
      code: 'COMPANY_NOT_FOUND',
      message: 'That company is not in the demo set.',
      fallbackUrl: `https://find-and-update.company-information.service.gov.uk/company/${number}`,
    },
  });
}

export function createFixtureTransport(now: () => Date = () => new Date()): Transport {
  return async (request) => {
    await delay(LATENCY_MS);

    if (request.path === PATHS.rates) {
      return jsonResponse(200, {
        periods: [...RATE_PERIODS],
        marginBp: STATUTORY_MARGIN_BP,
        coversTo: formatCalendarDate(TABLE_COVERS_TO),
        fetchedAt: now().toISOString(),
      });
    }

    if (request.path === PATHS.search) {
      const query = request.query?.q ?? '';
      const recorded = getSearchFixture(query);
      if (recorded !== undefined) return jsonResponse(200, normaliseSearch(recorded, now()));

      // No recorded search for this query, so match the demo set by name. Better
      // than an empty list: a reviewer typing "distressed" should find something.
      const needle = query.trim().toLowerCase();
      const hits = listCompanyFixtures()
        .filter((fixture) => needle.length > 0 && fixture.name.toLowerCase().includes(needle))
        .map((fixture) => ({
          number: fixture.number,
          name: fixture.name,
          status: fixture.profile.company_status ?? 'unknown',
          ...(fixture.profile.date_of_creation === undefined
            ? {}
            : { incorporatedOn: fixture.profile.date_of_creation }),
        }));

      return jsonResponse(200, { hits, totalResults: hits.length, fetchedAt: now().toISOString() });
    }

    if (request.path.startsWith(`${PATHS.company}/`)) {
      const raw = request.path.slice(PATHS.company.length + 1);
      const number = normaliseCompanyNumber(raw);
      if (number === undefined) {
        return jsonResponse(400, {
          error: { code: 'BAD_REQUEST', message: 'That does not look like a UK company number.' },
        });
      }

      const fixture = getCompanyFixture(number);
      if (fixture === undefined) return notFound(number);

      const optional = <T>(data: T | undefined): SourceResult<T> =>
        data === undefined ? { status: 'not-applicable' } : { status: 'ok', data };

      const snapshot = composeSnapshot({
        profile: fixture.profile,
        officers: optional(fixture.officers),
        charges: optional(fixture.charges),
        filings: optional(fixture.filings),
        fetchedAt: now(),
      });

      return jsonResponse(200, snapshot);
    }

    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'No such endpoint.' } });
  };
}
