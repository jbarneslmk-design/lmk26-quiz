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
  let MYPROMPT = null, MYDRAW = null, CURIMG = null, unImg = null, imgOf = null, submitting = false, unPrompt = null, unMine = null;
  // strokes are kept per drawing round, so a refresh never loses a half-finished drawing
  let drawR = null, SKEY = "nn_strokes_" + C.gameId + AS + "_0";
  let strokes = [];
  const loadStrokes = r => { SKEY = "nn_strokes_" + C.gameId + AS + "_" + r; try { strokes = JSON.parse(localStorage.getItem(SKEY)) || []; } catch { strokes = []; } };
  let pen = { c: "#14112b", s: 8 };
  const CW = 480, CH = 640; // drawings are 3:4 portrait, to use the phone's height
  const COLOURS = ["#14112b", "#ff2e88", "#ff8a00", "#ffd400", "#21d07a", "#18c6ff", "#7b5cff", "#8b5a2b", "#ffffff"];

  // stable "random" line per question so it doesn't change on refresh
  const line = (pool, salt) => { let h = 0; for (const c of pid + salt) h = (h * 31 + c.charCodeAt(0)) | 0; return pool[Math.abs(h) % pool.length]; };

  let P = {}, SCALL = {}, scoresRev = 0, ANSQ = {}, RESQ = {}, unAQ = null;
  function watchQ() {
    if (S.q === watchedQ) return;
    watchedQ = S.q; unA && unA(); unR && unR(); unAQ && unAQ(); MYANS = MYRES = null; ANSQ = {}; RESQ = {};
    if (S.q == null) return;
    unA = B.on(`answers/${S.q}/${pid}`, v => { MYANS = v; render(); });
    unAQ = B.on(`answers/${S.q}`, v => { ANSQ = v || {}; render(); });
    unR = B.on(`results/${S.q}`, v => { RESQ = v || {}; MYRES = RESQ[pid] || null; render(); });
  }
  // everyone's self-portrait (read straight from the local copy: pictures are big)
  function portraitRound() {
    const asg = B.peek("drawAssign") || {};
    for (const r in asg) if (Object.values(asg[r] || {}).includes(NN.PORTRAIT_PROMPT)) return r;
    return null;
  }
  const portraitOf = id => { const r = portraitRound(); return r == null ? null : B.peek(`drawings/${r}/${id}/img`) || null; };
  const nameOf = id => (P[id] && P[id].name) || (SCALL[id] && SCALL[id].name) || "Someone";
  const av = (id, cls) => NN.avatar(portraitOf(id), nameOf(id), cls);
  const answeredCount = () => { const art = CUR && CUR.artist; const of = Object.keys(P).filter(id => id !== art).length; return [Object.keys(ANSQ).filter(id => id !== art && P[id]).length, of]; };

  async function join(name) {
    name = name.trim().replace(/\s+/g, " ").slice(0, 18);
    if (!name) return;
    const all = (await B.get("players")) || {};
    const taken = new Set(Object.entries(all).filter(([id]) => id !== pid).map(([, p]) => p.name.toLowerCase()));
    let n = name, i = 2;
    while (taken.has(n.toLowerCase())) n = `${name} ${i++}`;
    localStorage.setItem(NKEY, name);
    await B.set("players/" + pid, { name: n, joinedAt: B.TS });
    SFX.play("join");
    wake();
  }
  let lock = null;
  async function wake() { try { lock = await navigator.wakeLock.request("screen"); } catch { } }
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && lock && wake());

  async function answer(v) {
    if (MYANS || S.phase !== "question" || B.now() > S.endsAt + 500) return;
    MYANS = { v, at: B.now(), pending: true }; lastKey = ""; render();
    SFX.play("lock");
    try { await B.set(`answers/${S.q}/${pid}`, { v, at: B.TS }); }
    catch (e) { console.warn("answer refused:", e.message); MYANS = null; lastKey = ""; render(); }
    navigator.vibrate && navigator.vibrate(30);
  }

  // share the players' page with someone else: QR of the join address
  let shareOpen = false;
  const joinQr = () => (window.NNQR ? NNQR.svg(NN.joinUrl()) : "");
  const shareOverlay = () => shareOpen ? `<div class="modal qrmodal" id="shareclose">
      <div class="card qrbig"><h2 class="title sm">SCAN TO PLAY</h2><div class="qr">${joinQr()}</div>
      <p class="url">${esc(NN.shortUrl(NN.joinUrl()))}</p><p class="muted small">Let your mate scan this. Tap to close.</p></div></div>` : "";
  const header = () => `<header class="ptop"><span class="brand">${esc((CUR && CUR.round) || "LMK 26")}</span>
    <span class="ptop-r">${me ? `${portraitOf(pid) ? av(pid, "xs") : ""}<span class="me">${esc(me.name)}${MYSC ? ` · <b>${fmt(MYSC.total)}</b>` : ""}</span>` : ""}
    ${SFX.buttons()}<button class="sharebtn" id="sharebtn" aria-label="Show the join QR code">📱 QR</button></span></header>`;

  function view() {
    const ph = S.phase || "lobby";
    if (!me) {
      const saved = localStorage.getItem(NKEY) || "";
      return `<section class="join">
        <h1 class="logo">LMK <br>26</h1>
        <p class="sub">The LMK Christmas Quiz</p>
        <div class="card">
          ${authed ? "" : `<label for="pw">Quiz password</label>
          <input id="pw" class="big-input" type="password" autocomplete="off" autocapitalize="none" placeholder="Ask the quizmaster">`}
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
        <p class="small"><span id="count">${count}</span> players ready</p>
        <div class="whohere">${Object.entries(P).sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0)).map(([id, p]) => `<span class="${id === pid ? "mine" : ""}">${esc(p.name)}</span>`).join("")}</div>
        <div class="card sharecard"><small>GET YOUR MATES IN</small><div class="qr">${joinQr()}</div><p class="muted small">Let them scan this</p></div></section>`;
    if ((ph === "draw" || ph === "drawdone") && CUR) {
      const portrait = !!CUR.portrait, dr = B.peek(`drawings/${CUR.drawRound ?? 0}`) || {};
      const drawn = Object.keys(P).filter(id => dr[id] && dr[id].img).length;
      if (MYDRAW && MYDRAW.img) return `<section class="wait center"><h2 class="title">${portrait ? "LOOKING GOOD" : "SUBMITTED"}</h2>
        <img class="drawing sm" src="${MYDRAW.img}" alt=""><p class="muted">${portrait ? "That's your picture for the rest of the night." : "A masterpiece. Keep a poker face — you'll be guessing everyone else's next."}</p>
        <p class="small">${drawn}/${Object.keys(P).length} finished</p></section>`;
      if (ph === "drawdone") return `<section class="wait center"><h2 class="title">PENCILS DOWN</h2><p class="muted">${strokes.length ? "Sending your drawing…" : "You didn't draw anything. Bold strategy."}</p></section>`;
      if (!MYPROMPT) return `<section class="wait center"><p class="muted">Getting your secret prompt…</p></section>`;
      return `<section class="draw">
        <div class="tbar"><i id="tbar"></i></div>
        <div class="prompt card"><small>${CUR.portrait ? "SELF-PORTRAIT" : "YOUR SECRET PROMPT — don't show anyone!"}</small><b>${esc(MYPROMPT)}</b></div>
        <canvas id="cv" width="${CW}" height="${CH}"></canvas>
        <div class="tools">
          ${COLOURS.map(c => `<button class="sw ${pen.c === c ? "on" : ""}" data-col="${c}" style="background:${c}" aria-label="colour"></button>`).join("")}
        </div>
        <div class="tools">
          ${[4, 8, 18].map(z => `<button class="sz ${pen.s === z ? "on" : ""}" data-size="${z}"><i style="width:${z}px;height:${z}px"></i></button>`).join("")}
          <button class="btn sm" data-tool="undo">↶ Undo</button>
          <button class="btn sm ghost" data-tool="clear">Clear</button>
          <button class="btn sm primary" data-tool="send">Done ✓</button>
        </div>
        <p class="muted small center drawhint">${CUR.portrait ? "Write your name too! Sends itself when time's up." : "No words or letters! Sends itself when time's up."}</p>
      </section>`;
    }
    if ((ph === "question" || ph === "closed") && CUR && CUR.artist === pid) {
      return `<section class="q"><div class="qhead"><span class="pill hot">YOUR DRAWING</span></div>
        ${CURIMG ? `<img class="drawing sm" src="${CURIMG}" alt="">` : ""}
        <div class="locked card"><small>THIS ONE'S YOURS</small><b>Poker face. 😐</b><p class="muted">${CUR.drawMode === "who" ? "Points for everyone you fool." : "Points for every correct guess."}</p>
          <p class="roomcount"><b>${answeredCount()[0]}/${answeredCount()[1]}</b> locked in</p></div></section>`;
    }
    if ((ph === "question" || ph === "closed") && CUR) {
      const closed = ph === "closed" || B.now() > S.endsAt + 500;
      const top = `<div class="qhead"><span class="pill">Q${CUR.num || CUR.index + 1}/${CUR.total}</span>${CUR.double ? `<span class="pill hot">DOUBLE</span>` : ""}</div>
        <div class="tbar"><i id="tbar"></i></div>
        <h2 class="qtext p">${esc(CUR.text)}</h2>${CUR.drawingOf ? (CURIMG ? `<img class="drawing sm" src="${CURIMG}" alt="">` : `<p class="muted small">Loading drawing…</p>`) : CUR.image ? `<img class="qimg" src="${esc(CUR.image)}" alt="">` : ""}`;
      if (MYANS) {
        const shown = CUR.type === "choice" ? `${LETTERS[MYANS.v]} · ${esc(CUR.options[MYANS.v])}` : `${fmt(MYANS.v)} ${esc(CUR.unit || "")}`;
        const [n, of] = answeredCount();
        return `<section class="q">${top}<div class="locked card"><small>LOCKED IN</small><b>${shown}</b><p class="muted">No take-backs. Fingers crossed.</p>
          <p class="roomcount"><b>${n}/${of}</b> locked in</p></div></section>`;
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
      const sum = REV.sum || {};
      let room = "";
      if (!num && CUR && CUR.options && sum.counts) {
        const max = Math.max(1, ...sum.counts);
        room = `<div class="card room"><h3>How the room answered</h3>
          ${CUR.options.map((o, i) => `<div class="rbar c${i} ${i === REV.answer ? "right" : ""}"><b>${LETTERS[i]}</b><span class="rt">${esc(o)}</span><em style="--w:${(sum.counts[i] / max) * 100}%"></em><strong>${sum.counts[i]}</strong></div>`).join("")}
          <h3>Got it right (${(sum.right || []).length})</h3>
          <div class="mini big">${(sum.right || []).map((x, i) => `<span class="${i === 0 ? "gold" : ""}">${esc(x.name)} <small>${x.secs}s</small></span>`).join("") || "<span>Nobody!</span>"}</div>
          ${sum.fastest ? `<p class="small">⚡ Fastest finger: <b>${esc(sum.fastest.name)}</b> in ${sum.fastest.secs}s</p>` : ""}</div>`;
      } else if (num) {
        room = `<div class="card room"><h3>Closest guesses</h3>
          <ol class="closest">${(sum.closest || []).map(c => `<li><b>${esc(c.name)}</b> — ${fmt(c.v)}</li>`).join("") || "<li>No guesses</li>"}</ol>
          ${sum.wildest ? `<h3>Wildest guess</h3><p><b>${esc(sum.wildest.name)}</b> said <b>${fmt(sum.wildest.v)}</b>. ${esc(line(LINES.far, "w" + S.q))}</p>` : ""}
          ${sum.avg != null ? `<p class="small">Room average: <b>${fmt(Math.round(sum.avg))}</b></p>` : ""}</div>`;
      }
      const artRes = REV.artist ? RESQ[REV.artist] : null;
      const artLine = artRes ? `<p class="artline">🎨 <b>${esc(nameOf(REV.artist))}</b> banks <b>+${fmt(artRes.pts)}</b> ${REV.drawMode === "what" ? `for ${artRes.right} correct guess${artRes.right === 1 ? "" : "es"}` : "for everyone they fooled"}</p>` : "";
      return `<section class="res ${cls} center">
        <h2 class="splash">${big}</h2>
        ${r ? `<p class="plus">+${fmt(r.pts)}</p>` : ""}
        <p class="msg">${esc(msg)}</p>
        <div class="card"><small class="muted">Answer</small><p class="big">${ans}</p>
          ${num && r && !r.artist ? `<p class="small">You said ${fmt(r.v)}</p>` : ""}</div>
        ${MYSC ? `<p>${ordinal(MYSC.rank)} of ${MYSC.of} · ${fmt(MYSC.total)} pts</p>${NN.stars(MYSC.streak)}` : ""}
        ${room}${artLine}
        ${sum.line ? `<p class="zinger">${esc(sum.line)}</p>` : ""}
        ${REV.funFact ? `<div class="card fact"><b>The real story:</b> ${esc(REV.funFact)}</div>` : ""}
      </section>`;
    }
    if (ph === "board") {
      const rows = Object.entries(SCALL).map(([id, x]) => ({ id, ...x })).sort((a, b) => a.rank - b.rank || b.total - a.total);
      const top = rows.slice(0, 10), mine = rows.find(x => x.id === pid);
      const row = x => { const mv = x.prevRank ? x.prevRank - x.rank : 0;
        return `<li class="${x.id === pid ? "me" : ""}"><span class="rk">${x.rank}</span>${av(x.id, "sm")}<span class="nm">${esc(x.name)}</span>
          <span class="mv ${mv > 0 ? "up" : mv < 0 ? "down" : ""}">${mv > 0 ? "▲" + mv : mv < 0 ? "▼" + -mv : ""}</span><span class="pts">${fmt(x.total)}</span></li>`; };
      return `<section class="pboard"><h2 class="title sm">STANDINGS</h2>
        ${mine ? `<p class="center">You're <b>${ordinal(mine.rank)}</b> of ${mine.of} · ${fmt(mine.total)} pts ${NN.stars(mine.streak)}</p>` : ""}
        <ol class="lb plb">${top.map(row).join("")}${mine && mine.rank > 10 ? `<li class="gap">⋯</li>${row(mine)}` : ""}</ol></section>`;
    }
    if (ph === "final" && F) {
      const pod = F.podium || [], st = F.stage, mine = SCALL[pid];
      const podCard = (i) => { const p = pod[i]; if (!p) return ""; const shown = st >= 3 - i;
        return `<div class="pcard p${i + 1} ${shown ? "show" : ""} ${p.pid === pid && shown ? "me" : ""}">
          <div class="place">${ordinal(i + 1)}</div>
          ${shown ? `${av(p.pid, "lg")}<div class="pn">${esc(p.name)}${p.pid === pid ? " <em>(you!)</em>" : ""}</div><div class="pp">${fmt(p.total)} pts</div>
            ${p.prize ? `<div class="prize">🎁 ${esc(p.prize.name)}${p.prize.from ? `<small>from ${esc(p.prize.from)}</small>` : ""}</div>` : ""}` : `<div class="av lg none">?</div><div class="pn">Drumroll…</div>`}</div>`; };
      const myLine = mine ? `<p class="center myfinal">You finished <b>${ordinal(mine.rank)}</b> of ${mine.of} with ${fmt(mine.total)} pts</p>` : "";
      if (st < 3) return `<section class="pfinal"><h2 class="title sm">THE FINAL COUNTDOWN</h2>
        <div class="ppod">${podCard(2)}${podCard(1)}${podCard(0)}</div></section>`;
      if (st === 3) return `<section class="pfinal">${pod[0] ? NN.celebration(portraitOf(pod[0].pid), pod[0].name, pod[0].total, pod[0].prize, pod[0].pid === pid) : ""}
        <div class="ppod small">${podCard(1)}${podCard(2)}</div>${myLine}</section>`;
      if (st === 4) return `<section class="pfinal"><h2 class="title sm">SPECIAL AWARDS</h2>${myLine}
        <div class="pawards">${(F.awards || []).map(a => `<div class="card award ${a.pid === pid ? "me" : ""}"><h3>${esc(a.title)}</h3>${av(a.pid, "md")}<p class="pname">${esc(a.name)}${a.pid === pid ? " (you!)" : ""}</p><p class="small">${esc(a.detail)}</p>${a.prize ? `<p class="prize">🎁 ${esc(a.prize)}</p>` : ""}</div>`).join("") || "<p>No awards this time.</p>"}</div>
        <p class="msg center">Merry Christmas! 🎄</p></section>`;
      const all = B.peek("drawings") || {}, pr = portraitRound(), asg = B.peek("drawAssign") || {};
      const items = Object.entries(all).flatMap(([r, by]) => Object.entries(by || {}).filter(([, d]) => d && d.img).map(([id, d]) => ({ id, img: d.img, prompt: String(r) === String(pr) ? "Self-portrait" : d.prompt || ((asg[r] || {})[id]) || "" })));
      return `<section class="pfinal"><h2 class="title sm">THE GALLERY</h2>${myLine}
        <div class="gallery pgallery">${items.map(d => `<figure><img src="${d.img}" alt="" loading="lazy"><figcaption><b>${esc(nameOf(d.id))}</b>${esc(d.prompt)}</figcaption></figure>`).join("")}</div>
        <p class="msg center">Merry Christmas! 🎄</p></section>`;
    }
    return `<section class="wait center"><p class="muted">Hold tight…</p></section>`;
  }

  function render() {
    if (ready < 1) return;
    // live room numbers only redraw the screen when nothing is in progress
    // (never while someone is drawing, choosing or typing a number)
    const drawing = S.phase === "draw" && MYPROMPT && !(MYDRAW && MYDRAW.img);
    const choosing = S.phase === "question" && !MYANS && !(CUR && CUR.artist === pid);
    const roomKey = drawing || choosing ? "busy" : [Object.keys(P).length, Object.keys(ANSQ).length, Object.keys(RESQ).length, scoresRev,
      S.phase === "draw" || S.phase === "drawdone" ? Object.keys(B.peek(`drawings/${CUR && CUR.drawRound}`) || {}).length : 0].join(",");
    const key = JSON.stringify([shareOpen, authed, gateErr, roomKey, !!me, me && me.name, S.phase, S.q, CUR && CUR.index, !!MYANS, MYRES, REV && REV.index, MYSC, F && F.stage, S.phase === "question" && B.now() > S.endsAt + 500, MYPROMPT, !!(MYDRAW && MYDRAW.img), !!CURIMG, CUR && CUR.drawingOf]);
    if (key === lastKey) { const c = $("#count"); c && (c.textContent = count); return; }
    lastKey = key;
    const drawingNow = (S.phase === "draw") && MYPROMPT && !(MYDRAW && MYDRAW.img) && me;
    document.body.classList.toggle("drawing-now", !!drawingNow);
    app.innerHTML = (drawingNow ? "" : header()) + `<main class="pstage">${view()}</main>` + shareOverlay();
    const sb = $("#sharebtn"); if (sb) sb.onclick = () => { shareOpen = true; lastKey = ""; render(); };
    const sc = $("#shareclose"); if (sc) sc.onclick = () => { shareOpen = false; lastKey = ""; render(); };
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
      jb.onclick = go; $("#nm").onkeydown = e => { if (e.key === "Enter") go(); };
      const pwEl = $("#pw"); if (pwEl) pwEl.onkeydown = e => { if (e.key === "Enter") $("#nm").focus(); };
    }
    app.querySelectorAll(".opt[data-v]").forEach(b => (b.onclick = () => answer(+b.dataset.v)));
    const ng = $("#numgo");
    if (ng) {
      const go = () => { const v = parseNum($("#num").value); if (v == null) { $("#num").classList.add("shake"); setTimeout(() => $("#num").classList.remove("shake"), 400); return; } answer(v); };
      ng.onclick = go; $("#num").onkeydown = e => { if (e.key === "Enter") go(); };
    }
    mountCanvas();
    tick();
    fitScreen();
    app.querySelectorAll(".pstage img").forEach(im => { if (!im.complete) im.addEventListener("load", fitScreen, { once: true }); });
  }

  // ---------- drawing ----------
  function paint(ctx, list) {
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, CW, CH);
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
    const pos = e => { const r = cv.getBoundingClientRect(); return [Math.round((e.clientX - r.left) * CW / r.width), Math.round((e.clientY - r.top) * CH / r.height)]; };
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
    if (submitting || drawR == null || (MYDRAW && MYDRAW.img) || !strokes.length || !me) return;
    submitting = true;
    try {
      const c = document.createElement("canvas"); c.width = CW; c.height = CH;
      paint(c.getContext("2d"), strokes);
      const img = c.toDataURL("image/jpeg", 0.7);
      await B.set(`drawings/${drawR}/${pid}`, { img, prompt: MYPROMPT, at: B.TS });
      SFX.play("lock");
      strokes = []; saveStrokes();
    } catch (e) { console.warn(e); } finally { submitting = false; }
  }

  // while waiting for others to finish drawing, keep the "x/y finished" count fresh (cheap: no pictures copied)
  let lastDrawn = -1;
  function drawProgress() {
    if (!(S.phase === "draw" || S.phase === "drawdone") || !(MYDRAW && MYDRAW.img) || !CUR) return;
    const n = Object.keys(B.peek(`drawings/${CUR.drawRound ?? 0}`) || {}).length;
    if (n !== lastDrawn) { lastDrawn = n; render(); }
  }
  setInterval(drawProgress, 1000);

  // No scrolling: if a screen is taller than the phone, shrink it to fit (down to 66%).
  // The join screen (keyboard) and the gallery are left to scroll; the drawing canvas
  // sizes itself to the screen in CSS instead.
  function fitScreen() {
    const st = $(".pstage"); if (!st) return;
    st.style.zoom = "";
    const cv = st.querySelector("#cv");
    if (cv) { // the canvas takes exactly the height that's left, so the tools stay on screen
      cv.style.width = "";
      const others = st.scrollHeight - cv.offsetHeight, avail = window.innerHeight - st.getBoundingClientRect().top - 16 - others;
      cv.style.width = Math.max(180, Math.min(st.clientWidth, avail * CW / CH)) + "px";
      return;
    }
    if (st.querySelector(".join, .pgallery")) return;
    const avail = window.innerHeight - st.getBoundingClientRect().top - 6, h = st.scrollHeight;
    if (h > avail + 2) st.style.zoom = Math.max(0.66, avail / h).toFixed(3);
  }
  window.addEventListener("resize", () => requestAnimationFrame(fitScreen));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitScreen()); // re-measure once the fonts are in

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
  B.on("players", v => { P = v || {}; count = Object.keys(P).length; render(); });
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
    const wantKey = want ? `${v.drawRound ?? 0}/${want}` : null;
    if (wantKey !== imgOf) { imgOf = wantKey; unImg && unImg(); CURIMG = null; unImg = wantKey ? B.on(`drawings/${wantKey}/img`, im => { CURIMG = im; render(); }) : null; }
    // drawing round: follow this round's prompt and my drawing for it
    if (v && v.type === "draw" && v.drawRound !== drawR) {
      drawR = v.drawRound ?? 0; loadStrokes(drawR);
      unPrompt && unPrompt(); unMine && unMine(); MYPROMPT = MYDRAW = null;
      unPrompt = B.on(`drawAssign/${drawR}/${pid}`, x => { MYPROMPT = x; render(); });
      unMine = B.on(`drawings/${drawR}/${pid}`, x => { MYDRAW = x; render(); });
    }
    render();
  });

  B.on("reveal", v => { REV = v; render(); });
  B.on("scores", v => { SCALL = v || {}; MYSC = SCALL[pid] || null; scoresRev++; render(); });
  // ---------- sound: shared cues from the host, played at the same moment on every phone ----------
  SFX.useClock(B.now);
  SFX.onChange(() => { lastKey = ""; if (!(S.phase === "draw" && MYPROMPT && !(MYDRAW && MYDRAW.img))) render(); else { const h = $(".ptop"); h && (h.outerHTML = header()); } });
  let lastFx = null, fxReady = false;
  B.on("fx", v => {
    if (!v || v.n === lastFx) return; lastFx = v.n;
    if (!fxReady) return; // don't replay whatever cue was there when the page opened
    const at = v.at, now = B.now();
    if (v.name === "reveal") {
      SFX.playAt("reveal", at, now);
      // my own result, just after the drumroll (results are written before the reveal)
      setTimeout(() => {
        const r = MYRES, mine = r && r.artist ? "art" : !r ? "miss" : r.ok || r.bullseye ? "correct" : r.pts > 0 ? "allin" : "wrong";
        SFX.playAt(mine, at + 650, B.now());
      }, Math.max(0, at - now - 300));
    } else if (v.name === "board") {
      SFX.playAt("board", at, now);
      setTimeout(() => { if (MYSC && MYSC.prevRank && MYSC.rank < MYSC.prevRank) SFX.playAt("up", at + 1300, B.now()); }, Math.max(0, at - now));
    } else if (v.name === "podium") {
      SFX.playAt("podium", at, now);
      if (v.pid === pid) SFX.playAt("place", at + 1500, now);
    } else if (v.name === "winner") {
      SFX.playAt(v.pid === pid ? "winnerMe" : "winner", at, now);
    } else SFX.playAt(v.name, at, now);
  });
  setTimeout(() => (fxReady = true), 2500);
  // countdown ticks and time's up, from the server-time deadline (so every phone ticks together)
  let ticked = {};
  setInterval(() => {
    const live = (S.phase === "question" || S.phase === "draw") && S.endsAt;
    SFX.duck(!!live);
    if (!live) return;
    const key = S.phase + S.q;
    for (let k = 5; k >= 0; k--) {
      const at = S.endsAt - k * 1000, d = at - B.now();
      if (d >= 0 && d < 400 && !ticked[key + ":" + k]) {
        ticked[key + ":" + k] = true;
        SFX.playAt(k === 0 ? (S.phase === "draw" ? "pencils" : "timeup") : k <= 3 ? "tickHi" : "tick", at, B.now());
      }
    }
  }, 150);
  let partied = false;
  B.on("final", v => {
    F = v; render();
    if (F && F.stage === 3 && !partied) {
      partied = true; NN.confetti(120);
      const win = (F.podium || [])[0];
      if (navigator.vibrate) navigator.vibrate(win && win.pid === pid ? [200, 80, 200, 80, 400] : [80]);
    }
    if (!F || F.stage < 3) partied = false;
  });
  ready = 1; render();
})();
