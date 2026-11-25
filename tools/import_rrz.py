#!/usr/bin/env python3
"""import_rrz.py — manažérsky report RRZ (hárky `statistiky`, `parametre`) na tidy CSV.

Zdroj je data/zdroj/RRZ_statistiky_parametre.xlsx (vyrobený skriptom
extract_rrz_sheets.py z plného reportu). Spusti po každej výmene zdroja:

    python3 tools/import_rrz.py

Čo tento skript rieši:

1. HÁROK JE ZOSTAVA, NIE TABUĽKA. `statistiky` je manažérsky prehľad: dlaždice,
   nadpisy sekcií a medzi nimi roztrúsené tabuľky, ktorých čísla sú k dispozícii
   priamo v hárku. Každá tabuľka sa preto hľadá podľa svojho NADPISU, nie podľa
   čísla riadku — po doplnení riadku v reporte sa import nerozsype, len sa posunie.
   Hneď za tým sa kontroluje, že hlavička sedí; ak nie, import spadne s menom
   tabuľky. Ticho načítané zlé stĺpce sú horšie než spadnutý import.

2. TRI DEFINÍCIE TOHO ISTÉHO DÔCHODKU. Hárok dáva každý počet aj priemer v troch
   pohľadoch: „všetci poberatelia", „nekrátené bez INÉHO dôchodku" a „sólo".
   Líšia sa o desiatky eur (SD 2026: 688,88 / 721,50 / 748,41 €), takže sú to tri
   rady jednej veličiny, nie tri veličiny — idú do jedného súboru ako rozmer
   `pohlad`, aby sa nedali omylom zmiešať do jedného radu.

3. PODIELY SA DOPOČÍTAVAJÚ, NEPREBERAJÚ. Hárok nesie podiel na dávkach len pre
   pohľad „všetci" (stĺpec H). Dopočítavame ho pre všetky tri pohľady z počtov v
   tom istom riadku, takže podiel vždy sedí k počtu vedľa neho. Pre „všetkých"
   kontrolujeme zhodu s hárkom.

4. ODVODY A VALORIZÁCIA SÚ V HÁRKU ZLOMKY. 0,04 je 4 %. Na webe sa percentá
   formátujú z čísla v percentách, takže prevádzame tu — raz, nie v každom view.

5. DÔCHODKOVÝ VEK JE TEXT. „63 r. a 8 mes." sa prevádza na mesiace (764) aj na
   roky (63,67). Ročník 1969 a mladší nemá číslo, ale pravidlo („−6 mesiacov" za
   dieťa), takže do číselného radu nepatrí a zostáva v poznámke manifestu.

6. ROK 2026 JE POLROK. Počty a priemery sú stav k júnu 2026, ale náklady a počty
   novopriznaných sú súčet za január – jún. Nie je to to isté a v grafe sa to
   nesmie čítať ako celý rok — preto to nesie `note` pri datasete aj podnadpis
   kariet.
"""

from __future__ import annotations

import csv
import re
import sys
from pathlib import Path

try:
    import openpyxl
except ImportError:
    sys.exit("Chýba openpyxl. Nainštaluj: pip install openpyxl")

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "zdroj" / "RRZ_statistiky_parametre.xlsx"
# Vývoj podľa druhu dôchodku (12/2024, 12/2025, 06/2026 a mesačne) a rozklad zmeny
# nákladov na starobné dôchodky — z iných hárkov reportu, preto vlastný výťah:
# python3 tools/extract_rrz_detail.py <report.xlsx>
SRC_DETAIL = ROOT / "data" / "zdroj" / "RRZ_detail_druhy.xlsx"
OUT = ROOT / "data"

# Pohľady na ten istý dôchodok — poradie určuje poradie v grafe.
POHLADY = ["Všetci poberatelia", "Nekrátené bez iného dôchodku", "Sólo poberatelia"]
# Druhy dôchodku v poradí, v akom ich vykazuje report.
DRUHY = ["Starobný dôchodok", "Predčasný dôchodok", "Invalidný dôchodok do 70 %",
         "Invalidný dôchodok nad 70 %", "Vdovský/vdovecký dôchodok", "Sirotský dôchodok"]

written: list[tuple[str, int]] = []


# ── pomôcky ──────────────────────────────────────────────────────────────────

def clean(v) -> str:
    """Text bunky na jednom riadku, bez dvojitých medzier.

    Poznámkové indexy („Starobný dôchodoka", „Všetci poberateliac") sa tu
    zámerne NEodstraňujú: pravidlo „zahoď koncové malé písmeno" zožralo aj
    nadpis „…podľa pohlavia". Názvy druhov a pohľadov si preto skript drží sám
    (DRUHY, POHLADY) a bunky overuje len na začiatok textu.
    """
    if v is None:
        return ""
    return re.sub(r"\s+", " ", str(v).replace("\n", " ")).strip()


def num(v):
    """Číslo bunky; „–" a prázdno sú chýbajúca hodnota, nie nula."""
    if v is None or (isinstance(v, str) and v.strip() in {"", "–", "-", "—"}):
        return None
    return float(v)


def r(v, nd=2):
    if v is None:
        return ""
    x = round(float(v), nd)
    return int(x) if nd == 0 else x


def find(ws, text: str, col: int = 1, start: int = 1) -> int:
    """Riadok, v ktorom daný stĺpec začína daným textom. Nenájdené = chyba."""
    for row in range(start, ws.max_row + 1):
        if clean(ws.cell(row, col).value).startswith(text):
            return row
    sys.exit(f"V hárku '{ws.title}' sa nenašiel riadok začínajúci '{text}'.")


def expect(ws, row: int, col: int, text: str, table: str) -> None:
    got = clean(ws.cell(row, col).value)
    if not got.startswith(text):
        sys.exit(f"Tabuľka '{table}': v {ws.cell(row, col).coordinate} sa čakalo "
                 f"'{text}', je tam '{got}'. Zmenilo sa rozloženie hárku — oprav import.")


def write_csv(name: str, header: list[str], rows: list[list]) -> None:
    path = OUT / name
    with path.open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(header)
        w.writerows(rows)
    written.append((name, len(rows)))


def months(text: str):
    """„63 r. a 8 mes." → 764 mesiacov. Iný tvar = None (je to pravidlo, nie číslo)."""
    m = re.match(r"(\d+)\s*r\.?\s*a\s*(\d+)\s*mes", clean(text))
    return int(m.group(1)) * 12 + int(m.group(2)) if m else None


# ── hárok `statistiky` ───────────────────────────────────────────────────────

def davky_podla_druhu(ws) -> None:
    """6 druhov × 3 pohľady → počet, priemer, podiel na dávkach."""
    top = find(ws, "Dôchodkové dávky, počty poberateľov")
    head, first = top + 2, top + 4
    expect(ws, head, 1, "Druh dôchodku", "dávky podľa druhu")
    expect(ws, head + 1, 2, "Počet", "dávky podľa druhu")

    raw = []
    for i in range(len(DRUHY)):
        row = first + i
        expect(ws, row, 1, DRUHY[i][:12], "dávky podľa druhu")
        raw.append([num(ws.cell(row, c).value) for c in (2, 3, 4, 5, 6, 7, 8)])

    totals = [sum(x[i] for x in raw) for i in (0, 2, 4)]
    out = []
    for druh, x in zip(DRUHY, raw):
        for j, pohlad in enumerate(POHLADY):
            pocet, priemer = x[2 * j], x[2 * j + 1]
            out.append([druh, pohlad, int(pocet), r(priemer), r(100 * pocet / totals[j], 4)])
        # Podiel za „všetkých" hárok uvádza sám — musí sedieť na dopočítaný.
        if abs(100 * x[0] / totals[0] - 100 * x[6]) > 0.001:
            sys.exit(f"Podiel za '{druh}' nesedí na hárok — skontroluj stĺpec H.")
    write_csv("rrz_davky_druh.csv",
              ["druh", "pohlad", "pocet", "priemer_eur", "podiel_pct"], out)


def sd_vyvoj(ws) -> None:
    top = find(ws, "Priemerný starobný dôchodok – vývoj")
    expect(ws, top + 2, 1, "Rok", "vývoj SD")
    out = []
    for i in range(3):
        row = top + 4 + i
        rok = int(ws.cell(row, 1).value)
        for j, pohlad in enumerate(POHLADY):
            out.append([rok, pohlad, int(num(ws.cell(row, 2 + 2 * j).value)),
                        r(num(ws.cell(row, 3 + 2 * j).value))])
    write_csv("rrz_sd_vyvoj.csv", ["rok", "pohlad", "pocet", "priemer_eur"], out)


def sd_pohlavie(ws) -> None:
    top = find(ws, "Starobný dôchodok podľa pohlavia")
    expect(ws, top + 2, 2, "Muži", "SD podľa pohlavia")
    expect(ws, top + 2, 4, "Ženy", "SD podľa pohlavia")
    out = []
    for i in range(3):
        row = top + 4 + i
        rok = int(ws.cell(row, 1).value)
        for pohlavie, c in (("Muži", 2), ("Ženy", 4)):
            out.append([rok, pohlavie, int(num(ws.cell(row, c).value)),
                        r(num(ws.cell(row, c + 1).value))])
    write_csv("rrz_sd_pohlavie.csv", ["rok", "pohlavie", "pocet", "priemer_eur"], out)


def vstup_vystup(ws) -> None:
    top = find(ws, "Novopriznaní a odchádzajúci poberatelia")
    expect(ws, top + 2, 2, "Novopriznaní", "novopriznaní a odchádzajúci")
    out = []
    for i in range(3):
        row = top + 4 + i
        rok = int(ws.cell(row, 1).value)
        for smer, c in (("Novopriznaní", 2), ("Odchádzajúci", 4)):
            out.append([rok, smer, int(num(ws.cell(row, c).value)),
                        r(num(ws.cell(row, c + 1).value))])
    write_csv("rrz_vstup_vystup.csv", ["rok", "smer", "pocet", "priemer_eur"], out)


def kratenie(ws) -> None:
    top = find(ws, "Krátenie dôchodkov za účasť v II. pilieri")
    expect(ws, top + 2, 4, "Priemerné krátenie", "krátenie za II. pilier")
    out = []
    for druh, head in (("Starobný dôchodok", top + 3), ("Predčasný dôchodok", top + 7)):
        expect(ws, head, 1, druh, "krátenie za II. pilier")
        for i in range(3):
            row = head + 1 + i
            out.append([int(ws.cell(row, 1).value), druh,
                        int(num(ws.cell(row, 2).value)),
                        r(num(ws.cell(row, 4).value)),
                        r(num(ws.cell(row, 5).value)),
                        r(num(ws.cell(row, 6).value) / 1e6, 2)])
    write_csv("rrz_kratenie.csv",
              ["rok", "druh", "pocet", "kratenie_pct", "kratenie_eur", "uspora_mil_eur"], out)


def doba_poberania(ws) -> None:
    """Priemer a medián dĺžky poberania SD u odchádzajúcich; tabuľka je v stĺpci D."""
    # Hľadá sa až POD nadpisom tabuľky: „Ženy" je aj hlavička tabuľky podľa
    # pohlavia o sedemdesiat riadkov vyššie a prvý nález by trafil ju.
    top = find(ws, "Priemerná a mediánová dĺžka poberania", col=4)
    out = []
    for pohlavie in ("Muži", "Ženy"):
        head = find(ws, pohlavie, col=4, start=top)
        expect(ws, head, 5, "Priemer", "dĺžka poberania")
        expect(ws, head, 7, "Medián", "dĺžka poberania")
        for i in range(3):
            row = head + 1 + i
            out.append([int(ws.cell(row, 4).value), pohlavie,
                        r(num(ws.cell(row, 5).value)), r(num(ws.cell(row, 7).value), 0)])
    out.sort(key=lambda x: (x[0], x[1]))
    write_csv("rrz_doba_poberania.csv",
              ["rok", "pohlavie", "priemer_rokov", "median_rokov"], out)


def naklady(ws) -> None:
    top = find(ws, "Náklady podľa druhu dôchodku")
    head = find(ws, "Druh dôchodku", start=top)
    expect(ws, head, 2, "2024", "náklady podľa druhu")
    podiel_head = find(ws, "Druh dôchodku", start=head + 1)

    druhy, sumy = [], {}
    row = head + 1
    while clean(ws.cell(row, 1).value) not in {"Spolu", ""}:
        d = clean(ws.cell(row, 1).value)
        druhy.append(d)
        sumy[d] = [num(ws.cell(row, c).value) for c in (2, 3, 4)]
        row += 1
    expect(ws, row, 1, "Spolu", "náklady podľa druhu")
    spolu = [num(ws.cell(row, c).value) for c in (2, 3, 4)]

    podiely = {}
    for i, d in enumerate(druhy):
        prow = podiel_head + 1 + i
        expect(ws, prow, 1, d[:10], "podiel na nákladoch")
        podiely[d] = [num(ws.cell(prow, c).value) for c in (2, 3, 4)]

    out = []
    for j, rok in enumerate((2024, 2025, 2026)):
        if abs(sum(sumy[d][j] for d in druhy) - spolu[j]) > 1:
            sys.exit(f"Náklady {rok}: súčet druhov nesedí na riadok 'Spolu'.")
        for d in druhy:
            out.append([rok, d, r(sumy[d][j] / 1e6, 2), r(podiely[d][j], 4)])
    write_csv("rrz_naklady_druh.csv", ["rok", "druh", "naklady_mil_eur", "podiel_pct"], out)


def decily(ws) -> None:
    """Hranice decilov dôchodkového príjmu — popisy osi X pri grafoch pracujúcich."""
    first = find(ws, "D1", col=8)
    out = []
    for i in range(10):
        label = clean(ws.cell(first + i, 8).value)
        m = re.match(r"D(\d+)\s*(\d+)\s*–\s*(\d+)", label)
        if not m:
            sys.exit(f"Popis decilu sa nedá prečítať: {label!r}")
        d, lo, hi = int(m.group(1)), int(m.group(2)), int(m.group(3))
        out.append([f"D{d}", d, lo, hi, hi - lo])
    write_csv("rrz_decily.csv", ["decil", "poradie", "od_eur", "do_eur", "sirka_eur"], out)


# ── hárok `parametre` ────────────────────────────────────────────────────────

def veliciny(ws) -> None:
    top = find(ws, "Výpočtové veličiny a valorizačné parametre")
    head = top + 2
    expect(ws, head, 1, "Ukazovateľ", "výpočtové veličiny")
    roky = [int(ws.cell(head, c).value) for c in (2, 3, 4)]
    keys = {"Aktuálna dôchodková hodnota": ("adh_eur", 1),
            "Štandardná valorizácia": ("valorizacia_pct", 100),
            "Životné minimum": ("zivotne_minimum_eur", 1),
            "Referenčná suma": ("referencna_suma_eur", 1)}
    data = {rok: {} for rok in roky}
    for i in range(4):
        row = head + 1 + i
        label = clean(ws.cell(row, 1).value)
        key, scale = next((v for k, v in keys.items() if label.startswith(k)), (None, None))
        if key is None:
            sys.exit(f"Neznámy parameter v riadku {row}: {label!r}")
        for j, rok in enumerate(roky):
            v = num(ws.cell(row, 2 + j).value)
            data[rok][key] = r(v * scale, 4) if v is not None else ""
    cols = [k for k, _ in keys.values()]
    write_csv("par_veliciny.csv", ["rok"] + cols,
              [[rok] + [data[rok].get(c, "") for c in cols] for rok in roky])


def dochodkovy_vek(ws) -> None:
    top = find(ws, "Dôchodkový vek podľa ročníka narodenia")
    head = top + 2
    expect(ws, head, 2, "Bez detí", "dôchodkový vek")
    deti = ["0 detí", "1 dieťa", "2 deti", "3 a viac detí"]
    out, row = [], head + 1
    while True:
        rocnik = clean(ws.cell(row, 1).value)
        if not re.fullmatch(r"\d{4}", rocnik):
            break
        for j, d in enumerate(deti):
            mes = months(ws.cell(row, 2 + j).value)
            if mes is None:
                sys.exit(f"Dôchodkový vek {rocnik}/{d} sa nedá prečítať.")
            out.append([int(rocnik), d, mes, r(mes / 12, 2)])
        row += 1
    write_csv("par_dochodkovy_vek.csv",
              ["rocnik", "deti", "vek_mesiacov", "vek_rokov"], out)


def minimalny_dochodok(ws) -> None:
    top = find(ws, "Minimálny dôchodok podľa počtu rokov")
    head = top + 2
    expect(ws, head, 2, "Násobok", "minimálny dôchodok")
    roky = [int(re.search(r"\d{4}", clean(ws.cell(head, c).value)).group()) for c in (3, 4)]
    out, row = [], head + 1
    while True:
        label = clean(ws.cell(row, 1).value)
        m = re.match(r"(\d+)\s*rok", label)
        if not m:
            break
        nasobok = num(ws.cell(row, 2).value)
        for j, rok in enumerate(roky):
            out.append([int(m.group(1)), rok, r(nasobok, 3), r(num(ws.cell(row, 3 + j).value))])
        row += 1
    write_csv("par_minimalny_dochodok.csv",
              ["roky_poistenia", "rok", "nasobok_zm", "suma_eur"], out)


def trinasty(ws) -> None:
    top = find(ws, "Výška 13. dôchodku podľa druhu dávky")
    head = top + 2
    expect(ws, head, 1, "Druh poberaného dôchodku", "13. dôchodok")
    out, row = [], head + 1
    while clean(ws.cell(row, 1).value):
        druh = clean(ws.cell(row, 1).value)
        out.append([druh, "2024", r(num(ws.cell(row, 2).value))])
        out.append([druh, "2025–2028", r(num(ws.cell(row, 4).value))])
        row += 1
    write_csv("par_trinasty_dochodok.csv", ["druh", "obdobie", "suma_eur"], out)


def vypocet(ws) -> None:
    top = find(ws, "Modelová matica výpočtu novopriznaného")
    head = top + 2
    expect(ws, head, 2, "POMB", "modelový výpočet")
    out, row = [], head + 1
    while clean(ws.cell(row, 1).value):
        pomb, odp = num(ws.cell(row, 2).value), int(num(ws.cell(row, 3).value))
        # Os kategórií potrebuje krátky a jednoznačný popis prípadu: názov
        # profilu sa opakuje pre dve dĺžky kariéry, takže sám o sebe nestačí.
        pripad = f"POMB {pomb:.1f} · {odp} rokov".replace(".", ",")
        out.append([clean(ws.cell(row, 1).value), pripad, r(pomb, 2), odp,
                    r(num(ws.cell(row, 4).value)), r(num(ws.cell(row, 5).value)),
                    clean(ws.cell(row, 6).value)])
        row += 1
    write_csv("par_vypocet.csv",
              ["profil", "pripad", "pomb", "odp_rokov", "zakladna_eur",
               "po_valorizacii_eur", "komentar"], out)


def pomb_uprava(ws) -> None:
    top = find(ws, "Úprava priemerného osobného mzdového bodu")
    head = top + 2
    expect(ws, head, 1, "Rok priznania", "úprava POMB")
    out, row = [], head + 1
    while clean(ws.cell(row, 1).value):
        label = clean(ws.cell(row, 1).value)
        # Posledný riadok je „2016+" — pre os treba číslo, pre tabuľku to „+".
        rok = int(re.match(r"(\d{4})", label).group(1))
        out.append([label, rok,
                    r(100 * num(ws.cell(row, 2).value), 1),
                    r(100 * num(ws.cell(row, 4).value), 1),
                    r(num(ws.cell(row, 6).value), 2)])
        row += 1
    write_csv("par_pomb_uprava.csv",
              ["rok_priznania", "rok", "nad_125_pct", "pod_1_pct", "max_pomb"], out)


def odvody(ws) -> None:
    top = find(ws, "Sadzby odvodov na starobné poistenie")
    head = top + 2
    expect(ws, head, 2, "I. pilier – zamestnanec", "sadzby odvodov")
    out, row = [], head + 1
    while clean(ws.cell(row, 1).value):
        vals = [num(ws.cell(row, c).value) for c in (2, 3, 4, 5, 6)]
        if abs(vals[0] + vals[1] - vals[2]) > 1e-9 or abs(vals[2] + vals[3] - vals[4]) > 1e-9:
            sys.exit(f"Sadzby za obdobie {clean(ws.cell(row, 1).value)} nesedia v súčte.")
        out.append([clean(ws.cell(row, 1).value)] + [r(100 * v, 3) for v in vals])
        row += 1
    write_csv("par_odvody.csv",
              ["obdobie", "zamestnanec_pct", "zamestnavatel_pct", "i_pilier_pct",
               "ii_pilier_pct", "spolu_pct"], out)


def narok(ws) -> None:
    top = find(ws, "Podmienky nároku na dôchodok")
    head = top + 2
    expect(ws, head, 2, "Podmienka nároku", "podmienky nároku")
    out, row = [], head + 1
    while clean(ws.cell(row, 1).value):
        out.append([clean(ws.cell(row, 1).value), clean(ws.cell(row, 2).value)])
        row += 1
    write_csv("par_narok.csv", ["druh", "podmienka"], out)


def psd_pravidla(ws) -> None:
    top = find(ws, "Predčasný starobný dôchodok – prahové hodnoty")
    head = top + 2
    expect(ws, head, 1, "Parameter", "pravidlá PSD")
    # Nadpisy stĺpcov sú dátumy („Do 14. 5. 2024"); do hlavičky CSV idú ako
    # stabilné názvy stĺpcov a ľudské znenie nesie manifest.
    out, row = [], head + 1
    while clean(ws.cell(row, 1).value):
        a, b = clean(ws.cell(row, 2).value), clean(ws.cell(row, 5).value)
        out.append([clean(ws.cell(row, 1).value), a, b, "áno" if a != b else "nie"])
        row += 1
    write_csv("par_psd_pravidla.csv",
              ["parameter", "do_15_5_2024", "od_15_5_2024", "zmena"], out)


# ── KPI dlaždice ─────────────────────────────────────────────────────────────

# Dlaždice hlavičky: mierka a jednotka sa NEHÁDAJÚ z popisu. Hárok drží podiely
# ako zlomky (0,2903), krátenie už ako percento (9,29) a náklady v eurách —
# jediný spoľahlivý spôsob, ako to rozlíšiť, je povedať to pri každom čísle.
#   nadpis v hárku -> (krátky názov, jednotka, násobok, desatinné miesta)
KPI = {
    "VYPLÁCANÉ DÁVKY":              ("Vyplácané dávky", "dôchodkov", 1, 0),
    "POBERATELIA STAROBNÉHO DÔCH.": ("Poberatelia starobného dôchodku", "osôb", 1, 0),
    "PRIEMERNÝ STAROBNÝ DÔCHODOK":  ("Priemerný starobný dôchodok", "EUR", 1, 2),
    "NÁKLADY NA DÔCHODKY":          ("Náklady na dôchodky", "mld. EUR", 1e-9, 2),
    "NOVOPRIZNANÝ STAROBNÝ DÔCH.":  ("Novopriznaný starobný dôchodok", "EUR", 1, 2),
    "MUŽI VS. ŽENY":                ("Muži vs. ženy", "%", 100, 2),
    "PRACUJÚCI DÔCHODCOVIA":        ("Pracujúci dôchodcovia", "%", 100, 2),
    "KRÁTENIE SD ZA II. PILIER":    ("Krátenie SD za II. pilier", "%", 1, 2),
}


def kpi(ws) -> None:
    """Osem čísel z hlavičky hárku aj s popisom, ktorý im dal autor reportu."""
    rows = []
    for top in (find(ws, "VYPLÁCANÉ DÁVKY"), find(ws, "NOVOPRIZNANÝ STAROBNÝ")):
        for col in (1, 2, 4, 6):
            label = clean(ws.cell(top, col).value)
            if not label:
                continue
            if label not in KPI:
                sys.exit(f"Nová dlaždica v hlavičke: {label!r} — doplň ju do KPI.")
            nazov, jednotka, scale, nd = KPI[label]
            rows.append([nazov, r(num(ws.cell(top + 1, col).value) * scale, nd),
                         jednotka, clean(ws.cell(top + 2, col).value)])
    if len(rows) != len(KPI):
        sys.exit(f"V hlavičke je {len(rows)} dlaždíc, čakalo sa {len(KPI)}.")
    write_csv("rrz_kpi.csv", ["ukazovatel", "hodnota", "jednotka", "popis"], rows)


# ── výťah `RRZ_detail_druhy.xlsx` ─────────────────────────────────────────────

# Blok hárku Popisne_statistiky (text v zátvorke hlavičky) → definícia v CSV.
DETAIL_POHLADY = {
    "vsetci poberatelia": "Všetci poberatelia",
    "poberatelia nekratenych dochodkov bez INYCH dochodkov": "Nekrátené bez iného dôchodku",
    "solo poberatelia": "Sólo poberatelia",
}
# Názvy druhov v Popisne_statistiky → názvy, aké nesie rrz_davky_druh.csv.
DETAIL_DRUHY = {
    "Starobný dôchodok": DRUHY[0], "Predčasný dôchodok": DRUHY[1],
    "Invalidný dôchodok do 70": DRUHY[2], "Invalidný dôchodok nad 70": DRUHY[3],
    "Vdovský/Vdovecký dôchodok": DRUHY[4], "Sirotský dôchodok": DRUHY[5],
}


def davky_druh_vyvoj(ws) -> None:
    """Počet a priemer podľa roku, druhu a definície → rrz_davky_druh_vyvoj.csv.

    Vstup:  ws — hárok Popisne_statistiky z výťahu; bloky pod sebou, každý s hlavičkou
            „Rok | Typ dochodku | Pocet (…) | Priemer davok (…)"
    Výstup: žiadny; CSV s riadkom rok × druh × definícia (3 × 6 × 3 = 54 riadkov)
    Príklad: (2026, Starobný dôchodok, Nekrátené bez iného dôchodku) → 1015460, 721.5
    """
    out = []
    pohlad = None
    for row in ws.iter_rows(values_only=True):
        if row[0] == "Rok":
            m = re.match(r"Pocet \((.+)\)$", clean(row[2]))
            if not m or m.group(1) not in DETAIL_POHLADY:
                sys.exit(f"Popisne_statistiky: neznámy blok „{clean(row[2])}“ — oprav DETAIL_POHLADY.")
            pohlad = DETAIL_POHLADY[m.group(1)]
            continue
        if not isinstance(row[0], (int, float)):
            continue
        typ = clean(row[1])
        if typ not in DETAIL_DRUHY:
            sys.exit(f"Popisne_statistiky: neznámy druh „{typ}“ — oprav DETAIL_DRUHY.")
        out.append([int(row[0]), DETAIL_DRUHY[typ], pohlad, int(num(row[2])), r(num(row[3]))])
    if {x[2] for x in out} != set(DETAIL_POHLADY.values()):
        sys.exit("Popisne_statistiky: vo výťahu nie sú všetky tri definície.")
    order = {d: i for i, d in enumerate(DRUHY)}
    porder = {p: i for i, p in enumerate(POHLADY)}
    out.sort(key=lambda x: (x[0], porder[x[2]], order[x[1]]))
    write_csv("rrz_davky_druh_vyvoj.csv", ["rok", "druh", "pohlad", "pocet", "priemer_eur"], out)


def davky_mesacne(ws) -> None:
    """Počet vyplácaných dávok podľa druhu po mesiacoch → rrz_davky_mesacne.csv.

    Vstup:  ws — hárok Poc_davok_podla_druhu_doch_mes z výťahu; hlavička + riadok za mesiac,
            stĺpec A dátum, ďalej šesť druhov v poradí DRUHY
    Výstup: žiadny; CSV s riadkom mesiac × druh (30 mesiacov × 6 = 180 riadkov)
    Príklad: (2026-06, Starobný dôchodok) → 1125948
    """
    rows = list(ws.iter_rows(values_only=True))
    if clean(rows[0][0]) != "Mesiac" or len(rows[0]) < 7:
        sys.exit("Poc_davok_podla_druhu_doch_mes: hlavička nesedí — vyrob výťah znova.")
    out = []
    for row in rows[1:]:
        if row[0] is None:
            continue
        mesiac = row[0].strftime("%Y-%m")
        for druh, v in zip(DRUHY, row[1:7]):
            out.append([mesiac, druh, int(num(v))])
    write_csv("rrz_davky_mesacne.csv", ["mesiac", "druh", "pocet"], out)


# Faktory rozkladu v poradí stĺpcov hárku Rozklad_zmeny_SD; každý má dva stĺpce
# za sebou — príspevok z predošlého roka (t−1) a z bežného roka (t).
ROZKLAD_FAKTORY = ["Noví poberatelia", "Valorizácia nových", "Paušálna valorizácia",
                   "Zomrelí", "Ostatné faktory", "Prerušenie poberania"]
RIMSKE = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"]


def rozklad_sd(ws) -> None:
    """Rozklad medziročnej zmeny nákladov na starobné dôchodky → rrz_rozklad_naklady_sd.csv.

    Vstup:  ws — hárok Rozklad_zmeny_SD z výťahu; hlavička + riadok za rok:
            rok, zmena spolu (€), 12 príspevkov (6 faktorov × t−1, t) v €, počet mesiacov
    Výstup: žiadny; CSV s riadkom rok × faktor × obdobie (13 riadkov za rok vrátane súčtu),
            v mil. €. Stĺpec `porovnanie` je popis snímky posuvníka; pri neúplnom roku
            nesie rozsah mesiacov, lebo report vtedy porovnáva rovnaké mesiace oboch rokov.
    Príklad: 2026 so 6 mesiacmi → porovnanie „2025 → 2026 (I.–VI.)“, súčet 238,88 mil. €
    """
    rows = list(ws.iter_rows(values_only=True))
    if clean(rows[0][0]) != "Rok" or len(rows[0]) != 15 or clean(rows[0][14]) != "Mesiacov v roku":
        sys.exit("Rozklad_zmeny_SD: hlavička nesedí — vyrob výťah znova.")
    out = []
    for row in rows[1:]:
        if not isinstance(row[0], (int, float)):
            continue
        rok, mesiacov = int(row[0]), int(row[14])
        porovnanie = f"{rok - 1} → {rok}"
        if mesiacov < 12:
            porovnanie += f" (I.–{RIMSKE[mesiacov]}.)"
        prispevky = [num(v) / 1e6 for v in row[2:14]]
        if abs(sum(prispevky) - num(row[1]) / 1e6) > 1e-6:
            sys.exit(f"Rozklad_zmeny_SD: {rok} — príspevky sa nesčítajú na zmenu spolu.")
        for i, faktor in enumerate(ROZKLAD_FAKTORY):
            for j, obdobie in enumerate(("t-1", "t")):
                out.append([rok, porovnanie, faktor, obdobie, r(prispevky[2 * i + j]), 0])
        out.append([rok, porovnanie, "Zmena spolu", "spolu", r(num(row[1]) / 1e6), 1])
    write_csv("rrz_rozklad_naklady_sd.csv",
              ["rok", "porovnanie", "faktor", "obdobie", "zmena_mil_eur", "je_spolu"], out)


def main() -> None:
    if not SRC.exists():
        sys.exit(f"Chýba {SRC.relative_to(ROOT)} — vyrob ho: "
                 f"python3 tools/extract_rrz_sheets.py <report.xlsx>")
    wb = openpyxl.load_workbook(SRC, data_only=True)
    st, par = wb["statistiky"], wb["parametre"]

    kpi(st)
    davky_podla_druhu(st)
    sd_vyvoj(st)
    sd_pohlavie(st)
    vstup_vystup(st)
    kratenie(st)
    doba_poberania(st)
    naklady(st)
    decily(st)

    veliciny(par)
    dochodkovy_vek(par)
    minimalny_dochodok(par)
    trinasty(par)
    vypocet(par)
    pomb_uprava(par)
    odvody(par)
    narok(par)
    psd_pravidla(par)

    if not SRC_DETAIL.exists():
        sys.exit(f"Chýba {SRC_DETAIL.relative_to(ROOT)} — vyrob ho: "
                 f"python3 tools/extract_rrz_detail.py <report.xlsx>")
    det = openpyxl.load_workbook(SRC_DETAIL, data_only=True)
    davky_druh_vyvoj(det["Popisne_statistiky"])
    davky_mesacne(det["Poc_davok_podla_druhu_doch_mes"])
    rozklad_sd(det["Rozklad_zmeny_SD"])

    print(f"Z {SRC.name} a {SRC_DETAIL.name} vzniklo {len(written)} súborov:")
    for name, n in written:
        print(f"  data/{name}  ({n} riadkov)")


if __name__ == "__main__":
    main()
