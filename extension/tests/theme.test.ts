import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveTheme } from '../lib/theme.js';

describe('resolveTheme', () => {
  it('follows the system only when asked to', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

/**
 * Contrast is a product requirement here, not a nicety: the severity colours are
 * how this interface communicates the one thing it exists to communicate. The
 * ratios are computed from the stylesheet itself, so a future palette tweak cannot
 * quietly break them.
 */
describe('severity colour contrast', () => {
  const css = readFileSync(fileURLToPath(new URL('../assets/ui.css', import.meta.url)), 'utf8');

  /** Reads a `--token: #hex;` declaration from a given block of the stylesheet. */
  function tokens(blockStart: string): Record<string, string> {
    const start = css.indexOf(blockStart);
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf('}', start));
    const found: Record<string, string> = {};
    for (const match of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) {
      found[match[1]!] = match[2]!;
    }
    return found;
  }

  function luminance(hex: string): number {
    const channel = (value: number): number => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const r = channel(parseInt(hex.slice(1, 3), 16));
    const g = channel(parseInt(hex.slice(3, 5), 16));
    const b = channel(parseInt(hex.slice(5, 7), 16));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function ratio(a: string, b: string): number {
    const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (lighter! + 0.05) / (darker! + 0.05);
  }

  const PAIRS = ['red', 'amber', 'green', 'info'] as const;

  it('clears 4.5:1 in the light palette', () => {
    const light = tokens(':root {');
    for (const name of PAIRS) {
      const text = light[name];
      const background = light[`${name}-bg`];
      expect(text, `--${name} missing`).toBeDefined();
      expect(background, `--${name}-bg missing`).toBeDefined();
      expect(ratio(text!, background!), `${name} in light`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('clears 4.5:1 in the dark palette', () => {
    const dark = tokens(":root[data-theme='dark'] {");
    for (const name of PAIRS) {
      expect(ratio(dark[name]!, dark[`${name}-bg`]!), `${name} in dark`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it('keeps body text readable in both palettes', () => {
    const light = tokens(':root {');
    const dark = tokens(":root[data-theme='dark'] {");
    expect(ratio(light.text!, light.bg!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(dark.text!, dark.bg!)).toBeGreaterThanOrEqual(4.5);
    // Muted and faint are still text somebody has to read, and `faint` is used at
    // 12px where it matters most. Both currently sit close to the line — 4.76 and
    // 4.79 in the light palette — so they are asserted rather than assumed.
    for (const token of ['muted', 'faint', 'accent'] as const) {
      expect(ratio(light[token]!, light.bg!), `${token} in light`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(dark[token]!, dark.bg!), `${token} in dark`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
