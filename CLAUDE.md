# Chartle — utvecklarnoteringar

Dagligt chart-pussel (Wordle för trading). Statisk webbapp utan backend för
själva spelet; valfri Supabase-leaderboard. Full beskrivning i README.md.

## Arkitektur i korthet

- `pipeline/` — Python-skript som körs EN gång lokalt för att generera pussel.
  Kräver `rawdata.pkl` (skapas av `fetch_data.py`, gitignorerad). Determinism:
  seed 42, samma rådata → samma 1825 pussel.
- `docs/` — hela sajten (vanilla JS + Plotly via CDN, ingen byggkedja).
  Mappen heter `docs/` för att GitHub Pages kräver rot eller `/docs`.
- Epoch: 2026-07-05 = Chartle #1. Runda r på dag d laddar
  `puzzles/{(d*5 + r) % 1825}.json`. Ändra ALDRIG epoch eller pusselordningen
  efter lansering — då får spelare om-numrerade/upprepade pussel.

## Regler och fällor

- **Deploy**: GitHub Pages med `build_type=workflow`
  (`.github/workflows/pages.yml`). Byt inte till branch-deploy — Jekyll-kedjan
  hänger sig på ~1800 filer. `docs/.nojekyll` ska också ligga kvar.
- **Priser i pussel-JSON är normaliserade**: sista synliga close = 100.
  All poänglogik (R-multiplar, stops) i `app.js` bygger på det.
- **Facit är base64-kodat** i `meta`-fältet — medveten lätt obfuskering,
  ingen säkerhet.
- **localStorage-schema** versioneras med `state.v` (nu 2). Bumpa versionen
  och skriv migrering i `loadState`-blocket om schemat ändras.
- **Avnoterade tickers**: yfinance tappar historik när bolag avnoteras
  (WBA → ersatt med KHC, SQ → XYZ). Kör om `fetch_data.py` med ersättare om
  fler försvinner.
- Repo-ägare: `1johanahlstrom-spec`, sajt:
  https://1johanahlstrom-spec.github.io/chartle/

## Vanliga kommandon

```bash
cd docs && python3 -m http.server 8137   # kör lokalt
# övningsläge: http://localhost:8137/?p=42 (rör inte streak/poäng)
```

Leaderboard: aktiveras genom att fylla i `docs/config.js` (Supabase-URL +
anon-nyckel) och köra `leaderboard.sql` i Supabase SQL Editor. Tom config =
leaderboard-UI:t visar "inte igång ännu".
