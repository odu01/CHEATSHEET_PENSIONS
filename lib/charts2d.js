// charts2d.js — 2D chart factories over Observable Plot.
//
// Every factory returns { node, legend, hits } where `legend` drives the HTML
// legend built by view.js and `hits` are pixel-space hover targets consumed by
// attachHover(). Plot's own legend and tip are deliberately not used: the legend
// needs to live in HTML so it can be a real toggle, and the tooltip has to list
// every series at a position rather than only the mark under the pointer.
//
// Mark specs are fixed here, not per chart: 2px lines, bars capped at 24px with a
// 4px rounded data-end, a 2px surface gap between touching fills, a 2px surface
// ring on dots, hairline solid gridlines. See MARKS in theme.js.

import { tokens, MARKS, colorMap } from './theme.js';
import { tickFormatter, formatterFor, int, num } from './format.js';
import { distinct, extent } from './data.js';

const P = () => window.Plot;

/** Approximate pixel width of a tick label, for margin sizing. */
const textWidth = s => String(s).length * 6.6 + 4;

/**
 * Inset that caps a band-scale mark at MARKS.barMaxThickness.
 *
 * The padding has to be in the formula. d3's band scale gives
 *   step = inner / (n - paddingInner + 2 * paddingOuter)
 *   bandwidth = step * (1 - paddingInner)
 * and Plot's `padding` option sets both paddings to the same value. Sizing the
 * inset off the raw step instead over-insets badly when there are few, wide
 * bands: with 7 categories across 1600px it subtracted more than the bandwidth
 * and every bar collapsed to zero width — the chart drew its labels and no bars.
 */
function bandInset(plotSize, categories, margins, padding = 0.22) {
  const inner = Math.max(1, plotSize - margins);
  const n = Math.max(1, categories);
  const step = inner / (n - padding + 2 * padding);
  const bandwidth = step * (1 - padding);
  return Math.max(0, (bandwidth - MARKS.barMaxThickness) / 2);
}

/**
 * Shared plot frame: hairline solid grid, recessive axes, no chart-drawn legend.
 * `xType` lets a caller force a band scale for categorical bars.
 */
function frame({ width, height, t, xLabel, yLabel, xTickFormat, yTickFormat,
                 xType, yType, xDomain, yDomain, marginLeft, marginBottom, marginTop, marginRight }) {
  return {
    width, height,
    marginLeft: marginLeft ?? 52,
    marginRight: marginRight ?? 16,
    marginTop: marginTop ?? 12,
    marginBottom: marginBottom ?? 34,
    style: {
      background: 'transparent',
      color: t.inkMuted,
      fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      fontSize: '12px',
      overflow: 'visible',
    },
    x: {
      label: xLabel ?? null, labelArrow: 'none', labelAnchor: 'center',
      tickFormat: xTickFormat, type: xType, domain: xDomain,
      tickSize: 0, tickPadding: 8,
    },
    y: {
      label: yLabel ?? null, labelArrow: 'none', labelAnchor: 'top',
      tickFormat: yTickFormat, type: yType, domain: yDomain,
      grid: true, tickSize: 0, tickPadding: 6,
    },
    color: { legend: false },
  };
}

/**
 * Hairline grid, in the mode's recessive gray. Solid, one step off the surface.
 *
 * Deliberately does NOT add an explicit axis mark. Adding Plot.axisY() here
 * suppresses the implicit axis and replaces it with one that carries none of the
 * scale's options — which silently threw away tickFormat and labelArrow, so every
 * y axis printed d3's English default ("2,300", "7.5") instead of Slovak, and the
 * label grew an arrow that was explicitly turned off.
 */
function chrome(t, { yZero = false } = {}) {
  const marks = [
    P().gridY({ stroke: t.grid, strokeWidth: MARKS.hairline, strokeOpacity: 1, strokeDasharray: null }),
  ];
  if (yZero) marks.push(P().ruleY([0], { stroke: t.axis, strokeWidth: MARKS.hairline }));
  return marks;
}

/** Series keys in stable first-seen order, plus their fixed colours. */
function seriesOf(rows, spec) {
  const keys = spec.series ? distinct(rows, spec.series) : [spec.yLabel || spec.y];
  return { keys, colors: colorMap(keys) };
}

function legendFor(keys, colors, markKind) {
  return keys.map(k => ({ label: String(k), color: colors.get(k), mark: markKind }));
}

// ─── line ────────────────────────────────────────────────────────────────────

function line(container, spec, rows, opts) {
  const t = tokens();
  const { keys, colors } = seriesOf(rows, spec);
  const yFmt = tickFormatter(spec.unit);              // axis ticks: short
  const labelFmt = formatterFor(spec.unit, spec.decimals);  // end labels: exact
  const clean = rows.filter(r => r[spec.y] != null);
  const [, hi] = extent(clean, spec.y);
  const [lo] = extent(clean, spec.y);

  const marginLeft = Math.max(44, textWidth(yFmt(hi)) + 18);
  const single = keys.length === 1;

  const marks = [
    ...chrome(t, { yZero: lo < 0 }),
    P().line(clean, {
      x: spec.x, y: spec.y,
      z: spec.series, stroke: spec.series ? spec.series : () => colors.get(keys[0]),
      strokeWidth: MARKS.lineWidth, strokeLinejoin: 'round', strokeLinecap: 'round',
      curve: spec.curve || 'linear',
    }),
  ];

  // End-dot + selective direct label. Only up to 4 series get labels, and only
  // when their end values are far enough apart that the labels won't collide —
  // past that the legend and tooltip carry identity instead.
  const ends = keys.map(k => {
    const s = spec.series ? clean.filter(r => r[spec.series] === k) : clean;
    return s.length ? s[s.length - 1] : null;
  }).filter(Boolean);

  marks.push(P().dot(ends, {
    x: spec.x, y: spec.y,
    fill: spec.series ? spec.series : () => colors.get(keys[0]),
    r: MARKS.markerRadius, stroke: t.surface, strokeWidth: MARKS.surfaceGap,
  }));

  const yVals = ends.map(r => r[spec.y]).sort((a, b) => a - b);
  const span = (hi - lo) || 1;
  const crowded = yVals.some((v, i) => i > 0 && (v - yVals[i - 1]) / span < 0.07);
  if (keys.length <= 4 && !crowded && spec.directLabels !== false) {
    marks.push(P().text(ends, {
      x: spec.x, y: spec.y, text: d => labelFmt(d[spec.y]),
      dx: 10, textAnchor: 'start', fill: t.inkPrimary, fontWeight: 600, fontSize: 11,
    }));
  }

  const plot = P().plot({
    ...frame({ width: opts.width, height: opts.height, t,
      xLabel: spec.xLabel, yLabel: spec.yLabel ?? spec.unit,
      xTickFormat: spec.xTickFormat === 'year' ? (d => String(d)) : undefined,
      yTickFormat: yFmt, marginLeft, marginTop: 26,
      marginRight: keys.length <= 4 && !crowded ? 72 : 20,
    }),
    color: { domain: keys, range: keys.map(k => colors.get(k)), legend: false },
    marks,
  });

  return {
    node: plot,
    legend: single ? [] : legendFor(keys, colors, 'line'),
    hover: { kind: 'crosshair', rows: clean, spec, keys, colors },
  };
}

// ─── area / stacked area ─────────────────────────────────────────────────────

function area(container, spec, rows, opts) {
  const t = tokens();
  const stacked = spec.type === 'area-stacked';
  const { keys, colors } = seriesOf(rows, spec);
  const yFmt = tickFormatter(spec.unit);
  const clean = rows.filter(r => r[spec.y] != null);

  // For a stack the axis must span the total, not the largest single series.
  let hi;
  if (stacked) {
    const totals = new Map();
    for (const r of clean) totals.set(r[spec.x], (totals.get(r[spec.x]) || 0) + r[spec.y]);
    hi = Math.max(...totals.values());
  } else {
    hi = extent(clean, spec.y)[1];
  }
  const marginLeft = Math.max(44, textWidth(yFmt(hi)) + 18);

  const marks = [...chrome(t)];

  if (stacked) {
    // The surface-coloured stroke between bands *is* the 2px surface gap: with
    // stacked areas there is no free space to leave, so the separator is drawn
    // in the surface colour rather than as an outline in the series colour.
    marks.push(P().areaY(clean, P().stackY({
      x: spec.x, y: spec.y, z: spec.series, fill: spec.series,
      stroke: t.surface, strokeWidth: MARKS.surfaceGap, curve: spec.curve || 'linear',
    })));
  } else {
    marks.push(P().areaY(clean, {
      x: spec.x, y: spec.y, z: spec.series,
      fill: spec.series ? spec.series : () => colors.get(keys[0]),
      fillOpacity: MARKS.areaOpacity, curve: spec.curve || 'linear',
    }));
    marks.push(P().line(clean, {
      x: spec.x, y: spec.y, z: spec.series,
      stroke: spec.series ? spec.series : () => colors.get(keys[0]),
      strokeWidth: MARKS.lineWidth, strokeLinejoin: 'round', strokeLinecap: 'round',
      curve: spec.curve || 'linear',
    }));
  }

  const plot = P().plot({
    ...frame({ width: opts.width, height: opts.height, t,
      xLabel: spec.xLabel, yLabel: spec.yLabel ?? spec.unit,
      xTickFormat: spec.xTickFormat === 'year' ? (d => String(d)) : undefined,
      yTickFormat: yFmt, marginLeft, marginTop: 26,
      yDomain: stacked ? [0, hi * 1.04] : undefined }),
    color: { domain: keys, range: keys.map(k => colors.get(k)), legend: false },
    marks,
  });

  return {
    node: plot,
    legend: keys.length > 1 ? legendFor(keys, colors, 'rect') : [],
    hover: { kind: 'crosshair', rows: clean, spec, keys, colors, stacked },
  };
}

// ─── column / bar / stacked / grouped ────────────────────────────────────────

function bars(container, spec, rows, opts) {
  const t = tokens();
  const horizontal = spec.type === 'bar' || spec.type === 'bar-stacked-h';
  const stacked = spec.type === 'bar-stacked' || spec.type === 'bar-stacked-h';
  const grouped = spec.type === 'bar-grouped';
  const { keys, colors } = seriesOf(rows, spec);
  const vFmt = tickFormatter(spec.unit);
  const valueFmt = formatterFor(spec.unit, spec.decimals);
  const clean = rows.filter(r => r[spec.y] != null);
  const cats = distinct(clean, spec.x);

  // Totals decide the value-axis domain for a stack.
  let hi;
  if (stacked) {
    const totals = new Map();
    for (const r of clean) totals.set(r[spec.x], (totals.get(r[spec.x]) || 0) + r[spec.y]);
    hi = Math.max(...totals.values());
  } else hi = extent(clean, spec.y)[1];
  const lo = Math.min(0, extent(clean, spec.y)[0]);
  const allPositive = lo >= 0;

  // One-sided rounding only makes sense when every bar grows from one baseline;
  // with negative values present the data-end is not always the same side.
  const round = allPositive ? MARKS.barRadius : 0;

  const shared = {
    fill: spec.series ? spec.series : () => colors.get(keys[0]),
  };

  let marks, plotOpts;

  // Band padding lives here so the inset calculation and the scale agree.
  const PAD_H = 0.28, PAD_V = 0.22;

  if (horizontal) {
    const marginLeft = Math.max(60, Math.max(...cats.map(c => textWidth(c))) + 14);
    const inset = bandInset(opts.height, cats.length * (grouped ? keys.length : 1), 46, PAD_H);
    const barOpts = {
      x: spec.y, y: spec.x, ...shared,
      insetTop: stacked ? 0 : inset, insetBottom: stacked ? 0 : inset,
      rx2: round,
      ...(stacked ? { insetLeft: MARKS.surfaceGap / 2, insetRight: MARKS.surfaceGap / 2 } : {}),
    };
    marks = [
      P().gridX({ stroke: t.grid, strokeWidth: MARKS.hairline, strokeDasharray: null }),
      stacked ? P().barX(clean, P().stackX(barOpts)) : P().barX(clean, barOpts),
      P().ruleX([0], { stroke: t.axis, strokeWidth: MARKS.hairline }),
    ];
    if (!stacked && !grouped && spec.directLabels !== false) {
      marks.push(P().text(clean, {
        x: spec.y, y: spec.x, text: d => valueFmt(d[spec.y]),
        dx: 8, textAnchor: 'start', fill: t.inkPrimary, fontWeight: 600, fontSize: 11,
      }));
    }
    plotOpts = frame({ width: opts.width, height: opts.height, t,
      xLabel: spec.yLabel ?? spec.unit, yLabel: null,
      xTickFormat: vFmt, marginLeft,
      marginRight: (!stacked && !grouped) ? 68 : 20,
      yType: 'band', xDomain: [lo, hi * 1.04] });
    plotOpts.y = { ...plotOpts.y, grid: false, domain: cats, padding: PAD_H };
  } else {
    const marginLeft = Math.max(44, textWidth(vFmt(hi)) + 18);
    const inset = bandInset(opts.width, cats.length * (grouped ? keys.length : 1), marginLeft + 20, PAD_V);
    const barOpts = {
      x: spec.x, y: spec.y, ...shared,
      insetLeft: stacked ? MARKS.surfaceGap / 2 : inset,
      insetRight: stacked ? MARKS.surfaceGap / 2 : inset,
      ry2: round,
      ...(stacked ? { insetTop: MARKS.surfaceGap / 2, insetBottom: MARKS.surfaceGap / 2 } : {}),
      ...(grouped ? { fx: spec.x, x: spec.series } : {}),
    };
    marks = [
      ...chrome(t, { yZero: !allPositive }),
      stacked ? P().barY(clean, P().stackY(barOpts)) : P().barY(clean, barOpts),
      P().ruleY([0], { stroke: t.axis, strokeWidth: MARKS.hairline }),
    ];
    if (!stacked && !grouped && cats.length <= 14 && spec.directLabels !== false) {
      marks.push(P().text(clean, {
        x: spec.x, y: spec.y, text: d => valueFmt(d[spec.y]),
        dy: -9, fill: t.inkPrimary, fontWeight: 600, fontSize: 11,
      }));
    }
    plotOpts = frame({ width: opts.width, height: opts.height, t,
      xLabel: spec.xLabel, yLabel: spec.yLabel ?? spec.unit,
      yTickFormat: vFmt, marginLeft, marginTop: 24,
      xType: 'band', yDomain: [lo, hi * (allPositive ? 1.08 : 1.04)] });
    plotOpts.x = { ...plotOpts.x, domain: grouped ? keys : cats, padding: PAD_V };
    if (grouped) plotOpts.fx = { domain: cats, label: spec.xLabel ?? null, padding: 0.18, tickSize: 0 };
  }

  const plot = P().plot({
    ...plotOpts,
    color: { domain: keys, range: keys.map(k => colors.get(k)), legend: false },
    marks,
  });

  return {
    node: plot,
    legend: keys.length > 1 ? legendFor(keys, colors, 'rect') : [],
    hover: { kind: 'band', rows: clean, spec, keys, colors, cats, horizontal, stacked },
  };
}

// ─── scatter ─────────────────────────────────────────────────────────────────

function scatter(container, spec, rows, opts) {
  const t = tokens();
  const { keys, colors } = seriesOf(rows, spec);
  // All-pairs CVD caps a scatter at 3 slots; past that the reader cannot
  // separate the marks, so the extra series are folded rather than coloured.
  const capped = keys.length > 3;
  const xFmt = tickFormatter(spec.xUnit), yFmt = tickFormatter(spec.unit);
  const clean = rows.filter(r => r[spec.x] != null && r[spec.y] != null);

  const marginLeft = Math.max(44, textWidth(yFmt(extent(clean, spec.y)[1])) + 18);

  const marks = [
    P().gridX({ stroke: t.grid, strokeWidth: MARKS.hairline, strokeDasharray: null }),
    ...chrome(t),
    P().dot(clean, {
      x: spec.x, y: spec.y,
      fill: spec.series && !capped ? spec.series : () => colors.get(keys[0]),
      // NOT spec.size — that is the card height ("s"/"m"/"l"), and passing the
      // string "l" as a radius made Plot draw no dots at all.
      r: spec.dotRadius ?? MARKS.markerRadius,
      stroke: t.surface, strokeWidth: MARKS.surfaceGap,
    }),
  ];

  // Selective direct labels: label the points named in `highlight`, not all of
  // them. A name beside every dot in a 24-point cloud is unreadable, but a reader
  // looking at a country comparison still has to be able to find their own.
  const highlight = [].concat(spec.highlight || []);
  if (highlight.length && spec.label) {
    const picked = clean.filter(r => highlight.includes(r[spec.label]));
    marks.push(
      P().dot(picked, {
        x: spec.x, y: spec.y, r: (spec.dotRadius ?? MARKS.markerRadius) + 3,
        fill: 'none', stroke: t.inkPrimary, strokeWidth: 1.5,
      }),
      P().text(picked, {
        x: spec.x, y: spec.y, text: spec.label,
        dy: -14, fill: t.inkPrimary, fontWeight: 700, fontSize: 11,
      }),
    );
  }

  const plot = P().plot({
    ...frame({ width: opts.width, height: opts.height, t,
      xLabel: spec.xLabel ?? spec.xUnit, yLabel: spec.yLabel ?? spec.unit,
      xTickFormat: xFmt, yTickFormat: yFmt, marginLeft, marginTop: 26 }),
    // inset pads the range, not the domain, so extreme points and their 2px
    // surface rings never sit flush against the frame edge
    x: { label: spec.xLabel ?? spec.xUnit, labelArrow: 'none', tickFormat: xFmt,
         tickSize: 0, tickPadding: 8, inset: 14 },
    y: { label: spec.yLabel ?? spec.unit, labelArrow: 'none', labelAnchor: 'top',
         tickFormat: yFmt, grid: true, tickSize: 0, tickPadding: 6, inset: 14 },
    color: { domain: keys, range: keys.map(k => colors.get(k)), legend: false },
    marks,
  });

  return {
    node: plot,
    legend: keys.length > 1 && !capped ? legendFor(keys, colors, 'dot') : [],
    note: capped
      ? 'Zobrazené ako jedna séria: v bodovom grafe môžu byť susedmi ktorékoľvek dva body, a taký test (all-pairs CVD) bezpečne prejdú najviac 3 farby. Sériu nájdeš v tabuľke pod grafom.'
      : null,
    hover: { kind: 'nearest', rows: clean, spec, keys, colors },
  };
}

// ─── heatmap ─────────────────────────────────────────────────────────────────

function heatmap(container, spec, rows, opts) {
  const t = tokens();
  const clean = rows.filter(r => r[spec.value] != null);
  const xs = distinct(clean, spec.x), ys = distinct(clean, spec.y);
  const [lo, hi] = extent(clean, spec.value);
  const valueFmt = formatterFor(spec.unit, spec.decimals);
  const diverging = spec.scale === 'diverging';

  // +18 for the rotated y label sitting outside the tick column
  const marginLeft = Math.max(56, Math.max(...ys.map(v => textWidth(v))) + 12) + (spec.yLabel ? 18 : 0);
  const cellW = (opts.width - marginLeft - 20) / xs.length;
  const cellH = (opts.height - 52) / ys.length;
  const fits = cellW > 44 && cellH > 22;

  const colorScale = diverging
    ? { type: 'diverging', pivot: spec.pivot ?? 0, scheme: undefined,
        range: [t.diverging.low, t.diverging.mid, t.diverging.high], legend: false }
    : { type: 'linear', domain: [lo, hi], range: [t.sequential[1], t.sequential[t.sequential.length - 2]], legend: false };

  const marks = [
    P().cell(clean, {
      x: spec.x, y: spec.y, fill: spec.value,
      inset: MARKS.surfaceGap / 2, rx: 2,
    }),
  ];
  // A value in every cell is only legible when the cells are big enough; the
  // table twin carries them otherwise.
  if (fits) {
    const inkFor = cellInkPicker(colorScale.range, lo, hi, t, diverging, spec.pivot ?? 0);
    marks.push(P().text(clean, {
      x: spec.x, y: spec.y, text: d => valueFmt(d[spec.value]),
      fill: d => inkFor(d[spec.value]),
      fontSize: 11, fontWeight: 600,
    }));
  }

  const plot = P().plot({
    ...frame({ width: opts.width, height: opts.height, t,
      // The x label is anchored left rather than centred: on a top axis a centred
      // label lands on top of the middle tick values.
      xLabel: spec.xLabel, yLabel: null, marginLeft, marginTop: 44 }),
    x: { label: spec.xLabel ?? null, labelArrow: 'none', labelAnchor: 'left',
         domain: xs, tickSize: 0, tickPadding: 6, axis: 'top' },
    // 'center' rotates the y label along the axis. Left at the default 'top' it
    // shares the top-left corner with a left-anchored x label and the two
    // overlap into one unreadable string.
    y: { label: spec.yLabel ?? null, labelArrow: 'none', labelAnchor: 'center',
         domain: ys, tickSize: 0, tickPadding: 6, grid: false },
    color: colorScale,
    marks,
  });

  return {
    node: plot,
    legend: [],
    scaleLegend: { lo, hi, unit: spec.unit, diverging, pivot: spec.pivot ?? 0 },
    hover: { kind: 'cell', rows: clean, spec, xs, ys },
  };
}

/**
 * White or ink for a label sitting inside a filled cell — the one place a label
 * may wear a colour other than a text token, because it has to clear the fill
 * beneath it.
 *
 * Which end of the ramp is dark is NOT assumed: in dark mode the sequential ramp
 * is reversed, so "high value" means a light fill there and a dark one in light
 * mode. The decision is made from the measured luminance of the interpolated
 * fill, which is right in both modes and for a diverging scale too.
 */
function cellInkPicker(range, lo, hi, t, diverging, pivot) {
  const lum = hex => {
    const c = String(hex).replace('#', '');
    const [r, g, b] = [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16) / 255)
      .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const interp = window.d3?.interpolateRgb;

  return v => {
    let fill;
    if (diverging) {
      const arm = v >= pivot ? [range[1], range[2]] : [range[1], range[0]];
      const span = v >= pivot ? (hi - pivot) || 1 : (lo - pivot) || -1;
      const f = Math.min(1, Math.abs((v - pivot) / span));
      fill = interp ? interp(arm[0], arm[1])(f) : arm[1];
    } else {
      const f = Math.min(1, Math.max(0, (v - lo) / ((hi - lo) || 1)));
      fill = interp ? interp(range[0], range[range.length - 1])(f) : range[range.length - 1];
    }
    // relative luminance of the fill decides; 0.4 sits between the two inks
    const L = fill.startsWith('#') ? lum(fill) : lumFromRgbString(fill);
    return L < 0.4 ? '#ffffff' : t.inkPrimary;
  };
}

/** d3.interpolateRgb returns "rgb(r, g, b)" — measure that form too. */
function lumFromRgbString(s) {
  const m = s.match(/(\d+(?:\.\d+)?)/g);
  if (!m) return 1;
  const [r, g, b] = m.slice(0, 3).map(v => Number(v) / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// ─── population pyramid ──────────────────────────────────────────────────────

function pyramid(container, spec, rows, opts) {
  const t = tokens();
  const clean = rows.filter(r => r[spec.value] != null);
  const bands = distinct(clean, spec.y);
  const sexes = distinct(clean, spec.series);
  const colors = colorMap(sexes);
  const vFmt = tickFormatter(spec.unit);

  const left = sexes[0];
  // Mirror the first group onto the negative side; the axis shows magnitudes.
  const mirrored = clean.map(r => ({
    ...r, __v: r[spec.series] === left ? -r[spec.value] : r[spec.value],
  }));
  const hi = Math.max(...mirrored.map(r => Math.abs(r.__v)));

  const plot = P().plot({
    ...frame({ width: opts.width, height: opts.height, t,
      xLabel: spec.xLabel ?? spec.unit, marginLeft: 54, marginTop: 22 }),
    x: { label: spec.xLabel ?? spec.unit, labelArrow: 'none',
         domain: [-hi * 1.05, hi * 1.05], tickFormat: d => vFmt(Math.abs(d)),
         tickSize: 0, tickPadding: 6, grid: true },
    y: { domain: bands, label: null, tickSize: 0, tickPadding: 6, padding: 0.16 },
    color: { domain: sexes, range: sexes.map(s => colors.get(s)), legend: false },
    marks: [
      P().gridX({ stroke: t.grid, strokeWidth: MARKS.hairline, strokeDasharray: null }),
      P().barX(mirrored, {
        x: '__v', y: spec.y, fill: spec.series,
        insetTop: 1, insetBottom: 1,
      }),
      P().ruleX([0], { stroke: t.axis, strokeWidth: MARKS.hairline }),
      P().text([{ l: sexes[0] }], { frameAnchor: 'top-left', dx: 6, dy: -14,
        text: 'l', fill: t.inkSecondary, fontWeight: 700, fontSize: 11 }),
      P().text([{ l: sexes[1] }], { frameAnchor: 'top-right', dx: -6, dy: -14,
        text: 'l', fill: t.inkSecondary, fontWeight: 700, fontSize: 11 }),
    ],
  });

  return {
    node: plot,
    legend: legendFor(sexes, colors, 'rect'),
    hover: { kind: 'band', rows: mirrored, spec: { ...spec, x: spec.y, y: spec.value },
             keys: sexes, colors, cats: bands, horizontal: true, stacked: false, pyramid: true },
  };
}

// ─── waterfall ───────────────────────────────────────────────────────────────

function waterfall(container, spec, rows, opts) {
  const t = tokens();
  const clean = rows.filter(r => r[spec.y] != null);
  const valueFmt = formatterFor(spec.unit, spec.decimals);
  const vFmt = tickFormatter(spec.unit);

  // Increments and decrements encode polarity, so they take the diverging poles,
  // not categorical slots; totals are neutral.
  let cum = 0;
  const steps = clean.map(r => {
    const isTotal = spec.totalFlag ? !!r[spec.totalFlag] : false;
    const v = r[spec.y];
    const from = isTotal ? 0 : cum;
    const to = isTotal ? v : cum + v;
    if (!isTotal) cum = to;
    else cum = v;
    return { ...r, __from: Math.min(from, to), __to: Math.max(from, to),
             __v: v, __total: isTotal,
             __kind: isTotal ? 'total' : v >= 0 ? 'rast' : 'pokles' };
  });

  const hi = Math.max(...steps.map(s => s.__to));
  const lo = Math.min(0, ...steps.map(s => s.__from));
  const cats = steps.map(s => s[spec.x]);
  const marginLeft = Math.max(44, textWidth(vFmt(hi)) + 18);
  const PAD = 0.24;
  const inset = bandInset(opts.width, cats.length, marginLeft + 20, PAD);

  const kindColor = { rast: t.diverging.high, pokles: t.diverging.low, total: t.other };

  // Connectors: from each step's running level across to the next step's band.
  // Plot.link maps band categories to band centres, so a link between adjacent
  // categories draws the horizontal tie line waterfalls are read by.
  const links = steps.slice(0, -1).map((s, i) => ({
    from: s[spec.x], to: steps[i + 1][spec.x],
    level: s.__total ? s.__v : s.__to,
  }));

  const plot = P().plot({
    ...frame({ width: opts.width, height: opts.height, t,
      xLabel: spec.xLabel, yLabel: spec.yLabel ?? spec.unit,
      yTickFormat: vFmt, marginLeft, marginTop: 26, marginBottom: 44 }),
    x: { domain: cats, label: spec.xLabel ?? null, labelArrow: 'none', tickSize: 0, tickPadding: 8, padding: PAD },
    y: { domain: [lo, hi * 1.1], label: spec.yLabel ?? spec.unit, labelArrow: 'none',
         tickFormat: vFmt, grid: true, tickSize: 0, tickPadding: 6 },
    marks: [
      P().gridY({ stroke: t.grid, strokeWidth: MARKS.hairline, strokeDasharray: null }),
      // connectors first, so the bars sit on top of them
      P().link(links, {
        x1: 'from', x2: 'to', y1: 'level', y2: 'level',
        stroke: t.axis, strokeWidth: MARKS.hairline,
      }),
      P().barY(steps, {
        x: spec.x, y1: '__from', y2: '__to',
        fill: d => kindColor[d.__kind],
        insetLeft: inset, insetRight: inset, ry2: MARKS.barRadius,
      }),
      P().ruleY([0], { stroke: t.axis, strokeWidth: MARKS.hairline }),
      P().text(steps, {
        x: spec.x, y: '__to', text: d => (d.__total ? '' : d.__v > 0 ? '+' : '−') + valueFmt(Math.abs(d.__v)),
        dy: -9, fill: t.inkPrimary, fontWeight: 600, fontSize: 11,
      }),
    ],
  });

  return {
    node: plot,
    legend: [
      { label: 'Rast', color: kindColor.rast, mark: 'rect' },
      { label: 'Pokles', color: kindColor.pokles, mark: 'rect' },
      { label: 'Úroveň', color: kindColor.total, mark: 'rect' },
    ],
    hover: { kind: 'band', rows: steps, spec: { ...spec, y: '__v' }, keys: ['__v'],
             colors: new Map([['__v', t.inkSecondary]]), cats, horizontal: false, stacked: false },
  };
}

export const CHART_TYPES = {
  line, area, 'area-stacked': area,
  column: bars, bar: bars, 'bar-stacked': bars, 'bar-stacked-h': bars, 'bar-grouped': bars,
  scatter, heatmap, pyramid, waterfall,
};

export function is2D(type) { return Object.hasOwn(CHART_TYPES, type); }

/** Render a 2D chart into `container`. */
export function render2D(container, spec, rows, opts) {
  const factory = CHART_TYPES[spec.type];
  if (!factory) throw new Error(`unknown 2D chart type "${spec.type}"`);
  return factory(container, spec, rows, opts);
}
