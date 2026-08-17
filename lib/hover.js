// hover.js — the hover layer.
//
// Tooltips enhance, they never gate: every number shown here is also in the table
// twin under each chart. Four hit models, all driven by the scales Plot exposes on
// the rendered SVG, so hit areas are computed rather than guessed:
//
//   crosshair — line/area: a hairline snaps to the nearest x and the readout lists
//               EVERY series at that x, so the pointer never has to find a 2px line
//   band      — bars/columns/pyramid: each band is the hit target, min 24px
//   nearest   — scatter: closest point wins, so no one has to hit an 8px dot
//   cell      — heatmap: the cell is the target
//
// Series and category names come from CSV files, so they are inserted with
// textContent only — never through innerHTML.

import { tokens, MARKS } from './theme.js';
import { formatterFor, monthLong } from './format.js';

const MIN_HIT = 24;

/** Build the shared tooltip element (one per chart card). */
function makeTip() {
  const tip = document.createElement('div');
  tip.className = 'viz-tip';
  tip.setAttribute('role', 'status');
  tip.setAttribute('aria-live', 'polite');
  tip.hidden = true;
  return tip;
}

function tipRow(label, value, color, mark = 'line') {
  const row = document.createElement('div');
  row.className = 'viz-tip-row';
  if (color) {
    const key = document.createElement('span');
    key.className = mark === 'rect' ? 'viz-tip-key viz-tip-key-rect' : 'viz-tip-key';
    key.style.background = color;
    row.appendChild(key);
  }
  // Value leads: the reader already knows the series and wants the number.
  const v = document.createElement('span');
  v.className = 'viz-tip-value';
  v.textContent = value;
  const l = document.createElement('span');
  l.className = 'viz-tip-label';
  l.textContent = label;
  row.append(v, l);
  return row;
}

function tipHead(text) {
  const h = document.createElement('div');
  h.className = 'viz-tip-head';
  h.textContent = text;
  return h;
}

/** Place the tooltip inside the card, flipping away from the edges. */
function place(tip, card, px, py) {
  tip.hidden = false;
  const cw = card.clientWidth, ch = card.clientHeight;
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let x = px + 14, y = py - th / 2;
  if (x + tw > cw - 4) x = px - tw - 14;
  if (x < 4) x = 4;
  if (y < 4) y = 4;
  if (y + th > ch - 4) y = ch - th - 4;
  tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

/**
 * Attach hover + keyboard focus to a rendered chart.
 * `stage` is the positioned wrapper holding the SVG; the overlay matches it 1:1.
 */
export function attachHover(stage, plot, hover, spec) {
  if (!hover) return;
  const t = tokens();
  const tip = makeTip();
  stage.appendChild(tip);

  const overlay = document.createElement('div');
  overlay.className = 'viz-overlay';
  stage.appendChild(overlay);

  const rule = document.createElement('div');
  rule.className = 'viz-crosshair';
  rule.hidden = true;
  overlay.appendChild(rule);

  const scale = name => { try { return plot.scale(name); } catch { return null; } };
  const sx = scale('x'), sy = scale('y'), sfx = scale('fx');
  const fmt = formatterFor(spec.unit, spec.decimals);

  const hide = () => { tip.hidden = true; rule.hidden = true; clearActive(); };
  let activeEl = null;
  function clearActive() {
    if (activeEl) { activeEl.classList.remove('viz-hit-active'); activeEl = null; }
  }

  if (hover.kind === 'crosshair') buildCrosshair();
  else if (hover.kind === 'band') buildBands();
  else if (hover.kind === 'nearest') buildNearest();
  else if (hover.kind === 'cell') buildCells();

  overlay.addEventListener('pointerleave', hide);

  // ── crosshair: one readout listing every series at the nearest x ───────────
  function buildCrosshair() {
    if (!sx || !sx.invert) return;
    // Group rows by x once. The key MUST be a primitive: every row parses its own
    // Date instance, so keying the Map by the Date object itself would put each
    // row in its own group and the readout would list one series instead of all.
    const keyOf = v => (v instanceof Date ? v.getTime() : v);
    const byX = new Map();
    for (const r of hover.rows) {
      const k = keyOf(r[hover.spec.x]);
      let g = byX.get(k);
      if (!g) { g = { v: r[hover.spec.x], rows: [] }; byX.set(k, g); }
      g.rows.push(r);
    }
    // Dates and numbers both order with `-`; strings need localeCompare.
    const groups = [...byX.values()].sort((a, b) =>
      (typeof a.v === 'string' ? String(a.v).localeCompare(String(b.v), 'sk') : a.v - b.v));
    const positions = groups.map(g => ({ v: g.v, rows: g.rows, px: sx.apply(g.v) }));

    overlay.tabIndex = 0;
    overlay.setAttribute('role', 'application');
    overlay.setAttribute('aria-label', spec.title || 'Graf');
    let cursor = -1;

    const showAt = i => {
      const p = positions[i];
      if (!p) return;
      cursor = i;
      rule.hidden = false;
      rule.style.transform = `translateX(${Math.round(p.px)}px)`;
      tip.replaceChildren(tipHead(p.v instanceof Date ? monthLong(p.v) : String(p.v)));
      const group = p.rows;
      const order = hover.keys.map(k =>
        group.find(r => !hover.spec.series || r[hover.spec.series] === k) || null);
      order.forEach((r, gi) => {
        if (!r) return;
        tip.appendChild(tipRow(String(hover.keys[gi]), fmt(r[hover.spec.y]),
          hover.colors.get(hover.keys[gi]), hover.stacked ? 'rect' : 'line'));
      });
      if (hover.stacked) {
        const total = group.reduce((s, r) => s + (r[hover.spec.y] || 0), 0);
        const row = tipRow('Celkom', fmt(total), null);
        row.classList.add('viz-tip-total');
        tip.appendChild(row);
      }
      place(tip, stage, p.px, sy ? Math.min(...group.map(r => sy.apply(r[hover.spec.y]) || 0)) : 40);
    };

    overlay.addEventListener('pointermove', e => {
      const px = e.clientX - overlay.getBoundingClientRect().left;
      let best = 0, bd = Infinity;
      positions.forEach((p, i) => { const d = Math.abs(p.px - px); if (d < bd) { bd = d; best = i; } });
      showAt(best);
    });
    overlay.addEventListener('focus', () => showAt(cursor < 0 ? positions.length - 1 : cursor));
    overlay.addEventListener('blur', hide);
    overlay.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight') { showAt(Math.min(positions.length - 1, cursor + 1)); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { showAt(Math.max(0, cursor - 1)); e.preventDefault(); }
      else if (e.key === 'Escape') hide();
    });
  }

  // ── band: the whole band is the target, never just the painted bar ─────────
  function buildBands() {
    const catScale = hover.horizontal ? sy : (sfx || sx);
    if (!catScale) return;
    // Plot exposes bandwidth/step on the scale descriptor as NUMBERS, not getters.
    const bw = catScale.bandwidth ?? catScale.step ?? MIN_HIT;
    const size = Math.max(MIN_HIT, bw + MARKS.surfaceGap * 2);

    for (const cat of hover.cats) {
      const pos = catScale.apply(cat);
      if (pos == null || Number.isNaN(pos)) continue;
      const hit = document.createElement('button');
      hit.type = 'button';
      hit.className = 'viz-hit';
      const centre = pos + bw / 2;
      if (hover.horizontal) {
        hit.style.left = '0px'; hit.style.right = '0px';
        hit.style.top = `${centre - size / 2}px`; hit.style.height = `${size}px`;
      } else {
        hit.style.top = '0px'; hit.style.bottom = '0px';
        hit.style.left = `${centre - size / 2}px`; hit.style.width = `${size}px`;
      }
      // hover.spec.x is always the category column: bars use it directly, and the
      // pyramid/waterfall factories remap their spec before handing it over.
      const rowsHere = hover.rows.filter(r => r[hover.spec.x] === cat);

      hit.setAttribute('aria-label', `${cat}: ` + rowsHere
        .map(r => `${hover.spec.series ? r[hover.spec.series] + ' ' : ''}${fmt(Math.abs(r[hover.spec.y]))}`)
        .join(', '));

      const show = () => {
        clearActive();
        hit.classList.add('viz-hit-active');
        activeEl = hit;
        tip.replaceChildren(tipHead(String(cat)));
        let total = 0;
        for (const key of hover.keys) {
          const r = hover.spec.series
            ? rowsHere.find(x => x[hover.spec.series] === key)
            : rowsHere[0];
          if (!r) continue;
          const v = Math.abs(r[hover.spec.y]);
          total += v;
          tip.appendChild(tipRow(
            hover.spec.series ? String(key) : (spec.yLabel || spec.unit || 'Hodnota'),
            fmt(v), hover.colors.get(key), 'rect'));
        }
        if (hover.stacked && hover.keys.length > 1) {
          const row = tipRow('Celkom', fmt(total), null);
          row.classList.add('viz-tip-total');
          tip.appendChild(row);
        }
        const r = hit.getBoundingClientRect(), o = overlay.getBoundingClientRect();
        place(tip, stage, r.left - o.left + r.width / 2, r.top - o.top + r.height / 2);
      };
      hit.addEventListener('pointerenter', show);
      hit.addEventListener('focus', show);
      hit.addEventListener('blur', hide);
      overlay.appendChild(hit);
    }
  }

  // ── nearest: closest point wins ───────────────────────────────────────────
  function buildNearest() {
    if (!sx || !sy) return;
    const pts = hover.rows.map(r => ({
      r, px: sx.apply(r[hover.spec.x]), py: sy.apply(r[hover.spec.y]),
    })).filter(p => Number.isFinite(p.px) && Number.isFinite(p.py));

    const xFmt = formatterFor(spec.xUnit, spec.xDecimals);
    const show = p => {
      clearActive();
      rule.hidden = true;
      const label = hover.spec.label ? String(p.r[hover.spec.label]) : '';
      tip.replaceChildren();
      if (label) tip.appendChild(tipHead(label));
      tip.appendChild(tipRow(spec.xLabel || spec.xUnit || 'x', xFmt(p.r[hover.spec.x]), null));
      tip.appendChild(tipRow(spec.yLabel || spec.unit || 'y', fmt(p.r[hover.spec.y]),
        hover.colors.get(hover.spec.series ? p.r[hover.spec.series] : hover.keys[0]), 'dot'));
      place(tip, stage, p.px, p.py);
    };
    overlay.addEventListener('pointermove', e => {
      const b = overlay.getBoundingClientRect();
      const mx = e.clientX - b.left, my = e.clientY - b.top;
      let best = null, bd = Infinity;
      for (const p of pts) {
        const d = (p.px - mx) ** 2 + (p.py - my) ** 2;
        if (d < bd) { bd = d; best = p; }
      }
      if (best && bd < 60 ** 2) show(best); else hide();
    });
  }

  // ── cell: the heat cell is the target ─────────────────────────────────────
  function buildCells() {
    if (!sx || !sy) return;
    const bwx = sx.bandwidth ?? 0;
    const bwy = sy.bandwidth ?? 0;
    for (const r of hover.rows) {
      const px = sx.apply(r[hover.spec.x]), py = sy.apply(r[hover.spec.y]);
      if (px == null || py == null) continue;
      const hit = document.createElement('button');
      hit.type = 'button';
      hit.className = 'viz-hit';
      hit.style.left = `${px}px`; hit.style.top = `${py}px`;
      hit.style.width = `${Math.max(bwx, 8)}px`; hit.style.height = `${Math.max(bwy, 8)}px`;
      hit.setAttribute('aria-label',
        `${r[hover.spec.y]}, ${r[hover.spec.x]}: ${fmt(r[hover.spec.value])}`);
      const show = () => {
        clearActive();
        hit.classList.add('viz-hit-active'); activeEl = hit;
        tip.replaceChildren(tipHead(`${r[hover.spec.y]} · ${r[hover.spec.x]}`));
        tip.appendChild(tipRow(spec.unit || 'Hodnota', fmt(r[hover.spec.value]), null));
        place(tip, stage, px + bwx / 2, py + bwy / 2);
      };
      hit.addEventListener('pointerenter', show);
      hit.addEventListener('focus', show);
      hit.addEventListener('blur', hide);
      overlay.appendChild(hit);
    }
  }
}
