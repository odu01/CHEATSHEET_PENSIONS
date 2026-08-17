#!/usr/bin/env node
// make-sample-data.mjs — regenerate the ILLUSTRATIVE sample datasets.
//
// Everything this script writes is synthetic. The numbers are plausible in order
// of magnitude and internally consistent, so the charts read like real output,
// but they are NOT official statistics and must not be quoted. Each generated
// file carries `illustrative: true` in the manifest, which puts a visible badge
// on every card that uses it — replace the file with real data and flip the flag.
//
// The one exception is vekova_struktura_2024.csv, which carries over the 2024
// age structure from the RRZ population simulator (Eurostat/UN based).
//
// Deterministic on purpose: a fixed-seed LCG, so re-running produces byte-identical
// files and a diff only ever shows a real change.
//
// Usage: node tools/make-sample-data.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data');
mkdirSync(OUT, { recursive: true });

// deterministic pseudo-random in [-1, 1]
let seed = 20240817;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed / 0x7fffffff) * 2 - 1; };
const r2 = v => Math.round(v * 100) / 100;
const r1 = v => Math.round(v * 10) / 10;

function write(name, header, rows) {
  const body = rows.map(r => r.join(',')).join('\n');
  writeFileSync(join(OUT, name), header.join(',') + '\n' + body + '\n', 'utf8');
  console.log(`  ${name.padEnd(34)} ${rows.length} riadkov`);
}

console.log('Generujem ilustračné dátové sady:');

// ── 1. age structure 2024 — carried over from the population simulator ───────
// Per-single-year values from that project's anchors.json; each 5-year band there
// holds the band average repeated 5x, so a band total is value x 5.
const MALE_BANDS = [28.1036, 30.555, 30.2904, 28.7908, 27.233, 30.681, 38.57, 42.8152,
  45.5756, 46.6724, 39.0836, 33.7478, 32.8522, 30.7826, 24.7246, 14.5502, 7.7876,
  3.3714, 1.219, 0.254];
const FEMALE_BANDS = [26.7046, 29.0118, 28.9208, 27.2186, 25.8644, 29.2416, 37.029,
  41.186, 43.0774, 44.5034, 38.5784, 34.9758, 35.9074, 37.009, 33.4692, 23.2742,
  15.3406, 8.1908, 3.3594, 0.7392];
const MALE_100 = 0.105, FEMALE_100 = 0.345;

{
  const rows = [];
  const label = i => `${i * 5}–${i * 5 + 4}`;
  MALE_BANDS.forEach((v, i) => rows.push([label(i), 'Muži', r2(v * 5)]));
  rows.push(['100+', 'Muži', r2(MALE_100)]);
  FEMALE_BANDS.forEach((v, i) => rows.push([label(i), 'Ženy', r2(v * 5)]));
  rows.push(['100+', 'Ženy', r2(FEMALE_100)]);
  const total = [...MALE_BANDS, ...FEMALE_BANDS].reduce((a, b) => a + b, 0) * 5 + MALE_100 + FEMALE_100;
  write('vekova_struktura_2024.csv', ['vekova_skupina', 'pohlavie', 'pocet_tis'], rows);
  console.log(`     (kontrola: celková populácia ${r1(total / 1000)} mil.)`);
}

// ── 2. pension expenditure, % of GDP ────────────────────────────────────────
{
  const rows = [];
  const kinds = [
    { name: 'Starobné',      base: 5.60, drift: 0.062, wobble: 0.05 },
    { name: 'Invalidné',     base: 1.05, drift: 0.004, wobble: 0.02 },
    { name: 'Pozostalostné', base: 0.72, drift: 0.002, wobble: 0.015 },
  ];
  for (let y = 2010; y <= 2070; y++) {
    const t = y - 2010;
    for (const k of kinds) {
      // slow ageing-driven drift, decelerating after 2050
      const ramp = t <= 40 ? t : 40 + (t - 40) * 0.45;
      const v = k.base + k.drift * ramp + k.wobble * rnd();
      rows.push([y, k.name, r2(Math.max(0, v))]);
    }
  }
  write('vydavky_dochodky.csv', ['rok', 'druh', 'podiel_hdp'], rows);
}

// ── 3. contributors vs pensioners, thousands ────────────────────────────────
{
  const rows = [];
  for (let y = 2010; y <= 2070; y++) {
    const t = y - 2010;
    // contributors peak around 2020 then decline with the workforce
    const payers = 2280 + 46 * Math.sin(Math.PI * Math.min(t, 12) / 24) - Math.max(0, t - 12) * 12.6 + 8 * rnd();
    const recipients = 1290 + t * 9.4 + Math.max(0, t - 25) * 3.1 + 6 * rnd();
    rows.push([y, 'Platitelia', r1(payers)]);
    rows.push([y, 'Poberatelia', r1(recipients)]);
  }
  write('platitelia_poberatelia.csv', ['rok', 'skupina', 'pocet_tis'], rows);
}

// ── 4. average pension, average wage, replacement rate ──────────────────────
{
  const rows = [];
  for (let y = 2010; y <= 2040; y++) {
    const t = y - 2010;
    const wage = 770 * Math.pow(1.036, t) + 6 * rnd();
    // replacement rate erodes as indexation lags wage growth
    const rr = 46.5 - t * 0.28 + 0.4 * rnd();
    rows.push([y, r1(wage), r1(wage * rr / 100), r2(rr)]);
  }
  write('nahradovy_pomer.csv', ['rok', 'priemerna_mzda_eur', 'priemerny_dochodok_eur', 'nahradovy_pomer'], rows);
}

// ── 5. statutory retirement age ─────────────────────────────────────────────
{
  const rows = [];
  for (let y = 2010; y <= 2070; y++) {
    // women converge on men by the early 2020s, then both drift with life expectancy
    const men = y <= 2016 ? 62 : 62 + Math.min((y - 2016) * 0.12, 1.1) + Math.max(0, y - 2030) * 0.055;
    const women = y <= 2016 ? 58.5 + (y - 2010) * 0.55 : Math.max(men - Math.max(0, 2022 - y) * 0.3, men);
    rows.push([y, 'Muži', r1(men)]);
    rows.push([y, 'Ženy', r1(Math.min(women, men))]);
  }
  write('dochodkovy_vek.csv', ['rok', 'pohlavie', 'vek'], rows);
}

// ── 6. deficit response surface: f(retirement age, TFR) ─────────────────────
// The genuine two-parameter case a 3D surface is for: the shape of the response
// is the finding, not any single cell.
{
  const rows = [];
  for (let age = 62; age <= 70; age += 0.5) {
    for (let tfr = 1.2; tfr <= 2.2 + 1e-9; tfr += 0.1) {
      // deficit shrinks with a later retirement age and with higher fertility,
      // fertility acting with a long lag so its effect is the weaker of the two
      const d = 3.35 - (age - 62) * 0.295 - (tfr - 1.2) * 0.62 + (age - 62) * (tfr - 1.2) * 0.021;
      rows.push([r1(age), r1(tfr), r2(Math.max(-0.6, d))]);
    }
  }
  write('saldo_povrch.csv', ['dochodkovy_vek', 'tfr', 'saldo_hdp'], rows);
}

// ── 7. second pillar ────────────────────────────────────────────────────────
{
  const rows = [];
  for (let y = 2010; y <= 2040; y++) {
    const t = y - 2010;
    rows.push([y, r2(4.1 + t * 0.72 + 0.15 * rnd()), r1(1480 + t * 22 + 9 * rnd())]);
  }
  write('pilier2.csv', ['rok', 'aktiva_hdp', 'sporitelia_tis'], rows);
}

// ── 8. country comparison (scatter) ─────────────────────────────────────────
{
  const data = [
    ['Slovensko', 32.5, 7.4], ['Česko', 33.8, 8.1], ['Poľsko', 30.9, 10.3],
    ['Maďarsko', 33.1, 7.9], ['Rakúsko', 31.7, 13.1], ['Nemecko', 37.2, 10.4],
    ['Francúzsko', 38.1, 13.6], ['Taliansko', 39.4, 15.4], ['Španielsko', 33.6, 11.7],
    ['Holandsko', 33.4, 12.0], ['Švédsko', 33.0, 10.6], ['Dánsko', 32.4, 9.8],
    ['Fínsko', 39.5, 13.0], ['Portugalsko', 38.0, 13.4], ['Grécko', 38.2, 15.2],
    ['Belgicko', 31.1, 11.5], ['Írsko', 24.2, 5.1], ['Slovinsko', 34.6, 10.3],
    ['Chorvátsko', 35.2, 10.4], ['Rumunsko', 31.8, 8.3], ['Bulharsko', 37.9, 8.6],
    ['Estónsko', 32.6, 7.6], ['Litva', 33.9, 7.5], ['Lotyšsko', 34.0, 8.4],
  ];
  const rows = data.map(([c, dep, exp]) => {
    const group = ['Slovensko', 'Česko', 'Poľsko', 'Maďarsko'].includes(c) ? 'V4'
      : ['Rakúsko', 'Nemecko', 'Francúzsko', 'Taliansko', 'Španielsko', 'Holandsko',
         'Portugalsko', 'Grécko', 'Belgicko', 'Írsko'].includes(c) ? 'EU-15' : 'Ostatné EU';
    return [c, group, r1(dep), r1(exp)];
  });
  write('krajiny_porovnanie.csv', ['krajina', 'skupina', 'zavislost_starych', 'vydavky_hdp'], rows);
}

// ── 9. decomposition of the change in expenditure (waterfall) ───────────────
{
  const rows = [
    ['Výdavky 2024', 7.35, 1],
    ['Demografia', 1.92, 0],
    ['Dôchodkový vek', -1.14, 0],
    ['Náhradový pomer', -0.58, 0],
    ['Miera zamestnanosti', -0.31, 0],
    ['Ostatné', 0.16, 0],
    ['Výdavky 2070', 7.40, 1],
  ];
  write('dekompozicia.csv', ['faktor', 'zmena_hdp', 'je_uroven'], rows);
}

console.log('\nHotovo. Všetky súbory okrem vekova_struktura_2024.csv sú ilustračné.');
