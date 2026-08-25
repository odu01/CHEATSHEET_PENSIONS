# Ako pridať dáta a graf

Pridanie grafu nevyžaduje zmenu kódu. Vložíš CSV do `data/` a jeden blok do
`data/manifest.json`.

Dve miesta, kde CSV žijú, a nemiešajú sa:

- **`data/*.csv`** — generované zo zošitov v `data/zdroj/` skriptom
  `npm run data`. Ručne sa needitujú, najbližší import ich prepíše.
- **`data/vstup/*.csv`** — ručný vstup. Sem sa dopĺňajú čísla, ktoré v zošitoch
  nie sú. Súbory tam už dáta majú (syntetické, viditeľne označené), takže
  „doplniť" znamená prepísať hodnoty. Postup:
  [../data/vstup/README.md](../data/vstup/README.md).

## Rýchly postup

```bash
# 1. CSV do data/ (alebo prepíš hodnoty v data/vstup/)
cp ~/moje_data.csv data/vydavky_2027.csv

# 2. dopíš dataset + view do data/manifest.json  (nižšie sú vzory)

# 3. skontroluj
npm run validate          # manifest + vstupné súbory + odkazy + paleta
npm run vstup             # čo je v data/vstup a čo v ňom chýba
npm run serve             # http://localhost:8080
```

Ak validácia prejde a stránka sa vykreslí, je to hotové. Commit ide priamo do
`main`, GitHub Pages nasadí koreň repozitára bez build stepu.

---

## 1. Tvar CSV

Dlhý („tidy") formát: **jeden riadok = jedno pozorovanie**, stĺpce sú premenné.

```csv
rok,druh,podiel_hdp
2024,Starobné,6.12
2024,Invalidné,1.08
2025,Starobné,6.19
2025,Invalidné,1.08
```

Toto je tvar, ktorý živí čiarové, plošné, stĺpcové aj skladané grafy bez ďalšej
práce.

Ak dostaneš tabuľku v širokom formáte (jeden stĺpec na kategóriu), nemusíš ju
prepisovať — nechaj to na transformáciu `unpivot`:

```csv
rok,starobne,invalidne,pozostalostne
2024,6.12,1.08,0.74
```

Parser zvládne: `,` `;` aj tab; hodnoty v úvodzovkách; `1234.5` aj slovenské
`1 234,5`; BOM z Excelu. Prázdna hodnota, `.`, `..`, `-`, `NA` sa čítajú ako
**chýbajúca** — v grafe vznikne medzera, nie pád na nulu.

## 2. Zápis datasetu

```json
"vydavky_2027": {
  "file": "data/vydavky_2027.csv",
  "label": "Výdavky na dôchodky",
  "unit": "% HDP",
  "source": "Sociálna poisťovňa, vlastný prepočet RRZ",
  "vintage": "2027-03",
  "illustrative": false,
  "columns": {
    "rok": { "type": "year" },
    "druh": { "type": "string" },
    "podiel_hdp": { "type": "number" }
  }
}
```

Tri veci, ktoré sa dajú ľahko pokaziť:

- **`source` je povinný**, ak dataset nie je `"illustrative": true`. Validácia inak
  neprejde. Je to zámerné: publikovaný štatistický prehľad nemá mať čísla bez
  zdroja.
- **`unit` má význam pre formátovanie.** `"tis. osôb"` znamená, že čísla **už sú**
  v tisícoch — web ich neprepočíta znova. Ak sú v CSV surové osoby, napíš
  `"osôb"` alebo `"dôchodkov"`: v tabuľke sa zobrazí presne (`1 134 690`), na osi
  skrátene (`1,13 mil.`).
- **`"type": "year"`** pri letopočtoch. Bez toho sa `2024` zobrazí ako `2 024,0`.
- **`"type": "month"`** pri mesačných radách v tvare `2024-01`. Načíta sa ako
  dátum, takže os použije časovú škálu namiesto 200 kategórií.

## 3. Zápis view

```json
"vydavky_2027_trend": {
  "type": "line",
  "title": "Výdavky na dôchodky",
  "subtitle": "Podiel na HDP podľa druhu dôchodku.",
  "dataset": "vydavky_2027",
  "x": "rok",
  "y": "podiel_hdp",
  "series": "druh",
  "unit": "% HDP",
  "xTickFormat": "year",
  "yLabel": "% HDP",
  "size": "m",
  "labels": { "rok": "Rok", "druh": "Druh", "podiel_hdp": "Výdavky" }
}
```

A pridaj id do niektorej stránky:

```json
{ "id": "vydavky", "label": "Výdavky", "views": ["vydavky_2027_trend", "..."] }
```

## 4. Typy grafov

| `type` | Na čo | Povinné kľúče |
|---|---|---|
| `line` | vývoj v čase | `x`, `y` |
| `area` | jedna rada v čase, objem | `x`, `y` |
| `area-stacked` | skladba celku v čase | `x`, `y`, `series` |
| `column` | porovnanie kategórií (vertikálne) | `x`, `y` |
| `bar` | porovnanie mnohých kategórií (vodorovne) | `x`, `y` |
| `bar-stacked` | skladba v rámci kategórie | `x`, `y`, `series` |
| `bar-grouped` | kategórie × séria vedľa seba | `x`, `y`, `series` |
| `scatter` | vzťah dvoch veličín | `x`, `y` |
| `heatmap` | matica dvoch dimenzií | `x`, `y`, `value` |
| `pyramid` | veková štruktúra podľa pohlavia | `y`, `value`, `series` |
| `waterfall` | rozklad zmeny na faktory | `x`, `y` (+ `totalFlag`) |
| `surface3d` | odozva na dva parametre | `x`, `y`, `z` |
| `scatter3d` | tri merané dimenzie | `x`, `y`, `z` |
| `tiles` | kľúčové čísla | `tiles` |
| `table` | len tabuľka | `dataset` |

### Ako si vybrať

- **Dve veličiny v rovnakých jednotkách** (mzda a dôchodok v EUR) → jeden `line`
  s `series`.
- **Dve veličiny v rôznych jednotkách** → **nikdy nie druhá os.** Buď dva grafy,
  alebo `index` transformácia na spoločný základ = 100.
- **Nominálne kategórie** (druhy dôchodkov, krajiny) → jedna farba pre všetky
  stĺpce. Dĺžka stĺpca už nesie hodnotu; farbiť ju podľa veľkosti je dvojité
  kódovanie.
- **3D** len pri odozve na dva parametre, kde ide o tvar. Pre časovú radu s
  kategóriou je lepšia teplotná mapa alebo malé násobky.
- **Bodový graf** znesie najviac **3 barevné série** (limit je zmeraný, nie
  odhadnutý — pozri `docs/ZHODNOTENIE_PRISTUPU.md` §5). Viac sérií sa zlúči a
  identitu nesie tabuľka.
- **Viac než 6 kategórií v skladanom grafe** → nezlučuj ich mechanicky do
  „Ostatné": sivá prejde limitom susednosti len vedľa červenej. Zlúč ich vecne.
  Vzor: vdovský + vdovecký + sirotský = „Pozostalostné", čím z 8 druhov dôchodku
  vzniknú presne 4 zmysluplné kategórie plus rodičovský a 13. dôchodok.

## 5. Transformácie

`"transform": [...]` sa aplikuje v poradí. Nechávajú CSV surové a úpravu robia na
strane view, takže jedno CSV môže živiť viacero grafov.

| `kind` | Čo robí | Príklad |
|---|---|---|
| `filter` | vyberie riadky | `{"kind":"filter","where":{"rok":{"gte":2020}}}` |
| `aggregate` | zoskupí a spočíta | `{"kind":"aggregate","by":["rok"],"value":"podiel_hdp","as":"sum"}` |
| `unpivot` | široký → dlhý | `{"kind":"unpivot","keep":["rok"],"into":"druh","value":"hodnota"}` |
| `pivot` | dlhý → široký | `{"kind":"pivot","key":"druh","value":"hodnota","by":["rok"]}` |
| `rename` | premenuje HODNOTY v stĺpci | `{"kind":"rename","column":"druh","map":{"Vdovský":"Pozostalostné"}}` |
| `derive` | vypočíta nový stĺpec | `{"kind":"derive","into":"pomer","expr":"a / b * 100","vars":{"a":"dochodok","b":"mzda"}}` |
| `index` | prepočíta na základ = 100 | `{"kind":"index","value":"hodnota","by":["druh"],"on":"rok","at":2020}` |
| `sort` | zoradí (`dir` môže byť pole podľa `by`) | `{"kind":"sort","by":["rok","mesiac"],"dir":["desc","asc"]}` |
| `bin` | zoskupí čísla do pásiem | `{"kind":"bin","column":"vek","into":"vekova_skupina","width":5,"max":95,"maxLabel":"95+"}` |
| `cumsum` | bežiaci súčet a podiel | `{"kind":"cumsum","columns":["pocet","vydavky"],"by":["rok"],"share":true,"origin":true}` |
| `topN` | ponechá N, zvyšok do „Ostatné" | `{"kind":"topN","n":6,"by":"hodnota","group":"krajina"}` |
| `limit` | prvých N riadkov | `{"kind":"limit","n":20}` |

`bin` píše názov pásma do `into` a jeho číselný začiatok do `<into>_od` — podľa
toho sa dá pásma zoradiť numericky. Vďaka tomu stačí v CSV vek po jednotlivých
rokoch a ten istý súbor uživí aj graf po rokoch veku, aj pyramídu po pásmach.

`cumsum` sčítava **v poradí riadkov**, tak pred neho patrí `sort`. So `share`
pridá aj `<stlpec>_kum_pct`, teda bežiaci podiel na súčte skupiny; dva takéto
podiely proti sebe na osiach sú kumulatívna distribúcia (Lorenzova krivka).
`origin` predradí nulový bod, bez ktorého by krivka nezačínala v (0, 0) — taký
riadok v dátach neexistuje, tabuľka pásiem začína až na hornej hranici prvého
pásma. Celá krivka „koľko % výdavkov ide na koľko % dôchodcov" je potom:

```json
[{ "kind": "sort", "by": "od_eur" },
 { "kind": "derive", "into": "vydavky_eur", "expr": "n * p", "vars": { "n": "pocet", "p": "priemer_eur" } },
 { "kind": "cumsum", "columns": ["pocet", "vydavky_eur"], "by": ["rok"], "share": true, "origin": true },
 { "kind": "derive", "into": "rovnomerne", "expr": "v", "vars": { "v": "pocet_kum_pct" } },
 { "kind": "unpivot", "keep": ["pocet_kum_pct"], "only": ["vydavky_eur_kum_pct", "rovnomerne"],
   "into": "kategoria", "value": "hodnota" },
 { "kind": "rename", "column": "kategoria",
   "map": { "vydavky_eur_kum_pct": "Výdavky na dôchodky", "rovnomerne": "Rovnomerné rozdelenie" } }]
```

Posledné dva kroky pridajú do grafu diagonálu rovnomerného rozdelenia — bez nej
sa krivka nedá s ničím porovnať.

Rozdiel, ktorý mätie: **`labels` premenúva NÁZVY STĹPCOV** (pre tabuľku a export),
**`rename` premenúva HODNOTY** v stĺpci (pre legendu a tooltip). Po `unpivot`
budeš takmer vždy chcieť `rename`, inak sa v legende objaví `priemerna_mzda_eur`.

## 6. Filtre nad stránkou

Jeden riadok filtrov nad všetkými kartami; filtruje všetky naraz, takže čísla si
navzájom odpovedajú.

```json
"filters": [
  { "dataset": "vydavky", "column": "druh", "label": "Druh dôchodku", "allLabel": "Všetky druhy" }
]
```

Filter sa aplikuje len na datasety, ktoré daný stĺpec majú — karty z iných datasetov
zostanú nedotknuté.

Dve veci, na ktoré si dať pozor:

- **`"required": true`** vypne možnosť „Všetko". Použi ju, keď view predpokladá
  jednu hodnotu naraz. Vzor: graf „novopriznaný vs vyplácaný" má sériu
  `kategoria` (dve hodnoty); keby v dátach zostalo päť druhov dôchodku, Plot by
  nakreslil jednu čiaru cikcakom cez všetky.
- **Filter platí pre celú stránku.** Graf, ktorý má zmysel len bez filtra (napr.
  „podľa druhu" so všetkými sériami), preto nedávaj na tú istú stránku — filter ho
  zredukuje na jednu sériu. Rozdeľ stránky; presne preto sú „Priemerné dôchodky"
  a „Novopriznané" dve.

## 7. Ukazovateľ, ku ktorému ešte nemáme reálne čísla

Prázdna karta s nápisom „čaká na dáta" nič nehovorí — nedá sa na nej posúdiť, či
je zvolený tvar grafu ten správny. Preto taký ukazovateľ dostane **syntetické
dáta**: rad z modelu kalibrovaného na zverejnené čísla, jasne označený, a
uložený v `data/vstup/` — teda presne v tom súbore, ktorý sa neskôr prepíše
reálnymi hodnotami.

```json
"dochodky_pasma": {
  "file": "data/vstup/dochodky_pasma.csv",
  "label": "Starobné dôchodky podľa výšky",
  "unit": "dôchodkov",
  "source": "Syntetické dáta (tools/gen_vstup.py) — kalibrované na 1 134 690 dôchodkov a priemer 683,10 € k 31. 12. 2024",
  "vintage": "2024 (modelované na zverejnené súčty)",
  "illustrative": true,
  "badge": "Syntetické dáta",
  "badgeNote": "Presné počty po pásmach SP nezverejňuje. Model drží zverejnené súčty a medzi nimi interpoluje.",
  "columns": {
    "pasmo":       { "type": "string", "label": "Označenie pásma", "unit": null },
    "od_eur":      { "type": "int",    "label": "Dolná hranica pásma v EUR (radí pásma)", "unit": "EUR" },
    "pocet":       { "type": "int",    "label": "Počet dôchodkov v pásme", "measure": true },
    "priemer_eur": { "type": "number", "label": "Priemer v pásme, EUR/mes.", "unit": "EUR", "decimals": 2 }
  }
}
```

Tri veci, ktoré to nastavuje:

- **`illustrative: true`** — karta dostane výstražný odznak a validácia neprosí o
  zdroj. Je to zároveň prepínač pre generátor: kým je nastavený, `npm run
  vstup:gen` smie súbor prepísať; keď sa zmaže, generátor sa ho už nedotkne.
  Prepísať reálne dáta modelom je presne ten tichý úraz, ktorý sa nesmie stať.
- **`badge` / `badgeNote`** — čo za číslo to je. „Syntetické dáta" (rad z modelu
  na zverejnených kotvách) je iné tvrdenie než „Ilustračné dáta" (vymyslená
  ukážka) a čitateľ to má vidieť bez čítania zdroja.
- **`columns` s `label`** — kontrakt. `unit` a `decimals` platia pre ten stĺpec
  v tabuľke (dataset môže mať počty vedľa eur), `measure: true` označí stĺpec ako
  hodnotu, nie rozmer — podľa toho `npm run vstup` kontroluje duplicitné kľúče.

Model a jeho kotvy sú v `tools/gen_vstup.py`; každý dataset si tam kontroluje
súčtom, že kotvy naozaj drží, inak generátor skončí chybou. Postup dopĺňania
reálnych čísel je v [../data/vstup/README.md](../data/vstup/README.md), kontrola
súboru je `npm run vstup`.

Ak dáta naozaj nemajú byť zobrazené vôbec (nie sú a ani model by nemal zmysel),
existuje ešte `"planned": true`: karta zobrazí odznak „Čaká na dáta" a tvar
súboru, ktorý sa má dodať. Vtedy súbor **nesmie existovať** a dataset musí mať
`note` a `columns` s `label`. Filtre na takej stránke nemajú z čoho vziať
hodnoty, tak sa vypíšu rovno:

```json
"filters": [
  { "dataset": "starobni_veky", "column": "kategoria", "label": "Kategória",
    "values": ["Iba SP", "SP + II. pilier", "SP + cudzina", "SP + výsluhové"],
    "default": "Iba SP", "required": true }
]
```

`values` zároveň dokumentuje presné znenie, ktoré má dodaný súbor obsahovať.

Prehľad toho, čo je zadané a na čo sa čaká, je v
[POZADOVANE_UKAZOVATELE.md](POZADOVANE_UKAZOVATELE.md).

## 8. Čo dostaneš zadarmo ku každému grafu

- tabuľku pod grafom so radením podľa stĺpca a exportom do CSV (UTF-8 s BOM, takže
  Excel otvorí diakritiku správne)
- tooltip, ktorý pri čiarových grafoch vypíše **všetky série** na danom X
- ovládanie klávesnicou (Tab na graf, ←/→ po hodnotách, Esc zatvorí)
- legendu s prepínaním sérií, ktorá pri skrytí série **neprefarbí** ostatné
- svetlý aj tmavý režim s vlastnými, zmeranými odtieňmi
- tlač: skryjú sa ovládacie prvky a rozbalia sa tabuľky
- odznak „Ilustračné dáta", kým dataset nemá reálny zdroj

## 9. Keď niečo nefunguje

```bash
npm run validate:manifest   # chýbajúci súbor, zlý stĺpec, neznámy typ, rozbitý odkaz
npm run validate:palette    # farba mimo prístupnostných limitov
npm run shots               # vykreslí všetky stránky do screenshots/ a nájde chyby v konzole
```

Časté hlásenia:

| Hlásenie | Príčina |
|---|---|
| `y="..." nie je stĺpec datasetu` | typo v názve stĺpca, alebo stĺpec vyrába transformácia, ktorú validátor nepozná |
| `chýba "source"` | doplň zdroj, alebo označ `"illustrative": true` |
| `súbor ... neexistuje` | cesta v `file` je od koreňa repozitára, nie od `data/` |
| `riadok N má iný počet stĺpcov` | v CSV je čiarka v texte bez úvodzoviek |
| rok sa zobrazuje `2 024,0` | chýba `"type": "year"` |
| na osi je 200 popiskov mesiacov | mesiac je string; nastav `"type": "month"` a `"xTickFormat": "month"` |
| os počtov opakuje `1,7 mil.` | rozsah je úzky — už sa rieši automaticky podľa rozpätia osi |
| v legende je `nazov_stlpca` | po `unpivot` chýba `rename` |
| filter je prázdny a nedá sa klikať | dataset je `planned` — dopíš do filtra `values` |
| na osi je 55 rokov natlačených na sebe a v grafe je ⚠ | stĺpec rokov nemá `"type": "year"`, tak z neho je text a os je ordinálna |
| počet osôb sa vypíše ako „23 281,0" | stĺpec nemá `"type": "int"` |
| graf ukazuje len jedno pohlavie a filter na stránke nie je | starý stav filtra z inej stránky; `openPage` ho pri zmene stránky maže |
| „dataset je označený planned, ale súbor už existuje" | pridal si dáta, zruš príznak `planned` |
| hodnoty sú 1000× menšie | `unit` hovorí „tis.", ale dáta sú surové (alebo naopak) |
