// frame.js — čas ako ovládateľná os grafu (Gapminderov posuvník s prehrávaním).
//
// Graf, ktorý má `frame`, nekreslí celý rad naraz: kreslí jeden okamih a čas sa
// posúva posuvníkom alebo prehrávaním. Dva dôvody, prečo to nie je ozdoba:
//
//   1. Bublinový graf, poradie stĺpcov a rozdelenie sa v čase HÝBU. Na statickom
//      obrázku sa taký pohyb dá ukázať len ako spleť čiar; tu ho vidno priamo.
//   2. Jeden okamih sa dá prečítať presne. Sedemnásť rokov naraz v jednom
//      bublinovom grafe je 200 prekrytých bublín, teda nič.
//
// Dve pravidlá, ktoré animácia musí splniť, inak klame:
//
//   • **Škály sú pevné pre celý rad.** Osi (aj veľkosť bubliny, aj farebné
//     kategórie) sa počítajú zo VŠETKÝCH snímok, nie z tej práve zobrazenej.
//     Inak sa graf pri prehrávaní „nafukuje" a rast, ktorý vidno, je rast osi.
//   • **Nič sa nespustí samo.** Prehrávanie začne až na kliknutie a pri
//     `prefers-reduced-motion` sa neponúka vôbec — animácia je vtedy len
//     posuvník. Karta bez interakcie ukazuje najnovšiu snímku, čo je aj to,
//     čo skončí na screenshote a v tlači.
//
// Ovládanie: play/pause, krok dozadu/dopredu, posuvník, klávesnica (šípky,
// Home/End, medzerník). Hodnota snímky je zároveň veľký priesvitný nápis v
// grafe — bez neho čitateľ nevie, čo práve vidí.

import { monthLabel, year as fmtYear } from './format.js';

const STEP_MS = 900;        // krok prehrávania; pri mesačnom rade sa zrýchli
const MIN_STEP_MS = 110;

/** Hodnoty snímok v poradí; Date sa porovnáva podľa času, nie ako objekt. */
export function frameValues(rows, key) {
  const seen = new Map();
  for (const r of rows) {
    const v = r[key];
    if (v == null) continue;
    const k = v instanceof Date ? v.getTime() : v;
    if (!seen.has(k)) seen.set(k, v);
  }
  return [...seen.entries()].sort((a, b) => (a[0] > b[0] ? 1 : a[0] < b[0] ? -1 : 0))
    .map(e => e[1]);
}

/** Riadky jednej snímky. */
export function frameRows(rows, key, value) {
  const want = value instanceof Date ? value.getTime() : value;
  return rows.filter(r => {
    const v = r[key];
    return (v instanceof Date ? v.getTime() : v) === want;
  });
}

/** Ako sa hodnota snímky napíše — mesiac ako „marec 2024", rok ako „2024". */
export function frameLabel(value) {
  if (value instanceof Date) return monthLabel(value);
  if (typeof value === 'number') return fmtYear(value);
  return String(value);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const reducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;

/**
 * Ovládací panel snímok. Vráti { node, dispose, value(), set(i) }.
 * `onChange(value, index)` sa volá pri každej zmene — vrátane prehrávania.
 */
export function buildFrameControl(values, onChange, opts = {}) {
  const node = el('div', 'viz-frame');
  let i = values.length - 1;                 // najnovšia snímka ako výchozia
  let timer = null;

  const stepMs = Math.max(MIN_STEP_MS, Math.round(STEP_MS / Math.max(1, values.length / 24)));

  const play = el('button', 'viz-frame-play');
  play.type = 'button';
  const prev = el('button', 'viz-frame-step', '‹');
  prev.type = 'button';
  prev.title = 'Predchádzajúca snímka';
  const next = el('button', 'viz-frame-step', '›');
  next.type = 'button';
  next.title = 'Nasledujúca snímka';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'viz-frame-slider';
  slider.min = '0';
  slider.max = String(values.length - 1);
  slider.step = '1';
  slider.value = String(i);
  slider.setAttribute('aria-label', opts.label || 'Čas');

  const readout = el('span', 'viz-frame-value');

  function paint() {
    slider.value = String(i);
    readout.textContent = frameLabel(values[i]);
    slider.setAttribute('aria-valuetext', readout.textContent);
    play.textContent = timer ? '❙❙' : '▶';
    play.title = timer ? 'Zastaviť' : 'Prehrať';
    play.setAttribute('aria-pressed', String(!!timer));
    prev.disabled = i === 0 && !timer;
    next.disabled = i === values.length - 1 && !timer;
  }

  function go(to, emit = true) {
    i = Math.max(0, Math.min(values.length - 1, to));
    paint();
    if (emit) onChange(values[i], i);
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    paint();
  }

  function start() {
    if (timer) { stop(); return; }
    if (i >= values.length - 1) go(0);          // od začiatku, keď stojíme na konci
    timer = setInterval(() => {
      if (i >= values.length - 1) { stop(); return; }
      go(i + 1);
    }, stepMs);
    paint();
  }

  play.addEventListener('click', start);
  prev.addEventListener('click', () => { stop(); go(i - 1); });
  next.addEventListener('click', () => { stop(); go(i + 1); });
  // Hodnotu treba prečítať PRED zastavením: stop() prekresľuje ovládanie a
  // prepíše slider.value podľa starého indexu. Pri opačnom poradí sa ťahanie
  // posuvníka tvárilo, že funguje, a nerobilo nič — krokovacie tlačidlá áno,
  // lebo si index nesú samy.
  slider.addEventListener('input', () => {
    const to = Number(slider.value);
    stop();
    go(to);
  });

  // Klávesnica na posuvníku: šípky rieši prehliadač, doplňujeme Home/End a
  // medzerník na prehrávanie.
  slider.addEventListener('keydown', ev => {
    if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); start(); }
    else if (ev.key === 'Home') { ev.preventDefault(); stop(); go(0); }
    else if (ev.key === 'End') { ev.preventDefault(); stop(); go(values.length - 1); }
  });

  // Prehrávanie sa neponúka, keď si čitateľ vypol animácie. Posuvník zostáva —
  // je to ovládanie, nie efekt.
  if (!reducedMotion()) node.appendChild(play);
  node.append(prev, slider, next, readout);
  paint();

  return {
    node,
    value: () => values[i],
    index: () => i,
    set: to => { stop(); go(to); },
    dispose: stop,
  };
}

/**
 * Veľký priesvitný nápis so snímkou, ako ho má Gapminder. Nie dekorácia:
 * pri prehrávaní je to jediné, čo hovorí, ktorý okamih je na obrazovke, a na
 * screenshote je to jediná stopa po čase.
 */
export function frameWatermark(value, corner = 'right') {
  const w = el('div', 'viz-frame-mark viz-frame-mark-' + corner, frameLabel(value));
  w.setAttribute('aria-hidden', 'true');   // hodnotu už hlási posuvník
  return w;
}
