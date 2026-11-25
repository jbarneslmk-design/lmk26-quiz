// Shared helpers + scenery
window.NN = (() => {
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (sel, el = document) => el.querySelector(sel);
  const fmt = n => (n == null || isNaN(n) ? "–" : Number(n).toLocaleString("en-GB", { maximumFractionDigits: 2 }));
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const LETTERS = ["A", "B", "C", "D", "E", "F"];
  const ordinal = n => n + (["th", "st", "nd", "rd"][((n % 100) - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");
  const parseNum = s => {
    const t = String(s ?? "").replace(/[£$€,%\s]/g, "").replace(/k$/i, "e3").replace(/m$/i, "e6");
    if (t === "" || isNaN(Number(t))) return null;
    return Number(t);
  };

  const LINES = {
    right: ["Promotion incoming.", "Someone's been reading the sales reports.", "Smooth operator.", "Big brain energy.",
      "Absolute scenes.", "Put that on your appraisal.", "The boss is watching… and nodding.", "Clean getaway."],
    wrong: ["Bold. Wrong, but bold.", "HR has been notified.", "A learning opportunity, let's say.", "Confidently incorrect.",
      "That's going in the Christmas card.", "Have another mince pie and try again.", "Swing and a miss.", "The sat-nav took you somewhere else."],
    none: ["Asleep at the wheel.", "Still on your first pint?", "Too busy with the stuffing.", "Ghosted the question."],
    close: ["Spooky accurate. Do you work in finance?", "Basically a human spreadsheet.", "Inside info, surely?"],
    far: ["Not even in the same postcode.", "Were you guessing in a different currency?", "Respectfully: what?"],
    nobody: ["Not one of you. Merry Christmas.", "A clean sweep of wrong. Impressive.", "Total wipeout. Next round's on you."],
    everyone: ["Too easy. Next year it gets nasty.", "Everyone got it. Suspicious.", "Full marks for the whole table."]
  };

  function scenery() {
    if (document.getElementById("scenery")) return;
    const d = document.createElement("div");
    d.id = "scenery";
    d.setAttribute("aria-hidden", "true");
    const INK = "#160a2b";
    // cartoon palm: brown trunk, green fronds, thick ink outline
    const palm = (side, s, extra = "") => `
      <svg class="palm ${side}" style="--s:${s};${extra}" viewBox="0 0 220 420">
        <g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">
          <path d="M96 420 C 100 330, 92 250, 118 140 L 136 146 C 116 250, 122 330, 124 420 Z" fill="#a8613a"/>
          <path d="M104 360 h18 M102 300 h20 M106 240 h18 M112 185 h16" fill="none" stroke-width="5"/>
          <path d="M126 140 C 80 100, 30 110, 4 160 C 40 140, 70 136, 96 150 C 72 150, 50 165, 36 190 C 70 160, 100 152, 126 146 Z" fill="#2fc46f"/>
          <path d="M128 140 C 170 92, 214 100, 218 150 C 192 128, 166 128, 150 140 C 176 146, 196 166, 202 196 C 176 164, 150 152, 128 148 Z" fill="#25a85d"/>
          <path d="M126 138 C 110 80, 70 50, 30 58 C 70 70, 96 96, 108 130 Z" fill="#3fd67e"/>
          <path d="M128 138 C 142 78, 182 52, 214 66 C 176 74, 150 100, 138 136 Z" fill="#2fc46f"/>
          <path d="M126 136 C 124 86, 136 40, 162 14 C 152 58, 144 96, 134 136 Z" fill="#3fd67e"/>
          <circle cx="122" cy="146" r="9" fill="#7b3f22"/><circle cx="138" cy="150" r="8" fill="#7b3f22"/>
          <g fill="#fff" stroke-width="5"><ellipse cx="62" cy="104" rx="22" ry="9" transform="rotate(-14 62 104)"/><ellipse cx="178" cy="100" rx="20" ry="8" transform="rotate(16 178 100)"/>
          <ellipse cx="74" cy="62" rx="16" ry="7" transform="rotate(10 74 62)"/><ellipse cx="184" cy="66" rx="14" ry="6" transform="rotate(-14 184 66)"/><ellipse cx="150" cy="34" rx="9" ry="6" transform="rotate(-50 150 34)"/></g>
        </g>
      </svg>`;
    const win = (x, y, w, h, cols, rows) => {
      let r = "";
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++)
        if ((i * 7 + j * 3) % 5) r += `<rect x="${x + 10 + i * ((w - 20) / cols)}" y="${y + 14 + j * 26}" width="${(w - 20) / cols - 8}" height="12" rx="2" fill="${(i + j) % 3 ? "#ffd86b" : "#ff9ec9"}"/>`;
      return r;
    };
    const cap = (x, w, t) => `<g fill="#fff" stroke="${INK}" stroke-width="5" stroke-linejoin="round">
        <path d="M${x + w * .22} ${t + 4} v${12 + (w % 7)} a6 6 0 0 0 12 0 v-${12 + (w % 7)}"/>
        <path d="M${x + w * .66} ${t + 4} v${20 - (w % 5)} a5 5 0 0 0 10 0 v-${20 - (w % 5)}"/>
        <rect x="${x - 7}" y="${t - 12}" width="${w + 14}" height="20" rx="10"/></g>`;
    const bld = (x, w, h, fill, cols) => `<rect x="${x}" y="${640 - h}" width="${w}" height="${h}" fill="${fill}" stroke="${INK}" stroke-width="6"/>${win(x, 640 - h + 10, w, h, cols, Math.floor((h - 40) / 26))}${cap(x, w, 640 - h)}`;
    d.innerHTML = `
      <svg class="world" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMax slice">
        <defs>
          <pattern id="dots" width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="7" cy="7" r="2.4" fill="#fff" opacity=".18"/></pattern>
        </defs>
        <rect width="1440" height="900" fill="url(#dots)"/>
        <g stroke="${INK}" stroke-width="6" stroke-linejoin="round">
          <path d="M140 210 c0-40 60-50 80-20 c20-40 100-30 100 20 c40 0 50 50 10 60 h-200 c-40-10-30-60 10-60z" fill="#ffb3d6"/>
          <path d="M1060 150 c0-36 54-46 72-18 c18-36 90-27 90 18 c36 0 45 45 9 54 h-180 c-36-9-27-54 9-54z" fill="#c9a8ff"/>
          <circle cx="720" cy="560" r="190" fill="#ffd36b"/>
          <circle cx="720" cy="560" r="150" fill="#ffe59a" stroke="none"/>
          ${bld(300, 90, 260, "#6b2fa0", 3)}${bld(392, 70, 190, "#8f3cb8", 2)}${bld(470, 110, 330, "#4f2389", 4)}
          ${bld(880, 100, 300, "#4f2389", 3)}${bld(985, 80, 220, "#8f3cb8", 2)}${bld(1070, 120, 360, "#6b2fa0", 4)}
          <rect x="-10" y="636" width="1460" height="280" fill="#1fc3c8"/>
          <rect x="-10" y="720" width="1460" height="200" fill="#16a3b8" stroke="none"/>
          <rect x="-10" y="820" width="1460" height="100" fill="#ffd9a0"/>
          <path d="M-10 862 Q 80 836 180 858 T 400 852 T 640 864 T 880 850 T 1120 862 T 1360 852 T 1460 858 V 920 H -10 Z" fill="#fff"/>
        </g>
        <g fill="#e6f4ff" stroke="none"><ellipse cx="300" cy="880" rx="90" ry="10"/><ellipse cx="1100" cy="884" rx="120" ry="10"/></g>
        <g fill="#ffe59a" stroke="${INK}" stroke-width="4">
          <rect x="600" y="660" width="240" height="12" rx="6"/><rect x="630" y="690" width="180" height="10" rx="5"/><rect x="665" y="740" width="110" height="9" rx="4"/>
        </g>
        <g fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".85">
          <path d="M120 700 q20-12 40 0 t40 0"/><path d="M1180 690 q20-12 40 0 t40 0"/><path d="M300 770 q20-12 40 0 t40 0"/><path d="M1000 780 q20-12 40 0 t40 0"/>
        </g>
      </svg>
      ${palm("l", 1.1)}${palm("l2", .72)}${palm("r", 1.15)}${palm("r2", .7)}
      <div class="snow"></div>`;
    document.body.prepend(d);
    const flakes = (box, n, minZ, maxZ) => {
      for (let i = 0; i < n; i++) {
        const depth = Math.random(), z = minZ + depth * (maxZ - minZ);
        const f = document.createElement(i % 5 === 0 ? "b" : "i");
        if (f.tagName === "B") f.textContent = "❄";
        f.style.cssText = `left:${Math.random() * 100}%;--z:${z}px;--d:${16 - depth * 9}s;--sd:${2.5 + Math.random() * 3}s;--sx:${10 + Math.random() * 30}px;animation-delay:-${Math.random() * 20}s,-${Math.random() * 5}s`;
        box.appendChild(f);
      }
    };
    const small = innerWidth < 600;
    flakes(d.querySelector(".snow"), small ? 45 : 90, 5, 14);
    const front = document.createElement("div");
    front.id = "snowfront"; front.className = "snow"; front.setAttribute("aria-hidden", "true");
    flakes(front, small ? 7 : 12, 16, 26);
    document.body.appendChild(front);
  }

  function stars(n, max = 5) {
    n = Math.min(n || 0, max);
    let s = "";
    for (let i = 0; i < max; i++) s += `<span class="${i < n ? "on" : ""}">★</span>`;
    return `<div class="stars" title="Streak">${s}</div>`;
  }

  // The players' page address: the folder this page is in, whatever the page is called
  // (works for .../lmk26-quiz/host, .../host.html, .../index.html or .../).
  const joinUrl = () => { const u = new URL(".", location.href); return u.origin + u.pathname; };
  const shortUrl = u => u.replace(/^https?:\/\//, "").replace(/\/$/, "");

  // picture of a person: their self-portrait if they drew one, otherwise their initials
  const avatar = (img, name, cls = "") => img
    ? `<span class="av ${cls}"><img src="${img}" alt=""></span>`
    : `<span class="av ${cls} none">${esc(String(name || "?").trim().split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase())}</span>`;
  // confetti for the big moments
  function confetti(n = 90) {
    const box = document.createElement("div"); box.className = "confetti"; box.setAttribute("aria-hidden", "true");
    const cols = ["#ff4f9a", "#1fc3c8", "#ffd23f", "#4fd66b", "#a98bff", "#ff8f3a", "#fff"];
    for (let i = 0; i < n; i++) {
      const p = document.createElement("i");
      p.style.cssText = `left:${Math.random() * 100}%;background:${cols[i % cols.length]};animation-duration:${2.5 + Math.random() * 3}s;animation-delay:${Math.random() * 1.5}s;transform:rotate(${Math.random() * 360}deg);width:${6 + Math.random() * 8}px;height:${10 + Math.random() * 12}px`;
      box.appendChild(p);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 9000);
  }
  const PORTRAIT_PROMPT = "Draw yourself — and write your name!";
  // the winner's big moment: portrait bouncing in front of a flashing, spinning star
  function celebration(img, name, total, prize, isMe) {
    const sparkles = Array.from({ length: 10 }, (_, i) => `<i style="--a:${i * 36}deg;--d:${(i % 5) * 0.18}s">★</i>`).join("");
    return `<div class="celebrate ${isMe ? "me" : ""}">
      <div class="burst-wrap"><div class="burst b2"></div><div class="burst"></div><div class="sparkles">${sparkles}</div>
        <div class="hero">${avatar(img, name, "hero-av")}</div></div>
      <div class="champ-title">${isMe ? "THAT'S YOU!" : "CHAMPION"}</div>
      <div class="champ-name">${esc(name)}</div>
      <div class="champ-pts">${fmt(total)} pts</div>
      ${prize ? `<div class="prize">🎁 ${esc(prize.name)}${prize.from ? `<small>from ${esc(prize.from)}</small>` : ""}</div>` : ""}
    </div>`;
  }

  return { esc, $, fmt, pick, LETTERS, ordinal, parseNum, LINES, scenery, stars, joinUrl, shortUrl, avatar, confetti, PORTRAIT_PROMPT, celebration };
})();
