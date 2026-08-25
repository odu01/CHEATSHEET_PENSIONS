# Požadované ukazovatele — stav

Zoznam toho, čo má web zobrazovať, ako to zadávaš. Slúži ako evidencia: čo je
hotové, čo čaká na dáta a ktorý súbor to odomkne.

Legenda: **hotové** = na webe s reálnymi dátami · **čaká** = stránka aj graf sú
pripravené, chýba súbor · **chýba zdroj** = nedá sa spočítať z ničoho, čo máme.

---

## Dávka 1 (zadané 2026-08)

### Starobní dôchodcovia po vekoch a podľa pohlavia — počty

| Ukazovateľ | Stav | Kde |
|---|---|---|
| Počet s dôchodkom iba z SP | čaká | *Podľa veku a pohlavia*, *Podľa kategórie* |
| Počet s dôchodkom z SP, ktorí sú sporiteľmi | čaká | to isté |
| Počet s dôchodkom z SP, ktorí majú dôchodok z cudziny | čaká | to isté |
| Počet s dôchodkom z SP, ktorí majú výsluhový dôchodok | čaká | to isté |

### Tie isté štyri skupiny — priemerný dôchodok

| Ukazovateľ | Stav | Kde |
|---|---|---|
| Priemerný dôchodok, iba z SP | čaká | *Podľa veku a pohlavia*, *Podľa kategórie* |
| Priemerný dôchodok, sporitelia | čaká | to isté |
| Priemerný dôchodok, dôchodok z cudziny | čaká | to isté |
| Priemerný dôchodok, výsluhový dôchodok | čaká | to isté |

Všetkých osem odomkne **jeden súbor**: `data/sp_starobni_podla_veku.csv`.

### Ostatné z dávky 1

| Ukazovateľ | Stav | Súbor |
|---|---|---|
| Priemerná doba poberania dôchodku pre zomretých starobných dôchodcov | čaká | `data/sp_doba_poberania.csv` |
| Aktíva dôchodkového systému v II. pilieri | čaká | `data/sp_pilier2.csv` |
| Počet sporiteľov v II. pilieri | čaká | `data/sp_pilier2.csv` |

Ani jeden z týchto jedenástich ukazovateľov **nie je** v zošitoch, ktoré sú v
`data/zdroj/`. Prehľadal som ich na kľúčové slová (vek, pohlavie, sporiteľ,
cudzina, výsluhové, pilier, doba poberania) — jediná podobná položka je „dôchodky
vyplácané do cudziny", čo je ale niečo iné: dôchodok posielaný do zahraničia, nie
dôchodca, ktorý má aj cudzí dôchodok.

---

## Čo treba dodať

Šablóny s hotovými hlavičkami sú v `data/sablony/`. Skopíruj do `data/` pod
uvedeným názvom, naplň a je to na webe — bez zmeny kódu.

### 1. `data/sp_starobni_podla_veku.csv`

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
teraz predpokladá ako **výlučné**, aby sa dali sčítať do celku. Ak sa prekrývajú,
povedz — vypnem skladanie a súčty a nechám len porovnávacie grafy, inak by web
ukazoval celok vyšší než realita.

Voliteľné, ak je to k dispozícii: `vek` môže ísť aj po 5-ročných pásmach —
potom pošli namiesto `vek` stĺpec `vekova_skupina` a povedz mi to, upravím
transformáciu.

### 2. `data/sp_doba_poberania.csv`

```csv
rok,pohlavie,priemer_rokov,pocet_zomretych
2024,Muži,14.2,21503
2024,Ženy,19.8,25871
```

Počet zomretých je dôležitý: bez neho sa priemery za viac rokov nedajú správne
zvážiť a nedá sa povedať, či je zmena priemeru vecná alebo zložením.

### 3. `data/sp_pilier2.csv`

```csv
mesiac,aktiva_mil_eur,pocet_sporitelov
2024-12,18420.5,1998431
```

Aktíva a sporitelia v jednom súbore, ale vo dvoch stĺpcoch — sú to rôzne
jednotky, takže web ich dá do dvoch samostatných grafov. Na jednu os s dvoma
mierkami sa nedajú (viď `docs/AKO_PRIDAT_DATA.md`, „Ako si vybrať").

---

## Ako to na webe vyzerá dnes

Stránky *Podľa veku a pohlavia*, *Podľa kategórie*, *Doba poberania* a *II. pilier*
už existujú a v navigácii sú. Každá karta zobrazuje odznak **„Čaká na dáta"**,
plánovaný typ grafu a presný tvar súboru. Nie sú tam žiadne vymyslené čísla —
radšej prázdna karta s kontraktom než graf, ktorý by sa dal citovať.

Validácia takýto dataset vyžaduje úplne opísaný: bez `columns` s popisom každého
stĺpca a bez `note` neprejde. A keď súbor pridáš, `planned` príznak sa musí zrušiť
— inak validácia zlyhá s tým, že súbor už existuje.

## Ďalšie dávky

Píš ďalšie ukazovatele; zapracujem ich rovnako — najprv stránka a kontrakt, potom
dáta. Až budeme mať pohromade, urobíme jeden prechod na usporiadanie navigácie
(dnes je v nej 12 položiek a láme sa do dvoch riadkov) a zlúčime, čo patrí spolu.
