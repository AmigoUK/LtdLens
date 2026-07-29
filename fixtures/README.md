# Fixtures

Recorded and synthetic Companies House payloads, shared by the Worker (which replays them as its upstream when no API key is configured) and by the test suites of both packages.

This is a workspace rather than a plain folder for a practical reason: workerd has no filesystem, so the Worker has to import fixtures statically for the bundler to inline them. The side effect is worth having — the extension's tests and the Worker's tests are guaranteed to run against byte-identical inputs.

## Honesty about provenance

**Nothing here has been recorded from the live API yet**, because there is no Companies House API key. Every file was hand-authored from the [published schemas](https://developer-specs.company-information.service.gov.uk/). They will be subtly wrong in places — an omitted field, a description template that does not exist, an enumeration value spelt differently.

That is an accepted, temporary state, and it is why `docs/CREDENTIALS_SETUP.md` budgets **half a day** for "re-record and fix the diffs" rather than treating it as a formality. A test suite that passes against fiction is worse than no test suite, because it is trusted.

The `real` flag on each fixture records whether its data came from the live register. Only Tesco's does, and even then the payloads were reconstructed from the public record rather than captured from the API.

## What each fixture is for

| Number     | Name                       | Real                         | Exercises                                                                                                                                                                                                                                              |
| ---------- | -------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `00445790` | TESCO PLC                  | Register data, reconstructed | The all-clear baseline: long-established, everything filed on time, one outstanding charge as an `info` row. Also the search-disambiguation anchor, since "tesco" returns dozens of hits.                                                              |
| `99000001` | DISTRESSED TRADING LIMITED | Synthetic                    | Accounts overdue, confirmation statement overdue, proposed for strike off, two director resignations inside six months, a charge created four months ago, undeliverable registered office. Several red flags at once, so it exercises pill precedence. |
| `99000002` | CEASED HOLDINGS LIMITED    | Synthetic                    | In liquidation, insolvency filings present, renamed in 2021, and **no `links.charges` at all** — so charges must resolve to `not-applicable`, which is a fact rather than a gap and must not mark the snapshot partial.                                |
| `99000003` | NEWCO VENTURES LIMITED     | Synthetic                    | Incorporated five months ago, no accounts filed yet, a single director, registered office moved last month. The young-company and recently-moved rules together.                                                                                       |

Synthetic companies use the `990000xx` range so they cannot be mistaken for real ones. They are not registered numbers.

## Still to add

- A **dissolved** company, and one in **administration** — the status enumeration has six terminal values and one fixture does not cover them all.
- A company whose officers call **fails**, to prove a rule reports `not-checked` rather than `clear`. This one can only ever be synthetic; a failure is not something the register will hand you on demand.
- A company with a **long or non-ASCII name**, as a layout regression guard.
- **Golden fixtures** — recorded `/v1/company` output with a `recordedAt` stamp — which arrive with the Worker in v0.1.0.

## Re-recording

`scripts/record-fixtures.mjs` (v0.3.0) reads the fixture list, calls the live API and overwrites the payloads, stamping each with its capture date. It needs a real key. Expect diffs; that is the point of running it.

Quarterly re-recording is in `docs/OPERATIONS.md`. Terminal-state companies (dissolved, liquidation) are the most stable fixtures you will ever have, because their data is frozen. Anything keyed on an overdue deadline is the least stable — a company proposed for strike off today will be dissolved within months.
