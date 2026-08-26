# Dátová architektúra

Prečo sú dáta rozdelené tak, ako sú, a čo z toho vyplýva pre dopĺňanie. Merané,
nie odhadnuté — čísla nižšie sa dajú prepočítať skriptami v `tools/`.

## Čo stránka naozaj stiahne

| stránka | požiadaviek | spolu | z toho CSV |
|---|---|---|---|
| typická (prehľad, výdavky, počty…) | 19–22 | 750–830 KB | 1–93 KB |
| podľa veku a pohlavia | 19 | 845 KB | **97 KB** |
| sezónnosť (3D) | 20 | **2 322 KB** | 3 KB |

Všetky CSV v repozitári spolu majú **392 KB**. Knižnice majú **477 KB** (d3 273 +
Observable Plot 204) a načítavajú sa na každej stránke.

Z toho vyplýva jediný záver, ktorý treba pri „minimalizácii dát" držať v hlave:
**dáta nie sú to, čo tú stránku váži.** Knižnice sú 4–8× väčšie než dáta, ktoré
stránka zobrazuje. Optimalizovať bajty v CSV má zmysel len tam, kde ide o
desiatky kilobajtov naraz (a jedno také miesto sme mali — viď kódy nižšie).

Prečo sa knižnice nedajú zmenšiť: Plot ich UMD build **vyžaduje d3 ako externú
závislosť** (`define(["exports","d3"], …)` v hlavičke balíka), takže d3 sa vyhodiť
nedá. Tree-shaking by potreboval bundler, a projekt je zámerne bez build stepu.
477 KB je teda cena za „žiadny build" a je to vedomé rozhodnutie, nie prehliadnutie.
Plotly (1,5 MB) sa načítava lenivo a len na jedinej stránke s 3D povrchom.

Skripty sú `defer`, takže nezdržujú prvé vykreslenie.

## Jedna veľká kocka verzus tabuľka na každý jav

Otázka, ktorá sa vždy vráti: nemalo by to byť jedno veľké CSV s dimenziami?
Prepočítané na skutočných dátach tohto projektu:

| | dnes | jedna kocka |
|---|---|---|
| súborov | 7 | 1 |
| riadkov | 5 671 | 10 403 |
| stĺpcov | 3–6 podľa javu | 14 (únia dimenzií) |
| buniek | 30 572 | 145 642 |
| prázdnych buniek | 0 | **72 %** |
| bajtov | **123 KB** | **~422 KB** |
| čo stiahne stránka | len to, čo kreslí | celú kocku |

Únia dimenzií je `kategoria · kohorta · mesiac · od_eur · pasmo · pohlavie · rok ·
rok_do · rok_od · stav_do · stav_od · vek`. Prežitie generácií nepozná pohlavie,
prechody nepoznajú vek, pásma nepoznajú mesiac — a v kocke by každý riadok nosil
prázdne miesta po všetkých ostatných. **Kocka je 3,4× väčšia, zo troch štvrtín
prázdna, a načítala by sa celá na každej stránke.** Preto nie.

Správna hranica nie je „veľa malých verzus jeden veľký", ale **granularita**:

> **Jeden súbor na jednu granularitu.** Dva javy, ktoré majú tú istú kombináciu
> dimenzií, patria do jedného súboru ako dva stĺpce. Dva javy s inou kombináciou
> patria do dvoch súborov.

Preto `pilier2.csv` má aktíva aj sporiteľov v jednom súbore (oboje je „za mesiac"),
`doba_poberania.csv` má priemer aj počet zomretých (oboje „za rok × pohlavie"), a
prežitie generácií je zvlášť (má dimenziu `kohorta`, ktorú nikto iný nemá).

Kontrola pri pridávaní javu: **aký je kľúč riadku?** Ak sa presne zhoduje s
niektorým existujúcim súborom, pridaj stĺpec. Inak nový súbor.

## Kódy v dátach, názvy v metadátach

Dlhý názov kategórie, ktorý sa v súbore zopakuje stotisíckrát, je zbytočná váha aj
otvorená dvierka pre preklep. Preto je vokabulár deklarovaný **raz** v manifeste v
`dimensions` a dáta nesú kódy:

```json
"dimensions": {
  "pohlavie": { "M": "Muži", "Z": "Ženy" },
  "kategoria_dochodcu": { "S": "Iba SP", "PCV": "SP + všetky tri", … }
}
```

```csv
rok,vek,pohlavie,kategoria,pocet,priemer_eur
2024,68,M,S,23455,883.4
```

Tri veci naraz:

1. **Menej bajtov.** `starobni_podla_veku.csv` spadol z 181 KB na 97 KB (−46 %) len
   tým, že názvy kategórií a pohlaví vystriedali kódy.
2. **Uzavretý slovník.** `npm run vstup` odmietne hodnotu, ktorá v kódovníku nie
   je. Predtým „Muzi" namiesto „Muži" ticho vyrobilo trinástu kategóriu a graf
   stratil sériu — nič nespadlo, len to bolo nesprávne.
3. **Preformulovanie bez dotknutia dát.** Zmena „Iba SP" na „Len dôchodok zo SP"
   je zmena jedného riadku manifestu.

Loader prijíma **kód aj názov**, takže malý ručne písaný súbor môže zostať pri
slovách (`doba_poberania.csv` má `Muži`) a veľký generovaný pri kódoch — a oba
skončia v aplikácii ako to isté. Validácia povolí obe formy a nič iné.

Pravidlo: **kódy tam, kde má súbor tisíce riadkov; slová tam, kde ich má desiatky.**

## Kontrolné súčty: čo drží dáta pri zemi

Formát súboru sa dá overiť. Že sú v ňom správne čísla, sa overiť nedá — pokiaľ sa
nepovie, na čo sa musia rovnať. Preto dataset môže deklarovať kontroly:

```json
"checks": [
  { "kind": "sum", "column": "pocet", "where": { "rok": 2024 },
    "equalsDataset": { "dataset": "pocty_mesacne", "column": "pocet",
                       "where": { "mesiac": "2024-12", "druh": "Starobný" } },
    "tolerance": 0.01,
    "note": "Súčet za rok 2024 musí dať zverejnený stav starobných dôchodkov." }
]
```

Beží to v `npm run vstup` aj v CI. Dnes je nasadených päť kontrol a dve z nich sú
**krížové medzi súbormi** — počet úmrtí v `doba_poberania.csv` sa musí rovnať
počtu úmrtí v matici prechodov. To je presne ten druh chyby, ktorý ručná výmena
dát prináša a ktorý žiadna kontrola formátu nezachytí:

```
doba_poberania: súčet pocet_zomretych (rok=2024) = 45500 — v súbore je 31 111,
  očakáva sa 45 500 (rozdiel 31.6 %, povolené 3.0 %) — Musí sedieť s počtom
  úmrtí v matici prechodov — dva súbory, jedno číslo.
```

Validácia manifestu navyše overuje, že kontrola má na čo ukazovať: kontrola
mieriaca na neexistujúci stĺpec by nikdy nebežala a to je horšie než žiadna —
vyzeralo by to, že dáta sú overené.

## Široká tabuľka pri odovzdaní

Človek, ktorý vypĺňa tabuľku, dá roky do hlavičky. Web chce dlhý formát. Riešenie
je na strane webu, nie na strane človeka — dataset môže povedať, že súbor prichádza
naširoko:

```json
"shape": { "kind": "wide", "keep": ["vek"], "into": "rok", "value": "pocet" }
```

Prevod sa deje **pri načítaní**, takže grafy, transformácie ani tabuľka o tom nič
nevedia, a ten, kto dáta dodáva, nemusí nič pivotovať.

## Kde čo žije

| | `data/*.csv` | `data/vstup/*.csv` |
|---|---|---|
| vzniká | `npm run data` zo zošitov v `data/zdroj/` | ručne (dnes `npm run vstup:gen`) |
| ručná úprava | nie, import prepíše | áno, presne na to sú |
| kontroluje | kontrolné súčty proti riadku „Celkom" v zošite | `npm run vstup`: kontrakt, slovník, kontrolné súčty |
| CI overuje | zhodu s zošitmi | zhodu s generátorom, kým je dataset syntetický |

Keď do vstupného súboru prídu reálne čísla a v manifeste sa zmaže `illustrative`,
generátor nad tým súborom stráca právo — už ho neprepíše a CI prestane porovnávať.

## Zhrnutie pravidiel

1. Jeden súbor na jednu granularitu; rovnaký kľúč riadku = ďalší stĺpec, nie ďalší súbor.
2. Dlhý (tidy) formát v súbore; širokú tabuľku prevedie `shape` pri načítaní.
3. Kódy v dátach, názvy v `dimensions` — pri tisícoch riadkov. Pri desiatkach slová.
4. Každý dataset má `unit` a typ pri každom stĺpci; `measure: true` odlíši hodnotu od rozmeru.
5. Čo sa musí rovnať, to sa deklaruje ako `checks` — vrátane krížových kontrol medzi súbormi.
6. Provenancia nie je nepovinná: `source`, alebo `illustrative: true` s odznakom.
