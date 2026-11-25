// LMK 26 — question builder: edit the quiz one question at a time, then upload to Neon or download the .js file.
(async () => {
  const B = Backend, C = QUIZ_CONFIG, { esc, $, LETTERS, parseNum, fmt } = NN;
  NN.scenery();
  const app = $("#app");
  const DKEY = "nn_builder_draft_" + C.gameId, PINKEY = "nn_host_pin_" + C.gameId;
  const clone = o => JSON.parse(JSON.stringify(o));
  await B.ready;

  const DEFAULT_PROMPTS = window.LMK_PROMPT_PACK ? window.LMK_PROMPT_PACK.slice() : ["The printer jamming at 4:59 on a Friday", "Accidentally hitting Reply All", "Someone microwaving fish in the staff kitchen",
    "Pretending to look busy when the boss walks past", "The last biscuit in the tin", "A meeting that should have been an email", "You're on mute",
    "The delivery van stuck down a country lane", "Hiding from a customer's phone call", "Monday morning before the first coffee", "The office plant nobody waters",
    "IT asking 'have you tried turning it off and on again?'", "The forklift doing a 12-point turn", "Stocktake on Christmas Eve",
    "Your laptop updating right before a big presentation", "Secret Santa gone wrong", "Someone stealing your parking space", "The kettle queue at 10am",
    "Leaving early and getting caught", "The fire drill in the pouring rain", "A customer saying 'it's urgent'", "The mystery smell in the warehouse",
    "Trying to find the right spreadsheet", "Out of office: gone fishing", "The pallet that collapsed", "Asking for a pay rise", "Lunch stolen from the fridge",
    "Falling asleep on a Teams call", "The office chair that won't stop sinking", "Zoom call with the cat filter stuck on"];
  const TEMPLATE = {
    title: "LMK 26", subtitle: "The LMK Christmas Quiz · Black Bull, Balsham", defaultDuration: 30, autoCloseWhenAllAnswered: true,
    prizes: [{ name: "", from: "" }, { name: "", from: "" }, { name: "", from: "" }],
    awards: { fastestFinger: true, hotStreak: true, wildestGuess: true, pudding: true },
    drawing: { mode: "both", placement: "spread", guessDuration: 20, maxQuestions: 10, artistBonus: 150, fooledBonus: 100 },
    drawPrompts: DEFAULT_PROMPTS,
    questions: [{ round: "Round 1", type: "choice", text: "", options: ["", "", "", ""], answer: null }]
  };

  // ---------- state ----------
  let quiz = null, saved = null, view = "start", qi = 0, loggedIn = B.mode === "local" && false, live = null, note = "", busy = false;
  try { const d = JSON.parse(localStorage.getItem(DKEY)); if (d && d.quiz) saved = d; } catch { }
  function normalise(q) {
    q = clone(q || TEMPLATE);
    q.prizes = [0, 1, 2].map(i => ({ name: (q.prizes && q.prizes[i] && q.prizes[i].name) || "", from: (q.prizes && q.prizes[i] && q.prizes[i].from) || "" }));
    q.awards = Object.assign({ fastestFinger: true, hotStreak: true, wildestGuess: true, pudding: true }, q.awards || {});
    q.drawing = Object.assign({}, TEMPLATE.drawing, q.drawing || {});
    if (q.portraitRound == null) q.portraitRound = true;
    if (!q.portraitSeconds) q.portraitSeconds = 30;
    q.drawPrompts = Array.isArray(q.drawPrompts) ? q.drawPrompts : DEFAULT_PROMPTS.slice();
    q.questions = (q.questions || []).map(x => {
      x = Object.assign({}, x);
      if (x.type === "choice") { x.options = (x.options || []).slice(); while (x.options.length < 2) x.options.push(""); }
      return x;
    });
    return q;
  }
  const save = () => { try { localStorage.setItem(DKEY, JSON.stringify({ quiz, at: Date.now(), view: view === "start" ? "settings" : view, qi })); } catch { } };
  const Q = () => quiz.questions;

  // ---------- checks ----------
  function problems(q) {
    const p = [];
    if (q.type === "draw") return p;
    if (!String(q.text || "").trim()) p.push("Type the question");
    if (q.type === "choice") {
      const filled = (q.options || []).filter(o => String(o).trim());
      if (filled.length < 2) p.push("Give at least 2 answers");
      if (q.answer == null || !String((q.options || [])[q.answer] || "").trim()) p.push("Tick the right answer");
    }
    if (q.type === "number" && (typeof q.answer !== "number" || isNaN(q.answer))) p.push("Type the right number");
    if (q.duration != null && (q.duration < 5 || q.duration > 300)) p.push("Seconds should be between 5 and 300");
    return p;
  }
  function globalProblems() {
    const p = [];
    if (!Q().filter(q => q.type !== "draw").length) p.push("Add at least one question");
    const draws = Q().filter(q => q.type === "draw").length;
    if (draws && quiz.drawPrompts.filter(s => s.trim()).length < 1) p.push("The drawing rounds need some prompts");
    return p;
  }
  const status = q => (q.type === "draw" ? "draw" : problems(q).length ? "bad" : q.todo ? "todo" : "ok");

  // ---------- clean export ----------
  function cleaned() {
    const out = clone(quiz);
    out.prizes = out.prizes.filter(p => p.name.trim()).map(p => (p.from.trim() ? { name: p.name.trim(), from: p.from.trim() } : { name: p.name.trim() }));
    out.drawPrompts = out.drawPrompts.map(s => s.trim()).filter(Boolean);
    out.questions = out.questions.map(q => {
      const o = {};
      if (q.round && q.round.trim()) o.round = q.round.trim();
      o.type = q.type;
      o.text = q.type === "draw" ? (q.text && q.text.trim()) || "Drawing round" : String(q.text || "").trim();
      if (q.type === "choice") {
        const opts = [], map = {};
        (q.options || []).forEach((t, i) => { if (String(t).trim()) { map[i] = opts.length; opts.push(String(t).trim()); } });
        o.options = opts; o.answer = q.answer != null && map[q.answer] != null ? map[q.answer] : null;
      }
      if (q.type === "number") { o.answer = q.answer; if (q.unit && q.unit.trim()) o.unit = q.unit.trim(); }
      if (q.duration) o.duration = q.duration;
      if (q.double && q.type !== "draw") o.double = true;
      if (q.funFact && q.funFact.trim() && q.type !== "draw") o.funFact = q.funFact.trim();
      if (q.image && q.image.trim() && q.type !== "draw") o.image = q.image.trim();
      if (q.todo) o.todo = true;
      return o;
    });
    return out;
  }
  function download(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  }
  const jsFile = () => `// LMK 26 quiz — made with the question builder, ${new Date().toLocaleString("en-GB")}\n// Upload it on host.html → ⋯ → Load quiz file (or straight from the builder).\nwindow.QUIZ = ${JSON.stringify(cleaned(), null, 2)};\n`;
  function parseFile(text) {
    const q = /^\s*[{[]/.test(text) ? JSON.parse(text) : new Function("window", text + "\n;return window.QUIZ;")({});
    if (!q || !Array.isArray(q.questions)) throw new Error("No questions found in that file");
    return q;
  }

  // ---------- login ----------
  async function login(pin) {
    await B.login({ pin }); sessionStorage.setItem(PINKEY, pin); loggedIn = true;
    try { live = await B.hostGetQuiz(); } catch { live = null; }
  }
  const pinErr = m => /bad_pin/.test(m) ? "Wrong PIN." : /offline/.test(m) ? "No internet connection." : /no_game/.test(m) ? "The quiz isn't set up in Neon yet." : "Couldn't log in: " + m;
  const savedPin = sessionStorage.getItem(PINKEY);
  if (savedPin) { try { await login(savedPin); } catch { sessionStorage.removeItem(PINKEY); } }

  // ---------- views ----------
  const pinBox = (id = "pin") => `<div class="row pinrow"><input id="${id}" class="big-input" type="password" inputmode="numeric" placeholder="Host PIN" autocomplete="off">
    <button class="btn primary" data-act="login" data-pin="${id}">Log in</button></div>`;
  function startView() {
    const draftInfo = saved ? `${saved.quiz.questions.filter(q => q.type !== "draw").length} questions, saved ${new Date(saved.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "";
    return `<section class="bstart">
      <h1 class="logo sm">QUESTION<br>BUILDER</h1>
      <p class="sub">LMK 26</p>
      <div class="card">
        ${loggedIn ? `<p class="okline">✓ Logged in as host</p>` : `<p><b>Log in with your host PIN</b> to edit the questions that are in the quiz now, and to upload when you're done.</p>${pinBox()}`}
        <p class="note">${esc(note)}</p>
        <div class="choices">
          ${live ? `<button class="btn primary big" data-act="start" data-src="live">Edit the quiz's questions<small>${live.questions.filter(q => q.type !== "draw").length} questions in the quiz now</small></button>` : ""}
          ${saved ? `<button class="btn big" data-act="start" data-src="draft">Carry on with my draft<small>${esc(draftInfo)}</small></button>` : ""}
          <label class="btn big">Open a quiz file<small>e.g. lmk26-questions.js</small><input type="file" id="openfile" accept=".js,.json" hidden></label>
          <button class="btn big ghost" data-act="start" data-src="new">Start from scratch<small>prizes, prompts and one blank question</small></button>
        </div>
      </div></section>`;
  }

  function nav() {
    const chips = Q().map((q, i) => `<button class="chipq ${status(q)} ${view === "q" && qi === i ? "on" : ""}" data-go="q" data-i="${i}" title="${esc(q.text || "")}">${q.type === "draw" ? "✏️" : qnum(i)}</button>`).join("");
    return `<nav class="bnav">
      <button class="step ${view === "settings" ? "on" : ""}" data-go="settings">Prizes & setup</button>
      <div class="chipsq">${chips}<button class="chipq add" data-act="addq" title="Add a question">+</button></div>
      <button class="step ${view === "drawing" ? "on" : ""}" data-go="drawing">Drawing prompts</button>
      <button class="step finish ${view === "finish" ? "on" : ""}" data-go="finish">Finish ✓</button>
    </nav>`;
  }
  const qnum = i => Q().slice(0, i + 1).filter(q => q.type !== "draw").length;

  function settingsView() {
    const a = quiz.awards;
    return `<section class="bcard card">
      <h2 class="title sm">PRIZES & SETUP</h2>
      <div class="grid2">
        <label>Quiz title<input class="inp" data-f="s.title" value="${esc(quiz.title)}"></label>
        <label>Subtitle (shown under the title)<input class="inp" data-f="s.subtitle" value="${esc(quiz.subtitle || "")}"></label>
        <label>Seconds per question (default)<input class="inp" data-f="s.defaultDuration" data-t="int" inputmode="numeric" value="${quiz.defaultDuration || 30}"></label>
        <label class="tick"><input type="checkbox" data-f="s.autoCloseWhenAllAnswered" data-t="bool" ${quiz.autoCloseWhenAllAnswered !== false ? "checked" : ""}> Close a question early once everyone has answered</label>
        <label class="tick"><input type="checkbox" data-f="s.autoAdvance" data-t="bool" ${quiz.autoAdvance !== false ? "checked" : ""}> Reveal the answer automatically once everyone's in or time's up (and carry on after drawing rounds)</label>
      </div>
      <h3>Self-portraits</h3>
      <div class="grid2">
        <label class="tick"><input type="checkbox" data-f="s.portraitRound" data-t="bool" ${quiz.portraitRound !== false ? "checked" : ""}> Start with everyone drawing themselves + their name</label>
        <label>Seconds to draw<input class="inp" data-f="s.portraitSeconds" data-t="int" inputmode="numeric" value="${quiz.portraitSeconds || 30}"></label>
      </div>
      <p class="hint">The portraits become everyone's picture on the leaderboard, podium and awards, and the winner's gets the big celebration.</p>
      <h3>Prizes</h3>
      ${quiz.prizes.map((p, i) => `<div class="grid2 prize-row"><label>${["🥇 1st", "🥈 2nd", "🥉 3rd"][i]} prize<input class="inp" data-f="s.prizes.${i}.name" value="${esc(p.name)}" placeholder="e.g. Hamper of goodies"></label>
        <label>From (customer / brand)<input class="inp" data-f="s.prizes.${i}.from" value="${esc(p.from)}" placeholder="optional"></label></div>`).join("")}
      <h3>Fun awards at the end</h3>
      <div class="ticks">
        <label class="tick"><input type="checkbox" data-f="s.awards.fastestFinger" data-t="bool" ${a.fastestFinger !== false ? "checked" : ""}> Fastest Finger</label>
        <label class="tick"><input type="checkbox" data-f="s.awards.hotStreak" data-t="bool" ${a.hotStreak !== false ? "checked" : ""}> Hot Streak</label>
        <label class="tick"><input type="checkbox" data-f="s.awards.wildestGuess" data-t="bool" ${a.wildestGuess !== false ? "checked" : ""}> Wildest Guess</label>
        <label class="tick"><input type="checkbox" data-f="s.awards.pudding" data-t="bool" ${a.pudding !== false ? "checked" : ""}> Christmas Pudding (last place)</label>
      </div>
      <div class="bfoot"><span></span><button class="btn primary" data-go="q" data-i="0">Questions →</button></div>
    </section>`;
  }

  function questionView() {
    const q = Q()[qi], n = Q().length, rounds = [...new Set(Q().map(x => x.round).filter(Boolean))];
    const typeBtn = (t, label) => `<button class="seg ${q.type === t ? "on" : ""}" data-act="type" data-t="${t}">${label}</button>`;
    let body = "";
    if (q.type === "choice") {
      body = `<label>Answers <span class="hint">tick the right one</span></label>
        <div class="optedit">${q.options.map((o, i) => `<div class="optrow c${i}">
          <b>${LETTERS[i]}</b><input class="inp" data-f="q.options.${i}" value="${esc(o)}" placeholder="Answer ${LETTERS[i]}">
          <label class="right"><input type="radio" name="ans" data-f="q.answer" data-t="int" value="${i}" ${q.answer === i ? "checked" : ""}> Right</label>
          ${q.options.length > 2 ? `<button class="x" data-act="delopt" data-i="${i}" title="Remove">✕</button>` : ""}</div>`).join("")}
        </div>
        ${q.options.length < 6 ? `<button class="btn sm" data-act="addopt">+ Add answer</button>` : ""}`;
    } else if (q.type === "number") {
      body = `<div class="grid2">
        <label>Right answer (a number)<input class="inp" data-f="q.answer" data-t="num" inputmode="decimal" value="${q.answer != null ? esc(q.answer) : ""}" placeholder="e.g. 18450"></label>
        <label>Unit (optional)<input class="inp" data-f="q.unit" value="${esc(q.unit || "")}" placeholder="e.g. orders, £, miles"></label></div>
        <p class="hint">Closest guess wins. Within 2% counts as spot on.</p>`;
    } else {
      body = `<div class="drawinfo">✏️ <b>A drawing round happens here.</b> Everyone draws a secret prompt on their phone, and the drawings come back as "What is it?" / "Who drew it?" questions later in the quiz. Set the prompts under <a href="#" data-go="drawing">Drawing prompts</a>.</div>
        <label>Seconds to draw<input class="inp" data-f="q.duration" data-t="int" inputmode="numeric" value="${q.duration || 90}"></label>`;
    }
    const probs = problems(q);
    return `<div class="bsplit">
      <section class="bcard card">
        <div class="bhead"><h2 class="title sm">${q.type === "draw" ? `DRAWING ROUND${Q().filter(x => x.type === "draw").length > 1 ? " " + (Q().slice(0, qi + 1).filter(x => x.type === "draw").length) : ""}` : `QUESTION ${qnum(qi)}`} <small>${qi + 1} of ${n}</small></h2>
          <div class="tools">
            <button class="btn sm" data-act="up" ${qi === 0 ? "disabled" : ""} title="Move earlier">↑</button>
            <button class="btn sm" data-act="down" ${qi === n - 1 ? "disabled" : ""} title="Move later">↓</button>
            <button class="btn sm" data-act="dup">Duplicate</button>
            <button class="btn sm danger" data-act="del">Delete</button>
          </div></div>
        <div class="segs">${typeBtn("choice", "Multiple choice")}${typeBtn("number", "Closest number")}${typeBtn("draw", "Drawing round")}</div>
        ${q.type !== "draw" ? `<label>Round name (optional)<input class="inp" data-f="q.round" value="${esc(q.round || "")}" list="rounds" placeholder="e.g. Round 1 · The Numbers"></label>
        <datalist id="rounds">${rounds.map(r => `<option value="${esc(r)}">`).join("")}</datalist>
        <label>Question<textarea class="inp" data-f="q.text" rows="2" placeholder="e.g. Which was our busiest month?">${esc(q.text || "")}</textarea></label>` : ""}
        ${body}
        ${q.type !== "draw" ? `<label>The real story <span class="hint">shown after the reveal — the funny bit</span><textarea class="inp" data-f="q.funFact" rows="2" placeholder="e.g. November: 4,312 orders. Thanks, Black Friday.">${esc(q.funFact || "")}</textarea></label>
        <div class="grid3">
          <label>Seconds<input class="inp" data-f="q.duration" data-t="int" inputmode="numeric" value="${q.duration || ""}" placeholder="${quiz.defaultDuration || 30}"></label>
          <label class="tick"><input type="checkbox" data-f="q.double" data-t="bool" ${q.double ? "checked" : ""}> Double points</label>
          <label class="tick"><input type="checkbox" data-f="q.todo" data-t="bool" ${q.todo ? "checked" : ""}> Still a placeholder</label>
        </div>
        <details ${q.image ? "open" : ""}><summary>Picture (optional)</summary>
          <label>Picture web address<input class="inp" data-f="q.image" value="${esc(q.image || "")}" placeholder="https://… (a photo of a product, say)"></label></details>` : ""}
        <div id="probs">${probsHtml(probs)}</div>
        <div class="bfoot">
          <button class="btn" data-act="prev">← ${qi === 0 ? "Setup" : "Back"}</button>
          <div class="row">
            <button class="btn" data-act="addq">+ Add question</button>
            <button class="btn primary" data-act="next">${qi === n - 1 ? "Drawing prompts →" : "Next question →"}</button>
          </div>
        </div>
      </section>
      <aside class="bprev"><p class="hint center">How it looks on phones</p><div class="phone" id="preview">${previewHtml(q)}</div></aside>
    </div>`;
  }
  const probsHtml = p => p.length ? `<div class="probs">⚠ ${p.map(esc).join(" · ")}</div>` : `<div class="probs ok">✓ Ready</div>`;
  function previewHtml(q) {
    if (q.type === "draw") return `<div class="pv-draw">✏️<b>DRAWING ROUND</b><span>Everyone gets a secret prompt</span></div>`;
    const head = `<div class="pv-top"><span class="pill">Q${qnum(qi)}</span>${q.double ? `<span class="pill hot">DOUBLE</span>` : ""}</div>
      <div class="pv-q">${esc(q.text || "Your question…")}</div>`;
    if (q.type === "number") return head + `<div class="pv-num">${q.unit ? esc(q.unit) + ": " : ""}<i>type a number</i></div>` +
      (q.answer != null ? `<div class="pv-ans">Answer: <b>${fmt(q.answer)}</b></div>` : "");
    return head + `<div class="opts">${q.options.map((o, i) => String(o).trim() ? `<div class="opt c${i} ${q.answer === i ? "right" : ""}"><b>${LETTERS[i]}</b><span>${esc(o)}</span></div>` : "").join("")}</div>`;
  }

  function drawingView() {
    const d = quiz.drawing, drawAt = Q().map((q, i) => (q.type === "draw" ? i : -1)).filter(i => i >= 0), hasDraw = drawAt.length > 0, prompts = quiz.drawPrompts;
    return `<section class="bcard card">
      <h2 class="title sm">DRAWING PROMPTS</h2>
      ${hasDraw ? `<p>${drawAt.length === 1 ? "Your drawing round is" : `You have <b>${drawAt.length} drawing rounds</b>, at`} ${drawAt.map((i, k) => `<a href="#" data-go="q" data-i="${i}">position ${i + 1}</a>`).join(", ")} in the running order. Each round's drawings come back as questions before the next round starts.</p>
        <button class="btn sm" data-act="adddraw">+ Add another drawing round</button>`
        : `<p class="probs">There's no drawing round in the quiz. <button class="btn sm" data-act="adddraw">Add a drawing round</button></p>`}
      ${(() => { const live = prompts.filter(s => s.trim()), withLike = live.filter(s => NN.parsePrompt(s).like.length >= 3).length;
        return `<div class="drawinfo"><b>Make the guessing hard:</b> after each prompt, add three look-alikes separated by <b>|</b>. They're near-misses of the same scene, used as the wrong answers on "What on earth is this?". Players only ever see the first part.<br>
          <i>e.g.</i> <code>The printer jamming at 4:59 on a Friday | The photocopier eating the contract | The printer out of toner on payroll day | Fixing the printer with a hammer</code><br>
          ${withLike}/${live.length} of yours have look-alikes. Prompts without them get the closest-sounding other prompts instead.
          ${window.LMK_PROMPT_PACK ? `<div class="row packrow"><button class="btn sm primary" data-act="pack" data-mode="replace">Use the LMK prompt pack (${window.LMK_PROMPT_PACK.length}, all with look-alikes)</button>
            <button class="btn sm" data-act="pack" data-mode="add">Add the pack's prompts I don't have</button></div>` : ""}</div>`; })()}
      <label>Secret prompts — one per line <span class="hint">${prompts.filter(s => s.trim()).length} prompts · aim for ${Math.max(1, drawAt.filter(i => !Q()[i].portrait).length) * 20} (about 20 per drawing round, so nobody gets a repeat)</span>
        <textarea class="inp prompts" data-f="s.drawPrompts" data-t="lines" rows="12">${esc(prompts.join("\n"))}</textarea></label>
      <div class="grid2">
        <label>Guessing style<select class="inp" data-f="d.mode">
          <option value="both" ${d.mode === "both" ? "selected" : ""}>Mix: "What is it?" and "Who drew it?"</option>
          <option value="what" ${d.mode === "what" ? "selected" : ""}>Only "What is it?"</option>
          <option value="who" ${d.mode === "who" ? "selected" : ""}>Only "Who drew it?"</option></select></label>
        <label>Where the drawings come back<select class="inp" data-f="d.placement">
          <option value="spread" ${d.placement !== "after" ? "selected" : ""}>Spread through the rest of the quiz</option>
          <option value="after" ${d.placement === "after" ? "selected" : ""}>All together, straight after drawing</option></select></label>
        <label>Seconds to guess each drawing<input class="inp" data-f="d.guessDuration" data-t="int" inputmode="numeric" value="${d.guessDuration || 20}"></label>
        <label>Most drawings to turn into questions<input class="inp" data-f="d.maxQuestions" data-t="int" inputmode="numeric" value="${d.maxQuestions ?? 10}"></label>
      </div>
      <p class="hint">Every drawing still goes up in the gallery at the end.</p>
      <div class="bfoot"><button class="btn" data-go="q" data-i="${Q().length - 1}">← Questions</button><button class="btn primary" data-go="finish">Finish →</button></div>
    </section>`;
  }

  function finishView() {
    const real = Q().filter(q => q.type !== "draw"), todo = real.filter(q => q.todo).length;
    const bad = Q().map((q, i) => ({ i, p: problems(q) })).filter(x => x.p.length), g = globalProblems();
    const prizes = quiz.prizes.filter(p => p.name.trim()).length;
    return `<section class="bcard card">
      <h2 class="title sm">FINISH</h2>
      <ul class="summary">
        <li><b>${real.length}</b> questions${(() => { const n = Q().filter(q => q.type === "draw").length; return n ? ` + ${n === 1 ? "a drawing round" : n + " drawing rounds"}` : ""; })()}</li>
        <li><b>${prizes}</b> of 3 prizes filled in</li>
        <li><b>${quiz.drawPrompts.filter(s => s.trim()).length}</b> drawing prompts</li>
        ${todo ? `<li class="warn-t">⚠ ${todo} still marked as placeholders</li>` : ""}
      </ul>
      ${g.length || bad.length ? `<div class="probs"><b>Needs fixing before upload:</b><ul>${g.map(x => `<li>${esc(x)}</li>`).join("")}
        ${bad.map(x => `<li><a href="#" data-go="q" data-i="${x.i}">Question ${qnum(x.i)}</a>: ${esc(x.p.join(", "))}</li>`).join("")}</ul></div>` : `<div class="probs ok">✓ Everything checks out.</div>`}
      <h3>Send it to the quiz</h3>
      ${loggedIn ? `<button class="btn primary big" data-act="upload" ${g.length || bad.length || busy ? "disabled" : ""}>⬆ Upload to the quiz</button>` : `<p>Log in with your host PIN to upload:</p>${pinBox("pin2")}`}
      <p class="note">${esc(note)}</p>
      <h3>Or keep a copy</h3>
      <button class="btn" data-act="export">⬇ Download lmk26-questions.js</button>
      <p class="hint">The file works with ⋯ → Load quiz file on the host page, and as a backup.</p>
      <div class="bfoot"><button class="btn" data-go="drawing">← Drawing prompts</button><a class="btn ghost" href="host.html">Go to the host page</a></div>
    </section>`;
  }

  function render() {
    if (view === "start" || !quiz) { app.innerHTML = startView(); bind(); return; }
    const body = view === "settings" ? settingsView() : view === "q" ? questionView() : view === "drawing" ? drawingView() : finishView();
    app.innerHTML = `<header class="topbar"><div class="brand">QUESTION BUILDER</div>
      ${loggedIn ? `<span class="pill live">HOST</span>` : `<button class="pill warn" data-act="home" title="Log in from the menu">NOT LOGGED IN — LOG IN</button>`}<span class="grow"></span>
      <span class="savedmark" id="savedmark">Saved on this device</span>
      <button class="btn sm ghost" data-act="home">Menu</button></header>
      ${nav()}<main class="bmain">${body}</main>`;
    bind();
  }

  // live updates without re-rendering (keeps the cursor where it is)
  function refreshLive() {
    save();
    const m = $("#savedmark"); if (m) { m.textContent = "Saved ✓"; clearTimeout(refreshLive.t); refreshLive.t = setTimeout(() => (m.textContent = "Saved on this device"), 1200); }
    if (view === "q") {
      const q = Q()[qi], pv = $("#preview"), pr = $("#probs");
      if (pv) pv.innerHTML = previewHtml(q);
      if (pr) pr.innerHTML = probsHtml(problems(q));
    }
    const chips = app.querySelectorAll(".chipq[data-i]");
    chips.forEach(c => { const q = Q()[+c.dataset.i]; if (q) { c.className = `chipq ${status(q)} ${view === "q" && qi === +c.dataset.i ? "on" : ""}`; c.title = q.text || ""; } });
  }

  function setField(path, raw, t) {
    const parts = path.split("."), rootKey = parts.shift();
    let obj = rootKey === "q" ? Q()[qi] : rootKey === "d" ? quiz.drawing : quiz;
    let v = raw;
    if (t === "int") v = raw === "" ? null : parseInt(raw, 10);
    if (t === "num") v = parseNum(raw);
    if (t === "lines") v = String(raw).split("\n");
    for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    const k = parts.at(-1);
    if (v == null || (typeof v === "number" && isNaN(v))) { if (t === "int" || t === "num") delete obj[k]; else obj[k] = v; } else obj[k] = v;
    if (rootKey === "q" && (k === "text" || k === "answer" || /^\d+$/.test(k)) && Q()[qi].todo && t !== "bool") {
      // editing a placeholder: untick "still a placeholder" automatically
      Q()[qi].todo = false; const cb = app.querySelector('[data-f="q.todo"]'); if (cb) cb.checked = false;
    }
  }

  function bind() {
    app.querySelectorAll("[data-f]").forEach(el => {
      const t = el.dataset.t;
      const h = () => { if (t === "bool") setField(el.dataset.f, el.checked, "bool"); else setField(el.dataset.f, el.value, t); refreshLive(); };
      el.addEventListener(el.type === "checkbox" || el.type === "radio" || el.tagName === "SELECT" ? "change" : "input", h);
    });
    app.querySelectorAll("input[id^=pin]").forEach(el => el.addEventListener("keydown", e => { if (e.key === "Enter") app.querySelector(`[data-pin="${el.id}"]`).click(); }));
    const of = $("#openfile");
    if (of) of.onchange = async () => {
      try { quiz = normalise(parseFile(await of.files[0].text())); save(); view = "settings"; note = ""; render(); }
      catch (e) { note = "Couldn't read that file: " + e.message; render(); }
    };
  }

  const hashOf = () => (view === "q" ? "#q" + (qi + 1) : "#" + view);
  function go(v, i, fromHistory) {
    view = v; if (i != null && quiz) qi = Math.max(0, Math.min(Q().length - 1, i)); note = "";
    if (quiz && view !== "start") save();
    if (!fromHistory) history.pushState({ view, qi }, "", hashOf());
    render(); window.scrollTo(0, 0);
  }
  window.addEventListener("popstate", e => {
    const st = e.state; if (!st) return;
    if (st.view !== "start" && !quiz) return;
    go(st.view, st.qi, true);
  });
  const blankQ = like => ({ round: (like && like.round) || "", type: "choice", text: "", options: ["", "", "", ""], answer: null });

  app.addEventListener("click", async e => {
    const g = e.target.closest("[data-go]");
    if (g) { e.preventDefault(); if (g.dataset.go === "q" && !Q().length) Q().push(blankQ()); return go(g.dataset.go, g.dataset.i != null ? +g.dataset.i : null); }
    const b = e.target.closest("[data-act]"); if (!b) return;
    const act = b.dataset.act, q = Q && quiz ? Q()[qi] : null;
    if (act === "login") {
      const el = $("#" + b.dataset.pin), pin = el.value.trim(); if (!pin) return el.focus();
      b.disabled = true; note = "Checking…"; const n = $(".note"); n && (n.textContent = note);
      try { await login(pin); note = live ? "" : "Logged in. There are no questions in the quiz yet."; }
      catch (err) { note = pinErr(err.message); }
      render(); return;
    }
    if (act === "start") {
      const src = b.dataset.src;
      if (src === "live") quiz = normalise(live);
      else if (src === "draft") quiz = normalise(saved.quiz);
      else { if (saved && !confirm("Start from scratch? Your saved draft will be replaced.")) return; quiz = normalise(TEMPLATE); }
      return go("settings");
    }
    if (act === "home") { saved = { quiz, at: Date.now() }; return go("start"); }
    if (act === "type") {
      const t = b.dataset.t; if (t === q.type) return;
      if (t === "choice") { q.options = q.options && q.options.length >= 2 ? q.options : ["", "", "", ""]; q.answer = null; }
      if (t === "number") { delete q.options; q.answer = typeof q.answer === "number" && q.type === "number" ? q.answer : null; }
      if (t === "draw") { delete q.options; delete q.answer; q.duration = q.duration || 90; q.round = q.round || "Drawing round"; }
      if (q.type === "draw" && t !== "draw") delete q.duration;
      q.type = t; save(); render(); return;
    }
    if (act === "addopt") { q.options.push(""); save(); render(); app.querySelector(`[data-f="q.options.${q.options.length - 1}"]`)?.focus(); return; }
    if (act === "delopt") {
      const i = +b.dataset.i; q.options.splice(i, 1);
      if (q.answer === i) q.answer = null; else if (q.answer > i) q.answer--;
      save(); render(); return;
    }
    if (act === "addq") { Q().splice(view === "q" ? qi + 1 : Q().length, 0, blankQ(q)); save(); return go("q", view === "q" ? qi + 1 : Q().length - 1); }
    if (act === "dup") { Q().splice(qi + 1, 0, clone(q)); save(); return go("q", qi + 1); }
    if (act === "del") {
      if (!confirm(q.type === "draw" ? "Remove the drawing round?" : `Delete question ${qnum(qi)}?`)) return;
      Q().splice(qi, 1); if (!Q().length) Q().push(blankQ()); save(); return go("q", Math.min(qi, Q().length - 1));
    }
    if (act === "up" || act === "down") {
      const j = act === "up" ? qi - 1 : qi + 1; [Q()[qi], Q()[j]] = [Q()[j], Q()[qi]]; save(); return go("q", j);
    }
    if (act === "prev") return qi === 0 ? go("settings") : go("q", qi - 1);
    if (act === "next") return qi === Q().length - 1 ? go("drawing") : go("q", qi + 1);
    if (act === "adddraw") {
      const at = Q().length ? Math.max(1, Math.round(Q().length * (Q().some(x => x.type === "draw") ? 2 / 3 : 1 / 3))) : 0;
      Q().splice(at, 0, { round: "Drawing round", type: "draw", text: "Drawing round", duration: 90 }); save(); return go("q", at);
    }
    if (act === "pack") {
      const pack = window.LMK_PROMPT_PACK || [];
      if (b.dataset.mode === "replace") {
        if (!confirm(`Replace your ${quiz.drawPrompts.filter(x => x.trim()).length} prompts with the ${pack.length} in the LMK pack?`)) return;
        quiz.drawPrompts = pack.slice();
      } else {
        const have = new Set(quiz.drawPrompts.map(x => NN.parsePrompt(x).p.toLowerCase()));
        quiz.drawPrompts = [...quiz.drawPrompts.filter(x => x.trim()), ...pack.filter(x => !have.has(NN.parsePrompt(x).p.toLowerCase()))];
      }
      save(); render(); return;
    }
    if (act === "export") { download("lmk26-questions.js", jsFile(), "text/javascript"); note = "Downloaded lmk26-questions.js"; render(); return; }
    if (act === "upload") {
      try {
        const st = await B.get("state");
        if (st && st.phase && st.phase !== "lobby" && !confirm("A quiz is in progress right now. Uploading new questions mid-game can mix up which question is which. Upload anyway?")) return;
        busy = true; note = "Uploading…"; render();
        const r = await B.hostPutQuiz(cleaned());
        live = cleaned();
        note = `✓ Uploaded ${r && r.questions != null ? r.questions : Q().length} items. Refresh the host page to use them.`;
      } catch (err) { note = /bad_pin|bad_session|forbidden/.test(err.message) ? "Your login has expired — log in again." : "Upload failed: " + err.message; if (/bad_|forbidden/.test(err.message)) loggedIn = false; }
      busy = false; render(); return;
    }
  });

  // reopening the builder (or refreshing) carries on exactly where you were
  if (saved && saved.quiz) {
    quiz = normalise(saved.quiz); view = saved.view || "settings"; qi = Math.min(saved.qi || 0, quiz.questions.length - 1);
    if (!["settings", "q", "drawing", "finish"].includes(view)) view = "settings";
    note = "";
  }
  history.replaceState({ view, qi }, "", view === "start" ? location.pathname : hashOf());
  render();
  if (saved && saved.quiz) { const m = $("#savedmark"); if (m) { m.textContent = "Carried on from your draft"; setTimeout(() => (m.textContent = "Saved on this device"), 3000); } }
})();
