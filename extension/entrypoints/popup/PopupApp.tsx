/**
 * The popup: a search box and a local history.
 *
 * Deliberately not the main way to use LtdLens — that is selecting a name on a
 * page and right-clicking, which arrives with the side panel in v0.2.1. The popup
 * exists for when there is nothing to select, and it carries the hint that teaches
 * the primary gesture. Somebody who only ever finds the popup has a worse tool
 * than the one they installed.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import type { SearchHit } from '@ltdlens/shared';
import { companyRecordUrl } from '@ltdlens/shared';
import type { HistoryEntry, SearchResult } from '@/lib/types';
import type { Settings } from '@/lib/settings';
import { useT } from '@/lib/i18n';
import { sendToBackground } from '@/platform/messaging';
import { AppFooter } from '@/components/AppFooter';
import { HistoryList, SearchResults } from '@/components/ResultList';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/StateBlock';

type View = { kind: 'idle' } | { kind: 'searching' } | { kind: 'results'; result: SearchResult };

export function PopupApp({ settings }: { settings: Settings }) {
  const { t } = useT();
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>({ kind: 'idle' });
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const now = new Date();

  const refreshHistory = useCallback(async () => {
    setHistory(await sendToBackground<HistoryEntry[]>({ type: 'history/list' }));
  }, []);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  const search = useCallback(async (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed.length < 2) return;

    setView({ kind: 'searching' });
    const result = await sendToBackground<SearchResult>({
      type: 'company/search',
      query: trimmed,
    });
    setView({ kind: 'results', result });
  }, []);

  /**
   * Until the side panel exists there is nothing to show a report in, so a
   * selection opens the official record. That is a smaller feature than the panel
   * but never a dead end — and it is exactly what the fallback does on error, so
   * the behaviour is consistent rather than a stopgap.
   */
  const open = useCallback((number: string) => {
    void chrome.tabs.create({ url: companyRecordUrl(number) });
  }, []);

  const selectHit = useCallback((hit: SearchHit) => open(hit.number), [open]);
  const selectEntry = useCallback((entry: HistoryEntry) => open(entry.number), [open]);

  const removeEntry = useCallback(
    async (entry: HistoryEntry) => {
      await sendToBackground({ type: 'history/remove', number: entry.number });
      await refreshHistory();
    },
    [refreshHistory],
  );

  const clearHistory = useCallback(async () => {
    await sendToBackground({ type: 'history/clear' });
    await refreshHistory();
  }, [refreshHistory]);

  return (
    <div style="width: 380px">
      <div class="stack" style="padding: 12px">
        <div class="row" style="justify-content: space-between">
          <h1>{t('app.name')}</h1>
          <button
            type="button"
            class="quiet"
            onClick={() => {
              void chrome.runtime.openOptionsPage();
            }}
          >
            ⚙
          </button>
        </div>

        {settings.dataSource === 'demo' && <div class="banner">{t('state.demoBanner')}</div>}

        <form
          class="row"
          onSubmit={(event) => {
            event.preventDefault();
            void search(query);
          }}
        >
          <input
            type="search"
            value={query}
            placeholder={t('search.placeholder')}
            aria-label={t('search.placeholder')}
            onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
            /* Autofocus is right here: the popup only opens because somebody
               clicked the icon, and typing a name is the only thing it is for.
               The usual objection — stealing focus on a page load — does not
               apply to a surface the user just summoned. */
            autoFocus
          />
          <button type="submit" class="primary" disabled={query.trim().length < 2}>
            {t('search.button')}
          </button>
        </form>

        {view.kind === 'idle' && <p class="hint">{t('search.hint')}</p>}
        {view.kind === 'searching' && <LoadingBlock label={t('search.searching')} />}

        {view.kind === 'results' && view.result.state === 'error' && (
          <ErrorBlock
            kind={view.result.kind}
            message={view.result.message}
            {...(view.result.retryAfterSeconds === undefined
              ? {}
              : { retryAfterSeconds: view.result.retryAfterSeconds })}
            onRetry={() => void search(query)}
          />
        )}

        {view.kind === 'results' &&
          view.result.state === 'ok' &&
          (view.result.data.hits.length === 0 ? (
            <EmptyBlock message={t('search.noResults')} />
          ) : (
            <SearchResults
              hits={view.result.data.hits}
              total={view.result.data.totalResults}
              onSelect={selectHit}
            />
          ))}

        {settings.historyEnabled && (
          <section class="stack">
            <div class="row" style="justify-content: space-between">
              <h2>{t('history.title')}</h2>
              {history.length > 0 && (
                <button type="button" class="quiet" onClick={() => void clearHistory()}>
                  {t('history.clear')}
                </button>
              )}
            </div>

            {history.length === 0 ? (
              <EmptyBlock message={t('history.empty')} />
            ) : (
              <HistoryList
                entries={history}
                now={now}
                onSelect={selectEntry}
                onRemove={(entry) => void removeEntry(entry)}
              />
            )}
          </section>
        )}

        <p class="disclaimer">{t('disclaimer')}</p>
      </div>

      <AppFooter />
    </div>
  );
}
