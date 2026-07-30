/**
 * Applies the resolved theme to the document.
 *
 * The theme is mirrored into `localStorage` and read by a tiny inline script in
 * each page's HTML, before the module bundle loads. Without that, a user who has
 * chosen light on a dark system gets a dark flash on every panel open, because
 * `chrome.storage` is asynchronous and the first paint happens first.
 * `chrome.storage.local` stays the source of truth; `localStorage` is only a paint
 * cache. Extension pages have their own stable origin, so it is private to us.
 */

import type { ThemeSetting } from '../lib/settings.js';
import { resolveTheme } from '../lib/theme.js';

export const THEME_CACHE_KEY = 'ltdlens.theme';

/*
 * The same key is read by a small inline script in each page's head, before this
 * module loads. That duplication is deliberate and cannot be avoided: the script
 * has to run before the bundle to prevent the flash, so it cannot import from
 * here. If this key ever changes, change it in every entrypoint's index.html too.
 *
 * (Note for the next person: do not write a glob like entrypoints/ * /index.html
 * inside a block comment. The star-slash closes the comment and the rest of the
 * file parses as code, which is how this file first failed to build.)
 */

export function applyTheme(setting: ThemeSetting): void {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const resolved = resolveTheme(setting, prefersDark);

  document.documentElement.dataset.theme = resolved;
  try {
    // `system` is not cached: the media query answers it with no flash, and
    // caching a resolved value would strand the user on yesterday's system theme.
    if (setting === 'system') localStorage.removeItem(THEME_CACHE_KEY);
    else localStorage.setItem(THEME_CACHE_KEY, resolved);
  } catch {
    // Storage denied. The theme still applies for this page.
  }
}

/** Re-applies on system change while the setting is `system`. Returns an unsubscribe. */
export function watchSystemTheme(getSetting: () => ThemeSetting): () => void {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const listener = (): void => {
    if (getSetting() === 'system') applyTheme('system');
  };

  query.addEventListener('change', listener);
  return () => {
    query.removeEventListener('change', listener);
  };
}
