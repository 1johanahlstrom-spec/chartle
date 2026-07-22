# 📊 Chartle — dagens chart-pussel

Alla spelare får samma anonymiserade historiska dagscharts (ticker och datum dolda).
Du ser 60 candlesticks med **10- och 20-dagars glidande medelvärde** (MA10/MA20),
väljer **Long / Short / Avstå** (+ valfri stop-nivå), och charten spelas fram
10 dagar. Poäng = R-multipel av utfallet.
Charterna spänner **1962–2024** — allt från 70-talets björnmarknad och Black
Monday 1987 till dot-com och 2020-talet.
**5 rundor per dag**, samma för alla, delbart resultat à la Wordle
(`Chartle #12 🟩🟥⬜🟩🟩 +4.2R`) och leaderboard med dagstopp + totalställning.

## Struktur

```
pipeline/           Python-skript som körs EN gång lokalt
  fetch_data.py     Steg 1: hämtar dagsdata 1962–2024 för 85 tickers (yfinance)
  build_puzzles.py  Steg 2–4: väljer 1825 fönster, normaliserar, skriver JSON
  repair_splits.py  Lagar pussel där yfinance missat en split
docs/                Hela spelets webbklient
  index.html
  style.css
  game.js           Ren spellogik (dygnsgräns, pusselval, SMA, R) — testad
  app.js            DOM, chart, spelflöde, leaderboard
  config.js
  vendor/           Plotly, självhostad (inget CDN)
  puzzles/          1825 st JSON-filer (~2,4 kB styck, ~4,3 MB totalt)
server/              Litet leaderboard-API (Python + SQLite)
tests/               node --test för spellogiken, unittest för API och pusseldata
compose.yaml         Webb, API, databasvolym och lokal Caddy
Caddyfile            Serverkonfiguration
```

## Tester

```bash
./tests/run.sh
```

Spellogiken körs under fyra tidszoner — det är själva poängen med testerna av
dygnsgränsen. `tests/test_puzzles.py` kontrollerar dessutom alla 1825 byggda
JSON-filer, bland annat att ingen ojusterad split ligger kvar i datan.

Browsertestet ingår inte i `run.sh` (det drar ner en egen Chromium):

```bash
docker compose up -d
npm install puppeteer
node tests/test_e2e.js
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
- **Dygnet bryts vid midnatt i Europe/Stockholm**, inte i enhetens lokala tid.
  Annars skulle spelare i olika tidszoner få olika pussel samma dag och
  leaderboardens "idag" blanda ihop kalenderdygn. Servern räknar dagen på
  samma sätt och avvisar inskick för dagar som inte inträffat än.
- **Innehållet räcker 365 dagar.** Från 2027-07-05 börjar pusslen om från
  början i samma ordning, och spelet visar en notis om det. Bygg ut i god tid.
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

## Leaderboard

Leaderboarden körs på den egna servern via API:t i `server/app.py`. Resultaten
lagras i SQLite i Docker-volymen `chartle_data`; inga externa databastjänster
eller API-nycklar behövs.

Spelare identifieras med ett anonymt UUID i localStorage + valfritt namn.
Poäng skickas in en gång per dag efter femte rundan.

**Leaderboarden är inte fusksäker.** Servern ser aldrig ett pussel — den tar
emot ett tal. Det finns spärrar mot de billiga attackerna (poängtak ±40R,
dagen måste ha inträffat, 10 inskick per timme och IP, ett resultat per spelare
och dag), men den som vill fuska kan fortfarande göra det. Riktig fusksäkerhet
kräver att servern håller facit och räknar poängen — se "Senare".

## Köra hela Chartle med Docker och Tailscale Funnel

Servern kör Chartle på en port som bara kan nås lokalt. Tailscale Funnel ger
sedan en publik HTTPS-adress utan routerändringar eller eget domännamn.

Starta Chartle:

```bash
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:8137/api/health
```

Publicera den på Tailscales lediga Funnel-port 10000:

```bash
tailscale funnel --bg --https=10000 http://127.0.0.1:8137
tailscale funnel status
```

Den publika adressen blir
`https://serverjohan.tail8248b9.ts.net:10000/`. Tailscale avslutar HTTPS och
skickar trafiken till den lokala Caddy-containern. Befintliga Tailscale Serve-
regler och Pi-hole på port 80/443 påverkas inte.

Stoppa den publika tunneln med:

```bash
tailscale funnel --https=10000 off
```

### Uppdatera

```bash
git pull
docker compose up -d --build
```

### Backup av databasen

SQLite använder WAL-läge. Gör en konsistent backup med SQLite inifrån
API-containern:

```bash
docker compose exec api python -c 'import sqlite3; s=sqlite3.connect("/data/chartle.db"); d=sqlite3.connect("/data/backup.db"); s.backup(d); d.close(); s.close()'
docker compose cp api:/data/backup.db ./chartle-backup.db
```

Volymen `chartle_data` är den enda kopian av allas resultat — automatisera det
med en cron-rad på servern:

```cron
15 4 * * * cd /sokvag/till/chartle && docker compose exec -T api python -c 'import sqlite3; s=sqlite3.connect("/data/chartle.db"); d=sqlite3.connect("/data/backup.db"); s.backup(d); d.close(); s.close()' && docker compose cp api:/data/backup.db /sokvag/till/backup/chartle-$(date +\%F).db
```

### Ingen cron för datan

Pusslen är förbyggda och statiska: `fetch_data.py` och `build_puzzles.py` körs
en gång lokalt, aldrig på servern. Det finns alltså ingen daglig hämtning att
schemalägga — backupen ovan är det enda återkommande jobbet. Kör *inte*
`build_puzzles.py` mot ett publicerat pusselset; det numrerar om alla pussel
(skriptet vägrar utan `CHARTLE_ALLOW_REBUILD=1`).

GitHub Pages-flödet är borttaget eftersom den kompletta appen nu publiceras från
den egna servern. `docs/` kan fortfarande köras fristående för lokal utveckling,
men leaderboarden kräver Docker-miljön eller ett separat startat API.

## Senare

Konton, handplockade EP/HTF/PS-setups från trade-databasen,
Play Store via TWA (samma kedja som Ritmova).
