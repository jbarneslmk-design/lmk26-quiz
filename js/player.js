(async () => {
  const B = Backend, C = QUIZ_CONFIG, { esc, $, fmt, LETTERS, ordinal, parseNum, LINES } = NN;
  NN.scenery();
  const app = $("#app");
  // ?as=2 lets you open extra "test players" in other tabs of the same browser
  const AS = new URLSearchParams(location.search).get("as") || "";
  const PKEY = "nn_pid_" + C.gameId + AS, NKEY = "nn_name" + AS;
  let pid = localStorage.getItem(PKEY);
  if (!pid) { pid = "p" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); localStorage.setItem(PKEY, pid); }

  app.innerHTML = `<div class="card center"><p>Connecting…</p></div>`;
  await B.ready;
  // ---------- quiz password (checked by Neon on every request) ----------
  const PWKEY = "nn_pw_" + C.gameId + AS;
  const needPw = B.mode === "neon" || !!C.localPassword;
  let authed = false, gateErr = "";
  const errText = m => /bad_password/.test(m) ? "Wrong password — ask the quizmaster." : /no_game/.test(m) ? "The quiz isn't open yet." : /offline/.test(m) ? "No signal — check your wifi / 4G." : "Couldn't connect (" + m + ")";
  async function unlock(password) { await B.login({ password, pid }); localStorage.setItem(PWKEY, password); authed = true; }
  if (!needPw) { await B.login({ pid }); authed = true; }
  else if (localStorage.getItem(PWKEY)) {
    try { await unlock(localStorage.getItem(PWKEY)); } catch (e) { if (!/offline/.test(e.message)) localStorage.removeItem(PWKEY); gateErr = errText(e.message); }
  }
  B.onAuthLost = () => { localStorage.removeItem(PWKEY); location.reload(); };

  let me, S = {}, CUR = null, REV = null, MYANS = null, MYRES = null, MYSC = null, F = null, count = 0, ready = 0;
  let unA = null, unR = null, watchedQ = null, lastKey = "";
  let MYPROMPT = null, MYDRAW = null, CURIMG = null, unImg = null, imgOf = null, submitting = false;
  const SKEY = "nn_strokes_" + C.gameId + AS;
  let strokes = []; try { strokes = JSON.parse(localStorage.getItem(SKEY)) || []; } catch { }
  let pen = { c: "#14112b", s: 8 };
  const COLOURS = ["#14112b", "#ff2e88", "#ff8a00", "#ffd400", "#21d07a", "#18c6ff", "#7b5cff", "#8b5a2b", "#ffffff"];

  // stable "random" line per question so it doesn't change on refresh
  const line = (pool, salt) => { let h = 0; for (const c of pid + salt) h = (h * 31 + c.charCodeAt(0)) | 0; return pool[Math.abs(h) % pool.length]; };

  function watchQ() {
    if (S.q === watchedQ) return;
    watchedQ = S.q; unA && unA(); unR && unR(); MYANS = MYRES = null;
    if (S.q == null) return;
    unA = B.on(`answers/${S.q}/${pid}`, v => { MYANS = v; render(); });
    unR = B.on(`results/${S.q}/${pid}`, v => { MYRES = v; render(); });
  }

  async function join(name) {
    name = name.trim().replace(/\s+/g, " ").slice(0, 18);
    if (!name) return;
    const all = (await B.get("players")) || {};
    const taken = new Set(Object.entries(all).filter(([id]) => id !== pid).map(([, p]) => p.name.toLowerCase()));
    let n = name, i = 2;
    while (taken.has(n.toLowerCase())) n = `${name} ${i++}`;
    localStorage.setItem(NKEY, name);
    await B.set("players/" + pid, { name: n, joinedAt: B.TS });
    wake();
  }
  let lock = null;
  async function wake() { try { lock = await navigator.wakeLock.request("screen"); } catch { } }
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && lock && wake());

  async function answer(v) {
    if (MYANS || S.phase !== "question" || B.now() > S.endsAt + 500) return;
    MYANS = { v, at: B.now(), pending: true }; lastKey = ""; render();
    try { await B.set(`answers/${S.q}/${pid}`, { v, at: B.TS }); }
    catch (e) { console.warn("answer refused:", e.message); MYANS = null; lastKey = ""; render(); }
    navigator.vibrate && navigator.vibrate(30);
  }

  const header = () => `<header class="ptop"><span class="brand">${esc((CUR && CUR.round) || "LMK 26")}</span>
    ${me ? `<span class="me">${esc(me.name)}${MYSC ? ` · <b>${fmt(MYSC.total)}</b>` : ""}</span>` : ""}</header>`;

  function view() {
    const ph = S.phase || "lobby";
    if (!me) {
      const saved = localStorage.getItem(NKEY) || "";
      return `<section class="join">
        <h1 class="logo">LMK <br>26</h1>
        <p class="sub">The LMK Christmas Quiz</p>
        <div class="card">
          ${authed ? "" : `<label for="pw">Quiz password</label>
          <input id="pw" class="big-input" type="password" autocomplete="off" autocapitalize="none" placeholder="On your table card">`}
          <label for="nm">Your name (so we know who to blame)</label>
          <input id="nm" class="big-input" maxlength="18" autocomplete="off" value="${esc(saved)}" placeholder="e.g. Big Steve">
          ${gateErr ? `<p class="gate-err">${esc(gateErr)}</p>` : ""}
          <button id="joinbtn" class="btn primary big">I'm in</button>
        </div>
        ${ph !== "lobby" ? `<p class="muted small">Quiz already running — you can still jump in.</p>` : ""}
      </section>`;
    }
    if (ph === "lobby") return `<section class="wait center">
        <h2 class="title">YOU'RE IN</h2><p class="big">${esc(me.name)}</p>
        <p class="muted">Phones face up, drinks in hand. Waiting for the boss to start…</p>
        <p class="small"><span id="count">${count}</span> players ready</p></section>`;
    if ((ph === "draw" || ph === "drawdone") && CUR) {
      if (MYDRAW && MYDRAW.img) return `<section class="wait center"><h2 class="title">SUBMITTED</h2>
        <img class="drawing sm" src="${MYDRAW.img}" alt=""><p class="muted">A masterpiece. Keep a poker face — you'll be guessing everyone else's next.</p></section>`;
      if (ph === "drawdone") return `<section class="wait center"><h2 class="title">PENCILS DOWN</h2><p class="muted">${strokes.length ? "Sending your drawing…" : "You didn't draw anything. Bold strategy."}</p></section>`;
      if (!MYPROMPT) return `<section class="wait center"><p class="muted">Getting your secret prompt…</p></section>`;
      return `<section class="draw">
        <div class="tbar"><i id="tbar"></i></div>
        <div class="prompt card"><small>YOUR SECRET PROMPT — don't show anyone!</small><b>${esc(MYPROMPT)}</b></div>
        <canvas id="cv" width="480" height="480"></canvas>
        <div class="tools">
          ${COLOURS.map(c => `<button class="sw ${pen.c === c ? "on" : ""}" data-col="${c}" style="background:${c}" aria-label="colour"></button>`).join("")}
        </div>
        <div class="tools">
          ${[4, 8, 18].map(z => `<button class="sz ${pen.s === z ? "on" : ""}" data-size="${z}"><i style="width:${z}px;height:${z}px"></i></button>`).join("")}
          <button class="btn sm" data-tool="undo">↶ Undo</button>
          <button class="btn sm ghost" data-tool="clear">Clear</button>
          <button class="btn sm primary" data-tool="send">Done ✓</button>
        </div>
        <p class="muted small center">No words or letters — that's cheating. Auto-sends when time's up.</p>
      </section>`;
    }
    if ((ph === "question" || ph === "closed") && CUR && CUR.artist === pid) {
      return `<section class="q"><div class="qhead"><span class="pill hot">YOUR DRAWING</span></div>
        ${CURIMG ? `<img class="drawing sm" src="${CURIMG}" alt="">` : ""}
        <div class="locked card"><small>THIS ONE'S YOURS</small><b>Poker face. 😐</b><p class="muted">${CUR.drawMode === "who" ? "Points for everyone you fool." : "Points for every correct guess."}</p></div></section>`;
    }
    if ((ph === "question" || ph === "closed") && CUR) {
      const closed = ph === "closed" || B.now() > S.endsAt + 500;
      const top = `<div class="qhead"><span class="pill">Q${CUR.num || CUR.index + 1}/${CUR.total}</span>${CUR.double ? `<span class="pill hot">DOUBLE</span>` : ""}</div>
        <div class="tbar"><i id="tbar"></i></div>
        <h2 class="qtext p">${esc(CUR.text)}</h2>${CUR.drawingOf ? (CURIMG ? `<img class="drawing sm" src="${CURIMG}" alt="">` : `<p class="muted small">Loading drawing…</p>`) : CUR.image ? `<img class="qimg" src="${esc(CUR.image)}" alt="">` : ""}`;
      if (MYANS) {
        const shown = CUR.type === "choice" ? `${LETTERS[MYANS.v]} · ${esc(CUR.options[MYANS.v])}` : `${fmt(MYANS.v)} ${esc(CUR.unit || "")}`;
        return `<section class="q">${top}<div class="locked card"><small>LOCKED IN</small><b>${shown}</b><p class="muted">No take-backs. Fingers crossed.</p></div></section>`;
      }
      if (closed) return `<section class="q">${top}<div class="locked card miss"><small>TIME'S UP</small><b>Too slow!</b><p class="muted">${line(LINES.none, "c" + CUR.index)}</p></div></section>`;
      if (CUR.type === "choice") return `<section class="q">${top}
        <div class="opts">${CUR.options.map((o, i) => `<button class="opt c${i}" data-v="${i}"><b>${LETTERS[i]}</b><span>${esc(o)}</span></button>`).join("")}</div></section>`;
      return `<section class="q">${top}
        <div class="card numbox"><input id="num" class="big-input" inputmode="decimal" autocomplete="off" placeholder="Your guess">
        <button id="numgo" class="btn primary big">Lock it in</button><p class="muted small">${CUR.unit ? "In " + esc(CUR.unit) + ". " : ""}Closest guess wins. Numbers only.</p></div></section>`;
    }
    if (ph === "reveal" && REV && REV.index === S.q) {
      const r = MYRES, num = REV.type === "number";
      let cls, big, msg;
      if (r && r.artist) { cls = "win"; big = "YOUR ART"; msg = REV.drawMode === "what" ? `${r.right} ${r.right === 1 ? "person" : "people"} worked it out.` : "Points for everyone you fooled."; }
      else if (!r) { cls = "miss"; big = "MISSED IT"; msg = line(LINES.none, "r" + S.q); }
      else if (num) {
        cls = r.ok || r.bullseye ? "win" : r.pts > 0 ? "meh" : "lose";
        big = r.bullseye ? "BULLSEYE" : r.ok ? "NAILED IT" : r.pts > 0 ? "NOT BAD" : "WAY OFF";
        msg = r.bullseye || r.ok ? line(LINES.close, "r" + S.q) : r.pts > 0 ? `Within ${Math.round(r.err * 100)}% — respectable.` : line(LINES.far, "r" + S.q);
      } else { cls = r.ok ? "win" : "lose"; big = r.ok ? "NAILED IT" : "WIPED OUT"; msg = line(r.ok ? LINES.right : LINES.wrong, "r" + S.q); }
      const ans = num ? `${fmt(REV.answer)} ${esc(REV.unit || "")}` : `${LETTERS[REV.answer]} · ${esc(REV.answerText)}`;
      return `<section class="res ${cls} center">
        <h2 class="splash">${big}</h2>
        ${r ? `<p class="plus">+${fmt(r.pts)}</p>` : ""}
        <p class="msg">${esc(msg)}</p>
        <div class="card"><small class="muted">Answer</small><p class="big">${ans}</p>
          ${num && r ? `<p class="small">You said ${fmt(r.v)}</p>` : ""}</div>
        ${MYSC ? `<p>${ordinal(MYSC.rank)} of ${MYSC.of} · ${fmt(MYSC.total)} pts</p>${NN.stars(MYSC.streak)}` : ""}
        ${REV.funFact ? `<p class="muted small">Look up — the boss has the story.</p>` : ""}
      </section>`;
    }
    if (ph === "board" && MYSC) {
      const mv = MYSC.prevRank ? MYSC.prevRank - MYSC.rank : 0;
      return `<section class="wait center"><p class="muted">You're currently</p>
        <h2 class="splash">${ordinal(MYSC.rank)}</h2><p>of ${MYSC.of} · ${fmt(MYSC.total)} pts</p>
        ${mv ? `<p class="mv ${mv > 0 ? "up" : "down"}">${mv > 0 ? "▲ Up " + mv : "▼ Down " + -mv}</p>` : ""}
        ${NN.stars(MYSC.streak)}<p class="muted small">Eyes on the big screen.</p></section>`;
    }
    if (ph === "final" && F) {
      const podI = (F.podium || []).findIndex(p => p.pid === pid);
      const shown = podI >= 0 && F.stage >= 3 - podI;
      const myAwards = F.stage >= 4 ? (F.awards || []).filter(a => a.pid === pid) : [];
      return `<section class="wait center">
        ${shown ? `<h2 class="splash win">${podI === 0 ? "CHAMPION" : ordinal(podI + 1).toUpperCase() + " PLACE"}</h2>
          ${F.podium[podI].prize ? `<div class="card"><small class="muted">You win</small><p class="big">🎁 ${esc(F.podium[podI].prize.name)}</p></div>` : ""}`
          : F.stage < 3 ? `<h2 class="title">DRUMROLL…</h2><p class="muted">The podium is being revealed. Look up!</p>`
          : MYSC ? `<p class="muted">You finished</p><h2 class="splash">${ordinal(MYSC.rank)}</h2><p>${fmt(MYSC.total)} pts</p>` : ""}
        ${myAwards.map(a => `<div class="card award"><h3>${esc(a.title)}</h3><p class="small">${esc(a.detail)}</p></div>`).join("")}
        ${F.stage >= 4 ? `<p class="msg">Merry Christmas! 🎄</p>` : ""}
      </section>`;
    }
    return `<section class="wait center"><p class="muted">Hold tight…</p></section>`;
  }

  function render() {
    if (ready < 1) return;
    const key = JSON.stringify([authed, gateErr, !!me, me && me.name, S.phase, S.q, CUR && CUR.index, !!MYANS, MYRES, REV && REV.index, MYSC, F && F.stage, S.phase === "question" && B.now() > S.endsAt + 500, MYPROMPT, !!(MYDRAW && MYDRAW.img), !!CURIMG, CUR && CUR.drawingOf]);
    if (key === lastKey) { const c = $("#count"); c && (c.textContent = count); return; }
    lastKey = key;
    app.innerHTML = header() + `<main class="pstage">${view()}</main>`;
    const jb = $("#joinbtn");
    if (jb) {
      const go = async () => {
        const name = $("#nm").value.trim(); if (!name) { $("#nm").focus(); return; }
        jb.disabled = true;
        try {
          if (!authed) { await unlock($("#pw").value.trim()); gateErr = ""; }
          await join(name);
        } catch (e) { gateErr = errText(e.message); localStorage.setItem(NKEY, name); lastKey = ""; render(); }
        finally { const b = $("#joinbtn"); b && (b.disabled = false); }
      };
      jb.onclick = go; $("#nm").onkeydown = e => e.key === "Enter" && go();
      const pwEl = $("#pw"); pwEl && (pwEl.onkeydown = e => e.key === "Enter" && $("#nm").focus());
    }
    app.querySelectorAll(".opt[data-v]").forEach(b => (b.onclick = () => answer(+b.dataset.v)));
    const ng = $("#numgo");
    if (ng) {
      const go = () => { const v = parseNum($("#num").value); if (v == null) { $("#num").classList.add("shake"); setTimeout(() => $("#num").classList.remove("shake"), 400); return; } answer(v); };
      ng.onclick = go; $("#num").onkeydown = e => e.key === "Enter" && go();
    }
    mountCanvas();
    tick();
  }

  // ---------- drawing ----------
  function paint(ctx, list) {
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 480, 480);
    ctx.lineCap = ctx.lineJoin = "round";
    for (const st of list) {
      ctx.strokeStyle = ctx.fillStyle = st.c; ctx.lineWidth = st.s;
      if (st.p.length === 1) { ctx.beginPath(); ctx.arc(st.p[0][0], st.p[0][1], st.s / 2, 0, 7); ctx.fill(); continue; }
      ctx.beginPath(); ctx.moveTo(st.p[0][0], st.p[0][1]);
      for (const [x, y] of st.p.slice(1)) ctx.lineTo(x, y);
      ctx.stroke();
    }
  }
  const saveStrokes = () => { try { localStorage.setItem(SKEY, JSON.stringify(strokes)); } catch { } };
  function mountCanvas() {
    const cv = $("#cv"); if (!cv) return;
    const ctx = cv.getContext("2d"); paint(ctx, strokes);
    let cur = null;
    const pos = e => { const r = cv.getBoundingClientRect(); return [Math.round((e.clientX - r.left) * 480 / r.width), Math.round((e.clientY - r.top) * 480 / r.height)]; };
    cv.onpointerdown = e => { e.preventDefault(); cv.setPointerCapture(e.pointerId); cur = { c: pen.c, s: pen.s, p: [pos(e)] }; strokes.push(cur); paint(ctx, strokes); };
    cv.onpointermove = e => {
      if (!cur) return; const p = pos(e), l = cur.p.at(-1);
      if (Math.abs(p[0] - l[0]) + Math.abs(p[1] - l[1]) < 2) return;
      cur.p.push(p);
      ctx.strokeStyle = cur.c; ctx.lineWidth = cur.s; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(l[0], l[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
    };
    cv.onpointerup = cv.onpointercancel = () => { if (cur) { cur = null; saveStrokes(); } };
    app.querySelectorAll("[data-col]").forEach(b => (b.onclick = () => { pen.c = b.dataset.col; app.querySelectorAll("[data-col]").forEach(x => x.classList.toggle("on", x === b)); }));
    app.querySelectorAll("[data-size]").forEach(b => (b.onclick = () => { pen.s = +b.dataset.size; app.querySelectorAll("[data-size]").forEach(x => x.classList.toggle("on", x === b)); }));
    app.querySelectorAll("[data-tool]").forEach(b => (b.onclick = () => {
      const t = b.dataset.tool;
      if (t === "undo") { strokes.pop(); saveStrokes(); paint(ctx, strokes); }
      if (t === "clear" && strokes.length && confirm("Wipe your drawing?")) { strokes = []; saveStrokes(); paint(ctx, strokes); }
      if (t === "send") { if (!strokes.length) return alert("Draw something first!"); submitDrawing(); }
    }));
  }
  async function submitDrawing() {
    if (submitting || (MYDRAW && MYDRAW.img) || !strokes.length || !me) return;
    submitting = true;
    try {
      const c = document.createElement("canvas"); c.width = c.height = 480;
      paint(c.getContext("2d"), strokes);
      const img = c.toDataURL("image/jpeg", 0.7);
      await B.set("drawings/" + pid, { img, prompt: MYPROMPT, at: B.TS });
      strokes = []; saveStrokes();
    } catch (e) { console.warn(e); } finally { submitting = false; }
  }

  function tick() {
    const bar = $("#tbar");
    if (S.phase === "draw" && S.endsAt && B.now() > S.endsAt) submitDrawing();
    if (bar && S.phase === "draw") { const left = Math.max(0, (S.endsAt - B.now()) / 1000); bar.style.width = (left / S.duration) * 100 + "%"; bar.classList.toggle("low", left <= 10); }
    if (bar && S.phase === "question") {
      const left = Math.max(0, (S.endsAt - B.now()) / 1000);
      bar.style.width = (left / S.duration) * 100 + "%";
      bar.classList.toggle("low", left <= 5);
      if (left <= 0) render(); // flips to "time's up"
    }
  }
  setInterval(tick, 250);

  B.on("players/" + pid, v => { me = v; render(); });
  B.on("players", v => { count = v ? Object.keys(v).length : 0; render(); });
  B.on("state", v => {
    const prev = S.q;
    S = v || { phase: "lobby" }; watchQ();
    if (S.phase === "drawdone") submitDrawing();
    if (S.phase === "draw" && S.q !== prev) { navigator.vibrate && navigator.vibrate([60, 40, 60]); }
    if (S.phase === "question" && S.q !== prev && navigator.vibrate) navigator.vibrate([60, 40, 60]);
    render();
  });
  B.on("current", v => {
    CUR = v;
    const want = v && v.drawingOf;
    if (want !== imgOf) { imgOf = want; unImg && unImg(); CURIMG = null; unImg = want ? B.on(`drawings/${want}/img`, im => { CURIMG = im; render(); }) : null; }
    render();
  });
  B.on("drawAssign/" + pid, v => { MYPROMPT = v; render(); });
  B.on("drawings/" + pid, v => { MYDRAW = v; render(); });
  B.on("reveal", v => { REV = v; render(); });
  B.on("scores/" + pid, v => { MYSC = v; render(); });
  B.on("final", v => { F = v; render(); });
  ready = 1; render();
})();
