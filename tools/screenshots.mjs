#!/usr/bin/env node
// screenshots.mjs — render every page in both modes; screenshot and/or assert.
//
// Two jobs in one script:
//   --check   fail the build on any console error, page error, failed request or
//             rendered error box. Static validation cannot see a chart that
//             throws while drawing, and that is exactly the class of bug that
//             ships a blank card to the web.
//   (default) also write PNGs to screenshots/ so a change to a chart can be
//             eyeballed — the palette validator checks colour, not layout, so
//             label collisions and overflow still need a human look.
//
// Usage: node tools/screenshots.mjs [--check] [--port 8123]

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'screenshots');
const args = process.argv.slice(2);
const CHECK_ONLY = args.includes('--check');
const PORT = Number(args[args.indexOf('--port') + 1]) || 8137;
const BASE = `http://127.0.0.1:${PORT}`;

const { chromium } = await import('playwright').catch(() => {
  console.error('Chýba playwright. Nainštaluj: npm install playwright && npx playwright install chromium');
  process.exit(2);
});

const manifest = JSON.parse(readFileSync(join(ROOT, 'data', 'manifest.json'), 'utf8'));
const pages = manifest.pages.map(p => p.id);

// ── serve ────────────────────────────────────────────────────────────────────
const server = spawn(process.execPath, [join(ROOT, 'tools', 'serve.mjs'), String(PORT)], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('server sa nespustil')), 10000);
  server.stdout.on('data', d => { if (String(d).includes('Beží')) { clearTimeout(t); resolve(); } });
});

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const problems = [];

// Prefer whatever browser Playwright installed for its own version. If that build
// is missing but the environment ships a Chromium (a preinstalled one, as in some
// CI images and sandboxes), use that instead of failing or trying to download.
function chromiumPath() {
  try {
    const want = chromium.executablePath();
    if (existsSync(want)) return undefined;          // undefined = let Playwright decide
  } catch { /* fall through to the environment copy */ }
  for (const p of ['/opt/pw-browsers/chromium', process.env.CHROME_PATH]) {
    if (p && existsSync(p)) {
      console.log(`  (používam predinštalovaný Chromium: ${p})`);
      return p;
    }
  }
  return undefined;
}

const browser = await chromium.launch({ executablePath: chromiumPath() });

try {
  for (const mode of ['light', 'dark']) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 2,
      colorScheme: mode,
      locale: 'sk-SK',
    });
    // Stamp the theme BEFORE the first navigation. Setting it afterwards and
    // reloading cancels whatever was in flight — which showed up as a spurious
    // ERR_ABORTED on the lazily-loaded 3D bundle.
    // Only localStorage here: an init script runs before the document exists, so
    // document.documentElement is still null. app.js stamps data-theme from this
    // value on boot, which is the same path a real visitor takes.
    await ctx.addInitScript(m => localStorage.setItem('rrz-theme', m), mode);

    const page = await ctx.newPage();

    page.on('console', m => {
      if (m.type() === 'error') problems.push(`[${mode}] console.error: ${m.text()}`);
      if (m.type() === 'warning' && /deprecat/i.test(m.text()))
        problems.push(`[${mode}] deprecation: ${m.text()}`);
      // Observable Plot warns on the console AND draws a ⚠ glyph into the chart
      // it is unhappy about. Both are build failures: the glyph is visible to
      // every visitor, and the warning names a real modelling mistake (a year
      // column left as a string put 55 ticks on top of each other).
      if (m.type() === 'warning' && /^Warning:/.test(m.text()))
        problems.push(`[${mode}] Plot warning: ${m.text().slice(0, 160)}`);
    });
    page.on('pageerror', e => problems.push(`[${mode}] pageerror: ${e.message}`));
    page.on('requestfailed', r =>
      problems.push(`[${mode}] request failed: ${r.url()} — ${r.failure()?.errorText}`));
    page.on('response', r => {
      if (r.status() >= 400) problems.push(`[${mode}] HTTP ${r.status()}: ${r.url()}`);
    });

    for (const id of pages) {
      // A fresh page per view: the hash router re-renders in place, but starting
      // clean means one page's failure cannot mask the next one's.
      await page.goto(`${BASE}/#${encodeURIComponent(id)}`, { waitUntil: 'networkidle' });
      // 3D scenes and ResizeObserver redraws settle a beat after networkidle
      await page.waitForTimeout(id === 'citlivost' ? 2500 : 900);

      const cards = await page.locator('.viz-card').count();
      if (!cards) problems.push(`[${mode}] ${id}: žiadne karty sa nevykreslili`);

      // an error box means a view threw while rendering
      const errs = await page.locator('.viz-error').allTextContents();
      for (const e of errs) problems.push(`[${mode}] ${id}: chybová karta — ${e.trim()}`);

      // every chart card must have produced an actual svg or a 3D canvas
      const empty = await page.evaluate(() => {
        const out = [];
        for (const stage of document.querySelectorAll('.viz-stage')) {
          const has = stage.querySelector('svg') || stage.querySelector('canvas');
          if (!has) out.push(stage.closest('.viz-card')?.querySelector('.viz-card-title')?.textContent
            || '(bez názvu)');
        }
        return out;
      });
      // A planned card deliberately has no plot stage. Each must name its file,
      // and the page must state the contract at least once — later cards over the
      // same file point back at the first instead of repeating the table.
      const plannedBroken = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.viz-planned')];
        const out = [];
        for (const p of cards) {
          const ok = p.querySelector('.viz-planned-cols') || p.querySelector('.viz-planned-ref');
          if (!p.querySelector('.viz-planned-file') || !ok)
            out.push(p.closest('.viz-card')?.querySelector('.viz-card-title')?.textContent || '(bez názvu)');
        }
        if (cards.length && !document.querySelector('.viz-planned-cols'))
          out.push('(stránka bez kontraktu stĺpcov)');
        return out;
      });
      for (const e of plannedBroken)
        problems.push(`[${mode}] ${id}: plánovaná karta bez kontraktu — "${e}"`);
      for (const e of empty) problems.push(`[${mode}] ${id}: prázdna plocha grafu — "${e}"`);

      // Plot's own warning marker, in case a warning arrives without a console
      // message (a redraw after a resize does not re-log).
      const glyphs = await page.evaluate(() => [...document.querySelectorAll('.viz-stage svg text')]
        .filter(t => /\u26a0/.test(t.textContent))
        .map(t => t.closest('.viz-card')?.querySelector('.viz-card-title')?.textContent || '(bez názvu)'));
      for (const g of glyphs)
        problems.push(`[${mode}] ${id}: Plot vykreslil výstražnú značku do grafu — "${g}"`);

      // a chart wider than its card means the layout overflows
      const overflow = await page.evaluate(() => {
        const out = [];
        for (const card of document.querySelectorAll('.viz-card')) {
          if (card.scrollWidth > card.clientWidth + 2)
            out.push((card.querySelector('.viz-card-title')?.textContent || '?') +
              ` (${card.scrollWidth} > ${card.clientWidth})`);
        }
        return out;
      });
      for (const o of overflow) problems.push(`[${mode}] ${id}: karta preteká — ${o}`);

      if (!CHECK_ONLY) {
        await page.screenshot({ path: join(OUT, `${id}-${mode}.png`), fullPage: true });
        console.log(`  screenshots/${id}-${mode}.png`);
      } else {
        console.log(`  ok: ${id} (${mode}), ${cards} kariet`);
      }
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}

if (problems.length) {
  console.error(`\n${problems.length} problémov:`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log('\nVšetky stránky sa vykreslili v oboch režimoch bez chýb.');
