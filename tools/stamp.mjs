#!/usr/bin/env node
// stamp.mjs — verzie v adresách skriptov a štýlu, aby prehliadač nebral starý kód.
//
// GitHub Pages posiela JS a CSS s cache na 10 minút. Manifest sa načítava vždy
// nanovo (cache: 'no-cache'), kód nie — po nasadení tak prehliadač kreslil nový
// manifest starým kódom: nové voľby (hrúbka stĺpca, pevné farby) ticho ignoroval
// a graf vyzeral, akoby zmena nebola nasadená.
//
// Riešenie bez build stepu: index.html nesie import mapu, ktorá každý modul
// presmeruje na adresu s odtlačkom obsahu (lib/theme.js → lib/theme.js?v=3f2a…).
// Zmenený súbor = nová adresa = prehliadač si ho stiahne; nezmenený zostáva
// v cache. Obyčajné obnovenie stránky (F5) stačí, lebo index.html sa pri ňom
// overuje vždy.
//
//   node tools/stamp.mjs           prepíše odtlačky v index.html
//   node tools/stamp.mjs --check   len overí, že sedia (beží v npm run validate a v CI)

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = join(ROOT, 'index.html');
const START = '<!-- importmap:start -->';
const END = '<!-- importmap:end -->';

/**
 * Odtlačok obsahu súboru.
 *
 * Vstup:  rel (string) — cesta od koreňa repozitára, napr. "lib/theme.js"
 * Výstup: string[10] — prvých 10 znakov SHA-256 v hex
 * Príklad: hash('style.css') → "a1b2c3d4e5"
 */
function hash(rel) {
  return createHash('sha256').update(readFileSync(join(ROOT, rel))).digest('hex').slice(0, 10);
}

/**
 * Nová podoba index.html s aktuálnymi odtlačkami.
 *
 * Vstup:  html (string) — súčasný obsah index.html; musí obsahovať značky START/END
 *         pred <script type="module">
 * Výstup: string — index.html s import mapou pre app.js a lib/*.js a s ?v= pri
 *         style.css a app.js
 * Príklad: stamped(readFileSync('index.html','utf8')) → html s ?v=… pri každom module
 */
function stamped(html) {
  const modules = ['app.js', ...readdirSync(join(ROOT, 'lib'))
    .filter(f => f.endsWith('.js')).sort().map(f => 'lib/' + f)];
  const imports = Object.fromEntries(modules.map(m => [`./${m}`, `./${m}?v=${hash(m)}`]));
  const map = `${START}\n<script type="importmap">\n${JSON.stringify({ imports }, null, 2)}\n</script>\n${END}`;
  if (!html.includes(START) || !html.includes(END))
    throw new Error(`index.html: chýbajú značky ${START} / ${END}`);
  return html
    .replace(new RegExp(`${START}[\\s\\S]*?${END}`), map)
    .replace(/href="style\.css(\?v=[0-9a-f]+)?"/, `href="style.css?v=${hash('style.css')}"`)
    .replace(/<script type="module" src="app\.js(\?v=[0-9a-f]+)?">/,
             `<script type="module" src="app.js?v=${hash('app.js')}">`);
}

const current = readFileSync(INDEX, 'utf8');
const next = stamped(current);
if (process.argv.includes('--check')) {
  if (next !== current) {
    console.error('index.html: odtlačky skriptov alebo štýlu nesedia na obsah súborov.');
    console.error('Spusti `npm run stamp` a commitni index.html — inak by prehliadač mohol kresliť starým kódom.');
    process.exit(1);
  }
  console.log('Odtlačky v index.html sedia.');
} else {
  writeFileSync(INDEX, next);
  console.log(next === current ? 'Odtlačky v index.html boli aktuálne.' : 'index.html: odtlačky aktualizované.');
}
