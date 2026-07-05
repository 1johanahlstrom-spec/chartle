// Chartle — dagens chart-pussel
// All state ligger i localStorage, inga konton, ingen backend.

const EPOCH = Date.UTC(2026, 6, 5);      // 2026-07-05 = Chartle #1
const TOTAL_PUZZLES = 365;
const ENTRY = 100;                        // priser är normaliserade: sista synliga close = 100

const $ = (id) => document.getElementById(id);

// --- Dagens pussel-nummer ---------------------------------------------------
const now = new Date();
const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
const dayIndex = Math.floor((todayUTC - EPOCH) / 86400000); // 0 = första dagen
const puzzleNo = dayIndex + 1;

// Övningsläge: ?p=N laddar godtyckligt pussel utan att röra streak
const params = new URLSearchParams(location.search);
const practice = params.has("p");
const fileIndex = practice
  ? parseInt(params.get("p"), 10) % TOTAL_PUZZLES
  : ((dayIndex % TOTAL_PUZZLES) + TOTAL_PUZZLES) % TOTAL_PUZZLES;

$("puzzle-no").textContent = practice ? `övning ${fileIndex}` : `#${puzzleNo}`;

// --- Lagring -----------------------------------------------------------------
function loadState() {
  try { return JSON.parse(localStorage.getItem("chartle") || "{}"); }
  catch { return {}; }
}
function saveState(s) { localStorage.setItem("chartle", JSON.stringify(s)); }

const state = loadState();
state.results = state.results || {};
$("streak").textContent = `🔥 ${state.streak || 0}`;

// --- Ladda pussel & rita chart ------------------------------------------------
let puzzle = null;
let meta = null;
let selectedStop = 5;

const CHART_LAYOUT = {
  paper_bgcolor: "#1a2029",
  plot_bgcolor: "#1a2029",
  font: { color: "#8b95a3", size: 11 },
  margin: { l: 44, r: 10, t: 10, b: 20 },
  showlegend: false,
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
  return [
    {
      type: "candlestick", x: idx,
      open: puzzle.o.slice(0, n), high: puzzle.h.slice(0, n),
      low: puzzle.l.slice(0, n), close: puzzle.c.slice(0, n),
      increasing: { line: { color: "#26a69a", width: 1 }, fillcolor: "#26a69a" },
      decreasing: { line: { color: "#ef5350", width: 1 }, fillcolor: "#ef5350" },
      hoverinfo: "none",
    },
    {
      type: "bar", x: idx, y: puzzle.v.slice(0, n), yaxis: "y2",
      marker: { color: idx.map(i => puzzle.c[i] >= puzzle.o[i] ? "#26a69a88" : "#ef535088") },
      hoverinfo: "none",
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

// --- Poäng: R-multipel --------------------------------------------------------
// Long: stop under entry. Om low ≤ stop under utfallet → stoppad (gap = sämre fill).
// R = resultat / risk, där risk = avståndet entry→stop.
function computeR(choice, stopPct) {
  if (choice === "pass") return { r: 0, exit: ENTRY, stopped: false };
  const risk = stopPct;
  const stopLevel = choice === "long" ? ENTRY - risk : ENTRY + risk;

  for (let i = puzzle.visible; i < puzzle.o.length; i++) {
    if (choice === "long" && puzzle.o[i] <= stopLevel)
      return { r: (puzzle.o[i] - ENTRY) / risk, exit: puzzle.o[i], stopped: true };
    if (choice === "long" && puzzle.l[i] <= stopLevel)
      return { r: -1, exit: stopLevel, stopped: true };
    if (choice === "short" && puzzle.o[i] >= stopLevel)
      return { r: (ENTRY - puzzle.o[i]) / risk, exit: puzzle.o[i], stopped: true };
    if (choice === "short" && puzzle.h[i] >= stopLevel)
      return { r: -1, exit: stopLevel, stopped: true };
  }
  const finalClose = puzzle.c[puzzle.c.length - 1];
  const r = choice === "long" ? (finalClose - ENTRY) / risk : (ENTRY - finalClose) / risk;
  return { r, exit: finalClose, stopped: false };
}

// --- Resultat & delning ---------------------------------------------------------
const CHOICE_LABEL = { long: "📈 Long", short: "📉 Short", pass: "🤚 Avstå" };
const CATEGORY_LABEL = {
  momentum: "momentum-namn",
  parabolic: "parabolic-kandidat",
  boring: "stabilt tråkbolag",
  decliners: "strukturell förlorare",
};

function fmtR(r) {
  const v = Math.round(r * 10) / 10;
  return (v > 0 ? "+" : "") + v.toFixed(1) + "R";
}

function resultEmoji(choice, r) {
  if (choice === "pass") return "⬜";
  return r > 0 ? "🟩" : r < 0 ? "🟥" : "⬜";
}

function showResult(res) {
  const { choice, stopPct, r } = res;
  const scoreEl = $("result-score");
  scoreEl.textContent = `${CHOICE_LABEL[choice]} → ${fmtR(r)}`;
  scoreEl.style.color = r > 0 ? "#26a69a" : r < 0 ? "#ef5350" : "#8b95a3";

  const dir = meta.fwdRetPct > 0 ? "steg" : "föll";
  const stoppedNote = res.stopped ? " Du blev stoppad på vägen." : "";
  $("result-facit").innerHTML =
    `Det var <strong>${meta.ticker}</strong> (${CATEGORY_LABEL[meta.category] || meta.category}), ` +
    `beslutdagen var <strong>${meta.decision}</strong> vid kursen $${meta.entryPrice}.<br>` +
    `De följande 10 dagarna ${dir} aktien <strong>${Math.abs(meta.fwdRetPct)}%</strong>.` +
    stoppedNote +
    (choice !== "pass" ? `<br>Din stop låg på ${stopPct}%.` : "");

  $("controls").style.display = "none";
  $("result").classList.remove("hidden");
  if (practice) $("comeback").textContent = "Övningsläge — påverkar inte din streak.";
}

function shareText(res) {
  const dirEmoji = { long: "📈", short: "📉", pass: "🤚" }[res.choice];
  let txt = `Chartle #${puzzleNo} ${dirEmoji}${resultEmoji(res.choice, res.r)} ${fmtR(res.r)}`;
  if (!practice && state.streak > 1) txt += ` 🔥${state.streak}`;
  return txt;
}

$("btn-share").addEventListener("click", async () => {
  const res = practice ? lastResult : state.results[puzzleNo];
  const txt = shareText(res);
  try {
    if (navigator.share) await navigator.share({ text: txt });
    else {
      await navigator.clipboard.writeText(txt);
      $("share-feedback").textContent = "Kopierat till urklipp!";
    }
  } catch { /* användaren avbröt */ }
});

// --- Spelflöde -------------------------------------------------------------------
let lastResult = null;

function updateStreak(r) {
  if (practice) return;
  const prev = state.lastPlayedDay;
  if (r >= 0) {
    state.streak = (prev === dayIndex - 1 ? (state.streak || 0) : 0) + 1;
  } else {
    state.streak = 0;
  }
  state.lastPlayedDay = dayIndex;
  $("streak").textContent = `🔥 ${state.streak}`;
}

function revealAndScore(choice) {
  document.querySelectorAll(".decision, .stop-btn").forEach(b => b.disabled = true);

  const res = computeR(choice, selectedStop);
  const stored = { choice, stopPct: selectedStop, r: res.r, stopped: res.stopped };
  lastResult = stored;
  if (!practice) {
    updateStreak(res.r);
    state.results[puzzleNo] = stored;
    saveState(state);
  }

  // Animera fram de 10 utfallsdagarna, en candle i taget
  const stopLevel = choice === "long" ? ENTRY - selectedStop : ENTRY + selectedStop;
  const shapes = stopShapes(choice, stopLevel);
  let n = puzzle.visible;
  const timer = setInterval(() => {
    n++;
    drawChart(n, shapes);
    if (n >= puzzle.o.length) {
      clearInterval(timer);
      showResult(stored);
    }
  }, 220);
}

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

async function init() {
  const resp = await fetch(`puzzles/${fileIndex}.json`);
  puzzle = await resp.json();
  meta = JSON.parse(atob(puzzle.meta));

  const already = !practice && state.results[puzzleNo];
  if (already) {
    // Redan spelat idag: visa hela charten + resultatet direkt
    lastResult = already;
    const stopLevel = already.choice === "long" ? ENTRY - already.stopPct : ENTRY + already.stopPct;
    drawChart(puzzle.o.length, stopShapes(already.choice, stopLevel));
    showResult(already);
  } else {
    drawChart(puzzle.visible);
  }
}

init();
