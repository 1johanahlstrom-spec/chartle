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

  // Tak per runda. R har annars ingen gräns åt något håll — nämnaren är
  // stoppavståndet, så ett 2 %-stopp på GME-squeezen 2021-02-23 ger +224.5R
  // och ett gap ned genom stoppen kan ge -31.2R. En enda sådan runda var värd
  // 20 vanliga speldagar på totallistan.
  //
  // Symmetriskt med flit: att bara kapa uppsidan hade gjort spelet brutalt
  // negativt. Räknat över alla pussel × riktning × stop ligger 3.1 % över
  // +10R och 0.19 % under -10R — capen klipper alltså svansen, inte spelet.
  // Realistiskt också: ingen sitter kvar hela vägen upp i en squeeze.
  const MAX_R = 10;

  function capR(r) {
    return Math.max(-MAX_R, Math.min(MAX_R, r));
  }

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

  // Validera hela kontraktet innan data når Plotly eller poänglogiken. Filerna
  // är statiska, men en ofullständig deploy ska ge ett begripligt laddfel i
  // stället för en krasch flera funktionsanrop senare.
  function validatePuzzle(puzzle) {
    if (!puzzle || typeof puzzle !== "object") throw new Error("Pusslet är inte ett objekt");
    if (!Number.isInteger(puzzle.visible) || puzzle.visible < 1)
      throw new Error("Pusslet har ogiltigt visible");
    const fields = ["o", "h", "l", "c", "v"];
    const length = Array.isArray(puzzle.o) ? puzzle.o.length : 0;
    if (length <= puzzle.visible) throw new Error("Pusslet saknar utfallsdagar");
    for (const field of fields) {
      const values = puzzle[field];
      if (!Array.isArray(values) || values.length !== length ||
          values.some((value) => !Number.isFinite(value)))
        throw new Error(`Pusslet har ogiltigt fält: ${field}`);
    }
    for (let i = 0; i < length; i++) {
      if (puzzle.l[i] <= 0 || puzzle.v[i] < 0 || puzzle.l[i] > puzzle.h[i] ||
          puzzle.o[i] < puzzle.l[i] || puzzle.o[i] > puzzle.h[i] ||
          puzzle.c[i] < puzzle.l[i] || puzzle.c[i] > puzzle.h[i])
        throw new Error(`Pusslet har ogiltig candle: ${i}`);
    }
    if (typeof puzzle.meta !== "string" || !puzzle.meta)
      throw new Error("Pusslet saknar meta");
    return puzzle;
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
    if (!["long", "short", "pass"].includes(choice)) throw new Error("Ogiltigt val");
    if (!Number.isFinite(stopPct) || stopPct <= 0) throw new Error("Ogiltig stop-nivå");
    if (choice === "pass") return { r: 0, stopped: false };
    const risk = stopPct;
    const stopLevel = choice === "long" ? ENTRY - risk : ENTRY + risk;

    for (let i = puzzle.visible; i < puzzle.o.length; i++) {
      if (choice === "long" && puzzle.o[i] <= stopLevel)
        return { r: capR((puzzle.o[i] - ENTRY) / risk), stopped: true };
      if (choice === "long" && puzzle.l[i] <= stopLevel)
        return { r: -1, stopped: true };
      if (choice === "short" && puzzle.o[i] >= stopLevel)
        return { r: capR((ENTRY - puzzle.o[i]) / risk), stopped: true };
      if (choice === "short" && puzzle.h[i] >= stopLevel)
        return { r: -1, stopped: true };
    }
    const finalClose = puzzle.c[puzzle.c.length - 1];
    const r = choice === "long" ? (finalClose - ENTRY) / risk : (ENTRY - finalClose) / risk;
    return { r: capR(r), stopped: false };
  }

  // --- Statistik ---------------------------------------------------------
  // Aggregeras EN gång per avslutad dag och lagras separat från state.days.
  // Det är hela poängen: pruneDays behåller bara de 30 senaste dagarna, så
  // statistik som räknas om ur state.days skulle krympa bakåt över tid.
  function emptyStats() {
    return {
      days: 0,            // avslutade dagar (alla ROUNDS rundor spelade)
      positiveDays: 0,    // dagar med total R >= 0, samma tröskel som streaken
      sumR: 0,            // summan av de dagar som räknats in här
      bestDay: null,      // null = ingen dag spelad än, till skillnad från 0R
      maxStreak: 0,
      choices: {
        long: { n: 0, wins: 0, sumR: 0 },
        short: { n: 0, wins: 0, sumR: 0 },
        pass: { n: 0, wins: 0, sumR: 0 },
      },
    };
  }

  // sumR hålls skild från state.totalR med flit. totalR är livstidssumman och
  // överlever pruneDays; sumR täcker exakt de dagar som ligger i stats. För en
  // spelare som migrerar från v2 skiljer de sig — då är sumR/days rätt snitt
  // och totalR/days fel, eftersom bortstädade dagar finns i den ena men inte
  // den andra.
  function recordDay(stats, rounds, streak) {
    const total = rounds.reduce((sum, round) => sum + round.r, 0);
    stats.days += 1;
    stats.sumR = Math.round((stats.sumR + total) * 100) / 100;
    if (total >= 0) stats.positiveDays += 1;
    if (stats.bestDay === null || total > stats.bestDay) stats.bestDay = total;
    stats.maxStreak = Math.max(stats.maxStreak, streak || 0);

    for (const round of rounds) {
      const choice = stats.choices[round.choice];
      if (!choice) continue;                     // okänt val i gammal data
      choice.n += 1;
      choice.sumR = Math.round((choice.sumR + round.r) * 100) / 100;
      if (round.r > 0) choice.wins += 1;
    }
    return stats;
  }

  // Migrering v2 → v3: bygg upp statistiken ur de dagar som råkar finnas kvar.
  // Ofullständig för den som spelat mer än KEEP_DAYS dagar — det är accepterat,
  // alternativet är att börja på noll för alla befintliga spelare.
  function statsFromDays(days, roundsPerDay) {
    const stats = emptyStats();
    const keys = Object.keys(days || {}).map(Number).sort((a, b) => a - b);
    for (const key of keys) {
      const day = days[key];
      if (day && Array.isArray(day.rounds) && day.rounds.length >= roundsPerDay) {
        recordDay(stats, day.rounds, 0);
      }
    }
    return stats;
  }

  // Härledda tal för statistikpanelen. Håller divisionerna på ett ställe så att
  // 0 spelade dagar aldrig blir NaN i UI:t.
  function statsSummary(stats) {
    const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);
    const summary = {
      days: stats.days,
      positiveDays: stats.positiveDays,
      positivePct: pct(stats.positiveDays, stats.days),
      avgR: stats.days ? stats.sumR / stats.days : 0,
      bestDay: stats.bestDay,
      maxStreak: stats.maxStreak,
      choices: {},
    };
    for (const [name, choice] of Object.entries(stats.choices)) {
      summary.choices[name] = {
        n: choice.n,
        winPct: pct(choice.wins, choice.n),
        avgR: choice.n ? choice.sumR / choice.n : 0,
      };
    }
    return summary;
  }

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  // localStorage är extern indata. En avbruten äldre migrering, ett tillägg eller
  // manuell redigering ska inte kunna göra hela appen oanvändbar vid uppstart.
  function sanitizeStoredState(raw) {
    if (!isObject(raw)) return {};
    const state = { ...raw };
    if (!isObject(state.days)) state.days = {};
    else {
      state.days = Object.fromEntries(Object.entries(state.days).filter(([, day]) =>
        isObject(day) && Array.isArray(day.rounds) && day.rounds.every((round) =>
          isObject(round) && ["long", "short", "pass"].includes(round.choice) &&
          Number.isFinite(round.r))));
    }
    if (!Number.isFinite(state.totalR)) state.totalR = 0;
    if (!Number.isInteger(state.streak) || state.streak < 0) state.streak = 0;
    const validChoice = (choice) => isObject(choice) &&
      [choice.n, choice.wins, choice.sumR].every(Number.isFinite);
    const validStats = isObject(state.stats) && isObject(state.stats.choices) &&
      [state.stats.days, state.stats.positiveDays, state.stats.sumR, state.stats.maxStreak]
        .every(Number.isFinite) &&
      ["long", "short", "pass"].every((name) => validChoice(state.stats.choices[name]));
    if (state.stats !== undefined && !validStats) delete state.stats;
    return state;
  }

  const api = {
    EPOCH_DAYS, ROUNDS, TOTAL_PUZZLES, DAYS_OF_CONTENT, ENTRY, MAX_R,
    stockholmDayIndex, puzzleFileIndex, validatePuzzle, sma, computeR,
    emptyStats, recordDay, statsFromDays, statsSummary, sanitizeStoredState,
  };

  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ChartleGame = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
