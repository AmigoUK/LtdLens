/**
 * The background service worker.
 *
 * **All network and cache access happens here and nowhere else.** The popup, the
 * options page and the side panel send messages. That buys one fetch path, one
 * cache, no duplicate in-flight requests across surfaces, and a host permission
 * that only ever matters in one file.
 *
 * The side panel and context menu arrive in v0.2.1; this version wires the popup.
 */

// Imported explicitly rather than relying on WXT's auto-imports. The magic
// globals work, but they only typecheck after `wxt prepare` has generated its
// declarations, which makes a fresh clone fail in a way that looks like a real
// error. An explicit import always works.
import { defineBackground } from 'wxt/utils/define-background';
import type { CompanySnapshot } from '@ltdlens/shared';
import type { BgRequest, CompanyResult, HistoryEntry, SearchResult } from '../lib/types.js';
import { addToHistory, removeFromHistory, trimHistory } from '../lib/history.js';
import { onRequest } from '../platform/messaging.js';
import { createClient } from '../platform/api.js';
import { clearLocalData, loadHistory, loadSettings, saveHistory } from '../platform/storage.js';

/** Records a successful lookup, if history is switched on. */
async function remember(snapshot: CompanySnapshot): Promise<void> {
  const settings = await loadSettings();
  if (!settings.historyEnabled || settings.historyLimit <= 0) return;

  const entry: HistoryEntry = {
    number: snapshot.number,
    name: snapshot.name,
    at: new Date().toISOString(),
  };

  const history = await loadHistory();
  await saveHistory(addToHistory(history, entry, settings.historyLimit));
}

async function handle(message: BgRequest): Promise<unknown> {
  switch (message.type) {
    case 'settings/get':
      return loadSettings();

    case 'company/search': {
      const settings = await loadSettings();
      const result: SearchResult = await createClient(settings).search(message.query);
      return result;
    }

    case 'company/get': {
      const settings = await loadSettings();
      const result: CompanyResult = await createClient(settings).company(message.number, {
        ...(message.refresh === undefined ? {} : { refresh: message.refresh }),
      });

      // Only a real result is remembered. Recording a failed lookup would fill
      // the history with companies the user never actually saw.
      if (result.state === 'ok') await remember(result.data);
      return result;
    }

    case 'history/list': {
      const settings = await loadSettings();
      const history = await loadHistory();
      // The stored list may be longer than a since-reduced limit.
      return settings.historyEnabled ? trimHistory(history, settings.historyLimit) : [];
    }

    case 'history/remove': {
      const history = await loadHistory();
      await saveHistory(removeFromHistory(history, message.number));
      return { ok: true };
    }

    case 'history/clear':
      await saveHistory([]);
      return { ok: true };

    case 'cache/clear':
      await clearLocalData();
      return { ok: true };

    case 'panel/pending':
      // The side panel handshake lands in v0.2.1.
      return undefined;
  }
}

export default defineBackground(() => {
  onRequest(handle);

  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      // A first-run page rather than a silent install. Somebody who has just
      // added the extension needs to know it works from a right-click, or they
      // will click the icon, see a search box, and never discover the point of it.
      void chrome.tabs.create({ url: chrome.runtime.getURL('/options.html?welcome=1') });
    }
  });
});
