# Flag rules

_Ruleset version 1.0.0. Last reviewed: 29 July 2026._

This is both the specification of what LtdLens reports and a record of what it deliberately does not claim. Every row states a **fact from the public register** and links to the page that proves it. None states a conclusion.

The distinction is not stylistic. "Accounts are overdue" is a verifiable statement about a filing deadline. "This company is unreliable" is an inference about a named UK business, published by us. The first is defensible; the second is a letter from a solicitor. Every rule below is written to stay on the first side of that line, and the **what this does not mean** column exists to keep it there.

There is no aggregate score, and there will not be one. A single number invites the reader to stop thinking and hands them a judgement they did not make; a list of sourced, dated facts does neither.

## How a rule can end

Each rule reaches one of three outcomes, and the difference between the last two is the most important property of the whole engine.

| Outcome         | Meaning                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------- |
| **raised**      | The fact is true of this company, as at the date of the snapshot.                                                     |
| **clear**       | The rule ran, and the fact is not true.                                                                               |
| **not-checked** | The rule could not run. Either a required source was not fetched, or it was fetched but the specific field is absent. |

**A rule that could not run never reports `clear`.** If the officer list failed to load, LtdLens says officer history was not assessed — it does not say the officers are fine. A green pill on a company nobody actually checked is the only genuinely dangerous output this product can produce, and the type system makes it unrepresentable rather than merely discouraged.

Sources are `profile`, `officers`, `charges` and `filings`. A source that was never needed — a company with no charges to fetch — counts as available, because "this company has no charges" is an answer rather than a gap.

## The rules

| ID                    | Level    | Fires when                                                                                                                                                                   | Reads                               | What this does **not** mean                                                                                                                                                                                                                                                                                         |
| --------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status-terminal`     | 🔴 red   | Company status is `dissolved`, `liquidation`, `receivership`, `administration`, `voluntary-arrangement`, `insolvency-proceedings`, `converted-closed`, `closed` or `removed` | profile                             | Not that anyone behaved improperly. Solvent companies are wound up voluntarily all the time, and a dissolved company may simply have finished its purpose. It does mean the entity on your invoice may no longer be able to contract or pay.                                                                        |
| `strike-off`          | 🔴 red   | Status detail is `active-proposal-to-strike-off`                                                                                                                             | profile                             | Not that the company has failed. Strike-off is often triggered by missed paperwork rather than insolvency, and it can be discontinued. It does mean the company could cease to exist within months, taking any debt owed to you with it.                                                                            |
| `accounts-overdue`    | 🔴 red   | Companies House reports annual accounts as overdue                                                                                                                           | profile                             | Not proof of financial trouble. Accountants are late, systems fail, and small companies miss deadlines for dull reasons. It is, however, the earliest signal the register gives, and it is a statutory duty that has been missed.                                                                                   |
| `cs-overdue`          | 🟡 amber | Companies House reports the confirmation statement as overdue                                                                                                                | profile                             | Less serious than overdue accounts: the confirmation statement is a short form, so missing it says more about administration than about money. Persistent lateness can lead to strike-off.                                                                                                                          |
| `young-no-accounts`   | 🟡 amber | Incorporated under twelve months ago **and** no accounts ever filed                                                                                                          | profile                             | Not a criticism at all. A company incorporated last month has filed nothing because nothing is due. This is a statement about the **evidence available**, not about the company: there is no trading history to look at yet.                                                                                        |
| `officer-churn`       | 🟡 amber | Two or more directors resigned in six months, **or** one resigned leaving one director or none                                                                               | officers                            | Not that anything is wrong. Directors retire, sell up and move on. Rapid turnover is a pattern that precedes many failures, but it equally accompanies ordinary restructuring. Secretaries and receivers are excluded from the count.                                                                               |
| `recent-move-young`   | 🟡 amber | Registered office moved within three months **and** company under two years old                                                                                              | profile, filings                    | Neither limb is remarkable alone — companies move, and companies are young. Together they describe an entity that has not settled. Plenty of legitimate businesses look exactly like this in their first year.                                                                                                      |
| `name-change`         | 🟡 amber | Company renamed within twelve months                                                                                                                                         | profile, filings                    | Renaming is ordinary and legitimate — rebrands, acquisitions, corrections. It matters here for one practical reason: the name on your invoice may not be the name the counterparty traded under when you started, and your own searches may have missed it.                                                         |
| `charges-outstanding` | ℹ️ info  | One or more outstanding charges registered                                                                                                                                   | charges                             | **Not a warning, and it never affects the summary.** A charge is a lender taking security over assets, which is what happens on every commercial loan, mortgage and asset finance agreement. Most healthy trading companies have them. It is shown because it is worth knowing who has a prior claim on the assets. |
| `all-clear`           | 🟢 green | Active, no red or amber flag raised, **and every source available**                                                                                                          | profile, officers, charges, filings | Not a recommendation, an endorsement, or a statement that the company will pay you. It means only that the public register shows nothing on the list above. Companies fail without the register saying anything at all first.                                                                                       |

`all-clear` is further qualified for companies under three years old: the message distinguishes an established company from a young one, because the register simply has less to say about the latter.

## Boundaries

Thresholds are held to the day and pinned by tests in both directions. All are measured against the date of the snapshot, never the reader's clock.

| Rule                | Threshold                                     | Held at                                                              |
| ------------------- | --------------------------------------------- | -------------------------------------------------------------------- |
| `young-no-accounts` | under 12 months                               | 11 months 30 days fires; 12 months exactly does not                  |
| `officer-churn`     | 6-month window                                | a resignation 5 months 30 days ago counts; 6 months exactly does not |
| `recent-move-young` | move within 3 months, company under 24 months | both boundaries held to the day                                      |
| `name-change`       | rename within 12 months                       | held to the day                                                      |
| `all-clear`         | 36 months for "established"                   | qualifies rather than withholds below it                             |

## The summary

Red if any red flag is raised; amber if any amber; otherwise green. `info` is displayed but never lifts the summary.

**A partial snapshot must never present as a clean bill of health.** Because `all-clear` requires every source, the reassuring message cannot appear on an incomplete record — but the interface carries the other half of this obligation. When `partial` is true it must show what was not assessed, and it must not present the green summary as though the record had been read in full.

## Changing a rule

The ruleset is versioned as a set. `RULESET_VERSION` in `shared/src/flags/rules.ts` changes whenever a rule is added, removed, or a threshold moves, and this document changes in the same commit.

Rules run in the browser at render time and are never baked into a cached snapshot. A correction therefore ships with the extension and immediately fixes every cached report — no cache purge, no server deployment. It also means the reading is the user's own, from a public record they asked for, rather than a verdict published from a server.

Wording that must never appear in a flag message, an interface string, documentation or listing copy: **score**, **rating**, **credit rating**, **creditworthy**, **do not trade**, **risky**, **unreliable**. Flags describe the register. Readers draw conclusions.

## Disputing a flag

Every flag links to the Companies House record that evidences it. If a flag is wrong, either LtdLens has misread the register or the register itself is out of date — both matter. There is a [flag dispute issue template](../.github/ISSUE_TEMPLATE/flag_dispute.yml) for the first, and only Companies House can correct the second.

## Deliberately not built

**Director history.** The Companies House API offers appointments by officer, and it is tempting. Using it would turn "check a company" into "profile a person" — a different data protection position, a different Chrome Web Store data declaration, and a different product. Directors' names, months of birth and service addresses are third-party personal data, and LtdLens reports counts rather than people. Decision taken 29 July 2026; revisit only with a fresh assessment, not as a feature request.

**Identity verification status.** The Economic Crime and Corporate Transparency Act made director identity verification a legal requirement from 18 November 2025, with a twelve-month transition running to roughly mid-November 2026. A rule keyed on an absent verification date would generate mass false positives for the whole of that window. Reconsider after the transition ends.
