/**
 * Fixtures are a workspace, not a folder, because workerd has no filesystem:
 * the Worker must import them statically so the bundler inlines them. That also
 * guarantees the extension's tests and the Worker's tests run against
 * byte-identical inputs.
 *
 * Three kinds live here and must not be mixed:
 *
 *   - **contract** — raw Companies House payloads, proving the normalisers match
 *     the real schema. Fidelity matters; branch coverage does not.
 *   - **golden** — recorded `/v1/company` output plus `recordedAt`, so tests can
 *     freeze "now" and never rot as filing deadlines roll forward. Arrives with
 *     the Worker in v0.1.0.
 *   - **synthetic** — hand-authored inputs for boundaries. No real company
 *     reliably has "exactly one active officer and one resignation five months
 *     ago" on the day you need it, and none will still have it next month.
 *
 * **Everything here is currently hand-authored from the published schemas**,
 * because there is no Companies House API key yet. They will be subtly wrong in
 * places — see `fixtures/README.md`. Re-recording them against the live API is a
 * budgeted half-day, not a formality: a test suite that passes against fiction
 * is worse than no test suite, because it is trusted.
 */

import type {
  ChChargeList,
  ChCompanyProfile,
  ChFilingHistoryList,
  ChOfficerList,
  ChSearchResponse,
} from '@ltdlens/shared';

import tescoProfile from './companies-house/company/00445790/profile.json' with { type: 'json' };
import tescoOfficers from './companies-house/company/00445790/officers.json' with { type: 'json' };
import tescoCharges from './companies-house/company/00445790/charges.json' with { type: 'json' };
import tescoFilings from './companies-house/company/00445790/filing-history.json' with { type: 'json' };

import distressedProfile from './companies-house/company/99000001/profile.json' with { type: 'json' };
import distressedOfficers from './companies-house/company/99000001/officers.json' with { type: 'json' };
import distressedCharges from './companies-house/company/99000001/charges.json' with { type: 'json' };
import distressedFilings from './companies-house/company/99000001/filing-history.json' with { type: 'json' };

import ceasedProfile from './companies-house/company/99000002/profile.json' with { type: 'json' };
import ceasedOfficers from './companies-house/company/99000002/officers.json' with { type: 'json' };
import ceasedFilings from './companies-house/company/99000002/filing-history.json' with { type: 'json' };

import newcoProfile from './companies-house/company/99000003/profile.json' with { type: 'json' };
import newcoOfficers from './companies-house/company/99000003/officers.json' with { type: 'json' };
import newcoFilings from './companies-house/company/99000003/filing-history.json' with { type: 'json' };

import tescoSearch from './companies-house/search/tesco.json' with { type: 'json' };

/** Marker string. CI greps the built production Worker bundle for it and fails
 *  if it appears — fixtures must be tree-shaken out of anything users reach. */
export const FIXTURES_MARKER = 'LTDLENS_FIXTURE_MARKER';

export interface CompanyFixture {
  number: string;
  name: string;
  /** True only for companies whose data came from the live register. */
  real: boolean;
  /** What this fixture is here to exercise. */
  covers: string;
  profile: ChCompanyProfile;
  officers?: ChOfficerList;
  charges?: ChChargeList;
  filings?: ChFilingHistoryList;
}

const fixtures: CompanyFixture[] = [
  {
    number: '00445790',
    name: 'TESCO PLC',
    real: true,
    covers:
      'A long-established, fully compliant company. The all-clear baseline, and the anchor for search disambiguation.',
    profile: tescoProfile,
    officers: tescoOfficers,
    charges: tescoCharges,
    filings: tescoFilings,
  },
  {
    number: '99000001',
    name: 'DISTRESSED TRADING LIMITED',
    real: false,
    covers:
      'Accounts overdue, confirmation statement overdue, proposed for strike off, two director resignations in six months, a charge created four months ago, undeliverable registered office. Exercises pill precedence with several red flags at once.',
    profile: distressedProfile,
    officers: distressedOfficers,
    charges: distressedCharges,
    filings: distressedFilings,
  },
  {
    number: '99000002',
    name: 'CEASED HOLDINGS LIMITED',
    real: false,
    covers:
      'In liquidation, with insolvency filings, a rename in 2021 and no charges link at all — so charges resolve to not-applicable rather than to a gap.',
    profile: ceasedProfile,
    officers: ceasedOfficers,
    filings: ceasedFilings,
  },
  {
    number: '99000003',
    name: 'NEWCO VENTURES LIMITED',
    real: false,
    covers:
      'Incorporated five months ago, no accounts filed yet, one director, and a registered office move last month. Exercises the young-company and recently-moved rules together.',
    profile: newcoProfile,
    officers: newcoOfficers,
    filings: newcoFilings,
  },
];

const byNumber = new Map(fixtures.map((fixture) => [fixture.number, fixture]));

export function listCompanyFixtures(): readonly CompanyFixture[] {
  return fixtures;
}

export function getCompanyFixture(number: string): CompanyFixture | undefined {
  return byNumber.get(number);
}

const searches = new Map<string, ChSearchResponse>([['tesco', tescoSearch]]);

/** Matches on a normalised prefix, so `tesco plc` finds the `tesco` fixture. */
export function getSearchFixture(query: string): ChSearchResponse | undefined {
  const normalised = query.trim().toLowerCase();
  for (const [key, response] of searches) {
    if (normalised.startsWith(key)) return response;
  }
  return undefined;
}
