# CLAUDE.md

Statický web s dynamickými grafmi a tabuľkami k slovenskému dôchodkovému (PAYGO)
systému. **Koreň repozitára JE web** — žiadny build step, žiadny bundler.
Nasadzuje sa cez GitHub Pages priamo z vetvy.

## Prvé, čo treba vedieť

**Graf sa nepridáva kódom.** Pridá sa CSV do `data/` a jeden blok do
`data/manifest.json`. Manifest je kontrakt: deklaruje `datasets`, `pages`,
`views` a `dimensions`. Keď niečo treba zobraziť inak, skoro vždy je odpoveď
v manifeste, nie v JS. Nové typy grafov sú výnimka, nie pravidlo.

Postup a všetky typy grafov: **`docs/AKO_PRIDAT_DATA.md`**.
Prečo sú dáta rozdelené tak, ako sú: **`docs/DATOVA_ARCHITEKTURA.md`**.

## Príkazy

```bash
npm run serve         # http://localhost:8080
npm run validate      # manifest + vstupné súbory + paleta + odtlačky  ← pred každým commitom
npm run stamp         # po zmene app.js, lib/*.js alebo style.css: odtlačky v index.html
npm run shots         # vykreslí 18 stránok × 3 prostredia, hľadá chyby
npm run shots -- --check   # to isté bez ukladania PNG (beží aj v CI)

npm run data          # zošity Sociálnej poisťovne  -> data/sp_*.csv
npm run data:rrz      # manažérsky prehľad RRZ      -> data/rrz_*.csv, par_*.csv
npm run data:rrz:detail -- <report.xlsx>   # vývoj podľa druhu -> data/zdroj/RRZ_detail_druhy.xlsx
npm run vstup         # čo je v data/vstup/ a či to sedí na kontrakt
npm run vstup:gen     # pregeneruje syntetické vstupné dáta z modelu
```

`npm run validate` a `npm run shots --check` musia prejsť. CI ich beží tiež a
navyše overuje, že `data/*.csv` sa dá znova vyrobiť zo zošitov **byte na byte**.

## Tri miesta, kde žijú dáta — nemiešať

| | vzniká | ručná úprava |
|---|---|---|
| `data/*.csv` | import zo zošitov v `data/zdroj/` | **nie** — import ich prepíše a CI to zachytí |
| `data/vstup/*.csv` | ručne (dnes generátor) | **áno**, presne na to sú |
| `data/zdroj/*.xlsx` | pôvodné zošity | len výmenou za novšie |

Keď do vstupného súboru prídu reálne čísla, v manifeste sa zmaže `illustrative`
a `badge` — generátor nad tým súborom stráca právo a CI prestane porovnávať.

## Pravidlá, ktoré sa nedajú uhádnuť z kódu

- **Jeden súbor na jednu granularitu.** Rovnaký kľúč riadku = ďalší stĺpec, nie
  ďalší súbor. (Jedna veľká kocka bola prepočítaná a zamietnutá — viď
  `docs/DATOVA_ARCHITEKTURA.md`.)
- **Nikdy dve osi y.** Dve veličiny inej mierky = dva grafy.
- **Farba drží entitu, nie poradie.** Farebné sloty sa prideľujú v pevnom
  poradí: najviac 3 pri bodových a bublinových grafoch, 6 pri susediacich
  (stohované, zoskupené). Siedma séria sa skladá do „Ostatné", nefarbí sa.
  `npm run validate` to meria, nehádaj. Entity, ktoré musia mať rovnakú farbu
  v každom grafe, sú v manifeste `colors` — starobný dôchodok (vo všetkých
  definíciách) je modrý, muži tmavomodrí, ženy červené. Druhy dôchodku majú farbu
  rodiny: predčasný červený, invalidné zelené, pozostalostné tmavomodré,
  rodičovský zlatý, 13. dôchodok fialový, štátne dávky sivé (`other`).
- **Mriežka má 12 stĺpcov** a každý riadok stránky musí dať presne 12
  (`span` pri view). Validácia to odmietne.
- **Vodorovné stĺpce (`bar`) sú len jednosériové alebo stohované**; viac sérií
  vedľa seba vie len zvislý `bar-grouped` — a ten potrebuje krátke popisy osi
  (roky, kódy), inak sa zlejú.
- **Každá karta má tabuľkový dvojník a CSV export**; identita série nikdy nie je
  len farba.
- **Provenancia nie je nepovinná.** Dataset má `source` a `vintage`, alebo
  `illustrative: true` s odznakom. Validácia bez toho neprejde.
- **Tmavý režim je vybraný, nie prevrátený** — vlastné kroky palety.

## Pasce, ktoré už raz stáli čas

- Stĺpec s rokom musí mať `"type": "year"`. Ako string z neho bude ordinálna os
  s 55 značkami cez seba a Plot nakreslí do grafu ⚠.
- Výška karty je `size` (`s`/`m`/`l`/`xl`/`xxl`). Polomer bubliny je `radius`.
  Zámena zabila graf už dvakrát.
- Dlaždica (`tiles`) berie **posledný riadok** po filtri. Keď filter nechá viac
  riadkov, treba `"agg": "sum"`, inak ukáže posledný a tvári sa normálne.
- Karta na stránke s filtrom nesmie mať **pevný filter na ten istý stĺpec**
  (`"rok": 2024` pod filtrom Rok): pri inom roku ostane prázdna a dlaždica so
  `sum` ukáže nulu. Validácia to odmieta.
- Tabuľka berie názov stĺpca z `label` pri stĺpci datasetu; `labels` vo view to
  prebíja.
- Prúdový diagram má `minWidth` — pod ňou sa plocha posúva nabok vo vlastnom
  ráme, stránka sa neposúva.
- Po zmene kódu (`app.js`, `lib/*.js`, `style.css`) treba `npm run stamp`, inak
  `validate` neprejde. Bez odtlačkov v index.html prehliadač po nasadení až
  10 minút kreslil nový manifest starým kódom — nové voľby ticho ignoroval.
- Pri písaní podnadpisu grafu si **pozri vykreslený graf**. Dve tvrdenia už
  opisovali opak toho, čo krivka robí.

## Jazyk a tón

Web aj dokumentácia sú **po slovensky**, vrátane komentárov v novšom kóde.
Podnadpis karty hovorí, čo v dátach vidno, nie čo graf zobrazuje. Čísla sa
formátujú slovensky (desatinná čiarka, medzera v tisícoch) — to robí
`lib/format.js` podľa `unit` v manifeste, neformátuj ručne.

## Čo v repozitári nie je

- `node_modules/` (Playwright je len pre `npm run shots`, inštaluje sa podľa
  potreby; v CI aj v sandboxe môže byť predinštalovaný globálne)
- `screenshots/` — generovaný artefakt
- plný manažérsky report RRZ. V `data/zdroj/` sú dva výťahy: hárky `statistiky`
  a `parametre` (`npm run data:rrz:extract -- <report.xlsx>`) a vývoj podľa druhu
  dôchodku z hárkov `Popisne_statistiky` a `Poc_davok_podla_druhu_doch_mes`
  (`npm run data:rrz:detail -- <report.xlsx>`, len počet a priemer v troch
  definíciách a šesť druhov) spolu s rozkladom zmeny nákladov na starobné
  dôchodky z hárku `Rocne_naklady_podla_druhu_doch`. Zvyšné hárky sa zámerne
  nezverejňujú.
- Report z 11/2026 má hárky premenované na `cheatsheet-statistiky` a
  `cheatsheet-parametre` a popis „september 2026“ pri júnových číslach — hlavný
  výťah sa z neho preto zatiaľ neobnovoval.
