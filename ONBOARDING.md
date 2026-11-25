# Prehľad dôchodkového systému — odovzdanie projektu

Vitaj. Tento repozitár je **dátové rozhranie k slovenskému dôchodkovému (PAYGO)
systému**: 18 stránok, 63 grafov a tabuliek, 41 datasetov. Je to statický web bez
build stepu — koreň repozitára je priamo to, čo sa nasadí na GitHub Pages.

Tento dokument je úvod pre človeka aj pre Clauda. Operatívne pravidlá projektu
(príkazy, konvencie, pasce) sú v **`CLAUDE.md`** a načítajú sa automaticky v
každej relácii Claude Code v tomto repozitári.

## Čo projekt robí

Graf sa nepridáva kódom. Pridá sa CSV do `data/` a jeden blok do
`data/manifest.json` — ten je kontrakt, ktorý deklaruje datasety, stránky a
views. Validácia potom overí, že všetko, čo stránka načíta, naozaj existuje:
každý dataset, stĺpec, odkaz na view aj cesta k skriptu.

Vďaka tomu sa dá pridať celá stránka bez jediného riadku JavaScriptu — a naopak,
preklep v názve stĺpca spadne pri `npm run validate`, nie až na webe.

## Prvých päť minút

```bash
npm run serve      # http://localhost:8080
npm run validate   # musí prejsť: manifest + vstupné súbory + paleta
npm run shots      # vykreslí 18 stránok × 3 prostredia do screenshots/
```

`npm run shots` potrebuje Playwright (`npm install`); ostatné nemá žiadne
závislosti — d3, Observable Plot a Plotly sú vendorované v `vendor/` na pevných
verziách.

## Odkiaľ sú dáta

| zdroj | čo z neho je | kde |
|---|---|---|
| Sociálna poisťovňa — mesačné a ročné zošity | výdavky, počty, priemerné dôchodky 2009–2026 | `data/sp_*.csv` |
| Manažérsky prehľad dôchodkového systému (Kancelária RRZ) | tri definície priemerného dôchodku, muži vs. ženy, krátenie za II. pilier, dĺžka poberania, náklady podľa druhu, celá legislatívna parametrika | `data/rrz_*.csv`, `data/par_*.csv` |
| model kalibrovaný na zverejnené kotvy | to, čo v zošitoch nie je (rozdelenie po pásmach, prežitie generácií, matica prechodov) | `data/vstup/*.csv` |

Zdrojové zošity sú commitnuté v `data/zdroj/` a CI overuje, že sa z nich CSV dá
znova vyrobiť **byte na byte**. Generované CSV sa preto neupravujú ručne —
najbližší import ich prepíše a CI to zachytí.

Syntetické datasety majú na karte odznak **„Syntetické dáta"** a v zdroji
vypísané kotvy, na ktorých model stojí. Keď prídu reálne čísla, prepíšu sa
hodnoty vo vstupnom súbore a v manifeste sa zmaže `illustrative` — generátor nad
tým súborom stráca právo.

## Čo je hotové a čo zostáva

Hotové: celá dátová vrstva, 2D aj 3D grafy, prúdový diagram prechodov medzi
stavmi, animácia časom, mobilná navigácia, tmavý režim, validácie a CI.

Otvorené / na pokračovanie:
- **Päť stránok beží na syntetických dátach** (rozdelenie dôchodkov, podľa veku a
  pohlavia, podľa kategórie, doba poberania, II. pilier). Evidencia zadaných
  ukazovateľov a čo k nim treba: `docs/POZADOVANE_UKAZOVATELE.md`.
- Podrobné hárky manažérskeho reportu RRZ (pracujúci dôchodcovia po deciloch,
  boxploty, kumulatívne distribúcie) zatiaľ zapracované nie sú — do projektu išli
  hárky `statistiky` a `parametre`.

## Dokumentácia

| súbor | o čom |
|---|---|
| `CLAUDE.md` | pravidlá projektu — číta ich Claude v každej relácii |
| `README.md` | prehľad, štruktúra priečinkov, ako sa nasadzuje |
| `docs/AKO_PRIDAT_DATA.md` | ako pridať dáta a graf, všetky typy grafov a transformácií |
| `docs/DATOVA_ARCHITEKTURA.md` | prečo sú dáta rozdelené tak, ako sú (vrátane prepočtu „jedna veľká kocka?") |
| `docs/POZADOVANE_UKAZOVATELE.md` | evidencia zadaní a ich stavu |
| `docs/ZDROJOVE_DATA.md` | čo presne je v ktorom zošite |
| `docs/VIZUALNY_AUDIT.md` | posledná vizuálna kontrola a jej nálezy |
| `data/vstup/README.md` | ako doplniť reálne čísla do vstupných súborov |

## Ako s týmto projektom pracovať s Claudom

Claude Code si `CLAUDE.md` načíta sám. Oplatí sa mu zadávať úlohy v jazyku
projektu — „pridaj stránku s X", „nahraď syntetické dáta na stránke Y reálnymi
z tohto zošita", „urob vizuálny audit" — a nechať ho prejsť `npm run validate`
a `npm run shots` pred commitom. Tie dve veci zachytia väčšinu chýb skôr, než
sa dostanú na web.

Čo si pri preberaní overiť ako prvé: ktorá vetva je tá živá a odkiaľ nasadzuje
GitHub Pages (Settings → Pages). História projektu vznikla na vývojovej vetve,
nie na `main`.
