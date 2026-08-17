// theme.js — RRZ design tokens for charts.
//
// Every categorical hex below is a *snapped* RRZ corporate colour: the brand hue
// angle is held and only OKLCH lightness/chroma were moved, by the minimum amount
// needed to clear the accessibility gates. The raw brand palette does not pass —
// #58595B (gray) sits at OKLCH chroma 0.003 and reads as gray rather than as an
// identity, #997468 (brown) collapses against #D82727 under deuteranopia
// (ΔE 7.8, below the floor of 8), and four of the eight brand colours fall under
// 3:1 against the dark surface. Gray is therefore reserved for "Other/inactive"
// and brown is not a series slot.
//
// Verified with the dataviz validator (OKLab ΔE ×100, Machado-Oliveira-Fernandes
// 2009 at severity 1.0):
//
//   light, adjacent, 6 slots : CVD ΔE 8.3 · normal ΔE 25.3 · all >= 3:1  PASS
//   dark,  adjacent, 6 slots : CVD ΔE 8.2 · normal ΔE 22.4 · all >= 3:1  PASS
//   light, all-pairs, 3 slots: CVD ΔE 8.3 · normal ΔE 17.1              PASS
//   dark,  all-pairs, 3 slots: CVD ΔE 8.2 · normal ΔE 17.1              PASS
//
// Re-run after ANY change: npm run validate:palette

export const SLOT_NAMES = ['blue', 'red', 'green', 'navy', 'gold', 'purple'];

// Brand anchors, kept for documentation and for the validator script.
export const BRAND = {
  blue:   '#13B5EA',
  red:    '#D82727',
  green:  '#37B268',
  navy:   '#3657A7',
  gold:   '#DCB47B',
  purple: '#9C479B',
  gray:   '#58595B',   // reserved: "Other" / inactive, never a series slot
  brown:  '#997468',   // not used: cannot clear the chroma floor as itself
};

export const PALETTE = {
  light: {
    surface:   '#ffffff',
    plane:     '#f4f6fa',
    inkPrimary:   '#0f1a33',
    inkSecondary: '#44536e',
    inkMuted:     '#6b7890',
    grid:      '#e6eaf1',
    axis:      '#c3cbd9',
    border:    'rgba(15,26,51,0.10)',
    // categorical, fixed order — assigned in sequence, never cycled
    series: ['#079fcf', '#d62928', '#31a861', '#3657aa', '#bb8b41', '#9d469c'],
    other:  '#82868e',
    // sequential: one hue (RRZ blue), light -> dark
    sequential: ['#daf3ff', '#c4ecff', '#a7e3ff', '#84d9ff', '#52cdff', '#00c0f9',
                 '#00b1e6', '#009fcf', '#008db7', '#007ba1', '#006a8b', '#005976', '#004962'],
    // ordinal subset: wider steps so order is visible, light end still >= 2:1
    ordinal: ['#00c0f9', '#009fcf', '#007ba1', '#005976'],
    // diverging: warm/cool poles + neutral gray midpoint
    diverging: { low: '#3657aa', mid: '#eef0f4', high: '#d62928' },
    deltaGood: '#006300',
    deltaBad:  '#b3231f',
  },
  dark: {
    surface:   '#1a2949',
    plane:     '#101c36',
    inkPrimary:   '#f2f5fa',
    inkSecondary: '#c2ccdd',
    inkMuted:     '#8f9db6',
    grid:      '#28385c',
    axis:      '#3b4c72',
    border:    'rgba(242,245,250,0.12)',
    series: ['#079fcf', '#da2d2b', '#35ab64', '#4e70bf', '#b7883e', '#a755a5'],
    other:  '#7d8088',
    sequential: ['#004962', '#005976', '#006a8b', '#007ba1', '#008db7', '#009fcf',
                 '#00b1e6', '#00c0f9', '#52cdff', '#84d9ff', '#a7e3ff', '#c4ecff', '#daf3ff'],
    ordinal: ['#84d9ff', '#00c0f9', '#009fcf', '#006a8b'],
    diverging: { low: '#4e70bf', mid: '#2b3b5e', high: '#da2d2b' },
    deltaGood: '#0ca30c',
    deltaBad:  '#e66767',
  },
};

// Status is fixed and never themed: reserved meaning, always shipped with an
// icon + label so the colour never carries the meaning on its own.
export const STATUS = {
  good:     '#0ca30c',
  warning:  '#fab219',
  serious:  '#ec835a',
  critical: '#d03b3b',
};

export const MARKS = {
  barMaxThickness: 24,   // never fill the band — the leftover is air
  barRadius: 4,          // rounded data-end, square at the baseline
  lineWidth: 2,
  markerRadius: 4.5,     // >= 8px diameter
  areaOpacity: 0.10,     // a wash, never a saturated block
  surfaceGap: 2,         // white does the separating, not a stroke
  hairline: 1,
};

export const FONT_STACK =
  "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

let current = null;

/** Resolve the active mode from the document, honouring the toggle then the OS. */
export function activeMode() {
  const stamped = document.documentElement.dataset.theme;
  if (stamped === 'light' || stamped === 'dark') return stamped;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Token set for the active mode. */
export function tokens() {
  const mode = activeMode();
  if (!current || current.mode !== mode) current = { mode, ...PALETTE[mode] };
  return current;
}

/** Invalidate the cached token set (call on theme change). */
export function resetTokens() { current = null; }

/**
 * Colour for series index i. Past the last slot everything folds into "Other" —
 * hues are never cycled or generated, because a 7th generated hue is
 * indistinguishable from an existing slot under CVD.
 */
export function seriesColor(i) {
  const t = tokens();
  return i < t.series.length ? t.series[i] : t.other;
}

/**
 * Stable colour map for a list of series keys. Colour follows the *entity*, so
 * filtering a series out never repaints the survivors: the map is built once
 * from the full key list and reused.
 */
export function colorMap(keys) {
  const map = new Map();
  keys.forEach((k, i) => map.set(k, seriesColor(i)));
  return map;
}

/** Observable Plot `style` block for the active mode. */
export function plotStyle() {
  const t = tokens();
  return {
    background: 'transparent',
    color: t.inkMuted,
    fontFamily: FONT_STACK,
    fontSize: '12px',
    overflow: 'visible',
  };
}

/** Recessive hairline grid + axis options shared by every 2D chart. */
export function axisDefaults() {
  const t = tokens();
  return {
    grid: t.grid,
    stroke: t.axis,
    tickColor: t.inkMuted,
    labelColor: t.inkSecondary,
  };
}
