# Changelog

All notable changes to **LtdLens** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet._

## [0.0.2] — 2026-07-29

### Added

- The `shared` workspace: the wire contract, the Companies House response types, and the normalisers that turn raw register payloads into the facts LtdLens reports. 140 unit tests, no mocking of any kind — every function that needs "now" takes a `Date` and every function that needs I/O takes an injected interface, which is what makes that possible.
- The `fixtures` workspace: four companies covering the all-clear baseline, a company in distress, one in liquidation, and one incorporated five months ago. It is a workspace rather than a folder because workerd has no filesystem, so the Worker must import fixtures statically for the bundler to inline them; the side effect is that both packages' tests are guaranteed to run against byte-identical inputs.
- `shared/tests/fixtures.test.ts`, which pushes every fixture through the real normalisers. It cannot prove the fixtures match what Companies House actually returns — only re-recording against the live API can — but it does prove the normalisers cope with the shapes we believe exist, and that each fixture exercises what its README claims.

### Changed

- **`CompanySnapshot` carries facts and never judgements.** No flags, no severity, no score: the ruleset runs in the browser at render time. A rule fix then ships with the extension and instantly corrects every cached report, with no KV purge and no Worker redeploy, and a verdict about a named UK company becomes the user's reading of a public record rather than something attv.uk publishes from a server. The concept document had flags baked into the cached object; this inverts that.
- **Partiality is structural rather than conventional.** Each upstream call arrives as a `SourceResult` — ok, skipped, failed or not-applicable — and the composer records that in `sources` instead of quietly substituting zeros. `FlagEvaluation` is `raised | clear | not-checked`, never a bare flag array, so the type system will not let a snapshot whose officer call failed render as a clean bill of health. A false green pill on a company nobody actually checked is the only genuinely dangerous output this product can produce, and it is now unrepresentable rather than merely discouraged.
- `not-applicable` deliberately does not mark a snapshot partial. "This company has no charges" is a fact, not a gap; conflating the two would train users to ignore the partial badge, which defeats the point of having one.

### Fixed

- Calendar dates are handled as calendar dates throughout, never round-tripped through a local-time `Date`. `new Date('2024-03-14')` is midnight UTC, which renders as the 13th west of Greenwich — an off-by-one that would misreport "incorporated on" and, worse, shift the very boundaries the flag rules turn on. The date module has no clock of its own; the reference date is always passed in, which is also what stops the test suite rotting as real filing deadlines roll forward.
- Accounts are reported overdue only when Companies House says so, and never inferred by comparing a due date to today. The register applies filing extensions and grace periods that are invisible to the API, and "overdue" is the single most consequential word this product puts on screen.

### Security

- Search responses never echo the query back, so a cached search result contains no user input at all. This is what will later allow search results to be cached at the edge without the cache becoming a record of what anyone searched for.

## [0.0.1] — 2026-07-29

### Added

- Initial monorepo scaffold: npm workspaces for `shared`, `fixtures`, `worker` and `extension`, a shared `tsconfig.base.json`, Prettier, and a single `npm run check` that CI and a human both run so the two can never diverge.
- ESLint flat config that enforces the layer boundaries mechanically rather than by convention. `shared/` and `extension/lib/` may not reference `chrome`, `fetch`, `window`, `document`, `localStorage`, `caches`, `navigator` or `process`; `worker/` may not call `console` outside a single observability module. The privacy promise and the pure-logic testing strategy both depend on those boundaries holding, and neither survives being a guideline.
- `scripts/verify-workspace.mjs`, wired into `npm run check`. It asserts that the root and extension versions agree — WXT publishes the manifest version from `extension/package.json`, not the root, and a mismatch ships a build whose version does not match its tag with no other symptom — and that the CHANGELOG describes the version about to be built.

### Changed

- **The project is named LtdLens, not SafeToTrade.** The working title collided with `SAFETOTRADE LIMITED` (Companies House 14990998), an active UK company incorporated on 10 July 2023 that operates safetotrade.com as a food-safety trustmark and holds safetotrade.uk, .co.uk and .com. That is the same semantic space — a badge asserting a business can be trusted — so the collision is not merely a domain problem: passing off is arguable without any registered trade mark, and the Chrome Web Store removes extensions on a brand owner's complaint without a hearing. LtdLens was verified clean against Companies House, the .uk/.co.uk/.com registries and general web search before adoption. `verify-workspace.mjs` fails the build if the old name reappears in a package name.
- TypeScript is pinned to `~5.9.3` rather than the current 7.0.2. `typescript-eslint@8.65.0` declares a peer range of `typescript >=4.8.4 <6.1.0`, and no stable line supports TypeScript 7 yet. Losing type-checked lint rules — the mechanism enforcing everything described above — to gain a compiler version is the wrong trade. Revisit when typescript-eslint ships stable TypeScript 7 support.

[Unreleased]: https://github.com/AmigoUK/LtdLens/compare/v0.0.2...HEAD
[0.0.2]: https://github.com/AmigoUK/LtdLens/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/AmigoUK/LtdLens/releases/tag/v0.0.1
