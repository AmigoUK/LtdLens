## What and why

<!-- The user-visible problem, and why this design rather than another. -->

## Checklist

- [ ] `npm run check` passes locally
- [ ] Pure logic lives in `shared/src/` or `extension/lib/` and has Vitest coverage
- [ ] No UI string, doc or listing copy uses "score", "rating", "creditworthy" or "do not trade" — flags state register facts, never conclusions
- [ ] Any rule that could not be evaluated reports `not-checked`, never `clear`
- [ ] CHANGELOG updated with cause and rationale, not just a summary
- [ ] If permissions or data flows changed: `PRIVACY.md` **and** `docs/STORE_LISTING.md` updated in the same commit
