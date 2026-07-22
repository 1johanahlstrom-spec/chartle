# Kodgranskning inför driftsättning — Chartle

> **Status 2026-07-22: åtgärdad.** Alla måste- och bör-punkter är fixade, plus
> fem av sex kan-vänta-punkter och ett fynd som dök upp först när testerna
> skrevs (se "Nytt fynd" nedan). Texten under beskriver problemen **som de såg
> ut vid granskningen** — den är alltså en historik, inte en beskrivning av
> koden idag. Kvarstående punkter listas sist i det här avsnittet.

## Åtgärdsstatus

| # | Fynd | Status |
|---|---|---|
| 1 | Dygnsgräns i lokal tid | ✅ `stockholmDayIndex` i `docs/game.js`, spegel i `server/app.py` |
| 2 | Ingen felhantering vid pusselladdning | ✅ try/catch + `showLoadError`, NaN-guard i `puzzleFileIndex` |
| 3 | `build_puzzles.py` raderar allt först | ✅ staging-katalog + `CHARTLE_ALLOW_REBUILD`-spärr |
| 4 | `fetch_data.py` korrumperar rådata | ✅ 90 %-tröskel, atomär skrivning, try/except |
| 5 | Leaderboarden helt förfalskningsbar | ⚠️ Delvis — se "Kvarstående" |
| 6 | Delningslänk till nedlagd sajt | ✅ `SHARE_URL` i config, fallback = sidans egen adress |
| 7 | Pusslen börjar om 2027-07-05 | ✅ Notis i UI + dokumenterat, testat |
| 8 | Facit och morgondagens pussel läckbara | ❌ Kräver server-API — se "Kvarstående" |
| 9 | `entryPrice` orimligt för gamla pussel | ✅ Priset utelämnas under $1, annars märkt "justerat" |
| 10 | Plotly från CDN, ingen CSP | ✅ Självhostad i `docs/vendor/`, CSP i `Caddyfile` |
| 11 | Ingen cache-busting | ✅ `?v=3` + Cache-Control per filtyp |
| 12 | `playerId` kan bli undefined | ✅ `newPlayerId()` med UUIDv4-fallback |
| 13 | Leaderboard saknar felhantering | ✅ try/catch/finally, knappen låser sig inte |
| 14 | `state.days` växer obegränsat | ✅ `pruneDays`, 30 dagar |
| 15 | Hårdkodade relativa sökvägar | ✅ Allt ankrat i `Path(__file__)` |
| 16 | Ingen automatisk backup | ✅ Cron-rad dokumenterad i README |
| 17 | Inga tester för spellogiken | ✅ 14 JS-test × 4 tidszoner + 17 Python-test |
| 18 | `meta.answer` oanvänd | ❌ Kan inte tas bort utan ombyggnad — se "Kvarstående" |
| 19 | Luckor inuti fönstret | ✅ `MAX_GAP_DAYS` i `build_puzzles.py` |
| 20 | Docker-härdning | ✅ `read_only`, `tmpfs`, `no-new-privileges`, minne, loggrotation |
| 21 | `total_leaderboard` subquery | ➖ Lämnad — korrekt och oproblematisk i den här skalan |
| 22 | Volym kan överskrida 100 | ➖ Lämnad — avsiktligt, avslöjar inget |
| 23 | `structuredClone` per bildruta | ➖ Lämnad medvetet: att återanvända layout-objektet låter Plotly ackumulera mutationer mellan bildrutor. Vinsten är omätbar, risken verklig |

## Nytt fynd som upptäcktes under fixarbetet

**Två pussel innehöll en ojusterad 2:1-split — pussel 1480 hade inverterat facit.**

Splittestet jag skrev för att bevaka `auto_adjust=True` hittade två MCD-fönster
där Yahoo saknar splitdata (deras historik är ofullständig för 1960-talet).
Båda splitarna låg i **utfallsdelen**, så charten såg normal ut när spelaren
valde och "kraschade" sedan 50 % under utspelningen:

| Pussel | Ticker | Facit före | Verklig rörelse |
|---|---|---|---|
| 1480 | MCD 1968-05-16 | short, −46,2 % | **+7,6 % (long)** |
| 1482 | MCD 1969-06-09 | short, −52,1 % | −4,3 % |

Pussel 1480 straffade alltså den som läste charten rätt. Lagade med
`pipeline/repair_splits.py` (×2 på candles efter spliten, volym ÷2, `fwdRetPct`
och `answer` omräknade). Efter korrigering återstår inga dag-till-dag-rörelser
över 7,1 % respektive 5,5 %, och OHLC-konsistensen är verifierad.

Ombyggnad var inte möjlig: `rawdata.pkl` är gitignorerad och saknas lokalt, och
en ombyggnad hade numrerat om alla 1825 pussel.

**Detta bör du dubbelkolla:** jag drog slutsatsen 2:1 från kvoterna 2,029 och
2,0037 plus MCD:s kända splithistorik — inte från en extern källa. Verifiera
gärna McDonald's split-datum 1968 och 1969 innan du litar helt på siffrorna.

## Kvarstående

- **Fynd 5 och 8 är samma underliggande sak:** klienten äger både facit och
  poängen. Spärrarna som lagts in (poängtak ±40R, dagen måste ha inträffat,
  10 inskick/timme/IP) stoppar de billiga attackerna, men den som vill fuska
  kan fortfarande göra det, och `?p=` visar fortfarande morgondagens chart.
  Riktig lösning: servern levererar de 60 synliga candlesen, tar emot
  gissningen och skickar utfallet först därefter. Det är ett eget projekt.
- **Fynd 18:** `meta.answer` kan inte tas bort utan att bygga om pusslen, vilket
  numrerar om dem. Fältet är kosmetiskt — poängen räknas alltid från prisserien
  — och bevakas nu av ett test som kräver att riktningen stämmer.
- ~~**Ingen browser-verifiering.**~~ ✅ Klart. `tests/test_e2e.js` kör hela
  spelet i en riktig Chromium mot Caddy-stacken och verifierar: inga
  CSP-överträdelser, Plotly ritar 60 candles + MA10/MA20, utspelningen ritar
  alla 70, omladdning mitt i dagen ger ingen ny gissning (runda 2, 1 sparad
  runda), 404 ger felmeddelande i stället för vit ruta, `?p=abc` ritar ett
  giltigt pussel, och mobil 390 px scrollar inte i sidled. Testet hittade en
  saknad favicon (404 vid varje sidladdning) — åtgärdad med `docs/favicon.svg`.

---

Granskad commit: `6427623` (branch `main`, 2026-07-22).
Omfattning: `docs/` (frontend), `docs/puzzles/` (1825 JSON), `pipeline/`,
`server/`, `compose.yaml`, `Caddyfile`, `tests/`.

Ingen kod har ändrats. Radnummer refererar till filerna som de ser ut nu.

---

## Sammanfattning

Grunden är sund. Pipelinen använder `auto_adjust=True`, så split- och
utdelningsproblemet du oroade dig för finns faktiskt **inte** — inga falska
krascher mitt i graferna. MA-beräkningen läcker inte framtida data.
Poänglogiken (`computeR`) hanterar gap förbi stoppen korrekt. API:t validerar
sin indata ordentligt och kör som icke-root i containern.

Det som stoppar driftsättning är fem saker: dygnsgränsen följer enhetens
lokala klocka, pusselladdningen saknar all felhantering, ombyggnadsskriptet
kan förstöra både rådata och de publicerade pusslen, leaderboarden går att
förfalska helt fritt, och delningslänken pekar på en sajt du lagt ner.

| Nivå | Antal fynd |
|---|---|
| Måste fixas före driftsättning | 6 |
| Bör fixas | 11 |
| Kan vänta | 6 |

---

# 🔴 Måste fixas före driftsättning

## 1. Dygnsgränsen är enhetens lokala midnatt — inte samma pussel för alla

**Fil:** `docs/app.js:12–15`

```js
const now = new Date();
const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
const dayIndex = Math.floor((todayUTC - EPOCH) / 86400000);
```

**Vad problemet är.** Namnet `todayUTC` lurar dig. `now.getFullYear()`,
`getMonth()` och `getDate()` returnerar datumet i **enhetens lokala tidszon**.
Att sedan stoppa in dem i `Date.UTC()` gör inte om dem till UTC — det bygger
bara en tidsstämpel av de lokala datumsiffrorna. Resultatet är att dygnet byts
vid lokal midnatt, olika för varje spelare.

Jag verifierade det med den faktiska klockan just nu:

| Tidszon | Lokal tid | dayIndex |
|---|---|---|
| Pacific/Auckland | 2026-07-23 05:05 | **18** |
| Europe/Stockholm | 2026-07-22 19:05 | 17 |
| UTC | 2026-07-22 17:05 | 17 |
| America/Los_Angeles | 2026-07-22 10:05 | 17 |

**Varför det spelar roll.** Tre konsekvenser:

1. README:s löfte "alla spelare får samma pussel" håller inte. En spelare i
   Nya Zeeland spelar Chartle #19 medan du spelar #18, och deras delade
   emoji-rad matchar inte din.
2. Leaderboarden blandar ihop dygnen. `submitScore` skickar `day: puzzleNo`
   (`app.js:337`) — klientens uppfattning om vilken dag det är. "Idag"-listan
   innehåller alltså folk från olika kalenderdygn.
3. **Klockan är fritt manipulerbar.** Vem som helst kan ställa fram
   systemklockan, spela morgondagens fem rundor, ställa tillbaka och spela
   igen. Streaken och Σ-poängen bygger helt på detta värde.

Punkt 3 kan du inte lösa helt utan serverstöd, men punkt 1 och 2 löser du
genom att bestämma **en** tidszon för hela spelet. Wordle använder lokal
midnatt medvetet; du har en leaderboard, så du vill ha en fast gräns.

**Åtgärd.** Räkna dagen i svensk tid oavsett var spelaren sitter:

```js
const EPOCH_DAYS = Math.floor(Date.UTC(2026, 6, 5) / 86400000);

// Dagens datum i Europe/Stockholm — samma svar för alla spelare i världen.
function stockholmDayIndex(at = new Date()) {
  const [{ value: y }, , { value: m }, , { value: d }] =
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Stockholm",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(at);
  return Math.floor(Date.UTC(+y, +m - 1, +d) / 86400000) - EPOCH_DAYS;
}

const dayIndex = stockholmDayIndex();
const puzzleNo = dayIndex + 1;
```

`Intl.DateTimeFormat` med `timeZone` finns i alla webbläsare du behöver bry
dig om och sköter sommartid åt dig.

Låt dessutom servern avvisa poäng för dagar som inte finns än — se fynd 5.

---

## 2. Ingen felhantering när ett pussel inte kan laddas — spelet blir en vit ruta

**Fil:** `docs/app.js:259–262` och `docs/app.js:24`

```js
async function loadRound(round) {
  const resp = await fetch(`puzzles/${fileIndexFor(round)}.json`);
  puzzle = await resp.json();
  meta = JSON.parse(atob(puzzle.meta));
```

**Vad problemet är.** `resp.ok` kontrolleras aldrig. Vid 404 eller
nätverksfel returnerar Caddy en HTML-sida, `resp.json()` kastar ett
`SyntaxError`, och eftersom `loadRound` anropas utan `.catch()` blir det ett
obehandlat promise-fel. Spelaren ser en tom sida utan felmeddelande och utan
sätt att komma vidare.

Samma funktion har en garanterad krasch via övningsläget. `?p=abc` ger:

```js
parseInt("abc", 10)                        // NaN
((NaN % 1825) + 1825) % 1825               // NaN
fetch("puzzles/NaN.json")                  // 404
```

**Varför det spelar roll.** Det här är inte teoretiskt. En spelare på
mobilnätet som tappar täckning mitt i runda 3, en felstavad länk som någon
delar, eller en halvklar `docker compose up` — alla ger samma vita ruta.
Värre: raden `d.rounds.push(round)` (`app.js:232`) körs *innan* laddningen,
så om runda 4 inte laddas sitter spelaren fast med en dag som varken kan
spelas klart eller skickas in.

**Åtgärd.** Validera indexet och visa ett riktigt fel:

```js
function fileIndexFor(round) {
  const raw = practice ? parseInt(params.get("p"), 10) : dayIndex * ROUNDS + round;
  if (!Number.isFinite(raw)) return 0;              // ?p=abc → pussel 0
  return ((raw % TOTAL_PUZZLES) + TOTAL_PUZZLES) % TOTAL_PUZZLES;
}

async function loadRound(round) {
  try {
    const resp = await fetch(`puzzles/${fileIndexFor(round)}.json`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    puzzle = await resp.json();
    meta = JSON.parse(atob(puzzle.meta));
  } catch (err) {
    $("chart").innerHTML =
      "<p class='lb-loading'>Kunde inte ladda charten. " +
      "Kontrollera nätverket och ladda om sidan.</p>";
    console.error("loadRound misslyckades:", err);
    return;
  }
  drawChart(puzzle.visible);
  document.querySelectorAll(".decision, .stop-btn").forEach(b => b.disabled = false);
  $("round-result").classList.add("hidden");
  $("day-summary").classList.add("hidden");
  $("controls").classList.remove("hidden");
  updateHeader();
}
```

Anropen i `init()` (`app.js:404`, `414`) och i `btn-next` (`app.js:276`) bör
också få `.catch(console.error)`.

---

## 3. `build_puzzles.py` raderar alla publicerade pussel innan den skriver nya

**Fil:** `pipeline/build_puzzles.py:127–130`

```python
outdir = Path("../docs/puzzles")
outdir.mkdir(parents=True, exist_ok=True)
for f in outdir.glob("*.json"):
    f.unlink()
```

**Vad problemet är.** Två separata risker i fyra rader.

*Risk A — halvskriven katalog.* Alla 1825 filer raderas först, sedan skrivs
nya en i taget i loopen på rad 132–160. Kraschar loopen (slut på disk,
Ctrl-C, ett oväntat `KeyError`) står du med en delvis tömd `docs/puzzles/` som
Caddy serverar direkt. Spelet går sönder för alla, och du har ingen kopia.

*Risk B — omnumrering.* Detta är den allvarligare. `random.Random(42).shuffle`
på rad 125 är deterministisk *givet samma kandidatlista*. Men kandidatlistan
beror på `rawdata.pkl`. Kör du om `fetch_data.py` — mer data, en avnoterad
ticker, en justerad utdelningsserie — ändras listan, och shuffle ger en helt
ny ordning. Pussel 90 blir ett annat chart.

Din egen `CLAUDE.md` säger: *"Ändra ALDRIG epoch eller pusselordningen efter
lansering."* Skriptet har inget som helst skydd mot att göra just det. Det är
ett kommando från fel katalog bort.

**Varför det spelar roll.** Efter lansering betyder omnumrering att spelare
som redan spelat får se om gamla charts, och att den delade emoji-raden för
"Chartle #12" betyder olika saker för olika personer beroende på när de
laddade sidan.

**Åtgärd.** Skriv till en temporär katalog och byt först när allt lyckats, och
vägra skriva över ett befintligt set utan uttryckligt medgivande:

```python
import os, shutil, sys

outdir = Path("../docs/puzzles")
existing = sorted(outdir.glob("*.json")) if outdir.exists() else []
if existing and os.environ.get("CHARTLE_ALLOW_REBUILD") != "1":
    sys.exit(
        f"AVBRYTER: {len(existing)} pussel finns redan i {outdir.resolve()}.\n"
        "Att bygga om numrerar om alla pussel och bryter epoken för spelare "
        "som redan börjat.\n"
        "Sätt CHARTLE_ALLOW_REBUILD=1 om du verkligen menar det."
    )

staging = outdir.parent / "puzzles.new"
shutil.rmtree(staging, ignore_errors=True)
staging.mkdir(parents=True)

for idx, cand in enumerate(chosen):
    ...
    (staging / f"{idx}.json").write_text(json.dumps(puzzle, separators=(",", ":")))

# Allt skrevs utan fel — byt in det nya settet i ett steg.
shutil.rmtree(outdir, ignore_errors=True)
staging.rename(outdir)
```

Överväg också att checka in `docs/puzzles/` under en tagg (`git tag
puzzles-v1`) så att du alltid kan återställa exakt det set spelarna ser.

---

## 4. `fetch_data.py` skriver över rådatan även när nedladdningen misslyckats delvis

**Fil:** `pipeline/fetch_data.py:54–77`, med följdfel i `pipeline/build_puzzles.py:38`

```python
data = yf.download(tickers, start="1962-01-01", end="2024-12-31", ...)
if data.empty:
    sys.exit(1)

ok, failed = [], []
for t in tickers:
    ...
if failed:
    print(f"MISSLYCKADES: {failed}")      # <- bara en utskrift

data.to_pickle("rawdata.pkl")             # <- skriver ändå
```

**Vad problemet är.** Skriptet räknar korrekt ut vilka tickers som saknar
data, skriver ut dem — och sparar sedan resultatet ändå. Enda avbrottet är om
*hela* nedladdningen är tom. Går 40 av 85 tickers sönder (Yahoo strular,
nätverket hackar, fler bolag avnoteras som WBA och SQ) skrivs din fungerande
`rawdata.pkl` över med ett stympat dataset. Filen är gitignorerad
(`.gitignore:3`), så det finns ingen kopia att gå tillbaka till.

**Följdfelet:** `build_puzzles.py:31–38` läser `categories.pkl` och itererar
över **alla** tickers, inte bara de som lyckades:

```python
categories = pd.read_pickle("categories.pkl")
ticker_cat = {t: cat for cat, ts in categories.items() for t in ts}
tickers = sorted(ticker_cat)
for ticker in tickers:
    df = data[ticker].dropna(how="all")   # KeyError om tickern saknas helt
```

En saknad ticker ger `KeyError` — och eftersom `MIN_LEVELS`-filtret bara
gäller enskilda fönster kan färre tickers dessutom göra att `assert
len(chosen) == 1825` på rad 122 slår till, vilket kraschar bygget.

**Varför det spelar roll.** Det bryter mot exakt det du efterfrågade: att
fetch-scriptet ska gå att köra om utan att korrumpera befintlig data. Just nu
är varje omkörning en chansning med din enda datakälla.

**Åtgärd.** Kräv en miniminivå av lyckade tickers, spara bara de som faktiskt
gick igenom, och skriv atomärt:

```python
MIN_OK = int(len(tickers) * 0.9)

ok, failed = [], []
for t in tickers:
    if t in data.columns.get_level_values(0):
        if len(data[t].dropna(how="all")) > 100:
            ok.append(t)
            continue
    failed.append(t)

print(f"OK: {len(ok)}/{len(tickers)} tickers")
if failed:
    print(f"MISSLYCKADES: {failed}")

if len(ok) < MIN_OK:
    sys.exit(
        f"AVBRYTER: bara {len(ok)} av {len(tickers)} tickers gav data "
        f"(kräver minst {MIN_OK}). rawdata.pkl lämnas orörd."
    )

# Spara bara kolumner som verkligen har data, och bara kategorier för dessa.
data = data[ok]
categories_ok = {cat: [t for t in ts if t in ok] for cat, ts in CATEGORIES.items()}

# Atomär skrivning: krasch mitt i lämnar den gamla filen intakt.
Path("rawdata.pkl.tmp").unlink(missing_ok=True)
data.to_pickle("rawdata.pkl.tmp")
pd.to_pickle(categories_ok, "categories.pkl.tmp")
Path("rawdata.pkl.tmp").replace("rawdata.pkl")
Path("categories.pkl.tmp").replace("categories.pkl")
print(f"Klart! Sparat {len(ok)} tickers till rawdata.pkl")
```

Lägg dessutom till en `try/except` runt själva `yf.download` — yfinance kastar
nätverksundantag som just nu tar ner skriptet med en stack trace.

---

## 5. Leaderboarden litar helt på klienten — vem som helst kan skicka in vad som helst

**Fil:** `server/app.py:63–99` och `server/app.py:174–193`, klient `docs/app.js:327–353`

**Vad problemet är.** `clean_score` validerar *formatet* på indata mycket bra
— typer, UUID, namnlängd, ändliga tal, intervall. Men den validerar aldrig att
poängen faktiskt är *spelad*. Servern ser aldrig ett pussel, en gissning eller
ett stop. Den tar emot ett tal och lagrar det.

Med Tailscale Funnel ligger endpointen på öppna internet. Detta räcker för att
toppa listan:

```bash
curl -X POST https://serverjohan.tail8248b9.ts.net:10000/api/scores \
  -H 'Content-Type: application/json' \
  -d '{"day":18,"player_id":"11111111-1111-4111-8111-111111111111",
       "name":"Toppen","day_r":100}'
```

Tre separata luckor:

- **`day_r` är godtyckligt.** Taket är `100` (`app.py:87`), inte något som
  följer av spelet. Max realistisk dagspoäng är 5 rundor à några R.
- **`player_id` väljs av klienten.** `UNIQUE (day, player_id)` (`app.py:44`)
  hindrar bara dubbletter från *samma* UUID. Ett nytt `uuid4()` per anrop ger
  obegränsat många rader. Ingen rate limiting finns.
- **`day` valideras bara mot `>= 1`** (`app.py:68`). Man kan fylla listan för
  dag 5000 innan den dagen ens finns.

**Varför det spelar roll.** En leaderboard som går att förfalska på tio
sekunder är sämre än ingen leaderboard — den gör att ärliga spelare slutar
bry sig. Databasen kan dessutom fyllas obegränsat av ett enkelt skript, och
volymen `chartle_data` ligger på din hemmaserver.

**Åtgärd.** Full fusksäkerhet kräver att servern äger facit och räknar poängen
— det är ett större omtag. Innan lansering räcker det att stänga de billiga
attackerna:

```python
import datetime, time
from collections import defaultdict

EPOCH_DATE = datetime.date(2026, 7, 5)
MAX_DAY_R = 40.0            # 5 rundor × realistiskt tak
STOCKHOLM = datetime.timezone(datetime.timedelta(hours=1))   # eller zoneinfo

def current_puzzle_no() -> int:
    today = datetime.datetime.now(STOCKHOLM).date()
    return (today - EPOCH_DATE).days + 1

def clean_score(payload):
    ...
    # Dagen måste vara en dag som faktiskt inträffat (±1 för tidszonsglapp).
    if not 1 <= day <= current_puzzle_no() + 1:
        raise ValueError("Ogiltig dag")
    ...
    if not -MAX_DAY_R <= day_r <= MAX_DAY_R:
        raise ValueError("Ogiltig poäng")
    return day, player_id, name, day_r


# Enkel rate limiting per IP i ChartleHandler.do_POST
_recent: dict[str, list[float]] = defaultdict(list)
_recent_lock = threading.Lock()
RATE_LIMIT, RATE_WINDOW = 10, 3600     # 10 inskick per timme och IP

def rate_limited(ip: str) -> bool:
    now = time.monotonic()
    with _recent_lock:
        hits = [t for t in _recent[ip] if now - t < RATE_WINDOW]
        _recent[ip] = hits + [now]
        return len(hits) >= RATE_LIMIT
```

och i `do_POST`, direkt efter path-kontrollen:

```python
if rate_limited(self.client_address[0]):
    self.send_json(429, {"error": "För många inskick — försök senare"})
    return
```

Obs: bakom Caddy blir `self.client_address[0]` containerns IP. Låt Caddy
skicka vidare klientens adress:

```
handle /api/* {
	reverse_proxy api:8080 {
		header_up X-Real-IP {remote_host}
	}
}
```

och läs `self.headers.get("X-Real-IP") or self.client_address[0]`. Räkna med
att detta bara höjer ribban — det stoppar inte en motiverad fuskare.

---

## 6. Delningslänken pekar på en sajt som inte längre finns

**Fil:** `docs/app.js:296`

```js
return txt + "\nhttps://1johanahlstrom-spec.github.io/chartle/";
```

**Vad problemet är.** README:118–120 säger att GitHub Pages-flödet är
borttaget och att appen numera publiceras från din egen server. Men varje
delat resultat innehåller fortfarande den gamla adressen.

**Varför det spelar roll.** Delningen är hela spridningsmekanismen i ett
Wordle-liknande spel. Varje person som klickar på länken hamnar på en död
sida eller på en gammal version av spelet — med en annan pusseluppsättning än
den mottagaren just läste om.

**Åtgärd.** Lägg adressen i `docs/config.js` så att den följer miljön, och
använd sidans egen adress som fallback:

```js
// docs/config.js
window.CHARTLE_CONFIG = {
  LEADERBOARD_ENABLED: true,
  API_BASE: "",
  SHARE_URL: "https://serverjohan.tail8248b9.ts.net:10000/",
};
```

```js
// docs/app.js
const shareUrl = LB.SHARE_URL || location.origin + location.pathname;
return txt + "\n" + shareUrl;
```

Kontrollera samtidigt att Tailscale Funnel-adressen är den du vill sprida —
den innehåller ditt tailnet-namn och går inte att byta utan att alla delade
länkar dör.

---

# 🟡 Bör fixas

## 7. Pusslen tar slut och börjar om 2027-07-05

**Fil:** `docs/app.js:6, 25`

`TOTAL_PUZZLES = 1825` och `(dayIndex * ROUNDS + round) % TOTAL_PUZZLES`. Vid
`dayIndex = 365` blir `365 * 5 = 1825`, `% 1825 = 0` — exakt tillbaka till
pussel 0. Spelet spelar om hela året i samma ordning, tyst.

Det är matematiskt rent (ingen hoppning, inga fel upprepningar inom året), men
efter 2027-07-05 får återkommande spelare charts de redan sett medan
leaderboarden fortsätter räkna som vanligt. Sätt en påminnelse och bygg ut
till fler pussel i god tid, eller visa ett meddelande när `dayIndex >= 365`.

## 8. Facit ligger i klienten, och morgondagens pussel går att spela i förväg

**Fil:** `docs/puzzles/*.json`, `docs/app.js:24, 262`

Du beskriver base64-kodningen som medveten lätt obfuskering, och det är ett
rimligt val — men var medveten om exakt hur mycket som ligger öppet:

- `atob(puzzle.meta)` i konsolen ger ticker, datum, `entryPrice`, `fwdRetPct`
  och `answer`.
- **Även utan `meta` finns svaret i klartext.** Arrayerna `o/h/l/c/v` är 70
  element långa medan `visible` är 60 — de tio utfallsdagarna skickas alltid
  med i samma fil som spelaren får innan hen gissat. Det går inte att undvika
  utan ett server-API.
- Filnamnen är förutsägbara. Imorgon är `dayIndex = 18`, alltså filerna
  90–94. `?p=90` visar exakt morgondagens första chart, med facit, utan att
  röra streaken (`app.js:229–230`).

Om leaderboarden ska betyda något på sikt är riktiga lösningen att servern
levererar de 60 synliga candlesen, tar emot gissningen, och först därefter
skickar utfallet. Fram till dess: acceptera det, men skriv inte ut i README
att resultaten är fusksäkra.

## 9. `entryPrice` är splitjusterat och blir orimligt i facit

**Fil:** `pipeline/build_puzzles.py:90`, visas i `docs/app.js:199`

Facit-texten säger *"beslutsdagen var 1962-08-31 vid kursen $0.09"*. Jag
kontrollerade de äldsta pusslen i det byggda settet:

```
XOM 1962-08-31  $0.09
KO  1963-05-21  $0.04
GE  1963-01-25  $0.67
```

99 pussel ligger före 1975. Priserna är korrekt split- och utdelningsjusterade
(vilket är rätt för charten — det är därför du slipper falska krascher), men
som "kursen den dagen" är de nonsens. XOM handlades inte för nio cent 1962.

Antingen ta bort priset ur facit för gamla pussel, eller skriv ut det som
justerat: `"(justerat pris, $0.09)"`. Ett alternativ är att spara även det
ojusterade priset i pipelinen (`auto_adjust=False` i ett andra anrop) enbart
för facit-texten.

## 10. Plotly laddas från CDN utan integritetskontroll eller reservplan

**Fil:** `docs/index.html:8`

```html
<script src="https://cdn.plot.ly/plotly-2.35.2.min.js" charset="utf-8"></script>
```

Hela spelet är utan funktion om `cdn.plot.ly` är nere eller blockerat, och det
finns ingen `integrity`-attribut som skyddar mot att den levererade filen byts
ut. Eftersom du ändå kör egen server och redan monterar `docs/` — ladda ner
filen till `docs/vendor/plotly-2.35.2.min.js` och servera den själv. Det tar
bort ett externt beroende, gör appen offlinekapabel på ditt LAN, och
möjliggör en striktare CSP.

Lägg samtidigt till en CSP i `Caddyfile:13–17`:

```
header {
	Referrer-Policy "strict-origin-when-cross-origin"
	X-Content-Type-Options "nosniff"
	X-Frame-Options "DENY"
	Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'"
}
```

(Denna CSP fungerar först när Plotly serveras lokalt.)

## 11. Ingen cache-busting — spelare fastnar på gammal `app.js`

**Fil:** `Caddyfile:8–11`, `docs/index.html:73–74`

`file_server` sätter `ETag` men ingen `Cache-Control`. Webbläsare får då själva
gissa hur länge `app.js` och `config.js` ska cachas. Efter en `docker compose
up -d --build` kan spelare köra vidare på gammal kod i timmar — vilket är
extra obehagligt om du precis fixat dygnsgränsen i fynd 1.

Versionera skriptet vid varje deploy:

```html
<script src="config.js?v=2"></script>
<script src="app.js?v=2"></script>
```

och sätt olika cachetider för kod och pussel i `Caddyfile`:

```
@puzzles path /puzzles/*
header @puzzles Cache-Control "public, max-age=31536000, immutable"
header /*.js Cache-Control "no-cache"
header /*.css Cache-Control "no-cache"
```

Pusselfilerna ändras aldrig (givet fynd 3), så de kan cachas hårt — det gör
spelet snabbare också.

## 12. `playerId` kan bli `undefined` och inskicket misslyckas tyst

**Fil:** `docs/app.js:42`

```js
if (!state.playerId && crypto.randomUUID) state.playerId = crypto.randomUUID();
```

Saknas `crypto.randomUUID` (icke-säker kontext, äldre webbläsare) hoppas
tilldelningen tyst över. Sedan skickas `player_id: undefined` (`app.js:338`),
JSON-serialiseras bort helt, och servern svarar 400 "Ogiltigt spelar-id" —
medan spelaren bara ser "Kunde inte skicka in". Ge den en reservväg:

```js
function newPlayerId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
if (!state.playerId) state.playerId = newPlayerId();
```

## 13. Leaderboard-anropen saknar felhantering

**Fil:** `docs/app.js:327–353, 355–379`

`submitScore` och `renderLeaderboard` anropar `lbRequest` utan `try/catch`.
Vid nätverksfel kastar `fetch` direkt, och i `submitScore` sker det efter att
knappen satts `disabled = true` (`app.js:333`) — knappen förblir grå för
alltid och spelaren kan inte försöka igen utan omladdning. Packa in båda i
`try/catch` och återaktivera knappen i en `finally`.

## 14. `state.days` växer obegränsat i localStorage

**Fil:** `docs/app.js:40, 44–47`

Varje spelad dag lägger till en nyckel i `state.days` som aldrig städas. Efter
ett år är det 365 objekt med fem rundor styck. localStorage-taket (~5 MB) nås
inte, men det är onödigt — och `loadState` har ingen hantering för det fall
att `setItem` kastar `QuotaExceededError`. Behåll t.ex. de senaste 30 dagarna
vid inläsning; totalsumman ligger ändå i `state.totalR`.

## 15. Hårdkodade relativa sökvägar i pipelinen

**Fil:** `pipeline/fetch_data.py:75–76`, `pipeline/build_puzzles.py:31–32, 127`

`pd.read_pickle("rawdata.pkl")` och `Path("../docs/puzzles")` fungerar bara om
du står i `pipeline/`. Kör du `python3 pipeline/build_puzzles.py` från
projektroten får du `FileNotFoundError` — eller värre, skriver till fel
katalog. Ankra i filens plats:

```python
ROOT = Path(__file__).resolve().parent.parent
data = pd.read_pickle(ROOT / "pipeline" / "rawdata.pkl")
outdir = ROOT / "docs" / "puzzles"
```

## 16. Ingen automatisk backup av leaderboard-databasen

**Fil:** `README.md:114–122`, `compose.yaml:26–27`

Backup-proceduren är dokumenterad och korrekt (`sqlite3.backup()` är rätt sätt
med WAL), men den är manuell. Volymen `chartle_data` är den enda kopian av
allas resultat. Lägg in den som en cron-rad på servern:

```cron
15 4 * * * cd /sokvag/till/chartle && docker compose exec -T api python -c \
  'import sqlite3; s=sqlite3.connect("/data/chartle.db"); d=sqlite3.connect("/data/backup.db"); s.backup(d); d.close(); s.close()' \
  && docker compose cp api:/data/backup.db /sokvag/till/backup/chartle-$(date +\%F).db
```

**Angående din fråga om cron för fetch-scriptet:** det behövs inte. Pusslen är
förbyggda och statiska — `fetch_data.py` och `build_puzzles.py` körs en gång
lokalt, aldrig på servern. Det enda återkommande jobbet du behöver är denna
backup. Det är en styrka i arkitekturen; se till att README säger det
uttryckligen så att inte framtida-du sätter upp en onödig cron som råkar
trigga fynd 3.

## 17. Inga tester för pusselval eller rättning

**Fil:** `tests/test_api.py` (enda testfilen)

De fyra API-testerna är bra skrivna — isolerad temp-databas, tydliga namn,
täcker sortering, namnuppdatering, dubbletter och validering. Men all logik
som faktiskt avgör spelet (`fileIndexFor`, `computeR`, `sma`) är otestad. Se
förslag längst ner.

---

# 🟢 Kan vänta

## 18. `meta.answer` beräknas men används aldrig

`build_puzzles.py:151` sätter `"answer": cand["label"]` (long/short/neutral
enligt ±5 %-trösklarna på rad 67–81). Frontend läser aldrig fältet — poängen
räknas om från grunden i `computeR` (`app.js:140`) med stop-nivåer. Två
parallella definitioner av "rätt svar" som kan glida isär: ett pussel märkt
`long` kan mycket väl ge −1R för en long som stoppas ut. Antingen ta bort
fältet eller använd det till statistik ("42 % valde rätt riktning").

## 19. Luckor *inuti* fönstret upptäcks inte

`build_puzzles.py:58–59` kontrollerar bara total kalenderspännvidd
(`span > WINDOW * 2.2`, ca 98 dagar för 70 handelsdagar). Ett bolag som var
handelsstoppat tre veckor mitt i fönstret passerar om resten är tät. Sällsynt,
och likviditetsfiltren fångar det mesta. Kan förfinas med en kontroll av
största avstånd mellan två på varandra följande datum.

## 20. Docker-härdning

`compose.yaml` kan stramas åt: `read_only: true` på `api` (den skriver bara i
`/data`), `tmpfs: /tmp`, `mem_limit`, och `logging` med `max-size` så att
loggarna inte fyller disken över tid. `restart: unless-stopped` är redan rätt
val. Dockerfile är redan bra — icke-root, minimal Alpine-bas, inga onödiga
lager.

## 21. `total_leaderboard` gör en subquery per spelare

`server/app.py:123–129` kör en korrelerad subquery för att hitta senaste
namnet. Helt oproblematiskt vid din skala (tiotals spelare), men blir O(n²) om
listan växer. En `players`-tabell med namnet vore renare den dagen det behövs.

## 22. Volymstaplarnas skala kan överskrida 100

`build_puzzles.py:157` normaliserar volym mot högsta *synliga* volym. En
utfallsdag med rekordvolym ger då en stapel över 100. Plotly autoskalar
y-axeln så det ser bra ut, och skalan avslöjar inget före reveal — men det är
värt att veta att `v` inte är begränsad till 0–100.

## 23. `structuredClone` av layouten vid varje ruta i animationen

`app.js:123` klonar `CHART_LAYOUT` en gång per `drawChart`, och animationen
(`app.js:249–256`) anropar den tio gånger med 200 ms mellanrum. Försumbart,
men layouten är konstant och kunde klonas en gång.

---

# Föreslagna testfall

Logiken i `fileIndexFor` och `computeR` är spelets kärna och helt otestad. Ett
`tests/test_game.js` som körs med `node --test` räcker — bryt först ut
funktionerna till en fil som både `app.js` och testet kan läsa, eller
duplicera dem i testet som en start.

**1. Dygnsgränsen vid midnatt (täcker fynd 1)**
Anropa dagindex-funktionen med samma tidsstämpel — `2026-07-22T22:30:00Z` —
under `TZ=Pacific/Auckland`, `TZ=Europe/Stockholm` och `TZ=America/Los_Angeles`.
Alla tre måste ge samma `dayIndex`. Testa också exakt `2026-07-22T21:59:59Z`
och `2026-07-22T22:00:01Z` (svensk midnatt sommartid) och kontrollera att
indexet ökar med precis 1 över gränsen. Det här testet **failar på dagens
kod** — skriv det först, fixa sedan.

**2. Pusselordningen hoppar inte och upprepar inte fel**
För `dayIndex` 0 till 364, samla alla `fileIndexFor(r)` för `r` 0–4. Kontrollera
att resultatet är exakt mängden 0–1824, var och en precis en gång. Kontrollera
sedan att `dayIndex = 365` ger `[0,1,2,3,4]` — dokumentera därmed
årsvarvningen från fynd 7. Testa också att negativa `dayIndex` (spelare med
felställd klocka före epoken) ger ett giltigt index i 0–1824, inte `NaN` eller
negativt.

**3. Dag utan data / trasigt pussel (täcker fynd 2)**
Låt `fetch` returnera 404, och separat ett svar med ogiltig JSON. Verifiera att
`loadRound` inte kastar ett obehandlat fel och att ett felmeddelande hamnar i
DOM:en. Testa även `?p=abc`, `?p=-5` och `?p=99999` — alla ska ge ett giltigt
pussel eller ett rent felmeddelande, aldrig `puzzles/NaN.json`.

**4. Rättning: gap förbi stoppen fyller på open**
Konstruera ett pussel där `visible = 60`, entry = 100, stop 5 % (stopnivå 95),
och där candle 60 har `open = 90` och `low = 88`. En long ska ge exakt
`(90 − 100) / 5 = −2.0R`, inte `−1R` — alltså att gap-grenen (`app.js:146–147`)
vinner över intraday-grenen (`app.js:148–149`). Spegelvänt för short med
`open = 110`. Lägg till ett fall där stoppen nås exakt (`low = 95.0`) och ska
ge `−1R`, och ett där inget stop nås och exit sker på `c[69]`.

**5. Split i fönstret ger ingen falsk krasch**
Ta ett pussel med känd split i intervallet — t.ex. NVDA:s 10:1 i juni 2024
eller AAPL:s 7:1 i juni 2014 — och verifiera att ingen dag-till-dag-förändring
i `c` överstiger säg 40 %. Detta testar att `auto_adjust=True`
(`fetch_data.py:55`) faktiskt gör sitt jobb, och larmar om någon råkar ändra
flaggan. Kör det som ett pytest över alla 1825 byggda JSON-filer — det är
snabbt och fångar hela kategorin trasig data på en gång.

---

# Vad som redan fungerar bra

Värt att säga uttryckligen, eftersom flera av dina uttalade farhågor visade
sig vara obefogade:

- **Splits och utdelningar är korrekt hanterade.** `auto_adjust=True`
  (`fetch_data.py:55`) justerar OHLC fullt ut. Ingen split ser ut som en
  krasch. Det var rätt val och är gjort rätt.
- **MA-beräkningen läcker inte framtiden.** `sma()` matas med
  `puzzle.c.slice(0, n)` (`app.js:94, 110, 115`), och `null` för de första
  (period−1) punkterna gör att Plotly inte ritar ofullständiga linjer. Precis
  som `CLAUDE.md` föreskriver.
- **En omladdning ger ingen ny gissning.** `d.rounds.push(round)` följt av
  `saveState()` (`app.js:232, 241`) sker direkt vid beslutet, före
  animationen. `init()` (`app.js:402–416`) läser tillbaka rätt antal rundor.
  Fungerar som avsett — det enda som återställer är att rensa localStorage.
- **Gap-hanteringen i `computeR` är korrekt.** Att kolla `open` före `low`
  (`app.js:146–149`) ger rätt fyllnadspris och tillåter utfall sämre än −1R,
  vilket matchar verkligheten.
- **Mobilrendering ser bra ut.** `responsive: true` (`app.js:125`),
  `fixedrange` på båda axlarna, `dragmode: false` och en media query som
  sänker chart-höjden till 340 px under 480 px (`style.css:279–281`). Rimliga
  val för touch.
- **API:ts indatavalidering är gedigen** för sitt syfte — typkontroller som
  avvisar `bool` (Python-fällan där `True == 1`), UUID-parsning,
  normalisering av whitespace i namn, `math.isfinite`, kontrollteckenfilter
  och CHECK-constraints även i schemat. Det enda som saknas är att validera
  att poängen är *spelad* (fynd 5).
- **XSS är korrekt undviket i leaderboarden.** `renderLeaderboard`
  (`app.js:374`) bygger celler med `textContent`, inte `innerHTML`, så
  spelarnamn kan inte injicera markup.
- **Dockerfile är välbyggd** — icke-root-användare, minimal bas, inga
  onödiga lager, korrekt `EXPOSE`. API-porten publiceras inte utåt utan nås
  bara via Caddy på det interna nätverket, och `docs/` monteras read-only.
