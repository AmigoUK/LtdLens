/**
 * Language persistence.
 *
 * The dictionary module holds the current language in memory and knows nothing
 * about storage; this connects the two. Each page calls `initLanguage()` before
 * rendering, so no surface flashes English before switching.
 */

import type { Language } from '../lib/i18n/index.js';
import { setLanguage } from '../lib/i18n/index.js';
import { loadSettings, saveSettings } from './storage.js';

export async function initLanguage(): Promise<Language> {
  const settings = await loadSettings();
  setLanguage(settings.language);
  return settings.language;
}

export async function persistLanguage(language: Language): Promise<void> {
  const settings = await loadSettings();
  await saveSettings({ ...settings, language });
  setLanguage(language);
}
