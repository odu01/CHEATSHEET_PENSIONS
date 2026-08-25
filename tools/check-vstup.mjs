#!/usr/bin/env node
// check-vstup.mjs — čo treba naplniť, čo je naplnené a či to sedí.
//
// Toto je hlavný nástroj rámca na dopĺňanie dát. Manifest je kontrakt, ale
// kontrakt sa musí dať prečítať bez čítania JSON-u a hlavne sa musí dať overiť
// PO tom, ako do súboru niekto nahrá reálne čísla. Skript preto:
//
//   1. vypíše každý vstupný súbor: stĺpce, typy, jednotku, počet riadkov,
//      pokrytie rozmerov (roky, pohlavia, kategórie) a či ide o syntetické dáta,
//   2. overí, že súbor sedí na kontrakt: hlavička, typy, prázdne hodnoty,
//      duplicitné kľúče, dieri v rozmeroch,
//   3. pri --sablona <dataset> vypíše prázdnu hlavičku na skopírovanie.
//
// Usage: node tools/check-vstup.mjs [--strict] [--sablona <dataset>]
//        --strict  urobí z upozornení chybu (používa CI)

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const STRICT = args.includes('--strict');
const WANT_TEMPLATE = args.includes('--sablona') ? args[args.indexOf('--sablona') + 1] : null;

const manifest = JSON.parse(readFileSync(join(ROOT, 'data', 'manifest.json'), 'utf8'));

/** Vstupné datasety = tie, ktoré ležia v data/vstup/. Zvyšok sa generuje z
 *  zošitov SP a ručne sa do nich nesiaha. */
const inputs = Object.entries(manifest.datasets)
  .filter(([, d]) => (d.file || '').startsWith('data/vstup/'));

if (WANT_TEMPLATE) {
  const hit = inputs.find(([id]) => id === WANT_TEMPLATE);
  if (!hit) {
    console.error(`Dataset "${WANT_TEMPLATE}" nie je vstupný. Sú to: ` +
      inputs.map(([id]) => id).join(', '));
    process.exit(2);
  }
  console.log(Object.keys(hit[1].columns || {}).join(','));
  process.exit(0);
}

// ── parsovanie CSV: rovnaké pravidlá ako lib/data.js ─────────────────────────
function parseCsv(text) {
  const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  const delim = (clean.split('\n')[0].match(/\t/g) || []).length ? '\t' : ',';
  const rows = [];
  let field = '', row = [], quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  row.push(field);
  rows.push(row);
  return rows;
}

const TYPE_OK = {
  int: v => /^-?\d+$/.test(v),
  number: v => /^-?\d+([.,]\d+)?([eE][-+]?\d+)?$/.test(v),
  year: v => /^\d{4}$/.test(v),
  month: v => /^\d{4}-\d{1,2}(-\d{1,2})?$/.test(v),
  date: v => !Number.isNaN(Date.parse(v)),
  bool: v => /^(true|false|1|0|ano|nie)$/i.test(v),
  string: () => true,
};

const problems = [];
const notes = [];

console.log('Vstupné súbory (data/vstup/) — čo web číta a čo treba naplniť\n');

for (const [id, def] of inputs) {
  const rel = def.file;
  const path = join(ROOT, rel);
  const cols = Object.entries(def.columns || {});
  const synthetic = !!def.illustrative;

  console.log(`── ${id} ${synthetic ? '· SYNTETICKÉ' : '· reálne dáta'}`);
  console.log(`   súbor:    ${rel}`);
  console.log(`   ukazuje:  ${def.label || '—'}${def.unit ? `  [${def.unit}]` : ''}`);

  if (!existsSync(path)) {
    problems.push(`${id}: súbor ${rel} neexistuje`);
    console.log('   CHÝBA\n');
    continue;
  }

  const rows = parseCsv(readFileSync(path, 'utf8'));
  const header = rows[0].map(h => h.trim());
  const body = rows.slice(1).filter(r => r.some(v => v.trim() !== ''));

  const want = cols.map(([n]) => n);
  if (header.join(',') !== want.join(',')) {
    problems.push(`${id}: hlavička je "${header.join(',')}", kontrakt žiada "${want.join(',')}"`);
  }

  // typy + prázdne hodnoty
  const bad = new Map();
  const empty = new Map();
  for (const r of body) {
    for (let i = 0; i < want.length; i++) {
      const type = cols[i][1].type || 'string';
      const v = (r[i] ?? '').trim();
      if (v === '') { empty.set(want[i], (empty.get(want[i]) || 0) + 1); continue; }
      if (!(TYPE_OK[type] || TYPE_OK.string)(v)) bad.set(want[i], (bad.get(want[i]) || 0) + 1);
    }
  }
  for (const [c, n] of bad) problems.push(`${id}: stĺpec "${c}" má ${n} hodnôt, ktoré nie sú ${
    cols.find(x => x[0] === c)[1].type}`);
  for (const [c, n] of empty) notes.push(`${id}: stĺpec "${c}" má ${n} prázdnych hodnôt`);

  // Rozmer vs. miera. Typ na to nestačí — počet osôb aj vek sú "int", ale vek
  // identifikuje riadok a počet je meraná hodnota. Preto to manifest hovorí
  // priamo: "number" je vždy miera, "int" len keď má measure: true.
  const isMeasure = (i) => {
    const c = cols[i][1];
    return c.measure === true || (c.type || 'string') === 'number';
  };
  const dims = want.filter((n, i) => !isMeasure(i));
  const keyCols = dims.length && dims.length < want.length ? dims : want;
  const seen = new Map();
  for (const r of body) {
    const k = keyCols.map(n => r[want.indexOf(n)]).join('|');
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  const dupes = [...seen.entries()].filter(([, n]) => n > 1);
  if (dupes.length)
    problems.push(`${id}: ${dupes.length} duplicitných kombinácií (${keyCols.join(' × ')}), ` +
      `napr. "${dupes[0][0]}"`);

  console.log(`   riadky:   ${body.length}`);
  console.log(`   stĺpce:   ${cols.map(([n, c]) => `${n} (${c.type || 'string'})`).join(', ')}`);

  // Pokrytie: čo v rozmere je. Pri krátkom zozname všetky hodnoty, pri dlhom
  // rozsah — a pri číselnom rade aj to, koľko hodnôt v ňom chýba. Dieru v rade
  // rokov alebo vekov inak nikto nevidí, kým sa graf nezačne správať čudne.
  for (const d of dims) {
    const vals = [...new Set(body.map(r => r[want.indexOf(d)]))];
    if (vals.length <= 12) { console.log(`   ${d}: ${vals.join(', ')}`); continue; }
    const nums = vals.map(Number).filter(n => Number.isFinite(n));
    if (nums.length === vals.length) {
      const gaps = Math.max(...nums) - Math.min(...nums) + 1 - vals.length;
      console.log(`   ${d}: ${Math.min(...nums)} … ${Math.max(...nums)}` +
        (gaps > 0 ? `  (v rade chýba ${gaps} hodnôt)` : '  (rad je celý)'));
    } else {
      const sorted = [...vals].sort();
      console.log(`   ${d}: ${sorted[0]} … ${sorted[sorted.length - 1]}  (${vals.length} hodnôt)`);
    }
  }
  if (synthetic) {
    console.log('   → nahradiť reálnymi: prepíš hodnoty (hlavička zostáva), potom v manifeste');
    console.log('     zmaž "illustrative" a "badge" a doplň "source" a "vintage"');
  }
  for (const [c] of cols) {
    const lbl = def.columns[c].label;
    if (lbl) console.log(`     ${c.padEnd(22)} ${lbl}`);
  }
  console.log('');
}

const synth = inputs.filter(([, d]) => d.illustrative).length;
console.log(`${inputs.length} vstupných súborov, z toho ${synth} so syntetickými dátami.`);

if (notes.length) {
  console.log('\nUpozornenia:');
  for (const n of notes) console.log('  ' + n);
}
if (problems.length) {
  console.error('\nChyby:');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
if (STRICT && notes.length) process.exit(1);
console.log('\nVšetky vstupné súbory sedia na kontrakt v manifeste.');
