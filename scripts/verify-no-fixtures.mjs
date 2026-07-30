#!/usr/bin/env node
/**
 * Asserts that a production Worker bundle contains no fixture data.
 *
 * This guard exists because the first attempt at tree-shaking looked correct and
 * was not. Routing the `__FIXTURES_ENABLED__` check through a helper function
 * made the flag opaque to esbuild, so the branch stayed live and forty kilobytes
 * of invented company data shipped in the bundle. No test caught it — every test
 * runs with fixtures deliberately enabled. Only grepping the built output did.
 *
 * What is at stake is not bundle size. A production Worker carrying fixture data
 * could, if any other guard failed, serve a report about a company that does not
 * exist to somebody deciding whether to extend it credit.
 *
 * Run: node scripts/verify-no-fixtures.mjs
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workerDir = join(root, 'worker');

/** Strings that must never appear in a production bundle. */
const FORBIDDEN = [
  // The marker exported by the fixtures package.
  'LTDLENS_FIXTURE_MARKER',
  // Company names from the fixtures, real and synthetic.
  'TESCO PLC',
  'DISTRESSED TRADING',
  'CEASED HOLDINGS',
  'NEWCO VENTURES',
  // The dropped working title, in case a stale file is ever reintroduced.
  'SafeToTrade',
];

const outDir = mkdtempSync(join(tmpdir(), 'ltdlens-bundle-'));

try {
  execFileSync(
    'npx',
    ['wrangler', 'deploy', '--dry-run', '--outdir', outDir, '--env', 'production'],
    { cwd: workerDir, stdio: 'pipe' },
  );
} catch (cause) {
  rmSync(outDir, { recursive: true, force: true });
  console.error('Could not build the production Worker bundle:\n');
  console.error(cause.stderr?.toString() ?? cause.message);
  process.exit(1);
}

const bundlePath = join(outDir, 'index.js');
if (!existsSync(bundlePath)) {
  rmSync(outDir, { recursive: true, force: true });
  console.error(`No bundle produced at ${bundlePath}.`);
  process.exit(1);
}

const bundle = readFileSync(bundlePath, 'utf8');
const found = FORBIDDEN.filter((needle) => bundle.includes(needle));
const sizeKb = Math.round(bundle.length / 1024);

rmSync(outDir, { recursive: true, force: true });

if (found.length > 0) {
  console.error('Production Worker bundle contains data that must not ship:\n');
  for (const needle of found) console.error(`  - ${needle}`);
  console.error(
    '\nCheck that `__FIXTURES_ENABLED__` is read directly in worker/src/upstream/index.ts,',
  );
  console.error('never through a wrapper function, and that fixtures/package.json still');
  console.error('declares "sideEffects": false.');
  process.exit(1);
}

console.log(`Production bundle clean (${sizeKb} KiB, no fixture data).`);
