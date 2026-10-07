// The page Billd's email links open in a browser: https://billd.theater/auth/confirm.html
//
// Two kinds of link arrive here (docs/app-build.md, "Email links"):
//   - ?token_hash=…&type=email|signup|recovery|email_change: the newer email templates link here
//     directly; this page verifies the link with Supabase, which signs the member in, then opens Billd
//   - #access_token=… (or #error=…): today's links go through Supabase first, which sends the
//     session back in the address; this page hands it to Billd's main page, which reads it as before
// With the Billd app installed, the phone opens these links in the app instead (web/native.js).
"use strict";
(function () {
  const $ = (s) => document.querySelector(s);
  const home = new URL("../", location.href).href;
  function show(kicker, title, text, go) {
    $("#cf-kicker").textContent = kicker; $("#cf-title").textContent = title; $("#cf-text").textContent = text || "";
    document.title = `${title} · Billd`;
    if (go) { $("#cf-go").href = go.href; $("#cf-go").textContent = go.label; $("#cf-go").hidden = false; }
    $("#cf-title").focus();
  }
  const q = new URLSearchParams(location.search);
  const hash = location.hash.replace(/^#/, "");
  // today's links: Supabase has verified it already; Billd's page signs in from the address
  if (/(^|&)(access_token|error|error_description)=/.test(hash)) { location.replace(home + "#" + hash); return; }
  const tokenHash = q.get("token_hash");
  const types = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];
  const type = types.includes(q.get("type")) ? q.get("type") : "email";
  const cfg = (window.DQ_CONFIG || {}).supabase;
  if (!tokenHash) { location.replace(home); return; }
  // the link's secret shouldn't stay in the address bar or the history
  history.replaceState(null, "", location.pathname);
  if (!cfg || !window.supabase) { show("Sorry", "That link can't be checked here", "Billd's server isn't connected on this copy of the site.", { href: home, label: "Open Billd" }); return; }
  const sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false } });
  sb.auth.verifyOtp({ token_hash: tokenHash, type }).then(({ error }) => {
    // supabase-js reports a failed connection as an error too (it doesn't reject)
    if (error && (error.name === "AuthRetryableFetchError" || error.status === 0 || /fetch|network|load failed/i.test(error.message || ""))) {
      show("Sorry", "Billd's server couldn't be reached", "Check your connection, then open the link in the email again. It hasn't been used up.", { href: home, label: "Open Billd" });
      return;
    }
    if (error) {
      show("Sorry", "That link didn't work", "It may have expired, or been used already. Log in, or ask Billd for a new link (Log in → Forgot password?).", { href: home, label: "Open Billd" });
      return;
    }
    if (type === "recovery") {
      try { sessionStorage.setItem("billd-recovery", "1"); } catch (e) { /* the page still opens Settings */ }
      show("Reset your password", "Choose a new password", "You're signed in. Billd's Settings page is opening, where you can set a new password.");
      setTimeout(() => location.replace(home + "#/settings"), 900);
      return;
    }
    show(type === "email_change" ? "Email changed" : "Welcome to Billd", "Your email address is confirmed", "You're signed in. Billd is opening…");
    setTimeout(() => location.replace(home + "#/"), 1200);
  }, () => show("Sorry", "Billd's server couldn't be reached", "Check your connection, then open the link in the email again.", { href: home, label: "Open Billd" }));
})();
