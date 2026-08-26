// app.js — manifest-driven controller.
//
// The whole site is one contract: data/manifest.json declares datasets, pages and
// views. Adding a chart means adding a CSV and a JSON block — no code change. This
// file only wires: load manifest -> build nav -> load the datasets a page needs ->
// render its views -> keep the URL, the theme toggle and the filter row in sync.

import { renderView } from './lib/view.js';
import { loadDataset, clearCache } from './lib/data.js';
import { resetTokens, activeMode } from './lib/theme.js';
import { applyTransforms } from './lib/transform.js';

const MANIFEST_URL = 'data/manifest.json';
// Rovnaká hranica je v style.css (--nav-wide / media query). Nad ňou sú dva
// pruhy, pod ňou rozbaľovacia ponuka.
const NAV_WIDE = 780;

const state = {
  manifest: null,
  pageId: null,
  filters: {},          // shared filter row: scopes every view on the page
  cards: [],
};

const $ = id => document.getElementById(id);

// ─── boot ────────────────────────────────────────────────────────────────────

async function boot() {
  try {
    const resp = await fetch(MANIFEST_URL, { cache: 'no-cache' });
    if (!resp.ok) throw new Error(`${MANIFEST_URL}: HTTP ${resp.status}`);
    state.manifest = await resp.json();
  } catch (err) {
    fatal(`Nepodarilo sa načítať ${MANIFEST_URL}: ${err.message}`);
    return;
  }

  const m = state.manifest;
  document.title = m.title || 'Prehľad dôchodkového systému';
  $('siteTitle').textContent = m.title || 'Prehľad dôchodkového systému';
  if (m.subtitle) $('siteSubtitle').textContent = m.subtitle;

  buildNav();
  initTheme();
  // A different page starts with its own filters. Carrying them over looked
  // harmless while every page filtered a different column, but "pohlavie: Muži"
  // set on one page silently cut every other page that has a pohlavie column
  // down to men — the chart still drew, just wrong.
  window.addEventListener('hashchange', () => {
    const id = pageFromHash();
    openPage(id, id !== state.pageId);
  });
  await openPage(pageFromHash(), false);
}

function pageFromHash() {
  const id = decodeURIComponent(location.hash.replace(/^#/, ''));
  const pages = state.manifest.pages || [];
  return pages.some(p => p.id === id) ? id : pages[0]?.id;
}

function fatal(msg) {
  const box = document.createElement('div');
  box.className = 'viz-error';
  box.textContent = msg;
  $('content').replaceChildren(box);
}

// ─── navigation ──────────────────────────────────────────────────────────────

/**
 * Two-tier navigation: sections on the first row, the active section's pages on
 * the second.
 *
 * Fourteen equal items in one strip wrapped to two lines and stopped being
 * navigation — nothing told the reader which of them belong together, so the
 * whole list had to be read every time. Sections come from the manifest
 * (`group` on each page), so the structure is data, not markup. A section with a
 * single page shows no second row: there would be nothing to choose.
 */
function groupsOf(pages) {
  const groups = [];
  for (const page of pages) {
    const name = page.group || page.label;
    let g = groups.find(x => x.name === name);
    if (!g) { g = { name, pages: [] }; groups.push(g); }
    g.pages.push(page);
  }
  return groups;
}

function buildNav() {
  const nav = $('nav');
  const groups = groupsOf(state.manifest.pages || []);
  state.navGroups = groups;

  const top = document.createElement('div');
  top.className = 'nav-row nav-row-group';
  for (const g of groups) {
    const a = document.createElement('a');
    a.className = 'nav-item nav-group';
    a.href = '#' + encodeURIComponent(g.pages[0].id);
    a.textContent = g.name;
    a.dataset.group = g.name;
    top.appendChild(a);
  }

  const sub = document.createElement('div');
  sub.className = 'nav-row nav-row-page';

  nav.replaceChildren(buildNavToggle(), top, sub, buildNavMenu(groups));
  state.navSub = sub;
  wireNavMenu();
}

/**
 * Phone navigation: one button that says where you are, one panel with the whole
 * map.
 *
 * The two desktop strips do not survive a 390 px viewport — the sections row
 * needed 645 px and the pages row 513 px, so they scrolled sideways with no
 * affordance and "II. pilier" and "Dáta" were simply not there for a phone
 * reader. Widening or shrinking them does not help: fourteen labels in Slovak do
 * not fit a phone at a readable size. So on small screens the strips are replaced
 * outright by a disclosure panel that shows all six sections with their pages at
 * once — one tap to see the whole site, one to go.
 *
 * Only one of the two navigations is ever displayed (`display: none` on the
 * other), so a screen reader is never offered the same fourteen links twice.
 */
function buildNavToggle() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'nav-toggle';
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', 'navMenu');
  btn.setAttribute('aria-label', 'Otvoriť ponuku stránok');

  const icon = document.createElement('span');
  icon.className = 'nav-toggle-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '\u2630';                 // ☰

  const text = document.createElement('span');
  text.className = 'nav-toggle-text';
  const g = document.createElement('span');
  g.className = 'nav-toggle-group';
  const p = document.createElement('span');
  p.className = 'nav-toggle-page';
  text.append(g, p);

  const caret = document.createElement('span');
  caret.className = 'nav-toggle-caret';
  caret.setAttribute('aria-hidden', 'true');
  caret.textContent = '\u25be';                // ▾

  btn.append(icon, text, caret);
  state.navToggle = btn;
  return btn;
}

function buildNavMenu(groups) {
  const menu = document.createElement('div');
  menu.className = 'nav-menu';
  menu.id = 'navMenu';
  menu.hidden = true;
  for (const g of groups) {
    const sec = document.createElement('section');
    sec.className = 'nav-menu-group';
    const h = document.createElement('p');
    h.className = 'nav-menu-title';
    h.textContent = g.name;
    const list = document.createElement('div');
    list.className = 'nav-menu-list';
    for (const page of g.pages) {
      const a = document.createElement('a');
      a.className = 'nav-menu-page';
      a.href = '#' + encodeURIComponent(page.id);
      a.textContent = page.label;
      a.dataset.menuPage = page.id;
      if (page.hint) {
        const hint = document.createElement('span');
        hint.className = 'nav-menu-hint';
        hint.textContent = page.hint;
        a.appendChild(hint);
      }
      list.appendChild(a);
    }
    sec.append(h, list);
    menu.appendChild(sec);
  }
  state.navMenu = menu;
  return menu;
}

/** Open/close the phone panel. One place, so every closing path agrees. */
function setNavMenu(open) {
  const menu = state.navMenu, btn = state.navToggle;
  if (!menu || !btn) return;
  menu.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  btn.setAttribute('aria-label', open ? 'Zavrieť ponuku stránok' : 'Otvoriť ponuku stránok');
  btn.classList.toggle('is-open', open);
}

function wireNavMenu() {
  const nav = $('nav');
  state.navToggle.addEventListener('click', () =>
    setNavMenu(state.navToggle.getAttribute('aria-expanded') !== 'true'));

  // Tapping the page you are already on does not change the hash, so nothing
  // would close the panel — close it here rather than relying on the router.
  state.navMenu.addEventListener('click', e => {
    if (e.target.closest('a')) setNavMenu(false);
  });

  nav.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || state.navMenu.hidden) return;
    setNavMenu(false);
    state.navToggle.focus();
  });

  // A tap outside the panel is a dismissal, not navigation.
  document.addEventListener('pointerdown', e => {
    if (!state.navMenu.hidden && !nav.contains(e.target)) setNavMenu(false);
  });

  // Rotating to landscape swaps to the desktop strips; the panel is then hidden
  // by CSS, and aria-expanded must not keep claiming it is open.
  window.matchMedia?.(`(min-width: ${NAV_WIDE}px)`).addEventListener('change', ev => {
    if (ev.matches) setNavMenu(false);
  });
}

function markNav() {
  const groups = state.navGroups || [];
  const active = groups.find(g => g.pages.some(p => p.id === state.pageId));
  markNavMenu(active);

  for (const a of $('nav').querySelectorAll('.nav-group')) {
    const on = a.dataset.group === active?.name;
    a.classList.toggle('is-active', on);
    if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
  }

  // The second row is rebuilt per section rather than shown and hidden: a hidden
  // strip of fourteen links is still fourteen links for a screen reader.
  const sub = state.navSub;
  if (!sub) return;
  sub.replaceChildren();
  const many = (active?.pages.length || 0) > 1;
  sub.hidden = !many;
  if (!many) return;
  for (const page of active.pages) {
    const a = document.createElement('a');
    a.className = 'nav-item nav-page';
    a.href = '#' + encodeURIComponent(page.id);
    a.textContent = page.label;
    a.dataset.page = page.id;
    if (page.hint) a.title = page.hint;
    if (page.id === state.pageId) {
      a.classList.add('is-active');
      a.setAttribute('aria-current', 'page');
    }
    sub.appendChild(a);
  }
}

/** The phone button has to say where you are; the panel has to show it too. */
function markNavMenu(active) {
  setNavMenu(false);                     // navigating away closes the panel
  const btn = state.navToggle;
  if (btn) {
    const page = active?.pages.find(p => p.id === state.pageId);
    btn.querySelector('.nav-toggle-group').textContent = active?.name || '';
    // A section with a single page names it the same as itself; printing the
    // label twice would just look like a bug.
    btn.querySelector('.nav-toggle-page').textContent =
      page && page.label !== active.name ? page.label : '';
  }
  for (const a of state.navMenu?.querySelectorAll('.nav-menu-page') || []) {
    const on = a.dataset.menuPage === state.pageId;
    a.classList.toggle('is-active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

// ─── page rendering ──────────────────────────────────────────────────────────

async function openPage(pageId, resetFilters = true) {
  if (!pageId) { fatal('Manifest neobsahuje žiadne stránky.'); return; }
  const page = (state.manifest.pages || []).find(p => p.id === pageId);
  if (!page) { fatal(`Stránka "${pageId}" nie je v manifeste.`); return; }

  state.pageId = pageId;
  if (resetFilters) state.filters = {};
  markNav();

  const content = $('content');
  for (const c of state.cards) c._dispose?.();
  state.cards = [];

  content.classList.add('is-loading');   // hold the frame, no skeleton flash
  const intro = document.createElement('div');
  intro.className = 'page-intro';
  const h2 = document.createElement('h2');
  h2.textContent = page.label;
  intro.appendChild(h2);
  if (page.description) {
    const p = document.createElement('p');
    p.textContent = page.description;
    intro.appendChild(p);
  }

  const grid = document.createElement('div');
  grid.className = 'viz-grid';

  const filterRow = document.createElement('div');
  filterRow.className = 'filter-row';
  filterRow.hidden = true;

  content.replaceChildren(intro, filterRow, grid);

  const viewIds = page.views || [];
  const specs = viewIds.map(id => {
    const v = state.manifest.views?.[id];
    if (!v) return { id, type: 'missing', title: `Chýbajúci view "${id}"` };
    return { ...v, id };
  });

  // Load every dataset this page needs, once, in parallel. Tiles may name their
  // own dataset, so a KPI row can pull from several files — those count too.
  const needed = [...new Set(specs.flatMap(s =>
    [s.dataset, ...(s.tiles || []).map(t => t.dataset)]).filter(Boolean))];
  const bundles = {};
  await Promise.all(needed.map(async ds => {
    const def = state.manifest.datasets?.[ds];
    if (!def) { bundles[ds] = { error: `Dataset "${ds}" nie je v manifeste.` }; return; }
    try {
      // The shared codelists travel with the definition so the loader can turn
      // codes into labels without reaching back into global state.
      bundles[ds] = await loadDataset({ ...def, __codelists: state.manifest.dimensions });
    } catch (err) {
      bundles[ds] = { error: err.message };
    }
  }));

  buildFilterRow(filterRow, page, specs, bundles);

  await drawViews(grid, specs, bundles);
  content.classList.remove('is-loading');
}

async function drawViews(grid, specs, bundles) {
  const cards = [];
  // One long "waiting for data" note per dataset per page, not per card.
  const shownNotes = new Set();
  for (const spec of specs) {
    if (spec.type === 'missing') {
      const card = document.createElement('section');
      card.className = 'viz-card';
      const e = document.createElement('div');
      e.className = 'viz-error';
      e.textContent = spec.title;
      card.appendChild(e);
      cards.push(card);
      continue;
    }
    const bundle = bundles[spec.dataset];
    if (!bundle || bundle.error) {
      const card = document.createElement('section');
      card.className = 'viz-card';
      const h = document.createElement('h3');
      h.className = 'viz-card-title';
      h.textContent = spec.title || spec.id;
      const e = document.createElement('div');
      e.className = 'viz-error';
      e.textContent = bundle?.error || `Dataset "${spec.dataset}" chýba.`;
      card.append(h, e);
      cards.push(card);
      continue;
    }
    // The shared filter row is applied before the view's own transforms —
    // except for a filter over a column that a transform produces, which lands
    // at the view's own `pageFilter` marker instead.
    const scoped = scopeRows(bundle, spec);
    const card = await renderView(withPageFilter(spec, bundle), scoped, { bundles, shownNotes });
    cards.push(card);
  }
  grid.replaceChildren(...cards);
  state.cards = cards;
}

/** Page filters that are set and not "all". */
function activeFilters() {
  return Object.entries(state.filters).filter(([, v]) => v != null && v !== '');
}

/** Apply the page-level filters to a dataset bundle for one view. */
function scopeRows(bundle, spec) {
  const active = activeFilters();
  if (!active.length) return bundle;
  const where = {};
  for (const [key, value] of active) {
    if (!Object.hasOwn(bundle.columns, key)) continue;   // filter not in this dataset
    where[key] = value;
  }
  if (!Object.keys(where).length) return bundle;
  return { ...bundle, rows: applyTransforms(bundle.rows, [{ kind: 'filter', where }]) };
}

/**
 * Substitute the view's `pageFilter` marker with the filters that scopeRows
 * could not apply, because their column does not exist in the CSV — it is made
 * by a transform. Filtering overlapping properties is the case that needs this:
 * `expand` invents the property column, the filter picks one property, and only
 * then may the rows be aggregated. Filtering before the expand is impossible and
 * filtering after the aggregate is too late — the column is gone by then.
 */
function withPageFilter(spec, bundle) {
  if (!spec.transform?.some(t => t.kind === 'pageFilter')) return spec;
  const where = {};
  for (const [key, value] of activeFilters()) {
    if (!Object.hasOwn(bundle.columns, key)) where[key] = value;
  }
  const transform = spec.transform.map(t => t.kind !== 'pageFilter' ? t
    : (Object.keys(where).length ? { kind: 'filter', where } : { kind: 'pageFilter' }));
  return { ...spec, transform };
}

// ─── filter row (one row, above everything it scopes) ────────────────────────

function buildFilterRow(host, page, specs, bundles) {
  const defs = page.filters || [];
  if (!defs.length) { host.hidden = true; return; }
  host.hidden = false;
  host.replaceChildren();

  for (const def of defs) {
    const bundle = bundles[def.dataset] || Object.values(bundles).find(b => b?.columns?.[def.column]);
    if (!bundle || bundle.error) continue;

    // A filter's options normally come from the data. A planned dataset has no
    // rows yet, so the manifest may declare them instead — which also documents
    // the exact category strings the incoming file has to use.
    let values = [...new Set(bundle.rows.map(r => r[def.column]).filter(v => v != null))];
    values.sort((a, b) => typeof a === 'number' ? a - b : String(a).localeCompare(String(b), 'sk'));
    if (!values.length && Array.isArray(def.values)) values = [...def.values];

    const wrap = document.createElement('label');
    wrap.className = 'filter';
    const span = document.createElement('span');
    span.className = 'filter-label';
    span.textContent = def.label || def.column;
    const sel = document.createElement('select');
    sel.className = 'filter-select';

    // A `required` filter offers no "all" option. Some views only make sense for
    // one value at a time: a chart whose series is "new vs paid" would, with every
    // pension type selected at once, draw one line zig-zagging across all of them.
    if (!def.required) {
      const all = document.createElement('option');
      all.value = '';
      all.textContent = def.allLabel || 'Všetko';
      sel.appendChild(all);
    }
    for (const v of values) {
      const o = document.createElement('option');
      o.value = String(v);
      o.textContent = String(v);
      sel.appendChild(o);
    }
    if (def.default != null && values.some(v => String(v) === String(def.default)))
      sel.value = String(def.default);
    else if (def.required) sel.value = String(values[0] ?? '');
    state.filters[def.column] = sel.value === '' ? null
      : (typeof values[0] === 'number' ? Number(sel.value) : sel.value);

    sel.addEventListener('change', async () => {
      state.filters[def.column] = sel.value === '' ? null
        : (typeof values[0] === 'number' ? Number(sel.value) : sel.value);
      const grid = document.querySelector('.viz-grid');
      grid.classList.add('is-refetching');       // hold the previous render
      await drawViews(grid, specs, bundles);
      grid.classList.remove('is-refetching');
    });

    if (!bundle.rows.length) {
      sel.disabled = true;
      sel.title = 'Dáta pre tento filter ešte nie sú dodané.';
      wrap.classList.add('is-pending');
    }

    wrap.append(span, sel);
    host.appendChild(wrap);
  }

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'viz-btn filter-reset';
  reset.textContent = 'Zrušiť filtre';
  reset.addEventListener('click', () => openPage(state.pageId, true));
  host.appendChild(reset);
}

// ─── theme toggle ────────────────────────────────────────────────────────────

function initTheme() {
  const saved = localStorage.getItem('rrz-theme');
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
  const btn = $('themeToggle');
  const sync = () => {
    const dark = activeMode() === 'dark';
    $('themeIcon').textContent = dark ? '☀' : '☾';
    $('themeText').textContent = dark ? 'Svetlý režim' : 'Tmavý režim';
    btn.setAttribute('aria-label', dark ? 'Prepnúť na svetlý režim' : 'Prepnúť na tmavý režim');
  };
  sync();
  btn.addEventListener('click', async () => {
    const next = activeMode() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('rrz-theme', next);
    resetTokens();
    sync();
    // Dark mode is its own selected set of steps, not a filter over the light
    // ones, so every chart is re-rendered against the new tokens.
    await openPage(state.pageId, false);
  });
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!document.documentElement.dataset.theme) { resetTokens(); sync(); openPage(state.pageId, false); }
  });
}

// ─── authoring aid: reload data without a hard refresh ───────────────────────
$('reloadBtn')?.addEventListener('click', async () => {
  clearCache();
  await openPage(state.pageId, false);
});

boot();
