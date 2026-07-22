"""Steg 2-4: Bygg 1825 pussel från rawdata.pkl och skriv dem som JSON till docs/puzzles/.

Varje pussel = 70 handelsdagar: 60 synliga candles + 10 dagars utfall.
Priser normaliseras så att sista synliga close (entry) = 100.
Volym normaliseras så att högsta synliga volym = 100.
Facit (ticker, datum, kategori) base64-kodas i "meta" — lätt obfuskering, som Wordle.

Deterministiskt: samma indata ger alltid samma 1825 pussel (seed 42). Notera att
"samma indata" betyder samma rawdata.pkl — ny rådata ger en ny ordning. Skriptet
vägrar därför skriva över ett befintligt pusselset utan CHARTLE_ALLOW_REBUILD=1.
"""

import base64
import json
import os
import random
import shutil
import sys
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent      # skriptet ska gå att köra var ifrån som helst
ROOT = HERE.parent

VISIBLE = 60          # candles spelaren ser
OUTCOME = 10          # dagar som spelas fram
WINDOW = VISIBLE + OUTCOME
STRIDE = 10           # testa nytt kandidatfönster var 10:e dag
MIN_GAP = 25          # min avstånd mellan valda fönster i samma ticker
MAX_PER_TICKER = 45
MAX_FLAT = 0.25       # max andel platta candles (high==low) i synligt fönster
MIN_LEVELS = 25       # min distinkta prisnivåer i synligt fönster (likviditet)
MAX_GAP_DAYS = 10     # max kalenderdagar mellan två handelsdagar (helger + helgdag)
# Tak per (label, år): hindrar att ett enda kraschår (1973, 1987, 2000, 2020)
# äter hela budgeten så att urvalet sprids över alla decennier 1962-2024.
MAX_PER_YEAR = {"long": 40, "short": 30, "neutral": 40}
TARGETS = {"long": 750, "short": 450, "neutral": 625}  # 1825 = 5 pussel/dag i 365 dagar

outdir = ROOT / "docs" / "puzzles"

# Att bygga om numrerar om ALLA pussel: shuffle(seed=42) är bara deterministisk
# givet exakt samma kandidatlista, och den beror på rawdata.pkl. Ny rådata ger
# ny ordning → spelare får om-numrerade och upprepade pussel, och epoken i
# docs/app.js pekar fel. Därför krävs ett uttryckligt medgivande.
existing = sorted(outdir.glob("*.json")) if outdir.exists() else []
if existing and os.environ.get("CHARTLE_ALLOW_REBUILD") != "1":
    sys.exit(
        f"AVBRYTER: {len(existing)} pussel finns redan i {outdir}.\n"
        "En ombyggnad numrerar om alla pussel och bryter epoken för spelare\n"
        "som redan börjat. Tagga nuvarande set först (git tag puzzles-v1) och\n"
        "kör sedan om med CHARTLE_ALLOW_REBUILD=1 om du verkligen menar det."
    )

data = pd.read_pickle(HERE / "rawdata.pkl")
categories = pd.read_pickle(HERE / "categories.pkl")
ticker_cat = {t: cat for cat, ts in categories.items() for t in ts}
tickers = sorted(ticker_cat)

candidates = []
for ticker in tickers:
    df = data[ticker].dropna(how="all")
    df = df[["Open", "High", "Low", "Close", "Volume"]].dropna()
    dates = df.index
    o, h, l, c, v = (df[col].to_numpy() for col in ["Open", "High", "Low", "Close", "Volume"])

    for i in range(0, len(df) - WINDOW, STRIDE):
        vis_h, vis_l = h[i:i + VISIBLE], l[i:i + VISIBLE]
        entry = c[i + VISIBLE - 1]
        final = c[i + WINDOW - 1]
        # Era-oberoende likviditetsfilter: priser är justerade (gamla blue chips
        # landar på ören efter split/utdelning), så inget absolut prisgolv. Vi
        # filtrerar istället bort trasig/steppig/illikvid data — platta candles,
        # nollvolym och för få distinkta prisnivåer (fångar både gamla illikvida
        # blue chips och moderna penny-stocks som CELH/SPCE).
        flat_frac = (vis_h == vis_l).mean()
        levels = len({round(float(x) / entry * 100, 2) for x in c[i:i + VISIBLE]})
        if (min(l[i:i + WINDOW]) <= 0 or v[i:i + VISIBLE].max() == 0
                or flat_frac > MAX_FLAT or levels < MIN_LEVELS):
            continue
        # Kräv sammanhängande handel: inga stora datumhål (halter/dålig data).
        # Både total spännvidd och största enskilda glapp kollas — annars
        # passerar ett fönster med tre veckors handelsstopp mitt i.
        span = (dates[i + WINDOW - 1] - dates[i]).days
        if span > WINDOW * 2.2:
            continue
        gaps = dates[i + 1:i + WINDOW] - dates[i:i + WINDOW - 1]
        if gaps.max().days > MAX_GAP_DAYS:
            continue

        fwd_ret = final / entry - 1
        vis_ret = c[i + VISIBLE - 1] / c[i] - 1
        rng = vis_h.max() - vis_l.min()
        range_pos = (entry - vis_l.min()) / rng if rng > 0 else 0.5

        if fwd_ret >= 0.05:
            label = "long"
            # Belöna setups där charten redan visar styrka (EP/HTF-känsla)
            quality = fwd_ret + 0.5 * max(0, vis_ret) + 0.3 * range_pos
        elif fwd_ret <= -0.05:
            label = "short"
            # Belöna parabolic run-ups som toppar, eller tydliga breakdowns
            quality = -fwd_ret + 0.5 * max(0, vis_ret) + 0.3 * (1 - range_pos)
        elif abs(fwd_ret) < 0.025:
            label = "neutral"
            # Föredra lugna charts där Avstå känns som ett ärligt svar
            daily_moves = pd.Series(c[i:i + VISIBLE]).pct_change().abs().mean()
            quality = -daily_moves
        else:
            continue  # 2.5-5%: för tvetydigt, hoppa över

        candidates.append({
            "ticker": ticker, "i": i, "label": label, "quality": quality,
            "year": dates[i + VISIBLE - 1].year,
            "start": str(dates[i].date()),
            "decision": str(dates[i + VISIBLE - 1].date()),
            "end": str(dates[i + WINDOW - 1].date()),
            "fwd_ret": round(fwd_ret * 100, 1),
            "entry_price": round(float(entry), 2),
        })

print(f"Kandidater totalt: {len(candidates)}")
for lbl in TARGETS:
    print(f"  {lbl}: {sum(1 for x in candidates if x['label'] == lbl)}")

# Greedy-urval: bäst kvalitet först, med tak per ticker, tak per år (decennie-
# spridning) och inget fönsteröverlapp inom samma ticker.
chosen = []
per_ticker = {t: [] for t in tickers}
for lbl, target in TARGETS.items():
    pool = sorted((x for x in candidates if x["label"] == lbl),
                  key=lambda x: -x["quality"])
    per_year = {}
    count = 0
    for cand in pool:
        if count >= target:
            break
        used = per_ticker[cand["ticker"]]
        if len(used) >= MAX_PER_TICKER:
            continue
        if per_year.get(cand["year"], 0) >= MAX_PER_YEAR[lbl]:
            continue
        if any(abs(cand["i"] - j) < MIN_GAP for j in used):
            continue
        used.append(cand["i"])
        per_year[cand["year"]] = per_year.get(cand["year"], 0) + 1
        chosen.append(cand)
        count += 1
    print(f"Valda {lbl}: {count}/{target}")

assert len(chosen) == sum(TARGETS.values()), f"Bara {len(chosen)} pussel!"

# Deterministisk blandning så att svarstyperna inte klumpar sig i kalendern
random.Random(42).shuffle(chosen)

# Skriv till en staging-katalog och byt in den först när ALLT lyckats. Att
# radera docs/puzzles/ innan skrivningen skulle lämna en halvtom katalog som
# Caddy serverar direkt om loopen kraschar.
staging = outdir.parent / "puzzles.new"
shutil.rmtree(staging, ignore_errors=True)
staging.mkdir(parents=True)

for idx, cand in enumerate(chosen):
    ticker, i = cand["ticker"], cand["i"]
    df = data[ticker].dropna(how="all")
    df = df[["Open", "High", "Low", "Close", "Volume"]].dropna()
    w = df.iloc[i:i + WINDOW]
    entry = float(w["Close"].iloc[VISIBLE - 1])
    vmax = float(w["Volume"].iloc[:VISIBLE].max())

    def norm(col):
        return [round(float(x) / entry * 100, 2) for x in w[col]]

    meta = {
        "ticker": ticker,
        "category": ticker_cat[ticker],
        "start": cand["start"],
        "decision": cand["decision"],
        "end": cand["end"],
        "entryPrice": cand["entry_price"],
        "fwdRetPct": cand["fwd_ret"],
        "answer": cand["label"],
    }
    puzzle = {
        "id": idx,
        "visible": VISIBLE,
        "o": norm("Open"), "h": norm("High"), "l": norm("Low"), "c": norm("Close"),
        "v": [round(float(x) / vmax * 100, 2) for x in w["Volume"]],
        "meta": base64.b64encode(json.dumps(meta).encode()).decode(),
    }
    (staging / f"{idx}.json").write_text(json.dumps(puzzle, separators=(",", ":")))

# Allt skrevs utan fel — byt in det nya settet i ett steg.
shutil.rmtree(outdir, ignore_errors=True)
staging.rename(outdir)

sizes = sum(f.stat().st_size for f in outdir.glob("*.json"))
print(f"\nSkrev {len(chosen)} pussel till {outdir} ({sizes // 1024} KB totalt)")
