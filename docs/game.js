// Ren spellogik utan DOM- eller nätverksberoenden.
// Laddas som vanligt <script> av index.html och som modul av tests/test_game.js
// — så att exakt samma kod testas som körs i webbläsaren.
(function (root) {
  "use strict";

  const EPOCH_DAYS = Math.floor(Date.UTC(2026, 6, 5) / 86400000);  // 2026-07-05 = Chartle #1
  const ROUNDS = 5;
  const TOTAL_PUZZLES = 1825;                       // 5 pussel/dag × 365 dagar
  const DAYS_OF_CONTENT = TOTAL_PUZZLES / ROUNDS;   // 365 dagar innan pusslen börjar om
  const ENTRY = 100;                                // normaliserat: sista synliga close = 100

  // Dygnet bryts vid midnatt i Europe/Stockholm — ALDRIG i enhetens lokala tid.
  // Annars får spelare i olika tidszoner olika pussel samma dag, och
  // leaderboardens "idag" blandar ihop kalenderdygn.
  function stockholmDayIndex(at) {
    const parts = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Stockholm",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(at || new Date());
    const get = (type) => Number(parts.find((p) => p.type === type).value);
    const days = Math.floor(Date.UTC(get("year"), get("month") - 1, get("day")) / 86400000);
    return days - EPOCH_DAYS;
  }

  // Modulo som alltid landar i 0..TOTAL_PUZZLES-1, även för negativa tal
  // (felställd klocka före epoken) och skräp (?p=abc → NaN).
  function puzzleFileIndex(raw) {
    if (!Number.isFinite(raw)) return 0;
    return ((Math.trunc(raw) % TOTAL_PUZZLES) + TOTAL_PUZZLES) % TOTAL_PUZZLES;
  }

  // Glidande medelvärde (SMA) på close. Måste matas med de redan visade
  // candlesen — aldrig hela serien — annars läcker framtida data. De första
  // (period-1) punkterna blir null → Plotly ritar ingen ofullständig linje.
  function sma(closes, period) {
    const out = [];
    let sum = 0;
    for (let i = 0; i < closes.length; i++) {
      sum += closes[i];
      if (i >= period) sum -= closes[i - period];
      out.push(i >= period - 1 ? sum / period : null);
    }
    return out;
  }

  // R-multipel. Long: stop under entry. Gap förbi stoppen fylls på open, så
  // sämre än -1R kan hända — precis som på riktigt. Ingen stop träffad → exit
  // på sista utfallsdagens close. R = resultat / risk.
  function computeR(puzzle, choice, stopPct) {
    if (choice === "pass") return { r: 0, stopped: false };
    const risk = stopPct;
    const stopLevel = choice === "long" ? ENTRY - risk : ENTRY + risk;

    for (let i = puzzle.visible; i < puzzle.o.length; i++) {
      if (choice === "long" && puzzle.o[i] <= stopLevel)
        return { r: (puzzle.o[i] - ENTRY) / risk, stopped: true };
      if (choice === "long" && puzzle.l[i] <= stopLevel)
        return { r: -1, stopped: true };
      if (choice === "short" && puzzle.o[i] >= stopLevel)
        return { r: (ENTRY - puzzle.o[i]) / risk, stopped: true };
      if (choice === "short" && puzzle.h[i] >= stopLevel)
        return { r: -1, stopped: true };
    }
    const finalClose = puzzle.c[puzzle.c.length - 1];
    const r = choice === "long" ? (finalClose - ENTRY) / risk : (ENTRY - finalClose) / risk;
    return { r, stopped: false };
  }

  const api = {
    EPOCH_DAYS, ROUNDS, TOTAL_PUZZLES, DAYS_OF_CONTENT, ENTRY,
    stockholmDayIndex, puzzleFileIndex, sma, computeR,
  };

  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ChartleGame = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
