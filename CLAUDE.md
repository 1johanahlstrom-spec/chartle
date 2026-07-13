# Chartle — utvecklarnoteringar

Dagligt chart-pussel (Wordle för trading). Statisk webbapp med ett litet
egenhostat Python/SQLite-API för leaderboarden. Full beskrivning i README.md.

## Arkitektur i korthet

- `pipeline/` — Python-skript som körs EN gång lokalt för att generera pussel.
  Kräver `rawdata.pkl` (skapas av `fetch_data.py`, gitignorerad). Determinism:
  seed 42, samma rådata → samma 1825 pussel.
- `docs/` — webbklienten (vanilla JS + Plotly via CDN, ingen byggkedja).
- `server/` — leaderboard-API med Pythons standardbibliotek och SQLite.
- `compose.yaml` + `Caddyfile` — egenhostad drift på localhost:8137; Tailscale
  Funnel publicerar porten med HTTPS på Funnel-port 10000.
- Epoch: 2026-07-05 = Chartle #1. Runda r på dag d laddar
  `puzzles/{(d*5 + r) % 1825}.json`. Ändra ALDRIG epoch eller pusselordningen
  efter lansering — då får spelare om-numrerade/upprepade pussel.

## Regler och fällor

- **Deploy**: egen Ubuntu-server via `compose.yaml`. Caddy serverar `docs/` och
  proxar `/api/*` på `127.0.0.1:8137`; Tailscale Funnel sköter publik HTTPS.
- **Priser i pussel-JSON är normaliserade**: sista synliga close = 100.
  All poänglogik (R-multiplar, stops) i `app.js` bygger på det.
- **MA10/MA20 räknas klientsidan** i `app.js` (`sma()`), inte i pusseldatan.
  Måste beräknas på `puzzle.c.slice(0, n)` — aldrig hela serien — annars läcker
  medelvärdet framtida candles under de 10 utspelningsdagarna. Första
  (period-1) punkterna är `null` så Plotly inte ritar en ofullständig linje.
- **Facit är base64-kodat** i `meta`-fältet — medveten lätt obfuskering,
  ingen säkerhet.
- **localStorage-schema** versioneras med `state.v` (nu 2). Bumpa versionen
  och skriv migrering i `loadState`-blocket om schemat ändras.
- **Avnoterade tickers**: yfinance tappar historik när bolag avnoteras
  (WBA → ersatt med KHC, SQ → XYZ). Kör om `fetch_data.py` med ersättare om
  fler försvinner.
- **Dataspann 1962–2024**: yfinance har daglig OHLC från **1962-01-02** för
  klassiska blue chips — allt äldre (30/40/50-tal) finns bara i betalkällor.
  85 tickers, varav de långlivade (kategorierna `classic` + `techclassic`)
  bidrar med vintage-chart. Moderna tickers returnerar automatiskt bara sin
  nutida historik.
- **INGET absolut prisgolv i urvalet**: priser är split/utdelningsjusterade,
  så gamla blue chips landar på ören (IBM 1962 ≈ $1.44). Det gamla
  `entry < 2`-filtret hade raderat hela 60-talet. Ersatt av era-oberoende
  likviditetsfilter i `build_puzzles.py` (`MIN_LEVELS` distinkta prisnivåer +
  `MAX_FLAT` platta candles) som fångar både gammalt illikvitt och moderna
  penny-stocks (CELH, SPCE). `MAX_PER_YEAR` sprider urvalet över decennierna.
- Repo-ägare: `1johanahlstrom-spec`, sajt:
  https://1johanahlstrom-spec.github.io/chartle/

## Vanliga kommandon

```bash
cd docs && python3 -m http.server 8137   # kör lokalt
# övningsläge: http://localhost:8137/?p=42 (rör inte streak/poäng)
```

Leaderboard: API:t använder `/data/chartle.db` i den persistenta Docker-volymen
`chartle_data`. `docs/config.js` styr om leaderboarden är aktiv och använder
same-origin `/api` i normal serverdrift.
