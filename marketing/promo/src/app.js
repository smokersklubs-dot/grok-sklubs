/* Sklubot promo — a deterministic timeline: renderAt(t) draws the frame at t seconds, nothing depends on the clock.
   The characters are the app's own (characters.js is rendered from web/src/components/Character.tsx); their CSS
   animations are paused and placed at the right time on every frame. */
(function () {
  "use strict";
  const params = new URLSearchParams(location.search);
  const MODE = params.get("mode") === "v" ? "v" : "h";
  const stage = document.getElementById("stage");
  stage.classList.add(MODE);
  const $ = (id) => document.getElementById(id);

  /* ---------- Easing ---------- */
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const prog = (t, a, d) => clamp((t - a) / d);
  const outCubic = (x) => 1 - Math.pow(1 - x, 3);
  const inOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const outBack = (x) => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
  const outElastic = (x) => (x === 0 || x === 1 ? x : Math.pow(2, -9 * x) * Math.sin((x * 10 - 0.75) * (2 * Math.PI) / 3.2) + 1);
  const lerp = (a, b, x) => a + (b - a) * x;

  /* ---------- Icons and characters ---------- */
  const icon = (n) => window.ICON[n] || "";
  const POINTER = '<svg viewBox="0 0 24 24" width="44" height="44"><path d="M5 3l14 7.2-6 2-2.6 6.3z" fill="#1e2024" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const APP_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect x="24" y="24" width="464" height="464" rx="132" fill="#e2552d"/><path fill="none" stroke="#fff" stroke-width="46" stroke-linecap="round" stroke-linejoin="round" d="M330 186c-14-30-40-46-76-46-46 0-78 24-78 58 0 36 30 48 80 58 52 10 84 24 84 62 0 36-34 62-84 62-40 0-70-18-84-50"/></svg>';

  // Every pre-rendered character uses the same React ids (_R_0_m…): each bot on screen gets its own prefix.
  function charHTML(id, state, size, uid) {
    return window.CHAR[id][state]
      .replace(/_R_[0-9a-z]*_/g, uid)
      .replace("width:200px;height:200px", `width:${size}px;height:${size}px`)
      .replace("--chr-size:200px", `--chr-size:${size}px`)
      .replace('width="200" height="200"', `width="${size}" height="${size}"`);
  }

  const bots = [];
  /** A character in a slot. set(state, t) swaps the markup only when the state changes. */
  function makeBot(parent, id, size, off) {
    const el = document.createElement("div");
    el.className = "bot";
    el.dataset.off = String(off || 0);
    parent.appendChild(el);
    const b = { el, id, size, state: "", since: 0, off: off || 0, look: [0, 0] };
    b.set = (state, t) => {
      if (state === b.state) return;
      el.innerHTML = charHTML(id, state, size, `b${bots.indexOf(b)}x`);
      b.state = state;
      b.since = t;
      el.dataset.since = String(t);
      b.chr = el.firstElementChild;
    };
    bots.push(b);
    return b;
  }
  /** Blink every few seconds (the app does it from a timer; here it comes from t). */
  function blink(b, t) {
    if (!b.chr) return;
    const can = !["sleeping", "happy", "euphoric"].includes(b.state);
    const p = (t * 1000 + b.off * 1733) % 3900;
    b.chr.classList.toggle("is-blink", can && p < 110);
    b.chr.style.setProperty("--fx", b.look[0].toFixed(2));
    b.chr.style.setProperty("--fy", b.look[1].toFixed(2));
  }

  /* ---------- Kinetic words ---------- */
  function splitWords(el) {
    const walk = (node) => {
      [...node.childNodes].forEach((n) => {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          n.textContent.split(/( )/).forEach((part) => {
            if (part === " ") frag.appendChild(document.createTextNode(" "));
            else if (part) {
              const w = document.createElement("span");
              w.className = "w";
              w.innerHTML = `<span class="wi"></span>`;
              w.firstChild.textContent = part;
              frag.appendChild(w);
            }
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1) walk(n);
      });
    };
    walk(el);
    el._words = [...el.querySelectorAll(".wi")];
  }
  document.querySelectorAll(".kin").forEach(splitWords);
  /** Words rise in one after the other from `start`; fade out at `end` if given. */
  function kinetic(el, t, start, end, stagger = 0.055) {
    el._words.forEach((w, i) => {
      const p = outCubic(prog(t, start + i * stagger, 0.5));
      w.style.transform = `translateY(${(1 - p) * 105}%)`;
    });
    el.style.opacity = end != null ? String(1 - prog(t, end, 0.25)) : "1";
  }

  /* ---------- Build the scenes ---------- */
  const TL = window.TL;
  const scenes = TL.scenes.map((s) => {
    const el = $("s-" + s.id);
    el.classList.add(s.theme === "dark" ? "theme-dark" : "theme-light");
    return { ...s, el };
  });

  // Hook
  document.querySelector(".hook-moon").innerHTML = icon("moon");
  const juno = makeBot($("hook-bot"), "juno", MODE === "h" ? 420 : 420, 0.3);

  // Team
  const TEAM = [
    { id: "seo", name: "Max", job: "SEO", ico: "search" },
    { id: "prospect", name: "Léa", job: "Prospection", ico: "target" },
    { id: "support", name: "Noé", job: "Service client", ico: "chat" },
    { id: "social", name: "Iris", job: "Réseaux sociaux", ico: "send" },
    { id: "admin", name: "Oscar", job: "Administratif", ico: "folder" },
  ];
  const members = TEAM.map((m, i) => {
    // (bot size below)
    const wrap = document.createElement("div");
    wrap.className = "member";
    wrap.innerHTML = `<div class="bot-holder"><div class="voice">${icon("volume")}</div></div><div class="m-name">${m.name}</div><div class="m-job">${icon(m.ico)}<span>${m.job}</span></div>`;
    $("team-row").appendChild(wrap);
    const bot = makeBot(wrap.firstElementChild, m.id, MODE === "h" ? 260 : 220, i * 0.37);
    return { ...m, wrap, bot, voice: wrap.querySelector(".voice") };
  });

  // Computer
  $("url-ico").innerHTML = icon("globe");
  ["globe", "terminal", "folder"].forEach((n) => { const s = document.createElement("span"); s.innerHTML = icon(n); $("dock").appendChild(s); });
  const BARS = [0.42, 0.55, 0.5, 0.68, 0.3, 0.76, 0.88];
  const bars = BARS.map((h, i) => { const b = document.createElement("i"); if (i === 4) b.className = "is-low"; b.style.height = h * 100 + "%"; $("bars").appendChild(b); return b; });
  const DOC = [0.95, 0.82, 0.9, 0.6, 0.86, 0.7];
  const docLines = DOC.map((w) => { const l = document.createElement("i"); l.style.width = w * 100 + "%"; $("doc-lines").appendChild(l); return l; });
  $("pc-pointer").innerHTML = POINTER;
  $("safe-pointer").innerHTML = POINTER;
  const TASKS = ["Analyser les positions du site", "Repérer les pages qui baissent", "Écrire le résumé de la semaine"];
  const tasks = TASKS.map((txt) => {
    const d = document.createElement("div");
    d.className = "task";
    d.innerHTML = `<span class="tk-ico"><span class="tk-spin"></span>${icon("check")}</span><span class="tk-txt">${txt}</span>`;
    $("tasks").appendChild(d);
    const chk = d.querySelector(".tk-ico svg");
    return { d, spin: d.querySelector(".tk-spin"), chk };
  });
  const maxBot = makeBot($("pc-bot"), "seo", MODE === "h" ? 250 : 230, 0.1);
  const MINIS = [
    { id: "prospect", name: "Léa", task: "Préparer les relances", wall: "#dd5230" },
    { id: "support", name: "Noé", task: "Répondre aux clients", wall: "#2c86cf" },
    { id: "admin", name: "Oscar", task: "Classer les factures", wall: "#c08310" },
  ];
  const minis = MINIS.map((m, i) => {
    const d = document.createElement("div");
    d.className = "mini";
    d.innerHTML = `<div class="mini-screen"><div class="mini-bar"><i></i><i></i><i></i><span>Ordinateur de ${m.name}</span></div>
      <div class="mini-wall" style="background: linear-gradient(160deg, color-mix(in srgb, ${m.wall} 70%, #fff), ${m.wall} 75%)"></div>
      <div class="mini-card"><div class="mini-task"><span class="tk-ico"><span class="tk-spin"></span>${icon("check")}</span><span>${m.task}</span></div><div class="mini-prog"><i></i></div></div>
      </div><div class="slot"></div><div class="mini-name">${m.name} <span>· ${TEAM.find((x) => x.id === m.id).job}</span></div>`;
    $("minis").appendChild(d);
    const bot = makeBot(d.querySelector(".slot"), m.id, MODE === "h" ? 190 : 200, 0.2 + i * 0.41);
    return { ...m, d, bot, bar: d.querySelector(".mini-prog i"), spin: d.querySelector(".tk-spin"), chk: d.querySelector(".tk-ico svg"), ico: d.querySelector(".tk-ico") };
  });

  // Safety
  $("card-ico").innerHTML = icon("mail");
  $("irrev-ico").innerHTML = icon("alert");
  $("out-ico").innerHTML = icon("check");
  const lea = makeBot($("safe-bot"), "prospect", MODE === "h" ? 320 : 300, 0.2);

  // Today
  $("st-i1").innerHTML = icon("tasks");
  $("st-i2").innerHTML = icon("clock");
  $("st-i3").innerHTML = icon("users");
  const DONE = [
    { id: "seo", name: "Max", title: "Résumé SEO de la semaine", min: 30 },
    { id: "support", name: "Noé", title: "Réponses aux questions clients", min: 45 },
    { id: "prospect", name: "Léa", title: "Relances envoyées", min: 25 },
    { id: "admin", name: "Oscar", title: "Factures classées", min: 20 },
    { id: "social", name: "Iris", title: "Posts de la semaine préparés", min: 40 },
  ];
  const TOTAL = DONE.reduce((a, r) => a + r.min, 0);
  const rows = DONE.map((r, i) => {
    const d = document.createElement("div");
    d.className = "today-row";
    d.innerHTML = `<span class="av"></span><span class="today-row-main"><span class="today-row-title">${r.title}</span><span class="today-row-sub">${r.name}</span></span><span class="today-row-min">≈ ${r.min} min</span><span class="today-row-ok">${icon("check")}</span>`;
    $("today-list").appendChild(d);
    const bot = makeBot(d.querySelector(".av"), r.id, 30, i * 0.3);
    return { d, bot };
  });
  const fmtMin = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`);

  // CTA
  $("app-icon").innerHTML = APP_ICON;
  $("cta-plat").innerHTML = [["globe", "Web"], ["smartphone", "Téléphone"], ["monitor", "Ordinateur"]].map(([i, l]) => `<span>${icon(i)}${l}</span>`).join("");
  const CTA_IDS = ["seo", "prospect", "support", "juno", "social", "admin"];
  const ctaBots = CTA_IDS.map((id, i) => {
    const d = document.createElement("div");
    d.className = "cb";
    $("cta-bots").appendChild(d);
    return { d, bot: makeBot(d, id, MODE === "h" ? 190 : 210, i * 0.29) };
  });

  /* ---------- Per-scene drawing ---------- */
  const pop = (el, t, at, from = 0) => {
    const p = prog(t, at, 0.55);
    const s = p <= 0 ? from : lerp(from, 1, outBack(p));
    el.style.transform = `scale(${Math.max(0, s)})`;
    el.style.opacity = p <= 0 ? "0" : String(clamp(p * 4));
  };
  const rise = (el, t, at, dist = 40, dur = 0.6) => {
    const p = outCubic(prog(t, at, dur));
    el.style.transform = `translateY(${(1 - p) * dist}px)`;
    el.style.opacity = String(p);
  };

  function drawHook(t) {
    const H = TL.hook;
    juno.set(t < H.wake ? "sleeping" : t < H.wake + 0.7 ? "happy" : "working", t);
    const jb = $("hook-bot");
    const wakeP = prog(t, H.wake, 0.5);
    jb.style.transform = `translateY(${-Math.sin(wakeP * Math.PI) * 40}px) scale(${1 + Math.sin(wakeP * Math.PI) * 0.06})`;
    juno.look = t > H.wake + 0.7 ? [5, 1] : [0, 0];
    rise(document.querySelector(".hook-moon"), t, 0.05, 20, 0.8);
    kinetic($("hook-text"), t, H.words, null, 0.09);
    // A slow push-in for the whole scene.
    const z = 1 + 0.03 * prog(t, 0, 4.6);
    $("s-hook").style.transform = `scale(${z})`;
  }

  function drawTeam(t) {
    const T = TL.team;
    kinetic($("team-title"), t, T.title);
    members.forEach((m, i) => {
      const at = T.pops[i];
      pop(m.wrap.firstElementChild, t, at);
      rise(m.wrap.querySelector(".m-name"), t, at + 0.15, 30, 0.5);
      rise(m.wrap.querySelector(".m-job"), t, at + 0.25, 30, 0.5);
      const sp = T.speak[i];
      const speaking = t >= sp && t < sp + 0.5;
      m.bot.set(t < at + 0.65 ? "happy" : speaking ? "speaking" : "idle", t);
      const vp = t < sp ? 0 : t < sp + 0.5 ? outBack(prog(t, sp, 0.3)) : 1 - prog(t, sp + 0.5, 0.2);
      m.voice.style.opacity = String(clamp(vp));
      m.voice.style.transform = `scale(${Math.max(0, vp)})`;
      // Before speaking, everyone looks at whoever is speaking.
      const who = T.speak.findIndex((s) => t >= s && t < s + 0.5);
      m.bot.look = who < 0 || who === i ? [0, 1] : [who < i ? -4 : 4, 0];
    });
    kinetic($("team-cap"), t, T.caption, null, 0.05);
  }

  function drawComputer(t) {
    const C = TL.computer;
    const a = $("pc-a"), b = $("pc-b");
    const sp = prog(t, C.split, 0.35);
    a.style.opacity = String(1 - sp);
    a.style.transform = `scale(${1 - 0.06 * inOutCubic(sp)})`;
    a.style.display = sp >= 1 ? "none" : "";
    b.style.display = t < C.split ? "none" : "";
    kinetic($("pc-title"), t, C.title);
    kinetic($("pc-sub"), t, C.title + 0.45, null, 0.04);
    const pcp = outCubic(prog(t, C.title + 0.2, 0.8));
    $("pc").style.transform = `translateY(${(1 - pcp) * 80}px)`;
    $("pc").style.opacity = String(pcp);
    // Browser opens, bars grow, then the document is written.
    const bw = $("win-browser");
    const bo = outBack(prog(t, C.open, 0.5));
    bw.style.transform = `scale(${0.6 + 0.4 * bo})`;
    bw.style.opacity = String(clamp(prog(t, C.open, 0.2)));
    bars.forEach((el, i) => { el.style.transform = `scaleY(${outCubic(prog(t, C.open + 0.5 + i * 0.12, 0.5))})`; });
    const dw = $("win-doc");
    const dop = outBack(prog(t, C.checks[0] + 0.2, 0.5));
    dw.style.transform = `scale(${0.6 + 0.4 * dop})`;
    dw.style.opacity = String(clamp(prog(t, C.checks[0] + 0.2, 0.2)));
    docLines.forEach((l, i) => { l.style.transform = `scaleX(${outCubic(prog(t, C.checks[0] + 0.7 + i * 0.32, 0.4))})`; });
    // The bot's pointer wanders over its own screen.
    const pts = MODE === "h"
      ? [[760, 560], [560, 20], [820, 260], [330, 380], [600, 560], [900, 330]]
      : [[700, 540], [480, 20], [740, 250], [320, 380], [560, 560], [820, 320]];
    const k = clamp((t - C.open + 0.3) / 1.0, 0, pts.length - 1.001);
    const i0 = Math.floor(k), f = inOutCubic(k - i0);
    const px = lerp(pts[i0][0], pts[i0 + 1][0], f), py = lerp(pts[i0][1], pts[i0 + 1][1], f);
    $("pc-pointer").style.transform = `translate(${px}px, ${py}px)`;
    tasks.forEach((tk, i) => {
      rise(tk.d, t, C.title + 0.6 + i * 0.15, 40, 0.6);
      const done = t >= C.checks[i];
      tk.d.classList.toggle("is-done", done);
      tk.spin.style.display = done ? "none" : "";
      tk.spin.style.transform = `rotate(${t * 400}deg)`;
      tk.chk.style.display = done ? "" : "none";
      tk.chk.style.transform = `scale(${outBack(prog(t, C.checks[i], 0.35))})`;
    });
    const lastDone = C.checks.findIndex((c) => t >= c && t < c + 0.45);
    maxBot.set(lastDone >= 0 ? "happy" : "working", t);
    maxBot.look = [-5, 0];
    pop($("pc-bot"), t, C.title + 1.0);

    if (t >= C.split) {
      kinetic($("par-title"), t, C.split + 0.35);
      kinetic($("par-sub"), t, C.split + 0.7, null, 0.04);
      minis.forEach((m, i) => {
        rise(m.d, t, C.split + 0.4 + i * 0.18, 70, 0.7);
        const start = C.split + 0.8 + i * 0.15;
        const end = C.miniChecks[i];
        m.bar.style.transform = `scaleX(${inOutCubic(prog(t, start, end - start))})`;
        const done = t >= end;
        m.spin.style.display = done ? "none" : "";
        m.spin.style.transform = `rotate(${t * 400}deg)`;
        m.chk.style.display = done ? "" : "none";
        m.chk.style.transform = `scale(${outBack(prog(t, end, 0.35))})`;
        m.ico.style.background = done ? "var(--ok-soft)" : "";
        m.ico.style.color = done ? "var(--ok)" : "";
        m.bot.set(done ? (t < end + 0.8 ? "happy" : "idle") : "working", t);
        m.bot.look = [-4, 0];
      });
    }
  }

  function drawSafety(t) {
    const S = TL.safety;
    kinetic($("safe-title"), t, S.title, null, 0.06);
    const cp = outCubic(prog(t, S.card, 0.7));
    $("appcard").style.transform = `translateY(${(1 - cp) * 90}px) scale(${0.96 + 0.04 * cp})`;
    $("appcard").style.opacity = String(cp);
    pop($("safe-bot"), t, S.card + 0.3);
    lea.set(t < S.click + 0.15 ? "waiting" : t < S.after + 0.9 ? "happy" : "idle", t);
    lea.look = t < S.click ? [5, -1] : [3, 0];
    // Pointer: comes in, rests on "Autoriser une fois", clicks.
    const btn = $("btn-allow");
    const sr = stage.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    const tx = br.left - sr.left + br.width * 0.55, ty = br.top - sr.top + br.height * 0.45;
    const sx = MODE === "h" ? 1900 : 1080, sy = MODE === "h" ? 1060 : 1700;
    const mp = inOutCubic(prog(t, S.cursor, 1.3));
    const press = t >= S.click && t < S.click + 0.16;
    const ptr = $("safe-pointer");
    ptr.style.transform = `translate(${lerp(sx, tx, mp)}px, ${lerp(sy, ty, mp)}px) scale(${press ? 0.86 : 1})`;
    ptr.style.opacity = String(clamp(prog(t, S.cursor, 0.2)) * (1 - prog(t, S.after + 0.4, 0.3)));
    btn.classList.toggle("is-hover", t >= S.cursor + 1.2 && t < S.click + 0.3);
    btn.style.transform = press ? "scale(0.95)" : "";
    const done = prog(t, S.click + 0.25, 0.3);
    $("card-actions").style.opacity = String(1 - done);
    $("card-outcome").style.opacity = String(done);
    $("irrev").style.opacity = String(1 - 0.55 * done);
    kinetic($("safe-cap"), t, S.after, null, 0.05);
  }

  function drawToday(t) {
    const D = TL.today;
    kinetic($("today-title"), t, D.title, null, 0.06);
    const pp = outCubic(prog(t, D.panel, 0.8));
    $("tp").style.transform = `translateY(${(1 - pp) * 80}px)`;
    $("tp").style.opacity = String(pp);
    let n = 0;
    rows.forEach((r, i) => {
      const at = D.rows[i];
      rise(r.d, t, at, 24, 0.45);
      if (t >= at) n++;
      r.bot.set(t >= at && t < at + 0.7 ? "happy" : "idle", t);
    });
    $("st-done").textContent = String(n);
    const mins = Math.round(TOTAL * inOutCubic(prog(t, D.total, 1.2)));
    $("st-time").textContent = fmtMin(mins);
    $("hl-num").textContent = "≈ " + fmtMin(mins);
    const hp = prog(t, D.total - 0.3, 0.6);
    rise($("hl"), t, D.total - 0.3, 60, 0.7);
    const pulse = 1 + 0.05 * Math.sin(prog(t, D.highlight, 0.5) * Math.PI);
    $("hl-num").style.transform = `scale(${pulse})`;
    $("hl-num").style.transformOrigin = "left center";
    void hp;
  }

  function drawCta(t) {
    const C = TL.cta;
    ctaBots.forEach((c, i) => {
      pop(c.d, t, C.bots + i * 0.1);
      c.bot.set(t >= C.euphoric && t < C.euphoric + 1.7 ? "euphoric" : t < C.euphoric ? "happy" : t < 43.2 ? "happy" : "idle", t);
    });
    const bp = outBack(prog(t, C.word, 0.6));
    $("cta-brand").style.transform = `scale(${0.7 + 0.3 * bp})`;
    $("cta-brand").style.opacity = String(clamp(prog(t, C.word, 0.25)));
    kinetic($("cta-line"), t, C.line, null, 0.07);
    const up = outBack(prog(t, C.url, 0.6));
    $("cta-url").style.transform = `translateX(-50%) scale(${0.6 + 0.4 * up})`;
    $("cta-url").style.opacity = String(clamp(prog(t, C.url, 0.2)));
    rise($("cta-plat"), t, C.platforms, 30, 0.6);
    rise($("cta-tpl"), t, C.platforms + 0.35, 30, 0.6);
  }

  const DRAW = { hook: drawHook, team: drawTeam, computer: drawComputer, safety: drawSafety, today: drawToday, cta: drawCta };

  /* ---------- One frame ---------- */
  function renderAt(t) {
    const W = MODE === "h" ? 1920 : 1080, H = MODE === "h" ? 1080 : 1920;
    scenes.forEach((s, i) => {
      const on = t >= s.start && t < s.end;
      s.el.style.display = on ? "block" : "none";
      s.el.style.zIndex = String(i + 1);
      if (!on) return;
      // Circular reveal over the previous scene.
      if (s.origin && t < s.start + TL.reveal) {
        const p = inOutCubic(prog(t, s.start, TL.reveal));
        const r = p * Math.hypot(W, H);
        s.el.style.clipPath = `circle(${r}px at ${s.origin[0] * 100}% ${s.origin[1] * 100}%)`;
      } else s.el.style.clipPath = "";
      DRAW[s.id](t);
    });
    bots.forEach((b) => blink(b, t));
    // Pause every CSS animation and put it where it should be at t.
    for (const a of document.getAnimations()) {
      const target = a.effect && a.effect.target;
      const host = target && target.closest ? target.closest(".bot") : null;
      a.pause();
      if (!host) { a.currentTime = t * 1000; continue; }
      const since = +host.dataset.since || 0;
      const off = +host.dataset.off || 0;
      const timing = a.effect.getComputedTiming();
      const infinite = timing.iterations === Infinity;
      a.currentTime = Math.max(0, (t - since + (infinite ? off + 3 : 0)) * 1000);
    }
  }
  window.renderAt = renderAt;
  window.PROMO_MODE = MODE;

  if (params.has("t")) renderAt(parseFloat(params.get("t")));
  else if (!params.has("render")) {
    const t0 = performance.now();
    const loop = () => { renderAt(((performance.now() - t0) / 1000) % TL.duration); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
})();
