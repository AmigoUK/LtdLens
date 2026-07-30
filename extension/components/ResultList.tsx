/**
 * Search results and history rows.
 *
 * Each row shows name, number, status and incorporation year. That is deliberately
 * everything needed to pick the right company without opening anything — there are
 * dozens of companies called some variant of "Smith Building", and choosing the
 * wrong one silently is worse than one extra click.
 */

import type { SearchHit } from '@ltdlens/shared';
import type { HistoryEntry } from '../lib/types.js';
import { useT } from '../lib/i18n/index.js';
import { formatCompanyNumber, formatDate, formatRelative, statusKey } from '../lib/format.js';

function severityForStatus(status: string): 'green' | 'amber' | 'red' {
  const normalised = status.toLowerCase();
  if (normalised === 'active') return 'green';
  if (normalised === 'registered' || normalised === 'open') return 'amber';
  return 'red';
}

export function SearchResults({
  hits,
  total,
  onSelect,
}: {
  hits: readonly SearchHit[];
  total: number;
  onSelect: (hit: SearchHit) => void;
}) {
  const { t } = useT();

  return (
    <div class="stack">
      {total > hits.length && (
        <p class="hint">{t('search.resultCount', { count: hits.length, total })}</p>
      )}

      <ul class="result-list">
        {hits.map((hit) => (
          <li key={hit.number}>
            <button type="button" class="result" onClick={() => onSelect(hit)}>
              <span class="result-name">{hit.name}</span>
              <span class="result-meta">
                <span class={`chip ${severityForStatus(hit.status)}`}>
                  {t(statusKey(hit.status))}
                </span>
                <span class="mono">{formatCompanyNumber(hit.number)}</span>
                {hit.incorporatedOn !== undefined && <span>{formatDate(hit.incorporatedOn)}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HistoryList({
  entries,
  now,
  onSelect,
  onRemove,
}: {
  entries: readonly HistoryEntry[];
  now: Date;
  onSelect: (entry: HistoryEntry) => void;
  onRemove: (entry: HistoryEntry) => void;
}) {
  const { t } = useT();

  return (
    <ul class="result-list">
      {entries.map((entry) => (
        <li key={entry.number} class="row">
          <button type="button" class="result" style="flex: 1" onClick={() => onSelect(entry)}>
            <span class="result-name">{entry.name}</span>
            <span class="result-meta">
              <span class="mono">{formatCompanyNumber(entry.number)}</span>
              <span>{formatRelative(entry.at, now)}</span>
            </span>
          </button>
          <button
            type="button"
            class="quiet"
            title={t('history.remove')}
            aria-label={`${t('history.remove')}: ${entry.name}`}
            onClick={() => onRemove(entry)}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}
