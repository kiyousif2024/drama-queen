// The week in New York (nyc/index.html). The listings are in week.json beside this page, which a weekly job
// (scripts/nyc_week.py) replaces: { days: [{ date, events: [{ title, venue, address?, borough, lat?, lon?, time,
// source, tags: [...], note? }] }], seasonal: [{ title, venue, borough, from, to, time?, source, tags, note? }] }.
// Anything else in the file is ignored, and a missing optional field is simply not shown.
// "Near me" asks the browser (or the app) for the visitor's position only when tapped; the position stays in this
// page's memory to sort by distance and is never stored or sent anywhere.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const BOROUGHS = ["Manhattan", "Brooklyn", "Queens"];
  const CATS = [["markets", "Markets & food"], ["outdoors", "Parks & outdoors"], ["parades", "Parades & street fairs"],
    ["holiday", "Holiday & seasonal"], ["special", "Special events"]];
  const PILL = { markets: "market", parades: "street", holiday: "seasonal", special: "special" };  // parks & outdoors is most of the list: no pill
  const BORO_KEY = "billd-nyc-borough";
  const PIN = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>`;
  const parse = (iso) => { const [y, m, d] = String(iso).split("-").map(Number); return new Date(y, m - 1, d); };
  const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // only web links: a listing's source can't be a javascript: address
  const safe = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch (e) { return ""; } };
  const link = (txt, url) => (safe(url) ? `<a href="${esc(safe(url))}" target="_blank" rel="noopener nofollow">${txt}</a>` : txt);
  const num = (x) => (typeof x === "number" && isFinite(x) ? x : typeof x === "string" && x.trim() && isFinite(+x) ? +x : null);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) { /* not kept */ } },
  };
  // today's date in New York, whatever the visitor's clock says
  const nyToday = (() => {
    try { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
    catch (e) { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  })();

  function failed() {
    $("dt-main").innerHTML = `<p class="dt-note">This week's listings aren't available right now. Please try again later.</p>`;
    $("dt-chips").innerHTML = ""; $("dt-q").hidden = true; $("dt-count").textContent = "";
    $("ny-filters").hidden = true;
  }

  // the file is replaced each week: ask the server every time rather than reuse a stored copy
  fetch("week.json", { cache: "no-store" })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((W) => { if (!W || !Array.isArray(W.days) || !W.days.length) throw new Error("no days"); start(W); })
    .catch(failed);

  function cleanEvent(e) {
    if (!e || typeof e !== "object" || !e.title) return null;
    const lat = num(e.lat), lon = num(e.lon);
    return { title: String(e.title), venue: String(e.venue || ""), address: e.address ? String(e.address) : "", note: e.note ? String(e.note) : "",
      borough: BOROUGHS.includes(e.borough) ? e.borough : "", time: e.time ? String(e.time) : "", source: e.source,
      tags: Array.isArray(e.tags) ? e.tags.map(String) : [], at: lat != null && lon != null ? [lat, lon] : null };
  }

  function start(W) {
    const days = W.days.filter((d) => d && /^\d{4}-\d{2}-\d{2}/.test(d.date || ""))
      .map((d) => ({ date: d.date.slice(0, 10), events: (Array.isArray(d.events) ? d.events : []).map(cleanEvent).filter(Boolean) }));
    const seasonal = (Array.isArray(W.seasonal) ? W.seasonal : []).map((s) => {
      const e = cleanEvent(s);
      return e && { ...e, from: /^\d{4}-\d{2}-\d{2}/.test(s.from || "") ? s.from.slice(0, 10) : "", to: /^\d{4}-\d{2}-\d{2}/.test(s.to || "") ? s.to.slice(0, 10) : "" };
    }).filter(Boolean);
    if (!days.length) return failed();
    const hi = (s, q) => {
      const t = esc(s); if (!q) return t;
      const re = new RegExp(esc(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig");
      return t.replace(re, (m) => `<mark>${m}</mark>`);
    };
    const venueHtml = (v, q) => {
      v = String(v || ""); const i = v.indexOf(" @");
      return i < 0 ? hi(v, q) : `${hi(v.slice(0, i), q)} <span class="at">@ ${hi(v.slice(i + 2).trim(), q)}</span>`;
    };

    days.forEach((d) => { d.d = parse(d.date); d.key = DOW[d.d.getDay()].toLowerCase(); d.today = d.date === nyToday; });
    const first = days[0].d, last = days[days.length - 1].d;
    $("dt-range").innerHTML = `Week of <b>${MON[first.getMonth()]} ${first.getDate()} – ${MON[last.getMonth()]} ${last.getDate()}, ${last.getFullYear()}</b>`;

    const views = [{ key: "week", label: "All week" }, ...days.map((d) => ({ key: d.key, label: DOW[d.d.getDay()], small: md(d.d), today: d.today }))];
    const keys = views.map((v) => v.key);
    let view = keys.includes(location.hash.slice(1)) ? location.hash.slice(1) : (days.find((d) => d.today)?.key || "week");
    let q = "", cat = "", here = null, nearOn = false, asking = false;
    let boro = store.get(BORO_KEY); if (!BOROUGHS.includes(boro)) boro = "";
    const msg = (text, warn) => { $("ny-msg").textContent = text || ""; $("ny-msg").classList.toggle("warn", !!warn); };

    const chipsHTML = (list, cur, attr) => list.map((v) =>
      `<button type="button" class="chip${v.today ? " today" : ""}${v.cls ? " " + v.cls : ""}" ${attr}="${esc(v.key)}" aria-pressed="${v.pressed ?? v.key === cur}">${v.icon || ""}${esc(v.label)}${v.small ? ` <small>${v.small}</small>` : ""}${v.today ? '<span class="vh"> (today)</span>' : ""}</button>`).join("");
    const chips = () => {
      $("dt-chips").innerHTML = chipsHTML(views, view, "data-k");
      $("ny-boro").innerHTML = chipsHTML([{ key: "", label: "All boroughs" }, ...BOROUGHS.map((b) => ({ key: b, label: b })),
        { key: "near", label: asking ? "Finding you…" : "Near me", icon: PIN, cls: "ny-near", pressed: nearOn }], boro, "data-b");
      $("ny-cat").innerHTML = chipsHTML([{ key: "", label: "Everything" }, ...CATS.map(([key, label]) => ({ key, label }))], cat, "data-c");
    };
    const match = (...f) => !q || f.some((s) => s && String(s).toLowerCase().includes(q.toLowerCase()));
    const keep = (e) => (!boro || e.borough === boro) && (!cat || e.tags.includes(cat)) && match(e.venue, e.title, e.time, e.borough, e.address, e.note);

    // distance in miles (the haversine formula), and how it reads
    const miles = (a) => {
      if (!here || !a) return null;
      const r = Math.PI / 180, x = Math.sin((a[0] - here[0]) * r / 2) ** 2 + Math.cos(here[0] * r) * Math.cos(a[0] * r) * Math.sin((a[1] - here[1]) * r / 2) ** 2;
      return 7917.6 * Math.asin(Math.sqrt(x));
    };
    const distTxt = (m) => (m == null ? "" : m < 0.1 ? "here" : `${m < 10 ? m.toFixed(1) : Math.round(m)} mi`);
    const byNear = (list) => (nearOn && here ? list.map((e) => ({ e, m: miles(e.at) })).sort((a, b) => (a.m ?? 1e9) - (b.m ?? 1e9)).map((x) => x.e) : list);

    function row(e) {
      const pills = e.tags.filter((t) => PILL[t]).slice(0, 2).map((t) => ` <span class="dt-tag">${PILL[t]}</span>`).join("");
      const more = [e.address, e.note].filter(Boolean).map((s) => hi(s, q)).join(" · ");
      const m = nearOn ? miles(e.at) : null;
      return `<li class="dt-row"><div class="dt-venue">${venueHtml(e.venue, q)}${e.borough ? `<span class="ny-boro">${hi(e.borough, q)}</span>` : ""}</div>`
        + `<div class="dt-what">${link(hi(e.title, q), e.source)}${pills}${more ? `<span class="ny-more">${more}</span>` : ""}</div>`
        + `<div class="dt-when">${esc(e.time)}${m != null ? `<span class="ny-dist">${distTxt(m)}</span>` : ""}</div></li>`;
    }
    function dayBlock(d) {
      const ev = byNear(d.events.filter(keep));
      if ((q || cat || boro) && !ev.length && view === "week") return "";
      const rows = ev.map(row).join("");
      const what = nearOn && here ? "nearest first" : `${ev.length} ${ev.length === 1 ? "event" : "events"}`;
      return `<section class="dt-block" id="d-${d.key}"><div class="dt-band"><h2>${FULL[d.d.getDay()]} ${md(d.d)}</h2>${d.today ? `<span class="now">Today</span>` : `<span>${what}</span>`}</div><ol class="dt-rows">${rows || `<li class="dt-empty">Nothing listed${boro ? ` in ${esc(boro)}` : ""}${cat ? " of this kind" : ""}.</li>`}</ol></section>`;
    }
    const rangeTxt = (s) => {
      const f = s.from ? parse(s.from) : null, t = s.to ? parse(s.to) : null, d0 = parse(nyToday);
      if (f && f > d0) return `Opens ${MON[f.getMonth()]} ${f.getDate()}${t ? ` · to ${MON[t.getMonth()]} ${t.getDate()}, ${t.getFullYear()}` : ""}`;
      return t ? `On now · to ${MON[t.getMonth()]} ${t.getDate()}, ${t.getFullYear()}` : "On now";
    };
    function seasonBlock() {
      const ss = byNear(seasonal.filter(keep));
      if (!ss.length) return "";
      const rows = ss.map((s) => {
        const m = nearOn ? miles(s.at) : null;
        const more = [s.time, s.note].filter(Boolean).map((x) => hi(x, q)).join(" · ");
        return `<li class="dt-row"><div class="dt-venue">${venueHtml(s.venue, q)}${s.borough ? `<span class="ny-boro">${esc(s.borough)}</span>` : ""}</div>`
          + `<div class="dt-what">${link(hi(s.title, q), s.source)}${more ? `<span class="ny-more">${more}</span>` : ""}</div>`
          + `<div class="dt-when">${esc(rangeTxt(s))}${m != null ? `<span class="ny-dist">${distTxt(m)}</span>` : ""}</div></li>`;
      }).join("");
      return `<section class="dt-block ny-season" id="d-season"><div class="dt-band"><h2>On now &amp; coming up</h2><span>Seasonal</span></div><ol class="dt-rows">${rows}</ol></section>`;
    }

    function render() {
      chips();
      let html = view === "week" ? days.map(dayBlock).join("") : dayBlock(days.find((d) => d.key === view));
      if (view === "week" || cat === "holiday") html += seasonBlock();
      $("dt-main").innerHTML = html || `<p class="dt-empty">${q ? `No matches for “${esc(q)}”. Try a place or a shorter word.` : `Nothing listed${boro ? ` in ${esc(boro)}` : ""} this week.`}</p>`;
      const total = days.reduce((n, d) => n + d.events.length, 0);
      $("dt-count").textContent = `${total} events across ${days.length} days in Manhattan, Brooklyn and Queens${seasonal.length ? `, plus ${seasonal.length} seasonal` : ""}.`;
    }

    // Near me: only when tapped. The app's own location call when Billd's app opened this page, else the browser's.
    function locate() {
      const opts = { timeout: 12000 };
      if (window.BilldNative && typeof window.BilldNative.position === "function") return window.BilldNative.position(opts);
      if (!("geolocation" in navigator)) return Promise.reject(Object.assign(new Error("unsupported"), { code: "unsupported" }));
      return new Promise((ok, fail) => navigator.geolocation.getCurrentPosition(
        (p) => ok({ lat: p.coords.latitude, lon: p.coords.longitude }),
        (e) => fail(Object.assign(new Error(e.message || "denied"), { code: e.code === 1 ? "denied" : "unavailable" })),
        { enableHighAccuracy: false, timeout: opts.timeout, maximumAge: 300000 }));
    }
    function near() {
      if (nearOn) { nearOn = false; msg(""); return render(); }
      if (here) { nearOn = true; msg("Sorted by distance from you, nearest first."); return render(); }
      asking = true; msg("Asking your browser where you are…"); chips();
      locate().then((p) => {
        const lat = num(p && p.lat), lon = num(p && p.lon);
        if (lat == null || lon == null) throw Object.assign(new Error("unavailable"), { code: "unavailable" });
        here = [lat, lon]; nearOn = true;
        msg("Sorted by distance from you, nearest first. Your location stays on this page and isn't saved or sent.");
      }).catch((e) => {
        nearOn = false;
        msg(e && e.code === "denied"
          ? "Location wasn't shared, so nothing is sorted by distance. Pick your borough above instead."
          : "Your location couldn't be found just now. Pick your borough above instead.", true);
      }).finally(() => { asking = false; render(); });
    }

    $("dt-chips").addEventListener("click", (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      view = b.dataset.k;
      try { history.replaceState(null, "", "#" + view); } catch (_) { /* file:// */ }
      render();
    });
    $("ny-boro").addEventListener("click", (e) => {
      const b = e.target.closest(".chip"); if (!b || asking) return;
      if (b.dataset.b === "near") return near();
      boro = b.dataset.b; store.set(BORO_KEY, boro);  // the borough is kept on this device; a location never is
      if ($("ny-msg").classList.contains("warn")) msg("");
      render();
    });
    $("ny-cat").addEventListener("click", (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      cat = b.dataset.c; render();
    });
    $("dt-q").addEventListener("input", (e) => { q = e.target.value.trim(); if (q && view !== "week") view = "week"; render(); });
    render();
  }
})();
