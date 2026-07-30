/**
 * Local lookup history. Pure list operations; storage lives in `platform/`.
 *
 * History is the one thing here that is genuinely about the user rather than about
 * companies, so it never leaves the browser and it is capped, clearable, and
 * switchable off entirely.
 */

import type { HistoryEntry } from './types.js';

/** Adds or refreshes an entry, most recent first. */
export function addToHistory(
  history: readonly HistoryEntry[],
  entry: HistoryEntry,
  limit: number,
): HistoryEntry[] {
  if (limit <= 0) return [];

  // Looking a company up twice should move it to the top, not create a second
  // row. Someone checking the same supplier weekly would otherwise fill their
  // history with one name.
  const without = history.filter((existing) => existing.number !== entry.number);
  return [entry, ...without].slice(0, limit);
}

export function removeFromHistory(
  history: readonly HistoryEntry[],
  number: string,
): HistoryEntry[] {
  return history.filter((entry) => entry.number !== number);
}

/** Applies a reduced limit to an existing list. */
export function trimHistory(history: readonly HistoryEntry[], limit: number): HistoryEntry[] {
  return limit <= 0 ? [] : history.slice(0, limit);
}

/** Drops entries that are not usable, so a corrupted store cannot break the popup. */
export function sanitiseHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];

  return raw.filter((entry): entry is HistoryEntry => {
    if (typeof entry !== 'object' || entry === null) return false;
    const candidate = entry as Partial<HistoryEntry>;
    return (
      typeof candidate.number === 'string' &&
      candidate.number.length > 0 &&
      typeof candidate.name === 'string' &&
      typeof candidate.at === 'string'
    );
  });
}
