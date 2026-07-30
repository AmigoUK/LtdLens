import { render } from 'preact';
import '@/assets/ui.css';
import { initLanguage } from '@/platform/language';
import { applyTheme } from '@/platform/theme';
import { loadSettings } from '@/platform/storage';
import { OptionsApp } from './OptionsApp';

async function start(): Promise<void> {
  const settings = await loadSettings();
  applyTheme(settings.theme);
  await initLanguage();

  // The first-run page is this one with a flag, so somebody who has just
  // installed the extension lands on something that explains the right-click
  // gesture rather than on a bare settings form.
  const welcome = new URLSearchParams(window.location.search).has('welcome');

  const root = document.getElementById('app');
  if (root !== null) render(<OptionsApp initial={settings} welcome={welcome} />, root);
}

void start();
