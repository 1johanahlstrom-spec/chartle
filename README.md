# 📊 Chartle — dagens chart-pussel

Alla spelare får samma anonymiserade historiska dagscharts (ticker och datum dolda).
Du ser 60 candlesticks, väljer **Long / Short / Avstå** (+ valfri stop-nivå),
och charten spelas fram 10 dagar. Poäng = R-multipel av utfallet.
**5 rundor per dag**, samma för alla, delbart resultat à la Wordle
(`Chartle #12 🟩🟥⬜🟩🟩 +4.2R`) och leaderboard med dagstopp + totalställning.

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

Deterministiskt: samma rådata ger alltid samma 1825 pussel (seed 42).
Fördelning: 750 long / 450 short / 625 avstå (neutral) = 5 pussel/dag i 365 dagar.

## Hur det funkar

- **Dagens pussel**: `dayIndex = dagar sedan 2026-07-05` (epoch = Chartle #1),
  runda r laddar `puzzles/{(dayIndex*5 + r) % 1825}.json`. Samma för alla,
  ingen server behövs för själva spelet.
- **Anonymisering**: priser indexeras så sista synliga close = 100, volym så
  högsta synliga volym = 100. Inga datum på axlarna. Facit (ticker, datum,
  kategori) ligger base64-kodat i JSON:en — lätt obfuskering, som Wordle.
- **Poäng**: R = resultat / risk. Stop på 2/5/8 % under (long) eller över
  (short) entry. Gap förbi stoppen fylls på open (sämre än -1R kan alltså hända,
  precis som på riktigt). Ingen stop träffad → exit på dag 10:s close.
  Avstå = 0R.
- **Poäng & streak**: lagras i localStorage. Dagens poäng = summan av de fem
  rundornas R. Dag med totalt R ≥ 0 förlänger streaken, förlust eller missad
  dag nollar den. Σ i headern är ackumulerad R över alla spelade dagar.

## Leaderboard (Supabase)

Leaderboarden är avstängd tills `docs/config.js` fylls i. Så här sätter du
igång den (gratis, ~5 minuter):

1. Skapa konto på [supabase.com](https://supabase.com) och skapa ett projekt
   (valfritt namn, gratis-planen räcker).
2. Öppna **SQL Editor** → New query, klistra in innehållet i `leaderboard.sql`
   och kör det. Det skapar tabellen `scores` (insert-only via RLS) och vyn
   `leaderboard_total`.
3. Gå till **Settings → API** och kopiera *Project URL* och *anon public*-nyckeln
   till `docs/config.js`. Anon-nyckeln är publik per design — skyddet ligger i
   RLS-policyerna.
4. Committa och pusha. Klart.

Spelare identifieras med ett anonymt UUID i localStorage + valfritt namn.
Poäng skickas in en gång per dag efter femte rundan.

## Publicera

Sajten deployas till GitHub Pages via GitHub Actions
(`.github/workflows/pages.yml`): varje push till `main` laddar upp `docs/`
som Pages-artefakt och deployar — klart på under en minut.

Obs: den klassiska Jekyll-baserade Pages-kedjan (deploy from branch) klarade
inte repots ~1800 pusselfiler — bygget fastnade/felade. Därför är Pages
konfigurerat med `build_type=workflow`. Ändra inte tillbaka till
branch-deploy i repo-inställningarna.

## Senare

Konton, handplockade EP/HTF/PS-setups från trade-databasen,
Play Store via TWA (samma kedja som Ritmova).
