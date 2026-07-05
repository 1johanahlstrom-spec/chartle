# 📊 Chartle — dagens chart-pussel

Alla spelare får samma anonymiserade historiska dagschart (ticker och datum dolda).
Du ser 60 candlesticks, väljer **Long / Short / Avstå** (+ valfri stop-nivå),
och charten spelas fram 10 dagar. Poäng = R-multipel av utfallet.
Ett pussel per dag, delbart resultat à la Wordle.

## Struktur

```
pipeline/           Python-skript som byggs körs EN gång lokalt
  fetch_data.py     Steg 1: hämtar dagsdata 2015–2024 för 50 tickers (yfinance)
  build_puzzles.py  Steg 2–4: väljer 365 fönster, normaliserar, skriver JSON
docs/                Hela spelet — statiska filer, ingen backend
  index.html
  style.css
  app.js
  puzzles/          365 st JSON-filer (~2,4 kB styck, 875 kB totalt)
```

## Köra lokalt

```bash
cd docs
python3 -m http.server 8137
# öppna http://localhost:8137
```

Övningsläge (påverkar inte streak): `http://localhost:8137/?p=42` laddar pussel 42.

## Bygga om pusslen

```bash
python3 -m venv venv
./venv/bin/pip install -r pipeline/requirements.txt
cd pipeline
../venv/bin/python fetch_data.py      # laddar ner rådata → rawdata.pkl
../venv/bin/python build_puzzles.py   # skriver 365 JSON till docs/puzzles/
```

Deterministiskt: samma rådata ger alltid samma 365 pussel (seed 42).
Fördelning: 150 long / 90 short / 125 avstå (neutral).

## Hur det funkar

- **Dagens pussel**: `dayIndex = dagar sedan 2026-07-05` (epoch = Chartle #1),
  fil = `puzzles/{dayIndex % 365}.json`. Samma för alla, ingen server behövs.
- **Anonymisering**: priser indexeras så sista synliga close = 100, volym så
  högsta synliga volym = 100. Inga datum på axlarna. Facit (ticker, datum,
  kategori) ligger base64-kodat i JSON:en — lätt obfuskering, som Wordle.
- **Poäng**: R = resultat / risk. Stop på 2/5/8 % under (long) eller över
  (short) entry. Gap förbi stoppen fylls på open (sämre än -1R kan alltså hända,
  precis som på riktigt). Ingen stop träffad → exit på dag 10:s close.
  Avstå = 0R.
- **Streak**: lagras i localStorage. R ≥ 0 (även Avstå) förlänger streaken,
  förlust eller missad dag nollar den.

## Publicera

Allt i `docs/` är statiskt — pusha till GitHub Pages eller dra mappen till
Netlify. Inga API-nycklar, inga driftskostnader.

## Senare (inte MVP)

Konton, leaderboard, flera pussel per dag, handplockade EP/HTF/PS-setups från
trade-databasen, Play Store via TWA (samma kedja som Ritmova).
