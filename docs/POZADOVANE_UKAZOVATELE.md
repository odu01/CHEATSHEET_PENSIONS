# Požadované ukazovatele — stav

Zoznam toho, čo má web zobrazovať, ako to zadávaš. Slúži ako evidencia: čo je
hotové, čo beží na syntetických dátach a ktorý súbor to prepne na reálne.

Legenda: **hotové** = na webe s reálnymi dátami · **syntetické** = graf aj čísla
sú na webe, čísla sú z modelu kalibrovaného na zverejnené kotvy a karta to
priznáva odznakom · **chýba zdroj** = nedá sa spočítať z ničoho, čo máme.

Prečo syntetické a nie prázdne: prázdna karta sa nedá posúdiť. Až keď v grafe
niečo je, je vidieť, či je zvolený tvar ten správny, či os niečo neodreže a či sa
z toho dá niečo prečítať. Preto má každý zadaný ukazovateľ dáta a zároveň
pripravený vstupný súbor, do ktorého sa reálne čísla len prepíšu:
[../data/vstup/README.md](../data/vstup/README.md).

---

## Dávka 1 (zadané 2026-08)

### Starobní dôchodcovia po vekoch a podľa pohlavia — počty

| Ukazovateľ | Stav | Kde |
|---|---|---|
| Počet s dôchodkom iba z SP | syntetické | *Podľa veku a pohlavia*, *Podľa kategórie* |
| Počet s dôchodkom z SP, ktorí sú sporiteľmi | syntetické | to isté |
| Počet s dôchodkom z SP, ktorí majú dôchodok z cudziny | syntetické | to isté |
| Počet s dôchodkom z SP, ktorí majú výsluhový dôchodok | syntetické | to isté |

### Tie isté štyri skupiny — priemerný dôchodok

| Ukazovateľ | Stav | Kde |
|---|---|---|
| Priemerný dôchodok, iba z SP | syntetické | *Podľa veku a pohlavia*, *Podľa kategórie* |
| Priemerný dôchodok, sporitelia | syntetické | to isté |
| Priemerný dôchodok, dôchodok z cudziny | syntetické | to isté |
| Priemerný dôchodok, výsluhový dôchodok | syntetické | to isté |

Všetkých osem prepne na reálne **jeden súbor**: `data/vstup/starobni_podla_veku.csv`.

### Ostatné z dávky 1

| Ukazovateľ | Stav | Súbor |
|---|---|---|
| Priemerná doba poberania dôchodku pre zomretých starobných dôchodcov | syntetické | `data/vstup/doba_poberania.csv` |
| Aktíva dôchodkového systému v II. pilieri | syntetické | `data/vstup/pilier2.csv` |
| Počet sporiteľov v II. pilieri | syntetické | `data/vstup/pilier2.csv` |

Ani jeden z týchto jedenástich ukazovateľov **nie je** v zošitoch, ktoré sú v
`data/zdroj/`. Prehľadal som ich na kľúčové slová (vek, pohlavie, sporiteľ,
cudzina, výsluhové, pilier, doba poberania) — jediná podobná položka je „dôchodky
vyplácané do cudziny", čo je ale niečo iné: dôchodok posielaný do zahraničia, nie
dôchodca, ktorý má aj cudzí dôchodok.

Pri II. pilieri sú koncoročné stavy zverejnené (ADSS, MPSVR, NBS), takže tam nie
je modelovaná úroveň, len mesiace medzi kotvami.

---

## Dávka 2 (zadané 2026-08, grafy bez dát)

Tri tvary grafov zadané obrázkom, bez dát — vymyslené synteticky a s pripraveným
vstupným súborom.

| Graf | Stav | Stránka | Súbor |
|---|---|---|---|
| Prežitie generácií (koľko % ročníka sa dožilo veku) | syntetické | *Demografia* | `data/vstup/prezitie_kohort.csv` |
| Nádej dožitia podľa už dosiahnutého veku | syntetické | *Demografia* | `data/vstup/nadej_dozitia_vek.csv` |
| Kumulatívna distribúcia výdavkov na dôchodky | syntetické | *Rozdelenie dôchodkov* | `data/vstup/dochodky_pasma.csv` |

Kumulatívna distribúcia je to čítanie, ktoré sa vo zdravotníctve robí pre
koncentráciu nákladov („koľko % nákladov ide na koľko % pacientov"), tu urobené
za dôchodky: dôchodcovia zoradení od najnižšieho dôchodku na osi x, kumulatívny
podiel výdavkov na osi y, plus diagonála rovnomerného rozdelenia. Model drží
zverejnené počty (1 134 690 dôchodkov, priemer 683,10 €, 107 131 nad 1 000 €,
469 nad 2 000 €, 50 nad 2 500 €, 84 693 poberateľov minimálneho dôchodku), takže
tie štyri čísla na karte sedia; tvar medzi nimi je model.

Reálny vstup, ktorý to prepne, je **tabuľka pásiem** — presne tak, ako ju
Sociálna poisťovňa zverejňuje. Kumulatívnu krivku, histogram aj podiely si web
dopočíta sám transformáciou v manifeste.

---

## Čo treba dodať

Súbory už existujú a majú správnu hlavičku. Doplniť = prepísať v nich hodnoty a
v manifeste zmazať `illustrative` a `badge`. Presný postup a kontrola:
[../data/vstup/README.md](../data/vstup/README.md), `npm run vstup`.

### 1. `data/vstup/starobni_podla_veku.csv`

```csv
rok,vek,pohlavie,kategoria,pocet,priemer_eur
2024,62,Muži,Iba SP,8431,712.40
2024,62,Muži,SP + II. pilier,1204,689.10
```

| Stĺpec | Typ | Význam |
|---|---|---|
| `rok` | letopočet | rok, ku ktorému je stav |
| `vek` | celé číslo | vek v celých rokoch (5-ročné pásma si web dopočíta sám) |
| `pohlavie` | text | `Muži` / `Ženy` |
| `kategoria` | text | `Iba SP` / `SP + II. pilier` / `SP + cudzina` / `SP + výsluhové` |
| `pocet` | celé číslo | počet starobných dôchodcov |
| `priemer_eur` | číslo | priemerný starobný dôchodok z SP, EUR/mesiac |

**Otázka, ktorú treba rozhodnúť:** sú tie štyri kategórie vzájomne výlučné? Ak
niekto má aj cudzí dôchodok aj II. pilier, patrí do jednej alebo do oboch? Web to
teraz predpokladá ako **výlučné**, aby sa dali sčítať do celku, a syntetické dáta
sú tak vygenerované. Ak sa prekrývajú, povedz — vypnem skladanie a súčty a nechám
len porovnávacie grafy, inak by web ukazoval celok vyšší než realita.

Voliteľné, ak je to k dispozícii: `vek` môže ísť aj po 5-ročných pásmach —
potom pošli namiesto `vek` stĺpec `vekova_skupina` a povedz mi to, upravím
transformáciu.

### 2. `data/vstup/doba_poberania.csv`

```csv
rok,pohlavie,priemer_rokov,pocet_zomretych
2024,Muži,14.2,21503
2024,Ženy,19.8,25871
```

Počet zomretých je dôležitý: bez neho sa priemery za viac rokov nedajú správne
zvážiť a nedá sa povedať, či je zmena priemeru vecná alebo zložením.

### 3. `data/vstup/pilier2.csv`

```csv
mesiac,aktiva_mil_eur,pocet_sporitelov
2024-12,18420.5,1998431
```

Aktíva a sporitelia v jednom súbore, ale vo dvoch stĺpcoch — sú to rôzne
jednotky, takže web ich dá do dvoch samostatných grafov. Na jednu os s dvoma
mierkami sa nedajú (viď `docs/AKO_PRIDAT_DATA.md`, „Ako si vybrať").

### 4. `data/vstup/dochodky_pasma.csv`

```csv
rok,pasmo,od_eur,pocet,priemer_eur
2024,600–700,600,194743,649.07
2024,700–800,700,165016,748.16
```

`od_eur` radí pásma, `pasmo` je len text do osi. `priemer_eur` je priemer v
pásme; ak ho SP neuvádza, stred pásma stačí. Pásma môžu byť aj iné než po 100 € —
web si poradí s akýmkoľvek delením, len musia ísť za sebou a nesmú sa prekrývať.

### 5. a 6. `data/vstup/prezitie_kohort.csv`, `data/vstup/nadej_dozitia_vek.csv`

Toto sú demografické tabuľky, nie dôchodková štatistika — zdrojom je ŠÚ SR
(tabuľky života) alebo Human Mortality Database. `prezitie_kohort.csv` chce
**kohortnú** tabuľku (jeden ročník cez celý život), nie periódovú; ak sú k
dispozícii len periódové, dajú sa kohortné dopočítať a vtedy to treba v `source`
napísať.

---

## Ako to na webe vyzerá dnes

Trinásť stránok, všetky s dátami a bez prázdnej karty. Kde čísla nie sú merané,
má karta odznak **„Syntetické dáta"**, v zdroji vypísané kotvy, na ktorých model
stojí, a v tooltipe odznaku vetu o tom, čo presne je modelované.

Poistka proti tichému úrazu: kým má dataset `illustrative`, generátor
`npm run vstup:gen` smie jeho súbor prepísať. Keď príznak zmažeš (lebo dáta sú
reálne), generátor sa toho súboru už nedotkne.

## Ďalšie dávky

Píš ďalšie ukazovatele; zapracujem ich rovnako — stránka, graf, syntetické dáta
kalibrované na to, čo je zverejnené, a vstupný súbor na prepísanie. Až budeme
mať pohromade, urobíme jeden prechod na usporiadanie navigácie (dnes je v nej 13
položiek a láme sa do dvoch riadkov) a zlúčime, čo patrí spolu.
