# CHEATSHEET_PENSIONS

Dynamické grafy a tabuľky k dôchodkovému (PAYGO) systému. Dodáš CSV a jeden blok
do manifestu, web z toho vykreslí graf, tabuľku a export — bez zmeny kódu.

Statická stránka: žiadny build step, žiadny bundler, žiadne runtime závislosti.
Repozitár *je* stránka.

```bash
npm run serve      # http://localhost:8080
npm run validate   # manifest + vstupné súbory + odkazy + prístupnosť palety
npm run vstup      # čo treba naplniť dátami a či to, čo tam je, sedí
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
`bar-stacked` · `bar-grouped` · `scatter` · `heatmap` · `pyramid` · `waterfall` ·
`bubbles` · `barrank` · `mountain` · `sankey`

Ktorýkoľvek z nich sa dá animovať: `"frame": "mesiac"` z časového stĺpca urobí
posuvník s prehrávaním. Škály sa pritom počítajú zo všetkých snímok, takže
prehrávanie hýbe značkami a nikdy nie osami — a nič sa nespustí samo.

Kumulatívne rozdelenie (Lorenzova krivka) nie je vlastný typ grafu — je to `line`
nad transformáciou `cumsum`. Zdroj dát zostáva tabuľka pásiem, akú zverejňuje SP.

3D (Plotly, načíta sa až na stránke, ktorá ho obsahuje): `surface3d` · `scatter3d`

Bez grafu: `tiles` (kľúčové čísla) · `table`

Štrnásť stránok v šiestich sekciách (sekcie v prvom riadku navigácie, stránky
vybranej sekcie v druhom; na telefóne namiesto pruhov jedna rozbaľovacia ponuka
s celou mapou) a žiadna prázdna karta. Deväť beží na reálnych dátach
Sociálnej poisťovne (prehľad, výdavky, počty, priemerné dôchodky, novopriznané,
sezónnosť s teplotnou mapou a 3D povrchom, pohyb v čase, demografia, dátový
katalóg), päť na syntetických (rozdelenie dôchodkov, podľa veku a pohlavia, podľa
kategórie, doba poberania, II. pilier).

Syntetické neznamená vymyslené naslepo: sú to rady z modelu, ktorý drží
zverejnené čísla a dopočítava len to, čo medzi nimi chýba. Každá taká karta má
odznak **„Syntetické dáta"** a v zdroji vypísané kotvy, na ktorých model stojí.
Vstupné súbory ležia v `data/vstup/` — doplniť reálne čísla znamená prepísať v
nich hodnoty; postup je v **[data/vstup/README.md](data/vstup/README.md)**,
kontrolu robí `npm run vstup`. Evidencia zadaných ukazovateľov je v
**[docs/POZADOVANE_UKAZOVATELE.md](docs/POZADOVANE_UKAZOVATELE.md)**.

Každý graf dostane automaticky tabuľku s presnými hodnotami, export do CSV,
tooltip so všetkými sériami na danom X, ovládanie klávesnicou, prepínanie sérií v
legende a svetlý aj tmavý režim.

## Štruktúra

```
index.html                 shell — hlavička, navigácia, footer
app.js                     controller: manifest → navigácia → načítanie → vykreslenie
style.css                  RRZ téma, 12-stĺpcová mriežka, svetlý + tmavý režim, tlač

lib/theme.js               dizajnové tokeny a paleta (zmerané hodnoty, nie od oka)
lib/format.js              slovenské formátovanie čísel, percent, EUR, rokov
lib/data.js                načítanie CSV/TSV/JSON, typovanie, cache
lib/transform.js           deklaratívne transformácie (filter, aggregate, index, …)
lib/charts2d.js            2D grafy nad Observable Plot
lib/charts3d.js            3D grafy, Plotly sa načíta na požiadanie
lib/hover.js               crosshair a tooltipy, hit targety ≥ 24 px
lib/frame.js               čas ako posuvník: prehrávanie, krokovanie, pevné škály
lib/sankey.js              rozloženie prúdového diagramu (jedna mierka pre všetky stĺpce)
lib/table.js               tabuľka s radením, CSV export, stat karty
lib/view.js                zloží jednu kartu: graf + legenda + tabuľka + provenancia

data/manifest.json         KONTRAKT: datasety, stránky, views
data/manifest.schema.json  JSON Schema pre editor
data/sp_*.csv              dátové súbory (generované z data/zdroj/)
data/zdroj/*.xlsx          pôvodné zošity Sociálnej poisťovne
data/vstup/*.csv           ručný vstup — sem sa dopĺňajú čísla, ktoré v zošitoch nie sú

tools/serve.mjs            lokálny server bez závislostí
tools/validate-manifest.mjs kontroluje, že všetko, čo stránka načíta, existuje
tools/check-palette.mjs    premeria paletu proti prístupnostným limitom
tools/screenshots.mjs      vykreslí všetky stránky v oboch režimoch, hľadá chyby
tools/import_sp.py         prevod zošitov SP na tidy CSV + kontrolné súčty
tools/check-vstup.mjs      čo je v data/vstup, čo v ňom chýba, či sedí na kontrakt
tools/gen_vstup.py         model pre syntetické vstupné dáta (kalibrovaný na kotvy)

vendor/                    d3 7.9.0, Observable Plot 0.6.17, Plotly gl3d 3.0.1
```

## Dáta

Web stojí na reálnych dátach **Sociálnej poisťovne**: mesačná rada výdavkov,
počtov a priemerných dôchodkov 2009-01 – 2026-04 a ročná štatistika dôchodkového
poistenia 2021–2024. Zdrojové zošity sú commitnuté v `data/zdroj/` a CSV v `data/`
sa z nich generujú skriptom:

```bash
npm run data     # python3 tools/import_sp.py
```

Skript rieši sedem pascí, ktoré sa pri ručnom prepise ľahko prehliadnu — počty
uvedené v tisícoch, kumulatívne stĺpce výdavkov, dve rôzne definície priemerného
dôchodku, rozdiel medzi počtom dôchodkov a počtom dôchodcov, definičné zlomy pri
rodičovskom a 13. dôchodku, a rozdiel medzi hotovostnou a ročnou metodikou. Každú
z nich kontroluje súčtom proti riadku „Celkom" v zošite a pri nezhode skončí
chybou. Podrobne: **[docs/ZDROJOVE_DATA.md](docs/ZDROJOVE_DATA.md)**.

Jediná výnimka je `data/vekova_struktura_2024.csv` — veková štruktúra prevzatá z
projektu DYNAMIC_PYRAMID_WEB (Eurostat/UN).

Súbory v `data/vstup/` sú ručný vstup pre ukazovatele, ktoré v zošitoch nie sú.
Dnes v nich sú syntetické čísla z `tools/gen_vstup.py` — Silerov model úmrtnosti
a rozdelenie dôchodkov, oboje kalibrované na zverejnené kotvy (stredná dĺžka
života a kojenecká úmrtnosť v SR, počet a priemer starobných dôchodkov, počty nad
1 000 / 2 000 / 2 500 €, koncoročné stavy II. piliera). Generátor si pri každom
datasete kontroluje súčtom, že kotvy drží, inak skončí chybou.

Čo v priložených zošitoch **nie je**: príjmy systému a saldo, HDP ako menovateľ
pre podiely, priemerná mzda pre náhradový pomer. Web tieto ukazovatele
nezobrazuje — pridaním ďalšieho CSV a bloku do manifestu pribudnú.

Dataset bez `source`, ktorý nie je označený `"illustrative": true`, neprejde
validáciou. Ilustračné datasety dostanú na každej karte výstražný odznak.

## Kontroly

Dáta: všetky CSV spolu majú 392 KB, knižnice 477 KB — na stránku sa teda ťahá
viac kódu než dát, a to je vedomé rozhodnutie (Plot vyžaduje d3 ako externú
závislosť a tree-shaking by potreboval build step). Rozbor v
**[docs/DATOVA_ARCHITEKTURA.md](docs/DATOVA_ARCHITEKTURA.md)**.

`npm run validate` beží aj v CI pred nasadením a overuje:

- každý dataset, stĺpec, view, stránka, `<script src>`, `<link href>` a `import`
  ukazuje na niečo, čo existuje
- každý dataset má zdroj, alebo je označený ako ilustračný
- každý súbor v `data/vstup/` sedí na kontrakt: hlavička, typy, prázdne hodnoty,
  duplicitné kľúče, diery v radoch rokov a vekov
- hodnoty v stĺpcoch s kódovníkom patria do uzavretého slovníka (preklep
  „Muzi" namiesto „Muži" neprejde)
- deklarované kontrolné súčty platia, vrátane krížových medzi dvoma súbormi
- paleta prechádza limitmi pre farbosleposť a kontrast v oboch režimoch
- CSV v `data/` sa zhodujú so zošitmi v `data/zdroj/` (pregenerovaním importu) a
  syntetické súbory v `data/vstup/` so svojím generátorom (kým sú syntetické)

Navyše `tools/screenshots.mjs --check` vykreslí všetkých 14 stránok v svetlom aj
tmavom režime a spadne na chybe v konzole, na neúspešnej požiadavke, na prázdnej
ploche grafu, na pretekajúcej karte — a na varovaní Observable Plot. To posledné
nie je prepis: Plot kreslí pri varovaní ⚠ priamo do grafu a jeho varovanie
zvyčajne pomenúva skutočnú chybu (stĺpec rokov ponechaný ako text natlačil 55
značiek na os).

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
- **[docs/DATOVA_ARCHITEKTURA.md](docs/DATOVA_ARCHITEKTURA.md)** — prečo sú dáta
  rozdelené tak, ako sú: granularita, kódovníky, kontrolné súčty, a prepočet
  „jedna veľká kocka verzus tabuľka na každý jav" na skutočných dátach
- **[docs/POZADOVANE_UKAZOVATELE.md](docs/POZADOVANE_UKAZOVATELE.md)** — čo má web
  zobrazovať, čo je hotové, čo čaká na dáta a v akom tvare ich dodať
- **[docs/ZDROJOVE_DATA.md](docs/ZDROJOVE_DATA.md)** — zdrojové zošity, čo z čoho
  vzniklo, sedem pascí v týchto dátach a čo dáta ešte neobsahujú
- **[docs/ZHODNOTENIE_PRISTUPU.md](docs/ZHODNOTENIE_PRISTUPU.md)** — zhodnotenie
  prístupu z DYNAMIC_PYRAMID_WEB: čo som prevzal, čo nie a prečo
