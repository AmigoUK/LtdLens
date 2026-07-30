#!/usr/bin/env node
/**
 * End-to-end checks against a real Chromium with the extension loaded.
 *
 * A hand-written script rather than `@playwright/test`, matching the sibling
 * project: there is one scenario file, it needs a persistent context with
 * `--load-extension`, and the test-runner ceremony buys nothing here.
 *
 * What this catches that unit tests cannot: whether the manifest actually loads,
 * whether the service worker registers, whether the surfaces render at all, and
 * whether the extension talks to any host it should not. That last one is the
 * mechanical enforcement of "zero telemetry" — it is the only check in the project
 * that could catch an accidental analytics call.
 *
 *   npm run build -w extension && xvfb-run -a node extension/scripts/e2e.mjs
 */

import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const extensionPath = join(here, '..', '.output', 'chrome-mv3');

const results = [];
let failed = 0;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failed += 1;
  const mark = ok ? '✓' : '✗';
  console.log(`  ${mark} ${name}${detail === '' ? '' : ` — ${detail}`}`);
}

/** Hosts the extension is allowed to contact. Anything else is a failure. */
const ALLOWED_HOSTS = new Set(['api.ltdlens.uk']);
const contacted = new Set();

const profile = mkdtempSync(join(tmpdir(), 'ltdlens-e2e-'));
let context;

try {
  context = await chromium.launchPersistentContext(profile, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  // Record every host the extension reaches for, and block real network access so
  // a mistake cannot quietly succeed.
  //
  // Only http(s) is intercepted. Aborting everything also blocks
  // chrome-extension:// requests — which is how the extension loads its own
  // modules and stylesheets — so the first version of this hook stopped every
  // surface from rendering at all and looked like a bug in the extension.
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      await route.continue();
      return;
    }
    contacted.add(url.host);
    await route.abort();
  });

  // The service worker is how we learn the extension id.
  let worker = context.serviceWorkers()[0];
  if (worker === undefined)
    worker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
  const extensionId = new URL(worker.url()).host;

  check('service worker registers', extensionId.length > 0, extensionId);

  const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
  check('manifest name', manifest.name === 'LtdLens', manifest.name);
  check(
    'permissions are exactly the expected three',
    JSON.stringify([...manifest.permissions].sort()) ===
      JSON.stringify(['contextMenus', 'sidePanel', 'storage']),
    manifest.permissions.join(', '),
  );
  check(
    'no host permission beyond the lookup service',
    JSON.stringify(manifest.host_permissions) === JSON.stringify(['https://api.ltdlens.uk/*']),
    (manifest.host_permissions ?? []).join(', '),
  );
  check('no content script declared', manifest.content_scripts === undefined);

  // --- Popup -----------------------------------------------------------------

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.waitForSelector('h1', { timeout: 10_000 });

  check('popup renders', (await popup.textContent('h1')) === 'LtdLens');
  check(
    'popup teaches the right-click gesture',
    (await popup.textContent('body')).includes('right-click'),
  );
  check(
    'popup carries the disclaimer',
    (await popup.textContent('.disclaimer')).includes('Not a credit rating'),
  );
  check(
    'credit footer shows a version',
    /v\d+\.\d+\.\d+/.test(await popup.textContent('.app-footer')),
    (await popup.textContent('.app-footer')).trim().slice(0, 60),
  );

  // --- Demo mode, end to end -------------------------------------------------

  // Switching the data source through storage rather than the options UI keeps
  // this check about the lookup path rather than about a select element.
  await popup.evaluate(async () => {
    const stored = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({
      settings: { ...(stored.settings ?? {}), schemaVersion: 1, dataSource: 'demo' },
    });
  });
  await popup.reload();
  await popup.waitForSelector('input[type="search"]');

  check('demo mode announces itself', (await popup.textContent('.banner')).includes('Demo mode'));

  await popup.fill('input[type="search"]', 'tesco');
  await popup.click('button[type="submit"]');
  await popup.waitForSelector('.result-name', { timeout: 10_000 });

  const firstResult = await popup.textContent('.result-name');
  check('search returns a company in demo mode', firstResult.includes('TESCO'), firstResult);
  check(
    'result row shows a status word, not just a colour',
    (await popup.textContent('.chip')).length > 2,
    await popup.textContent('.chip'),
  );

  // --- Options ---------------------------------------------------------------

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.waitForSelector('h1');

  check('options renders', (await options.textContent('h1')).includes('settings'));
  check(
    'options states the privacy position',
    (await options.textContent('body')).includes('no analytics'),
  );
  check(
    'options carries the Open Government Licence attribution',
    (await options.textContent('body')).includes('Open Government Licence'),
  );

  // Theme switching must take effect immediately, not on reload.
  await options.selectOption('select', 'dark');
  await options.waitForFunction(() => document.documentElement.dataset.theme === 'dark', {
    timeout: 5_000,
  });
  check('theme applies immediately', true, 'dark');

  // Language switching is the reason for a hand-rolled i18n layer: chrome.i18n
  // cannot do it without restarting the extension.
  const selects = options.locator('select');
  await selects.nth(1).selectOption('pl');
  await options.waitForFunction(() => document.body.textContent?.includes('Ustawienia') === true, {
    timeout: 5_000,
  });
  check('language applies immediately', true, 'pl');

  // --- The privacy claim, mechanically ---------------------------------------

  const strayHosts = [...contacted].filter((host) => !ALLOWED_HOSTS.has(host));
  check(
    'extension contacted no host but the lookup service',
    strayHosts.length === 0,
    strayHosts.length === 0
      ? `hosts seen: ${[...contacted].join(', ') || 'none'}`
      : strayHosts.join(', '),
  );

  // Demo mode is the strongest form of that claim: it should reach nothing at all.
  check(
    'demo mode made no network request whatsoever',
    contacted.size === 0,
    [...contacted].join(', ') || 'none',
  );
} finally {
  await context?.close();
  rmSync(profile, { recursive: true, force: true });
}

console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed === 0 ? 0 : 1);
