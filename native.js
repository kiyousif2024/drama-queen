// Billd inside the iPhone and Android apps (Capacitor), and the same calls on the website.
//
// The apps carry the website's own files (app/scripts/assemble.mjs); this file is where the two
// differ. Everything is feature-detected: on the website window.Capacitor doesn't exist, isApp is
// false, and each call below does what the website always did (Web Share or copy the link, a file
// download, ordinary links), so the website behaves exactly as before.
//
// window.BilldNative:
//   isApp, platform                  "ios", "android" or "web"
//   publicUrl(hash)                  the https://billd.theater address of a page, to share or email
//   openExternal(url)                another website: the in-app browser in the app, a new tab on the web
//   share({ title, text, url })      the phone's share sheet; Web Share, or copy the link, on the web
//   saveFile(name, text, type)       a download on the web; the share sheet (save, open in Calendar…) in the app
//   prefs.get/set/remove             small values the app keeps even if the web view's storage is cleared
//   reminders                        local notifications ("Your show is tonight"), app only
//   catalogue                        the bundled catalogue, and newer copies downloaded from billd.theater
//   onAuthLink(fn), onResume(fn)     email sign-in links that opened the app; the app coming back to the front
//   push                             phase 2 (docs/app-build.md): not built yet
"use strict";
(function () {
  const C = window.Capacitor;
  const isApp = !!(C && typeof C.isNativePlatform === "function" && C.isNativePlatform());
  const platform = isApp ? (C.getPlatform ? C.getPlatform() : "native") : "web";
  const APP = (window.DQ_CONFIG || {}).app || {};
  const SITE = (APP.site || "https://billd.theater").replace(/\/$/, "");
  const DATA_URL = APP.dataUrl || SITE + "/data/";

  // native plugins, through Capacitor's runtime (capacitor.js, bundled in the app only)
  const cache = {};
  function plugin(name) {
    if (!isApp) return null;
    if (!(name in cache)) {
      try {
        cache[name] = (C.Plugins && C.Plugins[name]) || (C.registerPlugin && (!C.isPluginAvailable || C.isPluginAvailable(name)) ? C.registerPlugin(name) : null);
      } catch (e) { cache[name] = null; }
    }
    return cache[name];
  }
  const err = (message, code) => Object.assign(new Error(message), { code });

  // ---------------------------------------------------------------- addresses
  // In the app the page's own address is capacitor://localhost or https://localhost, which means
  // nothing to anyone else: shared and emailed links always name the public site.
  function publicUrl(hash) {
    const h = hash == null ? location.hash : hash;
    if (!isApp) return location.origin + location.pathname + (h || "");
    return SITE + "/" + (h && h !== "#" ? (h.startsWith("#") ? h : "#" + h) : "");
  }

  // ---------------------------------------------------------------- other websites
  async function openExternal(url) {
    const Browser = plugin("Browser");
    if (Browser) {
      try { await Browser.open({ url, toolbarColor: "#4a0f1c", presentationStyle: "popover" }); return; } catch (e) { /* fall through */ }
    }
    window.open(url, "_blank", "noopener");
  }
  if (isApp) {
    // Tickets, Wikipedia and sources open in the in-app browser, never in Billd's own window.
    // A link to billd.theater opens the page in the app instead.
    document.addEventListener("click", (e) => {
      const a = e.target.closest && e.target.closest("a[href]");
      if (!a || e.defaultPrevented || a.hasAttribute("download")) return;
      const href = a.getAttribute("href") || "";
      if (href.startsWith("#")) {
        // a page of Billd's own meant to open beside the current one (the Terms, from the sign-up box)
        if (a.target === "_blank") { e.preventDefault(); openExternal(SITE + "/" + href); }
        return;
      }
      if (!/^https?:\/\//i.test(href)) return;  // mailto:, tel: and the like: the phone handles them
      e.preventDefault();
      const u = new URL(href);
      if (u.origin === SITE && !u.pathname.startsWith("/auth/") && (u.pathname === "/" || u.pathname === "/index.html")) { location.hash = u.hash || "#/"; return; }
      openExternal(href);
    }, true);
  }

  // ---------------------------------------------------------------- share
  // Returns "shared", "copied", "cancelled" or "shown" (the link was shown to copy by hand).
  async function share({ title, text, url }) {
    const Share = plugin("Share");
    if (Share) {
      try { await Share.share({ title, text: text || title, url, dialogTitle: "Share" }); return "shared"; }
      catch (e) { if (/cancel/i.test(e && e.message)) return "cancelled"; /* else fall back to copying */ }
    }
    try { if (!isApp && navigator.share) { await navigator.share({ title, text, url }); return "shared"; } }
    catch (e) { if (e.name === "AbortError") return "cancelled"; }
    try { await navigator.clipboard.writeText(url); return "copied"; }
    catch (e) { window.prompt("Copy this link", url); return "shown"; }
  }

  // ---------------------------------------------------------------- files (.ics, data export)
  async function saveFile(name, text, type) {
    const Filesystem = plugin("Filesystem"), Share = plugin("Share");
    if (Filesystem && Share) {
      // the app can't "download": the file goes to the app's cache, then the share sheet offers
      // Calendar, Files, Mail and the rest
      const { uri } = await Filesystem.writeFile({ path: name, data: text, directory: "CACHE", encoding: "utf8" });
      try { await Share.share({ title: name, files: [uri], dialogTitle: name }); }
      catch (e) { if (/cancel/i.test(e && e.message)) return "cancelled"; throw e; }
      return "shared";
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return "downloaded";
  }

  // ---------------------------------------------------------------- small stored values
  // localStorage, mirrored in the app to Preferences (native storage the system doesn't clear
  // when it tidies web view data), so the offline diary and plans survive either way.
  const prefs = {
    get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
    set(key, value) {
      try { localStorage.setItem(key, value); } catch (e) { /* full or blocked */ }
      const P = plugin("Preferences"); if (P) P.set({ key, value }).catch(() => {});
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch (e) { /* blocked */ }
      const P = plugin("Preferences"); if (P) P.remove({ key }).catch(() => {});
    },
    // the native copy, for when the web view's storage came back empty
    async restore(key) {
      const P = plugin("Preferences"); if (!P) return null;
      try { const { value } = await P.get({ key }); if (value != null) { try { localStorage.setItem(key, value); } catch (e) { /* blocked */ } } return value; }
      catch (e) { return null; }
    },
  };

  // ---------------------------------------------------------------- reminders
  const LN = () => plugin("LocalNotifications");
  const reminders = {
    get available() { return !!LN(); },
    async schedule({ id, at, title, body, route }) {
      const L = LN(); if (!L) throw err("Reminders work in the Billd app.", "unsupported");
      if (!(at instanceof Date) || at.getTime() < Date.now() + 30000) throw err("That time has already passed.", "past");
      let p = await L.checkPermissions();
      if (p.display !== "granted") p = await L.requestPermissions();
      if (p.display !== "granted") throw err("Notifications are off for Billd. Turn them on in your phone's Settings to get reminders.", "denied");
      await L.schedule({ notifications: [{ id, title, body, schedule: { at, allowWhileIdle: true }, extra: { route: route || "" } }] });
    },
    async cancel(ids) { const L = LN(); if (L && ids.length) await L.cancel({ notifications: ids.map((id) => ({ id })) }).catch(() => {}); },
    async pending() { const L = LN(); if (!L) return []; try { return (await L.getPending()).notifications || []; } catch (e) { return []; } },
  };

  // ---------------------------------------------------------------- the catalogue
  // The app ships with the catalogue as it was when the app was built (data/, with version.json).
  // At launch, when online, it asks billd.theater whether a newer one is out (data/version.json,
  // a few bytes) and downloads it in the background into IndexedDB, all files or none. The next
  // launch uses it; the bundled copy stays as the fallback. Data only: never code.
  const DB = "billd-catalogue", STORE = "files";
  let dbp = null;
  function idb() {
    if (!dbp) dbp = new Promise((ok, fail) => {
      if (!window.indexedDB) return fail(err("No IndexedDB", "unsupported"));
      const r = indexedDB.open(DB, 2);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fail(r.error);
    });
    return dbp;
  }
  async function tx(mode, run) {
    const db = await idb();
    return new Promise((ok, fail) => {
      const t = db.transaction(STORE, mode), s = t.objectStore(STORE);
      let out; const req = run(s); if (req) req.onsuccess = () => (out = req.result);
      t.oncomplete = () => ok(out); t.onerror = () => fail(t.error); t.onabort = () => fail(t.error);
    });
  }
  const idbGet = (k) => tx("readonly", (s) => s.get(k));
  const idbPut = (k, v) => tx("readwrite", (s) => s.put(v, k));
  const idbKeys = () => tx("readonly", (s) => s.getAllKeys());
  const idbDel = (keys) => tx("readwrite", (s) => { keys.forEach((k) => s.delete(k)); });
  const getJSON = (url, opts) => fetch(url, opts).then((r) => { if (!r.ok) throw err(`${url}: ${r.status}`, "http"); return r.json(); });

  let using = null;  // the catalogue this session runs on: { generated, from: "bundled" | "downloaded" }
  const catalogue = {
    get using() { return using; },
    // the newer copy downloaded for the next launch, if any: { generated, files, at }
    downloaded: () => (isApp ? idbGet("ready").catch(() => null) : Promise.resolve(null)),
    // Where this session's data comes from: null means the files beside the page (the website, or
    // the app's bundled copy); otherwise { generated, json(path) } reading a downloaded copy.
    async source() {
      if (!isApp) return null;
      let bundled = null;
      try { bundled = await getJSON("data/version.json"); } catch (e) { /* an older build: no version file */ }
      using = { generated: bundled && bundled.generated, from: "bundled" };
      try {
        const ready = await idbGet("ready");
        if (ready && ready.generated && (!bundled || ready.generated > bundled.generated)) {
          const gen = ready.generated;
          using = { generated: gen, from: "downloaded" };
          return { generated: gen, json: async (path) => { const t = await idbGet(`${gen}/${path}`); if (t == null) throw err(`${path} missing`, "missing"); return JSON.parse(t); } };
        }
      } catch (e) { console.warn("catalogue: the downloaded copy can't be read; using the bundled one", e); }
      return null;
    },
    // Download a newer catalogue if billd.theater has one. Resolves with its build time, or null.
    async refresh({ force = false } = {}) {
      if (!isApp || !navigator.onLine) return null;
      const remote = await getJSON(DATA_URL + "version.json", { cache: "no-cache" });
      if (!remote || !remote.generated || !Array.isArray(remote.files)) return null;
      const ready = await idbGet("ready").catch(() => null);
      const have = [using && using.generated, ready && ready.generated].filter(Boolean).sort().pop() || "";
      if (remote.generated <= have) return null;
      // about 30 MB (much less over the wire, compressed): on a mobile connection, wait for Wi-Fi
      // unless the copy in use is over a month old or the member asked
      const Network = plugin("Network");
      if (!force && Network) {
        try {
          const st = await Network.getStatus();
          const ageDays = (Date.now() - Date.parse(have || 0)) / 864e5;
          if (st.connectionType === "cellular" && ageDays < 30) return null;
        } catch (e) { /* unknown: go ahead */ }
      }
      const gen = remote.generated;
      for (const path of remote.files) {
        if (!/^[a-z0-9_/.-]+\.json$/i.test(path) || path.includes("..")) throw err(`odd file name ${path}`, "bad_version");
        const r = await fetch(`${DATA_URL}${path}?v=${encodeURIComponent(gen)}`);
        if (!r.ok) throw err(`${path}: ${r.status}`, "http");
        const text = await r.text();
        if (path === "index.json" && JSON.parse(text).meta.generated !== gen) throw err("the site was publishing; try later", "changed");
        await idbPut(`${gen}/${path}`, text);
      }
      await idbPut("ready", { generated: gen, files: remote.files, at: new Date().toISOString() });
      // keep the copy in use this session and the new one; drop older downloads
      const keep = new Set([gen, using && using.generated].filter(Boolean));
      const old = (await idbKeys()).filter((k) => k !== "ready" && !keep.has(String(k).split("/")[0]));
      if (old.length) await idbDel(old);
      return gen;
    },
  };
  if (isApp && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // ---------------------------------------------------------------- app events
  const authHandlers = [], pendingLinks = [], resumeHandlers = [];
  function incoming(url) {
    let u; try { u = new URL(url); } catch (e) { return; }
    if (u.origin === SITE && u.pathname.startsWith("/auth/")) {
      if (authHandlers.length) authHandlers.forEach((f) => f(url)); else pendingLinks.push(url);
    } else if (u.origin === SITE) {
      location.hash = u.hash || "#/";
    }
  }
  function onAuthLink(f) { authHandlers.push(f); pendingLinks.splice(0).forEach((url) => f(url)); }
  function onResume(f) { resumeHandlers.push(f); }
  if (isApp) {
    const App = plugin("App");
    if (App) {
      App.addListener("appUrlOpen", (ev) => incoming(ev.url));
      App.getLaunchUrl().then((r) => { if (r && r.url) incoming(r.url); }).catch(() => {});
      App.addListener("resume", () => resumeHandlers.forEach((f) => { try { f(); } catch (e) { console.error(e); } }));
      // Android's back button: close an open window first, then go back, then leave the app
      App.addListener("backButton", (ev) => {
        const d = document.querySelector("dialog[open]");
        if (d) { d.close(); return; }
        if (ev.canGoBack && location.hash && location.hash !== "#/") history.back(); else App.minimizeApp().catch(() => App.exitApp());
      });
    }
    const L = LN();
    if (L) L.addListener("localNotificationActionPerformed", (ev) => {
      const route = ev && ev.notification && ev.notification.extra && ev.notification.extra.route;
      if (route && route.startsWith("#/")) location.hash = route;
    });
    const Splash = plugin("SplashScreen");
    if (Splash) window.addEventListener("load", () => setTimeout(() => Splash.hide().catch(() => {}), 150));
  }

  // ---------------------------------------------------------------- push (phase 2)
  // Push needs Apple's push key and a Firebase project (docs/app-build.md, "Push notifications").
  // Then: add @capacitor/push-notifications, register() here, save the token to a push_tokens
  // table, and add a Settings section for which notifications to get. Nothing calls this yet.
  const push = { available: false, async register() { return null; } };

  window.BilldNative = { isApp, platform, site: SITE, publicUrl, openExternal, share, saveFile, prefs, reminders, catalogue, onAuthLink, onResume, push };
})();
