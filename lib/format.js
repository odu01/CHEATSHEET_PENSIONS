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
 * Units that count things: whole numbers, no decimals ever. Covers the Slovak
 * words this project actually uses in manifests.
 */
function unitIsCount(u) {
  return /(osôb|osoby|počet|pocet|dôchodk|dochodk|poberateľ|poberatel|platiteľ|platitel|prípad|pripad)/.test(u);
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
  // Counts read as whole numbers at full precision here — this formatter feeds
  // table cells, tooltips and direct labels, where "1 134 690" is the useful
  // answer and "1,1 mil." throws away five digits. Axis ticks compact instead;
  // that is tickFormatter's job.
  if (unitIsCount(u))
    return v => int(v);
  return v => num(v, decimals ?? 1);
}

/**
 * Axis-tick formatter: shorter than the label formatter, and never repeats the
 * unit (the axis label carries it). Ticks land on round numbers, so integers
 * print without a decimal tail.
 */
export function tickFormatter(unit, domain) {
  const u = (unit || '').toLowerCase();
  if (!unitPreScaled(u) && unitIsCount(u)) {
    // Raw counts get compacted, but the number of decimals has to come from the
    // SPAN, not the magnitude. A count axis running 1,46–1,73 million rounded to
    // one decimal printed "1,7 mil." on five consecutive ticks.
    const span = Array.isArray(domain) ? Math.abs(domain[1] - domain[0]) : null;
    const decFor = scale => {
      if (span == null) return 1;
      const steps = span / scale;          // how much of the unit the axis covers
      if (steps >= 5) return 0;
      if (steps >= 0.5) return 1;
      return 2;
    };
    return v => {
      const a = Math.abs(v);
      if (a >= 1e6) return num(v / 1e6, decFor(1e6)) + ' mil.';
      if (a >= 1e4) return num(v / 1e3, decFor(1e3)) + ' tis.';
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

const MONTHS_SK = ['január', 'február', 'marec', 'apríl', 'máj', 'jún',
                   'júl', 'august', 'september', 'október', 'november', 'december'];

/** Month as "12/2024" — compact, unambiguous, and sorts the same as it reads. */
export function monthLabel(v) {
  if (!(v instanceof Date)) return v == null ? '—' : String(v);
  return `${v.getUTCMonth() + 1}/${v.getUTCFullYear()}`;
}

/** Month spelled out, for tooltips where there is room: "december 2024". */
export function monthLong(v) {
  if (!(v instanceof Date)) return v == null ? '—' : String(v);
  return `${MONTHS_SK[v.getUTCMonth()]} ${v.getUTCFullYear()}`;
}

/** Month number 1–12 as a Slovak name; used for heatmap axes. */
export function monthName(n) {
  return MONTHS_SK[Number(n) - 1] || String(n);
}

/** Short month name, for a crowded categorical axis. */
export function monthShort(n) {
  const s = MONTHS_SK[Number(n) - 1];
  return s ? s.slice(0, 3) : String(n);
}

/**
 * Axis tick formatter for a time scale. Over a long span only the year is worth
 * printing; Plot's default would fall back to English month abbreviations.
 */
export function monthTickFormatter(spanMonths) {
  if (spanMonths > 36) return d => (d instanceof Date ? String(d.getUTCFullYear()) : String(d));
  return monthLabel;
}

/** ISO "YYYY-MM" — what a Date must look like in a CSV export. */
export function monthISO(v) {
  if (!(v instanceof Date)) return v == null ? '' : String(v);
  return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}`;
}
