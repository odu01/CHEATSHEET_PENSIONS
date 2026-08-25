// table.js — the table twin and the stat tiles.
//
// Every chart ships a table view. That is what makes a sub-3:1 fill, a dropped
// in-bar label, or a colour-only encoding acceptable: the number is always
// reachable without hovering and without seeing colour at all.
//
// All cell text goes in via textContent — column names and category values come
// from CSV files and are treated as untrusted.

import { formatterFor, int, num, year, isYearColumn, monthLabel, monthISO } from './format.js';
import { tokens } from './theme.js';

/**
 * Build a sortable table. `columns` is [{ key, label, type, unit, decimals }].
 * Numeric columns are right-aligned and use tabular figures so they line up.
 */
export function buildTable(rows, columns, opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'viz-table-wrap';

  const table = document.createElement('table');
  table.className = 'viz-table';
  if (opts.caption) {
    const cap = document.createElement('caption');
    cap.textContent = opts.caption;
    table.appendChild(cap);
  }

  const thead = document.createElement('thead');
  const hrow = document.createElement('tr');
  const state = { key: opts.sortKey ?? null, dir: opts.sortDir ?? 'asc' };

  columns.forEach(col => {
    const th = document.createElement('th');
    th.scope = 'col';
    const numeric = col.type === 'number' || col.type === 'int';
    if (numeric) th.classList.add('num');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'viz-th-sort';
    btn.textContent = col.label ?? col.key;
    if (col.unit) {
      const u = document.createElement('span');
      u.className = 'viz-th-unit';
      u.textContent = col.unit;
      btn.appendChild(u);
    }
    const caret = document.createElement('span');
    caret.className = 'viz-th-caret';
    caret.setAttribute('aria-hidden', 'true');
    btn.appendChild(caret);

    btn.addEventListener('click', () => {
      if (state.key === col.key) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
      else { state.key = col.key; state.dir = numeric ? 'desc' : 'asc'; }
      draw();
    });
    th.appendChild(btn);
    th.setAttribute('aria-sort', 'none');
    hrow.appendChild(th);
  });
  thead.appendChild(hrow);

  const tbody = document.createElement('tbody');
  table.append(thead, tbody);
  wrap.appendChild(table);

  function draw() {
    let out = rows;
    if (state.key) {
      const col = columns.find(c => c.key === state.key);
      // The sort key may be a column that is not displayed — a band table sorts
      // by the band's lower bound while showing only its label. Then there is no
      // declared type to go by, so take it from the value: without this, 0, 300,
      // 400 … sorted as text and put "1000–1100" second.
      const numeric = col
        ? (col.type === 'number' || col.type === 'int')
        : rows.some(r => typeof r[state.key] === 'number');
      const dir = state.dir === 'desc' ? -1 : 1;
      out = [...rows].sort((a, b) => {
        const x = a[state.key], y = b[state.key];
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        if (numeric || (x instanceof Date && y instanceof Date)) return (x - y) * dir;
        return String(x).localeCompare(String(y), 'sk') * dir;
      });
    }

    [...hrow.children].forEach((th, i) => {
      const isSorted = columns[i].key === state.key;
      th.setAttribute('aria-sort', isSorted ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none');
      th.classList.toggle('sorted', isSorted);
      th.classList.toggle('desc', isSorted && state.dir === 'desc');
    });

    const frag = document.createDocumentFragment();
    for (const r of out) {
      const tr = document.createElement('tr');
      for (const col of columns) {
        const td = document.createElement('td');
        const v = r[col.key];
        const numeric = col.type === 'number' || col.type === 'int';
        if (numeric) td.classList.add('num');
        if (v == null) { td.textContent = '—'; td.classList.add('empty'); }
        else if (col.format) td.textContent = col.format(v);
        else if (v instanceof Date) td.textContent = monthLabel(v);
        else if (numeric) td.textContent = formatterFor(col.unit, col.decimals)(v);
        else td.textContent = String(v);
        tr.appendChild(td);
      }
      frag.appendChild(tr);
    }
    tbody.replaceChildren(frag);
  }

  draw();
  return wrap;
}

/** Derive table columns from a view spec + the dataset's column types. */
export function columnsFor(spec, columns, rows, defs) {
  const keys = spec.tableColumns
    || [spec.x, spec.series, spec.y, spec.value].filter(Boolean)
       .filter((k, i, a) => a.indexOf(k) === i);

  return keys.map(k => {
    let type = columns[k] || (typeof rows?.[0]?.[k] === 'number' ? 'number' : 'string');
    if (rows?.[0]?.[k] instanceof Date) type = 'month';
    const label = spec.labels?.[k] || k;
    // A dataset can hold columns in different units — a band table has counts
    // next to euros. The view's unit belongs to the value it plotted, so every
    // other column takes the unit its own column declares in the manifest.
    const def = defs?.[k];
    let unit = (k === spec.y || k === spec.value) ? spec.unit
             : (k === spec.x ? (spec.xUnit ?? def?.unit) : def?.unit);

    // Don't print the unit twice. A manifest often uses the unit AS the label
    // ("% HDP"), which produced headers reading "% HDP  % HDP".
    if (unit && label.toLowerCase().includes(unit.toLowerCase())) unit = undefined;

    let decimals = (k === spec.y || k === spec.value) ? spec.decimals : def?.decimals;
    // An int column is whole by definition. Without this a count printed as
    // "23 281,0" — a decimal on a number of people.
    if (decimals == null && type === 'int') decimals = 0;
    const col = { key: k, label, type, unit, decimals };

    // Years are ordinal labels that happen to be numeric: no separator, no decimals.
    if (isYearColumn(k, columns[k])) { col.format = year; col.unit = undefined; }
    return col;
  });
}

/** Serialise rows to CSV for download. Quotes anything that needs it. */
export function toCSV(rows, columns) {
  const esc = v => {
    if (v == null) return '';
    // Dates go out as "YYYY-MM", not as a locale string: an export has to be
    // re-importable, and toString() would emit "Mon Jan 01 2024 …".
    const s = v instanceof Date ? monthISO(v) : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const head = columns.map(c => esc(c.label ?? c.key)).join(',');
  const body = rows.map(r => columns.map(c => esc(r[c.key])).join(',')).join('\n');
  return head + '\n' + body + '\n';
}

/** Trigger a client-side CSV download. */
export function downloadCSV(filename, rows, columns) {
  // BOM so Excel opens UTF-8 Slovak diacritics correctly
  const blob = new Blob(['﻿' + toCSV(rows, columns)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── stat tiles & hero figure ────────────────────────────────────────────────

/**
 * Stat tile: label (sentence case) · value (semibold, proportional figures) ·
 * optional signed delta against a named period · optional sparkline.
 * Proportional — not tabular — figures: tabular digits make a big number look loose.
 */
export function buildTile(tile) {
  const el = document.createElement('div');
  el.className = 'viz-tile' + (tile.hero ? ' viz-tile-hero' : '');

  const label = document.createElement('div');
  label.className = 'viz-tile-label';
  label.textContent = tile.label;
  el.appendChild(label);

  const value = document.createElement('div');
  value.className = 'viz-tile-value';
  value.textContent = tile.value;
  el.appendChild(value);

  if (tile.delta != null) {
    const d = document.createElement('div');
    // Direction times whether up is good — a rising deficit is not "good" green.
    const good = tile.higherIsBetter === false ? tile.deltaRaw < 0 : tile.deltaRaw > 0;
    d.className = 'viz-tile-delta ' + (tile.deltaRaw === 0 ? '' : good ? 'up-good' : 'up-bad');
    const arrow = document.createElement('span');
    arrow.className = 'viz-tile-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = tile.deltaRaw > 0 ? '▲' : tile.deltaRaw < 0 ? '▼' : '■';
    d.append(arrow, document.createTextNode(' ' + tile.delta));
    if (tile.deltaNote) {
      const n = document.createElement('span');
      n.className = 'viz-tile-delta-note';
      n.textContent = tile.deltaNote;
      d.appendChild(n);
    }
    el.appendChild(d);
  }

  if (tile.note) {
    const n = document.createElement('div');
    n.className = 'viz-tile-note';
    n.textContent = tile.note;
    el.appendChild(n);
  }

  if (tile.spark?.length > 1) el.appendChild(sparkline(tile.spark));
  return el;
}

/** 12-point sparkline: de-emphasised stroke, current point in the accent. */
function sparkline(values, w = 108, h = 26) {
  const t = tokens();
  const pts = values.slice(-12).filter(v => v != null);
  const lo = Math.min(...pts), hi = Math.max(...pts), span = (hi - lo) || 1;
  const step = pts.length > 1 ? w / (pts.length - 1) : w;
  const xy = pts.map((v, i) => [i * step, h - 2 - ((v - lo) / span) * (h - 4)]);

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'viz-spark');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', w); svg.setAttribute('height', h);
  svg.setAttribute('aria-hidden', 'true');

  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', xy.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '));
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', t.inkMuted);
  path.setAttribute('stroke-width', '1.5');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);

  const last = xy[xy.length - 1];
  const dot = document.createElementNS(NS, 'circle');
  dot.setAttribute('cx', last[0]); dot.setAttribute('cy', last[1]); dot.setAttribute('r', '2.75');
  dot.setAttribute('fill', t.series[0]);
  dot.setAttribute('stroke', t.surface); dot.setAttribute('stroke-width', '2');
  svg.appendChild(dot);
  return svg;
}
