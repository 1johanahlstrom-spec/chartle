"""Steg 1: Hämta historisk dagsdata (OHLCV) för alla tickers och spara lokalt.

Körs en gång. Resultatet sparas som rawdata.pkl så att build_puzzles.py
kan jobba offline utan att ladda ner igen.
"""

import sys

import pandas as pd
import yfinance as yf

momentum = ["NVDA", "SMCI", "MU", "AMD", "TSLA",
            "PLTR", "GME", "AMC", "CELH", "ELF",
            "ANF", "CVNA", "APP", "NFLX", "META",
            "SHOP", "ROKU", "ENPH", "XYZ", "COIN"]  # XYZ = f.d. SQ (Block)

parabolic = ["UPST", "AI", "MARA", "RIOT", "BYND",
             "PTON", "ZM", "DOCU", "TDOC", "SPCE"]

boring = ["KO", "PG", "JNJ", "WMT", "PEP",
          "MCD", "VZ", "T", "SO", "DUK", "KMB", "CL"]

decliners = ["KHC", "PYPL", "INTC", "BA",  # KHC ersätter WBA (avnoterad 2025)
             "F", "VFC", "MMM", "LUMN"]

CATEGORIES = {
    "momentum": momentum,
    "parabolic": parabolic,
    "boring": boring,
    "decliners": decliners,
}

tickers = momentum + parabolic + boring + decliners
print(f"Antal tickers: {len(tickers)}")

data = yf.download(tickers, start="2015-01-01", end="2024-12-31",
                   group_by="ticker", auto_adjust=True, threads=True)

if data.empty:
    print("FEL: ingen data hämtades alls.")
    sys.exit(1)

# Kontrollera vilka tickers som faktiskt fick data
ok, failed = [], []
for t in tickers:
    if t in data.columns.get_level_values(0):
        df = data[t].dropna(how="all")
        if len(df) > 100:
            ok.append(t)
            continue
    failed.append(t)

print(f"OK: {len(ok)} tickers")
if failed:
    print(f"MISSLYCKADES: {failed}")

data.to_pickle("rawdata.pkl")
pd.to_pickle(CATEGORIES, "categories.pkl")
print("Klart! Sparat till rawdata.pkl")
