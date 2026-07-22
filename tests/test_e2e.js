// End-to-end-verifiering i en riktig webbläsare mot den körande stacken.
// Ingår INTE i tests/run.sh — puppeteer drar ner en egen Chromium (~170 MB).
//
//   docker compose up -d
//   npm install puppeteer          # en gång, valfri katalog
//   node tests/test_e2e.js
//
// Kollar det som bara syns i en browser: att CSP:n inte blockerar Plotly,
// att charten faktiskt ritas, att omladdning inte ger en ny gissning, att
// ett trasigt pussel ger felmeddelande i stället för vit ruta, och att
// mobilvyn inte scrollar i sidled.
const puppeteer = require("puppeteer");

const BASE = process.env.CHARTLE_URL || "http://127.0.0.1:8137";
const problems = [];
const log = (...a) => console.log(...a);

function watch(page, label) {
  // "404"-sidan matar avsiktligt fram fel — där är felen själva testet.
  const expectErrors = label === "404";
  page.on("console", (m) => {
    const t = m.text();
    if (expectErrors && !/Refused to|Content Security Policy/i.test(t)) return;
    if (m.type() === "error" || /Refused to|Content Security Policy/i.test(t))
      problems.push(`[${label}] console: ${t}`);
  });
  page.on("pageerror", (e) => problems.push(`[${label}] pageerror: ${e.message}`));
  page.on("requestfailed", (r) =>
    problems.push(`[${label}] requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  page.on("response", (r) => {
    if (r.status() >= 400 && !(expectErrors && r.url().includes("/puzzles/")))
      problems.push(`[${label}] ${r.status()} ${r.url()}`);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  // ---- 1. Desktop: laddning, CSP, Plotly ----
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  watch(page, "desktop");
  // OBS: inte evaluateOnNewDocument — den körs även vid reload och hade
  // rensat state mitt i testet av "omladdning ger ingen ny gissning".
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE, { waitUntil: "networkidle0" });

  const chart = await page.evaluate(() => {
    const el = document.querySelector("#chart");
    return {
      hasPlotly: typeof window.Plotly !== "undefined",
      hasGame: typeof window.ChartleGame !== "undefined",
      svgCount: el.querySelectorAll("svg").length,
      candles: el.querySelectorAll(".cartesianlayer .trace path.box").length,
      bars: el.querySelectorAll(".cartesianlayer g.points path").length,
      maLines: el.querySelectorAll(".cartesianlayer .scatterlayer .trace .js-line").length,
      legend: [...el.querySelectorAll(".legendtext")].map((n) => n.textContent),
      puzzleNo: document.querySelector("#puzzle-no").textContent,
      noticeHidden: document.querySelector("#notice").classList.contains("hidden"),
    };
  });
  log("1. Rendering:", JSON.stringify(chart, null, 2));
  if (!chart.hasPlotly) problems.push("Plotly laddades inte");
  if (!chart.hasGame) problems.push("ChartleGame laddades inte");
  if (chart.candles !== 60) problems.push(`Förväntade 60 candles, fick ${chart.candles}`);
  if (chart.maLines < 2) problems.push(`Förväntade 2 MA-linjer, fick ${chart.maLines}`);

  // ---- 2. Spela en runda ----
  await page.click("#btn-long");
  await page.waitForSelector("#round-result:not(.hidden)", { timeout: 15000 });
  const round1 = await page.evaluate(() => ({
    score: document.querySelector("#result-score").textContent,
    facit: document.querySelector("#result-facit").textContent,
    candles: document.querySelectorAll("#chart .cartesianlayer .trace path.box").length,
    next: document.querySelector("#btn-next").textContent,
    stored: JSON.parse(localStorage.getItem("chartle")),
  }));
  log("\n2. Efter runda 1:", round1.score, "|", round1.next);
  log("   facit:", round1.facit.slice(0, 110));
  log("   candles efter utspelning:", round1.candles);
  if (round1.candles !== 70) problems.push(`Utspelningen ritade ${round1.candles}/70 candles`);
  const dayKey = Object.keys(round1.stored.days)[0];
  if (round1.stored.days[dayKey].rounds.length !== 1)
    problems.push("Rundan sparades inte i localStorage");

  // ---- 3. Omladdning mitt i dagen ger ingen ny gissning ----
  await page.reload({ waitUntil: "networkidle0" });
  const afterReload = await page.evaluate(() => ({
    roundNo: document.querySelector("#round-no").textContent,
    rounds: JSON.parse(localStorage.getItem("chartle")).days[
      Object.keys(JSON.parse(localStorage.getItem("chartle")).days)[0]].rounds.length,
    controlsVisible: !document.querySelector("#controls").classList.contains("hidden"),
  }));
  log("\n3. Efter omladdning: runda", afterReload.roundNo, "| sparade rundor:", afterReload.rounds);
  if (afterReload.rounds !== 1) problems.push("Omladdning ändrade antalet spelade rundor");
  if (afterReload.roundNo !== "2") problems.push(`Efter omladdning visas runda ${afterReload.roundNo}, väntade 2`);

  // ---- 4. Spela klart dagen ----
  for (let i = 2; i <= 5; i++) {
    await page.waitForSelector("#controls:not(.hidden)", { timeout: 10000 });
    await page.click(i % 2 ? "#btn-short" : "#btn-pass");
    await page.waitForSelector("#round-result:not(.hidden)", { timeout: 15000 });
    await page.click("#btn-next");
    await sleep(400);
  }
  await page.waitForSelector("#day-summary:not(.hidden)", { timeout: 10000 });
  const summary = await page.evaluate(() => ({
    emoji: document.querySelector("#summary-emoji").textContent,
    total: document.querySelector("#summary-r").textContent,
    lbVisible: !!document.querySelector("#lb-list"),
    state: JSON.parse(localStorage.getItem("chartle")),
  }));
  log("\n4. Dagens resultat:", summary.emoji, summary.total);
  log("   streak:", summary.state.streak, "| totalR:", summary.state.totalR,
      "| playerId:", summary.state.playerId?.slice(0, 8));
  if (summary.emoji.split(" ").filter(Boolean).length !== 5)
    problems.push(`Emoji-raden har ${summary.emoji.split(" ").length} tecken, väntade 5`);
  if (!summary.state.playerId) problems.push("playerId saknas");

  // ---- 5. Leaderboard laddar ----
  await sleep(1200);
  const lb = await page.evaluate(() => document.querySelector("#lb-list").textContent.trim());
  log("\n5. Leaderboard:", lb.slice(0, 90));

  // ---- 6. Trasigt pussel ger felmeddelande, inte vit ruta ----
  const broken = await browser.newPage();
  watch(broken, "404");
  await broken.setRequestInterception(true);
  broken.on("request", (r) =>
    r.url().includes("/puzzles/") ? r.respond({ status: 404, body: "nope" }) : r.continue());
  await broken.goto(BASE, { waitUntil: "networkidle0" });
  await sleep(800);
  const errText = await broken.evaluate(() => ({
    chart: document.querySelector("#chart").textContent.trim(),
    controlsHidden: document.querySelector("#controls").classList.contains("hidden"),
  }));
  log("\n6. Vid 404:", JSON.stringify(errText));
  if (!errText.chart.includes("Kunde inte ladda")) problems.push("404 gav inget felmeddelande");
  if (!errText.controlsHidden) problems.push("Knapparna syns fortfarande efter laddningsfel");

  // ---- 7. Skräp i ?p= ----
  const junk = await browser.newPage();
  watch(junk, "?p=abc");
  await junk.goto(`${BASE}/?p=abc`, { waitUntil: "networkidle0" });
  await sleep(800);
  const junkOk = await junk.evaluate(() =>
    document.querySelectorAll("#chart .cartesianlayer .trace path.box").length);
  log("7. ?p=abc ritade candles:", junkOk);
  if (junkOk !== 60) problems.push(`?p=abc ritade ${junkOk} candles`);

  // ---- 8. Mobil ----
  const mob = await browser.newPage();
  watch(mob, "mobil");
  await mob.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await mob.goto(BASE, { waitUntil: "domcontentloaded" });
  await mob.evaluate(() => localStorage.clear());
  await mob.goto(BASE, { waitUntil: "networkidle0" });
  await sleep(600);
  const mobile = await mob.evaluate(() => {
    const c = document.querySelector("#chart");
    return {
      chartWidth: c.getBoundingClientRect().width,
      chartHeight: Math.round(c.getBoundingClientRect().height),
      bodyScrollsSideways: document.documentElement.scrollWidth > window.innerWidth + 1,
      candles: c.querySelectorAll(".cartesianlayer .trace path.box").length,
    };
  });
  log("8. Mobil 390px:", JSON.stringify(mobile));
  if (mobile.bodyScrollsSideways) problems.push("Sidan scrollar i sidled på mobil");
  if (mobile.chartHeight !== 340) problems.push(`Mobil charthöjd ${mobile.chartHeight}, väntade 340`);
  if (process.env.CHARTLE_SCREENSHOTS) {
    await mob.screenshot({ path: "mobil.png" });
    await page.screenshot({ path: "desktop.png", fullPage: true });
  }

  await browser.close();

  log("\n" + "=".repeat(60));
  if (problems.length) {
    log(`PROBLEM (${problems.length}):`);
    problems.forEach((p) => log("  ✗ " + p));
    process.exit(1);
  }
  log("Allt grönt — inga CSP-fel, inga konsolfel, spelflödet fungerar.");
})();
