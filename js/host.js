(async () => {
  const B = Backend, C = QUIZ_CONFIG, { esc, $, fmt, pick, LETTERS, ordinal, LINES } = NN;
  NN.scenery();
  const app = $("#app");

  const gateJoinUrl = NN.joinUrl();
  // ---------- PIN gate (checked by Neon, not in the page) ----------
  const PINKEY = "nn_host_pin_" + C.gameId;
  const errText = m => /bad_pin/.test(m) ? "Wrong PIN. Try again." : /no_game/.test(m) ? "This quiz hasn't been set up in Neon yet." : /offline/.test(m) ? "No internet connection." : "Couldn't connect: " + m;
  async function tryLogin(pin) { await B.ready; return B.login({ pin }); }
  let saved = sessionStorage.getItem(PINKEY), ok = false;
  if (saved) { try { await tryLogin(saved); ok = true; } catch { sessionStorage.removeItem(PINKEY); } }
  if (!ok) {
    await new Promise(res => {
      app.innerHTML = `<div class="gatewrap">
        <div class="card gatejoin"><h2 class="title sm">PLAYERS: SCAN ME</h2>
          <div class="qr">${window.NNQR ? NNQR.svg(gateJoinUrl) : ""}</div>
          <p class="url">${esc(gateJoinUrl.replace(/^https?:\/\//, ""))}</p></div>
        <div class="card gate">
        <h1 class="logo sm">HOST</h1>
        <p>Enter the host PIN</p>
        <input id="pin" class="big-input" type="password" inputmode="numeric" autocomplete="off" />
        <button id="go" class="btn primary">Unlock</button>
        <p id="err" class="muted"></p></div></div>`;
      const go = async () => {
        const pin = $("#pin").value.trim(); if (!pin) return;
        $("#go").disabled = true; $("#err").textContent = "Checking…";
        try { await tryLogin(pin); sessionStorage.setItem(PINKEY, pin); res(); }
        catch (e) { $("#err").textContent = errText(e.message); $("#go").disabled = false; }
      };
      $("#go").onclick = go;
      $("#pin").onkeydown = e => { if (e.key === "Enter") go(); };
      $("#pin").focus();
    });
  }
  app.innerHTML = `<div class="card center"><p>Loading the quiz…</p></div>`;

  // ---------- quiz source ----------
  // Questions live in Neon behind the host PIN (never in the public site).
  // A local js/questions.js (rehearsal only) is uploaded the first time if Neon has none.
  let QUIZ = null, QSRC = "none";
  try { QUIZ = await B.hostGetQuiz(); if (QUIZ) QSRC = "db"; } catch { }
  if (!QUIZ && window.QUIZ) {
    QUIZ = window.QUIZ; QSRC = "file";
    try { await B.hostPutQuiz(QUIZ); QSRC = "db"; } catch { }
  }
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  // Question plan = your questions, with each drawing round's guess-the-drawing questions
  // slotted in after that round (spread out, or all together), before the next drawing round.
  // The running order starts with a 30-second self-portrait round (unless switched off in setup);
  // those portraits become everyone's picture on the leaderboard, podium and awards.
  let baseCache = null, baseFor = null;
  function baseQs() {
    const qs = (QUIZ && QUIZ.questions) || [];
    if (baseFor === QUIZ && baseCache) return baseCache;
    baseFor = QUIZ;
    const wantPortrait = QUIZ && QUIZ.portraitRound !== false && !qs.some(q => q.type === "draw" && q.portrait);
    baseCache = wantPortrait ? [{ type: "draw", portrait: true, round: "Self-portraits", text: "Self-portraits", duration: QUIZ.portraitSeconds || 30 }, ...qs] : qs;
    return baseCache;
  }
  const markers = () => baseQs().filter(q => q.type === "draw");
  const portraitRound = () => markers().findIndex(m => m.portrait);
  const portraitOf = pid => { const r = portraitRound(); return r < 0 ? null : (((D[r] || {})[pid]) || {}).img || null; };
  const av = (pid, cls) => NN.avatar(portraitOf(pid), nameOf(pid), cls);
  const roundOf = q => markers().indexOf(q);
  function placeDraws(seg, dq) {
    if (!dq || !dq.length) return seg;
    const place = (QUIZ.drawing && QUIZ.drawing.placement) || "spread", n = dq.length, L = seg.length;
    if (place === "after" || !L) return [...dq, ...seg];
    const out = []; let used = 0;
    for (let j = 0; j < L; j++) { const upto = Math.round(((j + 1) * n) / L); out.push(...dq.slice(used, upto)); used = upto; out.push(seg[j]); }
    return out;
  }
  function Q() {
    const base = baseQs(), out = [];
    let r = -1, k = 0, seg = [];
    const flush = () => { out.push(...(r < 0 ? seg : placeDraws(seg, DQ && DQ[r]))); seg = []; };
    for (const q of base) {
      if (q.type === "draw") { flush(); out.push(q); r = k++; } else seg.push(q);
    }
    flush();
    return out;
  }
  const realQs = () => Q().filter(q => q.type !== "draw");
  const qnum = i => Q().slice(0, i + 1).filter(q => q.type !== "draw").length;

  // ---------- live data ----------
  let REV = null, menuOpen = false, D = {}, DQ = {}, ASG = {}, S = { phase: "lobby" }, P = {}, A = {}, R = {}, SC = {}, F = null, connected = true, answersUnsub = null, answersQ = null;

  function watchAnswers() {
    if (S.q === answersQ) return;
    answersUnsub && answersUnsub();
    answersQ = S.q;
    A = {};
    if (S.q == null) return;
    answersUnsub = B.on("answers/" + S.q, v => { A = v || {}; render(); maybeAutoClose(); });
  }

  const players = () => Object.entries(P).map(([id, p]) => ({ id, ...p })).sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
  const nameOf = id => (P[id] && P[id].name) || (SC[id] && SC[id].name) || "Someone";

  // ---------- actions ----------
  async function goQuestion(i) {
    const q = Q()[i];
    if (q.type === "draw") return startDraw(i);
    const dur = q.duration || QUIZ.defaultDuration || 30;
    await B.set("current", {
      index: i, num: qnum(i), total: realQs().length, type: q.type, text: q.text,
      drawingOf: q.drawingOf || null, drawRound: q.drawRound ?? null, artist: q.artist || null, drawMode: q.drawMode || null,
      options: q.type === "choice" ? q.options : null,
      unit: q.unit || null, image: q.image || null, round: q.round || null, double: !!q.double
    });
    await B.set("state", { phase: "question", q: i, endsAt: B.now() + dur * 1000, duration: dur });
  }
  const closeQ = () => B.update("state", { phase: "closed", closedAt: B.now() });

  // ---------- drawing rounds (each has its own prompts, drawings and questions) ----------
  const DCFG = () => QUIZ.drawing || {};
  const usedPrompts = () => new Set(Object.values(ASG).flatMap(x => Object.values(x || {})).filter(x => x !== NN.PORTRAIT_PROMPT));
  async function startDraw(i) {
    const q = Q()[i], r = roundOf(q);
    const used = usedPrompts(), all = QUIZ.drawPrompts && QUIZ.drawPrompts.length ? QUIZ.drawPrompts : ["A very important meeting"];
    const fresh = shuffle(all.filter(x => !used.has(x))), pool = fresh.length >= players().length ? fresh : [...fresh, ...shuffle(all.filter(x => used.has(x)))];
    const asg = {};
    players().forEach((p, k) => (asg[p.id] = q.portrait ? NN.PORTRAIT_PROMPT : pool[k % pool.length]));
    await B.remove("drawings/" + r); await B.remove("dq/" + r); if (DQ) delete DQ[r];
    await B.set("drawAssign/" + r, asg);
    const dur = q.duration || 90;
    await B.set("current", { index: i, type: "draw", drawRound: r, portrait: !!q.portrait, text: q.text || "Drawing round", round: q.round || "Drawing round", total: realQs().length });
    await B.set("state", { phase: "draw", q: i, endsAt: B.now() + dur * 1000, duration: dur });
  }
  async function assignLate() {
    if (S.phase !== "draw") return;
    const r = roundOf(Q()[S.q]); if (r < 0) return;
    const mine = ASG[r] || {}, missing = players().filter(p => !mine[p.id]);
    if (!missing.length) return;
    const used = usedPrompts(), pool = shuffle((QUIZ.drawPrompts || []).filter(x => !used.has(x)));
    const upd = {};
    const portrait = markers()[r] && markers()[r].portrait;
    missing.forEach((p, k) => (upd[p.id] = portrait ? NN.PORTRAIT_PROMPT : pool[k] || pick(QUIZ.drawPrompts)));
    await B.update("drawAssign/" + r, upd);
  }
  async function buildDrawQs(r) {
    const d = (await B.get("drawings/" + r)) || {}, asg = (await B.get("drawAssign/" + r)) || {};
    const arts = shuffle(Object.entries(d).filter(([, x]) => x && x.img));
    const cfg = DCFG(), mode = cfg.mode || "both";
    const allPrompts = [...new Set([...Object.values(asg), ...(QUIZ.drawPrompts || [])])];
    const names = players().map(p => p.name);
    const max = cfg.maxQuestions ?? 10;
    const label = markers().length > 1 ? `Drawing round ${r + 1}` : "Drawing round";
    const list = arts.slice(0, max).map(([pid, x], k) => {
      const prompt = x.prompt || asg[pid] || "?", name = nameOf(pid);
      let m = mode === "both" ? (k % 2 ? "who" : "what") : mode;
      if (m === "who" && names.length < 3) m = "what";
      const decoys = m === "what" ? shuffle(allPrompts.filter(p => p !== prompt)).slice(0, 3) : shuffle(names.filter(n => n !== name)).slice(0, 3);
      const options = shuffle([m === "what" ? prompt : name, ...decoys]);
      return {
        type: "choice", drawMode: m, drawingOf: pid, drawRound: r, artist: pid, round: label,
        text: m === "what" ? pick(["What on earth is this?", "Name this masterpiece", "What's going on here?", "Explain this to HR"]) : pick(["Who drew this?", "Whose handiwork is this?", "Name the artist"]),
        options, answer: options.indexOf(m === "what" ? prompt : name),
        duration: cfg.guessDuration || 20,
        funFact: `${name} was asked to draw: “${prompt}”`
      };
    });
    DQ = Object.assign({}, DQ || {}, { [r]: list });
    await B.set("dq/" + r, list);
    return list;
  }
  // every drawing from every round, for the gallery
  const allDrawings = () => Object.entries(D || {}).flatMap(([r, byPid]) =>
    Object.entries(byPid || {}).filter(([, d]) => d && d.img).map(([pid, d]) => ({ r: +r, pid, img: d.img, prompt: markers()[r] && markers()[r].portrait ? "Self-portrait" : d.prompt || (ASG[r] || {})[pid] || "" })));

  function maybeAutoClose() {
    if (S.phase !== "question" || QUIZ.autoCloseWhenAllAnswered === false) return;
    const art = (Q()[S.q] || {}).artist;
    const n = Object.keys(P).filter(id => id !== art).length;
    if (n && Object.keys(A).filter(id => P[id] && id !== art).length >= n && maybeAutoClose.q !== S.q) {
      const q = S.q; maybeAutoClose.q = q;
      setTimeout(() => S.phase === "question" && S.q === q && closeQ(), 1200);
    }
  }

  function score(q, ans, st) {
    // returns {pid: {pts, ok, v, err?, secs?}}
    const out = {}, mult = q.double ? 2 : 1, durMs = st.duration * 1000, grace = 1500;
    const entries = Object.entries(ans || {});
    if (q.type === "choice") {
      for (const [pid, a] of entries) {
        if (pid === q.artist) continue;
        const late = a.at > st.endsAt + grace;
        const ok = a.v === q.answer && !late;
        const left = Math.max(0, Math.min(1, (st.endsAt - a.at) / durMs));
        out[pid] = { v: a.v, ok, secs: Math.max(0, (a.at - (st.endsAt - durMs)) / 1000), pts: ok ? Math.round((500 + 500 * left) * mult) : 0 };
      }
      if (q.artist) {
        const per = q.drawMode === "what" ? (DCFG().artistBonus ?? 150) : 0;
        const fooled = q.drawMode === "who" ? (DCFG().fooledBonus ?? 100) : 0;
        const right = Object.values(out).filter(r => r.ok).length, wrong = Object.values(out).length - right;
        out[q.artist] = { artist: true, ok: false, v: null, pts: (per * right + fooled * wrong) * mult, right };
      }
    } else {
      const tol = q.tolerance ?? 0.02, zeroAt = q.zeroAt ?? 0.5, base = Math.max(Math.abs(q.answer), 1e-9);
      let best = Infinity;
      for (const [pid, a] of entries) {
        if (a.at > st.endsAt + grace || typeof a.v !== "number") { out[pid] = { v: a.v, ok: false, pts: 0, err: null }; continue; }
        const err = Math.abs(a.v - q.answer) / base;
        best = Math.min(best, err);
        const ok = err <= tol;
        const pts = ok ? 1000 : Math.round(800 * Math.max(0, 1 - err / zeroAt));
        out[pid] = { v: a.v, ok, pts, err };
      }
      for (const pid in out) if (out[pid].err === best) { out[pid].pts += 200; out[pid].bullseye = true; }
      for (const pid in out) out[pid].pts *= mult;
    }
    return out;
  }

  function summarise(q, res) {
    const rows = Object.entries(res).filter(([, r]) => !r.artist).map(([pid, r]) => ({ pid, name: nameOf(pid), ...r }));
    const sum = { answered: rows.length, players: Object.keys(P).length };
    if (q.type === "choice") {
      sum.counts = q.options.map((_, i) => rows.filter(r => r.v === i).length);
      const right = rows.filter(r => r.ok).sort((a, b) => a.secs - b.secs);
      sum.right = right.map(r => ({ name: r.name, secs: +r.secs.toFixed(1) }));
      sum.fastest = right[0] ? { pid: right[0].pid, name: right[0].name, secs: +right[0].secs.toFixed(1) } : null;
    } else {
      const valid = rows.filter(r => r.err != null).sort((a, b) => a.err - b.err);
      sum.closest = valid.slice(0, 3).map(r => ({ name: r.name, v: r.v }));
      const w = valid.at(-1);
      sum.wildest = w && valid.length > 1 ? { pid: w.pid, name: w.name, v: w.v, err: w.err } : null;
      sum.avg = valid.length ? valid.reduce((s, r) => s + r.v, 0) / valid.length : null;
      sum.right = valid.filter(r => r.ok).map(r => ({ name: r.name }));
    }
    if (q.artist) sum.players = Math.max(0, sum.players - 1);
    sum.line = q.type === "number" ? (rows.length && !sum.right.length && Math.random() < .4 ? "Nobody spot on. Close-ish counts though." : "")
      : !rows.length || !sum.right.length ? pick(LINES.nobody)
      : sum.right.length === sum.players && sum.players > 1 ? pick(LINES.everyone) : "";
    return sum;
  }

  function totals(allResults) {
    const t = {};
    const qs = Object.keys(allResults).map(Number).sort((a, b) => a - b);
    for (const pid of new Set([...Object.keys(P), ...Object.keys(SC)])) {
      t[pid] = { name: nameOf(pid), total: 0, correct: 0, streak: 0, best: 0, fastest: 0, answered: 0 };
    }
    for (const qi of qs) {
      const res = allResults[qi] || {};
      let fastest = null;
      for (const pid in t) {
        const r = res[pid];
        if (r && r.artist) { t[pid].total += r.pts; continue; }
        if (r) { t[pid].total += r.pts; t[pid].answered++; }
        if (r && r.ok) { t[pid].correct++; t[pid].streak++; t[pid].best = Math.max(t[pid].best, t[pid].streak); if (r.secs != null && (!fastest || r.secs < fastest.secs)) fastest = { pid, secs: r.secs }; }
        else t[pid].streak = 0;
      }
      if (fastest) t[fastest.pid].fastest++;
    }
    const ranked = Object.entries(t).sort((a, b) => b[1].total - a[1].total);
    ranked.forEach(([pid, s], i) => {
      s.rank = i > 0 && ranked[i - 1][1].total === s.total ? ranked[i - 1][1].rank : i + 1;
      s.prevRank = (SC[pid] && SC[pid].rank) || null;
      s.of = ranked.length;
    });
    return t;
  }

  async function reveal() {
    const i = S.q, q = Q()[i];
    const ans = (await B.get("answers/" + i)) || {};
    const res = score(q, ans, S);
    const all = { ...((await B.get("results")) || {}), [i]: res };
    const sum = summarise(q, res);
    await B.set("results/" + i, res);
    await B.set("scores", totals(all));
    await B.set("reveal", { index: i, type: q.type, answer: q.answer, answerText: q.type === "choice" ? q.options[q.answer] : null, artist: q.artist || null, drawMode: q.drawMode || null, unit: q.unit || null, funFact: q.funFact || null, sum });
    await B.update("state", { phase: "reveal" });
    backup();
  }

  async function startFinal() {
    const sc = (await B.get("scores")) || {};
    const ranked = Object.entries(sc).sort((a, b) => b[1].total - a[1].total);
    const prizes = QUIZ.prizes || [];
    const podium = ranked.slice(0, 3).map(([pid, s], i) => ({ pid, name: s.name, total: s.total, prize: prizes[i] || null }));
    const awards = [];
    const aw = QUIZ.awards || {};
    if (aw.fastestFinger !== false) {
      const f = ranked.map(([pid, s]) => ({ pid, ...s })).sort((a, b) => b.fastest - a.fastest)[0];
      if (f && f.fastest) awards.push({ title: "Fastest Finger", pid: f.pid, name: f.name, detail: `First correct answer ${f.fastest}× — reflexes of a getaway driver`, prize: aw.fastestFingerPrize || null });
    }
    if (aw.hotStreak !== false) {
      const f = ranked.map(([pid, s]) => ({ pid, ...s })).sort((a, b) => b.best - a.best)[0];
      if (f && f.best >= 3) awards.push({ title: "Hot Streak", pid: f.pid, name: f.name, detail: `${f.best} correct in a row`, prize: aw.hotStreakPrize || null });
    }
    if (aw.wildestGuess !== false) {
      const allRes = (await B.get("results")) || {}, rev = [];
      let worst = null;
      for (const qi in allRes) {
        const q = Q()[qi]; if (!q || q.type !== "number") continue;
        for (const pid in allRes[qi]) { const r = allRes[qi][pid]; if (r.err != null && (!worst || r.err > worst.err)) worst = { pid, err: r.err, v: r.v, q }; }
      }
      if (worst && worst.err > 0.25) awards.push({ title: "Wildest Guess", pid: worst.pid, name: (sc[worst.pid] || {}).name, detail: `Guessed ${fmt(worst.v)} when the answer was ${fmt(worst.q.answer)}${worst.q.unit ? " " + worst.q.unit : ""}`, prize: aw.wildestGuessPrize || null });
    }
    if (aw.pudding !== false && ranked.length > 4) {
      const [pid, s] = ranked.at(-1);
      awards.push({ title: "Christmas Pudding Award", pid, name: s.name, detail: "Last place, first in our hearts", prize: aw.puddingPrize || null });
    }
    await B.set("final", { stage: 0, podium, awards });
    await B.update("state", { phase: "final" });
    backup();
  }

  let busy = false;
  async function next() {
    if (busy) return;
    busy = true; render();
    try { await step(); } finally { busy = false; render(); }
  }
  async function step() {
    const ph = S.phase || "lobby";
    if (ph === "lobby") return Q().length && goQuestion(0);
    if (ph === "draw") return B.update("state", { phase: "drawdone" });
    if (ph === "drawdone") {
      await new Promise(r => setTimeout(r, 1500)); // let last auto-submits land
      if (!Q()[S.q].portrait) await buildDrawQs(roundOf(Q()[S.q]));
      return S.q + 1 < Q().length ? goQuestion(S.q + 1) : startFinal();
    }
    if (ph === "question") return closeQ();
    if (ph === "closed") return reveal();
    if (ph === "reveal") return B.update("state", { phase: "board" });
    if (ph === "board") return S.q + 1 < Q().length ? goQuestion(S.q + 1) : startFinal();
    if (ph === "final" && F && F.stage < finalMax()) return B.update("final", { stage: F.stage + 1 });
  }

  const finalMax = () => (allDrawings().length ? 5 : 4);
  async function backup() {
    try { localStorage.setItem("nn_backup_" + C.gameId, JSON.stringify(await B.get(""))); } catch { }
  }
  function download(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; a.click();
  }
  async function exportAll() {
    const tree = await B.get("");
    download(`quiz-${C.gameId}.json`, JSON.stringify(tree, null, 2), "application/json");
    const rows = Object.values((tree && tree.scores) || {}).sort((a, b) => a.rank - b.rank)
      .map(s => [s.rank, `"${String(s.name).replace(/"/g, '""')}"`, s.total, s.correct, s.best, s.fastest].join(","));
    download(`scores-${C.gameId}.csv`, ["Rank,Name,Points,Correct,Best streak,Fastest answers", ...rows].join("\n"), "text/csv");
  }

  // ---------- rendering ----------
  const joinUrl = NN.joinUrl;
  const qr = url => (window.NNQR ? NNQR.svg(url) : "");
  let qrOpen = false;
  const qrOverlay = () => qrOpen ? `<div class="modal qrmodal" data-act="qrclose">
      <div class="card qrbig"><h2 class="title sm">SCAN TO PLAY</h2><div class="qr">${qr(joinUrl())}</div>
      <p class="url">${esc(joinUrl().replace(/^https?:\/\//, ""))}</p><p class="muted small">Tap anywhere to close</p></div></div>` : "";
  function optionsHtml(q, counts, correct) {
    const max = counts ? Math.max(1, ...counts) : 1;
    return `<div class="opts host">${q.options.map((o, i) => `
      <div class="opt c${i} ${correct != null ? (i === correct ? "right" : "dim") : ""}">
        <b>${LETTERS[i]}</b><span>${esc(o)}</span>
        ${counts ? `<em class="bar" style="--w:${(counts[i] / max) * 100}%"></em><strong class="cnt">${counts[i]}</strong>` : ""}
      </div>`).join("")}</div>`;
  }
  const qHead = (q, i) => `<div class="qhead">
      <span class="pill">${q.round ? esc(q.round) + " · " : ""}Q${qnum(i)}/${realQs().length}</span>
      ${q.double ? `<span class="pill hot">DOUBLE POINTS</span>` : ""}
    </div>`;

  function controls() {
    const ph = S.phase || "lobby", last = S.q + 1 >= Q().length;
    const label = {
      lobby: "Start the quiz ▶", draw: "Pencils down ■", drawdone: "Start guessing ▶", question: "Stop answers ■", closed: "Reveal answer ▶", reveal: "Leaderboard ▶",
      board: last ? "Final results ▶" : "Next question ▶",
      final: !F ? "…" : F.stage >= finalMax() ? "That's a wrap" : ["Reveal 3rd place ▶", "Reveal 2nd place ▶", "Reveal the winner ▶", "Special awards ▶", "The gallery ▶"][F.stage]
    }[ph];
    const done = ph === "final" && F && F.stage >= finalMax();
    let live = "";
    if (ph === "question" || ph === "closed" || ph === "draw") {
      const q = Q()[S.q] || {}, ps = players();
      const n = ph === "draw" ? ps.filter(p => ((D[roundOf(q)] || {})[p.id] || {}).img).length : ps.filter(p => A[p.id] && p.id !== q.artist).length;
      const of = ph === "draw" ? ps.length : ps.filter(p => p.id !== q.artist).length;
      live = `<span class="ctl-live"><b id="tleft2">${ph === "closed" ? "TIME" : ""}</b> · ${n}/${of} ${ph === "draw" ? "drawn" : "in"}</span>`;
    }
    return `<div class="controls">
      ${live}
      ${ph === "question" || ph === "draw" ? `<button class="btn" data-act="plus">+10s</button>` : ""}
      <button class="btn primary big" data-act="next" ${busy || done || (ph === "lobby" && !Q().length) ? "disabled" : ""}>${label}</button>
      <span class="hint">Space = next</span>
    </div>`;
  }

  function topbar() {
    const n = Object.keys(P).length;
    return `<header class="topbar">
      <div class="brand">${esc(QUIZ.title || "LMK 26")}</div>
      <span class="pill ${B.mode === "local" ? "warn" : "live"}">${B.mode === "local" ? "LOCAL TEST MODE" : "LIVE"}</span>
      <span id="conn" class="dot ${connected ? "" : "off"}" title="Connection"></span>
      <span class="pill">👥 ${n}</span>
      <span class="grow"></span>
      <button class="btn sm" data-act="export">Save results</button>
      <button class="btn sm" data-act="qr" title="Show the join QR code full screen">📱 Join QR</button>
      <button class="btn sm ghost" data-act="menu">⋯</button>
    </header>`;
  }

  function stage() {
    const ph = S.phase || "lobby";
    const ps = players();
    if (ph === "lobby") {
      const todo = Q().filter(q => q.todo).length;
      return `<section class="lobby">
        <div class="hero"><h1 class="logo">${esc(QUIZ.title || "LMK 26")}</h1><p class="sub">${esc(QUIZ.subtitle || "")}</p></div>
        <div class="joinbox card">
          <div class="qr">${qr(joinUrl())}</div>
          <div><p class="muted">Grab your phone and go to</p><p class="url">${esc(joinUrl().replace(/^https?:\/\//, ""))}</p>
          <p class="muted small">${realQs().length} questions${Q().some(q => q.type === "draw") ? " + drawing round" : ""} loaded${todo ? ` · <span class="warn-t">⚠ ${todo} still placeholders</span>` : ""}</p></div>
        </div>
        <div class="chips">${ps.map(p => `<button class="chip" data-kick="${p.id}" title="Tap to remove">${esc(p.name)}</button>`).join("") || `<p class="muted">Waiting for players…</p>`}</div>
      </section>`;
    }
    if (ph === "draw" || ph === "drawdone") {
      const dr = D[roundOf(Q()[S.q])] || {}, done = ps.filter(p => dr[p.id] && dr[p.id].img);
      return `<section class="qscreen drawscreen">
        ${(() => { const pq = Q()[S.q], portrait = !!pq.portrait, nFun = markers().filter(m => !m.portrait).length, k = markers().filter(m => !m.portrait).indexOf(pq);
          return `<div class="qhead"><span class="pill hot">${portrait ? "SELF-PORTRAITS" : esc(nFun > 1 ? `DRAWING ROUND ${k + 1}` : "DRAWING ROUND")}</span></div>
        <h2 class="qtext">${ph === "draw" ? (portrait ? "Draw yourself — and write your name!" : "Grab your phone. Draw your secret prompt.") : "PENCILS DOWN"}</h2>
        <p class="sub">${ph === "draw" ? (portrait ? "You've got 30 seconds. This is your picture for the rest of the night, so make it count." : "No words, no letters, no numbers. Just raw artistic talent.") : portrait ? `${done.length} self-portraits in. Gorgeous, every one of you.` : `${done.length} masterpieces received. Time to guess what on earth they are.`}</p>`; })()}
        <div class="qfoot">
          ${ph === "draw" ? `<div class="timer"><span id="tleft"></span></div>` : ""}
          <div class="answered"><strong>${done.length}/${ps.length}</strong> submitted
            <div class="mini">${done.map(p => `<span>${esc(p.name)} ✓</span>`).join("")}</div></div>
        </div></section>`;
    }
    if (ph === "question" || ph === "closed") {
      const q = Q()[S.q], answered = ps.filter(p => A[p.id] && p.id !== q.artist), need = ps.filter(p => p.id !== q.artist).length;
      return `<section class="qscreen">
        ${qHead(q, S.q)}
        <h2 class="qtext">${esc(q.text)}</h2>
        ${q.drawingOf ? `<div class="revwrap">${art(q, true)}<div>${optionsHtml(q)}</div></div>` : `${art(q)}
        ${q.type === "choice" ? optionsHtml(q) : `<div class="numhint card">Type your best guess${q.unit ? ` (${esc(q.unit)})` : ""} — closest wins</div>`}`}
        <div class="qfoot">
          <div class="timer ${ph === "closed" ? "done" : ""}"><span id="tleft">${ph === "closed" ? "TIME" : ""}</span></div>
          <div class="answered"><strong>${answered.length}/${need}</strong> locked in
            <div class="mini">${answered.map(p => `<span>${esc(p.name)}</span>`).join("")}</div></div>
        </div>
      </section>`;
    }
    if (ph === "reveal") {
      const q = Q()[S.q];
      return revealHtml(q);
    }
    if (ph === "board") return boardHtml();
    if (ph === "final") return finalHtml();
    return "";
  }

  const artImg = q => ((D[q.drawRound] || {})[q.drawingOf] || {}).img;
  const art = (q, small) => q.drawingOf ? (artImg(q) ? `<img class="drawing ${small ? "sm" : ""}" src="${artImg(q)}" alt="drawing">` : `<p class="muted">Loading drawing…</p>`)
    : q.image ? `<img class="qimg" src="${esc(q.image)}" alt="">` : "";
  function artistLine(q) {
    const r = (R[S.q] || {})[q.artist];
    return r ? `<p class="small center">🎨 <b>${esc(nameOf(q.artist))}</b> banks <b>+${fmt(r.pts)}</b> ${q.drawMode === "what" ? `for ${r.right} correct guess${r.right === 1 ? "" : "es"}` : "for everyone they fooled"}</p>` : "";
  }
  function galleryHtml() {
    return `<div class="gallery">${allDrawings().map(d => `<figure><img src="${d.img}" alt=""><figcaption><b>${esc(nameOf(d.pid))}</b>${esc(d.prompt)}</figcaption></figure>`).join("")}</div>`;
  }
  async function exportGallery() {
    const items = allDrawings();
    const html = `<!doctype html><meta charset="utf-8"><title>${esc(QUIZ.title)} — Gallery</title>
<style>body{background:#2b0f5c;color:#fff;font-family:system-ui;margin:24px}h1{font-family:Anton,Impact,sans-serif;font-size:56px;color:#ffd23f;text-shadow:4px 4px 0 #160a2b}div{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:22px}figure{margin:0;background:#fff;color:#160a2b;padding:10px;border-radius:12px;border:3px solid #160a2b;box-shadow:6px 6px 0 #160a2b}img{width:100%;border-radius:6px;border:2px solid #160a2b}figcaption b{display:block;color:#ff2f86}</style>
<h1>${esc(QUIZ.title)} — The Gallery</h1><div>${items.map(d => `<figure><img src="${d.img}"><figcaption><b>${esc(nameOf(d.pid))}</b>${esc(d.prompt)}</figcaption></figure>`).join("")}</div>`;
    download(`gallery-${C.gameId}.html`, html, "text/html");
  }
  function revealHtml(q) {
    const sum = (REV && REV.index === S.q && REV.sum) || { right: [], counts: q.options && q.options.map(() => 0) };
    let body;
    if (q.type === "choice") {
      body = `${optionsHtml(q, sum.counts, q.answer)}
        <div class="who card"><h3>Got it right (${sum.right.length})</h3>
          <div class="mini big">${sum.right.map((r, i) => `<span class="${i === 0 ? "gold" : ""}">${esc(r.name)} <small>${r.secs}s</small></span>`).join("") || "<span>Nobody!</span>"}</div>
          ${sum.fastest ? `<p class="small">⚡ Fastest: <b>${esc(sum.fastest.name)}</b> in ${sum.fastest.secs}s</p>` : ""}</div>`;
    } else {
      body = `<div class="bignum"><small>The answer</small>${fmt(q.answer)}<small>${esc(q.unit || "")}</small></div>
        <div class="cols">
          <div class="who card"><h3>Closest</h3><ol>${(sum.closest || []).map(c => `<li><b>${esc(c.name)}</b> — ${fmt(c.v)}</li>`).join("") || "<li>No guesses</li>"}</ol></div>
          <div class="who card"><h3>Wildest guess</h3>${sum.wildest ? `<p><b>${esc(sum.wildest.name)}</b> said <b>${fmt(sum.wildest.v)}</b></p><p class="muted small">${pick(LINES.far)}</p>` : "<p>—</p>"}
            ${sum.avg != null ? `<p class="small">Room average: ${fmt(Math.round(sum.avg))}</p>` : ""}</div>
        </div>`;
    }
    return `<section class="qscreen reveal">
      ${qHead(q, S.q)}<h2 class="qtext sm">${esc(q.text)}</h2>
      ${q.drawingOf ? `<div class="revwrap">${art(q, true)}<div>${body}</div></div>` : body}
      ${q.artist && REV && REV.index === S.q ? artistLine(q) : ""}
      ${sum.line ? `<p class="zinger">${esc(sum.line)}</p>` : ""}
      ${q.funFact ? `<div class="fact card"><b>The real story:</b> ${esc(q.funFact)}</div>` : ""}
    </section>`;
  }

  function boardHtml() {
    const rows = Object.entries(SC).map(([id, s]) => ({ id, ...s })).sort((a, b) => a.rank - b.rank || b.total - a.total).slice(0, 10);
    return `<section class="board">
      <h2 class="title">STANDINGS <small>after Q${S.q + 1}</small></h2>
      <ol class="lb">${rows.map(r => {
        const mv = r.prevRank ? r.prevRank - r.rank : 0;
        return `<li><span class="rk">${r.rank}</span>${av(r.id, "sm")}<span class="nm">${esc(r.name)}</span>${NN.stars(r.streak)}
          <span class="mv ${mv > 0 ? "up" : mv < 0 ? "down" : ""}">${mv > 0 ? "▲" + mv : mv < 0 ? "▼" + -mv : ""}</span><span class="pts">${fmt(r.total)}</span></li>`;
      }).join("")}</ol></section>`;
  }

  function finalHtml() {
    if (!F) return "";
    const pod = F.podium || [], st = F.stage;
    const slot = (i, cls) => {
      const p = pod[i], shown = st >= 3 - i;
      return `<div class="pod ${cls} ${shown ? "show" : ""}">
        ${shown && p ? `${av(p.pid, i === 0 ? "xl" : "lg")}<div class="pname">${esc(p.name)}</div><div class="ppts">${fmt(p.total)} pts</div>
          ${p.prize ? `<div class="prize">🎁 ${esc(p.prize.name)}${p.prize.from ? `<small>from ${esc(p.prize.from)}</small>` : ""}</div>` : ""}` : `<div class="pname">?</div>`}
        <div class="block">${ordinal(i + 1)}</div></div>`;
    };
    return `<section class="final">
      ${st === 4 ? `<h2 class="title">SPECIAL AWARDS</h2>` : ""}
      ${st === 3 && pod[0] ? NN.celebration(portraitOf(pod[0].pid), pod[0].name, pod[0].total, pod[0].prize, false) : ""}
      ${st < 4 ? `<h2 class="title">${st >= 3 ? "WE HAVE A WINNER" : "THE FINAL COUNTDOWN"}</h2>
      <div class="podium">${slot(1, "p2")}${slot(0, "p1")}${slot(2, "p3")}</div>` : ""}
      ${st === 4 ? `<div class="awards">${(F.awards || []).map(a => `<div class="card award"><h3>${esc(a.title)}</h3>${av(a.pid, "md")}<p class="pname">${esc(a.name)}</p><p class="small">${esc(a.detail)}</p>${a.prize ? `<p class="prize">🎁 ${esc(a.prize)}</p>` : ""}</div>`).join("")}</div>
        ${st < 5 ? `<p class="zinger">Merry Christmas, you lot. 🎄</p>` : ""}` : ""}
      ${st >= 5 ? `<h2 class="title sm">THE GALLERY</h2>${galleryHtml()}` : ""}
    </section>`;
  }

  function render() {
    if (!QUIZ) { app.innerHTML = `<div class="card center"><h2>No questions yet</h2><p>Make them in the <a href="builder.html" target="_blank" rel="noopener">question builder</a> (it uploads straight here), or load a quiz file. They're stored in Neon where only the host PIN can read them — never on the public website.</p>${fileBtn()} <button class="btn sm ghost" data-act="reloadq">↻ I've uploaded them — reload</button></div>`; bindFile(); return; }
    app.innerHTML = topbar() + `<main class="stage">${stage()}</main>` + controls() + menuHtml() + qrOverlay();
    bindFile(); tick();
  }
  const fileBtn = () => `<label class="btn sm">Load quiz file<input type="file" id="qfile" accept=".json,.js" hidden></label>`;
  function menuHtml() {
    if (!menuOpen) return "";
    return `<div class="modal" data-act="menubg"><div class="card menu">
      <h3>Host menu</h3>
      <p class="small muted">Game id: <b>${esc(C.gameId)}</b> · ${B.mode === "local" ? "local test mode" : "live on Neon"}</p>
      <p class="small">Quiz: <b>${esc(QUIZ.title)}</b> — ${realQs().length} questions ${QSRC === "db" ? (B.mode === "neon" ? "(stored in Neon, host-only)" : "(stored in this browser)") : "(not saved)"}</p>
      <div class="row"><a class="btn sm" href="builder.html" target="_blank" rel="noopener">✏️ Question builder</a>${fileBtn()}<button class="btn sm ghost" data-act="reloadq">↻ Reload questions</button></div>
      <div class="row"><button class="btn sm" data-act="export">Download results (JSON + CSV)</button></div>
      <div class="row"><button class="btn sm" data-act="gallery" ${allDrawings().length ? "" : "disabled"}>Download drawings gallery</button></div>
      <div class="row"><button class="btn sm" data-act="jump">Jump to question…</button></div>
      <div class="row"><button class="btn sm danger" data-act="reset">Reset game (wipes scores)</button></div>
      <div class="row"><button class="btn sm ghost" data-act="menu">Close</button></div>
    </div></div>`;
  }
  function bindFile() {
    const f = $("#qfile"); if (!f) return;
    f.onchange = async () => {
      const text = await f.files[0].text();
      try {
        const quiz = /^\s*[{[]/.test(text) ? JSON.parse(text) : new Function("window", text + "\n;return window.QUIZ;")({});
        if (!quiz || !Array.isArray(quiz.questions)) throw new Error("No questions found");
        await B.hostPutQuiz(quiz); QUIZ = quiz; QSRC = "db"; menuOpen = false; render();
      } catch (e) { alert("Couldn't read that quiz file: " + e.message); }
    };
  }

  function tick() {
    const el = $("#tleft"), t = $(".timer"), el2 = $("#tleft2");
    if ((!el && !el2) || (S.phase !== "question" && S.phase !== "draw")) return;
    const left = Math.max(0, (S.endsAt - B.now()) / 1000);
    if (el2) el2.textContent = Math.ceil(left) + "s";
    if (el && t) {
    el.textContent = Math.ceil(left);
    t.style.setProperty("--p", left / S.duration);
    t.classList.toggle("low", left <= 5);
    }
    if (left <= 0 && !tick.closing) {
      tick.closing = true;
      (S.phase === "draw" ? B.update("state", { phase: "drawdone" }) : closeQ()).finally(() => (tick.closing = false));
    }
  }
  setInterval(tick, 200);

  app.addEventListener("click", async e => {
    const kick = e.target.closest("[data-kick]");
    if (kick) { if (confirm(`Remove ${kick.textContent}?`)) { await B.remove("players/" + kick.dataset.kick); } return; }
    const b = e.target.closest("[data-act]"); if (!b) return;
    const act = b.dataset.act;
    if (act === "menubg") { if (e.target === b) { menuOpen = false; render(); } return; }
    if (act === "next") await next();
    if (act === "plus") await B.update("state", { endsAt: S.endsAt + 10000, duration: S.duration + 10 });
    if (act === "export") { await exportAll(); if (allDrawings().length) await exportGallery(); }
    if (act === "gallery") await exportGallery();
    if (act === "menu") { menuOpen = !menuOpen; render(); }
    if (act === "qr") { qrOpen = true; render(); }
    if (act === "reloadq") {
      try { const fresh = await B.hostGetQuiz(); if (fresh) { QUIZ = fresh; QSRC = "db"; menuOpen = false; render(); alert(`Loaded ${fresh.questions.filter(q => q.type !== "draw").length} questions from the quiz database.`); } else alert("No questions saved yet."); }
      catch (e) { alert("Couldn't reload: " + e.message); }
    }
    if (act === "qrclose") { qrOpen = false; render(); }
    if (act === "jump") {
      const n = parseInt(prompt(`Jump to which question? (1–${Q().length})`), 10);
      if (n >= 1 && n <= Q().length) { menuOpen = false; await goQuestion(n - 1); }
    }
    if (act === "reset") {
      if (prompt('This wipes all players and scores for this game. Type RESET to confirm.') === "RESET") {
        await backup();
        await B.reset();
        DQ = {}; await B.set("state", { phase: "lobby" }); menuOpen = false; render();
      }
    }
  });
  document.addEventListener("keydown", e => {
    if (e.code === "Space" && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
      e.preventDefault(); const b = $('[data-act="next"]'); b && !b.disabled && b.click();
    }
  });
  window.addEventListener("beforeunload", backup);

  if (!(await B.get("state"))) await B.set("state", { phase: "lobby" });
  B.on("state", v => { S = v || { phase: "lobby" }; watchAnswers(); render(); });
  B.on("players", v => { P = v || {}; render(); assignLate(); });
  B.on("drawings", v => { D = v || {}; render(); });
  B.on("drawAssign", v => { ASG = v || {}; });
  B.on("dq", v => { DQ = v || {}; render(); });
  B.on("results", v => { R = v || {}; });
  B.on("scores", v => { SC = v || {}; render(); });
  let partied = false;
  B.on("final", v => { F = v; render(); if (F && F.stage === 3 && !partied) { partied = true; NN.confetti(140); } if (!F || F.stage < 3) partied = false; });
  B.on("reveal", v => { REV = v; render(); });
  B.onConnection(c => { connected = c; const d = $("#conn"); d && d.classList.toggle("off", !c); });
  render();
})();
