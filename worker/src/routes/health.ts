/**
 * `GET /v1/health`.
 *
 * Reports which upstream is in use, which is the point: after a deployment the
 * one thing worth confirming immediately is that a production Worker is not
 * quietly serving fixture data. It carries no counters and no request
 * statistics, because there are none to carry.
 */

import { RULESET_VERSION } from '@ltdlens/shared';
import type { HealthResponseBody } from '@ltdlens/shared';
import type { Config } from '../env.js';
import { json } from '../http.js';

export function handleHealth(config: Config): Response {
  const body: HealthResponseBody = {
    ok: true,
    environment: config.environment,
    upstream: config.upstream,
    schema: config.schema,
    rulesetVersion: RULESET_VERSION,
  };
  return json(body, { headers: { 'Cache-Control': 'no-store' } });
}
