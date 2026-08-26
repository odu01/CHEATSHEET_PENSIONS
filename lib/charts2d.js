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

import { tokens, MARKS, colorMap, FONT_STACK } from './theme.js';
import { tickFormatter, formatterFor, int, num, monthTickFormatter, monthShort } from './format.js';
import { distinct, extent } from './data.js';
import { sankeyLayout, ribbonPath } from './sankey.js';

const P = () => window.Plot;

/** Primitive key for grouping by a value that may be a Date. */
const groupKey = v => (v instanceof Date ? v.getTime() : v);

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

/**
 * x-axis tick format. `xTickFormat: "year"` stops a year being printed with a
 * thousands separator; `"month"` switches a time scale to year-only labels over
 * a long span, instead of Plot's English month abbreviations.
 */
function xTicks(spec, rows) {
  if (spec.xTickFormat === 'year') return d => String(d);
  if (spec.xTickFormat === 'month') {
    const xs = rows.map(r => r[spec.x]).filter(d => d instanceof Date);
    const span = xs.length ? (Math.max(...xs) - Math.min(...xs)) / (1000 * 3600 * 24 * 30.44) : 0;
    return monthTickFormatter(span);
  }
  return undefined;
}

/**
 * Opacity accessor for "one series forward, the rest back".
 *
 * Emphasis is not hiding: the recessive series stay on screen at ~1/5 ink, so
 * the reader keeps the context they were comparing against. Returns a constant
 * when nothing is emphasised, so Plot sees no function and does no extra work.
 */
function emphasis(spec, opts, base = 1) {
  const on = opts?.emphasis;
  if (!on || !spec.series) return base;
  return d => (String(d[spec.series]) === on ? base : base * 0.18);
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
  const { keys, colors } = seriesOf(opts.allRows || rows, spec);
  const clean = rows.filter(r => r[spec.y] != null);
  // Domains from every frame, not just the one on screen: an axis that grows
  // while the animation plays turns the reader's attention into a lie.
  const [lo, hi] = extent(opts.allRows ? opts.allRows.filter(r => r[spec.y] != null) : clean, spec.y);
  const yFmt = tickFormatter(spec.unit, [lo, hi]);           // axis ticks: short
  const labelFmt = formatterFor(spec.unit, spec.decimals);   // end labels: exact

  const marginLeft = Math.max(44, textWidth(yFmt(hi)) + 18);
  const single = keys.length === 1;

  const marks = [
    ...chrome(t, { yZero: lo < 0 }),
    P().line(clean, {
      x: spec.x, y: spec.y,
      z: spec.series, stroke: spec.series ? spec.series : () => colors.get(keys[0]),
      strokeWidth: MARKS.lineWidth, strokeLinejoin: 'round', strokeLinecap: 'round',
      strokeOpacity: emphasis(spec, opts),
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
      xTickFormat: xTicks(spec, clean),
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
  const { keys, colors } = seriesOf(opts.allRows || rows, spec);
  const yFmt = tickFormatter(spec.unit);
  const clean = rows.filter(r => r[spec.y] != null);
  // With a frame animating, the axis spans every frame — see the note in `line`.
  const domainRows = opts.allRows ? opts.allRows.filter(r => r[spec.y] != null) : clean;

  // For a stack the axis must span the total, not the largest single series.
  let hi;
  if (stacked) {
    const totals = new Map();
    for (const r of domainRows) totals.set(groupKey(r[spec.x]), (totals.get(groupKey(r[spec.x])) || 0) + r[spec.y]);
    hi = Math.max(...totals.values());
  } else {
    hi = extent(domainRows, spec.y)[1];
  }
  const marginLeft = Math.max(44, textWidth(yFmt(hi)) + 18);

  const marks = [...chrome(t)];

  if (stacked) {
    // The surface-coloured stroke between bands *is* the 2px surface gap: with
    // stacked areas there is no free space to leave, so the separator is drawn
    // in the surface colour rather than as an outline in the series colour.
    marks.push(P().areaY(clean, P().stackY({
      x: spec.x, y: spec.y, z: spec.series, fill: spec.series,
      fillOpacity: emphasis(spec, opts),
      stroke: t.surface, strokeWidth: MARKS.surfaceGap, curve: spec.curve || 'linear',
    })));
  } else {
    marks.push(P().areaY(clean, {
      x: spec.x, y: spec.y, z: spec.series,
      fill: spec.series ? spec.series : () => colors.get(keys[0]),
      fillOpacity: emphasis(spec, opts, MARKS.areaOpacity), curve: spec.curve || 'linear',
    }));
    marks.push(P().line(clean, {
      x: spec.x, y: spec.y, z: spec.series,
      stroke: spec.series ? spec.series : () => colors.get(keys[0]),
      strokeWidth: MARKS.lineWidth, strokeLinejoin: 'round', strokeLinecap: 'round',
      strokeOpacity: emphasis(spec, opts), curve: spec.curve || 'linear',
    }));
  }

  const plot = P().plot({
    ...frame({ width: opts.width, height: opts.height, t,
      xLabel: spec.xLabel, yLabel: spec.yLabel ?? spec.unit,
      xTickFormat: xTicks(spec, clean),
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
  const { keys, colors } = seriesOf(opts.allRows || rows, spec);
  const valueFmt = formatterFor(spec.unit, spec.decimals);
  const clean = rows.filter(r => r[spec.y] != null);
  // Categories and the value axis come from every frame — the bars must not
  // reorder or rescale just because one month is on screen.
  const domainRows = opts.allRows ? opts.allRows.filter(r => r[spec.y] != null) : clean;
  const cats = distinct(domainRows, spec.x);
  // The tick formatter needs the axis span, not just the unit: without it a
  // count axis reaching 200 000 prints "20,0 tis." on every tick.
  const vFmt = tickFormatter(spec.unit, extent(domainRows, spec.y));

  // Totals decide the value-axis domain for a stack.
  let hi;
  if (stacked) {
    const totals = new Map();
    for (const r of domainRows) totals.set(groupKey(r[spec.x]), (totals.get(groupKey(r[spec.x])) || 0) + r[spec.y]);
    hi = Math.max(...totals.values());
  } else hi = extent(domainRows, spec.y)[1];
  const lo = Math.min(0, extent(domainRows, spec.y)[0]);
  const allPositive = lo >= 0;

  // One-sided rounding only makes sense when every bar grows from one baseline;
  // with negative values present the data-end is not always the same side.
  const round = allPositive ? MARKS.barRadius : 0;

  const shared = {
    fill: spec.series ? spec.series : () => colors.get(keys[0]),
    fillOpacity: emphasis(spec, opts),
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
  const { keys, colors } = seriesOf(opts.allRows || rows, spec);
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
         domain: xs, tickSize: 0, tickPadding: 6, axis: 'top',
         tickFormat: spec.xTickFormat === 'monthName' ? monthShort : undefined },
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
  const vFmt = tickFormatter(spec.unit, extent(clean, spec.value));

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
    // Only the kinds actually present: a "Pokles" swatch on a chart with no
    // decreases is a legend entry pointing at nothing.
    legend: [
      ['rast', 'Rast'], ['pokles', 'Pokles'], ['total', 'Úroveň'],
    ].filter(([k]) => steps.some(s => s.__kind === k))
     .map(([k, label]) => ({ label, color: kindColor[k], mark: 'rect' })),
    hover: { kind: 'band', rows: steps, spec: { ...spec, y: '__v' }, keys: ['__v'],
             colors: new Map([['__v', t.inkSecondary]]), cats, horizontal: false, stacked: false },
  };
}

// ─── bubbles ─────────────────────────────────────────────────────────────────

/**
 * Bublinový graf: x, y, veľkosť a farba — štyri veličiny naraz, a s `frame`
 * ešte piata, čas. Gapminderov tvar, ktorý má zmysel presne vtedy, keď sa
 * entity v čase HÝBU: druhy dôchodku sa posúvajú doprava (rastie priemer),
 * nahor (rastie počet) a nafukujú sa (rastú výdavky).
 *
 * Farba je all-pairs úloha, takže platí strop tri slotry; nad ním sa farba
 * prestane používať a identitu nesie priamy štítok pri každej bubline. Bublín
 * je v jednej snímke málo, takže štítok pri každej je čitateľný — na rozdiel od
 * bodového grafu s dvadsiatimi bodmi.
 *
 * `trail: true` s `frame` dokreslí cestu, po ktorej sa entita dostala tam, kde
 * je. Bez nej animácia zabudne, čo bolo — a práve cesta je to zaujímavé.
 */
function bubbles(container, spec, rows, opts) {
  const t = tokens();
  const all = opts.allRows || rows;
  const { keys, colors } = seriesOf(all, spec);
  const capped = keys.length > 3;
  const clean = rows.filter(r => r[spec.x] != null && r[spec.y] != null);
  const label = spec.label || spec.series;

  const xFmt = tickFormatter(spec.xUnit, extent(all, spec.x));
  const yFmt = tickFormatter(spec.unit, extent(all, spec.y));
  const marginLeft = Math.max(48, textWidth(yFmt(extent(all, spec.y)[1])) + 18);

  // Škály z celého radu, nie zo snímky — inak sa graf pri prehrávaní nafukuje
  // a rast, ktorý čitateľ vidí, je rast osi.
  const [x0, x1] = extent(all, spec.x);
  const [y0, y1] = extent(all, spec.y);
  // NIE spec.size — to je výška karty ("m"/"l"). Rovnaká pasca už raz zabila
  // bodový graf: reťazec "l" ako polomer a Plot nenakreslil nič.
  const rMax = spec.radius ? extent(all, spec.radius)[1] : null;

  const colorOf = d => (capped ? colors.get(keys[0]) : colors.get(d[spec.series]));
  const marks = [
    P().gridX({ stroke: t.grid, strokeWidth: MARKS.hairline, strokeDasharray: null }),
    ...chrome(t),
  ];

  // Cesta entity v čase: tenká čiara pod bublinami, z riadkov až po túto snímku.
  if (spec.trail && spec.frame && opts.trailRows?.length) {
    marks.push(P().line(opts.trailRows, {
      x: spec.x, y: spec.y, z: spec.series || label,
      stroke: spec.series && !capped ? spec.series : () => colors.get(keys[0]),
      strokeWidth: MARKS.hairline, strokeOpacity: 0.55, curve: 'catmull-rom',
    }));
  }

  marks.push(P().dot(clean, {
    x: spec.x, y: spec.y,
    r: spec.radius || (spec.dotRadius ?? MARKS.markerRadius),
    fill: spec.series && !capped ? spec.series : () => colors.get(keys[0]),
    fillOpacity: emphasis(spec, opts, 0.72),
    stroke: t.surface, strokeWidth: MARKS.surfaceGap,
  }));

  // Štítok pri každej bubline: identita nikdy nie je len farba, a pri troch
  // až šiestich bublinách sa to zmestí.
  if (label && clean.length <= 10) {
    marks.push(P().text(clean, {
      x: spec.x, y: spec.y, text: label,
      dy: -4, lineAnchor: 'bottom', fill: t.inkPrimary, fontWeight: 600, fontSize: 11,
    }));
  }

  const plot = P().plot({
    ...frame({ width: opts.width, height: opts.height, t,
      xLabel: spec.xLabel ?? spec.xUnit, yLabel: spec.yLabel ?? spec.unit,
      xTickFormat: xFmt, yTickFormat: yFmt, marginLeft, marginTop: 28 }),
    x: { label: spec.xLabel ?? spec.xUnit, labelArrow: 'none', tickFormat: xFmt,
         type: spec.xScale, domain: [x0, x1], tickSize: 0, tickPadding: 8, inset: 26 },
    y: { label: spec.yLabel ?? spec.unit, labelArrow: 'none', labelAnchor: 'top',
         tickFormat: yFmt, type: spec.yScale, domain: [y0, y1],
         grid: true, tickSize: 0, tickPadding: 6, inset: 26 },
    r: rMax ? { domain: [0, rMax], range: [3, spec.maxRadius ?? 34] } : undefined,
    color: { domain: keys, range: keys.map(k => colors.get(k)), legend: false },
    marks,
  });

  const logNote = [spec.xScale === 'log' && 'vodorovná', spec.yScale === 'log' && 'zvislá']
    .filter(Boolean).join(' a ');

  return {
    node: plot,
    legend: capped ? [] : legendFor(keys, colors, 'dot'),
    summary: logNote
      ? `Pozor na os: ${logNote} os je logaritmická — rovnaká vzdialenosť znamená rovnaký `
        + 'násobok, nie rovnaký rozdiel. Bez toho by sa menšie bubliny zlepili pri dne.'
      : null,
    note: capped
      ? `Farba by pri ${keys.length} sériách nebola rozlíšiteľná, identitu nesú štítky.`
      : (spec.radius ? 'Veľkosť bubliny: ' + (spec.radiusLabel || spec.radius) : null),
    hover: { kind: 'nearest', rows: clean, spec, keys, colors, extra: spec.radius ? [spec.radius] : [] },
  };
}

// ─── barrank ─────────────────────────────────────────────────────────────────

/**
 * Poradie v čase: vodorovné stĺpce zoradené podľa hodnoty, a pri prehrávaní si
 * poradie vymieňajú. Odpovedá na otázku, ktorú čiarový graf skryje: KTO je
 * najväčší a kedy sa to zmenilo.
 *
 * Farba drží entitu, nie poradie — to je celý zmysel. Keby sa farba priraďovala
 * podľa pozície, pri každej výmene poradia by sa stĺpce prebarvili a nedalo by
 * sa nič sledovať.
 */
function barrank(container, spec, rows, opts) {
  const t = tokens();
  const all = opts.allRows || rows;
  // Rovnaký kontrakt ako `bar`: x je kategória, y je hodnota. Farby sa priradia
  // z VŠETKÝCH kategórií radu, nie zo snímky — entita si tak drží farbu aj keď
  // sa poradie vymení, a to je celý zmysel tohto grafu.
  const cat = spec.x;
  const valueKey = spec.y;
  const catsAll = distinct(all, cat);
  const colors = colorMap(catsAll);
  const clean = rows.filter(r => r[valueKey] != null);

  const ranked = [...clean].sort((a, b) => (b[valueKey] || 0) - (a[valueKey] || 0));
  const hi = extent(all, valueKey)[1] || 1;
  const vFmt = tickFormatter(spec.unit, [0, hi]);
  const valueFmt = formatterFor(spec.unit, spec.decimals);
  const marginLeft = Math.max(...catsAll.map(c => textWidth(String(c)))) + 22;

  const plot = P().plot({
    ...frame({ width: opts.width, height: opts.height, t,
      xLabel: spec.xLabel ?? spec.unit, yLabel: null, xTickFormat: vFmt,
      marginLeft, marginRight: 76, yType: 'band', xDomain: [0, hi * 1.04] }),
    y: { label: null, domain: ranked.map(r => r[cat]), padding: 0.22, grid: false,
         tickSize: 0, tickPadding: 6 },
    color: { domain: catsAll, range: catsAll.map(k => colors.get(k)), legend: false },
    marks: [
      P().gridX({ stroke: t.grid, strokeWidth: MARKS.hairline, strokeDasharray: null }),
      P().barX(ranked, {
        x: valueKey, y: cat, fill: cat,
        ry2: MARKS.barRadius, insetTop: MARKS.surfaceGap / 2, insetBottom: MARKS.surfaceGap / 2,
      }),
      P().text(ranked, {
        x: valueKey, y: cat, text: d => valueFmt(d[valueKey]),
        dx: 8, textAnchor: 'start', fill: t.inkPrimary, fontWeight: 600, fontSize: 11,
      }),
      P().ruleX([0], { stroke: t.axis, strokeWidth: MARKS.hairline }),
    ],
  });

  return {
    node: plot,
    legend: [],       // každý stĺpec má vlastný štítok na osi, legenda by ho zdvojila
    hover: { kind: 'band', rows: ranked, spec,
             keys: [valueKey], colors: new Map([[valueKey, t.inkSecondary]]),
             cats: ranked.map(r => r[cat]), horizontal: true, stacked: false },
  };
}

// ─── mountain ────────────────────────────────────────────────────────────────

/**
 * „Hora": rozdelenie ako plocha nad spojitou osou. Gapminder tak kreslí
 * príjmové rozdelenie sveta; tu je to rozdelenie dôchodkov podľa výšky.
 *
 * Prečo nie histogram: histogram je o pásmach, hora je o tvare. Keď sa cez
 * `frame` prehráva desať rokov, je vidieť presne to, čo je na tom podstatné —
 * celá hora sa sťahuje doprava, ako rástli dôchodky.
 *
 * `ghost: true` nechá za sebou bledé obrysy predchádzajúcich snímok, takže
 * animácia nezabúda: v poslednej snímke vidno celú desaťročnú cestu.
 */
function mountain(container, spec, rows, opts) {
  const t = tokens();
  const all = opts.allRows || rows;
  const { keys, colors } = seriesOf(all, spec);
  const capped = keys.length > 3;      // prekryté priesvitné plochy sa nad 3 zlejú
  const clean = rows.filter(r => r[spec.y] != null)
    .sort((a, b) => (a[spec.x] > b[spec.x] ? 1 : a[spec.x] < b[spec.x] ? -1 : 0));

  const [x0, x1] = extent(all, spec.x);
  const hi = extent(all, spec.y)[1] || 1;
  const xFmt = tickFormatter(spec.xUnit, [x0, x1]);
  const yFmt = tickFormatter(spec.unit, [0, hi]);
  const marginLeft = Math.max(48, textWidth(yFmt(hi)) + 18);
  const curve = spec.curve || 'catmull-rom';

  const marks = [...chrome(t)];

  // Ghosty: predchádzajúce snímky ako tenké obrysy. Kreslia sa prvé, aby
  // zostali pod aktuálnou horou.
  for (const g of (spec.ghost && opts.ghostFrames) || []) {
    marks.push(P().line(g.rows, {
      x: spec.x, y: spec.y, z: spec.series,
      stroke: spec.series && !capped ? spec.series : () => colors.get(keys[0]),
      strokeOpacity: g.opacity, strokeWidth: MARKS.hairline, curve,
    }));
  }

  marks.push(
    P().areaY(clean, {
      x: spec.x, y: spec.y, z: spec.series,
      fill: spec.series && !capped ? spec.series : () => colors.get(keys[0]),
      fillOpacity: emphasis(spec, opts, keys.length > 1 ? 0.42 : 0.2), curve,
    }),
    P().line(clean, {
      x: spec.x, y: spec.y, z: spec.series,
      stroke: spec.series && !capped ? spec.series : () => colors.get(keys[0]),
      strokeWidth: MARKS.lineWidth, curve,
    }),
    P().ruleY([0], { stroke: t.axis, strokeWidth: MARKS.hairline }),
  );

  const plot = P().plot({
    ...frame({ width: opts.width, height: opts.height, t,
      xLabel: spec.xLabel ?? spec.xUnit, yLabel: spec.yLabel ?? spec.unit,
      xTickFormat: xFmt, yTickFormat: yFmt, marginLeft, marginTop: 26,
      xDomain: [x0, x1], yDomain: [0, hi * 1.06] }),
    color: { domain: keys, range: keys.map(k => colors.get(k)), legend: false },
    marks,
  });

  return {
    node: plot,
    legend: keys.length > 1 && !capped ? legendFor(keys, colors, 'rect') : [],
    hover: { kind: 'crosshair', rows: clean, spec, keys, colors },
  };
}

// ─── sankey ──────────────────────────────────────────────────────────────────

/**
 * Prúdový (alluviálny) diagram prechodov medzi stavmi.
 *
 * Odpovedá na otázku, na ktorú stĺpcový ani čiarový graf odpovedať nedokáže: nie
 * „koľko ich bolo v ktorom stave", ale **kto sa kam presunul**. Dva stavy s
 * rovnakým počtom môžu vzniknúť úplne inak — jeden tak, že nikto nikam nešiel,
 * druhý tak, že sa vymenila polovica ľudí.
 *
 * Kontrakt view: `source`, `target`, `value` a `layers` (dva stĺpce, ktoré
 * hovoria, do ktorej vrstvy stav patrí — typicky rok_od a rok_do). Uzol je teda
 * (vrstva, stav), takže „Starobný 2024" a „Starobný 2025" sú dva uzly a diagonála
 * „zostal v tom istom stave" je viditeľný prúd, nie skrytý zvyšok.
 *
 * Farba drží **rodinu zdrojového stavu**, nie jednotlivý stav: stavov je dvanásť,
 * paleta má šesť slotov a prekryté stužky sú na rozlišovanie ešte náchylnejšie
 * než plochy. Identitu preto nesie štítok pri každom uzle — v prúdovom diagrame
 * je aj tak povinný — a farba len ukazuje, odkiaľ prúd tečie.
 */
function sankey(container, spec, rows, opts) {
  const t = tokens();
  const all = opts.allRows || rows;
  const srcKey = spec.source, tgtKey = spec.target, valKey = spec.value;
  const [fromLayer, toLayer] = spec.layers || [];
  const clean = rows.filter(r => r[srcKey] != null && r[tgtKey] != null && r[valKey] > 0);
  if (!clean.length) throw new Error('sankey: žiadne prúdy s hodnotou > 0');

  const layerVal = v => (v instanceof Date ? v.getTime() : Number(v));
  const layerIdx = new Map(
    [...new Set(all.flatMap(r => [layerVal(r[fromLayer]), layerVal(r[toLayer])]))]
      .sort((a, b) => a - b).map((v, i) => [v, i]));

  // Rodina stavu pre farbu: skupina deklarovaná v `groups`, inak stav sám.
  const groupOf = name => (spec.groups && spec.groups[name]) || name;
  // Skupiny sa berú z OBOCH strán prúdu: „Zomretí" sú len cieľ, ale uzol musí
  // mať farbu, a naopak „Nový vstup" je len zdroj.
  const groupKeys = [...new Set(all.flatMap(r => [groupOf(r[srcKey]), groupOf(r[tgtKey])]))];
  // Skupina, ktorá nemá byť sériou (absorpčný stav ako úmrtie), dostane
  // recesívnu sivú z palety — nie ďalší farebný slot.
  const muted = new Set(spec.mutedGroups || []);
  const ordered = spec.groupOrder
    ? [...spec.groupOrder.filter(g => groupKeys.includes(g)),
       ...groupKeys.filter(g => !spec.groupOrder.includes(g))]
    : groupKeys;
  const colors = colorMap(ordered.filter(g => !muted.has(g)));
  for (const g of ordered) if (muted.has(g)) colors.set(g, t.other);

  const valueFmt = formatterFor(spec.unit, spec.decimals);
  const labelOf = (layer, name) => name;

  // Miesto na štítky: prvý stĺpec vľavo, posledný vpravo. Merané, nie hádané —
  // „Predčasný starobný + vdovský" je dlhý názov a odrezaný štítok je chyba.
  const names = [...new Set(all.flatMap(r => [String(r[srcKey]), String(r[tgtKey])]))];
  // Do žľabu sa musí zmestiť názov AJ hodnota: pri nízkom uzle idú na jeden
  // riadok a bez tejto rezervy sa číslo odrezalo o okraj karty.
  const widestValue = textWidth(valueFmt(Math.max(...clean.map(r => r[valKey])) * 20));
  const labelW = Math.min(opts.width * 0.30,
    Math.max(...names.map(textWidth)) + widestValue + 14);
  const padL = labelW, padR = labelW, padT = 10, padB = 10;
  const innerW = Math.max(80, opts.width - padL - padR);
  const innerH = Math.max(120, opts.height - padT - padB);

  const flows = clean.map(r => ({
    from: { layer: layerIdx.get(layerVal(r[fromLayer])), name: String(r[srcKey]) },
    to: { layer: layerIdx.get(layerVal(r[toLayer])), name: String(r[tgtKey]) },
    value: r[valKey],
    row: r,
  }));
  const lay = sankeyLayout(flows, {
    width: innerW, height: innerH,
    nodeWidth: spec.nodeWidth ?? 13, nodePad: spec.nodePad ?? 9,
    order: spec.nodeOrder ? { default: spec.nodeOrder } : {},
  });

  const SVG = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('width', opts.width);
  svg.setAttribute('height', opts.height);
  svg.setAttribute('viewBox', `0 0 ${opts.width} ${opts.height}`);
  svg.setAttribute('font-family', FONT_STACK);
  svg.setAttribute('font-size', '11');
  svg.style.maxWidth = '100%';
  svg.style.height = 'auto';

  const g = document.createElementNS(SVG, 'g');
  g.setAttribute('transform', `translate(${padL},${padT})`);
  svg.appendChild(g);

  const lastLayer = Math.max(...lay.nodes.map(n => n.layer));

  // Stužky prvé, uzly nad nimi: uzol je pevný bod, o ktorý sa oko oprie.
  const hoverRows = [];
  for (const k of lay.links) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', ribbonPath(k, spec.curvature));
    path.setAttribute('fill', colors.get(groupOf(k.source.name)) || t.other);
    path.setAttribute('fill-opacity', String(spec.flowOpacity ?? 0.42));
    // Priehľadný obrys len zväčšuje cieľ pre kurzor: tenký prúd sa inak nedá
    // trafiť a hit target má mať okolo 24 px.
    path.setAttribute('stroke', 'transparent');
    path.setAttribute('stroke-width', '12');
    path.setAttribute('class', 'viz-flow');
    path.setAttribute('data-flow', String(hoverRows.length));
    path.setAttribute('tabindex', '0');
    path.setAttribute('role', 'img');
    const aria = `${k.source.name} → ${k.target.name}: ${valueFmt(k.value)}`;
    path.setAttribute('aria-label', aria);
    hoverRows.push({ head: `${k.source.name} → ${k.target.name}`,
                     rows: [[valueFmt(k.value), spec.unit || '', colors.get(groupOf(k.source.name))]] });
    g.appendChild(path);
  }

  for (const n of lay.nodes) {
    const rect = document.createElementNS(SVG, 'rect');
    rect.setAttribute('x', n.x);
    rect.setAttribute('y', n.y);
    rect.setAttribute('width', n.w);
    rect.setAttribute('height', n.h);
    rect.setAttribute('rx', '2');
    rect.setAttribute('fill', colors.get(groupOf(n.name)) || t.other);
    rect.setAttribute('class', 'viz-flow-node');
    rect.setAttribute('data-flow', String(hoverRows.length));
    rect.setAttribute('tabindex', '0');
    rect.setAttribute('role', 'img');
    const inOut = [];
    if (n.in > 0) inOut.push([valueFmt(n.in), 'prišlo', t.inkSecondary]);
    if (n.out > 0) inOut.push([valueFmt(n.out), 'odišlo', t.inkSecondary]);
    rect.setAttribute('aria-label', `${n.name}: ${valueFmt(n.value)}`);
    hoverRows.push({ head: n.name, rows: [[valueFmt(n.value), spec.unit || '',
      colors.get(groupOf(n.name)) || t.other], ...inOut] });
    g.appendChild(rect);

    const label = document.createElementNS(SVG, 'text');
    const right = n.layer === lastLayer;
    label.setAttribute('x', right ? n.x + n.w + 6 : n.x - 6);
    label.setAttribute('y', n.y + n.h / 2);
    label.setAttribute('text-anchor', right ? 'start' : 'end');
    label.setAttribute('dominant-baseline', 'middle');
    label.setAttribute('fill', t.inkPrimary);
    label.setAttribute('font-weight', '600');
    label.textContent = labelOf(n.layer, n.name);

    // Súčet uzla je v prúdovom diagrame hlavné číslo a z výšky obdĺžnika ho
    // nikto lúštiť nebude. Pri vyššom uzle ide na druhý riadok, pri nízkom sa
    // pripojí za názov — inak by tenké stavy zostali bez čísla.
    const valueText = valueFmt(n.value);
    if (n.h >= 26) {
      const val = document.createElementNS(SVG, 'text');
      val.setAttribute('x', right ? n.x + n.w + 6 : n.x - 6);
      val.setAttribute('y', n.y + n.h / 2 + 12);
      val.setAttribute('text-anchor', right ? 'start' : 'end');
      val.setAttribute('dominant-baseline', 'middle');
      val.setAttribute('fill', t.inkMuted);
      val.setAttribute('font-size', '10');
      val.textContent = valueText;
      g.appendChild(val);
    } else {
      const tail = document.createElementNS(SVG, 'tspan');
      tail.setAttribute('fill', t.inkMuted);
      tail.setAttribute('font-weight', '400');
      // Medzera cez dx, nie cez znak: v SVG texte sa opakované medzery zlievajú
      // a vyšlo „24 002PN (nemocenské)".
      tail.setAttribute('dx', right ? '5' : '-5');
      tail.textContent = valueText;
      if (right) label.appendChild(tail);
      else label.insertBefore(tail, label.firstChild);
    }
    g.appendChild(label);
  }

  // Nadpisy stĺpcov (roky) — bez nich nie je jasné, čo je vľavo a čo vpravo.
  if (spec.layerLabels) {
    for (const [i, text] of spec.layerLabels.entries()) {
      const col = lay.nodes.filter(n => n.layer === i);
      if (!col.length) continue;
      const x = col[0].x + col[0].w / 2;
      const head = document.createElementNS(SVG, 'text');
      head.setAttribute('x', x);
      head.setAttribute('y', -1);
      head.setAttribute('text-anchor', 'middle');
      head.setAttribute('fill', t.inkSecondary);
      head.setAttribute('font-weight', '700');
      head.textContent = text;
      g.appendChild(head);
    }
  }

  return {
    node: svg,
    legend: groupKeys.length > 1
      ? [...colors.keys()].filter(k => groupKeys.includes(k))
          .map(k => ({ label: k, color: colors.get(k), mark: 'rect' }))
      : [],
    summary: `Šírka prúdu je počet osôb; mierka je rovnaká vo všetkých stĺpcoch, `
      + 'takže čo do uzla vteče, z neho aj vytečie.',
    hover: { kind: 'flow', flows: hoverRows },
  };
}

export const CHART_TYPES = {
  line, area, 'area-stacked': area,
  column: bars, bar: bars, 'bar-stacked': bars, 'bar-stacked-h': bars, 'bar-grouped': bars,
  scatter, heatmap, pyramid, waterfall,
  bubbles, barrank, mountain, sankey,
};

export function is2D(type) { return Object.hasOwn(CHART_TYPES, type); }

/** Render a 2D chart into `container`. */
export function render2D(container, spec, rows, opts) {
  const factory = CHART_TYPES[spec.type];
  if (!factory) throw new Error(`unknown 2D chart type "${spec.type}"`);
  return factory(container, spec, rows, opts);
}
