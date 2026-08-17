# Ako pridať dáta a graf

Pridanie grafu nevyžaduje zmenu kódu. Vložíš CSV do `data/` a jeden blok do
`data/manifest.json`.

## Rýchly postup

```bash
# 1. CSV do data/
cp ~/moje_data.csv data/vydavky_2027.csv

# 2. dopíš dataset + view do data/manifest.json  (nižšie sú vzory)

# 3. skontroluj
npm run validate          # manifest + odkazy + paleta
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
  `"osôb"` a web ich sám skráti na „1,2 mil.".
- **`"type": "year"`** pri letopočtoch. Bez toho sa `2024` zobrazí ako `2 024,0`.

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
  alebo `index` transformácia na spoločný základ = 100 (vzor:
  `mzda_dochodok_index` v manifeste).
- **Nominálne kategórie** (druhy dôchodkov, krajiny) → jedna farba pre všetky
  stĺpce. Dĺžka stĺpca už nesie hodnotu; farbiť ju podľa veľkosti je dvojité
  kódovanie.
- **3D** len pri odozve na dva parametre, kde ide o tvar. Pre časovú radu s
  kategóriou je lepšia teplotná mapa alebo malé násobky.
- **Bodový graf** znesie najviac **3 barevné série** (limit je zmeraný, nie
  odhadnutý — pozri `docs/ZHODNOTENIE_PRISTUPU.md` §5). Viac sérií sa zlúči a
  identitu nesie tabuľka.

## 5. Transformácie

`"transform": [...]` sa aplikuje v poradí. Nechávajú CSV surové a úpravu robia na
strane view, takže jedno CSV môže živiť viacero grafov.

| `kind` | Čo robí | Príklad |
|---|---|---|
| `filter` | vyberie riadky | `{"kind":"filter","where":{"rok":{"gte":2020}}}` |
| `aggregate` | zoskupí a spočíta | `{"kind":"aggregate","by":["rok"],"value":"podiel_hdp","as":"sum"}` |
| `unpivot` | široký → dlhý | `{"kind":"unpivot","keep":["rok"],"into":"druh","value":"hodnota"}` |
| `pivot` | dlhý → široký | `{"kind":"pivot","key":"druh","value":"hodnota","by":["rok"]}` |
| `rename` | premenuje HODNOTY v stĺpci | `{"kind":"rename","column":"druh","map":{"starobne":"Starobné"}}` |
| `derive` | vypočíta nový stĺpec | `{"kind":"derive","into":"pomer","expr":"a / b * 100","vars":{"a":"dochodok","b":"mzda"}}` |
| `index` | prepočíta na základ = 100 | `{"kind":"index","value":"hodnota","by":["druh"],"on":"rok","at":2020}` |
| `sort` | zoradí | `{"kind":"sort","by":"hodnota","dir":"desc"}` |
| `topN` | ponechá N, zvyšok do „Ostatné" | `{"kind":"topN","n":6,"by":"hodnota","group":"krajina"}` |
| `limit` | prvých N riadkov | `{"kind":"limit","n":20}` |

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

## 7. Čo dostaneš zadarmo ku každému grafu

- tabuľku pod grafom so radením podľa stĺpca a exportom do CSV (UTF-8 s BOM, takže
  Excel otvorí diakritiku správne)
- tooltip, ktorý pri čiarových grafoch vypíše **všetky série** na danom X
- ovládanie klávesnicou (Tab na graf, ←/→ po hodnotách, Esc zatvorí)
- legendu s prepínaním sérií, ktorá pri skrytí série **neprefarbí** ostatné
- svetlý aj tmavý režim s vlastnými, zmeranými odtieňmi
- tlač: skryjú sa ovládacie prvky a rozbalia sa tabuľky
- odznak „Ilustračné dáta", kým dataset nemá reálny zdroj

## 8. Keď niečo nefunguje

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
| v legende je `nazov_stlpca` | po `unpivot` chýba `rename` |
| hodnoty sú 1000× menšie | `unit` hovorí „tis.", ale dáta sú surové (alebo naopak) |
