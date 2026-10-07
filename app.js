// Billd: the page. Plays come from the static data files (data/index.json and its
// shards, or plays.js when opened as a file); members, diaries, reviews and lists
// come from social.js. Pages are drawn from the address (#/play/…, #/u/…), so every
// page has a link that can be shared, and the back button works.
"use strict";
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // a link from data (scraped, researched or sent by a member) is used only if it is http(s)
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u ?? "").trim()) ? String(u).trim() : "");
  const fold = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const S = window.BilldSocial;
  const CFG = window.DQ_CONFIG || {};
  // the iPhone and Android apps (web/native.js); on the website APP is false and N's calls do what the site always did
  const N = window.BilldNative;
  const APP = !!N.isApp;
  const OB = window.BilldOutbox;
  const DEVICE = APP ? "phone" : "device";

  // lookups without a prototype, so an id such as "constructor" or "__proto__" finds nothing
  const dict = () => Object.create(null);
  let D, works = [], byId = dict(), trad = dict(), reg = dict(), lang = dict(), ppl = dict(), genre = dict();
  let places = dict(), venues = dict(), orgs = dict();
  let me = null, myStatus = {}, rated = {}, popular = {};
  // members the signed-in member blocked: the database already hides their posts from everyone but the
  // Billd team; the page also leaves them out (for the team's own feeds, and as a second line)
  let blockedSet = new Set(), dbSettings = {};
  const notBlocked = (rows, key = "user_id") => (blockedSet.size ? rows.filter((r) => !blockedSet.has(r[key] ?? r.profile?.id)) : rows);

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
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), msg.length > 60 ? 6000 : 2600);
  }
  function avatar(p, cls = "") {
    const name = p?.display_name || cap(p?.username) || "?";
    return `<a class="avatar ${cls}" href="#/u/${esc(p?.username || "")}" style="--hue:${hash(p?.username || "") % 360}" aria-label="${esc(name)}">${esc(name.trim()[0] || "?")}</a>`;
  }
  const cap = (u) => (u ? u.charAt(0).toUpperCase() + u.slice(1) : "");
  const who = (p) => esc(p?.display_name || cap(p?.username) || "Someone");
  const playUrl = (id) => "#/play/" + encodeURIComponent(id);

  // ---------------------------------------------------------------- data
  // the app's downloaded catalogue (web/native.js), or null: the files beside the page
  let dataSrc = null;
  async function load() {
    if (window.PLAYS_DATA) return window.PLAYS_DATA;
    if (APP) {  // a newer catalogue downloaded from billd.theater, else the one the app was built with
      try { dataSrc = await N.catalogue.source(); if (dataSrc) return await dataSrc.json("index.json"); }
      catch (e) { console.warn("catalogue: using the bundled copy", e); dataSrc = null; }
    }
    // ask the server each time (GitHub Pages lets browsers reuse the index for 10 minutes), so a new publish shows at once
    const get = (url) => fetch(url, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
    return get("data/index.json").catch(() => get("plays.json"));
  }
  // a file of the catalogue (a shard, the credits): named with the build's date, so a cached copy is always right
  const dataJSON = (path) => (dataSrc ? dataSrc.json(path)
    : fetch(`data/${path}?v=${encodeURIComponent(D.meta.generated)}`).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }));
  // The split site (build_db.py --site) ships a compact index and loads each play's
  // description and productions from a shard when the play is opened.
  function expandIndex(data) {
    const P = data.people.map((r) => ({ slug: r[0], name: r[1], name_native: r[2] ?? null, birth_year: r[3] ?? null, death_year: r[4] ?? null, dates_approx: !!r[5] }));
    data.people = P;
    data.works = data.works.map((c, i) => ({
      id: c.i, title: c.t, original_title: c.o || null, alt_titles: c.at || [], search_titles: c.hs || [],
      people: (c.p || []).map((x) => Array.isArray(x) ? { person: P[x[0]].slug, role: x[1], disputed: !!x[2] } : { person: P[x].slug, role: "playwright", disputed: false }),
      tradition: c.tr || null, tradition_rule: c.tl || null, languages: c.l || [], region: c.r || null,
      year_from: c.a ?? null, year_to: c.b ?? null, date_basis: c.db || null, era: c.e || "undated",
      genres: c.g || [], date_certain: !!c.c, attribution_disputed: !!c.d, source: c.s || "wikidata",
      ids: {}, notes: null, productions: [], _lazy: true, _shard: i % data.shards, image: c.im || null,
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
    // a closing date may be a year or a month ("2000", "2026-08"): compare it at its own precision
    if (to && to < TODAY.slice(0, to.length)) return null;
    if (!to && from && from.length < 10 && from < TODAY.slice(0, from.length)) return null;
    if (from && from.length === 10 && from > TODAY) return "soon";
    return "now";
  }
  // Actors and directors: data/credits.json lists who was in or directed each play. It comes after the
  // page is up; its names join each play's search text, so searching a name finds their shows.
  let creditsLoaded = false;
  function loadCredits() {
    if (creditsLoaded || !D?.meta?.generated || !D.shards) return;
    creditsLoaded = true;
    dataJSON("credits.json").then((c) => {
      if (!c) return;
      const names = c.names.map((n) => fold(n));
      for (const [id, list] of Object.entries(c.works)) {
        const w = byId[id]; if (!w) continue;
        w._hay += " \u0001 " + list.map((i) => names[i]).join(" \u0001 ");
      }
      if (state.q.length && !$("#v-browse").hidden) applyBrowse();
    }).catch(() => { creditsLoaded = false; });
  }
  const shardCache = {};
  function loadDetail(w) {
    if (!w._lazy || w._loaded) return Promise.resolve(w);
    const n = String(w._shard).padStart(2, "0");
    shardCache[n] = shardCache[n] || dataJSON(`d/${n}.json`);
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
      // search_titles: a title as written when the one shown has a masked word (build_db.py), so it's still found
      w._hay = fold([w.title, w.original_title, ...w.alt_titles, ...(w.search_titles || []),
        ...w.people.map((p) => `${ppl[p.person]?.name || ""} ${ppl[p.person]?.name_native || ""}`),
        trad[w.tradition]?.name, regionName(w.region), ...w.languages.map((l) => lang[l]?.name), ...w.genres,
        ...[...new Set(w._runs.map((r) => r.place))].map((id) => places[id]?.name || ""), ...w._ds].join(" \u0001 "));
    }
    $("#gen").textContent = `${plural(works.length, "play")}, with ${plural(works.reduce((a, w) => a + w._n, 0), "production")}. Data built ${data.meta.generated.slice(0, 10)}.`;
    buildFacets();
    restorePrefs();
    $("#loading").hidden = true;
    loadCredits();
    route();
    // the app: fetch a newer catalogue from billd.theater in the background, for the next launch
    if (APP && !window.PLAYS_DATA) setTimeout(() => N.catalogue.refresh().catch((e) => console.warn("catalogue refresh:", e.message)), 5000);
  }

  // ---------------------------------------------------------------- posters
  const PALETTE = [  // [cover, type, brass]: deep jewel programme covers, each with a brass or ink accent
    ["#6d1726", "#fbf1dc", "#e3c27a"], ["#1d3d5c", "#f6efe2", "#e3c27a"], ["#1f5f5b", "#f2ece0", "#e9c97a"],
    ["#3b3a7a", "#f4ecf6", "#e3c27a"], ["#7a3a12", "#fbf1e4", "#f0d48c"], ["#245a3a", "#eef3e6", "#e9c97a"],
    ["#4a1420", "#f6ead6", "#d9a84a"], ["#2a2f45", "#f2ece0", "#e3c27a"], ["#a87a22", "#24170a", "#24170a"],
    ["#5b2a3a", "#fbeef3", "#f0d48c"], ["#5a4a2a", "#f6f0dc", "#f0d48c"], ["#16494d", "#eef3ef", "#e3c27a"],
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
    // a real picture when there is one (a free Commons image, never a production's artwork); the designed
    // cover stays underneath and shows again if the picture can't load
    const img = w.image && w.image[1] === "commons" ? `<img class="p-img" src="${esc(safeUrl(w.image[0]))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : "";
    return `<${tag} class="poster ${layout} ${cls}"${tag === "a" ? ` href="${playUrl(w.id)}"` : ""} style="--bg1:${bg};--fg:${fg};--acc:${acc}" aria-label="${esc(t)}${yearOf(w) != null ? ` (${esc(fmtDate(w))})` : ""}">${img}${nb}
      <span class="p-top" aria-hidden="true">${esc(top)}</span>
      <span class="p-title${size}" aria-hidden="true" lang="en">${esc(t)}</span>
      <span class="p-rule" aria-hidden="true"></span>
      <span class="p-by" aria-hidden="true">${esc(byText(w) || "Anonymous")}</span>
      <span class="p-yr" aria-hidden="true">${esc(fmtDate(w))}</span></${tag}>`;
  }
  // A picture replaces the designed cover once it has loaded. A wide one (Ticketmaster's artwork,
  // a landscape photo) sits whole across the top, like a playbill, so its own lettering isn't cut off.
  function billdImg(img) {
    const p = img.parentNode; if (!p) return;
    p.classList.add("has-img");
    if (img.naturalWidth > img.naturalHeight * 1.05) p.classList.add("wide");
  }
  // load and error don't bubble, so these listen in the capture phase (no inline handlers: the
  // page's content security policy forbids them)
  document.addEventListener("load", (e) => { const t = e.target; if (t.matches?.("img.p-img")) billdImg(t); }, true);
  document.addEventListener("error", (e) => {
    const t = e.target;
    if (t.matches?.("img.p-img")) t.remove();
    else if (t.matches?.(".np-art img")) t.parentNode?.remove();
  }, true);
  // who made the picture: Commons images need their author and licence; Ticketmaster's are its own
  function imageCredit(w) {
    const im = w.image; if (!im) return "";
    const [, , credit, license, page] = im;
    return `<p class="img-credit">Image: ${creditHTML(credit, license, page)}</p>`;
  }
  // Credit for a Commons picture: author (or "author unknown"), licence linked to its text, and the file's page
  function licenseLink(l) {
    const m = /^CC (BY(?:-SA)?) (\d\.\d)(?: ([a-z]{2}))?$/i.exec(l || "");
    if (m) return `https://creativecommons.org/licenses/${m[1].toLowerCase()}/${m[2]}/${m[3] ? m[3].toLowerCase() + "/" : ""}`;
    if (/^CC0$/i.test(l || "")) return "https://creativecommons.org/publicdomain/zero/1.0/";
    if (/^FAL$/i.test(l || "")) return "https://artlibre.org/licence/lal/en/";
    return "";
  }
  function creditHTML(credit, license, page) {
    const lic = license ? (licenseLink(license) ? `<a href="${esc(licenseLink(license))}" target="_blank" rel="noopener license">${esc(license)}</a>` : esc(license)) : "";
    return `${credit ? esc(credit) : "author unknown"}${lic ? `, ${lic}` : ""}, via <a href="${esc(safeUrl(page) || "https://commons.wikimedia.org/")}" target="_blank" rel="noopener">Wikimedia Commons</a>`;
  }
  // #/credits: every picture on Billd with its author and licence (a poster in a grid has no room for one)
  function renderCredits() {
    document.title = "Image credits · Billd";
    const rows = works.filter((w) => w.image && w.image[1] === "commons").sort((a, b) => a.title.localeCompare(b.title));
    pageEl().innerHTML = `<div class="wrap prose" style="padding-top:30px"><h1 class="h1">Image credits</h1>
      <p>Billd's posters use free pictures from <a href="https://commons.wikimedia.org" target="_blank" rel="noopener">Wikimedia Commons</a>: premiere posters, title pages, programmes and production photos. Here is each one with its author and licence; each play's page shows the same credit. Artwork for shows on stage now comes from Ticketmaster and appears only beside their ticket links.</p>
      <p class="hint">${plural(rows.length, "picture")}.</p>
      <ul class="credits">${rows.map((w) => `<li><a href="${playUrl(w.id)}">${esc(w.title)}</a>: ${creditHTML(w.image[2], w.image[3], w.image[4])}</li>`).join("")}</ul></div>`;
  }
  // #/copyright: how to report material on Billd that infringes your rights
  function renderCopyright() {
    document.title = "Copyright · Billd";
    pageEl().innerHTML = `<div class="wrap prose" style="padding-top:30px"><h1 class="h1">Copyright</h1>
      <p>Billd respects the rights of writers, photographers, designers and producers. Pictures on Billd are free-licensed images from Wikimedia Commons, credited on each play and on the <a href="#/credits">image credits</a> page, or artwork supplied by Ticketmaster for shows on sale. Facts about plays come from open data, listed on <a href="#/about">About the data</a>. Members' reviews, comments and lists are their own.</p>
      <h2>Reporting a problem</h2>
      <p>If something on Billd uses your work without permission, tell us and we'll look at it promptly and take it down where it infringes. Please include:</p>
      <ul><li>the page on Billd (its address) and what on it is yours;</li>
        <li>the original work, or where it can be seen;</li>
        <li>your name and how to reach you, and that you own the rights or act for the owner.</li></ul>
      <p>${CFG.contact?.copyright ? `Write to <a href="mailto:${esc(CFG.contact.copyright)}">${esc(CFG.contact.copyright)}</a>, or` : ""} <button class="linkbtn" type="button" id="cr-fb">send a copyright report</button>. Members can also use <b>Report</b> on any review, comment, list or profile and choose “Copyright infringement”.</p>
      ${CFG.contact?.agent ? `<h2>Designated agent</h2><p>Formal notices under the US Digital Millennium Copyright Act go to Billd's designated agent:<br>${["name", "address", "phone", "email"].map((k) => CFG.contact.agent[k]).filter(Boolean).map(esc).join("<br>")}</p>` : ""}
      <h2>What a formal notice needs</h2>
      <p>Under 17 U.S.C. § 512(c)(3), a notice must include: your physical or electronic signature; the copyrighted work you say is infringed; the material on Billd and where it is (its address), precisely enough for us to find it; your address, phone number and email; a statement that you believe in good faith that the use isn't authorised by the owner, its agent or the law; and a statement, under penalty of perjury, that the notice is accurate and that you own the right or may act for the owner.</p>
      <h2>If your post was removed</h2>
      <p>If you believe something you posted was removed by mistake, you can send a counter-notice through the same route; we'll restore it unless the person who complained tells us they've started court proceedings.</p>
      <h2>Repeat infringers</h2>
      <p>Billd closes the accounts of members who repeatedly post material that infringes others' copyright.</p></div>`;
    $("#cr-fb").addEventListener("click", () => openFeedback({ id: "copyright", title: "Copyright report" }));
  }
  // #/terms, #/privacy, #/guidelines: the texts in web/legal/*.md, shown as plain text. Only headings (#),
  // bullets (-), **bold** and links to Billd's own pages or to https addresses are recognised; everything
  // else is escaped, so the files can't add HTML to the page.
  const LEGAL = { terms: "Terms of Use", privacy: "Privacy Policy", guidelines: "Community Guidelines" };
  function inlineMD(t) {
    let out = "", last = 0;
    for (const m of t.matchAll(/\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g)) {
      out += esc(t.slice(last, m.index));
      if (m[1] != null) out += `<b>${esc(m[1])}</b>`;
      else {
        const href = /^#\/[\w/-]*$/.test(m[3]) ? m[3] : safeUrl(m[3]);
        out += href ? `<a href="${esc(href)}"${href.startsWith("#") ? "" : ' target="_blank" rel="noopener"'}>${esc(m[2])}</a>` : esc(m[2]);
      }
      last = m.index + m[0].length;
    }
    return out + esc(t.slice(last));
  }
  function legalHTML(md) {
    const out = []; let para = [], list = null;
    const flush = () => {
      if (para.length) { out.push(`<p>${inlineMD(para.join(" "))}</p>`); para = []; }
      if (list) { out.push(`<ul>${list.map((x) => `<li>${inlineMD(x)}</li>`).join("")}</ul>`); list = null; }
    };
    for (const raw of String(md).replace(/\r/g, "").split("\n")) {
      const line = raw.trim();
      const h = /^(#{1,3})\s+(.*)$/.exec(line), li = /^[-*]\s+(.*)$/.exec(line);
      if (!line) flush();
      else if (h) { flush(); const n = h[1].length; out.push(n === 1 ? `<h1 class="h1">${inlineMD(h[2])}</h1>` : `<h${n}>${inlineMD(h[2])}</h${n}>`); }
      else if (li) { if (para.length) flush(); (list = list || []).push(li[1]); }
      else if (list && /^\s{2,}/.test(raw)) list[list.length - 1] += " " + line;  // a bullet continued on the next line
      else { if (list) flush(); para.push(line.replace(/^>\s?/, "")); }
    }
    flush();
    return out.join("\n");
  }
  async function renderLegal(name) {
    const tok = routeSeq;
    document.title = `${LEGAL[name]} · Billd`;
    pageEl().innerHTML = `<div class="wrap legal" style="padding-top:30px"><p class="hint">Loading…</p></div>`;
    let text = "";
    try { const r = await fetch(`legal/${name}.md`, { cache: "no-cache" }); if (!r.ok) throw new Error(r.status); text = await r.text(); }
    catch (e) { if (!stale(tok)) pageEl().innerHTML = `<div class="wrap legal" style="padding-top:30px"><h1 class="h1">${LEGAL[name]}</h1><p class="empty">This page couldn't be loaded. Check your connection and try again.</p></div>`; return; }
    if (stale(tok)) return;
    const draft = name === "terms" && !termsState().live;  // the Privacy Policy is in force (7 Oct 2026); the Terms wait for the lawyer
    pageEl().innerHTML = `<div class="wrap legal" style="padding-top:30px">${draft ? `<p class="banner draft"><b>Draft.</b> These aren't in force yet: Billd's ${name === "terms" ? "Terms of Use are" : "Privacy Policy is"} being finalised.</p>` : ""}
      ${legalHTML(text)}
      <p class="foot-links" style="margin-top:30px">${Object.entries(LEGAL).filter(([k]) => k !== name).map(([k, n]) => `<a href="#/${k}">${n}</a>`).join(" · ")}${name === "privacy" ? ` · <a href="#/delete-account">Deleting your account</a>` : ""}</p></div>`;
  }

  // a poster with the viewer's own marks under it (seen, rating, like)
  function cell(w, extra = "") {
    const s = myStatus[w.id];
    const mine = s ? `${s.seen ? `<span class="seen-i" title="Seen">●</span>` : ""}${s.rating ? `<span class="stars" aria-label="${starsLabel(s.rating)}">${stars(s.rating)}</span>` : ""}${s.liked ? `<span class="heart" title="Liked">♥</span>` : ""}${s.want && !s.seen ? `<span title="Want to see">◷</span>` : ""}` : "";
    return `<div class="cell">${poster(w)}${extra || `<div class="cell-meta">${mine}</div>`}</div>`;
  }

  // ---------------------------------------------------------------- routing
  const pageEl = () => $("#page");
  let lastRoute = null;
  const navStack = [], scrollAt = {};
  // "‹ Back" to the page the visitor came from in Billd, named; a page opened directly goes to fallback
  function backLink(fallback = "#/onstage", fallbackName = "On stage now") {
    const prev = navStack.length > 1 ? navStack[navStack.length - 2] : null;
    const name = prev == null ? fallbackName : routeName(prev);
    return `<a class="back" href="${prev == null ? fallback : "#" + esc(prev)}" data-back="${prev == null ? "" : "1"}">‹ ${esc(name)}</a>`;
  }
  function routeName(h) {
    const [a, b] = h.replace(/^\//, "").split("/").map((x) => { try { return decodeURIComponent(x); } catch (e) { return x; } });
    if (!a) return "Home";
    if (a === "onstage") return b && places[b] ? `On stage in ${places[b].name}` : "On stage now";
    if (a === "browse") return "Shows";
    if (a === "play") return byId[b]?.title || "Back";
    if (a === "u") return `@${b}`;
    return { activity: "Activity", lists: "Lists", members: "Members", me: "My diary", list: "List", review: "Review", settings: "Settings",
             terms: "Terms of Use", privacy: "Privacy Policy", guidelines: "Community Guidelines", "delete-account": "Deleting your account" }[a] || "Back";
  }
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-back='1']");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    history.back();
  });
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
    if (/(^|[&#])(access_token|error_description|error_code)=/.test(h)) {
      const q = new URLSearchParams(h.slice(h.search(/(access_token|error)/)));
      const err = q.get("error_description");
      if (err) toast("That link didn't work (it may have expired). Try logging in, or ask for a new link.");
      const recovery = q.get("type") === "recovery";
      if (recovery) setTimeout(() => toast("Choose a new password below"), 400);
      h = recovery ? "/settings" : "";
      history.replaceState(null, "", location.pathname + location.search + (h ? "#" + h : ""));
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
    // where the visitor came from, so a page can offer "‹ Back" to it, and the scroll position to
    // return to: going back to the previous page restores both, its filters included
    let restore = null;
    if (!sameView) {
      scrollAt[lastRoute] = window.scrollY;
      if (navStack.length > 1 && navStack[navStack.length - 2] === key) { navStack.pop(); restore = scrollAt[key]; }
      else navStack.push(key);
    }
    lastRoute = key;
    const settle = () => { if (restore != null && !stale(tok)) requestAnimationFrame(() => window.scrollTo(0, restore)); };
    if (isBrowse) { applyBrowse(); document.title = "Shows · Billd"; if (restore != null) settle(); else if (!sameView) window.scrollTo(0, 0); return; }
    if (!sameView) window.scrollTo(0, 0);
    const go = {
      "": renderHome, onstage: () => renderOnStage(b), play: () => renderPlay(b), u: () => renderProfile(b, c), me: renderMe,
      lists: renderLists, list: () => renderList(b), review: () => renderReview(b), members: renderMembers,
      activity: () => renderActivity(b), settings: renderSettings, about: renderAbout, admin: () => renderAdmin(b),
      credits: renderCredits, copyright: renderCopyright, "delete-account": () => renderDeleteAccount(b),
      terms: () => renderLegal("terms"), privacy: () => renderLegal("privacy"), guidelines: () => renderLegal("guidelines"),
    }[a || ""] || renderNotFound;
    Promise.resolve(go()).then(settle).catch((e) => { console.error(e); if (stale(tok)) return; pageEl().innerHTML = `<div class="wrap"><p class="empty">${e?.code === "no_copy" ? esc(e.message) : `Something went wrong: ${esc(e.message)}`}</p></div>`; });
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
      const name = me.display_name || cap(me.username) || "?";
      el.innerHTML = `${myRank() ? `<a class="btn ghost sm acct-admin" href="#/admin">Admin</a>` : ""}<button class="btn sm" type="button" data-log>+ Log</button>`
        + `<span class="acct-menu"><button class="avatar" type="button" id="acct-btn" style="--hue:${hash(me.username || "") % 360}" aria-haspopup="menu" aria-expanded="false" aria-controls="acct-pop" aria-label="${esc(name)}: your account">${esc(name.trim()[0] || "?")}</button>`
        + `<div class="acct-pop" id="acct-pop" role="menu" hidden><div class="who">@${esc(me.username)}</div><a role="menuitem" href="#/u/${esc(me.username)}">Your profile and diary</a><a role="menuitem" href="#/settings">Settings</a><button role="menuitem" type="button" data-logout>Log out</button></div></span>`;
    } else if (S.kind === "local") {
      el.innerHTML = `<button class="btn sm" type="button" data-log>+ Log</button>${avatar(S.me())}`;
    } else {
      el.innerHTML = `<button class="btn ghost sm" type="button" data-auth-open="in">Log in</button><button class="btn sm" type="button" data-auth-open="up">Join</button>`;
    }
  }
  // the menu under your picture: profile, Settings, Log out
  const acctMenu = (open) => {
    const pop = $("#acct-pop"), btn = $("#acct-btn"); if (!pop || !btn) return;
    pop.hidden = !open; btn.setAttribute("aria-expanded", String(open));
    if (open) pop.querySelector("[role=menuitem]")?.focus();
  };
  document.addEventListener("click", (e) => { if (!e.target.closest(".acct-menu")) acctMenu(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#acct-pop") && !$("#acct-pop").hidden) { acctMenu(false); $("#acct-btn")?.focus(); } });
  window.addEventListener("hashchange", () => acctMenu(false));
  $("#acct").addEventListener("click", (e) => {
    if (e.target.closest("#acct-btn")) return acctMenu($("#acct-pop").hidden);
    if (e.target.closest("#acct-pop [role=menuitem]")) acctMenu(false);
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
  // The landing stage: house curtains part, a spotlight finds the floor, the words sit in its light
  function stageHTML(copy) {
    return `<div class="stage">
          <div class="st-back" aria-hidden="true"></div><div class="st-beam" aria-hidden="true"></div>
          <div class="st-floor" aria-hidden="true"></div><div class="st-pool" aria-hidden="true"></div>
          <div class="st-copy">${copy}</div>
          <div class="st-seats" aria-hidden="true"></div>
          <div class="st-drape l" aria-hidden="true"></div><div class="st-drape r" aria-hidden="true"></div><div class="st-valance" aria-hidden="true"></div>
        </div>`;
  }
  async function renderHome() {
    const tok = routeSeq;
    document.title = "Billd: a diary for theatregoers";
    const now = onNow();
    const intro = !me || S.kind === "local" ? `
      <section class="hero${APP ? " hero-app" : ""}">
        ${stageHTML(`<h1>Your <em>show biz.</em></h1>
            <p>Every play you've watched, from your first school trip to last night's preview, kept in one place, with the plays of every culture and era to browse between curtains.</p>
            <div class="acts">${S.kind === "local" ? `<button class="btn" type="button" data-log>Log a show</button>` : `<button class="btn" type="button" data-auth-open="up">Join Billd</button>`}
              ${APP && S.kind !== "local" ? `<button class="btn ghost" type="button" data-auth-open="in">Log in</button>` : `<a class="btn ghost" href="#/onstage">What's on now</a>`}</div>`)}
        <div class="lets" aria-label="What you can do on Billd">
          <div class="let">${ICONS.ticket}<p>Find out what's playing tonight in your city, with links to buy seats</p></div>
          <div class="let">${ICONS.cal}<p>Note the date, the theatre and the company for each performance, so your theatregoing history is never lost</p></div>
          <div class="let">${ICONS.lines}<p>Say what you thought, from one line to a full notice, and read what the people you follow made of it</p></div>
          <div class="let">${ICONS.grid}<p>Look up any play, from Sophocles to this season, and see where and when it's been staged</p></div>
        </div>
        ${S.kind === "local" ? `<p class="banner"><b>Preview mode.</b> Your diary is saved on this device. Member accounts, following and shared reviews switch on when Billd's server is connected.</p>` : ""}
      </section>` : `<section class="hero hero-member">${stageHTML(`<h1>Welcome back, <em>${who(me)}.</em></h1>
            <div class="acts"><button class="btn" type="button" data-log>Log a show</button><a class="btn ghost" href="#/onstage">What's on now</a>
              <a class="btn ghost" href="#/u/${esc(me.username)}/diary">Your diary</a></div>`)}</section>`;
    const ahead = signedIn() ? comingUp() : [];
    const sec = {
      plans: ahead.length ? `<section class="sec" id="home-plans"><div class="sec-head"><h2>Coming up</h2></div><ul class="stubs">${ahead.map(planStubHTML).join("")}</ul></section>` : "",
      // the app opens on the member's own diary (App Store guideline 4.2: a diary, not a page of ticket links)
      diary: APP && signedIn() ? `<section class="sec" id="home-diary"><div class="sec-head"><h2>Recently in your diary</h2><a href="#/u/${esc((me || S.me()).username)}/diary">Diary →</a></div><div class="scraps" id="home-diary-row"><p class="hint">Loading…</p></div></section>` : "",
      onstage: `<section class="sec"><div class="sec-head"><h2>On stage now</h2><a href="#/onstage">All ${now.length.toLocaleString()} →</a></div>
        <div class="row-scroll">${now.slice(0, 18).map((w) => cell(w, `<div class="cell-cap">${esc(nowWhere(w))}</div>`)).join("") || `<p class="empty">No current listings.</p>`}</div></section>`,
      pop: `<section class="sec" id="home-pop" hidden><div class="sec-head"><h2>Popular on Billd this week</h2></div><div class="row-scroll" id="home-pop-row"></div></section>`,
      friends: `<section class="sec" id="home-friends" hidden><div class="sec-head"><h2>New from friends</h2><a href="#/activity">More →</a></div><div class="row-scroll" id="home-friends-row"></div></section>`,
      rev: `<section class="sec" id="home-rev" hidden><div class="sec-head"><h2>Recent reviews</h2><a href="#/activity/everyone">More →</a></div><ul class="reviews" id="home-rev-list"></ul></section>`,
      explore: `<section class="sec"><div class="sec-head"><h2>Explore the archive</h2><a href="#/browse">Browse ${works.length.toLocaleString()} plays →</a></div>
        <p class="lead">Plays from every culture and era, from Sophocles to this season, with where and when they were staged.</p>
        <div class="row-scroll" style="margin-top:16px">${classics().map((w) => cell(w)).join("")}</div></section>`,
    };
    const order = APP ? ["plans", "diary", "friends", "rev", "onstage", "pop", "explore"] : ["plans", "onstage", "pop", "friends", "rev", "explore"];
    pageEl().innerHTML = `<div class="wrap">${intro}${order.map((k) => sec[k]).join("")}</div>`;
    // members' activity fills in as it arrives
    if (sec.diary) {
      const who0 = me || S.me();
      S.logsForUser(who0.id).then((logs) => {
        if (stale(tok) || !$("#home-diary-row")) return;
        const recent = logs.filter((l) => byId[l.play_id]).slice(0, 6);
        $("#home-diary-row").innerHTML = recent.length ? recent.map((l) => scrapHTML(l, true)).join("")
          : `<p class="empty">Nothing logged yet. <button class="linkbtn" type="button" data-log>Log the last show you saw.</button></p>`;
      }).catch(() => { if ($("#home-diary-row")) $("#home-diary-row").innerHTML = `<p class="empty">Your diary couldn't be loaded. Check your connection.</p>`; });
    }
    try {
      const pop = Object.keys(popular).map((id) => byId[id]).filter(Boolean).slice(0, 18);
      if (pop.length >= 4) { $("#home-pop-row").innerHTML = pop.map((w) => cell(w)).join(""); $("#home-pop").hidden = false; }
      if (me && S.kind !== "local") {
        const [lg, mk] = await Promise.all([S.feed(30), S.recentMarks(30, { friends: true }).catch(() => [])]);
        const feed = notBlocked(withMarks(lg.filter((l) => byId[l.play_id]), mk.filter((m) => m.seen)).filter((l) => l.user_id !== me.id));
        if (stale(tok)) return;
        if (feed.length) {
          $("#home-friends-row").innerHTML = feed.slice(0, 18).map((l) => cell(byId[l.play_id], `<div class="cell-meta">${avatar(l.profile, "sm")}${l.rating ? `<span class="stars">${stars(l.rating)}</span>` : ""}${l.liked ? `<span class="heart">♥</span>` : ""}</div>`)).join("");
          $("#home-friends").hidden = false;
        }
      }
      const revs = notBlocked((await S.recentReviews(6)).filter((l) => byId[l.play_id]));
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
      <label class="city-pick"><span>City</span>
        <select id="city-pick" aria-label="City">
          <option value="" ${sel ? "" : "selected"}>Everywhere (${now.length})</option>
          <optgroup label="Most shows">${cities.slice(0, 8).map((p) => `<option value="${esc(p)}" ${p === sel ? "selected" : ""}>${esc(places[p]?.name || p)} (${counts[p]})</option>`).join("")}</optgroup>
          <optgroup label="All cities, A–Z">${cities.slice().sort((x, y) => (places[x]?.name || x).localeCompare(places[y]?.name || y)).map((p) => `<option value="${esc(p)}">${esc(places[p]?.name || p)} (${counts[p]})</option>`).join("")}</optgroup>
        </select></label>
      <section class="sec"><div class="sec-head"><h2>Playing now</h2></div><div class="grid">${playing.map((w) => cell(w, `<div class="cell-cap">${esc(nowWhere(w))}</div>`)).join("") || `<p class="empty">Nothing listed.</p>`}</div></section>
      ${soon.length ? `<section class="sec"><div class="sec-head"><h2>Coming soon</h2></div><div class="grid">${soon.map((w) => cell(w, `<div class="cell-cap">${esc(soonWhen(w))}</div>`)).join("")}</div></section>` : ""}
    </div>`;
  }
  document.addEventListener("change", (e) => {
    if (e.target.id !== "city-pick") return;
    location.hash = e.target.value ? `#/onstage/${encodeURIComponent(e.target.value)}` : "#/onstage";
  });
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
    const empty = `<p class="empty">No plays match. ${state.when === "now" && (state.sel.place.size || state.sel.district.size) ? `<button class="linkbtn" type="button" data-when="ever">Include past productions</button> or remove a filter.` : "Try removing a filter or shortening the search."}
      ${state.q.length ? `<br>Billd doesn't have it? <button class="linkbtn" type="button" data-suggest-play>Suggest a play</button>` : ""}</p>`;
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
      pageEl().innerHTML = `<div class="wrap">${backLink()}<article class="play">
        <div class="play-poster">${poster(w)}${imageCredit(w)}</div>
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
            <div class="suggested" id="play-suggest"></div>
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
    const src = w.notes_source === "wikipedia" ? `From the English Wikipedia article${ids.enwiki ? ` <a href="https://en.wikipedia.org/wiki/${encodeURIComponent(ids.enwiki.replace(/ /g, "_"))}" target="_blank" rel="noopener">${esc((w.search_titles || []).length ? w.title : ids.enwiki)}</a>` : ""}, lightly edited; <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener license">CC BY-SA 4.0</a>.`
      : w.notes_source === "wikidata" ? "Description from Wikidata." : w.notes_source === "generated" ? "Summary written from the records below." : "";
    // Wikipedia leads lose their pronunciation guides in extraction, leaving "Hamlet (), is"
    const text = w.notes.replace(/\s*\(\s*[;,]?\s*\)/g, "").replace(/\(\s*[;,]\s*/g, "(");
    return `<p class="synopsis">${esc(text)}</p>${src ? `<p class="src">${src}</p>` : ""}`;
  }
  const SELLER = { todaytix: "TodayTix", broadway_direct: "Broadway Direct" };
  // A ticket link with the affiliate tracking set at publish (CFG.affiliates: seller -> template with {url})
  function aff(url, seller) {
    let host = ""; try { host = new URL(url).hostname; } catch (e) { /* not a link */ }
    seller = seller || (/(^|\.)ticketmaster\.[a-z.]+$/.test(host) ? "ticketmaster" : /(^|\.)todaytix\.com$/.test(host) ? "todaytix" : /(^|\.)broadwaydirect\.com$/.test(host) ? "broadway_direct" : "");
    const t = (CFG.affiliates || {})[seller];
    return t ? t.replace("{url}", encodeURIComponent(url)) : url;
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
      const main = safeUrl(r.ticket_url) ? `<a class="btn sm" href="${esc(aff(safeUrl(r.ticket_url)))}" target="_blank" rel="noopener nofollow sponsored">Tickets${/ticketmaster\./.test(r.ticket_url) ? " · Ticketmaster" : ""}</a>`
        : (safeUrl(v?.website) ? `<a class="btn sm" href="${esc(safeUrl(v.website))}" target="_blank" rel="noopener nofollow">Tickets · box office</a>` : "");
      const more = (r.links || []).filter(([, url]) => safeUrl(url)).map(([seller, url]) => `<a class="btn ghost sm" href="${esc(aff(url, seller))}" target="_blank" rel="noopener nofollow sponsored">${SELLER[seller] || "Tickets"}</a>`).join("");
      const tickets = main || more ? `<div class="np-buy">${main}${more}</div>` : "";
      return `<li><div><div class="np-where"><strong>${where || "Venue to be announced"}</strong>${r.district ? ` <span class="badge dist">${esc(r.district)}</span>` : ""}</div>
        <div class="np-when">${esc(when + until)}</div></div>${tickets}${whoIsInIt(p, r)}<small class="np-src">Listing checked ${esc(fmtPartial(r.checked))}. Check with the seller for dates and prices.</small></li>`;
    });
    // the current production's artwork, from Ticketmaster: shown here, beside its tickets, and nowhere else
    const art = w.artwork && safeUrl(w.artwork[0]) ? `<figure class="np-art"><img src="${esc(safeUrl(w.artwork[0]))}" alt="Artwork for this production of ${esc(w.title)}" loading="lazy" referrerpolicy="no-referrer">
      <figcaption>Artwork via <a href="${esc(aff(safeUrl(w.artwork[1]) || "https://www.ticketmaster.com/"))}" target="_blank" rel="noopener nofollow sponsored">Ticketmaster</a></figcaption></figure>` : "";
    return `<section class="nowp" aria-label="On stage now"><h2>${rows.some((x) => x.st === "now") ? "On stage now" : "Coming soon"}</h2>${art}<ul>${items.join("")}</ul>
      ${Object.keys(CFG.affiliates || {}).length ? `<p class="src">Billd may earn a commission when you buy tickets through these links.</p>` : ""}
      ${safeUrl(w.ids?.website) ? `<p class="src"><a href="${esc(safeUrl(w.ids.website))}" target="_blank" rel="noopener nofollow">Official website</a></p>` : ""}</section>`;
  }
  // who is in this production: its director(s) and cast, parts where known; the rest of a long
  // cast folds away. Names search Billd for that person, like the playwrights' names.
  function whoIsInIt(p, r) {
    const current = (p.credits || []).some((c) => c.since && (c.role === "cast" || c.role === "director"));
    const since = current ? (p.credits.find((c) => c.since)?.since || "") : "";
    const cr = (role) => (p.credits || []).filter((c) => c.role === role && (current ? !!c.since || (role === "director" && !p.credits.some((x) => x.since && x.role === "director")) : !c.since))
      .map((c) => ({ name: c.person ? ppl[c.person]?.name : orgs[c.org]?.name, part: c.character })).filter((x) => x.name);
    // a run that opened over a year ago without a current cast list: its credits are the original company
    const original = !current && r?.from && r.from.slice(0, 10) < new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
    const castLabel = current ? `Cast <small>as of ${esc(fmtPartial(since.slice(0, 7)))}</small>` : original ? "Original cast" : "Cast";
    const one = (x) => `<button class="linkbtn" type="button" data-person="${esc(x.name)}">${esc(x.name)}</button>${x.part ? ` <span class="np-part">as ${esc(x.part)}</span>` : ""}`;
    const dirs = cr("director"), cast = cr("cast"), SHOW = 6;
    if (!dirs.length && !cast.length) return "";
    return `<div class="np-cast">${dirs.length ? `<div><span class="np-l">Directed by</span> ${dirs.map(one).join(", ")}</div>` : ""}${cast.length ? `<div><span class="np-l">${castLabel}</span> ${cast.slice(0, SHOW).map(one).join(", ")}${cast.length > SHOW
      ? `<details class="np-more"><summary>and ${cast.length - SHOW} more</summary>, ${cast.slice(SHOW).map(one).join(", ")}</details>` : ""}</div>` : ""}</div>`;
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
    if (safeUrl(ids.website)) links.push(`<a href="${esc(safeUrl(ids.website))}" target="_blank" rel="noopener nofollow">Official website</a>`);
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
  // Production history: filters (when, city, a search over theatres and people) and a sort,
  // for plays staged dozens of times; the list shows 10 at a time.
  const pv = { play: null, sort: "newest", city: "", period: "", q: "", shown: 10 };
  const prodYear = (p) => Math.max(...p.runs.map((r) => (r.from ? parseInt(r.from, 10) : -99999)));
  const prodNow = (p) => p.runs.some((r) => listingStatus(r.checked, r.from, r.to));
  function periodOf(p) {
    if (prodNow(p)) return "now";
    const y = prodYear(p);
    if (y < -9999) return "undated";
    if (y >= 1950) return `${Math.floor(y / 10) * 10}s`;
    if (y >= 1800) return `${Math.floor(y / 50) * 50}–${Math.floor(y / 50) * 50 + 49}`;
    return y < 0 ? "Antiquity" : `${Math.floor(y / 100) + 1}th century`.replace(/^(\d*1)th/, "$1st").replace(/^(\d*2)th/, "$1nd").replace(/^(\d*3)th/, "$1rd").replace(/^1([123])(st|nd|rd)/, "1$1th");
  }
  function periodRank(k) {
    if (k === "now") return 1e9;
    if (k === "undated") return -1e9;
    if (k === "Antiquity") return -1e6;
    const n = parseInt(k, 10);
    return /century/.test(k) ? (n - 1) * 100 : n;
  }
  const prodCity = (p) => places[p.runs.find((r) => r.place)?.place]?.name || "";
  const prodHay = (p) => fold([p.title, p.notes, ...p.runs.map((r) => `${venues[r.venue]?.name || ""} ${places[r.place]?.name || ""} ${r.district || ""}`),
    ...p.credits.map((c) => (c.person ? ppl[c.person]?.name : orgs[c.org]?.name) || "")].join(" "));
  function productionsHTML(w) {
    if (pv.play !== w.id) Object.assign(pv, { play: w.id, sort: "newest", city: "", period: "", q: "", shown: 10 });
    const n = w.productions.length;
    const addBtn = `<button class="btn ghost sm" type="button" data-addprod>+ Add a production</button>`;
    if (!n) return `<div class="sec-head"><h2>Production history</h2>${addBtn}</div><p class="empty">No productions recorded yet. Seen one? Add it with its web page.</p>`;
    const nPlaces = new Set(w.productions.flatMap((p) => p.runs.map((r) => r.place).filter(Boolean))).size;
    // the filter choices, with counts
    const cities = {}, periods = {};
    w.productions.forEach((p) => { const c = prodCity(p); if (c) cities[c] = (cities[c] || 0) + 1; const k = periodOf(p); periods[k] = (periods[k] || 0) + 1; });
    const cityKeys = Object.keys(cities).sort((a, b) => cities[b] - cities[a] || a.localeCompare(b));
    const periodKeys = Object.keys(periods).sort((a, b) => periodRank(b) - periodRank(a));
    const periodName = (k) => ({ now: "On now", undated: "Undated" }[k] || k);
    const controls = n < 4 ? "" : `
      <div class="prod-tools">
        <label class="vh" for="pv-q">Search productions</label>
        <input id="pv-q" type="search" placeholder="Search theatres, directors, cast…" value="${esc(pv.q)}" autocomplete="off">
        <label class="sort">Sort
          <select id="pv-sort">${[["newest", "Newest first"], ["oldest", "Oldest first"], ["city", "City"], ["cast", "Most cast listed"]].map(([k, l]) => `<option value="${k}"${pv.sort === k ? " selected" : ""}>${l}</option>`).join("")}</select>
        </label>
      </div>
      ${periodKeys.length > 1 ? `<div class="chips prod-chips" role="group" aria-label="When">${periodKeys.map((k) => `<button class="chip" type="button" data-pv-period="${esc(k)}" aria-pressed="${pv.period === k}">${esc(periodName(k))} <small>${periods[k]}</small></button>`).join("")}</div>` : ""}
      ${cityKeys.length > 1 ? `<div class="chips prod-chips" role="group" aria-label="City">${cityKeys.slice(0, 8).map((c) => `<button class="chip" type="button" data-pv-city="${esc(c)}" aria-pressed="${pv.city === c}">${esc(c)} <small>${cities[c]}</small></button>`).join("")}
        ${cityKeys.length > 8 ? `<label class="vh" for="pv-city">More cities</label><select id="pv-city"><option value="">More cities…</option>${cityKeys.slice(8).map((c) => `<option value="${esc(c)}"${pv.city === c ? " selected" : ""}>${esc(c)} (${cities[c]})</option>`).join("")}</select>` : ""}</div>` : ""}`;
    return `<div class="sec-head"><h2>Production history</h2>${addBtn}</div>
      <p class="count" style="margin:-6px 0 10px">${plural(n, "production")}${nPlaces ? ` in ${plural(nPlaces, "city", "cities")}` : ""}</p>
      ${stagingStrip(w)}${controls}
      <div id="prod-list">${prodListHTML(w)}</div>`;
  }
  function prodListHTML(w) {
    const q = fold(pv.q).split(/\s+/).filter(Boolean);
    let list = w.productions.filter((p) => (!pv.city || prodCity(p) === pv.city) && (!pv.period || periodOf(p) === pv.period) && (!q.length || q.every((t) => prodHay(p).includes(t))));
    const cmp = {
      newest: (a, b) => (prodNow(b) - prodNow(a)) || prodYear(b) - prodYear(a),
      oldest: (a, b) => { const ya = prodYear(a), yb = prodYear(b); return (ya < -9999) - (yb < -9999) || ya - yb; },
      city: (a, b) => prodCity(a).localeCompare(prodCity(b)) || prodYear(b) - prodYear(a),
      cast: (a, b) => b.credits.filter((c) => c.role === "cast").length - a.credits.filter((c) => c.role === "cast").length || prodYear(b) - prodYear(a),
    }[pv.sort];
    list = list.sort(cmp);
    const filtered = pv.city || pv.period || q.length;
    if (!list.length) return `<p class="empty">No productions match. <button class="linkbtn" type="button" data-pv-clear>Clear the filters</button></p>`;
    const shown = list.slice(0, pv.shown);
    return `${filtered ? `<p class="count">${plural(list.length, "production")} match · <button class="linkbtn" type="button" data-pv-clear>Clear</button></p>` : ""}
      <ol class="prods">${shown.map((p) => prodItemHTML(w, p)).join("")}</ol>
      ${list.length > shown.length ? `<button class="btn ghost sm more" type="button" data-pv-more>Show ${Math.min(list.length - shown.length, 20)} more (${list.length - shown.length} left)</button>` : ""}`;
  }
  function prodItemHTML(w, p) {
    const kindLabel = { premiere: "World premiere", revival: "Revival", tour: "Tour", transfer: "Transfer" };
    const srcName = { wikipedia: "Wikipedia", idu: "IDU open data (CC BY 4.0)", web: "Source page", ticketmaster: "Ticketmaster", kunstenpunt: "Kunstenpunt", theaterencyclopedie: "TheaterEncyclopedie (CC0)", member: "Suggested by a member, checked against this page" };
    const by = (role) => p.credits.filter((c) => c.role === role && !c.since);
    const name = (c) => esc(c.person ? (ppl[c.person]?.name || c.person) : (orgs[c.org]?.name || c.org));
    const line = (label, list) => list.length ? `<div class="pc"><span class="pc-l">${label}</span> ${list.map(name).join(", ")}</div>` : "";
    const cast = by("cast"), curCast = p.credits.filter((c) => c.role === "cast" && c.since);
    const shownCast = cast.slice(0, 8).map((c) => name(c) + (c.character ? ` <small>as ${esc(c.character)}</small>` : ""));
    const others = ["designer", "composer", "choreographer", "translator", "adapter"].flatMap((r) => by(r).map((c) => `${name(c)} <small>(${r})</small>`));
    const pl = p.language && p.language !== w.languages[0] ? (lang[p.language]?.name || p.language) : "";
    return `<li class="prod">
      <div class="prod-head">${prodNow(p) ? `<span class="badge now">On now</span>` : ""}${kindLabel[p.kind] ? `<span class="badge">${kindLabel[p.kind]}</span>` : ""}${p.title ? `<em>${esc(p.title)}</em>` : ""}${pl ? ` <small>in ${esc(pl)}</small>` : ""}</div>
      <ul class="runs">${p.runs.map((r) => {
        const date = r.from ? fmtPartial(r.from) + (r.to && r.to !== r.from ? ` – ${fmtPartial(r.to)}` : "") : "date unknown";
        const where = [venues[r.venue]?.name, places[r.place]?.name].filter(Boolean).map(esc).join(", ");
        return `<li class="run"><span class="run-date">${r.certain === false ? "c. " : ""}${esc(date)}</span><span>${where}${r.district ? ` <span class="badge dist">${esc(r.district)}</span>` : ""}</span></li>`;
      }).join("")}</ul>
      ${line("Company", by("company"))}${line("Producer", by("producer"))}${line("Director", by("director"))}
      ${cast.length ? `<div class="pc"><span class="pc-l">${curCast.length ? "Original cast" : "Cast"}</span> ${shownCast.join(", ")}${cast.length > 8
        ? `<details class="np-more"><summary>and ${cast.length - 8} more</summary>, ${cast.slice(8).map((c) => name(c) + (c.character ? ` <small>as ${esc(c.character)}</small>` : "")).join(", ")}</details>` : ""}</div>` : ""}
      ${curCast.length ? `<div class="pc"><span class="pc-l">Cast as of ${esc(fmtPartial(curCast[0].since.slice(0, 7)))}</span> ${curCast.slice(0, 8).map((c) => name(c) + (c.character ? ` <small>as ${esc(c.character)}</small>` : "")).join(", ")}${curCast.length > 8 ? `, and ${curCast.length - 8} more` : ""}</div>` : ""}
      ${others.length ? `<div class="pc"><span class="pc-l">Also</span> ${others.join(", ")}</div>` : ""}
      ${p.notes ? `<p class="prod-notes">${esc(p.notes)}</p>` : ""}
      <div class="prod-src">${safeUrl(p.citation) ? `<a href="${esc(safeUrl(p.citation))}" target="_blank" rel="noopener">${srcName[p.source] || "Source"}</a>` : esc(srcName[p.source] || p.source)}${p.ids?.wikidata ? ` · <a href="https://www.wikidata.org/wiki/${esc(p.ids.wikidata)}" target="_blank" rel="noopener">Wikidata</a>` : ""}</div>
    </li>`;
  }
  function refreshProds(w, keepFocus) {
    const f = keepFocus && document.activeElement?.id;
    const box = $("#play-prods"); if (!box) return;
    box.innerHTML = productionsHTML(w);
    if (f) { const el = $("#" + f); if (el) { el.focus(); if (el.setSelectionRange && el.value) el.setSelectionRange(el.value.length, el.value.length); } }
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
    const plan = signedIn() ? planOf(w.id) : null;
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
        <button type="button" class="act-line${plan ? " planned" : ""}" data-plan="${esc(w.id)}">${plan ? `Going ${esc(planWhen(plan))} · change` : "Plan a date to see it…"}</button>
        <button type="button" class="act-line" data-addprod>Add a production…</button>
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
      const logs = notBlocked((await S.logsForPlay(w.id)).filter((l) => l.review || l.rating));
      if (stale(tok)) return;
      const el = $("#play-rev-list"); if (!el) return;
      const withText = logs.filter((l) => l.review);
      el.innerHTML = withText.length ? withText.map((l) => reviewHTML(l, { poster: false })).join("")
        : `<li class="empty">No reviews yet. ${signedIn() ? `<button class="linkbtn" type="button" data-log-play>Be the first to write one.</button>` : ""}</li>`;
      const mine = await S.mySuggestions(w.id).catch(() => []);
      if (stale(tok)) return;
      if (mine.length && $("#play-suggest")) $("#play-suggest").innerHTML = suggestionsHTML(mine, "Productions you suggested for this play");
      const lists = notBlocked(await S.listsWithPlay(w.id));
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
  // production history: search and sort
  let pvT;
  pageEl().addEventListener("input", (e) => {
    if (e.target.id !== "pv-q") return;
    const w = location.hash.startsWith("#/play/") ? byId[decodeURIComponent(location.hash.slice(7))] : null; if (!w) return;
    clearTimeout(pvT); pvT = setTimeout(() => { pv.q = e.target.value; pv.shown = 10; $("#prod-list").innerHTML = prodListHTML(w); }, 150);
  });
  pageEl().addEventListener("change", (e) => {
    const w = location.hash.startsWith("#/play/") ? byId[decodeURIComponent(location.hash.slice(7))] : null; if (!w) return;
    if (e.target.id === "pv-sort") { pv.sort = e.target.value; pv.shown = 10; $("#prod-list").innerHTML = prodListHTML(w); }
    if (e.target.id === "pv-city") { pv.city = e.target.value; pv.shown = 10; refreshProds(w, true); }
  });
  pageEl().addEventListener("click", async (e) => {
    const t = e.target;
    const w = location.hash.startsWith("#/play/") ? byId[decodeURIComponent(location.hash.slice(7))] : null;
    const act = t.closest("[data-act]");
    if (act && w) { const k = act.dataset.act; return setStatus(w, { [k]: act.getAttribute("aria-pressed") !== "true" }); }
    if (t.closest("[data-log-play]") && w) return openLog(w.id);
    if (t.closest("[data-addprod]") && w) return openAddProduction(w.id);
    const pc = t.closest("[data-pv-city]"); if (pc && w) { pv.city = pv.city === pc.dataset.pvCity ? "" : pc.dataset.pvCity; pv.shown = 10; return refreshProds(w); }
    const pp = t.closest("[data-pv-period]"); if (pp && w) { pv.period = pv.period === pp.dataset.pvPeriod ? "" : pp.dataset.pvPeriod; pv.shown = 10; return refreshProds(w); }
    if (t.closest("[data-pv-more]") && w) { pv.shown += 20; $("#prod-list").innerHTML = prodListHTML(w); return; }
    if (t.closest("[data-pv-clear]") && w) { Object.assign(pv, { city: "", period: "", q: "", shown: 10 }); return refreshProds(w); }
    if (t.closest("[data-addlist]") && w) return openListPicker(w.id);
    if (t.closest("[data-share]") && w) return share(`${w.title} on Billd`, playUrl(w.id));
    const sr = t.closest("[data-share-review]"); if (sr) return share(sr.dataset.title, `#/review/${sr.dataset.shareReview}`);
    const pl = t.closest("[data-plan]"); if (pl) return openPlan(pl.dataset.plan);
    const pi = t.closest("[data-plan-ics]"); if (pi) { const p = planOf(pi.dataset.planIcs); return p && calendarFile(p); }
    const pg = t.closest("[data-plan-log]"); if (pg) { const p = planOf(pg.dataset.planLog); return p && openLog(p.play_id, null, { seen_on: p.date, venue: p.venue, city: p.city, fromPlan: true }); }
    const pr = t.closest("[data-plan-rm]"); if (pr) { await removePlan(pr.dataset.planRm); toast("Plan removed"); return route(); }
    if (t.closest("[data-fix]") && w) return openFeedback({ id: w.id, title: w.title });
    const tr = t.closest("[data-trad]"); if (tr) return filterTradition(tr.dataset.trad);
    const pe = t.closest("[data-person]");
    if (pe) { $("#q").value = pe.dataset.person; state.q = fold(pe.dataset.person).split(/\s+/); for (const k in state.sel) state.sel[k].clear(); state.when = "ever"; totals(); location.hash = "#/browse"; return; }
    const lk = t.closest("[data-like-log]"); if (lk) return likeLog(lk);
    const sp = t.closest("[data-reveal]"); if (sp) { const b = sp.closest(".review").querySelector(".review-body"); b.hidden = false; sp.remove(); return; }
    const ed = t.closest("[data-edit-log]"); if (ed) { const l = await S.getLog(ed.dataset.editLog); if (l) openLog(l.play_id, l); return; }
    const fo = t.closest("[data-follow]"); if (fo) return follow(fo);
    const rp = t.closest("[data-report]"); if (rp) { const [k, id, uid] = rp.dataset.report.split(":"); return openReport(k, id, uid); }
    const bl = t.closest("[data-block]"); if (bl) return toggleBlock(bl.dataset.block, bl.dataset.name);
    const mr = t.closest("[data-mod-remove]"); if (mr) { const [k, id] = mr.dataset.modRemove.split(":"); if (k !== "list") return removePost(k, id);
      return removePost(k, id, () => { location.hash = "#/lists"; }); }
    const mg = t.closest("[data-manage]"); if (mg) { const p = await S.profileById(mg.dataset.manage); if (p) manageMember(p); return; }
    if (t.closest("[data-log]")) return openLog(null);
    const ao = t.closest("[data-auth-open]"); if (ao) return openAuth(ao.dataset.authOpen);
  });
  // the phone's share sheet in the app; Web Share or copy the link on the website. Links always
  // name the public site (inside the app the page's own address is a local one).
  async function share(title, hash) {
    const how = await N.share({ title, url: N.publicUrl(hash) });
    if (how === "copied") toast("Link copied");
  }

  // ---------------------------------------------------------------- reviews
  const VIS_LABEL = { friends: "Friends", private: "Only you" };
  // a post with a word on the filter list is saved but held: only its author and the Billd team see it
  const HELD_TEXT = "Waiting for the Billd team to approve — it contains a word that needs a check";
  const HELD_SAVED = "Saved. Only you and the Billd team can see it until the team approves it: it contains a word that needs a check.";
  const heldNote = (x, tag = "p") => (x?.held ? `<${tag} class="held-note">${HELD_TEXT}.${me && x.user_id && x.user_id !== me.id ? " Only its author and the Billd team can see it." : ""}</${tag}>` : "");
  const VIS_TITLE = { friends: "Only the people this member follows can see this", private: "Only you can see this" };
  // an entry made or changed offline, waiting on this device (outbox.js)
  const PENDING_TEXT = () => `Saved on this ${DEVICE} · will sync when you're online`;
  const isLocalId = (id) => String(id).startsWith("local-");
  function reviewHTML(l, { poster: withPoster = true, full = false } = {}) {
    const w = byId[l.play_id];
    const mine = me && l.user_id === me.id;
    const body = l.review ? (l.spoilers && !mine && !full ? `<p class="spoiler">This review may contain spoilers. <button class="linkbtn" type="button" data-reveal>Read it anyway</button></p><p class="review-body" hidden>${esc(l.review)}</p>`
      : `<p class="review-body${full ? "" : " clamp"}">${esc(l.review)}</p>`) : "";
    return `<li class="review${withPoster && w ? "" : " noposter"}">${withPoster && w ? poster(w, { badge: false, cls: "sm" }) : ""}
      <div>${withPoster ? `<h3 class="review-title"><a href="${playUrl(l.play_id)}">${esc(w?.title || l.play_title)}</a>${w && fmtDate(w) ? `<small>${esc(fmtDate(w))}</small>` : ""}</h3>` : ""}
        <div class="review-head">${avatar(l.profile, "sm")}<a href="#/u/${esc(l.profile?.username)}">${who(l.profile)}</a>${l.rating ? `<span class="stars" aria-label="${starsLabel(l.rating)}">${stars(l.rating)}</span>` : ""}${l.liked ? `<span class="heart" title="Liked it">♥</span>` : ""}${l.rewatch ? `<span title="Seen before">↻</span>` : ""}
          <span>${l.seen_on ? `Seen ${esc(fmtPartial(l.seen_on))}` : ago(l.created_at)}${l.venue ? ` · ${esc(l.venue)}` : ""}</span>${VIS_LABEL[l.visibility] ? `<span class="vis" title="${VIS_TITLE[l.visibility]}">${VIS_LABEL[l.visibility]}</span>` : ""}</div>
        ${heldNote(l)}${l.pending ? `<p class="pending-note">${PENDING_TEXT()}</p>` : ""}${body}
        <div class="review-foot">
          ${S.kind !== "local" && !isLocalId(l.id) ? `<button type="button" data-like-log="${esc(l.id)}" aria-pressed="${!!l.liked_by_me}">♥ <span>${l.likes ? l.likes.toLocaleString() : ""}</span> ${l.liked_by_me ? "Liked" : "Like"}</button>
          <a href="#/review/${esc(l.id)}">${l.comments ? plural(l.comments, "comment") : "Comment"}</a>` : ""}
          ${full && S.kind !== "local" && !isLocalId(l.id) && (l.visibility || "public") === "public" && !l.held ? `<button type="button" data-share-review="${esc(l.id)}" data-title="${esc(`${l.profile?.display_name || cap(l.profile?.username) || "A member"}'s review of ${w?.title || l.play_title} on Billd`)}">Share</button>` : ""}
          ${mine ? `<button type="button" data-edit-log="${esc(l.id)}">Edit</button>` : l.review ? modButton("review", l.id, l.user_id) : ""}
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
    if (isLocalId(l.id)) { location.replace(playUrl(l.play_id)); return; }  // not on the server yet: nothing to comment on
    const w = byId[l.play_id];
    document.title = `${l.profile?.display_name || l.profile?.username || "A member"}'s review of ${w?.title || l.play_title} · Billd`;
    pageEl().innerHTML = `<div class="wrap" style="max-width:820px;padding-top:30px"><ul class="reviews">${reviewHTML(l, { full: true })}</ul>
      <section class="sec"><div class="sec-head"><h2>Comments</h2></div><ul class="comments" id="cm-list"><li class="hint">Loading…</li></ul>
      ${signedIn() && S.kind !== "local" ? `<form class="comment-form" id="cm-form"><label class="vh" for="cm-body">Add a comment</label><input id="cm-body" maxlength="2000" placeholder="Add a comment…" required><button class="btn" type="submit">Post</button></form>` : S.kind !== "local" ? `<p class="hint"><button class="linkbtn" type="button" data-auth-open="in">Log in</button> to comment.</p>` : ""}</section>
      ${w ? `<p style="margin-top:30px"><a class="linkbtn" href="${playUrl(w.id)}">More about ${esc(w.title)} →</a></p>` : ""}</div>`;
    const draw = async () => {
      const cs = notBlocked(await S.comments(l.id));
      if (stale(tok)) return;
      $("#cm-list").innerHTML = cs.length ? cs.map((c) => `<li><a class="who" href="#/u/${esc(c.profile?.username)}">${who(c.profile)}</a>${esc(c.body)}${heldNote(c, "span")}<time datetime="${esc(c.created_at)}">${ago(c.created_at)}</time>${me && c.user_id === me.id ? ` <button class="linkbtn danger" type="button" data-del-c="${c.id}">Delete</button>` : ` ${modButton("comment", c.id, c.user_id, "linkbtn")}`}</li>`).join("") : `<li class="hint">No comments yet.</li>`;
    };
    draw();
    $("#cm-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = $("#cm-body").value.trim(); if (!body) return;
      try { const c = await S.addComment(l.id, body); $("#cm-body").value = ""; draw(); if (c?.held) toast(HELD_SAVED); } catch (err) { toast(err.message); }
    });
    $("#cm-list").addEventListener("click", async (e) => {
      const d = e.target.closest("[data-del-c]"); if (d) { await S.deleteComment(+d.dataset.delC); draw(); }
      const r = e.target.closest("[data-mod-remove^='comment:']"); if (r) { e.stopPropagation(); removePost("comment", r.dataset.modRemove.split(":")[1], draw); }
    });
  }

  // ---------------------------------------------------------------- log dialog
  const logState = { play: null, edit: null, liked: false, rating: 0, fromPlan: null };
  // prefill: the date and theatre of a plan (openPlan) being logged after the show
  function openLog(playId, edit, prefill) {
    if (!requireMe("Log in to keep a diary of the shows you see.")) return;
    const d = $("#logd");
    logState.edit = edit || null;
    logState.fromPlan = prefill?.fromPlan ? playId : null;
    // a new entry starts from the rating and like already given to the show
    const st = playId ? myStatus[playId] : null;
    logState.liked = edit ? !!edit.liked : !!st?.liked; logState.rating = edit ? (edit.rating || 0) : (st?.rating || 0);
    $("#log-pick-f").hidden = !!playId;
    $("#log-form").hidden = !playId;
    $("#log-pick").value = ""; $("#log-pick-list").innerHTML = "";
    $("#log-note").hidden = true;
    if (playId) setLogPlay(playId); else { $("#log-title").textContent = "What did you see?"; $("#log-meta").textContent = ""; $("#log-poster").innerHTML = ""; $("#log-kicker").textContent = "Log a show"; }
    $("#log-date").value = edit ? (edit.seen_on || "") : prefill?.seen_on && prefill.seen_on <= localToday() ? prefill.seen_on : localToday();
    $("#log-date").max = localToday();
    $("#log-venue").value = edit?.venue || prefill?.venue || ""; $("#log-city").value = edit?.city || prefill?.city || "";
    $("#log-review").value = edit?.review || "";
    $("#log-spoil").checked = !!edit?.spoilers; $("#log-rewatch").checked = !!edit?.rewatch;
    $("#log-del").hidden = !edit;
    $("#log-vis-f").hidden = S.kind === "local";
    let lastVis = "public"; try { lastVis = localStorage.getItem("billd-vis") || "public"; } catch (e) { /* default */ }
    $("#log-vis").value = edit?.visibility || lastVis;
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
    $("#log-pick-list").innerHTML = hits.map((w) => `<li><button type="button" data-pick="${esc(w.id)}"><span>${esc(w.title)}</span><small>${esc([fmtDate(w), byText(w)].filter(Boolean).join(" · "))}</small></button></li>`).join("") || `<li class="hint">No match. Billd doesn't have it? <button class="linkbtn" type="button" data-suggest-play>Suggest a play</button></li>`;
  });
  $("#log-pick-list").addEventListener("click", (e) => { const b = e.target.closest("[data-pick]"); if (b) { setLogPlay(b.dataset.pick); $("#log-date").focus(); } });
  $("#log-like").addEventListener("click", (e) => { logState.liked = !logState.liked; e.currentTarget.setAttribute("aria-pressed", String(logState.liked)); });
  $("#log-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const w = logState.play; if (!w) return;
    const row = { play_id: w.id, play_title: w.title, seen_on: $("#log-date").value || null, rating: logState.rating || null, liked: logState.liked,
                  review: $("#log-review").value.trim() || null, spoilers: $("#log-spoil").checked, rewatch: $("#log-rewatch").checked,
                  venue: $("#log-venue").value.trim() || null, city: $("#log-city").value.trim() || null };
    if (S.kind !== "local") { row.visibility = $("#log-vis").value; try { localStorage.setItem("billd-vis", row.visibility); } catch (e) { /* not kept */ } }
    if (row.seen_on && row.seen_on > localToday()) { note("#log-note", "The date seen can't be in the future.", true); return; }
    if (logState.edit) row.id = logState.edit.id;
    $("#log-save").disabled = true;
    try {
      const saved = await S.saveLog(row);
      const patch = { seen: true }; if (row.rating) patch.rating = row.rating; if (row.liked) patch.liked = true;
      if (row.visibility) patch.visibility = row.visibility;  // the show's rating and marks follow the entry
      const s = await S.setStatus(w.id, patch); if (s) myStatus[w.id] = s;
      if (logState.fromPlan === w.id) await removePlan(w.id);  // seen: the plan has done its job
      $("#logd").close();
      // no connection: kept on this device by outbox.js, and sent when it's back
      toast(saved?.pending ? `Saved on this ${DEVICE}. It will sync when you're back online.` : saved?.held ? HELD_SAVED
        : logState.edit ? "Entry updated" : row.review && S.kind !== "local" ? "Review posted" : "Added to your diary");
      route();
    } catch (err) { note("#log-note", err.message, true); }
    finally { $("#log-save").disabled = false; }
  });
  $("#log-del").addEventListener("click", async () => {
    if (!logState.edit || !confirm("Delete this diary entry? This can't be undone.")) return;
    try { const r = await S.deleteLog(logState.edit.id); $("#logd").close(); toast(r?.queued ? `Entry deleted. Billd will be told when this ${DEVICE} is back online.` : "Entry deleted"); route(); } catch (e) { note("#log-note", e.message, true); }
  });
  function note(sel, msg, isErr, ok) { const n = $(sel); n.textContent = msg || ""; n.hidden = !msg; n.classList.toggle("err", !!isErr); n.classList.toggle("ok", !!ok); }


  // ---------------------------------------------------------------- plans: a date to see a show
  // "I'm going on…": a date (and curtain-up time) for a show, kept on this device (in the app, also in
  // its own storage). The app can remind the member (a local notification, no server); the app and the
  // website both make a calendar file (.ics). After the date, the home page asks how it was, to log it.
  // Plans don't reach Billd's server yet (that needs a column on play_status: docs/app-build.md).
  const planKey = () => `billd-plans-v1:${me?.id || "local"}`;
  // only well-formed plans are read back, so a damaged entry can't break the home page
  function plans() {
    const out = {};
    try {
      const all = JSON.parse(N.prefs.get(planKey()) || "{}");
      if (all && typeof all === "object") for (const [k, p] of Object.entries(all)) {
        if (p && typeof p === "object" && p.play_id === k && /^\d{4}-\d{2}-\d{2}$/.test(p.date || "") && (!p.time || /^\d{2}:\d{2}$/.test(p.time))) out[k] = p;
      }
    } catch (e) { /* damaged: none */ }
    return out;
  }
  // log out (website) or account deleted: the plans and their reminders go
  function clearPlans(key = planKey()) {
    let all = {}; try { all = JSON.parse(N.prefs.get(key) || "{}") || {}; } catch (e) { /* none */ }
    const ids = Object.values(all).filter((p) => p?.remind && p.play_id).map((p) => remindId(p.play_id));
    if (ids.length) N.reminders.cancel(ids).catch(() => {});
    N.prefs.remove(key);
  }
  const savePlans = (all) => N.prefs.set(planKey(), JSON.stringify(all));
  const planOf = (playId) => plans()[playId] || null;
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function fmtTime(t) {
    const [h, m] = (t || "").split(":").map(Number);
    return Number.isFinite(h) ? `${((h + 11) % 12) + 1}${m ? ":" + String(m).padStart(2, "0") : ""} ${h < 12 ? "am" : "pm"}` : "";
  }
  function planWhen(p) {
    const dt = new Date(p.date + "T12:00:00Z");
    return `${WEEKDAYS[dt.getUTCDay()]} ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}${p.time ? `, ${fmtTime(p.time)}` : ""}`;
  }
  // when each kind of reminder goes off, in the phone's own time
  function remindAt(p, kind) {
    const [y, m, d] = p.date.split("-").map(Number);
    if (kind === "eve") return new Date(y, m - 1, d - 1, 18, 0);
    if (kind === "morning") return new Date(y, m - 1, d, 9, 0);
    if (kind === "3h" && p.time) { const [hh, mm] = p.time.split(":").map(Number); return new Date(y, m - 1, d, hh - 3, mm || 0); }
    return null;
  }
  const remindId = (playId) => hash("plan:" + playId) || 1;  // one reminder per planned show
  function reminderText(p, w) {
    const where = [p.time && `Curtain up ${fmtTime(p.time)}`, p.venue && `at ${p.venue}`].filter(Boolean).join(" ");
    const title = p.remind === "eve" ? `Tomorrow: ${w.title}` : p.remind === "3h" ? `Tonight: ${w.title}` : `Today: ${w.title}`;
    return { title, body: where ? where + "." : "Enjoy the show." };
  }
  async function removePlan(playId) {
    const all = plans(); if (!all[playId]) return;
    if (all[playId].remind) await N.reminders.cancel([remindId(playId)]);
    delete all[playId]; savePlans(all);
  }
  // an iCalendar file: a floating local time (the theatre's own clock), or the whole day without one
  const icsText = (t) => String(t || "").replace(/\\/g, "\\\\").replace(/[;,]/g, (c) => "\\" + c).replace(/\r?\n/g, "\\n");
  // RFC 5545: lines of at most 75 octets (UTF-8), continued with a space; never split inside a character
  const utf8 = new TextEncoder();
  function icsFold(line) {
    const out = []; let cur = "", size = 0;
    for (const ch of line) {
      const n = utf8.encode(ch).length;
      if (size + n > (out.length ? 74 : 75)) { out.push(cur); cur = ""; size = 0; }
      cur += ch; size += n;
    }
    out.push(cur);
    return out.join("\r\n ");
  }
  function icsFor(p) {
    const w = byId[p.play_id];
    const day = p.date.replace(/-/g, "");
    const next = new Date(p.date + "T12:00:00Z"); next.setUTCDate(next.getUTCDate() + 1);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Billd//Theatre diary//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT",
      `UID:${p.play_id.replace(/[^A-Za-z0-9_-]/g, "")}-${day}@billd.theater`, `DTSTAMP:${stamp}`];
    if (p.time) lines.push(`DTSTART:${day}T${p.time.replace(":", "").padEnd(4, "0")}00`, "DURATION:PT2H30M");
    else lines.push(`DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, "")}`);
    lines.push(`SUMMARY:${icsText(w ? w.title : p.title)}`);
    if (p.venue || p.city) lines.push(`LOCATION:${icsText([p.venue, p.city].filter(Boolean).join(", "))}`);
    const url = N.publicUrl(playUrl(p.play_id));
    lines.push(`DESCRIPTION:${icsText(`${w ? byText(w) : ""}${w && byText(w) ? "\n" : ""}On Billd: ${url}`)}`, `URL:${url}`);
    if (p.time) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsText(w ? w.title : p.title)}`, "TRIGGER:-PT3H", "END:VALARM");
    lines.push("END:VEVENT", "END:VCALENDAR");
    return lines.map(icsFold).join("\r\n") + "\r\n";
  }
  async function calendarFile(p) {
    const name = `${(byId[p.play_id]?.title || "show").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "show"}-${p.date}.ics`;
    try {
      const how = await N.saveFile(name, icsFor(p), "text/calendar");
      if (how === "downloaded") toast("Calendar file downloaded: open it to add the show to your calendar");
    } catch (e) { toast("Couldn't make the calendar file: " + e.message); }
  }
  let planPlay = null;
  function openPlan(playId) {
    if (!requireMe("Log in to plan the shows you'll see.")) return;
    const w = byId[playId]; if (!w) return;
    planPlay = w;
    const p = planOf(playId);
    $("#plan-title").textContent = w.title;
    $("#plan-date").min = localToday(); $("#plan-date").value = p?.date || "";
    $("#plan-time").value = p?.time || "";
    $("#plan-venue").value = p?.venue || ""; $("#plan-city").value = p?.city || "";
    $("#plan-remind-f").hidden = !N.reminders.available;
    $("#plan-remind").value = p?.remind || "";
    $("#plan-about").textContent = APP ? "Kept on this phone. After the date, Billd asks how it was, so you can log it."
      : "Kept in this browser. After the date, Billd asks how it was, so you can log it. In the Billd app, it can remind you too.";
    $("#plan-del").hidden = !p;
    note("#plan-note", "");
    // the theatres it's on at now, as for logging it
    loadDetail(w).then(() => {
      const runs = w.productions.flatMap((x) => x.runs).filter((r) => listingStatus(r.checked, r.from, r.to));
      const seen = new Set();
      $("#log-venues").innerHTML = runs.map((r) => [venues[r.venue]?.name, places[r.place]?.name]).filter(([v]) => v && !seen.has(v) && seen.add(v))
        .map(([v, c]) => `<option value="${esc(v)}">${esc(c || "")}</option>`).join("");
      if (!p && runs[0] && !$("#plan-venue").value) { $("#plan-venue").value = venues[runs[0].venue]?.name || ""; $("#plan-city").value = places[runs[0].place]?.name || ""; }
    }).catch(() => {});
    $("#pland").showModal();
    $("#plan-date").focus();
  }
  const planForm = () => ({ play_id: planPlay.id, title: planPlay.title, date: $("#plan-date").value, time: $("#plan-time").value,
    venue: $("#plan-venue").value.trim(), city: $("#plan-city").value.trim(), remind: N.reminders.available ? $("#plan-remind").value : "" });
  $("#plan-venue").addEventListener("change", () => {
    const w = planPlay; if (!w) return;
    const r = w.productions.flatMap((x) => x.runs).find((x) => venues[x.venue]?.name === $("#plan-venue").value);
    if (r && places[r.place] && !$("#plan-city").value) $("#plan-city").value = places[r.place].name;
  });
  $("#plan-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const w = planPlay; if (!w) return;
    const p = planForm();
    if (!p.date) return note("#plan-note", "Choose the date you're going.", true);
    if (p.date < localToday()) return note("#plan-note", "That date has passed. To log a show you've seen, use Log or review.", true);
    if (p.remind === "3h" && !p.time) return note("#plan-note", "Add the curtain-up time for a reminder 3 hours before.", true);
    const all = plans(), old = all[w.id];
    if (old?.remind) await N.reminders.cancel([remindId(w.id)]);
    all[w.id] = { ...p, created_at: old?.created_at || new Date().toISOString() };
    savePlans(all);
    let msg = `Planned for ${planWhen(p)}`;
    if (p.remind) {
      try { await N.reminders.schedule({ id: remindId(w.id), at: remindAt(p, p.remind), ...reminderText(p, w), route: playUrl(w.id) }); msg += ". Billd will remind you."; }
      catch (err) { all[w.id].remind = ""; savePlans(all); note("#plan-note", `The plan is saved, but not the reminder: ${err.message}`, true); return; }
    }
    // a show you're going to see is on your want-to-see list
    if (!myStatus[w.id]?.want && !myStatus[w.id]?.seen) S.setStatus(w.id, { want: true }).then((st) => { if (st) myStatus[w.id] = st; }).catch(() => {});
    $("#pland").close(); toast(msg); route();
  });
  $("#plan-ics").addEventListener("click", () => {
    if (!planPlay) return;
    const p = planForm();
    if (!p.date) return note("#plan-note", "Choose the date first.", true);
    calendarFile(p);
  });
  $("#plan-del").addEventListener("click", async () => {
    if (!planPlay) return;
    await removePlan(planPlay.id); $("#pland").close(); toast("Plan removed"); route();
  });
  // the home page's "Coming up": plans ahead, and those just past, to log
  function planStubHTML(p) {
    const w = byId[p.play_id]; if (!w) return "";
    const dt = new Date(p.date + "T12:00:00Z"), past = p.date < localToday();
    return `<li class="stub${past ? " past" : ""}"><div class="stub-d"><span>${past ? "Seen?" : WEEKDAYS[dt.getUTCDay()]}</span><b>${dt.getUTCDate()}</b><span>${MONTHS[dt.getUTCMonth()]}</span></div>
      <div class="stub-i"><h3><a href="${playUrl(w.id)}">${esc(w.title)}</a></h3><p>${esc([p.time && fmtTime(p.time), p.venue, p.city].filter(Boolean).join(" · ") || byText(w))}</p>
        <div class="stub-acts">${past ? `<button class="btn sm" type="button" data-plan-log="${esc(w.id)}">How was it? Log it</button><button class="btn ghost sm" type="button" data-plan-rm="${esc(w.id)}">I didn't go</button>`
          : `<button class="btn ghost sm" type="button" data-plan-ics="${esc(w.id)}">Add to calendar</button><button class="btn ghost sm" type="button" data-plan="${esc(w.id)}">${p.remind ? "Reminder set · change" : N.reminders.available ? "Remind me" : "Change"}</button>`}</div></div></li>`;
  }
  function comingUp() {
    const month = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    return Object.values(plans()).filter((p) => byId[p.play_id] && p.date >= month).sort((a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || ""));
  }

  // ---------------------------------------------------------------- add a production
  // A member pastes a production's page; the server function fetches it and web/extract.js
  // fills in the form. The member checks it, and it goes to a review queue, not onto the site.
  let apCtx = null;
  const ap = { play: null, page: null, extracted: null };
  function extractCtx() {
    if (apCtx) return apCtx;
    const weight = {};
    works.forEach((w) => w._runs.forEach((r) => { if (r.place) weight[r.place] = (weight[r.place] || 0) + 1; }));
    apCtx = {
      works: works.map((w) => ({ id: w.id, title: w.title, alt_titles: w.alt_titles, pop: w._pop, writers: writers(w).map((p) => ppl[p.person]?.name).filter(Boolean) })),
      venues: Object.values(venues).map((v) => ({ id: v.id, name: v.name, place: v.place })),
      places: Object.values(places).map((p) => ({ id: p.id, name: p.name, weight: Math.min(weight[p.id] || 0, 500) })),
      languages: D.languages,
      writersOf: (id) => (byId[id] ? byId[id].people.map((p) => ppl[p.person]?.name).filter(Boolean) : []),
    };
    return apCtx;
  }
  const SUGG_STATUS = { pending: "Waiting for review", approved: "Approved, coming soon", added: "Added, thank you", declined: "Not added" };
  function suggestionsHTML(list, heading) {
    return `<div class="sugg-box"><h3>${esc(heading)}</h3><ul>${list.map((x) => `<li>${x.play_title && heading.startsWith("Productions you suggested") && !heading.includes("this play") ? `<a href="${playUrl(x.play_id)}">${esc(x.play_title)}</a> · ` : ""}${esc([x.venue, x.city].filter(Boolean).join(", "))}${x.date_from ? `, ${esc(fmtPartial(x.date_from))}` : ""}
      <span class="badge${x.status === "added" ? " now" : ""}">${SUGG_STATUS[x.status] || x.status}</span>${x.review_note ? ` <small>${esc(x.review_note)}</small>` : ""} <small class="hint">sent ${ago(x.created_at)}</small></li>`).join("")}</ul>
      <p class="hint">Each suggestion is checked against its link before it's added to the production history.</p></div>`;
  }
  function openAddProduction(playId) {
    if (S.kind === "local") { toast("Adding productions needs Billd's server, which isn't connected on this copy."); return; }
    if (!requireMe("Log in to add a production.")) return;
    ap.play = byId[playId]; ap.page = null; ap.extracted = null;
    $("#ap-title").textContent = ap.play.title + (byText(ap.play) ? ` · ${byText(ap.play)}` : "");
    $("#ap-step1").hidden = false; $("#ap-form").hidden = true;
    $("#ap-url").value = ""; $("#ap-paste").value = ""; $("#ap-paste-box").open = false;
    note("#ap-note", "");
    if (!$("#addprod").open) $("#addprod").showModal();
    $("#ap-url").focus();
  }
  function apFill(x) {
    const set = (sel, val, key) => { const el = $(sel); el.value = val || ""; el.classList.toggle("auto", !!val); el.title = val && x.found?.[key] ? `From the page: “${x.found[key]}”` : ""; };
    set("#ap-from", x.date_from, "dates"); set("#ap-to", x.date_to, "dates");
    set("#ap-venue", x.venue, "venue"); set("#ap-city", x.city, "city");
    set("#ap-dir", (x.directors || []).join(", "), "directors"); set("#ap-cast", (x.cast || []).join(", "), "cast");
    set("#ap-adapt", (x.adapters || []).join(", "), "adapters"); set("#ap-lang", x.language_name, "language");
    $("#ap-link").value = x.url || $("#ap-url").value.trim();
    $("#ap-notes").value = x.creatives?.length ? `Creative team: ${x.creatives.join("; ")}` : "";
    $("#ap-notes").classList.toggle("auto", !!x.creatives?.length);
    $("#ap-people").innerHTML = (x.people || []).map((n) => `<button type="button" class="chip" data-person-add="${esc(n)}">+ ${esc(n)}</button>`).join("");
    $("#ap-people-f").hidden = !(x.people || []).length;
    const filled = ["date_from", "venue", "city", "directors", "cast"].some((k) => x[k] && (!Array.isArray(x[k]) || x[k].length));
    $("#ap-filled").hidden = !filled;
    const other = x.plays?.length && !x.plays.includes(ap.play.id) ? byId[x.plays[0]] : null;
    $("#ap-mismatch").hidden = !other;
    if (other) $("#ap-mismatch").innerHTML = `This page looks like it's about <b>${esc(other.title)}</b>${byText(other) ? ` by ${esc(byText(other))}` : ""}, not ${esc(ap.play.title)}. <button class="linkbtn" type="button" data-ap-switch="${esc(other.id)}">Add it to ${esc(other.title)} instead</button>`;
    // what members may pick from: theatres and cities Billd knows
    const city = places[x.place_id]?.id;
    $("#ap-venues").innerHTML = Object.values(venues).filter((v) => !city || v.place === city).slice(0, 400).map((v) => `<option value="${esc(v.name)}">${esc(places[v.place]?.name || "")}</option>`).join("");
    if (!$("#ap-cities").options.length) $("#ap-cities").innerHTML = Object.values(places).map((p) => `<option value="${esc(p.name)}">`).join("");
    if (!$("#ap-langs").options.length) $("#ap-langs").innerHTML = D.languages.map((l) => `<option value="${esc(l.name)}">`).join("");
    $("#ap-step1").hidden = true; $("#ap-form").hidden = false; note("#ap-note2", "");
    (x.venue ? $("#ap-from") : $("#ap-venue")).focus();
  }
  $("#ap-fetch").addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = $("#ap-url").value.trim();
    if (!url) return note("#ap-note", "Paste the production's web address, or paste its text below.", true);
    $("#ap-go").disabled = true; note("#ap-note", "Reading the page…");
    try {
      const page = await S.fetchProductionPage(url);
      if (!page.ok) {
        note("#ap-note", page.error || "Billd couldn't read that page.", true);
        if (page.blocked) { $("#ap-paste-box").open = true; $("#ap-paste").focus(); }
        return;
      }
      ap.page = page;
      ap.extracted = BilldExtract.extract(page, { ...extractCtx(), playId: ap.play.id });
      apFill(ap.extracted);
    } catch (err) { note("#ap-note", err.message, true); $("#ap-paste-box").open = true; }
    finally { $("#ap-go").disabled = false; }
  });
  $("#ap-read").addEventListener("click", () => {
    const text = BilldExtract.pageTextFromPaste($("#ap-paste").value);
    if (text.length < 40) return note("#ap-note", "Paste the page's text first.", true);
    ap.page = { url: $("#ap-url").value.trim(), text };
    ap.extracted = BilldExtract.extract(ap.page, { ...extractCtx(), playId: ap.play.id });
    apFill(ap.extracted);
  });
  $("#ap-manual").addEventListener("click", () => { ap.extracted = null; apFill({ url: $("#ap-url").value.trim() }); });
  $("#ap-back").addEventListener("click", () => { $("#ap-form").hidden = true; $("#ap-step1").hidden = false; });
  $("#addprod").addEventListener("click", (e) => {
    const p = e.target.closest("[data-person-add]");
    if (p) { const c = $("#ap-cast"); c.value = [c.value.trim(), p.dataset.personAdd].filter(Boolean).join(", "); p.remove(); if (!$("#ap-people").children.length) $("#ap-people-f").hidden = true; return; }
    const sw = e.target.closest("[data-ap-switch]");
    if (sw) { ap.play = byId[sw.dataset.apSwitch]; $("#ap-title").textContent = ap.play.title + (byText(ap.play) ? ` · ${byText(ap.play)}` : ""); $("#ap-mismatch").hidden = true; }
  });
  $("#addprod").addEventListener("input", (e) => e.target.classList?.remove("auto"));
  $("#ap-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = (id) => $(id).value.trim();
    if (!v("#ap-venue") || !v("#ap-city")) return note("#ap-note2", "Say which theatre and city, at least.", true);
    if (!v("#ap-from") && !v("#ap-to")) return note("#ap-note2", "Add the opening date, or roughly when you saw it.", true);
    if (v("#ap-from") && v("#ap-to") && v("#ap-to") < v("#ap-from")) return note("#ap-note2", "The closing date is before the opening.", true);
    const lang = D.languages.find((l) => fold(l.name) === fold(v("#ap-lang")));
    const row = { play_id: ap.play.id, play_title: ap.play.title, url: v("#ap-link") || null, venue: v("#ap-venue"), city: v("#ap-city"),
      date_from: v("#ap-from") || null, date_to: v("#ap-to") || null, directors: v("#ap-dir"), cast_list: v("#ap-cast"), adapters: v("#ap-adapt"),
      language: lang ? lang.id : v("#ap-lang"), notes: v("#ap-notes"),
      extracted: ap.extracted ? { ...ap.extracted, plays: (ap.extracted.plays || []).slice(0, 3) } : null };
    if (ap.sending) return;  // a second tap while the first is on its way
    ap.sending = true; $("#ap-send").disabled = true;
    try {
      await S.suggestProduction(row);
      notifyOwner(row);
      $("#addprod").close();
      toast("Sent for review. Its status shows on this play's page and in Settings.");
      if (location.hash === playUrl(ap.play.id)) route();
    } catch (err) { note("#ap-note2", err.message, true); }
    finally { ap.sending = false; $("#ap-send").disabled = false; }
  });
  // the owner hears about each suggestion by email, through the same form service as feedback
  function notifyOwner(row) {
    if (!web) return;
    const body = { ...(web.fields || {}), from_name: "Billd", subject: `Billd: production suggested for ${row.play_title}`,
      message: [`${row.play_title} at ${row.venue}, ${row.city}`, [row.date_from, row.date_to].filter(Boolean).join(" to "),
        row.directors && `Director: ${row.directors}`, row.cast_list && `Cast: ${row.cast_list}`, row.adapters && `Adapted by: ${row.adapters}`,
        row.notes, row.url && `Link: ${row.url}`, "", "Review it with: python3 scripts/production_suggestions.py"].filter((x) => x !== null && x !== undefined && x !== false).join("\n"),
      name: me ? `${me.display_name || ""} @${me.username}`.trim() : "", play_link: N.publicUrl(playUrl(row.play_id)) };
    fetch(web.endpoint, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) }).catch(() => { /* the suggestion is saved either way */ });
  }
  $("#log-addprod").addEventListener("click", () => {
    if (!logState.play) return;
    const id = logState.play.id;
    $("#logd").close(); openAddProduction(id);
  });

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
      <h3>${esc(l.title)}</h3><p>${who(l.profile)} · ${plural(l.count, "show")}${l.likes ? ` · ♥ ${l.likes}` : ""}</p>${l.held ? `<p class="held-note sm">Waiting for approval</p>` : ""}</a>`;
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
    if (S.kind !== "local") { const ls = notBlocked(await S.recentLists()); if (stale(tok)) return; $("#all-lists").innerHTML = ls.map(listCard).join("") || `<p class="empty">No lists yet.</p>`; }
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
      ${heldNote(l)}${l.description ? `<p class="lead" style="margin-top:12px;max-width:62ch">${esc(l.description)}</p>` : ""}
      <div class="toolbar">
        ${mine ? `<button class="btn ghost sm" type="button" id="edit-list">Edit list</button>` : ""}
        ${S.kind !== "local" && !mine ? `<button class="btn ghost sm" type="button" id="like-list" aria-pressed="${l.liked_by_me}">♥ ${l.liked_by_me ? "Liked" : "Like"} ${l.likes ? `· ${l.likes}` : ""}</button>` : ""}
        <button class="btn ghost sm" type="button" id="share-list">Share</button>
        ${mine ? "" : modButton("list", l.id, l.user_id, "btn ghost sm")}
        <span class="count">${plural(l.count, "show")}</span>
      </div>
      <ul class="list-items${l.ranked ? " ranked" : ""}">${l.items.map((i) => byId[i.play_id] ? `<li>${cell(byId[i.play_id], i.note ? `<div class="cell-cap">${esc(i.note)}</div>${heldNote({ held: i.held, user_id: l.user_id }, "div")}` : "")}</li>` : "").join("") || `<li class="empty">This list is empty.</li>`}</ul></div>`;
    $("#edit-list")?.addEventListener("click", () => editList(l));
    $("#share-list").addEventListener("click", () => share(`${l.title}, a list on Billd`, `#/list/${l.id}`));
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
        $("#editd").close(); toast(saved.held ? HELD_SAVED : l ? "List saved" : "List created");
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
    const [following, followers] = S.kind === "local" ? [[], []] : (await Promise.all([S.following(p.id), S.followers(p.id)])).map((ps) => notBlocked(ps, "id"));
    const blocked = !mine && blockedSet.has(p.id);
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
      // diary entries and shows marked seen without one, newest first, each play once
      const loggedPlays = new Set(logs.map((l) => l.play_id));
      const recent = logs.map((l) => ({ ...l, _log: true, when: l.seen_on || l.created_at.slice(0, 10), at: l.created_at }))
        .concat(seen.filter((s) => !loggedPlays.has(s.play_id)).map((s) => ({ ...s, when: (s.updated_at || "").slice(0, 10), at: s.updated_at || "" })))
        .filter((x) => byId[x.play_id])
        .sort((a, b) => b.when.localeCompare(a.when) || String(b.at).localeCompare(String(a.at)));
      const onStage = want.map((s) => byId[s.play_id]).filter((w) => w && w._now).slice(0, 4);
      const critics = following.slice(0, 4);
      const lines = critics.length ? await Promise.all(critics.map((c) => S.logsForUser(c.id, { limit: 40 }).catch(() => []))) : [];
      if (stale(tok)) return;
      const thisYear = logs.filter((l) => (l.seen_on || l.created_at).startsWith(String(THIS_YEAR)));
      const rated = thisYear.filter((l) => l.rating);
      const venues = new Set(thisYear.map((l) => (l.venue || "").trim().toLowerCase()).filter(Boolean));
      const aside = `${onStage.length ? `<section class="sec"><div class="sec-head"><h2>${mine ? "Tickets to get" : "Wants to see"}</h2><a href="${base}/want">All →</a></div>
          <ul class="stubs">${onStage.map(stubHTML).join("")}</ul></section>` : ""}
        ${critics.length ? `<section class="sec"><div class="sec-head"><h2>${mine ? "Critics I follow" : "Follows"}</h2><a href="${base}/following">All →</a></div>
          <ul class="critics">${critics.map((c, i) => criticHTML(c, lines[i], fset)).join("")}</ul></section>` : ""}
        <div class="season-card"><b>${mine ? "Your" : who(p) + "’s"} ${THIS_YEAR} season</b><p>${plural(thisYear.length, "show")}${venues.size ? ` · ${plural(venues.size, "theatre")}` : ""}${rated.length ? ` · ${(rated.reduce((a, l) => a + l.rating, 0) / rated.length / 2).toFixed(1)}★ average` : ""}</p>
          <a class="btn brass sm" href="${base}/diary">Open the diary</a></div>`;
      body = `<div class="prof-cols"><div>
        <section class="sec"><div class="sec-head"><h2>Recently in the diary</h2><a href="${base}/diary">Diary →</a></div>
          ${recent.length ? `<div class="scraps">${recent.slice(0, 8).map((l) => scrapHTML(l, mine)).join("")}</div>` : `<p class="empty">${mine ? `Nothing logged yet. <button class="linkbtn" type="button" data-log>Log the last show you saw.</button>` : "Nothing logged yet."}</p>`}</section>
        <section class="sec"><div class="sec-head"><h2>Favourite shows</h2>${mine ? `<button type="button" id="edit-favs">Edit</button>` : ""}</div>
          <div class="favs">${[0, 1, 2, 3].map((i) => favs[i] ? `<div>${poster(favs[i], { badge: false })}</div>` : `<div class="fav-empty">${mine ? "Pick a favourite in Edit profile" : ""}</div>`).join("")}</div></section>
        ${logs.some((l) => l.review) ? `<section class="sec"><div class="sec-head"><h2>Recent reviews</h2><a href="${base}/reviews">All →</a></div><ul class="reviews">${logs.filter((l) => l.review).slice(0, 3).map((l) => reviewHTML(l)).join("")}</ul></section>` : ""}
        </div><aside aria-label="Tickets, critics and season">${aside}</aside></div>`;
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
    pageEl().innerHTML = `<div class="prof-mast"><div class="wrap">
      <header class="prof">${avatar(p, "lg")}
        <div class="prof-main"><h1>${who(p)}’s Show Diary</h1><div class="handle">@${esc(p.username)}${S.kind === "local" ? " · saved on this device" : ""} ${roleBadge(p.id)}</div>${p.bio ? `<p class="bio">${esc(p.bio)}</p>` : ""}
          <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">${mine ? `<a class="btn ghost sm" href="#/settings">Edit profile</a>${S.kind !== "local" ? `<button class="btn ghost sm" type="button" data-logout>Log out</button>` : ""}` : S.kind !== "local" && !blocked ? `<button class="btn sm${fset.has(p.id) ? " on" : ""}" type="button" data-follow="${p.id}" data-on="${fset.has(p.id)}">${fset.has(p.id) ? "Following" : "Follow"}</button>` : ""}
            ${!mine && me && S.kind !== "local" ? (outranks(p.id) ? `<button class="btn ghost sm" type="button" data-manage="${p.id}">Manage</button>` : `<button class="btn ghost sm" type="button" data-report="profile:${p.id}:${p.id}">Report</button>`) : ""}
            ${!mine && me && S.kind !== "local" ? `<button class="btn ghost sm${blocked ? "" : " danger"}" type="button" data-block="${p.id}" data-name="${esc(p.display_name || p.username)}">${blocked ? "Unblock" : "Block"}</button>` : ""}
            <button class="btn ghost sm" type="button" id="share-prof">Share</button></div></div>
        <div class="prof-stats"><a href="${base}/seen"><b>${seen.length.toLocaleString()}</b><span>Shows</span></a><a href="${base}/diary"><b>${year.toLocaleString()}</b><span>This year</span></a><a href="${base}/lists"><b>${lists.length}</b><span>Lists</span></a>
          ${S.kind !== "local" ? `<a href="${base}/following"><b>${following.length}</b><span>Following</span></a><a href="${base}/followers"><b>${followers.length}</b><span>Followers</span></a>` : ""}</div>
      </header></div></div><div class="wrap">
      ${blocked ? `<p class="banner" style="margin:0 0 16px"><b>You've blocked ${who(p)}.</b> You don't see their diary, reviews, comments or lists, and they can't follow you or like or comment on your reviews.</p>` : ""}
      <nav class="tabs" aria-label="Profile">${tabs.map(([k, n]) => `<a href="${base}${k ? "/" + k : ""}"${k === (tab || "") ? ' aria-current="page"' : ""}>${n}</a>`).join("")}</nav>
      ${body}</div>`;
    $('.tabs a[aria-current="page"]')?.scrollIntoView({ inline: "center", block: "nearest" });
    $("#share-prof").addEventListener("click", () => share(`${p.display_name || p.username} on Billd`, "#/u/" + encodeURIComponent(p.username)));
    $("#edit-favs")?.addEventListener("click", () => editProfile());
    $("#new-list2")?.addEventListener("click", () => editList(null));
  }
  // A diary entry as a programme pasted into a scrapbook: the cover, the night, the stars and the
  // member's own words in pen. Works for a log and for a show marked seen without one.
  function scrapHTML(l, mine) {
    const w = byId[l.play_id];
    const d = l.seen_on || (l.created_at || "").slice(0, 10) || l.when || "";
    const dt = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + "T12:00:00Z") : null;
    const day = dt ? `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dt.getUTCDay()]} ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}` : "";
    const note = (l.review || "").trim().replace(/\s+/g, " ");
    const isLog = !!l._log || "seen_on" in l;
    return `<article class="scrap"><a href="${playUrl(l.play_id)}" aria-label="${esc(w?.title || l.play_title || "")}">${w ? poster(w, { tag: "span", badge: false }) : ""}</a>
      <div class="scrap-meta">${day ? `<time datetime="${esc(d)}">${esc(day)}</time>` : "<span></span>"}${l.rating ? `<span class="stars" aria-label="${starsLabel(l.rating)}">${stars(l.rating)}</span>` : ""}</div>
      ${note ? `<p class="scrap-note">${isLocalId(l.id) ? esc(note.length > 110 ? note.slice(0, 108).trimEnd() + "…" : note) : `<a href="#/review/${esc(l.id)}">${esc(note.length > 110 ? note.slice(0, 108).trimEnd() + "…" : note)}</a>`}</p>` : ""}
      ${l.venue ? `<p class="scrap-venue">${esc(l.venue)}</p>` : ""}${l.held ? `<p class="held-note sm" title="${HELD_TEXT}">Waiting for approval</p>` : ""}${l.pending ? `<p class="pending-note sm" title="${PENDING_TEXT()}">Saved on this ${DEVICE} · will sync</p>` : ""}
      <div class="scrap-foot">${l.liked ? `<span class="heart" title="Liked" aria-label="Liked">♥</span>` : ""}${l.rewatch ? `<span title="Seen before" aria-label="Seen before">↻</span>` : ""}${note && !isLocalId(l.id) ? `<a href="#/review/${esc(l.id)}">Review</a>` : ""}${mine && isLog && l.id ? `<button class="end" type="button" data-edit-log="${esc(l.id)}" aria-label="Edit entry">✎</button>` : ""}</div></article>`;
  }
  // A show on the want-to-see list that is on stage: a ticket stub dated by its closing or opening night
  function stubHTML(w) {
    const rs = w._runs.filter((r) => r.st);
    const soon = w._now === "soon";
    const d = soon ? rs.map((r) => r.from).filter((x) => x && x.length === 10).sort()[0] : rs.map((r) => r.to).filter((x) => x && x.length === 10).sort().pop();
    const dt = d ? new Date(d + "T12:00:00Z") : null;
    const block = dt ? `<span>${soon ? "Opens" : "Until"}</span><b>${dt.getUTCDate()}</b><span>${MONTHS[dt.getUTCMonth()]}</span>` : `<span>On</span><b>now</b>`;
    return `<li class="stub"><div class="stub-d">${block}</div><div class="stub-i"><h3><a href="${playUrl(w.id)}">${esc(w.title)}</a></h3><p>${esc(nowWhere(w))}</p>
      <a class="btn ghost sm" href="${playUrl(w.id)}">Tickets →</a></div></li>`;
  }
  function criticHTML(c, logs, fset) {
    const last = (logs || []).find((l) => l.review);
    const line = last ? last.review.trim().replace(/\s+/g, " ") : "";
    return `<li class="critic">${avatar(c)}<div class="critic-i"><a href="#/u/${esc(c.username)}">${who(c)}</a><small>${plural((logs || []).length, "diary entry", "diary entries")}</small>
      ${line ? `<q>${esc(line.length > 60 ? line.slice(0, 58).trimEnd() + "…" : line)}</q>` : ""}</div>
      ${me && c.id !== me.id ? `<button class="btn ghost sm${fset.has(c.id) ? " on" : ""}" type="button" data-follow="${c.id}" data-on="${fset.has(c.id)}">${fset.has(c.id) ? "Following" : "Follow"}</button>` : ""}</li>`;
  }
  function diaryHTML(logs, mine) {
    if (!logs.length) return `<p class="empty">The diary is empty.${mine ? ` <button class="linkbtn" type="button" data-log>Log a show</button>` : ""}</p>`;
    const dOf = (l) => l.seen_on || l.created_at.slice(0, 10);
    const sorted = [...logs].sort((a, b) => dOf(b).localeCompare(dOf(a)));
    const months = [];
    for (const l of sorted) {
      const m = dOf(l).slice(0, 7);
      if (!months.length || months[months.length - 1].m !== m) months.push({ m, logs: [] });
      months[months.length - 1].logs.push(l);
    }
    return months.map(({ m, logs: ls }) => `<h2 class="month">${new Date(m + "-15T12:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })} <small>${plural(ls.length, "show")}</small></h2>
      <div class="scraps">${ls.map((l) => scrapHTML(l, mine)).join("")}</div>`).join("");
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
    const draw = async (q) => { const fset = await myFollowing(); const ms = notBlocked(await S.members(q), "id"); if (stale(tok)) return; $("#mem-list").innerHTML = ms.map((m) => memberHTML(m, fset)).join("") || `<li class="empty">No members found.</li>`; };
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
      const [lg, mk] = await Promise.all([everyone ? S.recentLogs(60) : S.feed(60), S.recentMarks(60, { friends: !everyone }).catch(() => [])]);
      const logs = notBlocked(withMarks(lg.filter((l) => byId[l.play_id]), mk)).slice(0, 80);
      if (stale(tok)) return;
      $("#feed").innerHTML = logs.length ? logs.map(feedItem).join("") : `<li class="empty">${everyone ? `Nothing yet. <button class="linkbtn" type="button" data-log>Log a show</button> to get things started.` : `Nothing from people you follow yet. <a class="linkbtn" href="#/members">Find members to follow</a>.`}</li>`;
    } catch (e) { if (!stale(tok)) $("#feed").innerHTML = `<li class="empty">${esc(e.message)}</li>`; }
  }
  // Diary entries plus shows marked on a play's page without one (Letterboxd shows both). Logging
  // also marks the show, so a mark is left out when the same member logged that play around then.
  function withMarks(logs, marks) {
    const logged = new Map();
    logs.forEach((l) => { const k = l.user_id + "|" + l.play_id; logged.set(k, [...(logged.get(k) || []), Date.parse(l.created_at)]); });
    const extra = marks.filter((m) => byId[m.play_id] && !(logged.get(m.user_id + "|" + m.play_id) || []).some((t) => Math.abs(t - Date.parse(m.updated_at)) < 864e5))
      .map((m) => ({ ...m, mark: true, created_at: m.updated_at }));
    return logs.concat(extra).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  }
  function feedItem(l) {
    const w = byId[l.play_id];
    if (l.mark) {
      const verb = !l.seen ? "wants to see" : l.rating ? "rated" : l.liked ? "liked" : "saw";
      return `<li>${poster(w, { badge: false })}<div class="what"><a href="#/u/${esc(l.profile?.username)}">${who(l.profile)}</a> ${verb} <a href="${playUrl(w.id)}">${esc(w.title)}</a>
        ${l.seen && l.rating ? ` <span class="stars" aria-label="${starsLabel(l.rating)}">${stars(l.rating)}</span>` : ""}${l.seen && l.liked ? ` <span class="heart">♥</span>` : ""}</div><time datetime="${esc(l.created_at)}">${ago(l.created_at)}</time></li>`;
    }
    const verb = l.review ? "reviewed" : l.rewatch ? "saw again" : "saw";
    return `<li>${poster(w, { badge: false })}<div class="what"><a href="#/u/${esc(l.profile?.username)}">${who(l.profile)}</a> ${verb} <a href="${l.review ? `#/review/${esc(l.id)}` : playUrl(w.id)}">${esc(w.title)}</a>
      ${l.rating ? ` <span class="stars" aria-label="${starsLabel(l.rating)}">${stars(l.rating)}</span>` : ""}${l.liked ? ` <span class="heart">♥</span>` : ""}${l.venue ? ` <small class="hint">at ${esc(l.venue)}</small>` : ""}${heldNote(l)}</div><time datetime="${esc(l.created_at)}">${ago(l.created_at)}</time></li>`;
  }


  // ---------------------------------------------------------------- the offline diary (outbox.js)
  // Changes made without a connection wait on this device; a bar says so until they're sent.
  const OP_TEXT = { insert: "Logged", update: "Edited your entry for", delete: "Deleted a diary entry", status: "Marked" };
  const opTitle = (o) => byId[o.play_id || o.row?.play_id || o.prev?.play_id]?.title || o.row?.play_title || o.prev?.play_title || "";
  const opLine = (o) => `${OP_TEXT[o.kind] || "Changed"}${o.kind === "delete" ? "" : ` <b>${esc(opTitle(o))}</b>`} <small>${ago(o.at)} on this ${DEVICE}</small>`;
  function renderSyncBar() {
    const el = $("#sync-bar");
    let n = 0, bad = 0;
    try { if (me && S.kind !== "local") { n = OB.count(); bad = OB.problems().length; } } catch (e) { console.warn(e); }  // never in the way of opening
    el.hidden = !n && !bad;
    if (el.hidden) return;
    el.innerHTML = n && OB.waitingForLogin?.() ? `${plural(n, "change")} saved on this ${DEVICE}, waiting for your login to renew: ${n === 1 ? "it's" : "they're"} sent as soon as it does.`
      : n ? `${plural(n, "change")} saved on this ${DEVICE}${navigator.onLine ? `, waiting to sync. <button class="linkbtn" type="button" id="sync-now">Sync now</button>` : `: ${n === 1 ? "it" : "they"}'ll sync when you're back online.`}${bad ? ` <a class="linkbtn" href="#/settings">${plural(bad, "change")} need${bad === 1 ? "s" : ""} a look</a>` : ""}`
      : `${plural(bad, "change")} made on this ${DEVICE} couldn't be saved to Billd. <a class="linkbtn" href="#/settings">Have a look</a>`;
  }
  $("#sync-bar").addEventListener("click", (e) => { if (e.target.closest("#sync-now")) OB.flush(); });
  OB.onChange((info) => {
    renderSyncBar();
    if (info.sent) {
      toast(`${plural(info.sent, "change")} from this ${DEVICE} synced to Billd${info.notices?.includes("held") ? ". " + HELD_SAVED : ""}`);
      S.myStatuses().then((m) => { myStatus = m; }).catch(() => {});
      route();
    }
    if (info.notices?.includes("readded")) setTimeout(() => toast("An entry you edited offline had been deleted on another device, so it was saved again as a new entry."), 3000);
  });
  window.addEventListener("online", renderSyncBar);
  window.addEventListener("offline", renderSyncBar);
  function syncSettingsHTML() {
    if (!me || S.kind === "local") return "";
    const items = OB.items(), probs = OB.problems();
    if (!items.length && !probs.length) return "";
    return `<section class="sec" id="st-sync"><div class="sec-head"><h2>Saved on this ${DEVICE}</h2></div>
      ${items.length ? `<p class="hint">Made without a connection; sent to Billd when it's back.</p><ul class="outbox-list">${items.map((o) => `<li><span>${opLine(o)}</span></li>`).join("")}</ul>
        <p style="margin-top:10px"><button class="btn ghost sm" type="button" data-ob-flush>Sync now</button></p>` : ""}
      ${probs.length ? `<p class="hint" style="margin-top:14px">These changes couldn't be saved as they were. Nothing has been thrown away: choose what to do with each.</p><ul class="outbox-list">${probs.map((o) => `<li><span>${opLine(o)}<small>${esc(o.note || "")}</small></span>
        ${o.problem === "conflict" ? `<button class="btn sm" type="button" data-ob-mine="${esc(o.id)}">Use this ${DEVICE}'s version</button><button class="btn ghost sm" type="button" data-ob-drop="${esc(o.id)}">Keep the other</button>`
          : `<button class="btn sm" type="button" data-ob-retry="${esc(o.id)}">Try again</button><button class="btn ghost sm danger" type="button" data-ob-drop="${esc(o.id)}">Discard</button>`}</li>`).join("")}</ul>` : ""}</section>`;
  }
  pageEl().addEventListener("click", async (e) => {
    const t = e.target;
    if (t.closest("[data-ob-flush]")) { await OB.flush(); return renderSettings(); }
    const r = t.closest("[data-ob-retry]"); if (r) { await OB.retry(r.dataset.obRetry); return renderSettings(); }
    const m = t.closest("[data-ob-mine]"); if (m) { await OB.keepMine(m.dataset.obMine); return renderSettings(); }
    const d = t.closest("[data-ob-drop]"); if (d && confirm("Discard this change? It hasn't reached Billd, and it can't be brought back.")) { OB.discard(d.dataset.obDrop); renderSettings(); }
  });

  // ---------------------------------------------------------------- settings
  function renderSettings() {
    document.title = "Settings · Billd";
    let theme = "light"; try { theme = localStorage.getItem("billd-theme") || "light"; } catch (e) { /* default */ }
    const local = S.local && S.kind !== "local" && S.local.isLocalData();
    pageEl().innerHTML = `<div class="wrap" style="padding-top:30px;max-width:720px"><h1 class="h1">Settings</h1>
      ${me ? `<section class="sec"><div class="sec-head"><h2>Profile</h2></div><button class="btn ghost" type="button" id="st-prof">Edit profile and favourites</button></section>` : ""}
      ${myRank() ? `<section class="sec"><div class="sec-head"><h2>Billd team</h2></div><p class="hint" style="margin-bottom:10px">You're ${myRank() === 1 ? "a moderator" : myRank() === 2 ? "an admin" : "the owner"}.</p><a class="btn ghost" href="#/admin">Open Admin</a></section>` : ""}
      ${syncSettingsHTML()}
      ${canInstall() ? `<section class="sec"><div class="sec-head"><h2>The app</h2></div><p class="hint" style="margin-bottom:10px">Put Billd on your home screen and open it like an app.</p><button class="btn ghost" type="button" data-install>Install the app</button></section>` : ""}
      ${APP ? `<section class="sec"><div class="sec-head"><h2>The catalogue</h2></div><p class="hint" style="margin-bottom:10px">The plays and what's on stage are kept on this phone, so Billd works offline. This copy was made ${esc(fmtPartial((D.meta.generated || "").slice(0, 10)))}${N.catalogue.using?.from === "downloaded" ? ", downloaded from billd.theater" : ", when the app was built"}. Newer copies download by themselves on Wi-Fi.</p><button class="btn ghost" type="button" id="st-data">Check for a newer catalogue</button></section>` : ""}
      <section class="sec"><div class="sec-head"><h2>Appearance</h2></div>
        <div class="seg" role="radiogroup" aria-label="Theme">${[["light", "Programme (light)"], ["dark", "Velvet (dark)"]].map(([k, n]) => `<button type="button" role="radio" data-theme-set="${k}" aria-selected="${theme === k}" aria-checked="${theme === k}">${n}</button>`).join("")}</div></section>
      ${local && me ? `<section class="sec"><div class="sec-head"><h2>Diary saved on this device</h2></div><p>This device has shows you logged before you had an account. <button class="btn sm" type="button" id="st-import">Move them to my account</button></p></section>` : ""}
      ${me && S.kind !== "local" ? `<section class="sec" id="st-sugg" hidden></section>` : ""}
      <section class="sec"><div class="sec-head"><h2>Your data</h2></div><p class="hint" style="margin-bottom:10px">Download everything you've logged, rated, reviewed and listed, as a JSON file.</p><button class="btn ghost" type="button" id="st-export"${me ? "" : " disabled"}>Download my data</button></section>
      ${me && S.kind !== "local" ? `<section class="sec" id="st-blocks"><div class="sec-head"><h2>Blocked members</h2></div><p class="hint">Loading…</p></section>` : ""}
      ${me && S.kind !== "local" ? `<section class="sec"><div class="sec-head"><h2>Account</h2></div><form id="st-pw" style="display:flex;gap:8px;flex-wrap:wrap;max-width:460px"><label class="vh" for="st-pass">New password</label><input id="st-pass" type="password" minlength="8" placeholder="New password" autocomplete="new-password" style="flex:1"><button class="btn ghost" type="submit">Change password</button></form>
        <p style="margin-top:18px"><button class="btn ghost" type="button" id="st-out">Log out</button></p></section>` : ""}
      ${S.kind === "local" ? `<section class="sec"><div class="sec-head"><h2>Preview mode</h2></div><p class="hint">Billd isn't connected to its server yet, so your diary lives in this browser. Clearing your browser data would erase it; download it above to keep a copy.</p></section>` : ""}
      ${me ? `<section class="sec"><div class="sec-head"><h2>${S.kind === "local" ? "Delete my data" : "Delete my account"}</h2></div><div class="danger-zone">
        <p>${S.kind === "local" ? "Erase every show, rating, review and list saved on this device." : "Delete your account and everything you've posted on Billd: your diary, reviews, ratings, comments, lists, likes and follows. This can't be undone."} <a href="#/delete-account">What happens</a></p>
        <button class="btn ghost danger" type="button" id="st-delete">${S.kind === "local" ? "Erase the diary on this device" : "Delete my account"}</button></div></section>` : ""}
      <section class="sec"><div class="sec-head"><h2>Terms and policies</h2></div><p class="foot-links" style="margin:0"><a href="#/terms">Terms of Use</a> · <a href="#/privacy">Privacy Policy</a> · <a href="#/guidelines">Community Guidelines</a></p></section>
    </div>`;
    $("#st-prof")?.addEventListener("click", editProfile);
    if ($("#st-sugg")) Promise.all([S.mySuggestions(), S.myPlaySuggestions().catch(() => [])]).then(([list, plays]) => {
      if (!$("#st-sugg") || !(list.length || plays.length)) return;
      $("#st-sugg").innerHTML = (list.length ? suggestionsHTML(list, "Productions you suggested") : "")
        + (plays.length ? `<div class="sugg-box"><h3>Plays you suggested</h3><ul>${plays.map((x) => `<li><b>${esc(x.title)}</b>${x.playwright ? ` · ${esc(x.playwright)}` : ""}
            <span class="badge${x.status === "added" ? " now" : ""}">${SUGG_STATUS[x.status] || x.status}</span>${x.review_note ? ` <small>${esc(x.review_note)}</small>` : ""} <small class="hint">sent ${ago(x.created_at)}</small></li>`).join("")}</ul></div>` : "");
      $("#st-sugg").hidden = false;
    }).catch(() => {});
    $$("[data-theme-set]").forEach((b) => b.addEventListener("click", () => {
      const t = b.dataset.themeSet; document.documentElement.dataset.theme = t;
      try { localStorage.setItem("billd-theme", t); } catch (e) { /* not kept */ }
      renderSettings();
    }));
    $("#st-export")?.addEventListener("click", exportData);
    $("#st-data")?.addEventListener("click", async (e) => {
      e.target.disabled = true; e.target.textContent = "Checking…";
      try { const gen = await N.catalogue.refresh({ force: true }); toast(gen ? `Downloaded the catalogue of ${fmtPartial(gen.slice(0, 10))}. Billd uses it the next time you open it.` : navigator.onLine ? "You have the latest catalogue." : "You're offline. Try again with a connection."); }
      catch (err) { toast("The catalogue couldn't be downloaded: " + err.message); }
      finally { e.target.disabled = false; e.target.textContent = "Check for a newer catalogue"; }
    });
    $("#st-out")?.addEventListener("click", logOut);
    $("#st-pw")?.addEventListener("submit", async (e) => { e.preventDefault(); try { await S.setPassword($("#st-pass").value); $("#st-pass").value = ""; toast("Password changed"); } catch (err) { toast(err.message); } });
    $("#st-delete")?.addEventListener("click", openDeleteAccount);
    if ($("#st-blocks")) S.blocks().then((rows) => {
      const el = $("#st-blocks"); if (!el) return;
      blockedSet = new Set(rows.map((r) => r.blocked));
      el.innerHTML = `<div class="sec-head"><h2>Blocked members</h2></div>${rows.length ? `<ul class="blocked-list">${rows.map((r) => `<li>${avatar(r.profile, "sm")}<div><a href="#/u/${esc(r.profile?.username || "")}">${who(r.profile)}</a><small>@${esc(r.profile?.username || "")} · blocked ${ago(r.created_at)}</small></div>
          <button class="btn ghost sm" type="button" data-unblock="${esc(r.blocked)}" data-name="${esc(r.profile?.display_name || r.profile?.username || "")}">Unblock</button></li>`).join("")}</ul>`
        : `<p class="hint">You haven't blocked anyone. To block a member, open their profile and choose Block. Blocked members can't follow you or comment on or like your reviews, and you won't see their posts.</p>`}`;
      el.onclick = async (e) => {
        const b = e.target.closest("[data-unblock]"); if (!b) return;
        b.disabled = true;
        try { await S.block(b.dataset.unblock, false); blockedSet.delete(b.dataset.unblock); toast(`Unblocked ${b.dataset.name}`); renderSettings(); } catch (err) { toast(err.message); b.disabled = false; }
      };
    }).catch(() => { if ($("#st-blocks")) $("#st-blocks").hidden = true; });
    $("#st-import")?.addEventListener("click", async (e) => {
      e.target.disabled = true;
      try { await S.importLocal(S.local.exportLocal()); S.local.clearLocal(); myStatus = await S.myStatuses(); toast("Moved to your account"); route(); }
      catch (err) { toast(err.message); e.target.disabled = false; }
    });
  }
  // Log out: changes made without a connection that haven't reached Billd are sent first if possible;
  // otherwise the member chooses (they're cleared with the rest of the member's copy on this device).
  async function logOut(e) {
    const b = e?.currentTarget; if (b) b.disabled = true;
    try {
      let n = OB.count();
      if (n && navigator.onLine) { await OB.flush().catch(() => {}); n = OB.count(); }
      const bad = OB.problems().length;  // refused or conflicting changes waiting in Settings for the member to choose
      const what = [n ? `${n === 1 ? "A change" : `${n} changes`} you made without a connection ${n === 1 ? "hasn't" : "haven't"} reached Billd yet.` : "",
        bad ? `${bad === 1 ? "A change" : `${bad} changes`} made on this ${APP ? "phone" : "device"} couldn't be saved and ${bad === 1 ? "is" : "are"} waiting for you in Settings.` : ""].filter(Boolean).join(" ");
      if ((n || bad) && !confirm(`${what} Logging out discards ${n + bad === 1 ? "it" : "them"}.\n\nOK: log out and discard. Cancel: stay logged in${n ? `; waiting changes are sent when you're back online` : ""}.`)) return;
      if (!APP) clearPlans();  // a shared computer keeps nothing of the member's (the app keeps plans and their reminders)
      await S.signOut(); toast("Logged out"); location.hash = "#/";
    } finally { if (b) b.disabled = false; }
  }
  async function exportData() {
    const [logs, statuses, lists] = await Promise.all([S.logsForUser(me.id, { limit: 5000 }), S.statusesFor(me.id), S.listsForUser(me.id)]);
    await N.saveFile(`billd-${me.username}-${TODAY}.json`, JSON.stringify({ profile: me, exported: new Date().toISOString(), statuses, logs, lists }, null, 2), "application/json");
  }
  // ---- delete my account (Apple 5.1.1(v), Google Play): explained, then confirmed by typing the username
  function openDeleteAccount() {
    if (!me) return;
    const local = S.kind === "local";
    const word = local ? "erase" : me.username;
    $("#edit-title").textContent = local ? "Erase the diary on this device?" : "Delete your account?";
    const step1 = () => {
      $("#edit-form").innerHTML = local
        ? `<p style="margin:0">Every show, rating, review and list saved in this browser will be erased. Nothing of yours is kept anywhere else.</p>
          <p class="hint">Download a copy first if you might want it: <button class="linkbtn" type="button" data-del="export">Download my data</button></p>
          <div class="acts"><button class="btn ghost" type="button" data-close>Cancel</button><button class="btn danger" type="button" data-del="next">Continue</button></div>`
        : `<p style="margin:0">This deletes your Billd account <b>@${esc(me.username)}</b> straight away, and with it:</p>
          <ul class="del-steps"><li>your diary, ratings and reviews, and the likes and comments on them;</li><li>your comments, likes and lists;</li>
            <li>who you follow and who follows you, and anyone you blocked;</li><li>your profile, suggestions and messages to the team.</li></ul>
          <p class="hint">Reports you sent stay with the Billd team without your name, and the team's log notes that an account was deleted, not whose. It can't be undone, and you can join again later with the same email. <a href="#/delete-account" target="_blank" rel="noopener">More about deleting</a></p>
          <p class="hint">Want a copy first? <button class="linkbtn" type="button" data-del="export">Download my data</button></p>
          <div class="acts"><button class="btn ghost" type="button" data-close>Cancel</button><button class="btn danger" type="button" data-del="next">Continue</button></div>`;
    };
    const step2 = () => {
      $("#edit-form").innerHTML = `<p style="margin:0">${local ? "To confirm, type <b>erase</b> below." : `To confirm, type your username, <b>${esc(me.username)}</b>, below. Your account and everything you posted are deleted at once, and this can't be undone.`}</p>
        <div class="field"><label for="del-confirm">${local ? "Confirm" : "Your username"}</label>
          <input id="del-confirm" autocomplete="off" autocapitalize="none" spellcheck="false"></div>
        <p class="note err" id="del-note" hidden></p>
        <div class="acts"><button class="btn ghost" type="button" data-close>Cancel</button><button class="btn danger" type="submit" id="del-go" disabled>${local ? "Erase everything" : "Delete my account"}</button></div>`;
      const inp = $("#del-confirm");
      inp.addEventListener("input", () => { $("#del-go").disabled = inp.value.trim().replace(/^@/, "").toLowerCase() !== word; });
      inp.focus();
    };
    step1();
    const form = $("#edit-form");
    form.oninput = null;
    form.onclick = (e) => {
      const b = e.target.closest("[data-del]"); if (!b) return;
      if (b.dataset.del === "export") exportData();
      if (b.dataset.del === "next") step2();
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const typed = $("#del-confirm")?.value.trim().replace(/^@/, "").toLowerCase();
      if (typed !== word) return;
      $("#del-go").disabled = true; note("#del-note", "");
      try {
        const planned = planKey();
        await S.deleteAccount(typed);
        clearPlans(planned);
        myStatus = {}; blockedSet = new Set(); followingSet = null;
        $("#editd").close();
        if (local) { me = S.me(); toast("Erased"); location.hash = "#/"; route(); return; }
        me = null; renderAcct(); renderStanding(); renderTermsBar();
        location.hash = "#/delete-account/done";
      } catch (err) { note("#del-note", err.message, true); $("#del-go").disabled = false; }
    };
    $("#editd").showModal();
  }
  // #/delete-account: how to delete an account, for everyone (Google Play asks for a web page)
  function renderDeleteAccount(sub) {
    document.title = "Delete your account · Billd";
    const mail = CFG.contact?.support || CFG.contact?.privacy || "";
    if (sub === "done") {
      pageEl().innerHTML = `<div class="wrap prose" style="padding-top:30px"><h1 class="h1">Your account has been deleted</h1>
        <p>Your Billd account and everything you posted are gone, and you've been logged out on this device. Thank you for using Billd.</p>
        <p>You can keep browsing the plays, and you're welcome to join again any time.</p><p><a class="btn ghost" href="#/">Go to the home page</a></p></div>`;
      return;
    }
    const local = S.kind === "local";
    pageEl().innerHTML = `<div class="wrap prose" style="padding-top:30px"><h1 class="h1">Deleting your Billd account</h1>
      ${local ? `<p>On this copy of Billd there are no accounts: your diary is saved only in this browser. Erase it in <a href="#/settings">Settings</a> → <b>Delete my data</b>, or by clearing this site's data in your browser.</p>`
      : `<p>You can delete your account yourself, at any time, on the website or in the app:</p>
      <ol class="steps"><li>Log in to Billd.</li><li>Open <a href="#/settings">Settings</a> (from your profile picture, or the Profile tab).</li><li>Choose <b>Delete my account</b>, then type your username to confirm.</li></ol>
      ${me ? `<p><button class="btn danger" type="button" id="da-go">Delete my account</button></p>` : `<p><button class="btn ghost" type="button" data-auth-open="in">Log in</button></p>`}
      <h2>What's deleted</h2>
      <p>Straight away: your account and login, your profile, your diary entries, ratings and reviews (with the likes and comments other members left on them), your comments, likes and lists, who you follow and who follows you, the members you blocked, the plays and productions you suggested, and the feedback you sent.</p>
      <h2>What's kept</h2>
      <ul><li>Reports you sent about other members' posts stay with the Billd team, without your name, so the team can still act on them.</li>
        <li>The team's moderation log keeps a line saying an account was deleted, without your name, and drops the words of any of your posts it had recorded.</li>
        <li>Facts you suggested that were already added to Billd's catalogue (a production's dates or cast) stay, without your name.</li>
        <li>Our database provider's backups are overwritten on their normal schedule.</li></ul>
      <h2>Can't log in?</h2>
      <p>${mail ? `Email <a href="mailto:${esc(mail)}?subject=${encodeURIComponent("Delete my Billd account")}">${esc(mail)}</a> from the address on your account, with your username, or` : "Reset your password from the Log in window, or"} <button class="linkbtn" type="button" id="da-ask">ask the Billd team to delete it</button>${mail ? "" : " (include your username and the email address on the account)"}. We'll confirm it with you by email and delete it within 30 days, usually much sooner.</p>`}
    </div>`;
    $("#da-go")?.addEventListener("click", openDeleteAccount);
    $("#da-ask")?.addEventListener("click", () => {
      openFeedback(null);
      $("#fb-title").textContent = "Delete my account";
      $("#fb-text").value = "Please delete my Billd account.\nUsername: \nEmail address on the account: ";
    });
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
      <h2>On stage now</h2><p>A show counts as on now or coming soon only if a listing confirmed it in the last ${STALE_DAYS} days and its closing date hasn't passed. Ticket links go to the theatre's own box office or to ticket sellers (Ticketmaster, TodayTix, Broadway Direct). Billd doesn't sell tickets${Object.keys(CFG.affiliates || {}).length ? "; it may earn a commission when you buy through these links, at no extra cost to you" : " and isn't paid for links"}.</p>
      <h2>Reusing Billd's data</h2><p>Facts from Wikidata are CC0; play summaries drawn from Wikipedia stay under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener license">CC BY-SA 4.0</a>, credited on each play; Czech productions are CC BY 4.0 (Institut umění – Divadelní ústav). Pictures keep their own licences: see <a href="#/credits">image credits</a>. Reviews and lists belong to the members who wrote them. To report a copyright problem, see <a href="#/copyright">Copyright</a>.</p>
      <h2>Found a mistake?</h2><p>Use “Suggest a correction” on any show, or <button class="linkbtn" type="button" id="ab-fb">send feedback</button>.</p></div>`;
    $("#ab-fb").addEventListener("click", () => openFeedback(null));
  }

  // ---------------------------------------------------------------- auth dialog
  let authMode = "in";
  function openAuth(mode = "in", why) {
    if (S.kind === "local") { toast("Accounts arrive when Billd's server is connected. Your diary is saved on this device."); return; }
    setAuthMode(mode);
    $("#auth-terms").checked = false;
    note("#auth-note", why || "");
    $("#auth").showModal();
    (mode === "up" ? $("#auth-user") : $("#auth-email")).focus();
  }
  function setAuthMode(mode) {
    authMode = mode;
    $$("[data-auth]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.auth === mode)));
    $("#auth-title").textContent = mode === "up" ? "Join Billd" : mode === "reset" ? "Reset your password" : "Welcome back";
    $("#auth-user-f").hidden = mode !== "up";
    $("#auth-name-f").hidden = mode !== "up";
    $("#auth-pass-f").hidden = mode === "reset";
    $("#auth-pass").autocomplete = mode === "up" ? "new-password" : "current-password";
    $("#auth-go").textContent = mode === "up" ? "Create account" : mode === "reset" ? "Email me a reset link" : "Log in";
    $("#auth-forgot").hidden = mode !== "in";
    $("#auth-terms-f").hidden = !(mode === "up" && termsState().live);
    // Google on the website only for now: in the app, Apple requires Sign in with Apple alongside it
    $("#auth-alt").hidden = APP || mode === "reset";
    note("#auth-note", "");
  }
  $("#auth-google").addEventListener("click", async (e) => {
    const terms = termsState();
    if (authMode === "up" && terms.live && !$("#auth-terms").checked) return note("#auth-note", "Tick the box to agree to the Terms of Use and Community Guidelines.", true);
    e.currentTarget.disabled = true;
    try { await S.signInWithGoogle(); }  // leaves for Google's page
    catch (err) { note("#auth-note", err.message, true); e.currentTarget.disabled = false; }
  });
  // ---- a member who joined with Google chooses a username (asked again on each visit until they do)
  let askedName = false;
  function maybePickName() {
    if (askedName || !me || S.kind === "local" || !S.needsUsername?.() || $("#pickname").open) return;
    askedName = true;
    const guess = fold(me.display_name || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 20);
    $("#pn-user").value = guess.length >= 3 ? guess : "";
    $("#pn-name").value = me.display_name || "";
    $("#pn-show").textContent = $("#pn-user").value || "yourname";
    note("#pn-note", "");
    $("#pickname").showModal(); $("#pn-user").focus(); $("#pn-user").select();
  }
  $("#pn-user").addEventListener("input", (e) => { $("#pn-show").textContent = e.target.value.trim().toLowerCase() || "yourname"; });
  $("#pn-later").addEventListener("click", () => $("#pickname").close());
  $("#pn-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const user = $("#pn-user").value.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(user) || /^member_[0-9a-f]{8}$/.test(user)) return note("#pn-note", "Usernames are 3 to 20 lowercase letters, numbers or _.", true);
    $("#pn-go").disabled = true;
    try {
      if (!(await S.usernameFree(user))) return note("#pn-note", "That username is taken. Try another.", true);
      await S.updateProfile({ username: user, display_name: $("#pn-name").value.trim().slice(0, 50) || null });
      $("#pickname").close(); toast(`Welcome to Billd, ${$("#pn-name").value.trim() || cap(user)}`);
      if (location.hash.startsWith("#/u/")) location.hash = `#/u/${user}`;
    } catch (err) { note("#pn-note", /duplicate|unique|23505/i.test(err.message + (err.code || "")) ? "That username is taken. Try another." : err.message, true); }
    finally { $("#pn-go").disabled = false; }
  });
  $$("[data-auth]").forEach((b) => b.addEventListener("click", () => setAuthMode(b.dataset.auth)));
  $("#auth-forgot").addEventListener("click", () => setAuthMode("reset"));
  $("#auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#auth-email").value.trim(), pass = $("#auth-pass").value, user = $("#auth-user").value.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return note("#auth-note", "Enter your email address.", true);
    if (authMode !== "reset" && pass.length < 8) return note("#auth-note", "Passwords are at least 8 characters.", true);
    const terms = termsState();
    if (authMode === "up" && terms.live && !$("#auth-terms").checked) return note("#auth-note", "Tick the box to agree to the Terms of Use and Community Guidelines.", true);
    $("#auth-go").disabled = true;
    try {
      if (authMode === "up") {
        const r = await S.signUp(email, pass, user, $("#auth-name").value, terms.live ? terms.version : null);
        if (r.confirm) { note("#auth-note", "Almost there: open the link we emailed you to confirm your address, then log in.", false, true); return; }
        $("#auth").close(); toast(`Welcome to Billd, ${$("#auth-name").value.trim() || cap(user)}`);
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

  // ---------------------------------------------------------------- suggest a play
  function openSuggestPlay(title = "") {
    if (S.kind === "local") { toast("Suggesting plays needs Billd's server, which isn't connected on this copy."); return; }
    if (!requireMe("Log in to suggest a play.")) return;
    if ($("#logd").open) $("#logd").close();
    $("#sp-form").reset(); $("#sp-name").value = title; note("#sp-note", "");
    $("#suggplay").showModal(); (title ? $("#sp-by") : $("#sp-name")).focus();
  }
  document.addEventListener("click", (e) => {
    if (!e.target.closest("[data-suggest-play]")) return;
    openSuggestPlay(($("#logd").open ? $("#log-pick").value : $("#q").value).trim());
  });
  $("#sp-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const row = { title: $("#sp-name").value.trim(), playwright: $("#sp-by").value.trim(), year: $("#sp-year").value.trim(), url: $("#sp-url").value.trim(), notes: $("#sp-notes").value.trim() };
    if (!row.title) return note("#sp-note", "What's the play called?", true);
    try { await S.suggestPlay(row); $("#suggplay").close(); toast("Thanks! The team will look at it. You'll see its status in Settings"); }
    catch (err) { note("#sp-note", err.message, true); }
  });

  // ---------------------------------------------------------------- the Billd team
  // Roles: owner, admin, mod. The buttons shown here follow the same rules the database enforces
  // (supabase/schema.sql): a person acts only on people ranked below them, admins add and remove
  // mods, only the owner adds and removes admins, and no one can act on the owner.
  const RANK = { owner: 3, admin: 2, mod: 1 };
  const ROLE_NAME = { owner: "Owner", admin: "Admin", mod: "Moderator" };
  let team = {};  // user id -> role
  const myRank = () => (me && S.kind !== "local" ? RANK[S.role()] || 0 : 0);
  const rankOf = (uid) => RANK[team[uid]] || 0;
  const outranks = (uid) => !!me && uid !== me.id && myRank() > rankOf(uid);
  async function loadTeam() {
    try { const t = {}; (await S.team()).forEach((r) => (t[r.user_id] = r.role)); team = t; } catch (e) { /* no team yet */ }
  }
  const roleBadge = (uid) => (team[uid] ? `<span class="badge role">${ROLE_NAME[team[uid]]}</span>` : "");
  // under a post: Remove for the team (on posts by people ranked below them), Report for other members
  function modButton(kind, id, uid, cls = "") {
    if (!me || S.kind === "local" || uid === me.id) return "";
    return outranks(uid) ? `<button type="button" class="${cls}" data-mod-remove="${kind}:${id}">Remove</button>`
                         : `<button type="button" class="${cls}" data-report="${kind}:${id}:${esc(uid || "")}">Report</button>`;
  }
  // ---- the Terms of Use: on when the published site config (terms.live) or the database setting says so
  // (Admin -> Settings); the database setting is what stops members who haven't accepted from posting
  function termsState() {
    const c = CFG.terms || {}, d = dbSettings.terms || {};
    return { live: c.live === true || d.live === true, version: String((d.live === true ? d.version : c.version || d.version) || "") };
  }
  const needsTerms = () => { const t = termsState(); return !!(me && S.kind !== "local" && t.live && t.version && me.terms_version !== t.version); };
  function renderTermsBar() {
    const el = $("#terms-bar");
    if (!needsTerms()) { el.hidden = true; el.innerHTML = ""; return; }
    el.innerHTML = `<b>Please accept Billd's Terms of Use.</b> You can read everything, but you can't post, comment or follow until you do. <button class="linkbtn" type="button" data-terms-open>Read and accept</button>`;
    el.hidden = false;
    // asked once a visit; the bar stays until they accept
    let asked = false; try { asked = sessionStorage.getItem("billd-terms-asked") === termsState().version; sessionStorage.setItem("billd-terms-asked", termsState().version); } catch (e) { /* ask */ }
    if (!asked && !document.querySelector("dialog[open]")) openTerms();
  }
  function openTerms() { $("#terms-agree").checked = false; note("#terms-note", ""); $("#termsd").showModal(); }
  $("#terms-bar").addEventListener("click", (e) => { if (e.target.closest("[data-terms-open]")) openTerms(); });
  $("#terms-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!$("#terms-agree").checked) return note("#terms-note", "Tick the box to accept.", true);
    try { await S.acceptTerms(termsState().version); me = S.me(); $("#termsd").close(); renderTermsBar(); toast("Thank you. You're all set"); }
    catch (err) { note("#terms-note", err.message, true); }
  });
  function renderStanding() {
    const el = $("#standing");
    const st = me && S.kind !== "local" ? S.standing() : null;
    if (!st || st.status === "active") { el.hidden = true; el.innerHTML = ""; return; }
    el.innerHTML = st.status === "pending"
      ? `<b>Your account is waiting for approval.</b> Look around as much as you like; you can log, review and follow once the Billd team approves it.`
      : `<b>Your account is suspended.</b> ${st.note ? `${esc(st.note)} ` : ""}You can still read Billd, but not post.`;
    el.hidden = false;
  }

  // a confirmation with an optional or required note, for every team action
  function teamAction({ title, body = "", go, why = "Note", required = false, danger = false, run }) {
    const d = $("#modd");
    $("#modd-title").textContent = title;
    $("#modd-body").innerHTML = body;
    $("#modd-why-f").hidden = !why;
    $("#modd-why-l").innerHTML = why ? `${esc(why)}${required ? "" : ` <span class="opt">(optional)</span>`}` : "";
    $("#modd-why").value = "";
    note("#modd-note", "");
    const b = $("#modd-go");
    b.textContent = go; b.classList.toggle("danger", danger); b.disabled = false;
    $("#modd-form").onsubmit = async (e) => {
      e.preventDefault();
      const w = $("#modd-why").value.trim();
      if (required && !w) return note("#modd-note", "Add a note first.", true);
      b.disabled = true;
      try { await run(w); d.close(); } catch (err) { note("#modd-note", err.message, true); b.disabled = false; }
    };
    if (!d.open) d.showModal();
  }
  function removePost(kind, id, after) {
    const what = { review: "the review's text (the diary entry and rating stay)", comment: "the comment", list: "the whole list" }[kind];
    teamAction({ title: `Remove this ${kind}?`, body: `<p class="hint">This removes ${what}. It's recorded in the team log.</p>`,
      go: "Remove", danger: true, why: "Reason, for the team log",
      run: async (w) => { await S.removeContent(kind, id, w); toast("Removed"); after ? after() : route(); } });
  }

  const REPORT_REASONS = ["Spam or advertising", "Harassment or hate", "Spoilers without a warning", "Offensive or explicit", "Copyright infringement", "Something else"];
  const KIND_NAME = { review: "review", comment: "comment", list: "list", profile: "member" };
  function openReport(kind, id, uid) {
    if (!requireMe("Log in to report something.")) return;
    const canBlock = !!uid && uid !== me.id && !blockedSet.has(uid);
    $("#rep-block-f").hidden = !canBlock; $("#rep-block").checked = false;
    $("#rep-title").textContent = `Report this ${KIND_NAME[kind]}`;
    $("#rep-what").textContent = "Reports go to the Billd team. Only the team sees them.";
    $("#rep-reasons").innerHTML = REPORT_REASONS.map((r) => `<label><input type="radio" name="rep-r" value="${esc(r)}"> ${esc(r)}</label>`).join("");
    $("#rep-more").value = "";
    note("#rep-note", "");
    $("#rep-form").onsubmit = async (e) => {
      e.preventDefault();
      const r = $("input[name=rep-r]:checked")?.value;
      if (!r) return note("#rep-note", "Choose what's wrong.", true);
      const more = $("#rep-more").value.trim();
      try {
        await S.report(kind, id, more ? `${r}: ${more}` : r);
        const alsoBlock = canBlock && $("#rep-block").checked;
        if (alsoBlock) { await S.block(uid, true); blockedSet.add(uid); followingSet = null; }
        $("#reportd").close(); toast(alsoBlock ? "Reported and blocked. Thank you" : "Reported. Thank you");
        if (alsoBlock) route();
      } catch (err) { note("#rep-note", err.message, true); }
    };
    $("#reportd").showModal();
  }

  // ---- blocking: confirmed, since it also ends following both ways
  async function loadBlocks() {
    try { blockedSet = new Set(me && S.kind !== "local" ? (await S.blocks()).map((r) => r.blocked) : []); } catch (e) { blockedSet = new Set(); }
  }
  function toggleBlock(uid, name) {
    if (!requireMe("Log in to block members.")) return;
    if (blockedSet.has(uid)) {
      return S.block(uid, false).then(() => { blockedSet.delete(uid); toast(`Unblocked ${name}`); route(); }, (e) => toast(e.message));
    }
    teamAction({ title: `Block ${name}?`, go: "Block", danger: true, why: "",
      body: `<ul class="del-steps"><li>You won't see their diary, reviews, comments or lists anywhere on Billd.</li>
        <li>They can't follow you, or like or comment on your reviews and lists.</li>
        <li>You stop following each other.</li><li>They aren't notified, though they may notice they can no longer follow you or comment. You can unblock them from their profile or in Settings.</li></ul>
        <p class="hint" style="margin-top:10px">If they're breaking the <a href="#/guidelines" target="_blank" rel="noopener">Community Guidelines</a>, report them too, so the Billd team can act.</p>`,
      run: async () => { await S.block(uid, true); blockedSet.add(uid); followingSet = null; toast(`Blocked ${name}`); route(); } });
  }

  const STANDING_NAME = { active: "Active", pending: "Waiting for approval", suspended: "Suspended" };
  // a member's standing and role, from their profile or the admin page
  async function manageMember(p, after = route) {
    const st = (await S.standingsFor([p.id]))[p.id] || { status: "active", note: null };
    const role = team[p.id] || "", mr = myRank();
    const roles = mr >= 2 && outranks(p.id) ? [["", "Member"], ["mod", "Moderator"]].concat(mr >= 3 ? [["admin", "Admin"]] : []) : [];
    $("#edit-title").textContent = `Manage ${p.display_name || p.username}`;
    $("#edit-form").innerHTML = `
      <p style="margin:0">@${esc(p.username)} ${roleBadge(p.id)} · <b>${STANDING_NAME[st.status]}</b>${st.note ? ` <small class="hint">${esc(st.note)}</small>` : ""}</p>
      <div class="mod-acts">
        ${st.status === "pending" ? `<button class="btn sm" type="button" data-mm="approve">Approve</button>` : ""}
        ${st.status === "suspended" ? `<button class="btn sm" type="button" data-mm="reinstate">Reinstate</button>` : `<button class="btn ghost sm danger" type="button" data-mm="suspend">Suspend</button>`}
        <button class="btn ghost sm" type="button" data-mm="clear">Clear name and bio</button>
      </div>
      ${roles.length ? `<div class="field"><label for="mm-role">Role on the Billd team</label>
        <div style="display:flex;gap:8px"><select id="mm-role">${roles.map(([k, n]) => `<option value="${k}"${k === role ? " selected" : ""}>${n}</option>`).join("")}</select>
        <button class="btn ghost sm" type="button" data-mm="role">Save role</button></div>
        <p class="hint" style="margin:6px 0 0">${mr >= 3 ? "Admins can approve, moderate and add moderators. Only you can add or remove admins." : "Admins add and remove moderators; only the owner adds admins."}</p></div>` : ""}
      <p class="note err" id="mm-note" hidden></p>`;
    const done = (msg) => { $("#editd").close(); toast(msg); after(); };
    $("#edit-form").onsubmit = (e) => e.preventDefault();
    $("#edit-form").onclick = async (e) => {
      const b = e.target.closest("[data-mm]"); if (!b) return;
      const k = b.dataset.mm;
      try {
        if (k === "approve") { await S.setStanding(p.id, "active", null); return done("Approved"); }
        if (k === "reinstate") { await S.setStanding(p.id, "active", null); return done("Reinstated"); }
        if (k === "role") { await S.setStaffRole(p.id, $("#mm-role").value); await loadTeam(); return done("Role saved"); }
        $("#editd").close();
        if (k === "suspend") teamAction({ title: `Suspend ${p.display_name || p.username}?`, go: "Suspend", danger: true, required: true,
          body: `<p class="hint">They'll be able to read Billd but not post, comment, rate or follow. Their posts stay up; remove any that break the rules separately.</p>`,
          why: "Reason (they'll see this)", run: async (w) => { await S.setStanding(p.id, "suspended", w); toast("Suspended"); after(); } });
        if (k === "clear") teamAction({ title: "Clear their display name and bio?", go: "Clear", danger: true, why: "Reason, for the team log",
          body: `<p class="hint">Their username stays. It's recorded in the team log.</p>`, run: async (w) => { await S.clearProfile(p.id, w); toast("Cleared"); after(); } });
      } catch (err) { note("#mm-note", err.message, true); }
    };
    $("#editd").showModal();
  }

  // ---- the admin page: #/admin, #/admin/members, /team, /log, /settings
  async function reportTarget(r) {
    if (r.kind === "review") { const l = await S.getLog(r.target_id); return l && { who: l.profile, uid: l.user_id, title: l.play_title, text: l.review, link: `#/review/${l.id}` }; }
    if (r.kind === "comment") { const c = await S.getComment(r.target_id); return c && { who: c.profile, uid: c.user_id, text: c.body, link: `#/review/${c.log_id}` }; }
    if (r.kind === "list") { const l = await S.getList(r.target_id); return l && { who: l.profile, uid: l.user_id, title: l.title, text: l.description, link: `#/list/${l.id}` }; }
    const p = await S.profileById(r.target_id);
    return p && { who: p, uid: p.id, title: p.display_name, text: p.bio, link: `#/u/${encodeURIComponent(p.username)}` };
  }
  const nameLink = (p) => (p ? `<a href="#/u/${esc(p.username)}">${who(p)}</a>` : "a former member");
  function admSection(title, n, items, empty) {
    return `<section class="sec"><div class="sec-head"><h2>${esc(title)}${n ? ` <span class="badge now">${n}</span>` : ""}</h2></div>
      ${items.length ? `<ul class="adm-list">${items.join("")}</ul>` : `<p class="hint">${esc(empty)}</p>`}</section>`;
  }
  function admMember(p, st) {
    return `<li class="adm-item adm-row">${avatar(p, "sm")}<div class="adm-who">${nameLink(p)} <small>@${esc(p.username)}</small> ${roleBadge(p.id)}
        ${st && st.status !== "active" ? `<span class="badge">${STANDING_NAME[st.status]}</span>` : ""}${p.created_at ? `<small class="hint"> · joined ${ago(p.created_at)}</small>` : ""}
        ${st?.note && st.status === "suspended" ? `<div class="hint">${esc(st.note)}</div>` : ""}</div>
      <div class="adm-acts">${st?.status === "pending" && outranks(p.id) ? `<button class="btn sm" type="button" data-adm="approve" data-uid="${p.id}">Approve</button>` : ""}
        ${outranks(p.id) ? `<button class="btn ghost sm" type="button" data-adm="member" data-uid="${p.id}">Manage</button>` : ""}</div></li>`;
  }
  function logLine(x) {
    const a = x.actor_p ? who(x.actor_p) : "A former team member", t = nameLink(x.target_p), d = x.detail || {};
    const noteTxt = d.note ? ` <small class="hint">“${esc(d.note)}”</small>` : "";
    let s;
    if (x.action === "role") s = `${a} changed ${t}'s role from ${esc(d.from)} to ${esc(d.to)}`;
    else if (x.action === "status") s = `${a} ${d.to === "suspended" ? "suspended" : d.to === "pending" ? "set back to waiting for approval:" : d.from === "pending" ? "approved" : "reinstated"} ${t}`;
    else if (x.action.startsWith("remove ")) s = `${a} removed ${t}'s ${esc(x.action.slice(7))}${d.text || d.title ? ` <small class="hint">${esc(String(d.title || d.text).slice(0, 120))}</small>` : ""}`;
    else if (x.action === "clear profile") s = `${a} cleared ${t}'s name and bio`;
    else if (x.action.startsWith("report ")) s = `${a} marked report #${esc(d.id)} ${esc(x.action.slice(7))}`;
    else if (x.action.startsWith("feedback ")) s = `${a} marked feedback #${esc(d.id)} ${esc(x.action.slice(9))}`;
    else if (x.action.startsWith("play ")) s = `${a} ${esc(x.action.slice(5))} ${t}'s suggested play #${esc(d.id)}`;
    else if (x.action.startsWith("suggestion ")) s = `${a} ${esc(x.action.slice(11))} ${t}'s production suggestion #${esc(d.id)}`;
    else if (x.action.startsWith("import ")) s = `${a} ${x.action === "import pending" ? "sent back to waiting" : esc(x.action.slice(7))} the imported show ${d.title ? `<b>${esc(d.title)}</b>` : `#${esc(d.id)}`}${d.writer ? ` (by ${esc(d.writer)})` : ""}`;
    else if (x.action === "setting" && d.terms) s = `${a} ${d.terms.live ? "switched on" : "switched off"} the Terms of Use (version ${esc(d.terms.version)})`;
    else if (x.action === "setting") s = `${a} ${d.require_approval ? "turned on" : "turned off"} approval for new members`;
    else if (x.action === "account deleted") s = `${d.team ? "A member of the Billd team" : "A member"} deleted their account`;
    else if (x.action === "word block") s = `${a} added “${esc(d.term)}” to the word filter`;
    else if (x.action === "word allow") s = `${a} allowed “${esc(d.term)}” as an exception to the word filter`;
    else if (x.action === "word removed") s = `${a} removed “${esc(d.term)}” from the word filter`;
    else if (x.action === "held approve" || x.action === "held remove") s = `${a} ${x.action === "held approve" ? "approved" : "removed"} ${t}'s held ${esc((HELD_KIND[d.kind] || "post").toLowerCase())}${d.text || d.title ? ` <small class="hint">${esc(String(d.title || d.text).slice(0, 120))}</small>` : ""}`;
    else s = `${a}: ${esc(x.action)}`;
    return `<li class="adm-log">${s}${noteTxt} <time class="hint" datetime="${esc(x.created_at)}">${ago(x.created_at)}</time></li>`;
  }
  const admSugg = { status: "pending" };
  // posts held because they contain a word on the filter list (Queue tab)
  const HELD_KIND = { log: "Diary entry", comment: "Comment", list: "List", list_item: "List note" };
  const HELD_FIELD = { review: "the review", venue: "the theatre", city: "the town", play_title: "the title", body: "the comment", title: "the title", description: "the description", note: "the note" };
  function heldItem(x) {
    const where = String(x.reason || "").replace(/^listed word in /, "").split(/,\s*/).filter(Boolean).map((f) => HELD_FIELD[f] || f);
    const mine = x.uid === me.id;
    return `<li class="adm-item"><div class="adm-meta"><span class="badge">${HELD_KIND[x.kind] || esc(x.kind)}</span> by ${nameLink(x.who)} ${roleBadge(x.uid)} · held ${ago(x.at)}${x.vis === "friends" ? ` <span class="vis" title="${VIS_TITLE.friends}">Friends</span>` : ""}</div>
      <blockquote class="adm-quote held-text">${x.title ? `<b>${esc(x.title)}</b>${x.kind === "list_item" && byId[x.play_id] ? ` · ${esc(byId[x.play_id].title)}` : ""}<br>` : ""}${x.text ? esc(String(x.text).slice(0, 1500)) : "<i>Nothing written.</i>"}</blockquote>
      <div class="hint">${where.length ? `A listed word in ${esc(where.join(" and "))}` : "A listed word"} · <a href="${x.link}">Open</a></div>
      <div class="adm-acts">${outranks(x.uid) ? `<button class="btn sm" type="button" data-adm="held-approve" data-kind="${x.kind}" data-id="${esc(x.id)}">Approve</button>` : mine ? `<span class="hint">Your own post: someone else on the team approves it.</span>` : ""}
        ${outranks(x.uid) || mine ? `<button class="btn ghost sm danger" type="button" data-adm="held-remove" data-kind="${x.kind}" data-id="${esc(x.id)}">Remove</button>` : ""}</div></li>`;
  }
  const FB_KIND = { feedback: "Feedback", correction: "Correction", copyright: "Copyright report" };
  function feedbackItem(x) {
    return `<li class="adm-item"><div class="adm-meta"><span class="badge">${FB_KIND[x.kind] || esc(x.kind)}</span>${x.play_id ? ` <a href="${playUrl(x.play_id)}"><b>${esc(x.play_title || x.play_id)}</b></a>` : ""}
        · ${x.profile ? nameLink(x.profile) : esc(x.name || "someone without an account")} · ${ago(x.created_at)}${x.status !== "open" ? ` <span class="badge">${esc(x.status)}</span>` : ""}</div>
      <p class="adm-quote">${esc(x.body)}</p>${x.rating ? `<div class="hint">Rated Billd ${x.rating}/5</div>` : ""}
      <div class="adm-acts">${x.status === "open" ? `<button class="btn sm" type="button" data-adm="fb-done" data-id="${x.id}">Done</button><button class="btn ghost sm" type="button" data-adm="fb-dismiss" data-id="${x.id}">Dismiss</button>`
        : `<button class="btn ghost sm" type="button" data-adm="fb-open" data-id="${x.id}">Reopen</button>`}</div></li>`;
  }
  async function renderAdmin(tab = "") {
    const tok = routeSeq;
    if (!me || !myRank()) return renderNotFound();
    document.title = "Admin · Billd";
    const tabs = [["", "Queue"], ["suggestions", "Suggestions"], ["imports", "New shows"], ["members", "Members"], ["team", "Team"], ["log", "Log"], ["settings", "Settings"]];
    pageEl().innerHTML = `<div class="wrap admin" style="padding-top:30px;max-width:900px"><p class="kicker">Billd team · ${ROLE_NAME[S.role()]}</p><h1 class="h1">Admin</h1>
      <nav class="tabs" aria-label="Admin">${tabs.map(([k, n]) => `<a href="#/admin${k ? "/" + k : ""}"${k === tab ? ' aria-current="page"' : ""}>${n}</a>`).join("")}</nav>
      <div id="adm"><p class="hint">Loading…</p></div></div>`;
    const el = $("#adm");
    const people = {};  // user id -> profile, for Manage
    const again = () => { if (!stale(tok)) renderAdmin(tab); };
    await loadTeam();
    if (stale(tok)) return;
    if (!tab) {
      const [pending, reports, suggs, approved, plays, notes, held] = await Promise.all([S.standings("pending"), S.reports("open"), S.suggestionsFor("pending"), S.suggestionsFor("approved"),
        S.playSuggestionsFor("pending").catch(() => []), S.feedbackFor("open").catch(() => []), S.heldPosts().catch(() => [])]);
      const targets = await Promise.all(reports.map((r) => reportTarget(r).catch(() => null)));
      if (stale(tok)) return;
      pending.forEach((x) => x.profile && (people[x.user_id] = x.profile));
      held.forEach((x) => x.who && (people[x.uid] = x.who));
      const rep = reports.map((r, i) => {
        const t = targets[i];
        if (t?.who) people[t.uid] = t.who;
        return `<li class="adm-item"><div class="adm-meta"><span class="badge">${KIND_NAME[r.kind]}</span> reported by ${nameLink(r.reporter_p)} · ${ago(r.created_at)}</div>
          <p class="adm-reason">${esc(r.reason)}</p>
          ${t ? `<blockquote class="adm-quote">${t.title ? `<b>${esc(t.title)}</b> ` : ""}${t.text ? esc(String(t.text).slice(0, 600)) : `<i>${r.kind === "review" ? "The review's text has been removed." : "Nothing written."}</i>`}</blockquote>
            <div class="hint">by ${nameLink(t.who)} ${roleBadge(t.uid)} · <a href="${t.link}">Open</a></div>` : `<p class="hint">It's already gone.</p>`}
          <div class="adm-acts">
            ${t && r.kind !== "profile" && (t.text || r.kind !== "review") && (outranks(t.uid) || t.uid === me.id) ? `<button class="btn sm danger" type="button" data-adm="remove" data-kind="${r.kind}" data-id="${esc(r.target_id)}" data-rep="${r.id}">Remove ${KIND_NAME[r.kind]}</button>` : ""}
            ${t && outranks(t.uid) ? `<button class="btn ghost sm" type="button" data-adm="member" data-uid="${t.uid}">Manage member</button>` : ""}
            <button class="btn ghost sm" type="button" data-adm="resolve" data-rep="${r.id}">Done</button>
            <button class="btn ghost sm" type="button" data-adm="dismiss" data-rep="${r.id}">Dismiss</button></div></li>`;
      });
      const field = (k, v) => (v ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : "");
      const sug = suggs.map((x) => `<li class="adm-item"><div class="adm-meta"><a href="${playUrl(x.play_id)}"><b>${esc(x.play_title)}</b></a> · from ${nameLink(x.profile)} · ${ago(x.created_at)}</div>
          <dl class="adm-dl">${field("Theatre", x.venue)}${field("City", x.city)}${field("Dates", [x.date_from, x.date_to].filter(Boolean).map(fmtPartial).join(" to "))}
            ${field("Director", x.directors)}${field("Cast", x.cast_list)}${field("Adapter", x.adapters)}${field("Language", x.language)}${field("Notes", x.notes)}
            ${x.url ? `<dt>Link</dt><dd><a href="${esc(/^https?:\/\//i.test(x.url) ? x.url : "https://" + x.url)}" target="_blank" rel="noopener nofollow">${esc(x.url)}</a></dd>` : ""}</dl>
          <div class="adm-acts"><button class="btn sm" type="button" data-adm="approve-s" data-id="${x.id}">Approve</button><button class="btn ghost sm" type="button" data-adm="decline-s" data-id="${x.id}">Decline</button></div></li>`);
      el.innerHTML = admSection("Members waiting for approval", pending.length, pending.filter((x) => x.profile).map((x) => admMember(x.profile, x)), "No one is waiting.")
        + admSection("Held posts", held.length, held.map(heldItem), "No posts are waiting for a check.")
        + (held.length ? `<p class="hint" style="max-width:62ch;margin-top:-6px">These contain a word on the word filter's list, so only their authors and the team can see them. Approve one and it goes live; remove one and its words go (a diary entry keeps its date and rating).</p>` : "")
        + admSection("Reports", reports.length, rep, "No open reports.")
        + admSection("Feedback and corrections", notes.length, notes.map(feedbackItem), "Nothing new.")
        + admSection("Suggested plays", plays.length, plays.map((x) => `<li class="adm-item"><div class="adm-meta"><b>${esc(x.title)}</b> · from ${nameLink(x.profile)} · ${ago(x.created_at)}</div>
            <dl class="adm-dl">${field("Playwright", x.playwright)}${field("Year", x.year)}${field("Notes", x.notes)}
              ${x.url ? `<dt>Link</dt><dd><a href="${esc(/^https?:\/\//i.test(x.url) ? x.url : "https://" + x.url)}" target="_blank" rel="noopener nofollow">${esc(x.url)}</a></dd>` : ""}</dl>
            <div class="adm-acts"><button class="btn sm" type="button" data-adm="approve-p" data-id="${x.id}">Approve</button><button class="btn ghost sm" type="button" data-adm="decline-p" data-id="${x.id}">Decline</button></div></li>`), "No plays waiting.")
        + admSection("Suggested productions", suggs.length, sug, "No suggestions waiting.")
        + (approved.length ? `<p class="hint">${plural(approved.length, "approved production")} will be added to the plays' histories at the next data update.</p>` : "");
    } else if (tab === "suggestions") {
      // every suggestion and message, whatever its status
      const status = admSugg.status;
      const map = { pending: ["pending", "open"], approved: ["approved", null], added: ["added", "done"], declined: ["declined", "dismissed"], all: ["all", "all"] };
      const [ss, fs] = map[status];
      const [prods, plays, notes] = await Promise.all([S.suggestionsFor(ss), S.playSuggestionsFor(ss).catch(() => []), fs ? S.feedbackFor(fs).catch(() => []) : []]);
      if (stale(tok)) return;
      const badge = (st) => `<span class="badge${st === "added" || st === "done" ? " now" : ""}">${esc(st)}</span>`;
      const field = (k, v) => (v ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : "");
      const link = (u) => (u ? `<dt>Link</dt><dd><a href="${esc(/^https?:\/\//i.test(u) ? u : "https://" + u)}" target="_blank" rel="noopener nofollow">${esc(u)}</a></dd>` : "");
      const acts = (k, x) => x.status === "pending" ? `<div class="adm-acts"><button class="btn sm" type="button" data-adm="approve-${k}" data-id="${x.id}">Approve</button><button class="btn ghost sm" type="button" data-adm="decline-${k}" data-id="${x.id}">Decline</button></div>`
        : x.status === "added" ? "" : `<div class="adm-acts"><button class="btn ghost sm" type="button" data-adm="reopen-${k}" data-id="${x.id}">Back to waiting</button></div>`;
      el.innerHTML = `<div class="seg" role="radiogroup" aria-label="Status" style="margin-bottom:6px">${["pending", "approved", "added", "declined", "all"].map((k) =>
          `<button type="button" role="radio" data-sugg-status="${k}" aria-checked="${k === status}" aria-selected="${k === status}">${{ pending: "Waiting", approved: "Approved", added: "Added", declined: "Declined", all: "All" }[k]}</button>`).join("")}</div>
        ${admSection("Plays", plays.length, plays.map((x) => `<li class="adm-item"><div class="adm-meta"><b>${esc(x.title)}</b> ${badge(x.status)} · from ${nameLink(x.profile)} · ${ago(x.created_at)}</div>
            <dl class="adm-dl">${field("Playwright", x.playwright)}${field("Year", x.year)}${field("Notes", x.notes)}${link(x.url)}${field("Team note", x.review_note)}</dl>${acts("p", x)}</li>`), "None.")}
        ${admSection("Productions", prods.length, prods.map((x) => `<li class="adm-item"><div class="adm-meta"><a href="${playUrl(x.play_id)}"><b>${esc(x.play_title)}</b></a> ${badge(x.status)} · from ${nameLink(x.profile)} · ${ago(x.created_at)}</div>
            <dl class="adm-dl">${field("Theatre", x.venue)}${field("City", x.city)}${field("Dates", [x.date_from, x.date_to].filter(Boolean).map(fmtPartial).join(" to "))}${field("Director", x.directors)}${field("Cast", x.cast_list)}${link(x.url)}${field("Team note", x.review_note)}</dl>${acts("s", x)}</li>`), "None.")}
        ${fs ? admSection("Feedback and corrections", notes.length, notes.map(feedbackItem), "None.") : ""}`;
      el.querySelectorAll("[data-sugg-status]").forEach((b) => b.addEventListener("click", () => { admSugg.status = b.dataset.suggStatus; again(); }));
    } else if (tab === "imports") {
      // shows the box-office importers found that Billd can't match to a play it knows (scripts/import_review.py)
      let waiting, decided;
      try { [waiting, decided] = await Promise.all([S.importReviewFor("pending"), S.importReviewFor("decided")]); }
      catch (err) {
        if (stale(tok)) return;
        el.innerHTML = `<p class="hint">${err.code === "no_server" ? "The queue of imported shows needs Billd's server." : `The queue couldn't be loaded: ${esc(err.message)}`}</p>`;
        return;
      }
      if (stale(tok)) return;
      const field = (k, v) => (v ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : "");
      const dates = (x) => [x.date_from, x.date_to].filter(Boolean).map(fmtPartial).join(" to ");
      const link = (u) => (safeUrl(u) ? `<dt>Source</dt><dd><a href="${esc(safeUrl(u))}" target="_blank" rel="noopener nofollow">${esc(safeUrl(u).replace(/^https?:\/\/(www\.)?/i, "").slice(0, 80))}</a></dd>` : "");
      const where = (x) => [x.theatre, x.city].filter(Boolean).map(esc).join(", ");
      const item = (x, acts) => `<li class="adm-item"><div class="adm-meta"><b>${esc(x.title)}</b>${where(x) ? ` · ${where(x)}` : ""}${x.status !== "pending" ? ` <span class="badge${x.status === "approved" ? " now" : ""}">${esc(x.status)}</span>` : ""}</div>
          <dl class="adm-dl">${x.venue && x.venue !== x.theatre ? field("Venue", x.venue) : ""}${field("Dates", dates(x))}${link(x.source_url)}${field("Found by", x.origin)}
            ${x.status === "pending" ? field("First seen", fmtPartial(x.first_seen || "")) : ""}${x.status === "approved" ? field("Writer", x.playwright || "not known yet") : ""}${x.status === "pending" && x.notes ? field("Note", x.notes) : ""}
            ${x.status !== "pending" ? `${field("Note", x.notes)}<dt>Decided</dt><dd>${x.decider ? nameLink(x.decider) + " · " : ""}${x.decided_at ? ago(x.decided_at) : ""}</dd>` : ""}</dl>${acts}</li>`;
      el.innerHTML = `<p class="hint" style="max-width:62ch;margin-bottom:6px">Box-office calendars mix plays with stand-up, concerts and classes. Shows that match a play Billd knows are listed automatically;
          these didn't match, so they wait here. Approve a play (add its writer if the page names one) and it's listed after the next data update; reject anything that isn't a play and it's never listed.</p>
        ${admSection("Waiting for review", waiting.length, waiting.map((x) => item(x, `<div class="adm-acts"><button class="btn sm" type="button" data-adm="approve-i" data-id="${x.id}">Approve</button><button class="btn ghost sm" type="button" data-adm="reject-i" data-id="${x.id}">Reject</button></div>`)), "Nothing waiting.")}
        ${admSection("Recently decided", 0, decided.map((x) => item(x, `<div class="adm-acts"><button class="btn ghost sm" type="button" data-adm="reopen-i" data-id="${x.id}">Back to waiting</button></div>`)), "Nothing decided yet.")}`;
    } else if (tab === "members") {
      el.innerHTML = `<form id="adm-find" class="inline-new" role="search"><label class="vh" for="adm-q">Find a member</label><input id="adm-q" type="search" placeholder="Find a member by name or username" autocomplete="off"><button class="btn" type="submit">Find</button></form>
        <ul class="adm-list" id="adm-res"></ul><div id="adm-susp"></div>`;
      const find = async (q) => {
        const ms = await S.members(q);
        const st = await S.standingsFor(ms.map((m) => m.id));
        if (stale(tok)) return;
        ms.forEach((m) => (people[m.id] = m));
        $("#adm-res").innerHTML = ms.length ? ms.map((m) => admMember(m, st[m.id])).join("") : `<li class="hint">No members found.</li>`;
      };
      $("#adm-find").addEventListener("submit", (e) => { e.preventDefault(); find($("#adm-q").value.trim()); });
      const susp = await S.standings("suspended");
      if (stale(tok)) return;
      susp.forEach((x) => x.profile && (people[x.user_id] = x.profile));
      $("#adm-susp").innerHTML = admSection("Suspended", 0, susp.filter((x) => x.profile).map((x) => admMember(x.profile, x)), "No one is suspended.");
      find("");
    } else if (tab === "team") {
      const rows = await S.team();
      if (stale(tok)) return;
      rows.forEach((r) => r.profile && (people[r.user_id] = r.profile));
      const order = rows.slice().sort((a, b) => RANK[b.role] - RANK[a.role]);
      const mr = myRank();
      el.innerHTML = `<p class="hint" style="max-width:62ch;margin-bottom:16px">Moderators approve members and suggested productions, handle reports, remove posts and suspend members.
          Admins can also add and remove moderators and change site settings. Only the owner adds and removes admins, and no one can change the owner.</p>
        <ul class="adm-list">${order.map((r) => `<li class="adm-item adm-row">${avatar(r.profile, "sm")}<div class="adm-who">${nameLink(r.profile)} <span class="badge role">${ROLE_NAME[r.role]}</span>
            <small class="hint">${r.role === "owner" ? "" : `added ${ago(r.added_at)}${r.adder ? ` by @${esc(r.adder.username)}` : ""}`}</small></div>
            <div class="adm-acts">${outranks(r.user_id) && mr >= 2 ? `<button class="btn ghost sm" type="button" data-adm="member" data-uid="${r.user_id}">Change</button>` : ""}</div></li>`).join("")}</ul>
        ${mr >= 2 ? `<section class="sec"><div class="sec-head"><h2>Add to the team</h2></div>
          <form id="adm-add" class="inline-new"><label class="vh" for="adm-user">Username</label><input id="adm-user" placeholder="Their username" autocapitalize="none" spellcheck="false" required>
            <label class="vh" for="adm-role">Role</label><select id="adm-role"><option value="mod">Moderator</option>${mr >= 3 ? `<option value="admin">Admin</option>` : ""}</select>
            <button class="btn" type="submit">Add</button></form><p class="note err" id="adm-add-note" hidden></p></section>` : ""}`;
      $("#adm-add")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const u = $("#adm-user").value.trim().replace(/^@/, "").toLowerCase();
        try {
          const p = await S.getProfile(u);
          if (!p) return note("#adm-add-note", `No member is called @${u}.`, true);
          await S.setStaffRole(p.id, $("#adm-role").value);
          toast(`@${p.username} is now ${$("#adm-role").value === "admin" ? "an admin" : "a moderator"}`);
          again();
        } catch (err) { note("#adm-add-note", err.message, true); }
      });
    } else if (tab === "log") {
      const rows = await S.modLog(150);
      if (stale(tok)) return;
      el.innerHTML = rows.length ? `<ul class="adm-list">${rows.map(logLine).join("")}</ul>` : `<p class="hint">Nothing yet.</p>`;
    } else if (tab === "settings") {
      const cfg = await S.settings();
      if (stale(tok)) return;
      el.innerHTML = `<section class="sec"><div class="sec-head"><h2>New members</h2></div>
        <label class="check"><input type="checkbox" id="adm-appr"${cfg.require_approval ? " checked" : ""}${myRank() >= 2 ? "" : " disabled"}> New members need approval before they can post</label>
        <p class="hint" style="max-width:62ch;margin-top:8px">When this is on, new accounts can look around but can't log, review, comment or follow until a moderator approves them in the Queue. It doesn't affect members who joined earlier.${myRank() >= 2 ? "" : " Only admins can change this."}</p></section>
        ${myRank() >= 2 ? `<section class="sec"><div class="sec-head"><h2>Listings refresh</h2></div>
        <p class="hint" style="max-width:62ch">The data was last updated ${esc(fmtPartial((D.meta.generated || "").slice(0, 10)))}. Two scheduled Claude routines keep it current:
          <b>Billd weekly refresh</b> (Mondays: Ticketmaster and re-checking every listing and cast list) and
          <b>Billd monthly refresh</b> (the 1st: research for newly announced shows and casts). Open them in Claude Code to run one now, change its schedule or pause it.</p>
        <p style="margin-top:10px"><a class="btn sm" href="https://claude.ai/code" target="_blank" rel="noopener">Open routines in Claude Code</a></p></section>` : ""}
        <section class="sec"><div class="sec-head"><h2>Terms of Use</h2></div>
          <label class="check"><input type="checkbox" id="adm-terms"${cfg.terms?.live ? " checked" : ""}${myRank() >= 2 ? "" : " disabled"}> Members must accept the Terms to post</label>
          <div class="inline-new" style="margin-top:10px;max-width:420px"><label class="vh" for="adm-terms-v">Version</label><input id="adm-terms-v" value="${esc(cfg.terms?.version || "")}" placeholder="Version, e.g. 2026-11-01"${myRank() >= 2 ? "" : " disabled"}></div>
          <p class="hint" style="max-width:62ch;margin-top:8px">When this is on, new members tick a box to accept the <a href="#/terms">Terms</a> and <a href="#/guidelines">Community Guidelines</a> when they join, and existing members are asked once; until they accept they can read but not post.
            Change the version when the Terms change, and everyone is asked again. Turn it on only once the Terms are final, together with <code>terms.live</code> in the published site settings (the site config ${CFG.terms?.live ? "has it on" : "has it off"}).${myRank() >= 2 ? "" : " Only admins can change this."}</p></section>
        <section class="sec" id="adm-words"><div class="sec-head"><h2>Word filter</h2></div>
          <p class="hint" style="max-width:62ch">A review or diary entry (with its theatre, town and title), comment, list title or description, or list note that contains one of these words is saved but <b>held</b>: only its author and the team see it, with a note that it's waiting for a check, until a moderator approves or removes it in the <a href="#/admin">Queue</a>. An approved post that's edited to add a listed word is held again. Usernames, display names and bios can't be held (everyone sees them), so those are refused with a message asking for other words.
            Words match whole, ignoring capitals, accents, spacing (s p a c e d) and numbers for letters (n0t). Keep it to unambiguous slurs: ordinary words found in play titles (kill, hell, bastard) would hold every post about those plays. Play titles on Billd show listed words masked (“N****r”), from <code>data/masked_words.txt</code> at the next data update; keep that file in step with this list. <b>Allowed</b> phrases are exceptions that are never held. Existing posts aren't changed.</p>
          <div id="adm-words-body"><p class="hint">${myRank() >= 2 ? "Loading…" : "Only admins can see and change the list."}</p></div></section>`;
      $("#adm-appr").addEventListener("change", async (e) => {
        try { await S.setSetting("require_approval", e.target.checked); toast(e.target.checked ? "New members now need approval" : "New members can post straight away"); }
        catch (err) { e.target.checked = !e.target.checked; toast(err.message); }
      });
      const saveTerms = async () => {
        const live = $("#adm-terms").checked, version = $("#adm-terms-v").value.trim();
        if (!/^[A-Za-z0-9._-]{1,40}$/.test(version)) { toast("Give the Terms a version: letters, numbers, dots or dashes"); $("#adm-terms").checked = !!cfg.terms?.live; return; }
        try {
          await S.setSetting("terms", { version, live });
          if (live) await S.acceptTerms(version).catch(() => {});  // the admin who switches them on accepts them too
          cfg.terms = dbSettings.terms = { version, live };
          S.setTermsVersion(live ? version : null); me = S.me(); renderTermsBar();
          toast(live ? "Members must now accept the Terms to post" : "The Terms are switched off");
        } catch (err) { $("#adm-terms").checked = !!cfg.terms?.live; toast(err.message); }
      };
      $("#adm-terms").addEventListener("change", saveTerms);
      $("#adm-terms-v").addEventListener("change", () => { if (cfg.terms?.live) saveTerms(); });
      if (myRank() >= 2) {
        const words = async () => {
          let rows;
          try { rows = await S.moderationTerms(); } catch (err) { if (!stale(tok)) $("#adm-words-body").innerHTML = `<p class="hint">${esc(err.message)}</p>`; return; }
          if (stale(tok)) return;
          const chips = (sev) => rows.filter((r) => r.severity === sev).map((r) => `<li class="${sev}">${esc(r.term)}<button type="button" data-word-rm="${esc(r.term)}" aria-label="Remove ${esc(r.term)}">×</button></li>`).join("");
          $("#adm-words-body").innerHTML = `<h3 class="label" style="margin:14px 0 8px">Not allowed (${rows.filter((r) => r.severity === "block").length})</h3><ul class="term-list">${chips("block") || `<li>None</li>`}</ul>
            <h3 class="label" style="margin:14px 0 8px">Allowed exceptions</h3><ul class="term-list">${chips("allow") || `<li>None</li>`}</ul>
            <form id="adm-word-add" class="inline-new" style="margin-top:14px"><label class="vh" for="adm-word">Word or phrase</label><input id="adm-word" maxlength="60" placeholder="Word or phrase" autocomplete="off" autocapitalize="none" spellcheck="false" required>
              <label class="vh" for="adm-word-sev">Kind</label><select id="adm-word-sev"><option value="block">Not allowed</option><option value="allow">Allowed exception</option></select><button class="btn" type="submit">Add</button></form>`;
          $("#adm-word-add").addEventListener("submit", async (e) => {
            e.preventDefault();
            try { const t = await S.setModerationTerm($("#adm-word").value, $("#adm-word-sev").value, false); toast(`Added “${t}”`); words(); } catch (err) { toast(err.message); }
          });
        };
        $("#adm-words").addEventListener("click", async (e) => {
          const b = e.target.closest("[data-word-rm]"); if (!b) return;
          if (!confirm(`Remove “${b.dataset.wordRm}” from the word filter?`)) return;
          try { await S.setModerationTerm(b.dataset.wordRm, "block", true); toast("Removed"); words(); } catch (err) { toast(err.message); }
        });
        words();
      }
    } else return renderNotFound();
    el.onclick = async (e) => {
      const b = e.target.closest("[data-adm]"); if (!b) return;
      const k = b.dataset.adm, rid = b.dataset.rep ? +b.dataset.rep : null;
      try {
        if (k === "approve") { b.disabled = true; await S.setStanding(b.dataset.uid, "active", null); toast("Approved"); return again(); }
        if (k === "member") { const p = people[b.dataset.uid] || (await S.profileById(b.dataset.uid)); if (p) manageMember(p, again); return; }
        if (k === "resolve" || k === "dismiss") { b.disabled = true; await S.resolveReport(rid, k === "resolve" ? "resolved" : "dismissed"); toast(k === "resolve" ? "Marked done" : "Dismissed"); return again(); }
        if (k === "remove") return removePost(b.dataset.kind, b.dataset.id, async () => { await S.resolveReport(rid, "resolved"); again(); });
        if (k === "held-approve") { b.disabled = true; await S.reviewHeld(b.dataset.kind, b.dataset.id, "approve"); toast("Approved: it's live"); return again(); }
        if (k === "held-remove") return teamAction({ title: "Remove this post?", go: "Remove", danger: true, why: "Note for the team",
          body: `<p class="hint">${{ log: "The review is deleted, and the theatre or town if the word is there; the diary entry and rating stay.", comment: "The comment is deleted.", list: "The whole list is deleted.", list_item: "The note is deleted; the show stays on the list." }[b.dataset.kind] || ""}</p>`,
          run: async (w) => { await S.reviewHeld(b.dataset.kind, b.dataset.id, "remove", w); toast("Removed"); again(); } });
        if (k === "approve-s") return teamAction({ title: "Approve this production?", go: "Approve", why: "Note for the member",
          body: `<p class="hint">Check it against its link first. It's added to the play's history at the next data update.</p>`,
          run: async (w) => { await S.reviewSuggestion(+b.dataset.id, "approved", w || "Approved. It'll appear at the next update. Thank you!"); toast("Approved"); again(); } });
        if (k === "approve-p") return teamAction({ title: "Approve this play?", go: "Approve", why: "Note for the member",
          body: `<p class="hint">Check that it's a real play and isn't on Billd under another title. It's added at the next data update.</p>`,
          run: async (w) => { await S.reviewPlaySuggestion(+b.dataset.id, "approved", w || "Approved. It'll be on Billd after the next update. Thank you!"); toast("Approved"); again(); } });
        if (k === "decline-p") return teamAction({ title: "Decline this play?", go: "Decline", danger: true, required: true, why: "Reason (the member sees this)",
          run: async (w) => { await S.reviewPlaySuggestion(+b.dataset.id, "declined", w); toast("Declined"); again(); } });
        if (k === "reopen-s" || k === "reopen-p") { b.disabled = true; await (k === "reopen-s" ? S.reviewSuggestion(+b.dataset.id, "pending", null) : S.reviewPlaySuggestion(+b.dataset.id, "pending", null)); toast("Back to waiting"); return again(); }
        if (k === "fb-done" || k === "fb-dismiss" || k === "fb-open") { b.disabled = true; await S.resolveFeedback(+b.dataset.id, { "fb-done": "done", "fb-dismiss": "dismissed", "fb-open": "open" }[k]); toast("Saved"); return again(); }
        if (k === "approve-i") return teamAction({ title: "Approve this show?", go: "Approve", why: "Writer, as the source credits it",
          body: `<p class="hint">Check on the source page that it's a play (not stand-up, a concert or a class) and isn't on Billd under another title. It's added and listed at the next data update.</p>`,
          run: async (w) => { await S.reviewImport(+b.dataset.id, "approved", w, null); toast("Approved"); again(); } });
        if (k === "reject-i") return teamAction({ title: "Reject this show?", go: "Reject", danger: true, why: "Note for the team",
          body: `<p class="hint">It won't be listed, now or when the calendars show it again.</p>`,
          run: async (w) => { await S.reviewImport(+b.dataset.id, "rejected", null, w); toast("Rejected"); again(); } });
        if (k === "reopen-i") { b.disabled = true; await S.reviewImport(+b.dataset.id, "pending", null, null); toast("Back to waiting"); return again(); }
        if (k === "decline-s") return teamAction({ title: "Decline this production?", go: "Decline", danger: true, required: true, why: "Reason (the member sees this)",
          run: async (w) => { await S.reviewSuggestion(+b.dataset.id, "declined", w); toast("Declined"); again(); } });
      } catch (err) { toast(err.message); b.disabled = false; }
    };
  }

  // ---------------------------------------------------------------- feedback
  const fb = { ctx: null, busy: false };
  const web = CFG.feedback?.endpoint ? CFG.feedback : null;
  function openFeedback(ctx) {
    fb.ctx = ctx || null;
    const cr = ctx?.id === "copyright";
    $("#fb-title").textContent = cr ? "Copyright report" : ctx ? "Suggest a correction" : "Feedback";
    $("#fb-about").textContent = cr ? "Tell us what on Billd uses your work. We'll look at it promptly." : ctx ? ctx.title : "Tell us what works, what is missing, or what looks wrong.";
    $("#fb-text").placeholder = cr ? "The Billd page's address, what on it is yours, where the original is, and how to reach you (email). Say that you own the rights or act for the owner."
      : ctx ? "What is wrong or missing? A date, a playwright, a production…" : "";
    $("#fb-rate").hidden = !!ctx;
    $("#fb-form").hidden = false; $("#fb-done").hidden = true;
    const canSend = !!web || S.kind === "supabase";
    note("#fb-note", canSend ? "" : "Feedback can't be sent from this copy of Billd. Copy your text and send it to the owner another way.", !canSend);
    $("#fb-send").disabled = !canSend; $("#fb-copy").hidden = canSend;
    $("#fb").showModal(); $("#fb-text").focus();
  }
  $("#fb-open").addEventListener("click", () => openFeedback(null));
  $("#fb-copy").addEventListener("click", () => {
    const text = (fb.ctx ? `Correction for "${fb.ctx.title}" (${fb.ctx.id}):\n` : "Billd feedback:\n") + $("#fb-text").value.trim();
    navigator.clipboard?.writeText(text).then(() => note("#fb-note", "Copied. Paste it into a message to the owner.", false, true), () => { $("#fb-text").select(); });
  });
  $("#fb-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (fb.busy || !(web || S.kind === "supabase")) return;
    const comment = $("#fb-text").value.trim();
    if (!comment) { note("#fb-note", "Write a comment before sending.", true); return; }
    const rating = document.querySelector('input[name="fb-rating"]:checked')?.value;
    // a form service (Web3Forms, Formspree) that emails each submission to the owner
    const body = { ...(web?.fields || {}), from_name: "Billd", subject: fb.ctx ? `Billd correction: ${fb.ctx.title}` : "Billd feedback", message: comment };
    const name = $("#fb-name").value.trim() || (me ? `${me.display_name || ""} @${me.username}`.trim() : "");
    if (name) body.name = name;
    if (!fb.ctx && rating) body.rating = rating;
    if (fb.ctx) { body.play = fb.ctx.title; body.play_link = N.publicUrl(playUrl(fb.ctx.id)); }
    fb.busy = true; $("#fb-send").disabled = true; note("#fb-note", "Sending…");
    try {
      // kept for the Billd team's Admin page, and emailed to the owner; sent if either works
      const kind = fb.ctx?.id === "copyright" ? "copyright" : fb.ctx ? "correction" : "feedback";
      const saved = S.kind === "supabase" ? S.saveFeedback({ kind, body: comment, name: $("#fb-name").value.trim(), rating: !fb.ctx && rating ? +rating : null,
        play_id: kind === "correction" ? fb.ctx.id : null, play_title: kind === "correction" ? fb.ctx.title : null, page: location.hash.slice(0, 500) })
        .then(() => true, () => false) : Promise.resolve(false);
      const mailed = web ? fetch(web.endpoint, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) })
        .then((r) => (r.ok ? true : r.status === 429 ? "busy" : false), () => false) : Promise.resolve(false);
      const [db, mail] = await Promise.all([saved, mailed]);
      if (db !== true && mail !== true) throw new Error(mail === "busy" ? "Too many messages at once. Wait a minute, then send again." : "Your feedback was not sent. Try again in a moment.");
      $("#fb-text").value = ""; $("#fb-r0").checked = true; note("#fb-note", "");
      $("#fb-form").hidden = true; $("#fb-done").hidden = false; $("#fb-thanks").focus();
    } catch (err) { note("#fb-note", err.message.startsWith("Too") || err.message.startsWith("Your") ? err.message : "Your feedback was not sent because the connection failed. Try again in a moment.", true); }
    finally { fb.busy = false; $("#fb-send").disabled = false; }
  });

  // ---------------------------------------------------------------- installable app
  // not inside the app: its files are already on the phone (Android's web view would otherwise register it)
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol) && !window.claude && window.top === window && !APP) {
    window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => { /* offline support is optional */ }); });
  }
  // Android's Chrome offers to install the site (beforeinstallprompt); iPhones never do, so
  // there the steps are shown instead: Share, then Add to Home Screen.
  let installPrompt = null;
  const UA = navigator.userAgent;
  const IOS = /iPhone|iPad|iPod/.test(UA) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const ANDROID = /Android/.test(UA);
  const PHONE = IOS || ANDROID || matchMedia("(max-width: 860px) and (pointer: coarse)").matches;
  const installed = () => APP || matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const canInstall = () => !installed() && (PHONE || !!installPrompt);
  function showInstallLinks() { $("#install-wrap").hidden = !canInstall(); }
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; showInstallLinks(); if (location.hash === "" || location.hash === "#/") route(); });
  window.addEventListener("appinstalled", () => { installPrompt = null; showInstallLinks(); toast("Billd is on your home screen"); });
  showInstallLinks();
  const SHARE_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style="vertical-align:-3px"><path fill="currentColor" d="M12 2 7.5 6.5l1.4 1.4L11 5.8V15h2V5.8l2.1 2.1 1.4-1.4zM5 10v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V10h-3v2h1v8H7v-8h1v-2z"/></svg>`;
  async function install() {
    if (installPrompt) {
      installPrompt.prompt();
      try { await installPrompt.userChoice; } catch (e) { /* dismissed */ }
      installPrompt = null; showInstallLinks(); return;
    }
    const steps = IOS
      ? `<ol class="steps"><li>Tap the <b>Share</b> button ${SHARE_ICON} in Safari's toolbar (at the bottom on iPhone, at the top on iPad). In Chrome, it's at the top right.</li><li>Scroll down and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>. Billd opens from its icon, full screen, like an app.</li></ol>`
      : ANDROID
      ? `<ol class="steps"><li>Tap the <b>⋮</b> menu at the top right of Chrome.</li><li>Tap <b>Install app</b> (or <b>Add to Home screen</b>).</li><li>Tap <b>Install</b>. In Samsung Internet: menu <b>≡</b> → <b>Add page to</b> → <b>Home screen</b>.</li></ol>`
      : `<ol class="steps"><li>On a phone, open this page and choose <b>Add to Home Screen</b> from the browser's Share or ⋮ menu.</li><li>On a computer, in Chrome or Edge, click the install icon at the right of the address bar.</li></ol>`;
    $("#inst-steps").innerHTML = steps + `<p class="hint">No app store needed. It's free, and works offline for browsing.</p>`;
    $("#installd").showModal();
  }
  document.addEventListener("click", (e) => {
    const out = e.target.closest("[data-logout]"); if (out) logOut({ currentTarget: out });
    if (e.target.closest("[data-install]")) { e.preventDefault(); install(); }
    const d = e.target.closest("[data-install-dismiss]");
    if (d) { try { localStorage.setItem("billd-install-dismissed", "1"); } catch (err) { /* not kept */ } d.closest(".install-card")?.remove(); }
  });
  function installCardHTML() {
    let dismissed = false; try { dismissed = localStorage.getItem("billd-install-dismissed") === "1"; } catch (e) { /* show it */ }
    if (!canInstall() || dismissed) return "";
    return `<div class="install-card"><span class="logo-mark" aria-hidden="true">B</span><div><b>Get the Billd app</b><span>Add it to your home screen: free, no app store.</span></div>
      <button class="btn sm" type="button" data-install>Install</button><button class="x" type="button" data-install-dismiss aria-label="Not now">×</button></div>`;
  }
  document.body.addEventListener("click", (e) => {  // buttons outside the page area (home hero, footer)
    if (e.target.closest("#page")) return;
    if (e.target.closest("[data-log]") && !e.target.closest("#acct")) openLog(null);
  });

  // ---------------------------------------------------------------- start
  async function loadSocial() {
    try { await S.ready; } catch (e) { console.warn(e); toast(e.message); }
    me = S.me();
    // opened without a connection (signed in from the kept session): only what this device holds
    const offline = !!S.isOffline?.();
    try { dbSettings = S.kind !== "local" && !offline ? await S.settings() : {}; } catch (e) { dbSettings = {}; }
    S.setTermsVersion(termsState().live ? termsState().version : null);
    if (!offline) await Promise.all([loadTeam(), loadBlocks()]);
    renderAcct(); renderStanding(); renderTermsBar(); renderSyncBar(); maybePickName();
    try { myStatus = me ? await S.myStatuses() : {}; } catch (e) { myStatus = {}; }
    if (offline) return;
    try { (await S.popular(60)).forEach((r, i) => (popular[r.play_id] = 1000 - i)); } catch (e) { /* none yet */ }
    try { (await S.ratedPlays()).forEach((r) => (rated[r.play_id] = { avg: r.avg_rating != null ? Number(r.avg_rating) : null, n: r.ratings, seen: r.seen })); } catch (e) { /* none yet */ }
  }
  // An email link (confirm your address, reset your password) that opened the app: web/native.js
  // catches https://billd.theater/auth/… and social.js signs in from it.
  N.onAuthLink(async (url) => {
    try {
      const r = await S.handleAuthLink(url);
      if (r.type === "recovery") { location.hash = "#/settings"; setTimeout(() => toast("Choose a new password below"), 400); }
      else { location.hash = "#/"; toast("Your email address is confirmed. Welcome to Billd"); }
    } catch (e) { toast(e.message); }
  });
  // web/auth/confirm.html verified a password-reset link and sent the member here
  try { if (sessionStorage.getItem("billd-recovery")) { sessionStorage.removeItem("billd-recovery"); setTimeout(() => toast("Choose a new password below"), 1200); } } catch (e) { /* storage blocked */ }
  S.onAuth(async (p) => {
    me = p; followingSet = null; await Promise.all([loadTeam(), loadBlocks()]); renderAcct(); renderStanding(); renderTermsBar(); renderSyncBar(); maybePickName();
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
