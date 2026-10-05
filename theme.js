// Runs before first paint: the viewer's theme, and refusing to be shown inside another site's frame
// (clickjacking: a hidden Billd under someone else's buttons). GitHub Pages can't send the
// frame-ancestors header, so this is done here.
(function () {
  try { const t = localStorage.getItem("billd-theme"); if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; } catch (e) { /* storage blocked */ }
  if (window.top !== window.self && location.protocol === "https:" && !/claude/i.test(location.hostname)) {
    document.documentElement.style.display = "none";
    try { window.top.location.replace(location.href); } catch (e) { /* the framing page blocks navigation: stay hidden */ }
  }
})();
