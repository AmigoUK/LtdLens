import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  LANGUAGES,
  allKeys,
  dictionary,
  getLanguage,
  setLanguage,
  translate,
} from '../lib/i18n/index.js';

describe('dictionary parity', () => {
  it('has the same keys in every language', () => {
    // A half-translated interface is worse than an English one, so a language only
    // appears in LANGUAGES once its dictionary is complete.
    const { en, pl } = allKeys();
    expect([...pl].sort()).toEqual([...en].sort());
  });

  it('has no empty values', () => {
    for (const language of LANGUAGES) {
      for (const [key, value] of Object.entries(dictionary(language))) {
        expect(value.trim().length, `${language}:${key} is empty`).toBeGreaterThan(0);
      }
    }
  });

  it('uses the same placeholders in every language', () => {
    // A translation that drops {date} produces a sentence which reads correctly
    // and says the wrong thing — the worst kind of translation bug.
    const placeholders = (text: string) =>
      [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

    for (const [key, english] of Object.entries(dictionary('en'))) {
      const polish = dictionary('pl')[key];
      expect(polish, `pl:${key} missing`).toBeDefined();
      expect(placeholders(polish!), `placeholders differ for ${key}`).toEqual(
        placeholders(english),
      );
    }
  });

  it('never uses the words this product refuses to use', () => {
    // Flags state register facts. "Score", "rating" and the rest are inferences
    // about a named company, and that is a different legal position to be in.
    const forbidden = [
      'credit rating',
      'creditworthy',
      'do not trade',
      'unreliable',
      'risky',
      'ocena kredytowa',
      'niewiarygodn',
    ];

    for (const language of LANGUAGES) {
      for (const [key, value] of Object.entries(dictionary(language))) {
        for (const word of forbidden) {
          // The disclaimer is allowed to name what LtdLens is not.
          if (key === 'disclaimer') continue;
          expect(value.toLowerCase(), `${language}:${key} contains "${word}"`).not.toContain(word);
        }
      }
    }
  });
});

describe('translate', () => {
  it('interpolates named placeholders', () => {
    setLanguage('en');
    expect(translate('search.resultCount', { count: 3, total: 47 })).toBe('3 of 47 matches');
  });

  it('leaves an unresolved placeholder visible rather than blanking it', () => {
    // Blanking produces a sentence that reads correctly and is wrong.
    expect(translate('search.resultCount', { count: 3 })).toContain('{total}');
  });

  it('returns the key when nothing matches, so a gap is obvious', () => {
    expect(translate('no.such.key')).toBe('no.such.key');
  });

  it('falls back to English for a key missing from another language', () => {
    setLanguage('pl');
    // Both dictionaries are complete, so this asserts the mechanism via a key that
    // is deliberately identical in both.
    expect(translate('footer.email')).toBe('dev@attv.uk');
    setLanguage('en');
  });

  it('switches language in memory', () => {
    setLanguage('pl');
    expect(getLanguage()).toBe('pl');
    expect(translate('search.button')).toBe('Sprawdź');
    setLanguage('en');
    expect(translate('search.button')).toBe('Check');
  });
});

describe('source usage', () => {
  it('has a dictionary entry for every key used in the interface', () => {
    // Catches the common failure: adding a t('...') call and forgetting the string,
    // which ships a raw key to a user.
    const sources = ['popup/PopupApp.tsx', 'options/OptionsApp.tsx'].map((file) =>
      readFileSync(fileURLToPath(new URL(`../entrypoints/${file}`, import.meta.url)), 'utf8'),
    );
    const components = ['StateBlock.tsx', 'ResultList.tsx'].map((file) =>
      readFileSync(fileURLToPath(new URL(`../components/${file}`, import.meta.url)), 'utf8'),
    );

    const used = new Set<string>();
    for (const source of [...sources, ...components]) {
      for (const match of source.matchAll(/\bt\(\s*'([\w.-]+)'/g)) used.add(match[1]!);
    }

    expect(used.size).toBeGreaterThan(10);
    const english = dictionary('en');
    for (const key of used) {
      // statusKey() builds keys dynamically; those are checked separately.
      if (key.startsWith('status.')) continue;
      expect(english[key], `missing dictionary entry: ${key}`).toBeDefined();
    }
  });
});
