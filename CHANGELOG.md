# Changelog

All notable changes to **LtdLens** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet._

## [0.1.0] — 2026-07-30

### Added

- The Cloudflare Worker: router, upstream seam, two cache tiers, request coalescing, a three-state Companies House budget governor, and the error contract. `GET /v1/company/{number}`, `/v1/search`, `/v1/rates/late-payment` and `/v1/health`. 43 tests in real workerd with real KV and a real Cache API — not mocks, because the cache tiers and `waitUntil` are exactly the parts most likely to behave differently in production.
- **The whole system now runs with no credentials at all.** `wrangler dev` starts in local mode with KV simulated on disk, and with no API key the Worker replays recorded fixtures through the real normalisation, caching and governor code. Every branch of the degradation ladder is reachable from `curl` via `X-Fixture-Scenario: 429|500|timeout|partial|not-found`, so the failure paths are exercised now rather than discovered in production.
- `scripts/verify-no-fixtures.mjs`, wired into `npm run check`: builds the production bundle and fails if any fixture data survives. Verified to catch a real regression, not just to pass.
- CI now counts the `observability` blocks in `wrangler.jsonc` and fails unless all three are present and disabled. Wrangler environment blocks inherit nothing and Cloudflare's default is on, so a missing block silently retains request URLs for three days.
- `worker/README.md`: running without credentials, the endpoint contract, the cache tiers, the governor states, and an explicit list of what must never be logged.

### Fixed

- **Fixtures were shipping in the production bundle.** `__FIXTURES_ENABLED__` was read through a helper containing a `typeof` guard, which is opaque to esbuild, so the branch stayed live and roughly forty kilobytes of invented company data went into the bundle. No test caught it — every test runs with fixtures deliberately enabled — and it was only found by grepping the built output. The identifier is now read directly at the branch, `fixtures` and `shared` declare `sideEffects: false`, and the production bundle went from 72 KiB to 48 KiB. What was at stake was not size: a production Worker carrying fixture data could, if another guard failed, serve a report about a company that does not exist to somebody deciding whether to extend it credit.
- **The write-on-second-miss policy was self-defeating.** The "seen once" marker was to be stored in KV, but a marker in KV is itself a write, so a company looked up once would have cost one write instead of one and a company looked up twice would have cost two instead of one — strictly worse than no policy. The marker now lives in the unmetered edge cache, so a one-off lookup costs zero KV writes. This matters because the free tier's 1,000 writes a day, not the request count, is the binding constraint, and exhausting it fails in the worst direction: writes stop, nothing persists, every colo pays full upstream cost, and the Companies House limit — the one that gets a key banned — comes into play.
- A forced fixture scenario now scopes the cache namespace, so a degraded response cannot be served to the next ordinary request or vice versa. In production the scenario is always `ok` and the namespace is unchanged.
- The company route distinguishes "no such company" from "we could not reach the register". They are different facts and they need different wording; conflating them would tell a user a real company does not exist.

### Changed

- The budget governor has three states rather than two. A single cutoff wastes the budget between the cutoff and zero and produces a cliff where the service works perfectly and then not at all. In brownout the optional sources are dropped instead, so a cold check costs one upstream call rather than four and a report still arrives — honestly marked `partial`, which the flag engine already knows how to represent as "not checked" rather than "clear". A 429 is never retried: Companies House may ban an application that appears to work around the limit, and a retry is indistinguishable from an attempt.
- The coalescing test was replaced. It went through `SELF.fetch` and passed roughly two runs in three, because concurrent requests are not guaranteed to share an isolate and so may not share the promise map. A test that is right most of the time is worse than no test, since a real regression hides in the noise. Coalescing is now tested directly with a counter that cannot lie about how many times the work ran — including the case everyone gets wrong first, where a rejected promise left in the map turns one upstream blip into a permanent outage for that company.
- `@cloudflare/vitest-pool-workers` 0.19 replaced `defineWorkersConfig` with a Vite plugin. Noted in the config file so nobody restores the older form that appears in most documentation.

## [0.0.4] — 2026-07-29

### Added

- The flag ruleset and the engine that runs it: ten rules covering terminal status, strike-off, overdue accounts and confirmation statements, young companies with no filing history, director churn, a recent move by a young company, a recent rename, outstanding charges, and the all-clear. 238 tests, including a golden run of all four fixtures with the clock frozen.
- `docs/FLAG_RULES.md`, which is as much a legal-risk document as a specification. Every rule carries a **what this does not mean** line, because the gap between "accounts are overdue" and "this company is unreliable" is the gap between a verifiable statement and a solicitor's letter. It also records what was deliberately not built and why.
- The engine runs in the browser at render time. A rule correction therefore ships with the extension and immediately fixes every cached report — no cache purge, no server deployment — and the reading stays the user's own, from a public record they asked for, rather than a verdict published from a server.

### Changed

- **Each rule declares the sources it needs, and a rule that could not run reports `not-checked` rather than `clear`.** This is the property the whole engine exists to guarantee. If the officer list fails to load, LtdLens says officer history was not assessed; it does not say the officers are fine. `all-clear` requires all four sources, so the reassuring "no red flags in the public record" cannot be produced from a partial one — tested, deliberately, against the healthiest fixture in the set, where a regression would be least likely to be noticed.
- A rule may also report `'unknown'` when its source arrived but the field it needs is absent. A profile with no incorporation date cannot answer "is this company young?", and answering "no" would be a guess dressed as a finding.
- Outstanding charges are `info` and never lift the summary. A charge is a lender taking security, which happens on every commercial loan, mortgage and asset finance agreement; treating it as concerning would flag most healthy trading companies in the country.
- Flags carry i18n keys rather than rendered English, and every flag carries a required `sourceUrl` pointing at the specific Companies House page that evidences it — the filing history for an overdue account, the officer list for churn. Every claim is one click from its proof.

## [0.0.3] — 2026-07-29

### Added

- Statutory late-payment interest under the Late Payment of Commercial Debts (Interest) Act 1998: the reference rate table, the calculator, and the paragraph a user pastes into a chasing email. 185 tests. No user interface — deliberately. This is the one part of LtdLens whose output goes verbatim into a demand letter, so the legal arithmetic is settled and frozen before there is any screen to report a bug against and tempt someone into tuning it.
- The reference rate table covers every six-month period since the regime took its current form on 7 August 2002. Rates are stored as integer basis points, because 0.1% and 3.75% are not exactly representable in binary floating point and this table feeds figures into correspondence. The table was verified against two independently published tables that agree at every overlapping point, cross-checked against Bank of England Monetary Policy Committee summaries for the December 2025 and June 2026 fixings.
- Fixed compensation per section 5A — £40, £70 or £100 by the size of the debt, charged per invoice — with tests at every band edge and a penny either side of it.
- The demand paragraph is **always British English regardless of the interface language**. That is the point rather than a gap in the translation layer: it is addressed to a UK debtor and cites UK legislation, so a Polish-speaking owner running a company in Birmingham still sends it in English. It also shows where the rate came from, because an accounts department that can check a figure pays it and one that cannot escalates it.

### Fixed

- **The reference period is chosen by when interest starts to run, not by when the debt fell due.** The concept document had this a day out. Section 4(2) of the Act starts interest on the day _after_ the due date, and SI 2002/1675 article 4 selects the rate in force at the fixing "immediately before the day on which statutory interest starts to run". A debt due on 30 June therefore starts running on 1 July, falls in the July–December band and takes the 30 June rate — not the previous 31 December's. At the June 2023 boundary those two readings differ by 1.5 percentage points, in a number the user pastes into a letter. Tests pin all four boundary dates.
- The rate is fixed for the life of the debt and does not follow later base rate movements, even across a period boundary. Each invoice therefore carries its own rate, so a multi-invoice claim is a sum of independently rated lines rather than one rate applied to a total.
- Interest is computed at full precision and rounded once, rather than by summing a rounded daily figure. gov.uk's worked example rounds the daily amount to the nearest penny first, which understates a £1,000 debt over 50 days by about 14p; that example is illustrative, and the creditor is entitled to the arithmetic. The daily figure is still shown, because users check against it.

### Changed

- The calculator refuses rather than guesses. A debt whose interest starts outside the table — before August 2002, or after 31 December 2026, which is the next fixing — returns `unavailable` instead of extrapolating from the nearest rate. What the Monetary Policy Committee will do is not something a table can know, and a wrong figure in a demand letter is worse than no figure.
- Interest running for more than six years is flagged against the Small Business Commissioner's stated recovery limit. The arithmetic is still shown in full: what is actually recoverable is the user's decision, taken with advice, not one this calculator makes for them.

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

[Unreleased]: https://github.com/AmigoUK/LtdLens/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/AmigoUK/LtdLens/compare/v0.0.4...v0.1.0
[0.0.4]: https://github.com/AmigoUK/LtdLens/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/AmigoUK/LtdLens/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/AmigoUK/LtdLens/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/AmigoUK/LtdLens/releases/tag/v0.0.1
