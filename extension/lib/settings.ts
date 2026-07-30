/**
 * Settings, with a versioned migration chain.
 *
 * The reference project merges defaults on read — `{...defaults, ...stored}` —
 * which is fine until it is not. That pattern can add a field but can never
 * rename, reshape or remove one, and it silently resurrects a field the user
 * deliberately cleared. Both matter here, because settings hold the worker URL
 * and the cache policy, and getting either wrong is a support conversation about
 * why the extension is talking to the wrong host.
 *
 * Pure, and never throws. Bad stored data is an inconvenience, not a reason for a
 * blank options page.
 */

export const SETTINGS_SCHEMA_VERSION = 1;

export const DEFAULT_WORKER_URL = 'https://api.ltdlens.uk';

export type Language = 'en' | 'pl';
export type ThemeSetting = 'system' | 'light' | 'dark';
export type DataSource = 'live' | 'demo';

export interface Settings {
  schemaVersion: number;
  language: Language;
  theme: ThemeSetting;
  /**
   * `demo` serves bundled fixtures instead of calling the network. It exists for
   * three reasons: a Chrome Web Store reviewer can see a working report without
   * being handed credentials, onboarding can show a real report rather than a
   * screenshot that will go stale, and when the lookup service is unreachable the
   * extension degrades to something rather than nothing.
   */
  dataSource: DataSource;
  workerBaseUrl: string;
  cacheTtlHours: number;
  cacheMaxAgeDays: number;
  historyEnabled: boolean;
  historyLimit: number;
}

export function defaultSettings(): Settings {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    language: 'en',
    theme: 'system',
    dataSource: 'live',
    workerBaseUrl: DEFAULT_WORKER_URL,
    cacheTtlHours: 12,
    cacheMaxAgeDays: 30,
    historyEnabled: true,
    historyLimit: 20,
  };
}

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * Keyed by the version being migrated **from**.
 *
 * Empty at v1 — there is nothing older yet. Present so the first migration is an
 * entry in a chain that already works rather than a mechanism invented in a hurry
 * when it is first needed.
 */
export const MIGRATIONS: Record<number, Migration> = {};

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * A worker URL is only accepted if it is a plausible origin.
 *
 * Anything else falls back to the default rather than leaving the extension
 * pointed at nothing — a typo in this field would otherwise look exactly like the
 * lookup service being down.
 */
function workerUrl(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+$/.test(trimmed)) return fallback;
  return trimmed;
}

/**
 * Normalises whatever was in storage into valid settings.
 *
 * Unknown keys are dropped, out-of-range numbers are clamped, and a **newer**
 * stored schema falls back to defaults rather than guessing at a shape from the
 * future — which happens whenever someone runs an older build after a newer one,
 * and is far better than half-reading a structure this code does not understand.
 */
export function migrateSettings(raw: unknown): Settings {
  const defaults = defaultSettings();
  if (typeof raw !== 'object' || raw === null) return defaults;

  let working = { ...(raw as Record<string, unknown>) };

  // Anything stored before versioning existed is treated as version 0.
  let version = typeof working.schemaVersion === 'number' ? working.schemaVersion : 0;

  if (version > SETTINGS_SCHEMA_VERSION) return defaults;

  while (version < SETTINGS_SCHEMA_VERSION) {
    const migration = MIGRATIONS[version];
    if (migration === undefined) break;
    working = migration(working);
    version += 1;
  }

  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    language: oneOf(working.language, ['en', 'pl'] as const, defaults.language),
    theme: oneOf(working.theme, ['system', 'light', 'dark'] as const, defaults.theme),
    dataSource: oneOf(working.dataSource, ['live', 'demo'] as const, defaults.dataSource),
    workerBaseUrl: workerUrl(working.workerBaseUrl, defaults.workerBaseUrl),
    cacheTtlHours: clamp(working.cacheTtlHours, 1, 168, defaults.cacheTtlHours),
    cacheMaxAgeDays: clamp(working.cacheMaxAgeDays, 1, 365, defaults.cacheMaxAgeDays),
    historyEnabled:
      typeof working.historyEnabled === 'boolean'
        ? working.historyEnabled
        : defaults.historyEnabled,
    historyLimit: clamp(working.historyLimit, 0, 100, defaults.historyLimit),
  };
}

/** True when the stored blob differs from the normalised result and should be rewritten. */
export function needsRewrite(raw: unknown, migrated: Settings): boolean {
  if (typeof raw !== 'object' || raw === null) return true;
  const stored = raw as Record<string, unknown>;
  if (stored.schemaVersion !== migrated.schemaVersion) return true;
  return Object.entries(migrated).some(([key, value]) => stored[key] !== value);
}
