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
import { frameValues, frameRows, frameWatermark, buildFrameControl } from './frame.js';

/** Chart heights per view size; the container also has to fit the axis band. */
// xxl is for the flow diagram: twelve nodes with room for their labels.
const HEIGHTS = { s: 260, m: 340, l: 440, xl: 540, xxl: 720 };

/**
 * Grid span as a class. The grid is twelve columns and a view declares how many
 * it takes, so every row on a page adds up to twelve and no card is left with a
 * hole beside it. The old values are still understood: "full" was the whole row,
 * "2" was two of three columns.
 */
function spanClass(span) {
  if (span == null) return ' span-12';
  if (span === 'full') return ' span-12';
  if (span === '2' || span === 2) return ' span-8';
  const n = Math.max(3, Math.min(12, Number(span)));
  return Number.isFinite(n) ? ' span-' + n : ' span-12';
}

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
function sourceLine(dataset, spec, extraMetas) {
  const box = el('div', 'viz-source');

  // A KPI row pulls from several datasets, so every one of them gets credited.
  // Showing only the view's own dataset would attribute all four tiles to one
  // source and one vintage.
  const metas = [dataset, ...(extraMetas || [])]
    .filter(Boolean)
    .filter((m, i, a) => a.findIndex(x => x.file === m.file) === i);

  // Anything not measured is flagged, every card, no exception. `badge` lets a
  // dataset name what kind of not-measured it is — a modelled series calibrated
  // on published anchors is a different claim than a made-up sample, and the
  // reader has to be able to tell them apart at a glance.
  const fake = metas.find(m => m.illustrative);
  if (fake) {
    const badge = el('span', 'viz-badge viz-badge-warn');
    badge.append(el('span', 'viz-badge-icon', '⚠'),
      document.createTextNode(' ' + (fake.badge || 'Ilustračné dáta')));
    badge.title = fake.badgeNote
      || 'Vygenerované ukážkové čísla — nie oficiálna štatistika. Nahraď súbor reálnymi dátami.';
    box.appendChild(badge);
  }

  if (metas.length === 1) {
    const m = metas[0];
    const unit = spec?.unit || m.unit;
    const parts = [];
    if (m.source) parts.push('Zdroj: ' + m.source);
    if (m.vintage) parts.push('Vintage: ' + m.vintage);
    if (unit) parts.push('Jednotka: ' + unit);
    if (parts.length) box.appendChild(el('span', 'viz-source-text', parts.join(' · ')));
    // The badge and the source stay visible — provenance is not a disclosure.
    // The long methodological note folds away: on a page with four cards over one
    // dataset it was the same paragraph four times, and it pushed the charts apart.
    if (m.note) {
      const d = el('details', 'viz-source-more');
      d.appendChild(el('summary', 'viz-source-more-sum', 'O dátach'));
      d.appendChild(el('p', 'viz-source-note', m.note));
      box.appendChild(d);
    }
    return box;
  }

  // Several datasets: one line each, so a reader can tell which number came
  // from where. Identical source strings collapse into one entry.
  const seen = new Set();
  const list = el('div', 'viz-source-list');
  for (const m of metas) {
    const key = (m.source || '') + '|' + (m.vintage || '');
    if (seen.has(key)) continue;
    seen.add(key);
    const bits = [];
    if (m.label) bits.push(m.label);
    if (m.vintage) bits.push(m.vintage);
    const row = el('div', 'viz-source-row');
    row.textContent = (m.source ? m.source + ' — ' : '') + bits.join(', ');
    list.appendChild(row);
  }
  box.appendChild(el('span', 'viz-source-text', 'Zdroje:'));
  box.appendChild(list);
  return box;
}

/** "Waiting for data" card: the required CSV shape, spelled out. */
function plannedNotice(meta, spec, shownNotes) {
  const box = el('div', 'viz-planned');
  // The note describes the DATASET, so on a page with three cards over the same
  // planned file it would print three times. Show it on the first card only.
  const repeat = shownNotes?.has(meta.file);
  shownNotes?.add(meta.file);

  const head = el('div', 'viz-planned-head');
  head.append(el('span', 'viz-badge viz-badge-info', 'Čaká na dáta'),
              el('span', 'viz-planned-kind', 'plánovaný graf: ' + (spec.type || '?')));
  box.appendChild(head);

  if (meta.note && !repeat) box.appendChild(el('p', 'viz-planned-note', meta.note));

  box.appendChild(el('p', 'viz-planned-file', 'Súbor: ' + (meta.file || '—')));

  // On a page with several cards over the same planned file the contract is
  // identical, so print it once and point later cards at it.
  if (repeat) {
    box.appendChild(el('p', 'viz-planned-ref', 'Tvar súboru je uvedený pri prvej karte tejto stránky.'));
    return box;
  }

  const cols = Object.entries(meta.columns || {});
  if (cols.length) {
    const table = document.createElement('table');
    table.className = 'viz-planned-cols';
    const head2 = document.createElement('tr');
    for (const h of ['Stĺpec', 'Typ', 'Význam']) {
      const th = document.createElement('th');
      th.textContent = h;
      head2.appendChild(th);
    }
    table.appendChild(head2);
    for (const [name, c] of cols) {
      const tr = document.createElement('tr');
      for (const v of [name, c.type || 'string', c.label || '']) {
        const td = document.createElement('td');
        td.textContent = v;
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    box.appendChild(table);
  }
  return box;
}

/** HTML legend. `mark` mirrors the chart mark: rect for fills, line for lines. */
function buildLegend(items, onToggle, hidden, onEmphasis) {
  const box = el('div', 'viz-legend');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label',
    'Legenda — podržaním zvýrazníte sériu, kliknutím ju skryjete');
  for (const it of items) {
    const btn = el('button', 'viz-legend-item');
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(!hidden.has(it.label)));
    if (hidden.has(it.label)) btn.classList.add('is-off');
    const swatch = el('span', 'viz-legend-swatch viz-legend-' + (it.mark || 'rect'));
    swatch.style.background = it.color;
    btn.append(swatch, el('span', 'viz-legend-label', it.label));
    btn.addEventListener('click', () => onToggle(it.label));

    // Bringing one series forward: on hover AND on keyboard focus, because a
    // reader who tabs through the legend needs the same answer as one who points
    // at it. Nothing is hidden — the rest just recede.
    if (onEmphasis && !hidden.has(it.label)) {
      const on = () => { btn.classList.add('is-emph'); onEmphasis(it.label); };
      const off = () => { btn.classList.remove('is-emph'); onEmphasis(null); };
      btn.addEventListener('pointerenter', on);
      btn.addEventListener('pointerleave', off);
      btn.addEventListener('focus', on);
      btn.addEventListener('blur', off);
    }
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

/**
 * Stat-tile row / hero figure view.
 *
 * A tile may name its own `dataset`: an overview KPI row pulls its numbers from
 * several files (expenditure from one, counts from another), and splitting that
 * into one card per dataset would break the row into three.
 */
function renderTiles(card, spec, rows, bundles) {
  const grid = el('div', 'viz-tiles' + (spec.hero ? ' viz-tiles-hero' : ''));
  for (const tileSpec of spec.tiles || []) {
    const source = tileSpec.dataset ? bundles?.[tileSpec.dataset]?.rows : rows;
    if (!source) {
      grid.appendChild(el('div', 'viz-error',
        `Tile "${tileSpec.label}": dataset "${tileSpec.dataset}" nie je načítaný.`));
      continue;
    }
    const sub = applyTransforms(source, tileSpec.transform);
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
  const card = el('section', 'viz-card' + spanClass(spec.span));
  card.id = 'view-' + spec.id;

  const head = el('header', 'viz-card-head');
  head.appendChild(el('h3', 'viz-card-title', spec.title));
  if (spec.subtitle) head.appendChild(el('p', 'viz-card-sub', spec.subtitle));
  card.appendChild(head);

  const { rows: rawRows, columns, meta } = bundle;

  // Declared but not yet delivered: show what the card will be and exactly what
  // the file has to contain. Better than an empty chart, and it means the page
  // structure can be reviewed before the data exists.
  if (bundle.planned) {
    card.appendChild(plannedNotice(meta, spec, opts.shownNotes));
    return card;
  }
  // A frame slices the dataset BEFORE the view's transforms and the pipeline runs
  // once per frame. It cannot be a filter applied afterwards: the pyramid's
  // pipeline ends in `aggregate by [vekova_skupina, pohlavie]`, which drops the
  // year column — filtering after that found no year, drew no control, and
  // silently summed ten years into one pyramid.
  //
  // Running the pipeline per frame is also what makes the fixed scales honest:
  // the domain comes from the union of the per-frame results, not from one pass
  // over all rows (which for an aggregating pipeline would be ten years summed).
  const frameKey = v => (v instanceof Date ? v.getTime() : v);
  const frames = spec.frame ? frameValues(rawRows, spec.frame) : [];
  const framed = frames.length > 1;

  let rows;
  const perFrame = new Map();
  try {
    if (framed) {
      for (const v of frames) {
        perFrame.set(frameKey(v),
          applyTransforms(frameRows(rawRows, spec.frame, v), spec.transform));
      }
      rows = [...perFrame.values()].flat();
    } else {
      rows = applyTransforms(rawRows, spec.transform);
    }
  } catch (err) {
    card.appendChild(el('div', 'viz-error', `Chyba transformácie: ${err.message}`));
    return card;
  }

  // ── tiles / table-only views take a short path ───────────────────────────
  if (spec.type === 'tiles') {
    // A KPI row does not stretch: matched to a 600px chart beside it, the card
    // would be mostly void. Short and compact beats tall and empty.
    card.classList.add('viz-card-compact');
    renderTiles(card, spec, rows, opts.bundles);
    const tileMetas = (spec.tiles || [])
      .map(t => t.dataset && opts.bundles?.[t.dataset]?.meta)
      .filter(Boolean);
    card.appendChild(sourceLine(meta, spec, tileMetas));
    return card;
  }
  if (spec.type === 'table') {
    const cols = columnsFor(spec, columns, rows, meta?.columns);
    card.appendChild(buildTable(rows, cols, { sortKey: spec.sortKey, sortDir: spec.sortDir }));
    card.appendChild(tableTools(spec, rows, cols));
    card.appendChild(sourceLine(meta, spec));
    return card;
  }

  // ── chart views ──────────────────────────────────────────────────────────
  const stage = el('div', 'viz-stage');
  stage.style.minHeight = (HEIGHTS[spec.size || 'm']) + 'px';
  card.appendChild(stage);

  // Posúvanie musí byť povedané, nie objavené: na dotykovej ploche nie je
  // posuvník vidieť, kým sa jej niekto nedotkne.
  const panHint = spec.minWidth
    ? el('p', 'viz-pan-hint', 'Graf je širší než obrazovka — posúva sa nabok.') : null;
  if (panHint) { panHint.hidden = true; card.appendChild(panHint); }

  // The frame control sits between the chart and the legend: it belongs to this
  // chart (it is an encoding channel, like the crosshair), not to the page — page
  // filters stay in the one filter row above everything.
  const frameHost = el('div', 'viz-frame-host');
  card.appendChild(frameHost);

  const legendHost = el('div', 'viz-legend-host');
  card.appendChild(legendHost);

  const hidden = new Set(spec.hidden || []);
  let emphasised = null;
  let disposer = null;

  // ── frame: time as a slider ──────────────────────────────────────────────
  let frameCtl = null;
  if (framed) {
    frameCtl = buildFrameControl(frames, () => draw(), { label: spec.frameLabel || 'Čas' });
    frameHost.appendChild(frameCtl.node);
  }

  async function draw() {
    if (disposer) { disposer(); disposer = null; }
    const avail = Math.max(280, stage.clientWidth || card.clientWidth - 32 || 640);
    // Niektorý graf má dolnú hranicu, pod ktorou už nie je grafom: prúdový
    // diagram s dvanástimi stavmi nesie názvy po oboch stranách a na telefóne
    // sa do 366 px nezmestia ani pri najlepšej vôli. Namiesto zmenšovania na
    // nečitateľné sa nakreslí v minimálnej šírke a posúva sa v rámci karty —
    // vlastný posuvník, takže stránka sama nabok neuteká.
    const width = Math.max(avail, spec.minWidth || 0);
    const pan = width > avail + 1;
    stage.classList.toggle('viz-stage-pan', pan);
    if (panHint) panHint.hidden = !pan;
    const height = HEIGHTS[spec.size || 'm'];

    // Hidden series are filtered from the DATA, but the colour map was built from
    // the full key list, so the survivors keep their hue.
    const seriesKey = spec.series;
    let visible = seriesKey && hidden.size
      ? rows.filter(r => !hidden.has(String(r[seriesKey])))
      : rows;

    // One frame at a time, but the SCALES come from every frame — see frame.js.
    // The chart factory reads opts.allRows for its domains, so playing the
    // animation moves the marks and never the axes.
    let frameOpts = {};
    if (frameCtl) {
      const at = frameCtl.index();
      const keep = list => (seriesKey && hidden.size
        ? list.filter(r => !hidden.has(String(r[seriesKey]))) : list);
      frameOpts = { allRows: visible };
      // Trails and ghosts come from the per-frame results, not from filtering the
      // frame column: after an aggregate that column may not exist any more.
      if (spec.trail) {
        frameOpts.trailRows = frames.slice(0, at + 1)
          .flatMap(v => keep(perFrame.get(frameKey(v)) || []));
      }
      if (spec.ghost) {
        // Every earlier frame as a faint outline, oldest faintest — at the end
        // of the animation the whole path is on screen at once.
        frameOpts.ghostFrames = frames.slice(0, at).map((v, i) => ({
          rows: keep(perFrame.get(frameKey(v)) || []),
          opacity: 0.10 + 0.30 * ((i + 1) / Math.max(1, at)),
        }));
      }
      visible = keep(perFrame.get(frameKey(frames[at])) || []);
    }

    if (is3D(spec.type)) {
      const host = el('div', 'viz-3d');
      stage.replaceChildren(host);
      try {
        const res = await render3D(host, spec, visible, { width, height, ...frameOpts });
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
      res = render2D(stage, spec, visible, { width, height, emphasis: emphasised, ...frameOpts });
    } catch (err) {
      stage.replaceChildren(el('div', 'viz-error', `Graf sa nepodarilo zobraziť: ${err.message}`));
      return;
    }
    stage.replaceChildren(res.node);
    // Vo posúvateľnej ploche by `max-width: 100%` graf stiahol späť na šírku
    // okna a celé to vyšlo naprázdno.
    if (pan) { res.node.style.maxWidth = 'none'; res.node.style.width = width + 'px'; }
    // The big translucent frame value: while the animation plays it is the only
    // thing saying which moment is on screen, and it is what a screenshot keeps.
    if (frameCtl) stage.appendChild(frameWatermark(frameCtl.value(), spec.frameCorner || 'right'));
    attachHover(stage, res.node, res.hover, spec);
    // Prekryvná vrstva sa inak roztiahne len na viditeľné okno plochy, takže v
    // odsunutej časti by kurzor nič nenašiel.
    if (pan) stage.querySelector('.viz-overlay')?.style.setProperty('width', width + 'px');
    renderLegendAndNotes(res);
  }

  function renderLegendAndNotes(res) {
    const parts = [];
    // A legend is always present for two or more series; one series has none —
    // the card title already names what is plotted.
    if (res.legend?.length > 1) {
      parts.push(buildLegend(res.legend, label => {
        hidden.has(label) ? hidden.delete(label) : hidden.add(label);
        emphasised = null;
        draw();
      }, hidden, is3D(spec.type) ? null : label => {
        // 3D scenes rebuild their whole scene graph; re-rendering one on every
        // pointer move over the legend is not worth the emphasis.
        if (emphasised === label) return;
        emphasised = label;
        draw();
      }));
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
    const cols = columnsFor(spec, columns, rows, meta?.columns);
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
  card._dispose = () => { ro.disconnect(); frameCtl?.dispose(); if (disposer) disposer(); };

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
