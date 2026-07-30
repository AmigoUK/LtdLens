/**
 * Settings, and the first-run page.
 *
 * Changes save immediately rather than behind a Save button. There is nothing here
 * that needs a transaction, and a form somebody edits and then closes without
 * noticing the button is a form that lies about its state.
 *
 * The language switch is present because the dictionary is complete. It is worth
 * noting that a half-translated interface is worse than an English one, so a new
 * language goes into `LANGUAGES` only once its dictionary passes the parity test.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import type { Language, Settings, ThemeSetting } from '@/lib/settings';
import { DEFAULT_WORKER_URL } from '@/lib/settings';
import { LANGUAGES, useT } from '@/lib/i18n';
import { persistLanguage } from '@/platform/language';
import { applyTheme, watchSystemTheme } from '@/platform/theme';
import { saveSettings } from '@/platform/storage';
import { sendToBackground } from '@/platform/messaging';
import { AppFooter } from '@/components/AppFooter';

const PRIVACY_URL = 'https://github.com/AmigoUK/LtdLens/blob/main/PRIVACY.md';

export function OptionsApp({ initial, welcome }: { initial: Settings; welcome: boolean }) {
  const { t } = useT();
  const [settings, setSettings] = useState<Settings>(initial);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  useEffect(() => watchSystemTheme(() => settings.theme), [settings.theme]);

  const update = useCallback(
    async (patch: Partial<Settings>) => {
      const next = { ...settings, ...patch };
      setSettings(next);
      await saveSettings(next);

      if (patch.theme !== undefined) applyTheme(patch.theme);
      if (patch.language !== undefined) await persistLanguage(patch.language);

      setNotice(t('options.saved'));
      // The confirmation is transient. A permanent "Saved." next to a field the
      // user has since changed again is worse than none.
      setTimeout(() => setNotice(undefined), 1800);
    },
    [settings, t],
  );

  const clearData = useCallback(async () => {
    await sendToBackground({ type: 'cache/clear' });
    setNotice(t('options.cleared'));
    setTimeout(() => setNotice(undefined), 2400);
  }, [t]);

  return (
    <div style="max-width: 620px; margin: 0 auto">
      <div class="stack" style="padding: 20px; gap: 20px">
        <header class="stack" style="gap: 4px">
          <h1 style="font-size: 18px">{t('options.title')}</h1>
          <p class="hint">{t('app.tagline')}</p>
        </header>

        {welcome && (
          <div class="banner">
            <strong>{t('app.name')}</strong> — {t('search.hint')}
          </div>
        )}

        {notice !== undefined && <div class="banner">{notice}</div>}

        <section class="card stack">
          <h2>{t('options.appearance')}</h2>

          <label class="stack" style="gap: 4px">
            <span>{t('options.theme')}</span>
            <select
              value={settings.theme}
              onChange={(event) =>
                void update({ theme: (event.target as HTMLSelectElement).value as ThemeSetting })
              }
            >
              <option value="system">{t('options.theme.system')}</option>
              <option value="light">{t('options.theme.light')}</option>
              <option value="dark">{t('options.theme.dark')}</option>
            </select>
          </label>

          <label class="stack" style="gap: 4px">
            <span>{t('options.language')}</span>
            <select
              value={settings.language}
              onChange={(event) =>
                void update({ language: (event.target as HTMLSelectElement).value as Language })
              }
            >
              {LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {language === 'en' ? 'English' : 'Polski'}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section class="card stack">
          <h2>{t('options.data')}</h2>

          <label class="stack" style="gap: 4px">
            <span>{t('options.dataSource')}</span>
            <select
              value={settings.dataSource}
              onChange={(event) =>
                void update({
                  dataSource: (event.target as HTMLSelectElement).value as 'live' | 'demo',
                })
              }
            >
              <option value="live">{t('options.dataSource.live')}</option>
              <option value="demo">{t('options.dataSource.demo')}</option>
            </select>
            <p class="hint">{t('options.dataSource.help')}</p>
          </label>

          <label class="stack" style="gap: 4px">
            <span>{t('options.workerUrl')}</span>
            <input
              type="text"
              class="mono"
              value={settings.workerBaseUrl}
              placeholder={DEFAULT_WORKER_URL}
              onChange={(event) =>
                void update({ workerBaseUrl: (event.target as HTMLInputElement).value })
              }
            />
            <p class="hint">{t('options.workerUrl.help')}</p>
          </label>

          <label class="row" style="gap: 8px">
            <input
              type="checkbox"
              checked={settings.historyEnabled}
              style="width: auto"
              onChange={(event) =>
                void update({ historyEnabled: (event.target as HTMLInputElement).checked })
              }
            />
            <span>{t('options.history')}</span>
          </label>
          <p class="hint">{t('options.history.help')}</p>

          <div class="row" style="gap: 12px">
            <label class="stack" style="gap: 4px; flex: 1">
              <span>{t('options.cacheTtl')}</span>
              <input
                type="number"
                min={1}
                max={168}
                value={settings.cacheTtlHours}
                onChange={(event) =>
                  void update({ cacheTtlHours: Number((event.target as HTMLInputElement).value) })
                }
              />
            </label>

            <label class="stack" style="gap: 4px; flex: 1">
              <span>{t('options.cacheMaxAge')}</span>
              <input
                type="number"
                min={1}
                max={365}
                value={settings.cacheMaxAgeDays}
                onChange={(event) =>
                  void update({ cacheMaxAgeDays: Number((event.target as HTMLInputElement).value) })
                }
              />
            </label>
          </div>
          <p class="hint">{t('options.cacheMaxAge.help')}</p>
        </section>

        <section class="card stack">
          <h2>{t('privacy.title')}</h2>
          <p class="hint">{t('privacy.body')}</p>
          <div class="row">
            <button type="button" onClick={() => void clearData()}>
              {t('options.clearData')}
            </button>
            <a href={PRIVACY_URL} target="_blank" rel="noreferrer">
              {t('privacy.readMore')}
            </a>
          </div>
          <p class="hint">{t('options.clearData.help')}</p>
        </section>

        <p class="disclaimer">{t('disclaimer')}</p>
        <p class="disclaimer">{t('attribution')}</p>
      </div>

      <AppFooter />
    </div>
  );
}
