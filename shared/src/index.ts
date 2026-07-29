/**
 * Pure logic shared by the extension and the Worker.
 *
 * Nothing in this package may touch a platform global — no `chrome`, no `fetch`,
 * no `window`, no ambient clock. Every function that needs "now" takes a `Date`;
 * every function that needs I/O takes an injected interface. ESLint enforces it.
 *
 * Populated from v0.0.2 onwards.
 */

export const CONTRACT_VERSION = 1;
