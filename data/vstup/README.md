# data/vstup — sem sa dopĺňajú dáta

Toto je jediné miesto, kde sa čísla dopĺňajú **ručne**. Ostatné CSV v `data/`
vznikajú skriptom zo zošitov v `data/zdroj/` a editovať sa nemajú — najbližší
import ich prepíše.

Každý súbor tu **už dáta má**. Sú syntetické: z modelu kalibrovaného na
zverejnené čísla, nie meranie. Na weboch má každá karta nad takým súborom
výstražný odznak „Syntetické dáta" a v zdroji vypísané kotvy, na ktorých model
stojí. Dôvod, prečo nie sú karty prázdne: prázdna karta sa nedá posúdiť. Pri
grafe s číslami je hneď vidieť, či je zvolený tvar grafu ten správny, či os
niečo neodreže a či sa dá z toho niečo prečítať.

## Ako doplniť reálne dáta

```bash
npm run vstup            # vypíše, čo ktorý súbor obsahuje a čo v ňom treba
```

1. **Prepíš hodnoty** v príslušnom `data/vstup/*.csv`. Hlavička sa nemení —
   presne tie stĺpce, v tom poradí, s tými istými hodnotami v rozmeroch
   (`Muži`/`Ženy`, názvy kategórií). Riadkov môže byť koľkokoľvek.
2. **V `data/manifest.json`** v príslušnom datasete:
   - zmaž `"illustrative": true`, `"badge"` a `"badgeNote"`,
   - do `"source"` napíš, odkiaľ čísla sú, do `"vintage"` za aké obdobie.
3. `npm run vstup` — overí hlavičku, typy, prázdne hodnoty, duplicitné kľúče a
   diery v radoch rokov či vekov.
4. `npm run validate && npm run shots` — a pozri sa na obrázky.

Krok 2 nie je kozmetika. Kým je `illustrative` nastavené, `npm run vstup:gen`
smie súbor prepísať modelom. Keď ho zmažeš, generátor sa toho súboru už
nedotkne — dáta sú odvtedy tvoje.

Prázdnu hlavičku na začiatok vypíše `node tools/check-vstup.mjs --sablona <dataset>`.

## Čo je v ktorom súbore

| súbor | dataset | riadok = | stránka |
|---|---|---|---|
| `starobni_podla_veku.csv` | `starobni_veky` | rok × vek × pohlavie × kategória | Podľa veku a pohlavia, Podľa kategórie |
| `doba_poberania.csv` | `doba_poberania` | rok úmrtia × pohlavie | Doba poberania |
| `pilier2.csv` | `pilier2` | mesiac | II. pilier |
| `dochodky_pasma.csv` | `dochodky_pasma` | pásmo výšky dôchodku | Rozdelenie dôchodkov |
| `prezitie_kohort.csv` | `prezitie_kohort` | generácia × vek | Demografia |
| `nadej_dozitia_vek.csv` | `nadej_dozitia_vek` | rok × dosiahnutý vek | Demografia |
| `prechody_stavov.csv` | `prechody` | prúd zo stavu do stavu | Pohyb v čase |

Presné stĺpce, typy a významy sú v manifeste (`data/manifest.json`, kľúč
`columns`) a vypíše ich `npm run vstup`. Tu sú len tie veci, ktoré sa z hlavičky
nevyčítajú:

**`starobni_podla_veku.csv`** — vlastnosti dôchodcu sa prekrývajú (sporiteľ môže
mať aj dôchodok z Česka), preto `kategoria` nesie **nepretínajúce sa kombinácie**:

```
Iba SP · SP + II. pilier · SP + cudzina · SP + výsluhové
SP + II. pilier + cudzina · SP + II. pilier + výsluhové
SP + cudzina + výsluhové · SP + všetky tri
```

Každý dôchodca je teda v súbore presne raz a súčet za vek dáva celok. Skupiny ako
„všetci sporitelia" (aj tí s ďalšou vlastnosťou) si web dopočíta sám — v súbore
nemajú vlastné riadky, inak by sa niekto počítal dvakrát. Kombinovaných kategórií
je zlomok percenta; ak ich v dodaných dátach nebudete mať, vynechajte ich riadky.
`priemer_eur` je vždy len dôchodok z SP, nie spolu s cudzím či výsluhovým.

**`doba_poberania.csv`** — `pocet_zomretych` je váha priemeru. Bez neho sa roky
nedajú správne spriemerovať, preto je v kontrakte.

**`pilier2.csv`** — aktíva a sporitelia zostávajú v dvoch stĺpcoch a v dvoch
grafoch. Nikdy nie dve osi jedného grafu: eurá a osoby sa porovnávať nedajú.

**`dochodky_pasma.csv`** — `od_eur` je dolná hranica pásma a **radí pásma**;
`pasmo` je len text do osi. `priemer_eur` je priemer v pásme; ak ho SP
neuvádza, stred pásma stačí (kumulatívna krivka sa tým takmer nezmení).
Z počtu a priemeru si web dopočíta výdavky, kumulatívne podiely aj Lorenzovu
krivku sám — transformáciou v manifeste, nie ďalším stĺpcom.

**`prezitie_kohort.csv`** — `prezitie_pct` je podiel *pôvodnej* generácie, ktorý
sa dožil daného veku (kohortná, nie periódová tabuľka). Vo veku 0 je vždy 100.

**`nadej_dozitia_vek.csv`** — `nadej_dozitia_celkom` je **vek, ktorého sa človek
priemerne dožije**, teda dosiahnutý vek + nádej dožitia. Nie zvyšok života; ten
tvar grafu (klesajúce krivky) by hovoril niečo iné.

**`prechody_stavov.csv`** — jeden riadok je jeden prúd: zo stavu v roku `rok_od`
do stavu v roku `rok_do`. Tri pravidlá, bez ktorých diagram klame:

- **Stavový priestor je rovnaký na oboch stranách.** Kto v roku 2024 pracoval,
  väčšinou pracuje aj v 2025 — „pracujúci" preto musí byť aj v cieľovom roku.
- **Matica musí byť vyrovnaná:** čo odíde z uzla, musí niekde doraziť. Preto je
  tu „Nový vstup" (kto dovŕšil 55 alebo dostal dôchodok skôr) a „Zomretí" ako
  absorpčný stav len na cieľovej strane.
- **Prechod, ktorý neexistuje, sa nezapisuje ani ako nula.** Zo starobného
  dôchodku sa nedá prejsť na invalidný — po dôchodkovom veku sa nepriznáva.

Stavy, ktoré súbor používa (a prečo sú také): pracujúci · PN (nemocenské) ·
neaktívny · nový vstup · predčasný sólo · predčasný + vdovský · starobný sólo ·
starobný + vdovský · invalidný sólo · invalidný + vdovský · vdovský sólo ·
zomretí. „Vdovský sólo" je poberateľ vdovského alebo vdoveckého bez vlastného
dôchodku — teda aj ten, kto pritom pracuje.

## Odkiaľ vzali čísla svoje rády

Kotvy sú vypísané v `tools/gen_vstup.py` v sekcii 1, každá s prameňom. Zhrnutie:

- stredná dĺžka života v SR: 1970 = 69,7 · 2019 = 77,8 · 2021 = 74,6 (pandémia)
  · 2022 = 77,0 · 2023 = 78,2 (Eurostat/ŠÚ SR); nádej dožitia vo veku 65 v roku
  2023 = 18,4 roka
- kojenecká úmrtnosť: 1960 = 31 ‰ · 1990 = 14,7 ‰ · 2012–2023 = 5 ‰
- starobné dôchodky k 31. 12. 2024: 1 134 690 dôchodkov, priemer 683,10 €,
  107 131 nad 1 000 €, 469 nad 2 000 €, 50 nad 2 500 €, 84 693 poberateľov
  minimálneho dôchodku (389,90 €)
- roky 2015–2023 nie sú odhad: počet dôchodkov a priemer za každý december
  generátor **prečíta z reálnych radov** v `data/` (`sp_pocty_mesacne.csv`,
  `sp_priemer_mesacne.csv`), takže úroveň každého roku je číslo SP a model dopĺňa
  len tvar rozdelenia. Preto má animácia cez desať rokov čo ukázať.
- II. pilier: 14,1 mld. € a 1 838 665 sporiteľov ku koncu 2023, 1 949 000
  sporiteľov ku koncu 2024, 19,1 mld. € ku koncu 2025, 21,57 mld. € v 06/2026
- rozdelenie dôchodkov je stlačené: OECD uvádza Gini starobných príjmov v SR
  tesne pod 0,200, najnižšie v OECD
- prechody 2024 → 2025: okraje matice sú reálne stavy z mesačnej rady (starobný
  1 134 690 → 1 144 849, predčasný 39 055 → 30 619, invalidný 217 975 → 218 372,
  vdovský a vdovecký 343 352 → 343 512) a rozpad sólo verzus kombinácia je z
  ročnej štatistiky 2024 (vdovský sólo 24 354 z 289 000, vdovecký sólo 5 333 z
  54 352); vnútro matice dofituje IPF na tieto okraje

Model dopočítava len to, čo medzi kotvami chýba, a pri každom datasete si
kontroluje, že kotvy naozaj drží — inak generátor skončí chybou.
