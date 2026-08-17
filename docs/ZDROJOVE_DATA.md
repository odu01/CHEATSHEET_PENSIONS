# Zdrojové dáta Sociálnej poisťovne

Všetky čísla na webe pochádzajú z piatich zošitov v `data/zdroj/`. CSV v `data/`
sú z nich vygenerované skriptom `tools/import_sp.py`, ktorý je commitnutý spolu s
nimi — dá sa teda kedykoľvek overiť, čo z čoho vzniklo.

```bash
npm run data          # python3 tools/import_sp.py
```

## Zošity

| Súbor v `data/zdroj/` | Obsah | Rozsah |
|---|---|---|
| `SP_socialne_davky_mesacne.xlsx` | Mesačné výdavky, počty, priemery a novopriznané dôchodky, 5 listov podľa druhu (SD, PSD, INV, VD/VDm, SIR) | 2009-01 – 2026-04 |
| `SP_dochodkove_poistenie_2021.xlsx` | Ročná štatistika: počty vyplácaných dôchodkov, počty dôchodcov, sólo priemery, novopriznané, výdavky | 2021 |
| `SP_dochodkove_poistenie_2022.xlsx` | to isté | 2022 |
| `SP_dochodkove_poistenie_2023.xlsx` | to isté | 2023 |
| `SP_dochodkove_poistenie_2024.xlsx` | to isté | 2024 |

## Vygenerované CSV

| Súbor | Zdroj | Poznámka |
|---|---|---|
| `sp_vydavky_mesacne.csv` | mesačný zošit | výdavky podľa druhu, tis. € |
| `sp_vydavky_rok_mesiac.csv` | mesačný zošit | súčet všetkých druhov, mriežka rok × mesiac |
| `sp_pocty_mesacne.csv` | mesačný zošit | počet vyplácaných dôchodkov, prepočítaný na jednotky |
| `sp_priemer_mesacne.csv` | mesačný zošit | priemer sólo **a kráteného** dôchodku |
| `sp_priemer_novo_vs_stav.csv` | mesačný zošit | novopriznaný vs vyplácaný, obe v €/mesiac |
| `sp_novopriznane_mesacne.csv` | mesačný zošit | novopriznané, kategória 01-09P |
| `sp_vydavky_rocne.csv` | ročné zošity | z kumulatívneho stĺpca január–december |
| `sp_vydavky_zmena.csv` | ročné zošity | rozklad zmeny 2021 → 2024 |
| `sp_priemer_solo_mesacne.csv` | ročné zošity | priemer **len sólo** dôchodkov |
| `sp_dochodcovia_mesacne.csv` | ročné zošity | osoby, nie dôchodky |
| `sp_dochodky_vs_dochodcovia.csv` | ročné zošity | obe rady v jednom súbore |

---

## Sedem pascí v týchto dátach

Toto nie sú teoretické riziká — na každú z nich sa dalo naraziť pri prevode a
každá je v skripte ošetrená a okomentovaná.

### 1. Počty sú v tisícoch

V mesačnom zošite je „Počet vyplatených SD" za december 2024 hodnota **1134,69**.
Nie je to 1 135 dôchodkov, ale **1 134 690**. Overené proti ročnému zošitu, ktorý
ten istý údaj uvádza v jednotkách — čísla sa zhodujú presne. Import prepočítava
na jednotky, takže v CSV a na webe sú skutočné počty.

### 2. Výdavky v ročných zošitoch sú kumulatívne

Stĺpce sa menujú „január", „január a február", …, „január až december". Ročná
hodnota je teda **posledný stĺpec**, nie súčet stĺpcov. Kto by ich zrátal, dostal
by pre rok 2024 číslo asi šesťkrát vyššie, než aké je.

### 3. Dve rôzne definície priemerného dôchodku

| Zdroj | Definícia | Starobný, 12/2024 |
|---|---|---|
| mesačný zošit | aritmetický priemer sólo **a kráteného** dôchodku | **642,35 €** |
| ročný zošit | priemerná výška **sólo** dôchodkov | **683,10 €** |

Rozdiel je 40,75 €, teda 6 %. Sú to iné veličiny a **nesmú byť v jednom grafe**.
Preto majú vlastné CSV, vlastné poznámky v manifeste a na stránke *Priemerné
dôchodky* je ten rozdiel priamo pomenovaný.

### 4. Počet dôchodkov ≠ počet dôchodcov

December 2024: vyplácaných dôchodkov **1 779 367**, dôchodcov **1 465 702**.
Rozdiel 313 665 je počet ľudí poberajúcich viac než jeden dôchodok, typicky
starobný plus vdovský. Stránka *Počty* to má ako vlastný graf, pretože je to
najčastejšie zamieňaná dvojica v tejto štatistike.

### 5. Definičné zlomy v rade výdavkov

| Rok | Starobný dôchodok | Rodičovský | 13. dôchodok |
|---|---|---|---|
| 2021 | bez rodičovského | neexistoval | nebol |
| 2022 | bez rodičovského | neexistoval | nebol |
| 2023 | bez rodičovského | samostatný riadok | nebol |
| 2024 | **vrátane rodičovského** | „z toho" pod starobným | samostatný riadok |

V roku 2024 je teda „starobný dôchodok (vr. rodičovského)" 9 224 125 tis. €, čo
nie je porovnateľné s 6 358 286 tis. € za rok 2021. Import preto rodičovský
dôchodok zo starobného **vyčleňuje** a vykazuje ho ako vlastnú kategóriu:

```
2024  starobný bez rodičovského   8 908 136
2024  rodičovský                    315 989
                                 -----------
      spolu                       9 224 125   = hodnota v zošite
```

Skript to kontroluje súčtom proti riadku „Celkom" a pri nezhode nad 1 tis. €
skončí chybou. Pre roky 2021–2024 kontrola prechádza presne.

### 6. „Spolu výdavky na SD" neobsahuje rodičovský dôchodok

Toto sa pri prvom prevode nezachytilo. Mesačný list SD má na rodičovský dôchodok
**samostatný stĺpec** a súhrnný stĺpec ho nezahŕňa, takže v roku 2023 chýbalo
presne 286 068 tis. € proti ročnému zošitu. Preto import teraz na konci porovnáva
mesačné súčty s ročnou štatistikou po kategóriách:

```
kontrola mesačný (hotovostná metodika) vs ročný zošit:
  2021: spolu    8 015 307 vs    8 015 307 (+0.00 %)  OK
  2022: spolu    8 269 597 vs    8 269 597 (+0.00 %)  OK
  2023: spolu   10 318 692 vs   10 318 692 (+0.00 %)  OK
  2024: spolu   12 603 800 vs   12 629 572 (-0.20 %)  POZOR: Predčasný starobný -26 854
```

### 7. Mesačná a ročná rada nemusia sedieť na euro

Zostávajúci rozdiel v roku 2024 (predčasný starobný, −26 854 tis. €, teda −0,20 %
celkových výdavkov) **nie je chyba prevodu**. Mesačný zošit je hotovostná
metodika, ročný je publikovaná ročná štatistika, a jedna reklasifikácia medzi
nimi zostáva. Skript ho preto len vypíše a nepatchuje.

Praktické pravidlo: **ročné hodnoty ber z ročných zošitov**, nie sčítaním
mesiacov. `sp_vydavky_rocne.csv` je preto z ročnej štatistiky, nie z mesačnej rady.

---

## Čo dáta ešte neobsahujú

Aby bolo jasné, čo na webe nenájdeš, kým nedodáš ďalšie zdroje:

- **Príjmy systému** — odvody, transfery zo štátneho rozpočtu, saldo. Priložené
  zošity pokrývajú len výdavkovú stranu, takže web nemôže zobraziť deficit ani
  udržateľnosť.
- **Výdavky v % HDP** — chýba menovateľ. Doplnením radu nominálneho HDP sa dá
  dopočítať transformáciou `derive`.
- **Sirotské počty v mesačnej rade** — list SIR má len výdavky, nie počty. Počty
  sirotských dôchodkov sú preto len v ročných zošitoch (2021–2024).
- **II. pilier** — v priložených zošitoch nie je.
- **Náhradový pomer** — chýba priemerná mzda.
- **Roky pred 2021 v ročnej štatistike** — sólo priemery a počty dôchodcov máme
  len 2021–2024. Mesačná rada ide do roku 2009, ale s inou definíciou priemeru.
- **Rok 2026 je neúplný** (január–apríl). V mriežke rok × mesiac chýbajúce
  mesiace zostávajú prázdne; nedopočítavajú sa a nevstupujú do ročných súčtov.

## Výmena dát za novšie

1. Nahraď zošit v `data/zdroj/` novším pod tým istým názvom.
2. `npm run data` — prevod aj kontrolné súčty.
3. Skontroluj výpis kontroly: `OK` pri každom roku, alebo pochopiteľný rozdiel.
4. `npm run validate` a `npm run shots`.
5. Commitni zošit aj pregenerované CSV. CI kontroluje, že sa zhodujú.

Ak nový zošit zmení názvy listov alebo stĺpcov, skript spadne s konkrétnou
správou — mapovania sú na začiatku `tools/import_sp.py` v `MONTHLY_MAP`,
`VYD_LABELS`, `SOLO_LABELS` a `DOCHODCOVIA_LABELS`.
