// Billd: the page. Plays come from the static data files (data/index.json and its
// shards, or plays.js when opened as a file); members, diaries, reviews and lists
// come from social.js. Pages are drawn from the address (#/play/…, #/u/…), so every
// page has a link that can be shared, and the back button works.
"use strict";
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fold = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const S = window.BilldSocial;
  const CFG = window.DQ_CONFIG || {};

  let D, works = [], byId = {}, trad = {}, reg = {}, lang = {}, ppl = {}, genre = {};
  let places = {}, venues = {}, orgs = {};
  let me = null, myStatus = {}, rated = {}, popular = {};

  // ---------------------------------------------------------------- formatting
  const TODAY = new Date().toISOString().slice(0, 10);  // UTC: for listings, checked in UTC
  // the visitor's own calendar date: an evening show in Los Angeles is logged on that day
  const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const THIS_YEAR = +TODAY.slice(0, 4);
  const fy = (y) => (y < 0 ? `${-y} BCE` : `${y}`);
  function fmtDate(w) {
    const a = w.year_from, b = w.year_to;
    if (a == null && b == null) return "";
    const c = w.date_certain ? "" : "c. ";
    if (a == null) return `before ${fy(b)}`;
    if (a === b || b == null) return c + fy(a);
    if (a < 0 && b < 0) return `${c}${-a}–${-b} BCE`;
    return `${c}${fy(a)}–${fy(b)}`;
  }
  const yearOf = (w) => w.year_from ?? w.year_to;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtPartial(d) {
    if (!d) return "";
    const m = /^(-?\d+)(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(d);
    if (!m) return d;
    const y = fy(parseInt(m[1], 10));
    if (m[3]) return `${parseInt(m[3], 10)} ${MONTHS[parseInt(m[2], 10) - 1]} ${y}`;
    if (m[2]) return `${MONTHS[parseInt(m[2], 10) - 1]} ${y}`;
    return y;
  }
  const stars = (r) => r ? "★".repeat(Math.floor(r / 2)) + (r % 2 ? "½" : "") : "";
  const starsLabel = (r) => r ? `${r / 2} ${r === 2 ? "star" : "stars"}` : "";
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  function ago(iso) {
    const s = (Date.parse(iso) - Date.now()) / 1000;
    for (const [u, n] of [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]]) {
      if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), u);
    }
    return "just now";
  }
  function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  const plural = (n, one, many = one + "s") => `${n.toLocaleString()} ${n === 1 ? one : many}`;
  const regionName = (id) => reg[id]?.name || id || "";
  const macroOf = (id) => { const r = reg[id]; return r ? (r.kind === "macro" ? r.id : r.parent || r.id) : "other"; };
  const MACRO_ORDER = ["europe", "mena", "south_asia", "east_asia", "southeast_asia", "africa", "north_america", "latin_america", "caribbean", "oceania"];
  const macroList = () => D.regions.filter((r) => r.kind === "macro")
    .sort((a, b) => (MACRO_ORDER.indexOf(a.id) + 1 || 99) - (MACRO_ORDER.indexOf(b.id) + 1 || 99));
  const sameTitle = (a, b) => fold(a) === fold(b);
  function writers(w) {
    const ws = w.people.filter((p) => p.role === "playwright" || p.role === "co-author");
    return ws.length ? ws : w.people;  // e.g. a musical credited only to its composer and lyricist
  }
  const byText = (w) => writers(w).map((p) => ppl[p.person]?.name || p.person).join(", ");
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    (document.querySelector("dialog[open]") || document.body).appendChild(t);  // modal dialogs sit above everything else
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2600);
  }
  function avatar(p, cls = "") {
    const name = p?.display_name || p?.username || "?";
    return `<a class="avatar ${cls}" href="#/u/${esc(p?.username || "")}" style="--hue:${hash(p?.username || "") % 360}" aria-label="${esc(name)}">${esc(name.trim()[0] || "?")}</a>`;
  }
  const who = (p) => esc(p?.display_name || p?.username || "Someone");
  const playUrl = (id) => "#/play/" + encodeURIComponent(id);

  // ---------------------------------------------------------------- data
  function load() {
    if (window.PLAYS_DATA) return Promise.resolve(window.PLAYS_DATA);
    const get = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
    return get("data/index.json").catch(() => get("plays.json"));
  }
  // The split site (build_db.py --site) ships a compact index and loads each play's
  // description and productions from a shard when the play is opened.
  function expandIndex(data) {
    const P = data.people.map((r) => ({ slug: r[0], name: r[1], name_native: r[2] ?? null, birth_year: r[3] ?? null, death_year: r[4] ?? null, dates_approx: !!r[5] }));
    data.people = P;
    data.works = data.works.map((c, i) => ({
      id: c.i, title: c.t, original_title: c.o || null, alt_titles: c.at || [],
      people: (c.p || []).map((x) => Array.isArray(x) ? { person: P[x[0]].slug, role: x[1], disputed: !!x[2] } : { person: P[x].slug, role: "playwright", disputed: false }),
      tradition: c.tr || null, tradition_rule: c.tl || null, languages: c.l || [], region: c.r || null,
      year_from: c.a ?? null, year_to: c.b ?? null, date_basis: c.db || null, era: c.e || "undated",
      genres: c.g || [], date_certain: !!c.c, attribution_disputed: !!c.d, source: c.s || "wikidata",
      ids: {}, notes: null, productions: [], _lazy: true, _shard: i % data.shards,
      _n: c.n || 0, _ds: c.ds || [],
      _runs: (c.ru || []).map((r) => ({ place: r[0] != null ? data.places[r[0]].id : null, district: r[1] || null, yf: r[2] ?? null, yt: r[3] ?? null,
                                         checked: r[4] || null, from: r[5] || null, to: r[6] || null })),
    }));
  }
  // A listed run is "now" or "soon" while its closing date has not passed and a live
  // listing confirmed it recently; older listings are not trusted.
  const STALE_DAYS = 45;
  function listingStatus(checked, from, to) {
    if (!checked) return null;
    if ((Date.parse(TODAY) - Date.parse(checked)) / 864e5 > STALE_DAYS) return null;
    if (to && to.length === 10 && to < TODAY) return null;
    if (from && from.length === 10 && from > TODAY) return "soon";
    return "now";
  }
  const shardCache = {};
  function loadDetail(w) {
    if (!w._lazy || w._loaded) return Promise.resolve(w);
    const n = String(w._shard).padStart(2, "0");
    shardCache[n] = shardCache[n] || fetch(`data/d/${n}.json?v=${encodeURIComponent(D.meta.generated)}`).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
    return shardCache[n].then((sh) => {
      Object.entries(sh._people || {}).forEach(([slug, r]) => {
        if (!ppl[slug]) ppl[slug] = { slug, name: r[0], name_native: r[1] ?? null, birth_year: r[2] ?? null, death_year: r[3] ?? null, dates_approx: !!r[4] };
      });
      Object.assign(w, sh[w.id] || {});
      w._loaded = true;
      return w;
    });
  }

  function init(data) {
    if (data.format === "index-v1") expandIndex(data);
    D = data; works = data.works;
    data.traditions.forEach((t) => (trad[t.id] = t));
    data.regions.forEach((r) => (reg[r.id] = r));
    data.languages.forEach((l) => (lang[l.id] = l));
    data.people.forEach((p) => (ppl[p.slug] = p));
    (data.genres || []).forEach((g) => (genre[g.id] = g));
    (data.places || []).forEach((x) => (places[x.id] = x));
    (data.venues || []).forEach((x) => (venues[x.id] = x));
    (data.organizations || []).forEach((x) => (orgs[x.id] = x));
    for (const w of works) {
      byId[w.id] = w;
      w._macro = macroOf(w.region);
      w.productions = w.productions || [];
      if (!w._lazy) {
        w._n = w.productions.length;
        w._runs = w.productions.flatMap((p) => p.runs.map((r) => ({ place: r.place, district: r.district, yf: r.from ? parseInt(r.from, 10) : null,
          yt: r.to ? parseInt(r.to, 10) : null, checked: r.checked, from: r.from, to: r.to })));
        w._ds = [...new Set(w._runs.map((r) => r.district).filter(Boolean))];
      }
      for (const r of w._runs) r.st = listingStatus(r.checked, r.from, r.to);
      w._now = w._runs.some((r) => r.st === "now") ? "now" : w._runs.some((r) => r.st === "soon") ? "soon" : null;
      w._latest = Math.max(-99999, ...w._runs.map((r) => (r.st ? THIS_YEAR + 1 : r.yt ?? r.yf ?? -99999)));
      const recent = w._runs.filter((r) => r.st || (r.yf ?? -1e9) >= THIS_YEAR - 10).length;
      // a stand-in for popularity until members' activity says otherwise: what is on now, then what is staged often
      w._pop = (w._now === "now" ? 100000 : w._now === "soon" ? 50000 : 0) + new Set(w._runs.filter((r) => r.st).map((r) => r.place)).size * 1000 + recent * 20 + w._n;
      w._hay = fold([w.title, w.original_title, ...w.alt_titles,
        ...w.people.map((p) => `${ppl[p.person]?.name || ""} ${ppl[p.person]?.name_native || ""}`),
        trad[w.tradition]?.name, regionName(w.region), ...w.languages.map((l) => lang[l]?.name), ...w.genres,
        ...[...new Set(w._runs.map((r) => r.place))].map((id) => places[id]?.name || ""), ...w._ds].join(" \u0001 "));
    }
    $("#gen").textContent = `${plural(works.length, "play")}, with ${plural(works.reduce((a, w) => a + w._n, 0), "production")}. Data built ${data.meta.generated.slice(0, 10)}.`;
    buildFacets();
    restorePrefs();
    $("#loading").hidden = true;
    route();
  }

  // ---------------------------------------------------------------- posters
  const PALETTE = [
    ["#6d1f2b", "#f6ead6", "#f0b93f"], ["#1f3a5f", "#f2ece0", "#e9b949"], ["#1f4a3d", "#efe8d8", "#e7c56a"],
    ["#e9dfc8", "#1d1813", "#a3282e"], ["#3f2547", "#f4e9f0", "#f0b93f"], ["#b5452f", "#fbf1e4", "#1d1813"],
    ["#16494d", "#eef3ef", "#f0b93f"], ["#2a2724", "#f3ede4", "#e04f5f"], ["#c9962c", "#1d1404", "#1d1404"],
    ["#5b5f2a", "#f4f0dc", "#f6d36b"], ["#0f2e3a", "#f6efe2", "#ef8f5a"], ["#7a3b5c", "#fbeef3", "#f6d36b"],
  ];
  // tag "span" when the poster sits inside another link (a list row, a list card): links can't nest
  function poster(w, { badge = true, cls = "", tag = "a" } = {}) {
    if (!w) return `<div class="fav-empty">Not found</div>`;
    const h = hash(w.id);
    const [bg, fg, acc] = PALETTE[h % PALETTE.length];
    const layout = ["a", "b", "c"][(h >> 4) % 3];
    const t = w.title, len = t.length;
    const size = len > 46 ? " xlong" : len > 26 ? " long" : "";
    const top = trad[w.tradition]?.name || regionName(w.region) || "";
    const nb = badge && w._now ? `<span class="p-badge${w._now === "soon" ? " soon" : ""}">${w._now === "now" ? "On now" : "Soon"}</span>` : "";
    return `<${tag} class="poster ${layout} ${cls}"${tag === "a" ? ` href="${playUrl(w.id)}"` : ""} style="--bg1:${bg};--fg:${fg};--acc:${acc}" aria-label="${esc(t)}${yearOf(w) != null ? ` (${esc(fmtDate(w))})` : ""}">${nb}
      <span class="p-top" aria-hidden="true">${esc(top)}</span>
      <span class="p-title${size}" aria-hidden="true" lang="en">${esc(t)}</span>
      <span class="p-rule" aria-hidden="true"></span>
      <span class="p-by" aria-hidden="true">${esc(byText(w) || "Anonymous")}</span>
      <span class="p-yr" aria-hidden="true">${esc(fmtDate(w))}</span></${tag}>`;
  }
  // a poster with the viewer's own marks under it (seen, rating, like)
  function cell(w, extra = "") {
    const s = myStatus[w.id];
    const mine = s ? `${s.seen ? `<span class="seen-i" title="Seen">●</span>` : ""}${s.rating ? `<span class="stars" aria-label="${starsLabel(s.rating)}">${stars(s.rating)}</span>` : ""}${s.liked ? `<span class="heart" title="Liked">♥</span>` : ""}${s.want && !s.seen ? `<span title="Want to see">◷</span>` : ""}` : "";
    return `<div class="cell">${poster(w)}${extra || `<div class="cell-meta">${mine}</div>`}</div>`;
  }

  // ---------------------------------------------------------------- routing
  const pageEl = () => $("#page");
  let lastRoute = "";
  // Pages load members' data asynchronously; each render checks, after every wait, that the
  // visitor hasn't moved on, so a slow page never draws over the one now showing.
  let routeSeq = 0;
  const stale = (tok) => tok !== routeSeq;
  function route() {
    if (!D) return;
    const tok = ++routeSeq;
    let h = location.hash.replace(/^#/, "");
    // the return from an email link (confirm sign-up, reset password) carries Supabase's
    // tokens or an error in the address; supabase-js reads them, so show the home page
    if (/(^|&)(access_token|error_description|error_code)=/.test(h)) {
      const err = new URLSearchParams(h).get("error_description");
      if (err) toast(err.replace(/\+/g, " ") + ". Try logging in, or ask for a new link.");
      history.replaceState(null, "", location.pathname + location.search);
      h = "";
    }
    // links from before Billd: #play-id
    if (h && !h.startsWith("/")) { let id = ""; try { id = decodeURIComponent(h); } catch (e) { /* malformed */ } if (byId[id]) { location.replace(playUrl(id)); return; } }
    let parts;
    try { parts = h.replace(/^\//, "").split("/").map((x) => decodeURIComponent(x)); }
    catch (e) { $("#v-browse").hidden = true; pageEl().hidden = false; return renderNotFound(); }  // a malformed address
    const [a, b, c] = parts;
    const isBrowse = a === "browse";
    $("#v-browse").hidden = !isBrowse;
    pageEl().hidden = isBrowse;
    const nav = { "": "home", browse: "browse", onstage: "onstage", lists: "lists", list: "lists", members: "members", activity: "activity" }[a || ""];
    $$(".nav a").forEach((x) => { if (x.dataset.nav === nav) x.setAttribute("aria-current", "page"); else x.removeAttribute("aria-current"); });
    const mine = me && a === "u" && b === me.username;
    const tab = a === "" || a == null ? "home" : isBrowse ? "browse" : a === "activity" ? "activity" : (a === "me" || mine) ? "me" : "";
    $$(".tabbar a").forEach((x) => { if (x.dataset.tab === tab) x.setAttribute("aria-current", "page"); else x.removeAttribute("aria-current"); });
    const key = h;
    const sameView = key === lastRoute;
    lastRoute = key;
    if (isBrowse) { applyBrowse(); document.title = "Shows · Billd"; return; }
    if (!sameView) window.scrollTo(0, 0);
    const go = {
      "": renderHome, onstage: () => renderOnStage(b), play: () => renderPlay(b), u: () => renderProfile(b, c), me: renderMe,
      lists: renderLists, list: () => renderList(b), review: () => renderReview(b), members: renderMembers,
      activity: () => renderActivity(b), settings: renderSettings, about: renderAbout,
    }[a || ""] || renderNotFound;
    Promise.resolve(go()).catch((e) => { console.error(e); if (stale(tok)) return; pageEl().innerHTML = `<div class="wrap"><p class="empty">Something went wrong: ${esc(e.message)}</p></div>`; });
  }
  window.addEventListener("hashchange", route);
  function renderNotFound() {
    document.title = "Billd";
    pageEl().innerHTML = `<div class="wrap"><h1 class="h1" style="margin-top:40px">That page isn't on the bill.</h1><p><a class="linkbtn" href="#/">Go to the home page</a></p></div>`;
  }
  const signedIn = () => !!me;
  function requireMe(why) {
    if (signedIn()) return true;
    openAuth(S.kind === "local" ? "in" : "up", why);
    return false;
  }

  // ---------------------------------------------------------------- top bar
  function renderAcct() {
    const el = $("#acct");
    if (me && S.kind !== "local") {
      el.innerHTML = `<button class="btn sm" type="button" data-log>+ Log</button>${avatar(me)}`;
    } else if (S.kind === "local") {
      el.innerHTML = `<button class="btn sm" type="button" data-log>+ Log</button>${avatar(S.me())}`;
    } else {
      el.innerHTML = `<button class="btn ghost sm" type="button" data-auth-open="in">Log in</button><button class="btn sm" type="button" data-auth-open="up">Join</button>`;
    }
  }
  $("#acct").addEventListener("click", (e) => {
    const a = e.target.closest("[data-auth-open]"); if (a) return openAuth(a.dataset.authOpen);
    if (e.target.closest("[data-log]")) openLog(null);
  });
  $("#tab-log").addEventListener("click", () => openLog(null));
  if (matchMedia("(max-width: 420px)").matches) $("#q").placeholder = "Search shows";
  $("#search-form").addEventListener("submit", (e) => { e.preventDefault(); goSearch($("#q").value); });
  let qt;
  $("#q").addEventListener("input", (e) => { clearTimeout(qt); qt = setTimeout(() => goSearch(e.target.value, true), 160); });
  function goSearch(text, live) {
    state.q = fold(text).split(/\s+/).filter(Boolean); state.shown = 60;
    if (!location.hash.startsWith("#/browse")) { if (!text.trim() && live) return; location.hash = "#/browse"; }
    else applyBrowse();
  }

  // ---------------------------------------------------------------- home
  const ICONS = {
    eye: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5C6.5 5 2.4 9.2 1 12c1.4 2.8 5.5 7 11 7s9.6-4.2 11-7c-1.4-2.8-5.5-7-11-7Zm0 11.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Zm0-2.3a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z"/></svg>`,
    heart: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-10-9.3C.4 8.4 2.4 4 6.5 4c2.3 0 3.9 1.3 5.5 3.2C13.6 5.3 15.2 4 17.5 4c4.1 0 6.1 4.4 4.5 7.7C19.5 16.4 12 21 12 21Z"/></svg>`,
    clock: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 10.6 3.6 2.1-1 1.7-4.6-2.7V6h2Z"/></svg>`,
    lines: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h18v2.5H3zM3 9h13v2.5H3zM3 14h18v2.5H3zM3 19h10v2.5H3z"/></svg>`,
    star: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 3 6.6 7.2.8-5.4 4.9 1.5 7.1L12 17.8l-6.3 3.6 1.5-7.1L1.8 9.4 9 8.6Z"/></svg>`,
    cal: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h2v3h6V2h2v3h3a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3Zm-2 8v10h14V10Z"/></svg>`,
    grid: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z"/></svg>`,
    ticket: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v3a3 3 0 0 0 0 6v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a3 3 0 0 0 0-6Zm11 1v2h2V7Zm0 4v2h2v-2Zm0 4v2h2v-2Z"/></svg>`,
  };
  const onNow = () => works.filter((w) => w._now).sort((a, b) => (popular[b.id] || 0) - (popular[a.id] || 0) || b._pop - a._pop);
  async function renderHome() {
    const tok = routeSeq;
    document.title = "Billd: a diary for theatregoers";
    const now = onNow();
    const intro = !me || S.kind === "local" ? `
      <section class="hero">
        <h1>Track every show you've <em>seen.</em></h1>
        <p>Billd is a diary for theatregoers. Log the plays and musicals you see, rate and review them, find what's on stage near you, and see what your friends thought.</p>
        <div class="acts">${S.kind === "local" ? `<button class="btn" type="button" data-log>Log a show</button>` : `<button class="btn" type="button" data-auth-open="up">Get started, it's free</button>`}
          <a class="btn ghost" href="#/onstage">What's on now</a></div>
        <div class="lets" aria-label="Billd lets you">
          <div class="let">${ICONS.eye}<p>Keep track of every show you've ever seen, or just start from the day you join</p></div>
          <div class="let">${ICONS.heart}<p>Show some love for your favourite shows, lists and reviews with a like</p></div>
          <div class="let">${ICONS.lines}<p>Write and share reviews, and follow friends and other members to read theirs</p></div>
          <div class="let">${ICONS.star}<p>Rate each show on a five-star scale, with halves, to record your reaction</p></div>
          <div class="let">${ICONS.cal}<p>Keep a diary of your theatregoing: when, where, and who you saw it with</p></div>
          <div class="let">${ICONS.ticket}<p>See what's on stage now in your city, and get tickets from the theatre</p></div>
        </div>
        ${S.kind === "local" ? `<p class="banner"><b>Preview mode.</b> Your diary is saved on this device. Member accounts, following and shared reviews switch on when Billd's server is connected.</p>` : ""}
      </section>` : `<section class="welcome">${avatar(me)}<h1>Welcome back, ${who(me)}.</h1></section>`;
    pageEl().innerHTML = `<div class="wrap">${intro}
      <section class="sec"><div class="sec-head"><h2>On stage now</h2><a href="#/onstage">All ${now.length.toLocaleString()} →</a></div>
        <div class="row-scroll">${now.slice(0, 18).map((w) => cell(w, `<div class="cell-cap">${esc(nowWhere(w))}</div>`)).join("") || `<p class="empty">No current listings.</p>`}</div></section>
      <section class="sec" id="home-pop" hidden><div class="sec-head"><h2>Popular on Billd this week</h2></div><div class="row-scroll" id="home-pop-row"></div></section>
      <section class="sec" id="home-friends" hidden><div class="sec-head"><h2>New from friends</h2><a href="#/activity">More →</a></div><div class="row-scroll" id="home-friends-row"></div></section>
      <section class="sec" id="home-rev" hidden><div class="sec-head"><h2>Recent reviews</h2><a href="#/activity/everyone">More →</a></div><ul class="reviews" id="home-rev-list"></ul></section>
      <section class="sec"><div class="sec-head"><h2>Explore the archive</h2><a href="#/browse">Browse ${works.length.toLocaleString()} plays →</a></div>
        <p class="lead">Plays from every culture and era, from Sophocles to this season, with where and when they were staged.</p>
        <div class="row-scroll" style="margin-top:16px">${classics().map((w) => cell(w)).join("")}</div></section>
    </div>`;
    // members' activity fills in as it arrives
    try {
      const pop = Object.keys(popular).map((id) => byId[id]).filter(Boolean).slice(0, 18);
      if (pop.length >= 4) { $("#home-pop-row").innerHTML = pop.map((w) => cell(w)).join(""); $("#home-pop").hidden = false; }
      if (me && S.kind !== "local") {
        const feed = (await S.feed(30)).filter((l) => l.user_id !== me.id && byId[l.play_id]);
        if (stale(tok)) return;
        if (feed.length) {
          $("#home-friends-row").innerHTML = feed.slice(0, 18).map((l) => cell(byId[l.play_id], `<div class="cell-meta">${avatar(l.profile, "sm")}${l.rating ? `<span class="stars">${stars(l.rating)}</span>` : ""}${l.liked ? `<span class="heart">♥</span>` : ""}</div>`)).join("");
          $("#home-friends").hidden = false;
        }
      }
      const revs = (await S.recentReviews(6)).filter((l) => byId[l.play_id]);
      if (stale(tok)) return;
      if (revs.length && S.kind !== "local") { $("#home-rev-list").innerHTML = revs.map((l) => reviewHTML(l)).join(""); $("#home-rev").hidden = false; }
    } catch (e) { console.warn(e); }
  }
  function nowWhere(w) {
    const rs = w._runs.filter((r) => r.st);
    const cities = [...new Set(rs.map((r) => places[r.place]?.name).filter(Boolean))];
    const d = rs.find((r) => r.district)?.district;
    return d && cities.length === 1 ? d : cities.length > 2 ? `${cities.slice(0, 2).join(", ")} +${cities.length - 2}` : cities.join(", ");
  }
  let classicsCache;
  function classics() {
    if (classicsCache) return classicsCache;
    // a spread of eras and traditions, the most staged of each
    const seen = new Set(), out = [];
    const pool = works.filter((w) => w._n >= 3 && w.source === "curated").sort((a, b) => b._n - a._n);
    for (const w of pool) { const k = w.tradition || w.era; if (seen.has(k)) continue; seen.add(k); out.push(w); if (out.length >= 18) break; }
    return (classicsCache = out);
  }

  // ---------------------------------------------------------------- on stage
  function renderOnStage(city) {
    document.title = "On stage now · Billd";
    const now = onNow();
    const counts = {};
    now.forEach((w) => new Set(w._runs.filter((r) => r.st).map((r) => r.place)).forEach((p) => p && (counts[p] = (counts[p] || 0) + 1)));
    const cities = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    const sel = city && counts[city] ? city : null;
    const shown = sel ? now.filter((w) => w._runs.some((r) => r.st && r.place === sel)) : now;
    const soon = shown.filter((w) => w._now === "soon"), playing = shown.filter((w) => w._now === "now");
    pageEl().innerHTML = `<div class="wrap" style="padding-top:30px">
      <h1 class="h1">On stage ${sel ? `in ${esc(places[sel]?.name)}` : "now"}</h1>
      <p class="count" style="margin:8px 0 18px">${plural(playing.length, "show")} playing${soon.length ? `, ${soon.length} coming soon` : ""}. From the theatres' listings and Ticketmaster, checked in the last ${STALE_DAYS} days.</p>
      <div class="cities" role="group" aria-label="City">
        <a class="chip" href="#/onstage" aria-pressed="${!sel}">Everywhere <small>${now.length}</small></a>
        ${cities.map((p) => `<a class="chip" href="#/onstage/${encodeURIComponent(p)}" aria-pressed="${p === sel}">${esc(places[p]?.name || p)} <small>${counts[p]}</small></a>`).join("")}
      </div>
      <section class="sec"><div class="sec-head"><h2>Playing now</h2></div><div class="grid">${playing.map((w) => cell(w, `<div class="cell-cap">${esc(nowWhere(w))}</div>`)).join("") || `<p class="empty">Nothing listed.</p>`}</div></section>
      ${soon.length ? `<section class="sec"><div class="sec-head"><h2>Coming soon</h2></div><div class="grid">${soon.map((w) => cell(w, `<div class="cell-cap">${esc(soonWhen(w))}</div>`)).join("")}</div></section>` : ""}
    </div>`;
  }
  function soonWhen(w) {
    const r = w._runs.filter((x) => x.st === "soon").sort((a, b) => (a.from || "").localeCompare(b.from || ""))[0];
    return r ? `${fmtPartial(r.from)} · ${places[r.place]?.name || ""}` : "";
  }

  // ---------------------------------------------------------------- browse
  // Every filter is a group of chips: tap to select, tap again to unselect. Within a group
  // the choices widen the result (English OR Russian); across groups they narrow it. Where a
  // play is staged ("Performed in", "Theatre district") counts only the runs in the chosen
  // period, on now by default, so Broadway means what is on Broadway, not every revival.
  const state = { q: [], sel: {}, when: "now", sort: "popular", layout: "posters", shown: 60 };
  const TOP = 10;
  const FLAG_NAMES = { now: "On stage now or soon", seen: "Seen by me", unseen: "Not seen by me", want: "On my want-to-see list",
                       staged: "With production history", disputed: "Disputed attribution", curated: "Curated entries only" };
  let FACETS = [];
  const facetUI = {};
  const inWhen = (r) => state.when === "ever" || !!r.st || (state.when === "recent" && (r.yt ?? r.yf ?? -1e9) >= THIS_YEAR - 10);
  function buildFacets() {
    const eraLabel = Object.fromEntries(D.meta.eras.map((e) => [e.id, e.label]).concat([["undated", "Undated"]]));
    const eraOrder = D.meta.eras.map((e) => e.id).concat(["undated"]);
    FACETS = [
      { key: "flags", label: "Show only", all: true, order: ["now", "seen", "unseen", "want", "staged", "disputed", "curated"], name: (v) => FLAG_NAMES[v],
        values: (w) => { const s = myStatus[w.id]; return [w._now && "now", s?.seen && "seen", !s?.seen && "unseen", s?.want && "want", w._n && "staged", w.attribution_disputed && "disputed", w.source === "curated" && "curated"].filter(Boolean); } },
      { key: "place", label: "Performed in", when: true, values: (w) => [...new Set(w._runs.filter(inWhen).map((r) => r.place).filter(Boolean))], name: (v) => places[v]?.name || v },
      { key: "district", label: "Theatre district", when: true, values: (w) => [...new Set(w._runs.filter(inWhen).map((r) => r.district).filter(Boolean))], name: (v) => v },
      { key: "era", label: "Era", values: (w) => [w.era], name: (v) => eraLabel[v] || v, order: eraOrder },
      { key: "tradition", label: "Tradition", values: (w) => [w.tradition || "__none"], name: (v) => v === "__none" ? "Unclassified" : (trad[v]?.name || v) },
      { key: "macro", label: "Part of the world", values: (w) => [w._macro], name: (v) => reg[v]?.name || "Other" },
      { key: "region", label: "Country or region", values: (w) => w.region ? [w.region] : [], name: (v) => regionName(v) },
      { key: "language", label: "Language", values: (w) => w.languages, name: (v) => lang[v]?.name || v },
    ];
    for (const f of FACETS) { state.sel[f.key] = state.sel[f.key] || new Set(); facetUI[f.key] = facetUI[f.key] || { expanded: false, find: "" }; }
    totals();
    $("#facets").innerHTML = FACETS.map((f) => `<section class="facet" data-facet="${f.key}">
        <div class="facet-head"><h3 id="fh-${f.key}">${esc(f.label)}</h3><button class="facet-clear" type="button" data-clear="${f.key}" hidden>Clear</button></div>
        ${f.key === "place" ? `<div class="when" role="group" aria-label="When">${[["now", "On now"], ["recent", "Last 10 yrs"], ["ever", "Any time"]].map(([k, l]) => `<button type="button" data-when="${k}" aria-pressed="${state.when === k}">${l}</button>`).join("")}</div><p class="when-hint" id="when-hint"></p>` : ""}
        <input class="facet-find" type="search" data-find="${f.key}" placeholder="Find ${esc(f.label.toLowerCase())}…" aria-label="Find ${esc(f.label.toLowerCase())}" hidden>
        <div class="chips" role="group" aria-labelledby="fh-${f.key}" data-chips="${f.key}"></div>
        <button class="facet-more" type="button" data-more="${f.key}" hidden></button>
      </section>`).join("");
  }
  function totals() {
    for (const f of FACETS) {
      const total = {};
      for (const w of works) f.values(w).forEach((v) => { if (v) total[v] = (total[v] || 0) + 1; });
      f.total = total;
      f.keys = f.order ? f.order.filter((v) => total[v]) : Object.keys(total).sort((a, b) => total[b] - total[a] || f.name(a).localeCompare(f.name(b)));
      // the viewer's own marks filter only once they have some
      if (f.key === "flags" && !Object.keys(myStatus).length) f.keys = f.keys.filter((v) => !["seen", "unseen", "want"].includes(v) || state.sel.flags.has(v));
    }
  }
  function facetMatch(f, w) {
    const sel = state.sel[f.key];
    if (!sel || !sel.size) return true;
    const vals = f.values(w);
    return f.all ? [...sel].every((v) => vals.includes(v)) : vals.some((v) => sel.has(v));
  }
  function matches(w, skip) {
    for (const f of FACETS) if (f.key !== skip && !facetMatch(f, w)) return false;
    for (const tok of state.q) if (!w._hay.includes(tok)) return false;
    return true;
  }
  function renderFacets() {
    const focused = document.activeElement?.closest?.(".chip[data-f]");
    const keep = focused ? [focused.dataset.f, focused.dataset.v] : null;
    for (const f of FACETS) {
      const live = {};
      for (const w of works) if (matches(w, f.key)) f.values(w).forEach((v) => { if (v) live[v] = (live[v] || 0) + 1; });
      const sel = state.sel[f.key], ui = facetUI[f.key];
      const find = fold(ui.find || "");
      const keys = f.keys.filter((v) => !find || fold(f.name(v)).includes(find));
      const order = f.order ? keys.filter((v) => live[v] || sel.has(v) || f.key !== "flags") : keys.filter((v) => live[v] || sel.has(v));
      let shown = order;
      const limit = find || ui.expanded || f.order ? Infinity : TOP;
      if (shown.length > limit) shown = shown.slice(0, limit).concat(order.slice(limit).filter((v) => sel.has(v)));
      $(`[data-chips="${f.key}"]`).innerHTML = shown.map((v) => `<button class="chip${live[v] ? "" : " dim"}" type="button" aria-pressed="${sel.has(v)}" data-f="${f.key}" data-v="${esc(v)}">${esc(f.name(v))} <small>${(live[v] || 0).toLocaleString()}</small></button>`).join("")
        || `<small class="hint">${f.when && state.when === "now" ? "Nothing listed now. Try Any time." : "No match"}</small>`;
      const more = $(`[data-more="${f.key}"]`);
      more.hidden = !(order.length - shown.length > 0 || (ui.expanded && order.length > TOP && !find));
      more.textContent = ui.expanded ? "Show fewer" : `Show all ${order.length.toLocaleString()}`;
      $(`[data-find="${f.key}"]`).hidden = f.keys.length <= 15;
      $(`[data-clear="${f.key}"]`).hidden = !sel.size;
    }
    $$(".when button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.when === state.when)));
    $("#when-hint").textContent = { now: "Where shows are playing now.", recent: "Where plays were staged in the last ten years.", ever: "Every recorded staging, back to the premiere." }[state.when];
    if (keep) document.querySelector(`.chip[data-f="${keep[0]}"][data-v="${CSS.escape(keep[1])}"]`)?.focus({ preventScroll: true });
    const pills = [];
    if (state.q.length) pills.push(`<button class="pill" type="button" data-unq="1">“${esc(state.q.join(" "))}” <span class="x" aria-hidden="true">×</span><span class="vh"> remove search</span></button>`);
    for (const f of FACETS) for (const v of state.sel[f.key]) pills.push(`<button class="pill" type="button" data-f="${f.key}" data-v="${esc(v)}" aria-label="Remove filter ${esc(f.name(v))}">${esc(f.name(v))}${f.when && state.when !== "ever" ? ` <small>(${state.when === "now" ? "on now" : "last 10 yrs"})</small>` : ""} <span class="x" aria-hidden="true">×</span></button>`);
    $("#active").innerHTML = pills.length ? pills.join("") + (pills.length > 1 ? `<button class="clear-all" type="button" data-clearall="1">Clear all</button>` : "") : "";
    $("#active").hidden = !pills.length;
  }
  function toggleFilter(key, value) {
    const sel = state.sel[key]; if (!sel) return;
    if (sel.has(value)) sel.delete(value); else sel.add(value);
    state.shown = 60; applyBrowse();
  }
  function clearFilters() {
    for (const k in state.sel) state.sel[k].clear();
    state.q = []; $("#q").value = ""; state.shown = 60;
    for (const k in facetUI) facetUI[k].find = "";
    $$(".facet-find").forEach((i) => (i.value = ""));
    applyBrowse();
  }
  let filtered = [];
  function applyBrowse() {
    if (!D) return;
    totals();  // the viewer's seen and want-to-see marks may have changed
    filtered = works.filter((w) => matches(w));
    const nActive = Object.values(state.sel).reduce((a, x) => a + x.size, 0);
    $("#rail-toggle").textContent = nActive ? `Filters (${nActive})` : "Filters";
    $("#rail-done").textContent = `Show ${filtered.length.toLocaleString()} ${filtered.length === 1 ? "play" : "plays"}`;
    const ry = (w) => yearOf(w) ?? 99999;
    const cmp = {
      popular: (a, b) => (popular[b.id] || 0) - (popular[a.id] || 0) || (rated[b.id]?.seen || 0) - (rated[a.id]?.seen || 0) || b._pop - a._pop || a.title.localeCompare(b.title),
      recent: (a, b) => b._latest - a._latest || b._pop - a._pop,
      rated: (a, b) => (rated[b.id]?.avg ?? -1) - (rated[a.id]?.avg ?? -1) || (rated[b.id]?.n || 0) - (rated[a.id]?.n || 0) || b._pop - a._pop,
      year: (a, b) => ry(a) - ry(b) || a.title.localeCompare(b.title),
      title: (a, b) => fold(a.title).localeCompare(fold(b.title)),
    }[state.sort];
    filtered.sort(cmp);
    renderFacets();
    renderResults();
    savePrefs();
  }
  function renderResults() {
    $("#count").innerHTML = `<b>${filtered.length.toLocaleString()}</b> ${filtered.length === 1 ? "play" : "plays"}${filtered.length !== works.length ? ` of ${works.length.toLocaleString()}` : ""}`;
    $("#browse-h").textContent = state.sel.flags.has("now") || (state.when === "now" && (state.sel.place.size || state.sel.district.size)) ? "On stage" : "Shows";
    $$(".toolbar .seg button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.layout === state.layout)));
    for (const l of ["posters", "list", "timeline", "traditions"]) $("#b-" + l).hidden = state.layout !== l;
    $("#sort").value = state.sort;
    const items = filtered.slice(0, state.shown);
    const empty = `<p class="empty">No plays match. ${state.when === "now" && (state.sel.place.size || state.sel.district.size) ? `<button class="linkbtn" type="button" data-when="ever">Include past productions</button> or remove a filter.` : "Try removing a filter or shortening the search."}</p>`;
    if (state.layout === "posters") $("#b-posters").innerHTML = items.length ? items.map((w) => cell(w)).join("") : empty;
    if (state.layout === "list") $("#b-list").innerHTML = items.length ? items.map(listRow).join("") : `<li>${empty}</li>`;
    if (state.layout === "timeline") drawTimeline();
    if (state.layout === "traditions") renderTraditions();
    const rest = filtered.length - items.length;
    $("#more").hidden = rest <= 0 || state.layout === "timeline" || state.layout === "traditions";
    $("#more").textContent = `Show ${Math.min(rest, 120).toLocaleString()} more`;
  }
  function listRow(w) {
    const s = myStatus[w.id], t = trad[w.tradition];
    const where = w._now ? nowWhere(w) : w._n ? plural(w._n, "production") : "";
    return `<li><a class="lrow" href="${playUrl(w.id)}">${poster(w, { badge: false, tag: "span" })}
      <span class="t"><strong>${esc(w.title)}</strong>${w.original_title && !sameTitle(w.original_title, w.title) ? `<span class="orig" dir="auto">${esc(w.original_title)}</span>` : ""}${w._now ? ` <span class="badge now">${w._now === "now" ? "On now" : "Soon"}</span>` : ""}
        <small>${esc(byText(w) || "Anonymous")}${fmtDate(w) ? ` · ${esc(fmtDate(w))}` : ""}${t ? ` · ${esc(t.name)}` : ""}</small></span>
      <span class="r">${s?.rating ? `<span class="stars">${stars(s.rating)}</span><br>` : ""}${esc(where)}</span></a></li>`;
  }
  function renderTraditions() {
    const tc = {}; filtered.forEach((w) => { tc[w.tradition || "__none"] = (tc[w.tradition || "__none"] || 0) + 1; });
    let h = "";
    macroList().forEach((m) => {
      const ts = D.traditions.filter((t) => macroOf(t.region) === m.id && tc[t.id]);
      if (!ts.length) return;
      h += `<div class="tgroup"><h3>${esc(m.name)}</h3><div class="tgrid">` + ts.map((t) => `
        <button class="tcard" type="button" data-trad="${t.id}"><header><strong>${esc(t.name)}</strong><span class="n">${plural(tc[t.id], "play")}</span></header>
          <span class="per">${t.native_name ? `<span dir="auto">${esc(t.native_name)}</span> · ` : ""}${esc(t.period_label || "")}</span><p>${esc(t.description || "")}</p></button>`).join("") + `</div></div>`;
    });
    if (tc.__none) h += `<div class="tgroup"><h3>Unclassified</h3><div class="tgrid"><button class="tcard" type="button" data-trad="__none"><header><strong>Not yet assigned</strong><span class="n">${plural(tc.__none, "play")}</span></header><p>Imported plays not yet assigned to a tradition.</p></button></div></div>`;
    $("#b-traditions").innerHTML = h || `<p class="empty">No traditions match these filters.</p>`;
  }
  function filterTradition(id) { state.sel.tradition = new Set([id]); state.layout = state.layout === "traditions" ? "posters" : state.layout; state.shown = 60; location.hash === "#/browse" ? applyBrowse() : (location.hash = "#/browse"); }
  $("#facets").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip[data-f]"); if (chip) return toggleFilter(chip.dataset.f, chip.dataset.v);
    const w = e.target.closest("[data-when]"); if (w) return setWhen(w.dataset.when);
    const clear = e.target.closest("[data-clear]"); if (clear) { state.sel[clear.dataset.clear].clear(); state.shown = 60; return applyBrowse(); }
    const more = e.target.closest("[data-more]"); if (more) { const ui = facetUI[more.dataset.more]; ui.expanded = !ui.expanded; renderFacets(); }
  });
  function setWhen(k) {
    state.when = k; totals();
    // a place picked for "now" that has no runs in the new period stays selected, and shows 0
    state.shown = 60; applyBrowse();
  }
  $("#facets").addEventListener("input", (e) => { const k = e.target.dataset?.find; if (!k) return; facetUI[k].find = e.target.value; renderFacets(); });
  $("#active").addEventListener("click", (e) => {
    const p = e.target.closest("button"); if (!p) return;
    if (p.dataset.clearall) return clearFilters();
    if (p.dataset.unq) { state.q = []; $("#q").value = ""; return applyBrowse(); }
    if (p.dataset.f) toggleFilter(p.dataset.f, p.dataset.v);
  });
  $("#v-browse").addEventListener("click", (e) => {
    const w = e.target.closest(".results [data-when]"); if (w) return setWhen(w.dataset.when);
    const t = e.target.closest(".tcard"); if (t) return filterTradition(t.dataset.trad);
  });
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; applyBrowse(); });
  $("#reset").addEventListener("click", clearFilters);
  $(".toolbar .seg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; state.layout = b.dataset.layout; renderResults(); savePrefs(); });
  $("#more").addEventListener("click", () => { state.shown += 120; renderResults(); });
  function setRail(open) {
    $("#rail").classList.toggle("open", open); $("#rail-toggle").setAttribute("aria-expanded", String(open));
    if (!open) $("#rail-toggle").scrollIntoView({ block: "nearest" });
  }
  $("#rail-toggle").addEventListener("click", () => setRail(!$("#rail").classList.contains("open")));
  $("#rail-done").addEventListener("click", () => { setRail(false); $(".results-head").scrollIntoView({ block: "start" }); });

  // timeline: a piecewise-linear time axis, since antiquity is long but sparse
  const SEG = [[-560, 500, 0.20], [500, 1500, 0.15], [1500, 1800, 0.22], [1800, 1900, 0.15], [1900, 2030, 0.28]];
  const TICKS = [-500, 1, 500, 1000, 1500, 1600, 1700, 1800, 1850, 1900, 1950, 2000];
  let tlHits = [];
  function xOf(y, x0, w) {
    let acc = 0;
    for (const [a, b, f] of SEG) {
      if (y <= b || b === SEG[SEG.length - 1][1]) return x0 + (acc + Math.max(0, Math.min(1, (y - a) / (b - a))) * f) * w;
      acc += f;
    }
    return x0 + w;
  }
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function drawTimeline() {
    const canvas = $("#tl"), inner = $("#tl-inner");
    const dated = filtered.filter((w) => yearOf(w) != null);
    const macros = macroList().map((r) => r.id);
    const laneIds = [...new Set(dated.map((w) => w.tradition || "__none"))];
    laneIds.sort((a, b) => {
      const ta = trad[a], tb = trad[b];
      const ma = ta ? macros.indexOf(macroOf(ta.region)) : 99, mb = tb ? macros.indexOf(macroOf(tb.region)) : 99;
      return ma - mb || (ta?.year_from ?? 9999) - (tb?.year_from ?? 9999) || (ta?.name || "").localeCompare(tb?.name || "");
    });
    const LABEL = inner.clientWidth < 700 ? 120 : 210, TOPY = 34, LANE = 22, GAP = 18;
    const rows = []; let y = TOPY, lastMacro = null;
    laneIds.forEach((id) => {
      const m = trad[id] ? macroOf(trad[id].region) : "other";
      if (m !== lastMacro) { rows.push({ head: reg[m]?.name || "Unclassified", y }); y += GAP; lastMacro = m; }
      rows.push({ id, y }); y += LANE;
    });
    const H = Math.max(y + 12, 120), W = inner.clientWidth, dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.height = H + "px";
    const ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const C = { ink: css("--ink"), muted: css("--muted"), line: css("--line"), accent: css("--gold"), surface: css("--surface"), sunk: css("--raise") };
    const x0 = LABEL, plotW = W - LABEL - 30;  // room for the dots after 2000
    ctx.clearRect(0, 0, W, H);
    let acc = 0;
    SEG.forEach(([, , f], i) => { if (i % 2 === 1) { ctx.fillStyle = C.sunk; ctx.globalAlpha = 0.5; ctx.fillRect(x0 + acc * plotW, TOPY - 8, f * plotW, H - TOPY); ctx.globalAlpha = 1; } acc += f; });
    ctx.font = `11px ${css("--font-ui")}`; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    TICKS.forEach((t) => {
      const x = xOf(t, x0, plotW);
      ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + 0.5, TOPY - 8); ctx.lineTo(x + 0.5, H); ctx.stroke();
      ctx.fillStyle = C.muted; ctx.fillText(t === 1 ? "1 CE" : t < 0 ? `${-t} BCE` : String(t), x, 18);
    });
    const laneY = {};
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    rows.forEach((r) => {
      if (r.head) { ctx.fillStyle = C.ink; ctx.font = `700 13px ${css("--font-display")}`; ctx.fillText(r.head, 10, r.y + GAP / 2 + 1); return; }
      laneY[r.id] = r.y + LANE / 2;
      ctx.strokeStyle = C.line; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(x0, r.y + LANE - 0.5); ctx.lineTo(W - 16, r.y + LANE - 0.5); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = C.muted; ctx.font = `12.5px ${css("--font-ui")}`;
      let name = trad[r.id]?.name || "Unclassified";
      while (ctx.measureText(name).width > LABEL - 22 && name.length > 4) name = name.slice(0, -2) + "…";
      ctx.fillText(name, 10, r.y + LANE / 2);
    });
    tlHits = [];
    const marks = dated.map((w) => {
      const a = w.year_from ?? w.year_to, b = w.year_to ?? w.year_from;
      const xa = xOf(a, x0, plotW), xb = xOf(b, x0, plotW);
      return { w, xa, xb, x: (xa + xb) / 2, y: laneY[w.tradition || "__none"] + ((hash(w.id) % 7) - 3) * 1.6 };
    });
    ctx.lineCap = "round";
    marks.forEach((m) => { if (m.xb - m.xa > 2) { ctx.strokeStyle = C.accent; ctx.globalAlpha = 0.35; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(m.xa, m.y); ctx.lineTo(m.xb, m.y); ctx.stroke(); ctx.globalAlpha = 1; } });
    marks.forEach((m) => {
      ctx.beginPath(); ctx.arc(m.x, m.y, 6, 0, Math.PI * 2); ctx.fillStyle = C.surface; ctx.fill();
      ctx.beginPath(); ctx.arc(m.x, m.y, 4.5, 0, Math.PI * 2);
      if (m.w.date_certain) { ctx.fillStyle = C.accent; ctx.fill(); } else { ctx.lineWidth = 2; ctx.strokeStyle = C.accent; ctx.stroke(); }
      tlHits.push(m);
    });
  }
  function hitAt(ev) {
    const rect = $("#tl").getBoundingClientRect(), x = ev.clientX - rect.left, y = ev.clientY - rect.top;
    let best = null, bd = 100;
    for (const m of tlHits) { const d = (m.x - x) ** 2 + (m.y - y) ** 2; if (d < bd) { bd = d; best = m; } }
    return best ? { m: best } : null;
  }
  $("#tl").addEventListener("mousemove", (e) => {
    const h = hitAt(e), tip = $("#tip");
    if (!h) { tip.hidden = true; $("#tl").style.cursor = "default"; return; }
    const w = h.m.w;
    tip.innerHTML = `<b>${esc(w.title)}</b><span>${esc(byText(w) || "Anonymous")}</span><span>${esc(fmtDate(w))} · ${esc(trad[w.tradition]?.name || "Unclassified")}</span>`;
    tip.hidden = false; $("#tl").style.cursor = "pointer";
    tip.style.left = Math.min(h.m.x + 12, $("#tl-inner").clientWidth - 310) + "px"; tip.style.top = (h.m.y + 12) + "px";
  });
  $("#tl").addEventListener("mouseleave", () => ($("#tip").hidden = true));
  $("#tl").addEventListener("click", (e) => { const h = hitAt(e); if (h) location.hash = playUrl(h.m.w.id); });
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => !$("#v-browse").hidden && state.layout === "timeline" && drawTimeline(), 120); });

  function savePrefs() { try { localStorage.setItem("billd-browse", JSON.stringify({ sort: state.sort, layout: state.layout, when: state.when })); } catch (e) { /* storage blocked */ } }
  function restorePrefs() {
    try {
      const s = JSON.parse(localStorage.getItem("billd-browse") || "{}");
      if (s.sort) state.sort = s.sort; if (s.layout) state.layout = s.layout;
      if (s.when) { state.when = s.when; totals(); }
    } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- play page
  async function renderPlay(id) {
    const tok = routeSeq;
    const w = byId[id];
    if (!w) return renderNotFound();
    document.title = `${w.title} · Billd`;
    const draw = () => {
      pageEl().innerHTML = `<div class="wrap"><article class="play">
        <div class="play-poster">${poster(w)}</div>
        <div class="play-main">
          <header class="play-head">
            <h1>${esc(w.title)}${fmtDate(w) ? ` <span class="yr">${esc(fmtDate(w))}</span>` : ""}</h1>
            ${w.original_title && !sameTitle(w.original_title, w.title) ? `<p class="orig" dir="auto" lang="${esc(w.languages[0] || "")}">${esc(w.original_title)}</p>` : ""}
            <p class="byline">${writers(w).length ? "by " + writers(w).map((p) => `<button class="linkbtn" type="button" data-person="${esc(ppl[p.person]?.name || p.person)}">${esc(ppl[p.person]?.name || p.person)}</button>`).join(", ") : "Anonymous"}</p>
            <div class="tags">${w.tradition ? `<button class="tag" type="button" data-trad="${esc(w.tradition)}">${esc(trad[w.tradition]?.name)}</button>` : ""}${w.region ? `<span class="tag">${esc(regionName(w.region))}</span>` : ""}${w.languages.map((l) => `<span class="tag">${esc(lang[l]?.name || l)}</span>`).join("")}${w.genres.map((g) => `<span class="tag">${esc(genre[g]?.name || g)}</span>`).join("")}</div>
          </header>
          <div class="play-actions-slot" id="play-now">${w._lazy && !w._loaded ? "" : nowPlayingHTML(w)}</div>
          <div class="play-actions-slot" id="play-actions-sm"></div>
          <div class="play-body">
            <div id="play-desc">${w._lazy && !w._loaded ? `<p class="src">Loading…</p>` : descHTML(w)}</div>
            <section class="sec" id="play-reviews"><div class="sec-head"><h2>Reviews</h2><button type="button" data-log-play>Write a review</button></div><ul class="reviews" id="play-rev-list"><li class="empty">Loading reviews…</li></ul></section>
            <section class="sec" id="play-prods">${w._lazy && !w._loaded ? "" : productionsHTML(w)}</section>
            <section class="sec"><div class="sec-head"><h2>Details</h2></div><div id="play-facts">${w._lazy && !w._loaded ? "" : factsHTML(w)}</div></section>
          </div>
        </div>
        <aside class="side">
          <div class="box" id="play-actions"></div>
          <div class="box" id="play-stats"></div>
          <div class="box" id="play-lists" hidden></div>
        </aside>
      </article></div>`;
    };
    draw();
    renderPlayActions(w);
    if (w._lazy && !w._loaded) {
      try { await loadDetail(w); } catch (e) { if (!stale(tok)) $("#play-desc").innerHTML = `<p class="src">Could not load the details of this play.</p>`; return; }
      if (stale(tok)) return;
      $("#play-desc").innerHTML = descHTML(w); $("#play-now").innerHTML = nowPlayingHTML(w);
      $("#play-prods").innerHTML = productionsHTML(w); $("#play-facts").innerHTML = factsHTML(w);
    }
    renderPlaySocial(w, tok);
  }
  function descHTML(w) {
    const ids = w.ids || {};
    if (!w.notes) return "";
    const src = w.notes_source === "wikipedia" ? `From the English Wikipedia article${ids.enwiki ? ` <a href="https://en.wikipedia.org/wiki/${encodeURIComponent(ids.enwiki.replace(/ /g, "_"))}" target="_blank" rel="noopener">${esc(ids.enwiki)}</a>` : ""}, CC BY-SA 4.0.`
      : w.notes_source === "wikidata" ? "Description from Wikidata." : w.notes_source === "generated" ? "Summary written from the records below." : "";
    // Wikipedia leads lose their pronunciation guides in extraction, leaving "Hamlet (), is"
    const text = w.notes.replace(/\s*\(\s*[;,]?\s*\)/g, "").replace(/\(\s*[;,]\s*/g, "(");
    return `<p class="synopsis">${esc(text)}</p>${src ? `<p class="src">${src}</p>` : ""}`;
  }
  // Current and upcoming runs with where to buy tickets. Links come only from the listing
  // sources (the theatre's own site, Ticketmaster); none are made up.
  function nowPlayingHTML(w) {
    const rows = w.productions.flatMap((p) => p.runs.map((r) => ({ r, p, st: listingStatus(r.checked, r.from, r.to) })))
      .filter((x) => x.st).sort((a, b) => (a.st === "now" ? 0 : 1) - (b.st === "now" ? 0 : 1) || (a.r.from || "").localeCompare(b.r.from || ""));
    if (!rows.length) return "";
    const items = rows.map(({ r, p, st }) => {
      const v = venues[r.venue], where = [v?.name, places[r.place]?.name].filter(Boolean).map(esc).join(", ");
      const when = st === "soon" ? `Opens ${fmtPartial(r.from)}` : (r.from && r.from.length >= 7 ? `Since ${fmtPartial(r.from)}` : "Playing now");
      const until = r.to ? ` · until ${fmtPartial(r.to)}` : (st === "now" ? " · open-ended" : "");
      const tickets = r.ticket_url ? `<a class="btn sm" href="${esc(r.ticket_url)}" target="_blank" rel="noopener nofollow">Tickets${p.source === "ticketmaster" ? " · Ticketmaster" : ""}</a>`
        : (v?.website ? `<a class="btn sm" href="${esc(v.website)}" target="_blank" rel="noopener nofollow">Tickets · box office</a>` : "");
      return `<li><div><div class="np-where"><strong>${where || "Venue to be announced"}</strong>${r.district ? ` <span class="badge dist">${esc(r.district)}</span>` : ""}</div>
        <div class="np-when">${esc(when + until)}</div></div>${tickets}<small class="np-src">Listing checked ${esc(fmtPartial(r.checked))}. Check with the seller for dates and prices.</small></li>`;
    });
    return `<section class="nowp" aria-label="On stage now"><h2>${rows.some((x) => x.st === "now") ? "On stage now" : "Coming soon"}</h2><ul>${items.join("")}</ul>
      ${w.ids?.website ? `<p class="src"><a href="${esc(w.ids.website)}" target="_blank" rel="noopener nofollow">Official website</a></p>` : ""}</section>`;
  }
  function factsHTML(w) {
    const grouped = [];
    w.people.forEach((p) => { const g = grouped.find((x) => x.person === p.person); if (g) g.roles.push(p.role); else grouped.push({ ...p, roles: [p.role] }); });
    const pplHTML = grouped.length ? grouped.map((p) => {
      const P = ppl[p.person] || { name: p.person };
      const life = P.birth_year != null || P.death_year != null ? `${P.dates_approx ? "c. " : ""}${P.birth_year != null ? fy(P.birth_year) : "?"}–${P.death_year != null ? fy(P.death_year) : ""}` : "";
      return `<div><button class="linkbtn" type="button" data-person="${esc(P.name)}">${esc(P.name)}</button>${P.name_native && P.name_native !== P.name ? ` <span dir="auto">${esc(P.name_native)}</span>` : ""}
        <small>${p.roles.join() !== "playwright" ? ` · ${esc(p.roles.join(", "))}` : ""}${p.disputed ? " · disputed" : ""}${life ? ` · ${esc(life)}` : ""}</small></div>`;
    }).join("") : "Anonymous";
    const ids = w.ids || {}, links = [];
    if (ids.enwiki) links.push(`<a href="https://en.wikipedia.org/wiki/${encodeURIComponent(ids.enwiki.replace(/ /g, "_"))}" target="_blank" rel="noopener">Wikipedia</a>`);
    if (ids.wikidata) links.push(`<a href="https://www.wikidata.org/wiki/${esc(ids.wikidata)}" target="_blank" rel="noopener">Wikidata</a>`);
    if (ids.website) links.push(`<a href="${esc(ids.website)}" target="_blank" rel="noopener nofollow">Official website</a>`);
    const basis = { written: "written", premiered: "first performed", published: "first published", approximate: "approximate" }[w.date_basis] || "";
    return `<dl class="facts">
      <dt>${grouped.length > 1 ? "People" : "Playwright"}</dt><dd>${pplHTML}</dd>
      ${fmtDate(w) ? `<dt>Date</dt><dd>${esc(fmtDate(w))}${basis ? ` <small>${esc(basis)}${w.date_certain ? "" : ", conjectural"}</small>` : ""}</dd>` : ""}
      <dt>Tradition</dt><dd>${w.tradition ? `<button class="linkbtn" type="button" data-trad="${esc(w.tradition)}">${esc(trad[w.tradition]?.name)}</button>${w.tradition_rule ? ` <small>(inferred)</small>` : ""}` : "Unclassified"}</dd>
      <dt>Language</dt><dd>${w.languages.map((l) => esc(lang[l]?.name || l)).join(", ") || "—"}</dd>
      ${w.alt_titles.length ? `<dt>Also known as</dt><dd>${w.alt_titles.slice(0, 10).map((t) => `<span dir="auto">${esc(t)}</span>`).join("<br>")}</dd>` : ""}
      ${links.length ? `<dt>Links</dt><dd>${links.join(" · ")}</dd>` : ""}
    </dl><p class="src" style="margin-top:14px">Something wrong or missing? <button class="linkbtn" type="button" data-fix>Suggest a correction</button></p>`;
  }
  function productionsHTML(w) {
    if (!w.productions.length) return "";
    const kindLabel = { premiere: "World premiere", revival: "Revival", tour: "Tour", transfer: "Transfer" };
    const srcName = { wikipedia: "Wikipedia", idu: "IDU open data (CC BY 4.0)", web: "Source page", ticketmaster: "Ticketmaster", kunstenpunt: "Kunstenpunt", theaterencyclopedie: "TheaterEncyclopedie (CC0)" };
    const prodYear = (p) => Math.max(...p.runs.map((r) => (r.from ? parseInt(r.from, 10) : -99999)));
    // newest first: what a theatregoer could have seen comes before the history
    const prods = [...w.productions].sort((a, b) => prodYear(b) - prodYear(a));
    const item = (p) => {
      const by = (role) => p.credits.filter((c) => c.role === role);
      const name = (c) => esc(c.person ? (ppl[c.person]?.name || c.person) : (orgs[c.org]?.name || c.org));
      const line = (label, list) => list.length ? `<div class="pc"><span class="pc-l">${label}</span> ${list.map(name).join(", ")}</div>` : "";
      const cast = by("cast");
      const shownCast = cast.slice(0, 8).map((c) => name(c) + (c.character ? ` <small>as ${esc(c.character)}</small>` : ""));
      const others = ["designer", "composer", "choreographer", "translator", "adapter"].flatMap((r) => by(r).map((c) => `${name(c)} <small>(${r})</small>`));
      const pl = p.language && p.language !== w.languages[0] ? (lang[p.language]?.name || p.language) : "";
      return `<li class="prod">
        <div class="prod-head">${kindLabel[p.kind] ? `<span class="badge">${kindLabel[p.kind]}</span>` : ""}${p.title ? `<em>${esc(p.title)}</em>` : ""}${pl ? ` <small>in ${esc(pl)}</small>` : ""}</div>
        <ul class="runs">${p.runs.map((r) => {
          const date = r.from ? fmtPartial(r.from) + (r.to && r.to !== r.from ? ` – ${fmtPartial(r.to)}` : "") : "date unknown";
          const where = [venues[r.venue]?.name, places[r.place]?.name].filter(Boolean).map(esc).join(", ");
          return `<li class="run"><span class="run-date">${r.certain === false ? "c. " : ""}${esc(date)}</span><span>${where}${r.district ? ` <span class="badge dist">${esc(r.district)}</span>` : ""}</span></li>`;
        }).join("")}</ul>
        ${line("Company", by("company"))}${line("Producer", by("producer"))}${line("Director", by("director"))}
        ${cast.length ? `<div class="pc"><span class="pc-l">Cast</span> ${shownCast.join(", ")}${cast.length > 8 ? `, and ${cast.length - 8} more` : ""}</div>` : ""}
        ${others.length ? `<div class="pc"><span class="pc-l">Also</span> ${others.join(", ")}</div>` : ""}
        ${p.notes ? `<p class="prod-notes">${esc(p.notes)}</p>` : ""}
        <div class="prod-src">${p.citation ? `<a href="${esc(p.citation)}" target="_blank" rel="noopener">${srcName[p.source] || "Source"}</a>` : esc(srcName[p.source] || p.source)}${p.ids?.wikidata ? ` · <a href="https://www.wikidata.org/wiki/${esc(p.ids.wikidata)}" target="_blank" rel="noopener">Wikidata</a>` : ""}</div>
      </li>`;
    };
    const nPlaces = new Set(w.productions.flatMap((p) => p.runs.map((r) => r.place).filter(Boolean))).size;
    const FIRST = 4;
    return `<div class="sec-head"><h2>Production history</h2><span class="count">${plural(w.productions.length, "production")}${nPlaces ? ` in ${plural(nPlaces, "city", "cities")}` : ""}</span></div>
      ${stagingStrip(w)}
      <ol class="prods">${prods.slice(0, FIRST).map(item).join("")}</ol>
      ${prods.length > FIRST ? `<details class="more-prods"><summary>Show ${prods.length - FIRST} earlier productions</summary><ol class="prods" style="margin-top:14px">${prods.slice(FIRST).map(item).join("")}</ol></details>` : ""}`;
  }
  function stagingStrip(w) {
    const pts = w.productions.map((p) => { const r = p.runs.find((x) => x.from); return r ? { y: parseInt(r.from, 10), kind: p.kind, d: r.district, where: places[r.place]?.name || "" } : null; }).filter((x) => x && !isNaN(x.y));
    if (pts.length < 2) return "";
    const lo = Math.min(...pts.map((p) => p.y)), hi = Math.max(...pts.map((p) => p.y)), span = Math.max(hi - lo, 1);
    return `<div class="strip" aria-hidden="true"><div class="st-line">${pts.map((p) => `<span class="st-tick${p.kind === "premiere" ? " prem" : ""}${p.d ? " dist" : ""}" style="left:${((p.y - lo) / span * 100).toFixed(2)}%" title="${esc(fy(p.y) + (p.where ? ", " + p.where : "") + (p.d ? " (" + p.d + ")" : ""))}"></span>`).join("")}</div><div class="st-ends"><span>${esc(fy(lo))}</span><span>${esc(fy(hi))}</span></div></div>`;
  }

  // the viewer's buttons for a play: seen, like, want to see, rating, log, lists
  function rateHTML(name, value, cls = "") {
    let h = `<div class="rate ${cls}" role="radiogroup" aria-label="Rating" data-rate="${value || 0}">`;
    for (let s = 1; s <= 5; s++) {
      const full = value >= s * 2, half = value === s * 2 - 1;
      h += `<span class="star${full ? " full" : half ? " half" : ""}">
        <input type="radio" name="${name}" id="${name}-${s * 2 - 1}" value="${s * 2 - 1}"${value === s * 2 - 1 ? " checked" : ""}><label class="l" for="${name}-${s * 2 - 1}"><span class="vh">${s - 0.5} stars</span></label>
        <input type="radio" name="${name}" id="${name}-${s * 2}" value="${s * 2}"${value === s * 2 ? " checked" : ""}><label class="r" for="${name}-${s * 2}"><span class="vh">${s} ${s === 1 ? "star" : "stars"}</span></label></span>`;
    }
    return h + `</div>`;
  }
  function paintRate(el, v) {
    el.dataset.rate = v || 0;
    $$(".star", el).forEach((s, i) => { s.classList.toggle("full", v >= (i + 1) * 2); s.classList.toggle("half", v === (i + 1) * 2 - 1); });
  }
  function wireRate(el, onSet) {
    el.addEventListener("mouseover", (e) => { const inp = e.target.closest("label")?.previousElementSibling; if (inp?.value) paintRate(el, +inp.value); });
    el.addEventListener("mouseleave", () => paintRate(el, +(el.dataset.value || 0)));
    // a tap on the rating already given clears it, as on Letterboxd
    el.addEventListener("click", (e) => {
      const lab = e.target.closest("label"); if (!lab) return;
      const v = +$("#" + CSS.escape(lab.htmlFor)).value;
      e.preventDefault();
      const next = +(el.dataset.value || 0) === v ? 0 : v;
      el.dataset.value = next; paintRate(el, next);
      $$("input", el).forEach((i) => (i.checked = +i.value === next));
      onSet(next);
    });
    el.addEventListener("change", (e) => { const v = +e.target.value; el.dataset.value = v; paintRate(el, v); onSet(v); });  // keyboard arrows
  }
  function renderPlayActions(w) {
    const s = myStatus[w.id] || {};
    const html = !signedIn() ? `<div class="actions"><div class="act-signin">Log, rate and review the shows you see, and keep a list of what you want to see.<button class="btn" type="button" data-auth-open="up">Create a free account</button><br><button class="linkbtn" type="button" data-auth-open="in" style="margin-top:10px">Log in</button></div></div>`
      : `<div class="actions">
        <div class="act-row">
          <button type="button" class="act seen" data-act="seen" aria-pressed="${!!s.seen}">${ICONS.eye}${s.seen ? "Seen" : "Seen it?"}</button>
          <button type="button" class="act like" data-act="liked" aria-pressed="${!!s.liked}">${ICONS.heart}${s.liked ? "Liked" : "Like"}</button>
          <button type="button" class="act want" data-act="want" aria-pressed="${!!s.want}">${ICONS.clock}${s.want ? "On my list" : "Want to see"}</button>
        </div>
        <div class="act-rate"><span class="label" id="rate-l">${s.rating ? "Rated" : "Rate"}</span>${rateHTML("prate", s.rating || 0)}</div>
        <button type="button" class="act-line" data-log-play>${(s.seen ? "Log again or review…" : "Log or review…")}</button>
        <button type="button" class="act-line" data-addlist>Add to lists…</button>
        <button type="button" class="act-line" data-share>Share</button>
      </div>`;
    const box = matchMedia("(max-width: 860px)").matches ? $("#play-actions-sm") : $("#play-actions");
    ($("#play-actions-sm") === box ? $("#play-actions") : $("#play-actions-sm")).innerHTML = "";
    box.innerHTML = html;
    const rate = $(".rate", box);
    if (rate) { rate.dataset.value = s.rating || 0; wireRate(rate, (v) => setStatus(w, { rating: v || null })); }
  }
  async function setStatus(w, patch) {
    if (!requireMe("Log in to keep track of what you've seen.")) return;
    const before = myStatus[w.id];
    try {
      const s = await S.setStatus(w.id, patch);
      if (s) myStatus[w.id] = s; else delete myStatus[w.id];
      if (patch.seen === true && !before?.seen) toast("Marked as seen");
      if (patch.want === true) toast("Added to your want-to-see list");
      if (location.hash === playUrl(w.id)) {
        renderPlayActions(w); refreshStats(w);
        if ("rating" in patch && patch.rating) $("#prate-" + patch.rating)?.focus({ preventScroll: true });
      }
    } catch (e) { toast(e.message); }
  }
  async function renderPlaySocial(w, tok) {
    refreshStats(w, tok);
    try {
      const logs = (await S.logsForPlay(w.id)).filter((l) => l.review || l.rating);
      if (stale(tok)) return;
      const el = $("#play-rev-list"); if (!el) return;
      const withText = logs.filter((l) => l.review);
      el.innerHTML = withText.length ? withText.map((l) => reviewHTML(l, { poster: false })).join("")
        : `<li class="empty">No reviews yet. ${signedIn() ? `<button class="linkbtn" type="button" data-log-play>Be the first to write one.</button>` : ""}</li>`;
      const lists = await S.listsWithPlay(w.id);
      if (stale(tok)) return;
      if (lists.length && $("#play-lists")) {
        $("#play-lists").innerHTML = `<h3>In ${plural(lists.length, "list")}</h3><ul class="minilists">${lists.slice(0, 6).map((l) => `<li><a href="#/list/${l.id}">${esc(l.title)}</a><small>by ${who(l.profile)} · ${plural(l.count, "show")}</small></li>`).join("")}</ul>`;
        $("#play-lists").hidden = false;
      }
    } catch (e) { const el = !stale(tok) && $("#play-rev-list"); if (el) el.innerHTML = `<li class="empty">Reviews could not be loaded. ${esc(e.message)}</li>`; }
  }
  async function refreshStats(w, tok = routeSeq) {
    try {
      const st = await S.playStats(w.id);
      if (stale(tok)) return;
      const el = $("#play-stats"); if (!el) return;
      const max = Math.max(1, ...st.hist);
      el.innerHTML = `<h3>${S.kind === "local" ? "Your rating" : "Ratings"}</h3>${S.kind === "local" && !st.ratings ? `<p class="hint">Not rated yet.</p>` : ""}
        ${st.ratings ? `<div style="display:flex;align-items:flex-end;gap:14px"><div style="flex:1"><div class="hist" aria-hidden="true">${st.hist.map((n) => `<span style="height:${Math.round((n / max) * 100)}%"></span>`).join("")}</div><div class="hist-ends"><span>★</span><span>★★★★★</span></div></div>
          <div><div class="avg">${st.avg.toFixed(1)}</div><small class="hint">${plural(st.ratings, "rating")}</small></div></div>` : `${S.kind === "local" ? "" : `<p class="hint">No ratings yet.</p>`}`}
        ${S.kind !== "local" ? `<div class="stats"><span><b>${st.seen.toLocaleString()}</b> seen</span><span><b>${st.likes.toLocaleString()}</b> likes</span><span><b>${st.wants.toLocaleString()}</b> want to see</span></div>` : ""}`;
    } catch (e) { /* the stats are a nicety */ }
  }
  pageEl().addEventListener("click", async (e) => {
    const t = e.target;
    const w = location.hash.startsWith("#/play/") ? byId[decodeURIComponent(location.hash.slice(7))] : null;
    const act = t.closest("[data-act]");
    if (act && w) { const k = act.dataset.act; return setStatus(w, { [k]: act.getAttribute("aria-pressed") !== "true" }); }
    if (t.closest("[data-log-play]") && w) return openLog(w.id);
    if (t.closest("[data-addlist]") && w) return openListPicker(w.id);
    if (t.closest("[data-share]") && w) return share(`${w.title} on Billd`, location.href);
    if (t.closest("[data-fix]") && w) return openFeedback({ id: w.id, title: w.title });
    const tr = t.closest("[data-trad]"); if (tr) return filterTradition(tr.dataset.trad);
    const pe = t.closest("[data-person]");
    if (pe) { $("#q").value = pe.dataset.person; state.q = fold(pe.dataset.person).split(/\s+/); for (const k in state.sel) state.sel[k].clear(); state.when = "ever"; totals(); location.hash = "#/browse"; return; }
    const lk = t.closest("[data-like-log]"); if (lk) return likeLog(lk);
    const sp = t.closest("[data-reveal]"); if (sp) { const b = sp.closest(".review").querySelector(".review-body"); b.hidden = false; sp.remove(); return; }
    const ed = t.closest("[data-edit-log]"); if (ed) { const l = await S.getLog(ed.dataset.editLog); if (l) openLog(l.play_id, l); return; }
    const fo = t.closest("[data-follow]"); if (fo) return follow(fo);
    if (t.closest("[data-log]")) return openLog(null);
    const ao = t.closest("[data-auth-open]"); if (ao) return openAuth(ao.dataset.authOpen);
  });
  async function share(title, url) {
    try { if (navigator.share) { await navigator.share({ title, url }); return; } } catch (e) { if (e.name === "AbortError") return; }
    try { await navigator.clipboard.writeText(url); toast("Link copied"); } catch (e) { prompt("Copy this link", url); }
  }

  // ---------------------------------------------------------------- reviews
  function reviewHTML(l, { poster: withPoster = true, full = false } = {}) {
    const w = byId[l.play_id];
    const mine = me && l.user_id === me.id;
    const body = l.review ? (l.spoilers && !mine && !full ? `<p class="spoiler">This review may contain spoilers. <button class="linkbtn" type="button" data-reveal>Read it anyway</button></p><p class="review-body" hidden>${esc(l.review)}</p>`
      : `<p class="review-body${full ? "" : " clamp"}">${esc(l.review)}</p>`) : "";
    return `<li class="review${withPoster && w ? "" : " noposter"}">${withPoster && w ? poster(w, { badge: false, cls: "sm" }) : ""}
      <div>${withPoster ? `<h3 class="review-title"><a href="${playUrl(l.play_id)}">${esc(w?.title || l.play_title)}</a>${w && fmtDate(w) ? `<small>${esc(fmtDate(w))}</small>` : ""}</h3>` : ""}
        <div class="review-head">${avatar(l.profile, "sm")}<a href="#/u/${esc(l.profile?.username)}">${who(l.profile)}</a>${l.rating ? `<span class="stars" aria-label="${starsLabel(l.rating)}">${stars(l.rating)}</span>` : ""}${l.liked ? `<span class="heart" title="Liked it">♥</span>` : ""}${l.rewatch ? `<span title="Seen before">↻</span>` : ""}
          <span>${l.seen_on ? `Seen ${esc(fmtPartial(l.seen_on))}` : ago(l.created_at)}${l.venue ? ` · ${esc(l.venue)}` : ""}</span></div>
        ${body}
        <div class="review-foot">
          ${S.kind !== "local" ? `<button type="button" data-like-log="${l.id}" aria-pressed="${!!l.liked_by_me}">♥ <span>${l.likes ? l.likes.toLocaleString() : ""}</span> ${l.liked_by_me ? "Liked" : "Like"}</button>
          <a href="#/review/${l.id}">${l.comments ? plural(l.comments, "comment") : "Comment"}</a>` : ""}
          ${mine ? `<button type="button" data-edit-log="${l.id}">Edit</button>` : ""}
        </div></div></li>`;
  }
  async function likeLog(btn) {
    if (!requireMe("Log in to like reviews.")) return;
    const on = btn.getAttribute("aria-pressed") !== "true";
    try {
      await S.likeLog(+btn.dataset.likeLog, on);
      btn.setAttribute("aria-pressed", String(on));
      const n = +($("span", btn).textContent || 0) + (on ? 1 : -1);
      btn.innerHTML = `♥ <span>${n > 0 ? n : ""}</span> ${on ? "Liked" : "Like"}`;
    } catch (e) { toast(e.message); }
  }
  async function renderReview(id) {
    const tok = routeSeq;
    const l = await S.getLog(id);
    if (stale(tok)) return;
    if (!l) return renderNotFound();
    const w = byId[l.play_id];
    document.title = `${l.profile?.display_name || l.profile?.username || "A member"}'s review of ${l.play_title} · Billd`;
    pageEl().innerHTML = `<div class="wrap" style="max-width:820px;padding-top:30px"><ul class="reviews">${reviewHTML(l, { full: true })}</ul>
      <section class="sec"><div class="sec-head"><h2>Comments</h2></div><ul class="comments" id="cm-list"><li class="hint">Loading…</li></ul>
      ${signedIn() && S.kind !== "local" ? `<form class="comment-form" id="cm-form"><label class="vh" for="cm-body">Add a comment</label><input id="cm-body" maxlength="2000" placeholder="Add a comment…" required><button class="btn" type="submit">Post</button></form>` : S.kind !== "local" ? `<p class="hint"><button class="linkbtn" type="button" data-auth-open="in">Log in</button> to comment.</p>` : ""}</section>
      ${w ? `<p style="margin-top:30px"><a class="linkbtn" href="${playUrl(w.id)}">More about ${esc(w.title)} →</a></p>` : ""}</div>`;
    const draw = async () => {
      const cs = await S.comments(l.id);
      if (stale(tok)) return;
      $("#cm-list").innerHTML = cs.length ? cs.map((c) => `<li><a class="who" href="#/u/${esc(c.profile?.username)}">${who(c.profile)}</a>${esc(c.body)}<time datetime="${esc(c.created_at)}">${ago(c.created_at)}</time>${me && c.user_id === me.id ? ` <button class="linkbtn danger" type="button" data-del-c="${c.id}">Delete</button>` : ""}</li>`).join("") : `<li class="hint">No comments yet.</li>`;
    };
    draw();
    $("#cm-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = $("#cm-body").value.trim(); if (!body) return;
      try { await S.addComment(l.id, body); $("#cm-body").value = ""; draw(); } catch (err) { toast(err.message); }
    });
    $("#cm-list").addEventListener("click", async (e) => { const d = e.target.closest("[data-del-c]"); if (d) { await S.deleteComment(+d.dataset.delC); draw(); } });
  }

  // ---------------------------------------------------------------- log dialog
  const logState = { play: null, edit: null, liked: false, rating: 0 };
  function openLog(playId, edit) {
    if (!requireMe("Log in to keep a diary of the shows you see.")) return;
    const d = $("#logd");
    logState.edit = edit || null;
    // a new entry starts from the rating and like already given to the show
    const st = playId ? myStatus[playId] : null;
    logState.liked = edit ? !!edit.liked : !!st?.liked; logState.rating = edit ? (edit.rating || 0) : (st?.rating || 0);
    $("#log-pick-f").hidden = !!playId;
    $("#log-form").hidden = !playId;
    $("#log-pick").value = ""; $("#log-pick-list").innerHTML = "";
    $("#log-note").hidden = true;
    if (playId) setLogPlay(playId); else { $("#log-title").textContent = "What did you see?"; $("#log-meta").textContent = ""; $("#log-poster").innerHTML = ""; $("#log-kicker").textContent = "Log a show"; }
    $("#log-date").value = edit ? (edit.seen_on || "") : localToday();
    $("#log-date").max = localToday();
    $("#log-venue").value = edit?.venue || ""; $("#log-city").value = edit?.city || "";
    $("#log-review").value = edit?.review || "";
    $("#log-spoil").checked = !!edit?.spoilers; $("#log-rewatch").checked = !!edit?.rewatch;
    $("#log-del").hidden = !edit;
    $("#log-save").textContent = edit ? "Save changes" : "Save";
    $("#log-rate").outerHTML = rateHTML("lrate", logState.rating, "big").replace('class="rate big"', 'class="rate big" id="log-rate"');
    const r = $("#log-rate"); r.dataset.value = logState.rating; wireRate(r, (v) => (logState.rating = v));
    $("#log-like").setAttribute("aria-pressed", String(logState.liked));
    if (!d.open) d.showModal();
    (playId ? $("#log-date") : $("#log-pick")).focus();
  }
  function setLogPlay(playId) {
    const w = byId[playId]; logState.play = w;
    $("#log-pick-f").hidden = true; $("#log-form").hidden = false;
    $("#log-kicker").textContent = logState.edit ? "Edit diary entry" : "I saw…";
    $("#log-title").textContent = w.title;
    $("#log-meta").textContent = [fmtDate(w), byText(w)].filter(Boolean).join(" · ");
    $("#log-poster").innerHTML = poster(w, { badge: false });
    if (!logState.edit && !logState.rating && myStatus[w.id]?.rating) { logState.rating = myStatus[w.id].rating; const r = $("#log-rate"); r.dataset.value = logState.rating; paintRate(r, logState.rating); }
    if (!logState.edit && !logState.liked && myStatus[w.id]?.liked) { logState.liked = true; $("#log-like").setAttribute("aria-pressed", "true"); }
    // the theatres where it is on now come first among the suggestions
    const run = (r) => [venues[r.venue]?.name, places[r.place]?.name];
    const fill = () => {
      const rs = w.productions.flatMap((p) => p.runs).sort((a, b) => (listingStatus(b.checked, b.from, b.to) ? 1 : 0) - (listingStatus(a.checked, a.from, a.to) ? 1 : 0) || (b.from || "").localeCompare(a.from || ""));
      const seen = new Set();
      $("#log-venues").innerHTML = rs.map(run).filter(([v]) => v && !seen.has(v) && seen.add(v)).slice(0, 30).map(([v, c]) => `<option value="${esc(v)}">${esc(c || "")}</option>`).join("");
      const cur = rs.find((r) => listingStatus(r.checked, r.from, r.to));
      if (cur && !logState.edit && !$("#log-venue").value) { $("#log-venue").value = venues[cur.venue]?.name || ""; $("#log-city").value = places[cur.place]?.name || ""; }
    };
    loadDetail(w).then(fill).catch(() => {});
  }
  $("#log-venue").addEventListener("change", () => {
    const w = logState.play; if (!w) return;
    const r = w.productions.flatMap((p) => p.runs).find((x) => venues[x.venue]?.name === $("#log-venue").value);
    if (r && places[r.place] && !$("#log-city").value) $("#log-city").value = places[r.place].name;
  });
  $("#log-pick").addEventListener("input", (e) => {
    const q = fold(e.target.value).split(/\s+/).filter(Boolean);
    if (!q.length) { $("#log-pick-list").innerHTML = ""; return; }
    const hits = works.filter((w) => q.every((t) => w._hay.includes(t))).sort((a, b) => b._pop - a._pop).slice(0, 12);
    $("#log-pick-list").innerHTML = hits.map((w) => `<li><button type="button" data-pick="${esc(w.id)}"><span>${esc(w.title)}</span><small>${esc([fmtDate(w), byText(w)].filter(Boolean).join(" · "))}</small></button></li>`).join("") || `<li class="hint">No match.</li>`;
  });
  $("#log-pick-list").addEventListener("click", (e) => { const b = e.target.closest("[data-pick]"); if (b) { setLogPlay(b.dataset.pick); $("#log-date").focus(); } });
  $("#log-like").addEventListener("click", (e) => { logState.liked = !logState.liked; e.currentTarget.setAttribute("aria-pressed", String(logState.liked)); });
  $("#log-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const w = logState.play; if (!w) return;
    const row = { play_id: w.id, play_title: w.title, seen_on: $("#log-date").value || null, rating: logState.rating || null, liked: logState.liked,
                  review: $("#log-review").value.trim() || null, spoilers: $("#log-spoil").checked, rewatch: $("#log-rewatch").checked,
                  venue: $("#log-venue").value.trim() || null, city: $("#log-city").value.trim() || null };
    if (row.seen_on && row.seen_on > localToday()) { note("#log-note", "The date seen can't be in the future.", true); return; }
    if (logState.edit) row.id = logState.edit.id;
    $("#log-save").disabled = true;
    try {
      await S.saveLog(row);
      const patch = { seen: true }; if (row.rating) patch.rating = row.rating; if (row.liked) patch.liked = true;
      const s = await S.setStatus(w.id, patch); if (s) myStatus[w.id] = s;
      $("#logd").close();
      toast(logState.edit ? "Entry updated" : row.review && S.kind !== "local" ? "Review posted" : "Added to your diary");
      route();
    } catch (err) { note("#log-note", err.message, true); }
    finally { $("#log-save").disabled = false; }
  });
  $("#log-del").addEventListener("click", async () => {
    if (!logState.edit || !confirm("Delete this diary entry? This can't be undone.")) return;
    try { await S.deleteLog(logState.edit.id); $("#logd").close(); toast("Entry deleted"); route(); } catch (e) { note("#log-note", e.message, true); }
  });
  function note(sel, msg, isErr, ok) { const n = $(sel); n.textContent = msg || ""; n.hidden = !msg; n.classList.toggle("err", !!isErr); n.classList.toggle("ok", !!ok); }

  // ---------------------------------------------------------------- lists
  let listPlay = null;
  async function openListPicker(playId) {
    if (!requireMe("Log in to make lists.")) return;
    listPlay = playId;
    $("#listd-play").textContent = byId[playId]?.title || "";
    $("#listd-items").innerHTML = `<li class="hint">Loading…</li>`;
    $("#listd").showModal();
    drawListPicker();
  }
  async function drawListPicker() {
    const ls = await S.listsForUser(me.id);
    $("#listd-items").innerHTML = ls.length ? ls.map((l) => `<li><label><input type="checkbox" data-lid="${l.id}"${l.items.some((i) => i.play_id === listPlay) ? " checked" : ""}> <span>${esc(l.title)} <small class="hint">${plural(l.count, "show")}</small></span></label></li>`).join("")
      : `<li class="hint">You have no lists yet. Name one below.</li>`;
    $("#listd-items").dataset.lists = JSON.stringify(ls.map((l) => ({ id: l.id, items: l.items })));
  }
  $("#listd-items").addEventListener("change", async (e) => {
    const cb = e.target.closest("[data-lid]"); if (!cb) return;
    const ls = JSON.parse($("#listd-items").dataset.lists || "[]");
    const l = ls.find((x) => x.id === +cb.dataset.lid); if (!l) return;
    const items = l.items.filter((i) => i.play_id !== listPlay);
    if (cb.checked) items.push({ play_id: listPlay });
    try { await S.setListItems(l.id, items); toast(cb.checked ? "Added to list" : "Removed from list"); drawListPicker(); } catch (err) { toast(err.message); cb.checked = !cb.checked; }
  });
  $("#listd-new").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = $("#listd-name").value.trim(); if (!title) return;
    try { const l = await S.saveList({ title }); await S.setListItems(l.id, [{ play_id: listPlay }]); $("#listd-name").value = ""; toast("List created"); drawListPicker(); } catch (err) { toast(err.message); }
  });
  function listCard(l) {
    const ps = l.items.slice(0, 5).map((i) => byId[i.play_id]).filter(Boolean);
    return `<a class="lcard" href="#/list/${l.id}"><div class="lcard-stack">${ps.map((w) => poster(w, { badge: false, tag: "span" })).join("")}${Array(Math.max(0, 5 - ps.length)).fill(`<span class="ph"></span>`).join("")}</div>
      <h3>${esc(l.title)}</h3><p>${who(l.profile)} · ${plural(l.count, "show")}${l.likes ? ` · ♥ ${l.likes}` : ""}</p></a>`;
  }
  async function renderLists() {
    const tok = routeSeq;
    document.title = "Lists · Billd";
    pageEl().innerHTML = `<div class="wrap" style="padding-top:30px"><div class="results-head"><h1 class="h1">Lists</h1>${signedIn() ? `<button class="btn" type="button" id="new-list">New list</button>` : ""}</div>
      <p class="count" style="margin-top:8px">Collect, rank and share the shows you love, want to see, or think everyone should know.</p>
      ${signedIn() ? `<section class="sec"><div class="sec-head"><h2>Your lists</h2></div><div class="lists-grid" id="my-lists"><p class="hint">Loading…</p></div></section>` : ""}
      ${S.kind !== "local" ? `<section class="sec"><div class="sec-head"><h2>Recently updated</h2></div><div class="lists-grid" id="all-lists"><p class="hint">Loading…</p></div></section>` : ""}</div>`;
    $("#new-list")?.addEventListener("click", () => editList(null));
    if (signedIn()) { const ls = await S.listsForUser(me.id); if (stale(tok)) return; $("#my-lists").innerHTML = ls.map(listCard).join("") || `<p class="empty">No lists yet. Start one from any show with “Add to lists”, or with New list.</p>`; }
    if (S.kind !== "local") { const ls = await S.recentLists(); if (stale(tok)) return; $("#all-lists").innerHTML = ls.map(listCard).join("") || `<p class="empty">No lists yet.</p>`; }
  }
  async function renderList(id) {
    const tok = routeSeq;
    const l = await S.getList(id);
    if (stale(tok)) return;
    if (!l) return renderNotFound();
    document.title = `${l.title} · Billd`;
    const mine = me && l.user_id === me.id;
    pageEl().innerHTML = `<div class="wrap" style="padding-top:30px">
      <p class="kicker">List by <a href="#/u/${esc(l.profile?.username)}">${who(l.profile)}</a></p>
      <h1 class="h1" style="margin-top:6px">${esc(l.title)}</h1>
      ${l.description ? `<p class="lead" style="margin-top:12px;max-width:62ch">${esc(l.description)}</p>` : ""}
      <div class="toolbar">
        ${mine ? `<button class="btn ghost sm" type="button" id="edit-list">Edit list</button>` : ""}
        ${S.kind !== "local" && !mine ? `<button class="btn ghost sm" type="button" id="like-list" aria-pressed="${l.liked_by_me}">♥ ${l.liked_by_me ? "Liked" : "Like"} ${l.likes ? `· ${l.likes}` : ""}</button>` : ""}
        <button class="btn ghost sm" type="button" id="share-list">Share</button>
        <span class="count">${plural(l.count, "show")}</span>
      </div>
      <ul class="list-items${l.ranked ? " ranked" : ""}">${l.items.map((i) => byId[i.play_id] ? `<li>${cell(byId[i.play_id], i.note ? `<div class="cell-cap">${esc(i.note)}</div>` : "")}</li>` : "").join("") || `<li class="empty">This list is empty.</li>`}</ul></div>`;
    $("#edit-list")?.addEventListener("click", () => editList(l));
    $("#share-list").addEventListener("click", () => share(`${l.title}, a list on Billd`, location.href));
    $("#like-list")?.addEventListener("click", async (e) => {
      if (!requireMe("Log in to like lists.")) return;
      try { await S.likeList(l.id, !l.liked_by_me); route(); } catch (err) { toast(err.message); }
    });
  }
  // the list and profile editors redraw their form; this puts focus back on the same control
  function refocus(attrs) {
    if (!attrs) return;
    for (const [k, v] of attrs) {
      const el = $(`#edit-form [${k}="${CSS.escape(v)}"]`) || $(`#edit-form [${k}]`);
      if (el) { el.focus(); return; }
    }
    $("#edit-form input")?.focus();
  }
  const focusKey = (e) => { const b = e.target.closest("button"); return b ? [...b.attributes].filter((a) => a.name.startsWith("data-")).map((a) => [a.name, a.value]) : null; };
  function editList(l) {
    const items = l ? [...l.items] : [];
    $("#edit-title").textContent = l ? "Edit list" : "New list";
    const draw = () => {
      $("#edit-form").innerHTML = `
        <div class="field"><label for="el-title">Name</label><input id="el-title" maxlength="100" required value="${esc(l?.title || "")}"></div>
        <div class="field"><label for="el-desc">Description <span class="opt">(optional)</span></label><textarea id="el-desc" maxlength="2000" style="min-height:5em">${esc(l?.description || "")}</textarea></div>
        <label class="check"><input type="checkbox" id="el-ranked"${l?.ranked ? " checked" : ""}> Ranked list (numbered in order)</label>
        <div class="field"><label for="el-add">Add a show</label><input id="el-add" type="search" placeholder="Start typing a title" autocomplete="off"><ul class="pick" id="el-pick"></ul></div>
        <ol class="list-edit" id="el-items">${items.map((it, i) => `<li><span>${esc(byId[it.play_id]?.title || it.play_id)}</span><button type="button" data-up="${i}" aria-label="Move up">↑</button><button type="button" data-down="${i}" aria-label="Move down">↓</button><button type="button" data-rm="${i}" aria-label="Remove">×</button></li>`).join("")}</ol>
        <p class="note" id="el-note" hidden></p>
        <div class="acts">${l ? `<button class="linkbtn danger" type="button" id="el-del">Delete list</button>` : ""}<button class="btn" type="submit">${l ? "Save" : "Create list"}</button></div>`;
    };
    draw();
    const form = $("#edit-form");
    form.oninput = (e) => {
      if (e.target.id !== "el-add") return;
      const q = fold(e.target.value).split(/\s+/).filter(Boolean);
      $("#el-pick").innerHTML = q.length ? works.filter((w) => q.every((t) => w._hay.includes(t))).sort((a, b) => b._pop - a._pop).slice(0, 8)
        .map((w) => `<li><button type="button" data-addp="${esc(w.id)}"><span>${esc(w.title)}</span><small>${esc(fmtDate(w))}</small></button></li>`).join("") : "";
    };
    form.onclick = async (e) => {
      const add = e.target.closest("[data-addp]");
      const snap = { title: $("#el-title").value, desc: $("#el-desc").value, ranked: $("#el-ranked").checked };
      const restore = () => { $("#el-title").value = snap.title; $("#el-desc").value = snap.desc; $("#el-ranked").checked = snap.ranked; };
      if (add) { if (!items.some((i) => i.play_id === add.dataset.addp)) items.push({ play_id: add.dataset.addp }); draw(); restore(); $("#el-add").focus(); return; }
      const up = e.target.closest("[data-up]"), dn = e.target.closest("[data-down]"), rm = e.target.closest("[data-rm]");
      if (up && +up.dataset.up > 0) { const i = +up.dataset.up; [items[i - 1], items[i]] = [items[i], items[i - 1]]; draw(); restore(); refocus([["data-up", String(i - 1)]]); return; }
      if (dn && +dn.dataset.down < items.length - 1) { const i = +dn.dataset.down; [items[i + 1], items[i]] = [items[i], items[i + 1]]; draw(); restore(); refocus([["data-down", String(i + 1)]]); return; }
      if (rm) { const k = focusKey(e); items.splice(+rm.dataset.rm, 1); draw(); restore(); refocus(k); return; }
      if (e.target.closest("#el-del")) {
        if (!confirm("Delete this list? This can't be undone.")) return;
        try { await S.deleteList(l.id); $("#editd").close(); toast("List deleted"); location.hash = "#/lists"; } catch (err) { note("#el-note", err.message, true); }
      }
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const title = $("#el-title").value.trim(); if (!title) { note("#el-note", "Give the list a name.", true); return; }
      try {
        const saved = await S.saveList({ id: l?.id, title, description: $("#el-desc").value.trim() || null, ranked: $("#el-ranked").checked });
        await S.setListItems(saved.id, items);
        $("#editd").close(); toast(l ? "List saved" : "List created");
        if (location.hash === `#/list/${saved.id}`) route(); else location.hash = `#/list/${saved.id}`;
      } catch (err) { note("#el-note", err.message, true); }
    };
    $("#editd").showModal();
    $("#el-title").focus();
  }

  // ---------------------------------------------------------------- profiles
  function renderMe() {
    if (me) { location.replace("#/u/" + encodeURIComponent(me.username)); return; }
    document.title = "Billd";
    pageEl().innerHTML = `<div class="wrap" style="padding-top:40px;max-width:640px"><h1 class="h1">Your theatre diary</h1>
      <p class="lead" style="margin-top:12px">Create a free account to log the shows you see, rate and review them, make lists, and follow friends.</p>
      <div class="acts" style="margin-top:20px;justify-content:flex-start"><button class="btn" type="button" data-auth-open="up">Create account</button><button class="btn ghost" type="button" data-auth-open="in">Log in</button></div></div>`;
  }
  let followingSet = null;
  async function myFollowing() {
    if (!me || S.kind === "local") return new Set();
    if (!followingSet) followingSet = new Set((await S.following(me.id)).map((p) => p.id));
    return followingSet;
  }
  async function renderProfile(username, tab = "") {
    const tok = routeSeq;
    const p = await S.getProfile(username);
    if (stale(tok)) return;
    if (!p) return renderNotFound();
    const mine = me && p.id === me.id;
    document.title = `${p.display_name || p.username} · Billd`;
    const [logs, statuses, lists] = await Promise.all([S.logsForUser(p.id), S.statusesFor(p.id), S.listsForUser(p.id)]);
    const [following, followers] = S.kind === "local" ? [[], []] : await Promise.all([S.following(p.id), S.followers(p.id)]);
    const fset = await myFollowing();
    if (stale(tok)) return;
    const seen = statuses.filter((s) => s.seen), want = statuses.filter((s) => s.want && !s.seen), liked = statuses.filter((s) => s.liked);
    const year = logs.filter((l) => (l.seen_on || l.created_at).startsWith(String(THIS_YEAR))).length;
    const base = "#/u/" + encodeURIComponent(p.username);
    const tabs = [["", "Profile"], ["diary", "Diary"], ["reviews", "Reviews"], ["seen", "Seen"], ["want", "Want to see"], ["lists", "Lists"], ["likes", "Likes"]]
      .concat(S.kind !== "local" ? [["following", "Following"], ["followers", "Followers"]] : []);
    let body = "";
    const grid = (rows, extra) => `<div class="grid">${rows.map((s) => byId[s.play_id] ? cell(byId[s.play_id], extra ? extra(s) : `<div class="cell-meta">${s.rating ? `<span class="stars">${stars(s.rating)}</span>` : ""}${s.liked ? `<span class="heart">♥</span>` : ""}</div>`) : "").join("")}</div>`;
    if (!tab) {
      const favs = (p.favorites || []).map((id) => byId[id]);
      body = `<section class="sec"><div class="sec-head"><h2>Favourite shows</h2>${mine ? `<button type="button" id="edit-favs">Edit</button>` : ""}</div>
          <div class="favs">${[0, 1, 2, 3].map((i) => favs[i] ? `<div>${poster(favs[i], { badge: false })}</div>` : `<div class="fav-empty">${mine ? "Pick a favourite in Edit profile" : ""}</div>`).join("")}</div></section>
        <section class="sec"><div class="sec-head"><h2>Recent activity</h2><a href="${base}/diary">Diary →</a></div>
          ${logs.length ? `<div class="grid dense">${logs.slice(0, 8).map((l) => byId[l.play_id] ? cell(byId[l.play_id], `<div class="cell-meta">${l.rating ? `<span class="stars">${stars(l.rating)}</span>` : ""}${l.liked ? `<span class="heart">♥</span>` : ""}${l.review ? `<span title="Reviewed">≡</span>` : ""}</div>`) : "").join("")}</div>` : `<p class="empty">${mine ? `Nothing logged yet. <button class="linkbtn" type="button" data-log>Log the last show you saw.</button>` : "Nothing logged yet."}</p>`}</section>
        ${logs.some((l) => l.review) ? `<section class="sec"><div class="sec-head"><h2>Recent reviews</h2><a href="${base}/reviews">All →</a></div><ul class="reviews">${logs.filter((l) => l.review).slice(0, 3).map((l) => reviewHTML(l)).join("")}</ul></section>` : ""}`;
    } else if (tab === "diary") {
      body = diaryHTML(logs, mine);
    } else if (tab === "reviews") {
      const rv = logs.filter((l) => l.review);
      body = rv.length ? `<ul class="reviews">${rv.map((l) => reviewHTML(l)).join("")}</ul>` : `<p class="empty">No reviews yet.</p>`;
    } else if (tab === "seen") body = seen.length ? grid(seen) : `<p class="empty">No shows marked as seen yet.</p>`;
    else if (tab === "want") body = want.length ? grid(want, () => "") : `<p class="empty">Nothing on the want-to-see list. Tap “Want to see” on any show.</p>`;
    else if (tab === "likes") body = liked.length ? grid(liked) : `<p class="empty">No liked shows yet.</p>`;
    else if (tab === "lists") body = `${mine ? `<p><button class="btn sm" type="button" id="new-list2">New list</button></p>` : ""}<div class="lists-grid">${lists.map(listCard).join("") || `<p class="empty">No lists yet.</p>`}</div>`;
    else if (tab === "following" || tab === "followers") {
      const ps = tab === "following" ? following : followers;
      body = ps.length ? `<ul class="members">${ps.map((m) => memberHTML(m, fset)).join("")}</ul>` : `<p class="empty">${tab === "following" ? "Not following anyone yet." : "No followers yet."}</p>`;
    }
    pageEl().innerHTML = `<div class="wrap">
      <header class="prof">${avatar(p, "lg")}
        <div class="prof-main"><h1>${who(p)}</h1><div class="handle">@${esc(p.username)}${S.kind === "local" ? " · saved on this device" : ""}</div>${p.bio ? `<p class="bio">${esc(p.bio)}</p>` : ""}
          <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">${mine ? `<a class="btn ghost sm" href="#/settings">Edit profile</a>` : S.kind !== "local" ? `<button class="btn sm${fset.has(p.id) ? " on" : ""}" type="button" data-follow="${p.id}" data-on="${fset.has(p.id)}">${fset.has(p.id) ? "Following" : "Follow"}</button>` : ""}
            <button class="btn ghost sm" type="button" id="share-prof">Share</button></div></div>
        <div class="prof-stats"><a href="${base}/seen"><b>${seen.length.toLocaleString()}</b><span>Shows</span></a><a href="${base}/diary"><b>${year.toLocaleString()}</b><span>This year</span></a><a href="${base}/lists"><b>${lists.length}</b><span>Lists</span></a>
          ${S.kind !== "local" ? `<a href="${base}/following"><b>${following.length}</b><span>Following</span></a><a href="${base}/followers"><b>${followers.length}</b><span>Followers</span></a>` : ""}</div>
      </header>
      <nav class="tabs" aria-label="Profile">${tabs.map(([k, n]) => `<a href="${base}${k ? "/" + k : ""}"${k === (tab || "") ? ' aria-current="page"' : ""}>${n}</a>`).join("")}</nav>
      ${body}</div>`;
    $('.tabs a[aria-current="page"]')?.scrollIntoView({ inline: "center", block: "nearest" });
    $("#share-prof").addEventListener("click", () => share(`${p.display_name || p.username} on Billd`, location.href));
    $("#edit-favs")?.addEventListener("click", () => editProfile());
    $("#new-list2")?.addEventListener("click", () => editList(null));
  }
  function diaryHTML(logs, mine) {
    if (!logs.length) return `<p class="empty">The diary is empty.${mine ? ` <button class="linkbtn" type="button" data-log>Log a show</button>` : ""}</p>`;
    const sorted = [...logs].sort((a, b) => (b.seen_on || b.created_at.slice(0, 10)).localeCompare(a.seen_on || a.created_at.slice(0, 10)));
    let lastMonth = "", rows = "";
    for (const l of sorted) {
      const d = l.seen_on || l.created_at.slice(0, 10);
      const m = d.slice(0, 7);
      const w = byId[l.play_id];
      rows += `<tr><td class="mon">${m !== lastMonth ? `${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}` : ""}</td><td class="day">${+d.slice(8, 10)}</td>
        <td class="t"><a href="${playUrl(l.play_id)}">${esc(w?.title || l.play_title)}</a>${w && fmtDate(w) ? `<small>${esc(fmtDate(w))}</small>` : ""}${l.venue ? `<small>${esc(l.venue)}</small>` : ""}</td>
        <td class="stars">${stars(l.rating)}</td><td class="heart">${l.liked ? "♥" : ""}</td><td class="hide-sm">${l.rewatch ? "↻" : ""}</td>
        <td>${l.review ? `<a href="#/review/${l.id}" title="Read review" aria-label="Read review">≡</a>` : ""}</td>
        <td>${mine ? `<button class="icon-btn" type="button" data-edit-log="${l.id}" aria-label="Edit entry">✎</button>` : ""}</td></tr>`;
      lastMonth = m;
    }
    return `<div class="diary-wrap"><table class="diary"><thead><tr><th>Month</th><th>Day</th><th>Show</th><th>Rating</th><th><span class="vh">Liked</span></th><th class="hide-sm"><span class="vh">Seen before</span></th><th><span class="vh">Review</span></th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  function memberHTML(m, fset) {
    const isMe = me && m.id === me.id;
    return `<li class="member">${avatar(m)}<div><a class="name" href="#/u/${esc(m.username)}">${who(m)}</a><small>@${esc(m.username)}</small></div>
      ${!isMe && S.kind !== "local" ? `<button class="btn sm${fset.has(m.id) ? " on" : ""}" type="button" data-follow="${m.id}" data-on="${fset.has(m.id)}">${fset.has(m.id) ? "Following" : "Follow"}</button>` : ""}</li>`;
  }
  async function follow(btn) {
    if (!requireMe("Log in to follow members.")) return;
    const on = btn.dataset.on !== "true";
    try {
      await S.follow(btn.dataset.follow, on);
      const fs = await myFollowing(); on ? fs.add(btn.dataset.follow) : fs.delete(btn.dataset.follow);
      btn.dataset.on = String(on); btn.textContent = on ? "Following" : "Follow"; btn.classList.toggle("on", on);
    } catch (e) { toast(e.message); }
  }
  async function renderMembers() {
    document.title = "Members · Billd";
    if (S.kind === "local") {
      pageEl().innerHTML = `<div class="wrap" style="padding-top:30px"><h1 class="h1">Members</h1><p class="banner"><b>Preview mode.</b> Members and following switch on when Billd's server is connected. Until then your diary is saved on this device.</p></div>`;
      return;
    }
    pageEl().innerHTML = `<div class="wrap" style="padding-top:30px"><h1 class="h1">Members</h1>
      <p class="count" style="margin:8px 0 16px">Follow friends and other theatregoers to see what they've seen and what they thought.</p>
      <form id="mem-form" role="search" style="max-width:420px;margin-bottom:20px"><label class="vh" for="mem-q">Find members</label><input id="mem-q" type="search" placeholder="Find members by name or username"></form>
      <ul class="members" id="mem-list"><li class="hint">Loading…</li></ul></div>`;
    const tok = routeSeq;
    const draw = async (q) => { const fset = await myFollowing(); const ms = await S.members(q); if (stale(tok)) return; $("#mem-list").innerHTML = ms.map((m) => memberHTML(m, fset)).join("") || `<li class="empty">No members found.</li>`; };
    draw();
    let t; $("#mem-q").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => draw(e.target.value.trim()), 250); });
    $("#mem-form").addEventListener("submit", (e) => e.preventDefault());
  }
  async function renderActivity(which) {
    const tok = routeSeq;
    document.title = "Activity · Billd";
    const everyone = which === "everyone" || !me || S.kind === "local";
    pageEl().innerHTML = `<div class="wrap" style="padding-top:30px;max-width:860px"><h1 class="h1">Activity</h1>
      ${S.kind !== "local" ? `<nav class="tabs" aria-label="Activity"><a href="#/activity"${!everyone ? ' aria-current="page"' : ""}>Friends</a><a href="#/activity/everyone"${everyone ? ' aria-current="page"' : ""}>Everyone</a></nav>` : `<p class="banner"><b>Preview mode.</b> This is your own activity. Friends' activity appears once Billd's server is connected.</p>`}
      <ul class="feed" id="feed"><li class="hint">Loading…</li></ul></div>`;
    try {
      const logs = (everyone ? await S.recentLogs(60) : await S.feed(60)).filter((l) => byId[l.play_id]);
      if (stale(tok)) return;
      $("#feed").innerHTML = logs.length ? logs.map(feedItem).join("") : `<li class="empty">${everyone ? `Nothing yet. <button class="linkbtn" type="button" data-log>Log a show</button> to get things started.` : `Nothing from people you follow yet. <a class="linkbtn" href="#/members">Find members to follow</a>.`}</li>`;
    } catch (e) { if (!stale(tok)) $("#feed").innerHTML = `<li class="empty">${esc(e.message)}</li>`; }
  }
  function feedItem(l) {
    const w = byId[l.play_id];
    const verb = l.review ? "reviewed" : l.rewatch ? "saw again" : "saw";
    return `<li>${poster(w, { badge: false })}<div class="what"><a href="#/u/${esc(l.profile?.username)}">${who(l.profile)}</a> ${verb} <a href="${l.review ? `#/review/${l.id}` : playUrl(w.id)}">${esc(w.title)}</a>
      ${l.rating ? ` <span class="stars" aria-label="${starsLabel(l.rating)}">${stars(l.rating)}</span>` : ""}${l.liked ? ` <span class="heart">♥</span>` : ""}${l.venue ? ` <small class="hint">at ${esc(l.venue)}</small>` : ""}</div><time datetime="${esc(l.created_at)}">${ago(l.created_at)}</time></li>`;
  }

  // ---------------------------------------------------------------- settings
  function renderSettings() {
    document.title = "Settings · Billd";
    let theme = "dark"; try { theme = localStorage.getItem("billd-theme") || "dark"; } catch (e) { /* default */ }
    const local = S.local && S.kind !== "local" && S.local.isLocalData();
    pageEl().innerHTML = `<div class="wrap" style="padding-top:30px;max-width:720px"><h1 class="h1">Settings</h1>
      ${me ? `<section class="sec"><div class="sec-head"><h2>Profile</h2></div><button class="btn ghost" type="button" id="st-prof">Edit profile and favourites</button></section>` : ""}
      <section class="sec"><div class="sec-head"><h2>Appearance</h2></div>
        <div class="seg" role="radiogroup" aria-label="Theme">${[["dark", "Dark"], ["light", "Light"]].map(([k, n]) => `<button type="button" role="radio" data-theme-set="${k}" aria-selected="${theme === k}" aria-checked="${theme === k}">${n}</button>`).join("")}</div></section>
      ${local && me ? `<section class="sec"><div class="sec-head"><h2>Diary saved on this device</h2></div><p>This device has shows you logged before you had an account. <button class="btn sm" type="button" id="st-import">Move them to my account</button></p></section>` : ""}
      <section class="sec"><div class="sec-head"><h2>Your data</h2></div><p class="hint" style="margin-bottom:10px">Download everything you've logged, rated, reviewed and listed, as a JSON file.</p><button class="btn ghost" type="button" id="st-export"${me ? "" : " disabled"}>Download my data</button></section>
      ${me && S.kind !== "local" ? `<section class="sec"><div class="sec-head"><h2>Account</h2></div><form id="st-pw" style="display:flex;gap:8px;flex-wrap:wrap;max-width:460px"><label class="vh" for="st-pass">New password</label><input id="st-pass" type="password" minlength="8" placeholder="New password" autocomplete="new-password" style="flex:1"><button class="btn ghost" type="submit">Change password</button></form>
        <p style="margin-top:18px"><button class="btn ghost" type="button" id="st-out">Log out</button></p></section>` : ""}
      ${S.kind === "local" ? `<section class="sec"><div class="sec-head"><h2>Preview mode</h2></div><p class="hint">Billd isn't connected to its server yet, so your diary lives in this browser. Clearing your browser data would erase it; download it above to keep a copy.</p><p><button class="linkbtn danger" type="button" id="st-clear">Erase the diary on this device</button></p></section>` : ""}
    </div>`;
    $("#st-prof")?.addEventListener("click", editProfile);
    $$("[data-theme-set]").forEach((b) => b.addEventListener("click", () => {
      const t = b.dataset.themeSet; document.documentElement.dataset.theme = t;
      try { localStorage.setItem("billd-theme", t); } catch (e) { /* not kept */ }
      renderSettings();
    }));
    $("#st-export")?.addEventListener("click", exportData);
    $("#st-out")?.addEventListener("click", async () => { await S.signOut(); toast("Logged out"); location.hash = "#/"; });
    $("#st-pw")?.addEventListener("submit", async (e) => { e.preventDefault(); try { await S.setPassword($("#st-pass").value); $("#st-pass").value = ""; toast("Password changed"); } catch (err) { toast(err.message); } });
    $("#st-clear")?.addEventListener("click", () => { if (confirm("Erase every show, rating, review and list saved on this device?")) { S.clearLocal(); myStatus = {}; toast("Erased"); route(); } });
    $("#st-import")?.addEventListener("click", async (e) => {
      e.target.disabled = true;
      try { await S.importLocal(S.local.exportLocal()); S.local.clearLocal(); myStatus = await S.myStatuses(); toast("Moved to your account"); route(); }
      catch (err) { toast(err.message); e.target.disabled = false; }
    });
  }
  async function exportData() {
    const [logs, statuses, lists] = await Promise.all([S.logsForUser(me.id, { limit: 5000 }), S.statusesFor(me.id), S.listsForUser(me.id)]);
    const blob = new Blob([JSON.stringify({ profile: me, exported: new Date().toISOString(), statuses, logs, lists }, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `billd-${me.username}-${TODAY}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function editProfile() {
    const favs = [...(me.favorites || [])];
    $("#edit-title").textContent = "Edit profile";
    const draw = (vals) => {
      $("#edit-form").innerHTML = `
        ${S.kind !== "local" ? `<div class="field"><label for="ep-user">Username</label><input id="ep-user" maxlength="20" value="${esc(vals.username)}" autocapitalize="none" spellcheck="false"></div>` : ""}
        <div class="field"><label for="ep-name">Display name</label><input id="ep-name" maxlength="50" value="${esc(vals.display_name)}"></div>
        <div class="field"><label for="ep-bio">Bio <span class="opt">(optional)</span></label><textarea id="ep-bio" maxlength="500" style="min-height:5em">${esc(vals.bio)}</textarea></div>
        <div class="field"><span class="label">Favourite shows <span class="opt">(up to four)</span></span>
          <ol class="list-edit">${favs.map((id, i) => `<li><span>${esc(byId[id]?.title || id)}</span><button type="button" data-frm="${i}" aria-label="Remove">×</button></li>`).join("")}</ol>
          ${favs.length < 4 ? `<input id="ep-add" type="search" placeholder="Add a favourite" autocomplete="off"><ul class="pick" id="ep-pick"></ul>` : ""}</div>
        <p class="note" id="ep-note" hidden></p>
        <div class="acts"><button class="btn" type="submit">Save</button></div>`;
    };
    const vals = () => ({ username: $("#ep-user")?.value ?? me.username, display_name: $("#ep-name").value, bio: $("#ep-bio").value });
    draw({ username: me.username, display_name: me.display_name || "", bio: me.bio || "" });
    const form = $("#edit-form");
    form.oninput = (e) => {
      if (e.target.id !== "ep-add") return;
      const q = fold(e.target.value).split(/\s+/).filter(Boolean);
      $("#ep-pick").innerHTML = q.length ? works.filter((w) => q.every((t) => w._hay.includes(t))).sort((a, b) => b._pop - a._pop).slice(0, 8)
        .map((w) => `<li><button type="button" data-fadd="${esc(w.id)}"><span>${esc(w.title)}</span><small>${esc(fmtDate(w))}</small></button></li>`).join("") : "";
    };
    form.onclick = (e) => {
      const a = e.target.closest("[data-fadd]"), r = e.target.closest("[data-frm]");
      if (a && favs.length < 4 && !favs.includes(a.dataset.fadd)) { const v = vals(); favs.push(a.dataset.fadd); draw(v); $("#ep-add")?.focus(); }
      if (r) { const v = vals(); favs.splice(+r.dataset.frm, 1); draw(v); refocus([["data-frm", r.dataset.frm]]); }
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const v = vals();
      try {
        const patch = { display_name: v.display_name.trim() || null, bio: v.bio.trim() || null, favorites: favs };
        if (S.kind !== "local" && v.username.trim().toLowerCase() !== me.username) patch.username = v.username.trim().toLowerCase();
        me = await S.updateProfile(patch);
        $("#editd").close(); toast("Profile saved"); renderAcct();
        if (location.hash.startsWith("#/u/")) location.hash = "#/u/" + encodeURIComponent(me.username); else route();
      } catch (err) { note("#ep-note", /duplicate|unique/i.test(err.message) ? "That username is taken." : err.message, true); }
    };
    $("#editd").showModal();
  }
  function renderAbout() {
    document.title = "About the data · Billd";
    pageEl().innerHTML = `<div class="wrap prose" style="padding-top:30px"><h1 class="h1">About the data</h1>
      <p>Billd lists ${works.length.toLocaleString()} plays and musicals with ${works.reduce((a, w) => a + w._n, 0).toLocaleString()} recorded productions. Every production names its source and links to it; where a fact isn't known, it's left blank rather than guessed.</p>
      <h2>Sources</h2>
      <ul><li>Curated entries compiled for Billd from standard reference works.</li>
        <li><a href="https://www.wikidata.org" target="_blank" rel="noopener">Wikidata</a> (CC0).</li>
        <li><a href="https://en.wikipedia.org" target="_blank" rel="noopener">English</a> and <a href="https://ru.wikipedia.org" target="_blank" rel="noopener">Russian</a> Wikipedia: article summaries and stagings, CC BY-SA 4.0, credited on each play.</li>
        <li><a href="https://opendata.idu.cz" target="_blank" rel="noopener">Institut umění – Divadelní ústav</a>: Czech productions, CC BY 4.0.</li>
        <li><a href="https://theaterencyclopedie.nl" target="_blank" rel="noopener">TheaterEncyclopedie</a>: Dutch and Flemish productions, CC0.</li>
        <li><a href="https://www.kunsten.be" target="_blank" rel="noopener">Kunstenpunt – Flanders Arts Institute</a> open data.</li>
        <li>What's on now: Wikipedia's Broadway and West End theatre lists, with ticket links to each theatre's own site, and the <a href="https://developer.ticketmaster.com" target="_blank" rel="noopener">Ticketmaster Discovery API</a>.</li></ul>
      <h2>On stage now</h2><p>A show counts as on now or coming soon only if a listing confirmed it in the last ${STALE_DAYS} days and its closing date hasn't passed. Ticket links go to the theatre's own box office or to Ticketmaster; Billd doesn't sell tickets and isn't paid for links.</p>
      <h2>Found a mistake?</h2><p>Use “Suggest a correction” on any show, or <button class="linkbtn" type="button" id="ab-fb">send feedback</button>.</p></div>`;
    $("#ab-fb").addEventListener("click", () => openFeedback(null));
  }

  // ---------------------------------------------------------------- auth dialog
  let authMode = "in";
  function openAuth(mode = "in", why) {
    if (S.kind === "local") { toast("Accounts arrive when Billd's server is connected. Your diary is saved on this device."); return; }
    setAuthMode(mode);
    note("#auth-note", why || "");
    $("#auth").showModal();
    (mode === "up" ? $("#auth-user") : $("#auth-email")).focus();
  }
  function setAuthMode(mode) {
    authMode = mode;
    $$("[data-auth]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.auth === mode)));
    $("#auth-title").textContent = mode === "up" ? "Join Billd" : mode === "reset" ? "Reset your password" : "Welcome back";
    $("#auth-user-f").hidden = mode !== "up";
    $("#auth-pass-f").hidden = mode === "reset";
    $("#auth-pass").autocomplete = mode === "up" ? "new-password" : "current-password";
    $("#auth-go").textContent = mode === "up" ? "Create account" : mode === "reset" ? "Email me a reset link" : "Log in";
    $("#auth-forgot").hidden = mode !== "in";
    note("#auth-note", "");
  }
  $$("[data-auth]").forEach((b) => b.addEventListener("click", () => setAuthMode(b.dataset.auth)));
  $("#auth-forgot").addEventListener("click", () => setAuthMode("reset"));
  $("#auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#auth-email").value.trim(), pass = $("#auth-pass").value, user = $("#auth-user").value.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return note("#auth-note", "Enter your email address.", true);
    if (authMode !== "reset" && pass.length < 8) return note("#auth-note", "Passwords are at least 8 characters.", true);
    $("#auth-go").disabled = true;
    try {
      if (authMode === "up") {
        const r = await S.signUp(email, pass, user);
        if (r.confirm) { note("#auth-note", "Almost there: open the link we emailed you to confirm your address, then log in.", false, true); return; }
        $("#auth").close(); toast(`Welcome to Billd, @${user}`);
      } else if (authMode === "reset") {
        await S.resetPassword(email); note("#auth-note", "If there's an account for that email, a reset link is on its way.", false, true); return;
      } else {
        await S.signIn(email, pass); $("#auth").close(); toast("Welcome back");
      }
    } catch (err) { note("#auth-note", err.message, true); }
    finally { $("#auth-go").disabled = false; }
  });

  // ---------------------------------------------------------------- dialogs: shared behaviour
  // A click in the dialog's own padding also targets the dialog, so the pointer must be outside
  // its box, both when pressed and when released (a drag out of the review box keeps the text).
  $$("dialog").forEach((d) => {
    const outside = (e) => { const r = d.getBoundingClientRect(); return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom; };
    let downOutside = false;
    d.addEventListener("pointerdown", (e) => { downOutside = e.target === d && outside(e); });
    d.addEventListener("click", (e) => {
      if (e.target.closest("[data-close]")) return d.close();
      if (e.target === d && downOutside && outside(e)) d.close();
      downOutside = false;
    });
  });

  // ---------------------------------------------------------------- feedback
  const fb = { ctx: null, busy: false };
  const web = CFG.feedback?.endpoint ? CFG.feedback : null;
  function openFeedback(ctx) {
    fb.ctx = ctx || null;
    $("#fb-title").textContent = ctx ? "Suggest a correction" : "Feedback";
    $("#fb-about").textContent = ctx ? ctx.title : "Tell us what works, what is missing, or what looks wrong.";
    $("#fb-text").placeholder = ctx ? "What is wrong or missing? A date, a playwright, a production…" : "";
    $("#fb-rate").hidden = !!ctx;
    $("#fb-form").hidden = false; $("#fb-done").hidden = true;
    note("#fb-note", web ? "" : "Feedback can't be sent from this copy of Billd. Copy your text and send it to the owner another way.", !web);
    $("#fb-send").disabled = !web; $("#fb-copy").hidden = !!web;
    $("#fb").showModal(); $("#fb-text").focus();
  }
  $("#fb-open").addEventListener("click", () => openFeedback(null));
  $("#fb-copy").addEventListener("click", () => {
    const text = (fb.ctx ? `Correction for "${fb.ctx.title}" (${fb.ctx.id}):\n` : "Billd feedback:\n") + $("#fb-text").value.trim();
    navigator.clipboard?.writeText(text).then(() => note("#fb-note", "Copied. Paste it into a message to the owner.", false, true), () => { $("#fb-text").select(); });
  });
  $("#fb-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (fb.busy || !web) return;
    const comment = $("#fb-text").value.trim();
    if (!comment) { note("#fb-note", "Write a comment before sending.", true); return; }
    const rating = document.querySelector('input[name="fb-rating"]:checked')?.value;
    // a form service (Web3Forms, Formspree) that emails each submission to the owner
    const body = { ...(web.fields || {}), from_name: "Billd", subject: fb.ctx ? `Billd correction: ${fb.ctx.title}` : "Billd feedback", message: comment };
    const name = $("#fb-name").value.trim() || (me ? `${me.display_name || ""} @${me.username}`.trim() : "");
    if (name) body.name = name;
    if (!fb.ctx && rating) body.rating = rating;
    if (fb.ctx) { body.play = fb.ctx.title; body.play_link = location.origin + location.pathname + playUrl(fb.ctx.id); }
    fb.busy = true; $("#fb-send").disabled = true; note("#fb-note", "Sending…");
    try {
      const res = await fetch(web.endpoint, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(res.status === 429 ? "Too many messages at once. Wait a minute, then send again." : "Your feedback was not sent. Try again in a moment.");
      $("#fb-text").value = ""; $("#fb-r0").checked = true; note("#fb-note", "");
      $("#fb-form").hidden = true; $("#fb-done").hidden = false; $("#fb-thanks").focus();
    } catch (err) { note("#fb-note", err.message.startsWith("Too") || err.message.startsWith("Your") ? err.message : "Your feedback was not sent because the connection failed. Try again in a moment.", true); }
    finally { fb.busy = false; $("#fb-send").disabled = false; }
  });

  // ---------------------------------------------------------------- installable app
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol) && !window.claude && window.top === window) {
    window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => { /* offline support is optional */ }); });
  }
  let installPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; $("#install-wrap").hidden = false; });
  $("#install").addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    try { await installPrompt.userChoice; } catch (e) { /* dismissed */ }
    installPrompt = null; $("#install-wrap").hidden = true;
  });
  document.body.addEventListener("click", (e) => {  // buttons outside the page area (home hero, footer)
    if (e.target.closest("#page")) return;
    if (e.target.closest("[data-log]") && !e.target.closest("#acct")) openLog(null);
  });

  // ---------------------------------------------------------------- start
  async function loadSocial() {
    try { await S.ready; } catch (e) { console.warn(e); toast(e.message); }
    me = S.me();
    renderAcct();
    try { myStatus = me ? await S.myStatuses() : {}; } catch (e) { myStatus = {}; }
    try { (await S.popular(60)).forEach((r, i) => (popular[r.play_id] = 1000 - i)); } catch (e) { /* none yet */ }
    try { (await S.ratedPlays()).forEach((r) => (rated[r.play_id] = { avg: r.avg_rating != null ? Number(r.avg_rating) : null, n: r.ratings, seen: r.seen })); } catch (e) { /* none yet */ }
  }
  S.onAuth(async (p) => {
    me = p; followingSet = null; renderAcct();
    try { myStatus = me ? await S.myStatuses() : {}; } catch (e) { myStatus = {}; }
    if (D) { if (FACETS.length) totals(); route(); }
  });
  renderAcct();
  // The plays never wait more than a few seconds for members' data: if Supabase is slow or its
  // free project is paused, the site opens anyway and fills in accounts when they arrive.
  const social = loadSocial().then(() => { if (D) { renderAcct(); totals(); route(); } });
  Promise.all([load(), Promise.race([social, new Promise((ok) => setTimeout(ok, 5000))])]).then(([data]) => init(data)).catch((err) => {
    $("#loading").innerHTML = `Could not load the plays (${esc(err.message)}). Run <code>python3 build_db.py</code>, or serve the <code>web/</code> folder with <code>python3 -m http.server</code>.`;
  });
})();
