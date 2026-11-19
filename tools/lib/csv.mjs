// csv.mjs — jeden parser CSV pre všetky nástroje.
//
// Pravidlá sú tie isté ako v lib/data.js na strane webu: úvodzovky, zdvojená
// úvodzovka vnútri poľa, oddeľovač tabulátor alebo čiarka podľa hlavičky.
//
// Prečo zvlášť súbor: kontrola manifestu si predtým delila riadok na čiarkach
// (`line.split(',')`) a každý text s čiarkou vnútri úvodzoviek — napríklad
// „6 druhov dôchodkov, jún 2026" — pre ňu vyzeral ako riadok s navyše stĺpcom.
// Dva parsery v jednom projekte sa rozídu; tento je jeden.

/** CSV/TSV text na pole riadkov (pole polí). */
export function parseCsv(text) {
  const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  const delim = (clean.split('\n')[0].match(/\t/g) || []).length ? '\t' : ',';
  const rows = [];
  let field = '', row = [], quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  row.push(field);
  rows.push(row);
  return rows;
}
