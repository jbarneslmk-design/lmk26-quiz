// Realtime-ish backend.
//  • NEON mode (live): talks to the quiz functions in your Neon project over HTTPS.
//    Every call carries the quiz password or host PIN; Neon checks them.
//    Changes are picked up by polling (~1/sec), which is plenty for a pub quiz.
//  • LOCAL mode (rehearsal): no Neon settings → tabs in one browser sync via localStorage.
window.Backend = (() => {
  const cfg = window.QUIZ_CONFIG;
  const neonCfg = cfg.neon || {};
  const useNeon = !!(neonCfg.connectionString && !/PASTE/.test(neonCfg.connectionString));
  const TS = { ".sv": "timestamp" };
  const api = { mode: useNeon ? "neon" : "local", TS, role: null };

  const parts = p => (p ? String(p).split("/").filter(Boolean) : []);
  const getAt = (obj, p) => parts(p).reduce((o, k) => (o == null ? null : o[k] ?? null), obj);
  function setAt(obj, p, v) {
    const ks = parts(p);
    if (!ks.length) return v == null ? {} : v;
    if (obj == null || typeof obj !== "object") obj = {};
    let o = obj;
    for (let i = 0; i < ks.length - 1; i++) {
      if (o[ks[i]] == null || typeof o[ks[i]] !== "object") o[ks[i]] = {};
      o = o[ks[i]];
    }
    if (v == null) delete o[ks.at(-1)]; else o[ks.at(-1)] = v;
    return obj;
  }

  // listeners: re-evaluated after every change, fire only when their value changed
  const listeners = new Set();
  let tree = {};
  function notify() { listeners.forEach(f => f()); }
  function on(p, cb) {
    let last;
    const f = () => { const v = getAt(tree, p); const s = JSON.stringify(v); if (s !== last) { last = s; cb(v == null ? null : JSON.parse(s)); } };
    listeners.add(f); f();
    return () => listeners.delete(f);
  }
  api.on = on;

  // ================= NEON =================
  if (useNeon) {
    const url = new URL(neonCfg.connectionString.replace(/^postgres(ql)?:/, "https:"));
    const endpoint = neonCfg.endpoint || `https://${url.hostname}/sql`;
    const game = cfg.gameId;
    let pw = null, pin = null, pid = null, token = null, rev = 0, offset = 0, polling = false, again = false, timer = null, connected = null;
    const connCbs = [];
    const setConn = c => { if (c !== connected) { connected = c; connCbs.forEach(f => f(c)); } };

    async function call(fn, args) {
      const ph = args.map((_, i) => "$" + (i + 1)).join(",");
      const t0 = Date.now();
      let res;
      try {
        res = await fetch(endpoint, {
          method: "POST",
          // no Content-Type header: Neon's CORS rules don't allow it from web pages
          headers: {
            "Neon-Connection-String": neonCfg.connectionString,
            "Neon-Raw-Text-Output": "true",
            "Neon-Array-Mode": "true"
          },
          body: JSON.stringify({ query: `select quiz.${fn}(${ph})::text`, params: args.map(a => (a == null ? null : typeof a === "object" ? JSON.stringify(a) : String(a))) })
        });
      } catch (e) { setConn(false); throw new Error("offline"); }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setConn(true);
        const m = String(body.message || "error").replace(/^ERROR:\s*/, "");
        throw new Error(m);
      }
      setConn(true);
      const out = JSON.parse(body.rows[0][0]);
      if (out && out.now) offset = out.now - (t0 + Date.now()) / 2;
      return out;
    }

    function apply(r) {
      if (!r) return false;
      let changed = false;
      if (r.full) { tree = r.full || {}; changed = true; }
      else if (r.ops && r.ops.length) { for (const op of r.ops) tree = setAt(tree, op.p, op.v ?? null); changed = true; }
      rev = r.rev;
      if (changed) notify();
      return changed;
    }

    // sign in once; every later call uses the session token
    async function signIn() {
      const r = await call("check", [game, pin ? null : pw, pin || null]);
      token = r.token; api.role = r.role; return r.role;
    }
    // run a call; if the session was cleared (password changed), sign in again once
    async function authed(fn, rest) {
      try { return await call(fn, [token, ...rest]); }
      catch (e) {
        if (!/bad_session/.test(e.message)) throw e;
        try { await signIn(); } catch (e2) { if (/bad_password|bad_pin/.test(e2.message)) api.onAuthLost && api.onAuthLost(); throw e2; }
        return call(fn, [token, ...rest]);
      }
    }
    async function poll() {
      if (polling) { again = true; return pending; }
      polling = true;
      try { apply(await authed("sync", [rev])); }
      catch (e) { /* offline or refused: try again next tick */ }
      finally { polling = false; }
      if (again) { again = false; return poll(); }
    }
    let pending = null;
    const syncNow = () => (pending = poll());
    function loop() {
      clearTimeout(timer);
      const hidden = document.visibilityState === "hidden";
      timer = setTimeout(async () => { await syncNow(); loop(); }, hidden ? 4000 : api.role === "host" ? 700 : 1000);
    }
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && api.role) { syncNow(); loop(); } });

    async function write(ops) {
      try { await authed("write", [pid, ops]); }
      catch (e) { rev = -1; await syncNow(); throw e; } // resync on refusal
      await syncNow();
    }

    Object.assign(api, {
      ready: Promise.resolve(),
      // players: login({ password, pid });  host: login({ pin })
      async login({ password = null, pin: hostPin = null, pid: myPid = null }) {
        pw = hostPin ? null : password; pin = hostPin || null; pid = myPid;
        const role = await signIn();
        rev = -1; await syncNow(); loop();
        return role;
      },
      now: () => Math.round(Date.now() + offset),
      set: (p, v) => write([{ p, v }]),
      update: (p, obj) => write(Object.keys(obj).map(k => ({ p: (p ? p + "/" : "") + k, v: obj[k] }))),
      remove: p => write([{ p }]),
      async get(p) { await syncNow(); return getAt(tree, p); },
      onConnection(cb) { connCbs.push(cb); if (connected != null) cb(connected); },
      reset: async () => { await authed("reset", []); rev = -1; await syncNow(); },
      hostGetQuiz: () => authed("host_get_quiz", []),
      hostPutQuiz: q => authed("host_put_quiz", [q])
    });
    return api;
  }

  // ================= LOCAL (rehearsal) =================
  const KEY = "neonnoel:" + cfg.gameId;
  const bc = "BroadcastChannel" in window ? new BroadcastChannel(KEY) : null;
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const fixTS = v => {
    if (v && typeof v === "object") {
      if (v[".sv"] === "timestamp") return Date.now();
      const o = Array.isArray(v) ? [] : {};
      for (const k in v) o[k] = fixTS(v[k]);
      return o;
    }
    return v;
  };
  function write(mut) {
    tree = mut(read());
    localStorage.setItem(KEY, JSON.stringify(tree));
    notify(); bc && bc.postMessage(1);
    return Promise.resolve();
  }
  const reload = () => { tree = read(); notify(); };
  bc && (bc.onmessage = reload);
  window.addEventListener("storage", e => e.key === KEY && reload());
  tree = read();
  Object.assign(api, {
    ready: Promise.resolve(),
    async login({ password, pin, pid }) {
      if (pin != null) { if (String(pin) !== String(cfg.localHostPin || "2512")) throw new Error("bad_pin"); api.role = "host"; return "host"; }
      if (cfg.localPassword && password !== cfg.localPassword) throw new Error("bad_password");
      api.role = "player"; return "player";
    },
    now: () => Date.now(),
    set: (p, v) => write(t => setAt(t, p, fixTS(v))),
    update: (p, v) => write(t => { for (const k in v) t = setAt(t, (p ? p + "/" : "") + k, fixTS(v[k])); return t; }),
    remove: p => write(t => setAt(t, p, null)),
    get: async p => getAt(read(), p),
    onConnection(cb) { cb(true); },
    reset: () => write(() => ({ state: { phase: "lobby" } })),
    hostGetQuiz: async () => { try { return JSON.parse(localStorage.getItem("nn_quiz_" + cfg.gameId)); } catch { return null; } },
    hostPutQuiz: async q => { localStorage.setItem("nn_quiz_" + cfg.gameId, JSON.stringify(q)); return { ok: true }; }
  });
  return api;
})();
