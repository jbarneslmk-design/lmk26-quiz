# LMK 26 quiz

Static GitHub Pages site (plain HTML/CSS/JS, no build, no npm) plus a separate Neon project (LMK TESTING) reached from the browser over Neon's SQL-over-HTTP. Read **HANDOVER.md** first: it covers the architecture, data paths, security model and status.

Rules:
- Bump `?v=N` on every script/style link in index.html, host.html and builder.html whenever JS or CSS changes, because phones cache for 10 minutes.
- Key handlers: `e => { if (e.key === "Enter") go(); }`, never `e => e.key === "Enter" && go()`. Returning false blocks typing.
- Never send `Content-Type` to Neon (CORS). Only the `Neon-*` headers.
- Players' phones must not redraw while drawing or choosing (the `roomKey = "busy"` logic in player.js).
- `state.q` indexes the runtime `Q()` list (portrait marker + questions + generated drawing questions): don't change questions mid-game.
- DB changes: edit neon/schema.sql, add neon/UPDATE_N_*.sql (changed functions + grants), rebuild SETUP_LMK_TESTING.sql. The owner runs it in Neon's SQL Editor; you can't.
- Never commit js/questions.js (it's gitignored) or a LOCAL-mode config.js.
- After changing host.js or player.js, run `dev/play_test.py` (see HANDOVER.md → Run locally) and check it reports no page errors.
- Commits end with the session attribution lines.
