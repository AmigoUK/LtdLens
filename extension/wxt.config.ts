import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

/**
 * WXT takes the published manifest version from `extension/package.json`, not the
 * repo root. `scripts/verify-workspace.mjs` asserts the two agree, because a
 * mismatch ships a build whose version does not match its tag and has no other
 * symptom.
 *
 * **The permission set is deliberately smaller than the concept document's.**
 * No `alarms` and no `optional_host_permissions`: Chrome only disables an
 * extension on update when a new permission adds a *warning string*, and optional
 * permissions never do — so adding them at v1.0 for the watchlist and
 * bring-your-own-key costs nothing, while shipping them unused now is a real
 * review question with nothing to gain.
 *
 * There is no content script at all in the MVP. `contextMenus.onClicked` supplies
 * `info.selectionText` without any access to the page, which is both the smallest
 * possible review surface and an honest match for what the extension actually
 * needs.
 */
export default defineConfig({
  srcDir: '.',
  vite: () => ({
    plugins: [preact()],
  }),
  manifest: ({ mode }) => ({
    name: 'LtdLens',
    // Kept under 132 characters for the Chrome Web Store listing field.
    description:
      'Check any UK company before you trade — risk flags from official Companies House data. Free, no sign-up.',
    permissions: ['contextMenus', 'storage', 'sidePanel'],
    host_permissions:
      mode === 'production'
        ? ['https://api.ltdlens.uk/*']
        : // A localhost permission must never reach production; CWS reviewers
          // flag it, and `scripts/verify-manifest.mjs` fails the build if it does.
          ['https://api.ltdlens.uk/*', 'http://localhost:8787/*', 'http://127.0.0.1:8787/*'],
    // `sidePanel.open()` shipped in Chrome 116.
    minimum_chrome_version: '116',
    homepage_url: 'https://github.com/AmigoUK/LtdLens',
    // Note: `options_ui` cannot be set here. WXT generates it from the options
    // entrypoint and its value wins, so `open_in_tab` is declared as a
    // `<meta name="manifest.open_in_tab">` tag in options/index.html instead.
  }),
});
