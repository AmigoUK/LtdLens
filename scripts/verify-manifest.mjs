#!/usr/bin/env node
/**
 * Asserts the built production manifest declares exactly what it should.
 *
 * Permissions are the most consequential thing in a Chrome extension: they decide
 * what a reviewer asks about, what warning a user sees at install, and whether an
 * update silently disables itself. All of that is settled by a generated file
 * nobody reads after the first week. So it is asserted rather than trusted.
 *
 * The localhost host permission is the specific accident this exists to prevent.
 * It is needed in development, reviewers flag it, and it would ship the first time
 * somebody built without thinking about the mode.
 *
 *   node scripts/verify-manifest.mjs
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extensionDir = join(root, 'extension');
const manifestPath = join(extensionDir, '.output', 'chrome-mv3', 'manifest.json');

// Always rebuild rather than reading whatever is on disk. A manifest left over
// from an earlier build would be verified instead of the one about to ship, which
// is precisely the case this guard exists to catch.
//
// Note WXT writes development builds to `.output/chrome-mv3-dev`, so a dev build
// cannot masquerade as the production one here — but a *stale* production build
// could, which is why this is unconditional.
execFileSync('npx', ['wxt', 'build'], { cwd: extensionDir, stdio: 'pipe' });

if (!existsSync(manifestPath)) {
  console.error(`No manifest produced at ${manifestPath}.`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const failures = [];

/** Changing either list is a deliberate act with review consequences. */
const EXPECTED_PERMISSIONS = ['contextMenus', 'storage', 'sidePanel'];
const EXPECTED_HOSTS = ['https://api.ltdlens.uk/*'];

const actualPermissions = [...(manifest.permissions ?? [])].sort();
if (JSON.stringify(actualPermissions) !== JSON.stringify([...EXPECTED_PERMISSIONS].sort())) {
  failures.push(
    `Permissions changed. Expected ${EXPECTED_PERMISSIONS.join(', ')}; ` +
      `got ${actualPermissions.join(', ') || '(none)'}.`,
  );
}

const actualHosts = [...(manifest.host_permissions ?? [])].sort();
if (JSON.stringify(actualHosts) !== JSON.stringify([...EXPECTED_HOSTS].sort())) {
  failures.push(
    `Host permissions changed. Expected ${EXPECTED_HOSTS.join(', ')}; ` +
      `got ${actualHosts.join(', ') || '(none)'}.`,
  );
}

// Development-only hosts must never reach a production build.
const forbiddenHost = actualHosts.find(
  (host) => host.includes('localhost') || host.includes('127.0.0.1'),
);
if (forbiddenHost !== undefined) {
  failures.push(`Production manifest contains a development host: ${forbiddenHost}`);
}

// Deferred to v1.0 with the watchlist and bring-your-own-key. Shipping them unused
// invites a review question with nothing to gain.
for (const key of ['optional_permissions', 'optional_host_permissions']) {
  if (manifest[key] !== undefined) failures.push(`${key} should not be declared yet.`);
}

if (manifest.content_scripts !== undefined) {
  failures.push(
    'No content script in the MVP: contextMenus.onClicked supplies the selection ' +
      'without any page access, which is the smallest possible review surface.',
  );
}

// sidePanel.open() shipped in Chrome 116.
if (manifest.minimum_chrome_version !== '116') {
  failures.push(`minimum_chrome_version should be 116, got ${manifest.minimum_chrome_version}.`);
}

// The Chrome Web Store description field is limited to 132 characters.
if (typeof manifest.description !== 'string' || manifest.description.length > 132) {
  failures.push(
    `Description must be 132 characters or fewer (got ${manifest.description?.length ?? 0}).`,
  );
}

const extensionVersion = JSON.parse(
  readFileSync(join(extensionDir, 'package.json'), 'utf8'),
).version;
if (manifest.version !== extensionVersion) {
  failures.push(
    `Manifest version ${manifest.version} does not match extension/package.json ${extensionVersion}.`,
  );
}

if (failures.length > 0) {
  console.error('Manifest verification failed:\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `Manifest verified (v${manifest.version}: ${actualPermissions.join(', ')}; ${actualHosts.join(', ')}).`,
);
