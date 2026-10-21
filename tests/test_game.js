// Tester för spellogiken i docs/game.js.  Körs med:  node --test tests/
const test = require("node:test");
const assert = require("node:assert");

const game = require("../docs/game.js");
const { ROUNDS, TOTAL_PUZZLES, DAYS_OF_CONTENT } = game;

// Bygger ett pussel med 60 synliga candles på entry 100 och angivna utfallsdagar.
function makePuzzle(outcome) {
  const flat = (v) => Array(60).fill(v);
  const p = { visible: 60, o: flat(100), h: flat(100), l: flat(100), c: flat(100) };
  for (const day of outcome) {
    p.o.push(day.o); p.h.push(day.h); p.l.push(day.l); p.c.push(day.c);
  }
  return p;
}

// --- 1. Dygnsgränsen -----------------------------------------------------------
// Dessa värden är absoluta: de gäller oavsett vilken tidszon maskinen står i.
// Kör därför hela sviten under flera TZ (se tests/run.sh) — det är körningen
// under t.ex. TZ=Pacific/Auckland som faktiskt bevisar att lokal tid ignoreras.
test("dygnsgränsen följer svensk tid, inte maskinens", () => {
  // 22:30Z den 22 juli = 00:30 den 23 juli i Stockholm (sommartid, UTC+2).
  assert.strictEqual(game.stockholmDayIndex(new Date("2026-07-22T22:30:00Z")), 18);
  // 12:00Z samma dygn är fortfarande den 22 juli i Stockholm.
  assert.strictEqual(game.stockholmDayIndex(new Date("2026-07-22T12:00:00Z")), 17);
  // 23:00Z den 22 juli är redan den 23:e i Auckland — men inte hos oss.
  assert.strictEqual(game.stockholmDayIndex(new Date("2026-07-22T21:00:00Z")), 17);
});

test("vintertid: gränsen flyttar till 23:00Z", () => {
  // 2026-01-15 är normaltid i Sverige (UTC+1).
  const before = game.stockholmDayIndex(new Date("2026-01-15T22:59:59Z"));
  const after = game.stockholmDayIndex(new Date("2026-01-15T23:00:01Z"));
  assert.strictEqual(after - before, 1);
});

test("dagindex ökar med precis 1 över svensk midnatt", () => {
  // 2026-07-22 är sommartid i Sverige (UTC+2), så midnatt = 21:59:59Z / 22:00:01Z.
  const before = game.stockholmDayIndex(new Date("2026-07-22T21:59:59Z"));
  const after = game.stockholmDayIndex(new Date("2026-07-22T22:00:01Z"));
  assert.strictEqual(after - before, 1);
});

test("epokdagen är dagindex 0 och Chartle #1", () => {
  assert.strictEqual(game.stockholmDayIndex(new Date("2026-07-05T10:00:00Z")), 0);
});

// --- 2. Pusselordningen --------------------------------------------------------
test("ett år täcker varje pussel exakt en gång, utan hopp eller dubletter", () => {
  const seen = [];
  for (let d = 0; d < DAYS_OF_CONTENT; d++) {
    for (let r = 0; r < ROUNDS; r++) seen.push(game.puzzleFileIndex(d * ROUNDS + r));
  }
  assert.strictEqual(seen.length, TOTAL_PUZZLES);
  assert.strictEqual(new Set(seen).size, TOTAL_PUZZLES);
});

test("dag 365 börjar om från pussel 0 (dokumenterad årsvarvning)", () => {
  const day365 = [0, 1, 2, 3, 4].map((r) => game.puzzleFileIndex(DAYS_OF_CONTENT * ROUNDS + r));
  assert.deepStrictEqual(day365, [0, 1, 2, 3, 4]);
});

test("skräpindex ger alltid ett giltigt pussel, aldrig NaN", () => {
  for (const raw of [NaN, Infinity, -Infinity, undefined, -5, -1, 99999, 1.7]) {
    const idx = game.puzzleFileIndex(raw);
    assert.ok(Number.isInteger(idx) && idx >= 0 && idx < TOTAL_PUZZLES,
      `puzzleFileIndex(${raw}) gav ${idx}`);
  }
});

test("pussel-URL:en är versionsstämplad så cachen kan invalideras", () => {
  // Caddy cachar /puzzles/* som immutable och service workern cache-first.
  // Utan versionsparameter skulle en lagad pusselfil aldrig nå installerade
  // klienter, hur många deployer som helst.
  assert.match(String(game.PUZZLE_VERSION), /^\d+$/);
  assert.strictEqual(game.puzzleUrl(0), `puzzles/0.json?v=${game.PUZZLE_VERSION}`);
  // Samma modulo-skydd som puzzleFileIndex: skräp och årsvarvning.
  assert.strictEqual(game.puzzleUrl(TOTAL_PUZZLES), `puzzles/0.json?v=${game.PUZZLE_VERSION}`);
  assert.strictEqual(game.puzzleUrl(NaN), `puzzles/0.json?v=${game.PUZZLE_VERSION}`);
});

test("pusselkontraktet validerar alla serier och candles", () => {
  const valid = makePuzzle([{ o: 101, h: 103, l: 99, c: 102 }]);
  valid.v = Array(valid.o.length).fill(10);
  valid.meta = "e30=";
  assert.strictEqual(game.validatePuzzle(valid), valid);

  for (const mutate of [
    (p) => { p.h.pop(); },
    (p) => { p.v[0] = -1; },
    (p) => { p.l[0] = 101; },
    (p) => { p.c[0] = NaN; },
    (p) => { p.meta = ""; },
  ]) {
    const broken = structuredClone(valid);
    mutate(broken);
    assert.throws(() => game.validatePuzzle(broken));
  }
});

// --- 3. Rättning: gap, exakta träffar och exit -----------------------------------
test("gap förbi stoppen fylls på open — sämre än -1R", () => {
  // Stop 5 % → stopnivå 95. Dagen öppnar på 90, alltså (90-100)/5 = -2R.
  const p = makePuzzle([{ o: 90, h: 92, l: 88, c: 91 }]);
  const res = game.computeR(p, "long", 5);
  assert.strictEqual(res.r, -2);
  assert.strictEqual(res.stopped, true);
});

test("gap uppåt för short fylls på open", () => {
  const p = makePuzzle([{ o: 110, h: 112, l: 109, c: 111 }]);
  const res = game.computeR(p, "short", 5);
  assert.strictEqual(res.r, -2);
  assert.strictEqual(res.stopped, true);
});

test("stop träffad intraday ger exakt -1R", () => {
  const p = makePuzzle([{ o: 99, h: 99, l: 95, c: 97 }]);
  const res = game.computeR(p, "long", 5);
  assert.strictEqual(res.r, -1);
  assert.strictEqual(res.stopped, true);
});

test("ingen stop träffad → exit på sista utfallsdagens close", () => {
  const p = makePuzzle([
    { o: 101, h: 103, l: 100, c: 102 },
    { o: 102, h: 108, l: 101, c: 107 },
  ]);
  const res = game.computeR(p, "long", 5);
  assert.strictEqual(res.r, (107 - 100) / 5);
  assert.strictEqual(res.stopped, false);
});

test("R kapas vid +10R — en squeeze får inte äga totallistan", () => {
  // 2 %-stop, close på 549 = +449 %: okappat (549-100)/2 = +224.5R.
  const p = makePuzzle([{ o: 500, h: 560, l: 480, c: 549 }]);
  const res = game.computeR(p, "long", 2);
  assert.strictEqual(res.r, game.MAX_R);
  assert.strictEqual(res.stopped, false);
});

test("capen är symmetrisk — gap ned kapas vid -10R", () => {
  // Utan cap: (40-100)/2 = -30R. Att bara kapa uppsidan hade gjort spelet
  // brutalt negativt, eftersom gap förbi stoppen är vanligare än squeezes.
  const p = makePuzzle([{ o: 40, h: 45, l: 38, c: 42 }]);
  const res = game.computeR(p, "long", 2);
  assert.strictEqual(res.r, -game.MAX_R);
  assert.strictEqual(res.stopped, true);
});

test("capen rör inte vanliga utfall", () => {
  // Normalspelet ska vara oförändrat: bara 3.1 % av alla kombinationer i
  // pusseldatan ligger över +10R.
  const p = makePuzzle([{ o: 101, h: 112, l: 100, c: 110 }]);
  assert.strictEqual(game.computeR(p, "long", 5).r, 2);
  assert.strictEqual(game.computeR(p, "short", 5).r, -1);
});

test("avstå ger alltid 0R", () => {
  const p = makePuzzle([{ o: 50, h: 50, l: 50, c: 50 }]);
  assert.deepStrictEqual(game.computeR(p, "pass", 5), { r: 0, stopped: false });
});

test("ogiltigt val och stop avvisas innan poäng räknas", () => {
  const p = makePuzzle([{ o: 100, h: 101, l: 99, c: 100 }]);
  assert.throws(() => game.computeR(p, "buy", 5), /Ogiltigt val/);
  for (const stop of [0, -1, NaN, Infinity]) {
    assert.throws(() => game.computeR(p, "long", stop), /Ogiltig stop-nivå/);
  }
});

// --- 4. Statistik ------------------------------------------------------------------
// Bygger en avslutad dag av R-värden. Val väljs efter tecknet så att
// riktningsstatistiken går att kontrollera.
function makeDay(values) {
  return values.map((r) => ({ choice: r === 0 ? "pass" : r > 0 ? "long" : "short", r }));
}

test("recordDay summerar dagar, bästa dag och maxstreak", () => {
  const stats = game.emptyStats();
  game.recordDay(stats, makeDay([1, 2, 0]), 1);      // total +3
  game.recordDay(stats, makeDay([-1, -2, 0]), 0);    // total -3
  game.recordDay(stats, makeDay([4, 0, 0]), 1);      // total +4

  assert.strictEqual(stats.days, 3);
  assert.strictEqual(stats.positiveDays, 2);
  assert.strictEqual(stats.sumR, 4);
  assert.strictEqual(stats.bestDay, 4);
  assert.strictEqual(stats.maxStreak, 1);
});

test("en dag på exakt 0R räknas som positiv — samma tröskel som streaken", () => {
  const stats = game.emptyStats();
  game.recordDay(stats, makeDay([1, -1]), 1);
  assert.strictEqual(stats.positiveDays, 1);
  assert.strictEqual(stats.bestDay, 0);              // 0, inte null
});

test("riktningsstatistiken räknar träffar och snitt per val", () => {
  const stats = game.emptyStats();
  game.recordDay(stats, makeDay([2, -1, 0, 4, 0]), 1);
  const summary = game.statsSummary(stats);

  assert.strictEqual(summary.choices.long.n, 2);     // +2 och +4
  assert.strictEqual(summary.choices.long.winPct, 100);
  assert.strictEqual(summary.choices.long.avgR, 3);
  assert.strictEqual(summary.choices.short.n, 1);    // -1, ingen träff
  assert.strictEqual(summary.choices.short.winPct, 0);
  assert.strictEqual(summary.choices.pass.n, 2);
});

test("statsSummary ger nollor och inga NaN utan spelade dagar", () => {
  const summary = game.statsSummary(game.emptyStats());
  assert.strictEqual(summary.days, 0);
  assert.strictEqual(summary.positivePct, 0);
  assert.strictEqual(summary.avgR, 0);
  assert.strictEqual(summary.bestDay, null);
  for (const name of ["long", "short", "pass"]) {
    assert.strictEqual(summary.choices[name].avgR, 0, name);
    assert.strictEqual(summary.choices[name].winPct, 0, name);
  }
});

test("migrering från v2 räknar bara dagar som spelats klart", () => {
  const days = {
    5: { rounds: makeDay([1, 1, 1, 1, 1]) },         // klar → +5R
    6: { rounds: makeDay([2, -1, 0]) },              // avbruten mitt i dagen
    7: { rounds: makeDay([-1, -1, -1, -1, -1]) },    // klar → -5R
  };
  const stats = game.statsFromDays(days, ROUNDS);
  assert.strictEqual(stats.days, 2);
  assert.strictEqual(stats.sumR, 0);
  assert.strictEqual(stats.bestDay, 5);
  assert.strictEqual(stats.positiveDays, 1);
});

test("migrering utan sparade dagar ger tom men giltig statistik", () => {
  assert.deepStrictEqual(game.statsFromDays(undefined, ROUNDS), game.emptyStats());
  assert.deepStrictEqual(game.statsFromDays({}, ROUNDS), game.emptyStats());
});

test("statistiken överlever att state.days städas bort", () => {
  // Poängen med att aggregera: stats får inte krympa när pruneDays kastar dagar.
  const stats = game.emptyStats();
  for (let i = 0; i < 40; i++) game.recordDay(stats, makeDay([1, 1, 1, 1, 1]), i + 1);
  assert.strictEqual(stats.days, 40);
  assert.strictEqual(stats.maxStreak, 40);
  assert.strictEqual(game.statsSummary(stats).avgR, 5);
});

test("streaken visas som noll direkt när en dag missats", () => {
  // 8 = idag. Spelade man i förrgår (6) är gårdagen missad och streaken bruten
  // redan nu — inte först när dag 8 spelas klart.
  assert.strictEqual(game.visibleStreak(4, 6, 8), 0);
  assert.strictEqual(game.visibleStreak(4, 7, 8), 4);      // igår = kan fortsätta
  assert.strictEqual(game.visibleStreak(4, 8, 8), 4);      // dagen redan klar
  assert.strictEqual(game.visibleStreak(4, undefined, 8), 4); // äldre state
  assert.strictEqual(game.visibleStreak(-3, 7, 8), 0);
});

test("korrupt men giltig JSON-state återställs utan uppstartskrasch", () => {
  for (const raw of [null, "text", [], 42]) {
    assert.deepStrictEqual(game.sanitizeStoredState(raw), {});
  }
  const cleaned = game.sanitizeStoredState({ days: [], totalR: "x", streak: -2, stats: {} });
  assert.deepStrictEqual(cleaned.days, {});
  assert.strictEqual(cleaned.totalR, 0);
  assert.strictEqual(cleaned.streak, 0);
  assert.strictEqual(cleaned.stats, undefined);
});

test("sanitizeStoredState kastar bort trasig spelarinfo och statistik", () => {
  const cleaned = game.sanitizeStoredState({
    days: { abc: { rounds: [] }, "-1": { rounds: [] }, 1: { rounds: [] } },
    lastPlayedDay: "igår",
    playerId: "inte-ett-uuid",
    playerName: "   ",
    stats: { ...game.emptyStats(), bestDay: "x" },
  });
  assert.deepStrictEqual(cleaned.days, { 1: { rounds: [] } });
  assert.strictEqual(cleaned.lastPlayedDay, undefined);
  assert.strictEqual(cleaned.playerId, undefined);
  assert.strictEqual(cleaned.playerName, undefined);
  assert.strictEqual(cleaned.stats, undefined);

  const valid = game.sanitizeStoredState({
    lastPlayedDay: 3,
    playerId: "11111111-1111-4111-8111-111111111111",
    playerName: "Ada",
  });
  assert.strictEqual(valid.lastPlayedDay, 3);
  assert.strictEqual(valid.playerId, "11111111-1111-4111-8111-111111111111");
  assert.strictEqual(valid.playerName, "Ada");
});

// --- 5. MA läcker inte framtiden --------------------------------------------------
test("sma ger null för de första (period-1) punkterna", () => {
  const out = game.sma([1, 2, 3, 4, 5], 3);
  assert.deepStrictEqual(out.slice(0, 2), [null, null]);
  assert.strictEqual(out[2], 2);       // (1+2+3)/3
  assert.strictEqual(out[4], 4);       // (3+4+5)/3
});

test("sma på synliga candles är oberoende av framtida data", () => {
  const visible = [10, 11, 12, 13, 14];
  const withFuture = visible.concat([99, 99, 99]);
  assert.deepStrictEqual(game.sma(visible, 3), game.sma(withFuture.slice(0, 5), 3));
});
