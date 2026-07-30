/**
 * Localisation.
 *
 * A hand-rolled module rather than `chrome.i18n`, for one decisive reason: the
 * platform API cannot change language without restarting the extension, and the
 * options page needs a language switch that takes effect immediately.
 *
 * Pure — persistence lives in `platform/language.ts`. English is the fallback for
 * every missing key, so a gap in a translation shows English text rather than a
 * raw key. A user seeing "flag.accounts-overdue.label" learns nothing.
 *
 * Note that flag messages come through here from `shared`, which emits i18n keys
 * rather than rendered strings. The demand-letter paragraph deliberately does not:
 * see `shared/src/rates/wording.ts`.
 */

import { useEffect, useState } from 'preact/hooks';
import en from './en.json' with { type: 'json' };
import pl from './pl.json' with { type: 'json' };

export type Language = 'en' | 'pl';

type Dictionary = Record<string, string>;

const DICTIONARIES: Record<Language, Dictionary> = { en, pl };

export const LANGUAGES: readonly Language[] = ['en', 'pl'];

let current: Language = 'en';
const listeners = new Set<(language: Language) => void>();

export function getLanguage(): Language {
  return current;
}

export function setLanguage(language: Language): void {
  if (language === current) return;
  current = language;
  for (const listener of listeners) listener(language);
}

/** Interpolates `{name}` placeholders. */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    // An unresolved placeholder is left visible rather than blanked. Blanking it
    // produces a sentence that reads correctly and says the wrong thing.
    return value === undefined ? whole : String(value);
  });
}

export function translate(key: string, params?: Record<string, string | number>): string {
  const template = DICTIONARIES[current][key] ?? DICTIONARIES.en[key];
  return template === undefined ? key : interpolate(template, params);
}

/** Every key present in either dictionary. Used by the parity test. */
export function allKeys(): { en: string[]; pl: string[] } {
  return { en: Object.keys(DICTIONARIES.en), pl: Object.keys(DICTIONARIES.pl) };
}

export function dictionary(language: Language): Dictionary {
  return DICTIONARIES[language];
}

/** Re-renders the component when the language changes. */
export function useT(): {
  t: (key: string, params?: Record<string, string | number>) => string;
  language: Language;
} {
  const [language, setLocal] = useState<Language>(current);

  useEffect(() => {
    listeners.add(setLocal);
    setLocal(current);
    return () => {
      listeners.delete(setLocal);
    };
  }, []);

  return { t: translate, language };
}
