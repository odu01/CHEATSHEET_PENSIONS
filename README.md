# CHEATSHEET_PENSIONS

Dynamické grafy a tabuľky k dôchodkovému (PAYGO) systému. Dodáš CSV a jeden blok
do manifestu, web z toho vykreslí graf, tabuľku a export — bez zmeny kódu.

Statická stránka: žiadny build step, žiadny bundler, žiadne runtime závislosti.
Repozitár *je* stránka.

```bash
npm run serve      # http://localhost:8080
npm run validate   # manifest + odkazy na súbory + prístupnosť palety
```

## Ako to funguje

```
data/manifest.json   ─┐
data/*.csv           ─┴─►  app.js  ──►  lib/view.js  ──►  graf + legenda + tabuľka + export
```

`data/manifest.json` je jediný kontrakt. Deklaruje **datasety** (súbor, jednotka,
zdroj, vintage), **stránky** (záložky, filtre) a **views** (typ grafu, ktoré stĺpce
kam idú). Pridať graf znamená pridať dáta a JSON, nie kód.

Postup a všetky možnosti: **[docs/AKO_PRIDAT_DATA.md](docs/AKO_PRIDAT_DATA.md)**.
Schéma pre editor: `data/manifest.schema.json`.

## Typy grafov

2D (Observable Plot): `line` · `area` · `area-stacked` · `column` · `bar` ·
`bar-stacked` · `bar-grouped` · `scatter` · `heatmap` · `pyramid` · `waterfall`

3D (Plotly, načíta sa až na stránke, ktorá ho obsahuje): `surface3d` · `scatter3d`

Bez grafu: `tiles` (kľúčové čísla) · `table`

Každý graf dostane automaticky tabuľku s presnými hodnotami, export do CSV,
tooltip so všetkými sériami na danom X, ovládanie klávesnicou, prepínanie sérií v
legende a svetlý aj tmavý režim.

## Štruktúra

```
index.html                 shell — hlavička, navigácia, footer
app.js                     controller: manifest → navigácia → načítanie → vykreslenie
style.css                  RRZ téma, svetlý + tmavý režim, responzívne, tlač

lib/theme.js               dizajnové tokeny a paleta (zmerané hodnoty, nie od oka)
lib/format.js              slovenské formátovanie čísel, percent, EUR, rokov
lib/data.js                načítanie CSV/TSV/JSON, typovanie, cache
lib/transform.js           deklaratívne transformácie (filter, aggregate, index, …)
lib/charts2d.js            2D grafy nad Observable Plot
lib/charts3d.js            3D grafy, Plotly sa načíta na požiadanie
lib/hover.js               crosshair a tooltipy, hit targety ≥ 24 px
lib/table.js               tabuľka s radením, CSV export, stat karty
lib/view.js                zloží jednu kartu: graf + legenda + tabuľka + provenancia

data/manifest.json         KONTRAKT: datasety, stránky, views
data/manifest.schema.json  JSON Schema pre editor
data/*.csv                 dátové súbory

tools/serve.mjs            lokálny server bez závislostí
tools/validate-manifest.mjs kontroluje, že všetko, čo stránka načíta, existuje
tools/check-palette.mjs    premeria paletu proti prístupnostným limitom
tools/screenshots.mjs      vykreslí všetky stránky v oboch režimoch, hľadá chyby
tools/make-sample-data.mjs regeneruje ilustračné dáta (deterministicky)

vendor/                    d3 7.9.0, Observable Plot 0.6.17, Plotly gl3d 3.0.1
```

## Dáta v repozitári sú zatiaľ ilustračné

Okrem `data/vekova_struktura_2024.csv` (veková štruktúra prevzatá z projektu
DYNAMIC_PYRAMID_WEB, Eurostat/UN) sú **všetky priložené čísla vygenerované** ako
ukážka. Sú rádovo vierohodné a vnútorne konzistentné, aby grafy vyzerali ako
skutočný výstup, ale **nie sú oficiálna štatistika a nedajú sa citovať**.

Každý taký dataset má v manifeste `"illustrative": true` a na každej karte sa
zobrazuje výstražný odznak. Keď nahradíš súbor reálnymi dátami, doplň `source` a
prepni príznak na `false` — odznak zmizne.

Ukážkové dáta sa regenerujú deterministicky (`npm run data`), takže diff v `data/`
vždy znamená skutočnú zmenu.

## Kontroly

`npm run validate` beží aj v CI pred nasadením a overuje:

- každý dataset, stĺpec, view, stránka, `<script src>`, `<link href>` a `import`
  ukazuje na niečo, čo existuje
- každý dataset má zdroj, alebo je označený ako ilustračný
- paleta prechádza limitmi pre farbosleposť a kontrast v oboch režimoch
- ukážkové dáta súhlasia s generátorom

Navyše `tools/screenshots.mjs --check` vykreslí všetkých 7 stránok v svetlom aj
tmavom režime a spadne na chybe v konzole, na neúspešnej požiadavke, na prázdnej
ploche grafu alebo na pretekajúcej karte.

Prečo tak dôkladne: pôvodný `DYNAMIC_PYRAMID_WEB` je publikovaný v stave, v ktorom
sa nedá spustiť — má pomiešané názvy súborov s obsahom, chýba mu `worker.js` a
fetchuje cestu, ktorá v repozitári nie je. Nič to nezachytilo, pretože nič
nekontrolovalo, že súbory existujú. Detaily v
[docs/ZHODNOTENIE_PRISTUPU.md](docs/ZHODNOTENIE_PRISTUPU.md) §4.

## Prístupnosť

Farby nie sú vybrané od oka. Korporátne odtiene RRZ sú *snapnuté* na najbližšie
kroky OKLCH, ktoré prechádzajú limitmi (držaný hue, hýbe sa len svetlosť a chroma):
susedné páry CVD ΔE ≥ 8 pod protanopiou a deuteranopiou, normálne videnie ΔE ≥ 15,
kontrast ≥ 3:1 proti vlastnému podkladu režimu. Pôvodná osmica tieto limity
neprechádza — sivá sa číta ako sivá, hnedá splýva s červenou a štyri farby majú
proti tmavému podkladu kontrast pod 3:1. Zmerané hodnoty a zdôvodnenie sú v
`lib/theme.js` a v `docs/ZHODNOTENIE_PRISTUPU.md` §5; `npm run validate:palette`
to premeria kedykoľvek.

Ďalej: každá hodnota je dostupná aj bez farby (tabuľka pod grafom), legenda je pri
dvoch a viac sériách vždy prítomná, hit targety majú ≥ 24 px, grafy sa dajú
ovládať klávesnicou a tmavý režim má vlastné odtiene, nie invertované svetlé.

## Nasadenie

Push do `main` → GitHub Actions overí manifest aj paletu a nasadí koreň repozitára
na GitHub Pages. Žiadny build.

## Dokumentácia

- **[docs/AKO_PRIDAT_DATA.md](docs/AKO_PRIDAT_DATA.md)** — pridanie dát a grafu,
  typy grafov, transformácie, riešenie problémov
- **[docs/ZHODNOTENIE_PRISTUPU.md](docs/ZHODNOTENIE_PRISTUPU.md)** — zhodnotenie
  prístupu z DYNAMIC_PYRAMID_WEB: čo som prevzal, čo nie a prečo
