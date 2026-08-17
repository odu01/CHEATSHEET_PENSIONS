// view.js — renders one manifest view as a card.
//
// A card is: title · subtitle · chart · legend · notes · [table twin] · source line.
// The legend is HTML rather than a Plot legend so it can toggle series, and the
// toggle keeps each entity's colour — filtering a series out never repaints the
// survivors.

import { render2D, is2D } from './charts2d.js';
import { render3D, is3D } from './charts3d.js';
import { attachHover } from './hover.js';
import { buildTable, columnsFor, downloadCSV, buildTile } from './table.js';
import { applyTransforms } from './transform.js';
import { tokens, colorMap } from './theme.js';
import { formatterFor, compact, num, int, delta as fmtDelta } from './format.js';
import { distinct, extent } from './data.js';

/** Chart heights per view size; the container also has to fit the axis band. */
const HEIGHTS = { s: 260, m: 340, l: 440, xl: 540 };

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/**
 * Provenance chip: what the numbers are, where they came from, how old they are.
 * The unit shown is the VIEW's when it declares one — a dataset can hold columns
 * in different units (EUR alongside %), and the card should state the unit of
 * what it actually plotted.
 */
function sourceLine(dataset, spec) {
  const box = el('div', 'viz-source');
  if (dataset.illustrative) {
    const badge = el('span', 'viz-badge viz-badge-warn');
    badge.append(el('span', 'viz-badge-icon', '⚠'), document.createTextNode(' Ilustračné dáta'));
    badge.title = 'Vygenerované ukážkové čísla — nie oficiálna štatistika. Nahraď súbor reálnymi dátami.';
    box.appendChild(badge);
  }
  const unit = spec?.unit || dataset.unit;
  const parts = [];
  if (dataset.source) parts.push('Zdroj: ' + dataset.source);
  if (dataset.vintage) parts.push('Vintage: ' + dataset.vintage);
  if (unit) parts.push('Jednotka: ' + unit);
  if (parts.length) box.appendChild(el('span', 'viz-source-text', parts.join(' · ')));
  if (dataset.note) box.appendChild(el('span', 'viz-source-note', dataset.note));
  return box;
}

/** HTML legend. `mark` mirrors the chart mark: rect for fills, line for lines. */
function buildLegend(items, onToggle, hidden) {
  const box = el('div', 'viz-legend');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', 'Legenda — kliknutím skryjete sériu');
  for (const it of items) {
    const btn = el('button', 'viz-legend-item');
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(!hidden.has(it.label)));
    if (hidden.has(it.label)) btn.classList.add('is-off');
    const swatch = el('span', 'viz-legend-swatch viz-legend-' + (it.mark || 'rect'));
    swatch.style.background = it.color;
    btn.append(swatch, el('span', 'viz-legend-label', it.label));
    btn.addEventListener('click', () => onToggle(it.label));
    box.appendChild(btn);
  }
  return box;
}

/** Continuous scale legend for heatmaps — colour alone never carries a value. */
function buildScaleLegend(sl, unit) {
  const t = tokens();
  const box = el('div', 'viz-scale-legend');
  const bar = el('span', 'viz-scale-bar');
  const stops = sl.diverging
    ? [t.diverging.low, t.diverging.mid, t.diverging.high]
    : [t.sequential[1], t.sequential[t.sequential.length - 2]];
  bar.style.background = `linear-gradient(90deg, ${stops.join(', ')})`;
  const fmt = formatterFor(unit);
  box.append(el('span', 'viz-scale-end', fmt(sl.lo)), bar, el('span', 'viz-scale-end', fmt(sl.hi)));
  if (unit) box.appendChild(el('span', 'viz-scale-unit', unit));
  return box;
}

/** Stat-tile row / hero figure view. */
function renderTiles(card, spec, rows) {
  const grid = el('div', 'viz-tiles' + (spec.hero ? ' viz-tiles-hero' : ''));
  for (const tileSpec of spec.tiles || []) {
    const sub = applyTransforms(rows, tileSpec.transform);
    const series = tileSpec.value ? sub.map(r => r[tileSpec.value]).filter(v => v != null) : [];
    const latest = series[series.length - 1];
    const prev = series.length > 1 ? series[series.length - 2] : null;
    const fmt = formatterFor(tileSpec.unit ?? spec.unit, tileSpec.decimals);

    let value = tileSpec.text;
    if (value == null) {
      value = tileSpec.agg === 'sum' ? fmt(series.reduce((a, b) => a + b, 0))
        : tileSpec.agg === 'mean' ? fmt(series.reduce((a, b) => a + b, 0) / series.length)
        : tileSpec.agg === 'max' ? fmt(Math.max(...series))
        : tileSpec.agg === 'min' ? fmt(Math.min(...series))
        : fmt(latest);
    }
    const deltaRaw = (prev != null && latest != null && tileSpec.delta !== false) ? latest - prev : null;

    grid.appendChild(buildTile({
      label: tileSpec.label,
      value,
      note: tileSpec.note,
      hero: !!tileSpec.hero,
      deltaRaw,
      delta: deltaRaw == null ? null : fmtDelta(deltaRaw, tileSpec.deltaUnit ?? '', tileSpec.decimals ?? 1),
      deltaNote: deltaRaw == null ? null : (tileSpec.deltaNote ?? 'r/r'),
      higherIsBetter: tileSpec.higherIsBetter,
      spark: tileSpec.spark === false ? null : series,
    }));
  }
  card.appendChild(grid);
}

/**
 * Render a view into a fresh card element.
 * `resolve(datasetId)` returns { rows, columns, meta } already loaded.
 */
export async function renderView(spec, bundle, opts = {}) {
  const card = el('section', 'viz-card' + (spec.span ? ' span-' + spec.span : ''));
  card.id = 'view-' + spec.id;

  const head = el('header', 'viz-card-head');
  head.appendChild(el('h3', 'viz-card-title', spec.title));
  if (spec.subtitle) head.appendChild(el('p', 'viz-card-sub', spec.subtitle));
  card.appendChild(head);

  const { rows: rawRows, columns, meta } = bundle;
  let rows;
  try {
    rows = applyTransforms(rawRows, spec.transform);
  } catch (err) {
    card.appendChild(el('div', 'viz-error', `Chyba transformácie: ${err.message}`));
    return card;
  }

  // ── tiles / table-only views take a short path ───────────────────────────
  if (spec.type === 'tiles') {
    renderTiles(card, spec, rows);
    card.appendChild(sourceLine(meta, spec));
    return card;
  }
  if (spec.type === 'table') {
    const cols = columnsFor(spec, columns, rows);
    card.appendChild(buildTable(rows, cols, { sortKey: spec.sortKey, sortDir: spec.sortDir }));
    card.appendChild(tableTools(spec, rows, cols));
    card.appendChild(sourceLine(meta, spec));
    return card;
  }

  // ── chart views ──────────────────────────────────────────────────────────
  const stage = el('div', 'viz-stage');
  stage.style.minHeight = (HEIGHTS[spec.size || 'm']) + 'px';
  card.appendChild(stage);

  const legendHost = el('div', 'viz-legend-host');
  card.appendChild(legendHost);

  const hidden = new Set(spec.hidden || []);
  let disposer = null;

  async function draw() {
    if (disposer) { disposer(); disposer = null; }
    const width = Math.max(280, stage.clientWidth || card.clientWidth - 32 || 640);
    const height = HEIGHTS[spec.size || 'm'];

    // Hidden series are filtered from the DATA, but the colour map was built from
    // the full key list, so the survivors keep their hue.
    const seriesKey = spec.series;
    const visible = seriesKey && hidden.size
      ? rows.filter(r => !hidden.has(String(r[seriesKey])))
      : rows;

    if (is3D(spec.type)) {
      const host = el('div', 'viz-3d');
      stage.replaceChildren(host);
      try {
        const res = await render3D(host, spec, visible, { width, height });
        disposer = res.dispose;
        renderLegendAndNotes(res);
      } catch (err) {
        stage.replaceChildren(el('div', 'viz-error', `3D graf sa nepodarilo zobraziť: ${err.message}`));
      }
      return;
    }

    if (!is2D(spec.type)) {
      stage.replaceChildren(el('div', 'viz-error', `Neznámy typ grafu "${spec.type}"`));
      return;
    }

    let res;
    try {
      res = render2D(stage, spec, visible, { width, height });
    } catch (err) {
      stage.replaceChildren(el('div', 'viz-error', `Graf sa nepodarilo zobraziť: ${err.message}`));
      return;
    }
    stage.replaceChildren(res.node);
    attachHover(stage, res.node, res.hover, spec);
    renderLegendAndNotes(res);
  }

  function renderLegendAndNotes(res) {
    const parts = [];
    // A legend is always present for two or more series; one series has none —
    // the card title already names what is plotted.
    if (res.legend?.length > 1) {
      parts.push(buildLegend(res.legend, label => {
        hidden.has(label) ? hidden.delete(label) : hidden.add(label);
        draw();
      }, hidden));
    }
    if (res.scaleLegend) parts.push(buildScaleLegend(res.scaleLegend, spec.unit));
    if (res.note) parts.push(el('p', 'viz-note', res.note));
    if (res.summary) parts.push(el('p', 'viz-note', res.summary));
    if (spec.note) parts.push(el('p', 'viz-note', spec.note));
    legendHost.replaceChildren(...parts);
  }

  await draw();

  // ── table twin ───────────────────────────────────────────────────────────
  if (spec.table !== false) {
    const cols = columnsFor(spec, columns, rows);
    const details = el('details', 'viz-table-details');
    const summary = el('summary', 'viz-table-summary', 'Tabuľka a export');
    details.appendChild(summary);
    let built = false;
    details.addEventListener('toggle', () => {
      if (details.open && !built) {
        built = true;
        details.appendChild(buildTable(rows, cols, { sortKey: spec.x }));
        details.appendChild(tableTools(spec, rows, cols));
      }
    });
    card.appendChild(details);
  }

  card.appendChild(sourceLine(meta, spec));

  // Re-render on resize so the chart always fits its card.
  const ro = new ResizeObserver(debounce(() => draw(), 150));
  ro.observe(stage);
  card._dispose = () => { ro.disconnect(); if (disposer) disposer(); };

  return card;
}

function tableTools(spec, rows, cols) {
  const tools = el('div', 'viz-table-tools');
  const btn = el('button', 'viz-btn', 'Stiahnuť CSV');
  btn.type = 'button';
  btn.addEventListener('click', () => downloadCSV(`${spec.id}.csv`, rows, cols));
  const count = el('span', 'viz-table-count', `${rows.length} riadkov`);
  tools.append(btn, count);
  return tools;
}

function debounce(fn, ms) {
  let t = null;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
