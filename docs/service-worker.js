const CACHE = "chartle-v8";
const APP_SHELL = [
  "./",
  "style.css?v=8",
  "config.js?v=8",
  "game.js?v=8",
  "app.js?v=8",
  "pwa.js?v=8",
  "favicon.svg",
  "icon-192.png",
  "icon-512.png",
  "manifest.webmanifest",
  "vendor/plotly-2.35.2.min.js",
];

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
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) caches.open(CACHE).then((cache) => cache.put("./", response.clone()));
          return response;
        })
        .catch(() => caches.match("./"))
    );
    return;
  }

  // Statiska filer och spelade pussel sparas när de används.
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
      return response;
    }))
  );
});

// Klienten skickar dagens fem URL:er efter registrering. Då går hela dagens
// spel att slutföra offline, inte bara de rundor som redan hunnit öppnas.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "CACHE_PUZZLES" || !Array.isArray(event.data.urls)) return;
  const scope = new URL(self.registration.scope);
  const urls = event.data.urls
    .filter((url) => /^puzzles\/\d+\.json$/.test(url))
    .map((url) => new URL(url, scope).href);
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(urls)));
});
