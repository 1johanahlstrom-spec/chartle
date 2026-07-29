// End-to-end-verifiering i en riktig webbläsare mot den körande stacken.
// Ingår INTE i tests/run.sh — puppeteer drar ner en egen Chromium (~170 MB).
//
//   docker compose up -d
//   npm install puppeteer          # en gång, valfri katalog
//   node tests/test_e2e.js
//
// Kollar det som bara syns i en browser: att CSP:n inte blockerar Plotly,
// att charten faktiskt ritas, att omladdning inte ger en ny gissning, att
// ett trasigt pussel ger felmeddelande i stället för vit ruta, att
// mobilvyn inte scrollar i sidled, och att schemamigreringen v2 → v3 av
// riktig localStorage ger rätt statistik.
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
    // Rundhistoriken: en rad per spelad runda, med ticker och R.
    history: [...document.querySelectorAll("#round-history tr")].map((tr) =>
      [...tr.querySelectorAll("td")].map((td) => td.textContent)),
  }));
  log("\n4. Dagens resultat:", summary.emoji, summary.total);
  log("   streak:", summary.state.streak, "| totalR:", summary.state.totalR,
      "| playerId:", summary.state.playerId?.slice(0, 8));
  if (summary.emoji.split(" ").filter(Boolean).length !== 5)
    problems.push(`Emoji-raden har ${summary.emoji.split(" ").length} tecken, väntade 5`);
  if (!summary.state.playerId) problems.push("playerId saknas");

  // ---- 4b. Rundhistorik: emoji-raden ska gå att tyda ----
  log("   rundhistorik:");
  summary.history.forEach((row) => log("     " + row.join("  ")));
  if (summary.history.length !== 5)
    problems.push(`Rundhistoriken har ${summary.history.length} rader, väntade 5`);
  // Ticker sparas på rundan vid beslutet — saknas den visas "—", vilket
  // betyder att fältet inte skrevs och historiken efter omladdning blir tom.
  const missingTicker = summary.history.filter((row) => !row[2] || row[2] === "—");
  if (missingTicker.length)
    problems.push(`${missingTicker.length} rundor saknar ticker i historiken`);
  const storedRounds = summary.state.days[Object.keys(summary.state.days)[0]].rounds;
  if (!storedRounds.every((r) => r.ticker && r.year))
    problems.push("ticker/year sparades inte på rundorna i localStorage");
  // Historikens R-kolumn måste matcha det som faktiskt räknades.
  summary.history.forEach((row, i) => {
    const shown = parseFloat(row[4]);
    if (Math.abs(shown - storedRounds[i].r) > 0.06)
      problems.push(`Runda ${i + 1}: historiken visar ${row[4]}, sparat ${storedRounds[i].r}R`);
  });

  // ---- 4c. Statistikpanelen ----
  if (summary.state.v !== 3) problems.push(`state.v är ${summary.state.v}, väntade 3`);
  await page.click("#btn-stats");
  await page.waitForSelector("#stats-backdrop:not(.hidden)", { timeout: 5000 });
  const stats = await page.evaluate(() => ({
    tiles: [...document.querySelectorAll(".stat-tile")].map((t) => [
      t.querySelector(".stat-label").textContent,
      t.querySelector(".stat-value").textContent,
    ]),
    choiceRows: [...document.querySelectorAll("#stats-choices tr")].slice(1).map((tr) =>
      [...tr.querySelectorAll("td")].map((td) => td.textContent)),
    note: document.querySelector("#stats-note").textContent,
    emptyHidden: document.querySelector("#stats-empty").classList.contains("hidden"),
    stored: JSON.parse(localStorage.getItem("chartle")).stats,
  }));
  log("\n4c. Statistik:", JSON.stringify(stats.tiles), "|", stats.note);
  stats.choiceRows.forEach((row) => log("     " + row.join("  ")));
  if (stats.tiles.length !== 6) problems.push(`Statistiken visar ${stats.tiles.length} rutor, väntade 6`);
  if (!stats.emptyHidden) problems.push("Tomtexten visas trots en spelad dag");
  if (stats.stored.days !== 1) problems.push(`stats.days är ${stats.stored.days}, väntade 1`);
  // Summan av rundornas val måste stämma med ROUNDS — annars tappas rundor
  // i aggregeringen och statistiken glider tyst isär från spelhistoriken.
  const counted = ["long", "short", "pass"].reduce((s, c) => s + stats.stored.choices[c].n, 0);
  if (counted !== 5) problems.push(`Statistiken räknade ${counted} rundor, väntade 5`);
  if (stats.choiceRows.length !== 3)
    problems.push(`Valtabellen har ${stats.choiceRows.length} rader, väntade 3`);
  // Avstå ger alltid 0R — träff och snitt ska vara utelämnade, inte "0%".
  const passRow = stats.choiceRows[2];
  if (passRow[2] !== "—" || passRow[3] !== "—")
    problems.push(`Avstå-raden visar ${passRow[2]}/${passRow[3]}, väntade —/—`);

  if (process.env.CHARTLE_SCREENSHOTS) await page.screenshot({ path: "statistik.png" });
  await page.keyboard.press("Escape");
  await sleep(200);
  const closed = await page.evaluate(() =>
    document.querySelector("#stats-backdrop").classList.contains("hidden"));
  log("   stängs med Escape:", closed);
  if (!closed) problems.push("Escape stängde inte statistikpanelen");

  // ---- 4d. Tangentbord, skip och övningsläge ----
  // Körs i övningsläge så att dagens sparade resultat inte påverkas. Pussel
  // 1246 är GME-squeezen 2021-02-23 (+449 % på tio dagar) — samma pussel som
  // avslöjade att serverns gamla MAX_DAY_R på 40 avvisade ärliga resultat.
  const kb = await browser.newPage();
  watch(kb, "tangentbord");
  // localStorage delas mellan alla sidor på samma origin — utan en rensning
  // här ser övningsläget dagen som huvudsidan redan spelat, och kontrollen
  // "övningsläget sparar inget" blir meningslös.
  await kb.goto(`${BASE}/?p=1246`, { waitUntil: "domcontentloaded" });
  await kb.evaluate(() => localStorage.clear());
  await kb.goto(`${BASE}/?p=1246`, { waitUntil: "networkidle0" });
  await sleep(600);
  const practiceUi = await kb.evaluate(() => ({
    banner: !document.querySelector("#practice-banner").classList.contains("hidden"),
    puzzleNo: document.querySelector("#puzzle-no").textContent,
    shortcuts: !!document.querySelector("#shortcuts"),
  }));
  log("\n4d. Övningsläge:", JSON.stringify(practiceUi));
  if (!practiceUi.banner) problems.push("Övningsbannern visas inte i ?p=-läget");

  await kb.keyboard.press("1");                    // 1 = 2 % stop
  const stopAfterKey = await kb.evaluate(() =>
    document.querySelector(".stop-btn.selected").dataset.stop);
  log("   tangent 1 valde stop:", stopAfterKey + "%");
  if (stopAfterKey !== "2") problems.push(`Tangent 1 gav stop ${stopAfterKey}%, väntade 2%`);

  const started = Date.now();
  await kb.keyboard.press("l");                    // l = long
  await sleep(300);                                // låt utspelningen komma igång
  await kb.keyboard.press("Space");                // hoppa över resten
  await kb.waitForSelector("#round-result:not(.hidden)", { timeout: 5000 });
  const skipped = Date.now() - started;
  const afterSkip = await kb.evaluate(() => ({
    score: document.querySelector("#result-score").textContent,
    candles: document.querySelectorAll("#chart .cartesianlayer .trace path.box").length,
    stored: localStorage.getItem("chartle"),
  }));
  log("   long via tangent, skip efter", skipped, "ms →", afterSkip.score);
  log("   candles efter skip:", afterSkip.candles);
  // Full utspelning är 10 × 200 ms. Skip ska korta det rejält men ändå rita ut allt.
  if (skipped > 1500) problems.push(`Skip tog ${skipped} ms — utspelningen avbröts inte`);
  if (afterSkip.candles !== 70) problems.push(`Efter skip ritades ${afterSkip.candles}/70 candles`);
  // 2 %-stop på ett +449 %-utfall ger okappat +224.5R. MAX_R kapar vid +10R —
  // det är hela poängen med capen, så den siffran bevakas här.
  if (!afterSkip.score.includes("+10.0R"))
    problems.push(`Väntade +10.0R (capad) på pussel 1246, fick "${afterSkip.score}"`);
  // Övningsläget får aldrig skriva speldata.
  const practiceState = JSON.parse(afterSkip.stored || "{}");
  if (Object.keys(practiceState.days || {}).length)
    problems.push("Övningsläget sparade en spelad dag");

  // ---- 5. Leaderboard: alla tre flikarna laddar ----
  // Steg 4d öppnade en ny flik, så den här sidan ligger i bakgrunden. page.click
  // väntar på en rAF-baserad stabilitetskoll, och requestAnimationFrame stryps
  // i dolda flikar — utan bringToFront hänger klicket tills protocolTimeout.
  await page.bringToFront();
  await sleep(1200);
  const lb = await page.evaluate(() => document.querySelector("#lb-list").textContent.trim());
  log("\n5. Leaderboard (Idag):", lb.slice(0, 90));

  for (const tab of ["total", "average"]) {
    await page.click(`.lb-tab[data-tab="${tab}"]`);
    await sleep(900);
    const view = await page.evaluate(() => ({
      text: document.querySelector("#lb-list").textContent.trim(),
      label: document.querySelector(".lb-tab.selected").textContent,
    }));
    log(`   ${view.label}:`, view.text.slice(0, 90));
    // "Kunde inte ladda listan" betyder att endpointen saknas eller svarar fel.
    if (view.text.includes("Kunde inte ladda"))
      problems.push(`Fliken ${tab} kunde inte hämta sin lista`);
  }
  await page.click('.lb-tab[data-tab="today"]');

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

  // ---- 9. Migrering v2 → v3 av befintligt localStorage ----
  // Måste köras i browsern: migreringen ligger i app.js modulnivå och beror på
  // att den körs FÖRE pruneDays. Ett enhetstest av statsFromDays fångar inte
  // ordningen.
  const mig = await browser.newPage();
  watch(mig, "migrering");
  await mig.goto(BASE, { waitUntil: "domcontentloaded" });
  await mig.evaluate(() => {
    const round = (choice, r) => ({ choice, stopPct: 5, r, stopped: false });
    localStorage.setItem("chartle", JSON.stringify({
      v: 2, totalR: 12.5, streak: 3, lastPlayedDay: 1,
      playerId: "11111111-1111-4111-8111-111111111111",
      days: {
        1: {                                   // klar dag: +2 +1 +0 -1 +3 = +5R
          rounds: [round("long", 2), round("short", 1), round("pass", 0),
                   round("long", -1), round("long", 3)],
        },
        2: { rounds: [round("long", -1), round("pass", 0)] },   // halvspelad
      },
    }));
  });
  await mig.goto(BASE, { waitUntil: "networkidle0" });
  await sleep(600);
  const migrated = await mig.evaluate(() => JSON.parse(localStorage.getItem("chartle")));
  log("\n9. Migrering v2 → v3:", JSON.stringify(migrated.stats));
  if (migrated.v !== 3) problems.push(`Migreringen gav v=${migrated.v}, väntade 3`);
  if (migrated.stats.days !== 1)
    problems.push(`Migreringen räknade ${migrated.stats.days} dagar, väntade 1 (halvspelad dag ska hoppas över)`);
  if (migrated.stats.sumR !== 5) problems.push(`stats.sumR är ${migrated.stats.sumR}, väntade 5`);
  if (migrated.stats.bestDay !== 5) problems.push(`stats.bestDay är ${migrated.stats.bestDay}, väntade 5`);
  if (migrated.stats.maxStreak !== 3)
    problems.push(`maxStreak är ${migrated.stats.maxStreak}, väntade 3 (befintlig streak ska seedas)`);
  if (migrated.stats.choices.long.n !== 3 || migrated.stats.choices.long.wins !== 2)
    problems.push(`long räknades som ${JSON.stringify(migrated.stats.choices.long)}, väntade n=3 wins=2`);
  // Livstidssumman får inte röras av migreringen.
  if (migrated.totalR !== 12.5) problems.push(`totalR ändrades till ${migrated.totalR}, väntade 12.5`);
  // Historiken för v2-rundor saknar ticker — får inte krascha, ska visa "—".
  const legacy = await mig.evaluate(() => {
    document.querySelector("#btn-stats").click();
    const tiles = document.querySelectorAll(".stat-tile").length;
    document.querySelector("#btn-stats-close").click();
    return tiles;
  });
  if (legacy !== 6) problems.push(`Statistik efter migrering visade ${legacy} rutor, väntade 6`);

  await browser.close();

  log("\n" + "=".repeat(60));
  if (problems.length) {
    log(`PROBLEM (${problems.length}):`);
    problems.forEach((p) => log("  ✗ " + p));
    process.exit(1);
  }
  log("Allt grönt — inga CSP-fel, inga konsolfel, spelflödet fungerar.");
})();
