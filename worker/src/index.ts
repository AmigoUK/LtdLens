/**
 * LtdLens API.
 *
 * The Worker exists for exactly one reason: so users never need their own
 * Companies House API key. It returns normalised register facts and nothing
 * else — no verdicts, no scores, and no record of who asked.
 *
 * What that second half means in practice, and why it is architectural rather
 * than a promise:
 *
 *   - Nothing is logged. `no-console` is a lint error everywhere in this package
 *     except one observability module, and CI greps for violations.
 *   - Search queries are never written to KV, only to the colo-local edge cache,
 *     and even there the key is a hash. The response never echoes the query.
 *   - Company snapshots are keyed by a public identifier and contain public
 *     register data, so they are not user data at all.
 *   - `observability.enabled` is false in every environment block, which is what
 *     stops Cloudflare retaining request URLs for three days. CI asserts it.
 *
 * The residual is honest: a user's IP address passes transiently through
 * Cloudflare's transport layer, as it does for any HTTP request anywhere. That is
 * stated in PRIVACY.md rather than glossed over.
 */

import { PATHS } from '@ltdlens/shared';
import type { Env } from './env.js';
import { ConfigurationError, parseEnv } from './env.js';
import { budgetTracker } from './budget.js';
import { edgeCache, kvSnapshotStore } from './cache/store.js';
import { readControl } from './control.js';
import { count } from './observability/counters.js';
import { throttle } from './security/throttle.js';
import { error, json, preflight } from './http.js';
import { handleCompany } from './routes/company.js';
import { handleHealth } from './routes/health.js';
import { handleRates } from './routes/rates.js';
import { handleSearch } from './routes/search.js';
import { createUpstream } from './upstream/index.js';
import { parseFixtureScenario } from './upstream/types.js';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') return preflight();
    if (request.method !== 'GET') {
      return error('BAD_REQUEST', { message: 'Only GET is supported.' });
    }

    let config;
    try {
      config = parseEnv(env);
    } catch (cause) {
      // Deliberately terse. A misconfigured Worker must not describe its own
      // configuration to the internet.
      const message =
        cause instanceof ConfigurationError
          ? 'The lookup service is not configured correctly.'
          : 'The lookup service is unavailable.';
      return error('SERVICE_PAUSED', { message });
    }

    const url = new URL(request.url);
    const now = () => new Date();

    // Health and rates are answered before any of the checks below. Health must
    // stay reachable when the service is paused — otherwise there is no way to
    // confirm the pause took effect — and rates is a compiled-in constant that
    // costs nothing and lets the calculator keep working through an outage.
    if (url.pathname === PATHS.health) return handleHealth(config);
    if (url.pathname === PATHS.rates) return handleRates(now());

    const control = await readControl(env.SNAPSHOTS, now());
    if (control.mode === 'off') {
      count('control.paused');
      return error('SERVICE_PAUSED', {
        // The owner's own wording, verbatim. Whoever pauses the service knows
        // why better than any message compiled in here.
        ...(control.message === undefined ? {} : { message: control.message }),
      });
    }

    const decision = await throttle({
      request,
      salt: env.IP_SALT,
      now,
      cache: edgeCache(),
    });
    if (!decision.allowed) {
      count('throttle.rejected');
      return error('TOO_MANY_REQUESTS', { retryAfterSeconds: decision.retryAfterSeconds });
    }

    // Only honoured by the fixture upstream, and ignored entirely in production
    // because the fixture module is not in the bundle.
    const scenario = parseFixtureScenario(request.headers.get('X-Fixture-Scenario'));
    const upstream = createUpstream(config, { scenario, latencyMs: 0 });
    const edge = edgeCache();

    // A forced scenario produces different data, so it must not share a cache
    // entry with the normal path — otherwise a degraded response would be served
    // to the next ordinary request, or vice versa. In production `scenario` is
    // always 'ok' and this is exactly `config.schema`.
    const schema = scenario === 'ok' ? config.schema : `${config.schema}-fixture-${scenario}`;

    // The budget is tracked per scenario for the same reason. Simulating a rate
    // limit must not lock the development server out of every other scenario.
    const tracker = budgetTracker(scenario === 'ok' ? 'live' : `fixture-${scenario}`);

    if (url.pathname === PATHS.search) {
      return handleSearch(
        {
          upstream,
          tracker,
          edge,
          schema,
          upstreamMode: config.upstream,
          now,
        },
        url.searchParams.get('q'),
      );
    }

    if (url.pathname.startsWith(`${PATHS.company}/`)) {
      const number = url.pathname.slice(PATHS.company.length + 1);
      return handleCompany(
        {
          upstream,
          tracker,
          edge,
          store: kvSnapshotStore(env.SNAPSHOTS, edge),
          schema,
          upstreamMode: config.upstream,
          now,
          waitUntil: (promise) => ctx.waitUntil(promise),
        },
        number,
      );
    }

    if (url.pathname === '/') {
      // Somebody has typed the hostname into a browser. Point them at the
      // project rather than returning a bare 404.
      return json({
        service: 'LtdLens API',
        documentation: 'https://github.com/AmigoUK/LtdLens',
        endpoints: Object.values(PATHS),
      });
    }

    return error('NOT_FOUND');
  },
} satisfies ExportedHandler<Env>;
