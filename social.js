// Billd social layer: accounts, the shows each member has seen, ratings, diary
// entries and reviews, likes, lists and follows.
//
// Two backends with the same interface:
//   - Supabase, when config.js names a project (window.DQ_CONFIG.supabase = { url, anonKey }).
//     Everyone shares one database; supabase/schema.sql creates it with row-level security
//     so members can read everything public but change only their own rows.
//   - Local, otherwise: one member ("you") whose activity is kept in this browser's
//     storage. It lets the site work before the server is set up, and what it holds
//     can be moved to an account later (importLocal).
//
// Ratings are stored as 1-10 (half stars); the page shows them as 0.5-5 stars.
"use strict";
(function () {
  const cfg = (window.DQ_CONFIG || {}).supabase || null;
  const SUPABASE_JS = "supabase.js";  // @supabase/supabase-js 2.117.2 (dist/umd), served with the site rather than from a CDN
  const USERNAME = /^[a-z0-9_]{3,20}$/;
  // each backend has its own listeners, so clearing the device's preview diary after moving it
  // to an account doesn't announce the local "you" as the signed-in member
  function bus() {
    const listeners = new Set();
    return { listeners, emit: (me) => listeners.forEach((f) => { try { f(me); } catch (e) { console.error(e); } }) };
  }
  const err = (message, code) => Object.assign(new Error(message), { code });

  // ---------------------------------------------------------------- local
  const LS_KEY = "billd-local-v1";
  function localBackend() {
    const { listeners, emit } = bus();
    let db;
    const empty = () => ({ profile: { id: "local", username: "you", display_name: "", bio: "", favorites: [], created_at: new Date().toISOString() },
                           status: {}, logs: [], lists: [], seq: 1 });
    try { db = JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch (e) { db = null; }
    db = db || empty();
    const save = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(db)); } catch (e) { /* private mode: kept for this visit only */ } };
    const id = () => db.seq++;
    const me = () => db.profile;
    const author = () => ({ id: "local", username: db.profile.username, display_name: db.profile.display_name });
    const withAuthor = (l) => ({ ...l, profile: author(), likes: 0, liked_by_me: false, comments: 0 });
    const listOut = (l) => ({ ...l, profile: author(), count: l.items.length, likes: 0, liked_by_me: false });
    return {
      kind: "local",
      ready: Promise.resolve(),
      me: () => me(),
      isLocalData: () => db.logs.length + Object.keys(db.status).length + db.lists.length > 0,
      async signUp() { throw err("Accounts are not set up on this site yet.", "no_server"); },
      async signIn() { throw err("Accounts are not set up on this site yet.", "no_server"); },
      async signOut() {},
      async resetPassword() { throw err("Accounts are not set up on this site yet.", "no_server"); },
      async updateProfile(p) { Object.assign(db.profile, p); save(); emit(me()); return me(); },
      async getProfile(username) { return username === db.profile.username ? me() : null; },
      async members() { return [me()]; },
      async status(playId) { return db.status[playId] || null; },
      async myStatuses() { return { ...db.status }; },
      async statusesFor(userId) { return userId === "local" ? Object.entries(db.status).map(([play_id, s]) => ({ play_id, ...s })) : []; },
      async setStatus(playId, patch) {
        const s = { seen: false, liked: false, want: false, rating: null, ...(db.status[playId] || {}), ...patch, updated_at: new Date().toISOString() };
        if (patch.seen === false) { s.rating = null; s.liked = false; }
        if (s.rating || s.liked) s.seen = true;
        if (s.seen && patch.want === undefined) s.want = false;
        if (!s.seen && !s.liked && !s.want && !s.rating) delete db.status[playId]; else db.status[playId] = s;
        save(); return db.status[playId] || null;
      },
      async saveLog(log) {
        const now = new Date().toISOString();
        if (log.id) {
          const i = db.logs.findIndex((l) => l.id === log.id);
          if (i < 0) throw err("That entry no longer exists.", "not_found");
          db.logs[i] = { ...db.logs[i], ...log, updated_at: now };
          save(); return withAuthor(db.logs[i]);
        }
        const row = { ...log, id: id(), user_id: "local", created_at: now, updated_at: now };
        db.logs.unshift(row); save(); return withAuthor(row);
      },
      async deleteLog(logId) { db.logs = db.logs.filter((l) => l.id !== logId); save(); },
      async getLog(logId) { const l = db.logs.find((x) => x.id === Number(logId)); return l ? withAuthor(l) : null; },
      async logsForPlay(playId) { return db.logs.filter((l) => l.play_id === playId).map(withAuthor); },
      async logsForUser(userId) { return userId === "local" ? db.logs.map(withAuthor) : []; },
      async recentReviews(limit = 20) { return db.logs.filter((l) => l.review).slice(0, limit).map(withAuthor); },
      async feed(limit = 40) { return db.logs.slice(0, limit).map(withAuthor); },
      async recentLogs(limit = 40) { return db.logs.slice(0, limit).map(withAuthor); },
      async recentMarks(limit = 60) {
        return Object.entries(db.status).map(([play_id, st]) => ({ play_id, ...st, user_id: "local", profile: author() }))
          .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, limit);
      },
      async ratedPlays() { return Object.entries(db.status).filter(([, s]) => s.rating).map(([play_id, s]) => ({ play_id, avg_rating: s.rating / 2, ratings: 1, seen: 1 })); },
      async likeLog() { throw err("Liking reviews needs an account.", "no_server"); },
      async comments() { return []; },
      async addComment() { throw err("Comments need an account.", "no_server"); },
      async deleteComment() {},
      async listsForUser(userId) { return userId === "local" ? db.lists.map(listOut) : []; },
      async recentLists() { return db.lists.map(listOut); },
      async listsWithPlay(playId) { return db.lists.filter((l) => l.items.some((i) => i.play_id === playId)).map(listOut); },
      async getList(listId) { const l = db.lists.find((x) => x.id === Number(listId)); return l ? listOut(l) : null; },
      async saveList(list) {
        const now = new Date().toISOString();
        if (list.id) {
          const l = db.lists.find((x) => x.id === list.id); if (!l) throw err("That list no longer exists.", "not_found");
          Object.assign(l, list, { updated_at: now }); save(); return listOut(l);
        }
        const l = { items: [], ranked: false, description: "", ...list, id: id(), user_id: "local", created_at: now, updated_at: now };
        db.lists.unshift(l); save(); return listOut(l);
      },
      async deleteList(listId) { db.lists = db.lists.filter((l) => l.id !== listId); save(); },
      async setListItems(listId, items) {
        const l = db.lists.find((x) => x.id === listId); if (!l) throw err("That list no longer exists.", "not_found");
        l.items = items.map((it, i) => ({ play_id: it.play_id, note: it.note || "", position: i })); l.updated_at = new Date().toISOString(); save();
      },
      async likeList() { throw err("Liking lists needs an account.", "no_server"); },
      async follow() { throw err("Following members needs an account.", "no_server"); },
      async following() { return []; },
      async followers() { return []; },
      async playStats(playId) {
        const s = db.status[playId]; const hist = Array(10).fill(0);
        if (s?.rating) hist[s.rating - 1] = 1;
        return { seen: s?.seen ? 1 : 0, likes: s?.liked ? 1 : 0, wants: s?.want ? 1 : 0, ratings: s?.rating ? 1 : 0,
                 avg: s?.rating ? s.rating / 2 : null, hist, reviews: db.logs.filter((l) => l.play_id === playId && l.review).length };
      },
      async popular() { return []; },
      async fetchProductionPage() { throw err("Adding productions needs Billd's server.", "no_server"); },
      async suggestProduction() { throw err("Adding productions needs Billd's server.", "no_server"); },
      async mySuggestions() { return []; },
      async suggestPlay() { throw err("Suggesting plays needs Billd's server.", "no_server"); },
      async saveFeedback() { throw err("No server.", "no_server"); },
      async myPlaySuggestions() { return []; },
      async importReviewFor() { throw err("The queue of imported shows is kept on Billd's server.", "no_server"); },
      async reviewImport() { throw err("The queue of imported shows is kept on Billd's server.", "no_server"); },
      async heldPosts() { return []; },  // nothing is held on this device
      async reviewHeld() { throw err("Held posts are kept on Billd's server.", "no_server"); },
      // the Billd team and moderation need the server
      role: () => null,
      standing: () => ({ status: "active", note: null }),
      async team() { return []; },
      async settings() { return { require_approval: false }; },
      async report() { throw err("Reporting needs Billd's server.", "no_server"); },
      // blocking, the word list and the Terms need the server; deleting the account erases this device's diary
      async blocks() { return []; },
      async block() { throw err("Blocking needs Billd's server.", "no_server"); },
      async acceptTerms() {},
      setTermsVersion() {},
      async moderationTerms() { throw err("The word filter is kept on Billd's server.", "no_server"); },
      async setModerationTerm() { throw err("The word filter is kept on Billd's server.", "no_server"); },
      async deleteAccount() { db = empty(); save(); emit(me()); },
      exportLocal: () => JSON.parse(JSON.stringify(db)),
      clearLocal() { db = empty(); save(); emit(me()); },
      onAuth(f) { listeners.add(f); return () => listeners.delete(f); },
    };
  }

  // ---------------------------------------------------------------- supabase
  function loadScript(src) {
    return new Promise((ok, fail) => {
      const s = document.createElement("script"); s.src = src; s.async = true;
      s.onload = ok; s.onerror = () => fail(err("Could not reach the Billd server. Check your connection.", "unavailable"));
      document.head.appendChild(s);
    });
  }
  function supabaseBackend() {
    const { listeners, emit } = bus();
    let sb = null, profile = null, uid = null;
    let role = null, standing = { status: "active", note: null };  // the signed-in member's team role and standing
    let termsVersion = null;  // the Terms members must have accepted to post, while they are switched on
    const PROFILE = "profile:profiles!user_id(id,username,display_name)";
    const check = ({ data, error }) => { if (error) throw friendly(error); return data; };
    function friendly(e) {
      const m = e?.message || String(e);
      if (/Invalid login credentials/i.test(m)) return err("That email and password don't match an account.", "bad_login");
      if (/already registered|already exists/i.test(m)) return err("There is already an account with that email. Log in instead.", "exists");
      if (/Email not confirmed/i.test(m)) return err("Confirm your email first: open the link Billd sent you.", "unconfirmed");
      if (/Password should be/i.test(m)) return err("Choose a password of at least 8 characters.", "weak_password");
      // the word filter: posts with a listed word are held for the team, but names and bios are refused
      if (e?.hint === "billd_banned_word" || /filter list|word that isn't allowed on Billd/i.test(m))
        return err(/filter list/i.test(m) ? m : "Usernames, names and bios can't contain a word on Billd's filter list. Please choose different words.", "banned_word");
      // sign-up: the database refused the new profile (the word filter on usernames and names)
      if (/Database error saving new user/i.test(m)) return err("Billd couldn't create that account. If your username or name contains a word on Billd's filter list, please choose another: everyone sees names, so they can't wait for the team to check them.", "signup_refused");
      if (/rate limit/i.test(m)) return err("Too many tries. Wait a few minutes and try again.", "rate_limited");
      if (/profiles_username_key|duplicate key.*username/i.test(m)) return err("That username is taken.", "username_taken");
      if (/row-level security|row level security/i.test(m)) return err(standing.status === "suspended" ? "Your account is suspended, so it can't post." : standing.status === "pending" ? "Your account is waiting for approval. You can post once the Billd team approves it."
        : termsVersion && profile && profile.terms_version !== termsVersion ? "Accept Billd's Terms of Use first: see the note at the top of the page." : "You can't do that. (If you blocked this member, or they blocked you, you can't follow, like or comment.)", "forbidden");
      if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return err("Could not reach the Billd server. Check your connection.", "unavailable");
      return err(m, e?.code || "error");
    }
    // PostgREST returns at most 1,000 rows a request; page through, in a stable order
    async function all(make) {
      const out = [];
      for (let from = 0; ; from += 1000) {
        const rows = check(await make().range(from, from + 999));
        out.push(...rows);
        if (rows.length < 1000) return out;
      }
    }
    const needMe = () => { if (!uid) throw err("Log in to do that.", "signed_out"); return uid; };
    async function loadProfile() {
      if (!uid) { profile = null; role = null; standing = { status: "active", note: null }; return null; }
      const [{ data }, st, ms] = await Promise.all([sb.from("profiles").select("*").eq("id", uid).maybeSingle(),
        sb.from("staff").select("role").eq("user_id", uid).maybeSingle(),
        sb.from("member_status").select("status,note").eq("user_id", uid).maybeSingle()]);
      profile = data || null;
      role = st.data?.role || null;  // the tables are missing on a project not yet updated: no role
      standing = ms.data ? { status: ms.data.status, note: ms.data.note } : { status: "active", note: null };
      return profile;
    }
    const rpc = async (fn, args) => { needMe(); check(await sb.rpc(fn, args)); };
    const ready = loadScript(SUPABASE_JS).then(async () => {
      sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
      const { data } = await sb.auth.getSession();
      uid = data.session?.user?.id || null;
      await loadProfile();
      // supabase-js holds a lock while this runs, so the queries wait until it returns
      sb.auth.onAuthStateChange((_ev, session) => {
        const next = session?.user?.id || null;
        if (next === uid && (profile || !next)) return;
        setTimeout(async () => { uid = next; await loadProfile(); emit(profile); }, 0);
      });
    });
    const shapeLog = (l) => ({ ...l, likes: l.log_likes?.[0]?.count ?? 0, comments: l.log_comments?.[0]?.count ?? 0,
                               liked_by_me: false, log_likes: undefined, log_comments: undefined });
    async function markMine(logs) {
      if (!uid || !logs.length) return logs;
      const mine = check(await sb.from("log_likes").select("log_id").eq("user_id", uid).in("log_id", logs.map((l) => l.id)));
      const set = new Set(mine.map((r) => r.log_id));
      logs.forEach((l) => (l.liked_by_me = set.has(l.id)));
      return logs;
    }
    const LOG_SEL = `*,${PROFILE},log_likes(count),log_comments(count)`;
    const shapeList = (l) => ({ ...l, items: (l.list_items || []).sort((a, b) => a.position - b.position), count: l.list_items?.length ?? 0,
                                likes: l.list_likes?.[0]?.count ?? 0, liked_by_me: false, list_items: undefined, list_likes: undefined });
    const LIST_SEL = `*,${PROFILE},list_items(play_id,position,note,held),list_likes(count)`;
    return {
      kind: "supabase",
      ready,
      me: () => profile,
      isLocalData: () => false,
      async signUp(email, password, username, displayName, termsAccepted) {
        username = String(username || "").toLowerCase();
        if (!USERNAME.test(username)) throw err("Usernames are 3 to 20 letters, numbers or underscores.", "bad_username");
        const taken = check(await sb.from("profiles").select("id").eq("username", username).maybeSingle());
        if (taken) throw err("That username is taken.", "username_taken");
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: { username, display_name: (displayName || "").trim().slice(0, 50) || undefined, terms_version: termsAccepted || undefined }, emailRedirectTo: location.origin + location.pathname } });
        if (error) throw friendly(error);
        if (!data.session) return { confirm: true };  // the project asks new members to confirm their email
        uid = data.user.id; await loadProfile(); emit(profile); return { confirm: false };
      },
      async signIn(email, password) {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw friendly(error);
        uid = data.user.id; await loadProfile(); emit(profile);
      },
      async signOut() { await sb.auth.signOut(); uid = null; profile = null; emit(null); },
      async resetPassword(email) {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname + "#/settings" });
        if (error) throw friendly(error);
      },
      async setPassword(password) { const { error } = await sb.auth.updateUser({ password }); if (error) throw friendly(error); },
      async updateProfile(p) {
        needMe();
        const row = {};
        for (const k of ["display_name", "bio", "favorites", "username"]) if (k in p) row[k] = p[k];
        if (row.username && !USERNAME.test(row.username)) throw err("Usernames are 3 to 20 letters, numbers or underscores.", "bad_username");
        profile = check(await sb.from("profiles").update(row).eq("id", uid).select().single());
        emit(profile); return profile;
      },
      async getProfile(username) { return check(await sb.from("profiles").select("*").eq("username", String(username).toLowerCase()).maybeSingle()); },
      async members(q) {
        let query = sb.from("profiles").select("*").order("created_at", { ascending: false }).limit(60);
        if (q) query = query.or(`username.ilike.%${q.replace(/[%,()]/g, "")}%,display_name.ilike.%${q.replace(/[%,()]/g, "")}%`);
        return check(await query);
      },
      async status(playId) {
        if (!uid) return null;
        return check(await sb.from("play_status").select("*").eq("user_id", uid).eq("play_id", playId).maybeSingle());
      },
      async myStatuses() {
        if (!uid) return {};
        const out = {};
        (await all(() => sb.from("play_status").select("play_id,seen,liked,want,rating,visibility").eq("user_id", uid).order("play_id"))).forEach((r) => (out[r.play_id] = r));
        return out;
      },
      async statusesFor(userId) {
        return all(() => sb.from("play_status").select("play_id,seen,liked,want,rating,updated_at").eq("user_id", userId).order("updated_at", { ascending: false }).order("play_id"));
      },
      async setStatus(playId, patch) {
        needMe();
        const cur = (await this.status(playId)) || { seen: false, liked: false, want: false, rating: null };
        const s = { ...cur, ...patch };
        if (patch.seen === false) { s.rating = null; s.liked = false; }
        if (s.rating || s.liked) s.seen = true;
        if (s.seen && patch.want === undefined) s.want = false;
        if (!s.seen && !s.liked && !s.want && !s.rating) {
          check(await sb.from("play_status").delete().eq("user_id", uid).eq("play_id", playId));
          return null;
        }
        return check(await sb.from("play_status").upsert({ user_id: uid, play_id: playId, seen: s.seen, liked: s.liked, want: s.want,
                                                           rating: s.rating, visibility: s.visibility || "public", updated_at: new Date().toISOString() }).select().single());
      },
      async saveLog(log) {
        needMe();
        const row = {};
        for (const k of ["play_id", "play_title", "seen_on", "rating", "liked", "review", "spoilers", "rewatch", "venue", "city", "visibility"]) if (k in log) row[k] = log[k];
        const q = log.id ? sb.from("logs").update({ ...row, updated_at: new Date().toISOString() }).eq("id", log.id).eq("user_id", uid)
                         : sb.from("logs").insert({ ...row, user_id: uid });
        return shapeLog(check(await q.select(LOG_SEL).single()));
      },
      async deleteLog(logId) { needMe(); check(await sb.from("logs").delete().eq("id", logId).eq("user_id", uid)); },
      async getLog(logId) {
        const l = check(await sb.from("logs").select(LOG_SEL).eq("id", logId).maybeSingle());
        return l ? (await markMine([shapeLog(l)]))[0] : null;
      },
      async logsForPlay(playId, { limit = 50 } = {}) {
        return markMine(check(await sb.from("logs").select(LOG_SEL).eq("play_id", playId).order("created_at", { ascending: false }).limit(limit)).map(shapeLog));
      },
      async logsForUser(userId, { limit = 500 } = {}) {
        const q = () => sb.from("logs").select(LOG_SEL).eq("user_id", userId).order("seen_on", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false }).order("id", { ascending: false });
        const rows = limit > 1000 ? await all(q) : check(await q().limit(limit));
        return markMine(rows.map(shapeLog));
      },
      async recentReviews(limit = 20) {
        return markMine(check(await sb.from("logs").select(LOG_SEL).not("review", "is", null).neq("review", "")
          .order("created_at", { ascending: false }).limit(limit)).map(shapeLog));
      },
      async feed(limit = 50) {
        if (!uid) return [];
        const ids = check(await sb.from("follows").select("followee").eq("follower", uid)).map((r) => r.followee).concat([uid]);
        return markMine(check(await sb.from("logs").select(LOG_SEL).in("user_id", ids).order("created_at", { ascending: false }).limit(limit)).map(shapeLog));
      },
      // shows marked on a play's page (seen, liked, rated, want to see), with or without a diary entry
      async recentMarks(limit = 60, { friends = false } = {}) {
        let q = sb.from("play_status").select(`play_id,seen,liked,want,rating,updated_at,user_id,${PROFILE}`)
          .or("seen.eq.true,want.eq.true").order("updated_at", { ascending: false }).limit(limit);
        if (friends) {
          if (!uid) return [];
          const ids = check(await sb.from("follows").select("followee").eq("follower", uid)).map((r) => r.followee).concat([uid]);
          q = q.in("user_id", ids);
        }
        return check(await q);
      },
      async recentLogs(limit = 40) {
        return markMine(check(await sb.from("logs").select(LOG_SEL).order("created_at", { ascending: false }).limit(limit)).map(shapeLog));
      },
      async ratedPlays() {
        return check(await sb.from("play_stats").select("play_id,avg_rating,ratings,seen").order("seen", { ascending: false }).limit(5000));
      },
      async likeLog(logId, on) {
        needMe();
        if (on) check(await sb.from("log_likes").upsert({ user_id: uid, log_id: logId }));
        else check(await sb.from("log_likes").delete().eq("user_id", uid).eq("log_id", logId));
      },
      async comments(logId) {
        return check(await sb.from("log_comments").select(`*,${PROFILE}`).eq("log_id", logId).order("created_at"));
      },
      async addComment(logId, body) {
        needMe();
        return check(await sb.from("log_comments").insert({ log_id: logId, user_id: uid, body }).select(`*,${PROFILE}`).single());
      },
      async deleteComment(id) { needMe(); check(await sb.from("log_comments").delete().eq("id", id).eq("user_id", uid)); },
      async listsForUser(userId) {
        return check(await sb.from("lists").select(LIST_SEL).eq("user_id", userId).order("updated_at", { ascending: false })).map(shapeList);
      },
      async recentLists(limit = 24) {
        return check(await sb.from("lists").select(LIST_SEL).order("updated_at", { ascending: false }).limit(limit)).map(shapeList);
      },
      async listsWithPlay(playId) {
        const ids = check(await sb.from("list_items").select("list_id").eq("play_id", playId).limit(50)).map((r) => r.list_id);
        if (!ids.length) return [];
        return check(await sb.from("lists").select(LIST_SEL).in("id", ids).order("updated_at", { ascending: false })).map(shapeList);
      },
      async getList(listId) {
        const l = check(await sb.from("lists").select(LIST_SEL).eq("id", listId).maybeSingle());
        if (!l) return null;
        const out = shapeList(l);
        if (uid) out.liked_by_me = !!check(await sb.from("list_likes").select("list_id").eq("user_id", uid).eq("list_id", listId).maybeSingle());
        return out;
      },
      async saveList(list) {
        needMe();
        const row = {};
        for (const k of ["title", "description", "ranked"]) if (k in list) row[k] = list[k];
        const q = list.id ? sb.from("lists").update({ ...row, updated_at: new Date().toISOString() }).eq("id", list.id).eq("user_id", uid)
                          : sb.from("lists").insert({ ...row, user_id: uid });
        return shapeList(check(await q.select(LIST_SEL).single()));
      },
      async deleteList(listId) { needMe(); check(await sb.from("lists").delete().eq("id", listId).eq("user_id", uid)); },
      async setListItems(listId, items) {
        needMe();
        // shows taken off go; the rest are upserted, so a note the team approved, and not changed, stays approved
        const keep = [...new Set(items.map((it) => it.play_id))];
        let del = sb.from("list_items").delete().eq("list_id", listId);
        if (keep.length) del = del.not("play_id", "in", `(${keep.map((id) => `"${String(id).replace(/["\\]/g, "")}"`).join(",")})`);
        check(await del);
        if (items.length) check(await sb.from("list_items").upsert(items.map((it, i) => ({ list_id: listId, play_id: it.play_id, note: it.note || null, position: i })), { onConflict: "list_id,play_id" }));
        check(await sb.from("lists").update({ updated_at: new Date().toISOString() }).eq("id", listId));
      },
      async likeList(listId, on) {
        needMe();
        if (on) check(await sb.from("list_likes").upsert({ user_id: uid, list_id: listId }));
        else check(await sb.from("list_likes").delete().eq("user_id", uid).eq("list_id", listId));
      },
      async follow(userId, on) {
        needMe();
        if (on) check(await sb.from("follows").upsert({ follower: uid, followee: userId }));
        else check(await sb.from("follows").delete().eq("follower", uid).eq("followee", userId));
      },
      async following(userId) {
        return check(await sb.from("follows").select("profile:profiles!followee(id,username,display_name)").eq("follower", userId)).map((r) => r.profile);
      },
      async followers(userId) {
        return check(await sb.from("follows").select("profile:profiles!follower(id,username,display_name)").eq("followee", userId)).map((r) => r.profile);
      },
      async playStats(playId) {
        const r = check(await sb.from("play_stats").select("*").eq("play_id", playId).maybeSingle());
        const hist = Array.from({ length: 10 }, (_, i) => r?.["r" + (i + 1)] || 0);
        return { seen: r?.seen || 0, likes: r?.likes || 0, wants: r?.wants || 0, ratings: r?.ratings || 0,
                 avg: r?.avg_rating != null ? Number(r.avg_rating) : null, hist, reviews: r?.reviews || 0 };
      },
      async popular(limit = 24) { return check(await sb.from("popular_week").select("*").limit(limit)); },
      // "Add a production": the server function reads the page (browsers can't, across sites)
      async fetchProductionPage(url) {
        needMe();
        const { data, error } = await sb.functions.invoke("fetch-production", { body: { url } });
        if (error) {
          let msg = "Billd couldn't read that page. Paste its text instead.";
          try { const b = await error.context?.json?.(); if (b?.error) msg = b.error; } catch (e) { /* keep the general message */ }
          throw err(msg, "fetch_failed");
        }
        return data;
      },
      async suggestProduction(row) {
        needMe();
        const keep = ["play_id", "play_title", "url", "venue", "city", "date_from", "date_to", "directors", "cast_list", "adapters", "language", "notes", "extracted"];
        const out = { user_id: uid };
        for (const k of keep) if (row[k] != null && row[k] !== "") out[k] = row[k];
        return check(await sb.from("production_suggestions").insert(out).select().single());
      },
      // feedback, corrections and copyright reports: anyone may send (no account needed); the team reads them
      async saveFeedback(row) {
        await ready;
        const out = { user_id: uid || null };
        for (const k of ["kind", "play_id", "play_title", "body", "name", "rating", "page"]) if (row[k] != null && row[k] !== "") out[k] = row[k];
        check(await sb.from("feedback").insert(out));
      },
      async feedbackFor(status = "open") {
        let q = sb.from("feedback").select(`*,${PROFILE}`).order("created_at", { ascending: status === "open" }).limit(200);
        if (status !== "all") q = q.eq("status", status);
        return check(await q);
      },
      resolveFeedback: (id, status) => rpc("resolve_feedback", { feedback_id: id, new_status: status }),
      async suggestPlay(row) {
        needMe();
        const out = { user_id: uid };
        for (const k of ["title", "playwright", "year", "url", "notes"]) if (row[k]) out[k] = row[k];
        return check(await sb.from("play_suggestions").insert(out).select().single());
      },
      async myPlaySuggestions() {
        if (!uid) return [];
        return check(await sb.from("play_suggestions").select("id,title,playwright,status,review_note,created_at").eq("user_id", uid).order("created_at", { ascending: false }).limit(50));
      },
      async playSuggestionsFor(status = "pending") {
        let q = sb.from("play_suggestions").select(`*,${PROFILE}`).order("created_at", { ascending: status === "pending" }).limit(200);
        if (status !== "all") q = q.eq("status", status);
        return check(await q);
      },
      reviewPlaySuggestion: (id, status, why) => rpc("review_play_suggestion", { suggestion_id: id, new_status: status, why: why || null }),
      async mySuggestions(playId) {
        if (!uid) return [];
        let q = sb.from("production_suggestions").select("id,play_id,play_title,venue,city,date_from,date_to,status,review_note,created_at").eq("user_id", uid).order("created_at", { ascending: false }).limit(50);
        if (playId) q = q.eq("play_id", playId);
        return check(await q);
      },
      // ---- the Billd team and moderation (supabase/schema.sql checks every rule on the server)
      role: () => role,
      standing: () => standing,
      async team() {
        const { data, error } = await sb.from("staff").select("user_id,role,added_at,profile:profiles!user_id(id,username,display_name),adder:profiles!added_by(username)").order("added_at");
        return error ? [] : data;
      },
      async settings() {
        const { data } = await sb.from("site_settings").select("key,value");
        const out = { require_approval: false };
        (data || []).forEach((r) => (out[r.key] = r.value));
        return out;
      },
      setSetting: (key, value) => rpc("set_site_setting", { setting: key, val: value }),
      setStaffRole: (userId, r) => rpc("set_staff_role", { target: userId, new_role: r || null }),
      setStanding: (userId, status, why) => rpc("set_member_status", { target: userId, new_status: status, why: why || null }),
      removeContent: (kind, id, why) => rpc("moderate_remove", { kind, target_id: Number(id), why: why || null }),
      clearProfile: (userId, why) => rpc("moderate_profile", { target: userId, why: why || null }),
      resolveReport: (id, status) => rpc("resolve_report", { report_id: id, new_status: status }),
      reviewSuggestion: (id, status, why) => rpc("review_suggestion", { suggestion_id: id, new_status: status, why: why || null }),
      // shows the importers found that Billd can't match to a play (scripts/import_review.py fills the queue)
      async importReviewFor(status = "pending") {
        let q = sb.from("import_review").select("id,title,theatre,venue,city,date_from,date_to,source_url,origin,first_seen,status,playwright,decided_at,notes,decider:profiles!decided_by(id,username,display_name)");
        q = status === "pending" ? q.eq("status", "pending").order("first_seen").order("id").limit(300)
          : q.in("status", ["approved", "rejected"]).order("decided_at", { ascending: false }).limit(50);
        return check(await q);
      },
      reviewImport: (id, status, writer, why) => rpc("review_import", { item_id: id, new_status: status, writer: writer || null, why: why || null }),
      // ---- posts held for the team: they contain a word on the filter list (only the author and the team see them)
      async heldPosts() {
        const [logs, comments, lists, items] = await Promise.all([
          sb.from("logs").select(`id,user_id,play_id,play_title,review,venue,city,visibility,held_at,held_reason,${PROFILE}`).eq("held", true).order("held_at").limit(200),
          sb.from("log_comments").select(`id,log_id,user_id,body,held_at,held_reason,${PROFILE}`).eq("held", true).order("held_at").limit(200),
          sb.from("lists").select(`id,user_id,title,description,held_at,held_reason,${PROFILE}`).eq("held", true).order("held_at").limit(200),
          sb.from("list_items").select(`list_id,play_id,note,held_at,held_reason,list:lists!list_id(id,title,user_id,${PROFILE})`).eq("held", true).order("held_at").limit(200)].map(async (q) => check(await q)));
        return [
          ...logs.map((x) => ({ kind: "log", reason: x.held_reason, id: String(x.id), uid: x.user_id, who: x.profile, at: x.held_at, title: x.play_title, play_id: x.play_id,
                                 text: [x.review, x.venue && `Theatre: ${x.venue}`, x.city && `Town: ${x.city}`].filter(Boolean).join("\n"), link: `#/review/${x.id}`, vis: x.visibility })),
          ...comments.map((x) => ({ kind: "comment", reason: x.held_reason, id: String(x.id), uid: x.user_id, who: x.profile, at: x.held_at, text: x.body, link: `#/review/${x.log_id}` })),
          ...lists.map((x) => ({ kind: "list", reason: x.held_reason, id: String(x.id), uid: x.user_id, who: x.profile, at: x.held_at, title: x.title, text: x.description || "", link: `#/list/${x.id}` })),
          ...items.filter((x) => x.list).map((x) => ({ kind: "list_item", reason: x.held_reason, id: `${x.list_id}:${x.play_id}`, uid: x.list.user_id, who: x.list.profile, at: x.held_at, title: x.list.title, play_id: x.play_id, text: x.note || "", link: `#/list/${x.list_id}` })),
        ].sort((a, b) => String(a.at).localeCompare(String(b.at)));
      },
      reviewHeld: (kind, id, decision, why) => rpc("review_held", { kind, target_id: String(id), decision, why: why || null }),
      // ---- blocking: the database hides the blocked member's posts and stops them following, liking or commenting
      async blocks() {
        if (!uid) return [];
        return check(await sb.from("blocks").select("blocked,created_at,profile:profiles!blocked(id,username,display_name)").eq("blocker", uid).order("created_at", { ascending: false }));
      },
      async block(userId, on) {
        needMe();
        if (on) { const { error } = await sb.from("blocks").insert({ blocker: uid, blocked: userId }); if (error && error.code !== "23505") throw friendly(error); }  // 23505: already blocked
        else check(await sb.from("blocks").delete().eq("blocker", uid).eq("blocked", userId));
      },
      // ---- the Terms of Use: accepted at sign-up, or once by members who joined earlier
      setTermsVersion(v) { termsVersion = v || null; },
      async acceptTerms(version) {
        await rpc("accept_terms", { version });
        if (profile) profile = { ...profile, terms_version: version, terms_accepted_at: new Date().toISOString() };
      },
      // ---- the word filter (admins): the list isn't readable through the API, only through these functions
      async moderationTerms() { needMe(); return check(await sb.rpc("moderation_terms_list")); },
      async setModerationTerm(term, severity, remove) {
        needMe();
        return check(await sb.rpc("set_moderation_term", { new_term: String(term || ""), new_severity: severity || "block", remove: !!remove }));
      },
      // ---- delete my account: the server function checks the session and the typed username, then deletes everything
      async deleteAccount(username) {
        needMe();
        const { data, error } = await sb.functions.invoke("delete-account", { body: { username } });
        if (error || !data?.ok) {
          let msg = data?.error || "Your account couldn't be deleted. Try again later.";
          try { const b = await error?.context?.json?.(); if (b?.error) msg = b.error; } catch (e) { /* keep the general message */ }
          throw err(msg, "delete_failed");
        }
        try { await sb.auth.signOut({ scope: "local" }); } catch (e) { /* the session is gone with the account */ }
        uid = null; profile = null; role = null; standing = { status: "active", note: null }; emit(null);
      },
      async report(kind, targetId, reason) {
        needMe();
        check(await sb.from("reports").insert({ reporter: uid, kind, target_id: String(targetId), reason }));
      },
      async reports(status = "open") {
        return check(await sb.from("reports").select("*,reporter_p:profiles!reporter(id,username,display_name)").eq("status", status)
          .order("created_at", { ascending: status === "open" }).limit(100));
      },
      async suggestionsFor(status = "pending") {
        let q = sb.from("production_suggestions").select(`*,${PROFILE}`).order("created_at", { ascending: status === "pending" }).limit(200);
        if (status !== "all") q = q.eq("status", status);
        return check(await q);
      },
      async standings(status) {
        return check(await sb.from("member_status").select("user_id,status,note,changed_at,profile:profiles!user_id(id,username,display_name,created_at)")
          .eq("status", status).order("changed_at", { ascending: false }).limit(200));
      },
      async standingsFor(ids) {
        if (!ids.length) return {};
        const out = {};
        check(await sb.from("member_status").select("user_id,status,note").in("user_id", ids)).forEach((r) => (out[r.user_id] = r));
        return out;
      },
      async modLog(limit = 100) {
        return check(await sb.from("mod_log").select("*,actor_p:profiles!actor(username,display_name),target_p:profiles!target_user(username,display_name)")
          .order("created_at", { ascending: false }).limit(limit));
      },
      async getComment(id) { return check(await sb.from("log_comments").select(`*,${PROFILE}`).eq("id", id).maybeSingle()); },
      async profileById(id) { return check(await sb.from("profiles").select("*").eq("id", id).maybeSingle()); },
      async importLocal(data) {
        needMe();
        const st = Object.entries(data.status || {}).map(([play_id, s]) => ({ user_id: uid, play_id, seen: !!s.seen, liked: !!s.liked, want: !!s.want, rating: s.rating || null }));
        for (let i = 0; i < st.length; i += 500) check(await sb.from("play_status").upsert(st.slice(i, i + 500)));
        const logs = (data.logs || []).map((l) => ({ user_id: uid, play_id: l.play_id, play_title: l.play_title, seen_on: l.seen_on || null, rating: l.rating || null,
          liked: !!l.liked, review: l.review || null, spoilers: !!l.spoilers, rewatch: !!l.rewatch, venue: l.venue || null, city: l.city || null }));
        for (let i = 0; i < logs.length; i += 500) check(await sb.from("logs").insert(logs.slice(i, i + 500)));
        for (const l of data.lists || []) {
          const nl = check(await sb.from("lists").insert({ user_id: uid, title: l.title, description: l.description || null, ranked: !!l.ranked }).select().single());
          if (l.items?.length) check(await sb.from("list_items").insert(l.items.map((it, i) => ({ list_id: nl.id, play_id: it.play_id, note: it.note || null, position: i }))));
        }
      },
      onAuth(f) { listeners.add(f); return () => listeners.delete(f); },
    };
  }

  const backend = cfg && cfg.url && cfg.anonKey ? supabaseBackend() : localBackend();
  // A device that used Billd before accounts existed keeps its local diary, so a new
  // member can move it into their account.
  backend.local = backend.kind === "local" ? backend : (() => {
    try { return localStorage.getItem(LS_KEY) ? localBackend() : null; } catch (e) { return null; }
  })();
  window.BilldSocial = backend;
})();
