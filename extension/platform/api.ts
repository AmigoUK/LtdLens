/**
 * Builds the API client from the current settings.
 *
 * Chooses the transport from `dataSource`, which is the whole of what Demo mode
 * is: a different transport behind an identical client. Nothing downstream —
 * caching, error handling, the interface — knows or cares which one is in use,
 * except that results are labelled `demo` so the interface can never present
 * sample data as live.
 */

import type { ApiClient } from '../lib/api.js';
import { createApi } from '../lib/api.js';
import type { Settings } from '../lib/settings.js';
import { createFixtureTransport } from './fixtureTransport.js';
import { createHttpTransport } from './httpTransport.js';
import { chromeCacheStore } from './storage.js';

export function createClient(settings: Settings): ApiClient {
  const transport =
    settings.dataSource === 'demo'
      ? createFixtureTransport()
      : createHttpTransport(settings.workerBaseUrl);

  return createApi({
    transport,
    cache: chromeCacheStore(),
    now: () => new Date(),
    ttlHours: settings.cacheTtlHours,
    maxAgeDays: settings.cacheMaxAgeDays,
    mode: settings.dataSource,
  });
}
