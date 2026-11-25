# LMK 26 quiz — developer handover

Written 25 Nov 2026 (latest commit when written: `40a0a7e`). This is everything you need to pick up the code. For how to *run the night*, see README.md.

## What it is

A live, phone-based Christmas quiz for about 20 people at the Black Bull, Balsham. There's no big screen: every phone shows the shared screens. It's a static site on GitHub Pages, and the live state is held in a separate Neon project, which the browsers reach directly over Neon's SQL-over-HTTP endpoint. There is **no server, no build step and no npm**: just HTML, CSS and plain JS.

| Page | Who | What |
|---|---|---|
| `index.html` + `js/player.js` | players | Quiz password + name → answer, draw, see results, standings, podium, gallery |
| `host.html` + `js/host.js` | host (laptop or phone) | Host PIN → runs the game with one "next" button (Space bar on a laptop) |
| `builder.html` + `js/builder.js` | host | Host PIN → edit questions one at a time, then upload to Neon or export `.js` |

Live: https://jbarneslmk-design.github.io/lmk26-quiz/ (and `/host.html`, `/builder.html`).
Repo: `jbarneslmk-design/lmk26-quiz` (public, which free Pages needs). Pushing to `main` deploys in about a minute.
Database: the Neon project **LMK TESTING** (`ep-shy-shape-bj5y1ikk-pooler.c-3.eu-west-2.aws.neon.tech`, db `neondb`), deliberately separate from SHELL.

## Files

```
index.html host.html builder.html   pages: each loads config → common → backend → its own js (and qr.js)
css/style.css     all styling (sunset-cartoon theme, snow, celebration); one file, appended in sections
js/config.js      gameId "lmk26" + the PUBLIC quiz_web connection string (safe by design, see Security)
js/backend.js     Neon client (sign-in, polling sync, writes) + LOCAL test mode (localStorage)
js/common.js      helpers: esc, fmt, scenery/snow, stars, avatar(), confetti(), celebration(), joinUrl()
js/sfx.js         sound effects + background music, synthesised with Web Audio (no audio files)
js/qr.js          bundled QR encoder (Kazuhiko Arase, MIT), so no CDN is needed at the pub
js/prompts.js     LMK drawing prompt pack (65), each "Prompt | look-alike | look-alike | look-alike" (builder only)
js/host.js        the game engine: question flow, scoring, drawing rounds, final/awards
js/player.js      phone UI, drawing canvas, all shared screens
js/builder.js     question editor
js/questions.js   GITIGNORED: the real quiz lives in Neon (quiz.game.quizdef), never in this public repo
neon/schema.sql   source of truth for the database (tables, functions, grants)
neon/SETUP_LMK_TESTING.sql   one-paste first-time setup (schema + quiz_web role + setup line)
neon/UPDATE_1_multiple_drawing_rounds.sql   applied 25 Nov; already folded into schema.sql
dev/              local testing: mock Neon endpoint, test-site server, automated phone game
```

## How it works

### Data: one JSON tree per game

All live state is a single JSON document in `quiz.game.tree`. Each write appends `{p: path, v: value}` to `quiz.log` and bumps `rev`. Clients poll `quiz.sync(token, rev)` about every 1 s (the host every 0.7 s, 4 s when a tab is hidden) and get either nothing, the ops since `rev`, or the full tree. `backend.js` keeps a local copy, and `B.on(path, cb)` fires when that path's value changes. **Every client holds the whole tree**, pictures included (about 0.6 MB for 20 people, which is fine). Use `B.peek(path)` for big data such as pictures to avoid JSON-copying them on every change.

| Path | Written by | Contents |
|---|---|---|
| `state` | host | `{phase, q, endsAt, duration}`. Phase is one of `lobby · draw · drawdone · question · closed · reveal · board · final` |
| `current` | host | the question as players see it: text, options, type, `drawingOf`, `drawRound`, `artist`, `portrait`… **no answer** |
| `players/<pid>` | player | `{name, joinedAt}`. `pid` is random and kept in the phone's localStorage |
| `answers/<q>/<pid>` | player | `{v, at}`. Written once; `at` is server time |
| `results/<q>/<pid>` | host | `{pts, ok, v, secs or err, bullseye, artist, right}` |
| `scores/<pid>` | host | totals, rank, prevRank, streak, best, fastest. Recomputed from all results on every reveal (idempotent) |
| `reveal` | host | answer + summary for everyone (counts, who was right, fastest, closest, wildest, the real story) |
| `drawAssign/<r>/<pid>` | host | that player's prompt for drawing round `r` |
| `drawings/<r>/<pid>` | player | `{img: JPEG data URL, prompt, at}` |
| `dq/<r>` | host | guess-the-drawing questions generated for round `r` (these do contain answers, which is accepted) |
| `final` | host | `{stage 0–5, podium[], awards[]}`. Stages: 3rd → 2nd → winner → awards → gallery |

Questions and answers are **not** in the tree. They're in `quiz.game.quizdef`, readable only with a host session (`host_get_quiz` / `host_put_quiz`).

### Question order (`Q()` in host.js), the fragile bit

`state.q` is an index into `Q()`, which is built at runtime:
1. `baseQs()` = an automatic **self-portrait** draw marker prepended (unless `portraitRound: false`), then `QUIZ.questions`.
2. After each drawing round `r` finishes, its generated `dq/r` questions are spliced in, either spread among the questions up to the next drawing marker or all together (`drawing.placement`).

So **changing the questions mid-game shifts indices** and mixes things up. The builder warns about this; only edit between games.

### Scoring (host.js, `score()` / `totals()`)
- **Choice:** 500 points plus up to 500 for speed (time left ÷ duration), ×2 if `double`. A 1.5 s grace period after the timer.
- **Number:** 1000 if within `tolerance` (default 2%), otherwise 800 × (1 − err ÷ `zeroAt` (0.5)), plus 200 for the closest guess.
- **Drawing prompts** are `"Prompt | look-alike | look-alike | look-alike"`. Players only see the first part. On "What is it?", the wrong answers are that prompt's look-alikes; when there are fewer than 3, `lookalikes()` fills in the closest-sounding other prompts (shared words, `NN.alike`). This stops the real answer standing out.
- **Drawing questions:** the artist can't answer. They get `artistBonus` (150) per correct "what is it?" and `fooledBonus` (100) per person fooled on "who drew it?".
- **Awards:** Fastest Finger, Hot Streak (3+), Wildest Guess (over 25% off), and Christmas Pudding (last place, only with 5+ players).

### The flow (host.js `step()`)
`lobby → [draw → drawdone] → question → closed → reveal → board → next…` and then `final` stages 0–5. A question closes when its timer ends or when everyone has answered (`autoCloseWhenAllAnswered`). Self-portrait rounds skip question generation. A `busy` flag stops double-taps from skipping a question.

### Phones as the shared screen (player.js)
`view()` renders by phase. `render()` only rebuilds the DOM when a **render key** changes. Live room numbers (answer counts, drawings done) are deliberately left out of the key while the player is drawing or choosing (`roomKey = "busy"`), so a redraw never kills a stroke or a half-typed number. Keep that rule.

### Sound (js/sfx.js)
- **Shared moments** (question start, early close, drawing start/end, reveal, standings, final, each podium place, winner, awards, gallery): the host writes `fx = {n, name, at, pid?}`, where `at` is server time plus 1.2 s. Every phone schedules the sound for that moment on the shared clock (`SFX.playAt(name, at, B.now())`), so the room hears it together. On `reveal`, each phone also plays its own result (correct, wrong, miss or artist) just after the drumroll; on `winner`, the winner's phone plays the bigger `winnerMe`.
- **Countdown:** each phone plays the ticks for the last 5 s, then time's-up, worked out from `state.endsAt` (server time), so these are in sync with no cue needed.
- **Your own taps** (lock-in, sending a drawing, joining) play straight away.
- **Music:** an original lo-fi loop at 84 bpm, Cmaj7 · Am7 · Fmaj7 · G. Its bars are counted from the shared clock, so phones that switch it on are in step. It gets quieter during questions and drawing. Off by default (🎵); effects are on by default (🔊).
- **Browsers only allow sound after a tap.** The first tap anywhere unlocks it, and until then the header shows "🔇 Tap for sound". iPhones in silent mode may stay quiet.
- `dev/sound_demo.py` prints every sound's loudness and writes a demo WAV.

### Phones fit on one screen
`fitScreen()` in player.js shrinks any screen taller than the phone (CSS `zoom`, down to 66%). The join screen and gallery may scroll. The drawing canvas is sized to exactly the height that's left, so the tools are always visible. `dev/play_test.py` reports any screen that needs scrolling; run it with `PHONE=375x667` (iPhone SE) as well as the default 390x844.

## Security model
- `quiz_web` (its password is in `js/config.js`, public on purpose) can only `EXECUTE` six SECURITY DEFINER functions: `check, sync, write, reset, host_put_quiz, host_get_quiz`. It has no table access.
- `quiz.check(game, password, pin)` verifies the bcrypt hash once (with a 0.6 s delay when wrong) and hands out a session token. Every other call takes the token, so bcrypt doesn't run on every poll.
- `quiz.write` enforces that **players** may only: join as their own pid; answer once, only while that question is open (server clock, +2 s); and send their own drawing during a drawing round. Everything else needs a host session.
- `quiz.setup(game, pw, pin)` is owner-only. It sets or changes the password and PIN and signs everyone out.
- **Known limits:** a player's identity is just a random pid, so someone determined could post as another pid they've seen in the tree. The `dq` answers are visible to anyone who digs. Fine for a pub quiz.

## Working on it

### Run locally
- **Quickest:** set `connectionString` in `js/config.js` to something containing `PASTE`. That gives LOCAL mode, with tabs in one browser syncing via localStorage. Open `host.html` (PIN `2512`) and `index.html?as=1`, `?as=2`… for extra players. **Don't commit that change.**
- **The real Neon code path, offline:** run local Postgres plus `dev/mock_neon.py` plus `dev/serve_test_site.sh` (the steps are at the top of `mock_neon.py`). Test password `snowball`, PIN `2512`.
- **Automated:** `CHROME=/path/to/chrome python3 dev/play_test.py` plays a full phones-only game with 4 players (portraits, questions, a drawing round, podium and gallery). Screenshots go to `dev/shots/`. Run it after any change to host.js or player.js.

### Rules that bit us (keep them)
1. **Bump `?v=N`** on every `<script>`/`<link>` in all three HTML files whenever JS or CSS changes, otherwise phones keep the old cached copy for up to 10 minutes. It's `?v=11` at the moment.
2. **Never write `onkeydown = e => cond && action()`.** Returning `false` cancels the keystroke, so the box ignores typing. Use `e => { if (cond) action(); }`.
3. **Don't send a `Content-Type` header to Neon**, because its CORS rules reject it from browsers. Use the `Neon-Connection-String`, `Neon-Raw-Text-Output: true` and `Neon-Array-Mode: true` headers, and put the query and params in the body.
4. **Test with real key presses and taps**, not Playwright `fill()`, which skips key events and hid rule 2.
5. **Database changes:** edit `neon/schema.sql`, add a `neon/UPDATE_N_*.sql` containing only the changed functions plus grants, rebuild `SETUP_LMK_TESTING.sql` from the schema, and have the owner paste the update into Neon's SQL Editor. You can check it's applied from the browser by asking `pg_proc.prosrc` through the quiz_web endpoint (catalogs are readable).
6. Phones redraw only on a render-key change, and never mid-draw or mid-answer.

### Making a quiz
Use the builder (`builder.html`): log in, edit, Finish → **Upload**. Then on the host page use ⋯ → **↻ Reload questions**. The quiz file format is in README §5; `dev/sample_questions.js` is a small working example.

## Status and what's left
**Works, tested end to end:** sign-in and password, questions, the drawing rounds (several), self-portraits as avatars, the shared phone screens, the winner celebration, the builder, the QR join, and refresh resilience for the host and players.

**Still to do before the night:**
- [ ] Real questions from LMK data (the current set is placeholders marked `todo`). Prizes are still TBC (from LMK's customers).
- [ ] Rehearse on real phones over the pub's Wi-Fi and 4G, then use **⋯ → Reset game**.
- [ ] Reset the `neondb_owner` password in Neon. It was pasted into a chat on 25 Nov; the site doesn't use it.

**After Christmas:** Save results (host ⋯), delete the LMK TESTING Neon project, and make this repo private or delete it.

**Ideas not built:** a host "kick and ban" beyond removing a name; showing per-player answer history at the end; letting the host play from the same phone (it works in two tabs, but the hidden tab polls slowly).
