/**
 * Storage adapters.
 *
 * Thin by design: every decision lives in `lib/`, so these are wrappers with no
 * branching worth testing. If one of these functions grows an `if`, that `if`
 * belongs in `lib/`.
 *
 * Everything is `chrome.storage.local` rather than `sync`. Sync would carry a
 * user's lookup history across their machines through Google's servers, which
 * would make the privacy claim materially weaker for a convenience nobody asked
 * for.
 */

import type { HistoryEntry } from '../lib/types.js';
import type { Settings } from '../lib/settings.js';
import { migrateSettings, needsRewrite } from '../lib/settings.js';
import { sanitiseHistory } from '../lib/history.js';
import type { CacheEntry } from '../lib/cache.js';
import type { CacheStore } from '../lib/api.js';

const SETTINGS_KEY = 'settings';
const HISTORY_KEY = 'history';
const CACHE_PREFIX = 'cache:';

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const raw = stored[SETTINGS_KEY];
  const settings = migrateSettings(raw);

  // Write the migrated shape back once, so the next read is a straight hit and a
  // migration never runs twice on the same data.
  if (needsRewrite(raw, settings)) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  }

  return settings;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function loadHistory(): Promise<HistoryEntry[]> {
  const stored = await chrome.storage.local.get(HISTORY_KEY);
  return sanitiseHistory(stored[HISTORY_KEY]);
}

export async function saveHistory(history: readonly HistoryEntry[]): Promise<void> {
  await chrome.storage.local.set({ [HISTORY_KEY]: history });
}

/** The local snapshot cache, as `lib/api.ts` expects it. */
export function chromeCacheStore(): CacheStore {
  return {
    async get(key) {
      const stored = await chrome.storage.local.get(CACHE_PREFIX + key);
      return stored[CACHE_PREFIX + key] as CacheEntry | undefined;
    },

    async set(key, entry) {
      await chrome.storage.local.set({ [CACHE_PREFIX + key]: entry });
    },

    async keys() {
      const all = await chrome.storage.local.get(null);
      return Object.entries(all)
        .filter(([key]) => key.startsWith(CACHE_PREFIX))
        .map(([key, value]) => ({
          key: key.slice(CACHE_PREFIX.length),
          fetchedAt: (value as CacheEntry | undefined)?.fetchedAt ?? '',
        }));
    },

    async delete(keys) {
      await chrome.storage.local.remove(keys.map((key) => CACHE_PREFIX + key));
    },
  };
}

/** Removes history and every cached report. Settings are kept. */
export async function clearLocalData(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const doomed = Object.keys(all).filter(
    (key) => key === HISTORY_KEY || key.startsWith(CACHE_PREFIX),
  );
  if (doomed.length > 0) await chrome.storage.local.remove(doomed);
}
