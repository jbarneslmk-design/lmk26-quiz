#!/usr/bin/env python3
"""Plays a whole game on phone-sized screens: a host plus 4 players, from self-portraits to the gallery.

Needs: pip install playwright && playwright install chromium (or set CHROME=/path/to/chrome); dev/mock_neon.py and dev/serve_test_site.sh running,
and a fresh lobby:  psql -d neondb -c "update quiz.game set tree='{\\"state\\":{\\"phase\\":\\"lobby\\"}}', rev=rev+1, quizdef=null; delete from quiz.log;"
Screenshots go to dev/shots/. Prints the final scores and any page errors (there should be none).
Uses real taps and key presses (not fill()), because a fill() test once hid a bug where boxes ignored typing.
"""
import asyncio, math, os, random
from playwright.async_api import async_playwright
BASE = os.environ.get("BASE", "http://localhost:8000/")
SH = os.path.join(os.path.dirname(__file__), "shots"); os.makedirs(SH, exist_ok=True)
QA = {"Which was our busiest month?": 3, "Who makes the best brew?": 1, "Longest-serving customer?": 0}
# PHONE=375x667 tests a small phone (iPhone SE); default is a typical 390x844
W, H = (int(x) for x in os.environ.get("PHONE", "390x844").split("x"))
PHONE = dict(viewport={"width": W, "height": H}, is_mobile=True, has_touch=True)
SCROLLS = {}
STUCK = []   # steps that should have moved on by themselves but didn't
async def check_fit(pg, who):
    """Record any screen that needs scrolling (the join screen and the gallery are allowed to)."""
    r = await pg.evaluate("""() => { const st = document.querySelector('.pstage');
      if (!st || st.querySelector('.join, .pgallery')) return null;
      const over = document.documentElement.scrollHeight - innerHeight;
      return over > 4 ? { over, screen: (st.firstElementChild && st.firstElementChild.className) || '?', zoom: st.style.zoom || '1' } : null; }""")
    if r: SCROLLS.setdefault(r["screen"], (who, r["over"], r["zoom"]))

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get("CHROME") or None); errs = []
        host = await (await b.new_context(**PHONE)).new_page(); host.on("pageerror", lambda e: errs.append(("host", str(e))))
        await host.goto(BASE + "host.html"); await host.tap("#pin"); await host.keyboard.type("2512"); await host.keyboard.press("Enter")
        await host.wait_for_selector(".lobby", timeout=15000)
        names, cols, ps = ["Dave", "Sharon", "Kev", "Priya"], ["#ff2e88", "#18c6ff", "#21d07a", "#ff8a00"], []
        for i, n in enumerate(names):
            pg = await (await b.new_context(**PHONE)).new_page(); pg.on("pageerror", lambda e, n=n: errs.append((n, str(e))))
            await pg.goto(BASE); await pg.tap("#pw"); await pg.keyboard.type("snowball"); await pg.tap("#nm"); await pg.keyboard.type(n); await pg.keyboard.press("Enter")
            await pg.wait_for_selector(".wait", timeout=10000); ps.append(pg)
        shot = lambda pg, name, full=False: pg.screenshot(path=os.path.join(SH, name + ".png"), full_page=full)
        await host.wait_for_timeout(1500); await shot(ps[0], "01_lobby")
        label = lambda: host.evaluate("document.querySelector('[data-act=next]').textContent")
        async def nxt():
            if await host.locator("[data-act=next]").is_enabled(): await host.tap("[data-act=next]")
        async def draw(pg, i, portrait):
            bx = await pg.locator("#cv").bounding_box(); X = lambda x: bx["x"] + x * bx["width"]; Y = lambda y: bx["y"] + y * bx["height"]
            async def path(pts, col=None, size=None):
                if col: await pg.tap(f'[data-col="{col}"]')
                if size: await pg.tap(f'[data-size="{size}"]')
                await pg.mouse.move(X(pts[0][0]), Y(pts[0][1])); await pg.mouse.down()
                for x, y in pts[1:]: await pg.mouse.move(X(x), Y(y), steps=2)
                await pg.mouse.up()
            circ = lambda cx, cy, r, a0=0, a1=2 * math.pi, k=30: [(cx + r * math.cos(a0 + (a1 - a0) * j / k), cy + r * math.sin(a0 + (a1 - a0) * j / k)) for j in range(k + 1)]
            if portrait:
                await path(circ(.5, .42, .25), cols[i], 8); await path([(.42, .37), (.43, .37)], "#14112b", 8); await path([(.58, .37), (.59, .37)])
                await path(circ(.5, .47, .11, .2, math.pi - .2, 12)); await path([(.2, .85), (.25, .75), (.3, .85), (.35, .75)])
            else:
                await path(circ(.5, .5, .3), "#7b5cff", 8); await path([(.2, .8), (.8, .2)], "#ff2e88", 18)
            await pg.tap('[data-tool="send"]')
        taken = set()
        for _ in range(150):
            await host.wait_for_timeout(450); l = await label()
            for i, pg in enumerate(ps): await check_fit(pg, names[i])
            if "Pencils down" in l:
                cur = await host.evaluate("Backend.get('current')"); key = f"drew{cur.get('drawRound')}"
                if key in taken:  # already drew: should move on by itself once everyone's in
                    for _ in range(16):
                        await host.wait_for_timeout(500)
                        if (await label()) != l: break
                    else:
                        STUCK.append("Pencils down (everyone had drawn)"); await nxt()
                    continue
                taken.add(key); await asyncio.sleep(1.3)
                for i, pg in enumerate(ps):
                    await pg.wait_for_selector("#cv", timeout=8000)
                    if i == 1 and "draw_screen" not in taken: taken.add("draw_screen"); await shot(pg, "02_drawing_screen")
                    await draw(pg, i, cur.get("portrait"))
                continue
            if "Reveal answer" in l or "Start guessing" in l:
                # these should happen automatically; give it 8 s before calling it stuck
                for _ in range(16):
                    await host.wait_for_timeout(500)
                    if (await label()) != l: break
                else:
                    STUCK.append(l.strip()); await nxt()
                continue
            if "Stop answers" in l:
                await asyncio.sleep(1.3); cur = await host.evaluate("Backend.get('current')")
                for i, pg in enumerate(ps):
                    try:
                        o = pg.locator(".opt[data-v]")
                        if await o.count():
                            await (pg.tap(f'.opt[data-v="{QA[cur["text"]]}"]') if i == 0 and cur["text"] in QA else o.nth(random.randrange(await o.count())).tap(timeout=2500))
                        elif await pg.locator("#num").count():
                            await pg.tap("#num"); await pg.keyboard.type(str(18000 if i == 0 else random.randint(500, 60000))); await pg.tap("#numgo")
                    except Exception: pass
                await host.wait_for_timeout(2500)  # everyone answered: it closes and reveals by itself
                continue
            if "Leaderboard" in l:
                cur = await host.evaluate("Backend.get('current')"); k = "draw" if cur.get("drawingOf") else cur["type"]
                if k not in taken: taken.add(k); await ps[1].wait_for_timeout(1500); await shot(ps[1], "02_reveal_" + k, True)
                await nxt(); continue
            if "Reveal 2nd" in l or "Reveal the winner" in l:
                await ps[1].wait_for_timeout(1500); await shot(ps[1], "03_podium_" + ("3rd" if "2nd" in l else "2nd")); await nxt(); continue
            if "Special awards" in l:
                await asyncio.sleep(1.6); await shot(ps[0], "03_winner_own_phone"); await shot(ps[2], "04_winner_other_phone", True); await nxt(); continue
            if "wrap" in l:
                await ps[1].wait_for_timeout(1500); await shot(ps[1], "05_gallery", True); break
            await nxt()
        ans = await host.evaluate("Backend.get('answers').then(a => Object.fromEntries(Object.entries(a || {}).map(([q, x]) => [q, Object.keys(x || {}).length])))")
        print("answers per question:", ans)
        sc = await host.evaluate("Backend.get('scores')")
        print("final:", sorted((v["rank"], v["name"], v["total"]) for v in sc.values()))
        print(f"phone {W}x{H}: screens that need scrolling:", SCROLLS or "none")
        print("steps that didn't move on by themselves:", STUCK or "none")
        print("page errors:", errs or "none")
        await b.close()
asyncio.run(main())
