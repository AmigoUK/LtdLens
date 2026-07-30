import { render } from 'preact';
import '@/assets/ui.css';
import { initLanguage } from '@/platform/language';
import { applyTheme } from '@/platform/theme';
import { loadSettings } from '@/platform/storage';
import { PopupApp } from './PopupApp';

/**
 * Language and theme are applied before the first render, so no surface flashes
 * English or the wrong palette on open.
 */
async function start(): Promise<void> {
  const settings = await loadSettings();
  applyTheme(settings.theme);
  await initLanguage();

  const root = document.getElementById('app');
  if (root !== null) render(<PopupApp settings={settings} />, root);
}

void start();
