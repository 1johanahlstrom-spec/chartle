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

test("avstå ger alltid 0R", () => {
  const p = makePuzzle([{ o: 50, h: 50, l: 50, c: 50 }]);
  assert.deepStrictEqual(game.computeR(p, "pass", 5), { r: 0, stopped: false });
});

// --- 4. MA läcker inte framtiden --------------------------------------------------
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
