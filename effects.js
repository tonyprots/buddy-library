// Интро из клубной деки: стекло, осколки и вылет бадди.
const EFFECTS_CSS = '\n/* ================= fx: интро со взрывом и графические переходы (drafts/fx) ================= */\n.fx-layer{position:absolute;inset:0;pointer-events:none}\n.fx-canvas{position:absolute;left:0;top:0;width:1280px;height:720px;z-index:7;pointer-events:none}\n\n/* ---------- интро: трещины по обложке ---------- */\n/* смятие в точке удара: белая крошка и мелкие сколы */\n.fx-crush{position:absolute;z-index:6;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;pointer-events:none;opacity:0;\n  background:radial-gradient(circle,rgba(255,255,255,1) 0 3px,rgba(235,230,225,.9) 5px,rgba(210,204,198,.45) 9px,rgba(255,255,255,0) 23px)}\n[data-buddy-effects][data-fx=clean] .slide.on{animation:none}\n\n/* осколки: блок размером со свой кусок, внутри — копия обложки, сдвинутая на место */\n.fx-shards{position:absolute;inset:0;z-index:5;pointer-events:none;perspective:900px}\n.fx-shard{position:absolute;overflow:hidden;contain:strict;will-change:transform,opacity;backface-visibility:hidden}\n.fx-shard > .slide.fx-clone{position:absolute;inset:auto;width:1280px;height:720px;background:var(--paper)}\n.fx-shade{position:absolute;inset:0;background:#1A1817;opacity:0;pointer-events:none}\n.fx-clone,.fx-clone *{animation:none!important;transition:none!important}\n/* пока обложка — это осколки, оригинал прячем; осколки уже стоят на его месте */\n[data-buddy-effects].fx-armed > .slide.cover{visibility:hidden}\n.fx-crackcv{position:absolute;left:0;top:0;width:1280px;height:720px;z-index:6;pointer-events:none}\n\n.fx-flash{position:absolute;inset:0;z-index:6;pointer-events:none;\n  background:radial-gradient(circle at var(--x) var(--y),rgba(236,241,255,.95) 0%,rgba(19,64,224,.2) 14%,rgba(19,64,224,0) 38%)}\n.fx-ring{position:absolute;z-index:6;width:1800px;height:1800px;border-radius:50%;border:1.5px solid var(--flame);pointer-events:none;\n  transform:translate(-50%,-50%) scale(.02);opacity:0;will-change:transform,opacity}\n\n/* до взрыва человечка на обложке нет — он внутри */\n[data-buddy-effects].fx-intro .buddy{opacity:0}\n\n/* ---------- переход «диафрагма» ---------- */\n.fx-iris{position:absolute;inset:0;z-index:3;pointer-events:none;background:var(--paper)}\n.fx-iris-ring{position:absolute;z-index:3;width:0;height:0;border:14px solid var(--flame);border-radius:50%;transform:translate(-50%,-50%);pointer-events:none;box-sizing:border-box}\nhtml[data-vt=push]::view-transition-old(fx-stage){animation:fx-out .62s cubic-bezier(.6,0,.2,1) both;transform-origin:30% 50%}\nhtml[data-vt=push]::view-transition-new(fx-stage){animation:fx-in .62s cubic-bezier(.6,0,.2,1) both;box-shadow:-30px 0 60px -20px rgba(40,25,15,.35)}\nhtml[data-vt=push][data-dir=back]::view-transition-old(fx-stage){animation-name:fx-out-b;transform-origin:70% 50%}\nhtml[data-vt=push][data-dir=back]::view-transition-new(fx-stage){animation-name:fx-in-b}\n@keyframes fx-out{to{transform:translateX(-14%) scale(.86) rotate(-1.5deg);opacity:.0;filter:brightness(.85)}}\n@keyframes fx-in{from{transform:translateX(100%) rotate(2deg)}to{transform:none}}\n@keyframes fx-out-b{to{transform:translateX(14%) scale(.86) rotate(1.5deg);opacity:0;filter:brightness(.85)}}\n@keyframes fx-in-b{from{transform:translateX(-100%) rotate(-2deg)}to{transform:none}}\n\n/* ---------- подсказка о выбранном переходе ---------- */\n.fx-toast{position:absolute;left:50%;top:22px;z-index:8;transform:translate(-50%,-8px);opacity:0;pointer-events:none;\n  padding:9px 16px;border-radius:999px;background:var(--ink);color:#fff;font-size:14px;white-space:nowrap;\n  transition:opacity .2s,transform .2s}\n.fx-toast.on{opacity:1;transform:translate(-50%,0)}\n.fx-toast span{color:var(--peach)}\nhtml.export .fx-toast{display:none}\n'

export function attachDeckEffects({ stage: deck, buddy, show, keyboard = false }) {
  if (!deck || !buddy?.experimental || typeof show !== 'function') throw new TypeError('Нужны stage, buddy и show(index)')
  if (deck.hasAttribute('data-buddy-effects')) throw new Error('Эффекты уже подключены')
  const html = deck, window = { __buddy: buddy.experimental, go: show },
    nodes = new Set(), timers = new Set(), intervals = new Set(), framesPending = new Set(), cleanups = [],
    previousAnimations = new Set(deck.getAnimations({ subtree: true })),
    localStorage = { getItem: () => null, setItem: () => {} }
  let dead = false
  const setTimeout = (fn, ms) => { const id = globalThis.setTimeout(() => { timers.delete(id); if (!dead) fn() }, ms); timers.add(id); return id },
    clearTimeout = id => { globalThis.clearTimeout(id); timers.delete(id) },
    setInterval = (fn, ms) => { const id = globalThis.setInterval(() => { if (!dead) fn() }, ms); intervals.add(id); return id },
    clearInterval = id => { globalThis.clearInterval(id); intervals.delete(id) },
    requestAnimationFrame = fn => { const id = globalThis.requestAnimationFrame(t => { framesPending.delete(id); if (!dead) fn(t) }); framesPending.add(id); return id },
    addEventListener = (type, fn, options) => { if (!keyboard) return; globalThis.addEventListener(type, fn, options); cleanups.push(() => globalThis.removeEventListener(type, fn, options)) }
  deck.setAttribute('data-buddy-effects', '')
  const style = document.createElement('style')
  style.textContent = EFFECTS_CSS
  deck.append(style)
  const slides = [].slice.call(deck.querySelectorAll(':scope > .slide'));
  const reduced = () => buddy.reducedMotion;
  const EXPORT = /[?&]export=1/.test(location.search);
  const W = 1280, H = 720, PI = Math.PI;

  const MODES = ['none', 'push', 'clean', 'iris'];
  const NAMES = { none: 'без перехода', push: 'колода', clean: 'склейка + хореография', iris: 'диафрагма от человечка' };
  let mode = MODES.includes(localStorage.getItem('fx-mode3')) ? localStorage.getItem('fx-mode3') : 'none';
  html.dataset.fx = mode;
  const EASE = 'cubic-bezier(.16,1,.3,1)';
  // основной вариант: вылет из пробоины вверх и приземление на строку заголовка следующего слайда
  const JUMPS = ['line', 'leap', 'flip'], JNAMES = { line: 'вылет на заголовок', leap: 'прыжок на зрителя', flip: 'на зрителя и сальто назад' };
  let jump = JUMPS.includes(localStorage.getItem('fx-jump2')) ? localStorage.getItem('fx-jump2') : 'line';

  const el = (cls, parent, tag) => { const e = document.createElement(tag || 'div'); e.className = cls; (parent || deck).appendChild(e); nodes.add(e); return e; };
  const discard = node => {
    const subtree = [];
    for (const owned of nodes) {
      let ancestor = owned;
      while (ancestor && ancestor !== node) ancestor = ancestor.parentNode;
      if (ancestor === node) subtree.push(owned);
    }
    for (const owned of subtree) {
      if (owned.tagName?.toLowerCase() === 'canvas') owned.width = owned.height = 0;
      nodes.delete(owned); owned.remove();
    }
    node.remove();
  };
  const rr = (a, b) => a + (b - a) * Math.random();
  // кадры: rAF, а если вкладка его не крутит (превью в фоне) — таймер
  function frames(fn) {
    let last = performance.now(), dead = false;
    const go = () => { if (dead) return; const now = performance.now(), dt = Math.min(.05, (now - last) / 1000); last = now;
      if (fn(dt) === false) { dead = true; return; } sched(); };
    const sched = () => { let done = false; const f = () => { if (!done) { done = true; go(); } }; requestAnimationFrame(f); setTimeout(f, 34); };
    sched();
  }

  // ---------- подсказка ----------
  const toast = el('fx-toast');
  function say(t) { toast.innerHTML = t; toast.classList.add('on'); clearTimeout(say.tm); say.tm = setTimeout(() => toast.classList.remove('on'), 1800); }

  // ---------- искры на canvas ----------
  const cv = el('fx-canvas', deck, 'canvas'); cv.width = W * 2; cv.height = H * 2;
  const cx = cv.getContext('2d'); cx.scale(2, 2);
  let parts = [], spinning = false;
  function burst(x, y, n, o) {
    o = o || {};
    for (let k = 0; k < n; k++) {
      const a = rr(0, Math.PI * 2), v = rr(o.v0 || 120, o.v1 || 720);
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - rr(0, 160), life: rr(.5, 1.2), t: 0, r: rr(1.5, 4.5),
        c: o.cols ? o.cols[k % o.cols.length] : (k % 3 ? '#1340E0' : '#C6F432'), sq: Math.random() < .35 });
    }
    if (!spinning) { spinning = true; frames(stepParts); }
  }
  function stepParts(dt) {
    cx.clearRect(0, 0, W, H);
    parts = parts.filter(p => (p.t += dt) < p.life);
    for (const p of parts) {
      p.vy += 900 * dt; p.vx *= Math.exp(-1.6 * dt); p.vy *= Math.exp(-.6 * dt);
      p.x += p.vx * dt; p.y += p.vy * dt;
      const k = 1 - p.t / p.life; cx.globalAlpha = Math.min(1, k * 1.6); cx.fillStyle = p.c;
      if (p.sq) { cx.save(); cx.translate(p.x, p.y); cx.rotate(p.t * 9); cx.fillRect(-p.r, -p.r * .5, p.r * 2, p.r); cx.restore(); }
      else { cx.beginPath(); cx.arc(p.x, p.y, p.r * k + .4, 0, Math.PI * 2); cx.fill(); }
    }
    cx.globalAlpha = 1;
    if (!parts.length) { spinning = false; return false; }
  }

  // ---------- разлом: одна «паутина» задаёт и трещины, и осколки ----------
  // лучи от точки удара + кольца-перемычки; часть перемычек не лопается — осколок длиннее.
  // Каждая линия — ломаная с мелкой дрожью: по этим же точкам режутся осколки, так что край осколка совпадает с трещиной.
  const RADII = [0, 12, 30, 62, 112, 190, 310, 490, 760, 1150, 1700];
  function jag(a, b, amp) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, n = Math.max(1, Math.round(L / 5));
    const nx = -dy / L, ny = dx / L, f1 = rr(0, 6.3), f2 = rr(0, 6.3), k1 = rr(1, 2.2), k2 = rr(5, 9), pts = [a];
    for (let i = 1; i < n; i++) {
      const t = i / n, o = Math.sin(PI * t) * amp * (Math.sin(f1 + t * k1 * PI) * .75 + Math.sin(f2 + t * k2 * PI) * .25) + rr(-.3, .3);
      pts.push([a[0] + dx * t + nx * o, a[1] + dy * t + ny * o]);
    }
    pts.push(b); return pts;
  }
  // перемычка идёт по дуге вокруг точки удара, слегка выгнута наружу и неровная
  function arc(a, b, ox, oy) {
    const ta = Math.atan2(a[1] - oy, a[0] - ox), ra = Math.hypot(a[0] - ox, a[1] - oy), rb = Math.hypot(b[0] - ox, b[1] - oy);
    let dt = Math.atan2(b[1] - oy, b[0] - ox) - ta; while (dt > PI) dt -= 2 * PI; while (dt < -PI) dt += 2 * PI;
    const n = Math.max(2, Math.round(Math.abs(dt) * (ra + rb) / 2 / 5)), bulge = (ra + rb) / 2 * rr(.01, .07), f = rr(0, 6.3), pts = [a];
    for (let i = 1; i < n; i++) {
      const t = i / n, r = ra + (rb - ra) * t + Math.sin(PI * t) * bulge + Math.sin(f + t * 7) * Math.min(2.2, ra * .02) + rr(-.3, .3), q = ta + dt * t;
      pts.push([ox + Math.cos(q) * r, oy + Math.sin(q) * r]);
    }
    pts.push(b); return pts;
  }
  function fracture(ox, oy) {
    const n = 14, a0 = rr(0, 2 * PI), NR = RADII.length, C = [ox, oy];
    const ang = []; for (let k = 0; k < n; k++) ang.push(a0 + (k + rr(-.32, .32)) * 2 * PI / n);
    const P = ang.map(a => RADII.map((R, r) => {
      if (!r) return C;
      const b = a + rr(-.05, .05) * (r < 4 ? 2.5 : 1), q = R * rr(.84, 1.16);
      return [ox + Math.cos(b) * q, oy + Math.sin(b) * q];
    }));
    const ray = P.map(row => row.slice(0, -1).map((p, r) => jag(p, row[r + 1], Math.min(4, (RADII[r + 1] - RADII[r]) * .025))));
    const br = [], open = [];
    for (let k = 0; k < n; k++) {
      br.push([null]); open.push([false]);
      for (let r = 1; r < NR; r++) {
        br[k].push(arc(P[k][r], P[(k + 1) % n][r], ox, oy));
        open[k].push(r >= 2 && r < NR - 1 && Math.random() < (r < 4 ? .12 : .4));
      }
    }
    const cells = [], tail = a => a.slice(1), back = a => a.slice().reverse().slice(1);
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      for (let r = 0; r < NR - 1;) {
        let s = r + 1; while (s < NR - 1 && open[k][s]) s++;
        const poly = r ? br[k][r].slice() : [C];
        for (let q = r; q < s; q++) poly.push(...tail(ray[k2][q]));
        poly.push(...back(br[k][s]));
        for (let q = s - 1; q >= r; q--) poly.push(...back(ray[k][q]));
        poly.pop();
        const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
        if (Math.max(...xs) > -20 && Math.min(...xs) < W + 20 && Math.max(...ys) > -20 && Math.min(...ys) < H + 20)
          cells.push({ poly, R: RADII[r] });
        r = s;
      }
    }
    // рёбра для рисования; w(d) — толщина в точке на расстоянии d от удара, у кончика ветки сходит на нет
    const edges = [], seg = (pts, kind, w) => edges.push({ pts, kind, w, k: rr(.8, 1.2) });
    const wRay = d => .45 + 1.5 * Math.exp(-d / 160), wBr = d => .4 + .9 * Math.exp(-d / 190);
    for (let k = 0; k < n; k++) {
      for (let r = 0; r < NR - 1; r++) seg(ray[k][r], 'ray', wRay);
      for (let r = 1; r < NR - 1; r++) if (!open[k][r]) seg(br[k][r], 'br', wBr);
      for (let r = 2; r < 7; r++) if (Math.random() < .4) {   // отростки: короткие, сходят на нет
        let a = ang[k] + (Math.random() < .5 ? 1 : -1) * rr(.3, .7), [x, y] = P[k][r]; const L = RADII[r] * rr(.2, .45), pts = [[x, y]];
        for (let q = 0; q < 3; q++) { a += rr(-.25, .25); x += Math.cos(a) * L / 3; y += Math.sin(a) * L / 3; pts.push([x, y]); }
        const j = []; for (let q = 0; q < 3; q++) j.push(...(q ? tail : v => v)(jag(pts[q], pts[q + 1], L * .02)));
        seg(j, 'tip', wBr);
      }
    }
    return { cells, edges, ox, oy };
  }

  // ---------- рисунок трещин: заранее, в два холста (лучи и перемычки), потом проявляется волной от удара ----------
  // Трещина — не линия, а лента переменной толщины: тёмная сердцевина, рядом светлый блик скола,
  // вокруг — едва заметная полоса грани. Блик виден на тексте, сердцевина — на бумаге, как у настоящего стекла.
  const LIGHT = -2.3;   // свет сверху слева
  function ribbon(ctx, pts, ws, off) {
    const L = [], R = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      const nx = -dy / l, ny = dx / l, h = ws[i] / 2, o = off || 0;
      L.push([pts[i][0] + nx * (o + h), pts[i][1] + ny * (o + h)]); R.push([pts[i][0] + nx * (o - h), pts[i][1] + ny * (o - h)]);
    }
    ctx.moveTo(L[0][0], L[0][1]); for (const p of L) ctx.lineTo(p[0], p[1]);
    for (let i = R.length - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
    ctx.closePath();
  }
  function paintCracks(F, cvs, dpr) {
    const { ox, oy } = F, [cR, cB] = cvs.map(c => { const x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); return x; });
    // зона смятия: молочная крошка, конус Герца, волосяные трещинки, сколы-чешуйки
    const g = cR.createRadialGradient(ox, oy, 0, ox, oy, 30);
    g.addColorStop(0, 'rgba(255,255,255,.75)'); g.addColorStop(.3, 'rgba(240,242,244,.45)'); g.addColorStop(1, 'rgba(240,242,244,0)');
    cR.fillStyle = g; cR.beginPath(); cR.arc(ox, oy, 30, 0, 2 * PI); cR.fill();
    for (let q = 0; q < 6; q++) {
      const a = rr(0, 2 * PI), r = rr(3, 13), s = rr(2, 5), pts = [];
      for (let v = 0; v < 5; v++) { const b = a + v / 5 * 2 * PI; pts.push([ox + Math.cos(a) * r + Math.cos(b) * s * rr(.5, 1), oy + Math.sin(a) * r + Math.sin(b) * s * rr(.5, 1)]); }
      cR.beginPath(); pts.forEach((p, i) => i ? cR.lineTo(p[0], p[1]) : cR.moveTo(p[0], p[1])); cR.closePath();
      cR.fillStyle = 'rgba(255,255,255,.7)'; cR.fill(); cR.lineWidth = .35; cR.strokeStyle = 'rgba(40,36,33,.45)'; cR.stroke();
    }
    const hair = [];
    for (let q = 0; q < 70; q++) {
      let a = rr(0, 2 * PI), r = rr(1, 16); const L = rr(3, 20), pts = [[ox + Math.cos(a) * r, oy + Math.sin(a) * r]];
      for (let v = 1; v <= 4; v++) { a += rr(-.18, .18); r += L / 4; pts.push([ox + Math.cos(a) * r, oy + Math.sin(a) * r]); }
      hair.push({ pts, kind: 'hair', w: () => .45, k: rr(.6, 1) });
    }
    const cone = []; const cr = rr(7, 10); for (let v = 0; v <= 40; v++) { const b = v / 40 * 2 * PI, r = cr + rr(-.6, .6); cone.push([ox + Math.cos(b) * r, oy + Math.sin(b) * r]); }
    hair.push({ pts: cone, kind: 'cone', w: () => .55, k: 1 });
    for (let v = 0; v < 40; v++) { const a = rr(0, 2 * PI), r = rr(0, 18); cR.fillStyle = `rgba(60,55,50,${rr(.15, .45).toFixed(2)})`; cR.beginPath(); cR.arc(ox + Math.cos(a) * r, oy + Math.sin(a) * r, rr(.25, .7), 0, 2 * PI); cR.fill(); }
    // ленты: три прохода, чтобы блики легли поверх всех сердцевин
    const all = F.edges.concat(hair);
    const prep = all.map(e => {
      const n = e.pts.length, d0 = Math.hypot(e.pts[0][0] - ox, e.pts[0][1] - oy);
      const ws = e.pts.map((p, i) => {
        const t = i / Math.max(1, n - 1), d = Math.hypot(p[0] - ox, p[1] - oy);
        let w = e.w(d) * e.k * (.85 + .3 * Math.sin(i * 1.7 + d0));
        if (e.kind === 'tip' || e.kind === 'hair') w *= Math.pow(1 - t, .7);
        return Math.max(0, w);
      });
      const a = Math.atan2(e.pts[n - 1][1] - e.pts[0][1], e.pts[n - 1][0] - e.pts[0][0]), lit = Math.abs(Math.sin(a - LIGHT));
      return { e, ws, lit, ctx: e.kind === 'br' ? cB : cR };
    });
    for (const q of prep) { q.ctx.beginPath(); ribbon(q.ctx, q.e.pts, q.ws.map(w => w * 3.2 + .8), 0); q.ctx.fillStyle = 'rgba(120,128,136,.07)'; q.ctx.fill(); }
    for (const q of prep) { q.ctx.beginPath(); ribbon(q.ctx, q.e.pts, q.ws, 0); q.ctx.fillStyle = `rgba(36,33,31,${(.42 + .4 * q.lit).toFixed(2)})`; q.ctx.fill(); }
    for (const q of prep) { q.ctx.beginPath(); ribbon(q.ctx, q.e.pts, q.ws.map(w => w * .5), Math.max(.55, q.ws[0] * .6)); q.ctx.fillStyle = `rgba(255,255,255,${(.35 + .55 * (1 - q.lit)).toFixed(2)})`; q.ctx.fill(); }
  }

  // ---------- стекло: обложка заранее разрезана на осколки ----------
  // Всё тяжёлое — при загрузке, пока обложка на экране: копии обложки, слои, траектории.
  // Осколок — блок размером со свой кусок, а не весь экран: слои маленькие, видеопамяти мало.
  // Траектории просчитаны заранее и отданы браузеру как анимация transform/opacity — она идёт на композиторе
  // и не зависит от главного потока, где живёт человечек.
  const SETTLE = 90, BOOM_AT = 560, ZMAX = 480, STEP = 1000 / 40;
  const simTime = tau => tau < 80 ? tau : tau < 620 ? 80 + (tau - 80) * .28 : 80 + 540 * .28 + (tau - 620);   // рапид, мс
  let G = null;
  function dropGlass() {
    if (!G) return;
    G.anims.forEach(a => a.cancel()); discard(G.layer); discard(G.cv); G.off.forEach(c => c.width = c.height = 0); clearTimeout(G.tm1); G = null;
    html.classList.remove('fx-armed');
  }
  function buildGlass() {
    dropGlass(); const tb = performance.now();
    const cover = slides[0], [x, y] = impactPoint(cover), F0 = fracture(x, y);
    const layer = el('fx-shards'); layer.style.perspectiveOrigin = `${x.toFixed(0)}px ${y.toFixed(0)}px`;
    const anims = [], dur = 1600, g = 1000;
    let simEnd = 0;
    const S = F0.cells.map(c => {
      const xs = c.poly.map(p => p[0]), ys = c.poly.map(p => p[1]);
      const bx = Math.floor(Math.max(-30, Math.min(...xs))), by = Math.floor(Math.max(-30, Math.min(...ys)));
      const bw = Math.ceil(Math.min(W + 30, Math.max(...xs))) - bx, bh = Math.ceil(Math.min(H + 30, Math.max(...ys))) - by;
      if (bw < 2 || bh < 2) return null;
      const s = el('fx-shard', layer);
      s.style.cssText = `left:${bx}px;top:${by}px;width:${bw}px;height:${bh}px;clip-path:polygon(${c.poly.map(p => (p[0] - bx).toFixed(1) + 'px ' + (p[1] - by).toFixed(1) + 'px').join(',')})`;
      const cl = cover.cloneNode(true); cl.classList.add('fx-clone'); cl.removeAttribute('id'); cl.setAttribute('aria-hidden', 'true');
      cl.style.left = -bx + 'px'; cl.style.top = -by + 'px'; s.appendChild(cl);
      const sh = bw * bh < 120000 ? el('fx-shade', s) : null;   // тень поворота — только мелким: крупные далеко и почти не кувыркаются
      const mx = xs.reduce((a, v) => a + v, 0) / xs.length, my = ys.reduce((a, v) => a + v, 0) / ys.length;
      s.style.transformOrigin = `${(mx - bx).toFixed(1)}px ${(my - by).toFixed(1)}px`;
      const dx = mx - x, dy = my - y, d = Math.max(20, Math.hypot(dx, dy)), ux = dx / d, uy = dy / d;
      // проседание стекла после второго удара: у центра сильнее
      const give = rr(.6, 2.6) * Math.max(0, 1 - d / 700), sx = ux * give, sy = uy * give, sr = rr(-.5, .5) * Math.max(.2, 1 - d / 500);
      const k = 1.1 * rr(.75, 1.25) * (1 - Math.min(.7, d / 1100));
      const vx = ux * 1000 * k, vy = uy * 800 * k - rr(60, 220), vz = rr(250, 1400) * (1 - Math.min(.5, d / 1600));
      const vr = rr(-520, 520), vrx = rr(-420, 420), vry = rr(-420, 420), delay = d / 3200 * 1000, b = rr(-.015, .012);
      const T = (tx, ty, tz, a, bb, cc) => `translate3d(${tx.toFixed(1)}px,${ty.toFixed(1)}px,${tz.toFixed(1)}px) rotateX(${a.toFixed(1)}deg) rotateY(${bb.toFixed(1)}deg) rotate(${cc.toFixed(2)}deg)`;
      const kf = [{ offset: 0, transform: T(0, 0, 0, 0, 0, 0), opacity: 1, easing: 'cubic-bezier(.2,.9,.3,1)' }];
      const shade = [{ offset: 0, opacity: 0 }];
      // реальное время взрыва: пока осколок не погас
      const real = [];
      for (let tau = 0; ; tau += STEP) {
        const tt = Math.max(0, simTime(tau) - delay) / 1000;
        const op = Math.max(0, 1 - Math.max(0, tt - dur / 1000 * .45) / (dur / 1000 * .55));
        real.push([tau, tt, op]); if (op <= 0) break;
      }
      const total = BOOM_AT + real[real.length - 1][0];
      simEnd = Math.max(simEnd, total);
      kf.push({ offset: SETTLE / total, transform: T(sx, sy, 0, 0, 0, sr), opacity: 1 });
      shade.push({ offset: SETTLE / total, opacity: Math.max(0, -b) * .35 });
      for (const [tau, tt, op] of real) {
        const off = (BOOM_AT + tau) / total;
        const rx = vrx * tt, ry = vry * tt, z = ZMAX * (1 - Math.exp(-vz * tt / ZMAX));   // глубина с потолком: осколок не проходит сквозь камеру
        kf.push({ offset: Math.min(1, off), transform: T(sx + vx * tt, sy + vy * tt + .5 * g * tt * tt, z, rx, ry, sr + vr * tt), opacity: +op.toFixed(3) });
        shade.push({ offset: Math.min(1, off), opacity: +((1 - Math.abs(Math.cos(rx * PI / 180) * Math.cos(ry * PI / 180))) * .22 + Math.max(0, -b) * .35).toFixed(3) });
      }
      const a1 = s.animate(kf, { duration: total, fill: 'forwards' }); a1.pause(); anims.push(a1);
      if (sh) { const a2 = sh.animate(shade, { duration: total, fill: 'forwards' }); a2.pause(); anims.push(a2); }
      return s;
    }).filter(Boolean);
    // трещины — один canvas в разрешении экрана, а не сотни SVG-линий
    const cv = el('fx-crackcv', deck, 'canvas'), dpr = Math.min(3, (devicePixelRatio || 1) * stageScale()) || 1;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const off = [0, 1].map(() => { const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height; return c; });
    paintCracks(F0, off, dpr);
    G = { x, y, layer, S, anims, cv, ctx: cv.getContext('2d'), dpr, off, shown: [0, 0], dur: simEnd, buildMs: Math.round(performance.now() - tb) };
    html.classList.add('fx-armed');
  }
  // трещины проявляются кольцом от точки удара: за кадр докладываем только новое кольцо из готового рисунка
  function revealTo(i, R) {
    const { ctx, dpr, off, x, y, shown } = G;
    if (R <= shown[i]) return;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.beginPath();
    ctx.arc(x * dpr, y * dpr, R * dpr, 0, 2 * PI); if (shown[i] > 0) ctx.arc(x * dpr, y * dpr, shown[i] * dpr, 0, 2 * PI, true);
    ctx.clip(); ctx.drawImage(off[i], 0, 0); ctx.restore();
    shown[i] = R;
  }
  // Звезда — от первого удара; волна — от фактического второго, на часах WAAPI.
  // Ограниченный dt частиц здесь терял длинные кадры и оставлял трещины позади осколков.
  function growCracks(r1, d1, v, lag) {
    const g0 = G, far = 1500, startedAt = performance.now();
    frames(() => {
      if (G !== g0) return false;
      const now = performance.now(), t = now - startedAt,
        wave = g0.secondImpactAt == null ? null : Math.max(0, now - g0.secondImpactAt);
      const e = u => 1 - Math.pow(1 - Math.min(1, u), 3);
      const ray = wave == null ? r1 * e(t / d1) : Math.min(far, r1 + wave * v / 1000);
      const bri = wave == null ? r1 * .8 * e((t - 50) / d1) : Math.min(far, r1 * .8 + Math.max(0, wave - lag) * v / 1000);
      revealTo(0, ray); revealTo(1, Math.max(0, bri));
      if (ray >= far && bri >= far) return false;
    });
  }

  // ---------- где стоит человечек ----------
  function buddyAt() {
    const b = window.__buddy && window.__buddy.B;
    return b ? [b.x, b.y - 14] : [W / 2, H - 60];
  }
  // сцена масштабирована; переводим клик/рамку в координаты 1280×720
  function stageScale() { return deck.getBoundingClientRect().width / W; }

  // ================== переходы ==================
  let job = null;   // текущий переход: {commit, done, kill}
  function finishJob() { if (job) { const j = job; job = null; j.commit(); j.kill && j.kill(); } }
  function stopMotion() {
    armed = false; finishJob(); dropGlass();
    html.classList.remove('fx-intro', 'fx-armed');
    for (const id of timers) globalThis.clearTimeout(id);
    for (const id of intervals) globalThis.clearInterval(id);
    for (const id of framesPending) globalThis.cancelAnimationFrame(id);
    timers.clear(); intervals.clear(); framesPending.clear();
    for (const animation of deck.getAnimations({ subtree: true })) if (!previousAnimations.has(animation)) animation.cancel();
    for (const node of nodes) if (node !== cv && node !== toast) discard(node);
    parts = []; spinning = false; cx.clearRect(0, 0, W, H);
    const host = deck.querySelector('.buddy'); if (host) host.style.zIndex = '4';
  }

  window.__fxGo = function (n, i, commit) {
    if (reduced() || EXPORT) { stopMotion(); commit(); return; }
    if (armed && i === 0 && n > 0) { armed = false; introBoom(n, commit); return; }
    if (armed && n !== 0) { armed = false; dropGlass(); html.classList.remove('fx-intro'); }
    const fwd = n > i;
    const go = () => { commit(); if (fwd && mode === 'clean') choreograph(slides[n]); };
    if (job) { finishJob(); go(); return; }   // листают быстрее, чем идёт переход: сразу
    if (mode === 'none' || mode === 'clean' || !fwd && mode !== 'push') { go(); return; }
    let done = false;
    const j = job = { commit() { if (!done) { done = true; go(); } }, kill: null };
    const end = () => { if (job === j) job = null; };
    ({ iris, push })[mode](j, fwd ? 1 : -1, end);
  };

  // ================== хореография слайда ==================
  // заголовок поднимается из-под маски, блоки — лесенкой. translate, а не transform: свои повороты блоков не ломаются
  function reveal(e, d) {
    e.animate([{ clipPath: 'inset(-15% -3% 100% -3%)', translate: '0 .45em' }, { clipPath: 'inset(-15% -3% -30% -3%)', translate: '0 0' }],
      { duration: 820, delay: d, easing: EASE, fill: 'backwards' });
  }
  function rise(e, d, y) {
    e.animate([{ opacity: 0, translate: `0 ${y || 18}px`, filter: 'blur(3px)' }, { opacity: 1, translate: '0 0', filter: 'blur(0)' }],
      { duration: 700, delay: d, easing: EASE, fill: 'backwards' });
  }
  function choreograph(s) {
    if (reduced() || EXPORT || !s) return;
    const q = c => s.querySelector(c);
    if (s.classList.contains('divider')) {
      q('.dv-num') && rise(q('.dv-num'), 0, 10);
      q('.dv-title') && reveal(q('.dv-title'), 60);
      q('.dv-sub') && rise(q('.dv-sub'), 260);
      q('.dv-nav') && rise(q('.dv-nav'), 360, 8);
      return;
    }
    const h = q('.slide-head h2') || q('h1');
    if (h) reveal(h, 0);
    if (q('.lede')) rise(q('.lede'), 140);
    let base = q('.body'); if (!base) return;
    while (base.children.length === 1 && base.firstElementChild.children.length) base = base.firstElementChild;
    [...base.children].forEach((e, k) => rise(e, 200 + Math.min(k, 7) * 60));
  }

  // View Transitions: новый слайд раскрывается кругом из человечка / въезжает колодой
  function vt(kind, j, dir, end) {
    if (!document.startViewTransition) { j.commit(); end(); return; }
    const [x, y] = buddyAt();
    html.style.setProperty('--fx-ox', x.toFixed(0) + 'px'); html.style.setProperty('--fx-oy', y.toFixed(0) + 'px');
    html.dataset.vt = kind; html.dataset.dir = dir > 0 ? 'fwd' : 'back';
    const t = document.startViewTransition(() => j.commit());
    j.kill = () => { try { t.skipTransition(); } catch (e) {} };
    const fin = () => { clearTimeout(guard); delete html.dataset.vt; delete html.dataset.dir; end(); };
    // страховка: если браузер не дорисует переход (фоновая вкладка, слабая машина), не держим листалку
    const guard = setTimeout(() => { j.kill(); fin(); }, 1400);
    t.finished.finally(fin);
  }
  // диафрагма: в старом слайде открывается круглая дыра из человечка, по кромке — кольцо пламени
  function iris(j, dir, end) {
    const cur = slides.find(s => s.classList.contains('on')), [x, y] = buddyAt();
    const ov = el('fx-iris'), c = cur.cloneNode(true); c.classList.add('fx-clone'); c.removeAttribute('id'); ov.appendChild(c);
    const ring = el('fx-iris-ring'); ring.style.left = x + 'px'; ring.style.top = y + 'px';
    j.commit();
    j.kill = () => { discard(ov); discard(ring); };
    const far = Math.max(Math.hypot(x, y), Math.hypot(W - x, y), Math.hypot(x, H - y), Math.hypot(W - x, H - y)) + 20;
    let t = 0; const D = .85;
    frames(dt => {
      t += dt; const u = Math.min(1, t / D), e = u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2, R = e * far;
      ov.style.webkitMaskImage = ov.style.maskImage = `radial-gradient(circle at ${x}px ${y}px, transparent ${R.toFixed(1)}px, #000 ${(R + 1).toFixed(1)}px)`;
      ring.style.width = ring.style.height = (2 * R).toFixed(1) + 'px'; ring.style.borderWidth = (14 * (1 - u) + 3).toFixed(1) + 'px';
      if (u >= 1) { j.kill(); end(); return false; }
    });
  }
  function push(j, dir, end) { vt('push', j, dir, end); }
  // ================== интро: разбить обложку ==================
  let armed = false;
  function startIntro() {
    if (reduced() || EXPORT) return;
    finishJob();
    if (window.go) { const raw = window.__fxGo; window.__fxGo = null; window.go(0); window.__fxGo = raw; }
    armed = true; html.classList.add('fx-intro');
    // стекло режем, когда шрифты уже на месте: иначе копии обложки разойдутся с оригиналом
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => { if (armed) requestAnimationFrame(() => armed && stageScale() > 0 && buildGlass()); });   // скрытая сцена — соберём при ударе
  }
  function shake(nodes, amp, dur) {
    const k = [];
    for (let s = 0; s <= 8; s++) { const f = 1 - s / 8; k.push({ translate: `${(rr(-amp, amp) * f).toFixed(1)}px ${(rr(-amp, amp) * f).toFixed(1)}px` }); }
    nodes.forEach(n => n && n.animate(k, { duration: dur, easing: 'linear' }));
  }
  // точка удара — в заголовке, чуть правее середины строки
  function impactPoint(cover) {
    const h = cover.querySelector('h1'), k = stageScale(), d = deck.getBoundingClientRect();
    if (!h || !(k > 0)) return [W * .5, H * .45];   // сцена ещё без размеров (скрытая вкладка) — масштаб 0
    const r = h.getBoundingClientRect();
    return [Math.min(W - 200, (r.left - d.left) / k + r.width / k * .55), (r.top - d.top) / k + r.height / k * .55];
  }
  // опора на заголовке следующего слайда: верх строчных букв первой строки, в координатах сцены.
  // Высокие знаки (заглавные, б, й, ф…) по ходу пути исключены — человечек ходит по строчным и останавливается у высоких.
  function headLine(slide) {
    const h = slide.querySelector('.dv-title, .slide-head h2, h1, h2');
    const k = stageScale(), d = deck.getBoundingClientRect();
    if (!h || !h.textContent.trim() || !(k > 0)) return null;
    const tf = getComputedStyle(slide).transform, dy = tf && tf !== 'none' ? new DOMMatrix(tf).m42 : 0;   // въезд слайда (translateY 9px) ещё идёт
    const cs = getComputedStyle(h), c2 = document.createElement('canvas').getContext('2d');
    c2.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const mx = c2.measureText('x'), xh = mx.actualBoundingBoxAscent, fa = mx.fontBoundingBoxAscent, fd = mx.fontBoundingBoxDescent;
    // знаки первой строки с их рамками
    const chars = [], tw = document.createTreeWalker(h, NodeFilter.SHOW_TEXT), rg = document.createRange();
    let top0 = null;
    for (let t; (t = tw.nextNode());) for (let q = 0; q < t.length; q++) {
      const ch = t.data[q]; if (!ch.trim()) continue;
      rg.setStart(t, q); rg.setEnd(t, q + 1); const r = rg.getBoundingClientRect(); if (r.width < 1) continue;
      if (top0 == null) top0 = r.top; if (Math.abs(r.top - top0) > 4) break;
      chars.push({ x1: (r.left - d.left) / k, x2: (r.right - d.left) / k, tall: c2.measureText(ch).actualBoundingBoxAscent > xh * 1.12, lh: r.height / k });
    }
    if (!chars.length) return null;
    const base = (top0 - d.top) / k - dy + (chars[0].lh - (fa + fd)) / 2 + fa;
    const y = base - xh + 1;
    const spans = [];
    for (const c of chars) {
      if (c.tall) continue;
      const L = spans[spans.length - 1];
      if (L && c.x1 - L[1] < 3) L[1] = c.x2; else spans.push([c.x1, c.x2]);
    }
    const sp = spans.map(([a, b]) => [a + 7, b - 7]).filter(([a, b]) => b - a > 18);
    if (!sp.length) return null;
    const x1 = chars[0].x1, x2 = chars[chars.length - 1].x2;
    return { kind: 'plat', y, x1, x2, rad: 0, spans: sp, box: { x1, x2, y1: y, y2: base }, text: true };
  }
  // площадка — верх блока с [data-buddy-land]: человечек падает на него сверху и машет
  function landPlat(slide) {
    const b = slide.querySelector('[data-buddy-land]'), k = stageScale(), d = deck.getBoundingClientRect();
    if (!b || !(k > 0)) return null;
    const tf = getComputedStyle(slide).transform, dy = tf && tf !== 'none' ? new DOMMatrix(tf).m42 : 0;
    const r = b.getBoundingClientRect(), x1 = (r.left - d.left) / k, x2 = (r.right - d.left) / k, y = (r.top - d.top) / k - dy;
    return { kind: 'plat', y, x1, x2, rad: 0, spans: [[x1 + 30, x2 - 30]], box: { x1, x2, y1: y, y2: y + r.height / k } };
  }
  function introBoom(n, commit) {
    if (!G) buildGlass();
    const g0 = G, { x, y } = g0;
    let done = false;
    job = { commit() { if (done) return; done = true; dropGlass(); commit(); html.classList.remove('fx-intro'); job = null; }, kill: null };
    // удар 1: смятие в точке и короткая звезда
    g0.secondImpactAt = null;
    growCracks(70, 110, 3200, 70);
    shake([g0.layer, g0.cv], 2.5, 200);
    burst(x, y, 10, { v0: 30, v1: 150, cols: ['#fff', '#E3DDD6', '#B9B0A8'] });
    // удар 2: трещины бегут до краёв, стекло проседает; дальше всё по таймлайну анимаций осколков
    g0.tm1 = setTimeout(() => {
      if (G !== g0) return;
      g0.secondImpactAt = performance.now();
      g0.anims.forEach(a => a.play());
      shake([g0.layer, g0.cv], 5, 260);
      burst(x, y, 16, { v0: 40, v1: 220, cols: ['#fff', '#E3DDD6', '#B9B0A8'] });
      // удар 3 — на том же таймлайне, что и осколки, чтобы взрыв и разлёт не разъехались
      const clock = g0.layer.animate([{ opacity: 1 }, { opacity: 1 }], { duration: BOOM_AT });
      clock.onfinish = () => { if (G !== g0 || done) return; done = true; job = null; boom(n, commit, g0); };
    }, 420);
  }
  function boom(n, commit, g0) {
    const { x, y } = g0;
    g0.cv.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 90, fill: 'forwards' });
    commit();
    html.classList.remove('fx-intro', 'fx-armed');
    // убираем в два шага: сразу прячем (дёшево), а сотню узлов и холсты выбрасываем, когда браузер свободен
    setTimeout(() => {
      if (G !== g0) return; G = null;
      g0.layer.style.display = 'none'; g0.cv.style.display = 'none';
      (window.requestIdleCallback || setTimeout)(() => { discard(g0.layer); discard(g0.cv); g0.off.forEach(c => c.width = c.height = 0); });
    }, g0.dur - BOOM_AT + 100);
    // под обложкой — первый раздел: «камера» отъезжает из лёгкого расфокуса
    const next = slides[n], land = landPlat(next), line = land || (jump === 'line' ? headLine(next) : null);   // мерим до «камеры»: её масштаб сдвинул бы рамки
    next.animate(jump === 'line' ? [{ scale: '1.06', opacity: .4 }, { scale: '1', opacity: 1, easing: EASE }]
      : [{ scale: '1.1', opacity: .35, easing: 'ease-out' }, { scale: '1.1', opacity: .8, offset: .4, easing: 'cubic-bezier(.3,0,.15,1)' }, { scale: '1', opacity: 1 }],
      { duration: jump === 'line' ? 1200 : 1400 });
    if (mode === 'clean') setTimeout(() => choreograph(next), 380);
    const fl = el('fx-flash'); fl.style.setProperty('--x', x + 'px'); fl.style.setProperty('--y', y + 'px');
    fl.animate([{ opacity: 0 }, { opacity: .75, offset: .08 }, { opacity: 0 }], { duration: 560, easing: 'ease-out' }).onfinish = () => discard(fl);
    const ring = el('fx-ring'); ring.style.left = x + 'px'; ring.style.top = y + 'px';
    ring.animate([{ transform: 'translate(-50%,-50%) scale(.02)', opacity: .9 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 0 }],
      { duration: 1000, easing: 'cubic-bezier(.1,.6,.3,1)', fill: 'forwards' }).onfinish = () => discard(ring);
    burst(x, y, 60, { v0: 120, v1: 640, cols: ['#1340E0', '#C6F432', '#5577F0'] });
    burst(x, y, 80, { v0: 60, v1: 460, cols: ['#FFFFFF', '#E9E2DA', '#C4BAB1'] });
    // человечек вылетает из пробоины: по умолчанию — прыжок на зрителя (J — другие варианты)
    // смена слайда будит самого человечка (его наблюдатель в микрозадаче сбрасывает действие) — встаём в очередь после него
    const bd = window.__buddy;
    if (bd && bd.fall) Promise.resolve().then(() => {
      const B = bd.B; B.face = x < W / 2 ? 1 : -1; B.alpha = B.alphaT = 1; B.queue = [];
      if (land || jump === 'line' || !bd.leap) {
        // строка заголовка — временная площадка: человечек сам видит только коробки, текст для него не опора.
        // Его пересканы (через 1,1 и 2,6 с после смены слайда) площадки пересобирают — возвращаем строку, пока стоим на ней
        // держим строку и в полёте: долгий кадр взрыва растягивает падение за первый пересканер (1,1 с), и без строки он пролетал заголовок на пол
        let was = false;   // после того как сошёл со строки, она снова не площадка
        const keep = () => { if (B.surf === line) was = true; else if (was) return true;
          if ((B.surf === line || B.mode === 'free') && !bd.W.plats.includes(line)) bd.W.plats.push(line); };
        if (line) { bd.W.plats.push(line); const t0 = performance.now(), iv = setInterval(() => { if (keep() || performance.now() - t0 > 6000) clearInterval(iv); }, 50); }
        B.x = x;
        if (line) { let best = null; for (const [p, q] of line.spans) { const v = Math.max(p + 10, Math.min(q - 10, x)); if (best == null || Math.abs(v - x) < Math.abs(best - x)) best = v; } B.x = best; }
        if (land) {   // прыгает сверху, из-за края сцены, прямо на блок
          B.x = Math.max(land.x1 + 60, Math.min(land.x2 - 60, land.x1 + (land.x2 - land.x1) * .62)); B.face = -1;
          B.y = -70; B.scale = B.scaleT = 1;
          bd.begin(bd.fall(60, 1.5, 1));
        } else {
          B.y = y - 30; B.cam = .8; B.scale = .3; B.scaleT = 1;
          bd.begin(bd.fall(-630, 7, line ? .4 : 1));
        }   // на строке не задерживается — сразу дальше, на линию
      } else {
        // пока летит в камеру — поверх осколков и искр
        const bz = deck.querySelector('.buddy'); if (bz) bz.style.zIndex = 8;
        const xp = x + (W / 2 - x) * .55, yp = 372, xl = Math.max(240, Math.min(W - 240, xp + (xp < W / 2 ? 140 : -140)));
        B.x = x; B.y = y; B.scale = B.scaleT = .22;
        bd.begin(bd.leap({ x0: x, y0: y, xp, yp, xl, smax: 6.4, flip: jump === 'flip' }));
        setTimeout(() => shake([next], 3.5, 200), 400);              // «касание» объектива
        setTimeout(() => { if (bz) bz.style.zIndex = ''; }, 1500);
      }
      // со строки — сразу вниз, на линию над оглавлением раздела (верхняя граница .dv-nav); её человечек сам считает площадкой
      const down = () => {
        const nv = next.querySelector('.dv-nav'); if (!nv || !line || B.surf !== line) return null;
        const k = stageScale(), d = deck.getBoundingClientRect(); if (!(k > 0)) return null;
        const ny = (nv.getBoundingClientRect().top - d.top) / k;
        let P = bd.W.plats.find(p => p !== line && Math.abs(p.y - ny) < 4);
        if (!P) { bd.rescan(); if (!bd.W.plats.includes(line)) bd.W.plats.push(line); P = bd.W.plats.find(p => p !== line && Math.abs(p.y - ny) < 4); }
        if (!P || !P.spans.length) return null;
        const want = B.x + (B.face || 1) * 110;   // дугой вперёд, а не отвесно сквозь слово
        let tx = null; for (const [p, q] of P.spans) { const v = Math.max(p + 12, Math.min(q - 12, want)); if (tx == null || Math.abs(v - want) < Math.abs(tx - want)) tx = v; }
        return bd.jumpTo(tx, P, { apex: 22, gk: 6 });
      };
      bd.plan(land ? [() => bd.MAKE.wave()] : line && jump === 'line' ? [down, () => bd.MAKE.cheer()] : [() => bd.MAKE.cheer(), () => bd.MAKE.wave()]);
    });
  }

  // клавиши: T — запасной вид перехода; I — снова на обложку, готовую к взрыву
  addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    if (e.code === 'KeyT') {
      mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length]; localStorage.setItem('fx-mode3', mode); html.dataset.fx = mode;
      say('Переход: <span>' + NAMES[mode] + '</span>');
    }
    if (e.code === 'KeyJ') { jump = JUMPS[(JUMPS.indexOf(jump) + 1) % JUMPS.length]; localStorage.setItem('fx-jump2', jump); say('Человечек: <span>' + JNAMES[jump] + '</span> · I — разбить заново'); }
    if (e.code === 'KeyI') startIntro();
  }, true);

  // Интро запускается только явным вызовом armIntro().
  window.__fx = { build: () => buildGlass(), get glass() { return G && { n: G.S.length, ms: G.buildMs, kf: G.anims.length }; }, startIntro, choreograph, fracture, get jump() { return jump; }, set jump(v) { jump = v; }, get mode() { return mode; }, set mode(v) { mode = v; html.dataset.fx = v; }, burst };

  const motionQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const onMotionChange = () => Promise.resolve().then(() => { if (!dead && reduced()) stopMotion(); });
  motionQuery?.addEventListener('change', onMotionChange);
  cleanups.push(() => motionQuery?.removeEventListener('change', onMotionChange));

  return Object.freeze({
    armIntro(variant = 'line') {
      if (dead) throw new Error('Эффекты отключены')
      if (!JUMPS.includes(variant)) throw new RangeError('Вариант: line, leap или flip')
      if (reduced()) { stopMotion(); show(0); return false }
      jump = variant; startIntro(); return true
    },
    go(index, currentIndex) {
      if (dead) throw new Error('Эффекты отключены')
      if (!Number.isInteger(index) || index < 0 || index >= slides.length) throw new RangeError('Нет такого слайда')
      window.__fxGo(index, currentIndex, () => show(index))
    },
    get glass() { return window.__fx.glass },
    destroy() {
      if (dead) return
      dead = true; job = null; armed = false; dropGlass()
      for (const id of timers) globalThis.clearTimeout(id)
      for (const id of intervals) globalThis.clearInterval(id)
      for (const id of framesPending) globalThis.cancelAnimationFrame(id)
      timers.clear(); intervals.clear(); framesPending.clear()
      for (const off of cleanups) off()
      cleanups.length = 0
      for (const animation of deck.getAnimations({ subtree: true })) if (!previousAnimations.has(animation)) animation.cancel()
      previousAnimations.clear()
      for (const node of nodes) discard(node)
      parts = []; spinning = false
      style.remove(); html.classList.remove('fx-intro', 'fx-armed'); delete html.dataset.fx
      deck.removeAttribute('data-buddy-effects')
      const host = deck.querySelector('.buddy'); if (host) host.style.zIndex = '4'
    }
  })
}
