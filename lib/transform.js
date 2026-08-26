// transform.js — declarative row transforms.
//
// A view in the manifest can carry a `transform` array; each entry is applied in
// order. This is what lets a single CSV feed several views without a per-view
// script: filter one year out here, index to a base there, aggregate somewhere
// else. Unknown transform kinds throw, so a typo in the manifest fails loudly
// instead of silently drawing the wrong thing.

/**
 * Key for a group of rows. The separator is a NUL because no data value can
 * contain one: joining with a space would make ["a b", "c"] and ["a", "b c"]
 * the same group. Written as an escape on purpose — a raw NUL byte in the source
 * makes git treat this file as binary and stop showing diffs for it.
 * Dates are keyed by their timestamp: every row parses its own Date instance, so
 * two identical months are two different objects.
 */
function groupKey(row, keys) {
  return keys.map(k => {
    const v = row[k];
    return v instanceof Date ? v.getTime() : v;
  }).join('\u0000');
}

const AGGREGATORS = {
  sum:   vs => vs.reduce((a, b) => a + b, 0),
  mean:  vs => vs.reduce((a, b) => a + b, 0) / vs.length,
  min:   vs => Math.min(...vs),
  max:   vs => Math.max(...vs),
  count: vs => vs.length,
  first: vs => vs[0],
  last:  vs => vs[vs.length - 1],
};

/** Compare a value against a filter spec. */
function matches(value, spec) {
  if (spec == null) return value == null;
  if (Array.isArray(spec)) return spec.includes(value);
  if (typeof spec === 'object') {
    if ('eq'  in spec && value !== spec.eq)  return false;
    if ('ne'  in spec && value === spec.ne)  return false;
    if ('gt'  in spec && !(value >  spec.gt))  return false;
    if ('gte' in spec && !(value >= spec.gte)) return false;
    if ('lt'  in spec && !(value <  spec.lt))  return false;
    if ('lte' in spec && !(value <= spec.lte)) return false;
    if ('in'  in spec && !spec.in.includes(value)) return false;
    if ('notIn' in spec && spec.notIn.includes(value)) return false;
    return true;
  }
  return value === spec;
}

const OPS = {
  /** { kind: "filter", where: { rok: {gte: 2020}, kategoria: ["A","B"] } } */
  filter(rows, spec) {
    const entries = Object.entries(spec.where || {});
    return rows.filter(r => entries.every(([k, s]) => matches(r[k], s)));
  },

  /**
   * { kind: "aggregate", by: ["rok"], value: "hodnota", as: "sum" }
   * or several measures at once:
   * { kind: "aggregate", by: ["vek"], values: { "pocet": "sum", "objem": "sum" } }
   *
   * The multi-measure form is what a weighted mean needs: mean of an average is
   * not the average. Sum the counts and sum count × value, then `derive` the
   * ratio — three declarative steps instead of a bespoke aggregator.
   */
  aggregate(rows, spec) {
    const by = spec.by || [];
    const measures = spec.values
      ? Object.entries(spec.values).map(([col, as]) => [col, as, col])
      : [[spec.value, spec.as || 'sum', spec.into || spec.value]];
    for (const [, as] of measures) {
      if (!AGGREGATORS[as]) throw new Error(`transform.aggregate: unknown aggregator "${as}"`);
    }
    const groups = new Map();
    for (const r of rows) {
      const key = groupKey(r, by);
      let g = groups.get(key);
      if (!g) { g = { keyRow: r, values: measures.map(() => []) }; groups.set(key, g); }
      measures.forEach(([col], i) => {
        const v = r[col];
        if (v != null && !Number.isNaN(v)) g.values[i].push(v);
      });
    }
    const out = [];
    for (const { keyRow, values } of groups.values()) {
      const o = {};
      for (const k of by) o[k] = keyRow[k];
      measures.forEach(([, as, into], i) => {
        o[into] = values[i].length ? AGGREGATORS[as](values[i]) : null;
      });
      out.push(o);
    }
    return out;
  },

  /**
   * { kind: "pivot", key: "kategoria", value: "hodnota", by: ["rok"] }
   * Long -> wide. Useful for table views where each category is a column.
   */
  pivot(rows, spec) {
    const by = spec.by || [];
    const groups = new Map();
    for (const r of rows) {
      const key = groupKey(r, by);
      let o = groups.get(key);
      if (!o) { o = {}; for (const k of by) o[k] = r[k]; groups.set(key, o); }
      o[String(r[spec.key])] = r[spec.value];
    }
    return [...groups.values()];
  },

  /**
   * { kind: "unpivot", keep: ["rok"], into: "kategoria", value: "hodnota" }
   * Wide -> long, so a spreadsheet-shaped CSV (one column per category) can feed
   * a series-based chart without being reshaped by hand first.
   */
  unpivot(rows, spec) {
    const keep = spec.keep || [];
    const out = [];
    for (const r of rows) {
      for (const [k, v] of Object.entries(r)) {
        if (keep.includes(k)) continue;
        if (spec.only && !spec.only.includes(k)) continue;
        const o = {};
        for (const kk of keep) o[kk] = r[kk];
        o[spec.into || 'kategoria'] = k;
        o[spec.value || 'hodnota'] = v;
        out.push(o);
      }
    }
    return out;
  },

  /**
   * { kind: "derive", into: "podiel", expr: "a / b * 100", vars: {a:"x", b:"y"} }
   * Arithmetic only — the expression is parsed by a tiny evaluator rather than
   * eval(), so a manifest can never execute arbitrary code.
   */
  derive(rows, spec) {
    const fn = compile(spec.expr);
    const vars = spec.vars || {};
    return rows.map(r => {
      const scope = {};
      for (const [name, col] of Object.entries(vars)) scope[name] = r[col];
      let v;
      try { v = fn(scope); } catch { v = null; }
      return { ...r, [spec.into]: Number.isFinite(v) ? v : null };
    });
  },

  /**
   * { kind: "index", value: "hodnota", by: ["kategoria"], at: 2024, on: "rok", base: 100 }
   * Rebases every series to `base` at a common point. This is the honest answer
   * to "two measures of different scale on one chart" — one axis, indexed —
   * instead of a second y-scale.
   */
  index(rows, spec) {
    const by = spec.by || [];
    const base = spec.base ?? 100;
    const baseline = new Map();
    for (const r of rows) {
      if (r[spec.on] !== spec.at) continue;
      baseline.set(groupKey(r, by), r[spec.value]);
    }
    return rows.map(r => {
      const b = baseline.get(groupKey(r, by));
      const v = r[spec.value];
      return { ...r, [spec.into || spec.value]:
        (b == null || v == null || b === 0) ? null : v / b * base };
    });
  },

  /**
   * { kind: "rename", column: "ukazovatel", map: { "priemerna_mzda_eur": "Priemerná mzda" } }
   * Relabels VALUES inside a column (the manifest's `labels` renames columns).
   * Done as a transform rather than at render time so the pretty name reaches the
   * legend, the tooltip, the table and the CSV export from one place — otherwise
   * an unpivot leaves raw CSV header names like "priemerna_mzda_eur" on screen.
   */
  rename(rows, spec) {
    const map = spec.map || {};
    const col = spec.column;
    return rows.map(r => Object.hasOwn(map, r[col]) ? { ...r, [col]: map[r[col]] } : r);
  },

  /**
   * { kind: "expand", column: "kategoria", into: "znak",
   *   map: { "SP + II. pilier + cudzina": ["Sporiteľ", "Cudzina"] } }
   *
   * One row becomes one row per property it carries. This is how overlapping
   * groups are read out of non-overlapping data: a pensioner who both saves in
   * the II. pillar and draws a foreign pension is counted ONCE in the file (in
   * the combined category) and shows up under BOTH properties here. Per-property
   * sums are then right — but the sum ACROSS properties exceeds the total by the
   * overlap, so an expanded series must never be stacked or totalled.
   *
   * Unmapped values pass through unchanged unless `keepUnmapped: false`.
   */
  expand(rows, spec) {
    const map = spec.map || {};
    const into = spec.into || spec.column;
    const out = [];
    for (const r of rows) {
      const v = r[spec.column];
      if (!Object.hasOwn(map, v)) {
        if (spec.keepUnmapped !== false) out.push({ ...r, [into]: v });
        continue;
      }
      const targets = map[v];
      for (const t of (Array.isArray(targets) ? targets : [targets])) out.push({ ...r, [into]: t });
    }
    return out;
  },

  /**
   * { kind: "pageFilter" }
   * Placeholder: the page's filter row is substituted here. Page filters normally
   * apply to the dataset before any transform runs, which is right for a column
   * that exists in the CSV. A filter over a column that a transform PRODUCES has
   * to land in the middle of the pipeline instead — after `expand` invents the
   * column, before the `aggregate` that drops it. A no-op on its own, so the
   * pipeline stays valid outside the app.
   */
  pageFilter(rows) { return rows; },

  /**
   * { kind: "sort", by: "rok", dir: "asc" } — or by: ["rok","mesiac"].
   * `dir` may be an array matching `by`, which is what a heatmap needs: years
   * descending so the newest is on top, months ascending so they read Jan→Dec.
   */
  sort(rows, spec) {
    const keys = Array.isArray(spec.by) ? spec.by : [spec.by];
    const dirs = keys.map((_, i) => {
      const d = Array.isArray(spec.dir) ? spec.dir[i] : spec.dir;
      return d === 'desc' ? -1 : 1;
    });
    return [...rows].sort((a, b) => {
      for (let i = 0; i < keys.length; i++) {
        const x = a[keys[i]], y = b[keys[i]];
        if (x == null && y == null) continue;
        if (x == null) return 1;
        if (y == null) return -1;
        if (x < y) return -dirs[i];
        if (x > y) return dirs[i];
      }
      return 0;
    });
  },

  /**
   * { kind: "bin", column: "vek", into: "vekova_skupina", width: 5, max: 100 }
   * Groups a numeric column into bands and writes the band LABEL into `into`.
   * Lets one age-resolved CSV feed both a per-year line chart and a binned
   * pyramid without shipping the same numbers twice.
   *
   * The label is built so it sorts correctly as a string within a band width
   * ("0–4", "5–9", … "100+"), and the numeric band start is also written to
   * `<into>_od` for views that need to order or filter numerically.
   */
  bin(rows, spec) {
    const width = spec.width || 5;
    const max = spec.max ?? null;
    const into = spec.into || (spec.column + '_pasmo');
    const maxLabel = spec.maxLabel || (max != null ? `${max}+` : null);
    return rows.map(r => {
      const v = r[spec.column];
      if (v == null || Number.isNaN(v)) return { ...r, [into]: null, [into + '_od']: null };
      if (max != null && v >= max) return { ...r, [into]: maxLabel, [into + '_od']: max };
      const start = Math.floor(v / width) * width;
      return { ...r, [into]: `${start}–${start + width - 1}`, [into + '_od']: start };
    });
  },

  /**
   * { kind: "cumsum", columns: ["pocet","vydavky"], by: ["rok"], share: true, origin: true }
   * Running total of each column in the CURRENT row order — put a `sort` in front
   * of it, cumsum trusts the order it is given. Writes "<col>_kum", and with
   * `share` also "<col>_kum_pct", the running share of that group's total.
   *
   * Two shares against each other is exactly a cumulative distribution (Lorenz)
   * curve: cumulative % of pensioners on x, cumulative % of spending on y. That
   * chart needs the origin, which no data row can supply — a band table starts
   * at the top of its first band — so `origin: true` prepends a zero point per
   * group.
   */
  cumsum(rows, spec) {
    const cols = spec.columns || [spec.column];
    const by = spec.by || [];
    const suffix = spec.suffix || '_kum';

    const totals = new Map();
    if (spec.share) {
      for (const r of rows) {
        const k = groupKey(r, by);
        if (!totals.has(k)) totals.set(k, {});
        const t = totals.get(k);
        for (const c of cols) t[c] = (t[c] || 0) + (Number(r[c]) || 0);
      }
    }

    const running = new Map();
    const out = [];
    for (const r of rows) {
      const k = groupKey(r, by);
      if (!running.has(k)) {
        running.set(k, {});
        if (spec.origin) {
          const zero = {};
          for (const b of by) zero[b] = r[b];
          for (const c of cols) {
            zero[c + suffix] = 0;
            if (spec.share) zero[c + suffix + '_pct'] = 0;
          }
          out.push(zero);
        }
      }
      const acc = running.get(k);
      const o = { ...r };
      for (const c of cols) {
        acc[c] = (acc[c] || 0) + (Number(r[c]) || 0);
        o[c + suffix] = acc[c];
        if (spec.share) {
          const t = totals.get(k)?.[c];
          o[c + suffix + '_pct'] = t ? acc[c] / t * 100 : null;
        }
      }
      out.push(o);
    }
    return out;
  },

  /** { kind: "limit", n: 10 } */
  limit(rows, spec) { return rows.slice(0, spec.n); },

  /**
   * { kind: "topN", n: 6, by: "hodnota", group: "kategoria", other: "Ostatné" }
   * Keeps the N largest groups and folds the tail into one "Other" row — the
   * documented answer to running out of categorical slots.
   */
  topN(rows, spec) {
    const group = spec.group, value = spec.by;
    const totals = new Map();
    for (const r of rows) totals.set(r[group], (totals.get(r[group]) || 0) + (r[value] || 0));
    const keep = new Set([...totals.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, spec.n).map(e => e[0]));
    const label = spec.other || 'Ostatné';
    return rows.map(r => keep.has(r[group]) ? r : { ...r, [group]: label });
  },
};

/**
 * Minimal arithmetic expression compiler: + - * / ( ) numbers and identifiers.
 * Deliberately not eval — the manifest is data, and data must not be able to run.
 */
export function compile(expr) {
  const tokens = String(expr).match(/\d+\.?\d*|[A-Za-z_]\w*|[()+\-*/]/g) || [];
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = t => { if (tokens[pos] !== t) throw new Error(`expected ${t}`); pos++; };

  function primary(scope) {
    const t = peek();
    if (t === '(') { eat('('); const v = additive(scope); eat(')'); return v; }
    if (t === '-') { eat('-'); return -primary(scope); }
    pos++;
    if (/^\d/.test(t)) return Number(t);
    const v = scope[t];
    return v == null ? NaN : v;
  }
  function multiplicative(scope) {
    let v = primary(scope);
    while (peek() === '*' || peek() === '/') {
      const op = peek(); pos++;
      const r = primary(scope);
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function additive(scope) {
    let v = multiplicative(scope);
    while (peek() === '+' || peek() === '-') {
      const op = peek(); pos++;
      const r = multiplicative(scope);
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  return scope => { pos = 0; return additive(scope); };
}

/** Apply a manifest transform pipeline. */
export function applyTransforms(rows, pipeline) {
  if (!pipeline || !pipeline.length) return rows;
  let out = rows;
  for (const spec of pipeline) {
    const op = OPS[spec.kind];
    if (!op) throw new Error(`unknown transform kind "${spec.kind}"`);
    out = op(out, spec);
  }
  return out;
}

export const TRANSFORM_KINDS = Object.keys(OPS);
