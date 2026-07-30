# Project status

_Last updated: 30 July 2026, at v0.2.0._

A snapshot of where LtdLens is, what is deliberately not built yet, and what is
waiting on something outside the repository. Written to be picked up cold — by
somebody else, or by the same person in three months.

## Where it is

The whole system runs end to end **with no credentials of any kind**. The Worker
replays recorded fixtures through the real normalisation, caching and governor
code; the extension installs into Chrome and works against it or against its own
bundled Demo mode.

| Package     | State                                                                                                                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared`    | Complete for the MVP: wire contract, Companies House types, normalisers, flag ruleset, statutory interest calculator. 238 tests.                                                              |
| `fixtures`  | Four companies covering the all-clear baseline, distress, liquidation and a young company. **Hand-authored from published schemas — not yet recorded from the live API.**                     |
| `worker`    | Complete for the MVP: router, upstream seam, two cache tiers, coalescing, three-state governor, kill switch, throttle, error contract. 64 tests in real workerd. Not deployed.                |
| `extension` | Popup, settings, background worker, theme and translation layers, Demo mode. 83 unit tests plus 19 end-to-end checks in real Chromium. **No side panel and no context menu yet** — see below. |

385 tests across three runners. `npm run check` runs everything CI runs; CI adds
the end-to-end job.

## What works today

```bash
npm ci
npm run check                 # typecheck, lint, format, tests, build, guards
npm run dev:worker            # http://localhost:8787, fixture upstream
npm run dev:ext               # loads into Chrome
npm run e2e -w extension      # 19 checks in real Chromium
```

Every branch of the degradation ladder is reachable without credentials:

```bash
curl localhost:8787/v1/company/00445790 -H 'X-Fixture-Scenario: partial'
curl localhost:8787/v1/company/00445790 -H 'X-Fixture-Scenario: 429'
curl localhost:8787/v1/company/00445790 -H 'X-Fixture-Scenario: 500'
```

## Not built yet, and why

**The side panel and the context menu (v0.2.1).** This is the gap that matters:
the primary gesture — select a company name on any page, right-click, read the
report — does not exist yet. The popup currently opens the official Companies
House record instead of a report, which is useful but is not the product. Also in
that step: `ReportView` with the severity pill and flag rows, the `?q=`/`?number=`
entry points the end-to-end tests need (Playwright cannot click a native context
menu), and the interest calculator's interface.

**Deferred to v1.0 on purpose**, not forgotten: auto-detection of company numbers
on a page (needs `<all_urls>`, the single largest review risk), the watchlist and
its weekly digest (needs `alarms`), bring-your-own-key mode (needs
`optional_host_permissions`), VAT checking, and The Gazette. The manifest declares
none of those permissions today, because Chrome only disables an extension on
update when a new permission adds a warning string — and optional permissions
never do, so adding them later is free while shipping them unused is a review
question with nothing to gain.

## Blocked on something outside the repository

| What                                          | Who                             | Notes                                                                                                                                                                                                                                                               |
| --------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Companies House API key                       | Owner                           | Free, self-service, issued immediately. **Leave the IP restriction empty** — a Worker's egress address is Cloudflare's and varies, so an IP restriction works locally and silently 403s in production.                                                              |
| Cloudflare account                            | Owner                           | Free tier is fine for a closed beta.                                                                                                                                                                                                                                |
| `ltdlens.uk` onto a Cloudflare zone           | Owner                           | Bought and parked. The Cache API is documented not to function on `workers.dev`, so the custom domain is load-bearing rather than cosmetic.                                                                                                                         |
| Workers Paid, $5/month                        | Owner, before any public launch | The free tier allows 1,000 KV writes a day, and exceeding it fails in the worst direction: writes stop, nothing persists, every colo pays full upstream cost, and the Companies House limit — the one that gets a key banned — comes into play.                     |
| Companies House terms on proxying and caching | Owner                           | `/terms-of-use` on the developer hub returns 404 and no clause about proxying, caching or attribution could be found. Ask on the developer forum, describing the architecture plainly, **before** deploying.                                                        |
| Trader vs Non-Trader declaration              | Owner                           | The sibling project declared Non-Trader arguing attv.uk earns nothing. LtdLens is described as a marketing asset, which weakens that argument. Either the listing drops the commercial framing or the declaration changes. Settle it before submission, not during. |

When the API key arrives, the first job is `npm run fixtures:record` and then
fixing whatever the real schema disagrees with. **Budget half a day.** Every
fixture is currently hand-authored and will be subtly wrong somewhere; a test
suite that passes against fiction is worse than no test suite, because it is
trusted.

## Decisions that would be expensive to reverse

- **The Worker returns facts, never judgements.** The ruleset runs in the browser
  at render time. A rule fix therefore ships with the extension and instantly
  corrects every cached report, with no cache purge and no deployment — and a
  verdict about a named UK company is the user's reading of a public record
  rather than something attv.uk publishes from a server.
- **A rule that could not run reports `not-checked`, never `clear`.** Enforced by
  the type system rather than by convention. A green pill on a company nobody
  actually checked is the only genuinely dangerous output this product can
  produce.
- **No aggregate score, ever.** A single number invites the reader to stop
  thinking and is what earns a solicitor's letter; a list of sourced, dated,
  linked facts does neither. The words _score_, _rating_, _creditworthy_ and _do
  not trade_ are absent from every string, and the dictionary test asserts it.
- **Search queries never reach durable storage.** They are cached at the edge
  under a hash and never in KV, because a KV key holding what somebody typed
  would be a readable, enumerable record of it.
- **The name is LtdLens.** "SafeToTrade" collided with an active UK company
  (Companies House 14990998) operating in the same semantic space. The directory
  path and the old repository name are historical.

## Guards that must keep passing

These exist because each one caught something real, or would have:

| Guard                    | What it prevents                                                                                                                        |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `verify-no-fixtures.mjs` | Fixture data shipping in the production Worker. It did, once — the flag was read through a helper, which made it opaque to the bundler. |
| `verify-manifest.mjs`    | A permission or a localhost host reaching a published build.                                                                            |
| `verify-workspace.mjs`   | A version mismatch between the tag, the root and `extension/package.json`, which WXT publishes.                                         |
| CI `privacy-guard`       | A `console.*` in the Worker, a client IP read outside the throttle, a missing `observability` block, a committed secret.                |
| CI end-to-end            | The extension contacting any host but the lookup service. The only mechanical check on the zero-telemetry claim.                        |

## Reading order for someone new

1. `README.md` — what it is.
2. `docs/FLAG_RULES.md` — what it claims, and pointedly what it does not.
3. `worker/README.md` — how to run everything with no credentials.
4. `CLAUDE.md` — conventions, and the gotchas that cost time to learn.
5. `CHANGELOG.md` — every decision, with its reasoning, in order.
