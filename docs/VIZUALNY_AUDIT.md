# Vizuálny audit po zapracovaní manažérskeho prehľadu RRZ

Čo sa kontrolovalo, čo sa našlo a čo sa s tým urobilo. Kontrola bežala nad
**20 stránkami × 3 prostredia** (monitor svetlý, monitor tmavý, telefón
390 × 844) — teda 60 vykreslení — a nad výrezmi jednotlivých kariet pri plnej
veľkosti.

Automatická časť je `npm run validate` + `npm run shots`; tá hľadá chyby, ktoré
sa dajú zmerať. Zvyšok je pozeranie na obrázky, lebo *„vyzerá to zle" sa zmerať
nedá* — a práve tam bola väčšina nálezov.

## Čo našla automatika

| kontrola | výsledok |
|---|---|
| manifest: datasety, stĺpce, typy, odkazy | 0 chýb, 0 upozornení |
| mriežka: každý riadok stránky dá 12 stĺpcov | 0 chýb (kontrola doplnená v tomto kole) |
| kontrolné súčty v dátach | 11 prejde, z toho 4 krížové medzi súbormi |
| paleta: svetlá aj tmavá, CVD, kontrast | prešla |
| vykreslenie: chyby, Plot warningy, pretečenie kariet | 0 nálezov v 60 vykresleniach |

## Čo našlo oko — a čo sa opravilo

**1. Zoskupený stĺpcový graf mal rozsypanú os.** Vnútorná os kreslila názvy
sérií pod každú skupinu, takže tri slovenské názvy ležali cez seba a z osi bola
šmuha. Navyše sa rok formátoval ako veličina — na osi stálo `2,024`.
→ Vnútorná os v zoskupenom grafe ide preč (identitu nesie legenda) a pásmová os
dostala formát, ktorý s rokom zaobchádza ako s menom, nie s číslom.

**2. Stĺpce v skupine stáli ďaleko od seba.** Strop hrúbky 24 px je správny pre
samostatný stĺpec, ktorý má celé pásmo. V skupine sa pásmo delí medzi série,
takže z troch stĺpcov zostali tri ceruzky s medzerou širšou než ony samy.
→ Strop rastie so skupinou a stĺpce v nej stoja pri sebe; vzduch je medzi
skupinami, kam patrí.

**3. Karta „Dĺžka poberania" na celú šírku.** Šesť stĺpcov cez 1 300 px vyzerá
riedko pri akomkoľvek strope. → Rozdelená na dve polovičné karty a tá druhá
pridala obsah, ktorý tam chýbal: medián vedľa priemeru (u žien 29 vs. 26,8 roka).

**4. Dlaždica „Vyplácané dávky" ukazovala 20 056 namiesto 1 778 143.** Filter
nechal šesť riadkov a dlaždica vzala posledný (sirotské dôchodky) namiesto
súčtu. → Doplnená agregácia. *Toto je najtichšia chyba z celého kola: číslo
vyzeralo úplne normálne.*

**5. Hlavička tabuľky vypisovala názvy stĺpcov z CSV** — `adh_eur`,
`zivotne_minimum_eur`. Tabuľka sa pozerala len na `labels` vo view, nie na
`label` pri stĺpci datasetu, takže popisy v manifeste nemali žiadny účinok.
→ Opravené; platí to pre celý web, nielen pre nové stránky.

**6. Stĺpec „2026" v nákladoch vyzeral ako prepad.** Je to prvý polrok a chýba
v ňom 13. dôchodok. Poznámka pod grafom to hovorila, ale graf sa číta skôr než
poznámka. → Na osi je priamo `2026 (I. polrok)`.

**7. Šiesta séria v nákladoch bola neviditeľná a predsa prekážala.** Štátne
dávky sú 0,03 % — v stĺpci ich nevidno, ale zabrali šiesty farebný slot a druhý
riadok legendy. → Z grafu von, v tabuľke zostávajú.

**8. Podnadpis grafu solidarizácie tvrdil opak toho, čo graf kreslí.**
„Započítava sa stále menej" — krivka pritom od roku 2004 rastie. → Prepísané na
to, čo v dátach naozaj je: z nadpriemerného bodu sa započítava stále **viac**
(40 → 68 %) a z podpriemerného dopláca stále menej (60 → 20 %); oboje znižuje
solidaritu.

**9. Os ročníkov mala polovičné značky** — `1964.5`, `1965.5`. Ročník s polovicou
neexistuje. → Pri formáte `year` má os krok 1.

**10. Dve tvrdenia v podnadpisoch nesedeli na to, čo karta ukazuje.** „V tabuľke
je aj rok 2024" — tabuľka pod kartou ukazuje prefiltrované riadky, takže tam
nebol. Podobne „štyri stredné desatiny 52 – 64 €", keď ich je päť a rozpätie je
52 – 68 €. → Opravené.

**11. „Zdroje:" pri karte s viacerými zdrojmi** sedelo vertikálne v strede
zoznamu namiesto pri prvom riadku. → `align-items: flex-start`.

## Čo sa kontrolovalo a bolo v poriadku

- **Farby.** Žiadny nový graf neprekročil overené limity: najviac 5 farebných
  slotov (stohovaný stĺpec), inde 2 – 4. Validátor palety prešiel v oboch
  režimoch.
- **Tmavý režim.** Nové grafy majú vlastné kroky palety, nie prevrátené svetlé.
- **Telefón.** Všetkých 20 stránok, žiadne vodorovné posúvanie stránky, žiadna
  pretečená karta, dlaždice 2 v rade, grafy na celú šírku.
- **Tabuľkový dvojník a export** je pod každou novou kartou.
- **Provenancia.** Každý nový dataset má `source` a `vintage`; žiadny nie je
  `illustrative`, lebo všetky nové čísla sú merané.

## Čo zostalo vedome tak

- **Stránka „Stav k júnu 2026" je dlhá na telefóne** (~4 700 px). Je to
  prehľadová stránka s ôsmimi dlaždicami a štyrmi grafmi; skracovať ju by
  znamenalo niečo vyhodiť.
- **Decil D10 je 3 281 € široký** a v grafe šírok pásiem prevalcuje ostatné.
  Je to vlastnosť rozdelenia, nie grafu — a je to presne to, čo má karta ukázať.
- **Tri definície priemerného dôchodku** zostávajú vedľa seba. Je to mätúce, ale
  zdroj ich vykazuje všetky tri a rozdiel 60 € je vecné zistenie, nie šum.
