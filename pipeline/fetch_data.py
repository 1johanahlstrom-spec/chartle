"""Steg 1: Hämta historisk dagsdata (OHLCV) för alla tickers och spara lokalt.

Körs en gång. Resultatet sparas som rawdata.pkl så att build_puzzles.py
kan jobba offline utan att ladda ner igen.

Spannet är 1962-2024: Yahoo/yfinance har daglig OHLC från 1962-01-02 för de
klassiska blue-chipsen (allt äldre finns bara i betalkällor). Moderna tickers
(NVDA, PLTR ...) returnerar automatiskt bara sin nutida historik — de gamla
bolagen bidrar med 60/70/80/90-talschart, vilket är hela poängen.
"""

import sys

import pandas as pd
import yfinance as yf

# --- Moderna tickers (2015-2024-eran), samma som ursprungssetet ---------------
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

# --- Vintage: långlivade stora US-bolag med daglig data 1962-2014 -------------
# Old-economy blue chips (industri, konsument, energi, finans, hälsa).
classic = ["IBM", "GE", "XOM", "CVX", "DIS", "MRK", "CAT", "GD", "HON",
           "MO", "DE", "DD", "EMR", "PFE", "AXP", "BAC", "WFC", "TGT",
           "GIS", "HSY", "ABT", "LOW", "HD", "COST", "NKE", "AMGN",
           "UNH", "JPM", "C"]

# Tech med både 90-talets mani och dot-com-kraschen i historiken.
techclassic = ["MSFT", "AAPL", "ORCL", "CSCO", "QCOM", "TXN"]

CATEGORIES = {
    "momentum": momentum,
    "parabolic": parabolic,
    "boring": boring,
    "decliners": decliners,
    "classic": classic,
    "techclassic": techclassic,
}

tickers = momentum + parabolic + boring + decliners + classic + techclassic
print(f"Antal tickers: {len(tickers)}")

data = yf.download(tickers, start="1962-01-01", end="2024-12-31",
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
