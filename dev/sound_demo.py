#!/usr/bin/env python3
"""Renders every sound in js/sfx.js offline: prints its loudness (anything near 0 is silent) and writes
dev/shots/sounds_demo.wav, a 50-second 'whole night' demo with the music underneath.
Needs dev/serve_test_site.sh running (BASE, default http://localhost:8000/) and Playwright (CHROME=… optional)."""
import asyncio, base64, json, os
BASE = os.environ.get("BASE", "http://localhost:8000/")
OUT = os.path.join(os.path.dirname(__file__), "shots"); os.makedirs(OUT, exist_ok=True)
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get("CHROME") or None)
        pg = await b.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto(BASE + "index.html"); await pg.wait_for_function("window.SFX")
        res = await pg.evaluate("""async () => {
          const names = Object.keys(SFX._sounds), out = {};
          for (const n of names) {           // each sound on its own: is it audible, does it clip?
            const buf = await SFX._offline(n.startsWith('winner') ? 7 : 3, [[0.05, n]]);
            const d = buf.getChannelData(0); let peak = 0, sum = 0, bad = 0;
            for (const x of d) { if (!isFinite(x)) bad++; const a = Math.abs(x); if (a > peak) peak = a; sum += x * x; }
            out[n] = { peak: +peak.toFixed(3), rms: +Math.sqrt(sum / d.length).toFixed(4), bad };
          }
          return out; }""")
        for k, v in res.items(): print(f"{k:9s} peak {v['peak']:.3f}  rms {v['rms']:.4f}" + ("  NaN!" if v["bad"] else ""))
        # a demo: a whole 'night' in 50 seconds, with the music underneath
        demo = await pg.evaluate("""async () => {
          const T = [[0.3,'join'],[2.2,'start'],[4.0,'lock'],[5.0,'tick'],[6.0,'tick'],[7.0,'tickHi'],[8.0,'tickHi'],[9.0,'tickHi'],[10.0,'timeup'],
            [12.0,'reveal'],[12.65,'correct'],[15.0,'reveal'],[15.65,'wrong'],[18.5,'board'],[19.8,'up'],[21.5,'draw'],[24.0,'lock'],[25.5,'pencils'],
            [27.5,'allin'],[29.5,'final'],[31.5,'podium'],[34.5,'podium'],[36.0,'place'],[38.0,'winnerMe'],[45.5,'awards'],[47.5,'gallery']];
          const buf = await SFX._offline(51, T, { at: 0.2, dur: 50.5 });
          const d = buf.getChannelData(0), n = d.length, rate = buf.sampleRate;
          const wav = new DataView(new ArrayBuffer(44 + n * 2));
          const w = (o, s) => [...s].forEach((c, i) => wav.setUint8(o + i, c.charCodeAt(0)));
          w(0,'RIFF'); wav.setUint32(4, 36 + n * 2, true); w(8,'WAVEfmt '); wav.setUint32(16,16,true); wav.setUint16(20,1,true); wav.setUint16(22,1,true);
          wav.setUint32(24,rate,true); wav.setUint32(28,rate*2,true); wav.setUint16(32,2,true); wav.setUint16(34,16,true); w(36,'data'); wav.setUint32(40,n*2,true);
          for (let i = 0; i < n; i++) wav.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i])) * 32767, true);
          let s = ''; const u = new Uint8Array(wav.buffer); for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode(...u.subarray(i, i + 32768));
          return btoa(s); }""")
        open(os.path.join(OUT, "sounds_demo.wav"), "wb").write(base64.b64decode(demo))
        print("page errors:", errs or "none")
        await b.close()
asyncio.run(main())
