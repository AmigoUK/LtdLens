import { describe, expect, it } from 'vitest';
import { addToHistory, removeFromHistory, sanitiseHistory, trimHistory } from '../lib/history.js';
import type { HistoryEntry } from '../lib/types.js';

const entry = (number: string, at = '2026-07-30T10:00:00.000Z'): HistoryEntry => ({
  number,
  name: `COMPANY ${number}`,
  at,
});

describe('addToHistory', () => {
  it('puts the newest entry first', () => {
    const history = addToHistory([entry('00000001')], entry('00000002'), 20);
    expect(history.map((e) => e.number)).toEqual(['00000002', '00000001']);
  });

  it('moves a repeat lookup to the top instead of duplicating it', () => {
    // Somebody checking the same supplier weekly would otherwise fill their
    // history with one name.
    const history = addToHistory(
      [entry('00000001'), entry('00000002')],
      entry('00000002', '2026-07-30T12:00:00.000Z'),
      20,
    );
    expect(history.map((e) => e.number)).toEqual(['00000002', '00000001']);
    expect(history).toHaveLength(2);
    expect(history[0]?.at).toBe('2026-07-30T12:00:00.000Z');
  });

  it('enforces the limit', () => {
    const existing = [entry('00000001'), entry('00000002'), entry('00000003')];
    expect(addToHistory(existing, entry('00000004'), 3)).toHaveLength(3);
  });

  it('keeps nothing when the limit is zero', () => {
    expect(addToHistory([entry('00000001')], entry('00000002'), 0)).toEqual([]);
  });
});

describe('removeFromHistory', () => {
  it('removes only the named entry', () => {
    const history = removeFromHistory([entry('00000001'), entry('00000002')], '00000001');
    expect(history.map((e) => e.number)).toEqual(['00000002']);
  });

  it('is a no-op for an entry that is not there', () => {
    const history = [entry('00000001')];
    expect(removeFromHistory(history, '00000009')).toEqual(history);
  });
});

describe('trimHistory', () => {
  it('applies a limit that has since been reduced', () => {
    const history = [entry('1'), entry('2'), entry('3')];
    expect(trimHistory(history, 2)).toHaveLength(2);
    expect(trimHistory(history, 0)).toEqual([]);
  });
});

describe('sanitiseHistory', () => {
  it('drops anything unusable rather than letting it break the popup', () => {
    const raw = [
      entry('00000001'),
      { number: '00000002' },
      { name: 'NO NUMBER LTD', at: 'x' },
      null,
      'nonsense',
      { number: '', name: 'EMPTY', at: 'x' },
    ];
    expect(sanitiseHistory(raw).map((e) => e.number)).toEqual(['00000001']);
  });

  it('returns an empty list for anything that is not an array', () => {
    for (const raw of [undefined, null, {}, 'history']) {
      expect(sanitiseHistory(raw)).toEqual([]);
    }
  });
});
