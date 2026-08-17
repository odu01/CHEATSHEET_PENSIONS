// format.js — Slovak number, percent and currency formatting.
// Slovak convention: non-breaking space as the thousands separator, comma as the
// decimal separator. Intl handles both; we only pick the options.

const cache = new Map();

function nf(opts) {
  const key = JSON.stringify(opts);
  let f = cache.get(key);
  if (!f) { f = new Intl.NumberFormat('sk-SK', opts); cache.set(key, f); }
  return f;
}

/** Fixed-decimal number, e.g. 1 234,5 */
export function num(v, decimals = 1) {
  if (v == null || Number.isNaN(v)) return '—';
  return nf({ minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v);
}

/** Integer with thousands separators. */
export function int(v) {
  if (v == null || Number.isNaN(v)) return '—';
  return nf({ maximumFractionDigits: 0 }).format(Math.round(v));
}

/** Percent, value already in percent units (2.7 -> "2,7 %"). */
export function pct(v, decimals = 1) {
  if (v == null || Number.isNaN(v)) return '—';
  return num(v, decimals) + ' %';
}

/** Percent from a share (0.027 -> "2,7 %"). */
export function share(v, decimals = 1) {
  return pct(v == null ? v : v * 100, decimals);
}

/** Euro amount. */
export function eur(v, decimals = 0) {
  if (v == null || Number.isNaN(v)) return '—';
  return nf({ style: 'currency', currency: 'EUR', minimumFractionDigits: decimals,
              maximumFractionDigits: decimals }).format(v);
}

/**
 * Compact form for stat tiles and axis ticks: 1 284 / 12,9 tis. / 4,2 mld.
 * Slovak scale words, because "12.9K" reads as English on a Slovak page.
 */
export function compact(v, decimals = 1) {
  if (v == null || Number.isNaN(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return num(v / 1e9, decimals) + ' mld.';
  if (a >= 1e6) return num(v / 1e6, decimals) + ' mil.';
  if (a >= 1e4) return num(v / 1e3, decimals) + ' tis.';
  return int(v);
}

/** Signed delta for stat tiles, e.g. "+2,4 p. b." */
export function delta(v, unit = '', decimals = 1) {
  if (v == null || Number.isNaN(v)) return '—';
  const s = v > 0 ? '+' : v < 0 ? '−' : '';
  return s + num(Math.abs(v), decimals) + (unit ? ' ' + unit : '');
}

/**
 * True when the unit string already states the scale ("tis. osôb", "mil. EUR").
 * Such values must NOT be rescaled again: a column of thousands under the label
 * "tis. osôb" holds 2300 meaning 2,300 thousand, and compacting it to "2 tis."
 * would both lose two digits and re-apply a scale the label already carries.
 */
function unitPreScaled(u) {
  return /\b(tis|mil|mld)\.?\s/.test(u) || /^(tis|mil|mld)\.?$/.test(u.trim());
}

/**
 * Formatter resolved from a unit string declared in the manifest. Keeps the
 * manifest declarative — a view says `"unit": "% HDP"` and the right formatter
 * follows, so no view needs to carry a format function.
 *
 * This is the FULL-precision formatter: direct labels, tooltips and table cells.
 * For axis ticks use tickFormatter().
 */
export function formatterFor(unit, decimals) {
  const u = (unit || '').toLowerCase();
  if (u.includes('%') || u.includes('p. b.') || u.includes('p.b.'))
    return v => num(v, decimals ?? 1) + ' %';
  if (u.startsWith('eur') || u.includes('€'))
    return v => eur(v, decimals ?? 0);
  if (u.includes('index'))
    return v => num(v, decimals ?? 1);
  if (unitPreScaled(u))
    return v => num(v, decimals ?? 1);
  if (u.includes('osôb') || u.includes('počet') || u.includes('osoby'))
    return v => compact(v, decimals ?? 1);   // raw head-counts do get compacted
  return v => num(v, decimals ?? 1);
}

/**
 * Axis-tick formatter: shorter than the label formatter, and never repeats the
 * unit (the axis label carries it). Ticks land on round numbers, so integers
 * print without a decimal tail.
 */
export function tickFormatter(unit) {
  const u = (unit || '').toLowerCase();
  if (!unitPreScaled(u) && (u.includes('osôb') || u.includes('počet'))) {
    // genuinely raw counts: 1 200 000 -> "1,2 mil."
    return v => {
      const a = Math.abs(v);
      if (a >= 1e6) return num(v / 1e6, 1) + ' mil.';
      if (a >= 1e4) return num(v / 1e3, 0) + ' tis.';
      return int(v);
    };
  }
  return v => Number.isInteger(v) ? int(v) : num(v, 1);
}

/** Year range label, e.g. "2024–2070". */
export function yearRange(a, b) { return `${a}–${b}`; }

/**
 * A year is an ordinal label that happens to be a number: no thousands separator
 * and no decimals. Without this a year column renders as "2 010,0".
 */
export function year(v) {
  return v == null || Number.isNaN(v) ? '—' : String(Math.round(v));
}

/** True when a column holds years, by declared type or by its name. */
export function isYearColumn(name, type) {
  return type === 'year' || /^(rok|year|rok_?od|rok_?do)$/i.test(String(name));
}
