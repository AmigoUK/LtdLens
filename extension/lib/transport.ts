/**
 * The transport seam.
 *
 * `lib/api.ts` takes a `Transport` rather than calling `fetch`, which is why the
 * client's every error branch is testable with a three-line stub — no msw, no
 * service worker mock, no network. There are two real implementations in
 * `platform/`: one over `fetch`, and one that serves bundled fixtures for Demo
 * mode.
 */

export interface TransportRequest {
  path: string;
  query?: Record<string, string>;
  /** Abort signal, so a slow lookup can be cancelled when a panel closes. */
  signal?: AbortSignal;
}

export interface TransportResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

/**
 * Rejects only when the request could not be made at all — no response, DNS
 * failure, abort. Any HTTP status, including 500, resolves: a 503 with a
 * `Retry-After` is information, and throwing it away would lose the countdown the
 * interface shows.
 */
export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

/** Case-insensitive header read. Header casing is not guaranteed anywhere. */
export function header(headers: Record<string, string>, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}

export function numericHeader(headers: Record<string, string>, name: string): number | undefined {
  const raw = header(headers, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}
