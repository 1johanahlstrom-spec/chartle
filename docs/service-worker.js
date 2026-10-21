// Cacheversionen MÅSTE matcha ?v= i index.html. tests/test_contract.py vaktar
// att de inte glider isär — en glömd bump är annars osynlig tills någon kör
// gammal kod mot ett nytt API.
const CACHE = "chartle-v9";
const APP_SHELL = [
  "./",
  "style.css?v=9",
  "config.js?v=9",
  "game.js?v=9",
  "app.js?v=9",
  "pwa.js?v=9",
  "favicon.svg",
  "icon-192.png",
  "icon-512.png",
  "manifest.webmanifest",
  "vendor/plotly-2.35.2.min.js",
];

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      // En full kvot ska inte göra ett lyckat nätvarv till ett fel — spelet
      // fungerar även om just den här filen inte kunde sparas offline.
      await cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // HTML hämtas från nätet först så en deploy syns direkt. Vid avbrott finns
  // det senast installerade appskalet kvar.
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request).catch(() => caches.match("./")));
    return;
  }

  // Pussel och vendor-filer är oföränderliga under sin URL (pusslen är
  // versionsstämplade med ?v=, se game.js) och kan därför cachas först.
  if (url.pathname.startsWith("/puzzles/") || url.pathname.startsWith("/vendor/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Egen kod får ALDRIG serveras cache-first: då fortsätter en installerad app
  // att köra förra deployens app.js fast Caddy svarar no-cache. Nätet först,
  // cachen bara som reserv när nätet är borta.
  if (/\.(?:js|css)$/.test(url.pathname) || url.pathname === "/manifest.webmanifest") {
    event.respondWith(networkFirst(request));
    return;
  }

  // Ikoner, favicon och annat statiskt.
  event.respondWith(cacheFirst(request));
});

// Klienten skickar dagens fem URL:er efter registrering. Då går hela dagens
// spel att slutföra offline, inte bara de rundor som redan hunnit öppnas.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "CACHE_PUZZLES" || !Array.isArray(event.data.urls)) return;
  const scope = new URL(self.registration.scope);
  const urls = event.data.urls.flatMap((raw) => {
    try {
      const url = new URL(raw, scope);
      // Query-strängen (pusselsetets version) behålls med flit: annars
      // förhämtas en annan URL än app.js faktiskt hämtar.
      return url.origin === scope.origin && /^\/puzzles\/\d+\.json$/.test(url.pathname)
        ? [url.href]
        : [];
    } catch {
      return [];
    }
  });
  // Ett trasigt pussel får inte hindra de övriga fyra från att bli offlinebara.
  event.waitUntil(caches.open(CACHE).then((cache) =>
    Promise.allSettled(urls.map((url) => cache.add(url)))));
});
