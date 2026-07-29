# Changelog

All notable changes to **LtdLens** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet._

## [0.0.1] — 2026-07-29

### Added

- Initial monorepo scaffold: npm workspaces for `shared`, `fixtures`, `worker` and `extension`, a shared `tsconfig.base.json`, Prettier, and a single `npm run check` that CI and a human both run so the two can never diverge.
- ESLint flat config that enforces the layer boundaries mechanically rather than by convention. `shared/` and `extension/lib/` may not reference `chrome`, `fetch`, `window`, `document`, `localStorage`, `caches`, `navigator` or `process`; `worker/` may not call `console` outside a single observability module. The privacy promise and the pure-logic testing strategy both depend on those boundaries holding, and neither survives being a guideline.
- `scripts/verify-workspace.mjs`, wired into `npm run check`. It asserts that the root and extension versions agree — WXT publishes the manifest version from `extension/package.json`, not the root, and a mismatch ships a build whose version does not match its tag with no other symptom — and that the CHANGELOG describes the version about to be built.

### Changed

- **The project is named LtdLens, not SafeToTrade.** The working title collided with `SAFETOTRADE LIMITED` (Companies House 14990998), an active UK company incorporated on 10 July 2023 that operates safetotrade.com as a food-safety trustmark and holds safetotrade.uk, .co.uk and .com. That is the same semantic space — a badge asserting a business can be trusted — so the collision is not merely a domain problem: passing off is arguable without any registered trade mark, and the Chrome Web Store removes extensions on a brand owner's complaint without a hearing. LtdLens was verified clean against Companies House, the .uk/.co.uk/.com registries and general web search before adoption. `verify-workspace.mjs` fails the build if the old name reappears in a package name.
- TypeScript is pinned to `~5.9.3` rather than the current 7.0.2. `typescript-eslint@8.65.0` declares a peer range of `typescript >=4.8.4 <6.1.0`, and no stable line supports TypeScript 7 yet. Losing type-checked lint rules — the mechanism enforcing everything described above — to gain a compiler version is the wrong trade. Revisit when typescript-eslint ships stable TypeScript 7 support.

[Unreleased]: https://github.com/AmigoUK/LtdLens/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/AmigoUK/LtdLens/releases/tag/v0.0.1
