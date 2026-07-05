// Chartle — dagens chart-pussel, 5 rundor per dag.
// Spelstate i localStorage. Leaderboard via Supabase (valfritt, se config.js).

const EPOCH = Date.UTC(2026, 6, 5);      // 2026-07-05 = Chartle #1
const ROUNDS = 5;
const TOTAL_PUZZLES = 1825;               // 5 pussel/dag × 365 dagar
const ENTRY = 100;                        // priser är normaliserade: sista synliga close = 100

const $ = (id) => document.getElementById(id);

// --- Dagens pussel-nummer ---------------------------------------------------
const now = new Date();
const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
const dayIndex = Math.floor((todayUTC - EPOCH) / 86400000); // 0 = första dagen
const puzzleNo = dayIndex + 1;

// Övningsläge: ?p=N laddar ett enskilt pussel utan att röra streak/poäng
const params = new URLSearchParams(location.search);
const practice = params.has("p");

$("puzzle-no").textContent = practice ? `övning ${params.get("p")}` : `#${puzzleNo}`;

function fileIndexFor(round) {
  if (practice) return ((parseInt(params.get("p"), 10) % TOTAL_PUZZLES) + TOTAL_PUZZLES) % TOTAL_PUZZLES;
  return (((dayIndex * ROUNDS + round) % TOTAL_PUZZLES) + TOTAL_PUZZLES) % TOTAL_PUZZLES;
}

// --- Lagring -----------------------------------------------------------------
function loadState() {
  try { return JSON.parse(localStorage.getItem("chartle") || "{}"); }
  catch { return {}; }
}
function saveState() { localStorage.setItem("chartle", JSON.stringify(state)); }

const state = loadState();
if (!state.v) {           // migrera från v1 (en runda/dag): behåll bara streaken
  state.v = 2;
  delete state.results;
}
state.days = state.days || {};
state.totalR = state.totalR || 0;
if (!state.playerId && crypto.randomUUID) state.playerId = crypto.randomUUID();

function day() {
  if (!state.days[puzzleNo]) state.days[puzzleNo] = { rounds: [] };
  return state.days[puzzleNo];
}
function dayR(d) { return d.rounds.reduce((s, r) => s + r.r, 0); }

// --- Chart --------------------------------------------------------------------
let puzzle = null;
let meta = null;
let selectedStop = 5;

const CHART_LAYOUT = {
  paper_bgcolor: "#1a2029",
  plot_bgcolor: "#1a2029",
  font: { color: "#8b95a3", size: 11 },
  margin: { l: 44, r: 10, t: 10, b: 20 },
  showlegend: true,
  legend: {
    x: 0, y: 1, xanchor: "left", yanchor: "top", orientation: "h",
    font: { size: 10 }, bgcolor: "rgba(0,0,0,0)",
  },
  dragmode: false,
  xaxis: {
    rangeslider: { visible: false },
    showticklabels: false,
    gridcolor: "#242d38",
    fixedrange: true,
    range: [-1, 70],
  },
  yaxis: { domain: [0.24, 1], gridcolor: "#242d38", fixedrange: true },
  yaxis2: { domain: [0, 0.18], gridcolor: "#242d38", fixedrange: true, showticklabels: false },
  shapes: [],
};

// Glidande medelvärde (SMA) på close. Beräknas på de redan visade candlesen —
// aldrig på framtida data — så inget läcker under utspelningen. De första
// (period-1) punkterna blir null → Plotly ritar ingen linje där.
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

function traces(n) {
  const idx = [...Array(n).keys()];
  const closes = puzzle.c.slice(0, n);
  return [
    {
      type: "candlestick", x: idx,
      open: puzzle.o.slice(0, n), high: puzzle.h.slice(0, n),
      low: puzzle.l.slice(0, n), close: closes,
      increasing: { line: { color: "#26a69a", width: 1 }, fillcolor: "#26a69a" },
      decreasing: { line: { color: "#ef5350", width: 1 }, fillcolor: "#ef5350" },
      hoverinfo: "none", showlegend: false,
    },
    {
      type: "bar", x: idx, y: puzzle.v.slice(0, n), yaxis: "y2",
      marker: { color: idx.map(i => puzzle.c[i] >= puzzle.o[i] ? "#26a69a88" : "#ef535088") },
      hoverinfo: "none", showlegend: false,
    },
    {
      type: "scatter", mode: "lines", x: idx, y: sma(closes, 10),
      line: { color: "#4a9eff", width: 1.3 }, name: "MA10",
      hoverinfo: "none", connectgaps: false,
    },
    {
      type: "scatter", mode: "lines", x: idx, y: sma(closes, 20),
      line: { color: "#f5b544", width: 1.3 }, name: "MA20",
      hoverinfo: "none", connectgaps: false,
    },
  ];
}

function drawChart(n, extraShapes = []) {
  const layout = structuredClone(CHART_LAYOUT);
  layout.shapes = extraShapes;
  Plotly.react("chart", traces(n), layout, { displayModeBar: false, responsive: true });
}

function stopShapes(choice, stopLevel) {
  if (choice === "pass") return [];
  const line = (y, color, dash) => ({
    type: "line", x0: 59, x1: 70, y0: y, y1: y,
    line: { color, width: 1, dash },
  });
  return [line(ENTRY, "#8b95a3", "dot"), line(stopLevel, "#ef5350", "dash")];
}

// --- Poäng: R-multipel ----------------------------------------------------------
// Long: stop under entry. Gap förbi stoppen fylls på open (sämre än -1R kan hända).
// Ingen stop träffad → exit på sista utfallsdagens close. R = resultat / risk.
function computeR(choice, stopPct) {
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

// --- UI-hjälpare ------------------------------------------------------------------
const CHOICE_LABEL = { long: "📈 Long", short: "📉 Short", pass: "🤚 Avstå" };
const CATEGORY_LABEL = {
  momentum: "momentum-namn",
  parabolic: "parabolic-kandidat",
  boring: "stabilt tråkbolag",
  decliners: "strukturell förlorare",
  classic: "klassiskt blue chip",
  techclassic: "tech-veteran",
};

function fmtR(r) {
  const v = Math.round(r * 10) / 10;
  return (v > 0 ? "+" : "") + v.toFixed(1) + "R";
}
function rColor(r) { return r > 0 ? "#26a69a" : r < 0 ? "#ef5350" : "#8b95a3"; }
function resultEmoji(round) {
  if (round.choice === "pass") return "⬜";
  return round.r > 0 ? "🟩" : round.r < 0 ? "🟥" : "⬜";
}

function updateHeader() {
  $("streak").textContent = `🔥 ${state.streak || 0}`;
  $("total-r").textContent = `Σ ${fmtR(state.totalR)}`;
  const d = practice ? { rounds: [] } : day();
  $("round-no").textContent = Math.min(d.rounds.length + 1, ROUNDS);
  $("day-r").textContent = fmtR(dayR(d));
}

// --- Spelflöde -------------------------------------------------------------------
let practiceResult = null;

function showRoundResult(round) {
  $("result-score").textContent = `${CHOICE_LABEL[round.choice]} → ${fmtR(round.r)}`;
  $("result-score").style.color = rColor(round.r);

  const dir = meta.fwdRetPct > 0 ? "steg" : "föll";
  $("result-facit").innerHTML =
    `Det var <strong>${meta.ticker}</strong> (${CATEGORY_LABEL[meta.category] || meta.category}), ` +
    `beslutsdagen var <strong>${meta.decision}</strong> vid kursen $${meta.entryPrice}.<br>` +
    `De följande 10 dagarna ${dir} aktien <strong>${Math.abs(meta.fwdRetPct)}%</strong>.` +
    (round.stopped ? " Du blev stoppad på vägen." : "");

  const done = practice || day().rounds.length >= ROUNDS;
  $("btn-next").textContent = practice ? "Spela igen →"
    : done ? "Dagens resultat →" : "Nästa chart →";
  $("controls").classList.add("hidden");
  $("round-result").classList.remove("hidden");
}

function showDaySummary() {
  const d = day();
  const total = dayR(d);
  $("summary-emoji").textContent = d.rounds.map(resultEmoji).join(" ");
  $("summary-r").textContent = fmtR(total);
  $("summary-r").style.color = rColor(total);

  $("controls").classList.add("hidden");
  $("round-result").classList.add("hidden");
  $("day-summary").classList.remove("hidden");
  initLeaderboard();
}

function revealAndScore(choice) {
  document.querySelectorAll(".decision, .stop-btn").forEach(b => b.disabled = true);

  const res = computeR(choice, selectedStop);
  const round = { choice, stopPct: selectedStop, r: Math.round(res.r * 100) / 100, stopped: res.stopped };

  if (practice) {
    practiceResult = round;
  } else {
    const d = day();
    d.rounds.push(round);
    if (d.rounds.length === ROUNDS) {          // dagen klar → poäng & streak
      const total = dayR(d);
      state.totalR = Math.round((state.totalR + total) * 100) / 100;
      const prev = state.lastPlayedDay;
      state.streak = total >= 0 ? (prev === dayIndex - 1 ? (state.streak || 0) : 0) + 1 : 0;
      state.lastPlayedDay = dayIndex;
    }
    saveState();
  }
  updateHeader();

  // Animera fram de 10 utfallsdagarna, en candle i taget
  const stopLevel = choice === "long" ? ENTRY - selectedStop : ENTRY + selectedStop;
  const shapes = stopShapes(choice, stopLevel);
  let n = puzzle.visible;
  const timer = setInterval(() => {
    n++;
    drawChart(n, shapes);
    if (n >= puzzle.o.length) {
      clearInterval(timer);
      showRoundResult(round);
    }
  }, 200);
}

async function loadRound(round) {
  const resp = await fetch(`puzzles/${fileIndexFor(round)}.json`);
  puzzle = await resp.json();
  meta = JSON.parse(atob(puzzle.meta));

  drawChart(puzzle.visible);
  document.querySelectorAll(".decision, .stop-btn").forEach(b => b.disabled = false);
  $("round-result").classList.add("hidden");
  $("day-summary").classList.add("hidden");
  $("controls").classList.remove("hidden");
  updateHeader();
}

$("btn-next").addEventListener("click", () => {
  if (practice) { location.reload(); return; }
  const d = day();
  if (d.rounds.length >= ROUNDS) showDaySummary();
  else loadRound(d.rounds.length);
});

document.querySelectorAll(".stop-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".stop-btn").forEach(b => b.classList.remove("selected"));
    btn.classList.add("selected");
    selectedStop = parseInt(btn.dataset.stop, 10);
  });
});

$("btn-long").addEventListener("click", () => revealAndScore("long"));
$("btn-short").addEventListener("click", () => revealAndScore("short"));
$("btn-pass").addEventListener("click", () => revealAndScore("pass"));

// --- Delning ------------------------------------------------------------------------
function shareText() {
  const d = day();
  let txt = `Chartle #${puzzleNo} ${d.rounds.map(resultEmoji).join("")} ${fmtR(dayR(d))}`;
  if (state.streak > 1) txt += ` 🔥${state.streak}`;
  return txt + "\nhttps://1johanahlstrom-spec.github.io/chartle/";
}

$("btn-share").addEventListener("click", async () => {
  const txt = shareText();
  try {
    if (navigator.share) await navigator.share({ text: txt });
    else {
      await navigator.clipboard.writeText(txt);
      $("share-feedback").textContent = "Kopierat till urklipp!";
    }
  } catch { /* användaren avbröt */ }
});

// --- Leaderboard (Supabase) ------------------------------------------------------------
const LB = window.CHARTLE_CONFIG || {};
const lbEnabled = LB.SUPABASE_URL && LB.SUPABASE_ANON_KEY;
let lbTab = "today";

async function lbRequest(path, options = {}) {
  const resp = await fetch(`${LB.SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: LB.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${LB.SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
      ...(options.headers || {}),
    },
  });
  return resp;
}

async function submitScore() {
  const name = $("lb-name").value.trim();
  if (!name) { $("lb-feedback").textContent = "Skriv ett namn först."; return; }
  state.playerName = name;
  saveState();

  $("btn-submit-score").disabled = true;
  const resp = await lbRequest("scores", {
    method: "POST",
    body: JSON.stringify({
      day: puzzleNo,
      player_id: state.playerId,
      name,
      day_r: Math.round(dayR(day()) * 100) / 100,
    }),
  });
  if (resp.ok || resp.status === 409) {   // 409 = redan inskickad idag
    day().submitted = true;
    saveState();
    $("lb-feedback").textContent = "Inskickat! 🏆";
    $("lb-submit-row").classList.add("hidden");
    renderLeaderboard();
  } else {
    $("btn-submit-score").disabled = false;
    $("lb-feedback").textContent = "Kunde inte skicka in — försök igen.";
  }
}

async function renderLeaderboard() {
  const list = $("lb-list");
  list.innerHTML = "<p class='lb-loading'>Laddar…</p>";
  const query = lbTab === "today"
    ? `scores?day=eq.${puzzleNo}&select=player_id,name,day_r&order=day_r.desc&limit=25`
    : `leaderboard_total?select=player_id,name,total_r,days&order=total_r.desc&limit=25`;
  const resp = await lbRequest(query, { headers: { Prefer: "" } });
  if (!resp.ok) { list.innerHTML = "<p class='lb-loading'>Kunde inte ladda listan.</p>"; return; }
  const rows = await resp.json();
  if (!rows.length) { list.innerHTML = "<p class='lb-loading'>Inga resultat ännu — bli först!</p>"; return; }

  list.innerHTML = "";
  const table = document.createElement("table");
  rows.forEach((row, i) => {
    const tr = document.createElement("tr");
    if (row.player_id === state.playerId) tr.className = "me";
    const score = lbTab === "today" ? row.day_r : row.total_r;
    const extra = lbTab === "total" ? ` · ${row.days} dagar` : "";
    const medal = ["🥇", "🥈", "🥉"][i] || `${i + 1}.`;
    const td = (txt) => { const el = document.createElement("td"); el.textContent = txt; return el; };
    tr.append(td(medal), td(row.name + extra), td(fmtR(Number(score))));
    table.appendChild(tr);
  });
  list.appendChild(table);
}

function initLeaderboard() {
  if (!lbEnabled) {
    $("leaderboard").innerHTML = "<h3>🏆 Leaderboard</h3><p class='lb-loading'>Leaderboarden är inte igång ännu.</p>";
    return;
  }
  if (state.playerName) $("lb-name").value = state.playerName;
  if (day().submitted) $("lb-submit-row").classList.add("hidden");
  renderLeaderboard();
}

$("btn-submit-score").addEventListener("click", submitScore);
document.querySelectorAll(".lb-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".lb-tab").forEach(b => b.classList.remove("selected"));
    btn.classList.add("selected");
    lbTab = btn.dataset.tab;
    renderLeaderboard();
  });
});

// --- Start ------------------------------------------------------------------------------
function init() {
  updateHeader();
  if (practice) { loadRound(0); return; }
  const d = day();
  if (d.rounds.length >= ROUNDS) {
    loadRound(ROUNDS - 1).then(() => {   // visa sista charten fullt utspelad bakom summeringen
      const last = d.rounds[ROUNDS - 1];
      const stopLevel = last.choice === "long" ? ENTRY - last.stopPct : ENTRY + last.stopPct;
      drawChart(puzzle.o.length, stopShapes(last.choice, stopLevel));
      showDaySummary();
    });
  } else {
    loadRound(d.rounds.length);
  }
}

init();
