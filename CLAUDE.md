# Project Overview

LtdLens is a free Chrome MV3 extension. Select a UK company name or number on any page, right-click, and a side panel shows what the public register says — risk flags in plain English, each stating a fact and linking to the filing that proves it. It also calculates statutory late-payment interest offline. It is a marketing asset for attv.uk, not a SaaS: no accounts, no telemetry, no user data collected.

The approved plan lives at `/root/.claude/plans/https-github-com-amigouk-safetotrade-saf-functional-pearl.md`.

# Tech Stack

Each pin has a reason. Do not bump one without checking the reason still holds.

- **TypeScript `~5.9.3`** — _not_ 7.x. `typescript-eslint@8.65` declares peer `typescript >=4.8.4 <6.1.0`; no stable line supports TS 7. Type-checked lint rules enforce this project's layer boundaries, so they outrank compiler novelty. Verify with `npm view typescript-eslint peerDependencies` before revisiting.
- **WXT 0.21** — still pre-1.0, so minor bumps can break. Peers `vite ^8`, `eslint ^10`, `typescript >=5.4`.
- **Vitest 4.1** — chosen because `@cloudflare/vitest-pool-workers@0.19` peers `vitest ^4.1.0`, giving one test runner across the whole monorepo.
- **Preact 10** — function components and `preact/hooks` only. No signals, no router.
- **Node 22.23.1** (`.nvmrc`), npm 10.9.8 (`packageManager`).

Run everything with `npm run check`. CI runs the same command; they must never diverge.

# Naming & Coding Conventions

- **The product is LtdLens.** The working title "SafeToTrade" collided with an active UK company (Companies House 14990998) and must never reappear. `scripts/verify-workspace.mjs` fails the build if it does.
- **Never write "score", "rating", "credit rating", "creditworthy" or "do not trade"** in UI strings, documentation or listing copy. Flags state register facts ("Accounts are overdue"), never conclusions ("unreliable"). This is legal positioning, not style.
- **Repository documentation is British English. Conversation with the owner is Polish.**
- Directory conventions: `shared/src/` and `extension/lib/` hold pure logic; `extension/platform/` holds thin `chrome.*` adapters with no branching; `extension/components/` and `entrypoints/` are presentation only.
- **Pure logic MUST have Vitest coverage.** If a function is hard to test, it is in the wrong layer.
- Every function needing "now" takes a `Date` parameter; every function needing I/O takes an injected interface. This is what makes the test suite need no Chrome mocking and no msw.
- Conventional Commits with scopes. Bodies explain cause and rationale, end with a `Verified: <counts>` line and the Claude co-author trailer.
- Releases: SemVer from v0.0.1, Keep a Changelog in `CHANGELOG.md`, annotated git tags, GitHub Releases with the `npm run zip` artefact.
- GitHub Actions are pinned to full commit SHAs, including `actions/*`.
- `npm audit` must stay at zero. Add an `overrides` entry per finding with the reason recorded in the CHANGELOG; drop it once the parent ships the fix.

# Protected Files

Never rewrite silently — every change here must be deliberate and recorded:

- `PRIVACY.md` and `docs/STORE_LISTING.md` — every permission or data-flow change must be reflected in both, never quietly.
- `docs/DPIA.md`, `docs/FLAG_RULES.md` — legal-risk documents.
- `fixtures/**` — recorded payloads. Re-record with the script, never hand-edit a recording.
- `eslint.config.js` — the layer boundaries and the privacy guarantees are enforced here. Loosening a rule is a decision, not a tidy-up.

# Critical gotchas (learned the hard way)

1. **`chrome.sidePanel.open()` must be the first synchronous statement** in the `contextMenus.onClicked` listener. A context-menu click is a valid user gesture, but any `await` before the call loses it. Someone will eventually want to "tidy" this into an async function — do not let them.
2. **The panel handshake needs both directions.** The panel may be closed and opening, or already open showing a previous company. Write the pending request to `chrome.storage.session` _and_ broadcast it; the panel reads session on mount _and_ registers a listener. Deduplicate by `requestId`. The MV3 service worker can also be evicted mid-request, so results go to session storage too.
3. **Playwright cannot click Chrome's native context menu** — it is an OS-level widget. That is why `sidepanel.html` accepts `?q=` / `?number=` / `?demo=1`: it is the only way E2E can reach the panel at all.
4. **WXT reads the published manifest version from `extension/package.json`**, not the repo root. `verify-workspace.mjs` asserts they agree.
5. **Wrangler `env` blocks inherit nothing** — `vars`, `define`, `kv_namespaces` and `observability` must be repeated in full in every block. Omitting `observability` silently re-enables request logging, which would make the privacy claim false.
6. **Cloudflare KV free tier allows 1,000 writes/day** — the binding constraint, not the request count. Never put a KV write on a hot path.
7. **The Cache API is documented not to function on `workers.dev`** — the custom domain is load-bearing, not cosmetic.
8. **Flags are computed client-side by design.** Do not "optimise" them into the Worker: it would make attv.uk the publisher of a verdict about a named company, and it would force a cache purge on every rule change.
9. **A rule that cannot be evaluated must never report a pass.** If an upstream call fails, the flag is `not-checked`, not `clear`. A false green on a counterparty-risk tool is the only genuinely dangerous output this product can produce.
10. **The statutory interest reference rate is keyed to when interest _starts to run_** (the day after the due date), not to the due date itself — [SI 2002/1675 art. 4](https://www.legislation.gov.uk/uksi/2002/1675/article/4/made). A debt due 30 June takes the 30 June rate, not the previous 31 December's. The rate is then fixed for the life of that debt.
