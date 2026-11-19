#!/usr/bin/env python3
"""extract_rrz_sheets.py — z manažérskeho reportu vyberie dva hárky.

Prečo nie celý zošit. Zdrojový report má ~70 hárkov a 4,4 MB; do projektu sa
majú dostať dva: `statistiky` a `parametre`. Repozitár je zároveň zverejnený
web, takže commitnúť celý zošit by znamenalo zverejniť aj tých ~68 hárkov, o
ktoré nikto nežiadal. Tento skript vyrobí zdroj, ktorý obsahuje presne to, čo
sa publikuje — a ktorý sa dá kedykoľvek porovnať s CSV, ktoré z neho vznikli.

    python3 tools/extract_rrz_sheets.py <cesta_k_reportu.xlsx>

Zapisuje data/zdroj/RRZ_statistiky_parametre.xlsx. Vzorce sa pritom nahradia
vypočítanými hodnotami (načítava sa data_only=True): hárky sú výstupná správa,
nie model, a hodnota je to, čo sa publikuje.
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    import openpyxl
except ImportError:
    sys.exit("Chýba openpyxl. Nainštaluj: pip install openpyxl")

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "zdroj" / "RRZ_statistiky_parametre.xlsx"
SHEETS = ("statistiky", "parametre")


def main(src: Path) -> None:
    wb = openpyxl.load_workbook(src, data_only=True)
    missing = [s for s in SHEETS if s not in wb.sheetnames]
    if missing:
        sys.exit(f"V zošite chýbajú hárky: {', '.join(missing)}")

    out = openpyxl.Workbook()
    out.remove(out.active)
    for name in SHEETS:
        ws, dst = wb[name], out.create_sheet(name)
        for row in ws.iter_rows():
            for cell in row:
                if cell.value is not None:
                    dst.cell(cell.row, cell.column, cell.value)
        # Šírky stĺpcov nesú čitateľnosť hárku, inak by sa otvoril ako kaša.
        for key, dim in ws.column_dimensions.items():
            if dim.width:
                dst.column_dimensions[key].width = dim.width
    OUT.parent.mkdir(parents=True, exist_ok=True)
    out.save(OUT)
    kb = OUT.stat().st_size / 1024
    print(f"{OUT.relative_to(ROOT)} — {len(SHEETS)} hárky, {kb:.0f} KB "
          f"(zdroj mal {src.stat().st_size / 1024 / 1024:.1f} MB a {len(wb.sheetnames)} hárkov)")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(Path(sys.argv[1]))
