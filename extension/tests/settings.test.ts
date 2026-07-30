import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKER_URL,
  SETTINGS_SCHEMA_VERSION,
  defaultSettings,
  migrateSettings,
  needsRewrite,
} from '../lib/settings.js';

describe('migrateSettings', () => {
  it('returns defaults for anything unusable', () => {
    for (const raw of [undefined, null, 'settings', 42, []]) {
      expect(migrateSettings(raw)).toEqual(defaultSettings());
    }
  });

  it('treats a blob written before versioning as version 0', () => {
    const migrated = migrateSettings({ theme: 'dark', historyEnabled: false });
    expect(migrated.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
    expect(migrated.theme).toBe('dark');
    expect(migrated.historyEnabled).toBe(false);
  });

  it('falls back to defaults for a schema from the future', () => {
    // Happens whenever somebody runs an older build after a newer one. Guessing at
    // a shape this code has never seen is worse than starting clean.
    const migrated = migrateSettings({ schemaVersion: 99, theme: 'dark' });
    expect(migrated).toEqual(defaultSettings());
  });

  it('drops unknown keys rather than carrying them forever', () => {
    const migrated = migrateSettings({ schemaVersion: 1, somethingRemoved: 'yes' });
    expect(migrated).not.toHaveProperty('somethingRemoved');
  });

  it('rejects invalid enum values instead of storing them', () => {
    const migrated = migrateSettings({
      schemaVersion: 1,
      theme: 'neon',
      language: 'de',
      dataSource: 'guess',
    });
    expect(migrated.theme).toBe('system');
    expect(migrated.language).toBe('en');
    expect(migrated.dataSource).toBe('live');
  });

  it('clamps numbers to a usable range', () => {
    const low = migrateSettings({ schemaVersion: 1, cacheTtlHours: 0, cacheMaxAgeDays: -5 });
    expect(low.cacheTtlHours).toBe(1);
    expect(low.cacheMaxAgeDays).toBe(1);

    const high = migrateSettings({ schemaVersion: 1, cacheTtlHours: 9999, historyLimit: 500 });
    expect(high.cacheTtlHours).toBe(168);
    expect(high.historyLimit).toBe(100);
  });

  it('rounds a fractional number rather than storing it', () => {
    expect(migrateSettings({ schemaVersion: 1, cacheTtlHours: 12.7 }).cacheTtlHours).toBe(13);
  });

  it('ignores a number that is not one', () => {
    for (const value of [NaN, Infinity, '12', null]) {
      expect(migrateSettings({ schemaVersion: 1, cacheTtlHours: value }).cacheTtlHours).toBe(12);
    }
  });

  it('accepts a plausible worker origin and strips a trailing slash', () => {
    expect(
      migrateSettings({ schemaVersion: 1, workerBaseUrl: 'http://localhost:8787/' }).workerBaseUrl,
    ).toBe('http://localhost:8787');
  });

  it('rejects a worker URL that could not work', () => {
    // A typo here would look exactly like the lookup service being down, which is
    // a support conversation nobody enjoys.
    for (const value of ['not a url', 'ftp://x', '', 'https://', 42, undefined]) {
      expect(migrateSettings({ schemaVersion: 1, workerBaseUrl: value }).workerBaseUrl).toBe(
        DEFAULT_WORKER_URL,
      );
    }
  });

  it('keeps historyEnabled false rather than resurrecting the default', () => {
    // The failure mode of a defaults-merge: a user switches something off and it
    // comes back on by itself.
    expect(migrateSettings({ schemaVersion: 1, historyEnabled: false }).historyEnabled).toBe(false);
  });

  it('never throws', () => {
    const nasty = { schemaVersion: 'one', theme: { nested: true }, historyLimit: [] };
    expect(() => migrateSettings(nasty)).not.toThrow();
  });
});

describe('needsRewrite', () => {
  it('is true for anything that was not already normalised', () => {
    expect(needsRewrite(undefined, defaultSettings())).toBe(true);
    expect(needsRewrite({}, defaultSettings())).toBe(true);
    expect(needsRewrite({ schemaVersion: 0 }, defaultSettings())).toBe(true);
  });

  it('is false when storage already holds exactly the migrated result', () => {
    const settings = defaultSettings();
    expect(needsRewrite({ ...settings }, settings)).toBe(false);
  });

  it('is true when one field differs', () => {
    const settings = defaultSettings();
    expect(needsRewrite({ ...settings, theme: 'dark' }, settings)).toBe(true);
  });
});
