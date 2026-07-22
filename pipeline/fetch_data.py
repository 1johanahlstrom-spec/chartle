"""Steg 1: Hämta historisk dagsdata (OHLCV) för alla tickers och spara lokalt.

Körs en gång. Resultatet sparas som rawdata.pkl så att build_puzzles.py
kan jobba offline utan att ladda ner igen.

Spannet är 1962-2024: Yahoo/yfinance har daglig OHLC från 1962-01-02 för de
klassiska blue-chipsen (allt äldre finns bara i betalkällor). Moderna tickers
(NVDA, PLTR ...) returnerar automatiskt bara sin nutida historik — de gamla
bolagen bidrar med 60/70/80/90-talschart, vilket är hela poängen.
"""

import sys
from pathlib import Path

import pandas as pd
import yfinance as yf

HERE = Path(__file__).resolve().parent      # skriptet ska gå att köra var ifrån som helst
MIN_OK_FRACTION = 0.9                       # andel tickers som måste ge data

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

# auto_adjust=True justerar OHLC för både split och utdelning. Det är
# avgörande: utan det ser varje split ut som en krasch mitt i charten.
try:
    data = yf.download(tickers, start="1962-01-01", end="2024-12-31",
                       group_by="ticker", auto_adjust=True, threads=True)
except Exception as error:                  # nätverksfel, API-ändringar, rate limit
    sys.exit(f"AVBRYTER: nedladdningen misslyckades ({error}). Befintlig data är orörd.")

if data.empty:
    sys.exit("AVBRYTER: ingen data hämtades alls. Befintlig data är orörd.")

# Kontrollera vilka tickers som faktiskt fick data
ok, failed = [], []
for t in tickers:
    if t in data.columns.get_level_values(0):
        df = data[t].dropna(how="all")
        if len(df) > 100:
            ok.append(t)
            continue
    failed.append(t)

print(f"OK: {len(ok)}/{len(tickers)} tickers")
if failed:
    print(f"MISSLYCKADES: {failed}")

# Skriv ALDRIG över en fungerande rawdata.pkl med ett stympat dataset. Filen är
# gitignorerad, så det finns ingen kopia att gå tillbaka till.
min_ok = int(len(tickers) * MIN_OK_FRACTION)
if len(ok) < min_ok:
    sys.exit(
        f"AVBRYTER: bara {len(ok)} av {len(tickers)} tickers gav data "
        f"(kräver minst {min_ok}). rawdata.pkl lämnas orörd.\n"
        "Är fler bolag avnoterade? Byt ut dem i listorna ovan och kör om."
    )

# Spara bara det som faktiskt har data — annars kraschar build_puzzles.py med
# KeyError på en ticker som saknas i rådatan.
data = data[ok]
categories_ok = {cat: [t for t in ts if t in ok] for cat, ts in CATEGORIES.items()}

# Atomär skrivning: en krasch mitt i lämnar den gamla filen intakt.
for frame, name in ((data, "rawdata.pkl"), (categories_ok, "categories.pkl")):
    tmp = HERE / f"{name}.tmp"
    pd.to_pickle(frame, tmp)
    tmp.replace(HERE / name)

print(f"Klart! Sparat {len(ok)} tickers till {HERE / 'rawdata.pkl'}")
