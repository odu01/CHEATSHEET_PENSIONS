#!/usr/bin/env node
// screenshots.mjs — render every page in every target; screenshot and/or assert.
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
// Every page is rendered three times: desktop light, desktop dark and a phone.
// The phone is not a nicety — under 780 px the navigation and the grid behave
// differently, so it is a different page and needs its own pass.
//
// Usage: node tools/screenshots.mjs [--check] [--port 8123] [--only mobile]

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
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

const TARGETS = [
  { name: 'light',  colorScheme: 'light', viewport: { width: 1440, height: 1000 } },
  { name: 'dark',   colorScheme: 'dark',  viewport: { width: 1440, height: 1000 } },
  { name: 'mobile', colorScheme: 'light', viewport: { width: 390, height: 844 }, phone: true },
].filter(t => !ONLY || t.name === ONLY);

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
  for (const target of TARGETS) {
    const mode = target.name;
    const ctx = await browser.newContext({
      viewport: target.viewport,
      deviceScaleFactor: 2,
      colorScheme: target.colorScheme,
      locale: 'sk-SK',
      isMobile: !!target.phone,
      hasTouch: !!target.phone,
    });
    // Stamp the theme BEFORE the first navigation. Setting it afterwards and
    // reloading cancels whatever was in flight — which showed up as a spurious
    // ERR_ABORTED on the lazily-loaded 3D bundle.
    // Only localStorage here: an init script runs before the document exists, so
    // document.documentElement is still null. app.js stamps data-theme from this
    // value on boot, which is the same path a real visitor takes.
    await ctx.addInitScript(m => localStorage.setItem('rrz-theme', m), target.colorScheme);

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

      // An animated card must actually have its control: a view that declares a
      // frame but renders no slider is a silent loss of a whole dimension.
      // Nothing is played here — the screenshot has to be reproducible, so every
      // animated card is captured on its last frame, which is also what a
      // visitor sees before touching anything.
      const frameCheck = await page.evaluate(() => {
        const out = [];
        for (const card of document.querySelectorAll('.viz-card')) {
          const host = card.querySelector('.viz-frame-host');
          if (!host) continue;
          const hasCtl = !!host.querySelector('.viz-frame-slider');
          const hasMark = !!card.querySelector('.viz-frame-mark');
          if (hasCtl !== hasMark)
            out.push((card.querySelector('.viz-card-title')?.textContent || '?') +
              ` (posuvník ${hasCtl}, nápis ${hasMark})`);
        }
        return out;
      });
      for (const f of frameCheck)
        problems.push(`[${mode}] ${id}: nekonzistentné ovládanie času — ${f}`);

      // A flow diagram must have flows, and each one must carry its own text
      // label for a screen reader — colour and width alone say nothing.
      const flowCheck = await page.evaluate(() => {
        const out = [];
        for (const svg of document.querySelectorAll('.viz-stage svg')) {
          const flows = svg.querySelectorAll('.viz-flow');
          if (!flows.length) continue;
          const title = svg.closest('.viz-card')?.querySelector('.viz-card-title')?.textContent || '?';
          const unlabelled = [...flows].filter(f => !f.getAttribute('aria-label')).length;
          if (unlabelled) out.push(`${title}: ${unlabelled} prúdov bez aria-label`);
          // Every label must stay inside the DRAWING — a clipped node name is a
          // bug the palette validator cannot see. The reference is the svg, not
          // the card: an over-wide diagram may pan inside its own stage, and a
          // label that is merely scrolled out of view is reachable, while one
          // outside the svg box is cut off by it for good.
          const box = svg.getBoundingClientRect();
          const clipped = [...svg.querySelectorAll('text')].filter(tx => {
            const r = tx.getBoundingClientRect();
            return r.width > 0 && (r.left < box.left - 1 || r.right > box.right + 1);
          }).length;
          if (clipped) out.push(`${title}: ${clipped} štítkov preteká plochu grafu`);
        }
        return out;
      });
      for (const f of flowCheck) problems.push(`[${mode}] ${id}: ${f}`);

      // A drawing wider than its stage is fine only if the stage scrolls. Without
      // that it is the phone-navigation bug again: content that exists, cannot be
      // reached, and says nothing about it.
      const unreachable = await page.evaluate(() => {
        const out = [];
        for (const stage of document.querySelectorAll('.viz-stage')) {
          if (stage.scrollWidth <= stage.clientWidth + 2) continue;
          const ox = getComputedStyle(stage).overflowX;
          const title = stage.closest('.viz-card')?.querySelector('.viz-card-title')?.textContent || '?';
          if (ox !== 'auto' && ox !== 'scroll')
            out.push(`${title} (${stage.scrollWidth} > ${stage.clientWidth}, overflow-x: ${ox})`);
          else if (stage.closest('.viz-card').querySelector('.viz-pan-hint[hidden]'))
            out.push(`${title}: posúva sa, ale bez upozornenia`);
        }
        return out;
      });
      for (const u of unreachable)
        problems.push(`[${mode}] ${id}: graf je širší než plocha a nedá sa doscrollovať — ${u}`);

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

      if (target.phone) await checkPhone(page, id, problems, !CHECK_ONLY);

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

/**
 * What can only break on a phone.
 *
 * The horizontal strips were the actual bug: at 390 px the section row needed
 * 645 px and scrolled sideways with nothing to say so, which silently hid two
 * whole sections. A test for "does it overflow" would have caught it, so here it
 * is — plus the panel that replaced it has to open, list every page, and close on
 * Escape, because a navigation you cannot close is worse than none.
 */
async function checkPhone(page, id, problems, shoot) {
  const m = await page.evaluate(() => {
    const strips = [];
    for (const row of document.querySelectorAll('.nav-row')) {
      if (!row.getClientRects().length) continue;          // display:none = fine
      if (row.scrollWidth > row.clientWidth + 2)
        strips.push(`${row.className} (${row.scrollWidth} > ${row.clientWidth})`);
    }
    const t = document.querySelector('.nav-toggle');
    return {
      strips,
      docWidth: document.documentElement.scrollWidth,
      winWidth: window.innerWidth,
      toggle: t && t.getClientRects().length ? (t.textContent || '').trim() : null,
      headerH: Math.round(document.querySelector('.app-header').getBoundingClientRect().height),
    };
  });

  for (const st of m.strips)
    problems.push(`[mobile] ${id}: navigačný pruh preteká bez ovládania — ${st}`);
  if (m.docWidth > m.winWidth + 2)
    problems.push(`[mobile] ${id}: stránka sa posúva nabok (${m.docWidth} > ${m.winWidth})`);
  if (!m.toggle)
    problems.push(`[mobile] ${id}: chýba tlačidlo ponuky stránok`);
  // A quarter of a 844 px screen spent on a header nobody reads twice.
  if (m.headerH > 120)
    problems.push(`[mobile] ${id}: hlavička je vysoká ${m.headerH} px`);

  await page.locator('.nav-toggle').click();
  const open = await page.evaluate(() => ({
    expanded: document.querySelector('.nav-toggle')?.getAttribute('aria-expanded'),
    hidden: document.querySelector('.nav-menu')?.hidden,
    links: document.querySelectorAll('.nav-menu-page').length,
    active: document.querySelectorAll('.nav-menu-page.is-active').length,
    clipped: [...document.querySelectorAll('.nav-menu-page')]
      .filter(a => a.scrollWidth > a.clientWidth + 2).length,
  }));
  if (open.expanded !== 'true' || open.hidden)
    problems.push(`[mobile] ${id}: ponuka sa neotvorila (aria-expanded=${open.expanded})`);
  if (open.links !== pages.length)
    problems.push(`[mobile] ${id}: ponuka ukazuje ${open.links} z ${pages.length} stránok`);
  if (open.active !== 1)
    problems.push(`[mobile] ${id}: v ponuke je ${open.active} označených stránok, má byť práve jedna`);
  if (open.clipped)
    problems.push(`[mobile] ${id}: ${open.clipped} názvov v ponuke je odrezaných`);

  // One picture of the open panel is worth having; fourteen identical ones are not.
  if (shoot && id === pages[0]) {
    await page.screenshot({ path: join(OUT, 'nav-menu-mobile.png') });
    console.log('  screenshots/nav-menu-mobile.png');
  }

  await page.keyboard.press('Escape');
  const stillOpen = await page.evaluate(() => !document.querySelector('.nav-menu')?.hidden);
  if (stillOpen) problems.push(`[mobile] ${id}: ponuka sa nezavrela klávesom Escape`);
}

if (problems.length) {
  console.error(`\n${problems.length} problémov:`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`\nVšetky stránky sa vykreslili bez chýb v ${TARGETS.length} prostrediach: ` +
  `${TARGETS.map(t => t.name).join(', ')}.`);
