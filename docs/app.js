// Chartle — dagens chart-pussel, 5 rundor per dag.
// Spelstate i localStorage. Leaderboard via eget API (se config.js).

// Ren spellogik (dygnsgräns, pusselval, SMA, R-beräkning) bor i game.js och
// testas av tests/test_game.js.
const {
  ROUNDS, DAYS_OF_CONTENT, ENTRY,
  stockholmDayIndex, puzzleFileIndex, validatePuzzle, sma, computeR,
  emptyStats, recordDay, statsFromDays, statsSummary, sanitizeStoredState,
} = ChartleGame;

const KEEP_DAYS = 30;                     // så många spelade dagar sparas i localStorage

const $ = (id) => document.getElementById(id);

// --- Dagens pussel-nummer ---------------------------------------------------
const dayIndex = stockholmDayIndex();      // 0 = första dagen
const puzzleNo = dayIndex + 1;

// Övningsläge: ?p=N laddar ett enskilt pussel utan att röra streak/poäng
const params = new URLSearchParams(location.search);
const practice = params.has("p");

$("puzzle-no").textContent = practice ? `övning ${params.get("p")}` : `#${puzzleNo}`;

function fileIndexFor(round) {
  return puzzleFileIndex(practice ? parseInt(params.get("p"), 10) : dayIndex * ROUNDS + round);
}

// --- Lagring -----------------------------------------------------------------
function loadState() {
  try { return sanitizeStoredState(JSON.parse(localStorage.getItem("chartle") || "{}")); }
  catch { return {}; }
}
function saveState() {
  try { localStorage.setItem("chartle", JSON.stringify(state)); }
  catch (err) { console.error("Kunde inte spara state:", err); }  // t.ex. full kvot
}

// crypto.randomUUID saknas i osäkra kontexter och äldre webbläsare. Utan
// fallback blir player_id undefined och alla inskick svarar 400.
function newPlayerId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;            // version 4
  b[8] = (b[8] & 0x3f) | 0x80;            // variant
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
         `${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Behåll bara de senaste dagarna — totalsumman ligger ändå i state.totalR.
function pruneDays(days) {
  const keys = Object.keys(days).map(Number).sort((a, b) => b - a);
  for (const key of keys.slice(KEEP_DAYS)) delete days[key];
  return days;
}

const state = loadState();
if (!state.v) {           // migrera från v1 (en runda/dag): behåll bara streaken
  state.v = 2;
  delete state.results;
}
if (state.v === 2) {      // v3: aggregerad statistik + ticker sparad per runda
  // Måste köras FÖRE pruneDays — annars migreras bara de dagar som råkar
  // överleva städningen, och de äldre försvinner ur statistiken för alltid.
  state.stats = statsFromDays(state.days, ROUNDS);
  state.stats.maxStreak = Math.max(state.stats.maxStreak, state.streak || 0);
  state.v = 3;
}
state.stats = state.stats || emptyStats();
state.days = pruneDays(state.days || {});
state.totalR = state.totalR || 0;
if (!state.playerId) state.playerId = newPlayerId();

// Skriv tillbaka direkt. Utan detta lever migreringen, städningen och ett
// nygenererat playerId bara i minnet tills spelaren råkar avsluta en runda —
// och räknas om vid varje sidladdning fram till dess.
saveState();

function day() {
  if (!state.days[puzzleNo]) state.days[puzzleNo] = { rounds: [] };
  return state.days[puzzleNo];
}
function dayR(d) { return d.rounds.reduce((s, r) => s + r.r, 0); }

// --- Chart --------------------------------------------------------------------
let puzzle = null;
let meta = null;
let selectedStop = 5;
let playback = null;      // pågående utspelning, null när ingen är igång
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

// Varna när kalendern lämnat det byggda innehållet. Efter 365 dagar går
// (dayIndex * 5) % 1825 tillbaka till 0 och hela året spelas om i samma ordning.
function showCalendarNotice() {
  if (practice) return;
  let msg = "";
  if (dayIndex < 0) {
    // Går bara att nå med en felställd klocka — epoken ligger i det förflutna.
    msg = "Enhetens datum verkar vara felställt: Chartle startade 2026-07-05. " +
          "Kontrollera klockan, annars kan resultat inte skickas in.";
  } else if (dayIndex >= DAYS_OF_CONTENT) {
    const lap = Math.floor(dayIndex / DAYS_OF_CONTENT) + 1;
    msg = `Varv ${lap}: alla ${DAYS_OF_CONTENT} dagars charts är spelade, ` +
          "så de börjar om från början. Nya charts är på gång!";
  }
  if (!msg) return;
  $("notice").textContent = msg;
  $("notice").classList.remove("hidden");
}

// --- Spelflöde -------------------------------------------------------------------
function showRoundResult(round) {
  $("result-score").textContent = `${CHOICE_LABEL[round.choice]} → ${fmtR(round.r)}`;
  $("result-score").style.color = rColor(round.r);

  const dir = meta.fwdRetPct > 0 ? "steg" : "föll";
  // entryPrice är split- och utdelningsjusterat. För gamla blue chips blir det
  // ören (XOM 1962 ≈ $0.09) och säger ingenting om vad aktien faktiskt kostade
  // — då utelämnar vi priset hellre än att skriva ut något missvisande.
  const price = meta.entryPrice >= 1
    ? ` vid kursen $${meta.entryPrice} (justerat för split och utdelning)`
    : "";
  const fact = $("result-facit");
  fact.replaceChildren();
  const strong = (text) => { const el = document.createElement("strong"); el.textContent = text; return el; };
  fact.append("Det var ", strong(meta.ticker),
    ` (${CATEGORY_LABEL[meta.category] || meta.category}), beslutsdagen var `,
    strong(meta.decision), `${price}.`, document.createElement("br"),
    `De följande 10 dagarna ${dir} aktien `, strong(`${Math.abs(meta.fwdRetPct)}%`), ".",
    round.stopped ? " Du blev stoppad på vägen." : "");

  const done = practice || day().rounds.length >= ROUNDS;
  $("btn-next").textContent = practice ? "Spela igen →"
    : done ? "Dagens resultat →" : "Nästa chart →";
  $("controls").classList.add("hidden");
  $("round-result").classList.remove("hidden");
}

// Rundhistorik: vad de fem emojierna faktiskt stod för. Rundor sparade under
// schema v2 saknar ticker/år — då visas raden ändå, bara utan namnet.
function renderRoundHistory(rounds) {
  const list = $("round-history");
  list.innerHTML = "";
  const table = document.createElement("table");
  rounds.forEach((round, i) => {
    const tr = document.createElement("tr");
    const td = (txt, cls) => {
      const el = document.createElement("td");
      el.textContent = txt;
      if (cls) el.className = cls;
      return el;
    };
    const name = round.ticker ? `${round.ticker} ${round.year || ""}`.trim() : "—";
    const rCell = td(fmtR(round.r), "history-r");
    rCell.style.color = rColor(round.r);
    tr.append(
      td(`${i + 1}.`, "history-no"),
      td(resultEmoji(round), "history-emoji"),
      td(name, "history-name"),
      // Stop-nivån är meningslös för Avstå — ingen position togs.
      td(round.choice === "pass" ? CHOICE_LABEL.pass
        : `${CHOICE_LABEL[round.choice]} · ${round.stopPct}%`, "history-choice"),
      rCell,
    );
    table.appendChild(tr);
  });
  list.appendChild(table);
}

function showDaySummary() {
  const d = day();
  const total = dayR(d);
  $("summary-emoji").textContent = d.rounds.map(resultEmoji).join(" ");
  $("summary-r").textContent = fmtR(total);
  $("summary-r").style.color = rColor(total);
  renderRoundHistory(d.rounds);

  $("controls").classList.add("hidden");
  $("round-result").classList.add("hidden");
  $("day-summary").classList.remove("hidden");
  initLeaderboard();
}

function revealAndScore(choice) {
  document.querySelectorAll(".decision, .stop-btn").forEach(b => b.disabled = true);

  const res = computeR(puzzle, choice, selectedStop);
  // ticker och år sparas här och inte bara i puzzle: dagssummeringen ska kunna
  // visa alla fem rundorna efter en omladdning, då bara sista pusslet laddas om.
  const round = {
    choice, stopPct: selectedStop,
    r: Math.round(res.r * 100) / 100, stopped: res.stopped,
    ticker: meta.ticker, year: Number(meta.decision.slice(0, 4)),
  };

  if (!practice) {
    const d = day();
    d.rounds.push(round);
    if (d.rounds.length === ROUNDS) {          // dagen klar → poäng & streak
      const total = dayR(d);
      state.totalR = Math.round((state.totalR + total) * 100) / 100;
      const prev = state.lastPlayedDay;
      state.streak = total >= 0 ? (prev === dayIndex - 1 ? (state.streak || 0) : 0) + 1 : 0;
      state.lastPlayedDay = dayIndex;
      recordDay(state.stats, d.rounds, state.streak);   // efter streaken — maxStreak läser den
    }
    saveState();
  }
  updateHeader();

  // Animera fram de 10 utfallsdagarna, en candle i taget
  const stopLevel = choice === "long" ? ENTRY - selectedStop : ENTRY + selectedStop;
  const shapes = stopShapes(choice, stopLevel);
  let n = puzzle.visible;
  const finish = () => {
    if (!playback) return;                 // redan avslutad
    clearInterval(playback.timer);
    playback = null;
    drawChart(puzzle.o.length, shapes);
    $("chart").setAttribute("aria-label", "Kursdiagram med 70 candlesticks inklusive tio utfallsdagar, MA10, MA20 och volym");
    showRoundResult(round);
  };
  playback = {
    timer: setInterval(() => {
      n++;
      if (n >= puzzle.o.length) { finish(); return; }
      drawChart(n, shapes);
    }, 200),
    finish,
  };
  if (reduceMotion) playback.finish();
}

// Hoppa direkt till facit. Tio candles à 200 ms × fem rundor är tio sekunders
// väntan per dag för den som spelar varje morgon.
function skipPlayback() {
  if (playback) playback.finish();
}

function showLoadError() {
  $("chart").innerHTML =
    "<p class='load-error'>Kunde inte ladda charten.<br>" +
    "Kontrollera nätverket och ladda om sidan.</p>";
  $("controls").classList.add("hidden");
}

// Returnerar true om rundan laddades. Ett trasigt eller saknat pussel får
// aldrig bli ett obehandlat promise-fel — då står spelaren med en vit ruta.
async function loadRound(round, showControls = true) {
  try {
    const resp = await fetch(`puzzles/${fileIndexFor(round)}.json`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const loaded = validatePuzzle(await resp.json());
    const parsed = JSON.parse(atob(loaded.meta));
    if (!parsed || typeof parsed !== "object" || typeof parsed.ticker !== "string" ||
        typeof parsed.decision !== "string" || !Number.isFinite(parsed.fwdRetPct))
      throw new Error("Pusslet har ogiltig metadata");
    puzzle = loaded;
    meta = parsed;
  } catch (err) {
    console.error("Kunde inte ladda runda", round, err);
    showLoadError();
    return false;
  }

  drawChart(puzzle.visible);
  $("chart").setAttribute("aria-label", "Kursdiagram med 60 candlesticks, MA10, MA20 och volym");
  document.querySelectorAll(".decision, .stop-btn").forEach(b => b.disabled = false);
  $("round-result").classList.add("hidden");
  $("day-summary").classList.add("hidden");
  // Vid omladdning av en färdigspelad dag laddas sista pusslet bara för att
  // ritas bakom summeringen — då ska knapparna aldrig visas.
  if (showControls) $("controls").classList.remove("hidden");
  updateHeader();
  return true;
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
    document.querySelectorAll(".stop-btn").forEach(b => b.setAttribute("aria-pressed", String(b === btn)));
    selectedStop = parseInt(btn.dataset.stop, 10);
  });
});

$("btn-long").addEventListener("click", () => revealAndScore("long"));
$("btn-short").addEventListener("click", () => revealAndScore("short"));
$("btn-pass").addEventListener("click", () => revealAndScore("pass"));

// Klick i charten hoppar över utspelningen.
$("chart").addEventListener("click", skipPlayback);

// --- Tangentbord ---------------------------------------------------------------
// L/S/A väljer riktning, 1/2/3 stop-nivå, Enter går vidare, mellanslag hoppar
// över utspelningen. Klickar bara på knappar som faktiskt är aktiva, så
// genvägarna kan aldrig göra något musen inte kunde.
const KEY_DECISION = { l: "btn-long", s: "btn-short", a: "btn-pass", p: "btn-pass" };
const KEY_STOP = { 1: "2", 2: "5", 3: "8" };

// Alla beslutsknappar bor i #controls, så det är den sektionen som avgör om
// ett val är möjligt just nu — inte knappens närmaste förälder (#decision-row,
// som aldrig döljs).
function clickDecision(id) {
  if ($("controls").classList.contains("hidden")) return;
  const btn = $(id);
  if (btn && !btn.disabled) btn.click();
}

document.addEventListener("keydown", (event) => {
  // Aldrig kapa tangenter från namnfältet, och aldrig krocka med webbläsarens
  // egna genvägar (Ctrl/Cmd/Alt).
  if (event.target.tagName === "INPUT" || event.metaKey || event.ctrlKey || event.altKey) return;
  if (!$("stats-backdrop").classList.contains("hidden")) return;   // modalen äger tangenterna

  const key = event.key.toLowerCase();
  if (key === " " || key === "spacebar") {
    if (playback) { event.preventDefault(); skipPlayback(); }
    return;
  }
  if (key === "enter") {
    if (!$("round-result").classList.contains("hidden")) { event.preventDefault(); $("btn-next").click(); }
    return;
  }
  if (KEY_STOP[key] && !$("controls").classList.contains("hidden")) {
    const btn = document.querySelector(`.stop-btn[data-stop="${KEY_STOP[key]}"]`);
    if (btn && !btn.disabled) btn.click();
    return;
  }
  if (KEY_DECISION[key]) clickDecision(KEY_DECISION[key]);
});

// --- Statistik --------------------------------------------------------------------
// Siffrorna kommer från state.stats, som aggregeras vid varje avslutad dag.
// Att räkna om dem ur state.days går inte: pruneDays behåller bara 30 dagar.
function renderStats() {
  const s = statsSummary(state.stats);
  const empty = s.days === 0;
  $("stats-empty").classList.toggle("hidden", !empty);
  $("stats-tiles").classList.toggle("hidden", empty);
  $("stats-choices").classList.toggle("hidden", empty);
  if (empty) { $("stats-note").textContent = ""; return; }

  const tiles = [
    ["Spelade dagar", String(s.days)],
    ["Positiva dagar", `${s.positivePct}%`],
    ["Snitt per dag", fmtR(s.avgR)],
    ["Bästa dag", fmtR(s.bestDay)],
    ["Nuvarande streak", `🔥 ${state.streak || 0}`],
    ["Längsta streak", `🔥 ${s.maxStreak}`],
  ];
  const tileBox = $("stats-tiles");
  tileBox.innerHTML = "";
  for (const [label, value] of tiles) {
    const tile = document.createElement("div");
    tile.className = "stat-tile";
    const v = document.createElement("div");
    v.className = "stat-value";
    v.textContent = value;
    const l = document.createElement("div");
    l.className = "stat-label";
    l.textContent = label;
    tile.append(v, l);
    tileBox.appendChild(tile);
  }

  const table = $("stats-choices");
  table.innerHTML = "";
  const header = document.createElement("tr");
  for (const text of ["", "Antal", "Träff", "Snitt"]) {
    const th = document.createElement("th");
    th.textContent = text;
    header.appendChild(th);
  }
  table.appendChild(header);
  for (const name of ["long", "short", "pass"]) {
    const choice = s.choices[name];
    const tr = document.createElement("tr");
    const td = (txt) => { const el = document.createElement("td"); el.textContent = txt; return el; };
    // Avstå ger alltid exakt 0R — en "träffprocent" där vore bara vilseledande.
    tr.append(
      td(CHOICE_LABEL[name]),
      td(String(choice.n)),
      td(name === "pass" ? "—" : `${choice.winPct}%`),
      td(name === "pass" ? "—" : fmtR(choice.avgR)),
    );
    table.appendChild(tr);
  }

  $("stats-note").textContent = s.days === 1
    ? "Baserat på 1 spelad dag."
    : `Baserat på ${s.days} spelade dagar.`;
}

let focusBeforeStats = null;
function openStats() {
  renderStats();
  focusBeforeStats = document.activeElement;
  $("stats-backdrop").classList.remove("hidden");
  $("btn-stats-close").focus();
}
function closeStats() {
  $("stats-backdrop").classList.add("hidden");
  if (focusBeforeStats && typeof focusBeforeStats.focus === "function") focusBeforeStats.focus();
  else $("btn-stats").focus();
}

$("btn-stats").addEventListener("click", openStats);
$("btn-stats-close").addEventListener("click", closeStats);
// Klick på bakgrunden stänger — men inte klick inuti panelen.
$("stats-backdrop").addEventListener("click", (event) => {
  if (event.target === $("stats-backdrop")) closeStats();
});
document.addEventListener("keydown", (event) => {
  if ($("stats-backdrop").classList.contains("hidden")) return;
  if (event.key === "Escape") { closeStats(); return; }
  if (event.key !== "Tab") return;
  const focusable = [...$("stats-panel").querySelectorAll(
    'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault(); first.focus();
  }
});

// --- Delning ------------------------------------------------------------------------
function shareText() {
  const d = day();
  let txt = `Chartle #${puzzleNo} ${d.rounds.map(resultEmoji).join("")} ${fmtR(dayR(d))}`;
  if (state.streak > 1) txt += ` 🔥${state.streak}`;
  // Adressen sätts i config.js. Fallback = sidan spelaren faktiskt spelar på.
  const url = (window.CHARTLE_CONFIG || {}).SHARE_URL || (location.origin + location.pathname);
  return txt + "\n" + url;
}

// Övningsläget fanns bara som ?p=N i README. Ett slumpat pussel ger spelet
// innehåll efter dagens fem rundor, utan att röra streak eller poäng.
$("btn-practice").addEventListener("click", () => {
  const idx = Math.floor(Math.random() * ChartleGame.TOTAL_PUZZLES);
  location.href = `?p=${idx}`;
});

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

// --- Leaderboard (eget API + SQLite) ---------------------------------------------------
const LB = window.CHARTLE_CONFIG || {};
const lbEnabled = LB.LEADERBOARD_ENABLED === true;
const apiBase = (LB.API_BASE || "").replace(/\/$/, "");
let lbTab = "today";

async function lbRequest(path, options = {}) {
  const resp = await fetch(`${apiBase}/api/${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  return resp;
}

async function submitScore() {
  const name = $("lb-name").value.trim();
  if (!name) { $("lb-feedback").textContent = "Skriv ett namn först."; return; }
  if (puzzleNo < 1) { $("lb-feedback").textContent = "Chartle har inte startat än."; return; }

  $("btn-submit-score").disabled = true;
  $("lb-feedback").textContent = "Skickar…";
  // Ett 400 betyder att servern avvisade själva innehållet — samma data ger
  // samma svar hur många gånger man än trycker. Att då skriva "försök igen"
  // och släppa knappen fri sätter spelaren i en loop utan utväg.
  let permanent = false;
  try {
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
      state.playerName = name;              // sparas först när det gick vägen
      saveState();
      $("lb-feedback").textContent = "Inskickat! 🏆";
      $("lb-submit-row").classList.add("hidden");
      renderLeaderboard();
      return;
    }
    if (resp.status === 429) {
      $("lb-feedback").textContent = "För många inskick — vänta en stund.";
    } else if (resp.status === 400) {
      permanent = true;
      $("lb-feedback").textContent = "Servern kunde inte ta emot resultatet. Dagens poäng finns kvar lokalt.";
    } else {
      $("lb-feedback").textContent = "Kunde inte skicka in — försök igen.";
    }
  } catch (err) {
    console.error("Inskick misslyckades:", err);
    $("lb-feedback").textContent = "Ingen kontakt med servern — försök igen.";
  } finally {
    // Knappen måste tillbaka vid nätverksfel, annars sitter spelaren fast.
    if (!day().submitted && !permanent) $("btn-submit-score").disabled = false;
  }
}

// "30 dagar" och "Snitt" räknar på samma rullande fönster, bara sorterat
// olika — totalen belönar den som spelat mycket, snittet den som spelat jämnt.
const LB_QUERY = {
  today: () => `leaderboard/today?day=${puzzleNo}&limit=25`,
  total: () => "leaderboard/total?limit=25",
  average: () => "leaderboard/average?limit=25",
};
const LB_EMPTY = {
  today: "Inga resultat ännu — bli först!",
  total: "Inga resultat de senaste 30 dagarna.",
  average: "Ingen har spelat tillräckligt många dagar ännu.",
};

async function renderLeaderboard() {
  const list = $("lb-list");
  list.innerHTML = "<p class='lb-loading'>Laddar…</p>";
  const query = LB_QUERY[lbTab]();
  let rows;
  try {
    const resp = await lbRequest(query);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    rows = await resp.json();
  } catch (err) {
    console.error("Kunde inte ladda leaderboard:", err);
    list.innerHTML = "<p class='lb-loading'>Kunde inte ladda listan.</p>";
    return;
  }
  if (!rows.length) {
    list.innerHTML = "";
    const empty = document.createElement("p");
    empty.className = "lb-loading";
    empty.textContent = LB_EMPTY[lbTab];
    list.appendChild(empty);
    return;
  }

  list.innerHTML = "";
  const table = document.createElement("table");
  rows.forEach((row, i) => {
    const tr = document.createElement("tr");
    if (row.player_id === state.playerId) tr.className = "me";
    const score = lbTab === "today" ? row.day_r : lbTab === "average" ? row.avg_r : row.total_r;
    const extra = lbTab === "today" ? "" : ` · ${row.days} ${row.days === 1 ? "dag" : "dagar"}`;
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
    document.querySelectorAll(".lb-tab").forEach(b => b.setAttribute("aria-selected", String(b === btn)));
    lbTab = btn.dataset.tab;
    $("lb-feedback").textContent = "";   // gällde den förra vyn
    renderLeaderboard();
  });
});

// --- Start ------------------------------------------------------------------------------
function init() {
  updateHeader();
  showCalendarNotice();
  if (practice) {
    $("practice-banner").classList.remove("hidden");
    loadRound(0);
    return;
  }
  const d = day();
  if (d.rounds.length >= ROUNDS) {
    // #controls är synlig i HTML från början, så vid omladdning av en färdig
    // dag ritas beslutsknapparna upp direkt och ligger kvar tills fetchen är
    // klar. Dölj dem innan laddningen i stället.
    $("controls").classList.add("hidden");
    loadRound(ROUNDS - 1, false).then((ok) => {   // sista charten fullt utspelad bakom summeringen
      if (!ok) return;
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
