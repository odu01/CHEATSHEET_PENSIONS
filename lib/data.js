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
    case 'date':
      return String(v);
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

  const rows = body.map(r => {
    const o = {};
    header.forEach((name, i) => { o[name] = coerce(r[i], columns[name]); });
    return o;
  });

  return { rows, columns, meta: def };
}

/** Distinct values of a column, in first-seen order (stable colour assignment). */
export function distinct(rows, key) {
  const out = [], seen = new Set();
  for (const r of rows) {
    const v = r[key];
    if (v == null || seen.has(v)) continue;
    seen.add(v); out.push(v);
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
