/**
 * Fixtures are a workspace, not a folder, because workerd has no filesystem:
 * the Worker must import them statically so the bundler inlines them. That also
 * guarantees the extension's tests and the Worker's tests run against
 * byte-identical inputs.
 *
 * Three kinds live here and must not be mixed:
 *   - contract  — raw recorded Companies House payloads; prove the normalisers
 *                 match the real schema. Fidelity matters, branch coverage does not.
 *   - golden    — recorded `/v1/company` output plus `recordedAt`, so tests can
 *                 freeze "now" and never rot as filing deadlines roll forward.
 *   - synthetic — hand-authored rule inputs for boundaries. No real company
 *                 reliably has "exactly one active officer and one resignation
 *                 five months ago" on the day you need it.
 *
 * Populated from v0.0.2 onwards.
 */

export const FIXTURES_MARKER = 'LTDLENS_FIXTURE_MARKER';
