// The week in Detroit (detroit/index.html). The listings are in week.json beside this page, which a weekly
// job replaces: { days: [{ date, events: [{ venue, title, time, source, tag? }] }], film: [{ venue, note?,
// films: [{ title, times, source }] }], happy: [{ venue, hours }], happyNote }. Nothing else in the file is used.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const parse = (iso) => { const [y, m, d] = String(iso).split("-").map(Number); return new Date(y, m - 1, d); };
  const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // only web links: a listing's source can't be a javascript: address
  const safe = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch (e) { return ""; } };
  const link = (txt, url) => (safe(url) ? `<a href="${esc(safe(url))}" target="_blank" rel="noopener nofollow">${txt}</a>` : txt);

  function failed() {
    $("dt-main").innerHTML = `<p class="dt-note">This week's listings aren't available right now. Please try again later.</p>`;
    $("dt-chips").innerHTML = ""; $("dt-q").hidden = true; $("dt-count").textContent = "";
  }

  // the file is replaced each week: ask the server every time rather than reuse a stored copy
  fetch("week.json", { cache: "no-store" })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((W) => { if (!W || !Array.isArray(W.days) || !W.days.length) throw new Error("no days"); start(W); })
    .catch(failed);

  function start(W) {
    const days = W.days.filter((d) => d && /^\d{4}-\d{2}-\d{2}/.test(d.date || "")).map((d) => ({ ...d, events: Array.isArray(d.events) ? d.events : [] }));
    const film = Array.isArray(W.film) ? W.film.map((v) => ({ ...v, films: Array.isArray(v.films) ? v.films : [] })) : [];
    const happy = Array.isArray(W.happy) ? W.happy : [];
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

    const now = new Date(); now.setHours(0, 0, 0, 0);
    days.forEach((d) => { d.d = parse(d.date); d.key = DOW[d.d.getDay()].toLowerCase(); d.today = +d.d === +now; });
    const first = days[0].d, last = days[days.length - 1].d;
    $("dt-range").innerHTML = `Week of <b>${MON[first.getMonth()]} ${first.getDate()} – ${MON[last.getMonth()]} ${last.getDate()}, ${last.getFullYear()}</b>`;

    const views = [{ key: "week", label: "All week" },
      ...days.map((d) => ({ key: d.key, label: DOW[d.d.getDay()], small: md(d.d), today: d.today })),
      { key: "food", label: "Markets & food" }, { key: "film", label: "Film" }, { key: "happy", label: "Happy hours" }];
    const keys = views.map((v) => v.key);
    let view = keys.includes(location.hash.slice(1)) ? location.hash.slice(1) : (days.find((d) => d.today)?.key || "week");
    let q = "";

    const chips = () => {
      $("dt-chips").innerHTML = views.map((v) =>
        `<button type="button" class="chip${v.today ? " today" : ""}" data-k="${v.key}" aria-pressed="${v.key === view}">${v.label}${v.small ? ` <small>${v.small}</small>` : ""}${v.today ? '<span class="vh"> (today)</span>' : ""}</button>`).join("");
    };
    const match = (...f) => !q || f.some((s) => s && String(s).toLowerCase().includes(q.toLowerCase()));

    function dayBlock(d, foodOnly) {
      const ev = d.events.filter((e) => e && (!foodOnly || e.tag === "food") && match(e.venue, e.title, e.time));
      if ((q || foodOnly) && !ev.length) return "";
      const rows = ev.map((e) => `<li class="dt-row"><div class="dt-venue">${venueHtml(e.venue, q)}</div><div class="dt-what">${link(hi(e.title, q), e.source)}${e.tag === "food" ? ' <span class="dt-tag">food</span>' : ""}</div><div class="dt-when">${esc(e.time || "")}</div></li>`).join("");
      return `<section class="dt-block" id="d-${d.key}"><div class="dt-band"><h2>${FULL[d.d.getDay()]} ${md(d.d)}</h2>${d.today ? '<span class="now">Today</span>' : `<span>${ev.length} ${ev.length === 1 ? "pick" : "picks"}</span>`}</div><ol class="dt-rows">${rows || '<li class="dt-empty">Nothing listed.</li>'}</ol></section>`;
    }
    function filmBlock() {
      const parts = film.map((v) => {
        const fs = v.films.filter((f) => f && match(v.venue, f.title, f.times));
        if (!fs.length) return "";
        return `<div class="dt-subh">${hi(v.venue, q)}${v.note ? " · " + esc(v.note) : ""}</div><ol class="dt-rows">${fs.map((f) => `<li class="dt-row"><div class="dt-what" style="grid-column:1/3">${link(hi(f.title, q), f.source)}</div><div class="dt-when">${esc(f.times || "")}</div></li>`).join("")}</ol>`;
      }).join("");
      return parts ? `<section class="dt-block" id="d-film"><div class="dt-band"><h2>Film</h2><span>Playing this week</span></div>${parts}</section>` : "";
    }
    function happyBlock() {
      const hs = happy.filter((h) => h && match(h.venue, h.hours));
      return hs.length ? `<section class="dt-block" id="d-happy"><div class="dt-band"><h2>Happy hours</h2><span>${esc(W.happyNote || "Downtown")}</span></div><ol class="dt-rows">${hs.map((h) => `<li class="dt-row"><div class="dt-what" style="grid-column:1/3;font-weight:600">${hi(h.venue, q)}</div><div class="dt-when">${esc(h.hours)}</div></li>`).join("")}</ol></section>` : "";
    }

    function render() {
      chips();
      let html;
      if (view === "week") html = days.map((d) => dayBlock(d)).join("") + filmBlock() + happyBlock();
      else if (view === "food") html = days.map((d) => dayBlock(d, true)).join("");
      else if (view === "film") html = filmBlock();
      else if (view === "happy") html = happyBlock();
      else html = dayBlock(days.find((d) => d.key === view));
      $("dt-main").innerHTML = html || `<p class="dt-empty">${q ? `No matches for “${esc(q)}”. Try a venue name or a shorter word.` : "Nothing listed."}</p>`;
      const total = days.reduce((n, d) => n + d.events.length, 0);
      $("dt-count").textContent = `${total} events across ${days.length} days, plus ${film.reduce((n, v) => n + v.films.length, 0)} films and ${happy.length} happy hours.`;
    }

    $("dt-chips").addEventListener("click", (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      view = b.dataset.k;
      try { history.replaceState(null, "", "#" + view); } catch (_) { /* file:// */ }
      render();
    });
    $("dt-q").addEventListener("input", (e) => { q = e.target.value.trim(); if (q && view !== "week") view = "week"; render(); });
    render();
  }
})();
