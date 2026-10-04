// Billd: read a production's details from its web page, for the "Add a production" form.
//
// Input is what supabase/functions/fetch-production returns ({title, meta, jsonld, text}), or
// just {text} when a member pastes the page. Output is a best guess at each field with the words
// it came from, for the member to check: nothing here is saved without them seeing it.
// schema.org Event data wins when a page has it; otherwise the visible text is read with
// patterns ("Directed by", "September 16 – 26, 2026", "Performed in Korean"), and theatres,
// cities and plays are matched against Billd's own lists.
"use strict";
(function (root) {
  const fold = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  const MON = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
  const DAY = "(\\d{1,2})(?:st|nd|rd|th)?";
  const YR = "(\\d{4})";
  const DASH = "\\s*(?:[–—-]|to|until|through|thru|till)\\s*";
  const WD = "(?:(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\\.?,?\\s+)?";
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const mon = (s) => MONTHS[fold(s).replace(/\.$/, "").slice(0, s.toLowerCase().startsWith("sept") ? 4 : 3)] || MONTHS[fold(s).slice(0, 3)];
  const THIS_YEAR = new Date().getFullYear();

  // ---------------------------------------------------------------- dates
  // Each pattern: a regex and how to turn its groups into [from, to]
  const RANGES = [
    // September 16, 2026 – September 26, 2026 / Sep 16 2026 to Oct 2 2026
    [new RegExp(`${WD}${MON}\\s+${DAY},?\\s+${YR}${DASH}${WD}${MON}\\s+${DAY},?\\s+${YR}`, "i"), (g) => [ymd(g[3], mon(g[1]), g[2]), ymd(g[6], mon(g[4]), g[5])]],
    // September 16 – October 2, 2026
    [new RegExp(`${WD}${MON}\\s+${DAY}${DASH}${WD}${MON}\\s+${DAY},?\\s+${YR}`, "i"), (g) => [ymd(g[5], mon(g[1]), g[2]), ymd(g[5], mon(g[3]), g[4])]],
    // September 16 – 26, 2026
    [new RegExp(`${WD}${MON}\\s+${DAY}${DASH}${DAY},?\\s+${YR}`, "i"), (g) => [ymd(g[4], mon(g[1]), g[2]), ymd(g[4], mon(g[1]), g[3])]],
    // 16 September 2026 – 26 September 2026
    [new RegExp(`${WD}${DAY}\\s+${MON},?\\s+${YR}${DASH}${WD}${DAY}\\s+${MON},?\\s+${YR}`, "i"), (g) => [ymd(g[3], mon(g[2]), g[1]), ymd(g[6], mon(g[5]), g[4])]],
    // 16 September – 3 October 2026
    [new RegExp(`${WD}${DAY}\\s+${MON}${DASH}${WD}${DAY}\\s+${MON},?\\s+${YR}`, "i"), (g) => [ymd(g[5], mon(g[2]), g[1]), ymd(g[5], mon(g[4]), g[3])]],
    // 16 – 26 September 2026
    [new RegExp(`${WD}${DAY}${DASH}${WD}${DAY}\\s+${MON},?\\s+${YR}`, "i"), (g) => [ymd(g[4], mon(g[3]), g[1]), ymd(g[4], mon(g[3]), g[2])]],
  ];
  const SINGLES = [
    [new RegExp(`${WD}${MON}\\s+${DAY},?\\s+${YR}`, "gi"), (g) => ymd(g[3], mon(g[1]), g[2])],
    [new RegExp(`${WD}${DAY}\\s+${MON},?\\s+${YR}`, "gi"), (g) => ymd(g[3], mon(g[2]), g[1])],
  ];
  const valid = (d) => { const t = Date.parse(d); return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === d; };
  const plausible = (d) => valid(d) && Math.abs(+d.slice(0, 4) - THIS_YEAR) <= 3;
  function dates(text) {
    const lines = text.split("\n");
    // a range in the opening part of the page is the run; later ones are often other shows
    for (const [limit] of [[80], [lines.length]]) {
      const chunk = lines.slice(0, limit).join("\n");
      for (const [re, f] of RANGES) {
        const m = chunk.match(re);
        if (m) { const [a, b] = f(m); if (plausible(a) && plausible(b) && a <= b) return { from: a, to: b, words: m[0].trim() }; }
      }
    }
    const until = text.match(new RegExp(`\\b(?:through|until|thru|closes|closing|ends)\\s+${WD}(?:${MON}\\s+${DAY},?\\s+${YR}|${DAY}\\s+${MON},?\\s+${YR})`, "i"));
    const singles = [];
    for (const [re, f] of SINGLES) for (const m of text.slice(0, 8000).matchAll(re)) { const d = f(m); if (plausible(d)) singles.push({ d, words: m[0].trim() }); }
    if (until) {
      const g = until;
      const to = g[1] ? ymd(g[3], mon(g[1]), g[2]) : ymd(g[6], mon(g[5]), g[4]);
      if (plausible(to)) return { from: null, to, words: until[0].trim() };
    }
    if (singles.length) {
      singles.sort((a, b) => a.d.localeCompare(b.d));
      const last = singles[singles.length - 1].d;
      return { from: singles[0].d, to: last !== singles[0].d ? last : null, words: [...new Set(singles.map((s) => s.words))].slice(0, 2).join(" … ") };
    }
    return null;
  }

  // ---------------------------------------------------------------- people
  const PART = "[\\p{Lu}][\\p{L}'’.-]+";
  const JOIN = "(?:\\s+(?:de|del|della|di|da|van|von|der|den|la|le|du|bin|al|el|y)){0,2}";
  const NAME = `${PART}(?:${JOIN}\\s+${PART}){1,3}`;
  const NAMES = `${NAME}(?:\\s*(?:,|&|and)\\s*${NAME})*`;
  const NOT_NAMES = /^(?:The|A|An|This|That|With|And|New|North|South|East|West|Box|Book|Buy|Get|Tickets?|Performances?|Running|Run|Time|Season|Theatre|Theater|Company|Production|Directed|Director|Written|Music|Lyrics|Book|Cast|Creative|Team|Gallery|Video|Related|Content|Events?|Artists?|Creatives?|About|Contact|Privacy|Policy|Terms|Sign|Log|Menu|Search|Home|Donate|Support|Membership|Members?|Visit|Access|Accessibility|Avenue|Street|Hall|Center|Centre|Drill|Studio|Stage|Main|Upper|Lower|Royal|National|Opera|House|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|Emmy|Tony|Olivier|Obie|Pulitzer|Cannes|Award|Best|Actress|Actor|Korean|English|Captions?|Squid|Game|Learn|More|World|Premiere|Read|View|See|Watch|Explore|Discover|Quick|Links|Phone|Hours|Section)$/;
  const titleCase = (s) => s.replace(/[\p{L}'’-]+/gu, (w) => w.length <= 2 && /^(DE|DA|DI|LA|LE|DU|EL|AL|Y)$/.test(w) ? w.toLowerCase() : w[0] + w.slice(1).toLowerCase());
  const ORG = /\b(?:Productions?|Inc|LLC|Ltd|Theatre|Theater|Company|Foundation|Group|Entertainment|Studios?|Presents|Trust|Council|Fund|Ensemble|Orchestra|Armory|Center|Centre|Festival|Hall|Arts|Museum|Opera|Gallery|Academy|Institute|Society|Club|Network|Herald|Times|Review)\b/;
  function cleanName(n) {
    n = n.replace(/\s+/g, " ").replace(/[’']s$/, "").trim();
    const words = n.split(" ");
    if (words.length < 2 || words.length > 4 || ORG.test(n)) return null;
    if (words.some((w) => /\.$/.test(w) && w.length > 2)) return null;  // "Writing." ends a sentence; "J." is an initial
    if (NOT_NAMES.test(words[0]) || NOT_NAMES.test(words[words.length - 1])) return null;
    return n;
  }
  function splitNames(s) { return s.split(/\s*(?:,|&|\band\b)\s*/).map(cleanName).filter(Boolean); }
  function grab(lines, patterns) {
    const out = [], words = [];
    for (const line of lines) {
      let l = line === line.toUpperCase() && /[A-Z]{3}/.test(line) ? titleCase(line) : line;
      l = l.replace(/\s*\([^)]*\)/g, "").replace(/\s*[“"][^”"]*[”"]/g, "");  // "Tom Blyth (“The People We Meet…”), Krysta Rodriguez"
      for (const re of patterns) {
        for (const m of l.matchAll(re)) {
          const names = splitNames(m[1]);
          if (names.length) { names.forEach((n) => !out.includes(n) && out.push(n)); words.push(m[0].trim()); }
        }
      }
      if (out.length >= 12) break;
    }
    return { names: out, words: words.slice(0, 3).join(" · ") };
  }
  const rx = (s) => new RegExp(s, "gu");
  const DIRECTOR = [rx(`\\b(?:[Dd]irected\\s+by|[Dd]irection\\s+(?:by|from)|[Ss]taged\\s+by|[Dd]irector\\s*[:–—-])\\s*(${NAMES})`),
                    rx(`\\b[Dd]irector(?:\\s+and\\s+[a-z]+)?\\s+(${NAME})`)];
  const ADAPTER = [rx(`\\b(?:[Aa]dapted\\s+by|[Aa]daptation\\s+by|[Tt]ranslated\\s+by|[Tt]ranslation\\s+by|(?:[Nn]ew\\s+)?[Vv]ersion\\s+by|[Aa]\\s+new\\s+(?:version|adaptation|translation)\\s+by)\\s+(${NAMES})`),
                   rx(`\\b(${NAME})[’']s\\s+(?:\\w+\\s+){0,2}(?:adaptation|version|translation)\\b`)];
  // "with" only opening a sentence: "presented in association with X Productions" is producers
  const CAST = [rx(`(?:\\b(?:[Ss]tarring|[Ff]eaturing|[Cc]ast\\s+(?:includes|members include):?)|(?:^|[.!]\\s+)[Ww]ith)\\s+(${NAMES})`),
                rx(`\\b(?:[Aa]ctor|[Aa]ctress|[Ss]tar)\\s+(${NAME})`)];

  // ---------------------------------------------------------------- page structure
  function ldEvent(jsonld) {
    const isEvent = (t) => /Event|TheaterEvent|Play|CreativeWork/.test([].concat(t || []).join(" "));
    return (jsonld || []).find((x) => isEvent(x["@type"]) && (x.startDate || x.location)) || null;
  }
  const names = (x) => [].concat(x || []).map((p) => (typeof p === "string" ? p : p && p.name)).filter(Boolean);
  function cleanTitle(page) {
    const raw = page.meta?.["og:title"] || page.meta?.["twitter:title"] || page.title || "";
    return raw.replace(/\s*[|–—·•]\s*[^|–—·•]+$/, "").replace(/\s+-\s+(tickets?|book now|official site).*$/i, "").replace(/\s*\|\s*$/, "").trim();
  }

  // ---------------------------------------------------------------- matching Billd's lists
  function wordIn(hay, needle) {
    if (!needle || needle.length < 4) return false;
    const i = hay.indexOf(needle);
    if (i < 0) return false;
    const before = hay[i - 1], after = hay[i + needle.length];
    return !(before && /[a-z0-9]/.test(before)) && !(after && /[a-z0-9]/.test(after));
  }
  function matchVenue(hay, ctx, cityId) {
    let best = null;
    for (const v of ctx.venues || []) {
      const n = fold(v.name.replace(/\s*\(.*\)$/, ""));
      if (n.length < 7 || !wordIn(hay, n)) continue;
      const score = n.length + (cityId && v.place === cityId ? 50 : 0) + (/\(\d{4}/.test(v.name) ? -100 : 0);
      if (!best || score > best.score) best = { v, score };
    }
    return best ? best.v : null;
  }
  function matchPlace(hay, ctx) {
    let best = null;
    for (const p of ctx.places || []) {
      const n = fold(p.name);
      if (n.length < 4 || !wordIn(hay, n)) continue;
      const score = (p.weight || 0) + n.length;
      if (!best || score > best.score) best = { p, score };
    }
    return best ? best.p : null;
  }
  function matchPlays(title, hay, ctx) {
    const t = fold(title);
    const out = [];
    for (const w of ctx.works || []) {
      const titles = [w.title, ...(w.alt_titles || [])].map(fold).filter((x) => x.length >= 3);
      const hit = titles.find((x) => x === t || wordIn(t, x));
      if (!hit) continue;
      let score = hit.length * 3 + (hit === t ? 40 : 0) + Math.min(w.pop || 0, 2000) / 100;
      const writers = (w.writers || []).map(fold);
      if (writers.some((n) => n && wordIn(hay, n))) score += 60;
      else if (writers.some((n) => n && wordIn(hay, n.split(" ").pop()))) score += 25;
      out.push({ id: w.id, score });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 6).map((x) => x.id);
  }

  // ---------------------------------------------------------------- the whole page
  function extract(page, ctx = {}) {
    const text = page.text || "";
    const lines = text.split("\n");
    const hay = fold(text);
    const ev = ldEvent(page.jsonld);
    const out = { url: page.url || "", title: cleanTitle(page) || (lines[0] || "").slice(0, 120), found: {} };
    const note = (k, words) => { if (words) out.found[k] = String(words).slice(0, 160); };

    // which play: the one the member started from, else a title on the page that matches one
    out.plays = matchPlays(out.title, hay, ctx);
    if (!out.plays.length) {
      for (const l of lines.slice(0, 40)) {
        if (l.length > 80) continue;
        const m = matchPlays(l, hay, ctx);
        if (m.length && (ctx.works || []).some((w) => w.id === m[0] && fold(w.title) === fold(l))) { out.plays = m; out.title = l; break; }
      }
    }
    if (ctx.playId && !out.plays.includes(ctx.playId)) out.play_mismatch = out.plays.length > 0;
    const playId = ctx.playId || out.plays[0];

    // dates
    if (ev && ev.startDate) {
      out.date_from = String(ev.startDate).slice(0, 10); out.date_to = ev.endDate ? String(ev.endDate).slice(0, 10) : null;
      note("dates", "schema.org event data");
    } else {
      const d = dates(text);
      if (d) { out.date_from = d.from; out.date_to = d.to; note("dates", d.words); }
    }

    // theatre and city
    const loc = ev && [].concat(ev.location || [])[0];
    const ldCity = loc?.address?.addressLocality || (typeof loc?.address === "string" ? loc.address.split(",").slice(-2, -1)[0] : "");
    let place = ldCity ? (ctx.places || []).find((p) => fold(p.name) === fold(ldCity)) : null;
    const siteName = page.meta?.["og:site_name"] || "";
    let venue = loc?.name ? (ctx.venues || []).find((v) => fold(v.name) === fold(loc.name)) : null;
    if (!venue) venue = matchVenue(fold([siteName, page.title, text].join("\n")), ctx, place?.id);
    if (!venue && page.url) {
      // "armoryonpark.org" -> Park Avenue Armory: most of a theatre's words in the address
      const host = fold((page.url.match(/^https?:\/\/(?:www\.)?([^/]+)/i) || [])[1] || "").replace(/\.[a-z.]+$/, "").replace(/[^a-z0-9]/g, "");
      let best = null;
      if (host.length >= 5) for (const v of ctx.venues || []) {
        const words = fold(v.name).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !/^(theatre|theater|the)$/.test(w));
        const hits = words.filter((w) => host.includes(w)).length;
        if (hits >= 2 && hits / words.length >= 0.6 && (!best || hits > best.hits)) best = { v, hits };
      }
      if (best) { venue = best.v; note("venue", `the web address (${host})`); }
    }
    if (venue) { out.venue = venue.name; out.venue_id = venue.id; note("venue", venue.name); if (!place && venue.place) place = (ctx.places || []).find((p) => p.id === venue.place); }
    else if (loc?.name) { out.venue = loc.name; note("venue", "schema.org event data"); }
    else if (siteName) { out.venue = siteName; note("venue", `the website's name, "${siteName}"`); }
    // a city named in the description may be the play's setting ("modern-day Seoul"), so only
    // address lines, the page title and the site name count
    if (!place) {
      const addr = lines.filter((l) => l.length < 120 && (/\b\d{5}\b|\b[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}\b|,\s*(?:NY|CA|IL|MA|DC|PA|WA|TX|GA|MN|ON|BC|NSW|VIC)\b/.test(l)));
      place = matchPlace(fold([page.title, siteName, ...addr].join("\n")), ctx);
    }
    if (place) { out.city = place.name; out.place_id = place.id; note("city", place.name); }
    else if (ldCity) out.city = ldCity;

    // people
    const writerNames = new Set((ctx.writersOf ? ctx.writersOf(playId) : []).map(fold));
    const notWriter = (n) => !writerNames.has(fold(n));
    if (ev) {
      const dirs = names(ev.director), cast = names(ev.performer || ev.actor);
      if (dirs.length) { out.directors = dirs; note("directors", "schema.org event data"); }
      if (cast.length) { out.cast = cast.slice(0, 20); note("cast", "schema.org event data"); }
    }
    if (!out.directors) { const g = grab(lines, DIRECTOR); if (g.names.length) { out.directors = g.names.filter(notWriter).slice(0, 3); note("directors", g.words); } }
    const ad = grab(lines, ADAPTER);
    const notPlace = (n) => !(out.venue && fold(out.venue).includes(fold(n))) && !(siteName && fold(siteName).includes(fold(n)));
    if (ad.names.filter(notWriter).filter(notPlace).length) { out.adapters = ad.names.filter(notWriter).filter(notPlace).slice(0, 3); note("adapters", ad.words); }
    if (!out.cast) { const g = grab(lines, CAST); if (g.names.length) { out.cast = g.names.filter(notWriter).slice(0, 20); note("cast", g.words); } }
    // Names the page gives as performers elsewhere (title credits, "actor X", "Starring X"): they
    // tell a cast list of actors from one that alternates part and actor ("Song Do-young /
    // Jeon Do-yeon"), and which way round it goes.
    const ROLE_LABEL = /design|costume|lighting|sound|music|direct|writ|adapt|dramaturg|choreograph|composer|video|projection|casting|movement|fight|wig|hair|make-?up|props|manager|produc|translat|^after$|version|orchestrat|arrang|lyric|book by/i;
    const nameLine = (l) => { const t = l.replace(/^[*•·\-–]\s*/, "").trim(); if (ROLE_LABEL.test(t)) return null; const u = t === t.toUpperCase() ? titleCase(t) : t; return new RegExp(`^${NAME}$`, "u").test(u) ? cleanName(u) : null; };
    const known = new Set((out.cast || []).map(fold));
    lines.slice(0, 30).forEach((l) => { const n = nameLine(l); if (n && notWriter(n) && !(out.directors || []).map(fold).includes(fold(n))) known.add(fold(n)); });
    function sortCast(names, label) {
      // names: one entry per line or list item; an item may hold "part | actor"
      const flat = [], pairs = [];
      names.forEach((x) => { const parts = String(x).split(/\s*\|\s*/).filter(Boolean); if (parts.length === 2) pairs.push(parts); else flat.push(parts[0]); });
      let result = null, how = "";
      if (pairs.length >= 2) {
        const second = pairs.filter((p) => known.has(fold(p[1]))).length, first = pairs.filter((p) => known.has(fold(p[0]))).length;
        if (second > first) result = pairs.map((p) => `${p[1]} as ${p[0]}`);
        else if (first > second) result = pairs.map((p) => `${p[0]} as ${p[1]}`);
        how = "parts and actors";
      } else if (flat.length >= 4 && flat.length % 2 === 0) {
        const odd = flat.filter((n, i) => i % 2 === 1 && known.has(fold(n))).length, even = flat.filter((n, i) => i % 2 === 0 && known.has(fold(n))).length;
        if (odd && !even) { result = []; for (let i = 0; i < flat.length; i += 2) result.push(`${flat[i + 1]} as ${flat[i]}`); how = "parts and actors"; }
        else if (even && !odd && known.size >= 2 && odd + even >= 2) { result = []; for (let i = 0; i < flat.length; i += 2) result.push(`${flat[i]} as ${flat[i + 1]}`); how = "actors and parts"; }
      }
      if (!result && !pairs.length) result = flat;
      if (!result) { out.people = [...new Set([...(out.people || []), ...pairs.flat()])]; return false; }  // can't tell which is which
      const actors = new Set(result.map((r) => fold(r.split(" as ")[0])));
      out.cast = [...(out.cast || []).filter((n) => !actors.has(fold(n.split(" as ")[0]))), ...result].slice(0, 40);
      note("cast", `${label}${how ? ` (${how})` : ""}: ${result.slice(0, 2).join(", ")}…`);
      return true;
    }
    // lists under a "Cast" heading, from the page's structure (see parse.js castLists)
    for (const list of page.castLists || []) {
      const items = list.map((t) => t.split(/\s*\|\s*/).map((x) => nameLine(x)).filter(Boolean).join(" | ")).filter((t) => t && t.split(" | ").every(notWriter));
      if (items.length >= 2 && sortCast(items, "the page's cast list")) break;
    }
    // a "Cast" heading followed by one name per line (pasted text, simple pages)
    const head = lines.findIndex((l) => /^(?:the\s+)?(?:current\s+|original\s+|full\s+)?cast(?:\s+list)?:?$/i.test(l.trim()));
    if (head >= 0) {
      const listed = [];
      for (const l of lines.slice(head + 1, head + 90)) {
        if (/full cast|cast details|see all/i.test(l)) continue;
        const n = nameLine(l);
        if (!n) { if (listed.length) break; continue; }
        if (notWriter(n)) listed.push(n);
      }
      if (listed.length >= 2) sortCast(listed, lines[head].trim());
    }
    // "Creative Team": a job on one line, the name on the next
    const ct = lines.findIndex((l) => /^(?:the\s+)?creative(?:\s+team)?s?:?$/i.test(l.trim()));
    if (ct >= 0) {
      const creatives = [];
      for (let i = ct + 1; i < Math.min(lines.length, ct + 60); i++) {
        const label = lines[i].replace(/^[*•·\-–]\s*/, "").trim();
        if (/^(?:the\s+)?(?:current\s+|original\s+)?cast$/i.test(label)) break;
        const n = lines[i + 1] && nameLine(lines[i + 1]);
        if (!n || nameLine(label)) continue;
        i++;
        if (/^after$|^based on|original(?:ly)? by/i.test(label)) continue;  // the play's own author
        if (/direct/i.test(label)) { out.directors = [...new Set([...(out.directors || []), n])]; note("directors", `${label}: ${n}`); }
        if (/writ|adapt|version|translat|text by/i.test(label) && notWriter(n)) { out.adapters = [...new Set([...(out.adapters || []), n])]; note("adapters", `${label}: ${n}`); }
        if (!/direct|writ|adapt|version|translat|text by/i.test(label) && label.length < 50) creatives.push(`${label}: ${n}`);
      }
      if (creatives.length) out.creatives = creatives;
    }
    // names standing on their own lines near the title (a credits block), for the member to sort
    const used = new Set([...(out.directors || []), ...(out.adapters || []), ...(out.cast || [])].map(fold));
    // only just under the title, where pages list the artists; elsewhere it's menus and buttons
    const at = Math.max(0, lines.findIndex((l) => fold(l) === fold(out.title)));
    const loose = [];
    for (const l of lines.slice(at + 1, at + 10)) {
      const s = l === l.toUpperCase() ? titleCase(l) : l;
      if (s.length > 40 || /^by\s/i.test(s) || !new RegExp(`^${NAME}$`, "u").test(s)) continue;
      const n = cleanName(s);
      if (n && !used.has(fold(n)) && notWriter(n) && fold(n) !== fold(out.title) && !(out.venue && fold(out.venue).includes(fold(n))) && !loose.includes(n)) loose.push(n);
    }
    const inCast = new Set((out.cast || []).map((c) => fold(c.split(" as ")[0])));
    out.people = [...new Set([...(out.people || []), ...loose])].filter((n) => !inCast.has(fold(n)) && !(out.directors || []).map(fold).includes(fold(n))).slice(0, 10);

    // language: "Performed in Korean with English captions"
    const lm = text.match(/\b(?:[Pp]erformed|[Pp]resented|[Ss]ung|[Pp]layed|[Ss]taged)\s+in\s+([A-Z][a-z]+)/);
    if (lm) {
      const L = (ctx.languages || []).find((x) => fold(x.name) === fold(lm[1]));
      if (L) { out.language = L.id; out.language_name = L.name; note("language", lm[0]); }
    }

    return out;
  }

  const api = { extract, dates, pageTextFromPaste: (s) => String(s || "").split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n") };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BilldExtract = api;
})(typeof window !== "undefined" ? window : globalThis);
