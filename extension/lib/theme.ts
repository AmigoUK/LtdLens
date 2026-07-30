/**
 * Theme resolution. Pure; applying it to the document is `platform/theme.ts`.
 */

import type { ThemeSetting } from './settings.js';

export type ResolvedTheme = 'light' | 'dark';

export function resolveTheme(setting: ThemeSetting, prefersDark: boolean): ResolvedTheme {
  if (setting === 'light') return 'light';
  if (setting === 'dark') return 'dark';
  return prefersDark ? 'dark' : 'light';
}
