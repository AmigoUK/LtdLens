/**
 * `GET /v1/rates/late-payment` — the statutory rate table.
 *
 * This endpoint is **not** how the calculator gets its rates. The table ships
 * inside the extension, because the calculator needs history anyway — a debt
 * from 2023 takes the 2023 reference rate — and because a calculator that makes
 * no network request at all is both a better product and a privacy claim that
 * can be demonstrated live in DevTools.
 *
 * What this endpoint is for is updates. The statutory rate is a step function
 * fixed twice a year, on 30 June and 31 December, so a seven-day cache is ample:
 * an installation that has not been updated in months still picks up a new
 * half-year entry without waiting for a store release.
 *
 * It touches neither upstream nor KV. It is a constant, served with a long TTL.
 */

import {
  RATE_PERIODS,
  STATUTORY_MARGIN_BP,
  TABLE_COVERS_TO,
  formatCalendarDate,
} from '@ltdlens/shared';
import type { RatesResponseBody } from '@ltdlens/shared';
import { json } from '../http.js';

const TTL_SECONDS = 7 * 24 * 60 * 60;

export function handleRates(now: Date): Response {
  const body: RatesResponseBody = {
    periods: [...RATE_PERIODS],
    marginBp: STATUTORY_MARGIN_BP,
    coversTo: formatCalendarDate(TABLE_COVERS_TO),
    fetchedAt: now.toISOString(),
  };

  return json(body, {
    headers: { 'Cache-Control': `public, max-age=${TTL_SECONDS}` },
  });
}
