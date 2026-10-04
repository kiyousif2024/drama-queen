// Drama Queen service worker: makes the public website work offline and installable.
// build_db.py --site replaces BUILD with the build time, so each publish gets fresh caches.
const BUILD = "2026-10-04T12:35:36Z";
const SHELL = `dq-shell-${BUILD}`;
const DATA = `dq-data-${BUILD}`;
const SHELL_FILES = ["./", "index.html", "config.js", "plays.js", "manifest.webmanifest",
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
  if (url.pathname.includes("/data/") || url.pathname.endsWith("plays.json")) {
    // Data: answer from the cache at once, refresh it in the background.
    event.respondWith(caches.open(DATA).then(async (cache) => {
      const hit = await cache.match(req);
      const fresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; });
      return hit || fresh;
    }));
    return;
  }
  // Pages, scripts and icons: the network first, so a new version shows at once; the cache when offline.
  event.respondWith(fetch(req).then((res) => {
    if (res.ok) caches.open(SHELL).then((c) => c.put(req, res.clone()));
    return res;
  }).catch(() => caches.match(req).then((hit) => hit || caches.match("index.html"))));
});
