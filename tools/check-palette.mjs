#!/usr/bin/env node
// check-palette.mjs — re-run the accessibility gates on the palette in lib/theme.js.
//
// The point of running this in CI is that the palette is a *derived* artefact: the
// hexes in theme.js are RRZ brand hues snapped to passing OKLCH steps. Anyone can
// "fix" a colour by eye and silently break colourblind separation or contrast, and
// nothing on screen would look obviously wrong. This turns that into a red build.
//
// Gates (OKLab ΔE ×100; Machado-Oliveira-Fernandes 2009 CVD sim at severity 1.0):
//   lightness band · chroma floor · adjacent CVD ΔE >= 8 · normal-vision ΔE >= 15
//   · contrast >= 3:1 vs the mode's own surface
// Plus: the ordinal ramp is checked as a ramp, and the all-pairs cap is asserted,
// because a scatter/bubble form can put any two slots side by side.
//
// Usage: node tools/check-palette.mjs

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, validateOrdinal } from './validate_palette.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'lib', 'theme.js'), 'utf8');

/** Pull an array of hexes out of theme.js by key, per mode block. */
function grab(mode, key) {
  const block = src.split(`  ${mode}: {`)[1];
  if (!block) throw new Error(`theme.js: nenašiel sa blok "${mode}"`);
  const m = block.match(new RegExp(`${key}:\\s*\\[([^\\]]+)\\]`));
  if (!m) throw new Error(`theme.js: v bloku "${mode}" chýba "${key}"`);
  return m[1].match(/#[0-9a-fA-F]{6}/g) || [];
}
function grabScalar(mode, key) {
  const block = src.split(`  ${mode}: {`)[1];
  const m = block.match(new RegExp(`${key}:\\s*'(#[0-9a-fA-F]{6})'`));
  return m ? m[1] : null;
}

// The all-pairs cap: how many leading slots may appear in a scatter/bubble/map.
const ALL_PAIRS_CAP = 3;

let failed = false;
const capCouldRise = [];

// House rule, stricter than the generic gate. In the generic method a sub-3:1 fill
// is a WARN that merely obligates a relief channel (visible labels or a table
// view). Here it is a hard failure, because this palette was snapped so that every
// slot clears 3:1 against its own surface — so a slot dropping below it can only
// mean someone re-picked a colour by eye. Without this, pasting the raw brand blue
// #13B5EA back into the light series (2.1:1 on white) passes silently.
const STRICT_CONTRAST = true;

const report = (label, r) => {
  console.log(`\n${label}`);
  let bad = 0;
  for (const [check, st, detail] of r.report) {
    const isFail = st === false || st === 'fail'
      || (STRICT_CONTRAST && st === 'relief' && String(check).startsWith('Contrast'));
    const tag = isFail ? 'FAIL'
      : (st === true || st === 'pass') ? 'PASS' : 'WARN';
    console.log(`  [${tag}] ${String(check).padEnd(22)} ${detail}` +
      (isFail && st === 'relief' ? '  ← domáce pravidlo: v tomto projekte je < 3:1 chyba' : ''));
    if (isFail) bad++;
  }
  if (bad) failed = true;
};

for (const mode of ['light', 'dark']) {
  const surface = grabScalar(mode, 'surface');
  const series = grab(mode, 'series');
  const ordinal = grab(mode, 'ordinal');

  console.log(`\n${'='.repeat(70)}\n${mode.toUpperCase()} — surface ${surface}, ${series.length} kategorických slotov`);

  // adjacent pairlist: stacks, bars, lines
  report(`categorical, adjacent (${series.length} slotov)`,
    validate(series, { mode, surface }));

  // all-pairs: scatter/bubble/small multiples — assert the documented cap holds…
  const capped = validate(series.slice(0, ALL_PAIRS_CAP), { mode, surface, pairs: 'all' });
  report(`categorical, all-pairs (prvé ${ALL_PAIRS_CAP} sloty — limit pre bodové grafy)`, capped);

  // …and note whether it is understated. The cap may only rise if the extra slot
  // passes in BOTH modes — reporting it per mode would invite raising the cap on
  // the strength of the looser one.
  if (series.length > ALL_PAIRS_CAP) {
    const next = validate(series.slice(0, ALL_PAIRS_CAP + 1), { mode, surface, pairs: 'all' });
    if (next.ok) capCouldRise.push(mode);
  }

  report('ordinal ramp', validateOrdinal(ordinal, { mode, surface }));
}

console.log(`\n${'='.repeat(70)}`);
if (failed) {
  console.error('PALETA NEPREŠLA — oprav označené kontroly v lib/theme.js.');
  console.error('Postup: drž značkový hue, hýb len OKLCH svetlosťou/chromou (snap-to-passing).');
  process.exit(1);
}
console.log('Paleta prešla všetkými kontrolami v oboch režimoch.');
console.log('WARN = povolené len so sekundárnym kódovaním (priame štítky, medzery, tabuľka).');

if (capCouldRise.length === 2) {
  console.log(`\nNOTE  ${ALL_PAIRS_CAP + 1}. slot prejde all-pairs v oboch režimoch —` +
    ` limit sa dá zvýšiť (scatter v charts2d.js, scatter3d v charts3d.js).`);
} else if (capCouldRise.length === 1) {
  console.log(`\nNOTE  ${ALL_PAIRS_CAP + 1}. slot prejde all-pairs len v režime "${capCouldRise[0]}",` +
    ` v druhom nie — limit ${ALL_PAIRS_CAP} zostáva správny (platí prísnejší režim).`);
}
