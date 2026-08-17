#!/usr/bin/env node
// validate-manifest.mjs — fail the build before a broken page reaches the web.
//
// This exists because of a concrete failure: the published DYNAMIC_PYRAMID_WEB
// repository does not run. Its filenames and contents are shuffled (plot.js holds
// the model, worker.js holds the CSS, index.html holds the JSON data), worker.js
// is missing entirely, and index.html fetches data/anchors.json — a path that is
// not in the repository. Nothing caught it, because nothing checked that the
// files a page loads actually exist.
//
// So this script asserts:
//   1. every referenced file exists on disk
//   2. every <script>/<link>/import path in the HTML and JS resolves
//   3. every dataset a view names is declared, and every column it uses is in the CSV
//   4. every view a page lists exists, and no view is orphaned
//   5. required keys per chart type are present
//   6. every dataset declares provenance (source or an explicit illustrative flag)
//
// Usage: node tools/validate-manifest.mjs

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const warnings = [];
const err = m => errors.push(m);
const warn = m => warnings.push(m);

// ── required keys per view type ──────────────────────────────────────────────
const REQUIRED = {
  line:            ['dataset', 'x', 'y'],
  area:            ['dataset', 'x', 'y'],
  'area-stacked':  ['dataset', 'x', 'y', 'series'],
  column:          ['dataset', 'x', 'y'],
  bar:             ['dataset', 'x', 'y'],
  'bar-stacked':   ['dataset', 'x', 'y', 'series'],
  'bar-stacked-h': ['dataset', 'x', 'y', 'series'],
  'bar-grouped':   ['dataset', 'x', 'y', 'series'],
  scatter:         ['dataset', 'x', 'y'],
  heatmap:         ['dataset', 'x', 'y', 'value'],
  pyramid:         ['dataset', 'y', 'value', 'series'],
  waterfall:       ['dataset', 'x', 'y'],
  surface3d:       ['dataset', 'x', 'y', 'z'],
  scatter3d:       ['dataset', 'x', 'y', 'z'],
  tiles:           ['tiles'],
  table:           ['dataset'],
};

// Keys whose value must name a real column in the view's dataset.
const COLUMN_KEYS = ['x', 'y', 'z', 'value', 'series', 'label', 'totalFlag'];

// ── 1. manifest parses ──────────────────────────────────────────────────────
const manifestPath = join(ROOT, 'data', 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error('FATAL: data/manifest.json chýba');
  process.exit(1);
}
let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (e) {
  console.error(`FATAL: data/manifest.json nie je platný JSON — ${e.message}`);
  process.exit(1);
}

// ── 2. datasets: file exists, header matches declared columns ───────────────
const headers = {};      // datasetId -> Set(column names)

for (const [id, def] of Object.entries(manifest.datasets || {})) {
  if (!def.file) { err(`dataset "${id}": chýba "file"`); continue; }
  const p = join(ROOT, def.file);
  if (!existsSync(p)) { err(`dataset "${id}": súbor ${def.file} neexistuje`); continue; }

  const text = readFileSync(p, 'utf8').replace(/^﻿/, '');
  if (!text.trim()) { err(`dataset "${id}": ${def.file} je prázdny`); continue; }

  let cols;
  if (def.file.endsWith('.json')) {
    try {
      const json = JSON.parse(text);
      const rows = Array.isArray(json) ? json : json.rows;
      if (!Array.isArray(rows) || !rows.length) throw new Error('žiadne riadky');
      cols = Object.keys(rows[0]);
    } catch (e) { err(`dataset "${id}": ${def.file} — ${e.message}`); continue; }
  } else {
    const first = text.split('\n')[0];
    const delim = def.file.endsWith('.tsv') ? '\t' : ',';
    cols = first.split(delim).map(s => s.trim().replace(/^"|"$/g, ''));
    // every data row must have the same field count as the header
    const lines = text.trimEnd().split('\n');
    const bad = lines.findIndex((l, i) => i > 0 && l.split(delim).length !== cols.length);
    if (bad > 0) err(`dataset "${id}": ${def.file} riadok ${bad + 1} má iný počet stĺpcov než hlavička`);
  }
  headers[id] = new Set(cols);

  for (const name of Object.keys(def.columns || {})) {
    if (!headers[id].has(name))
      err(`dataset "${id}": manifest deklaruje stĺpec "${name}", v ${def.file} nie je (má: ${[...headers[id]].join(', ')})`);
  }
  // provenance is not optional for a public statistics page
  if (!def.source && def.illustrative !== true)
    err(`dataset "${id}": chýba "source" — alebo ho označ "illustrative": true`);
  if (!def.unit) warn(`dataset "${id}": chýba "unit", formátovanie čísel padne na predvolené`);
}

// ── 3. views: required keys, real dataset, real columns ─────────────────────
const views = manifest.views || {};
for (const [id, v] of Object.entries(views)) {
  if (!v.type) { err(`view "${id}": chýba "type"`); continue; }
  const req = REQUIRED[v.type];
  if (!req) { err(`view "${id}": neznámy typ "${v.type}" (známe: ${Object.keys(REQUIRED).join(', ')})`); continue; }
  for (const key of req) if (v[key] == null) err(`view "${id}" (${v.type}): chýba povinný kľúč "${key}"`);

  if (!v.title) warn(`view "${id}": chýba "title"`);
  if (!v.dataset) continue;
  if (!manifest.datasets?.[v.dataset]) { err(`view "${id}": dataset "${v.dataset}" nie je v manifeste`); continue; }
  const cols = headers[v.dataset];
  if (!cols) continue;

  // Columns produced by a transform are legal even though they are not in the CSV.
  const produced = new Set();
  for (const t of v.transform || []) {
    if (t.into) produced.add(t.into);
    if (t.kind === 'unpivot') { produced.add(t.into || 'kategoria'); produced.add(t.value || 'hodnota'); }
    if (t.kind === 'aggregate') produced.add(t.into || t.value);
    if (t.kind === 'index') produced.add(t.into || t.value);
    if (t.kind === 'pivot' && t.key) produced.add('*');   // pivot column names are data-dependent
  }
  const known = c => cols.has(c) || produced.has(c) || produced.has('*');

  for (const key of COLUMN_KEYS) {
    const c = v[key];
    if (typeof c === 'string' && !known(c))
      err(`view "${id}": ${key}="${c}" nie je stĺpec datasetu "${v.dataset}" (má: ${[...cols].join(', ')})`);
  }
  for (const c of v.tableColumns || []) {
    if (!known(c)) err(`view "${id}": tableColumns obsahuje "${c}", ktorý v datasete "${v.dataset}" nie je`);
  }
  for (const t of v.transform || []) {
    for (const c of Object.keys(t.where || {})) {
      if (!known(c)) err(`view "${id}": transform filtruje podľa "${c}", ktorý v datasete "${v.dataset}" nie je`);
    }
  }
  for (const tile of v.tiles || []) {
    if (tile.value && !known(tile.value))
      err(`view "${id}": tile "${tile.label}" používa "${tile.value}", ktorý v datasete "${v.dataset}" nie je`);
    if (!tile.label) err(`view "${id}": tile bez "label"`);
  }
}

// ── 4. pages reference real views; no orphans ──────────────────────────────
const used = new Set();
for (const page of manifest.pages || []) {
  if (!page.id) err('page bez "id"');
  if (!page.label) warn(`page "${page.id}": chýba "label"`);
  if (!page.views?.length) err(`page "${page.id}": žiadne views`);
  for (const vid of page.views || []) {
    if (!views[vid]) err(`page "${page.id}": view "${vid}" nie je v manifeste`);
    used.add(vid);
  }
  for (const f of page.filters || []) {
    if (!f.column) err(`page "${page.id}": filter bez "column"`);
    if (f.dataset && !manifest.datasets?.[f.dataset])
      err(`page "${page.id}": filter odkazuje na neexistujúci dataset "${f.dataset}"`);
    if (f.dataset && headers[f.dataset] && f.column && !headers[f.dataset].has(f.column))
      err(`page "${page.id}": filter podľa "${f.column}", ktorý v datasete "${f.dataset}" nie je`);
  }
}
for (const id of Object.keys(views)) if (!used.has(id)) warn(`view "${id}" nie je na žiadnej stránke`);

const ids = (manifest.pages || []).map(p => p.id);
const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
if (dupes.length) err(`duplicitné page id: ${[...new Set(dupes)].join(', ')}`);

// ── 5. every asset the HTML and the modules load actually exists ────────────
// This is the check that would have caught the shuffled-filenames failure.
function checkAssetRefs(file, patterns) {
  if (!existsSync(join(ROOT, file))) { err(`${file} neexistuje`); return; }
  const text = readFileSync(join(ROOT, file), 'utf8');
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const ref = m[1];
      if (/^(https?:)?\/\//.test(ref) || ref.startsWith('data:') || ref.startsWith('#')) continue;
      const target = ref.startsWith('.')
        ? resolvePath(join(ROOT, dirname(file)), ref)
        : join(ROOT, ref);
      if (!existsSync(target)) err(`${file}: odkazuje na "${ref}", ktorý neexistuje`);
    }
  }
}

checkAssetRefs('index.html', [
  /<script[^>]+src="([^"]+)"/g,
  /<link[^>]+href="([^"]+)"/g,
]);

const IMPORT_RE = [
  /(?:^|\s)import\s[^'"]*from\s*['"]([^'"]+)['"]/gm,
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];
for (const f of ['app.js', ...readdirSync(join(ROOT, 'lib')).filter(f => f.endsWith('.js')).map(f => 'lib/' + f)]) {
  checkAssetRefs(f, IMPORT_RE);
}

// The lazily-loaded 3D bundle is a string, not an import — check it by name.
{
  const src = readFileSync(join(ROOT, 'lib', 'charts3d.js'), 'utf8');
  const m = src.match(/const SRC\s*=\s*['"]([^'"]+)['"]/);
  if (!m) err('lib/charts3d.js: nenašiel sa SRC pre Plotly bundle');
  else if (!existsSync(join(ROOT, m[1]))) err(`lib/charts3d.js: SRC "${m[1]}" neexistuje`);
}

// ── report ─────────────────────────────────────────────────────────────────
const datasetCount = Object.keys(manifest.datasets || {}).length;
const viewCount = Object.keys(views).length;
const pageCount = (manifest.pages || []).length;

for (const w of warnings) console.warn(`  WARN  ${w}`);
for (const e of errors) console.error(`  FAIL  ${e}`);

console.log(`\nmanifest: ${pageCount} stránok, ${viewCount} views, ${datasetCount} datasetov` +
  ` — ${errors.length} chýb, ${warnings.length} upozornení`);

process.exit(errors.length ? 1 : 0);
