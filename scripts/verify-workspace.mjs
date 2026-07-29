#!/usr/bin/env node
/**
 * Guards that must hold on every commit, and that a human will not remember.
 *
 * These grow as the project does — the release guards land in v0.2.2 with
 * `release.yml`, the manifest and fixture-tree-shaking guards land with the
 * packages they police. Anything asserted here is also asserted in CI.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

const read = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));

const rootPkg = read('package.json');
const extensionPkg = read('extension/package.json');

// WXT takes the published manifest version from extension/package.json, not the
// repo root. A mismatch ships a build whose version does not match its tag, and
// it is silent without this check.
if (rootPkg.version !== extensionPkg.version) {
  failures.push(
    `Version mismatch: root package.json is ${rootPkg.version}, ` +
      `extension/package.json is ${extensionPkg.version}. WXT publishes the latter.`,
  );
}

// The CHANGELOG must describe the version we are about to build.
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
if (!changelog.includes(`## [${rootPkg.version}]`)) {
  failures.push(`CHANGELOG.md has no section for [${rootPkg.version}].`);
}

// The working title collided with an active UK company (Companies House
// 14990998). It must not creep back in through a copied file.
const forbidden = ['SafeToTrade', 'safetotrade'];
for (const term of forbidden) {
  if (rootPkg.name.includes(term) || extensionPkg.name.includes(term)) {
    failures.push(`Package name still contains the dropped working title "${term}".`);
  }
}

if (failures.length > 0) {
  console.error('Workspace verification failed:\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`Workspace verification passed (v${rootPkg.version}).`);
