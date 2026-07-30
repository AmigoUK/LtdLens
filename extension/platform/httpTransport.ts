/**
 * The `fetch`-backed transport.
 *
 * Rejects only when no request could be made at all. Every HTTP status resolves,
 * including 503 — a `Retry-After` is information the interface shows as a
 * countdown, and throwing the response away would lose it.
 */

import type { Transport, TransportResponse } from '../lib/transport.js';

/** Long enough for a cold four-call aggregation, short enough to not feel broken. */
const TIMEOUT_MS = 12_000;

export function createHttpTransport(baseUrl: string): Transport {
  const base = baseUrl.replace(/\/+$/, '');

  return async (request) => {
    const url = new URL(base + request.path);
    for (const [key, value] of Object.entries(request.query ?? {})) {
      url.searchParams.set(key, value);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    // An external signal, from a closing panel, must also abort the request.
    const external = request.signal;
    const forward = () => controller.abort();
    external?.addEventListener('abort', forward);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        // No cookies, ever. There is no session, and sending credentials would
        // create the tracking surface this project exists without.
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
      });

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        // A non-JSON response — a proxy or captive portal. The status still tells
        // the client something useful, so this resolves rather than throwing.
        body = undefined;
      }

      const result: TransportResponse = { status: response.status, body, headers };
      return result;
    } finally {
      clearTimeout(timeout);
      external?.removeEventListener('abort', forward);
    }
  };
}
