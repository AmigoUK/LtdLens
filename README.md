# LtdLens

**Check any UK company before you trade.** Select a company name or number on any page — an email, LinkedIn, a supplier's website, an invoice open in your browser — right-click, and LtdLens shows you what the public register says, in plain English, in a couple of seconds.

Free. No sign-up. No API key. No tracking.

> **Status: in development at v0.2.0.** Nothing is published yet. See
> [docs/STATUS.md](docs/STATUS.md) for where the project stands, what is
> deliberately not built, and what is waiting on credentials.

## What it tells you

LtdLens reads the official record and points out the things a careful person would want to know before offering credit terms — accounts overdue, a strike-off in progress, a company dissolved or in liquidation, recent director departures, outstanding charges. Every flag states a **fact from the register**, links to the exact page that proves it, and is dated.

It is not a credit rating, a credit reference or financial advice, and it will never give you a score out of a hundred. A number invites you to stop reading; a list of sourced, dated facts does not.

It also calculates statutory late-payment interest under the Late Payment of Commercial Debts (Interest) Act 1998 — the Bank of England base rate plus eight percentage points, plus the fixed compensation you are owed per invoice — and writes the paragraph you can paste into your chasing email. That part works entirely offline and makes no network request at all.

## Privacy

Three claims, each of which the architecture makes true rather than merely asserting:

- **Nothing you look up is stored anywhere but your own browser.** Your history and settings live in `chrome.storage.local`. There is no account to create and no identifier to attach anything to.
- **Search queries never reach durable storage on the server.** Company snapshots are cached, keyed by a company number — a public identifier holding public register data. Search text is not, deliberately: a cache key containing what someone typed would be a readable, enumerable record of it.
- **The extension talks to exactly one host, and CI proves it.** An end-to-end test intercepts every request the extension makes and fails if any of them goes anywhere else.

Full detail in [PRIVACY.md](PRIVACY.md) once published.

## Data source

Company information comes from the [Companies House public data API](https://developer.company-information.service.gov.uk/). It is published under the Open Government Licence v3.0.

> Contains public sector information licensed under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).

## Repository layout

| Path         | What lives there                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/`    | Pure logic used by both sides: types, normalisers, the flag ruleset, the statutory interest calculator. No platform globals — ESLint enforces it. |
| `fixtures/`  | Recorded and synthetic Companies House payloads. A workspace rather than a folder because workerd has no filesystem.                              |
| `worker/`    | Cloudflare Worker: a caching proxy in front of Companies House, so users never need their own key. Returns facts, never verdicts.                 |
| `extension/` | The Chrome MV3 extension itself (WXT + Preact).                                                                                                   |

## Build from source

```bash
nvm use            # Node 22.23.1
npm ci
npm run check      # typecheck, lint, format, tests, build, guards
```

`npm run check` is the single command CI runs. If it passes locally it passes there.

## Licence and credits

[MIT](LICENSE).

dev@attv.uk · Project & Development: Tomasz 'Amigo' Lewandowski · [www.attv.uk](https://www.attv.uk) · [GitHub](https://github.com/AmigoUK/LtdLens)
