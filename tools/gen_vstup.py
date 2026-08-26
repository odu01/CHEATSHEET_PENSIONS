#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""gen_vstup.py — vygeneruje syntetické vstupné súbory do data/vstup/.

Prečo tento skript existuje
---------------------------
Web má ukazovatele, ku ktorým ešte nemáme dodané reálne čísla. Prázdna karta
s nápisom „čaká na dáta" nič nehovorí — graf sa nedá posúdiť, ani sa nedá
overiť, či je zvolený tvar grafu ten správny. Preto sa každý taký ukazovateľ
naplní **syntetickými** dátami: číslami z modelu, ktorý je kalibrovaný na
zverejnené kotvy (uvedené nižšie u každého datasetu, s odkazom na zdroj).

Syntetické neznamená vymyslené naslepo. Model drží tie čísla, ktoré sú
zverejnené, a dopočítava len to, čo medzi nimi chýba. Čo je kotva a čo je
dopočítané, je vidieť v komentároch pri každej funkcii a v hlavičke každého
CSV; každá karta na webe má navyše výstražný odznak „Syntetické dáta".

Súbory v data/vstup/ sú zároveň **vstupný formát**: keď prídu reálne čísla,
prepíšu sa hodnoty v tom istom súbore (hlavička sa nemení) a v manifeste sa
zmažú kľúče `illustrative` a `badge` a doplní sa `source`. Nič iné.
Kontrolu tvaru súboru robí `npm run vstup`.

Použitie:  python3 tools/gen_vstup.py            # prepíše data/vstup/*.csv
           python3 tools/gen_vstup.py --check     # len overí, že sú aktuálne

Determinizmus: žiadny generátor náhodných čísel. Rovnaký vstup → rovnaký
výstup po bajtoch, takže CI vie overiť, že commitnuté CSV sedia so skriptom.
"""

from __future__ import annotations

import csv
import io
import math
import sys
from bisect import bisect_right
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "vstup"

CHECK = "--check" in sys.argv[1:]

# ─────────────────────────────────────────────────────────────────────────────
# 1. Kotvy: čísla, ktoré sú zverejnené a model ich musí dodržať
# ─────────────────────────────────────────────────────────────────────────────

# Stredná dĺžka života pri narodení, SR, obe pohlavia. Zverejnené body:
#   1970 = 69,7 (minimum radu), 2019 = 77,8, 2021 = 74,6 (pandemický pokles),
#   2022 = 77,0, 2023 = 78,2. Rok 2014–2020 sa držal okolo 77.
#   Zdroj: Eurostat / ŠÚ SR, citované v teraz.sk a openiazoch.sk (2022, 2024).
# Body pred 1970 a po 2024 sú predĺženie radu, nie meranie — pre kohortové
# krivky treba mortalitu od roku 1930 do roku ~2130, inak sa generácia 1930
# ani 2030 nedá dopočítať.
E0_ANCHORS = {
    1930: 52.0, 1935: 54.5, 1940: 57.0, 1945: 58.5, 1950: 62.5, 1955: 67.0,
    1960: 69.8, 1965: 70.3, 1970: 69.7, 1975: 70.2, 1980: 70.4, 1985: 70.8,
    1990: 71.0, 1995: 72.5, 2000: 73.3, 2005: 74.2, 2010: 75.6, 2015: 76.7,
    2019: 77.8, 2020: 76.9, 2021: 74.6, 2022: 77.0, 2023: 78.2, 2024: 78.5,
    2030: 79.6, 2040: 80.9, 2050: 81.9, 2060: 82.8, 2080: 84.2, 2100: 85.4,
    2130: 86.8,
}

# Rozdiel žena − muž v strednej dĺžke života. 2023: muži 75,0 / ženy 81,6
# (UN WPP pre SR) → rozdiel 6,6 roka. Historicky bol väčší, projekcia ho zužuje.
GAP_ANCHORS = {1930: 4.0, 1950: 5.0, 1970: 7.0, 1990: 7.7, 2000: 8.2,
               2010: 7.4, 2023: 6.6, 2040: 5.8, 2060: 5.2, 2130: 4.6}

# Kojenecká úmrtnosť na 1000 živonarodených. Zverejnené body: 1960 = 31,0,
# 1990 = 14,7, 2012 = 5,0 (minimum), 2023 = 5,0. Zdroj: World Bank / UNICEF.
IMR_ANCHORS = {1930: 160.0, 1940: 130.0, 1950: 90.0, 1960: 31.0, 1970: 25.4,
               1980: 20.9, 1990: 14.7, 2000: 8.6, 2010: 5.7, 2012: 5.0,
               2023: 5.0, 2040: 3.6, 2060: 3.0, 2130: 2.6}

# Nádej dožitia vo veku 65 v roku 2023: 18,4 roka (spolu 83,4). Týmto bodom sa
# ladí sklon Gompertzovej zložky — bez neho by model splnil e0 a pomýlil sa
# práve v tom veku, na ktorom dôchodkovému systému záleží najviac.
E65_2023 = 18.4

# Starobné dôchodky k 31. 12. 2024 (Sociálna poisťovňa):
POCET_SD_2024 = 1_134_690      # počet vyplácaných starobných dôchodkov
PRIEMER_SD_2024 = 683.10       # priemerný starobný dôchodok „solo", EUR/mes.
NAD_1000_2024 = 107_131        # počet dôchodkov nad 1 000 EUR
NAD_2000_2024 = 469            # počet dôchodkov nad 2 000 EUR
NAD_2500_2024 = 50             # počet dôchodkov nad 2 500 EUR
MIN_DOCHODOK_2024 = 389.90     # suma minimálneho dôchodku (10/2024)
POCET_MIN_2024 = 84_693        # počet poberateľov minimálneho dôchodku

# Zomretí dôchodcovia za rok. Kotva: v SR zomiera ~53 tis. osôb ročne (2024),
# z toho drvivá väčšina vo veku nad 65 → odhad 45 500 zomretých dôchodcov.
# Jedno číslo pre dobu poberania aj pre maticu prechodov, aby si neprotirečili.
ZOMRETI_SD = 45_500

# II. pilier — zverejnené koncoročné stavy. Čistá hodnota majetku v mil. EUR
# a počet sporiteľov. Zdroj: ADSS, MPSVR, NBS (tlačové správy 2024–2026).
PILIER2_AKTIVA = {  # mil. EUR, koniec obdobia
    "2013-12": 6_090, "2014-12": 6_350, "2015-12": 6_650, "2016-12": 7_320, "2017-12": 8_020, "2018-12": 8_270,
    "2019-12": 9_540, "2020-12": 10_640, "2021-12": 12_240, "2022-12": 11_820,
    "2023-12": 14_060, "2024-12": 16_780, "2025-12": 19_100, "2026-06": 21_570,
}
PILIER2_SPORITELIA = {  # osôb, koniec obdobia
    "2013-12": 1_450_000, "2014-12": 1_451_000, "2015-12": 1_452_000, "2016-12": 1_469_000, "2017-12": 1_487_000,
    "2018-12": 1_509_000, "2019-12": 1_570_000, "2020-12": 1_628_000,
    "2021-12": 1_691_000, "2022-12": 1_748_000, "2023-12": 1_838_665,
    "2024-12": 1_949_000, "2025-12": 2_016_000, "2026-06": 2_048_000,
}

# Dôchodkový vek, pri ktorom sa priznával starobný dôchodok. Do roku 2003 platil
# vek 60 pre mužov a 53–57 pre ženy podľa počtu detí (tu ako priemer za ženy),
# potom postupné zjednocovanie a naviazanie na strednú dĺžku života.
DOCH_VEK_MUZI = {1990: 60.0, 2004: 60.0, 2010: 62.0, 2017: 62.0, 2020: 62.5,
                 2024: 63.2, 2030: 64.0, 2040: 65.2}
DOCH_VEK_ZENY = {1990: 55.5, 2004: 56.5, 2010: 58.5, 2017: 61.0, 2020: 62.0,
                 2024: 63.2, 2030: 64.0, 2040: 65.2}

# Živonarodení v SR — hrubá rada pre vekový profil dôchodcov. Presné čísla
# netreba: profil sa nakoniec preváži na zverejnený súčet dôchodkov.
NARODENI = {1925: 105_000, 1930: 108_000, 1935: 102_000, 1940: 98_000,
            1945: 92_000, 1950: 95_000, 1955: 92_000, 1960: 85_000,
            1965: 78_000, 1970: 80_000, 1975: 95_000, 1980: 95_000,
            1985: 80_000, 1990: 79_000, 1995: 61_000, 2000: 55_000,
            2005: 54_000, 2010: 61_000, 2015: 56_000, 2020: 57_000}


def real_december(name: str, druh: str, column: str) -> dict:
    """Decembrové hodnoty z reálnej mesačnej rady v data/.

    Syntetické súbory sa tým prestávajú vznášať: úroveň každého roku je reálne
    číslo Sociálnej poisťovne a model dopĺňa len tvar rozdelenia. Bez toho by
    animácia cez desať rokov ukazovala pohyb, ktorý si vymyslel model.
    """
    out = {}
    with (ROOT / "data" / name).open(encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            if row["druh"] != druh or not row["mesiac"].endswith("-12"):
                continue
            out[int(row["mesiac"][:4])] = float(row[column])
    if not out:
        raise SystemExit(f"gen_vstup: v {name} nie sú decembrové hodnoty pre {druh}")
    return out


# Reálne decembrové stavy starobných dôchodkov a hotovostný priemer za ne.
# Priemer sa používa len ako POMER medzi rokmi — hladina roku 2024 zostáva
# zverejnený sólo priemer 683,10 €. Pomer je definične neutrálny (tá istá
# populácia, tá istá metodika), takže sa dá preniesť na inú definíciu hladiny.
POCTY_SD = real_december("sp_pocty_mesacne.csv", "Starobný", "pocet")
PRIEMER_CASH = real_december("sp_priemer_mesacne.csv", "Starobný", "priemer_eur")

# Roky, za ktoré sa generujú vekové a pásmové rozdelenia — desať rokov stačí,
# aby mala animácia čo ukázať, a všetky majú reálnu kotvu.
ROKY = [r for r in range(2015, 2025) if r in POCTY_SD and r in PRIEMER_CASH]


def rok_uroven(rok: int) -> tuple[int, float]:
    """(počet dôchodkov, priemerný dôchodok) pre daný rok."""
    pocet = int(round(POCTY_SD[rok]))
    priemer = PRIEMER_SD_2024 * PRIEMER_CASH[rok] / PRIEMER_CASH[2024]
    return pocet, priemer


def interp(anchors: dict, x: float) -> float:
    """Lineárna interpolácia medzi kotvami, mimo rozsahu drží krajnú hodnotu."""
    keys = sorted(anchors)
    if x <= keys[0]:
        return float(anchors[keys[0]])
    if x >= keys[-1]:
        return float(anchors[keys[-1]])
    i = bisect_right(keys, x) - 1
    x0, x1 = keys[i], keys[i + 1]
    y0, y1 = anchors[x0], anchors[x1]
    return float(y0 + (y1 - y0) * (x - x0) / (x1 - x0))


# ─────────────────────────────────────────────────────────────────────────────
# 2. Model úmrtnosti (Siler): infantná + pozaďová + Gompertzova zložka
# ─────────────────────────────────────────────────────────────────────────────
#
#   μ(x) = a1·exp(−b1·x)  +  a2  +  a3·exp(b3·x)
#          detská úmrtnosť   úrazy   starnutie
#
# Pre každý rok a pohlavie sa hľadajú dve neznáme:
#   a1  tak, aby q0 sedelo na kojeneckú úmrtnosť daného roku,
#   a3  tak, aby e0 sedelo na strednú dĺžku života daného roku.
# Sklon b3 je jeden pre celý model a je nastavený tak, aby v roku 2023 vyšla
# nádej dožitia vo veku 65 na 18,4 roka. Tri kotvy, tri parametre — nič viac
# sa nedoladzuje.

B1 = 1.4          # ako rýchlo opadá detská úmrtnosť s vekom
A2 = 0.00035      # pozaďová (úrazová) úmrtnosť, nezávislá od veku
OMEGA = 121       # posledný vek tabuľky


def _q0(a1: float, a3: float, b3: float) -> float:
    """Pravdepodobnosť úmrtia v prvom roku života — integrovaná po mesiacoch,
    lebo riziko v prvom roku padá príliš rýchlo na stredový odhad."""
    s = 0.0
    for k in range(12):
        x = (k + 0.5) / 12.0
        s += (a1 * math.exp(-B1 * x) + A2 + a3 * math.exp(b3 * x)) / 12.0
    return 1.0 - math.exp(-s)


def life_table(a1: float, a3: float, b3: float) -> tuple[list[float], list[float]]:
    """Vráti (q, l): pravdepodobnosti úmrtia a prežívajúcich z 1,0 pri narodení."""
    q = [0.0] * OMEGA
    q[0] = _q0(a1, a3, b3)
    for x in range(1, OMEGA):
        mu = a1 * math.exp(-B1 * (x + 0.5)) + A2 + a3 * math.exp(b3 * (x + 0.5))
        q[x] = 1.0 - math.exp(-mu)
    q[OMEGA - 1] = 1.0
    l = [1.0]
    for x in range(OMEGA):
        l.append(l[x] * (1.0 - q[x]))
    return q, l


def ex(l: list[float], x: int) -> float:
    """Nádej dožitia vo veku x z radu prežívajúcich (polročná korekcia)."""
    if l[x] <= 0:
        return 0.0
    total = sum((l[k] + l[k + 1]) / 2.0 for k in range(x, OMEGA))
    return total / l[x]


def _solve(f, lo: float, hi: float, target: float, iters: int = 90) -> float:
    """Bisekcia na monotónnej funkcii. Bez knižníc a bez prekvapení."""
    flo = f(lo)
    for _ in range(iters):
        mid = (lo + hi) / 2.0
        fm = f(mid)
        if (fm > target) == (flo > target):
            lo, flo = mid, fm
        else:
            hi = mid
    return (lo + hi) / 2.0


def calibrate(e0_target: float, imr_target: float, b3: float) -> tuple[float, float]:
    """Nájde (a1, a3) pre daný rok. a3 rieši e0, a1 rieši kojeneckú úmrtnosť;
    väzba medzi nimi je slabá, tak stačia tri kolá striedania."""
    a1, a3 = 0.02, 1e-5
    for _ in range(3):
        a3 = _solve(lambda v: ex(life_table(a1, v, b3)[1], 0), 1e-7, 5e-3, e0_target)
        a1 = _solve(lambda v: _q0(v, a3, b3), 0.0, 1.0, imr_target / 1000.0)
    return a1, a3


def fit_b3() -> float:
    """Sklon starnutia z kotvy e65 = 18,4 v roku 2023 (pri e0 = 78,2)."""
    def e65_for(b3: float) -> float:
        a1, a3 = calibrate(E0_ANCHORS[2023], IMR_ANCHORS[2023], b3)
        return ex(life_table(a1, a3, b3)[1], 65)
    # vyššie b3 = prudšie starnutie = kratšia nádej dožitia vo vyššom veku
    return _solve(e65_for, 0.060, 0.160, E65_2023, iters=40)


B3 = fit_b3()

# Ročné tabuľky sa používajú opakovane (kohorty aj periódy), tak sa cachujú.
_TABLES: dict[tuple[int, str], tuple[list[float], list[float]]] = {}


def table(year: int, sex: str = "spolu") -> tuple[list[float], list[float]]:
    """Periódová tabuľka pre daný rok a pohlavie (spolu / muzi / zeny)."""
    key = (year, sex)
    if key in _TABLES:
        return _TABLES[key]
    e0 = interp(E0_ANCHORS, year)
    gap = interp(GAP_ANCHORS, year)
    imr = interp(IMR_ANCHORS, year)
    if sex == "muzi":
        e0, imr = e0 - gap / 2.0, imr * 1.12
    elif sex == "zeny":
        e0, imr = e0 + gap / 2.0, imr * 0.88
    a1, a3 = calibrate(e0, imr, B3)
    _TABLES[key] = life_table(a1, a3, B3)
    return _TABLES[key]


def cohort_survival(birth_year: int, sex: str = "spolu", max_age: int = 100) -> list[float]:
    """Podiel generácie, ktorý sa dožil veku x — z úmrtností tých kalendárnych
    rokov, ktoré generácia skutočne prežila (nie z jednej periódovej tabuľky)."""
    out = [1.0]
    l = 1.0
    for age in range(max_age):
        q, _ = table(birth_year + age, sex)
        l *= 1.0 - q[age]
        out.append(l)
    return out


# ─────────────────────────────────────────────────────────────────────────────
# 3. Zápis CSV
# ─────────────────────────────────────────────────────────────────────────────

WRITTEN: list[tuple[str, int]] = []
STALE: list[str] = []
KEPT: list[str] = []


def _synthetic_files() -> set[str]:
    """Ktoré vstupné súbory sú ešte syntetické — podľa manifestu, nie podľa
    zoznamu v tomto skripte.

    Toto je poistka, na ktorej celý rámec stojí: keď niekto dodá reálne čísla a
    v manifeste zmaže `illustrative`, generátor sa toho súboru odvtedy ani
    nedotkne. Inak by `npm run vstup:gen` tiché prepísal reálne dáta modelom a
    nikto by si to nemusel všimnúť.
    """
    import json
    mf = json.loads((ROOT / "data" / "manifest.json").read_text(encoding="utf-8"))
    out = set()
    for d in mf.get("datasets", {}).values():
        f = d.get("file", "")
        if f.startswith("data/vstup/") and d.get("illustrative"):
            out.add(f.split("/")[-1])
    return out


SYNTHETIC = _synthetic_files()


def write_csv(name: str, header: list[str], rows: list[list]) -> None:
    """Zapíše (alebo pri --check porovná) jeden vstupný súbor."""
    path0 = OUT / name
    if path0.exists() and name not in SYNTHETIC:
        KEPT.append(name)          # už má reálne dáta — nechať na pokoji
        return
    buf = io.StringIO(newline="")
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(header)
    w.writerows(rows)
    text = buf.getvalue()
    path = OUT / name
    if CHECK:
        old = path.read_text(encoding="utf-8") if path.exists() else ""
        if old != text:
            STALE.append(name)
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    WRITTEN.append((name, len(rows)))


def r2(v: float) -> float:
    return round(v + 0.0, 2)


# ─────────────────────────────────────────────────────────────────────────────
# 4. Jednotlivé datasety
# ─────────────────────────────────────────────────────────────────────────────

KOHORTY = [1930, 1950, 1970, 1990, 2010, 2030]


def gen_prezitie_kohort() -> None:
    """Prežitie generácií: koľko % ročníka sa dožilo veku x.

    Kotvy: rada e0 a kojeneckej úmrtnosti (vyššie). Pri generáciách 1990 a
    mladších je väčšina krivky projekcia — generácia 1990 má odžité len ~36
    rokov, generácia 2030 sa ešte nezačala rodiť.
    """
    rows = []
    for c in KOHORTY:
        s = cohort_survival(c, "spolu", 100)
        for age in range(0, 101):
            rows.append([c, age, r2(s[age] * 100.0)])
    write_csv("prezitie_kohort.csv", ["kohorta", "vek", "prezitie_pct"], rows)


VEKY_NADEJE = [0, 10, 45, 65, 80]


def gen_nadej_dozitia() -> None:
    """Nádej dožitia podľa dosiahnutého veku: kto sa dožil veku x, dožije sa
    priemerne veku (x + e_x). Preto krivka pre vek 80 leží najvyššie — nie je
    to chyba, je to prežitie tých, ktorí už prežili rizikový vek.
    """
    rows = []
    for year in range(1970, 2025):
        q, l = table(year, "spolu")
        for age in VEKY_NADEJE:
            rows.append([year, age, r2(age + ex(l, age))])
    write_csv("nadej_dozitia_vek.csv", ["rok", "vek", "nadej_dozitia_celkom"], rows)


def _norm_cdf(z: float) -> float:
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def gen_dochodky_pasma() -> None:
    """Rozdelenie starobných dôchodkov podľa výšky — vstup pre kumulatívnu
    distribúciu výdavkov (Lorenzova krivka) aj pre histogram počtov.

    Kalibrácia na zverejnené čísla SP k 31. 12. 2024. Model má presne tri
    voľné parametre a drží štyri kotvy naraz:
      • súčet počtov       = 1 134 690 starobných dôchodkov
      • vážený priemer     = 683,10 EUR
      • pod min. dôchodkom = 84 693 (poberatelia minimálneho dôchodku 389,90 €)
      • nad 1 000 EUR      = 107 131
    a k tomu malá zložka vysokých dôchodkov, ktorá sama drží obe kotvy chvosta:
      • nad 2 000 EUR = 469,  nad 2 500 EUR = 50.

    Tvar telesa je **rozdelené normálne** rozdelenie (vľavo iná disperzia než
    vpravo). Symetrické by nesedelo: dôchodky sú zdola pridržané minimálnym
    dôchodkom a nahor majú tenký, ale dlhý chvost. OECD uvádza Gini starobných
    príjmov v SR tesne pod 0,200 — najnižšie v OECD, a presne to takýto tvar
    hovorí.

    Zverejnený údaj „do 700 EUR = 487 837" sa nepoužíva: s priemerom 683 EUR je
    nezlučiteľný (pri priemere 683 musí byť pod 700 EUR viac než polovica
    dôchodkov, nie 43 %), takže patrí k neskoršiemu obdobiu než ostatné kotvy.
    """
    SQ2PI = math.sqrt(2.0 / math.pi)
    T_MU, T_SIGMA = 1500.0, 450.0     # zložka vysokých dôchodkov
    w = NAD_2000_2024 / (POCET_SD_2024 * (1.0 - _norm_cdf((2000.0 - T_MU) / T_SIGMA)))

    def split_cdf(x: float, m: float, sl: float, sr: float) -> float:
        """CDF rozdeleného normálneho rozdelenia s vrcholom v m."""
        if x < m:
            return 2.0 * sl / (sl + sr) * _norm_cdf((x - m) / sl)
        return (sl + 2.0 * sr * (_norm_cdf((x - m) / sr) - 0.5)) / (sl + sr)

    def cdf_for(m: float, sl: float, sr: float):
        return lambda x: (1.0 - w) * split_cdf(x, m, sl, sr) + w * _norm_cdf((x - T_MU) / T_SIGMA)

    # m vychádza priamo z kotvy priemeru: priemer rozdeleného normálneho
    # rozdelenia je m + sqrt(2/π)·(σ_vpravo − σ_vľavo), plus vplyv chvosta.
    def peak(sl: float, sr: float) -> float:
        body_mean = (PRIEMER_SD_2024 - w * T_MU) / (1.0 - w)
        return body_mean - SQ2PI * (sr - sl)

    # σ_vpravo drží kotvu „nad 1 000 EUR", σ_vľavo kotvu „minimálny dôchodok"
    def share_above_1000(sl: float, sr: float) -> float:
        return 1.0 - cdf_for(peak(sl, sr), sl, sr)(1000.0)

    def fit_sr(sl: float) -> float:
        return _solve(lambda sr: share_above_1000(sl, sr), 120.0, 900.0,
                      NAD_1000_2024 / POCET_SD_2024)

    def share_below_min(sl: float) -> float:
        sr = fit_sr(sl)
        return cdf_for(peak(sl, sr), sl, sr)(MIN_DOCHODOK_2024)

    SL = _solve(share_below_min, 60.0, 400.0, POCET_MIN_2024 / POCET_SD_2024, iters=60)
    SR = fit_sr(SL)
    M = peak(SL, SR)
    cdf = cdf_for(M, SL, SR)

    edges = [0.0, 300.0] + [400.0 + 100.0 * i for i in range(17)] + [2500.0, 1e9]

    def mean_between(lo: float, hi: float) -> float:
        """Priemer pásma numericky — aby vážený priemer za všetky pásma sedel."""
        n, s, wsum = 60, 0.0, 0.0
        top = min(hi, 4200.0)
        for k in range(n):
            x0 = lo + (top - lo) * k / n
            x1 = lo + (top - lo) * (k + 1) / n
            d = cdf(x1) - cdf(x0)
            s += (x0 + x1) / 2.0 * d
            wsum += d
        return s / wsum if wsum > 0 else (lo + top) / 2.0

    # Rovnaké rozdelenie pre desať rokov: pásma zostávajú, mení sa len úroveň.
    # Dôchodok x € v roku 2024 zodpovedá x × (priemer roku / priemer 2024), takže
    # celá krivka sa posúva doprava tak, ako rástol priemer — nič viac sa
    # nepredpokladá. Reálne rozdelenie sa pritom aj mierne rozťahuje; to model
    # nevie a nepredstiera. Počty za rok sú reálne decembrové stavy SP.
    rows = []
    for rok in ROKY:
        total_rok, priemer_rok = rok_uroven(rok)
        ratio = priemer_rok / PRIEMER_SD_2024
        counts, means = [], []
        for i in range(len(edges) - 1):
            lo, hi = edges[i], edges[i + 1]
            counts.append((cdf(hi / ratio) - cdf(lo / ratio)) * total_rok)
            means.append(mean_between(lo / ratio, hi / ratio) * ratio)
        scale = total_rok / sum(counts)
        ints = [int(round(c * scale)) for c in counts]
        ints[ints.index(max(ints))] += total_rok - sum(ints)
        for i in range(len(edges) - 1):
            lo, hi = edges[i], edges[i + 1]
            label = (f"do {edges[1]:.0f}" if i == 0 else
                     f"{lo:.0f} a viac" if hi > 1e8 else f"{lo:.0f}\u2013{hi:.0f}")
            rows.append([rok, label, int(lo), ints[i], r2(means[i])])
        if rok == 2024:
            ints24, means24 = ints, means
    ints, means = ints24, means24

    # Kontrolné súčty. Ak model prestane držať kotvy, skript spadne tu.
    assert sum(ints) == POCET_SD_2024, f"súčet pásiem {sum(ints)}"
    avg = sum(n * m for n, m in zip(ints, means)) / sum(ints)
    assert abs(avg - PRIEMER_SD_2024) < 3.0, f"priemer pásiem {avg:.2f}"
    nad1000 = sum(n for e, n in zip(edges, ints) if e >= 1000)
    assert abs(nad1000 - NAD_1000_2024) / NAD_1000_2024 < 0.03, f"nad 1000 = {nad1000}"
    nad2000 = sum(n for e, n in zip(edges, ints) if e >= 2000)
    assert abs(nad2000 - NAD_2000_2024) <= 60, f"nad 2000 = {nad2000}"
    pod_min = cdf(MIN_DOCHODOK_2024) * POCET_SD_2024
    assert abs(pod_min - POCET_MIN_2024) / POCET_MIN_2024 < 0.03, f"pod min. = {pod_min:.0f}"
    print(f"pásma dôchodkov: vrchol {M:.0f} EUR, σ vľavo {SL:.0f} / vpravo {SR:.0f}, "
          f"priemer {avg:.2f} EUR, nad 1 000 EUR {nad1000}")

    write_csv("dochodky_pasma.csv",
              ["rok", "pasmo", "od_eur", "pocet", "priemer_eur"], rows)



# Vekové rozdelenie za rovnakých desať rokov ako pásma — animácia
# pyramídy potom má čo ukázať a každý rok má reálnu úroveň.
ROKY_VEKY = ROKY
VEK_MIN, VEK_MAX = 60, 95

# Vlastnosti starobného dôchodcu, ktoré sa môžu kombinovať. Podiel je
# **marginálny**: koľko % dôchodcov danú vlastnosť má, bez ohľadu na ostatné.
# Relatívna výška je dôchodok z SP (nie spolu s cudzím či výsluhovým).
ZNAKY = [
    # (názov, marginálny podiel v r. 2024, relatívna výška dôchodku z SP,
    #  tvar podľa veku, násobok pre mužov a ženy)
    #
    # Tvar je len relatívny — hladina sa dopočíta tak, aby vážený podiel za celú
    # populáciu dôchodcov sedel na uvedený marginálny podiel. Preto sa dá tvar
    # meniť bez toho, aby sa rozsypala kotva.
    #
    # II. pilier beží od 2005: kto v tom čase ešte pracoval, mohol vstúpiť, takže
    # podiel sporiteľov s vekom klesá exponenciálne — nie lineárne do nuly.
    # Sporitelia nad 85 rokov existujú, len ich je málo.
    ("II. pilier", 0.070, 0.935, lambda vek: math.exp(-0.155 * (vek - 62)), (1.05, 0.95)),
    # Kto pracoval pred rokom 1993 v českej časti federácie, má český dôchodok.
    # Skupina je preto silnejšia vo vyšších vekoch a má menej rokov v SP.
    ("cudzina", 0.058, 0.760, lambda vek: max(1.0 + 0.015 * (vek - 68), 0.3), (1.15, 0.87)),
    # Výsluhové roky sa v SP nezhodnocujú → veľmi nízky starobný dôchodok z SP.
    # Vojaci a policajti sú prevažne muži, tu je rozdiel medzi pohlaviami najväčší.
    ("výsluhové", 0.020, 0.545, lambda vek: max(1.0 + 0.006 * (vek - 68), 0.3), (2.60, 0.35)),
]

# Vlastnosti sa prekrývajú, ale kombinácie sú zriedke. Model ich berie ako
# nezávislé — s jednou výnimkou: kto má výsluhový dôchodok, bol väčšinu kariéry
# v osobitnom systéme, takže sporiteľom v II. pilieri je podstatne zriedkavejšie.
# Asociačný faktor < 1 znamená „menej častá kombinácia, než by dala nezávislosť".
ASOCIACIA = {("II. pilier", "výsluhové"): 0.40}

# Osem kategórií, ktoré sa NEPREKRÝVAJÚ a spolu dávajú 100 %. Vstupný súbor
# musí byť takto rozdelený — inak sa počty nedajú sčítať do celku. Marginálne
# skupiny („všetci sporitelia") si web dopočíta transformáciou `expand`.
KATEGORIE_NAZVY = {
    (): "Iba SP",
    ("II. pilier",): "SP + II. pilier",
    ("cudzina",): "SP + cudzina",
    ("výsluhové",): "SP + výsluhové",
    ("II. pilier", "cudzina"): "SP + II. pilier + cudzina",
    ("II. pilier", "výsluhové"): "SP + II. pilier + výsluhové",
    ("cudzina", "výsluhové"): "SP + cudzina + výsluhové",
    ("II. pilier", "cudzina", "výsluhové"): "SP + všetky tri",
}


def znak_shares(pocty: dict, rok: int) -> dict:
    """Marginálny podiel každej vlastnosti pre každé (vek, pohlavie).

    Tvar podľa veku a rozdiel medzi pohlaviami je modelový; hladina je
    kalibrovaná — vážený priemer podielov cez celú populáciu dôchodcov dá presne
    marginálnu kotvu. Bez tejto normalizácie by zmena tvaru ticho posunula aj
    celkový podiel sporiteľov.
    """
    total = sum(pocty.values())
    out: dict[tuple[int, str], dict[str, float]] = {k: {} for k in pocty}
    for nazov, podiel, _rel, shape, (fm, ff) in ZNAKY:
        anchor = podiel
        if nazov == "II. pilier":
            # pred rokom 2024 boli sporitelia medzi dôchodcami vzácnejší
            anchor *= 1.0 - 0.12 * (2024 - rok)
        raw = {k: shape(k[0]) * (fm if k[1] == "Muži" else ff) for k in pocty}
        weighted = sum(raw[k] * pocty[k] for k in pocty) / total
        scale = anchor / weighted if weighted > 0 else 0.0
        for k in pocty:
            out[k][nazov] = min(max(raw[k] * scale, 0.0), 0.60)
    return out


def kombinacie(marginal: dict) -> dict:
    """Z marginálnych podielov urobí podiely ôsmich nepretínajúcich sa kategórií.

    Nezávislosť plus asociačné faktory na vybraných pároch. Výsledok sa
    normalizuje na 1, takže súčet kategórií je vždy presne 100 % — aj keď
    asociácia posunie jednotlivé kombinácie.
    """
    names = [z[0] for z in ZNAKY]
    raw = {}
    for combo in KATEGORIE_NAZVY:
        pr = 1.0
        for n in names:
            pr *= marginal[n] if n in combo else (1.0 - marginal[n])
        for (a, b), f in ASOCIACIA.items():
            if a in combo and b in combo:
                pr *= f
        raw[combo] = pr
    total = sum(raw.values())
    return {c: v / total for c, v in raw.items()}


def gen_starobni_podla_veku() -> None:
    """Počty a priemerné dôchodky podľa veku, pohlavia a kategórie.

    Vekový profil nie je odhad od oka: vychádza z počtu narodených v danom
    ročníku, prežitia tohto ročníka podľa modelu a z krivky priznávania
    dôchodku okolo dôchodkového veku. Výsledok sa preváži tak, aby súčet
    sedel na zverejnený počet starobných dôchodkov (1 134 690 k 31. 12. 2024)
    a vážený priemer na 683,10 EUR.

    Kategórie sú **nepretínajúce sa kombinácie** vlastností (iba SP, SP +
    jedna vlastnosť, SP + dve, SP + všetky tri), takže sa sčítajú presne na
    celok. Vlastnosti sa v skutočnosti prekrývajú a kombinácie sú zriedke —
    dohromady necelé percento dôchodcov. Marginálne skupiny („všetci
    sporitelia", teda aj tí, čo majú aj dôchodok z cudziny) si web dopočíta
    transformáciou `expand`, aby sa nikde nesčítalo dvakrát.
    """
    rows = []
    for rok in ROKY_VEKY:
        # celkový počet dôchodkov v danom roku — 2024 je kotva, staršie roky
        # medziročne mierne nižšie (rada počtov na webe rastie ~0,8 % r/r)
        total_target = float(rok_uroven(rok)[0])
        raw: dict[tuple[int, str], float] = {}
        for sex in ("Muži", "Ženy"):
            key = "muzi" if sex == "Muži" else "zeny"
            vek_doch = interp(DOCH_VEK_MUZI if key == "muzi" else DOCH_VEK_ZENY, rok)
            for vek in range(VEK_MIN, VEK_MAX + 1):
                cohort = rok - vek
                births = interp(NARODENI, cohort) * (0.513 if key == "muzi" else 0.487)
                surv = cohort_survival(cohort, key, max_age=vek)[vek]
                # priznávanie: nula pred dôchodkovým vekom mínus 2 roky (predčasné),
                # plynulý nábeh na 97 % dva roky po dôchodkovom veku
                t = (vek - (vek_doch - 2.0)) / 4.0
                takeup = 0.0 if t <= 0 else (0.97 if t >= 1 else 0.97 * t * t * (3 - 2 * t))
                raw[(vek, sex)] = births * surv * takeup
        scale = total_target / sum(raw.values())
        pocty = {k: v * scale for k, v in raw.items() if v * scale >= 1}
        shares = znak_shares(pocty, rok)

        # priemerný dôchodok podľa veku: staršie ročníky majú nižší dôchodok
        # (valorizácie zaostávajú za rastom novopriznaných), muži vyšší než ženy
        for (vek, sex), v in sorted(raw.items(), key=lambda kv: (kv[0][1], kv[0][0])):
            pocet_vek = v * scale
            if pocet_vek < 1:
                continue
            # Priemerný dôchodok podľa veku má vrchol, nie sklon: najmladší
            # dôchodcovia majú kratšiu odpracovanú dobu alebo krátenie za
            # predčasnosť, najstarší zaostávajú za valorizáciami a mali nižší
            # základ. Priamka by bola nielen nudná, ale aj nesprávna.
            vek_faktor = (1.0 - 0.025 * (66 - vek)) if vek < 66 else (1.0 - 0.010 * (vek - 66))
            sex_faktor = 1.115 if sex == "Muži" else 0.905
            base = PRIEMER_SD_2024 * vek_faktor * sex_faktor

            rel = {z[0]: z[2] for z in ZNAKY}
            for combo, share in kombinacie(shares[(vek, sex)]).items():
                pocet = int(round(pocet_vek * share))
                if pocet <= 0:
                    continue
                # výška dôchodku z SP: každá vlastnosť ju zníži svojím faktorom,
                # kombinácia teda znižuje viac než ktorákoľvek z nich samotná
                faktor = 1.030
                for n in combo:
                    faktor *= rel[n]
                rows.append([rok, vek, sex, KATEGORIE_NAZVY[combo], pocet, r2(base * faktor)])

    # Kalibrácia výšky dôchodku: relatívne rozdiely medzi vekmi, pohlaviami a
    # kategóriami určuje model, ale hladinu určuje kotva — vážený priemer za rok
    # 2024 musí dať 683,10 EUR. Staršie roky sú o valorizáciu nižšie.
    for rok in ROKY_VEKY:
        sub = [r for r in rows if r[0] == rok]
        avg = sum(r[4] * r[5] for r in sub) / sum(r[4] for r in sub)
        target = rok_uroven(rok)[1]
        k = target / avg
        for r in sub:
            r[5] = r2(r[5] * k)

    # Zaokrúhľovanie ôsmich kategórií × 35 vekov × 2 pohlavia stratí niekoľko
    # jednotiek; zvyšok dostane najväčší riadok, aby súčet sedel na kotvu presne.
    for rok in ROKY_VEKY:
        sub = [r for r in rows if r[0] == rok]
        target = rok_uroven(rok)[0]
        biggest = max(sub, key=lambda r: r[4])
        biggest[4] += target - sum(r[4] for r in sub)

    total = sum(r[4] for r in rows if r[0] == 2024)
    assert total == POCET_SD_2024, \
        f"počet starobných dôchodcov 2024 = {total}, kotva {POCET_SD_2024}"
    avg = (sum(r[4] * r[5] for r in rows if r[0] == 2024)
           / sum(r[4] for r in rows if r[0] == 2024))
    assert abs(avg - PRIEMER_SD_2024) < 0.5, \
        f"priemerný dôchodok 2024 = {avg:.2f}, kotva {PRIEMER_SD_2024}"

    # Kombinácie musia byť to, čo hovoríme, že sú: zriedkavé.
    kombi = sum(r[4] for r in rows if r[0] == 2024 and r[3].count("+") > 1)
    assert kombi / total < 0.02, f"kombinácie sú {kombi / total:.1%} z celku, to už nie je minimum"
    print(f"starobní dôchodcovia 2024: {total} spolu, z toho {kombi} "
          f"({kombi / total * 100:.2f} %) v kombinovaných kategóriách")

    write_csv("starobni_podla_veku.csv",
              ["rok", "vek", "pohlavie", "kategoria", "pocet", "priemer_eur"], rows)


def gen_doba_poberania() -> None:
    """Priemerná doba poberania dôchodku za tých, ktorí v danom roku zomreli.

    Počíta sa z toho istého modelu úmrtnosti ako krivky prežitia: pre každý
    ročník sa vezme vek priznania dôchodku (podľa vtedy platného dôchodkového
    veku) a rozloženie úmrtí podľa tabuliek. Z úmrtí, ktoré padnú do daného
    kalendárneho roku, sa spočíta priemer (vek úmrtia − vek priznania).

    Zjednodušenie: každý ročník má rovnakú veľkosť. Doba poberania je pomer,
    takže veľkosť ročníka mení výsledok len málo — a rada je tak čitateľná bez
    ďalších predpokladov o pôrodnosti.
    """
    def vek_priznania(cohort: int, anch: dict) -> float:
        """Vek, v ktorom ročník dosiahol dôchodkový vek. Dôchodkový vek sa mení
        v čase, takže hľadaný vek a rok priznania závisia od seba — tri kolá
        pevného bodu to uzavrú."""
        a = interp(anch, cohort + 62)
        for _ in range(3):
            a = interp(anch, cohort + a)
        return a

    raw = []
    for rok in range(2000, 2025):
        for sex, key, anch in (("Muži", "muzi", DOCH_VEK_MUZI),
                               ("Ženy", "zeny", DOCH_VEK_ZENY)):
            wsum, dur, deaths_total = 0.0, 0.0, 0.0
            for vek in range(50, 101):
                cohort = rok - vek
                surv = cohort_survival(cohort, key, max_age=vek + 1)
                deaths = surv[vek] - surv[vek + 1]     # zomrelí vo veku vek
                doba = vek + 0.5 - vek_priznania(cohort, anch)
                if doba <= 0:
                    continue                            # zomrel pred dôchodkom
                deaths_total += deaths
                dur += deaths * doba
                wsum += deaths
            raw.append([rok, sex, dur / wsum, deaths_total])

    # Počet zomretých dôchodcov je váha priemeru, takže musí byť v súbore.
    # Kotva: v SR zomiera ~53 tis. osôb ročne (2024), z toho drvivá väčšina vo
    # veku nad 65 → odhad 45 500 zomretých starobných dôchodcov za rok 2024.
    # Pomer mužov a žien a vývoj v čase dáva model; rast kopíruje rast počtu
    # dôchodcov (~0,9 % ročne), lebo modelové ročníky sú rovnako veľké.
    base = sum(r[3] for r in raw if r[0] == 2024)
    rows = []
    for rok, sex, doba, deaths in raw:
        pocet = ZOMRETI_SD * (deaths / base) * (1.0 - 0.009 * (2024 - rok))
        rows.append([rok, sex, r2(doba), int(round(pocet))])
    write_csv("doba_poberania.csv",
              ["rok", "pohlavie", "priemer_rokov", "pocet_zomretych"], rows)


# ─────────────────────────────────────────────────────────────────────────────
# 5. Prechody medzi stavmi (rok → rok)
# ─────────────────────────────────────────────────────────────────────────────
#
# Prúdový diagram odpovedá na to, na čo stav neodpovie: nie koľko ich v danom
# stave bolo, ale KTO SA KAM presunul. Dva roky s rovnakým počtom starobných
# dôchodcov môžu vzniknúť tak, že nikto nikam nešiel, alebo tak, že desaťtisíce
# odišli a desaťtisíce prišli.
#
# Stavy, ktoré boli v zadaní, majú tri logické chyby a tie sú tu opravené:
#
#   1. „invalid-sólo" a „invalidný dôchodca - sólo" je ten istý stav. Ostal jeden.
#      (Ak bol zámer rozlíšiť invaliditu do 70 % a nad 70 %, to je iný rozpad a
#      dá sa doplniť — sú to dva riadky v tabuľke.)
#   2. V roku 2025 chýbali pracujúci, PN a neaktívni. Prechodová matica musí mať
#      na oboch stranách ROVNAKÝ stavový priestor, inak diagram tvrdí, že každý,
#      kto v roku 2024 pracoval, je o rok neskôr dôchodca. Väčšina ľudí pritom
#      zostane tam, kde bola.
#   3. „Zomretý" naopak patrí len do cieľového roku — je to absorpčný stav, do
#      ktorého sa vchádza a z ktorého sa nevychádza. Tak to v zadaní bolo a je to
#      správne.
#
# Doplnené sú prechody, ktoré vyplývajú zo zákona a bez nich by diagram nedával
# zmysel:
#   • predčasný starobný → starobný pri dovŕšení dôchodkového veku (automaticky),
#   • invalidný → starobný pri dovŕšení dôchodkového veku,
#   • vdovský sólo → starobný + vdovský (poberateľke sa prizná vlastný dôchodok),
#   • X + vdovský → X sólo, keď po roku bez podmienok nárok na vdovský zanikne,
#   • PN → invalidný sólo, čo je hlavná cesta k invalidnému dôchodku.
# A prechody, ktoré NEEXISTUJÚ, tu nie sú vôbec: starobný → invalidný (po
# dôchodkovom veku sa invalidný dôchodok nepriznáva) ani starobný → predčasný.
#
# Populácia: všetci poberatelia dôchodku zo SP (bez ohľadu na vek) + osoby 55+
# bez dôchodku. Preto je tu „Nový vstup" — kto dovŕšil 55 alebo dostal dôchodok
# pred 55. rokom. Bez neho by matica nemohla byť vyrovnaná.

STAV_PRAC = "Pracujúci"
STAV_PN = "PN (nemocenské)"
STAV_NEAKT = "Neaktívny"
STAV_INV = "Invalidný sólo"
STAV_PRED = "Predčasný sólo"
STAV_STAR = "Starobný sólo"
STAV_VDOV = "Vdovský sólo"
STAV_STAR_V = "Starobný + vdovský"
STAV_PRED_V = "Predčasný + vdovský"
STAV_INV_V = "Invalidný + vdovský"
STAV_VSTUP = "Nový vstup"
STAV_ZOM = "Zomretí"

# Podiel poberateľov vdovského/vdoveckého, ktorí ho majú SÓLO — zverejnené za
# 2024: 24 354 z 289 000 vdovských a 5 333 z 54 352 vdoveckých.
SOLO_VDOVSKY = 24_354 / 289_000
SOLO_VDOVECKY = 5_333 / 54_352

# Ako sa poberatelia vdovského v kombinácii delia podľa vlastného dôchodku.
# Modelový odhad: vdovy a vdovci sú prevažne v starobnom veku.
KOMBI_SPLIT = {STAV_STAR_V: 0.92, STAV_INV_V: 0.07, STAV_PRED_V: 0.01}

# Osoby 55+ bez dôchodku — rádové odhady (ŠÚ SR: zamestnanosť 55–64 okolo 62 %,
# populácia 55–64 okolo 700 tis.). Modelové, nie zverejnené.
BEZ_DOCHODKU_2024 = {STAV_PRAC: 470_000, STAV_PN: 24_000, STAV_NEAKT: 250_000}
BEZ_DOCHODKU_TREND = {STAV_PRAC: 1.015, STAV_PN: 1.0, STAV_NEAKT: 0.99}

# Ročné pravdepodobnosti prechodu. Presné nie sú a byť nemôžu — slúžia ako
# východiskový vzor, ktorý sa dofituje na reálne stavy oboch rokov (IPF nižšie).
# Relatívne veľkosti sú to podstatné a každá je odôvodnená v komentári.
PRECHODY = {
    STAV_PRAC: {STAV_PRAC: 0.86, STAV_PN: 0.02, STAV_NEAKT: 0.03,
                STAV_PRED: 0.015, STAV_STAR: 0.06, STAV_VDOV: 0.008, STAV_ZOM: 0.007},
    # Dlhá PN je hlavná cesta k invalidnému dôchodku.
    STAV_PN: {STAV_PRAC: 0.55, STAV_PN: 0.15, STAV_NEAKT: 0.09, STAV_INV: 0.10,
              STAV_STAR: 0.07, STAV_PRED: 0.02, STAV_VDOV: 0.005, STAV_ZOM: 0.015},
    STAV_NEAKT: {STAV_NEAKT: 0.72, STAV_PRAC: 0.10, STAV_PRED: 0.05, STAV_STAR: 0.09,
                 STAV_INV: 0.02, STAV_VDOV: 0.01, STAV_ZOM: 0.01},
    # Invalidný dôchodok sa pri dovŕšení dôchodkového veku mení na starobný.
    STAV_INV: {STAV_INV: 0.90, STAV_STAR: 0.065, STAV_INV_V: 0.008,
               STAV_PRAC: 0.005, STAV_ZOM: 0.022},
    # Predčasný sa na starobný preklopí automaticky — preto stav predčasných
    # medziročne padol o 8 436, hoci nových predčasných pribudlo.
    STAV_PRED: {STAV_PRED: 0.62, STAV_STAR: 0.35, STAV_PRED_V: 0.006, STAV_ZOM: 0.024},
    # Zo starobného sa už nikam neodchádza, len ovdovie alebo zomrie.
    STAV_STAR: {STAV_STAR: 0.955, STAV_STAR_V: 0.011, STAV_ZOM: 0.034},
    # Vdovský sólo je najčastejšie prechodný stav: buď sa prizná vlastný
    # dôchodok, alebo po roku bez podmienok nárok zanikne.
    STAV_VDOV: {STAV_VDOV: 0.70, STAV_STAR_V: 0.20, STAV_PRED_V: 0.03,
                STAV_INV_V: 0.01, STAV_NEAKT: 0.04, STAV_ZOM: 0.02},
    STAV_STAR_V: {STAV_STAR_V: 0.93, STAV_STAR: 0.035, STAV_ZOM: 0.035},
    STAV_PRED_V: {STAV_PRED_V: 0.60, STAV_STAR_V: 0.35, STAV_PRED: 0.02, STAV_ZOM: 0.03},
    STAV_INV_V: {STAV_INV_V: 0.90, STAV_STAR_V: 0.06, STAV_INV: 0.015, STAV_ZOM: 0.025},
    # Kto dovŕšil 55 alebo dostal dôchodok pred 55. rokom.
    STAV_VSTUP: {STAV_PRAC: 0.55, STAV_NEAKT: 0.22, STAV_PN: 0.02, STAV_INV: 0.14,
                 STAV_VDOV: 0.05, STAV_STAR: 0.01, STAV_PRED: 0.01},
}

# Poradie stavov v diagrame — zhora dolu, bez dôchodku najvyššie.
STAV_ORDER = [STAV_PRAC, STAV_PN, STAV_NEAKT, STAV_VSTUP,
              STAV_PRED, STAV_PRED_V, STAV_STAR, STAV_STAR_V,
              STAV_INV, STAV_INV_V, STAV_VDOV, STAV_ZOM]


def _stavy_roku(rok: int) -> dict:
    """Stavy dôchodkových skupín za daný rok z reálnych mesačných rád."""
    star = real_december("sp_pocty_mesacne.csv", "Starobný", "pocet")[rok]
    pred = real_december("sp_pocty_mesacne.csv", "Predčasný starobný", "pocet")[rok]
    inv = real_december("sp_pocty_mesacne.csv", "Invalidný", "pocet")[rok]
    vdov = real_december("sp_pocty_mesacne.csv", "Vdovský", "pocet")[rok]
    vdovec = real_december("sp_pocty_mesacne.csv", "Vdovecký", "pocet")[rok]

    solo_pozost = vdov * SOLO_VDOVSKY + vdovec * SOLO_VDOVECKY
    kombi = (vdov + vdovec) - solo_pozost
    out = {STAV_VDOV: solo_pozost}
    for stav, share in KOMBI_SPLIT.items():
        out[stav] = kombi * share
    # Vlastný dôchodok mínus tí, ktorí k nemu majú aj vdovský.
    out[STAV_STAR] = star - out[STAV_STAR_V]
    out[STAV_PRED] = pred - out[STAV_PRED_V]
    out[STAV_INV] = inv - out[STAV_INV_V]
    return out


def gen_prechody() -> None:
    """Matica prechodov 2024 → 2025, dofitovaná na reálne stavy oboch rokov.

    Riadkové súčty musia dať stav roku 2024, stĺpcové stav roku 2025 (aj s
    úmrtiami). Také zadanie rieši **iteratívne proporčné prispôsobenie** (IPF):
    začne sa modelovými pravdepodobnosťami a striedavo sa škálujú riadky a
    stĺpce, kým nesedia oba okraje. Výsledok je matica, ktorej OKRAJE sú reálne
    čísla Sociálnej poisťovne a len jej vnútro je model — presne tak, ako pri
    ostatných syntetických súboroch tohto projektu.
    """
    ROK_OD, ROK_DO = 2024, 2025
    stav_od = _stavy_roku(ROK_OD)
    stav_do = _stavy_roku(ROK_DO)
    for s, v in BEZ_DOCHODKU_2024.items():
        stav_od[s] = float(v)
        stav_do[s] = v * BEZ_DOCHODKU_TREND[s]
    stav_do[STAV_ZOM] = float(ZOMRETI_SD)

    # „Nový vstup" dorovnáva bilanciu: koľko muselo pribudnúť, aby sa stav 2024
    # plus prírastok rovnal stavu 2025 plus úmrtia.
    vstup = sum(stav_do.values()) - sum(stav_od.values())
    if vstup <= 0:
        raise SystemExit(f"gen_vstup: nový vstup vyšiel {vstup:.0f} — bilancia nesedí")
    stav_od[STAV_VSTUP] = vstup

    rows_keys = [s for s in STAV_ORDER if s in stav_od]
    cols_keys = [s for s in STAV_ORDER if s in stav_do]
    m = {r: {c: (PRECHODY.get(r, {}).get(c, 0.0) * stav_od[r]) for c in cols_keys}
         for r in rows_keys}

    for _ in range(200):
        for r in rows_keys:                     # riadky na stav 2024
            tot = sum(m[r].values())
            if tot > 0:
                k = stav_od[r] / tot
                for c in cols_keys:
                    m[r][c] *= k
        for c in cols_keys:                     # stĺpce na stav 2025
            tot = sum(m[r][c] for r in rows_keys)
            if tot > 0:
                k = stav_do[c] / tot
                for r in rows_keys:
                    m[r][c] *= k

    rows = []
    for r in rows_keys:
        for c in cols_keys:
            v = int(round(m[r][c]))
            if v <= 0:
                continue
            rows.append([ROK_OD, r, ROK_DO, c, v])

    # Kontrola okrajov: čo nesedí na reálny stav, je chyba modelu, nie dáta.
    for r in rows_keys:
        got = sum(x[4] for x in rows if x[1] == r)
        if stav_od[r] > 100 and abs(got - stav_od[r]) / stav_od[r] > 0.02:
            raise SystemExit(f"prechody: riadok {r} dáva {got}, stav 2024 je {stav_od[r]:.0f}")
    for c in cols_keys:
        got = sum(x[4] for x in rows if x[3] == c)
        if stav_do[c] > 100 and abs(got - stav_do[c]) / stav_do[c] > 0.02:
            raise SystemExit(f"prechody: stĺpec {c} dáva {got}, stav 2025 je {stav_do[c]:.0f}")

    zostali = sum(x[4] for x in rows if x[1] == x[3])
    print(f"prechody 2024→2025: {len(rows)} prúdov, {sum(x[4] for x in rows)} osôb, "
          f"z toho {zostali} ({zostali / sum(x[4] for x in rows) * 100:.1f} %) zostalo "
          f"v tom istom stave")
    write_csv("prechody_stavov.csv",
              ["rok_od", "stav_od", "rok_do", "stav_do", "pocet"], rows)


def _months(first: str, last: str) -> list[str]:
    y0, m0 = (int(v) for v in first.split("-"))
    y1, m1 = (int(v) for v in last.split("-"))
    out = []
    y, m = y0, m0
    while (y, m) <= (y1, m1):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def gen_pilier2() -> None:
    """II. pilier: čistá hodnota aktív a počet sporiteľov, mesačne.

    Koncoročné stavy sú zverejnené kotvy (ADSS/MPSVR/NBS). Medzi nimi sa
    interpoluje geometricky — teda hladko, bez vymyslenej mesačnej volatility.
    Rovná krivka je v tomto prípade poctivejšia než vlnky, ktoré by vyzerali
    ako trhový pohyb, hoci žiadny meraný nie je. Pokles v roku 2022 je
    zverejnený medziročný pokles majetku, nie artefakt modelu.
    """
    a_keys = sorted(PILIER2_AKTIVA)
    s_keys = sorted(PILIER2_SPORITELIA)

    def idx(mon: str) -> float:
        y, m = (int(v) for v in mon.split("-"))
        return y * 12 + (m - 1)

    def geo(keys: list[str], data: dict, mon: str) -> float:
        x = idx(mon)
        xs = [idx(k) for k in keys]
        if x <= xs[0]:
            return float(data[keys[0]])
        if x >= xs[-1]:
            return float(data[keys[-1]])
        i = bisect_right(xs, x) - 1
        t = (x - xs[i]) / (xs[i + 1] - xs[i])
        y0, y1 = data[keys[i]], data[keys[i + 1]]
        return float(y0 * (y1 / y0) ** t)

    rows = []
    for mon in _months("2013-12", "2026-06"):
        rows.append([mon, r2(geo(a_keys, PILIER2_AKTIVA, mon)),
                     int(round(geo(s_keys, PILIER2_SPORITELIA, mon)))])
    write_csv("pilier2.csv",
              ["mesiac", "aktiva_mil_eur", "pocet_sporitelov"], rows)


# ─────────────────────────────────────────────────────────────────────────────

def main() -> int:
    print(f"model úmrtnosti: b3 = {B3:.5f}  (kotva e65 2023 = {E65_2023} r.)")
    for year in (1970, 2000, 2023):
        q, l = table(year, "spolu")
        print(f"  {year}: e0 = {ex(l, 0):.2f}   e65 = {ex(l, 65):.2f}   "
              f"q0 = {q[0] * 1000:.1f} ‰")

    gen_prezitie_kohort()
    gen_nadej_dozitia()
    gen_dochodky_pasma()
    gen_starobni_podla_veku()
    gen_doba_poberania()
    gen_pilier2()
    gen_prechody()

    print("\nvstupné súbory:")
    for name, n in WRITTEN:
        print(f"  data/vstup/{name}  —  {n} riadkov  (syntetické)")
    for name in KEPT:
        print(f"  data/vstup/{name}  —  reálne dáta, negenerujem")

    if CHECK and STALE:
        print("\nNeaktuálne súbory (spusť `npm run vstup:gen`):", file=sys.stderr)
        for name in STALE:
            print(f"  data/vstup/{name}", file=sys.stderr)
        return 1
    print("\nHotovo." if not CHECK else "\nVšetky súbory sú aktuálne.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
