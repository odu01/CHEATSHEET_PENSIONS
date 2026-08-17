// charts3d.js — 3D charts, loaded on demand.
//
// The 1.6 MB Plotly gl3d bundle is fetched the first time a 3D view is opened and
// never on any other page, so the 2D pages stay on the ~490 kB d3+Plot pair.
//
// A word on when 3D is the right form: a 3D surface earns its keep for a genuine
// two-parameter response (deficit as a function of retirement age AND fertility),
// where the shape of the response is the finding. It is the wrong form for a
// series over time with a category — that reads better as small multiples or a
// heatmap, because occlusion and perspective make values in the far corner
// unreadable. Both 3D views therefore also ship the heatmap projection and the
// table, so no value is only reachable by rotating a scene.

import { tokens } from './theme.js';
import { formatterFor, monthShort } from './format.js';
import { distinct, extent } from './data.js';

const SRC = 'vendor/plotly-gl3d-3.0.1.min.js';
let loading = null;

/** Load Plotly once; concurrent callers share the same promise. */
export function loadPlotly() {
  if (window.Plotly) return Promise.resolve(window.Plotly);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SRC;
    s.async = true;
    s.onload = () => window.Plotly ? resolve(window.Plotly)
      : reject(new Error('Plotly sa načítal, ale nevytvoril window.Plotly'));
    s.onerror = () => reject(new Error(`Nepodarilo sa načítať ${SRC}`));
    document.head.appendChild(s);
  });
  return loading;
}

/** Plotly layout shared by every 3D scene, in the active mode's tokens. */
function layoutFor(spec, t, opts) {
  const axis = (title, ticks) => ({
    title: { text: title || '', font: { size: 11, color: t.inkSecondary } },
    tickfont: { size: 10, color: t.inkMuted },
    gridcolor: t.grid,
    zerolinecolor: t.axis,
    backgroundcolor: 'rgba(0,0,0,0)',
    showbackground: false,
    linecolor: t.axis,
    ...(ticks || {}),
  });
  // Month numbers on a 3D axis read as bare integers; name them, matching the
  // heatmap that sits beside the surface.
  const monthTicks = spec.xTickFormat === 'monthName'
    ? { tickmode: 'array', tickvals: [1, 3, 5, 7, 9, 11],
        ticktext: [1, 3, 5, 7, 9, 11].map(monthShort) }
    : null;
  return {
    width: opts.width,
    height: opts.height,
    margin: { l: 0, r: 0, t: 8, b: 0 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: "'Inter', system-ui, sans-serif", color: t.inkSecondary },
    showlegend: false,
    scene: {
      xaxis: axis(spec.xLabel ?? spec.x, monthTicks),
      yaxis: axis(spec.yLabel ?? spec.y),
      zaxis: axis(spec.zLabel ?? spec.unit),
      aspectmode: 'cube',
      camera: spec.camera || { eye: { x: 1.7, y: -1.7, z: 0.9 } },
    },
  };
}

const CONFIG = {
  displaylogo: false,
  responsive: false,
  // Keep only the controls that make sense for a static scene.
  modeBarButtonsToRemove: ['toImage', 'resetCameraLastSave3d', 'hoverClosest3d'],
  displayModeBar: 'hover',
};

/** One-hue sequential colourscale from the mode's ramp — never a rainbow. */
function colorscale(t) {
  const ramp = t.mode === 'dark' ? [...t.sequential].reverse() : t.sequential;
  return ramp.map((hex, i) => [i / (ramp.length - 1), hex]);
}

/** Reshape long rows into the z-matrix a surface needs. */
function toMatrix(rows, spec) {
  const xs = distinct(rows, spec.x).sort((a, b) => a - b);
  const ys = distinct(rows, spec.y).sort((a, b) => a - b);
  const index = new Map(rows.map(r => [`${r[spec.x]}|${r[spec.y]}`, r[spec.z ?? spec.value]]));
  const z = ys.map(y => xs.map(x => {
    const v = index.get(`${x}|${y}`);
    return v == null ? null : v;
  }));
  return { xs, ys, z };
}

/**
 * 3D surface over a regular (x, y) grid — the two-parameter response case.
 * Missing cells stay null so Plotly leaves a hole rather than interpolating a
 * value that was never in the data.
 */
async function surface3d(container, spec, rows, opts) {
  const Plotly = await loadPlotly();
  const t = tokens();
  const { xs, ys, z } = toMatrix(rows, spec);
  const fmt = formatterFor(spec.unit, spec.decimals);
  const [lo, hi] = extent(rows, spec.z ?? spec.value);

  const trace = {
    type: 'surface',
    x: xs, y: ys, z,
    colorscale: colorscale(t),
    cmin: lo, cmax: hi,
    connectgaps: false,
    hovertemplate:
      `${spec.xLabel ?? spec.x}: %{x}<br>${spec.yLabel ?? spec.y}: %{y}` +
      `<br><b>%{z:.2f}</b> ${spec.unit ?? ''}<extra></extra>`,
    colorbar: {
      thickness: 10, len: 0.6, outlinewidth: 0,
      tickfont: { size: 10, color: t.inkMuted },
      title: { text: spec.unit ?? '', font: { size: 10, color: t.inkSecondary }, side: 'right' },
    },
    contours: spec.contours === false ? undefined : {
      z: { show: true, usecolormap: true, project: { z: true }, width: 2 },
    },
    lighting: { ambient: 0.75, diffuse: 0.5, specular: 0.08, roughness: 0.9 },
  };

  await Plotly.newPlot(container, [trace], layoutFor(spec, t, opts), CONFIG);
  return {
    dispose: () => Plotly.purge(container),
    summary: `Povrch ${xs.length} × ${ys.length} bodov, rozsah ${fmt(lo)} – ${fmt(hi)}.`,
  };
}

/** 3D scatter — three measured dimensions per observation. */
async function scatter3d(container, spec, rows, opts) {
  const Plotly = await loadPlotly();
  const t = tokens();
  const keys = spec.series ? distinct(rows, spec.series) : [null];
  // Three slots is the all-pairs colour cap; past that fold to one series and
  // let the tooltip carry identity.
  const useColor = keys.length > 1 && keys.length <= 3;

  const traces = (useColor ? keys : [null]).map((k, i) => {
    const sub = k == null ? rows : rows.filter(r => r[spec.series] === k);
    return {
      type: 'scatter3d', mode: 'markers', name: k == null ? (spec.title ?? '') : String(k),
      x: sub.map(r => r[spec.x]), y: sub.map(r => r[spec.y]), z: sub.map(r => r[spec.z]),
      text: sub.map(r => spec.label ? String(r[spec.label]) : ''),
      marker: {
        size: 4.5, color: t.series[i] ?? t.other,
        line: { width: 1.5, color: t.surface },   // the surface ring, in 3D
        opacity: 0.95,
      },
      hovertemplate:
        `%{text}<br>${spec.xLabel ?? spec.x}: %{x}<br>${spec.yLabel ?? spec.y}: %{y}` +
        `<br><b>%{z}</b> ${spec.unit ?? ''}<extra></extra>`,
    };
  });

  await Plotly.newPlot(container, traces, layoutFor(spec, t, opts), CONFIG);
  return {
    dispose: () => Plotly.purge(container),
    legend: useColor ? keys.map((k, i) => ({ label: String(k), color: t.series[i], mark: 'dot' })) : [],
    summary: `${rows.length} bodov v 3 dimenziách.`,
  };
}

export const CHART_TYPES_3D = { surface3d, scatter3d };

export function is3D(type) { return Object.hasOwn(CHART_TYPES_3D, type); }

export function render3D(container, spec, rows, opts) {
  const factory = CHART_TYPES_3D[spec.type];
  if (!factory) throw new Error(`unknown 3D chart type "${spec.type}"`);
  return factory(container, spec, rows, opts);
}
