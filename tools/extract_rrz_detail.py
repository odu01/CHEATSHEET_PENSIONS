#!/usr/bin/env python3
"""extract_rrz_detail.py — z plného reportu RRZ vyberie vývoj dávok podľa druhu dôchodku.

Hlavný výťah (extract_rrz_sheets.py) nesie hárky `statistiky` a `parametre` a v nich je
rozpad podľa druhu dôchodku len za posledný mesiac. Vývoj za predchádzajúce roky je v
dvoch iných hárkoch reportu. Tento skript z nich vyberie presne to, čo web zobrazuje —
nič viac, lebo repozitár je zároveň zverejnený web:

  Popisne_statistiky              rok × druh × definícia → počet, priemer
                                  (len bloky „všetci poberatelia", „nekrátené bez INÝCH
                                  dôchodkov" a „sólo"; medián, rozptyl, extrémy a bloky
                                  s výsluhovým a cudzinovým dôchodkom sa nepublikujú)
  Poc_davok_podla_druhu_doch_mes  mesiac × druh → počet vyplácaných dávok
                                  (šesť druhov dôchodku; výsluhové a cudzinové dávky sa
                                  nepublikujú)
  Rocne_naklady_podla_druhu_doch  rok → rozklad medziročnej zmeny nákladov na starobné
                                  dôchodky na príspevky faktorov (t−1 a t), v eurách;
                                  ostatné stĺpce hárku (náklady podľa druhu, pomocné
                                  stĺpce grafu) sa nepublikujú
  Mesacne_naklady_podla_druhu     len počet mesiacov v každom roku — hovorí, či je
                                  rozklad za celý rok, alebo za jeho začiatok

    python3 tools/extract_rrz_detail.py <cesta_k_reportu.xlsx>

Zapisuje data/zdroj/RRZ_detail_druhy.xlsx. Hodnoty sa berú vypočítané (data_only).
Keď report zmení názvy stĺpcov alebo blokov, skript skončí chybou s menom toho, čo
nenašiel — ticho vybraté zlé stĺpce sú horšie než spadnutý výťah.
"""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

try:
    import openpyxl
except ImportError:
    sys.exit("Chýba openpyxl. Nainštaluj: pip install openpyxl")

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "zdroj" / "RRZ_detail_druhy.xlsx"

# Bloky hárku Popisne_statistiky, ktoré sa publikujú: text v zátvorke hlavičky
# stĺpca „Pocet (…)". Ostatné bloky (krátené, s výsluhovým, s cudzinovým) nie.
BLOKY = (
    "vsetci poberatelia",
    "poberatelia nekratenych dochodkov bez INYCH dochodkov",
    "solo poberatelia",
)
# Stĺpce mesačného hárku, ktoré sa publikujú — šesť druhov dôchodku v poradí reportu.
MESACNE_STLPCE = (
    "Mesiac",
    "Starobné dôchodkové dávky",
    "Predčasné starobné dôchodkové dávky",
    "Invalidné dôchodkové dávky do 70%",
    "Invalidné dôchodkové dávky nad 70%",
    "Vdovské/vdovecké dôchodkové dávky",
    "Sirotské dôchodkové dávky",
)
# Stĺpce rozkladu v hárku Rocne_naklady_podla_druhu_doch v poradí, v akom sa
# publikujú: rok, zmena spolu, 12 príspevkov (faktor × t−1/t) a kontrola reportu.
ROZKLAD_STLPCE = (
    "Rok",
    "Medziročná zmena nákladov na starobné dôchodky",
    "Príspevok nových poberateľov z predošlého roka na zmene",
    "Príspevok nových poberateľov z daného roka na zmene",
    "Príspevok valorizácie novopriznaných dôchodkov z predošlého roka na zmene",
    "Príspevok valorizácie novopriznaných dôchodkov z daného roka na zmene",
    "Príspevok paušálnej januárovej valorizácie z predchádzajúceho roka na zmene",
    "Príspevok paušálnej januárovej valorizácie z daného roka na zmene",
    "Príspevok zomrelých poberateľov z predošlého roka na zmene",
    "Príspevok zomrelých poberateľov z daného roka na zmene",
    "Príspevok ostatných faktorov z predošlého roka na zmene",
    "Príspevok ostatných faktorov z daného roka na zmene",
    "Príspevok prerušeného poberania dôchodku z predošlého roka na zmene",
    "Príspevok prerušeného poberania dôchodku z daného roka na zmene",
)


def popisne_bloky(ws) -> list[list]:
    """Vyberie z hárku Popisne_statistiky publikované bloky, stĺpce A–D.

    Vstup:  ws — hárok openpyxl (read-only), bloky pod sebou, každý s hlavičkou
            „Rok | Typ dochodku | Pocet (…) | Priemer davok (…) | …"
    Výstup: list riadkov (list[4]) — hlavička bloku, jeho dátové riadky a prázdny
            riadok ako oddeľovač; poradie blokov ako v BLOKY
    Príklad: 3 bloky × (1 hlavička + 18 riadkov) → 60 riadkov vrátane oddeľovačov
    """
    rows = [list(r[:4]) for r in ws.iter_rows(values_only=True)]
    out = []
    for blok in BLOKY:
        head = f"Pocet ({blok})"
        start = next((i for i, r in enumerate(rows)
                      if r[0] == "Rok" and str(r[2] or "").strip() == head), None)
        if start is None:
            sys.exit(f"Popisne_statistiky: nenašiel sa blok s hlavičkou „{head}“")
        out.append(rows[start])
        for r in rows[start + 1:]:
            if not isinstance(r[0], (int, float)):
                break
            out.append(r)
        out.append([None] * 4)
    return out


def mesacne_davky(ws) -> list[list]:
    """Vyberie z mesačného hárku počet dávok šiestich druhov dôchodku.

    Vstup:  ws — hárok openpyxl (read-only); 1. riadok hlavička, ďalej riadok za mesiac
            so stĺpcom A ako dátum
    Výstup: list riadkov (list[7]) — hlavička MESACNE_STLPCE a riadky mesiacov
    Príklad: 01/2024 – 06/2026 → 1 + 30 riadkov
    """
    rows = list(ws.iter_rows(values_only=True))
    head = [str(v).strip() if v is not None else "" for v in rows[0]]
    idx = []
    for name in MESACNE_STLPCE:
        if name not in head:
            sys.exit(f"Poc_davok_podla_druhu_doch_mes: chýba stĺpec „{name}“")
        idx.append(head.index(name))
    out = [list(MESACNE_STLPCE)]
    for r in rows[1:]:
        if isinstance(r[idx[0]], datetime):
            out.append([r[i] for i in idx])
    return out


def mesiacov_v_roku(ws) -> dict[int, int]:
    """Koľko mesiacov má hárok mesačných nákladov v každom roku.

    Vstup:  ws — hárok Mesacne_naklady_podla_druhu (read-only); stĺpec A je dátum mesiaca
    Výstup: dict {rok (int): počet rôznych mesiacov (int)}
    Príklad: 01/2024 – 06/2026 → {2024: 12, 2025: 12, 2026: 6}
    """
    seen: dict[int, set[int]] = {}
    for r in ws.iter_rows(values_only=True):
        if isinstance(r[0], datetime):
            seen.setdefault(r[0].year, set()).add(r[0].month)
    return {y: len(m) for y, m in seen.items()}


def rozklad_sd(ws, mesiacov: dict[int, int]) -> list[list]:
    """Vyberie rozklad zmeny nákladov na starobné dôchodky a pridá počet mesiacov.

    Vstup:  ws — hárok Rocne_naklady_podla_druhu_doch (read-only); 1. riadok hlavička,
            pod ňou riadok za každý rok, pre ktorý report rozklad počíta
            mesiacov — výstup mesiacov_v_roku (dict {rok: počet mesiacov})
    Výstup: list riadkov (list[15]) — hlavička ROZKLAD_STLPCE + „Mesiacov v roku" a riadok
            za rok; hodnoty v eurách, ako ich počíta report
    Príklad: 2025 → [2025, 420892121.9, 219512940.7, …, 12]
    """
    rows = list(ws.iter_rows(values_only=True))
    head = [str(v).strip() if v is not None else "" for v in rows[0]]
    idx = []
    for name in ROZKLAD_STLPCE[1:]:
        if name not in head:
            sys.exit(f"Rocne_naklady_podla_druhu_doch: chýba stĺpec „{name}“")
        idx.append(head.index(name))
    # „Rok" je v hárku viackrát (aj pri nákladoch podľa druhu) — rok rozkladu je
    # stĺpec hneď pred zmenou spolu.
    if idx[0] == 0 or head[idx[0] - 1] != "Rok":
        sys.exit("Rocne_naklady_podla_druhu_doch: pred zmenou spolu nie je stĺpec „Rok“")
    idx.insert(0, idx[0] - 1)
    out = [list(ROZKLAD_STLPCE) + ["Mesiacov v roku"]]
    for r in rows[1:]:
        rok = r[idx[0]]
        if not isinstance(rok, (int, float)):
            continue
        vals = [r[i] for i in idx]
        if any(not isinstance(v, (int, float)) for v in vals):
            sys.exit(f"Rocne_naklady_podla_druhu_doch: rok {rok} nemá všetky príspevky")
        # Príspevky sa musia sčítať na zmenu spolu — to isté overuje stĺpec Kontrola reportu.
        if abs(sum(vals[2:]) - vals[1]) > 1:
            sys.exit(f"Rocne_naklady_podla_druhu_doch: rok {rok} — príspevky "
                     f"{sum(vals[2:]):,.0f} € sa nerovnajú zmene {vals[1]:,.0f} €")
        if int(rok) not in mesiacov:
            sys.exit(f"Mesacne_naklady_podla_druhu: chýbajú mesiace roku {int(rok)}")
        out.append(vals + [mesiacov[int(rok)]])
    if len(out) == 1:
        sys.exit("Rocne_naklady_podla_druhu_doch: rozklad nie je ani za jeden rok")
    return out


def main(src: Path) -> None:
    """Zapíše výťah RRZ_detail_druhy.xlsx z plného reportu.

    Vstup:  src — cesta k plnému reportu (.xlsx)
    Výstup: žiadny; zapíše OUT a vypíše jeho veľkosť
    Príklad: main(Path("Summary_Report_auto.xlsx"))
    """
    wb = openpyxl.load_workbook(src, data_only=True, read_only=True)
    for name in ("Popisne_statistiky", "Poc_davok_podla_druhu_doch_mes",
                 "Rocne_naklady_podla_druhu_doch", "Mesacne_naklady_podla_druhu"):
        if name not in wb.sheetnames:
            sys.exit(f"V zošite chýba hárok {name}")
    mesiacov = mesiacov_v_roku(wb["Mesacne_naklady_podla_druhu"])
    out = openpyxl.Workbook()
    out.remove(out.active)
    for name, rows in (("Popisne_statistiky", popisne_bloky(wb["Popisne_statistiky"])),
                       ("Poc_davok_podla_druhu_doch_mes",
                        mesacne_davky(wb["Poc_davok_podla_druhu_doch_mes"])),
                       ("Rozklad_zmeny_SD",
                        rozklad_sd(wb["Rocne_naklady_podla_druhu_doch"], mesiacov))):
        ws = out.create_sheet(name)
        for r in rows:
            ws.append(r)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    out.save(OUT)
    print(f"{OUT.relative_to(ROOT)} — {OUT.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(Path(sys.argv[1]))
