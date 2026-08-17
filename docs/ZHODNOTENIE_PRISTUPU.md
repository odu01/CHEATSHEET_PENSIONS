# Zhodnotenie prístupu z DYNAMIC_PYRAMID_WEB

Zadanie: preštudovať metodiku a technický postup projektu `odu01/DYNAMIC_PYRAMID_WEB`
a posúdiť, či je vhodný aj pre tento web — dynamické grafy a tabuľky k dôchodkovému
systému, kde nástroju dodám tabuľky alebo datasety a on zobrazí preddefinované 2D
grafy, prípadne 3D grafy, a tabuľky.

**Odpoveď v jednej vete:** technický skelet áno a prevzal som ho takmer celý, ale
jadro toho projektu — simulačný engine vo web workeri — je pre túto úlohu zbytočné
a pevne zadrôtované grafy sa museli otočiť naruby: tam parametre vyrábajú dáta, tu
dáta určujú graf.

---

## 1. Čo som v tom projekte našiel

Repozitár je malý a čitateľný: 8 súborov, ~1 700 riadkov, žiadny build step, žiadne
npm. Vlastný obsah:

| Vrstva | Ako to je riešené |
|---|---|
| Doručenie | Statické súbory, ES modules priamo v prehliadači, GitHub Pages |
| Knižnice | D3 v7 + Observable Plot 0.6 z jsDelivr, Inter z Google Fonts |
| Model | `model.js` — kohortno-komponentná Lesliho matica, `P(t+1) = L(θ)·P(t) + M`, 101 kohort × 2 pohlavia, Gompertz–Makeham mortalita kalibrovaná na SK 2024, Beta(3,4) profil fertility |
| Výpočet | `worker.js` — celá simulácia 2024–2150 mimo hlavné vlákno |
| Vizualizácia | `plot.js` — jedna funkcia `renderPyramid`, stacked horizontal bar |
| Alokácia | Waterfall do 8 stavov trhu práce (zamestnaný, PN, invalidný, dôchodca…) |
| UI | `index.html` so 12 slidrami, 9 stat kartami, interaktívnou legendou |
| Výkon | Predpočítané snapshoty pre všetky roky; slider roku je len index do polí, nie prepočet; `Float64Array` a znovupoužité buffery; debounce 100 ms |

Metodicky je to solídne. Konštrukcia „parametre → prepočítaj celý horizont →
slider roku len indexuje" je presne to, čo drží interaktivitu pod 16 ms.

## 2. Čo som prevzal

- **Statický web bez build stepu.** Repozitár *je* stránka. Žiadny bundler, žiadny
  `node_modules` v runtime, nasadenie je copy súborov. Pre publikovaný prehľad
  inštitúcie je to najmenej pohyblivých častí, aké sa dá mať.
- **Observable Plot + D3** ako 2D vrstva. Rovnaká voľba, rovnaké dôvody.
- **Oddelenie vrstiev na čisté moduly** s funkciami tvaru
  `render(container, data, options)`.
- **Vzor „predpočítaj, potom indexuj"** — tu sa vracia ako `transform` pipeline:
  dataset sa načíta a otransformuje raz, karty už len čítajú.
- **Korporátna paleta a tmavá téma**, ale prekalibrované — pozri sekciu 5.
- **Interaktívna legenda** na skrývanie série.

## 3. Čo NEBOLO vhodné a čo som zmenil

### 3.1 Web worker a simulačný engine — vypustené

Ten projekt je *výpočtovo* riadený: slider zmení parameter, model prepočíta 126
rokov × 101 kohort × 2 pohlavia, worker to drží mimo UI vlákno. Tento web je
*dátovo* riadený: dáta už existujú, len sa majú zobraziť. Načítanie CSV a jeho
transformácia je otázka milisekúnd, worker by pridal len asynchrónnu zložitosť bez
prínosu.

Vrátil by som ho, keby sa niekedy počítalo priamo v stránke — napríklad slider
dôchodkového veku, ktorý dopočítava saldo. Dnes sú všetky hodnoty už v CSV a
transformácie nad nimi (agregácie, prepočty na milióny, indexácia) sú otázka
milisekúnd na hlavnom vlákne.

### 3.2 Zadrôtované grafy → deklaratívny manifest

V `plot.js` sú `STATE_NAMES`, `STATE_COLORS`, `STATE_LABELS` a `STACK_ORDER`
konštanty v kóde, `renderPyramid` kreslí jeden konkrétny graf a `index.html` má
každý slider a každú stat kartu napísanú ručne. Pridať graf = napísať kód.

To je pre jednu pyramídu v poriadku, pre tvoju požiadavku nie. Tu je kontrakt
`data/manifest.json`: datasety, stránky a views sú dáta, nie kód. Pridať graf =
vložiť CSV a jeden blok JSON. Kódu je 14 typov grafov, ktoré vedia vykresliť
hocijaký dataset správneho tvaru.

### 3.3 Formát dát

`Float64Array` indexovaný `(vek × 2 + pohlavie) × 8 + stav` je optimálny pre
simuláciu a nepoužiteľný ako všeobecný formát. Tu je vstupom *tidy* dlhý formát:
jeden riadok = jedno pozorovanie, stĺpce sú premenné. Presne to, čo padne z Excelu
alebo z databázy.

### 3.4 3D — nie je tam, tu je, ale ako voliteľný modul

Observable Plot 3D nemá. Pridal som Plotly (`surface3d`, `scatter3d`), ale bundle
sa načíta až na stránke, ktorá 3D naozaj obsahuje. 2D stránky ostávajú na ~490 kB.

Metodická poznámka, ktorú som zabudoval do kódu aj do stránky *Citlivosť*: 3D
povrch má zmysel pri odozve na **dva parametre naraz**, kde ide o tvar odozvy.
Nemá zmysel pre časovú radu s kategóriou — oklúzia a perspektíva urobia hodnoty v
zadnom rohu nečitateľnými. Preto má každý 3D pohľad aj 2D projekciu (teplotnú mapu)
a tabuľku.

### 3.5 Chýbajúca provenancia

Ten projekt nikde neuvádza, odkiaľ čísla sú a ako sú staré. Pre štatistický prehľad
je to zásadné. Každý dataset tu deklaruje `source`, `vintage`, `unit`, a validácia
neprejde, ak dataset nemá zdroj a ani nie je explicitne označený ako ilustračný.
Ilustračné datasety dostanú na každej karte výstražný odznak. Karta, ktorá čerpá z
viacerých datasetov (napr. riadok kľúčových čísel), vypíše zdroj každého z nich —
jeden spoločný riadok by pripísal všetky čísla jednému zošitu a jednému obdobiu.

Pri reálnych dátach Sociálnej poisťovne sa to hneď vyplatilo: dva zošity používajú
dve rôzne definície priemerného dôchodku (642,35 € vs 683,10 € za ten istý
december 2024), takže bez jasnej provenancie na karte by sa dali nechtiac porovnať.
Podrobne v `docs/ZDROJOVE_DATA.md`.

## 4. Čo tam je rozbité a čo som z toho urobil

Toto nie je kritika mimo tému — je to priamo dôvod, prečo tento repozitár má CI.

**Publikovaný `DYNAMIC_PYRAMID_WEB` sa nedá spustiť.** V jedinom commite sú názvy
súborov a ich obsah pomiešané:

| Súbor v repozitári | Čo v ňom naozaj je |
|---|---|
| `README.md` | dokumentácia stavu (obsah `PROGRESS.md`) |
| `PROGRESS.md` | kód `plot.js` |
| `plot.js` | kód `model.js` |
| `model.js` | `Logo.svg` |
| `Logo.svg` | `index.html` |
| `index.html` | `data/anchors.json` |
| `worker.js` | `style.css` |
| `style.css` | `README.md` |

Zdrojový kód `worker.js` v repozitári **nie je vôbec** a `index.html` (ten pravý)
fetchuje `data/anchors.json` — cestu, ktorá v repozitári neexistuje, hoci samotné
dáta tam pod iným názvom sú. Stránka teda spadne pri načítaní.

Nič to nezachytilo, pretože nič nekontrolovalo, že súbory, ktoré stránka načítava,
existujú. Preto `tools/validate-manifest.mjs` overuje každý `<script src>`, každý
`<link href>`, každý `import` a každý dataset proti disku, a `tools/screenshots.mjs`
vykreslí všetkých 8 stránok v oboch režimoch a spadne na akejkoľvek chybe v konzole.
Oboje beží v CI pred nasadením.

Že to nie je teoretické: smoke test odhalil počas vývoja štyri chyby, ktoré
statická validácia nevidí — zmizli stĺpce (výpočet odsadenia pásma ignoroval
padding), slovenské formátovanie čísel sa tichо zahodilo (explicitná os prepísala
nastavenia škály), body v bodovom grafe sa nekreslili (výška karty `"l"` sa poslala
ako polomer bodu) a roky sa zobrazovali ako „2 010,0".

**Druhý problém:** knižnice sa ťahajú z CDN na plávajúcom rozsahu
(`@observablehq/plot@0.6`, `d3@7`). Upstream release môže kedykoľvek zmeniť
vykreslenie už publikovanej stránky. Tu sú knižnice vendorované v presných verziách
(`vendor/plot-0.6.17.umd.min.js`, `vendor/d3-7.9.0.min.js`). Bonus: stránka nerobí
žiadne požiadavky na tretie strany. Z rovnakého dôvodu som vynechal Google Fonts a
používam systémový sans.

## 5. Paleta — čo prekalibrovanie ukázalo

Chcel som ponechať korporátne farby RRZ. Zmeral som ich (OKLab ΔE ×100, simulácia
protanopie a deuteranopie modelom Machado–Oliveira–Fernandes 2009, severity 1.0) a
pôvodná osmica neprejde:

- `#58595B` (korporátna sivá) má OKLCH chromu **0,003** — číta sa ako sivá, nie ako
  identita série. Vyhradil som ju pre „Ostatné / neaktívne".
- `#997468` (hnedá) sa pod deuteranopiou zliева s `#D82727` (červená): ΔE **7,8**,
  pod hranicou 8. Zvýšenie chromy z nej urobí oranžovú, čiže prestane byť hnedá.
  Nepoužívam ju ako sériu.
- Štyri z ôsmich farieb mali proti tmavému podkladu kontrast **pod 3:1**
  (`#3657A7` 2,14 · `#58595B` 2,09 · `#9C479B` 2,64 · `#D82727` 2,95).

Riešenie nie je vybrať iné farby, ale *snap-to-passing*: držať značkový hue a hýbať
len OKLCH svetlosťou a chromou o najmenej, čo stačí. Výsledok je 6 slotov, ktoré v
oboch režimoch prechádzajú všetkými kontrolami:

| Slot | Značka | Svetlý | Tmavý |
|---|---|---|---|
| 1 | modrá `#13B5EA` | `#079fcf` | `#079fcf` |
| 2 | červená `#D82727` | `#d62928` | `#da2d2b` |
| 3 | zelená `#37B268` | `#31a861` | `#35ab64` |
| 4 | tmavomodrá `#3657A7` | `#3657aa` | `#4e70bf` |
| 5 | zlatá `#DCB47B` | `#bb8b41` | `#b7883e` |
| 6 | fialová `#9C479B` | `#9d469c` | `#a755a5` |

Zmerané: susedné páry CVD ΔE 8,3 (svetlý) / 8,2 (tmavý), normálne videnie 25,3 /
22,4, všetko ≥ 3:1. Pri bodových grafoch, kde môžu byť susedmi ktorékoľvek dva
body, prejdú bezpečne **3 sloty** — nad tri sa séria zloží do jednej farby a
identitu nesie tabuľka. `tools/check-palette.mjs` to všetko premeria pri každom
commite, takže farbu už nikto nemôže „opraviť" od oka.

Poradie slotov nie je kozmetika. Prehľadal som všetkých 720 permutácií šiestich
hue; 96 z nich prechádza v oboch režimoch a vybral som spomedzi nich to, ktoré
začína korporátnou modrou a má najmenšiu odchýlku od značky.

## 6. Verdikt

| Časť prístupu | Vhodná? |
|---|---|
| Statický web bez build stepu, GitHub Pages | Áno, prevzaté |
| Observable Plot + D3 | Áno, prevzaté a vendorované na presnú verziu |
| Modulárne oddelenie model / render / shell | Áno, prevzaté |
| Predpočítaj raz, potom indexuj | Áno, ako `transform` pipeline |
| Tmavá téma a korporátne farby | Áno, ale paletu bolo treba prekalibrovať |
| Web worker + simulačný engine | Nie, pre dátovo riadený prehľad zbytočné |
| Grafy zadrôtované v kóde | Nie, nahradené manifestom |
| `Float64Array` dátový formát | Nie, nahradené tidy CSV |
| CDN na plávajúcom rozsahu | Nie, vendorované |
| Bez CI a bez kontroly odkazov | Nie — presne to spôsobilo, že originál nebeží |

Skelet teda áno, jadro nie. Súčasný web má z toho projektu tvar, nie obsah.

## 7. Čo by som doplnil ďalej

Nie je to v tejto dodávke, lebo si to nežiadal, ale je to logické pokračovanie:

1. ~~**Skript na import z Excelu**~~ — hotové: `tools/import_sp.py` prevádza zošity
   Sociálnej poisťovne z `data/zdroj/` a kontroluje súčty proti riadku „Celkom".
   Pozri `docs/ZDROJOVE_DATA.md`.
2. **Vlastné rozpätie rokov ako filter** — filtre teraz filtrujú podľa hodnoty
   stĺpca; posuvník rozsahu rokov by bol užitočný na časových radách.
3. **Trvalý odkaz na stav stránky** — filtre a skryté série do URL, aby sa dal
   konkrétny pohľad poslať mailom.
4. **Testy transformácií** — `lib/transform.js` je jediná vrstva s reálnou logikou
   a zaslúži si unit testy, nie len smoke test v prehliadači.
