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
const loaded = new Map();          // datasetId -> { want, body }

/** Riadky ľubovoľného datasetu z manifestu — aj mimo data/vstup. */
function readDataset(dsId) {
  if (loaded.has(dsId)) return loaded.get(dsId);
  const d = manifest.datasets?.[dsId];
  if (!d?.file) return null;
  const path = join(ROOT, d.file);
  if (!existsSync(path)) return null;
  const grid = parseCsv(readFileSync(path, 'utf8'));
  const rec = { want: grid[0].map(h => h.trim()), body: grid.slice(1) };
  loaded.set(dsId, rec);
  return rec;
}

const asNumber = v => Number(String(v).replace(/[\s ]/g, '').replace(',', '.'));

/** Súčet stĺpca cez riadky, ktoré sedia na `where`. Porovnáva sa ako text, aby
 *  „2024" v manifeste sedelo na „2024" v CSV bez ohľadu na typ. */
function sumWhere(rec, column, where = {}) {
  const ci = rec.want.indexOf(column);
  if (ci < 0) return null;
  const conds = Object.entries(where).map(([k, v]) => [rec.want.indexOf(k), String(v)]);
  if (conds.some(([i]) => i < 0)) return null;
  let sum = 0;
  for (const r of rec.body) {
    if (!conds.every(([i, v]) => (r[i] ?? '').trim() === v)) continue;
    const n = asNumber(r[ci]);
    if (Number.isFinite(n)) sum += n;
  }
  return sum;
}

function describeCheck(chk) {
  const w = Object.entries(chk.where || {}).map(([k, v]) => `${k}=${v}`).join(', ');
  const target = chk.equalsDataset
    ? `${chk.equalsDataset.dataset}.${chk.equalsDataset.column}` : chk.equals;
  return `súčet ${chk.column}${w ? ` (${w})` : ''} = ${target}`;
}

/** Vráti text chyby, alebo null keď kontrola prešla. */
function runCheck(id, chk, want, body) {
  if (chk.kind !== 'sum') return `${id}: neznámy druh kontroly "${chk.kind}"`;
  const got = sumWhere({ want, body }, chk.column, chk.where);
  if (got == null) return `${id}: kontrola sa nedá spočítať — stĺpec "${chk.column}" ` +
    `alebo filter ${JSON.stringify(chk.where)} v súbore nie je`;

  let expect = chk.equals;
  if (chk.equalsDataset) {
    const other = readDataset(chk.equalsDataset.dataset);
    if (!other) return `${id}: kontrola odkazuje na dataset "${chk.equalsDataset.dataset}", ` +
      'ktorý sa nedá prečítať';
    expect = sumWhere(other, chk.equalsDataset.column, chk.equalsDataset.where);
    if (expect == null) return `${id}: v datasete "${chk.equalsDataset.dataset}" sa kontrola ` +
      'nedá spočítať';
  }
  if (!Number.isFinite(expect)) return `${id}: kontrola nemá s čím porovnávať`;
  const tol = chk.tolerance ?? 0.01;
  const off = expect === 0 ? Math.abs(got) : Math.abs(got - expect) / Math.abs(expect);
  if (off > tol) {
    return `${id}: ${describeCheck(chk)} — v súbore je ${got.toLocaleString('sk-SK')}, ` +
      `očakáva sa ${Number(expect).toLocaleString('sk-SK')} ` +
      `(rozdiel ${(off * 100).toFixed(1)} %, povolené ${(tol * 100).toFixed(1)} %)` +
      `${chk.note ? ' — ' + chk.note : ''}`;
  }
  return null;
}

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

  // Uzavretý slovník: hodnota musí byť kód alebo jeho názov, nič iné. Bez toho
  // preklep („Muzi" namiesto „Muži") ticho vyrobí trinástu kategóriu a graf
  // stratí sériu — nič nespadne, len to bude nesprávne.
  const allowed = new Map();
  for (const [name, c] of cols) {
    const codes = c.codes || (c.codelist && manifest.dimensions?.[c.codelist]);
    if (!codes) continue;
    if (c.codelist && !manifest.dimensions?.[c.codelist]) {
      problems.push(`${id}: stĺpec "${name}" odkazuje na codelist "${c.codelist}", ktorý v manifeste nie je`);
      continue;
    }
    allowed.set(name, new Set([...Object.keys(codes), ...Object.values(codes)]));
  }

  // typy + prázdne hodnoty
  const bad = new Map();
  const empty = new Map();
  const offVocab = new Map();
  for (const r of body) {
    for (let i = 0; i < want.length; i++) {
      const type = cols[i][1].type || 'string';
      const v = (r[i] ?? '').trim();
      if (v === '') { empty.set(want[i], (empty.get(want[i]) || 0) + 1); continue; }
      if (!(TYPE_OK[type] || TYPE_OK.string)(v)) bad.set(want[i], (bad.get(want[i]) || 0) + 1);
      const ok = allowed.get(want[i]);
      if (ok && !ok.has(v)) {
        if (!offVocab.has(want[i])) offVocab.set(want[i], new Set());
        offVocab.get(want[i]).add(v);
      }
    }
  }
  for (const [c, n] of bad) problems.push(`${id}: stĺpec "${c}" má ${n} hodnôt, ktoré nie sú ${
    cols.find(x => x[0] === c)[1].type}`);
  for (const [c, n] of empty) notes.push(`${id}: stĺpec "${c}" má ${n} prázdnych hodnôt`);
  for (const [c, vals] of offVocab) {
    const codes = cols.find(x => x[0] === c)[1];
    const list = codes.codes || manifest.dimensions[codes.codelist];
    problems.push(`${id}: stĺpec "${c}" má hodnoty mimo slovníka: ` +
      `${[...vals].slice(0, 4).map(v => `"${v}"`).join(', ')}` +
      `${vals.size > 4 ? ` (+${vals.size - 4})` : ''} — povolené sú ` +
      `${Object.keys(list).join(' / ')} alebo ich názvy`);
  }

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
  loaded.set(id, { want, body });

  // Kontrolné súčty, ktoré musia platiť aj po tom, ako súbor prepíše človek.
  // Toto je jediná vec, ktorá pri ručnej výmene dát zachytí, že súbor síce má
  // správny tvar, ale nesprávne čísla — a že si dva súbory neprotirečia.
  for (const chk of def.checks || []) {
    const res = runCheck(id, chk, want, body);
    if (res) problems.push(res);
    else console.log(`   ✓ ${describeCheck(chk)}`);
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
