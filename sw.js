// Billd service worker: makes the public website work offline and installable.
// build_db.py --site replaces BUILD with the build time, so each publish gets fresh caches.
const BUILD = "2026-10-04T20:45:46Z";
const SHELL = `billd-shell-${BUILD}`;
const DATA = `billd-data-${BUILD}`;
const SHELL_FILES = ["./", "index.html", "app.css", "app.js", "social.js", "config.js", "plays.js", "manifest.webmanifest",
                     "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("/data/index.json") || url.pathname.endsWith("plays.json")) {
    // The index: the network first, so a new publish shows at once; the cache when offline.
    // GitHub Pages lets browsers reuse files for 10 minutes; "no-cache" asks the server each time
    // (a quick "not modified" when nothing changed).
    event.respondWith(fetch(req, { cache: "no-cache" }).then((res) => {
      if (res.ok) { const copy = res.clone(); event.waitUntil(caches.open(DATA).then((c) => c.put(req, copy))); }
      return res;
    }).catch(() => caches.match(req)));
    return;
  }
  if (url.pathname.includes("/data/")) {
    // Shards are named with the build's date (?v=), so a cached copy is always the right one.
    event.respondWith(caches.open(DATA).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) event.waitUntil(cache.put(req, res.clone()));
      return res;
    }));
    return;
  }
  // Pages, scripts and icons: the network first, so a new version shows at once; the cache when offline.
  event.respondWith(fetch(req.mode === "navigate" ? req : new Request(req, { cache: "no-cache" })).then((res) => {
    if (res.ok) caches.open(SHELL).then((c) => c.put(req, res.clone()));
    return res;
  }).catch(() => caches.match(req).then((hit) => hit || caches.match("index.html"))));
});
