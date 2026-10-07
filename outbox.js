// The offline diary: logging a show, editing or deleting an entry, and marking a show (seen, liked,
// rated, want to see) work without a connection. A change that can't reach Billd's server is kept
// on this device in an outbox and sent when the connection is back, in the order it was made.
// The member's own diary, marks, lists and follows are also kept from each load, so their diary
// opens offline: in the app, on the phone; on the website only for the browser session (sessionStorage),
// so a shared computer doesn't keep a member's private entries. Logging out (or deleting the account)
// clears the member's copy and their waiting changes (app.js warns first if some haven't been sent).
// Each waiting change belongs to the member who made it and is only ever sent as that member.
// Used by the website and the apps alike (social.js's server backend only: the preview mode already
// keeps everything on the device).
//
// Conflicts: the last change wins. An entry edited on this device and, later, somewhere else is left
// as the other change made it, and this device's version is kept for the member to choose
// (Settings → "Saved on this device"); an entry edited here but deleted elsewhere is saved again as a
// new entry. Nothing made on this device is dropped without the member seeing it.
//
// window.BilldOutbox: count(), problems(), flush(), retry(id), discard(id), keepMine(id), onChange(fn)
"use strict";
(function () {
  const S = window.BilldSocial;
  const N = window.BilldNative || { prefs: { get: () => null, set() {}, remove() {}, restore: async () => null }, onResume() {} };
  const listeners = new Set();
  const emit = (info) => listeners.forEach((f) => { try { f(info || {}); } catch (e) { console.error(e); } });
  if (!S || S.kind === "local") {
    window.BilldOutbox = { count: () => 0, items: () => [], problems: () => [], flush: async () => 0, retry() {}, discard() {}, keepMine() {}, onChange: (f) => listeners.add(f) };
    return;
  }
  const KEY = "billd-outbox-v1";
  const CACHE = "billd-mine-v1:";
  const now = () => new Date().toISOString();
  const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const uid = () => S.me()?.id || null;
  const t = (iso) => (iso ? Date.parse(iso) : 0);  // the server writes +00:00, this device Z
  // no point asking the server: no connection, or signed in from the kept session until it renews (social.js)
  const live = () => navigator.onLine && !S.isOffline?.();
  // an expired or rejected session (PostgREST 401: PGRST301/302) isn't a refusal: wait for it to renew
  const authErr = (e) => e?.status === 401 || /^(PGRST30[0-9]|401)$/.test(String(e?.code || "")) || /JWT|not authenticated|invalid claim|session (missing|expired)/i.test(e?.message || "");
  const offlineErr = (e) => !navigator.onLine || e?.code === "unavailable" || /Failed to fetch|NetworkError|Load failed|network/i.test(e?.message || "");

  // ---- stored state: { ops: [...], problems: [...] }, each op tagged with its member
  // Only well-formed changes are read back: a damaged queue never stops Billd opening.
  const isObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
  function validOp(o) {
    if (!isObj(o) || typeof o.uid !== "string" || !o.uid || typeof o.id !== "string") return false;
    if (o.kind === "insert") return isObj(o.row) && typeof o.row.play_id === "string" && typeof o.tempId === "string" && o.tempId.startsWith("local-");
    if (o.kind === "update") return isObj(o.row) && o.logId != null && typeof o.logId !== "object";
    if (o.kind === "delete") return o.logId != null && typeof o.logId !== "object";
    if (o.kind === "status") return typeof o.play_id === "string" && isObj(o.patch);
    return false;
  }
  let box = read();
  function read() {
    try {
      const b = JSON.parse(N.prefs.get(KEY) || "null");
      if (isObj(b)) return { ops: Array.isArray(b.ops) ? b.ops.filter(validOp) : [], problems: Array.isArray(b.problems) ? b.problems.filter(validOp) : [] };
    } catch (e) { /* damaged: start again */ }
    return { ops: [], problems: [] };
  }
  function save() { N.prefs.set(KEY, JSON.stringify(box)); emit(); }
  // Billd can be open in several tabs, all sharing one stored queue: every change starts from what's
  // stored now (another tab may have changed it), never from this tab's older copy.
  function sync() { box = read(); }
  // in the app, the native copy when the web view's storage was cleared
  if (!box.ops.length && !box.problems.length) N.prefs.restore(KEY).then((v) => { if (v) { box = read(); emit(); } });
  const mine = () => box.ops.filter((o) => o.uid === uid());

  // ---- the member's own data as last loaded: kept on the phone in the app; on the website only for
  // this browser session (it holds private and friends-only entries)
  const store = (() => { try { return N.isApp ? localStorage : sessionStorage; } catch (e) { return null; } })();
  const cacheGet = () => { try { const c = JSON.parse(store?.getItem(CACHE + uid()) || "null"); return isObj(c) ? c : {}; } catch (e) { return {}; } };
  function cacheSet(patch) {
    if (!uid() || !store) return;
    try { store.setItem(CACHE + uid(), JSON.stringify({ ...cacheGet(), ...patch, at: now() })); }
    catch (e) { /* storage full: the diary just won't open offline */ }
  }
  // log out, account deleted: nothing of this member's stays on the device
  function forgetMember(id) {
    if (!id) return;
    for (const st of [(() => { try { return localStorage; } catch (e) { return null; } })(), (() => { try { return sessionStorage; } catch (e) { return null; } })()]) {
      try { st?.removeItem(CACHE + id); } catch (e) { /* blocked */ }
    }
    sync();
    box.ops = box.ops.filter((o) => o.uid !== id); box.problems = box.problems.filter((o) => o.uid !== id);
    if (box.ops.length || box.problems.length) save(); else { N.prefs.remove(KEY); emit(); }
  }
  // an account change (log out, another member logs in) stops a send in progress
  let generation = 0;
  // the member's copy in this tab's session storage goes when they're no longer signed in here,
  // whichever tab they logged out in
  const dropTabCopy = (id) => { try { if (id) sessionStorage.removeItem(CACHE + id); } catch (e) { /* blocked */ } };
  let lastUid = uid();
  S.onAuth(() => { generation++; const id = uid(); if (lastUid && lastUid !== id) dropTabCopy(lastUid); lastUid = id; sync(); emit(); });
  window.addEventListener("storage", (e) => {
    if (e.key === KEY || e.key === null) { sync(); emit(); }  // another tab changed the queue (or logged out)
    if ((e.key === null || /^sb-.*-auth-token$/.test(e.key || "")) && !e.newValue) dropTabCopy(uid());  // logged out in another tab
  });

  // the raw server calls
  const raw = {};
  for (const k of ["saveLog", "deleteLog", "setStatus", "status", "getLog", "logsForUser", "logsForPlay", "statusesFor", "myStatuses", "listsForUser", "following", "followers", "getProfile", "signOut", "deleteAccount"]) raw[k] = S[k].bind(S);
  S.signOut = async () => { const id = uid(); generation++; try { await raw.signOut(); } finally { forgetMember(id); } };
  S.deleteAccount = async (username) => { const id = uid(); await raw.deleteAccount(username); generation++; forgetMember(id); };

  // ---- how a waiting change looks on the page
  const author = () => { const p = S.me() || {}; return { id: p.id, username: p.username, display_name: p.display_name }; };
  const pendingLog = (op) => ({ ...(op.prev || {}), ...op.row, id: op.kind === "insert" ? op.tempId : op.logId, user_id: op.uid,
    created_at: op.prev?.created_at || op.at, updated_at: op.at, profile: author(), likes: op.prev?.likes || 0, comments: op.prev?.comments || 0, liked_by_me: false, pending: true });
  // the same rules as the server's setStatus (social.js)
  function nextStatus(cur, patch) {
    const s = { seen: false, liked: false, want: false, rating: null, ...(cur || {}), ...patch };
    if (patch.seen === false) { s.rating = null; s.liked = false; }
    if (s.rating || s.liked) s.seen = true;
    if (s.seen && patch.want === undefined) s.want = false;
    return !s.seen && !s.liked && !s.want && !s.rating ? null : s;
  }
  function overlayLogs(logs) {
    const ops = mine();
    let out = logs.filter((l) => !ops.some((o) => o.kind === "delete" && o.logId === l.id));
    out = out.map((l) => { const u = ops.find((o) => o.kind === "update" && o.logId === l.id); return u ? pendingLog({ ...u, prev: l }) : l; });
    const ins = ops.filter((o) => o.kind === "insert").map(pendingLog).reverse();
    return ins.concat(out);
  }
  function overlayStatuses(map) {
    const out = { ...map };
    for (const o of mine()) if (o.kind === "status") { const s = nextStatus(out[o.play_id], o.patch); if (s) out[o.play_id] = { play_id: o.play_id, ...s, pending: true }; else delete out[o.play_id]; }
    return out;
  }

  // ---- queueing
  function queueLog(row) {
    const me = uid();
    sync();
    if (row.id && String(row.id).startsWith("local-")) {  // a change to an entry that hasn't reached the server yet
      const op = box.ops.find((o) => o.kind === "insert" && o.tempId === row.id && o.uid === me);
      if (!op) throw Object.assign(new Error("That entry no longer exists."), { code: "not_found" });
      const { id, ...rest } = row; Object.assign(op.row, rest); op.at = now(); save(); return pendingLog(op);
    }
    if (row.id) {
      const prev = (cacheGet().logs || []).find((l) => l.id === row.id) || null;
      let op = box.ops.find((o) => o.kind === "update" && o.logId === row.id && o.uid === me);
      const { id, ...rest } = row;
      if (op) { Object.assign(op.row, rest); op.at = now(); }
      else { op = { id: rid(), uid: me, kind: "update", logId: row.id, row: rest, at: now(), base: prev?.updated_at || null, prev }; box.ops.push(op); }
      save(); return pendingLog(op);
    }
    const op = { id: rid(), uid: me, kind: "insert", tempId: "local-" + rid(), row: { ...row }, at: now() };
    box.ops.push(op); save(); return pendingLog(op);
  }
  // writes: try the server; with no connection, keep the change here
  S.saveLog = async (row) => {
    if (!uid()) return raw.saveLog(row);
    if (row.id && String(row.id).startsWith("local-")) return queueLog(row);
    if (!live()) return queueLog(row);
    try { const saved = await raw.saveLog(row); remember(saved); return saved; }
    catch (e) { if (offlineErr(e)) return queueLog(row); throw e; }
  };
  S.deleteLog = async (logId) => {
    if (!uid()) return raw.deleteLog(logId);
    if (String(logId).startsWith("local-")) { sync(); box.ops = box.ops.filter((o) => !(o.kind === "insert" && o.tempId === logId && o.uid === uid())); save(); return { queued: false }; }
    const queue = () => {
      sync();
      box.ops = box.ops.filter((o) => !(o.kind === "update" && o.logId === logId && o.uid === uid()));
      box.ops.push({ id: rid(), uid: uid(), kind: "delete", logId, at: now() }); save();
      return { queued: true };
    };
    if (!live()) return queue();
    try { await raw.deleteLog(logId); forget(logId); return { queued: false }; }
    catch (e) { if (offlineErr(e)) return queue(); throw e; }
  };
  S.setStatus = async (playId, patch) => {
    if (!uid()) return raw.setStatus(playId, patch);
    const queue = () => {
      sync();
      const statuses = overlayStatuses(cacheGet().statuses || {});
      const s = nextStatus(statuses[playId], patch);
      const op = box.ops.find((o) => o.kind === "status" && o.play_id === playId && o.uid === uid());
      if (op) { Object.assign(op.patch, patch); op.at = now(); } else box.ops.push({ id: rid(), uid: uid(), kind: "status", play_id: playId, patch: { ...patch }, at: now() });
      save();
      return s ? { play_id: playId, ...s, pending: true } : null;
    };
    if (!live()) return queue();
    try {
      const s = await raw.setStatus(playId, patch);
      const st = { ...(cacheGet().statuses || {}) }; if (s) st[playId] = s; else delete st[playId]; cacheSet({ statuses: st });
      return s;
    } catch (e) { if (offlineErr(e)) return queue(); throw e; }
  };
  function remember(log) {
    if (!log) return;
    const logs = (cacheGet().logs || []).filter((l) => l.id !== log.id);
    cacheSet({ logs: [log, ...logs] });
  }
  function forget(logId) { cacheSet({ logs: (cacheGet().logs || []).filter((l) => l.id !== logId) }); }

  // ---- reads: the server when it answers (and keep a copy), the copy when it doesn't
  const isMe = (id) => id && id === uid();
  async function through(fetcher, key, fallback) {
    if (!live()) return key in cacheGet() ? cacheGet()[key] : fallback;
    try { const v = await fetcher(); cacheSet({ [key]: v }); return v; }
    catch (e) { if (offlineErr(e) && key in cacheGet()) return cacheGet()[key]; if (offlineErr(e) && fallback !== undefined) return fallback; throw e; }
  }
  S.myStatuses = async () => {
    if (!uid()) return raw.myStatuses();
    return overlayStatuses(await through(() => raw.myStatuses(), "statuses", {}));
  };
  S.status = async (playId) => {
    if (!uid() || live()) { try { return await raw.status(playId); } catch (e) { if (!offlineErr(e)) throw e; } }
    return overlayStatuses(cacheGet().statuses || {})[playId] || null;
  };
  S.statusesFor = async (userId) => {
    if (!isMe(userId)) return raw.statusesFor(userId);
    let base;
    try { if (!live()) throw Object.assign(new Error("offline"), { code: "unavailable" }); base = await raw.statusesFor(userId); const m = {}; base.forEach((r) => (m[r.play_id] = r)); cacheSet({ statuses: { ...(cacheGet().statuses || {}), ...m } }); }
    catch (e) { if (!offlineErr(e)) throw e; base = Object.entries(cacheGet().statuses || {}).map(([play_id, s]) => ({ play_id, ...s })); }
    const map = {}; base.forEach((r) => (map[r.play_id] = r));
    return Object.values(overlayStatuses(map)).map((r) => ({ updated_at: r.updated_at || now(), ...r }));
  };
  S.logsForUser = async (userId, opts) => {
    if (!isMe(userId)) return raw.logsForUser(userId, opts);
    let logs;
    try { if (!live()) throw Object.assign(new Error("offline"), { code: "unavailable" }); logs = await raw.logsForUser(userId, opts); if (!opts?.limit || opts.limit >= 500) cacheSet({ logs }); }
    catch (e) {
      if (!offlineErr(e)) throw e;
      // no copy here (on the website: a tab opened while offline): say so, rather than show an empty diary
      if (!("logs" in cacheGet())) throw Object.assign(new Error(N.isApp
        ? "Your diary hasn't been saved on this phone yet, so it can't be shown without a connection. It will show when you're back online."
        : "Without a connection, your diary shows only in a tab where you opened Billd while online. Nothing is lost: it will show when you're back online."), { code: "no_copy" });
      logs = (cacheGet().logs || []).slice(0, opts?.limit || 500);
    }
    return overlayLogs(logs);
  };
  S.logsForPlay = async (playId, opts) => {
    try { if (!live() && uid()) throw Object.assign(new Error("offline"), { code: "unavailable" }); return overlayLogs(await raw.logsForPlay(playId, opts)).filter((l) => l.play_id === playId); }
    catch (e) { if (!offlineErr(e) || !uid()) throw e; return overlayLogs(cacheGet().logs || []).filter((l) => l.play_id === playId); }
  };
  S.getLog = async (logId) => {
    if (String(logId).startsWith("local-")) { const op = mine().find((o) => o.kind === "insert" && o.tempId === logId); return op ? pendingLog(op) : null; }
    const pend = mine().find((o) => o.kind === "update" && String(o.logId) === String(logId));
    try { if (!live()) throw Object.assign(new Error("offline"), { code: "unavailable" }); const l = await raw.getLog(logId); return pend && l ? pendingLog({ ...pend, prev: l }) : l; }
    catch (e) {
      if (!offlineErr(e)) throw e;
      const l = (cacheGet().logs || []).find((x) => String(x.id) === String(logId));
      return pend ? pendingLog({ ...pend, prev: l }) : l || null;
    }
  };
  S.listsForUser = (userId) => (isMe(userId) ? through(() => raw.listsForUser(userId), "lists", []) : raw.listsForUser(userId));
  S.following = (userId) => (isMe(userId) ? through(() => raw.following(userId), "following", []) : raw.following(userId));
  S.followers = (userId) => (isMe(userId) ? through(() => raw.followers(userId), "followers", []) : raw.followers(userId));
  S.getProfile = async (username) => {
    const me = S.me();
    if (!live() && me && String(username).toLowerCase() === me.username) return me;
    try { return await raw.getProfile(username); }
    catch (e) { if (offlineErr(e) && me && String(username).toLowerCase() === me.username) return me; throw e; }
  };

  // ---- sending
  // One tab sends at a time (a lock shared by the tabs), and each change is checked against the stored
  // queue just before it goes, so a change another tab already sent is never sent twice.
  let flushing = null;
  let authWait = false;  // the last send was refused for the session (401): waiting for the login to renew
  // where the browser has no such lock (an old browser, a page not served over https), a short-lived
  // note in storage says which tab is sending; the others leave the sending to it
  const TAB = rid(), LEASE = "billd-outbox-sending";
  function lease() {
    try {
      const l = JSON.parse(localStorage.getItem(LEASE) || "null");
      if (l && l.tab !== TAB && l.until > Date.now()) return false;
      localStorage.setItem(LEASE, JSON.stringify({ tab: TAB, until: Date.now() + 30000 }));
      return JSON.parse(localStorage.getItem(LEASE)).tab === TAB;
    } catch (e) { return true; }  // storage blocked: this tab is the only one that can send
  }
  const unlease = () => { try { if (JSON.parse(localStorage.getItem(LEASE) || "null")?.tab === TAB) localStorage.removeItem(LEASE); } catch (e) { /* blocked */ } };
  const exclusive = (fn) => {
    if (navigator.locks?.request) return navigator.locks.request("billd-outbox-send", fn);
    if (!lease()) return Promise.resolve(0);
    // tabs see each other's storage a moment late: wait, then check the turn is still this tab's
    return new Promise((r) => setTimeout(r, 120 + Math.random() * 180)).then(() => {
      try { if (JSON.parse(localStorage.getItem(LEASE) || "null")?.tab !== TAB) return 0; } catch (e) { /* blocked: send */ }
      return Promise.resolve().then(fn).finally(unlease);
    });
  };
  // take a change out of the stored queue (by id: another tab may have stored its own copy since)
  function drop(op, problem) {
    sync();
    if (problem) box.problems.push({ ...op, ...problem });
    box.ops = box.ops.filter((o) => o.id !== op.id); save();
  }
  function flush() {
    if (flushing) return flushing;
    if (!live() || !uid() || !mine().length) return Promise.resolve(0);
    flushing = exclusive(async () => {
      let sent = 0;
      authWait = false;
      const notices = [];
      const gen = generation, owner = uid();
      sync();
      // before each request: the same member is still signed in, and the change is still waiting
      // (a log out, in any tab, empties the queue). Otherwise stop: nothing is ever sent as someone else.
      const ABORT = { abort: true };
      const go = (op) => {
        if (generation !== gen || uid() !== owner || op.uid !== owner) throw ABORT;
        if (!navigator.locks?.request && !lease()) throw ABORT;  // another tab took over the sending
        sync();
        const cur = box.ops.find((o) => o.id === op.id && o.uid === owner);
        if (!cur) throw ABORT;
        return cur;
      };
      for (const waiting of mine()) {
        let op = waiting;
        try {
          op = go(op);
          if (op.kind === "insert") {
            const saved = await raw.saveLog(op.row);
            remember(saved);
            if (saved?.held) notices.push("held");
          } else if (op.kind === "update") {
            let cur = null;
            try { cur = await raw.getLog(op.logId); } catch (e) { if (offlineErr(e) || authErr(e)) throw e; }
            op = go(op);
            if (!cur) {  // deleted somewhere else meanwhile: keep this device's version as a new entry
              remember(await raw.saveLog(op.row));
              notices.push("readded");
            } else if (cur.updated_at && t(cur.updated_at) !== t(op.base) && t(cur.updated_at) > t(op.at)) {
              // changed somewhere else after this device's edit: that later change stays, and this
              // device's version waits for the member to choose
              drop(op, { problem: "conflict", server: cur, note: "This entry was changed on another device after you edited it here." });
              continue;
            } else remember(await raw.saveLog({ ...op.row, id: op.logId }));
          } else if (op.kind === "delete") {
            await raw.deleteLog(op.logId); forget(op.logId);
          } else if (op.kind === "status") {
            await raw.setStatus(op.play_id, op.patch);
          }
          drop(op); sent++;
        } catch (e) {
          if (e === ABORT) { if (generation !== gen || uid() !== owner) break; continue; }  // the account changed: the rest waits for its own member
          // no connection, or the session needs renewing: try again later (the minute timer, or the next login)
          if (authErr(e)) { authWait = true; break; }
          if (offlineErr(e) || e?.code === "signed_out") break;
          sync();
          if (!box.ops.some((o) => o.id === op.id)) break;
          // refused (the account is suspended, the show was removed…): kept, for the member to see
          drop(op, { problem: "refused", note: e.message || String(e) });
        }
      }
      if (sent || notices.length || authWait) emit({ sent, notices });
      return sent;
    }).finally(() => { flushing = null; });
    return flushing;
  }
  window.addEventListener("online", () => setTimeout(flush, 800));
  N.onResume?.(() => flush());
  setInterval(() => { if (S.isOffline?.() && navigator.onLine) S.recover?.(); else if (mine().length && navigator.onLine) flush(); }, 60000);
  S.ready.then(() => flush()).catch(() => {});
  S.onAuth(() => setTimeout(flush, 300));

  const mineProblems = () => box.problems.filter((p) => p.uid === uid());
  window.BilldOutbox = {
    // waiting changes as the member sees them: a show logged here and its mark (seen, rated) are one
    count: () => { const ops = mine(); const logged = new Set(ops.filter((o) => o.kind === "insert").map((o) => o.row.play_id)); return ops.filter((o) => !(o.kind === "status" && logged.has(o.play_id))).length; },
    waitingForLogin: () => authWait && mine().length > 0,
    items: () => mine().map((o) => ({ ...o })),
    problems: () => mineProblems().map((p) => ({ ...p })),
    flush,
    // send a refused change again
    retry(id) { sync(); const p = box.problems.find((x) => x.id === id && x.uid === uid()); if (!p) return; box.problems = box.problems.filter((x) => x !== p); const { problem, note, server, ...op } = p; box.ops.push({ ...op, at: now() }); save(); return flush(); },
    // keep this device's version of a conflicting entry: it becomes the latest change
    keepMine(id) { sync(); const p = box.problems.find((x) => x.id === id && x.uid === uid()); if (!p) return; box.problems = box.problems.filter((x) => x !== p); const { problem, note, server, ...op } = p; box.ops.push({ ...op, base: server?.updated_at || op.base, at: now() }); save(); return flush(); },
    discard(id) { const me = uid(); sync(); box.problems = box.problems.filter((x) => !(x.id === id && x.uid === me)); box.ops = box.ops.filter((x) => !(x.id === id && x.uid === me)); save(); },
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
  };
})();
