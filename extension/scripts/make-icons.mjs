#!/usr/bin/env node
/**
 * Generates the extension icons.
 *
 * Checked in as a script rather than hand-drawn files so the shapes are
 * reproducible and the small sizes can be tuned without redrawing anything. The
 * 16-pixel version is the one that matters — it is what a user actually sees in
 * the toolbar, and it is where most extension icons turn into mud.
 *
 * The mark is a lens **magnifying** a line of a filed document: the lens interior
 * is opaque and holds thicker rules than the page behind it. Two earlier attempts
 * failed for reasons worth recording, since both are easy to repeat:
 *
 *   - A translucent fill inside the ring reads as a solid disc at every size.
 *   - Leaving the interior empty over white paper produces a half-moon, because
 *     the ring straddles the page edge and its inside is two different colours.
 *
 * The handle is a `<line>` with a round cap rather than a rotated rectangle.
 * Rotating a rect about a chosen origin puts it somewhere slightly unintended,
 * which is how the first version ended up with the handle pointing at the wrong
 * corner.
 *
 *   node extension/scripts/make-icons.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'icon');
const tmpDir = join(here, '..', '.icon-tmp');

/** Slate ink and a blue lens — the same palette as the interface tokens. */
const INK = '#0f172a';
const LENS = '#1d4ed8';
const PAPER = '#ffffff';
const RULE = '#94a3b8';

/** A document, with a lens magnifying one of its lines. */
function detailedSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="26" fill="${INK}"/>

  <!-- The filed document, sitting high and left to leave the lens room. -->
  <rect x="26" y="18" width="58" height="72" rx="6" fill="${PAPER}"/>
  <rect x="36" y="30" width="38" height="5" rx="2.5" fill="${RULE}"/>
  <rect x="36" y="42" width="28" height="5" rx="2.5" fill="${RULE}"/>
  <rect x="36" y="54" width="34" height="5" rx="2.5" fill="${RULE}"/>

  <!-- Handle drawn before the ring so the ring's stroke covers its end and the
       two read as one object. -->
  <line x1="86" y1="86" x2="108" y2="108" stroke="${LENS}" stroke-width="14"
        stroke-linecap="round"/>

  <!-- Opaque interior, then heavier rules inside it: the lens magnifies rather
       than tints. This is what makes the mark legible. -->
  <circle cx="76" cy="76" r="28" fill="${PAPER}"/>
  <rect x="60" y="68" width="32" height="7" rx="3.5" fill="${INK}"/>
  <rect x="60" y="81" width="22" height="7" rx="3.5" fill="${INK}"/>
  <circle cx="76" cy="76" r="28" fill="none" stroke="${LENS}" stroke-width="10"/>
</svg>`;
}

/**
 * Small mark: the lens alone, heavier than proportion would suggest.
 *
 * At 16 and 32 pixels the document rules render as a grey smudge, so they go, and
 * a stroke that looks right at 128 pixels disappears at 16. A recognisable lens
 * beats an accurate miniature nobody can read.
 */
function simpleSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="26" fill="${INK}"/>
  <line x1="72" y1="72" x2="102" y2="102" stroke="${PAPER}" stroke-width="18"
        stroke-linecap="round"/>
  <circle cx="54" cy="54" r="30" fill="${INK}"/>
  <circle cx="54" cy="54" r="30" fill="none" stroke="${PAPER}" stroke-width="16"/>
</svg>`;
}

const SIZES = [16, 32, 48, 96, 128];

rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(tmpDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

for (const size of SIZES) {
  const svg = size <= 32 ? simpleSvg(size) : detailedSvg(size);
  const svgPath = join(tmpDir, `icon-${size}.svg`);
  writeFileSync(svgPath, svg);

  execFileSync('convert', [
    '-background',
    'none',
    '-density',
    '512',
    svgPath,
    '-resize',
    `${size}x${size}`,
    join(outDir, `${size}.png`),
  ]);

  console.log(`  ${size}.png`);
}

rmSync(tmpDir, { recursive: true, force: true });
console.log(`Wrote ${SIZES.length} icons to ${outDir}`);
