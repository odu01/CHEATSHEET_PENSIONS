// data.js — dataset loading and typing.
//
// Everything the app draws comes through here, so the rest of the code only ever
// sees an array of plain row objects with real JS types. Adding data means adding
// a CSV plus a manifest entry; no code change.

const cache = new Map();      // url -> Promise<rows>

const DELIMITERS = { csv: ',', tsv: '\t', txt: '\t' };

/** Detect the delimiter from the extension, falling back to sniffing the header. */
function delimiterFor(url, header) {
  const ext = url.split('.').pop().toLowerCase();
  if (DELIMITERS[ext]) return DELIMITERS[ext];
  const counts = [[',', 0], [';', 0], ['\t', 0]].map(([d]) => [d, header.split(d).length]);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Parse delimited text. Handles quoted fields with embedded delimiters, escaped
 * quotes ("") and CRLF. Small enough to read, which matters more here than
 * pulling in a parser dependency for files this simple.
 */
export function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [], field = '', quoted = false, i = 0;
  // strip a UTF-8 BOM: Excel writes one and it corrupts the first column name
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { quoted = true; i++; continue; }
    if (c === delimiter) { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r.length === 1 && r[0].trim() !== ''));
}

/**
 * Coerce one cell. Empty and the usual "missing" markers become null rather than
 * 0 or NaN — a gap in a series must render as a gap, not as a drop to zero.
 */
export function coerce(raw, type) {
  const v = typeof raw === 'string' ? raw.trim() : raw;
  if (v === '' || v == null || v === '.' || v === '..' || v === '-' || v === 'NA' || v === 'n/a') return null;
  switch (type) {
    case 'int': {
      const n = parseInt(String(v).replace(/[\s ]/g, ''), 10);
      return Number.isNaN(n) ? null : n;
    }
    case 'number': {
      // accept both "1234.5" and the Slovak "1 234,5"
      const s = String(v).replace(/[\s ]/g, '').replace(',', '.');
      const n = Number(s);
      return Number.isNaN(n) ? null : n;
    }
    case 'bool':
      return /^(true|1|ano|yes|y)$/i.test(String(v));
    case 'month': {
      // "2024-01" -> Date at the 1st, UTC. A real Date lets Plot use a time
      // scale: 208 months on a band scale would print 208 ticks and the
      // crosshair's numeric ordering would compare strings.
      const m = /^(\d{4})-(\d{1,2})/.exec(String(v));
      if (!m) return null;
      return new Date(Date.UTC(+m[1], +m[2] - 1, 1));
    }
    case 'date': {
      const d = new Date(String(v));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    // A year is a number, even though it is printed like a label. Left as a
    // string it lands on an ordinal x scale: 55 years of data print 55 ticks
    // into one another, and Plot draws a warning glyph into the chart.
    // format.year() handles the printing (no separator, no decimals).
    case 'year': {
      const n = parseInt(String(v).replace(/[\s ]/g, ''), 10);
      return Number.isNaN(n) ? null : n;
    }
    default:
      return String(v);
  }
}

/** Infer a column type from a sample of values, when the manifest omits it. */
function inferType(values) {
  const seen = values.filter(v => v !== '' && v != null).slice(0, 50);
  if (!seen.length) return 'string';
  const numeric = seen.every(v => {
    const s = String(v).replace(/[\s ]/g, '').replace(',', '.');
    return s !== '' && !Number.isNaN(Number(s));
  });
  if (!numeric) return 'string';
  return seen.every(v => /^-?\d+$/.test(String(v).replace(/[\s ]/g, ''))) ? 'int' : 'number';
}

/**
 * Load a dataset declared in the manifest. Returns { rows, columns, meta }.
 * `columns` maps name -> type, so downstream code never re-sniffs.
 */
export function loadDataset(def, baseUrl = '') {
  // A dataset marked `planned` has no file yet: the manifest declares the shape
  // it will arrive in so the page and its data contract are visible, and the
  // card renders as "waiting for data" rather than as a broken chart.
  if (def.planned) {
    const columns = {};
    for (const [name, c] of Object.entries(def.columns || {})) columns[name] = c.type || 'string';
    return Promise.resolve({ rows: [], columns, meta: def, planned: true });
  }
  const url = baseUrl + def.file;
  if (!cache.has(url)) cache.set(url, fetchDataset(url, def));
  return cache.get(url);
}

async function fetchDataset(url, def) {
  const resp = await fetch(url, { cache: 'no-cache' });
  if (!resp.ok) throw new Error(`${url}: HTTP ${resp.status}`);

  if (url.endsWith('.json')) {
    const json = await resp.json();
    const rows = Array.isArray(json) ? json : json.rows;
    if (!Array.isArray(rows)) throw new Error(`${url}: JSON must be an array of rows, or {rows: [...]}`);
    const columns = {};
    for (const name of Object.keys(rows[0] || {}))
      columns[name] = def.columns?.[name]?.type || inferType(rows.map(r => r[name]));
    return { rows, columns, meta: def };
  }

  const text = await resp.text();
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
  const grid = parseDelimited(text, delimiterFor(url, firstLine));
  if (!grid.length) throw new Error(`${url}: empty file`);

  const header = grid[0].map(h => h.trim());
  const body = grid.slice(1);

  const columns = {};
  header.forEach((name, i) => {
    columns[name] = def.columns?.[name]?.type || inferType(body.map(r => r[i]));
  });

  let rows = body.map(r => {
    const o = {};
    header.forEach((name, i) => { o[name] = coerce(r[i], columns[name]); });
    return o;
  });

  rows = reshape(rows, def, columns);
  decode(rows, def);
  return { rows, columns, meta: def };
}

/**
 * Wide → long on load, when the dataset declares `shape`.
 *
 * A spreadsheet handed over by a human almost always has time across the top —
 * one column per year — because that is how a person fills a table. The site
 * wants long format. Reshaping at LOAD time rather than per view means the
 * charts, the transforms and the table twin never learn about it, and the person
 * supplying the data does not have to pivot anything.
 *
 *   "shape": { "kind": "wide", "keep": ["vek"], "into": "rok", "value": "pocet" }
 */
function reshape(rows, def, columns) {
  const sh = def.shape;
  if (!sh || sh.kind !== 'wide') return rows;
  const keep = sh.keep || [];
  const intoName = sh.into || 'kategoria';
  const valueName = sh.value || 'hodnota';
  const intoType = def.columns?.[intoName]?.type || 'string';
  const valueType = def.columns?.[valueName]?.type || 'number';

  const out = [];
  for (const r of rows) {
    for (const [k, v] of Object.entries(r)) {
      if (keep.includes(k)) continue;
      if (sh.only && !sh.only.includes(k)) continue;
      if (v == null || v === '') continue;
      const o = {};
      for (const kk of keep) o[kk] = r[kk];
      o[intoName] = coerce(k, intoType);
      o[valueName] = coerce(v, valueType);
      out.push(o);
    }
  }
  for (const k of Object.keys(columns)) if (!keep.includes(k)) delete columns[k];
  columns[intoName] = intoType;
  columns[valueName] = valueType;
  return out;
}

/**
 * Codes → labels, from the codelist the manifest declares.
 *
 * Data files carry short codes, metadata carries the words. That is how every
 * serious statistical release works (SDMX codelists, Eurostat's dictionaries),
 * for three reasons that all matter here: the file gets smaller where a long
 * label repeats thousands of times, the vocabulary is CLOSED so a typo cannot
 * quietly invent a thirteenth category, and the wording can be fixed in one
 * place without touching the data.
 */
function decode(rows, def) {
  const maps = [];
  for (const [name, c] of Object.entries(def.columns || {})) {
    const codes = c.codes || (c.codelist && def.__codelists?.[c.codelist]);
    if (codes) maps.push([name, codes]);
  }
  if (!maps.length) return;
  for (const r of rows) {
    for (const [name, codes] of maps) {
      const v = r[name];
      if (v != null && Object.hasOwn(codes, v)) r[name] = codes[v];
    }
  }
}

/**
 * Distinct values of a column, in first-seen order (stable colour assignment).
 * Dates are deduped by their timestamp: every row parses its own Date instance,
 * so a Set of the objects themselves would treat identical months as distinct.
 */
export function distinct(rows, key) {
  const out = [], seen = new Set();
  for (const r of rows) {
    const v = r[key];
    if (v == null) continue;
    const k = v instanceof Date ? v.getTime() : v;
    if (seen.has(k)) continue;
    seen.add(k); out.push(v);
  }
  return out;
}

/** [min, max] of a numeric column, ignoring nulls. */
export function extent(rows, key) {
  let lo = Infinity, hi = -Infinity;
  for (const r of rows) {
    const v = r[key];
    if (v == null || Number.isNaN(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo === Infinity ? [0, 0] : [lo, hi];
}

/** Clear the cache — used by the "reload data" control during authoring. */
export function clearCache() { cache.clear(); }
