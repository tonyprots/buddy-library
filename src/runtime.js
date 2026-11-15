/* Человечек на слайдах: живёт своей жизнью и смелеет к концу деки.
 *
 * Тело — 2.5D-скелет: суставы в объёме (x — вперёд, y — вниз, z — вбок), поворот вокруг
 * вертикали проецируется ортогонально, поэтому разворачивается он через анфас, а не зеркальным
 * щелчком. Позы — углы суставов. На земле опорную точку держит «якорь», поэтому ступни не
 * скользят, а таз сам качается как перевёрнутый маятник. В лазанье руки и ноги ставит
 * двухзвенная ИК. Рисунок — SVG: конусные конечности, полутон по направлению света,
 * дальние конечности темнее.
 *
 * Мир — пол у логотипа, сам логотип и коробки текущего слайда: картинки, плитки, карточки, бары.
 * Стоять, висеть и лезть можно только там, где рядом нет текста и картинок. Смелость задаёт
 * таблица LEVELS по доле пройденной деки, репертуар — таблица MOVES, суперспособности — POWERS.
 * Один rAF-цикл; при prefers-reduced-motion — одна статичная поза.
 */
import { resolveBrand } from './brand.js'

let instanceId = 0
const legacyHandBones = new WeakMap()
// Собственный нейтральный реквизит для примера без подключённых фирменных изображений.
const neutralPropImages = Object.fromEntries(Object.entries({
  disk: '<circle cx="12" cy="12" r="10" fill="#d7e3df"/><circle cx="12" cy="12" r="3" fill="#405953"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2" fill="#f4faf8" stroke="#405953" stroke-width="2"/><path d="m3 5 9 8 9-8" fill="none" stroke="#405953" stroke-width="2"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2" fill="#f4faf8" stroke="#405953" stroke-width="2"/><path d="M3 10h18M7 2v5m10-5v5m-10 8h3m4 0h3m-10 4h3" stroke="#405953" stroke-width="2"/>',
  tracker: '<circle cx="12" cy="12" r="10" fill="#d7e3df"/><path d="m6 12 4 4 8-9" fill="none" stroke="#405953" stroke-width="3"/>'
}).map(([id, body]) => [id, 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' + body + '</svg>')]))

// Кольцо и рукоять находятся у пальцев уже posed/placed GLB, а не у Wrist.
export function legacyHandPoint(rig, side, out) {
  let cached = legacyHandBones.get(rig)
  if (!cached) {
    const sides = ['L', 'R'].map(suffix => ['Middle1', 'Middle2'].map(name => rig.root.getObjectByName(name + suffix)))
    if (sides.some(bones => bones.some(bone => !bone))) return false
    cached = sides.map(bones => ({ bones, a: bones[0].position.clone(), b: bones[1].position.clone() }))
    legacyHandBones.set(rig, cached)
  }
  const hand = cached[side]
  hand.bones[0].getWorldPosition(hand.a); hand.bones[1].getWorldPosition(hand.b)
  out[0] = (hand.a.x + hand.b.x) / 2; out[1] = -(hand.a.y + hand.b.y) / 2
  return true
}

export const pullupCandidates = (world, body, level, range) => world.walls.filter(w =>
  w.gap >= 45 && w.gap <= level.reach && w.footX >= range[0] && w.footX <= range[1] && Math.abs(w.footX - body.x) < 420)

export const trackerCandidates = (world, body, floor = 700) => world.plats.filter(q =>
  q.x2 - q.x1 > 60 && q.x1 - 300 < body.x && q.x2 + 300 > body.x && q.y < floor - 70 && q.y > floor - 460 &&
  q.spans.some(([a, b]) => b - a >= 26))

export function createRuntime({ deck, host, presentation = null, brand: brandOption, logos = {}, keyboard = false, motion = 'system', autonomous = true, renderer = 'auto', enabledPowers = null, hoodie = null, dependencies = {}, behavior: initialBehavior = null }) {
  const { THREE, Buddy3D } = dependencies, brand = brandOption ?? resolveBrand(null, logos),
    accent = brand.accent || '#FF6427',
    window = { THREE, Buddy3D: renderer === 'svg' ? null : Buddy3D };
  const uid = 'buddy-' + (++instanceId) + '-', cleanups = [], timers = new Set();
  let destroyed = false, raf = 0, viewRaf = 0, viewRevision = 0, lastRender = null, cachedActor = null, cachedProps = null,
    visible = true, runtimePaused = false, last = performance.now(), frameCost = 0, framePeak = 0, frameCount = 0, worldDirty = true;
  const setTimeout = (fn, ms) => {
    const id = globalThis.setTimeout(() => { timers.delete(id); if (!destroyed) fn(); }, ms);
    timers.add(id); return id;
  };
  const clearTimeout = id => { globalThis.clearTimeout(id); timers.delete(id); };
  const addEventListener = (type, fn, options) => {
    globalThis.addEventListener(type, fn, options);
    cleanups.push(() => globalThis.removeEventListener(type, fn, options));
  };
  const NS = 'http://www.w3.org/2000/svg';
  const LAB = !!window.BUDDY_LAB;
  if (!host) return;
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  let REDUCED = motion === 'reduce' || motion === 'system' && motionQuery.matches;
  const powerEnabled = name => !enabledPowers || enabledPowers.has(name);
  const listeners = new Set();
  let behavior = initialBehavior, focusRequested = false, focused = false, commandId = 0,
    command = { id: 0, status: 'completed' };
  const notify = event => { for (const listener of listeners) listener(event); };
  function interrupt(reason) {
    if (command.status === 'running') command = { ...command, status: 'cancelled', reason };
    notify({ type: 'interrupt', reason });
  }
  function startCommand() {
    interrupt('replaced');
    command = { id: ++commandId, status: 'running' };
    focused = false;
  }
  function completeCommand() {
    if (command.status === 'running') command = { ...command, status: 'completed' };
  }

  // ===================== таблицы поведения =====================

  // Смелость по ходу деки. p — доля пройденного: 0 — обложка, 1 — итоговый слайд.
  // Берётся первая строка, где p ≤ upTo.
  //   floor  — где ходит по полу, px сцены (правее не даёт навигация)
  //   climb  — на какую высоту над полом готов залезть, px (0 — никуда, кроме логотипа)
  //   reach  — с какого зазора между полом и низом карточки допрыгнет до её кромки, px
  //   down   — как слезает: climb — лезет обратно, hang — повисает и спрыгивает, jump — прыгает
  //   tricks — 0 нет, 1 стойка на руках, 2 ещё сальто, кувырок, прыжки между коробками
  // Одна страница без слайдов: смелости не к чему расти, поэтому сразу средний уровень — лазает по блокам.
  const SINGLE_PAGE_PROGRESS = .5;
  const LEVELS = [
    { upTo: .12, name: 'observing', floor: [176, 470], climb: 0, reach: 0, down: 'climb', tricks: 0 },
    { upTo: .32, name: 'settling in', floor: [176, 900], climb: 300, reach: 110, down: 'climb', tricks: 1 },
    { upTo: .66, name: 'climbing', floor: [176, 1080], climb: 560, reach: 150, down: 'hang', tricks: 1 },
    { upTo: 1.01, name: 'showing off', floor: [176, 1080], climb: 700, reach: 175, down: 'jump', tricks: 2 },
  ];

  // Репертуар на полу: веса по уровням 0–3. Недавние действия штрафуются, так что повторов подряд нет.
  const MOVES = {
    stroll: [3.9, 2.8, 2, 1.7], jog: [.15, .35, .4, .45], idle: [6, 5.3, 5, 4.6], shadowbox: [.8, 1.4, 1.3, 1.2], kick: [0, .9, 1, 1],
    lookSlide: [7.5, 7, 6.5, 6.5], lookHall: [1.4, 1.1, 1, 1], wave: [2.2, 1.8, 1.7, 1.5],
    yawn: [.8, .6, .4, .3], stretch: [3, 2.4, 1.9, 1.6],
    squats: [.3, .3, .3, .25], jacks: [.8, 1.7, 1.6, 1.4], toeTouch: [.7, 1.3, 1.2, 1],
    sideBend: [1, 1.2, .9, .8], sitRest: [4.2, 4.4, 4, 3.7], hop: [.5, .9, .9, .9],
    stumble: [.3, .6, .6, .6], clap: [.3, .5, .6, .7], logo: [1.3, 1, .6, .4],
    popcorn: [.7, 1, .9, .8], read: [.7, .9, .8, .6], note: [.9, 1.1, 1.1, 1],
    nap: [.8, .8, .6, .5], climb: [0, 3.4, 5.6, 9.5], pullups: [0, 2, 2.8, 3], handstand: [0, .5, 1, 1.3], backflip: [0, 0, .6, 1.3],
  };
  // Одно и то же действие не повторяется раньше, чем через REPEAT_GAP секунд (свои паузы — в REPEAT_GAP_OF;
  // 0 — без ограничения, это ходьба и стойка, из которых складывается всё остальное). Приседания — редкость.
  const REPEAT_GAP = 45;
  const REPEAT_GAP_OF = { popcorn: 80, read: 80, note: 22, nap: 0, stroll: 0, jog: 0, idle: 0, strollTop: 0, lookSlide: 10, sitRest: 15, climb: 0, pullups: 30, squats: 150,
    jacks: 25, toeTouch: 25, sideBend: 25, stretch: 25, shadowbox: 25, kick: 25 };   // зарядка — чаще общей паузы
  const FINAL_BONUS = { dance: 3, cheer: 2, backflip: 1.5, climb: 2 };   // на итоговом слайде

  // В ядре без политики способности стартуют с POWER_FROM; публичная политика использует долю деки.
  // Пауза между ними сжимается от POWER_GAP[0] к POWER_GAP[1] к концу деки; на новом слайде способность приходит быстро,
  // если с прошлой прошло хотя бы 60 % паузы. Без повторов, пока не показаны все доступные.
  // Обязательные номера: лазанье — на первом слайде с досягаемой стеной начиная с MUST_CLIMB_FROM,
  // магнит — на первом слайде с иконками начиная с MUST_MAGNET_FROM. Показал — больше не навязываем.
  const POWER_FROM = 4;
  const POWER_GAP = [[26, 38], [10, 16]];
  const MUST_CLIMB_FROM = 8, MUST_MAGNET_FROM = 10;
  const POWERS = {          // с какого уровня доступна
    levitate: 0, shield: 0, laser: 1, shrink: 1, smoke: 1, lightning: 1, fire: 1, ice: 1,
    portal: 2, speed: 2, clone: 2, fly: 2, hulk: 2, web: 2, magnet: 2,
    grapple: 1, construct: 1,
  };
  // Клавиши (раскладка не важна): B — трюк сейчас (лезет, подтягивается, прыгает; на итоговом слайде —
  // полёт к главной плитке), N — следующая суперспособность, C — залезть на блок, M — магнит иконок.
  const KEYS = { trick: 'KeyB', power: 'KeyN', climb: 'KeyC', magnet: 'KeyM' };

  // ===================== математика =====================
  const S = 0.45;                 // px на единицу скелета; рост с головой ≈ 104 ед. ≈ 47 px
  const PK = S / .5;              // пиксельные отступы лазанья заданы для S = 0.5
  const RUN_ST = .32;             // доля опоры в цикле бега
  const PX_M = 100 / 1.75 * S;    // px в метре (рост 1,75 м)
  const G = 9.81 * PX_M;          // ускорение свободного падения, px/с²
  const FLOOR = 700;              // пол — 20 px над нижним краем сцены 1280×720
  const PI = Math.PI;
  const rad = d => d * PI / 180, deg = r => r * 180 / PI;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = t => (t = clamp(t, 0, 1), t * t * (3 - 2 * t));
  const bump = (t, a, b) => t <= a || t >= b ? 0 : Math.sin(PI * (t - a) / (b - a));
  let seed = (Date.now() ^ 0x9e3779b9) >>> 0;
  function rnd() {
    seed = (seed + 0x6D2B79F5) >>> 0; let t = seed;
    t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  const rr = (a, b) => a + (b - a) * rnd();
  const chance = p => rnd() < p;

  // ===================== скелет =====================
  // длины в единицах; таз стоя на высоте HIP_H
  // пропорции мультяшные: голова ≈ 1/5 роста, ноги короче, конечности плотнее
  const L = { thigh: 20.5, shin: 19.5, ankle: 3.2, toe: 8.4, heel: 3.2, torso: 26, neck: 3, headR: 8.6,
    upper: 14, fore: 12.5, hand: 4.4, hipW: 5.6, shW: 9.2 };
  const HS = L.headR / 6.7;       // масштаб черт лица (они заданы для головы радиусом 6.7)
  const HIP_H = L.thigh + L.shin + L.ankle;

  // поза: rot — поворот всего тела (сальто, стойка), tl/ts — наклон корпуса вперёд/вбок,
  // hp/hy — голова вниз/к зрителю; парные: плечо sf/sa (вперёд/в сторону), локоть ef, ea — кисть
  // в сторону; бедро hf/ha, колено kf, ka — голень внутрь/наружу сверх бедра (лотос, нога на ногу), стопа af (+ носок вверх относительно горизонта тела)
  const SC = ['rot', 'tl', 'ts', 'hp', 'hy', 'mouth', 'smile', 'lid', 'brow'];
  const AR = ['sf', 'sa', 'ef', 'ea', 'hf', 'ha', 'kf', 'ka', 'af'];
  function pose(o) {
    const p = { rot: 0, tl: 3, ts: 0, hp: 0, hy: 0, mouth: 0, smile: 0, lid: 0, brow: 0,
      sf: [5, -3], sa: [7, 7], ef: [12, 9], ea: [0, 0], hf: [2, -2], ha: [2, 2], kf: [3, 3], ka: [0, 0], af: [0, 0] };
    if (o) for (const k in o) p[k] = Array.isArray(o[k]) ? o[k].slice() : o[k];
    return p;
  }
  function mix(A, B, t) {
    const o = {};
    for (const k of SC) o[k] = A[k] + (B[k] - A[k]) * t;
    for (const k of AR) o[k] = [A[k][0] + (B[k][0] - A[k][0]) * t, A[k][1] + (B[k][1] - A[k][1]) * t];
    return o;
  }
  const copy = p => mix(p, p, 0);
  const full = o => !!o && SC.every(k => k in o) && AR.every(k => k in o);
  const sd = (ci, near, far) => ci === 0 ? [near, far] : [far, near];   // значение для ближней к залу руки

  const pitch = (v, a) => { const c = Math.cos(a), s = Math.sin(a); return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]]; };
  const roll = (v, a) => { const c = Math.cos(a), s = Math.sin(a); return [v[0], v[1] * c + v[2] * s, -v[1] * s + v[2] * c]; };
  const add = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const sc3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const dirOf = (flex, abd, side) => { const f = rad(flex), b = rad(abd); return [Math.sin(f) * Math.cos(b), Math.cos(f) * Math.cos(b), side * Math.sin(b)]; };
  const inF = (v, F) => [F[0][0] * v[0] + F[1][0] * v[1] + F[2][0] * v[2], F[0][1] * v[0] + F[1][1] * v[1] + F[2][1] * v[2], F[0][2] * v[0] + F[1][2] * v[1] + F[2][2] * v[2]];

  // прямая кинематика; ys — знак поворота к залу (голова поворачивается «к зрителю»)
  // tw — насколько фигура повёрнута к залу (0 — профиль, 1 — анфас): согнутое предплечье тогда разворачивается к животу,
  // как у живого человека. Без разворота сгиб в анфас смотрит прямо в камеру, и рука читается коротким обрубком
  function solve(p, ys, tw) {
    const R = rad(p.rot), body = v => pitch(v, R);
    const tl = rad(p.tl), ts = rad(p.ts);
    const T = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(v => body(pitch(roll(v, ts), tl)));   // корпус: вперёд, вниз, вбок
    const H = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(body);                                 // таз
    const up = sc3(T[1], -1);
    const pel = [0, 0, 0], shC = add(pel, up, L.torso);
    const legs = [1, -1].map((s, i) => {
      const hip = add(pel, H[2], s * L.hipW);
      const kd = inF(dirOf(p.hf[i], p.ha[i], s), H), knee = add(hip, kd, L.thigh);
      const sd2 = inF(dirOf(p.hf[i] - p.kf[i], p.ha[i] + p.ka[i], s), H), ankle = add(knee, sd2, L.shin);
      const fd = inF(dirOf(90 + p.af[i], p.ha[i] * .3 + p.ka[i] * .8, s), H);
      const sole = add(ankle, H[1], L.ankle);
      return { hip, knee, ankle, shin: sd2, toe: add(sole, fd, L.toe), heel: add(sole, fd, -L.heel) };
    });
    const arms = [1, -1].map((s, i) => {
      const sh = add(add(shC, T[2], s * L.shW), T[1], 1.6);
      const ud = inF(dirOf(p.sf[i], p.sa[i], s), T), elbow = add(sh, ud, L.upper);
      const inw = tw ? tw * .5 * clamp(p.ef[i] - 10, 0, 110) : 0;
      const fd = inF(dirOf(p.sf[i] + p.ef[i], p.sa[i] + p.ea[i] - inw, s), T), wrist = add(elbow, fd, L.fore);
      return { sh, elbow, wrist, fd, hand: add(wrist, fd, L.hand * .55) };
    });
    const hp = rad(p.hp), hy = rad(p.hy) * ys;
    const f0 = add(sc3(T[0], Math.cos(hp)), up, -Math.sin(hp));
    const hU = add(sc3(up, Math.cos(hp)), T[0], Math.sin(hp));
    const hF = add(sc3(f0, Math.cos(hy)), T[2], Math.sin(hy));
    const hS = add(sc3(T[2], Math.cos(hy)), f0, -Math.sin(hy));
    const neckTop = add(shC, up, L.neck);
    const head = add(add(neckTop, hU, L.headR * .82), f0, .8);
    const seat = body([-2.6, 4.6, 0]);   // низ ягодиц: замер по 3D-модели (было 9,5 — таз висел над полом, «сидит на кочке»)
    return { pel, shC, T, up, legs, arms, neckTop, head, hF, hU, hS, seat };
  }
  // самая низкая точка стоп (ед. ниже таза) — для расчёта высоты таза
  function lowY(p) { const k = solve(p, 1); let m = -1e9; for (const g of k.legs) m = Math.max(m, g.heel[1], g.toe[1]); return m; }

  // двухзвенная ИК в сагиттальной плоскости: угол 0 — вниз, плюс — вперёд
  function ik2(vx, vy, a, b, elbowFwd) {
    const d = clamp(Math.hypot(vx, vy), Math.abs(a - b) + .01, a + b - .01);
    const al = Math.atan2(vx, vy);
    const be = Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
    const bend = PI - Math.acos(clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1));
    return elbowFwd ? [deg(al - be), deg(bend)] : [deg(al + be), deg(bend)];
  }

  // ===================== рисунок =====================
  const PAL = {
    hood: ['#5577F0', '#1340E0', '#0A2A9E'], jeans: ['#5C6A8A', '#36425F', '#1F2840'],
    skin: ['#F9D7BE', '#EBB48F', '#C88A63'], hulk: ['#A6D77F', '#6DAE47', '#3E7A28'],
    hair: ['#5A4232', '#3A2A20', '#24180F'], shoe: ['#5A5552', '#2E2B2A', '#191716'],
  };
  // Стили отрисовки на одном скелете. ol — толщина контура (ед.), cel — двухтоновая заливка с
  // жёсткой границей тени, head/limb/chest — масштаб головы, конечностей, груди, sq — сила
  // squash & stretch; pal — свои цвета поверх PAL (top — верх, legs — низ, hand — кисти).
  const FLAME = ['#FF8A55', '#FF6427', '#D2460F'], NAVY = ['#4B5C8E', '#2C3863', '#1A2246'];
  const STYLES = {
    volume: { ol: 0, cel: false, head: 1, limb: 1, chest: 1, sq: .45, pal: {} },
    hero: { ol: .8, cel: true, head: 1.08, limb: 1.07, chest: 1.2, sq: .75, cape: true, mask: true,
      pal: { top: FLAME, legs: NAVY, shoe: ['#E95A22', '#C23A0C', '#7A2006'], hand: ['#FFFFFF', '#F3EFEA', '#C9C0B8'],
        cape: ['#E95A22', '#C23A0C', '#7A2006'], belt: ['#FFD84D', '#FFC400', '#C99500'] } },
    platformer: { ol: .95, cel: true, head: 1.8, limb: 1.2, arm: 1.12, chest: .78, lift: 1.02, sq: 1, big: true, cape: true, logo: true,
      pal: { top: FLAME, legs: NAVY, shoe: ['#FFFFFF', '#F4F0EC', '#C8C0B8'], sole: FLAME, cape: ['#FFE16A', '#FFC400', '#C28F00'] } },
    // «Реализм»: голова ×1,35, мягкая светотень вместо полос cel, тонкий контур, рукава сужаются к
    // манжете, кисть с большим пальцем, худи объёмнее и длиннее, джинсы уже, складки на сгибах
    real: { ol: .62, cel: false, soft: true, real: true, head: 1.35, limb: 1, arm: 1, chest: .95, lift: .78, sq: .8, big: true, eye: .78, cape: true, logo: true,
      // черты: зачёс вверх, густые брови, вытянутое лицо, белая футболка под худи
      pal: { top: ['#5577F0', '#1340E0', '#0A2A9E'], legs: ['#3D4A70', '#222B4A', '#10152B'], skin: ['#F4CDAE', '#DFA67F', '#B47A55'], hair: ['#4A3324', '#33231A', '#1E140E'], shoe: ['#FFFFFF', '#EEE9E4', '#B9B0A8'], sole: FLAME,
        cape: ['#FFE16A', '#FFC400', '#C28F00'], rib: ['#E9561C', '#D24A14', '#9E340A'] } },
  };
  const STYLE = 'real';
  // худи под презентацию (outfit.js): основной стиль и запасной «объём»; герой и платформер — свои костюмы
  if (hoodie) { PAL.hood = hoodie.svg.slice(); STYLES.real.pal.top = hoodie.svg.slice(); }
  const INK = [26, 24, 23], OL = '#221B19';
  const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const css = c => 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')';
  const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const LIGHT = [-.55, -.83];
  const f2 = v => v.toFixed(2);
  const KC = .5523;
  // капсула с разными радиусами концов — сегмент конечности
  function cap(a, b, ra, rb) {
    let ux = b[0] - a[0], uy = b[1] - a[1]; const l = Math.hypot(ux, uy) || 1e-3; ux /= l; uy /= l;
    const nx = -uy, ny = ux;
    const P = (x, y) => f2(x) + ' ' + f2(y);
    const p1x = a[0] + nx * ra, p1y = a[1] + ny * ra, p2x = b[0] + nx * rb, p2y = b[1] + ny * rb;
    const ex = b[0] + ux * rb, ey = b[1] + uy * rb, p3x = b[0] - nx * rb, p3y = b[1] - ny * rb;
    const p4x = a[0] - nx * ra, p4y = a[1] - ny * ra, sx = a[0] - ux * ra, sy = a[1] - uy * ra;
    return 'M' + P(p1x, p1y) + 'L' + P(p2x, p2y) +
      'C' + P(p2x + ux * rb * KC, p2y + uy * rb * KC) + ' ' + P(ex + nx * rb * KC, ey + ny * rb * KC) + ' ' + P(ex, ey) +
      'C' + P(ex - nx * rb * KC, ey - ny * rb * KC) + ' ' + P(p3x + ux * rb * KC, p3y + uy * rb * KC) + ' ' + P(p3x, p3y) +
      'L' + P(p4x, p4y) +
      'C' + P(p4x - ux * ra * KC, p4y - uy * ra * KC) + ' ' + P(sx - nx * ra * KC, sy - ny * ra * KC) + ' ' + P(sx, sy) +
      'C' + P(sx + nx * ra * KC, sy + ny * ra * KC) + ' ' + P(p1x - ux * ra * KC, p1y - uy * ra * KC) + ' ' + P(p1x, p1y) + 'Z';
  }
  const circ = (q, r) => 'M' + f2(q[0] - r) + ' ' + f2(q[1]) + 'a' + f2(r) + ' ' + f2(r) + ' 0 1 0 ' + f2(2 * r) + ' 0a' + f2(r) + ' ' + f2(r) + ' 0 1 0 ' + f2(-2 * r) + ' 0Z';

  let figN = 0;
  // Фигура: out.draw(k, yaw, p, x, y, scl, tint). Перед вызовом можно задать out.sq = [sx, sy]
  // (squash & stretch от уровня стоп), out.dt (шаг для плаща) и out.wind = [vx, vy] (ветер, px/с).
  function makeFigure(parent, style) {
    style = style || STYLE;
    const ST = STYLES[style], OLW = ST.ol, TK = ST.limb, AK = ST.arm || TK, HK = ST.head;
    const PR = {}; { const pal = Object.assign({ top: PAL.hood, legs: PAL.jeans, hand: PAL.skin, cape: PAL.hood }, PAL, ST.pal); for (const k in pal) PR[k] = pal[k].map(rgb); }
    const hs = HS * HK;
    const id = uid + 'fig-' + (++figN) + '_';
    const el = (tag, at, par) => { const e = document.createElementNS(NS, tag); for (const k in at) e.setAttribute(k, at[k]); par.appendChild(e); return e; };
    const defs = el('defs', {}, parent);
    const root = el('g', {}, parent);
    // контур — подложка под заливкой: кружков на суставах нет, граница видна только снаружи
    const olAt = { fill: OL, stroke: OL, 'stroke-width': 2 * OLW, 'stroke-linejoin': 'round', display: OLW ? '' : 'none' };
    const stroke = OLW ? { stroke: OL, 'stroke-width': OLW, 'stroke-linejoin': 'round' } : {};
    const OFF = ST.cel ? [0, .17, .17, .57, .57, 1] : ST.soft ? [0, .2, .42, .62, .86, 1] : [0, .5, .5, .5, .5, 1];
    function grad(name) {
      const g = el('linearGradient', { id: id + name, gradientUnits: 'userSpaceOnUse' }, defs);
      return { g, st: OFF.map(o => el('stop', { offset: o }, g)) };
    }
    function part(name) { const g = el('g', {}, root); return { name, g, d: 0 }; }
    const cape = ST.cape ? part('cape') : null;
    if (cape) { cape.gr = grad('cape'); cape.ol = el('path', olAt, cape.g); cape.body = el('path', { fill: 'url(#' + id + 'cape)' }, cape.g);
      cape.lining = el('path', {}, cape.g); cape.tip = null; cape.v = [0, 0]; }
    // нога из двух частей: бедро всегда за корпусом (подол худи лежит на нём), голень — по глубине колена
    const legs = [0, 1].map(i => { const P = part('leg' + i); P.gr = grad('leg' + i);
      const T = part('thigh' + i); P.thigh = T; T.ol = el('path', olAt, T.g); T.fill = el('path', { fill: 'url(#' + id + 'leg' + i + ')' }, T.g);
      P.ol = el('path', olAt, P.g);
      P.limb = el('path', { fill: 'url(#' + id + 'leg' + i + ')' }, P.g);
      P.shoe = el('path', {}, P.g);
      P.sole = ST.pal.sole ? el('path', {}, P.g) : null;
      if (ST.real) { P.fold = el('path', { fill: 'none', 'stroke-linecap': 'round' }, P.g); P.lace = el('path', { fill: 'none', 'stroke-linecap': 'round' }, P.g); }
      return P; });
    const arms = [0, 1].map(i => { const P = part('arm' + i); P.gr = grad('arm' + i);
      P.ol = el('path', olAt, P.g);
      P.limb = el('path', { fill: 'url(#' + id + 'arm' + i + ')' }, P.g);
      P.hand = el('path', {}, P.g);
      if (ST.real) { P.cuff = el('path', {}, P.g); P.fold = el('path', { fill: 'none', 'stroke-linecap': 'round' }, P.g); P.knuck = el('path', { fill: 'none', 'stroke-linecap': 'round' }, P.g); }
      return P; });
    const torso = part('torso'); torso.gr = grad('torso');
    torso.ol = el('path', olAt, torso.g);
    torso.hood = el('path', {}, torso.g);
    torso.body = el('path', { fill: 'url(#' + id + 'torso)' }, torso.g);
    torso.hem = el('path', { fill: 'none', 'stroke-linecap': 'round' }, torso.g);
    if (ST.real) { torso.pocket = el('path', { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, torso.g);
      torso.seam = el('path', { fill: 'none', 'stroke-linecap': 'round' }, torso.g);
      torso.tee = el('path', { fill: '#FAF7F4' }, torso.g);
      torso.strings = el('path', { fill: 'none', stroke: '#FFF4EC', 'stroke-linecap': 'round' }, torso.g); }
    torso.emblem = ST.mask ? el('circle', Object.assign({ fill: '#fff' }, stroke), torso.g) : null;
    if (ST.logo) {   // значок на груди: лаймовый круг цвета клуба
      torso.logo = el('g', {}, torso.g);
      el('circle', { cx: 25, cy: 25, r: 30, fill: '#fff', stroke: OL, 'stroke-width': 4 }, torso.logo);
      el('circle', { cx: 25, cy: 25, r: 25, fill: '#C6F432' }, torso.logo);
    }
    torso.bolt = ST.mask ? el('path', { fill: css(PR.top[1]) }, torso.g) : null;
    const head = part('head');
    const hgr = el('radialGradient', { id: id + 'head', cx: .36, cy: .32, r: .78 }, defs);
    head.st = (ST.cel ? [0, .7, .7, 1] : [0, .55, .55, 1]).map(o => el('stop', { offset: o }, hgr));
    head.neck = el('path', {}, head.g);
    head.ears = [0, 1].map(() => el('ellipse', Object.assign({ rx: 1.25 * hs, ry: 1.9 * hs }, stroke), head.g));
    head.skull = el('ellipse', Object.assign({ rx: (ST.real ? 6.15 : 6.5) * hs, ry: (ST.real ? 7.5 : 7.1) * hs, fill: 'url(#' + id + 'head)' }, stroke), head.g);
    head.blush = ST.big && !ST.real ? [0, 1].map(() => el('ellipse', { fill: '#FF7F6E', opacity: .45 }, head.g)) : [];
    head.nose = el('circle', { r: 1.15 * hs }, head.g);
    head.hair = el('path', stroke, head.g);
    head.shine = ST.cel ? el('ellipse', { fill: '#fff', opacity: .55 }, head.g) : null;
    head.mask = ST.mask ? el('path', { fill: 'none', stroke: '#1A2246', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, head.g) : null;
    // глаза: у платформера — белок с контуром, карая радужка, зрачок, два блика; у героя — белок и зрачок
    head.eyes = [0, 1].map(() => el('ellipse', ST.big ? { fill: '#fff', stroke: OL, 'stroke-width': .55 } : { fill: ST.mask ? '#fff' : '#1A1817' }, head.g));
    head.irises = ST.big ? [0, 1].map(() => el('ellipse', { fill: '#6B4A2E' }, head.g)) : [];
    head.pupils = ST.mask || ST.big ? [0, 1].map(() => el('circle', { fill: '#1A1817' }, head.g)) : [];
    head.glints = ST.big ? [0, 1].map(() => el('circle', { fill: '#fff' }, head.g)) : [];
    head.glints2 = ST.big ? [0, 1].map(() => el('circle', { fill: '#fff', opacity: .8 }, head.g)) : [];
    head.brows = ST.big ? [0, 1].map(() => el('path', { fill: 'none', stroke: ST.real ? '#24170F' : '#3A2A20', 'stroke-linecap': 'round' }, head.g)) : [];
    head.mouth = el('ellipse', { fill: '#6E2F22' }, head.g);
    head.smile = el('path', { fill: 'none', stroke: '#7A3A2C', 'stroke-width': .75 * (ST.big ? 1.3 : 1), 'stroke-linecap': 'round' }, head.g);
    const parts = [legs[0], legs[1], legs[0].thigh, legs[1].thigh, arms[0], arms[1], torso, head].concat(cape ? [cape] : []);
    let order = '';
    const out = { only: names => parts.forEach(q => q.g.setAttribute('display', !names || names.includes(q.name) ? '' : 'none')), root, eyesW: [[0, 0], [0, 0]], eyeOn: [false, false], visible: true, handsW: [[0, 0], [0, 0]], palmsW: [[0, 0, 0], [0, 0, 0]], mouthW: [0, 0, 0], sq: [1, 1], dt: 1 / 60, wind: [0, 0], capeOn: !!ST.mask };   // плащ: у героя всегда, у платформера — на время суперспособности

    function shade(name, depth, tint) {   // [свет, основа, тень] с учётом глубины
      let c = PR[name];
      if ((name === 'skin' || (name === 'hand' && style !== 'hero')) && tint) c = c.map((v, i) => mixc(v, PR.hulk[i], tint));
      const far = clamp(.5 - depth / 16, 0, 1) * (ST.cel ? .3 : .42);
      return c.map(v => mixc(v, INK, far));
    }
    const celShadow = cols => mixc(cols[1], cols[2], .72);
    const nrm = (a, b) => { const x = b[0] - a[0], y = b[1] - a[1], l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
    const at2 = (q, d, k) => [q[0] + d[0] * k, q[1] + d[1] * k];
    // складка на внутренней стороне сгиба: u — направление в сустав, v — из сустава, bend — 0…1
    function crease(el, j, u, v, r, bend, col) {
      let dx = v[0] - u[0], dy = v[1] - u[1]; const l = Math.hypot(dx, dy);
      if (bend < .15 || l < .2) { el.setAttribute('d', ''); return; }
      dx /= l; dy /= l;
      const a = [j[0] + dx * r * .75 - u[0] * r * .7, j[1] + dy * r * .75 - u[1] * r * .7], m = [j[0] + dx * r * .35, j[1] + dy * r * .35], b = [j[0] + dx * r * .75 + v[0] * r * .7, j[1] + dy * r * .75 + v[1] * r * .7];
      el.setAttribute('d', 'M' + f2(a[0]) + ' ' + f2(a[1]) + 'Q' + f2(m[0]) + ' ' + f2(m[1]) + ' ' + f2(b[0]) + ' ' + f2(b[1]));
      el.setAttribute('stroke', css(col)); el.setAttribute('stroke-width', .5); el.setAttribute('opacity', Math.min(1, bend * 1.3).toFixed(2));
    }
    function paintGrad(P, a, b, r, cols) {
      let ux = b[0] - a[0], uy = b[1] - a[1]; const l = Math.hypot(ux, uy) || 1; ux /= l; uy /= l;
      let nx = -uy, ny = ux; if (nx * LIGHT[0] + ny * LIGHT[1] < 0) { nx = -nx; ny = -ny; }
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      P.gr.g.setAttribute('x1', f2(mx + nx * r)); P.gr.g.setAttribute('y1', f2(my + ny * r));
      P.gr.g.setAttribute('x2', f2(mx - nx * r)); P.gr.g.setAttribute('y2', f2(my - ny * r));
      const hi = mixc(cols[1], [255, 255, 255], .3), cs = ST.cel ? [hi, hi, cols[1], cols[1], celShadow(cols), celShadow(cols)]
        : ST.soft ? [mixc(cols[0], [255, 255, 255], .12), cols[0], mixc(cols[0], cols[1], .7), cols[1], mixc(cols[1], cols[2], .75), mixc(cols[2], cols[1], .25)]   // блик → основа → тень, без ступенек
        : [cols[0], cols[1], cols[1], cols[1], cols[1], cols[2]];
      cs.forEach((c, i) => P.gr.st[i].setAttribute('stop-color', css(c)));
    }

    out.draw = function (k, yaw, p, x, y, scl, tint) {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const X = v => v[0] * c - v[2] * s, Dp = v => v[0] * s + v[2] * c, P2 = v => [X(v), v[1]];
      // squash & stretch от уровня стоп
      let fy = -1e9; for (const g of k.legs) fy = Math.max(fy, g.heel[1], g.toe[1]);
      const [qx, qy] = out.sq, by = y + fy * scl;
      root.setAttribute('transform', 'translate(' + f2(x) + ' ' + f2(by) + ') scale(' + (scl * qx).toFixed(4) + ' ' + (scl * qy).toFixed(4) + ') translate(0 ' + f2(-fy) + ')');
      const toW = q => [x + q[0] * scl * qx, by + (q[1] - fy) * scl * qy];
      // ноги
      for (let i = 0; i < 2; i++) {
        const g = k.legs[i], P = legs[i];
        const hp = P2(g.hip), kp = P2(g.knee), ap = P2(g.ankle);
        P.d = Dp(g.knee) - 8;
        const cols = shade('legs', P.d + 8, 0);
        const R = ST.real, td = R ? cap(hp, kp, 5.3, 4.1) : cap(hp, kp, 5.6 * TK, 4.3 * TK);
        let ld = R ? cap(kp, ap, 4.1, 3.2) : cap(kp, ap, 4.3 * TK, 3.3 * TK);
        if (R) ld += cap(at2(ap, nrm(ap, kp), 2.2), ap, 3.4, 3.55);   // низ штанины чуть шире и ложится на кроссовок
        P.thigh.fill.setAttribute('d', td); P.thigh.ol.setAttribute('d', td); P.thigh.d = Math.min(P.d - .5, -3) - (i ? .1 : 0);
        // заливка голени захватывает низ бедра: стык у колена закрыт, контур колена не рисуется
        const mk2 = [lerp(hp[0], kp[0], .55), lerp(hp[1], kp[1], .55)];
        P.limb.setAttribute('d', ld + (R ? cap(mk2, kp, 4.7, 4.1) : cap(mk2, kp, 4.9 * TK, 4.3 * TK)));
        paintGrad(P, hp, ap, (R ? 5 : 6) * TK, cols);
        if (P.fold) crease(P.fold, kp, nrm(hp, kp), nrm(kp, ap), 3.9, clamp((p.kf[i] - 20) / 60, 0, 1), cols[2]);
        const up = sc3(g.shin, -1), big = ST.real ? 1.16 : ST.big ? 1.3 : style === 'hero' ? 1.12 : 1;
        const sd = cap(P2(add(g.heel, up, 2.8 * big)), P2(add(g.toe, up, 2.2 * big + (big - 1) * 2)), 3 * big, 2.3 * big + (big - 1) * 1.5);
        P.shoe.setAttribute('d', sd);
        const sh = shade('shoe', P.d + 8, 0);
        P.shoe.setAttribute('fill', css(sh[ST.cel ? 1 : 1]));
        P.ol.setAttribute('d', ld + sd);
        if (P.sole) {   // подошва платформера — яркая полоса
          P.sole.setAttribute('d', cap(P2(add(g.heel, up, .9)), P2(add(g.toe, up, .9)), 1.1, 1.1));
          P.sole.setAttribute('fill', css(shade('sole', P.d + 8, 0)[1]));
        }
        if (P.lace) {   // шнуровка — светлая полоска по подъёму
          const l0 = P2(add(add(g.heel, up, 4.6), sc3(g.shin, 0), 0)), l1 = P2(add(lerp3(g.heel, g.toe, .62), up, 3.7));
          P.lace.setAttribute('d', 'M' + f2(lerp(l0[0], l1[0], .25)) + ' ' + f2(lerp(l0[1], l1[1], .25)) + 'L' + f2(l1[0]) + ' ' + f2(l1[1]));
          P.lace.setAttribute('stroke', css(sh[2])); P.lace.setAttribute('stroke-width', .7);
        }
      }
      // руки
      for (let i = 0; i < 2; i++) {
        const g = k.arms[i], P = arms[i];
        const sp = P2(g.sh), ep = P2(g.elbow), wp = P2(g.wrist), hp = P2(g.hand);
        P.d = (Dp(g.elbow) + Dp(g.wrist)) / 2 + 1;
        const acol = shade('top', P.d, 0);
        if (ST.real) {   // рукав сужается от плеча к манжете, манжета в рубчик, кисть-варежка с большим пальцем
          const fd = nrm(ep, wp), cuffA = at2(wp, fd, -1.7), ld = cap(sp, ep, 4.1, 2.85) + cap(ep, cuffA, 2.95, 2.65);
          P.limb.setAttribute('d', ld);
          paintGrad(P, sp, wp, 3.8, acol);
          const cd = cap(cuffA, at2(wp, fd, .2), 2.75, 2.55);
          P.cuff.setAttribute('d', cd); P.cuff.setAttribute('fill', css(shade('rib', P.d, 0)[1]));
          const fx = X(k.T[0]) >= 0 ? 1 : -1; let nf = [-fd[1], fd[0]]; if (nf[0] * fx < 0 && Math.abs(nf[0]) > .2) nf = [-nf[0], -nf[1]];
          const tip = at2(wp, fd, 4.3), hd = cap(at2(wp, fd, .9), tip, 1.75, 1.95) + cap(at2(at2(wp, fd, 1.3), nf, 1.1), at2(at2(wp, fd, 2.9), nf, 2.1), .8, .72);
          P.hand.setAttribute('d', hd); P.hand.setAttribute('fill', css(shade('hand', P.d, tint)[1]));
          const kn = at2(tip, fd, -1.6);
          P.knuck.setAttribute('d', 'M' + f2(kn[0] - nf[0] * 1.3) + ' ' + f2(kn[1] - nf[1] * 1.3) + 'L' + f2(kn[0] + nf[0] * .9) + ' ' + f2(kn[1] + nf[1] * .9));
          P.knuck.setAttribute('stroke', css(shade('hand', P.d, tint)[2])); P.knuck.setAttribute('stroke-width', .35);
          crease(P.fold, ep, nrm(sp, ep), fd, 2.9, clamp((p.ef[i] - 25) / 70, 0, 1), acol[2]);
          out.handsW[i] = toW(hp); P.ol.setAttribute('d', ld + cd + hd);
        } else {
          const ld = cap(sp, ep, 3.7 * AK * (style === 'hero' ? 1.12 : 1), 3.2 * AK) + cap(ep, wp, 3.2 * AK, 2.7 * AK);
          P.limb.setAttribute('d', ld);
          paintGrad(P, sp, wp, 3.9 * AK, acol);
          const hr = (ST.big ? 3.3 : style === 'hero' ? 2.9 : 2.7), hd = circ(hp, hr);
          P.hand.setAttribute('d', hd); out.handsW[i] = toW(hp);
          P.hand.setAttribute('fill', css(shade('hand', P.d, tint)[1]));
          P.ol.setAttribute('d', ld + hd);
        }
      }
      // корпус: худи с капюшоном (у героя — трико с поясом и эмблемой)
      {
        const H = P2(k.pel), C = P2(k.shC);
        let ux = C[0] - H[0], uy = C[1] - H[1]; const l = Math.hypot(ux, uy) || 1; ux /= l; uy /= l;
        const nx = -uy, ny = ux;
        const hw = (d, w) => Math.hypot(d * c, w * s);
        const ww = ST.real ? hw(6.4 - 1.6 * clamp((p.tl - 8) / 30, 0, 1), 9.3) : hw(6.2, 8.6) * (ST.big ? 1.12 : 1), wc = hw(6.6, 11) * ST.chest, HM = ST.real ? -5.4 + 2.6 * clamp((p.tl - 8) / 30, 0, 1) : -4;
        const pt = (b, au, an) => [b[0] + ux * au + nx * an, b[1] + uy * au + ny * an];
        const hemL = pt(H, HM, ww), hemR = pt(H, HM, -ww), chL = pt(C, -3.5, wc), chR = pt(C, -3.5, -wc), top = pt(C, 1.6, 0);
        const P = (q) => f2(q[0]) + ' ' + f2(q[1]);
        const bd = 'M' + P(hemL) + 'C' + P(pt(hemL, 9, 0)) + ' ' + P(pt(chL, -8, 0)) + ' ' + P(chL) +
          'C' + P(pt(chL, 3.6, 0)) + ' ' + P(pt(top, 0, wc * .8)) + ' ' + P(top) +
          'C' + P(pt(top, 0, -wc * .8)) + ' ' + P(pt(chR, 3.6, 0)) + ' ' + P(chR) +
          'C' + P(pt(chR, -8, 0)) + ' ' + P(pt(hemR, 9, 0)) + ' ' + P(hemR) +
          'Q' + P(pt(H, HM - 1.6, 0)) + ' ' + P(hemL) + 'Z';
        torso.body.setAttribute('d', bd);
        const cols = shade('top', 0, 0);
        paintGrad(torso, H, C, Math.max(ww, wc), cols);
        torso.hem.setAttribute('d', 'M' + P(pt(H, -1.8, ww * .92)) + 'Q' + P(pt(H, -3, 0)) + ' ' + P(pt(H, -1.8, -ww * .92)));
        if (style === 'hero') { torso.hem.setAttribute('stroke', css(PR.belt[1])); torso.hem.setAttribute('stroke-width', 2.4); torso.hem.setAttribute('opacity', 1); }
        else if (ST.real) {   // подол в рубчик
          torso.hem.setAttribute('d', 'M' + P(pt(H, HM + 1.2, ww * .97)) + 'Q' + P(pt(H, HM - .2, 0)) + ' ' + P(pt(H, HM + 1.2, -ww * .97)));
          torso.hem.setAttribute('stroke', css(shade('rib', 0, 0)[1])); torso.hem.setAttribute('stroke-width', 2.3); torso.hem.setAttribute('opacity', 1); torso.hem.setAttribute('stroke-linecap', 'butt');
        }
        else { torso.hem.setAttribute('stroke', css(mixc(cols[2], INK, .25))); torso.hem.setAttribute('stroke-width', .9); torso.hem.setAttribute('opacity', style === 'volume' ? .55 : .7); }
        if (ST.real) {   // карман-кенгуру, шнурки капюшона, ворот — по 3D-точкам корпуса
          const Q = (u, f, sd) => P2(add(add(add(k.pel, k.up, u), k.T[0], f), k.T[2], sd)), fw = Dp(k.T[0]);
          const vis = fw > .12, sh2 = css(mixc(cols[1], cols[2], .8));
          const a1 = Q(-1.2, 6.7, 4.4), a2 = Q(6.2, 6.9, 3.1), a3 = Q(6.2, 6.9, -3.1), a4 = Q(-1.2, 6.7, -4.4);
          torso.pocket.setAttribute('d', vis ? 'M' + P(a1) + 'L' + P(a2) + 'Q' + P(Q(6.9, 7, 0)) + ' ' + P(a3) + 'L' + P(a4) : '');
          torso.pocket.setAttribute('stroke', sh2); torso.pocket.setAttribute('stroke-width', .55);
          const n0 = Q(L.torso - 1.2, 4.6, 1.2), n1 = Q(L.torso - 6.5, 6.1, 1.6), m0 = Q(L.torso - 1.2, 4.6, -1.2), m1 = Q(L.torso - 6, 6.1, -1.5);
          torso.strings.setAttribute('d', vis ? 'M' + P(n0) + 'L' + P(n1) + 'M' + P(m0) + 'L' + P(m1) : '');
          torso.strings.setAttribute('stroke-width', .55);
          const t0 = Q(L.torso + .3, 4, 2.6), t1 = Q(L.torso - 3.2, 5.9, 0), t2 = Q(L.torso + .3, 4, -2.6), t3 = Q(L.torso + .9, 3.2, 0);   // белая футболка в вырезе
          torso.tee.setAttribute('d', fw > -.1 ? 'M' + P(t0) + 'Q' + P(Q(L.torso - 1.6, 5.4, 1.4)) + ' ' + P(t1) + 'Q' + P(Q(L.torso - 1.6, 5.4, -1.4)) + ' ' + P(t2) + 'Q' + P(t3) + ' ' + P(t0) + 'Z' : '');
          const c0 = Q(L.torso + .4, 1.5, 4.6), c1 = Q(L.torso - 2.2, 5.2, 0), c2 = Q(L.torso + .4, 1.5, -4.6);
          torso.seam.setAttribute('d', 'M' + P(c0) + 'Q' + P(c1) + ' ' + P(c2)); torso.seam.setAttribute('stroke', sh2); torso.seam.setAttribute('stroke-width', .6);
        }
        const hoodC = add(add(k.shC, k.T[0], -4.8), k.up, 1.6), hc = P2(hoodC), hd = circ(hc, 5);
        torso.hood.setAttribute('d', style === 'hero' ? '' : hd);
        torso.hood.setAttribute('fill', css(ST.cel ? celShadow(cols) : cols[2]));
        torso.ol.setAttribute('d', bd + (style === 'hero' ? '' : hd));
        if (torso.logo) {
          const fw = Dp(k.T[0]), e = P2(add(add(k.shC, k.up, -8), k.T[0], 6.2)), sx = clamp(.2 + fw * .8, .2, 1), ang = deg(Math.atan2(ux, -uy));
          torso.logo.setAttribute('transform', 'translate(' + P(e) + ') rotate(' + ang.toFixed(1) + ') scale(' + (sx * .105).toFixed(3) + ' .105) translate(-25 -25)');
          torso.logo.setAttribute('display', fw > -.05 ? '' : 'none');
        }
        if (torso.emblem) {   // эмблема на груди: белый круг с молнией, сжимается в профиль
          const fw = Dp(k.T[0]), e = P2(add(add(k.shC, k.up, -8.5), k.T[0], 6.4));
          const on = fw > -.1, sx = clamp(.25 + fw * .75, .25, 1), ang = deg(Math.atan2(ux, -uy));
          torso.emblem.setAttribute('cx', f2(e[0])); torso.emblem.setAttribute('cy', f2(e[1]));
          torso.emblem.setAttribute('r', 3.3); torso.emblem.setAttribute('display', on ? '' : 'none');
          torso.emblem.setAttribute('transform', 'translate(' + P(e) + ') rotate(' + ang.toFixed(1) + ') scale(' + sx.toFixed(2) + ' 1) translate(' + f2(-e[0]) + ' ' + f2(-e[1]) + ')');
          torso.bolt.setAttribute('d', 'M-.5 -2.5L1.6 -2.5L.3 -.4L1.8 -.4L-1.4 2.7L-.4 .4L-1.8 .4Z');
          torso.bolt.setAttribute('transform', 'translate(' + P(e) + ') rotate(' + ang.toFixed(1) + ') scale(' + sx.toFixed(2) + ' 1)');
          torso.bolt.setAttribute('display', on ? '' : 'none');
        }
        torso.d = 0;
      }
      // плащ: маятник на плечах с затуханием — отстаёт при разгоне, хлопает в прыжке
      if (cape) cape.g.setAttribute('display', out.capeOn ? '' : 'none');
      if (cape && !out.capeOn) cape.tip = cape.pm = null;
      if (cape && out.capeOn) {
        const a0 = P2(add(k.arms[0].sh, k.up, 1.2)), a1 = P2(add(k.arms[1].sh, k.up, 1.2));
        const mid = [(a0[0] + a1[0]) / 2, (a0[1] + a1[1]) / 2], LC = ST.mask ? 31 : 34;
        // покой: между «вдоль спины» и «отвесно вниз», чуть за спиной; на скорости — шлейфом назад
        const bd = P2(add(sc3(k.up, -1), k.T[0], -.18)), bl0 = Math.hypot(bd[0], bd[1]) || 1;
        let rx = bd[0] / bl0 * .55, ry = bd[1] / bl0 * .55 + .45; const rl = Math.hypot(rx, ry) || 1;
        const rest = [mid[0] + rx / rl * LC, mid[1] + ry / rl * LC];
        const mW = toW(mid), Lw = LC * scl, dt = Math.min(out.dt, .05);
        const vel = cape.pm && dt > 0 ? [(mW[0] - cape.pm[0]) / dt, (mW[1] - cape.pm[1]) / dt] : [0, 0]; cape.pm = mW;
        const r0 = toW(rest), sp = Math.hypot(vel[0], vel[1]), rW = [r0[0] - vel[0] * .2, r0[1] - vel[1] * .2 - sp * .09];   // поток поднимает плащ над спиной
        if (!cape.tip) { cape.tip = rW.slice(); cape.v = [0, 0]; }
        if (dt > 0) {
          cape.v[0] += ((rW[0] - cape.tip[0]) * 70 - cape.v[0] * 7 - out.wind[0] * 1.8) * dt;
          cape.v[1] += ((rW[1] - cape.tip[1]) * 70 - cape.v[1] * 7 - out.wind[1] * 1.8) * dt;
          cape.tip[0] += cape.v[0] * dt; cape.tip[1] += cape.v[1] * dt;
        } else { cape.tip[0] = rW[0] - out.wind[0] * .03; cape.tip[1] = rW[1] - out.wind[1] * .03; }
        let dx = cape.tip[0] - mW[0], dy = cape.tip[1] - mW[1]; const dl = Math.hypot(dx, dy) || 1;
        if (dl > Lw) { cape.tip[0] = mW[0] + dx / dl * Lw; cape.tip[1] = mW[1] + dy / dl * Lw; }
        const tl = [(cape.tip[0] - x) / (scl * qx), (cape.tip[1] - by) / (scl * qy) + fy];
        dx = tl[0] - mid[0]; dy = tl[1] - mid[1]; const L2 = Math.hypot(dx, dy) || 1;
        const px = -dy / L2, py = dx / L2, hwB = Math.max(Math.abs(a0[0] - a1[0]) * .7, 6.5) + 4;
        const bl = [tl[0] + px * hwB, tl[1] + py * hwB], br = [tl[0] - px * hwB, tl[1] - py * hwB];
        const fl = Math.min(1, (Math.hypot(cape.v[0], cape.v[1]) + Math.hypot(vel[0], vel[1])) / (60 * scl / S)), ph = (cape.t = (cape.t || 0) + dt) * 14;
        const wv = (u) => [tl[0] + px * hwB * u + dx / L2 * Math.sin(ph + u * 5) * 3.2 * fl, tl[1] + py * hwB * u + dy / L2 * Math.sin(ph + u * 5) * 3.2 * fl];
        const P = (q) => f2(q[0]) + ' ' + f2(q[1]);
        const cd = 'M' + P(a0) + 'Q' + P([(a0[0] + bl[0]) / 2 + px * 2, (a0[1] + bl[1]) / 2 + py * 2]) + ' ' + P(bl) +
          'Q' + P(wv(.5)) + ' ' + P(wv(0)) + 'Q' + P(wv(-.5)) + ' ' + P(br) +
          'Q' + P([(a1[0] + br[0]) / 2 - px * 2, (a1[1] + br[1]) / 2 - py * 2]) + ' ' + P(a1) + 'Z';
        cape.body.setAttribute('d', cd); cape.ol.setAttribute('d', cd);
        paintGrad(cape, mid, tl, hwB, PR.cape);
        cape.lining.setAttribute('d', 'M' + P(bl) + 'Q' + P(wv(.5)) + ' ' + P(wv(0)) + 'Q' + P(wv(-.5)) + ' ' + P(br) + 'Q' + P(wv(0)) + ' ' + P(bl) + 'Z');
        cape.lining.setAttribute('fill', css(PR.cape[2]));
        cape.d = -40;
      }
      // голова
      {
        const hcW = add(k.head, k.hU, (HK - 1) * L.headR * (ST.lift || .62));
        const hc = P2(hcW), sk = shade('skin', 2, tint);
        const hst = ST.cel ? [sk[1], sk[1], celShadow(sk), celShadow(sk)] : [sk[0], sk[1], sk[1], sk[2]];
        hst.forEach((cc, i) => head.st[i].setAttribute('stop-color', css(cc)));
        head.neck.setAttribute('d', cap(P2(add(k.shC, k.up, -1)), P2(k.neckTop), 2.8, 2.6));
        head.neck.setAttribute('fill', css(mixc(sk[1], sk[2], .55)));
        const u2 = [X(k.hU), k.hU[1]], ul = Math.hypot(u2[0], u2[1]) || 1; u2[0] /= ul; u2[1] /= ul;
        const rt = [-u2[1], u2[0]];
        head.skull.setAttribute('cx', f2(hc[0])); head.skull.setAttribute('cy', f2(hc[1]));
        head.skull.setAttribute('transform', 'rotate(' + deg(Math.atan2(u2[0], -u2[1])).toFixed(1) + ' ' + f2(hc[0]) + ' ' + f2(hc[1]) + ')');
        const at3 = (f, u, sdw) => add(add(add(hcW, k.hF, f * hs), k.hU, u * hs), k.hS, sdw * hs);
        const fD = Dp(k.hF), sD = Dp(k.hS);
        for (let i = 0; i < 2; i++) {   // уши
          const sg = i ? -1 : 1, e = head.ears[i], q = P2(at3(-.6, -.4, sg * 6.1));
          e.setAttribute('cx', f2(q[0])); e.setAttribute('cy', f2(q[1]));
          e.setAttribute('fill', css(mixc(sk[1], sk[2], .5)));
          e.setAttribute('display', sg * sD > -.25 ? '' : 'none');
        }
        const nq = P2(at3(6.5, ST.big ? -2.2 : -1.4, 0));
        head.nose.setAttribute('cx', f2(nq[0])); head.nose.setAttribute('cy', f2(nq[1]));
        head.nose.setAttribute('r', ((ST.big ? .8 : 1.15) * hs).toFixed(2));
        head.nose.setAttribute('fill', css(mixc(sk[1], sk[2], .35)));
        head.nose.setAttribute('display', fD > -.3 ? '' : 'none');
        // маска героя: полоса по поверхности головы на уровне глаз
        if (head.mask) {
          let d = '', open = false;
          for (let sdw = -6.4; sdw <= 6.41; sdw += .8) {
            const f = Math.sqrt(Math.max(0, 6.75 * 6.75 - sdw * sdw)), vis = Dp(k.hF) * f + Dp(k.hS) * sdw;
            if (vis > -.4) { const q = P2(at3(f, .1, sdw)); d += (open ? 'L' : 'M') + f2(q[0]) + ' ' + f2(q[1]); open = true; } else open = false;
          }
          head.mask.setAttribute('d', d); head.mask.setAttribute('stroke-width', (3.3 * hs).toFixed(2));
        }
        const eyeAt = ST.big ? [5.5, -1, 2.75] : [5.2, -.1, 2.4];
        for (let i = 0; i < 2; i++) {   // глаза
          const sg = i ? -1 : 1, e = head.eyes[i], w3 = at3(eyeAt[0], eyeAt[1], sg * eyeAt[2]), q = P2(w3);
          const vis = fD * .85 + sg * .42 * sD, on = vis > .1, sx = clamp(.45 + vis * .7, .45, 1);
          out.eyeOn[i] = on;
          out.eyesW[i] = toW(q);
          const ek = ST.eye || 1, rx = (ST.big ? 1.45 * ek : ST.mask ? 1.45 : .95) * hs * sx, ry = (ST.big ? 1.75 * ek : ST.mask ? 1.05 : 1.25) * hs * (1 - p.lid * .85);
          e.setAttribute('cx', f2(q[0])); e.setAttribute('cy', f2(q[1]));
          e.setAttribute('rx', rx.toFixed(2)); e.setAttribute('ry', ry.toFixed(2));
          e.setAttribute('display', on ? '' : 'none');
          if (head.irises[i]) {   // радужка смещена к направлению взгляда (вбок вслед за поворотом головы), чуть вниз
            const ir = head.irises[i], o = P2(at3(eyeAt[0] + .25, eyeAt[1] - .25, sg * eyeAt[2] + .45 * c)), open = 1 - p.lid * .85;
            ir.setAttribute('cx', f2(o[0])); ir.setAttribute('cy', f2(o[1])); ir.setAttribute('rx', (rx * .72).toFixed(2)); ir.setAttribute('ry', (Math.min(ry, 1.25 * hs * open)).toFixed(2));
            ir.setAttribute('display', on && p.lid < .8 ? '' : 'none');
            const pp = head.pupils[i]; pp.setAttribute('cx', f2(o[0])); pp.setAttribute('cy', f2(o[1])); pp.setAttribute('r', (rx * .38).toFixed(2));
            pp.setAttribute('display', on && p.lid < .6 ? '' : 'none');
            const g2 = head.glints2[i]; g2.setAttribute('cx', f2(o[0] + rx * .3)); g2.setAttribute('cy', f2(o[1] + ry * .32)); g2.setAttribute('r', (.22 * hs * sx).toFixed(2));
            g2.setAttribute('display', on && p.lid < .5 ? '' : 'none');
            // бровь: наружный конец выше; brow < 0 — сведены (сосредоточен), > 0 — подняты (удивлён)
            const br = head.brows[i], by0 = eyeAt[1] + 2.75 + p.brow * .7, bi = P2(at3(eyeAt[0] - .2, by0 - Math.min(0, p.brow) * .9 - .1, sg * (eyeAt[2] - 1.1))),
              bm = P2(at3(eyeAt[0] - .3, by0 + .55, sg * eyeAt[2])), bo = P2(at3(eyeAt[0] - .7, by0 + .1 + Math.max(0, -p.brow) * .2, sg * (eyeAt[2] + 1.2)));
            br.setAttribute('d', 'M' + f2(bi[0]) + ' ' + f2(bi[1]) + 'Q' + f2(bm[0]) + ' ' + f2(bm[1]) + ' ' + f2(bo[0]) + ' ' + f2(bo[1]));
            br.setAttribute('stroke-width', ((ST.real ? 1.05 : .75) * hs).toFixed(2)); br.setAttribute('display', vis > .05 ? '' : 'none');
          } else if (head.pupils[i]) { const pp = head.pupils[i], o = P2(at3(eyeAt[0] + .3, eyeAt[1], sg * eyeAt[2] + .3 * c));
            pp.setAttribute('cx', f2(o[0])); pp.setAttribute('cy', f2(o[1])); pp.setAttribute('r', (.62 * hs * Math.min(1, ry / (1.05 * hs) + .1)).toFixed(2));
            pp.setAttribute('display', on && p.lid < .7 ? '' : 'none'); }
          if (head.glints[i]) { const gl = head.glints[i];
            gl.setAttribute('cx', f2(q[0] - rx * .22 + .45 * c * hs)); gl.setAttribute('cy', f2(q[1] - ry * .3)); gl.setAttribute('r', (.42 * hs * sx).toFixed(2));
            gl.setAttribute('display', on && p.lid < .5 ? '' : 'none'); }
          if (head.blush[i]) { const bq = P2(at3(5.2, -3, sg * 4.1)), b = head.blush[i];
            b.setAttribute('cx', f2(bq[0])); b.setAttribute('cy', f2(bq[1])); b.setAttribute('rx', (1.35 * hs * sx).toFixed(2)); b.setAttribute('ry', (.8 * hs).toFixed(2));
            b.setAttribute('display', vis > .25 ? '' : 'none'); }
        }
        const mq = P2(at3(5.8, ST.big ? -3.9 : -3.7, 0));
        const mw = toW(mq); out.mouthW[0] = mw[0]; out.mouthW[1] = mw[1]; out.mouthW[2] = 0;
        head.mouth.setAttribute('cx', f2(mq[0])); head.mouth.setAttribute('cy', f2(mq[1]));
        head.mouth.setAttribute('rx', (1.25 * hs * p.mouth * clamp(.5 + fD, .5, 1)).toFixed(2)); head.mouth.setAttribute('ry', (1.7 * hs * p.mouth).toFixed(2));
        head.mouth.setAttribute('display', p.mouth > .05 && fD > -.2 ? '' : 'none');
        if (p.smile > .1 && fD > .15 && p.mouth < .1) {
          const my = ST.big ? -3.6 : -3.2, a = P2(at3(5.5, my, 1.7)), b = P2(at3(5.5, my, -1.7)), m = P2(at3(5.9, my - 1.2 * (.6 + .4 * p.smile), 0));
          head.smile.setAttribute('d', 'M' + f2(a[0]) + ' ' + f2(a[1]) + 'Q' + f2(m[0]) + ' ' + f2(m[1]) + ' ' + f2(b[0]) + ' ' + f2(b[1]));
          head.smile.setAttribute('display', '');
        } else head.smile.setAttribute('display', 'none');
        // волосы: шапка над лбом и затылком, линия роста — по повороту лица; у платформера — вихор
        const fX = X(k.hF), a = clamp(Math.abs(fX) / .95, 0, 1), sg = fX >= 0 ? 1 : -1;
        const cx = hc[0] + (u2[0] * .55 - sg * rt[0] * .35 * a) * hs, cy = hc[1] + (u2[1] * .55 - sg * rt[1] * .35 * a) * hs, r = 7.3 * hs;
        const pt = th => [cx + r * (Math.sin(th) * sg * rt[0] + Math.cos(th) * u2[0]), cy + r * (Math.sin(th) * sg * rt[1] + Math.cos(th) * u2[1])];
        const aF = rad(lerp(80, 50, a)), aB = -rad(lerp(80, 142, a));
        const p0 = pt(aF), p1 = pt(aB);
        const ctl = [hc[0] + (u2[0] * lerp(3.4, 1.4, a) - sg * rt[0] * lerp(0, 1.4, a)) * hs, hc[1] + (u2[1] * lerp(3.4, 1.4, a) - sg * rt[1] * lerp(0, 1.4, a)) * hs];
        let hd = 'M' + f2(p0[0]) + ' ' + f2(p0[1]) + 'A' + f2(r) + ' ' + f2(r) + ' 0 ' + (aF - aB > PI ? 1 : 0) + ' ' + (sg > 0 ? 0 : 1) + ' ' + f2(p1[0]) + ' ' + f2(p1[1]);
        if (ST.big) {   // чёлка: линия роста — зубцами, на лоб спадают пряди
          const N = 7, qb = t => [(1 - t) * (1 - t) * p1[0] + 2 * t * (1 - t) * ctl[0] + t * t * p0[0], (1 - t) * (1 - t) * p1[1] + 2 * t * (1 - t) * ctl[1] + t * t * p0[1]];
          for (let j = 1; j <= N; j++) {
            const t1 = (j - .5) / N, t2 = j / N, a1 = qb(t1), a2 = qb(t2), dn = (ST.real ? .7 : 1.5) * hs * (.4 + .6 * Math.sin(PI * t1)) * (.3 + .7 * a);
            hd += 'Q' + f2(a1[0] - u2[0] * dn) + ' ' + f2(a1[1] - u2[1] * dn) + ' ' + f2(a2[0]) + ' ' + f2(a2[1]);
          }
          hd += 'Z';
        } else hd += 'Q' + f2(ctl[0]) + ' ' + f2(ctl[1]) + ' ' + f2(p0[0]) + ' ' + f2(p0[1]) + 'Z';
        if (ST.real) {   // зачёс вверх: три пряди над лбом, клонятся назад от лица
          for (const [th, h, w] of [[rad(52), 1.17, 20], [rad(30), 1.22, 22], [rad(6), 1.16, 20]]) {
            const b0 = pt(th + rad(w)), b1 = pt(th - rad(w)), tip = [cx + (Math.cos(th) * u2[0] + Math.sin(th) * sg * rt[0]) * r * h - sg * rt[0] * r * .28, cy + (Math.cos(th) * u2[1] + Math.sin(th) * sg * rt[1]) * r * h - sg * rt[1] * r * .28];
            hd += 'M' + f2(b0[0]) + ' ' + f2(b0[1]) + 'Q' + f2((b0[0] + tip[0]) / 2 + u2[0] * 1.2) + ' ' + f2((b0[1] + tip[1]) / 2 + u2[1] * 1.2) + ' ' + f2(tip[0]) + ' ' + f2(tip[1]) +
              'Q' + f2((b1[0] + tip[0]) / 2) + ' ' + f2((b1[1] + tip[1]) / 2) + ' ' + f2(b1[0]) + ' ' + f2(b1[1]) + 'Z';
          }
        } else if (ST.big) {   // вихор на макушке, клонится назад от лица
          const b0 = pt(rad(8)), b1 = pt(rad(-18)), tip = [cx + u2[0] * r * 1.24 - sg * rt[0] * r * .5 * (.4 + a * .6), cy + u2[1] * r * 1.24 - sg * rt[1] * r * .5 * (.4 + a * .6)];
          hd += 'M' + f2(b0[0]) + ' ' + f2(b0[1]) + 'Q' + f2((b0[0] + tip[0]) / 2 + u2[0] * 2) + ' ' + f2((b0[1] + tip[1]) / 2 + u2[1] * 2) + ' ' + f2(tip[0]) + ' ' + f2(tip[1]) +
            'Q' + f2((b1[0] + tip[0]) / 2) + ' ' + f2((b1[1] + tip[1]) / 2) + ' ' + f2(b1[0]) + ' ' + f2(b1[1]) + 'Z';
        }
        head.hair.setAttribute('d', hd);
        head.hair.setAttribute('fill', css(PR.hair[ST.big ? 0 : 1]));
        if (head.shine) {   // блик на волосах
          const sq2 = [cx + (u2[0] * .62 * r) + rt[0] * r * .28, cy + (u2[1] * .62 * r) + rt[1] * r * .28];
          head.shine.setAttribute('cx', f2(sq2[0])); head.shine.setAttribute('cy', f2(sq2[1]));
          head.shine.setAttribute('rx', (1.8 * hs).toFixed(2)); head.shine.setAttribute('ry', (.75 * hs).toFixed(2));
          head.shine.setAttribute('transform', 'rotate(' + deg(Math.atan2(rt[1], rt[0])).toFixed(1) + ' ' + f2(sq2[0]) + ' ' + f2(sq2[1]) + ')');
        }
        head.d = 1.5;
      }
      // порядок: дальнее раньше
      const sorted = parts.slice().sort((a, b) => a.d - b.d), key = sorted.map(q => q.name).join();
      if (key !== order) { order = key; sorted.forEach(q => root.appendChild(q.g)); }
    };
    return out;
  }

  if (LAB) { window.__buddyKit = { pose, mix, solve, makeFigure, lowY, S, STYLES, gait }; return; }
  if (!deck) return;

  // ===================== сцена =====================
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 1280 720'); svg.setAttribute('width', 1280); svg.setAttribute('height', 720);
  host.appendChild(svg);
  const mk = (tag, at, par) => { const e = document.createElementNS(NS, tag); for (const k in at) e.setAttribute(k, at[k]); (par || svg).appendChild(e); return e; };
  const fxBack = mk('g', {});
  const shadowEl = mk('ellipse', { fill: '#1A1817', opacity: .14 });
  const cloneShadow = mk('ellipse', { fill: '#1A1817', opacity: 0 });
  const ghostLayer = mk('g', { opacity: .9 });
  const ghosts = [.34, .2, .1].map(o => { const g = mk('g', { opacity: o, display: 'none' }, ghostLayer); return { g, fig: makeFigure(g) }; });
  const ghostStep = 4, maxFrameDt = .05, zipSpeed = 620;
  const cloneG = mk('g', { display: 'none' });
  const cloneFig = makeFigure(cloneG);
  const figWrap = mk('g', {});
  const fig = makeFigure(figWrap);
  const clipR = mk('rect', { y: -100, height: 1000 }, mk('clipPath', { id: uid + 'clip' }, mk('defs', {})));
  const fxFront = mk('g', {});

  // 3D-фигура (three.js, proto3d/rig3d.js): маленький холст, который едет за фигурой между задним и передним
  // слоями SVG. Пока модель грузится или если WebGL нет, рисует SVG; с 3D от SVG-фигуры остаётся только плащ.
  // Холст не во весь слайд: прозрачный слой 2560×1440 с MSAA стоил 2,7–3,2 мс на кадр и тяжёлую композицию,
  // а фигура занимает около 100×100 px. Позиция холста выровнена по пикселям экрана (дробный сдвиг слоя
  // композитор размазывает), дробная часть уходит в камеру; буфер — вдвое плотнее экрана (суперсэмплинг).
  const G3 = (() => {
    if (!window.Buddy3D || !window.THREE) return null;
    const cv = document.createElement('canvas');
    cv.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;transform-origin:0 0;will-change:transform;pointer-events:none';
    let ren; try { ren = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: true, powerPreference: 'low-power' }); } catch (e) { return null; }
    host.appendChild(cv);
    const front = document.createElementNS(NS, 'svg');
    front.setAttribute('viewBox', '0 0 1280 720'); front.setAttribute('width', 1280); front.setAttribute('height', 720);
    host.appendChild(front); front.appendChild(fxFront);
    ren.setClearColor(0, 0); ren.outputColorSpace = THREE.SRGBColorSpace; ren.autoClear = false;
    const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(0, 1280, 0, -720, -3000, 3000); cam.position.z = 1500;
    const rig = Buddy3D.create(hoodie ? { hood: hoodie.look } : {}); scene.add(rig.root);
    const gl = ren.getContext(), viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS),
      maxDimension = Math.min(ren.capabilities.maxTextureSize, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), viewport[0], viewport[1]);
    const g = { cv, ren, scene, cam, rig, hp: [0, 0, 0], dir: [0, 0, 1], on: false, pr: 0, w: 0, h: 0, ss: 2, smallSince: null, inst: [],
      resizes: 0, resizeMs: 0, lastResizeMs: 0, peakPixels: 0, pixelRatioChanges: 0, lastFrameResized: false,
      reserveW: 0, reserveH: 0, reserveBounds: null, reserveMs: 0, framedFxUntil: 0, rendererDisposed: false, screenRatio: 0, outlinePx: 0, viewRevision: -1,
      maxDimension, densityLimit: 'none' };
    rig.loaded.then(() => {
      if (destroyed) { dispose3d(); return; }
      // шейдеры компилируются сразу, а не на первом кадре с фигурой (иначе рывок при появлении)
      rig.pose(solve(B.pose, 1), B.pose, {}); try { ren.compile(scene, cam); } catch (e) { }
      g.on = true; fig.only(['cape']); cloneFig.only(['cape']); ghostLayer.setAttribute('display', 'none');
      if (REDUCED) render(solve(B.pose, 1), 0);
    }).catch(() => { cv.remove(); });
    return g;
  })();

  // ===================== мир: пол, логотип, коробки слайда =====================
  const W = { idx: 0, n: 1, li: 0, progress: SINGLE_PAGE_PROGRESS, final: false, ready: false, ob: [], boxes: [], plats: [], walls: [],
    floor: { kind: 'floor', y: FLOOR, x1: 0, x2: 1280, spans: [[176, 470]] }, logo: null, navX: 1100, time: 0 };
  const slides = presentation?.slides || [].slice.call(deck.querySelectorAll(':scope > .slide'));
  W.n = slides.length || 1;
  const alpha = c => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return 0; const v = m[1].split(','); return v.length > 3 ? parseFloat(v[3]) : 1; };
  function boxD() { const r = deck.getBoundingClientRect(); return { l: r.left, t: r.top, k: r.width / 1280 || 1 }; }
  // CSS-transform не меняет content-box: за его масштабом следит отдельный observer ниже.
  // Запасная проверка идёт по реальному времени, а не по замороженным часам модели.
  let deckK = 0, deckKAt = -1;
  const stageK = () => { if (!deckK || performance.now() - deckKAt > 1000) { deckK = boxD().k; deckKAt = performance.now(); } return deckK; };
  function invalidatePresentation() {
    if (destroyed) return;
    deckK = 0; viewRevision++;
    if (viewRaf) return;
    viewRaf = requestAnimationFrame(() => {
      viewRaf = 0;
      if (destroyed || !G3?.on || !lastRender || G3.viewRevision === viewRevision) return;
      // Перерисовка представления не вызывает frame(): пауза и модельное время сохраняются.
      draw3d(lastRender.k, lastRender.scale, lastRender.jitter);
    });
  }
  addEventListener('resize', invalidatePresentation);
  const toD = (r, b) => ({ x1: (r.left - b.l) / b.k, y1: (r.top - b.t) / b.k, x2: (r.right - b.l) / b.k, y2: (r.bottom - b.t) / b.k });
  const shown = e => !e.checkVisibility || e.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  // свободные отрезки по x, где фигура (полоса yTop..yBot) не заслонит текст и картинки
  function spans(x1, x2, yTop, yBot, pad) {
    let seg = [[x1, x2]];
    for (const o of W.ob) {
      if (o.y2 <= yTop || o.y1 >= yBot) continue;
      const a = o.x1 - pad, c = o.x2 + pad, next = [];
      for (const [s, e] of seg) { if (c <= s || a >= e) next.push([s, e]); else { if (a > s) next.push([s, a]); if (c < e) next.push([c, e]); } }
      seg = next;
    }
    return seg.filter(([s, e]) => e - s >= 4);
  }
  const inSpans = (sp, x) => sp.some(([a, b]) => x >= a && x <= b);
  const nearestIn = (sp, x) => { let best = null, bd = 1e9; for (const [a, b] of sp) { const q = clamp(x, a, b), d = Math.abs(q - x); if (d < bd) { bd = d; best = q; } } return best; };
  const zoneFree = (x1, y1, x2, y2) => !W.ob.some(o => o.x2 > x1 && o.x1 < x2 && o.y2 > y1 && o.y1 < y2);
  const LV = () => LEVELS[W.boost ? LEVELS.length - 1 : W.li];   // boost — после клавиши трюка, до смены слайда
  function floorRange() { const lv = LV(); return [Math.max(lv.floor[0], (W.brandX2 || 0) + 18), Math.min(lv.floor[1], W.navX - 16)]; }

  function rescan() {
    if (destroyed) return;
    // .on часто меняют синхронно перед play(): не ждём микрозадачи MutationObserver.
    const current = slides.findIndex(s => s.classList.contains(presentation?.activeClass || 'on'));
    if (current >= 0 && current !== W.idx) onSlide(current);
    const slide = slides[W.idx]; if (!slide) return;
    const b = boxD(), ob = [], boxes = [];
    W.logo = null; W.brandX2 = 0; W.navX = 1100;
    const tw = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT), rg = document.createRange();
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (!/\S/.test(n.nodeValue) || !n.parentElement || !shown(n.parentElement)) continue;
      rg.selectNodeContents(n);
      for (const r of rg.getClientRects()) if (r.width > 1 && r.height > 1) ob.push(toD(r, b));
    }
    // что движется само (стопка свайп-карточек, бесконечные анимации), — не опора
    const moving = [].slice.call(slide.querySelectorAll('.deckstack, .mk')).concat(slide.getAnimations ? slide.getAnimations({ subtree: true })
      .filter(a => a.effect && a.effect.target && a.effect.target !== slide && a.effect.getComputedTiming().iterations === Infinity).map(a => a.effect.target) : []);
    for (const e of slide.querySelectorAll('*')) {
      const tag = e.tagName.toUpperCase();
      if (tag !== 'SVG' && e.closest('svg')) continue;
      if (tag === 'IMG' && e.closest('.screen')) continue;
      const media = tag === 'IMG' || tag === 'SVG' || tag === 'VIDEO' || tag === 'CANVAS' || e.classList.contains('screen');
      const r = e.getBoundingClientRect(); if (r.width < 6 || r.height < 6 || !shown(e)) continue;
      const d = toD(r, b);
      if (media) ob.push(d);
      if (d.x2 - d.x1 < 40 || d.y2 - d.y1 < 14) continue;
      if (moving.some(m => m.contains(e))) continue;
      const cs = getComputedStyle(e);
      const boxed = media || alpha(cs.backgroundColor) > .04 || (parseFloat(cs.borderTopWidth) > 0 && alpha(cs.borderTopColor) > .04);
      if (!boxed) continue;
      d.rad = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, 18); d.media = media;
      boxes.push(d);
    }
    const nav = deck.querySelector('.nav');
    if (nav) { const d = toD(nav.getBoundingClientRect(), b); ob.push(d); W.navX = d.x1; }
    W.ob = ob; W.boxes = boxes;
    // подпись .brand: верх надписи или аватарка [data-perch]
    const br = deck.querySelector('.brand');
    if (br) {
      W.brandX2 = toD(br.getBoundingClientRect(), b).x2;
      const pr = br.querySelector('[data-perch]'), tx = br.querySelector('[data-perch-text]');
      if (tx && (!pr || W.idx % 3)) {   // на двух слайдах из трёх площадка — верх букв подписи, на третьем — аватарка
        const d = toD(tx.getBoundingClientRect(), b), fs = parseFloat(getComputedStyle(tx).fontSize) || 14, y = (d.y1 + d.y2) / 2 - .36 * fs * (d.y2 - d.y1) / tx.getBoundingClientRect().height;
        W.logo = { kind: 'logo', y, x1: d.x1, x2: d.x2, spans: [[d.x1 + 6, d.x2 - 6]] };
      } else if (pr) { const d = toD(pr.getBoundingClientRect(), b); W.logo = { kind: 'logo', y: d.y1 + 1, x1: d.x1, x2: d.x2, spans: [[(d.x1 + d.x2) / 2 - 2, (d.x1 + d.x2) / 2 + 2]] }; }
      else {
      const d = toD(br.getBoundingClientRect(), b), w = d.x2 - d.x1, h = d.y2 - d.y1, y = d.y1 + h * 21.5 / 50;
      const x1 = d.x1 + w * 88 / 220 + 3, x2 = d.x2 - 3;
      W.logo = { kind: 'logo', y, x1: d.x1 + w * 86 / 220, x2: d.x2, spans: spans(x1, x2, y - 52, y - 1, 4) };
      }
    }
    // Пол учитывает измеренную подпись: floorRange использует brandX2.
    const [fa, fb] = floorRange();
    W.floor = { kind: 'floor', y: FLOOR, x1: 0, x2: 1280, spans: spans(fa, fb, FLOOR - 52, FLOOR - 1, 6) };
    // площадки: верх коробок
    const plats = [];
    for (const q of boxes) {
      const y = q.y1; if (y < 70 || y > FLOOR - 40) continue;
      const m = Math.max(q.rad, 3) + 4;
      const sp = spans(q.x1 + m, q.x2 - m, y - 52, y - 1, 6);
      if (sp.length) plats.push({ kind: 'plat', y, x1: q.x1, x2: q.x2, rad: q.rad, spans: sp, box: q });
    }
    W.plats = plats;
    // стены: боковые кромки коробок, по которым можно долезть от пола
    const walls = [], why = [];
    for (const P of plats) for (const side of [-1, 1]) {
      const wx = side < 0 ? P.x1 : P.x2, tag = Math.round(wx) + '@' + Math.round(P.y) + ': ';
      if (walls.some(w => Math.abs(w.x - wx) < 4 && Math.abs(w.top - P.y) < 4)) continue;
      const cov = boxes.filter(q => Math.abs((side < 0 ? q.x1 : q.x2) - wx) < 2.5 && q.y2 > P.y - 1).map(q => [q.y1, q.y2]).sort((a, c) => a[0] - c[0]);
      let bottom = P.y; for (const [a, c] of cov) if (a <= bottom + 16) bottom = Math.max(bottom, c);
      if (FLOOR - bottom > LEVELS[LEVELS.length - 1].reach) { why.push(tag + 'too high ' + Math.round(FLOOR - bottom)); continue; }
      const footX = wx + side * 12;
      if (!inSpans(W.floor.spans, footX)) { why.push(tag + 'no floor'); continue; }
      if (!zoneFree(Math.min(wx + side * .8, wx + side * 21), P.y - 50, Math.max(wx + side * .8, wx + side * 21), FLOOR)) { why.push(tag + 'text by the wall'); continue; }
      const cx1 = Math.min(wx + side * 1.5, wx + side * 14.5), cx2 = Math.max(wx + side * 1.5, wx + side * 14.5);
      if (boxes.some(q => q.x2 > cx1 && q.x1 < cx2 && q.y2 > P.y - 30 && q.y1 < FLOOR)) { why.push(tag + 'not enough room'); continue; }
      const topX = wx - side * (Math.max(P.rad, 3) + 10);
      if (!inSpans(P.spans, topX)) { why.push(tag + 'text on top'); continue; }
      walls.push({ x: wx, side, plat: P, top: P.y, bottom, gap: FLOOR - bottom, grab: Math.max(P.y, Math.min(bottom - 4, FLOOR - 50)), footX, topX, h: FLOOR - P.y });
    }
    W.why = why;
    W.walls = walls;
    if (B.surf && B.surf.kind === 'floor') B.surf = W.floor;
    if (B.surf && B.surf.kind === 'plat') { const same = plats.find(q => Math.abs(q.y - B.surf.y) < 2 && Math.abs(q.x1 - B.surf.x1) < 2); if (same) { if (B.topSurf === B.surf) B.topSurf = same; B.surf = same; } }
    if (B.surf && B.surf.kind === 'logo') { const ok = W.logo && inSpans(W.logo.spans, B.x) && Math.abs(W.logo.y - B.surfY) < 3; if (ok && B.topSurf === B.surf) B.topSurf = W.logo; B.surf = W.logo || W.floor; if (!ok && B.mode === 'ground') { B.queue = []; begin(fall(0)); } }   // подпись сменила площадку (буквы/аватарка) — не висеть в воздухе
    W.ready = true; worldDirty = false;
  }
  // поверхность под точкой (для теней, падений)
  function surfaceBelow(x, y) {
    let best = W.floor;
    for (const s of W.plats.concat(W.logo ? [W.logo] : [])) if (inSpans(s.spans, x) && s.y >= y - 1 && s.y < best.y) best = s;
    return best;
  }

  // ===================== состояние тела =====================
  const B = {
    x: 228, y: FLOOR - HIP_H * S, yaw: .3, yawV: 0, face: 1, cam: .15, scale: 1, scaleT: 1, alpha: 1, alphaT: 1, tint: 0, tintT: 0,
    mode: 'ground', surf: W.floor, surfY: FLOOR, anchor: null, lift: 0, vx: 0, free: false, cset: 0,
    pose: pose(), from: pose(), bt: 1, bd: .28, act: null, queue: [], hist: [], lastAt: {}, t: 0,
    upCount: 0, upLimit: 4, nextPower: 1e9, lastPower: -1e9, powerSlide: -1, did: {}, bag: [], jitter: 0,
    topSurf: null, topSince: -1e9, downAt: -1e9,
    blinkAt: 1.5, blinkT: -9, clone: null, ghost: false, trail: [], fxs: [],
    sq: 0, sqV: 0, sqT: 0, capeUntil: -1, clip: null, restore: [],   // squash & stretch: + вытянут, − сплющен
  };
  function A(name, mode, fn, o) { return Object.assign({ name, mode, t: 0, fn }, o || {}); }
  function begin(a) {
    if (G3) {
      const hadBounds = !!G3.reserveBounds;
      G3.reserveW = 0; G3.reserveH = 0; G3.reserveBounds = null;
      if (hadBounds && a.name === 'idle') G3.trim = true;
      if (a.canvasScale) reserveCanvasScale(a.canvasScale);
      if (a.canvasBounds) reserveCanvasBounds(a.canvasBounds);
    }
    B.act = a; a.t = 0; B.bt = 0; B.bd = a.blend != null ? a.blend : .28; IN.arm = B.bd > 0;
    if (a.name === 'climb' || a.name === 'magnet') B.did[a.name] = 1;   // обязательные номера показаны
    B.mode = a.mode; B.lift = 0; B.vx = 0; B.free = false; B.drive = false; B.cset = a.cset || 0;
    if (a.mode === 'ground') B.surfY = B.surf.y;
    if (a.init) a.init(a);
  }
  const camSide = () => (B.face > 0 ? 0 : 1);

  // ===================== жизнь поверх любой позы =====================
  function life(p, dt) {
    const t = B.t;
    if (B.mode === 'ground' && !p.still) {
      const br = Math.sin(t * 2 * PI / 3.4);
      p.tl += .9 * br; p.sf[0] += 1.1 * br; p.sf[1] += 1.1 * br; p.hp -= .5 * br;
    }
    if (t > B.blinkAt) { B.blinkT = t; B.blinkAt = t + (chance(.18) ? .32 : rr(2.2, 5.8)); }
    const bl = t - B.blinkT; if (bl < .16) p.lid = Math.max(p.lid, bump(bl, 0, .16));
  }
  function yawStep(dt) {
    const target = B.face > 0 ? B.cam * PI / 2 : PI - B.cam * PI / 2, w = 11;
    // Точное решение пружины: разворот не зависит от FPS и не ударяется в предел после длинного кадра.
    const x = B.yaw - target, j = B.yawV + w * x, e = Math.exp(-w * dt);
    B.yaw = clamp(target + (x + j * dt) * e, 0, PI);
    B.yawV = (B.yawV - j * w * dt) * e;
  }
  const floorHandSupport = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let floorHandSupportActive = false;
  function contacts(k, set) {
    const c = [], support = floorHandSupportActive && B.act && B.act.name === 'handstand';
    for (let i = 0; i < 2; i++) { c.push(['h' + i, support ? floorHandSupport[i + 2] : k.legs[i].heel]); c.push(['t' + i, support ? floorHandSupport[i + 2] : k.legs[i].toe]); }
    if (set & 1) for (let i = 0; i < 2; i++) c.push(['k' + i, add(k.legs[i].knee, [0, 1, 0], 2.6)]);
    if (set & 2) for (let i = 0; i < 2; i++) {
      c.push(['w' + i, support ? floorHandSupport[i] : add(k.arms[i].hand, [0, 1, 0], 1.6)]);
    }
    if (set & 4) c.push(['s', k.seat]);
    if (set & 8) {
      // Только roll: низ объёма в мировом направлении вниз, включая squash вокруг стоп.
      // Точка под подбородком (-hU) при перевороте оказывалась над головой и пропускала её сквозь пол.
      const fy = feetLow(k), sy = 1 + B.sq * STYLES[STYLE].sq,
        volume = (id, p, radius) => c.push([id, [p[0], fy + (p[1] + radius - fy) * sy, p[2]]]);
      volume('hd', k.head, 7.2); volume('nk', k.neckTop, 2.6);
      for (let i = 0; i < 2; i++) volume('sh' + i, k.arms[i].sh, 4.2);
      c.push(['bk', add(k.shC, k.T[0], -5.5)]); c.push(['pb', add(k.pel, k.T[0], -5)]);
    }
    return c;
  }
  function groundSolve(k, dt) {
    const sc = S * B.scale, c = Math.cos(B.yaw), s = Math.sin(B.yaw);
    const cs = contacts(k, B.cset);
    let low = cs[0]; for (const q of cs) if (q[1][1] > low[1][1]) low = q;
    B.y = B.surfY - (low[1][1] + B.lift) * sc;
    const X = v => v[0] * c - v[2] * s;
    B.footWX = B.x + X(low[1]) * sc; B.footId = low[0];   // для замера проскальзывания стоп
    if (B.lift > .3 || B.free || B.drive) { B.anchor = null; B.x += B.vx * dt; return; }
    let cur = null; if (B.anchor) for (const q of cs) if (q[0] === B.anchor.id) cur = q;
    if (!cur || cur[1][1] < low[1][1] - .7) B.anchor = { id: low[0], wx: B.x + X(low[1]) * sc };
    else B.x = B.anchor.wx - X(cur[1]) * sc;
  }

  // ===================== базовые позы =====================
  const STAND = pose();
  const CROUCH = pose({ hf: [62, 58], kf: [94, 90], tl: 30, sf: [-45, -50], ef: [20, 20], hp: -8, af: [0, 0] });
  const PUSH = pose({ hf: [-4, -6], kf: [2, 2], af: [-38, -38], tl: 4, sf: [160, 150], ef: [10, 12], hp: -10 });
  const AIR = pose({ hf: [32, 16], kf: [50, 36], af: [-16, -16], tl: 6, sf: [120, 96], sa: [20, 20], ef: [30, 30], hp: -4 });
  const REACH = pose({ hf: [14, 6], kf: [14, 10], af: [-20, -20], tl: 8, sf: [70, 58], sa: [26, 26], ef: [24, 24] });
  const TUCK = pose({ hf: [124, 120], kf: [140, 136], af: [-30, -30], tl: 24, sf: [74, 76], ef: [58, 60], sa: [14, 14], hp: 16 });   // кисти на голенях
  const landPose = m => pose({ hf: [38 + 42 * m, 34 + 42 * m], kf: [58 + 62 * m, 54 + 62 * m], tl: 16 + 26 * m, sf: [48, 40], sa: [26, 26], ef: [30, 30], hp: 6, af: [0, 0] });
  const REACH_LOW = lowY(REACH);

  // ключевые кадры: [[t, поза], …] → функция от времени
  function keys(list) {
    const F = list.map(([t, o]) => [t, full(o) ? o : pose(o)]);
    const fn = t => {
      for (let i = 0; i < F.length - 1; i++) if (t <= F[i + 1][0]) return mix(F[i][1], F[i + 1][1], smooth((t - F[i][0]) / (F[i + 1][0] - F[i][0] || 1)));
      return copy(F[F.length - 1][1]);
    };
    fn.dur = F[F.length - 1][0];
    return fn;
  }
  // жест на месте: поза по времени, длительность, доля поворота к залу
  function gest(name, dur, cam, f, o) {
    return A(name, 'ground', (a) => { if (a.t > dur) return null; B.cam = typeof cam === 'function' ? cam(a.t) : cam; return f(a.t, a); }, o);
  }

  // ===================== походка =====================
  // фазы бега (st = .32): касание чуть впереди таза → амортизация → толчок носком → полёт, маховая
  // пятка к ягодице, бедро выносится вперёд; руки согнуты под прямым углом и работают от плеча
  function gait(ph, Ad, run, lift) {
    const p = pose(), st = run ? RUN_ST : .6, k = Math.min(1, Ad / 22);
    for (let i = 0; i < 2; i++) {
      const q = (ph + i * .5) % 1;
      if (q < st) {
        const u = q / st;
        if (run) {
          p.hf[i] = lerp(.45 * Ad, -Ad, u);
          p.kf[i] = 18 + 24 * Math.sin(PI * Math.min(1, u * 1.15));
          p.af[i] = 4 * (1 - smooth(u / .2)) - 46 * smooth((u - .45) / .55);
        } else {
          p.hf[i] = Ad * (1 - 2 * u);
          p.kf[i] = 4 + 13 * bump(u, 0, .45) * k + 26 * smooth((u - .72) / .28) * k;
          p.af[i] = 7 * k * (1 - smooth(u / .18)) - 22 * k * smooth((u - .62) / .38);
        }
      } else {
        const w = (q - st) / (1 - st);
        if (run) {
          p.hf[i] = -Ad + (1.45 * Ad + 1.1 * Ad * bump(w, .3, 1)) * smooth(w);   // вынос колена вперёд
          p.kf[i] = 18 + 105 * Math.pow(bump(w, 0, .82), .8);
          p.af[i] = lerp(-46, 2, smooth(w / .7));
        } else {
          p.hf[i] = -Ad + 2 * Ad * smooth(w);
          p.kf[i] = lerp(30 * k, 5, smooth(w)) + (30 * k + 14 * lift) * bump(w, 0, .9);
          p.af[i] = lerp(-22 * k, 7 * k, smooth(w));
        }
      }
      // бег: плечо ходит вокруг вертикали (мах бедра несимметричен, поэтому вычитаем его середину), локоть ~90°
      p.sf[i] = run ? -1.1 * (p.hf[i] + .3 * Ad) - 10 : -.85 * p.hf[i] + 4;
      p.ef[i] = run ? 84 + .9 * Math.max(0, p.sf[i]) - .1 * Math.max(0, -p.sf[i]) : 13 + 22 * Math.max(0, -p.hf[i]) / Math.max(Ad, 6);
      p.sa[i] = run ? 12 : 7;
    }
    const q0 = ph % 1;
    p.tl = run ? 17 + 3 * Math.cos(4 * PI * q0) : 4 + Ad * .07;
    p.hp = run ? -4 : -2 + 2 * Math.cos(4 * PI * q0) * k;   // голова гасит покачивание
    return p;
  }
  // идти к x; kind: walk | jog | run | zip (суперскорость)
  function walkTo(tx, kind, o) {
    kind = kind || 'walk'; o = o || {};
    const vmax = { walk: 31, jog: 62, run: 104, zip: zipSpeed }[kind], acc = { walk: 70, jog: 110, run: 160, zip: 2400 }[kind];
    const run = kind !== 'walk';
    let v = 0, ph = .02, turn = 0, turnPose = null, handoffAt = null, glance = rr(1.5, 4), zipRun = 0, zipKnee = null;
    const blendGait = (p, t, dt) => {
      const result = o.entryPose && t < .2 ? mix(o.entryPose, p, smooth(t / .2)) : p;
      if (kind === 'zip') {
        if (!zipKnee) zipKnee = result.kf.slice();
        const weight = 1 - Math.exp(-dt / .03);
        for (let i = 0; i < 2; i++) result.kf[i] = zipKnee[i] = lerp(zipKnee[i], result.kf[i], weight);
      }
      return result;
    };
    return A('walk', 'ground', (a, dt) => {
      const dir = Math.sign(tx - B.x) || B.face;
      if (a.t === 0 || (dir !== B.face && v < 6)) { if (dir !== B.face) { turn = .42; handoffAt = null; } B.face = dir; }
      B.cam = o.cam || 0;
      // тело едет по скорости, а не за опорной стопой: перецепка пятка → носок → другая нога давала
      // рывки 0…140 px/с внутри шага, а на торможении — скачки назад
      B.drive = true; B.vx = 0;
      let d = (tx - B.x) * B.face;
      if (turn > 0) { turn -= dt; turnPose = gait(ph, 0, false, 1); ph += dt / .5; return blendGait(turnPose, a.t, dt); }
      if (d < 1.2 && v < 10) return null;
      if (d < -2) return null;
      const vT = Math.min(vmax, Math.sqrt(2 * acc * Math.max(0, d - 1)));
      v += clamp(vT - v, -acc * 1.6 * dt, acc * dt);
      const vm = v / PX_M;
      // бег и шаг смешиваются плавно по скорости — без переключения формул на пороге
      let rk = run ? smooth((v - 22) / 26) : 0;
      // Zip пересекает весь диапазон walk→run за один кадр: формула
      // скорости остаётся прежней, а поза сменяет режим за короткую паузу.
      if (kind === 'zip') { zipRun += (rk - zipRun) * (1 - Math.exp(-dt / .08)); rk = zipRun; }
      const T = lerp(clamp(1.12 - .18 * vm, .82, 1.15), clamp(.74 - .05 * vm, .52, .72), rk);
      const st = lerp(.6, RUN_ST, rk), sweep = lerp(2, 1.45, rk);   // доля амплитуды, которую стопа проходит в опоре
      const Ad = deg(Math.asin(clamp(v / (S * B.scale) * st * T / (sweep * (L.thigh + L.shin)), 0, lerp(.55, .78, rk))));
      const G = q => rk <= 0 ? gait(q, Ad, false, 0) : rk >= 1 ? gait(q, Ad, true, 0) : mix(gait(q, Ad, false, 0), gait(q, Ad, true, 0), rk);
      // подгонка шага: в опоре фаза идёт так, чтобы опорная стопа стояла на полу при скорости v
      let rate = 1 / T;
      { const q = ph % 1, air = rk * Math.max(bump(q, RUN_ST - .02, .52), bump(q, RUN_ST + .48, 1.02)) * 9 > .3;
        if (!air && v > 3) {
          const e = .004, ys = Math.cos(B.yaw) >= 0 ? 1 : -1, c = Math.cos(B.yaw), sn = Math.sin(B.yaw), sc = S * B.scale;
          const c0 = contacts(solve(G(ph), ys), 0); let lo = c0[0]; for (const w of c0) if (w[1][1] > lo[1][1]) lo = w;
          const c1 = contacts(solve(G(ph + e), ys), 0).find(w => w[0] === lo[0]);
          const dX = ((c1[1][0] - lo[1][0]) * c - (c1[1][2] - lo[1][2]) * sn) * sc / e;   // px на единицу фазы
          const r = -v * B.face / dX;
          if (r > 0) rate = clamp(r, .45 / T, 2.2 / T);
        } }
      ph += dt * rate;
      // Последний шаг разворота может держать поднятое колено: не обнуляем его при lift1→lift0.
      // Скорость, путь и фаза продолжаются как прежде; смешивается только сырая поза до life/MIND.
      if (turnPose && handoffAt == null) handoffAt = a.t;
      const target = G(ph), u = handoffAt == null ? 1 : smooth((a.t - handoffAt) / .2);
      if (kind === 'zip') target.tl = 24;
      const p = turnPose ? mix(turnPose, target, u) : target;
      if (u >= 1) turnPose = null;
      { const q = ph % 1; B.lift = 9 * rk * Math.max(bump(q, RUN_ST - .02, .52), bump(q, RUN_ST + .48, 1.02)); }
      B.vx = v * B.face;
      if (kind === 'zip') { B.free = true; B.lift = 0; }
      if (a.t > glance && a.t < glance + 1.1) p.hy = 40 * bump(a.t - glance, 0, 1.1);
      if (a.t > glance + 1.1) glance = a.t + rr(2.5, 6);
      if (o.stumbleAt && a.t > o.stumbleAt) { B.queue.unshift(() => stumble(), () => walkTo(tx, kind)); return null; }
      return blendGait(p, a.t, dt);
    });
  }
  // спотыкается: носок цепляется, большой шаг-подхват, оглядывается
  function stumble() {
    const ci = 0;
    const k = keys([[0, gait(.3, 24, false, 0)],
      [.14, { hf: [16, -34], kf: [10, 46], tl: 30, sf: [72, 64], sa: [34, 30], ef: [20, 24], hp: -8, af: [0, -30] }],
      [.4, { hf: [48, -22], kf: [22, 30], tl: 24, sf: [40, 90], sa: [50, 20], ef: [30, 20], hp: 4, af: [8, -20] }],
      [.62, { hf: [30, -10], kf: [26, 18], tl: 14, sf: [-10, 30], sa: [30, 24], ef: [20, 20], hp: 10 }],
      [1.05, { hf: [4, -2], kf: [6, 4], tl: 4, hp: 26, hy: -10 }],
      [1.7, { hy: 30, smile: 1, sf: sd(ci, 10, -3), ef: sd(ci, 40, 9) }], [2.1, {}]]);
    return gest('stumble', k.dur, .15, t => k(t), { blend: .1 });
  }

  // ===================== жесты =====================
  function idle(dur, o) {
    o = o || {}; const s0 = rr(0, 9), look = rr(.8, 2.5);
    return gest('idle', dur, o.cam != null ? o.cam : .15, t => {
      const p = pose({ hf: [3, -2.5], kf: [3, 5] });
      const w = Math.sin(t * 2 * PI / 6.5 + s0);
      p.kf[0] += Math.max(0, 7 * w); p.kf[1] += Math.max(0, -7 * w);
      p.hp = 3 * Math.sin(t * .7 + s0);
      if (t > look && t < look + 1.6) p.hy = 22 * bump(t - look, 0, 1.6);
      return p;
    });
  }
  function lookSlide() {
    const up = { hp: -34, tl: -3, hy: 12, sf: [5, -3], sa: [7, 7], ef: [12, 9] };
    const h = rr(0, 2.2);   // иногда задерживает взгляд подольше
    const k = keys([[0, {}], [.45, up], [1.3 + h, up], [1.45 + h, Object.assign({}, up, { hp: -26 })], [1.6 + h, up], [2.0 + h, {}]]);   // взглянуть, не зависая
    return gest('lookSlide', k.dur, .35, t => k(t));
  }
  function lookHall() {
    const k = keys([[0, {}], [.4, { hy: 30, smile: 1 }], [1.0, { hy: 30, smile: 1, hp: 8 }], [1.2, { hy: 30, smile: 1 }], [1.6, { hy: 30, smile: 1 }], [2.0, {}]]);
    return gest('lookHall', k.dur, .75, t => k(t));
  }
  function wave() {
    // плечо в сторону чуть ниже горизонтали, предплечье вертикально — машет от локтя (ea задаёт предплечье в абсолютных осях, не кисть)
    const ci = camSide(), arm = { sa: sd(ci, 82, 6), sf: sd(ci, 15, -3), ef: sd(ci, 0, 9), ea: sd(ci, 110, 0), hy: 18, smile: 1 };
    const k = keys([[0, {}], [.35, arm], [2, arm], [2.4, {}]]);
    return gest('wave', 2.4, .7, t => {
      const p = k(t); p.ea[ci] += 18 * Math.sin((t - .3) * 2 * PI * 1.8) * bump(t, .25, 2.1);
      p.handOpen = sd(ci, smooth(t / .35) * (1 - smooth((t - 2) / .4)), 0);
      p.handFacing = p.handOpen;
      return p;
    });
  }
  function yawn() {
    const ci = camSide(), y = { tl: -2, hp: -8, mouth: 1, lid: .7 };
    for (const key in MOUTH) y[key] = sd(ci, MOUTH[key], STAND[key][1 - ci]);
    const k = keys([[0, {}], [.6, Object.assign({}, y, { mouth: .4 })], [1.4, y], [2.2, y], [2.7, { hp: 6, smile: .5 }], [3.1, {}]]);
    return gest('yawn', k.dur, .55, t => {
      const p = k(t);
      p.handOpen = sd(ci, .9 * smooth(t / .4) * (1 - smooth((t - 2.3) / .5)), 0);
      p.still = t > .3 && t < 2.6 ? 1 : 0;
      return p;
    });
  }
  function stretch() {
    const y = { tl: -4, sf: [176, 170], sa: [10, 10], ef: [4, 6], af: [-30, -30], hp: -16, kf: [0, 0], hf: [0, 0] };
    const k = keys([[0, {}], [.7, y], [1.8, y], [2.4, {}]]);
    return gest('stretch', k.dur, .4, t => k(t));
  }
  function squats(n) {
    // вполоборота к залу и ноги шире: в профиль обе ноги сливаются в одну и присед читается как «пистолетик» на одной ноге
    const DN = pose({ hf: [96, 96], kf: [124, 124], tl: 40, sf: [100, 100], ef: [18, 18], hp: -12, af: [0, 0], ha: [16, 16] });
    const UP = pose({ sf: [90, 90], ef: [18, 18], ha: [14, 14] });
    const rep = 1.7;
    return gest('squats', n * rep + .5, .72, t => { if (t > n * rep) return mix(UP, STAND, smooth((t - n * rep) / .5)); return mix(UP, DN, (1 - Math.cos(2 * PI * t / rep)) / 2); });
  }
  function jacks(n) {
    const rep = .74;
    return gest('jacks', n * rep + .3, 1, t => {
      const p = pose({ smile: .7 });
      if (t > n * rep) return p;
      const u = (t / rep) % 1, o = (1 - Math.cos(2 * PI * u)) / 2;
      p.sa = [10 + 152 * o, 10 + 152 * o]; p.sf = [0, 0]; p.ef = [8, 8]; p.ea = [-10 * o, -10 * o];
      p.ha = [3 + 15 * o, 3 + 15 * o]; p.kf = [6 + 10 * Math.abs(Math.sin(2 * PI * u)), 6 + 10 * Math.abs(Math.sin(2 * PI * u))];
      p.af = [-8, -8]; p.hf = [3, 3];
      B.lift = 3.6 * Math.pow(Math.abs(Math.sin(2 * PI * u)), .7);
      return p;
    });
  }
  function toeTouch(n) {
    const DN = pose({ tl: 102, hf: [14, 14], kf: [5, 5], sf: [110, 110], ef: [4, 4], hp: 26, af: [0, 0] }), rep = 2.6;
    return gest('toeTouch', n * rep, .3, t => mix(STAND, DN, (1 - Math.cos(2 * PI * t / rep)) / 2));
  }
  function sideBend(n) {
    const rep = 2.8;
    return gest('sideBend', n * rep, 1, t => {
      const s = Math.sin(2 * PI * t / rep), p = pose({ ha: [7, 7] });
      p.ts = 26 * s;
      const up = s > 0 ? 1 : 0, dn = 1 - up, a = Math.abs(s);
      p.sa[up] = 10 + 140 * a; p.ea[up] = -30 * a; p.ef[up] = 4 + 6 * a;
      // При боковом сгибе отводим нижнюю руку от бедра; в нуле обе руки начинают с 10°.
      p.sa[dn] = 10 + 32 * a; p.ef[dn] = 4;
      return p;
    });
  }
  // Посадка на пол. Руки у фигуры короткие (плечо сидя на 32 ед. над полом, рука — 29), так что
  // «упёрся руками сзади» не собирается — кисти повисают в воздухе. Поэтому сидит, обняв колени:
  // таз и стопы на полу, кисти сцеплены на голенях — опора видна. У логотипа — спиной к знаку,
  // кисти на коленях. Углы подобраны по геометрии (__buddy.kin): таз и подошвы на одной высоте.
  const SQUAT = pose({ hf: [100, 100], kf: [128, 128], tl: 34, sf: [40, 40], ef: [30, 30], af: [0, 0], sa: [4, 4] });
  const SIT_HUG = pose({ hf: [137, 135], kf: [93, 89], tl: 5, sf: [8, 10], ef: [76, 72], sa: [-4, -4], af: [0, 0], hp: 4 });
  const SIT_BACK = pose({ hf: [134, 132], kf: [86, 82], tl: -12, sf: [20, 22], ef: [79, 77], sa: [20, 18], ea: [-46, -44], af: [0, 0], hp: -2 });
  function sitRest(dur, lean, backX) {   // backX — куда опустить таз, чтобы спина легла на знак
    const SIT = lean ? SIT_BACK : SIT_HUG;
    const D = dur || rr(6, 11), ph = rr(0, 6);
    let held = SIT;
    return gest('sitRest', D + 2.1, () => .35, t => {
      if (backX != null && t < 1.05 && B.anchor) B.anchor.wx += (backX - B.x) * .12;   // присаживаясь, подшагивает к знаку
      if (t < .5) return mix(STAND, SQUAT, smooth(t / .5));
      if (t < 1.05) return mix(SQUAT, SIT, smooth((t - .5) / .55));
      if (t < 1.05 + D) {
        const p = copy(SIT), u = t - 1.05 + ph, br = Math.sin(u * 2 * PI / 3.6), fade = smooth((t - 1.05) / .3);
        p.tl += (1.4 * br + (lean ? 0 : 2.5 * Math.sin(u * .9))) * fade; // дышит; обняв колени — чуть покачивается
        p.hp += 2 * br * fade; p.hy = 30 * bump(((u + 1) % 6.5) / 6.5, .15, .55) * fade;
        if (lean) p.kf[1] += 2 * Math.max(0, Math.sin(u * 1.1)) * fade;
        p.smile = lerp(SIT.smile, .2 + .7 * Math.min(1, p.hy / 18), fade);
        held = copy(p); // подъём начинается из настоящего поворота головы и покачивания, без сброса к SIT
        p.still = 1;
        return p;
      }
      const u = t - 1.05 - D;
      return u < .55 ? mix(held, SQUAT, smooth(u / .55)) : mix(SQUAT, STAND, smooth((u - .55) / .5));
    }, { cset: 6 });
  }
  function clap() {
    return gest('clap', 2.4, 1, t => {
      // локти у боков, предплечья вперёд и к середине — ладони сходятся перед грудью (o = 0 — хлопок)
      const p = pose({ sf: [32, 32], sa: [14, 14], ef: [78, 78], smile: 1, hy: 0 }), o = (1 + Math.sin(t * 2 * PI * 3.4)) / 2;
      p.ea = [-46 + 62 * o, -46 + 62 * o];
      const amount = Math.min(smooth(t / .25), smooth((2.4 - t) / .25)), q = amount < 1 ? mix(STAND, p, amount) : p;
      q.handContact = 'clap'; q.handContactAmount = amount;
      return q;
    });
  }
  function point() {
    const ci = camSide(), y = { sf: sd(ci, 146, -3), ef: sd(ci, 4, 9), sa: sd(ci, 8, 40), hp: -26, hy: 6 };
    y.sf[1 - ci] = -30; y.sa[1 - ci] = 29; y.ef[1 - ci] = 59; y.ea = sd(ci, 0, -44);   // вторая рука — на поясе (подобрано по цели кисти)
    const k = keys([[0, {}], [.4, y], [1.6, y], [1.75, Object.assign({}, y, { hy: 34, smile: 1 })], [2.4, Object.assign({}, y, { hy: 34, smile: 1 })], [2.8, {}]]);
    return gest('point', k.dur, .4, t => k(t));
  }
  // ===================== занятия с реквизитом: табурет и попкорн, книга, блокнот =====================
  // Реквизит — маленький SVG поверх фигуры (fxFront) или за ней (fxBack). Живёт, пока действие его «пингует»
  // каждый кадр: оборвали действие (смена слайда, способность) — вещь исчезает сама.
  // Позы рук подобраны по цели кисти (__buddy.kin + перебор), а не на глаз: у предплечья абсолютные оси.
  function prop(layer, build, draw) {
    const st = { ping: true, miss: 0 };
    custom(1e6, () => build(mk('g', {}, layer)), (o, dt) => {
      st.miss = st.ping ? 0 : st.miss + dt; st.ping = false;
      if (st.done || st.miss > .2) { o.age = o.life; o.el.remove(); return; }
      draw(o.el, st, dt);
    });
    return st;
  }
  // 3D-реквизит (proto3d/rig3d.js, api.prop): та же жизнь по пингу, но рисуется в сцене фигуры — со светотенью
  // и контуром тела. fn(st, k) возвращает параметры вещи на этот кадр (см. api.prop) или null.
  const P3 = new Map();
  function prop3(name, fn) { const st = { ping: true, miss: 0 }; P3.set(name, { st, fn }); return st; }
  const legacyGripW = [[0, 0], [0, 0]];
  const legacyGrip = side => G3 && G3.on && legacyHandPoint(G3.rig, side, legacyGripW[side]) ? legacyGripW[side] : fig.handsW[side];
  const tc = (p, d) => [p[0], p[1], p[2] + d * B.face];   // цель, сдвинутая к зрителю: страница на ¾, а не ребром
  const hMid = (k, up) => { const a = k.arms[0].hand, b = k.arms[1].hand; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - (up || 0), (a[2] + b[2]) / 2]; };
  const seatW = () => { const k = B.kk, sc = S * B.scale; return k ? [B.x + k.seat[0] * Math.cos(B.yaw) * sc, B.y + k.seat[1] * sc] : [B.x, B.y]; };
  const CHAIR = pose({ hf: [90, 88], kf: [90, 88], tl: 2, af: [0, 0], sf: [1, 1], sa: [-10, -10], ef: [58, 58], ea: [-1, -1], hp: -14 });
  const MOUTH = { sf: 101, sa: 3, ef: 93, ea: -38 };               // кисть у рта, сидя: локоть вперёд на уровне плеча (подбор по 3D-лицу)
  const LAP = { sf: 1, sa: -10, ef: 58, ea: -1 };                  // кисть на коленях (в ведёрке)
  const armSet = (p, i, a) => { for (const k in a) p[k][i] = a[k]; };
  const armMix = (p, i, a, b, u) => { for (const k in a) p[k][i] = a[k] + (b[k] - a[k]) * u; };

  // раскладывает табуреточку, садится и смотрит слайд с попкорном
  function popcorn(D) {
    if (B.surf.kind !== 'floor') return null;
    D = D || rr(8, 12);
    const f = B.x < 640 ? 1 : -1; B.face = f;
    const ci = camSide(), fi = 1 - ci, T = D + 3.4;
    const REACH = pose({ sf: sd(ci, -24, -3), ef: sd(ci, 40, 9), sa: sd(ci, 14, 7), hy: 10 });
    let x0 = null, eatAt = 2.6;
    const SW = 10, kernels = [[-2, 0], [0, -1.2], [2, -.2], [-.8, -1.8], [1.2, -2]];
    const stool = prop3('stool', (st, k) => ({ atW: [st.x, st.bot], side: lerp(k.arms[ci].hand[2], 0, st.place), H: Math.max(4, (st.bot - st.top) / (S * B.scale)), open: st.open, k: Math.max(.01, st.al) }));
    const bucket = prop3('bucket', (st, k) => st.k > 0 ? { at: [k.arms[fi].hand[0], k.arms[fi].hand[1] - 2.4, k.arms[fi].hand[2]], k: st.k } : null);
    const grab = prop3('handful', (st, k) => st.on ? { at: k.arms[ci].hand } : null);   // горсть — по пути ко рту
    stool.open = 0; stool.al = 0; stool.place = 0; stool.x = B.x; stool.top = B.y; stool.bot = B.y; bucket.k = 0; grab.on = false;
    return gest('popcorn', T, .35, (t) => {
      stool.ping = bucket.ping = grab.ping = true; B.face = f;
      const sc = S * B.scale, h = fig.handsW[ci];
      // табурет: из кармана — сложенный в руке, ставится за спиной и раскрывается
      if (t < .5) { stool.al = smooth(t / .25); stool.open = 0; stool.place = 0; stool.x = h[0]; stool.top = h[1] - 7; stool.bot = h[1] + 4; }
      else if (t < 1.1 || x0 == null) {
        if (x0 == null) x0 = B.x - f * 22.6 * Math.abs(Math.cos(B.yaw)) * sc;   // куда сядет таз (кинематика CHAIR)
        const u = smooth((t - .5) / .6), top = B.surfY - 18 * sc;
        stool.x = lerp(h[0], x0, u); stool.top = lerp(h[1] - 7, top, u); stool.bot = lerp(h[1] + 4, B.surfY, u); stool.open = smooth((t - .75) / .35); stool.place = u;
      } else if (t < T - 1.0) { stool.x = x0; stool.bot = B.surfY; stool.top = Math.min(B.surfY - 4, Math.max(B.surfY - 18 * sc, seatW()[1])); stool.open = 1; stool.place = 1; }   // пока не сел, табурет своей высоты, а не до таза
      else {   // встал — складывает и прячет
        const u = smooth((t - T + 1.0) / .7);
        stool.open = 1 - smooth(u / .5); stool.place = 1 - u; stool.x = lerp(x0, h[0], u); stool.top = lerp(B.surfY - 18 * sc, h[1] - 7, u); stool.bot = lerp(B.surfY, h[1] + 4, u); stool.al = 1 - smooth((u - .6) / .4);
        if (t > T - .05) stool.done = true;
      }
      bucket.k = smooth((t - 1.7) / .3) * (1 - smooth((t - (T - 1.6)) / .3));
      if (t > 1.75 && t < 1.85 && !bucket.pop) { bucket.pop = 1; sparks(fig.handsW[fi][0], fig.handsW[fi][1] - 4, 4, '#FFD84D'); }
      if (bucket.k <= 0 && t > T - 1.3) bucket.done = grab.done = true;
      // поза
      if (t < .5) return mix(STAND, REACH, smooth(t / .4));
      if (t < 1.1) return mix(REACH, STAND, smooth((t - .5) / .4));
      if (t < 1.8) return mix(STAND, CHAIR, smooth((t - 1.1) / .7));
      if (t > T - 1.0) return mix(CHAIR, STAND, smooth((t - T + 1.0) / .7));
      const p = copy(CHAIR), u = t - 1.8;
      p.still = 1; p.smile = .45; p.hy = 14 * bump((u % 7) / 7, .55, .8);   // иногда косится в зал
      p.tl += .8 * Math.sin(u * 2 * PI / 3.6); p.hp += 2 * Math.sin(u * 1.3);
      // горсть: из ведёрка ко рту и обратно, жуёт
      if (t > eatAt + 1.6) eatAt = t + rr(.6, 1.8) + (t > T - 3.4 ? 99 : 0);   // под конец ведёрко уже убирает — не ест
      const e = t - eatAt;
      grab.on = e > .05 && e < .6;
      if (e > 0 && e < .45) armMix(p, ci, LAP, MOUTH, smooth(e / .45));
      else if (e >= .45 && e < .85) { armSet(p, ci, MOUTH); p.mouth = .3 + .3 * Math.abs(Math.sin(e * 22)); }
      else if (e >= .85 && e < 1.3) armMix(p, ci, MOUTH, LAP, smooth((e - .85) / .45));
      else armSet(p, ci, LAP);
      if (e > 1.3 && e < 1.6) p.mouth = .2 * Math.abs(Math.sin(e * 20));
      if (e > .1 && e < .2 && chance(.08)) particle({ x: h[0], y: h[1], vx: rr(-8, 8), vy: rr(-12, -4), r: .9, life: .7, fill: '#FFF3CF', grow: 0, g: 160, op: 1 });   // уронил зёрнышко
      return p;
    });
  }

  // садится по-турецки и читает книжку, переворачивая страницы
  const LOTUS_FLOOR = pose({ hf: [105, 105], ha: [48, 48], kf: [40, 48], ka: [-108, -108], tl: 8, af: [0, 0],
    sf: [-11, -11], sa: [0, 0], ef: [117, 117], ea: [-16, -16], hp: 28 });   // таз на полу (замер по 3D), кисти держат книгу у груди
  function readBook(D) {
    if (B.surf.kind !== 'floor') return null;
    D = D || rr(8, 12);
    const f = B.face, ci = camSide(), T = D + 2.8;
    let flipAt = 2.6 + rr(1.5, 2.5);
    const book = prop3('book', (st, k) => st.k > 0 ? { at: hMid(k), grip: [0, -4.6, -.8], to: tc(k.head, 9), up: [1, -.4, 0], k: st.k * 1.3, open: st.open, flip: st.flip } : null);   // страницами к лицу
    book.k = 0; book.open = 1; book.flip = 0;
    return gest('read', T, .4, (t) => {
      book.ping = true; B.face = f;
      book.k = smooth((t - .95) / .3) * (1 - smooth((t - (T - 1.45)) / .3));
      book.open = 1 - .7 * smooth((t - (T - 1.75)) / .3);
      if (book.k <= 0 && t > T - 1.3) book.done = true;
      if (t < .5) return mix(STAND, SQUAT, smooth(t / .5));
      if (t < 1.2) return mix(SQUAT, LOTUS_FLOOR, smooth((t - .5) / .7));
      if (t > T - 1.15) { const u = t - T + 1.15; return u < .55 ? mix(LOTUS_FLOOR, SQUAT, smooth(u / .55)) : mix(SQUAT, STAND, smooth((u - .55) / .5)); }
      const p = copy(LOTUS_FLOOR), u = t - 1.2;
      p.still = 1; p.smile = .25 + .5 * bump((u % 5) / 5, .6, .75); p.hp += 3 * Math.sin(u * .9); p.tl += .7 * Math.sin(u * 2 * PI / 3.8);
      p.lid = .25;
      // страница: ближняя рука перекидывает лист
      if (t > flipAt + 1.1) flipAt = t + rr(2.4, 3.6);
      const e = t - flipAt;
      book.flip = e > .15 && e < .75 ? (e - .15) / .6 : 0;
      if (e > 0 && e < .9) { p.ea[ci] += 22 * bump(e, 0, .9); p.sf[ci] += 8 * bump(e, 0, .9); }
      return p;
    }, { cset: 4 });
  }

  // увидел на слайде что-то стоящее — лампочка, достаёт блокнот и записывает
  const NOTE = pose({ sf: [19, -12], sa: [-13, -1], ef: [144, 140], ea: [-6, -32], hp: 26 });   // [пишущая, держащая] — переставляется по camSide
  function noteIdea() {
    const f = B.face, ci = camSide(), fi = 1 - ci, T = 5.8;
    const P = copy(NOTE); for (const k of ['sf', 'sa', 'ef', 'ea']) { const w = NOTE[k][0], hld = NOTE[k][1]; P[k][ci] = w; P[k][fi] = hld; }
    const LOOK = pose({ hp: -26, hy: 6, brow: .9, mouth: .35 });
    // блокнот держат за нижний край (grip), страница — к лицу; карандаш смотрит в текущую строку
    const PK = 1.45, PUP = [1, -.6, 0], unit = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
    const padFrame = k => {
      const at = k.arms[fi].hand, to = tc(k.head, 20), n = unit([to[0] - at[0], to[1] - at[1], to[2] - at[2]]);
      const d = PUP[0] * n[0] + PUP[1] * n[1] + PUP[2] * n[2], u = unit([PUP[0] - n[0] * d, PUP[1] - n[1] * d, PUP[2] - n[2] * d]);
      return { at, n, u };
    };
    const pad = prop3('pad', (st, k) => st.k > 0 ? { at: k.arms[fi].hand, grip: [0, -4.4, -.9], to: tc(k.head, 20), up: PUP, k: st.k * PK, lines: st.lines } : null);
    const pencil = prop3('pencil', (st, k) => {
      if (pad.k <= 0) return null;
      const F = padFrame(k), ly = 4.4 + 2.8 - 1.15 * Math.min(5, pad.lines);   // текущая строка, от нижнего края
      const pt = add(add(F.at, F.u, ly * PK), F.n, 1.5 * PK); pt[2] += pad.wx || 0;
      return { at: k.arms[ci].hand, to: pt, k: pad.k };   // остриём в строку
    });
    pad.k = 0; pad.lines = 0;
    return gest('note', T, .45, (t) => {
      pad.ping = pencil.ping = true; B.face = f;
      if (t > .35 && !pad.bulb) { pad.bulb = 1; MIND.bubbleAt = Math.min(MIND.bubbleAt, W.time - 18); MIND.bubble('bulb'); MIND.sur = Math.max(MIND.sur, .6); }
      pad.k = smooth((t - 1.05) / .2) * (1 - smooth((t - 5.05) / .2));   // появляется, когда руки уже на месте
      if (pad.k <= 0 && t > 5.2) pad.done = pencil.done = true;
      const writing = (t > 1.25 && t < 3.3) || (t > 3.85 && t < 4.75);
      pad.lines = Math.min(6, Math.floor(2.2 * (clamp(t - 1.25, 0, 2.05) + clamp(t - 3.85, 0, .9))));   // строчки появляются, пока пишет
      if (t < .5) return mix(STAND, LOOK, smooth(t / .4));
      if (t < .85) return LOOK;
      if (t < 1.25) return mix(LOOK, P, smooth((t - .85) / .4));
      let p;
      if (t < 3.3) p = copy(P);
      else if (t < 3.85) p = mix(P, Object.assign(copy(P), { hp: -22, brow: .7 }), bump(t, 3.3, 3.85) * 1.4 > 1 ? 1 : bump(t, 3.3, 3.85) * 1.4);   // сверяется со слайдом
      else if (t < 4.75) p = copy(P);
      else if (t < 5.2) { p = copy(P); p.hp = 26 - 18 * bump(t, 4.75, 5.2); p.smile = 1; }   // кивнул сам себе
      else return mix(P, pose({ smile: 1, hy: 20 }), smooth((t - 5.2) / .55));
      pad.wx = writing ? 1.6 * Math.sin(t * 5.5) : 0;   // остриё ходит вдоль строки
      if (writing) { p.sa[ci] += 4 * Math.sin(t * 5.5); p.ef[ci] += 1.5 * Math.sin(t * 23); }
      p.still = 1; p.smile = Math.max(p.smile, .5);
      return p;
    });
  }
  function dance(dur) {
    return gest('dance', dur || 4.2, 1, t => {
      const p = pose({ smile: 1 }), b = Math.sin(t * 2 * PI * 2), s = Math.sin(t * 2 * PI);
      p.kf = [10 + 16 * (b + 1) / 2, 10 + 16 * (1 - b) / 2]; p.hf = [6 + 8 * (b + 1) / 2, 6 + 8 * (1 - b) / 2];
      p.ts = 9 * s; p.hp = 6 * b;
      p.sa = [70 + 70 * Math.max(0, s), 70 + 70 * Math.max(0, -s)]; p.ef = [80 - 50 * Math.max(0, s), 80 - 50 * Math.max(0, -s)];
      p.ha = [6, 6];
      return t < .3 ? mix(STAND, p, smooth(t / .3)) : t > (dur || 4.2) - .3 ? mix(p, STAND, smooth((t - (dur || 4.2) + .3) / .3)) : p;
    });
  }
  // стойка на руках
  function handstand() {
    const k = keys([[0, {}],
      [.5, { sf: [172, 172], ef: [2, 2], tl: 0 }],
      [.95, { hf: [44, -8], kf: [44, 0], tl: 26, sf: [168, 168], ef: [0, 0], hp: -45 }],
      [1.45, { rot: 92, hf: [92, -24], kf: [70, 0], tl: 0, sf: [176, 176], ef: [0, 0], af: [0, -30], hp: -45 }],
      [2.0, { rot: 176, hf: [12, -14], kf: [10, 0], sf: [178, 178], ef: [0, 0], af: [-34, -34], hp: -40 }],
      [2.4, { rot: 180, hf: [0, 0], kf: [0, 0], sf: [180, 180], ef: [0, 0], af: [-36, -36], hp: -40 }],
      [3.9, { rot: 180, hf: [0, 0], kf: [0, 0], sf: [180, 180], ef: [0, 0], af: [-36, -36], hp: -40 }],
      [4.4, { rot: 176, hf: [-14, 14], kf: [0, 10], sf: [178, 178], ef: [0, 0], af: [-30, -30], hp: -40 }],
      [5.0, { rot: 92, hf: [-24, 92], kf: [0, 70], sf: [176, 176], ef: [0, 0], af: [-30, 0], hp: -40 }],
      [5.5, { hf: [-8, 44], kf: [0, 44], tl: 26, sf: [168, 168] }],
      [6.0, { sf: [150, 150], sa: [40, 40], smile: 1 }], [6.5, {}]]);
    // вполоборота к залу (cam .45) и с чуть разведёнными руками: в чистом профиле руки прячутся за головой
    return gest('handstand', k.dur, .45, t => { const p = k(t); if (t > 2.4 && t < 3.9) { p.rot += 3 * Math.sin((t - 2.4) * 5); p.ha = [4 + 3 * Math.sin(t * 4), 4 - 3 * Math.sin(t * 4)]; } const sp = 14 * Math.min(1, 2 * bump(t, 1, 5.4)); p.sa = [sp, sp]; p.handContact = 'floor'; p.handContactAmount = Math.min(smooth((t - .8) / .6), smooth((5.6 - t) / .6)); return p; }, { cset: 2 });
  }
  // кувырок вперёд после большого падения
  function rollOver() {
    const d = .9;
    return A('roll', 'ground', (a) => {
      if (a.t > d + .45) return null;
      B.free = true; B.cset = 15;
      const u = clamp(a.t / d, 0, 1);
      B.vx = a.t < d ? 34 * B.face : 0;
      const p = mix(TUCK, STAND, smooth((a.t - d) / .45));
      p.rot = a.t < d ? 360 * smooth(u) : 0;
      return p;
    }, { blend: .1, cset: 15 });
  }

  // ===================== прыжки, падения =====================
  // прыжок на поверхность surf в точку tx; o.apex — запас высоты, o.flip — сальто (−360 назад)
  function jumpTo(tx, surf, o) {
    o = o || {};
    let ph = 0, t0 = 0, x0, y0, y1, vx, vy0, T, m = 0, touchdown;
    const G = 9.81 * PX_M * (o.gk || 1), crouch = o.quick ? mix(STAND, CROUCH, .35) : CROUCH,
      launch = o.quick ? mix(STAND, PUSH, .3) : PUSH;
    return A('jump', 'ground', (a) => {
      if (ph === 0) {
        if (Math.abs(tx - B.x) > 3) B.face = Math.sign(tx - B.x);
        B.cam = o.cam || 0;
        const c1 = o.quick ? .08 : .24, c2 = o.quick ? .14 : .44;
        if (a.t < c2) {
          const p = a.t < c1 ? mix(STAND, crouch, smooth(a.t / c1)) : mix(crouch, launch, smooth((a.t - c1) / (c2 - c1))),
            swing = smooth(a.t / c2);
          // Мах рук начинается вместе с приседом: весь разворот не умещается в последние 60–100 мс.
          for (const key of ['sf', 'sa', 'ef', 'ea']) p[key] = STAND[key].map((value, i) => lerp(value, launch[key][i], swing));
          if (a.t < c1) B.sqT = -.12 * (o.quick ? .35 : 1) * smooth(a.t / c1);
          return p;
        }
        B.sqV += 4.2; dust(B.x, B.surfY, .4);
        ph = 1; t0 = a.t; B.mode = 'free';
        x0 = B.x; y0 = B.y; y1 = surf.y - REACH_LOW * S * B.scale;
        const top = Math.min(y0, y1) - (o.apex != null ? o.apex : 10);
        vy0 = -Math.sqrt(2 * G * (y0 - top));
        const td = Math.sqrt(2 * (y1 - top) / G);
        T = -vy0 / G + td; vx = (tx - x0) / T; m = clamp(td / .55, 0, 2);
      }
      if (ph === 1) {
        const t = Math.min(a.t - t0, T), u = t / T;
        B.x = x0 + vx * t; B.y = y0 + vy0 * t + .5 * G * t * t;
        B.sqT = Math.min(.16, Math.abs(vy0 + G * t) / 1500);
        let p = u < .5 ? mix(launch, AIR, smooth(u / .5)) : mix(AIR, REACH, smooth((u - .5) / .5));
        if (o.flip) { p = mix(p, TUCK, smooth((u - .02) / .34) * (1 - smooth((u - .6) / .38))); p.rot = o.flip * smooth((u - .06) / .8); }
        if (o.arms === 'V') {
          const raised = copy(p); raised.sf = [10, 10]; raised.sa = [150, 150]; raised.ef = [8, 8]; raised.smile = 1;
          p = mix(p, raised, smooth(u / .4));
        }
        if (a.t - t0 >= T) {
          touchdown = copy(p); touchdown.rot = ((touchdown.rot + 180) % 360 + 360) % 360 - 180;
          ph = 2; t0 = a.t; B.mode = 'ground'; B.surf = surf; B.surfY = surf.y; B.anchor = null;
          land(m);
          if (o.roll && m > 1.05) { B.queue.unshift(() => Object.assign(rollOver(), { blend: .18 })); return null; }
        }
        return p;
      }
      // приземление: амортизация по высоте падения; после сальто и мелких прыжков — короткая, без глубокого приседа
      const t = a.t - t0, mm = Math.min(m, o.flip ? .45 : 1.3), d = .2 + .3 * mm, L2 = landPose(mm), tail = o.quick ? .02 : .25,
        settled = o.arms === 'V' ? pose({ smile: 1, sa: [40, 40], ef: [80, 80] }) : STAND;
      if (t > d + tail) return null;
      const p = t < d * .4 ? mix(touchdown, L2, smooth(t / (d * .4))) : mix(L2, settled, smooth((t - d * .4) / (d * .6 + tail)));
      if (o.arms === 'V') for (const key of ['sf', 'sa', 'ef', 'ea'])
        p[key] = touchdown[key].map((value, i) => lerp(value, settled[key][i], smooth(t / (d + tail))));
      return p;
    }, { blend: .2 });
  }

  function leap(o) {
    const s0 = o.s0 || .22, sm = o.smax || 5, t1 = o.t1 || .42, th = o.hold || .12, t2 = o.t2 || .7;
    const STAR = pose({ sf: [34, 34], sa: [100, 100], ef: [10, 10], ea: [20, 20], hf: [8, 8], ha: [26, 26], kf: [14, 14], af: [10, 10], tl: -8, hp: -10, hy: 20, mouth: 1, brow: 1, smile: .5 });
    const fl = W.floor, xl = o.xl, yl = fl.y - REACH_LOW * S;
    return A('leap', 'free', (a, dt) => {
      const t = a.t; B.cam = 1;
      let s, p;
      if (t < t1) {                      // на нас: масштаб как 1/z при постоянной скорости — рост разгоняется
        const u = t / t1, e = smooth(u);
        s = s0 / (1 - u * (1 - s0 / sm));
        B.x = o.x0 + (o.xp - o.x0) * e; B.y = o.y0 + (o.yp - o.y0) * e;
        p = mix(AIR, STAR, smooth(Math.min(1, u * 1.6))); B.sqT = .14;
      } else if (t < t1 + th) {          // у самого объектива: замер, дрожь
        const v = (t - t1) / th;
        s = sm * (1 + .025 * Math.sin(v * PI)); B.x = o.xp; B.y = o.yp;
        p = STAR; B.sqT = -.1;
      } else {                           // прочь: масштаб падает как 1/z, путь — парабола к полу
        const u = Math.min(1, (t - t1 - th) / t2), f = 1.3 * u * u - .3 * u;
        s = 1 / (1 / sm + u * (1 - 1 / sm));
        B.x = o.xp + (xl - o.xp) * smooth(u); B.y = o.yp + (yl - o.yp) * f;
        p = mix(STAR, AIR, smooth(Math.min(1, u * 1.8)));
        p.sa = [60 + 40 * Math.sin(t * 15), 60 + 40 * Math.cos(t * 13)]; p.mouth = .6;
        if (o.flip) p.rot = -360 * smooth(Math.min(1, u * 1.15));
        B.sqT = Math.min(.18, u * .3);
        if (u >= 1) {
          B.scale = B.scaleT = 1; B.x = xl; B.y = yl; B.surf = fl; B.surfY = fl.y;
          B.queue.unshift(() => fall(o.land || 190)); return null;
        }
      }
      B.scale = B.scaleT = s;
      return p;
    }, { blend: .08, canvasScale: sm * 1.025 });
  }
  // падение (слайд ушёл из-под ног)
  function fall(vy, gk, hold) {
    let v = vy == null ? -40 : vy, m = 0, ph = 0, t0 = 0, chute = null, landingPose = null;
    const roll = LV().tricks >= 2, noChute = arguments.length > 1;   // сборка fx зовёт fall(vy, gk, hold) — там своё падение, без парашюта
    return A('fall', 'free', (a, dt) => {
      if (ph === 0) {
        if (chute === null) {   // с большой высоты раскрывает парашют
          chute = !noChute && (B.forceChute || surfaceBelow(B.x, B.y).y - B.y > CHUTE_H && chance(.85)); B.forceChute = false;
          if (chute) { B.queue.unshift(() => parachute(v)); return null; }
        }
        const yPrev = B.y; v += G * (gk || 1) * dt; B.y += v * dt;
        const s = B.passPlats ? W.floor : surfaceBelow(B.x, Math.min(yPrev, B.y));
        const p = mix(AIR, REACH, smooth(v / 200));
        p.sa = [70 + 40 * Math.sin(a.t * 14), 70 + 40 * Math.cos(a.t * 13)]; p.sf = [80, 60]; p.hp = 20; p.mouth = .5;
        p.hf[0] += 16 * Math.sin(a.t * 11); p.hf[1] -= 16 * Math.sin(a.t * 11);
        const yl = s.y - lowY(p) * S * B.scale;
        B.sqT = Math.min(.18, v / 1300);
        if (B.y >= yl) {
          B.y = yl; landingPose = copy(p); m = clamp(v / (G * .55), 0, 2); ph = 1; t0 = a.t;
          B.surfY = s.y; land(m); B.passPlats = false;
          B.mode = 'ground'; B.surf = s; B.surfY = s.y; B.anchor = null;
          if (roll && m > 1.05) { B.queue.unshift(() => rollOver()); return null; }
        }
        return p;
      }
      const t = a.t - t0, mm = Math.min(m, 1.3), d = .3 + .35 * mm, L2 = landPose(mm);
      if (t > (d + .5) * (hold || 1)) return null;
      return t < d * .4 ? mix(landingPose, L2, smooth(t / (d * .4))) : mix(L2, STAND, smooth((t - d * .4) / (d * .6 + .5)));
    }, { blend: .15 });
  }

  // парашют: с высоты больше CHUTE_H px — купол раскрывается через треть секунды, спуск ~1 м/с с покачиванием,
  // после приземления купол опадает и сползает в сторону
  const CHUTE_H = 210;
  const parachuteFrame = () => [Math.max(0, B.x - 220 * S * B.scale), Math.max(0, B.y - 200 * S * B.scale),
    Math.min(1280, B.x + 220 * S * B.scale), FLOOR + 12];
  const HANG = pose({ sf: [160, 160], sa: [24, 24], ef: [26, 26], ea: [-18, -18], hf: [10, -4], kf: [16, 24], af: [-30, -30], tl: 2, hp: -16, smile: 1 });
  // Публичный запуск: свободный коридор включает тело, качание и раскрытый купол.
  // Коридор — лишь план кадра; detail остаётся за фактически появившимся реквизитом.
  function parachuteLaunchSite(h) {
    if (B.mode !== 'ground' || B.surf.kind !== 'floor') return null;
    const sc = S * B.scale, half = 220 * sc + 16, top = FLOOR - h - 200 * sc,
      [fa, fb] = floorRange(), candidates = [];
    for (const [a, b] of W.floor.spans) {
      const lo = Math.max(a + 18, fa, half), hi = Math.min(b - 18, fb, 1280 - half);
      if (lo > hi) continue;
      candidates.push(clamp(B.x, lo, hi), lo, hi);
      for (let x = lo; x <= hi; x += 8) candidates.push(x);
    }
    candidates.sort((a, b) => Math.abs(a - B.x) - Math.abs(b - B.x));
    return candidates.find(x => zoneFree(x - half, top, x + half, FLOOR)
      && zoneFree(Math.min(x, B.x) - 18, FLOOR - 58, Math.max(x, B.x) + 18, FLOOR)) ?? null;
  }
  function parachuteLaunch(h, bounds) {
    const entry = copy(B.pose), prep = .33;
    let y0, t0, duration, speed, airbornePose, apexShown = false;
    return A('chuteLaunch', 'ground', (a) => {
      if (y0 == null && a.t < prep) {
        // Ноги приседают и распрямляются, руки совершают один мах за всё окно.
        const p = a.t < .18 ? mix(entry, CROUCH, smooth(a.t / .18)) : mix(CROUCH, PUSH, smooth((a.t - .18) / (prep - .18))),
          swing = smooth(a.t / prep);
        for (const key of ['sf', 'sa', 'ef', 'ea']) p[key] = entry[key].map((value, i) => lerp(value, PUSH[key][i], swing));
        B.drive = true; B.anchor = null; p.still = 1;
        return p;
      }
      if (y0 == null) {
        // Фактическая последняя наземная поза уже решена groundSolve: от неё
        // начинается физическая парабола, без коррекции таза в момент отрыва.
        y0 = B.y; t0 = a.t; speed = Math.sqrt(2 * G * Math.max(0, y0 - (FLOOR - h)));
        duration = speed / G; airbornePose = copy(B.pose); B.mode = 'free'; B.anchor = null;
      }
      if (apexShown) {
        B.passPlats = true;
        B.queue.unshift(() => parachute(0));
        return null;
      }
      const t = Math.min(a.t - t0, duration), p = mix(airbornePose, AIR, smooth(t / .5));
      B.y = y0 - speed * t + .5 * G * t * t; p.still = 1;
      if (t >= duration) { B.y = FLOOR - h; apexShown = true; }
      return p;
    }, { blend: 0, frameBounds: bounds });
  }
  function parachute(v0) {
    let v = v0 || 0, ph = 0, t0 = 0, m = 0, landingPose = null;
    const sx = B.x, w0 = rr(0, 6), f = B.face, dft = B.chuteDrift || 0, entryPose = copy(B.pose); B.chuteDrift = 0;
    const canopyState = st => {
      const sc = S * B.scale, dr = st.drop;
      let cx = B.x + 6 * st.sway * sc, cy = B.y - 150 * sc, d = 0, al = 1, open = st.open;
      if (dr) {   // сначала ветер уводит ткань от головы, потом она теряет форму и опадает сбоку
        const t = Math.max(0, W.time - dr.t0);
        cx = dr.x + dr.side * 140 * sc * smooth(t / .5);
        cy = lerp(dr.y, B.surfY - 3, smooth((t - .45) / 1));
        d = smooth((t - .35) / .85); open *= 1 - .95 * d;
        al = 1 - smooth((t - 1.35) / .45);
      }
      st.cx = cx; st.cy = cy; st.sc = sc; st.dr = !!dr;
      const size = Math.max(.01, al), width = (.25 + .75 * open) * (1 + .25 * d) * size,
        height = open * (1 - .85 * d) * size;
      st.rimWidth = 47.5 * sc * width;
      st.box = [cx - 56 * sc * width, cy - 44 * sc * height, cx + 56 * sc * width, cy + 6 * sc * width];
      return { atW: [cx, cy], side: 0, open, sway: st.sway, drop: d, k: size, hands: null,
        box: st.box };
    }, ch = prop3('chute', canopyState);
    ch.open = 0; ch.sway = 0;
    const RIM = [-1, -.62, -.22, .22, .62, 1], cords = [];
    let flat, dome, gores;
    const lines = prop(fxFront, g => {
      g.setAttribute('data-buddy-parachute-layer', '');
      flat = mk('g', {}, g);
      dome = mk('path', { fill: '#2F5BFF', stroke: '#0B2A9C', 'stroke-width': .7, 'data-buddy-parachute-canopy': 'svg' }, flat);
      gores = mk('path', { fill: '#C6F432' }, flat);
      for (let i = 0; i < 6; i++) cords.push(mk('path', { fill: 'none', stroke: '#2A2F3A', 'stroke-width': .55,
        'stroke-linecap': 'round', opacity: .8, 'data-buddy-parachute-cord': i }, g));
      return g;
    }, () => {
      const fallback = !(G3 && G3.on);
      flat.setAttribute('display', fallback ? '' : 'none');
      if (fallback) {
        const P = canopyState(ch), w = 47.5 * ch.sc * (.25 + .75 * P.open) * (1 + .25 * P.drop),
          h = 34.55 * ch.sc * .92 * P.open * (1 - .85 * P.drop);
        flat.setAttribute('opacity', ch.open > .005 ? P.k : 0);
        flat.setAttribute('transform', 'translate(' + f2(ch.cx) + ' ' + f2(ch.cy) + ') scale(' + P.k + ')');
        dome.setAttribute('d', `M${-w} 0C${-w} ${-h * .8} ${-w * .45} ${-h} 0 ${-h}C${w * .45} ${-h} ${w} ${-h * .8} ${w} 0Q0 ${2 * ch.sc} ${-w} 0Z`);
        gores.setAttribute('d', [-1, 1].map(side => `M0 ${-h}C${side * w * .3} ${-h} ${side * w * .5} ${-h * .7} ${side * w * .65} 0L${side * w * .35} 0C${side * w * .25} ${-h * .6} ${side * w * .1} ${-h} 0 ${-h}Z`).join(''));
      }
      const show = ch.cx != null && ch.open > .05, dr = ch.drop,
        headY = B.y + B.kk.head[1] * ch.sc;
      cords.forEach((e, i) => {
        if (!show) { e.setAttribute('d', ''); return; }
        const arm = i < 3 ? 0 : 1, w = ch.rimWidth,
          rx = ch.cx + RIM[i] * w, ry = ch.cy + 2 * ch.sc * (1 - Math.abs(RIM[i])), h = legacyGrip(arm);
        if (!dr) { e.setAttribute('d', 'M' + f2(rx) + ' ' + f2(ry) + 'L' + f2(h[0]) + ' ' + f2(h[1])); return; }
        // Стропы ещё в кистях при касании; отпускаются, когда рука опустилась ниже головы.
        if (!dr.released[arm] && W.time - dr.t0 > .08 && h[1] > headY + 5 * ch.sc)
          dr.released[arm] = { x: h[0], y: h[1], t0: W.time };
        const released = dr.released[arm], t = released ? Math.max(0, W.time - released.t0) : 0,
          alpha = 1 - smooth(t / .35), x = released ? released.x + dr.side * 32 * ch.sc * smooth(t / .7) : h[0],
          y = released ? released.y + 25 * ch.sc * t + .4 * G * t * t : h[1],
          sag = 14 * ch.sc * smooth((W.time - dr.t0) / .4);
        e.setAttribute('opacity', .8 * alpha);
        e.setAttribute('d', alpha > .001 ? `M${f2(rx)} ${f2(ry)}Q${f2((rx + x) / 2 + dr.side * sag)} ${f2((ry + y) / 2 + sag)} ${f2(x)} ${f2(y)}` : '');
      });
    });
    const action = A('chute', 'free', (a, dt) => {
      ch.ping = true; lines.ping = true;
      const held = p => {
        p.handFist = ch.drop ? ch.drop.released.map(released => released ? 1 - smooth((W.time - released.t0) / .2) : 1)
          : [smooth(a.t / .22), smooth(a.t / .22)];
        return p;
      };
      if (ph === 0) {
        const t = a.t;
        if (t < .3) v += G * dt; else v += (84 * B.scale - v) * Math.min(1, dt * 3.4);   // купол тормозит до ~1,5 м/с
        const yPrev = B.y;
        B.y += v * dt;
        const sw = Math.sin((t + w0) * 1.25) * smooth(t / .8);
        B.x = clamp(sx + 8 * sw + dft * Math.max(0, t - .3), 24, 1256); ch.sway = Math.cos((t + w0) * 1.25);
        ch.open = smooth((t - .22) / .42) * (1 + .12 * bump(t, .5, .9));
        const p = t < .55 ? mix(entryPose, HANG, smooth(t / .55)) : copy(HANG);
        p.hf[0] += 7 * Math.sin(t * 2.1); p.hf[1] -= 7 * Math.sin(t * 2.1); p.kf[0] += 5 * Math.sin(t * 1.7); p.still = 1;
        // Проверяем пройденный отрезок, а не только конечную точку шага:
        // на большой скорости таз может уже оказаться ниже платформы.
        const s = B.passPlats ? W.floor : surfaceBelow(B.x, Math.min(yPrev, B.y)), yl = s.y - lowY(p) * S * B.scale;
        if (B.y >= yl) {
          B.y = yl; landingPose = copy(p); m = clamp(v / (G * .55), 0, 2); ph = 1; t0 = a.t;
          B.surfY = s.y; land(m); B.passPlats = false; B.mode = 'ground'; B.surf = s; B.anchor = null;
          const sc = S * B.scale, x = B.x + 6 * ch.sway * sc, next = x + f * 140 * sc,
            side = next > 56 * sc + 8 && next < 1280 - 56 * sc - 8 ? f : -f;
          ch.drop = { x, y: B.y - 150 * sc, t0: W.time, side, released: [null, null] };
        }
        return held(p);
      }
      const t = a.t - t0, L2 = landPose(.35);
      if (t > 2) { ch.done = true; lines.done = true; return null; }
      return held(t < .32 ? mix(landingPose, L2, smooth(t / .32)) : mix(L2, pose({ smile: 1, hy: 20 }), smooth((t - .32) / .7)));
    }, { blend: .15 });
    action.detailBounds = () => B.act === action && !ch.done ? ch.box : null;
    return action;
  }
  // шаг с высокой кромки: короткий толчок наружу, дальше падение (а с высоты — парашют)
  function leapOff(lx, dur) {
    const x0 = B.x;
    return A('leapOff', 'free', (a, dt) => {
      const u = Math.min(1, a.t / (dur || .32));
      B.x = lerp(x0, lx, smooth(u)); B.y -= (1 - 2 * u) * 46 * dt;
      if (u >= 1) { B.queue.unshift(() => fall(0)); return null; }
      return mix(STAND, AIR, smooth(u));
    });
  }

  // ===================== лазанье =====================
  function ikLimbs(p, hands, feet) {
    const sc = S * B.scale, f = Math.cos(B.yaw) >= 0 ? 1 : -1, k = solve(p, f);
    for (let i = 0; i < 2; i++) {
      const h = hands && hands[i];
      if (h) {
        const sh = k.arms[i].sh, v = pitch([(h[0] - B.x) / sc * f - sh[0], (h[1] - B.y) / sc - sh[1], 0], -rad(p.tl + p.rot));
        // Хват кромки ориентирует кисть независимо от предплечья: IK целится
        // в запястье, а не в продолжение fd. Длины здесь — проекции в плоскость.
        const wrist = h[3], r = wrist
          ? ik2(v[0], v[1], L.upper * Math.cos(rad(p.sa[i])), L.fore * Math.cos(rad(p.sa[i] + p.ea[i])), true)
          : ik2(v[0], v[1], L.upper, L.fore + L.hand * .55, true);
        const w = h[2] == null ? 1 : h[2];
        p.sf[i] = lerp(p.sf[i], r[0], w); p.ef[i] = lerp(p.ef[i], r[1], w);
      }
      const q = feet && feet[i];
      if (q) {
        const hp = k.legs[i].hip, v = pitch([(q[0] - B.x) / sc * f - hp[0], (q[1] - B.y) / sc - hp[1] - L.ankle, 0], -rad(p.rot));
        const r = ik2(v[0], v[1], L.thigh, L.shin, false);
        const weight = q[2] == null ? 1 : q[2];
        p.hf[i] = weight === 1 ? r[0] : lerp(p.hf[i], r[0], weight);
        p.kf[i] = weight === 1 ? r[1] : lerp(p.kf[i], r[1], weight);
      }
    }
    return p;
  }
  const HX = 8.5 * PK, HY = 23 * PK;   // таз относительно хвата в висе, px
  function mantleKeys(side) {
    const sc = S * B.scale;
    const CR = pose({ tl: 30, hf: [72, 60], kf: [104, 84], af: [0, 0] });
    return [
      [0, HX, HY, pose({ tl: 4, hp: -26, hf: [22, 10], kf: [40, 30], sa: [14, 14] })],
      [.45, 4.5 * PK, 9 * PK, pose({ tl: 28, hp: -6, hf: [38, 4], kf: [70, 20], af: [-10, -10], sa: [14, 14] })],
      [.95, -1 * PK, 1 * PK, pose({ tl: 46, hp: 0, hf: [108, 8], kf: [128, 14], af: [-20, -30], sa: [14, 14] })],
      [1.4, -6 * PK, -lowY(CR) * sc, CR],
      [1.8, -9 * PK, -lowY(STAND) * sc, STAND],
    ];
  }
  function mantleAt(MK, t) {
    for (let i = 0; i < MK.length - 1; i++) if (t <= MK[i + 1][0]) {
      const u = smooth((t - MK[i][0]) / (MK[i + 1][0] - MK[i][0]));
      return [lerp(MK[i][1], MK[i + 1][1], u), lerp(MK[i][2], MK[i + 1][2], u), mix(MK[i][3], MK[i + 1][3], u)];
    }
    const e = MK[MK.length - 1]; return [e[1], e[2], copy(e[3])];
  }
  // лазанье вверх по стене w или вниз (down: 'climb' — лезет, 'hang' — повисает и спрыгивает)
  function climb(w0, down, o) {   // o.pull — повиснуть и подтянуться o.pull раз, не залезая
    const w = Object.assign({}, w0, { grab: Math.max(w0.top, Math.min(w0.grab, (w0.bottom || FLOOR) - Math.min(w0.plat && w0.plat.rad || 0, 18) - 2)) });   // хват выше нижнего скругления
    const side = w.side, face = -side, wx = w.x, top = w.top, sc = () => S * B.scale;
    const low = !down && w.h < 40;
    const MK = mantleKeys(side), MT = MK[MK.length - 1][0];
    let ph = 'turn', t0 = 0, py = 0, ct = 0, x0, y0, x1, y1, vy0, T, mo = null, preparationPose = null, mantleEntryPose = null, climbLimbs = null, climbEntryPose = null, pullPose = null, pullFrom = null;
    const limbKeys = ['sf', 'ef', 'hf', 'kf'], rememberLimbs = p => Object.fromEntries(limbKeys.map(key => [key, p[key].slice()]));
    const hands = [{ y: 0, y0: 0, y1: 0, w: -1 }, { y: 0, y0: 0, y1: 0, w: -1 }], feet = [{ y: 0, y0: 0, y1: 0, w: -1 }, { y: 0, y0: 0, y1: 0, w: -1 }];
    const P = .62, STEP = 14 * PK, V = (STEP / P) * clamp(1 + (w.grab - w.top - 120) / 260, 1, 1.7);   // по высокой стене — бодрее
    // скруглённый угол (карточки, кнопки-капсулы): у верха боковой грани нет, верх у кромки ниже — руки и стопы ставим на дугу,
    // а встаёт он дальше от кромки, на плоский верх. Иначе кисти висят в воздухе, а сам он стоит на склоне скругления
    const r = Math.min(w.plat && w.plat.rad || 0, 18), ins = r * .6;
    const bot = w.bottom || FLOOR, inX = y => y < top + r ? r - Math.sqrt(Math.max(0, r * r - (top + r - y) * (top + r - y)))
      : y > bot - r ? r - Math.sqrt(Math.max(0, r * r - (y - bot + r) * (y - bot + r))) : 0;   // насколько грань ушла внутрь на высоте y
    const topY = d => d < r ? top + r - Math.sqrt(Math.max(0, r * r - (r - d) * (r - d))) : top;            // верх в d px от кромки
    const start = (name, t) => { ph = name; t0 = t; };
    function loop(a, dt) {
      ct += dt; const dir = down ? 1 : -1;
      py = down ? py + V * dt : Math.max(top + HY, py - V * dt);
      const p = pose({ tl: 5, hp: down ? 10 : -26, sa: [14, 14], ha: [8, 8], af: [-20, -20], hf: [34 + 16 * Math.sin(ct * 4), 22 - 16 * Math.sin(ct * 4)], kf: [56, 44], still: 1 });
      const hx = [], fx = [];
      for (let i = 0; i < 2; i++) {
        const h = hands[i], phi = (ct / P + i * .5) % 1, wnd = Math.floor(ct / P + i * .5);
        if (phi < .34 && h.w !== wnd) { h.w = wnd; h.y0 = h.y; const end = py + dir * V * (.34 - phi) * P; h.y1 = down ? end - 10 * PK : Math.max(top, end - 23 * PK); }
        if (phi < .34) h.y = lerp(h.y0, h.y1, smooth(phi / .34));
        hx.push([wx + side * (.8 + 3.2 * bump(phi, 0, .34) * (phi < .34 ? 1 : 0)) * PK - side * inX(h.y), h.y]);
        const f = feet[i], pf = (ct / P + i * .5 + .5) % 1, wf = Math.floor(ct / P + i * .5 + .5);
        if (pf < .3 && f.w !== wf) { f.w = wf; f.y0 = f.y; const end = py + dir * V * (.3 - pf) * P; f.y1 = down ? end + 21 * PK : end + 10 * PK; }
        if (pf < .3) f.y = lerp(f.y0, f.y1, smooth(pf / .3));
        fx.push(f.y > bot - 2 ? null : [wx + side * (4.4 + 3 * (pf < .3 ? bump(pf, 0, .3) : 0)) * PK - side * inX(f.y), f.y,
          smooth((bot - 2 - f.y) / Math.max(6, r * .5))]);
      }
      B.x = wx + side * HX; B.y = py;
      ikLimbs(p, hx, fx);
      if (climbEntryPose && a.t - t0 < .2) {
        const weight = smooth((a.t - t0) / .2);
        for (const key of ['hf', 'ha', 'kf', 'ka', 'af']) for (let i = 0; i < 2; i++)
          p[key][i] = lerp(climbEntryPose[key][i], p[key][i], weight);
      }
      // У предела досягаемости acos меняет угол сустава быстрее, чем цель
      // движется по дуге. Короткое затухание сохраняет непрерывный хват.
      if (!climbLimbs) climbLimbs = rememberLimbs(p);
      const weight = 1 - Math.exp(-dt / .05);
      for (const key of limbKeys) for (let i = 0; i < 2; i++)
        p[key][i] = climbLimbs[key][i] = lerp(climbLimbs[key][i], p[key][i], weight);
      return p;
    }
    return A(down ? 'climbDown' : 'climb', 'ground', (a, dt) => {
      if (ph === 'turn') {
        B.face = face; B.cam = 0;
        if (a.t < .5) return idle(1).fn({ t: a.t }, dt) || STAND;
        if (down) {   // спуск: тело подтягивается к кромке плавно, а не прыжком на 13–17 px
          start('mantle', a.t); B.mode = 'free';
          const e = mantleAt(MK, MT); mo = [B.x - (wx + side * e[0]), B.y - (top + e[1])];
        } else start('crouch', a.t);
      }
      if (ph === 'crouch') {
        const t = a.t - t0;
        if (t < .33) {
          const p = t < .24 ? mix(STAND, CROUCH, smooth(t / .24)) : mix(CROUCH, PUSH, smooth((t - .24) / .09));
          if (o && o.pull) {
            // Руки заранее тянутся к кромке: прежний мах −45→160° за .09s
            // давал28° за120Hz. Ноги/корпус и момент отрыва остаются прежними.
            const arms = mix(STAND, PUSH, smooth(t / .33));
            for (const key of ['sf', 'sa', 'ef', 'ea']) p[key] = arms[key];
          } else {
            // Обычное лазанье и паутина используют ту же видимую подготовку.
            // Pull-ветка выше сохранена; меняются только руки до отрыва.
            const arms = mix(STAND, PUSH, smooth(t / .33));
            for (const key of ['sf', 'sa', 'ef', 'ea']) p[key] = arms[key];
          }
          preparationPose = copy(p); return p;
        }
        B.mode = 'free'; start('fly', a.t);
        x0 = B.x; y0 = B.y;
        if (low) { x1 = wx + side * 4.5 * PK; y1 = top + 9 * PK; } else { x1 = wx + side * HX; y1 = w.grab + HY; }
        if (o && o.web) { x1 = wx + side * HX; y1 = top + HY; T = Math.max(.55, (y0 - y1) / 260); start('web', a.t); webLine(o.web, [wx, top]); }
        else {
        const peak = Math.min(y0, y1) - 5; vy0 = -Math.sqrt(2 * G * (y0 - peak)); T = -vy0 / G + Math.sqrt(2 * (y1 - peak) / G);
        }
      }
      if (ph === 'web') {   // паутина: нить к кромке и подтяг на ней прямо к верху
        const t = a.t - t0, u = smooth(clamp((t - .25) / T, 0, 1));
        B.x = lerp(x0, x1, u); B.y = lerp(y0, y1, u) + 6 * Math.sin(PI * u);
        const AIM = pose({ sf: [165, 20], sa: [10, 20], ef: [0, 30], hp: -30, brow: -.6 }), UP = pose({ sf: [175, 170], sa: [8, 8], ef: [6, 8], hf: [24, 10], kf: [40, 26], tl: 4, hp: -20, still: 1 });
        const p = t < .25 ? mix(preparationPose || PUSH, AIM, smooth(t / .2)) : mix(AIM, UP, smooth((t - .25) / .2));
        p.kf[0] += 14 * Math.sin(t * 9) * u; p.kf[1] -= 14 * Math.sin(t * 9) * u; p.still = 1;
        if (t >= T + .25) { o.web.done = 1; mantleEntryPose = copy(p); start('mantle', a.t); B.mode = 'free'; }
        return p;
      }
      if (ph === 'fly') {
        const t = Math.min(a.t - t0, T), u = t / T;
        B.x = lerp(x0, x1, u); B.y = y0 + vy0 * t + .5 * G * t * t;
        const p = mix(PUSH, pose({ tl: 5, hp: -24, sf: [170, 165], ef: [6, 8], hf: [16, 4], kf: [30, 16], sa: [14, 14] }), smooth(u));
        if (u > .55) { const gy = low ? top + r * .3 : w.grab, k = smooth((u - .55) / .45), ledge = o && o.pull,
          target = y => ledge ? [wx + side * 1.1 * PK - side * inX(y), y + 6 * PK, k, 1]
            : [wx + side * .8 * PK - side * inX(y), y, k];
          ikLimbs(p, [target(gy), target(gy + (low ? 0 : 5 * PK))]);
          if (o && o.pull) { p.handTask = { kind: 'ledge', amount: [k, k], face }; p.handFist = [k * .4, k * .4]; }
        }
        if (a.t - t0 >= T) {
          if (low) { start('mantle', a.t - .45); }
          else if (o && o.pull) { pullPose = copy(p); pullFrom = [B.x, B.y]; start('pull', a.t); B.sqV += 1.2; }
          else {
            start('climb', a.t); py = y1; ct = 0;
            hands[0].y = w.grab; hands[1].y = w.grab + 5 * PK; feet[0].y = py + 16 * PK; feet[1].y = py + 21 * PK;
            hands.forEach(h => h.w = -1); feet.forEach(f => f.w = -1);
            climbLimbs = rememberLimbs(p);
            climbEntryPose = copy(p);
          }
        }
        return p;
      }
      if (ph === 'climb') {
        const p = loop(a, dt);
        if (!down && py <= top + HY + .5 && hands[0].y <= top + .5 && hands[1].y <= top + .5) {
          mantleEntryPose = copy(p); start('mantle', a.t);
        }
        if (down) {   // руки дошли до низа карточки или ноги до пола — отпускает
          const g = surfaceBelow(B.x, B.y + 5);
          if (B.y + 22 * PK * B.scale >= g.y - 4 || Math.max(hands[0].y, hands[1].y) >= (w.bottom || FLOOR) - 6) { B.queue.unshift(() => fall(0)); return null; }
        }
        return p;
      }
      if (ph === 'pull') {   // вис на кромке и подтягивания: подбородок к кромке, потом спрыгивает
        const t = a.t - t0, R = 1.05, n = o.pull, i = Math.floor(t / R), u = (t % R) / R, settle = smooth(clamp(t / .25, 0, 1));
        const k = i < n ? Math.sin(PI * u) ** 1.4 : 0, sw = i >= n ? 0 : 1.4 * Math.sin(t * 3);
        // Прежний первый pull-кадр перескакивал на −2PK/+7PK и менял IK-цель
        // второй руки. Оседание занимает только .25s; дальнейший путь и длительность прежние.
        B.x = lerp(pullFrom[0], wx + side * (HX - 2 * PK) + sw * .3, settle); B.y = lerp(pullFrom[1], y1 + 7 * PK - 15 * PK * k, settle);
        const target = pose({ tl: 2 - 4 * k, hp: -14 + 10 * k, sa: [12, 12], ha: [6, 6], af: [-34, -34], hf: [8 + 22 * k + sw, 2 + 22 * k - sw], kf: [14 + 40 * k, 8 + 40 * k],
          still: 1, smile: k > .6 ? 1 : .3, brow: k > .5 ? -.8 : .2, mouth: k > .7 ? .4 : 0 });
        const p = mix(pullPose, target, settle), gy = w.grab + lerp(5, 1.5, settle) * PK;
        p.still = 1; p.handTask = { kind: 'ledge', amount: [1, 1], face }; p.handFist = [.4, .4];
        // Запястье ниже подушечек пальцев: измеренный GLB хват нижней дуги.
        // Цель y+2PK недостижима в нижнем висе; y+6PK сохраняет длины рук и путь таза.
        ikLimbs(p, [[wx + side * 1.1 * PK - side * inX(w.grab), w.grab + 6 * PK, 1, 1],
          [wx + side * 1.1 * PK - side * inX(gy), gy + 6 * PK, 1, 1]]);
        if (t >= n * R + .35) { B.queue.unshift(() => fall(0)); return null; }
        return p;
      }
      if (ph === 'mantle') {
        const t = a.t - t0, tt = down ? MT - t : t;
        const [dx, dy, p] = mantleAt(MK, clamp(tt, 0, MT));
        const mk = mo ? 1 - smooth(t / .35) : 0;
        const din = ins * smooth(clamp(-dx / (9 * PK), 0, 1));   // над верхом — глубже внутрь, на плоское
        B.x = wx + side * (dx - din) + (mo ? mo[0] * mk : 0); B.y = top + dy + (mo ? mo[1] * mk : 0);
        const wk = clamp((1.4 - tt) / .3, 0, 1), d1 = 2 * PK + ins, d2 = 5.5 * PK + ins;
        if (wk > 0) ikLimbs(p, [[wx - side * d1, topY(d1), wk], [wx - side * d2, topY(d2), wk]]);
        if (mantleEntryPose && t < .24) Object.assign(p, mix(mantleEntryPose, p, smooth(t / .24)));
        p.still = 1;
        if (!down && t >= MT) {
          B.mode = 'ground'; B.surf = w.plat; B.surfY = top; B.anchor = null; B.upCount = 0; B.upLimit = Math.round(rr(3, 6));
          return null;
        }
        if (down && t >= MT) {
          if (down === 'hang') { B.queue.unshift(() => fall(0)); return null; }
          start('climb', a.t); py = B.y; ct = 0;
          climbEntryPose = copy(p); climbLimbs = rememberLimbs(p);
          hands[0].y = top; hands[1].y = top; feet[0].y = py + 16 * PK; feet[1].y = py + 21 * PK; hands.forEach(h => h.w = -1); feet.forEach(f => f.w = -1);
        }
        return p;
      }
      return null;
    }, { blend: .2 });
  }
  // посидеть на кромке лицом в зал, болтая ногами
  function edgeSit(dur) {
    const D = dur || rr(4, 8);
    const ES = pose({ hf: [86, 84], kf: [84, 92], tl: -3, sa: [24, 24], sf: [8, 8], ef: [4, 4], af: [-25, -25], smile: .6 });
    const SQ = pose({ hf: [84, 84], kf: [112, 112], tl: 30, sf: [40, 40], ef: [10, 10], af: [0, 0] });
    let y0, ys, ph = 0;
    return A('edgeSit', 'ground', (a) => {
      B.cam = 1;
      if (ph === 0) { if (a.t < .45) return STAND; ph = 1; B.mode = 'free'; y0 = B.y; ys = B.surf.y - solve(ES, 1).seat[1] * S * B.scale - 1; a.t0 = a.t; }
      const t = a.t - a.t0;
      if (t < .5) { B.y = lerp(y0, lerp(y0, ys, .55), smooth(t / .5)); return mix(STAND, SQ, smooth(t / .5)); }
      if (t < 1) { B.y = lerp(lerp(y0, ys, .55), ys, smooth((t - .5) / .5)); return mix(SQ, ES, smooth((t - .5) / .5)); }
      if (t < 1 + D) {
        const p = copy(ES), u = t - 1;
        p.kf = [88 + 22 * Math.sin(u * 2 * PI / 1.5), 88 + 22 * Math.sin(u * 2 * PI / 1.5 + PI)];
        p.hy = 28 * Math.sin(u * .6); p.hp = 8 * Math.sin(u * .45) + 4; p.still = 1;
        return p;
      }
      const u = t - 1 - D;
      if (u < .5) { B.y = lerp(ys, lerp(y0, ys, .55), smooth(u / .5)); return mix(ES, SQ, smooth(u / .5)); }
      if (u < 1) { B.y = lerp(lerp(y0, ys, .55), y0, smooth((u - .5) / .5)); return mix(SQ, STAND, smooth((u - .5) / .5)); }
      B.mode = 'ground'; B.anchor = null; return null;
    });
  }

  // ===================== эффекты суперспособностей =====================
  function particle(o) {   // {x,y,vx,vy,r,life,fill,grow,g}
    o.el = mk('circle', { r: o.r, fill: o.fill || accent }, o.back ? fxBack : fxFront);
    o.age = 0; B.fxs.push(o); return o;
  }
  function puff(x, y, n, col) { for (let i = 0; i < n; i++) particle({ x: x + rr(-6, 6), y: y - rr(0, 4), vx: rr(-22, 22), vy: rr(-26, -6), r: rr(1.6, 3.2), life: rr(.5, 1), fill: col || '#CFC8C2', grow: 2.2 }); }
  // пыль из-под ног: облачка стелются по поверхности в обе стороны и тормозят
  function dust(x, y, m) {
    const n = Math.round(3 + 7 * Math.min(m, 1.6));
    for (let i = 0; i < n; i++) { const sd = i % 2 ? 1 : -1, v = rr(24, 46 + 40 * m);
      particle({ x: x + sd * rr(2, 7), y: y - rr(.5, 2.5), vx: sd * v, vy: -rr(4, 14), r: rr(1.3, 2.4 + m), life: rr(.4, .75), fill: '#C4BAB1', grow: 1.6, op: .9, drag: 5.5 }); }
  }
  function land(m) { B.sqV -= 2.6 + 3.4 * Math.min(m, 1.5); dust(B.x, B.surfY, m); }
  function sparks(x, y, n, col) { for (let i = 0; i < n; i++) { const a = rr(0, 2 * PI), v = rr(30, 90); particle({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: rr(.8, 1.6), life: rr(.4, .8), fill: col || accent, grow: -1, g: 60 }); } }
  function fxStep(dt) {
    for (let i = B.fxs.length - 1; i >= 0; i--) {
      const o = B.fxs[i]; o.age += dt;
      if (o.age >= o.life) { o.el.remove(); B.fxs.splice(i, 1); continue; }
      if (o.update) { o.update(o, dt); continue; }
      o.vy += (o.g || 0) * dt; if (o.drag) { const kd = Math.exp(-o.drag * dt); o.vx *= kd; o.vy *= kd; }
      o.x += o.vx * dt; o.y += o.vy * dt;
      const u = o.age / o.life;
      o.el.setAttribute('cx', f2(o.x)); o.el.setAttribute('cy', f2(o.y));
      o.el.setAttribute('r', f2(Math.max(.1, o.r * (1 + (o.grow || 0) * u))));
      o.el.setAttribute('opacity', ((o.op || .8) * (o.hold ? (u < o.hold ? 1 : 1 - (u - o.hold) / (1 - o.hold)) : 1 - u)).toFixed(3));
    }
  }
  function custom(life, build, update) { const o = { life, age: 0, update }; o.el = build(); B.fxs.push(o); return o; }
  // свободное место на полу для фигуры с эффектом высотой h и полушириной hw
  function freeFloorX(h, hw, minD, maxD) {
    const xs = [];
    for (const [a, b] of W.floor.spans) for (let x = a + hw; x <= b - hw; x += 8) { const d = Math.abs(x - B.x); if (d >= minD && d <= maxD && zoneFree(x - hw, FLOOR - h, x + hw, FLOOR)) xs.push(x); }
    return xs.length ? xs[Math.floor(rnd() * xs.length)] : null;
  }
  // облако дыма: плотное первые полсекунды, фигуру за ним не видно
  function smokeCloud(x) {
    const cols = ['#9A928C', '#B5ADA7', '#827B76', '#C9C2BC'];
    for (let i = 0; i < 18; i++) {
      const a = rr(-PI, 0), r = rr(3, 18);
      particle({ x: x + Math.cos(a) * r * 1.2, y: FLOOR - 14 + Math.sin(a) * r * 1.4 + rr(0, 8), vx: Math.cos(a) * rr(8, 24), vy: Math.sin(a) * rr(4, 14) - 5,
        r: rr(5.5, 9), life: rr(1.6, 2.2), fill: cols[i % 4], grow: .9, op: .97, hold: .5, drag: 2.4 });
    }
    for (let i = 0; i < 6; i++) particle({ x, y: FLOOR - 2, vx: (i % 2 ? 1 : -1) * rr(40, 80), vy: -rr(2, 8), r: rr(3, 5), life: rr(.6, 1), fill: '#B5ADA7', grow: 1.2, op: .9, drag: 4 });
    sparks(x, FLOOR - 8, 8, '#FFC400');
  }
  // молния: свечение, середина и белая сердцевина по одной ломаной, плюс ответвление
  function boltFx() {
    const g = mk('g', {}, fxFront);
    const ls = [['#FFC400', 5, .35], ['#FFE16A', 2.2, 1], ['#FFFFFF', .8, 1]].map(([c, w, o]) => mk('polyline', { fill: 'none', stroke: c, 'stroke-width': w, opacity: o, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, g));
    const br = mk('polyline', { fill: 'none', stroke: '#FFE16A', 'stroke-width': 1, 'stroke-linecap': 'round' }, g);
    return { g, set(a, b, on) {
      g.setAttribute('opacity', on ? 1 : 0); if (!on) return;
      const pts = [], n = 9, dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
      for (let i = 0; i <= n; i++) { const u = i / n, j = i && i < n ? rr(-7, 7) * Math.sin(PI * u) : 0; pts.push([a[0] + dx * u + nx * j, a[1] + dy * u + ny * j]); }
      const s = pts.map(q => f2(q[0]) + ',' + f2(q[1])).join(' '); ls.forEach(e => e.setAttribute('points', s));
      const k = 3 + Math.floor(rnd() * 4), q = pts[k], e2 = [q[0] + rr(-16, 16), q[1] + rr(6, 16)];
      br.setAttribute('points', f2(q[0]) + ',' + f2(q[1]) + ' ' + f2((q[0] + e2[0]) / 2 + rr(-4, 4)) + ',' + f2((q[1] + e2[1]) / 2) + ' ' + f2(e2[0]) + ',' + f2(e2[1]));
    }, anchor(a) {
      const start = f2(a[0]) + ',' + f2(a[1]);
      for (const line of ls) {
        const points = line.getAttribute('points');
        if (points) line.setAttribute('points', start + points.slice(points.indexOf(' ')));
      }
    } };
  }
  // огненный шар: пока ball.go = 0 висит в ball.at, потом летит к tx вдоль пола с огненным хвостом и взрывается
  function fireBall(at, tx) {
    const ball = { at, r: 0, go: 0 };
    let x = at[0], y = at[1], done = false;
    // Шар несёт главный знак набора; без знака остаётся огонь.
    const LG = brand.logo;
    custom(6, () => { const g = mk('g', {}, fxFront); mk('circle', { fill: accent, opacity: .35 }, g);
      if (LG) { const im = mk('image', { href: LG, preserveAspectRatio: 'xMidYMid meet' }, g); mk('g', {}, g); return g; }
      mk('circle', { fill: '#FF8A2A' }, g); mk('circle', { fill: '#FFE16A' }, g); return g; }, (o, dt) => {
      if (done) return;
      if (!ball.go) { x = ball.at[0]; y = ball.at[1]; }
      else {
        const dir = Math.sign(tx - x) || 1; x += dir * 280 * dt; y += (FLOOR - 16 - y) * Math.min(1, dt * 6);
        particle({ x: x - dir * 3, y: y + rr(-2, 2), vx: -dir * rr(10, 30), vy: rr(-24, -6), r: rr(1.4, 2.6), life: rr(.25, .45), fill: chance(.5) ? '#FF8A2A' : '#FFC400', grow: -.5, op: .9, back: true });
        if ((tx - x) * dir <= 0) {
          done = true; o.el.remove(); sparks(x, y, 18, '#FF8A2A'); sparks(x, y, 8, '#FFC400'); puff(x, FLOOR, 6, '#B5ADA7');
          const m = mk('ellipse', { cx: x, cy: FLOOR - .5, rx: 6, ry: 1.6, fill: '#3A2A20', opacity: .5 }, fxBack);
          custom(2.2, () => m, (q) => m.setAttribute('opacity', (.5 * (1 - q.age / 2.2)).toFixed(2)));
          o.age = o.life; return;
        }
      }
      const fl = 1 + .12 * Math.sin(o.age * 40), r = Math.max(.01, ball.r) * fl, c = o.el.children;
      c[0].setAttribute('cx', f2(x)); c[0].setAttribute('cy', f2(y)); c[0].setAttribute('r', f2(r * 1.8));
      if (LG) { const R = Math.max(.01, ball.r) * 1.5; c[1].setAttribute('x', f2(x - R)); c[1].setAttribute('y', f2(y - R)); c[1].setAttribute('width', f2(2 * R)); c[1].setAttribute('height', f2(2 * R)); }
      else { for (const e of c) { e.setAttribute('cx', f2(x)); e.setAttribute('cy', f2(y)); } c[1].setAttribute('r', f2(r)); c[2].setAttribute('r', f2(r * .5)); }
    });
    return ball;
  }
  // кольцо-портал Доктора Стрэнджа: раскрывается, крутится искрами, схлопывается
  function portalRing(x, life) {
    const cy = FLOOR - 27;
    const ring = custom(life, () => { const g = mk('g', {}, fxFront);
      mk('ellipse', { cx: x, cy, fill: 'rgba(255,100,39,.10)' }, g);
      mk('ellipse', { cx: x, cy, fill: 'none', stroke: accent, 'stroke-width': 2.6, 'stroke-dasharray': '5 2.5' }, g);
      mk('ellipse', { cx: x, cy, fill: 'none', stroke: '#FFC400', 'stroke-width': .9 }, g); return g; }, (o) => {
      const u = o.age, k = smooth(u / .5) * smooth((life - u) / .4), c = o.el.children;
      for (const e of c) { e.setAttribute('rx', f2(9 * k)); e.setAttribute('ry', f2(29 * k)); }
      c[1].setAttribute('stroke-dashoffset', f2(u * 40)); c[2].setAttribute('opacity', (.6 + .4 * Math.sin(u * 20)).toFixed(2));
      if (k > .5 && chance(.6)) { const a = rr(0, 2 * PI); particle({ x: x + Math.cos(a) * 9, y: cy + Math.sin(a) * 29, vx: -Math.sin(a) * 30, vy: Math.cos(a) * 60, r: rr(.6, 1.2), life: rr(.3, .5), fill: chance(.5) ? '#FFC400' : '#FF6427', grow: -1 }); }
    });
    ring.frameBounds = [x - 12, cy - 32, x + 12, cy + 32];
  }
  // вернуть всё, что способности временно меняли на слайде (спрятанные иконки)
  function unrestore() { for (const f of B.restore.splice(0)) f(); }
  function hideMagnetSource(element) {
    const original = element.getAttribute('style'), value = element.style.getPropertyValue('visibility'),
      priority = element.style.getPropertyPriority('visibility');
    element.style.setProperty('visibility', 'hidden', 'important');
    const installed = element.getAttribute('style');
    let restored = false;
    return () => {
      if (restored) return;
      restored = true;
      if (element.getAttribute('style') === installed) {
        if (original === null) element.removeAttribute('style');
        else element.setAttribute('style', original);
      } else if (element.style.getPropertyValue('visibility') === 'hidden' && element.style.getPropertyPriority('visibility') === 'important') {
        // Владелец мог изменить другие свойства во время номера: возвращаем только наше.
        if (value) element.style.setProperty('visibility', value, priority);
        else element.style.removeProperty('visibility');
        if (original === null && element.style.length === 0) element.removeAttribute('style');
      }
    };
  }
  // нить паутины от ладони до точки на кромке; st.done — оборвать и растаять
  function webLine(st, at) {
    custom(8, () => { const g = mk('g', {}, fxFront); mk('line', { stroke: '#8A8580', 'stroke-width': 1.3, 'stroke-linecap': 'round' }, g); mk('line', { stroke: '#FFFFFF', 'stroke-width': .6, 'stroke-linecap': 'round' }, g);
      mk('path', { fill: 'none', stroke: '#FFFFFF', 'stroke-width': .6, d: 'M' + f2(at[0] - 3) + ' ' + f2(at[1] - 1) + 'L' + f2(at[0] + 3) + ' ' + f2(at[1] + 1) + 'M' + f2(at[0] - 2) + ' ' + f2(at[1] + 2) + 'L' + f2(at[0] + 2) + ' ' + f2(at[1] - 2) }, g); return g; }, (o) => {
      if (st.done) { st.fade = (st.fade || 0) + 1 / 60; o.el.setAttribute('opacity', Math.max(0, 1 - st.fade * 3).toFixed(2)); if (st.fade > .4) o.age = o.life; return; }
      const h = fig.handsW[0], u = Math.min(1, o.age / .18), e = [lerp(h[0], at[0], u), lerp(h[1], at[1], u)];
      for (const l of [o.el.children[0], o.el.children[1]]) { l.setAttribute('x1', f2(h[0])); l.setAttribute('y1', f2(h[1])); l.setAttribute('x2', f2(e[0])); l.setAttribute('y2', f2(e[1])); }
      o.el.children[2].setAttribute('opacity', u >= 1 ? 1 : 0);
    });
  }
  const bodyC = () => [B.x, B.y - 12 * B.scale];

  // Цели крюка и кромки паутины — общие для самого номера и для availability(): can() не обещает
  // номер, от которого планировщик потом откажется (раньше can() проверял только наличие площадок).
  function grappleTargets() {
    const cands = [];
    for (const q of W.plats) {
      const dy = B.surfY - q.y; if (dy < 80 || dy > 330) continue;
      const out = B.x < q.x1 - 20 ? [q.x1] : B.x > q.x2 + 20 ? [q.x2] : null, eds = out || (B.surf.kind === 'floor' ? [q.x1, q.x2] : []);
      for (const ed of eds) {
        const inw = ed === q.x1 ? 1 : -1, x = nearestIn(q.spans, ed + inw * 10), st = out ? null : ed - inw * 16;
        if (x == null || Math.abs(x - ed) > 24 || !zoneFree(x - 8, q.y - 46, x + 8, q.y - 2)) continue;
        const rx = ed - inw * 8;   // вдоль грани до пола — ни одного блока (строка внутри карточки отпадает)
        if (W.plats.some(P => P !== q && P.box && P.x1 - 2 < rx && rx < P.x2 + 2 && P.box.y2 > q.y + 6 && P.y < B.surfY - 4)) continue;
        if (W.plats.some(P => P !== q && P.box && P.x1 < x + 10 && P.x2 > x - 10 && P.box.y2 > q.y - 46 && P.y < q.y - 2)) continue;   // над площадкой нет места для роста
        if (st != null && (!inSpans(B.surf.spans, st) || Math.abs(st - B.x) > 260)) continue;
        const dx = Math.abs(ed - B.x); if (out && (dx < 30 || dx > 230)) continue;
        cands.push({ q, x, st, d: Math.hypot(dx, dy) });
      }
    }
    return cands;
  }
  function webWalls() {
    const fr = floorRange();
    return W.walls.filter(w => w.footX >= fr[0] && w.footX <= fr[1] && w.h <= 600 && Math.abs(w.footX - B.x) < 500 && w.h > 80);
  }
  function powerMake(name) {
    const fr = floorRange();
    const farX = () => { const sp = W.floor.spans; const xs = []; for (const [a, b] of sp) for (let x = a; x <= b; x += 10) if (Math.abs(x - B.x) > 160) xs.push(x); return xs.length ? xs[Math.floor(rnd() * xs.length)] : clamp(B.x + 200 * B.face, fr[0] + 10, fr[1] - 10); };
    // способность с эффектом выше головы — только там, где над ним нет текста; иначе сначала отойти
    function makeRoom(nm, h, hw) {
      const roomy = x => zoneFree(x - hw, FLOOR - h, x + hw, FLOOR);
      // дошёл до выбранного места — считаем, что места хватает, даже если встал в паре пикселей от точки
      if (B.surf.kind === 'floor' && (roomy(B.x) || (B.roomAt != null && Math.abs(B.x - B.roomAt) < 10))) { B.roomAt = null; return true; }
      B.roomAt = null;
      let best = null; for (const [a, b] of W.floor.spans) for (let x = a + hw; x <= b - hw; x += 8) if (roomy(x) && (best == null || Math.abs(x - B.x) < Math.abs(best - B.x))) best = x;
      if (best == null || B.surf.kind !== 'floor') return null;
      const km = B.keyMagnet; B.queue.unshift(() => { B.roomAt = best; B.keyMagnet = km; const a = powerMake(nm); B.roomAt = null; B.keyMagnet = false; if (a) a.power = true; return a; });
      return walkTo(best, Math.abs(best - B.x) > 320 ? 'jog' : 'walk');
    }
    switch (name) {
      case 'levitate': {
        const go = makeRoom('levitate', 80, 26); if (go !== true) return go;   // поза лотоса, поднимается, светится
        const LO = pose({ hf: [80, 80], ha: [50, 50], kf: [20, 28], ka: [-110, -110], sa: [24, 24], sf: [34, 34], ef: [56, 56], af: [0, 0], tl: 0, lid: .8, smile: .4 });   // голени скрещены (ka), а не шпагат
        let y0, yl, aura;
        return A('levitate', 'ground', (a) => {
          B.cam = 1;
          if (a.t < .45) return STAND;
          if (!y0) {
            B.mode = 'free'; y0 = B.y; yl = B.surf.y - lowY(LO) * S - 22; a.t0 = a.t;
            aura = custom(9, () => mk('ellipse', { fill: 'none', stroke: accent, 'stroke-width': 1.2 }, fxBack), (o) => {
              const u = o.age, al = clamp(u / 1, 0, 1) * clamp((7.4 - u) / .8, 0, 1);
              o.el.setAttribute('cx', f2(B.x)); o.el.setAttribute('cy', f2(B.y + 4)); o.el.setAttribute('rx', f2(20 + 2 * Math.sin(u * 3))); o.el.setAttribute('ry', f2(16 + 2 * Math.sin(u * 3)));
              o.el.setAttribute('opacity', (.45 * al).toFixed(2));
            });
          }
          const t = a.t - a.t0;
          if (t < 1.4) { B.y = lerp(y0, yl, smooth(t / 1.4)); return mix(STAND, LO, smooth(t / 1)); }
          if (t < 5.4) { B.y = yl + 2 * Math.sin((t - 1.4) * 2.2); const p = copy(LO); p.still = 1; return p; }
          if (t < 6.6) { B.y = lerp(yl, y0, smooth((t - 5.4) / 1.2)); return mix(LO, STAND, smooth((t - 5.6) / 1)); }
          B.mode = 'ground'; B.anchor = null; return null;
        });
      }
      case 'shield': {   // силовое поле: стойка, пузырь вспыхивает и гаснет
        const go = makeRoom('shield', 70, 34); if (go !== true) return go;
        const ST = pose({ ha: [12, 12], kf: [24, 24], hf: [12, 12], tl: 6, sf: [70, 70], sa: [48, 48], ef: [30, 30], ea: [20, 20], smile: .5 });   // руки раскрыты — держит купол, а не закрывает лицо
        return gest('shield', 4.2, 1, (t, a) => {
          if (!a.fx && t > .5) {
            a.fx = 1; sparks(B.x, B.y - 6, 14);
            custom(3.4, () => mk('circle', { fill: accent, 'fill-opacity': .09, stroke: accent, 'stroke-width': 1.4 }, fxFront), (o) => {
              const u = o.age, r = 31 * smooth(u / .35) + 1.2 * Math.sin(u * 9), c = bodyC();
              o.el.setAttribute('cx', f2(c[0])); o.el.setAttribute('cy', f2(c[1])); o.el.setAttribute('r', f2(Math.max(1, r)));
              o.el.setAttribute('opacity', (clamp((3.4 - u) / .5, 0, 1) * (.75 + .25 * Math.sin(u * 14))).toFixed(2));
            });
            // по кромке пузыря кружат знаки сервисов; сами знаки не вращаются, движется только точка на орбите
            const LS = brand.products;
            if (LS.length) custom(3.4, () => { const g = mk('g', {}, fxFront); for (const h of LS) mk('image', { href: h, width: 11, height: 11, preserveAspectRatio: 'xMidYMid meet' }, g); return g; }, (o) => {
              const u = o.age, r = 31 * smooth(u / .35), c = bodyC(), n = LS.length;
              [...o.el.children].forEach((e, i) => { const ang = 2 * PI * i / n + u * 1.6; e.setAttribute('x', f2(c[0] + r * Math.cos(ang) - 5.5)); e.setAttribute('y', f2(c[1] + r * Math.sin(ang) - 5.5)); });
              o.el.setAttribute('opacity', (smooth(u / .3) * clamp((3.4 - u) / .5, 0, 1)).toFixed(2));
            });
          }
          return t < .5 ? mix(STAND, ST, smooth(t / .5)) : t > 3.7 ? mix(ST, STAND, smooth((t - 3.7) / .5)) : ST;
        });
      }
      case 'laser': {   // лазер из глаз в пол, остаётся дымящаяся подпалина
        const tx = clamp(B.x + B.face * rr(70, 120), fr[0], fr[1]);
        const L2 = pose({ hp: 20, sf: [183, 183], sa: [69, 69], ef: [2, 2], ea: [-128, -128], ha: [6, 6], kf: [10, 10] });   // пальцы у висков, локти в стороны (подобрано по цели кисти)
        let beams = null;
        return gest('laser', 4.4, .55, (t, a) => {
          if (t > .8 && t < 2.1 && !beams) {
            beams = [0, 1].map(() => { const g = mk('g', {}, fxFront); mk('line', { stroke: 'rgba(255,48,24,.42)', 'stroke-width': 3.6, 'stroke-linecap': 'round' }, g); mk('line', { stroke: '#FF3B1F', 'stroke-width': 1.5, 'stroke-linecap': 'round' }, g); mk('line', { stroke: '#FFF4EE', 'stroke-width': .6, 'stroke-linecap': 'round' }, g); return g; });
            a.mark = mk('ellipse', { cx: tx, cy: FLOOR - .5, rx: 0, ry: 1.6, fill: '#3A2A20', opacity: .55 }, fxBack);
            a.afterRender = () => {
              for (let i = 0; i < beams.length; i++) {
                const eye = fig.eyesW[fig.eyeOn[i] ? i : 1 - i];
                for (const line of beams[i].children) { line.setAttribute('x1', f2(eye[0])); line.setAttribute('y1', f2(eye[1])); }
              }
            };
          }
          if (beams) {
            const on = t > .8 && t < 2.1, fl = .75 + .25 * Math.sin(t * 60);
            beams.forEach((g, i) => {
              const e = fig.eyesW[fig.eyeOn[i] ? i : 1 - i];
              for (const ln of g.children) { ln.setAttribute('x1', f2(e[0])); ln.setAttribute('y1', f2(e[1])); ln.setAttribute('x2', f2(tx + (i ? 1.5 : -1.5))); ln.setAttribute('y2', FLOOR - 1); }
              g.setAttribute('opacity', on ? fl.toFixed(2) : 0);
            });
            if (on) { a.mark.setAttribute('rx', f2(Math.min(8, (t - .8) * 9))); if (chance(.35)) sparks(tx, FLOOR - 1, 1, '#FF3B1F'); }
            if (t > 2.1 && !a.smoke) { a.smoke = 1; for (let i = 0; i < 6; i++) particle({ x: tx + rr(-3, 3), y: FLOOR - 2, vx: rr(-3, 3), vy: rr(-14, -8), r: rr(1.2, 2), life: rr(1.6, 2.6), fill: '#9C948E', grow: 2.4, op: .5, g: 0 }); }
            if (t >= 4.3 && !a.done) { a.done = 1; beams.forEach(g => g.remove()); const mark = a.mark; custom(2, () => mark, (o) => mark.setAttribute('opacity', (.55 * (1 - o.age / 2)).toFixed(2))); }
          }
          if (t < .7) return mix(STAND, L2, smooth(t / .6));
          if (t < 2.2) { const p = copy(L2); p.ea[0] += 4 * Math.sin(t * 30); return p; }
          if (t < 2.8) return mix(L2, pose({ hp: 18, hy: 0, smile: .2 }), smooth((t - 2.2) / .6));
          return mix(pose({ hp: 18 }), pose({ hy: 30, smile: 1 }), smooth((t - 2.8) / .6));
        });
      }
      case 'hulk': {   // упирается в пол, вырастает, оценивает новые размеры и делает два тяжёлых шага
        const go = makeRoom('hulk', 160, 55); if (go !== true) return go;
        const FLEX = pose({ sa: [96, 96], sf: [10, 10], ef: [120, 120], ea: [-60, -60], ha: [10, 10], kf: [16, 16], hf: [8, 8], mouth: 1, tl: 4, hp: -10 });
        const SIZE = pose({ sf: [52, 52], sa: [30, 30], ef: [74, 74], hp: 23, brow: .7, mouth: .35 });
        const LOOK = pose({ sf: [35, 35], sa: [40, 40], ef: [60, 60], hy: 28, smile: 1, hp: 15 });
        const STEP0_END = copy(FLEX), STEP1_END = copy(FLEX);
        STEP0_END.hp = STEP1_END.hp = 18;
        STEP0_END.hf[0] = STEP0_END.kf[0] = STEP1_END.hf[1] = STEP1_END.kf[1] = 0;
        return gest('hulk', 6.4, 1, (t, a) => {
          const growth = smooth((t - .6) / 1.35) * (1 - smooth((t - 4.65) / 1.2));
          B.scaleT = 1 + 2.4 * growth; B.tintT = .65 * growth;
          B.jitter = t > .65 && t < 1.8 ? .25 : 0;
          for (const [index, at] of [[0, 3.05], [1, 3.9]]) if (t >= at && !a['stomp' + index]) {
            a['stomp' + index] = true;
            const x = B.x + (index ? -1 : 1) * B.face * 21;
            puff(x, FLOOR, 14);
            custom(.85, () => mk('ellipse', { cx: x, cy: FLOOR, fill: 'none', stroke: '#717f8f', 'stroke-width': 1.1 }, fxBack), o => {
              const u = o.age / o.life;
              o.el.setAttribute('rx', f2(7 + u * 55)); o.el.setAttribute('ry', f2(2 + u * 8));
              o.el.setAttribute('opacity', (.55 * (1 - u)).toFixed(2));
            });
          }
          let p;
          if (t < .6) p = mix(STAND, CROUCH, smooth(t / .6));
          else if (t < 2) p = mix(CROUCH, FLEX, smooth((t - .6) / 1.35));
          else if (t < 2.6) p = mix(FLEX, SIZE, smooth((t - 2) / .45));
          else if (t < 3.2) { p = copy(FLEX); p.hp = 18; p.hf[0] = 40 * bump(t, 2.6, 3.05); p.kf[0] = 60 * bump(t, 2.6, 3.05); }
          else if (t < 4.05) { p = copy(FLEX); p.hp = 18; p.hf[1] = 40 * bump(t, 3.25, 3.9); p.kf[1] = 60 * bump(t, 3.25, 3.9); }
          else if (t < 4.6) p = copy(LOOK);
          else p = mix(FLEX, pose({ hy: 30, smile: 1, sf: [140, -3], ef: [120, 9], sa: [30, 7] }), smooth((t - 4.6) / .8));
          if (t >= 2.6 && t < 2.8) p = mix(SIZE, p, smooth((t - 2.6) / .2));
          else if (t >= 3.2 && t < 3.4) p = mix(STEP0_END, p, smooth((t - 3.2) / .2));
          else if (t >= 4.05 && t < 4.25) p = mix(STEP1_END, p, smooth((t - 4.05) / .2));
          else if (t >= 4.6 && t < 4.8) p = mix(LOOK, p, smooth((t - 4.6) / .2));
          p.mouth = t > 1 && t < 2.6 ? 1 : 0;
          return p;
        }, { canvasScale: 3.45, frameBounds: [Math.max(0, B.x - 90), FLOOR - 190, Math.min(1280, B.x + 90), FLOOR + 12] });
      }
      case 'shrink': {   // уменьшается, бегает крошкой, возвращается
        const tx = farX();
        B.queue.unshift(() => walkTo(tx, 'walk'), () => gest('grow', 1, .6, (t, a) => { if (!a.f) { a.f = 1; B.scaleT = 1; sparks(B.x, B.y, 10); } return pose({ smile: 1, hy: 20 }); }));
        return gest('shrink', 1, .6, (t, a) => { if (!a.f && t > .3) { a.f = 1; B.scaleT = .42; sparks(B.x, B.y, 10); } return pose({ hp: 20 }); });
      }
      case 'speed': {   // суперскорость: шлейф из отражений и пыль на торможении
        const tx = farX(), direction = Math.sign(tx - B.x) || B.face, scale = S * B.scale * 1.15,
          // История ограничена числом отрисованных кадров и максимальным dt, а не шириной слайда.
          history = Math.min(Math.abs(tx - B.x) + zipSpeed * maxFrameDt, zipSpeed * ghosts.length * ghostStep * maxFrameDt),
          bounds = [B.x + FIG_BOX[0] * scale - (direction > 0 ? history : 0) - 4,
            B.surfY - (HIP_H + L.toe) * S * B.scale + FIG_BOX[1] * scale - 4,
            B.x + FIG_BOX[2] * scale + (direction < 0 ? history : 0) + 4,
            B.surfY + FIG_BOX[3] * scale + 4];
        B.queue.unshift(() => walkTo(tx, 'zip', { entryPose: CROUCH }), () => gest('brake', 1.6, .4, (t, a) => { if (!a.f) { a.f = 1; puff(B.x + B.face * 6, FLOOR, 10); } B.ghost = t < .25; return mix(pose({ tl: -12, hf: [30, -20], kf: [20, 30] }), pose({ hy: 30, smile: 1 }), smooth(t / 1.2)); }));
        return gest('ready', .7, 0, (t) => { B.ghost = true; return mix(STAND, CROUCH, smooth(t / .7)); }, { canvasBounds: bounds });
      }
      case 'clone': {   // клон напротив, вместе машут и прыгают, клон пропадает
        const c = clamp(B.x + B.face * 34, fr[0] + 40, fr[1] - 40);
        if (Math.abs(2 * c - B.x - B.x) < 30) return null;
        B.queue.unshift(() => jacks(4), () => wave(), () => gest('unclone', .8, .6, (t, a) => { if (!a.f) { a.f = 1; sparks(2 * B.clone - B.x, B.y, 16); } if (t > .15) B.clone = null; return pose({ hy: 30, smile: 1 }); }));
        return gest('clone', 1, .6, (t, a) => { if (!a.f && t > .3) { a.f = 1; B.clone = c; sparks(2 * c - B.x, B.y, 16); } return pose({ hy: 20, smile: t > .5 ? 1 : 0 }); });
      }
      case 'smoke': {   // дымовая шашка: бросает под ноги, тонет в дыму и выходит из второго облака в другом месте
        const go = makeRoom('smoke', 64, 28); if (go !== true) return go;
        const tx = freeFloorX(64, 28, 300, 760) ?? freeFloorX(64, 28, 170, 760); if (tx == null) return null;
        const WIND = pose({ sf: [-40, 10], ef: [100, 20], tl: 6, hy: 10, brow: -.7, smile: .7 });
        const THROW = pose({ sf: [64, 8], ef: [8, 14], tl: 16, hf: [22, 2], kf: [30, 8], brow: -.7, smile: .9 });
        const HERO = pose({ hf: [74, 4], kf: [104, 34], tl: 24, sf: [36, -16], sa: [52, 24], ef: [28, 18], af: [0, -14], hy: 30, smile: 1, brow: .4 });
        return gest('smoke', 3.6, (t) => t < 1.2 ? .25 : .8, (t, a) => {
          if (t > .3 && !a.bomb) {   // шашка летит из руки под ноги
            a.bomb = 1; const h = fig.handsW[0].slice(), gx = B.x + B.face * 6;
            custom(.25, () => mk('circle', { r: 2.2, fill: '#2C2624' }, fxFront), (o) => { const u = o.age / .25; o.el.setAttribute('cx', f2(lerp(h[0], gx, u))); o.el.setAttribute('cy', f2(lerp(h[1], FLOOR - 2, u) - 10 * Math.sin(PI * u))); });
          }
          if (t > .55 && !a.c1) { a.c1 = 1; smokeCloud(B.x + B.face * 4); }
          if (t > .78 && t < 1.5) B.alpha = B.alphaT = 0;
          if (t > 1.25 && !a.moved) { a.moved = 1; B.x = tx; B.anchor = null; B.trail.length = 0; smokeCloud(tx); }
          if (t >= 1.5 && !a.show) { a.show = 1; B.alpha = B.alphaT = 1; }
          if (t < .3) return mix(STAND, WIND, smooth(t / .3));
          if (t < .55) return mix(WIND, THROW, smooth((t - .3) / .25));
          if (t < 1.25) return THROW;
          if (t < 2.5) return HERO;
          return mix(HERO, pose({ hy: 30, smile: 1, sa: [40, 7], ef: [60, 9] }), smooth((t - 2.5) / .7));
        });
      }
      case 'lightning': {   // молния из ладоней в пол: ломаная перестраивается на каждом кадре
        const d = rr(70, 110), tx = clamp(B.x + B.face * d, fr[0], fr[1]);
        if (Math.abs(tx - B.x) < 50 || !zoneFree(Math.min(B.x, tx) - 4, FLOOR - 50, Math.max(B.x, tx) + 4, FLOOR)) return null;
        const CH = pose({ sf: [158, 150], sa: [16, 16], ef: [8, 8], hp: -16, tl: -4, hf: [8, -4], kf: [12, 10], brow: -1 });
        const SH = pose({ sf: [74, 66], sa: [6, 6], ef: [4, 6], tl: 12, hf: [26, -12], kf: [26, 8], hp: 6, brow: -1, mouth: .5 });
        let bolt = null;
        return gest('lightning', 3.6, .15, (t, a) => {
          if (t > .3 && t < 1 && chance(.5)) { const h = fig.palmsW[chance(.5) ? 0 : 1]; sparks(h[0], h[1], 1, '#FFD84D'); }
          if (t > 1 && !bolt) {
            bolt = boltFx(); a.mark = mk('ellipse', { cx: tx, cy: FLOOR - .5, rx: 0, ry: 1.6, fill: '#3A2A20', opacity: .5 }, fxBack);
            const from = [0, 0];
            a.afterRender = () => {
              const h = fig.palmsW;
              from[0] = (h[0][0] + h[1][0]) / 2; from[1] = (h[0][1] + h[1][1]) / 2;
              bolt.anchor(from);
            };
          }
          if (bolt) {
            const on = t > 1 && t < 2.3 && Math.floor(t * 16) % 4 !== 3, h = fig.palmsW, from = [(h[0][0] + h[1][0]) / 2, (h[0][1] + h[1][1]) / 2];
            bolt.set(from, [tx, FLOOR - 1], on);
            if (on) { a.mark.setAttribute('rx', f2(Math.min(7, (t - 1) * 8))); if (chance(.5)) sparks(tx, FLOOR - 2, 2, '#FFD84D'); }
            if (t >= 2.3 && !a.done) { a.done = 1; bolt.g.remove(); const m = a.mark; custom(2, () => m, (o) => m.setAttribute('opacity', (.5 * (1 - o.age / 2)).toFixed(2)));
              for (let i = 0; i < 5; i++) particle({ x: tx + rr(-3, 3), y: FLOOR - 2, vx: rr(-3, 3), vy: rr(-14, -8), r: rr(1.2, 2), life: rr(1.4, 2.2), fill: '#9C948E', grow: 2.4, op: .5 }); }
          }
          if (t < 1) { const p = mix(STAND, CH, smooth(t / .5)); p.ef[0] += 5 * Math.sin(t * 30) * smooth((t - .4) / .4); return p; }
          if (t < 2.35) { const p = mix(CH, SH, smooth((t - 1) / .12)); p.ef[0] += 5 * Math.sin(t * 43); p.ef[1] += 5 * Math.cos(t * 37); return p; }
          return mix(SH, pose({ hy: 30, smile: 1, brow: .3 }), smooth((t - 2.35) / .8));
        });
      }
      case 'fire': {   // огненный шар: копит между ладоней и толкает вдоль пола
        let tx = clamp(B.x + B.face * 190, fr[0], fr[1]);
        while (Math.abs(tx - B.x) > 60 && !zoneFree(Math.min(B.x, tx) - 6, FLOOR - 36, Math.max(B.x, tx) + 6, FLOOR)) tx -= B.face * 10;
        if (Math.abs(tx - B.x) <= 60) return null;
        const CHG = pose({ hf: [30, -8], kf: [44, 12], tl: 16, sf: [24, 30], sa: [24, 24], ef: [100, 96], ea: [-28, -28], hp: 10, brow: -1 });
        const PSH = pose({ hf: [36, -16], kf: [46, 6], tl: 18, sf: [84, 80], sa: [4, 4], ef: [4, 6], hp: 4, brow: -1, mouth: .7 });
        let ball = null;
        return gest('fire', 3.2, .1, (t, a) => {
          const h = fig.handsW, hc = [(h[0][0] + h[1][0]) / 2 + B.face * 2, (h[0][1] + h[1][1]) / 2];
          if (t > .3 && !ball) ball = fireBall(hc, tx);
          if (ball && !ball.go) { ball.at = hc; ball.r = 5.5 * smooth((t - .3) / .9); if (t > 1.35) { ball.go = 1; B.sqV -= 1.5; } }
          if (t < .3) return mix(STAND, CHG, smooth(t / .3));
          if (t < 1.35) { const p = copy(CHG); p.ef[0] += 4 * Math.sin(t * 34); return p; }
          if (t < 1.6) return mix(CHG, PSH, smooth((t - 1.35) / .12));
          if (t < 2.3) return PSH;
          return mix(PSH, pose({ hy: 30, smile: 1, sa: [30, 7], ef: [70, 9], sf: [20, -3] }), smooth((t - 2.3) / .7));
        });
      }
      case 'disk': {   // знак Диска поднимается из люка в полу, бросок как фрисби, возврат в руку и обратно в люк
        const DK = brand.roles.disc || neutralPropImages.disk;
        if (!DK || B.surf.kind !== 'floor') return null;
        let D = 220; const f = B.face;
        while (D > 90 && !zoneFree(Math.min(B.x, B.x + f * D) - 12, FLOOR - 60, Math.max(B.x, B.x + f * D) + 12, FLOOR - 10)) D -= 10;
        if (D <= 90) return null;
        const R = 9, hx = B.x + f * 12;
        const DOWN = pose({ hf: [70, 64], kf: [110, 100], tl: 34, sf: [60, 50], sa: [10, 10], ef: [10, 10], hp: 8, hy: 10 });
        const HOLD = pose({ sf: [70, -6], sa: [10, 6], ef: [40, 6], tl: 4, smile: .6 });
        const WIND = pose({ hf: [20, -6], kf: [24, 8], sf: [20, -6], sa: [40, 6], ef: [120, 6], tl: -6, ts: -14, hy: -10, brow: -.4 });
        const THROW = pose({ hf: [26, -12], kf: [30, 6], sf: [96, -10], sa: [6, 6], ef: [0, 6], tl: 10, ts: 10, mouth: .5 });
        const CATCH = pose({ sf: [92, 88], sa: [8, 8], ef: [24, 24], tl: -2, smile: 1, brow: .4 });
        const FOLLOW = pose({ hf: [8, -4], kf: [12, 6], sf: [34, 10], sa: [10, 8], ef: [40, 22], tl: 4, brow: .3 });
        const st = { x: hx, y: FLOOR + R, on: 0, hatch: 0 };
        custom(9, () => { const g = mk('g', {}, fxFront); mk('ellipse', { fill: '#2A2522', opacity: 0 }, g);
          mk('image', { href: DK, width: 2 * R, height: 2 * R, opacity: 0, preserveAspectRatio: 'xMidYMid meet' }, g); return g; }, (o, dt) => {
          st.miss = st.ping ? 0 : (st.miss || 0) + dt; st.ping = false;
          if (st.done || st.miss > .2) { o.age = o.life; o.el.remove(); return; }
          const c = o.el.children;
          c[0].setAttribute('cx', f2(hx)); c[0].setAttribute('cy', f2(FLOOR - .5)); c[0].setAttribute('rx', f2(11 * st.hatch)); c[0].setAttribute('ry', f2(2.2 * st.hatch)); c[0].setAttribute('opacity', (.85 * st.hatch).toFixed(2));
          // знак ниже пола прячем: виден только край над люком
          c[1].setAttribute('x', f2(st.x - R)); c[1].setAttribute('y', f2(st.y - R)); c[1].setAttribute('opacity', (st.on * clamp((FLOOR - st.y + R) / (2 * R), 0, 1)).toFixed(2));
        });
        const T0 = 1.5, TF = 1.6;   // бросок в T0, полёт туда и обратно TF секунд
        return gest('disk', 6, .2, (t) => {
          st.ping = true; B.face = f;
          const h = fig.handsW[0], hand = [h[0] + f * 3, h[1]];
          st.hatch = smooth(t / .3) * (1 - smooth((t - 5.2) / .4));
          if (t < .9) { st.on = 1; st.x = hx; st.y = lerp(FLOOR + R, FLOOR - 26, smooth((t - .2) / .7)); if (t > .2 && t < .25) puff(hx, FLOOR, 3, '#B5ADA7'); }
          else if (t < T0) { st.x = hand[0]; st.y = hand[1]; }
          else if (t < T0 + TF) { const u = (t - T0) / TF, k = Math.sin(PI * u); st.x = lerp(hand[0], B.x + f * D, k); st.y = hand[1] - 16 * Math.sin(PI * Math.min(1, u * 2)) * (u < .5 ? 1 : 0) - 8 * Math.sin(2 * PI * u) * (u > .5 ? -1 : 0);
            if (chance(.5)) particle({ x: st.x - f * (u < .5 ? 8 : -8), y: st.y + rr(-2, 2), vx: 0, vy: rr(-4, 4), r: rr(.8, 1.4), life: .3, fill: '#3A8DFF', grow: -1, op: .6, back: true }); }
          else if (t < 4.4) { st.x = hand[0]; st.y = hand[1]; }
          else if (t < 5.2) { const u = smooth((t - 4.4) / .8); st.x = lerp(hand[0], hx, u); st.y = lerp(hand[1], FLOOR + R + 2, u); }
          else st.on = 0;
          if (t >= 5.95) st.done = true;
          if (t < .4) return mix(STAND, DOWN, smooth(t / .4));
          if (t < .9) return DOWN;
          if (t < 1.2) return mix(DOWN, HOLD, smooth((t - .9) / .3));
          if (t < T0 - .05) return mix(HOLD, WIND, smooth((t - 1.2) / .25));
          if (t < T0 + .15) return mix(WIND, THROW, smooth((t - T0 + .05) / .2));
          // после броска рука не висит «как у зомби»: опускается, взгляд провожает знак, к возврату руки встречают его
          if (t < T0 + TF - .45) { const p = mix(THROW, FOLLOW, smooth((t - T0 - .15) / .45)); p.hp = -6 * Math.sin(PI * (t - T0) / TF); p.smile = 1; return p; }
          if (t < 4.4) return mix(FOLLOW, CATCH, smooth((t - T0 - TF + .45) / .4));
          if (t < 5.2) return mix(CATCH, DOWN, smooth((t - 4.4) / .5));
          return mix(DOWN, pose({ hy: 30, smile: 1, sa: [30, 7], ef: [70, 9] }), smooth((t - 5.2) / .7));
        }, { frameBounds: [Math.max(0, Math.min(B.x - 36, B.x + f * D - 14)), FLOOR - 90,
          Math.min(1280, Math.max(B.x + 36, B.x + f * D + 14)), FLOOR + 12] });
      }
      case 'mail': {   // знак Почты улетает за край слайда, через секунду прилетает ответ — прямо в руку
        const ML = brand.roles.message || neutralPropImages.mail;
        if (!ML || B.surf.kind !== 'floor') return null;
        const go = makeRoom('mail', 70, 20); if (go !== true) return go;
        const f = B.x < 640 ? -1 : 1, ex = f < 0 ? -30 : 1310, R = 7;
        const HOLD = pose({ sf: [70, -6], sa: [10, 6], ef: [40, 6], tl: 4, smile: .6, hp: 10 });
        const WIND = pose({ sf: [-20, -6], sa: [30, 6], ef: [100, 6], tl: -6, ts: -10, brow: -.3 });
        const THROW = pose({ hf: [24, -10], kf: [28, 6], sf: [120, -10], sa: [6, 6], ef: [0, 6], tl: 8, ts: 8 });
        const LOOK = pose({ sf: [-6, -6], sa: [6, 6], ef: [12, 12], hy: 40, brow: .6, mouth: .3 });
        const READ = pose({ sf: [60, -6], sa: [10, 6], ef: [70, 6], hp: 18, smile: 1, brow: .5 });
        const st = { x: 0, y: 0, on: 0 };
        let el = null, h0 = null;
        return gest('mail', 6.4, .3, (t) => {
          st.ping = true; B.face = f;
          const h = fig.handsW[0], hand = [h[0] + f * 3, h[1] - 2];
          if (!el) { el = custom(6.6, () => mk('image', { href: ML, width: 2 * R, height: 2 * R, opacity: 0 }, fxFront), (o, dt) => {
            st.miss = st.ping ? 0 : (st.miss || 0) + dt; st.ping = false;   // действие прервали — знак убираем
            if (st.done || st.miss > .2) { o.age = o.life; o.el.remove(); return; }
            o.el.setAttribute('x', f2(st.x - R)); o.el.setAttribute('y', f2(st.y - R)); o.el.setAttribute('opacity', st.on.toFixed(2)); }); }
          if (t < 1.1) { st.x = hand[0]; st.y = hand[1]; st.on = smooth((t - .2) / .3); }
          else if (t < 2) { if (!h0) h0 = hand; const u = (t - 1.1) / .9; st.x = lerp(h0[0], ex, u * u); st.y = h0[1] - 40 * Math.sin(PI * Math.min(1, u * 1.2)) * (1 - u) - 10 * u; }
          else if (t < 3) st.on = 0;
          else if (t < 3.9) { const u = smooth((t - 3) / .9); st.on = 1; st.x = lerp(ex, hand[0], u); st.y = lerp(hand[1] - 60, hand[1], u) - 30 * Math.sin(PI * u); if (t > 3.85 && !st.hit) { st.hit = 1; sparks(hand[0], hand[1], 6, '#FFC400'); } }
          else if (t < 5.6) { st.x = hand[0]; st.y = hand[1]; }
          else { st.on = 1 - smooth((t - 5.6) / .4); st.x = hand[0]; st.y = hand[1]; }
          if (t > 6.3) st.done = true;
          if (t < .4) return mix(STAND, HOLD, smooth(t / .4));
          if (t < .9) return mix(HOLD, WIND, smooth((t - .5) / .4));
          if (t < 1.25) return mix(WIND, THROW, smooth((t - .9) / .2));
          if (t < 2.2) return THROW;
          if (t < 3.2) return mix(THROW, LOOK, smooth((t - 2.2) / .4));
          if (t < 3.9) return mix(LOOK, HOLD, smooth((t - 3.2) / .5));
          if (t < 5.6) return mix(HOLD, READ, smooth((t - 3.9) / .4));
          return mix(READ, pose({ hy: 30, smile: 1, sa: [30, 7], ef: [70, 9] }), smooth((t - 5.6) / .7));
        }, { frameBounds: [Math.max(0, Math.min(B.x - 36, ex - R)), FLOOR - 145,
          Math.min(1280, Math.max(B.x + 36, ex + R)), FLOOR + 12] });
      }
      case 'calendar': {   // знак Календаря выскакивает над головой: хлопок по лбу — и бегом, будто опаздывает на встречу
        const CL = brand.roles.reminder || neutralPropImages.calendar;
        if (!CL || B.surf.kind !== 'floor') return null;
        const go = makeRoom('calendar', 92, 14); if (go !== true) return go;
        const tx = randomFloorX(260, 700); if (tx == null) return null;
        const R = 9, ALERT = Object.assign(copy(STAND), { brow: 1, mouth: .8, hy: 20 }),
          PALM = pose({ sf: [138, -6], sa: [19, 6], ef: [30, 6], ea: [-64, 0], hp: 14, hy: 10, brow: 1, mouth: .6 });
        const st = { on: 0, lift: 0 };
        custom(4.5, () => { const g = mk('g', { opacity: 0 }, fxFront); mk('image', { href: CL, width: 2 * R, height: 2 * R }, g); mk('text', { 'font-size': 11, 'font-weight': 700, fill: '#FF3333', 'text-anchor': 'middle' }, g).textContent = '!'; return g; }, (o) => {
          const e = fig.eyesW[0], x = (e[0] + fig.eyesW[1][0]) / 2, y = Math.min(e[1], fig.eyesW[1][1]) - 22 - 6 * st.lift, c = o.el.children;
          c[0].setAttribute('x', f2(x - R)); c[0].setAttribute('y', f2(y - R)); c[1].setAttribute('x', f2(x + R + 3)); c[1].setAttribute('y', f2(y - 2));
          o.el.setAttribute('opacity', (smooth(o.age / .15) * (1 - smooth((o.age - 3.6) / .6))).toFixed(2));
        });
        plan([() => walkTo(tx, 'jog')]);
        return gest('calendar', 1.7, .4, (t) => {
          st.lift = bump(t, 0, .3);
          if (t < .35) return mix(STAND, ALERT, smooth(t / .15));
          if (t < .55) return mix(ALERT, PALM, smooth((t - .35) / .2));
          if (t < 1.3) { const p = copy(PALM); p.hp += 4 * Math.sin(t * 20) * smooth((t - .55) / .08) * (1 - smooth((t - .6) / .5)); return p; }
          return mix(PALM, pose({ brow: .8, mouth: .4 }), smooth((t - 1.3) / .4));
        });
      }
      case 'portal': {   // кольцо-портал: ныряет рыбкой в одно кольцо и вылетает из другого
        const go = makeRoom('portal', 66, 34); if (go !== true) return go;
        const f = B.face, x1 = B.x + f * 30;
        if (!inSpans(W.floor.spans, x1) || !zoneFree(x1 - 14, FLOOR - 66, x1 + 14, FLOOR)) return null;
        const xs = [];
        for (const [a, b] of W.floor.spans) for (let x = a + 14; x <= b - 14; x += 8) {
          const xe = x + f * 80; if (Math.abs(x - x1) < 200 || !inSpans(W.floor.spans, xe)) continue;
          if (zoneFree(Math.min(x, xe) - 14, FLOOR - 66, Math.max(x, xe) + 14, FLOOR)) xs.push(x);
        }
        if (!xs.length) return null;
        const x2 = xs[Math.floor(rnd() * xs.length)], RY = FLOOR - 27;
        const CAST = pose({ sf: [86, 52], sa: [24, 34], ef: [36, 70], tl: 2, brow: -.6, hy: 4 });
        const DIVE = pose({ rot: 82, sf: [176, 172], sa: [6, 6], ef: [0, 0], hf: [0, -6], kf: [6, 22], af: [-40, -40], hp: -60, tl: 0, smile: 1 });
        let ph = 0, t0 = 0, x0, y0, launchPose = null;
        return A('portal', 'ground', (a) => {
          B.cam = 0; B.face = f;
          if (ph === 0) {
            if (!a.rings) { a.rings = 1; portalRing(x1, 5); portalRing(x2, 5); }
            if (a.t < 1.3) {
              const p = mix(STAND, CAST, smooth(a.t / .35)), wave = smooth(a.t / .18) * (1 - smooth((a.t - 1.1) / .2));
              p.sf[0] += 26 * Math.sin(a.t * 10) * wave; p.sf[1] += 26 * Math.cos(a.t * 10) * wave; return p;
            }
            if (a.t < 1.56) {
              const u = smooth((a.t - 1.3) / .26), p = mix(CAST, CROUCH, u), arms = mix(CAST, PUSH, u);
              for (const key of ['sf', 'sa', 'ef', 'ea']) p[key] = arms[key];
              launchPose = copy(p); return p;
            }
            ph = 1; t0 = a.t; B.mode = 'free'; x0 = B.x; y0 = B.y; B.sqV += 3.5; dust(B.x, FLOOR, .4);
          }
          const t = a.t - t0, dd = 240 * t, d1 = Math.abs(x1 - x0) + 34;
          const p = mix(launchPose || PUSH, DIVE, smooth(t / .18)); p.still = 1;
          if (dd < d1) { B.x = x0 + f * dd; B.y = lerp(y0, RY, smooth(dd / 26)) - 4 * Math.sin(PI * dd / d1); B.clip = { x: x1, keep: -f }; }
          else {
            const e = dd - d1; B.x = x2 - f * 34 + f * e; B.y = RY - 3 * Math.sin(Math.min(1, e / 70) * PI); B.clip = { x: x2, keep: f };
            if (e > 70) { B.clip = null; B.trail.length = 0; B.queue.unshift(() => fall(20)); return null; }
          }
          return p;
        });
      }
      case 'tracker': {   // знак Трекера падает на кромку ближайшей плитки, рядом зелёная галочка «готово»
        const TR = brand.roles.mark || neutralPropImages.tracker;
        if (!TR || B.surf.kind !== 'floor') return null;
        const ps = trackerCandidates(W, B, FLOOR);
        if (!ps.length) return null;
        // над точкой посадки должно быть пусто (spans — свободные участки над кромкой); нижняя плитка — ближе к нему
        const q = ps.sort((a, b) => b.y - a.y)[0];
        if (!q) return null;
        const R = 9, want = B.x + (Math.sign((q.x1 + q.x2) / 2 - B.x) || B.face) * rr(70, 150);
        let lx = null; for (const [a, b] of q.spans) if (b - a >= 2 * R + 8) { const x = clamp(want, a + R + 4, b - R - 4); if (lx == null || Math.abs(x - want) < Math.abs(lx - want)) lx = x; }
        const ly = q.y - R;
        B.face = Math.sign(lx - B.x) || B.face;
        const mark = custom(5, () => { const g = mk('g', { opacity: 0 }, fxFront); mk('image', { href: TR, width: 2 * R, height: 2 * R, preserveAspectRatio: 'xMidYMid meet' }, g);
          const c = mk('g', { opacity: 0 }, g); mk('circle', { r: 5, fill: '#2FB560' }, c); mk('path', { d: 'M-2.4 .2L-.6 2 2.6-1.8', fill: 'none', stroke: '#FFF', 'stroke-width': 1.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, c); return g; }, (o) => {
          const t = o.age - .35, u = clamp(t / .45, 0, 1), y = ly - 34 * (1 - u) * (1 - u) - 3 * bump(t, .45, .7);
          o.el.setAttribute('opacity', (t < 0 ? 0 : Math.min(1, t / .15) * (1 - smooth((o.age - 4.4) / .6))).toFixed(2));
          const c = o.el.children; c[0].setAttribute('x', f2(lx - R)); c[0].setAttribute('y', f2(y - R));
          const k = smooth((t - .8) / .25); c[1].setAttribute('opacity', k.toFixed(2)); c[1].setAttribute('transform', 'translate(' + f2(lx + R + 2) + ',' + f2(y - R + 1) + ') scale(' + f2(.6 + .4 * k) + ')');
          if (t > .45 && !o.hit) { o.hit = true; sparks(lx, ly + R, 6, '#2FB560'); }
        });
        // Знак остаётся после жеста: его полёт, галочка и затухание — одна
        // цель камеры, принадлежащая FX, а не уже завершённому point().
        mark.frameBounds = [lx - R - 2, ly - R - 36, lx + R + 9, ly + R + 2];
        return point();
      }
      case 'grapple': {   // крюк-кошка: выстрел на блок выше, трос натягивается — подтягивается и вылезает наверх
        const sc = S * B.scale, cands = []; let gT = B.grapT; B.grapT = null;
        if (gT && gT.idx != null && gT.idx !== W.idx) gT = null;   // цель с прошлого слайда
        if (!gT && W.time - (B.downAt ?? -99) < 15) return null;   // только что слез — крюком обратно не лезет
        if (gT) cands.push({ q: gT.q, x: gT.x, d: 0 }); else cands.push(...grappleTargets());
        if (!cands.length) return null;
        cands.sort((u, v) => u.d - v.d);
        const c = gT ? cands[0] : cands[Math.floor(rnd() * Math.min(4, cands.length))], f = Math.sign(c.x - B.x) || 1, hook = [c.x - f * 3, c.q.y + .5];
        if (c.st != null && Math.abs(c.st - B.x) > 4) {   // к грани пешком, крюк — оттуда
          B.grapT = { q: c.q, x: c.x, idx: W.idx };
          plan([() => powerMake('grapple')]);
          return walkTo(c.st, Math.abs(c.st - B.x) > 120 ? 'jog' : 'walk');
        }
        B.face = f;
        const ci = camSide(), sh = [B.x + f * 2 * sc, B.y - 24 * sc], aim = deg(Math.atan2(Math.abs(hook[0] - sh[0]), hook[1] - sh[1]));
        const AIM = pose({ sf: sd(ci, aim, aim - 30), sa: sd(ci, 8, 22), ef: sd(ci, 0, 40), tl: -4, hp: -24, brow: -.6, hf: [8, -6], kf: [10, 8] });
        const TUG = Object.assign(copy(AIM), { tl: -12, hf: [-6, 16], kf: [6, 22] }); TUG.sf[ci] = aim - 8;
        const ZIP = pose({ sf: [168, 158], sa: [10, 12], ef: [8, 22], tl: -6, hp: -20, hf: [24, -8], kf: [34, 50], af: [-30, -30], smile: .6 });
        const OVER = pose({ sf: [30, 30], sa: [16, 16], ef: [60, 60], tl: 30, hp: -6, hf: [96, 20], kf: [110, 30], af: [-10, -10] });
        let hk = null, x0, y0, xh, yh, T1;
        const rope = prop(fxFront, g => {
          mk('path', { fill: 'none', stroke: '#5A4B42', 'stroke-width': .6, 'stroke-linecap': 'round' }, g);
          mk('path', { d: 'M0 0l-2.2 -2.4M0 0l2.2 -2.4M0 0v-3.2M0 0l0 2.6', stroke: '#4A4E57', 'stroke-width': .9, 'stroke-linecap': 'round', fill: 'none' }, g);   // кошка
          const gun = mk('g', { 'data-buddy-prop': 'grapple-launcher' }, g);
          mk('rect', { x: -.75, y: -1.4, width: 1.5, height: 2.8, rx: .35, fill: '#33302E' }, gun);   // рукоять внутри кулака
          mk('rect', { x: -1.2, y: -2.8, width: 5.2, height: 1.8, rx: .5, fill: '#33302E' }, gun);
          return g;
        }, (g, st) => {
          const h = legacyGrip(ci), [ln, cat, gun] = g.children;
          const tip = st.tip || h;
          const ang = st.u > 0 ? Math.atan2(tip[1] - h[1], tip[0] - h[0]) : rad(f > 0 ? -40 : -140),
            muzzle = [h[0] + 4 * Math.cos(ang) + 1.9 * Math.sin(ang), h[1] + 4 * Math.sin(ang) - 1.9 * Math.cos(ang)];
          ln.setAttribute('d', st.u > 0 ? `M${f2(muzzle[0])} ${f2(muzzle[1])}Q${f2((muzzle[0] + tip[0]) / 2)} ${f2((muzzle[1] + tip[1]) / 2 + st.sag)} ${f2(tip[0])} ${f2(tip[1])}` : '');
          cat.setAttribute('transform', `translate(${f2(tip[0])} ${f2(tip[1])}) rotate(${(f * 180).toFixed(0)}) scale(${st.u > 0 ? 1 : 0})`);
          gun.setAttribute('transform', `translate(${f2(h[0])} ${f2(h[1])}) rotate(${deg(ang).toFixed(1)})`);
          gun.setAttribute('opacity', st.gun.toFixed(2));
        });
        rope.u = 0; rope.sag = 0; rope.gun = 0;
        return A('grapple', 'ground', (a, dt) => {
          rope.ping = true; B.face = f; B.cam = .3;
          const t = a.t;
          rope.gun = smooth(t / .3) * (t > T1 + .6 ? 1 - smooth((t - T1 - .6) / .3) : 1);
          const held = p => { p.handFist = sd(ci, rope.gun, 0); return p; };
          if (t < .55) { rope.u = 0; return held(mix(STAND, AIM, smooth(t / .45))); }
          if (t < .95) {   // выстрел: кошка летит по прямой, трос тянется следом
            const u = smooth((t - .55) / .4), h = fig.handsW[ci];
            if (!hk) hk = h.slice();
            rope.u = u; rope.tip = [lerp(hk[0], hook[0], u), lerp(hk[1], hook[1], u) - 14 * Math.sin(PI * u)]; rope.sag = 0;
            return held(copy(AIM));
          }
          if (!a.hit) { a.hit = 1; rope.tip = hook; sparks(hook[0], hook[1], 5, '#C9C2BA'); }
          if (t < 1.35) { rope.sag = 0; return held(mix(AIM, TUG, bump(t, .95, 1.35))); }   // дёрнул — держит
          if (x0 == null) { x0 = B.x; y0 = B.y; const ed = f > 0 ? c.q.x1 : c.q.x2; xh = Math.abs(hook[0] - ed) < 26 ? ed - f * HX : hook[0] - f * 2 * sc; yh = hook[1] + 40 * sc; T1 = 1.35 + clamp(Math.hypot(xh - x0, yh - y0) / 230, .5, 1.3); B.mode = 'free'; dust(B.x, B.surfY, .5); }
          if (t < T1) {   // подтягивается: разгон и торможение у кромки
            const u = (t - 1.35) / (T1 - 1.35), e = u * u * (3 - 2 * u);
            B.x = lerp(x0, xh, e); B.y = lerp(y0, yh, e) + 6 * Math.sin(PI * u) * sc;
            // Наземный рывок возвращается в AIM. Подтягивание начинает ту же
            // позу; колебание ноги входит постепенно вместе с разгоном.
            const p = mix(AIM, ZIP, smooth(u / .3)); p.hf[0] += 10 * Math.sin(t * 9) * (1 - u) * smooth(u / .12); p.still = 1;
            return held(p);
          }
          if (t < T1 + .55) {   // выбирается на блок
            const u = smooth((t - T1) / .55), top = c.q.y - REACH_LOW * sc;
            B.x = lerp(xh, c.x + f * 4, u); B.y = lerp(yh, top, u) - 8 * Math.sin(PI * u) * sc;
            return held(u < .5 ? mix(ZIP, OVER, u * 2) : mix(OVER, STAND, (u - .5) * 2));
          }
          if (!a.top) { a.top = 1; B.mode = 'ground'; B.surf = c.q; B.surfY = c.q.y; B.anchor = null; rope.tip = hook; dust(B.x, c.q.y, .3); }
          if (t > T1 + 1.1) { rope.done = true; return null; }
          return held(mix(STAND, pose({ smile: 1, hy: 26 }), smooth((t - T1 - .55) / .5)));
        });
      }
      case 'construct': {   // как Зелёный фонарь: кольцо на кулаке собирает из света копию предмета со слайда
        if (B.surf.kind !== 'floor') return null;
        const b = boxD(), items = [];
        for (const e of slides[W.idx].querySelectorAll('svg, img')) {
          if (e.closest('.screen') || e.closest('.buddy') || !shown(e)) continue;
          const d = toD(e.getBoundingClientRect(), b), w = d.x2 - d.x1, h = d.y2 - d.y1;
          if (w >= 14 && w <= 90 && h >= 14 && h <= 90 && d.y2 < FLOOR - 40) items.push({ e, w, h, cx: (d.x1 + d.x2) / 2 });
        }
        if (!items.length) return null;
        const go = makeRoom('construct', 110, 46); if (go !== true) return go;
        const it = items[Math.floor(rnd() * items.length)], f = Math.sign(it.cx - B.x) || B.face, ci = f > 0 ? 0 : 1;
        const k = Math.min(1, 34 / Math.max(it.w, it.h)), W2 = it.w * k, H2 = it.h * k;   // копия — около 34 px
        const FIST = pose({ sf: sd(ci, 96, 20), sa: sd(ci, 10, 12), ef: sd(ci, 0, 70), ea: sd(ci, 0, -20), tl: -2, hp: -6, brow: -.8 });
        const ADMIRE = pose({ sf: sd(ci, 70, 10), sa: sd(ci, 14, 10), ef: sd(ci, 40, 30), hy: 18, smile: 1, brow: .6 });
        let wrap = null, undo = null, pos = null;
        const ring = prop(fxFront, g => {
          mk('circle', { r: 3.6, fill: 'rgba(57,231,95,.25)' }, g); mk('circle', { r: 1.3, fill: 'none', stroke: '#2BD15A', 'stroke-width': .7 }, g);
          mk('path', { fill: 'rgba(57,231,95,.16)', stroke: 'rgba(43,209,90,.5)', 'stroke-width': .4 }, g);   // луч к копии
          return g;
        }, (g, st) => {
          const h = legacyGrip(ci), [glow, band, beam] = g.children;
          g.setAttribute('opacity', st.amount.toFixed(3));
          for (const e of [glow, band]) { e.setAttribute('cx', f2(h[0])); e.setAttribute('cy', f2(h[1])); }
          glow.setAttribute('r', f2(2.6 + 1.6 * st.glow)); glow.setAttribute('opacity', (.4 + .6 * st.glow).toFixed(2));
          if (pos && st.beam > 0) { const r = (Math.max(W2, H2) / 2) * st.beam;
            beam.setAttribute('d', `M${f2(h[0])} ${f2(h[1])}L${f2(pos[0])} ${f2(pos[1] - r)}L${f2(pos[0])} ${f2(pos[1] + r)}Z`); beam.setAttribute('opacity', st.beam.toFixed(2)); }
          else beam.setAttribute('opacity', 0);
        });
        ring.glow = 0; ring.beam = 0; ring.amount = 0;
        return gest('construct', 6.4, .45, (t, a) => {
          ring.ping = true; B.face = f;
          ring.amount = smooth(t / .4) * (1 - smooth((t - 5.4) / .5));
          const held = p => { p.handFist = sd(ci, ring.amount, 0); return p; };
          const h = fig.handsW[ci];
          if (!wrap) {
            wrap = document.createElement('div');
            wrap.style.cssText = 'position:absolute;left:0;top:0;width:' + W2 + 'px;height:' + H2 + 'px;transform-origin:50% 50%;pointer-events:none;'
              + 'filter:brightness(0) invert(64%) sepia(86%) saturate(620%) hue-rotate(78deg) drop-shadow(0 0 3px rgba(57,231,95,.9)) drop-shadow(0 0 7px rgba(57,231,95,.5));opacity:0';
            const cl = it.e.cloneNode(true); cl.style.cssText = 'width:100%;height:100%;display:block;margin:0'; cl.removeAttribute('class'); wrap.appendChild(cl); host.appendChild(wrap);
            undo = () => wrap.remove(); B.restore.push(undo);
          }
          pos = [B.x + f * 34, B.y - 26 * S * B.scale + 2 * Math.sin(t * 2.4)];
          const grow = smooth((t - .9) / .9), fade = 1 - smooth((t - 5.0) / .6);
          ring.glow = smooth((t - .3) / .4) * (1 - smooth((t - 5.4) / .5)) * (1 + .3 * Math.sin(t * 9));
          ring.beam = t > .8 && t < 2 ? bump(t, .8, 2) : 0;
          const sc2 = grow * (1 + .12 * bump(t, 1.5, 2.2)) * (t > 5 ? 1 + .25 * (1 - fade) : 1);
          wrap.style.transform = 'translate(' + (pos[0] - W2 / 2).toFixed(1) + 'px,' + (pos[1] - H2 / 2).toFixed(1) + 'px) scale(' + sc2.toFixed(3) + ') rotate(' + (6 * Math.sin(t * 1.7)).toFixed(1) + 'deg)';
          wrap.style.opacity = (.85 * grow * fade).toFixed(2);
          if (t > .9 && t < 1.8 && chance(.5)) particle({ x: lerp(h[0], pos[0], rnd()), y: lerp(h[1], pos[1], rnd()) + rr(-3, 3), vx: rr(-6, 6), vy: rr(-10, -2), r: rr(.6, 1.2), life: .5, fill: '#39E75F', grow: -1, op: .8 });
          if (t > 5.0 && !a.burst) { a.burst = 1; sparks(pos[0], pos[1], 12, '#39E75F'); }
          if (t > 5.65 && !a.gone) { a.gone = 1; undo(); B.restore = B.restore.filter(x => x !== undo); }
          if (t > 6.3) ring.done = true;
          if (t < .7) return held(mix(STAND, FIST, smooth(t / .5)));
          if (t < 2.2) { const p = copy(FIST); p.sf[ci] += 3 * Math.sin(t * 30) * bump(t, .9, 2); return held(p); }   // кулак дрожит от усилия
          if (t < 2.7) return held(mix(FIST, ADMIRE, smooth((t - 2.2) / .5)));
          if (t < 5.0) { const p = copy(ADMIRE); p.hy = 18 + 14 * bump(t, 3.2, 4.4); return held(p); }   // любуется, косится в зал
          return held(mix(ADMIRE, pose({ smile: 1, hy: 24 }), smooth((t - 5.0) / .8)));
        });
      }
      case 'binoculars': {   // бинокль: в двойном круге — увеличенный кусок слайда, взгляд медленно ведёт по строке
        const b = boxD(), sl = slides[W.idx], targets = [];
        for (const e of sl.querySelectorAll('h1, h2, h3, p, li, img, svg')) {
          if (e.closest('.screen') || e.closest('.buddy') || !shown(e)) continue;
          const d = toD(e.getBoundingClientRect(), b);
          if (d.x2 - d.x1 < 30 || d.y2 > FLOOR - 50 || d.y1 < 20 || d.x1 < 0 || d.x2 > 1280) continue;
          targets.push(d);
        }
        if (!targets.length) return null;
        const tg = targets[Math.floor(rnd() * targets.length)], f = Math.sign((tg.x1 + tg.x2) / 2 - B.x) || B.face;
        const look = pose({ sf: [110, 110], sa: [-1, -1], ef: [72, 72], ea: [-18, -18], hp: -18, tl: -2, brow: .5 });   // кисти держат стволы у глаз, локти вперёд (подбор по 3D)
        const PRE = pose({ sf: [30, 30], sa: [4, 4], ef: [112, 112], ea: [-10, -10], hp: -8 });   // по пути: сначала сгибает локти, потом поднимает — без прямых рук
        const LR = 46, k2 = 1.9;   // радиус круга и увеличение
        let lens = null, inner = null, undo = null;
        const bino = prop3('binoculars', (st, k) => st.k > 0 ? { at: add(add(k.head, k.hF, 15.6), k.hU, 4.5), dir: k.hF, up: k.hU, k: st.k * 1.5 } : null);   // окуляры у глаз, стволами по взгляду
        bino.k = 0;
        return gest('binoculars', 6, .3, (t, a) => {
          bino.ping = true; B.face = f;
          bino.k = smooth((t - .55) / .12) * (1 - smooth((t - 4.76) / .12));   // в руках только пока кисти у глаз
          if (t > 5.4) bino.done = true;
          if (!lens && t > .8) {
            lens = document.createElement('div');
            lens.style.cssText = 'position:absolute;left:0;top:0;width:' + (LR * 3.4) + 'px;height:' + (LR * 2) + 'px;pointer-events:none;overflow:hidden;opacity:0';
            // два круга бинокля: центры (LR, LR) и (2,4·LR, LR), clip-path считает от левого верхнего угла
            lens.style.clipPath = 'path("M 0 ' + LR + ' a ' + LR + ' ' + LR + ' 0 1 0 ' + (2 * LR) + ' 0 a ' + LR + ' ' + LR + ' 0 1 0 ' + (-2 * LR) + ' 0 Z M ' + (1.4 * LR) + ' ' + LR + ' a ' + LR + ' ' + LR + ' 0 1 0 ' + (2 * LR) + ' 0 a ' + LR + ' ' + LR + ' 0 1 0 ' + (-2 * LR) + ' 0 Z")';
            inner = sl.cloneNode(true); inner.querySelectorAll('.buddy').forEach(x => x.remove());
            inner.style.cssText += ';position:absolute;left:0;top:0;width:1280px;height:720px;margin:0;transform-origin:0 0;background:#fff;opacity:1;visibility:visible;animation:none';
            inner.querySelectorAll('*').forEach(x => { x.style.animation = 'none'; });   // анимации входа слайда перебивают transform и прячут содержимое
            lens.appendChild(inner);
            const rim = document.createElementNS('http://www.w3.org/2000/svg', 'svg');   // тёмный ободок окуляров поверх картинки
            rim.setAttribute('width', LR * 3.4); rim.setAttribute('height', LR * 2); rim.style.cssText = 'position:absolute;left:0;top:0';
            rim.innerHTML = '<g fill="none" stroke="#2F3237" stroke-width="7"><circle cx="' + LR + '" cy="' + LR + '" r="' + LR + '"/><circle cx="' + (2.4 * LR) + '" cy="' + LR + '" r="' + LR + '"/></g>';
            lens.appendChild(rim); host.appendChild(lens);
            undo = () => lens.remove(); B.restore.push(undo);
          }
          if (lens) {
            const u = clamp((t - 1.2) / 3.4, 0, 1), cx = lerp(tg.x1 + 20, Math.max(tg.x1 + 20, tg.x2 - 20), smooth(u)), cy = (tg.y1 + tg.y2) / 2;
            const lx = clamp(cx - LR * 1.7, 4, 1276 - LR * 3.4), ly = clamp(cy - LR, 4, 716 - LR * 2);
            lens.style.transform = 'translate(' + lx.toFixed(1) + 'px,' + ly.toFixed(1) + 'px)';
            // внутри — слайд, увеличенный вокруг точки взгляда
            const gx = lx + LR * 1.7, gy = ly + LR;   // точка слайда под центром бинокля — её и увеличиваем
            inner.style.transform = 'translate(' + (LR * 1.7 - gx * k2).toFixed(1) + 'px,' + (LR - gy * k2).toFixed(1) + 'px) scale(' + k2 + ')';
            lens.style.opacity = (smooth((t - .8) / .4) * (1 - smooth((t - 4.7) / .4))).toFixed(2);
            if (t > 5.2 && !a.gone) { a.gone = 1; undo(); B.restore = B.restore.filter(x => x !== undo); }
          }
          if (t < .3) return mix(STAND, PRE, smooth(t / .3));
          if (t < .6) return mix(PRE, look, smooth((t - .3) / .3));
          if (t < 4.9) { const p = copy(look); p.hy += 4 * Math.sin(t * 1.1); p.still = 1; return p; }
          if (t < 5.15) return mix(look, PRE, smooth((t - 4.9) / .25));
          if (t < 5.5) return mix(PRE, pose({ smile: 1, hy: 26, brow: .6 }), smooth((t - 5.15) / .35));
          return pose({ smile: 1, hy: 26, brow: .6 });
        });
      }
      case 'magnet': {   // как Магнето: притягивает иконку со слайда, крутит над ладонями и возвращает на место
        if (B.surf.kind !== 'floor') return null;
        const b = boxD(), icons = [];
        for (const e of slides[W.idx].querySelectorAll('svg, img')) {
          if (e.closest('.screen') || e.closest('.buddy') || !shown(e)) continue;
          const d = toD(e.getBoundingClientRect(), b), w = d.x2 - d.x1, h = d.y2 - d.y1, cx = (d.x1 + d.x2) / 2;
          if (w >= 14 && w <= 72 && h >= 14 && h <= 72 && (B.keyMagnet || Math.abs(cx - B.x) < 560) && d.y2 < FLOOR - 70) icons.push({ e, d, w, h, cx, cy: (d.y1 + d.y2) / 2 });
        }
        if (!icons.length) return null;   // иконки ищем до того, как отходить: без них и отходить незачем
        const go = makeRoom('magnet', 120, 30); if (go !== true) return go;
        const ic = icons[Math.floor(rnd() * icons.length)];
        const POINT = pose({ sf: [118, 104], sa: [8, 14], ef: [0, 10], tl: -4, hp: -18, brow: -1 });
        const HOLD = pose({ sf: [166, 160], sa: [16, 16], ef: [12, 12], tl: -3, hp: -26, smile: 1, brow: .4 });
        let wrap = null, lines = null;
        const at = (x, y, sc, rot) => { wrap.style.transform = 'translate(' + (x - ic.w / 2).toFixed(1) + 'px,' + (y - ic.h / 2).toFixed(1) + 'px) scale(' + sc.toFixed(3) + ') rotate(' + rot.toFixed(1) + 'deg)'; };
        const bez = (p0, c, p1, u) => [(1 - u) * (1 - u) * p0[0] + 2 * u * (1 - u) * c[0] + u * u * p1[0], (1 - u) * (1 - u) * p0[1] + 2 * u * (1 - u) * c[1] + u * u * p1[1]];
        return gest('magnet', 7.2, .3, (t, a) => {
          B.face = Math.sign(ic.cx - B.x) || B.face;
          if (!wrap) {
            wrap = document.createElement('div');
            wrap.style.cssText = 'position:absolute;left:0;top:0;width:' + ic.w + 'px;height:' + ic.h + 'px;color:' + getComputedStyle(ic.e).color + ';transform-origin:50% 50%;filter:drop-shadow(0 4px 5px rgba(26,24,23,.2));pointer-events:none';
            const c = ic.e.cloneNode(true); c.style.cssText = 'width:100%;height:100%;display:block;margin:0'; c.removeAttribute('class'); wrap.appendChild(c); host.appendChild(wrap);
            const restoreVisibility = hideMagnetSource(ic.e);
            const undo = () => { restoreVisibility(); wrap.remove(); };
            B.restore.push(undo); a.undo = undo;
            lines = [0, 1].map(() => mk('path', { fill: 'none', stroke: '#FF6427', 'stroke-width': 1, 'stroke-dasharray': '3 3', 'stroke-linecap': 'round', opacity: 0 }, fxBack));
          }
          const hc = [(fig.handsW[0][0] + fig.handsW[1][0]) / 2, Math.min(fig.handsW[0][1], fig.handsW[1][1])];
          const holdP = [B.x + B.face * 3, hc[1] - ic.h * .4 - 6], src = [ic.cx, ic.cy], ctl = [(ic.cx + holdP[0]) / 2, Math.min(ic.cy, holdP[1]) - 50];
          let pos = src, sc = 1, rot = 0, pull = 0;
          if (t < .9) { pos = [src[0] + 1.6 * Math.sin(t * 70) * smooth(t / .9), src[1]]; pull = smooth(t / .5); }
          else if (t < 2.1) { const u = smooth((t - .9) / 1.2); pos = bez(src, ctl, holdP, u); sc = lerp(1, .78, u); rot = 360 * u; pull = 1; }
          else if (t < 4.6) { pos = [holdP[0] + 2 * Math.sin(t * 3), holdP[1] + 2.5 * Math.sin(t * 4.2)]; sc = .78 + .03 * Math.sin(t * 5); rot = 10 * Math.sin(t * 2.6); pull = .6; }
          else if (t < 5.8) { const u = smooth((t - 4.6) / 1.2); pos = bez(holdP, ctl, src, u); sc = lerp(.78, 1, u); rot = -360 * u; pull = 1 - u; }
          else if (!a.back) { a.back = 1; a.undo(); B.restore = B.restore.filter(f => f !== a.undo); sparks(ic.cx, ic.cy, 10); lines.forEach(l => l.remove()); }
          if (!a.back) {
            at(pos[0], pos[1], sc, rot);
            lines.forEach((l, i) => { const h = fig.handsW[i], m = [(h[0] + pos[0]) / 2 + (i ? 8 : -8), (h[1] + pos[1]) / 2 - 10];
              l.setAttribute('d', 'M' + f2(h[0]) + ' ' + f2(h[1]) + 'Q' + f2(m[0]) + ' ' + f2(m[1]) + ' ' + f2(pos[0]) + ' ' + f2(pos[1]));
              l.setAttribute('stroke-dashoffset', f2(-t * 18)); l.setAttribute('opacity', (.55 * pull).toFixed(2)); });
          }
          if (t < .9) return mix(STAND, POINT, smooth(t / .35));
          if (t < 2.1) return mix(POINT, HOLD, smooth((t - .9) / 1.2));
          if (t < 4.6) { const p = copy(HOLD); p.sf[0] += 4 * Math.sin(t * 3); p.sf[1] += 4 * Math.sin(t * 3 + 1); return p; }
          if (t < 5.8) return mix(HOLD, POINT, smooth((t - 4.6) / .4));
          return mix(POINT, pose({ hy: 30, smile: 1, brow: .3 }), smooth((t - 5.8) / .8));
        });
      }
      case 'ice': {   // как Айсмен: намораживает дорожку вдоль пола и скользит по ней
        let tx = clamp(B.x + B.face * 230, fr[0], fr[1]);
        while (Math.abs(tx - B.x) > 90 && !zoneFree(Math.min(B.x, tx) - 10, FLOOR - 56, Math.max(B.x, tx) + 10, FLOOR)) tx -= B.face * 10;
        if (Math.abs(tx - B.x) <= 90) return null;
        const f = Math.sign(tx - B.x), x0 = B.x;
        const CAST = pose({ sf: [70, 60], sa: [10, 10], ef: [10, 10], tl: 14, hf: [26, -8], kf: [34, 10], hp: 6, brow: -.6 });
        const SURF = pose({ hf: [30, -14], ha: [10, 10], kf: [44, 22], tl: 8, sf: [30, -40], sa: [70, 60], ef: [10, 10], hy: 25, hp: -4, smile: 1 });
        let strip = null;
        return gest('ice', 3.6, (t) => t < .7 ? .1 : .45, (t, a) => {
          B.face = f;
          if (!strip) {
            strip = mk('g', {}, fxBack);
            mk('rect', { y: FLOOR - 3.2, height: 3.6, rx: 1.8, fill: '#BFE6F7', opacity: .9 }, strip); mk('rect', { y: FLOOR - 2.8, height: .8, rx: .4, fill: '#FFFFFF' }, strip);
            const sx = strip; custom(6, () => sx, (o) => {
              const g = clamp((o.age - .15) / .55, 0, 1), xa = f > 0 ? x0 - 6 : lerp(x0, tx, g) - 6, w = Math.abs(tx - x0) * g + 12;
              for (const r of sx.children) { r.setAttribute('x', f2(f > 0 ? x0 - 6 : xa)); r.setAttribute('width', f2(w)); }
              sx.setAttribute('opacity', (1 - smooth((o.age - 3.6) / 2)).toFixed(2));
              if (g > 0 && g < 1 && chance(.6)) particle({ x: lerp(x0, tx, g), y: FLOOR - 3, vx: rr(-20, 20), vy: rr(-40, -15), r: rr(.7, 1.2), life: rr(.3, .6), fill: chance(.5) ? '#FFFFFF' : '#9ED8F2', grow: -1, g: 80 });
            });
          }
          if (t < .7) return mix(STAND, CAST, smooth(t / .3));
          if (t < 2.5) {   // разгон и скольжение по льду
            const u = smooth((t - .7) / 1.8); B.free = true; B.vx = 0; B.x = lerp(x0, tx, u);
            if (chance(.4)) particle({ x: B.x - f * 4, y: FLOOR - 2, vx: -f * rr(10, 30), vy: rr(-14, -4), r: rr(.6, 1.1), life: .4, fill: '#FFFFFF', grow: -1 });
            const p = mix(CAST, SURF, smooth((t - .7) / .3)); p.ts = 6 * Math.sin(t * 5); p.still = 1; return p;
          }
          B.free = false;
          return mix(SURF, pose({ hy: 30, smile: 1, sa: [30, 7], ef: [70, 9] }), smooth((t - 2.5) / .6));
        });
      }
      case 'web': {   // как Человек-паук: нить в кромку карточки и подтяг прямо наверх
        if (B.surf.kind !== 'floor') return null;
        if (W.time - (B.downAt ?? -99) < 15) return null;   // только что слез — нитью обратно не лезет
        const ws = webWalls();
        if (!ws.length) return null;
        const w = ws.sort((a, b) => Math.abs(a.footX - B.x) - Math.abs(b.footX - B.x))[0];
        plan([() => climb(w, false, { web: {} })]);
        return walkTo(w.footX, 'jog');
      }
      case 'fly': {   // полёт над полосой у логотипа; со знаком Телемоста — стоя на нём, как на доске
        const tx = farX();
        const alt = zoneFree(Math.min(B.x, tx) - 20, FLOOR - 78, Math.max(B.x, tx) + 20, FLOOR - 40) ? 56 : 30;
        const TM = brand.roles.board;
        const FLY = TM ? pose({ hf: [24, -10], ha: [8, 8], kf: [36, 18], tl: 6, sf: [26, -34], sa: [62, 56], ef: [14, 14], hy: 25, hp: -4, smile: 1 })
          : pose({ rot: 82, sf: [176, 150], sa: [8, 8], ef: [0, 40], hf: [0, -10], kf: [0, 24], af: [-40, -40], hp: -60, tl: 0, smile: 1 });
        let x0, y0, d, T, board = null, preparationPose = null;
        if (TM) { const R = 11; board = { on: 0, x: B.x, y: FLOOR };
          custom(30, () => { const g = mk('g', { opacity: 0 }, fxFront); mk('ellipse', { fill: '#000', opacity: .1 }, g); mk('image', { href: TM, width: 2 * R, height: 2 * R, preserveAspectRatio: 'xMidYMid meet' }, g); return g; }, (o, dt) => {
            board.miss = board.ping ? 0 : (board.miss || 0) + dt; board.ping = false;   // действие прервали — знак убираем
            if (board.gone || board.miss > .2) { o.age = o.life; o.el.remove(); return; }
            const c = o.el.children; o.el.setAttribute('opacity', board.on.toFixed(2));
            c[0].setAttribute('cx', f2(board.x)); c[0].setAttribute('cy', f2(FLOOR)); c[0].setAttribute('rx', f2(R * (1 - .5 * clamp((FLOOR - board.y) / 60, 0, 1)))); c[0].setAttribute('ry', 1.6);
            c[1].setAttribute('x', f2(board.x - R)); c[1].setAttribute('y', f2(board.y - 2));
          }); }
        return A('fly', 'ground', (a) => {
          if (board) board.ping = true;
          B.cam = 0; B.face = Math.sign(tx - B.x) || B.face;
          if (a.t < .26) {
            const p = mix(STAND, CROUCH, smooth(a.t / .26));
            if (!TM) {
              const arms = mix(STAND, PUSH, smooth(a.t / .26));
              for (const key of ['sf', 'sa', 'ef', 'ea']) p[key] = arms[key];
              preparationPose = copy(p);
            }
            return p;
          }
          if (!x0) { x0 = B.x; y0 = B.y; d = tx - x0; T = Math.abs(d) / 150 + 1.6; a.t0 = a.t; B.mode = 'free'; puff(x0, FLOOR, 6); }
          const t = a.t - a.t0, u = clamp(t / T, 0, 1);
          const yl = FLOOR - lowY(STAND) * S;
          B.x = x0 + d * smooth(u); B.y = lerp(y0, yl, smooth((u - .8) / .2)) - alt * bump(u, 0, 1) ** .6 + 2 * Math.sin(t * 5) * bump(u, .1, .9);
          // Таз летит по прежней траектории от crouch-y0; ноги раскрываются
          // из последней подготовительной позы, без CROUCH→PUSH одним кадром.
          let p = u < .15 ? mix(TM ? CROUCH : preparationPose || PUSH, FLY, smooth(u / .15)) : u > .82 ? mix(FLY, TM ? STAND : REACH, smooth((u - .82) / .18)) : copy(FLY);
          if (TM) { p.ts = 5 * Math.sin(t * 4); board.x = B.x; board.y = B.y + lowY(p) * S * B.scale; board.on = smooth(u / .08) * (1 - smooth((u - .9) / .1)); }
          else p.kf[1] += 10 * Math.sin(t * 6);
          p.still = 1;
          if (u >= 1) { B.mode = 'ground'; B.anchor = null; B.surf = W.floor; if (board) board.gone = true; return null; }
          return p;
        }, { frameBounds: [Math.max(0, Math.min(B.x, tx) - 45), FLOOR - alt - 75,
          Math.min(1280, Math.max(B.x, tx) + 45), FLOOR + 12] });
      }
    }
    return null;
  }
  function pickPower(any) {   // any — по клавише: любая способность, без оглядки на уровень
    const avail = Object.keys(POWERS).filter(k => powerEnabled(k) && (any || POWERS[k] <= W.li && (!behavior || behavior.allows(k))));
    B.bag = B.bag.filter(k => avail.includes(k));
    if (!B.bag.length) { B.bag = avail.slice(); for (let i = B.bag.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [B.bag[i], B.bag[j]] = [B.bag[j], B.bag[i]]; } }
    for (let i = 0; i < B.bag.length; i++) { const name = B.bag[i], a = MAKE[name] ? MAKE[name]() : powerMake(name); if (a) { B.bag.splice(i, 1); if (a.name !== 'walk' && a.power === undefined) a.power = true; return a; } }
    return null;
  }

  // ===================== решения =====================
  function weighted(tbl) {
    let sum = 0; const list = [];
    for (const k in tbl) { let w = tbl[k] * MIND.gate(k) * (behavior ? behavior.weight(k) : 1); if (w <= 0) continue; const gap = REPEAT_GAP_OF[k] ?? REPEAT_GAP; if (B.lastAt[k] != null && W.time - B.lastAt[k] < gap) continue; const last = B.hist.lastIndexOf(k); if (last >= 0) { const ago = B.hist.length - last; w *= ago <= 2 ? .1 : ago <= 5 ? .45 : 1; } list.push([k, w]); sum += w; }
    let r = rnd() * sum; for (const [k, w] of list) if ((r -= w) <= 0) return k;
    return list.length ? list[0][0] : 'idle';
  }
  function remember(name) { B.lastAt[name] = W.time; B.hist.push(name); if (B.hist.length > 12) B.hist.shift(); }
  function plan(list) { B.queue = list.concat(B.queue); }
  function stairsRun(n) {
    const st = slides[W.idx] && slides[W.idx].querySelector('[data-buddy-stairs]');
    if (!st || B.surf.kind !== 'floor' || B.mode !== 'ground') return null;
    const b = boxD(), ps = [];
    for (const e of st.children) {
      const d = toD(e.getBoundingClientRect(), b), cx = (d.x1 + d.x2) / 2;
      const q = W.plats.find(q => Math.abs(q.y - d.y1) < 6 && q.x1 < cx && q.x2 > cx); if (q) ps.push(q);
    }
    if (ps.length < 2) { if ((n || 0) < 12) { plan([() => stairsRun((n || 0) + 1)]); return idle(.3); } return null; }
    const p0 = ps[0], gx = p0.spans[0][0] + 8, seq = [];   // канат — на самое начало первого блока
    for (let i = 1; i < ps.length; i++) {
      const a = ps[i - 1], q = ps[i];
      seq.push(() => { B.face = 1; return idle(i === 1 ? .9 : .6); });   // пауза на каждой ступени: зритель успевает прочитать пункт
      seq.push(() => walkTo(a.spans[a.spans.length - 1][1] - 2, 'jog'));
      seq.push(() => jumpTo(q.spans[0][0] + 12, q, { apex: 14 }));
    }
    const L = ps[ps.length - 1];
    seq.push(() => { B.face = 1; return idle(1.2); });
    seq.push(() => { B.face = -1; return idle(.5); });   // разворачивается и спокойно уходит влево на парашюте, мимо блоков
    seq.push(() => { B.forceChute = true; B.passPlats = true; B.chuteDrift = -38; return leapOff(L.x1 - 14, .55); });
    plan(seq);
    B.grapT = { q: p0, x: gx };
    const a = powerMake('grapple'); if (a) a.power = true; return a;
  }
  function randomFloorX(minD, maxD) {
    const xs = []; for (const [a, b] of W.floor.spans) for (let x = a; x <= b; x += 6) { const d = Math.abs(x - B.x); if (d >= minD && d <= maxD) xs.push(x); }
    return xs.length ? xs[Math.floor(rnd() * xs.length)] : null;
  }
  const MAKE = {
    stroll: () => { const x = randomFloorX(40, 300); if (x == null) return null; return walkTo(x, 'walk', { stumbleAt: chance(.05) ? rr(1, 3) : 0 }); },
    jog: () => { const x = randomFloorX(160, 600); return x == null ? null : walkTo(x, 'jog'); },
    // просто постоять — дольше: зал смотрит на слайд, а не на зарядку
    idle: () => idle(rr(3.5, 7.5)), lookSlide, lookHall, wave, yawn, stretch, clap, point,
    popcorn: d => popcorn(d), read: d => readBook(d), note: noteIdea,
    squats: () => squats(Math.round(rr(3, 5))), jacks: () => jacks(Math.round(rr(5, 9))), toeTouch: () => toeTouch(Math.round(rr(2, 3))),
    sideBend: () => sideBend(Math.round(rr(2, 4))), sitRest: d => sitRest(d), edgeSit: d => edgeSit(d), sitLean: () => sitRest(rr(4, 7), true),
    hop: () => jumpTo(B.x + B.face * rr(0, 12), B.surf, { apex: rr(6, 12) }),
    cheer: () => jumpTo(B.x, B.surf, { apex: 14, arms: 'V', cam: .9 }),
    stumble: () => { const x = randomFloorX(90, 300); return x == null ? null : walkTo(x, 'walk', { stumbleAt: rr(.8, 1.6) }); },
    dance: () => dance(),
    descend: () => B.surf.kind !== 'floor' ? descend(LV()) : null,   // для раскадровок: слезть сейчас
    handstand: () => LV().tricks >= 1 ? handstand() : null,
    backflip: () => LV().tricks >= 2 ? jumpTo(B.x - B.face * 6, B.surf, { apex: 20, flip: -360 }) : null,
    logo: () => {
      if (!W.logo || !W.logo.spans.length) return null;
      const lx = nearestIn(W.logo.spans, rr(W.logo.x1 + 8, W.logo.x2 - 6)), fx = nearestIn(W.floor.spans, 184);
      if (lx == null || fx == null) return null;
      plan([() => jumpTo(lx, W.logo, { apex: 8 })]);
      B.upCount = 0; B.upLimit = Math.round(rr(2, 4));
      return walkTo(fx, Math.abs(fx - B.x) > 120 ? 'jog' : 'walk');   // издалека шагом идёт 7–8 с — смена слайда сбрасывала прыжок
    },
    pullups: () => {   // повиснуть на кромке ближней карточки и подтянуться пару раз
      if (W.time - (B.downAt ?? -99) < 15) return null;   // только что слез — сразу на кромку не виснет
      const lv = LV(), fr = floorRange();
      const ws = pullupCandidates(W, B, lv, fr);
      if (!ws.length) return null;
      const w = ws.sort((a, b) => Math.abs(a.footX - B.x) - Math.abs(b.footX - B.x))[0];
      plan([() => climb(w, false, { pull: Math.round(rr(2, 4)) })]);
      return walkTo(w.footX, Math.abs(w.footX - B.x) > 160 ? 'jog' : 'walk');
    },
    finale: () => finaleFly(), nap: duration => nap(duration),
    shadowbox: () => {   // бой с тенью: стойка, джебы с подскоком
      const G = pose({ sf: [40, 50], sa: [14, 14], ef: [125, 120], hf: [16, -6], kf: [22, 10], tl: 8, hp: 4, brow: -.5 });
      return gest('shadowbox', 3.2, .15, (t) => {
        const p = copy(G), j = Math.floor(t / .4), u = (t % .4) / .4, hit = bump(u, 0, .7), i = j % 2;
        if (t > .3 && t < 2.7) { p.sf[i] = 40 + 52 * hit; p.ef[i] = 125 - 118 * hit; p.ts = (i ? -6 : 6) * hit; }
        p.kf[0] += 6 * Math.abs(Math.sin(t * 8)); p.kf[1] += 6 * Math.abs(Math.sin(t * 8));
        const out = t < .3 ? mix(STAND, p, smooth(t / .3)) : t > 2.8 ? mix(p, pose({ hy: 20, smile: 1 }), smooth((t - 2.8) / .4)) : p;
        const fist = smooth(t / .3) * (1 - smooth((t - 2.8) / .4));
        out.handFist = [fist, fist];
        return out;
      });
    },
    kick: () => {   // высокий удар ногой: замах коленом, выпрямление, возврат
      const G = pose({ sf: [40, 50], sa: [20, 20], ef: [110, 110], tl: -6, brow: -.6 });
      return gest('kick', 1.9, .1, (t) => {
        const p = copy(G);
        if (t < .35) { const u = smooth(t / .35); p.hf[0] = 95 * u; p.kf[0] = 110 * u; p.tl = -6 - 8 * u; }
        else if (t < .75) { const u = smooth((t - .35) / .15); p.hf[0] = 95 + 10 * u; p.kf[0] = 110 - 100 * u; p.af[0] = -30 * u; p.tl = lerp(-14, -18, u); }
        else if (t < 1.2) { const u = smooth((t - .75) / .45); p.hf[0] = lerp(105, 0, u); p.kf[0] = lerp(10, G.kf[0], u) + 60 * bump(u, 0, 1); p.af[0] = -30 * (1 - u); p.tl = lerp(-18, G.tl, u); }
        return t < .15 ? mix(STAND, p, smooth(t / .15)) : t > 1.4 ? mix(p, pose({ smile: 1, hy: 25 }), smooth((t - 1.4) / .4)) : p;
      });
    },
    climb: () => {
      if (W.time - (B.downAt ?? -99) < 15) return null;   // только что слез — не лезет обратно
      const lv = LV(), fr = floorRange();
      const ws = W.walls.filter(w => w.h <= lv.climb && w.gap <= lv.reach && w.footX >= fr[0] && w.footX <= fr[1]
        && !W.plats.some(P => P !== w.plat && P.box && P.x1 < w.topX + 10 && P.x2 > w.topX - 10 && P.box.y2 > w.top - 46 && P.y < w.top - 2));
      if (!ws.length) return null;
      let sum = 0; const wl = ws.map(w => { const v = 1 / (1 + Math.abs(w.footX - B.x) / 300) / (1 + w.h / 160); sum += v; return v; });
      let r = rnd() * sum, w = ws[0]; for (let i = 0; i < ws.length; i++) if ((r -= wl[i]) <= 0) { w = ws[i]; break; }
      plan([() => climb(w)]);
      return walkTo(w.footX, w.gap > 90 || (w.h > 140 && lv.tricks) ? 'jog' : 'walk');
    },
  };
  function decide() {
    if (!W.ready) return idle(rr(.5, 1));
    const lv = LV(), s = B.surf;
    if (s.kind === 'plat' || s.kind === 'logo') return decideTop(lv);
    const fr = floorRange();
    if (B.x < fr[0] - 4 || B.x > fr[1] + 4) return walkTo(nearestIn(W.floor.spans, B.x) || clamp(B.x, fr[0] + 8, fr[1] - 8));
    if (powersReady()) {
      if (!MIND.calm()) { const m = mustDo(); if (m) return m; }
      if (B.powerSlide !== W.idx) { B.powerSlide = W.idx; if (W.time - B.lastPower >= .6 * powerGap()) B.nextPower = Math.min(B.nextPower, W.time + rr(.5, 3)); }
      if (W.time > B.nextPower && MIND.calm()) B.nextPower = MIND.slideAt + (behavior?.quietSeconds ?? CALM) + rr(1, 4);   // зал читает слайд
      if (W.time > B.nextPower && B.scale === 1) {
        const a = pickPower(); B.nextPower = W.time + powerGap();
        if (a) { B.lastPower = W.time; remember('power'); return a; }
      }
    }
    const tbl = {};
    for (const k in MOVES) tbl[k] = MOVES[k][W.li];
    if (W.final) for (const k in FINAL_BONUS) tbl[k] = (tbl[k] || 0) + FINAL_BONUS[k];
    for (let i = 0; i < 6; i++) {
      const k = weighted(tbl), a = MAKE[k] && MAKE[k]();
      if (a) { remember(k); return a; }
      tbl[k] = 0;
    }
    return idle(rr(1, 2));
  }
  // Публичная политика ускоряется по progress; прежнее ядро сохраняет интервалы POWER_GAP.
  function powersReady() { return behavior ? W.progress >= .15 : W.idx >= POWER_FROM; }
  function powerGap() {
    // Короткие деки и progress() имеют ту же драматургию, что длинная презентация.
    if (behavior) return behavior.powerSeconds * lerp(1.8, .7, clamp((W.progress - .15) / .85, 0, 1)) * rr(1, 1.35);
    const u = clamp((W.idx - POWER_FROM) / Math.max(1, slides.length - 1 - POWER_FROM), 0, 1);
    return rr(lerp(POWER_GAP[0][0], POWER_GAP[1][0], u), lerp(POWER_GAP[0][1], POWER_GAP[1][1], u));
  }
  // обязательные номера: лазанье и магнит хотя бы раз за деку
  function mustDo() {
    if ((!behavior || behavior.allows('climb')) && !B.did.climb && (behavior ? W.progress >= .25 : W.idx >= MUST_CLIMB_FROM) && W.walls.length) { const a = MAKE.climb(); if (a) { remember('climb'); return a; } }
    if ((!behavior || behavior.allows('magnet')) && powerEnabled('magnet') && !B.did.magnet && (behavior ? W.progress >= .45 : W.idx >= MUST_MAGNET_FROM) && B.scale === 1) {
      B.keyMagnet = true; const a = powerMake('magnet'); B.keyMagnet = false;   // любая иконка на слайде, не только ближние
      if (a) { if (a.name !== 'walk') a.power = true; B.lastPower = W.time; B.nextPower = W.time + powerGap(); remember('power'); return a; }
    }
    return null;
  }
  function decideTop(lv) {
    const s = B.surf;
    // наверху способности не выбираются: пора — спускается
    if (B.topSurf !== s) { B.topSurf = s; B.topSince = W.time; }
    const fresh = W.time - B.topSince < 6;   // только что залез: сначала освоится на новой площадке
    if (!fresh && powersReady() && !MIND.calm() && (W.time > B.nextPower || (!B.did.magnet && (behavior ? W.progress >= .45 : W.idx >= MUST_MAGNET_FROM)))) return descend(lv);
    B.upCount++;
    if (B.upCount > B.upLimit && !fresh) return descend(lv);
    const tbl = { strollTop: 2.5, idle: 3, lookHall: 1.5, wave: 1, lookDown: 1, edgeSit: s.kind === 'plat' ? 3 : 0,
      sitRest: s.kind === 'logo' ? 0 : 1.2,   // на надписи не садится: сидящий закрывает «360»
      cheer: lv.tricks ? .8 : 0, backflip: lv.tricks >= 2 ? .8 : 0, gap: lv.tricks >= 2 && !fresh ? 1.2 : 0,
      dance: W.final ? 2 : 0 };
    for (let i = 0; i < 6; i++) {
      const k = weighted(tbl); let a = null;
      if (k === 'strollTop') { const xs = []; for (const [p, q] of s.spans) for (let x = p; x <= q; x += 4) if (Math.abs(x - B.x) > 14) xs.push(x); if (xs.length) a = walkTo(xs[Math.floor(rnd() * xs.length)], lv.tricks >= 2 && chance(.4) ? 'jog' : 'walk'); }
      else if (k === 'idle') a = idle(rr(3.5, 7.5));
      else if (k === 'lookHall') a = lookHall();
      else if (k === 'wave') a = wave();
      else if (k === 'lookDown') a = gest('lookDown', 2.4, .3, t => mix(STAND, pose({ hp: 34, tl: 10, hy: 8 }), bump(t, 0, 2.4) * 1.3 > 1 ? 1 : bump(t, 0, 2.4) * 1.3));
      else if (k === 'edgeSit') { if (zoneFree(B.x - 8, s.y + 1, B.x + 8, s.y + 24)) a = edgeSit(); }
      else if (k === 'sitRest') a = sitRest(rr(5, 9));
      else if (k === 'cheer') a = MAKE.cheer();
      else if (k === 'backflip') a = MAKE.backflip();
      else if (k === 'dance') a = dance(3);
      else if (k === 'gap') a = gapJump(s);
      if (a) { remember(k); return a; }
      tbl[k] = 0;
    }
    return idle(1);
  }
  function gapJump(s) {
    for (const P of W.plats) {
      if (P === s || P.y < s.y - 24 || P.y > s.y + 70) continue;
      for (const side of [-1, 1]) {
        const edge = side < 0 ? s.x1 : s.x2, gap = side < 0 ? edge - P.x2 : P.x1 - edge;
        if (gap < 8 || gap > 80) continue;
        const from = nearestIn(s.spans, edge - side * 6), to = nearestIn(P.spans, (side < 0 ? P.x2 : P.x1) + side * 14);
        if (from == null || to == null || Math.abs(from - edge) > 14 || (to - from) * side < 10) continue;
        plan([() => jumpTo(to, P, { apex: 12 })]);
        return walkTo(from, 'walk');
      }
    }
    return null;
  }
  function descend(lv) {
    const s = B.surf;
    if (s.kind === 'logo') { const fx = nearestIn(W.floor.spans, rr(186, 230)); if (fx != null) return jumpTo(fx, W.floor, { apex: 6 }); }
    const ways = [];
    for (const w of W.walls) if (w.plat === s) ways.push({ kind: 'wall', w, x: w.topX, side: w.side });
    for (const side of [-1, 1]) {
      const edge = side < 0 ? s.x1 : s.x2, sx = nearestIn(s.spans, edge - side * (Math.max(s.rad || 0, 3) + 8));
      if (sx == null || Math.abs(sx - edge) > 30) continue;
      const lx = edge + side * 16, t = surfaceBelow(lx, s.y + 2);
      if (!inSpans(t.spans, lx)) continue;
      ways.push({ kind: 'jump', side, x: sx, lx, t, h: t.y - s.y, edge });
    }
    if (!ways.length) {   // чистой кромки нет: к ближнему краю свободного места и прыжок на пол туда, где нет текста
      const side = B.x - s.x1 < s.x2 - B.x ? -1 : 1, edge = side < 0 ? s.x1 : s.x2;
      const sx = nearestIn(s.spans, edge), lx = nearestIn(W.floor.spans, edge + side * 30);
      if (sx == null || lx == null) { B.surf = W.floor; return fall(0); }
      plan([() => jumpTo(lx, W.floor, { apex: 8, roll: lv.tricks >= 2 })]);
      return Math.abs(sx - B.x) > 3 ? walkTo(sx, 'walk') : idle(.3);
    }
    const wall = ways.find(q => q.kind === 'wall'), jump = ways.filter(q => q.kind === 'jump').sort((a, b) => a.h - b.h)[0];
    let way;
    if (lv.down === 'climb') way = wall || jump;
    else if (lv.down === 'hang') way = (wall && (!jump || jump.h > 100 || chance(.5))) ? Object.assign({}, wall, { hang: true }) : jump || wall;
    else way = jump || wall;
    if (way.kind === 'wall') {
      plan([() => climb(way.w, way.hang ? 'hang' : 'climb')]);
      return walkTo(way.x, 'walk');
    }
    if (way.h > CHUTE_H + 20 && chance(.35)) { plan([() => leapOff(way.lx)]); return walkTo(way.x, 'walk'); }   // высоко — шагнуть и раскрыть парашют
    const flip = lv.tricks >= 2 && way.h < 170 && chance(.3);
    plan([() => jumpTo(way.lx, way.t, { apex: flip ? 16 : 6, flip: flip ? -360 * way.side * B.face * -1 * (way.side === B.face ? -1 : 1) : 0, roll: lv.tricks >= 2 })]);
    return walkTo(way.x, 'walk');
  }

  // ===================== по клавише =====================
  // B — трюк сразу: карточка в пределах 260 px (лезет или подтягивается), иначе логотип рядом, иначе сальто на месте.
  // До смены слайда он остаётся на самом смелом уровне.
  function forceTrick() {
    W.boost = true; rescan();
    if (W.final) return finaleFly();
    const fr = floorRange(), ws = W.walls.filter(w => w.footX >= fr[0] && w.footX <= fr[1] && w.gap <= LV().reach && Math.abs(w.footX - B.x) < 260)
      .sort((a, b) => Math.abs(a.footX - B.x) - Math.abs(b.footX - B.x));
    if (ws.length) {
      const w = ws[0], pull = w.gap >= 45 && chance(.35);
      plan([() => climb(w, false, pull ? { pull: Math.round(rr(2, 3)) } : null)]);
      return walkTo(w.footX, Math.abs(w.footX - B.x) > 120 ? 'jog' : 'walk');
    }
    if (W.logo && W.logo.spans.length) {
      const lx = nearestIn(W.logo.spans, rr(W.logo.x1 + 8, W.logo.x2 - 6)), fx = nearestIn(W.floor.spans, 184);
      if (lx != null && fx != null && Math.abs(fx - B.x) < 260) { plan([() => jumpTo(lx, W.logo, { apex: 10 })]); B.upCount = 0; B.upLimit = 2; return walkTo(fx, 'jog'); }
    }
    return jumpTo(B.x - B.face * 6, B.surf, { apex: 20, flip: -360 });
  }
  // C — залезть на ближайший блок, до которого достаёт (на любом слайде); блоков нет — обычный трюк
  function forceClimb() {
    W.boost = true; rescan();
    const fr = floorRange(), reach = LEVELS[LEVELS.length - 1].reach;
    const ws = W.walls.filter(w => w.footX >= fr[0] && w.footX <= fr[1] && w.gap <= reach).sort((a, b) => Math.abs(a.footX - B.x) - Math.abs(b.footX - B.x));
    if (!ws.length) return forceTrick();
    const w = ws[0];
    plan([() => climb(w, false, null)]);
    return walkTo(w.footX, Math.abs(w.footX - B.x) > 120 ? 'jog' : 'walk');
  }
  // M — магнит: притянуть иконку со слайда; иконок нет — следующая способность
  function forceMagnet() {
    B.keyMagnet = true; const a = powerMake('magnet'); B.keyMagnet = false;   // по клавише — любая иконка на слайде
    if (!a) return forcePower();
    if (a.name !== 'walk') a.power = true;
    remember('power'); return a;
  }
  function forcePower() {
    B.nextPower = W.time + powerGap(); B.lastPower = W.time;
    remember('power'); return pickPower(true);
  }
  // в воздухе или посреди способности — сразу после; наверху — сначала спускается; иначе — прямо сейчас
  function force(fn) {
    if (!W.ready || !B.act) return;
    interrupt('replaced');
    B.queue = [() => fn()];
    if (B.mode === 'free' || B.act.power) return;
    if (B.surf.kind !== 'floor') { const d = descend(LV()); if (d) begin(d); return; }
    startNext();
  }

  // итоговый слайд: взлетает к главной плитке, зависает у текста и показывает на него, возвращается на пол
  // облёт: эллипс почти во весь слайд, с волной по радиусу, случайным центром и направлением — каждый раз чуть другой
  function lapPath(x, y) {
    const cx = 640 + rr(-24, 24), cy = 370 + rr(-14, 14), RX = rr(548, 586), RY = rr(292, 318), dir = chance(.5) ? 1 : -1;
    const p1 = rr(0, 2 * PI), p2 = rr(0, 2 * PI), a1 = rr(.04, .07), a2 = rr(.02, .04), turn = rr(1.0, 1.12);
    const th0 = Math.atan2((y - cy) / RY, (x - cx) / RX), r0 = Math.hypot((x - cx) / RX, (y - cy) / RY), N = 200, pts = [[x, y]], cum = [0];
    for (let i = 1; i <= N; i++) {
      const u = i / N, th = th0 + dir * 2 * PI * turn * u, w = 1 + a1 * Math.sin(3 * th + p1) + a2 * Math.sin(5 * th + p2), r = lerp(r0, w, smooth(Math.min(1, u / .14)));
      pts.push([clamp(cx + RX * r * Math.cos(th), 28, 1252), clamp(cy + RY * r * Math.sin(th), 34, FLOOR - 26)]);
    }
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const len = cum[cum.length - 1]; return { pts, cum, len, dur: len / rr(380, 450) + .6 };
  }
  function finaleFly() {
    if (B.surf.kind !== 'floor' || B.scale !== 1) return null;
    const tile = slides[W.idx] && (slides[W.idx].querySelector('[data-buddy-fly]') || slides[W.idx].querySelector('.tile.main'));
    if (!tile || !shown(tile)) return null;
    const b = boxD(), T = toD(tile.getBoundingClientRect(), b), txt = tile.querySelector('.bmain,[data-buddy-text]') || tile, X = toD(txt.getBoundingClientRect(), b);
    let best = null, bs = 1e9;
    for (let x = T.x1 - 40; x <= T.x2 + 40; x += 6) for (let y = T.y1 - 30; y <= T.y2 + 10; y += 6) {
      if (y > FLOOR - 70 || x < 20 || x > 1240 || !zoneFree(x - 14, y - 30, x + 14, y + 24)) continue;
      const dx = Math.max(X.x1 - x, 0, x - X.x2), dy = Math.max(X.y1 - y, 0, y - X.y2), d = Math.hypot(dx, dy);
      if (d < 16) continue;
      const sc = d + Math.abs(y - (X.y1 + X.y2) / 2) * .4 + Math.abs(x - B.x) * .02;
      if (sc < bs) { bs = sc; best = [x, y]; }
    }
    if (!best) return null;
    const [hx, hy] = best, fx = nearestIn(W.floor.spans, B.x);
    const yl = FLOOR - lowY(STAND) * S, cxp = [(X.x1 + X.x2) / 2, (X.y1 + X.y2) / 2];
    const HOVER = pose({ tl: -4, hp: -8, hf: [16, 6], kf: [34, 22], af: [-40, -40], sa: [10, 18], sf: [100, 20], ef: [4, 40], smile: 1, brow: .4 });
    const LAND = pose({ tl: 6, hf: [20, 14], kf: [30, 22], sf: [150, 140], sa: [30, 30], ef: [10, 10], smile: 1 });
    let flightPitch = null;
    const flyPose = (dx, dy, dt) => { const target = clamp(deg(Math.atan2(Math.abs(dx), -dy)), 15, 82),
      r = flightPitch = flightPitch == null ? target : lerp(flightPitch, target, 1 - Math.exp(-dt / .1));
      return pose({ rot: r, sf: [176, 150], sa: [8, 8], ef: [0, 40], hf: [0, -10], kf: [0, 24], af: [-40, -40], hp: -40 * r / 82 - 10, tl: 0, smile: 1 }); };
    const bez = (p0, c, p1, u) => [(1 - u) * (1 - u) * p0[0] + 2 * u * (1 - u) * c[0] + u * u * p1[0], (1 - u) * (1 - u) * p0[1] + 2 * u * (1 - u) * c[1] + u * u * p1[1]];
    let ph = 0, t0 = 0, p0, c0, d0, d1, c1, ring = null, lap = null, lapDone = false, lapEntryPose = null, returnEntryPose = null;
    return A('finale', 'ground', (a, dt) => {
      B.cam = 0;
      if (ph === 0) {   // присед и толчок
        if (a.t < .3) {
          // Ноги приседают и разгибаются до старта траектории; руки готовят взлёт
          // всё окно .3 s, без обратного взмаха CROUCH→PUSH в одном кадре.
          const p = a.t < .15 ? mix(STAND, CROUCH, smooth(a.t / .15)) : mix(CROUCH, PUSH, smooth((a.t - .15) / .15)),
            arms = mix(STAND, PUSH, smooth(a.t / .3));
          for (const key of ['sf', 'sa', 'ef', 'ea']) p[key] = arms[key];
          return p;
        }
        ph = 1; t0 = a.t; B.mode = 'free'; p0 = [B.x, B.y]; c0 = [lerp(B.x, hx, .2), Math.min(B.y, hy) - 60]; d0 = Math.hypot(hx - B.x, hy - B.y) / 230 + .7;
        B.sqV += 4; dust(B.x, FLOOR, .8);
      }
      const t = a.t - t0;
      if (ph === 1) {   // полёт к плитке
        const u = smooth(clamp(t / d0, 0, 1)), q = bez(p0, c0, [hx, hy], u), q2 = bez(p0, c0, [hx, hy], Math.min(1, u + .05));
        B.x = q[0]; B.y = q[1]; B.face = Math.sign(hx - p0[0]) || B.face;
        if (chance(.4)) particle({ x: B.x, y: B.y + 10, vx: rr(-6, 6), vy: rr(6, 16), r: rr(.8, 1.4), life: .4, fill: '#FFC400', grow: -1 });
        const flight = flyPose(q2[0] - q[0], q2[1] - q[1], dt),
          p = t < .2 ? mix(PUSH, flight, smooth(t / .2)) : u > .85 ? mix(flight, HOVER, smooth((u - .85) / .15)) : flight;
        p.kf[1] += 8 * Math.sin(t * 7); p.still = 1;
        if (t >= d0) { ph = 2; t0 = a.t; B.face = Math.sign(cxp[0] - hx) || B.face; sparks(hx, hy, 8, '#1340E0'); }
        return p;
      }
      if (ph === 2) {   // зависает у текста: показывает на него, плитку обводит пульсирующий контур
        if (!ring) {
          const rr0 = parseFloat(getComputedStyle(tile).borderTopLeftRadius) || 16;
          ring = mk('rect', { x: f2(T.x1 - 4), y: f2(T.y1 - 4), width: f2(T.x2 - T.x1 + 8), height: f2(T.y2 - T.y1 + 8), rx: rr0 + 4, fill: 'none', stroke: '#1340E0', 'stroke-width': 3, opacity: 0 }, fxBack);
          if (tile.hasAttribute('data-buddy-like')) {   // лайк: большое сердце у человечка и сердечки, всплывающие из карточки
            const HP = 'M0 7C-2.2 5-11 -.6-11-6.2-11-10.2-8-12.6-5-12.6-2.8-12.6-1-11.3 0-9.6 1-11.3 2.8-12.6 5-12.6 8-12.6 11-10.2 11-6.2 11-.6 2.2 5 0 7Z';
            const lx = clamp(hx + B.face * 34, 30, 1250), ly = Math.max(30, hy - 46);
            custom(5.2, () => { const g = mk('g', { opacity: 0 }, fxFront); mk('path', { d: HP, fill: '#FF3B5C', stroke: '#0B0B0F', 'stroke-width': 1.1 }, g); return g; }, (o) => {
              const u = o.age, pop = u < .45 ? 1.4 * Math.sin(PI / 2 * u / .45) : 1 + .1 * Math.abs(Math.sin(u * 5));
              o.el.setAttribute('transform', 'translate(' + f2(lx) + ' ' + f2(ly - 4 * Math.sin(u * 2)) + ') scale(' + f2(1.7 * pop) + ')');
              o.el.setAttribute('opacity', (smooth(u / .15) * smooth((5.2 - u) / .5)).toFixed(2));
            });
            for (let i = 0; i < 12; i++) {
              const dl = .3 + i * .36, sx = rr(T.x1 + 24, T.x2 - 24), sy = T.y1 + rr(4, 20), dr = rr(-14, 14), sc = rr(.55, .95);
              custom(dl + 1.8, () => mk('path', { d: HP, fill: i % 3 ? '#FF3B5C' : '#C6F432', stroke: '#0B0B0F', 'stroke-width': 1, opacity: 0 }, fxFront), (o) => {
                const u = (o.age - dl) / 1.8; if (u < 0) return;
                o.el.setAttribute('transform', 'translate(' + f2(sx + dr * u + 4 * Math.sin(u * 9)) + ' ' + f2(sy - 70 * u) + ') scale(' + f2(sc * (u < .15 ? u / .15 : 1)) + ')');
                o.el.setAttribute('opacity', (smooth(u / .1) * smooth((1 - u) / .35)).toFixed(2));
              });
            }
          }
          custom(5.2, () => ring, (o) => { const u = o.age; ring.setAttribute('opacity', (smooth(u / .4) * smooth((5.2 - u) / .6) * (.65 + .35 * Math.sin(u * 6))).toFixed(2)); ring.setAttribute('stroke-width', f2(3 + 1.2 * Math.sin(u * 6))); });
          // Главный знак и произвольный набор продуктов на орбите.
          const LS = brand.products;
          const cands = [[hx - B.face * 44, hy - 8], [hx, hy - 58], [hx + B.face * 40, hy - 46]];
          const cc = brand.logo && cands.find(([x, y]) => zoneFree(x - 28, y - 28, x + 28, y + 28));
          if (cc) custom(5.2, () => { const g = mk('g', { opacity: 0 }, fxFront); mk('image', { href: brand.logo, x: f2(cc[0] - 10), y: f2(cc[1] - 10), width: 20, height: 20 }, g); for (const h of LS) mk('image', { href: h, width: 9, height: 9 }, g); return g; }, (o) => {
            const u = o.age, r = 21 * smooth(u / .6), k = o.el.children;
            for (let i = 1; i < k.length; i++) { const ang = 2 * PI * (i - 1) / LS.length + u * 1.4; k[i].setAttribute('x', f2(cc[0] + r * Math.cos(ang) - 4.5)); k[i].setAttribute('y', f2(cc[1] + r * .8 * Math.sin(ang) - 4.5)); }
            o.el.setAttribute('opacity', (smooth(u / .4) * smooth((5.2 - u) / .6)).toFixed(2));
          });
        }
        B.x = hx + 1.5 * Math.sin(t * 2.2); B.y = hy + 3 * Math.sin(t * 3.1);
        if (chance(.12)) sparks(rr(X.x1, X.x2), rr(X.y1, X.y2), 1, '#1340E0');
        const like = tile.hasAttribute('data-buddy-like'), side = camSide(), amount = like ? smooth(t / .4) * (1 - smooth((t - 3.35) / .45)) : 0,
          approved = Object.assign(copy(HOVER), { sf: sd(side, 70, 20), sa: sd(side, 18, 18), ef: sd(side, 65, 40) }),
          p = like ? mix(HOVER, approved, amount) : copy(HOVER);
        if (like) { p.handShape = { kind: 'thumbsUp', side, amount }; p.handFacing = sd(side, amount * .55, 0); }
        p.kf[0] += 10 * Math.sin(t * 3); p.kf[1] += 10 * Math.sin(t * 3 + 1.4); p.sf[0] += 6 * Math.sin(t * 2); p.still = 1;
        if (t > 3.8 && tile.hasAttribute('data-buddy-like') && !lapDone) { lapDone = true; lapEntryPose = copy(p); ph = 4; t0 = a.t; lap = lapPath(B.x, B.y); return p; }
        if (t > 3.8) { returnEntryPose = copy(p); ph = 3; t0 = a.t; p0 = [B.x, B.y]; c1 = [lerp(B.x, fx, .7), Math.min(B.y, yl) - 30]; d1 = Math.hypot(fx - B.x, yl - B.y) / 260 + .6; }
        return p;
      }
      if (ph === 4) {   // круг через четыре угла слайда
        const L = lap, d = Math.min(L.len, L.len * smooth(clamp(t / L.dur, 0, 1)) ), i = Math.max(1, L.cum.findIndex(c => c >= d)), k = (d - L.cum[i - 1]) / Math.max(1e-6, L.cum[i] - L.cum[i - 1]);
        const q = [lerp(L.pts[i - 1][0], L.pts[i][0], k), lerp(L.pts[i - 1][1], L.pts[i][1], k)], dx = L.pts[i][0] - L.pts[i - 1][0], dy = L.pts[i][1] - L.pts[i - 1][1];
        B.x = q[0]; B.y = q[1]; if (Math.abs(dx) > .5) B.face = Math.sign(dx);
        if (chance(.5)) particle({ x: B.x, y: B.y + 10, vx: rr(-6, 6), vy: rr(6, 16), r: rr(.8, 1.4), life: .5, fill: chance(.5) ? '#1340E0' : '#C6F432', grow: -1 });
        const target = flyPose(dx, dy, dt); target.kf[1] += 8 * Math.sin(t * 7);
        const pp = t < .25 ? mix(lapEntryPose, target, smooth(t / .25)) : target; pp.still = 1;
        if (t >= L.dur) { returnEntryPose = copy(pp); ph = 3; t0 = a.t; p0 = [B.x, B.y]; c1 = [lerp(B.x, fx, .7), Math.min(B.y, yl) - 30]; d1 = Math.hypot(fx - B.x, yl - B.y) / 260 + .6; }
        return pp;
      }
      // обратно на пол
      const u = smooth(clamp(t / d1, 0, 1)), q = bez(p0, c1, [fx, yl], u), q2 = bez(p0, c1, [fx, yl], Math.min(1, u + .05));
      B.x = q[0]; B.y = q[1]; B.face = Math.sign(fx - p0[0]) || B.face;
      if (t >= d1) { B.mode = 'ground'; B.surf = W.floor; B.surfY = FLOOR; B.anchor = null; land(.8); B.queue.unshift(() => gest('finLand', 1.2, .6, (tt) => mix(CROUCH, pose({ hy: 30, smile: 1, sa: [30, 7], ef: [70, 9] }), smooth(tt / .8)))); return null; }
      const flight = flyPose(q2[0] - q[0], q2[1] - q[1], dt),
        target = u > .8 ? mix(flight, LAND, smooth((u - .8) / .2)) : flight,
        p = t < .25 ? mix(returnEntryPose, target, smooth(t / .25)) : target;
      p.still = 1; return p;
    }, { power: true });
  }

  // ===================== смена слайда =====================
  function react() {
    // реакция на новый слайд: чаще просто пойти дальше, чем встать и смотреть
    const tbl = { stroll: 4, jog: W.li ? .6 : .2, lookSlide: 6.5, point: 1, cheer: W.li ? 1.2 : .3, clap: .5, lookHall: .4, wave: W.idx === 0 ? 3 : .4 };
    const k = weighted(tbl); remember(k);
    return (k === 'cheer' ? MAKE.cheer() : MAKE[k]()) || MAKE.lookSlide();
  }
  function onSlide(i) {
    if (i === W.idx && W.ready) return;
    interrupt('slide-changed'); focused = false;
    W.idx = i; W.final = W.n > 1 && i === W.n - 1 || !!(slides[i] && slides[i].querySelector('.tile.main,[data-buddy-fly]'));
    MIND.onSlide(i);
    const p = W.n > 1 ? i / (W.n - 1) : SINGLE_PAGE_PROGRESS;
    W.progress = p;
    W.li = Math.max(0, LEVELS.findIndex(l => p <= l.upTo));
    W.ready = false; W.plats = []; W.walls = [];
    clearTransient(); W.boost = false;   // эффекты способностей не переезжают на новый слайд
    B.topSurf = null; B.topSince = B.downAt = -1e9;
    clearTimeout(onSlide.tm); clearTimeout(onSlide.tm2);
    onSlide.tm = setTimeout(() => { rescan(); MIND.scan(slides[W.idx]); }, 1100); onSlide.tm2 = setTimeout(rescan, 2600);   // второй раз — когда доедут плитки бенто
    B.queue = [];
    if (REDUCED) { rescan(); staticPose(); return; }
    const up = B.surf && (B.surf.kind === 'plat' || B.surf.kind === 'logo') || B.mode === 'free';
    if (!autonomous || focusRequested) { begin(up ? fall(B.mode === 'free' ? 0 : -45) : idle(focusRequested ? .4 : 3600)); return; }
    if (up) { begin(fall(B.mode === 'free' ? 0 : -45)); plan([() => react()]); }
    else if (MIND.sur > .9) { begin(jumpTo(B.x, B.surf, { apex: 9 })); plan([() => react()]); }   // разбудили сменой слайда
    else begin(react());
    // Авторская разметка — явная постановка: сохраняем её и в спокойных профилях.
    if (W.final && (!behavior || behavior.profile === 'show' || slides[i]?.querySelector('[data-buddy-fly]'))) plan([() => idle(rr(1.5, 2.5)), () => finaleFly()]);
    if (slides[i] && slides[i].querySelector('[data-buddy-stairs]')) { if (!up) begin(idle(.5)); else { B.passPlats = true; B.forceChute = true; } B.queue = [() => stairsRun()]; }
  }



  // ===================== инерциализация переходов =====================
  // Вместо смешивания старой и новой позы (Bollo, GDC 2018; Holden, «Dead Blending»): в момент перехода
  // запоминаем разницу «последний кадр − первый кадр нового действия» и её скорость, а дальше гасим
  // эту разницу критически демпфированной пружиной. Новое действие играет с первого кадра, без «киселя»,
  // а инерция старого движения сохраняется. 25 каналов, без выделения памяти на кадр.
  const NCH = SC.length + AR.length * 2;
  const IN = { arm: false, x: new Float64Array(NCH), v: new Float64Array(NCH), h: .1, on: false,
    prev: new Float64Array(NCH), prev2: new Float64Array(NCH), dtPrev: 1 / 60 };
  function chGet(p, out) { let i = 0; for (const k of SC) out[i++] = p[k]; for (const k of AR) { out[i++] = p[k][0]; out[i++] = p[k][1]; } }
  const _cur = new Float64Array(NCH);
  function inertia(p, dt) {
    chGet(p, _cur);
    if (IN.arm && B.pose) {
      IN.arm = false; IN.on = true; IN.h = Math.max(.04, B.bd * .32);
      for (let i = 0; i < NCH; i++) {
        let x = IN.prev[i] - _cur[i];
        if (i === 0) x = ((x + 540) % 360) - 180;   // поворот тела — по кратчайшей дуге
        IN.x[i] = clamp(x, -200, 200);
        IN.v[i] = clamp((IN.prev[i] - IN.prev2[i]) / Math.max(IN.dtPrev, 1e-3), -900, 900);
      }
    }
    if (IN.on) {
      const y = 1.3862944 / IN.h, e = Math.exp(-y * dt); let left = 0;
      for (let i = 0; i < NCH; i++) {
        const x = IN.x[i], j = IN.v[i] + x * y;
        IN.x[i] = e * (x + j * dt); IN.v[i] = e * (IN.v[i] - j * y * dt);
        left += Math.abs(IN.x[i]);
      }
      let i = 0;
      for (const k of SC) p[k] += IN.x[i++];
      for (const k of AR) { p[k][0] += IN.x[i]; p[k][1] += IN.x[i + 1]; i += 2; }
      if (left < .02) IN.on = false;
      chGet(p, _cur);
    }
    IN.prev2.set(IN.prev); IN.prev.set(_cur); IN.dtPrev = dt || IN.dtPrev;
  }

  // ===================== ум: взгляд, настроение, внимание =====================
  // Поверх любого действия. Взгляд: сначала прыгают глаза (саккада), голова догоняет с задержкой ~80 мс.
  // Настроение — две оси (Russell): v — удовольствие −1…1, a — возбуждение 0…1; события дают толчок,
  // дальше значения стекают к базе. База возбуждения падает, если слайд висит долго (скучает, потом спит).
  // Бюджет внимания: CALM (4) секунд после смены слайда — только тихое (зал читает слайд), трюки и способности ждут.
  const CALM = 4, LOUD = { climb: 1, pullups: 1, handstand: 1, backflip: 1, jacks: 1, hop: .6, jog: .5, shadowbox: 1, kick: 1, dance: 1, stumble: .7,
    cheer: .6, gap: 1, squats: .8, toeTouch: .6, logo: .4, sideBend: .3 };
  const SLEEPY = { yawn: 1, stretch: .6, sitRest: 1, idle: .5, lookHall: .3, nap: 1 };
  // критически демпфированная пружина (Holden, «Spring-It-On»): x — отклонение, v — скорость, h — полураспад
  function spring(st, goal, h, dt) {
    const y = 1.3862944 / Math.max(h, 1e-4), x0 = st.x - goal, j = st.v + x0 * y, e = Math.exp(-y * dt);
    st.x = goal + e * (x0 + j * dt); st.v = e * (st.v - j * y * dt);
    return st.x;
  }
  const MIND = {
    v: .3, a: .45, sur: 0,                                            // настроение и удивление
    slideAt: 0, flips: [], dwell: 0, pts: [],                         // слайд: когда открыт, частота листания, что на нём интересного
    tgt: null, tgtUntil: 0, nextSacc: 0, micro: [0, 0], microAt: 0,   // куда смотрит
    gx: { x: 0, v: 0 }, gy: { x: 0, v: 0 }, hp: { x: 0, v: 0 }, hy: { x: 0, v: 0 }, goal: [0, 0], headGoal: [0, 0, 0], headAt: 0,
    dir: null, cur: null, bubbleAt: -99, lean: { x: 0, v: 0 }, lastX: null, lastVx: 0,
    calm() { return W.time - this.slideAt < (behavior?.quietSeconds ?? CALM); },
    // множитель веса действия: громкое глушится в тихом окне и при низком возбуждении, сонное растёт от скуки
    gate(k) {
      let w = 1;
      const loud = LOUD[k] || 0, bored = !behavior || behavior.sleepy ? clamp((this.dwell - 35) / 50, 0, 1) : 0;
      if (loud) { if (this.calm()) w *= 1 - .92 * loud; w *= lerp(.35, 1.5, clamp(this.a / .8, 0, 1)) ** loud; }
      if (SLEEPY[k]) w *= 1 + 3 * bored * SLEEPY[k];
      if (k === 'nap') w *= this.dwell > 60 && !W.final ? 1 : 0;
      if (k === 'lookSlide' && this.calm()) w *= 2.5;
      return w;
    },
    onSlide(i) {
      const now = W.time;
      this.flips = this.flips.filter(t => now - t < 5); this.flips.push(now);
      const wasNap = B.act && B.act.name === 'nap';
      this.slideAt = now; this.dwell = 0; this.pts = [];
      this.a = Math.min(1, this.a + .15); this.v = Math.min(1, this.v + .05);
      if (W.final) { this.v = Math.min(1, this.v + .5); this.a = Math.min(1, this.a + .35); this.bubble('heart'); }
      if (wasNap) { this.sur = 1; this.bubble('!'); }
      else if (this.flips.length >= 4) { this.sur = .5; if (chance(.5)) this.bubble('?'); }   // листают быстро — удивлён, но тих
      this.look(null);
    },
    // интересные точки слайда: заголовок, крупные числа, картинки — в px сцены
    scan(slide) {
      const b = boxD(), pts = [];
      for (const e of slide.querySelectorAll('h1, h2, h3, img, .screen, [class*=num], [class*=big], [class*=stat], strong, b')) {
        if (!shown(e)) continue;
        const r = e.getBoundingClientRect(); if (r.width < 8 || r.height < 8) continue;
        const d = toD(r, b), cs = getComputedStyle(e), fs = parseFloat(cs.fontSize) || 0;
        const media = e.tagName === 'IMG' || e.classList.contains('screen');
        const kind = media ? 'pic' : /\d/.test(e.textContent) && fs >= 40 ? 'stat' : /^H[12]$/.test(e.tagName) ? 'title' : null;
        if (!kind) continue;
        pts.push({ x: (d.x1 + d.x2) / 2, y: (d.y1 + d.y2) / 2, kind, w: kind === 'stat' ? 3 : kind === 'title' ? 2 : 1 + Math.min(2, (d.x2 - d.x1) * (d.y2 - d.y1) / 60000) });
      }
      this.pts = pts;
      // сценарий взгляда на новом слайде: заголовок → самое крупное число или картинка
      const t0 = W.time, title = pts.find(q => q.kind === 'title'), star = pts.filter(q => q.kind !== 'title').sort((a, c) => c.w - a.w)[0];
      if (title) this.look(title, 1.3, t0 + rr(.1, .35));
      if (star) this.look(star, 1.8, t0 + 1.6, star.kind === 'stat' ? () => { this.sur = Math.max(this.sur, .8); this.a = Math.min(1, this.a + .2); if (chance(.35)) this.bubble('!'); } : null);
    },
    look(p, dur, at, then) {   // p = {x, y, z} в px сцены (z — к зрителю); null — сброс
      if (!p) { this.tgt = null; this.queue = []; return; }
      (this.queue = this.queue || []).push({ p, dur: dur || 1.5, at: at || W.time, then });
    },
    headPos() {   // голова в px сцены — по прошлому кадру 3D или по скелету
      if (G3 && G3.on && this._hp) return this._hp;
      return [B.x, B.y - 38 * S * B.scale, 0];
    },
    update(dt) {
      const now = W.time;
      this.dwell = now - this.slideAt;
      if ((!behavior || behavior.sleepy) && !focusRequested && this.dwell > 40 && this.dwell - dt <= 40 && !W.final) this.bubble('…');   // задумался на долгом слайде
      // настроение стекает к базе
      const baseA = behavior && !behavior.sleepy ? .45 : lerp(.45, .1, smooth((this.dwell - 25) / 70)), baseV = W.final ? .7 : .3;
      this.a += (baseA - this.a) * (1 - Math.exp(-dt / 9)); this.v += (baseV - this.v) * (1 - Math.exp(-dt / 14));
      this.sur *= Math.exp(-dt / .7);
      // курсор рядом — смотрим на него
      const hp = this.headPos();
      let curTgt = null;
      if (this.cur && now - this.cur.t < 1.4) {
        const dx = this.cur.x - hp[0], dy = this.cur.y - hp[1], d = Math.hypot(dx, dy);
        if (d < 320) curTgt = { x: this.cur.x, y: this.cur.y, z: 60 };
      }
      // очередь взглядов (сценарий слайда), иначе — курсор, иначе — бродячие саккады
      let tg = null;
      while (this.queue?.length && this.queue[0].p.active && !this.queue[0].p.active()) this.queue.shift();
      if (this.queue && this.queue.length && now >= this.queue[0].at) {
        const q = this.queue[0];
        if (!q.started) { q.started = now; if (q.then) q.then(); }
        tg = q.p; if (now - q.started > q.dur) this.queue.shift();
      } else if (curTgt) tg = curTgt;
      else {
        if (now > this.nextSacc) {
          this.nextSacc = now + rr(.8, 3);
          const r = rnd(), walking = B.act && (B.act.name === 'walk');
          if (walking || r < .35) this.tgt = null;                                    // перед собой
          else if (r < .65 && this.pts.length) { const q = this.pts[Math.floor(rnd() * this.pts.length)]; this.tgt = { x: q.x + rr(-20, 20), y: q.y, z: 0 }; }
          else if (r < .8) this.tgt = { x: hp[0], y: hp[1] + 20, z: 2000 };            // в зал
          else this.tgt = { x: hp[0] + B.face * rr(40, 140), y: B.surfY - 4, z: 20 };   // под ноги впереди
        }
        tg = this.tgt;
      }
      // голова — по геометрии сцены (устойчиво), глаза — остаток по 3D-голове прошлого кадра (lookDir)
      let gx = 0, gy = 0, wantHp = 0, wantHy = 0;
      if (tg) {
        const dx = tg.x - hp[0], dy = hp[1] - tg.y, far = Math.abs(dx) + (tg.z || 0) + 1;
        const ayG = Math.atan2(dy, far);
        wantHp = -clamp(deg(ayG) * .6, -28, 28);
        wantHy = (tg.z || 0) > 500 ? 22 : dx * B.face < -30 ? 14 : 0;   // в зал или назад — голова к зрителю
        const d = G3 && G3.on && this.dir;
        if (d) { gx = clamp(Math.atan2(d[0], Math.max(d[2], .05)) / .6, -1, 1); gy = clamp(Math.atan2(d[1], Math.hypot(d[0], d[2])) / .45, -1, 1); }
        else gy = clamp((ayG - rad(-wantHp)) / .45, -1, 1);
        this._want = tg;
      } else this._want = null;
      // микросаккады — чтобы взгляд не стоял мёртво
      if (now > this.microAt) { this.microAt = now + rr(.25, .7); this.micro = [rr(-.06, .06), rr(-.05, .05)]; }
      if (Math.abs(gx - this.goal[0]) + Math.abs(gy - this.goal[1]) > .08) { this.goal = [gx, gy]; this.headAt = now + .08; }
      if (now >= this.headAt) this.headGoal = [wantHp, wantHy];
      spring(this.gx, this.goal[0] + this.micro[0], .025, dt); spring(this.gy, this.goal[1] + this.micro[1], .025, dt);
      spring(this.hp, this.headGoal[0], .14, dt); spring(this.hy, this.headGoal[1], .18, dt);
      // инерция корпуса: при разгоне и торможении корпус по инерции отстаёт и забегает вперёд
      if (B.mode === 'ground' && this.lastX != null && dt > 0) {
        const vx = (B.x - this.lastX) / dt * B.face, acc = clamp((vx - this.lastVx) / dt, -900, 900);
        this.lastVx += (vx - this.lastVx) * Math.min(1, dt * 20);
        const k = 355, c = 2 * .55 * Math.sqrt(k);
        this.lean.v += (-k * this.lean.x - c * this.lean.v - acc * 6) * dt; this.lean.x = clamp(this.lean.x + this.lean.v * dt, -9, 9);
      } else { this.lean.x *= Math.exp(-dt * 6); this.lean.v = 0; this.lastVx = 0; }
      this.lastX = B.x;
    },
    // наложить на позу: голова, осанка, мимика; FACE — для шейдера лица
    apply(p, dt) {
      const target = B.mode === 'ground' && !(B.act && B.act.power) && !p.still ? 1 : .35;
      // Ограничение внимания в полёте/удержании позы тоже входит плавно:
      // мгновенная смена множителя давала до 18° поверх уже сглаженной позы.
      this.poseWeight ??= target;
      this.poseWeight += (target - this.poseWeight) * (1 - Math.exp(-dt / .12));
      const quiet = this.poseWeight;
      // взгляд добавляется к позе, но не запрокидывает голову за −40° (у lookSlide своё −34, вместе выходило −62)
      p.hp = Math.max(p.hp + this.hp.x * quiet, Math.min(p.hp, -40)); p.hy += this.hy.x * quiet;
      if (B.mode === 'ground' && !(B.act && B.act.power)) {
        const slouch = clamp((.35 - this.a) / .25, 0, 1);   // скучно — сутулится, голова ниже
        p.tl += 5 * slouch + this.lean.x; p.hp += 7 * slouch - .6 * this.lean.x;
        p.lid = Math.max(p.lid, .32 * slouch);
      }
      p.smile = clamp(p.smile + .45 * this.v, -1, 1.2);
      p.brow = clamp(p.brow + 1.1 * this.sur, -1, 1.3);
      p.mouth = Math.max(p.mouth, .7 * this.sur * (this.sur > .3 ? 1 : 0));
      FACE.gaze[0] = this.gx.x; FACE.gaze[1] = this.gy.x;
      FACE.blush = 0; FACE.browTilt = clamp(-this.v, 0, 1) * .8 + .5 * this.sur; FACE.squint = 0;
    },
    // пузырь-мысль над головой: редко, у всех кроме сна — общая пауза 18 с
    bubble(kind) {
      if (kind !== 'z' && W.time - this.bubbleAt < 18) return;
      if (kind !== 'z') this.bubbleAt = W.time;
      bubbles.push({ kind, age: 0, life: kind === 'z' ? 2.2 : 1.9, el: null });
    },
  };

  // пузыри: белое облачко с тонким контуром и знаком; живут в переднем слое, летят за головой
  const bubbleLayer = document.createElementNS(NS, 'g'); bubbleLayer.setAttribute('class', 'buddy-bubbles');
  const bubbles = [];
  const GLYPH = {
    '!': '<path d="M0 -4.6v5.4" stroke="#FF6427" stroke-width="2.1" stroke-linecap="round"/><circle cx="0" cy="3.6" r="1.15" fill="#FF6427"/>',
    '?': '<path d="M-2.4 -2.6c0-2.2 1.3-3.2 2.6-3.2s2.5 1 2.5 2.4c0 1.9-2.5 2-2.5 4.1" fill="none" stroke="#2C3863" stroke-width="1.8" stroke-linecap="round"/><circle cx="0.2" cy="4" r="1.1" fill="#2C3863"/>',
    heart: '<path d="M0 4.2c-3.6-2.5-5-4.2-5-6 0-1.6 1.2-2.7 2.6-2.7 1 0 1.9.6 2.4 1.5.5-.9 1.4-1.5 2.4-1.5 1.4 0 2.6 1.1 2.6 2.7 0 1.8-1.4 3.5-5 6z" fill="#FF6427"/>',
    bulb: '<path d="M0 -5.4a3.6 3.6 0 0 0-2.2 6.5c.5.4.8 1 .8 1.6h2.8c0-.6.3-1.2.8-1.6A3.6 3.6 0 0 0 0-5.4z" fill="#FFC23D" stroke="#B07A00" stroke-width=".8"/><path d="M-1.3 4.1h2.6M-.9 5.4h1.8" stroke="#6B625E" stroke-width=".9" stroke-linecap="round"/>',
    '…': '<circle cx="-3" cy="0" r="1.15" fill="#2C3863"/><circle cx="0" cy="0" r="1.15" fill="#2C3863"/><circle cx="3" cy="0" r="1.15" fill="#2C3863"/>',
    z: '<text x="0" y="3.4" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-weight="700" font-size="9" fill="#2C3863">z</text>',
  };
  function bubbleStep(dt) {
    if (!bubbles.length) return;
    if (!bubbleLayer.parentNode && fxFront.parentNode) fxFront.parentNode.appendChild(bubbleLayer);
    const hp = MIND.headPos();
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i]; b.age += dt;
      if (!b.el) {
        b.el = document.createElementNS(NS, 'g');
        const z = b.kind === 'z';
        b.s = B.face || 1;   // сторона облачка — на всю его жизнь; хвостик-кружки всегда смотрят на голову
        b.el.innerHTML = z ? GLYPH.z : '<circle cx="' + (-5.5 * b.s) + '" cy="12.5" r="1.3" fill="#fff" stroke="rgba(34,27,25,.35)" stroke-width=".7"/><circle cx="' + (-3 * b.s) + '" cy="9" r="2" fill="#fff" stroke="rgba(34,27,25,.35)" stroke-width=".7"/>'
          + '<ellipse cx="0" cy="0" rx="8.6" ry="7.6" fill="#fff" stroke="rgba(34,27,25,.35)" stroke-width=".7"/>' + (GLYPH[b.kind] || '');
        b.ox = z ? rr(4, 9) : 10; b.oy = z ? -6 : -16;
        bubbleLayer.appendChild(b.el);
      }
      const u = b.age / b.life, pop = b.age < .25 ? 1 - Math.pow(1 - b.age / .25, 3) * Math.cos(b.age * 14) : 1;
      const sc = (b.kind === 'z' ? .8 + .5 * u : .9 * clamp(pop, 0, 1.08)) * (u > .85 ? 1 - (u - .85) / .15 * .3 : 1);
      const fx = b.kind === 'z' ? Math.sin(b.age * 3) * 2 : 0;
      b.el.setAttribute('transform', 'translate(' + f2(hp[0] + b.s * b.ox + fx) + ' ' + f2(hp[1] + b.oy - (b.kind === 'z' ? 14 * u : 3 * u)) + ') scale(' + sc.toFixed(3) + ')');
      b.el.setAttribute('opacity', (u > .8 ? 1 - (u - .8) / .2 : 1).toFixed(3));
      if (b.age >= b.life) { b.el.remove(); bubbles.splice(i, 1); }
    }
  }

  // сон на долгом слайде: садится, глаза закрываются, дышит медленнее, над головой «z»
  function nap(duration = 1e6) {
    const SQ = SQUAT, SIT = SIT_HUG;
    const DOZE = pose({ hf: [142, 140], kf: [100, 96], tl: 30, hp: 38, sf: [-6, -6], ef: [108, 108], sa: [12, 12], ea: [-36, -36], af: [2, 2], lid: 1, smile: .25 });
    let zAt = 2, sleepArousal = null;
    return gest('nap', duration, () => .3, (t) => {
      if (t < .5) return mix(STAND, SQ, smooth(t / .5));
      if (t < 1.05) return mix(SQ, SIT, smooth((t - .5) / .55));
      if (sleepArousal === null) sleepArousal = MIND.a;
      // Сонная осанка входит вместе с наклоном головы, а не прибавляется
      // одним кадром после завершения усаживания.
      MIND.a = Math.min(MIND.a, lerp(sleepArousal, .1, smooth((t - 1.05) / 1.55)));
      if (t < 2.6) { const p = mix(SIT, DOZE, smooth((t - 1.05) / 1.55)); p.lid = smooth((t - 1.05) / 1.2); return p; }   // медленно клонит голову на колени
      const p = copy(DOZE), u = t - 2.6, br = Math.sin(u * 2 * PI / 4.6);
      p.tl += 1.6 * br; p.hp += 2 * br; p.still = 1;
      p.lid = 1; p.mouth = .15 + .1 * Math.max(0, br);
      if (t > zAt) { zAt = t + rr(1.2, 1.8); MIND.bubble('z'); }
      return p;
    }, { cset: 6 });
  }

  // ===================== кадр =====================
  function park() {
    if (B.mode === 'free') return fall(0);
    if (B.surf.kind !== 'floor') return descend(LV()) || idle(.5);
    const x = nearestIn(W.floor.spans, B.x);
    if (x != null && Math.abs(x - B.x) > 1.2) return walkTo(x, 'walk');
    focused = x != null;
    return idle(focused ? 3600 : .5);
  }
  function startNext() {
    for (let g = 0; g < 8; g++) {
      const f = B.queue.shift();
      if (!f) completeCommand();
      const a = f ? f() : focusRequested ? park() : autonomous ? decide() : idle(3600);
      if (a) { begin(a); return !!f; }
    }
    begin(idle(1)); return false;
  }
  function frame(dt) {
    B.t += dt; W.time += dt;
    if (!B.act) startNext();
    B.act.t += dt; B.sqT = 0;
    let p = B.act.fn(B.act, dt);
    for (let g = 0; !p && g < 4; g++) { startNext(); p = B.act.fn(B.act, 0); }
    if (!p) p = pose();
    // своя копия на кадр: действия часто отдают одну и ту же константу (return DOWN), а life и MIND.apply
    // прибавляют к позе — без копии наклон головы копился кадр за кадром и голова запрокидывалась на 150°
    { const o = Object.assign({}, p); for (const k of AR) o[k] = p[k].slice(); p = o; }
    inertia(p, dt);
    life(p, dt);
    MIND.update(dt); MIND.apply(p, dt);
    B.pose = p;
    yawStep(dt);
    B.scale += (B.scaleT - B.scale) * Math.min(1, dt * 3.2);
    if (Math.abs(B.scaleT - B.scale) < 1e-3) B.scale = B.scaleT;   // экспонента к цели не приходит: без прилипания после «уменьшения» B.scale === 1 не выполнялось до конца деки, и способности больше не включались
    B.alpha += (B.alphaT - B.alpha) * Math.min(1, dt * 4);
    B.tint += (B.tintT - B.tint) * Math.min(1, dt * 2.5);
    // squash & stretch — затухающая пружина: толчки дают прыжки и приземления, цель — скорость в полёте
    B.sqV += ((B.sqT - B.sq) * 260 - B.sqV * 15) * dt; B.sq = clamp(B.sq + B.sqV * dt, -.32, .26);
    if (B.act && B.act.power) B.capeUntil = B.t + 1.6;
    const k = solve(p, Math.cos(B.yaw) >= 0 ? 1 : -1, Math.sin(B.yaw)); B.kk = k;
    floorHandSupportActive = false;
    if (B.act.name === 'handstand' && p.handContact === 'floor') {
      const supportRig = G3 && G3.rig;
      if (supportRig && supportRig.handContactSupports) floorHandSupportActive = supportRig.handContactSupports(k, p, floorHandSupport);
    }
    if (B.mode === 'ground') groundSolve(k, dt);
    if (B.mode === 'ground') {
      if (B.surf.kind === 'plat' || B.surf.kind === 'logo') {
        if (B.topSurf !== B.surf) { B.topSurf = B.surf; B.topSince = W.time; }
      } else if (B.topSurf) { B.topSurf = null; B.downAt = W.time; }
    }
    B.seat = B.cset & 4 ? clamp(1 - (feetLow(k) - k.seat[1]) / 14, 0, 1) : 0;   // 1 — таз на полу
    render(k, dt);
    if (listeners.size) notify({ type: 'frame', time: W.time });
  }
  function render(k, dt) {
    const sc = S * B.scale, jx = B.jitter ? rr(-B.jitter, B.jitter) : 0;
    const sqk = B.sq * STYLES[STYLE].sq;
    fig.sq = cloneFig.sq = [1 - sqk * .55, 1 + sqk]; fig.dt = cloneFig.dt = dt;
    fig.capeOn = cloneFig.capeOn = !!STYLES[STYLE].mask || B.t < B.capeUntil;
    fig.draw(k, B.yaw, B.pose, B.x + jx, B.y, sc, B.tint);
    for (let i = 0; i < 2; i++) { fig.palmsW[i][0] = fig.handsW[i][0]; fig.palmsW[i][1] = fig.handsW[i][1]; }
    fig.root.setAttribute('opacity', B.alpha.toFixed(3));
    if (B.clip) {   // портал: видна только часть фигуры по одну сторону кольца
      clipR.setAttribute('x', B.clip.keep < 0 ? -2000 : f2(B.clip.x)); clipR.setAttribute('width', B.clip.keep < 0 ? f2(2000 + B.clip.x) : 4000);
      figWrap.setAttribute('clip-path', 'url(#' + uid + 'clip)');
    } else figWrap.removeAttribute('clip-path');
    // тень на поверхности под ногами
    let fy = -1e9, fxs = 0; for (const g of k.legs) { fy = Math.max(fy, g.heel[1], g.toe[1]); fxs += g.ankle[0]; }
    const c = Math.cos(B.yaw), feetY = B.y + fy * sc;
    let cx = B.x + fxs / 2 * c * sc, rx = 11 * sc;
    if (B.cset & 4 && B.mode === 'ground') {   // сидит: тень от таза до стоп, иначе не видно, на что он опирается
      const sx = B.x + k.seat[0] * c * sc, w = Math.max(0, B.seat - .5) * 2;
      rx += Math.abs(cx - sx) / 2 * w; cx += (sx - cx) / 2 * w;
    }
    const sf = surfaceBelow(cx, feetY - 2), h = Math.max(0, sf.y - feetY), q = 1 - Math.min(.75, h / 120);
    shadowEl.setAttribute('cx', f2(cx)); shadowEl.setAttribute('cy', f2(sf.y + .4));
    shadowEl.setAttribute('rx', f2(rx * q)); shadowEl.setAttribute('ry', f2(2 * sc * q * (1 + .25 * Math.max(0, B.seat - .5) * 2)));
    shadowEl.setAttribute('opacity', (.15 * q * B.alpha).toFixed(3));
    // клон: зеркально относительно точки B.clone
    if (B.clone != null) {
      cloneG.setAttribute('display', '');
      cloneFig.draw(k, PI - B.yaw, B.pose, 2 * B.clone - B.x, B.y, sc, B.tint);
      cloneShadow.setAttribute('cx', f2(2 * B.clone - cx)); cloneShadow.setAttribute('cy', f2(sf.y + .4));
      cloneShadow.setAttribute('rx', f2(11 * sc * q)); cloneShadow.setAttribute('ry', f2(2 * sc * q)); cloneShadow.setAttribute('opacity', (.15 * q).toFixed(3));
    } else { cloneG.setAttribute('display', 'none'); cloneShadow.setAttribute('opacity', 0); }
    // шлейф суперскорости
    B.trail.unshift([k, B.yaw, B.pose, B.x, B.y, sc]); if (B.trail.length > ghosts.length * ghostStep + 1) B.trail.pop();
    ghosts.forEach((g, i) => {
      const tr = B.trail[(i + 1) * ghostStep];
      if (B.ghost && tr) { g.g.setAttribute('display', ''); g.fig.draw(tr[0], tr[1], tr[2], tr[3], tr[4], tr[5], 0); }
      else g.g.setAttribute('display', 'none');
    });
    lastRender = { k, scale: sc, jitter: jx };
    cachedActor = actorEnvelope(k, B.pose, B.x + jx, B.y, B.yaw, sc, fig.sq);
    if (B.clone != null) cachedActor = unionBounds(cachedActor, actorEnvelope(k, B.pose, 2 * B.clone - B.x, B.y, PI - B.yaw, sc, fig.sq));
    if (B.ghost) for (let i = 0; i < ghosts.length; i++) {
      const tr = B.trail[(i + 1) * ghostStep];
      if (tr) cachedActor = unionBounds(cachedActor, actorEnvelope(tr[0], tr[2], tr[3], tr[4], tr[1], tr[5], [1, 1]));
    }
    if (G3 && G3.on) draw3d(k, sc, jx);
    else if (B.act?.afterRender) B.act.afterRender();
    fxStep(dt); bubbleStep(dt);
  }
  const feetLow = k => { let fy = -1e9; for (const g of k.legs) fy = Math.max(fy, g.heel[1], g.toe[1]); return fy; };
  // рамка вокруг фигуры в px сцены: таз в (x, y), s — px на единицу скелета; хватает на сальто и руки вверх
  const FIG_BOX = [-72, -82, 72, 62];
  const validBounds = bounds => Array.isArray(bounds) && bounds.length === 4 && bounds.every(Number.isFinite)
    && bounds[2] >= bounds[0] && bounds[3] >= bounds[1];
  function unionBounds(a, b) {
    if (!a) return b ? b.slice() : null;
    if (!b) return a.slice();
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
  }
  function actorEnvelope(k, p, x, y, yaw, scale, squash) {
    const bounds = [Infinity, Infinity, -Infinity, -Infinity], c = Math.cos(yaw), s = Math.sin(yaw),
      sx = scale * squash[0], sy = scale * squash[1], foot = feetLow(k), offsetY = y + foot * (scale - sy),
      point = (v, radius) => {
        const px = x + (v[0] * c - v[2] * s) * sx, py = offsetY + v[1] * sy,
          rx = radius * sx, ry = radius * sy;
        bounds[0] = Math.min(bounds[0], px - rx); bounds[1] = Math.min(bounds[1], py - ry);
        bounds[2] = Math.max(bounds[2], px + rx); bounds[3] = Math.max(bounds[3], py + ry);
      };
    // SVG сдвигает центр увеличенной головы; GLB масштабирует её от нижнего
    // сустава. Радиус включает максимальный pivot lift обеих отрисовок.
    // Запас skin/hair — 1 ед. скелета; проверяется по bundled GLB offline.
    const headScale = 1.5 - .35 * Math.max(0, -Math.cos((p.rot || 0) * PI / 180)), style = STYLES[STYLE],
      headLift = L.headR * Math.max((headScale - 1) * .82, (style.head - 1) * (style.lift || .62)),
      headRadius = L.headR * Math.max(headScale, style.head) + headLift + 1;
    point(k.head, headRadius);
    point(k.pel, fig.capeOn ? 24 : 6); point(k.shC, 8); point(k.seat, 4);
    // Настоящие пальцы выходят дальше короткой расчётной точки кисти:
    // сфера включает открытые и согнутые пальцы при повороте Wrist.
    for (const arm of k.arms) { point(arm.sh, 4.2); point(arm.elbow, 3.5); point(arm.wrist, 3); point(arm.hand, 10); }
    for (const leg of k.legs) { point(leg.hip, 5); point(leg.knee, 4); point(leg.ankle, 3); point(leg.heel, 2.5); point(leg.toe, 2.5); }
    // Поверхность модели, включая обувь, требует до 0,78 ед. сверх капсул.
    // Запас в 1 ед. скелета масштабируется вместе с фигурой.
    bounds[0] -= sx; bounds[1] -= sy; bounds[2] += sx; bounds[3] += sy;
    return bounds;
  }
  function draw3d(k, sc, jx) {
    const { ren, rig, scene, cam, cv } = G3;
    G3.lastFrameResized = false;
    const dev = (devicePixelRatio || 1) * stageK();          // пикселей экрана на px сцены
    G3.viewRevision = viewRevision;
    const inst = G3.inst; inst.length = 0;
    if (B.ghost) [.3, .18, .09].forEach((o, i) => { const tr = B.trail[(i + 1) * ghostStep]; if (tr) inst.push([tr[0], tr[2], tr[3], tr[4], tr[1], tr[5], [1, 1], o]); });
    if (B.clone != null) inst.push([k, B.pose, 2 * B.clone - B.x, B.y, PI - B.yaw, sc, fig.sq, 1]);
    inst.push([k, B.pose, B.x + jx, B.y, B.yaw, sc, fig.sq, 1]);
    const dt3 = G3.t3 == null ? 0 : Math.max(0, W.time - G3.t3); G3.t3 = W.time;
    // Старый реквизит использует те же точки рук, что FX: вычисляем их до его callback.
    if (P3.size && rig.renderAnchors) {
      const face = faceNow(), fy = feetLow(k);
      face.head = 1.5 - .35 * Math.max(0, -Math.cos((B.pose.rot || 0) * PI / 180)); face.yaw = B.yaw;
      rig.pose(k, B.pose, face); rig.place(B.x + jx, B.y + fy * sc, fy, sc, fig.sq, B.yaw);
      rig.renderAnchors(fig, B.act && B.act.name === 'lightning');
    }
    const props = [];
    for (const [n, e] of P3) {
      const st = e.st; st.miss = st.ping ? 0 : st.miss + dt3; st.ping = false;
      if (st.done || st.miss > .2) { rig.prop(n, null); P3.delete(n); continue; }
      const P = e.fn(st, k); if (!P) { rig.prop(n, null); continue; }
      props.push([n, P]);
    }
    let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
    cachedProps = null;
    for (const [, P] of props) if (validBounds(P.box) && (P.fade == null || P.fade > .001) && P.k !== 0) {
      cachedProps = unionBounds(cachedProps, P.box);
      x1 = Math.min(x1, P.box[0]); y1 = Math.min(y1, P.box[1]); x2 = Math.max(x2, P.box[2]); y2 = Math.max(y2, P.box[3]);
    }
    for (const q of inst) {
      const s = q[5] * 1.15;
      x1 = Math.min(x1, q[2] + FIG_BOX[0] * s); x2 = Math.max(x2, q[2] + FIG_BOX[2] * s);
      y1 = Math.min(y1, q[3] + FIG_BOX[1] * s); y2 = Math.max(y2, q[3] + FIG_BOX[3] * s);
    }
    if (G3.reserveBounds) {
      x1 = Math.min(x1, G3.reserveBounds[0]); y1 = Math.min(y1, G3.reserveBounds[1]);
      x2 = Math.max(x2, G3.reserveBounds[2]); y2 = Math.max(y2, G3.reserveBounds[3]);
    }
    // размер холста — с шагом 16 px; растёт сразу, сжимается через 2 с (иначе перевыделение буфера на каждом кадре)
    const needW = Math.max(G3.reserveW, Math.ceil((x2 - x1) / 16) * 16), needH = Math.max(G3.reserveH, Math.ceil((y2 - y1) / 16) * 16);
    let W2 = G3.w, H2 = G3.h;
    // растёт сразу и с запасом в 20 % (рост фигуры — серия кадров, иначе буфер перевыделяется на каждом);
    // сжимается, только если фигура была меньше холста 2 с подряд: короткое «уменьшиться и вырасти» холст не трогает
    if (needW > W2 || needH > H2) {
      W2 = Math.max(W2, Math.ceil(needW * 1.2 / 16) * 16); H2 = Math.max(H2, Math.ceil(needH * 1.2 / 16) * 16); G3.smallSince = null;
    } else if (G3.trim || REDUCED) {
      W2 = needW; H2 = needH; G3.smallSince = null; G3.trim = false;
    } else if (canvasInUse()) {
      G3.smallSince = null;   // приземление и жесты не прерываются дорогостоящим сжатием framebuffer
    } else if (needW < W2 - 48 || needH < H2 - 48) {
      if (G3.smallSince == null) G3.smallSince = W.time;
      else if (W.time - G3.smallSince > 2) { W2 = needW; H2 = needH; G3.smallSince = null; }
    } else G3.smallSince = null;
    const pr = canvasRatio(W2, H2, dev);
    resizeCanvas(W2, H2, pr, dev);
    // левый верхний угол — по сетке пикселей экрана, рамка по центру нужной области
    const L0 = Math.floor(((x1 + x2) / 2 - W2 / 2) * dev) / dev, T0 = Math.floor(((y1 + y2) / 2 - H2 / 2) * dev) / dev;
    cam.left = L0; cam.right = L0 + W2; cam.top = -T0; cam.bottom = -(T0 + H2); cam.updateProjectionMatrix();
    cv.style.transform = 'translate(' + L0.toFixed(4) + 'px,' + T0.toFixed(4) + 'px)';
    ren.clear();
    rig.tint(B.tint);
    const face = faceNow();
    for (const q of inst) {
      const [kk, p, x, y, yaw, s, sq, op] = q, fy = feetLow(kk);
      rig.opacity(op);
      // голова ×1,5 нужна для читаемости, но вниз головой она упирается в пол — тогда уменьшаем до ×1,15
      face.head = 1.5 - .35 * Math.max(0, -Math.cos((p.rot || 0) * PI / 180)); face.yaw = yaw;
      rig.pose(kk, p, face); rig.place(x, y + fy * s, fy, s, sq, yaw);
      const main = q === inst[inst.length - 1]; rig.propsOn(main);   // реквизит — только у главной фигуры, не у клона и шлейфа
      if (main && rig.renderAnchors) rig.renderAnchors(fig, B.act && B.act.name === 'lightning');
      if (main) for (const [n, P] of props) rig.prop(n, P);
      ren.render(scene, cam);
    }
    // для «ума»: где голова и куда от неё цель взгляда — по только что отрисованной главной фигуре
    if (rig.headPos(G3.hp)) { MIND._hp = G3.hp; const w = MIND._want; MIND.dir = w ? rig.lookDir(w.x, w.y, w.z || 0, G3.dir) : null; }
    rig.opacity(1);
    cv.style.opacity = B.alpha.toFixed(3);
    cv.style.clipPath = !B.clip ? '' : B.clip.keep < 0 ? 'inset(0 ' + f2(Math.max(0, L0 + W2 - B.clip.x)) + 'px 0 0)' : 'inset(0 0 0 ' + f2(Math.max(0, B.clip.x - L0)) + 'px)';
    if (B.act?.afterRender) B.act.afterRender();
  }
  const canvasPixelLimit = 8.4e6, supersamplingPixelBudget = 2.4e6;
  function canvasInUse() {
    return B.mode === 'free' || B.queue.length || !['idle', 'lookSlide', 'lookHall', 'nap', 'posed'].includes(B.act?.name)
      || B.fxs.some(fx => validBounds(fx.frameBounds));
  }
  function canvasRatio(width, height, dev) {
    const framedFx = B.fxs.some(fx => validBounds(fx.frameBounds));
    if (framedFx) G3.framedFxUntil = W.time + 2;
    const reserveFx = framedFx || W.time < G3.framedFxUntil;
    // 6 ограничивает только supersampling: native DPR крупного плана важнее мягкого бюджета.
    const ceiling = Math.max(dev, Math.min(6, Math.sqrt(supersamplingPixelBudget / (width * height)))),
      desired = Math.min(dev * G3.ss, ceiling),
      budget = Math.sqrt(canvasPixelLimit / (width * height)), hardware = G3.maxDimension / Math.max(width, height),
      // Native scale растёт дискретными ступенями вверх: мелкий CSS zoom не перевыделяет
      // framebuffer каждый кадр и не застревает на дробь ниже экранного DPR.
      density = desired === dev ? Math.ceil(dev * 8) / 8
        // У FX после жеста камера ещё приближается: весь мягкий резерв
        // выделяется сразу и сохраняется две секунды после выхода эффекта.
        : reserveFx ? ceiling : desired,
      // Камера может отъехать и вернуться в одном номере: уже выделенная плотность
      // сохраняется до покоя, чтобы её плавный scale не перевыделял framebuffer.
      ratio = Math.min(Math.max(density, canvasInUse() || reserveFx ? G3.pr : 0), budget, hardware);
    G3.densityLimit = ratio >= desired ? 'none' : hardware <= budget ? 'hardware' : 'pixel-budget';
    return ratio;
  }
  function resizeCanvas(width, height, ratio, screenRatio) {
    const { ren, rig, cv } = G3;
    const nativeShort = ratio >= screenRatio && (cv.width < Math.floor(width * screenRatio) || cv.height < Math.floor(height * screenRatio)),
      resized = width !== G3.w || height !== G3.h || Math.abs(ratio - G3.pr) > .01 || nativeShort;
    if (resized) {
      if (ratio !== G3.pr) G3.pixelRatioChanges++;
      G3.w = width; G3.h = height; G3.pr = ratio;
      // setPixelRatio сам вызывает setSize со старыми размерами: атомарная операция избегает двойного resize.
      const at = performance.now();
      ren.setDrawingBufferSize(width, height, ratio);
      G3.lastResizeMs = performance.now() - at; G3.resizeMs += G3.lastResizeMs; G3.resizes++;
      G3.lastFrameResized = true; G3.peakPixels = Math.max(G3.peakPixels, cv.width * cv.height);
      cv.style.width = width + 'px'; cv.style.height = height + 'px';
    }
    const display = Math.max(.01, screenRatio || (devicePixelRatio || 1) * stageK()),
      outline = 1.25 * G3.pr / display;
    // При ограничении supersampling контур не должен становиться темнее и толще в крупном плане.
    if (resized || Math.abs(outline - G3.outlinePx) > 1e-4) rig.viewport(cv.width, cv.height, outline);
    G3.screenRatio = display; G3.outlinePx = outline;
  }
  function reserveCanvasScale(scale) {
    if (!G3?.on) return;
    const at = performance.now(), dev = (devicePixelRatio || 1) * stageK(),
      width = Math.ceil((FIG_BOX[2] - FIG_BOX[0]) * 1.15 * S * scale / 16) * 16,
      height = Math.ceil((FIG_BOX[3] - FIG_BOX[1]) * 1.15 * S * scale / 16) * 16;
    G3.reserveW = width; G3.reserveH = height; G3.smallSince = null;
    const w = Math.max(G3.w, width), h = Math.max(G3.h, height),
      ratio = canvasRatio(w, h, dev);
    resizeCanvas(w, h, ratio, dev); G3.reserveMs += performance.now() - at;
  }
  function reserveCanvasBounds(bounds) {
    if (!validBounds(bounds) || bounds[2] <= bounds[0] || bounds[3] <= bounds[1]) throw new RangeError('Expected finite bounds [x1,y1,x2,y2] with positive area');
    if (!G3?.on) return false;
    const at = performance.now(), scale = S * B.scale * 1.15,
      actor = [B.x + FIG_BOX[0] * scale - 4, B.y + FIG_BOX[1] * scale - 4, B.x + FIG_BOX[2] * scale + 4, B.y + FIG_BOX[3] * scale + 4];
    G3.reserveBounds = unionBounds(bounds, actor); G3.smallSince = null;
    const width = Math.ceil((G3.reserveBounds[2] - G3.reserveBounds[0]) / 16) * 16,
      height = Math.ceil((G3.reserveBounds[3] - G3.reserveBounds[1]) / 16) * 16,
      dev = (devicePixelRatio || 1) * stageK(),
      ratio = canvasRatio(width, height, dev);
    resizeCanvas(width, height, ratio, dev); G3.reserveMs += performance.now() - at;
    return true;
  }
  // мимика и взгляд поверх позы: заполняет «ум» (ниже), здесь — значения по умолчанию
  const FACE = { gaze: [0, 0], blush: 0, browTilt: 0, squint: 0, frown: 0, head: 1.5 };
  function faceNow() { return FACE; }

  // ===================== запуск =====================
  let MANUAL = false;
  function clearTransient() {
    if (G3) { G3.reserveW = 0; G3.reserveH = 0; G3.reserveBounds = null; G3.framedFxUntil = 0; }
    cachedProps = null;
    unrestore();
    for (const o of B.fxs) o.el.remove();
    B.fxs = []; fxBack.replaceChildren(); fxFront.replaceChildren();
    propsClear();
    Object.assign(B, { scale: 1, scaleT: 1, alpha: 1, alphaT: 1, tint: 0, tintT: 0,
      clone: null, ghost: false, clip: null, jitter: 0, forceChute: false, passPlats: false,
      roomAt: null, grapT: null, keyMagnet: false, chuteDrift: 0, capeUntil: -1 });
    B.trail.length = 0;
  }
  window.__buddy = {
    get reduced() { return REDUCED; },
    get renderer() { return G3 && G3.on ? 'webgl' : 'svg'; },
    ready: G3 ? G3.rig.loaded.catch(() => null) : Promise.resolve(),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    command: () => command,
    behavior(policy) { behavior = policy; B.bag = []; },
    focus(on) {
      focusRequested = on; focused = false;
      if (on && B.act?.name === 'nap' && !REDUCED) {
        clearTransient(); B.queue = []; begin(idle(.45)); return;
      }
      if (B.act && ['idle', 'nap'].includes(B.act.name) && !B.queue.length && !REDUCED) {
        if (B.act.name === 'nap') clearTransient();
        begin(idle(.45));
      }
    },
    finishRest() {
      if (B.act?.name === 'nap') { clearTransient(); B.queue = []; begin(idle(.45)); }
    },
    tools: { pose, copy, mix, gest, mk, custom, particle, sparks, S, solve, clamp, lerp, smooth, begin, hands: () => fig.handsW, mouth: () => fig.mouthW,
      prop3, reserveCanvasBounds, registerPropBuilders: factory => G3 ? G3.rig.registerPropBuilders(factory) : 0 },
    registerAbilities(factories) {
      for (const [name, factory] of Object.entries(factories)) { MAKE[name] = factory; POWERS[name] = 1; }
    },
    availability(name) {
      if (name === 'parachute') {
        if (B.mode !== 'ground' || B.surf.kind !== 'floor') return 'Parachute launch requires a standing pose on the floor';
        if (parachuteLaunchSite(440) == null) return 'No clear, reachable corridor for parachute launch';
      }
      if (['climb', 'grapple', 'web', 'pullups'].includes(name) && W.time - B.downAt < 15)
        return 'Wait 15 seconds after descending before climbing again';
      if (name === 'web') {
        if (B.surf.kind !== 'floor' || B.mode !== 'ground') return 'Web swing requires a standing pose on the floor';
        if (!webWalls().length) return 'No block edge within reach of the thread';
      }
      if (name === 'grapple' && !grappleTargets().length) return 'No platform within grappling-hook range';
      if (name === 'pullups') {
        if (B.surf.kind !== 'floor' || B.mode !== 'ground') return 'Pull-ups require a standing pose on the floor';
        if (!pullupCandidates(W, B, LV(), floorRange()).length) return 'No reachable edge for pull-ups';
      }
      if (name === 'tracker') {
        if (B.surf.kind !== 'floor' || B.mode !== 'ground') return 'Stamping requires a standing pose on the floor';
        if (!trackerCandidates(W, B, FLOOR).length) return 'No suitable clear edge for stamping';
      }
      return null;
    },
    autonomous(on) {
      const was = autonomous; autonomous = !!on;
      // ожидание без своей воли длится час — при включении своей жизни его обрываем, дальше решает decide()
      if (autonomous && !was && B.act && B.act.name === 'idle' && !B.queue.length && !REDUCED) begin(idle(rr(.3, .8)));
    },
    reset() {
      interrupt(REDUCED ? 'reduced-motion' : 'reset'); focused = false;
      clearTransient();
      if (G3) G3.trim = true;
      for (const o of bubbles) if (o.el) o.el.remove();
      bubbles.length = 0;
      Object.assign(B, { x: 640, y: FLOOR - lowY(STAND) * S, surf: W.floor, surfY: FLOOR,
        mode: 'ground', anchor: null, face: 1, cam: .15, yaw: .3, yawV: 0,
        pose: copy(STAND), queue: [], vx: 0, lift: 0, free: false, drive: false,
        cset: 0, sq: 0, sqV: 0, sqT: 0, topSurf: null, topSince: -1e9, downAt: -1e9 });
      IN.on = IN.arm = false; IN.x.fill(0); IN.v.fill(0);
      chGet(STAND, IN.prev); IN.prev2.set(IN.prev);
      MIND.lastX = null; MIND.lastVx = 0; MIND.lean.x = MIND.lean.v = 0; MIND.poseWeight = 1;
      begin(idle(autonomous || focusRequested ? rr(.5, 1) : 3600)); REDUCED ? staticPose() : frame(1 / 60);
    },
    scene(name) {
      if (!['stairs', 'finale', 'land', 'leap', 'flip'].includes(name)) return false;
      startCommand();
      const launchScale = B.scale;
      clearTransient();
      B.queue = [];
      rescan();
      if (name === 'stairs') { const a = stairsRun(); if (a) begin(a); return !!a; }
      if (name === 'finale') { const a = finaleFly(); if (a) begin(a); return !!a; }
      if (name === 'land') {
        const target = slides[W.idx].querySelector('[data-buddy-land]');
        if (!target) return false;
        const d = toD(target.getBoundingClientRect(), boxD()), x = (d.x1 + d.x2) / 2;
        const surf = { kind: 'plat', y: d.y1, x1: d.x1, x2: d.x2, spans: [[d.x1 + 10, d.x2 - 10]] };
        Object.assign(B, { x, y: -80, mode: 'free', surf, passPlats: false, forceChute: false });
        B.queue = [() => wave()]; begin(fall(0, 1)); return true;
      }
      if (name === 'leap' || name === 'flip') {
        B.scale = B.scaleT = launchScale;
        B.queue = []; begin(leap({ x0: B.x, y0: B.y, s0: launchScale, xp: 640, yp: 350, xl: 640, smax: 5, flip: name === 'flip' })); return true;
      }
      return false;
    },
    progress(p) { W.progress = p; W.li = LEVELS.findIndex(l => p <= l.upTo); W.boost = false; },
    destroy() {
      if (destroyed) return;
      interrupt('destroyed'); listeners.clear();
      destroyed = true; unrestore(); observer.disconnect(); resizeObserver?.disconnect(); intersectionObserver?.disconnect(); viewObserver.disconnect();
      cancelAnimationFrame(raf); cancelAnimationFrame(viewRaf); for (const id of timers) globalThis.clearTimeout(id);
      timers.clear(); for (const off of cleanups) off();
      clearTransient(); B.queue = []; B.act = null;
      dispose3d(); host.replaceChildren();
    },
    kin: o => { const k = solve(pose(o), 1), r = v => v.map(x => +x.toFixed(1)); return { seat: r(k.seat), sh: k.arms.map(a => r(a.sh)), hand: k.arms.map(a => r(a.hand)), elbow0: r(k.arms[0].elbow), knee: k.legs.map(g => r(g.knee)), heel: k.legs.map(g => r(g.heel)), toe: k.legs.map(g => r(g.toe)), head: r(k.head), hF: r(k.hF), hU: r(k.hU), hS: r(k.hS) }; },
    mind: () => MIND, say: k => { MIND.bubbleAt = -99; MIND.bubble(k); },
    manual(on) { MANUAL = on !== false; runtimePaused = MANUAL; cancelAnimationFrame(raf); raf = 0; last = performance.now(); schedule(); },
    step(sec, fps) {
      if (destroyed || REDUCED) return;
      fps = fps || 60;
      const n = Math.floor(sec * fps + 1e-9), substeps = Math.max(1, Math.ceil(60 / fps)), dt = 1 / (fps * substeps);
      for (let i = 0; i < n; i++) for (let j = 0; j < substeps; j++) frame(dt);
      let remaining = Math.max(0, sec - n / fps);
      while (remaining > 1e-9) { const step = Math.min(1 / 60, remaining); frame(step); remaining -= step; }
    },
    seed(n) { seed = n >>> 0; },
    run(list) {
      startCommand();
      const airborne = B.mode === 'free';
      clearTransient();
      B.queue = list.map(x => () => { const [n, ...args] = Array.isArray(x) ? x : [x]; if (MAKE[n]) return MAKE[n](...args); const a = powerMake(n); if (a && a.name !== 'walk') a.power = true; return a; });
      // Прерывание полёта не телепортирует на пол: сначала завершаем безопасное падение.
      if (airborne) { begin(fall(0)); return true; }
      return startNext();
    },
    state: () => ({ x: +B.x.toFixed(1), y: +B.y.toFixed(1), act: B.act && B.act.name, surf: B.surf && B.surf.kind, level: W.li, plats: W.plats.length, walls: W.walls.length, queue: B.queue.length, fx: B.fxs.length, time: W.time, visible, focusing: focusRequested, focused, busy: !!(B.act && !['idle', 'lookSlide', 'lookHall', 'nap'].includes(B.act.name)) || B.queue.length > 0 }),
    metrics: () => ({ frames: frameCount, meanFrameMs: frameCount ? frameCost / frameCount : 0, peakFrameMs: framePeak, scheduled: !!raf, timers: timers.size,
      canvasResizes: G3?.resizes ?? 0, canvasResizeMs: G3?.resizeMs ?? 0, canvasLastResizeMs: G3?.lastResizeMs ?? 0,
      canvasPeakPixels: G3?.peakPixels ?? 0, canvasPixels: G3 ? G3.cv.width * G3.cv.height : 0,
      canvasReserveMs: G3?.reserveMs ?? 0,
      canvasReserved: !!(G3?.reserveW || G3?.reserveBounds || G3 && W.time < G3.framedFxUntil),
      canvasWidth: G3?.cv.width ?? 0, canvasHeight: G3?.cv.height ?? 0, drawingBufferRatio: G3?.pr ?? 0,
      screenRatio: G3?.screenRatio ?? 0, outlineBufferPx: G3?.outlinePx ?? 0,
      outlineScreenPx: G3?.pr ? G3.outlinePx * G3.screenRatio / G3.pr : 0,
      canvasPixelLimit, canvasDimensionLimit: G3?.maxDimension ?? 0,
      canvasDensityLimit: G3?.densityLimit ?? 'none',
      nativeDensityMet: !!G3?.w && G3.cv.width >= Math.floor(G3.w * G3.screenRatio) && G3.cv.height >= Math.floor(G3.h * G3.screenRatio),
      pixelRatioChanges: G3?.pixelRatioChanges ?? 0, lastFrameResized: G3?.lastFrameResized ?? false }),
    frameBounds() {
      const copy = bounds => bounds ? Object.freeze(bounds.slice()) : null,
        actor = cachedActor || [B.x - 16, B.y - 38, B.x + 16, B.surfY + 2],
        detail = B.act?.detailBounds?.();
      let planned = validBounds(B.act?.frameBounds) ? B.act.frameBounds : null;
      for (const fx of B.fxs) if (validBounds(fx.frameBounds)) planned = unionBounds(planned, fx.frameBounds);
      return Object.freeze({ actor: copy(actor), props: copy(cachedProps),
        detail: copy(validBounds(detail) ? detail : null),
        planned: copy(planned) });
    },
    ensureWorld() { if (worldDirty || !W.ready || slides.findIndex(s => s.classList.contains(presentation?.activeClass || 'on')) !== W.idx) rescan(); },
    world: () => ({ walls: W.walls.map(w => ({ x: Math.round(w.x), side: w.side, top: Math.round(w.top), h: Math.round(w.h) })), plats: W.plats.map(p => ({ y: Math.round(p.y), x1: Math.round(p.x1), x2: Math.round(p.x2), spans: p.spans.map(s => s.map(Math.round)) })), floor: W.floor.spans.map(s => s.map(Math.round)), logo: W.logo && W.logo.spans }),
    force: k => force(k === 'power' ? forcePower : forceTrick),
    drop(h) {
      B.surf = W.floor; B.y = FLOOR - h; B.mode = 'free';
      const entryBounds = parachuteFrame();
      B.queue = [() => Object.assign(fall(0), { frameBounds: entryBounds, detailBounds: () => entryBounds })]; startNext();
    },   // стенд: падение с высоты h px
    launchParachute(h = 440) {
      const x = parachuteLaunchSite(h), launchScale = B.scale;
      if (x == null) return false;
      startCommand();
      const half = 220 * S * B.scale, bounds = [Math.max(0, Math.min(B.x, x) - half),
        Math.max(0, FLOOR - h - 200 * S * B.scale), Math.min(1280, Math.max(B.x, x) + half), FLOOR + 12];
      clearTransient(); B.scale = B.scaleT = launchScale; B.surf = W.floor; B.surfY = FLOOR;
      B.queue = [() => parachuteLaunch(h, bounds)];
      if (Math.abs(x - B.x) > 1.2) B.queue.unshift(() => Object.assign(walkTo(x, 'walk'), { frameBounds: bounds }));
      return startNext();
    },
    posed(o, cam, cset) { const P = pose(o); B.queue = [() => gest('posed', 1e9, cam == null ? .3 : cam, () => Object.assign(copy(P), { still: 1 }), { cset: cset || 0 })]; startNext(); },   // стенд: застывшая поза
    rescan, B, W, MAKE, LEVELS, leap, fall, jumpTo, begin, plan,
  };

  const deckSlideIdx = () => Math.max(0, slides.findIndex(s => s.classList.contains(presentation?.activeClass || 'on')));
  W.idx = -1;
  const observer = new MutationObserver(() => { worldDirty = true; const i = deckSlideIdx(); if (i !== W.idx) onSlide(i); });
  for (const slide of slides) observer.observe(slide, { subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'src'], childList: true, characterData: true });
  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => { worldDirty = true; invalidatePresentation(); });
  resizeObserver?.observe(deck);
  const viewNodes = new Map();
  function viewStamp(node) {
    const style = node.style || {}, transform = (style.transform || '').replace(/translate(?:3d|X|Y|Z)?\([^)]*\)/g, '');
    let scale = transform;
    try {
      const Matrix = globalThis.DOMMatrixReadOnly || globalThis.DOMMatrix, m = Matrix && new Matrix(transform || undefined);
      if (m) scale = Math.hypot(m.m11, m.m12, m.m13).toFixed(6) + ':' + Math.hypot(m.m21, m.m22, m.m23).toFixed(6);
    } catch { /* var()/проценты: пересчитываем реальную рамку при изменении строки. */ }
    let variables = '';
    for (let i = 0; i < (style.length || 0); i++) if (style[i].startsWith('--')) variables += style[i] + ':' + style.getPropertyValue(style[i]);
    return [scale, style.scale || '', style.zoom || '', node.getAttribute?.('class') || '', variables].join('|');
  }
  const viewObserver = new MutationObserver(records => {
    for (const { target } of records) {
      const stamp = viewStamp(target);
      if (stamp !== viewNodes.get(target)) { viewNodes.set(target, stamp); invalidatePresentation(); }
    }
  });
  for (let node = deck; node && node !== document; node = node.parentElement) {
    viewNodes.set(node, viewStamp(node)); viewObserver.observe(node, { attributes: true, attributeFilter: ['style', 'class'] });
  }
  const transitionEnded = event => {
    if (viewNodes.has(event.target) && (!event.propertyName || /transform|scale|zoom/.test(event.propertyName))) invalidatePresentation();
  };
  addEventListener('transitionend', transitionEnded); addEventListener('animationend', transitionEnded);
  let densityQuery = null;
  const densityChanged = () => {
    densityQuery?.removeEventListener('change', densityChanged);
    densityQuery = matchMedia('(resolution: ' + (globalThis.devicePixelRatio || 1) + 'dppx)');
    densityQuery.addEventListener('change', densityChanged); invalidatePresentation();
  };
  if (G3) densityChanged(); cleanups.push(() => densityQuery?.removeEventListener('change', densityChanged));
  const intersectionObserver = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
    visible = entries[0]?.isIntersecting !== false; cancelAnimationFrame(raf); raf = 0; last = performance.now(); schedule();
  });
  intersectionObserver?.observe(deck);
  W.idx = deckSlideIdx(); { const p = W.n > 1 ? W.idx / (W.n - 1) : SINGLE_PAGE_PROGRESS; W.progress = p; W.li = Math.max(0, LEVELS.findIndex(l => p <= l.upTo)); W.final = W.n > 1 && W.idx === W.n - 1 || !!(slides[W.idx] && slides[W.idx].querySelector('.tile.main,[data-buddy-fly]')); }
  rescan();
  const startupFloor = W.floor.spans[0];
  if (startupFloor) B.x = Math.min(startupFloor[1], startupFloor[0] + 52);
  B.y = FLOOR - lowY(STAND) * S;
  setTimeout(() => { rescan(); if (slides[W.idx]) MIND.scan(slides[W.idx]); }, 600);

  function staticPose() {
    B.mode = 'ground'; B.surf = W.floor; B.surfY = FLOOR; B.y = FLOOR - lowY(STAND) * S;
    B.cam = .35; B.yaw = .35 * PI / 2; B.act = idle(1e9); B.pose = pose({ hy: 12, smile: .6 });
    fig.draw(solve(B.pose, 1), B.yaw, B.pose, B.x, B.y, S, 0); render(solve(B.pose, 1), 0);
  }
  if (motion === 'system') {
    const changed = () => {
      REDUCED = motionQuery.matches; cancelAnimationFrame(raf); raf = 0;
      window.__buddy.reset(); last = performance.now(); schedule();
    };
    motionQuery.addEventListener('change', changed);
    cleanups.push(() => motionQuery.removeEventListener('change', changed));
  }
  const visibilityChanged = () => { cancelAnimationFrame(raf); raf = 0; last = performance.now(); schedule(); };
  document.addEventListener('visibilitychange', visibilityChanged);
  cleanups.push(() => document.removeEventListener('visibilitychange', visibilityChanged));
  // курсор — только для взгляда: координаты в px сцены
  addEventListener('pointermove', (e) => { if (REDUCED || MANUAL || !visible || !deck.contains(e.target)) return; const b = boxD(); MIND.cur = { x: (e.clientX - b.l) / b.k, y: (e.clientY - b.t) / b.k, t: W.time }; }, { passive: true });

  addEventListener('keydown', (e) => {   // B — трюк, N — суперспособность (по коду клавиши, раскладка не важна)
    if (!keyboard || REDUCED || !visible || e.metaKey || e.ctrlKey || e.altKey || e.repeat || MANUAL) return;
    const t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.code === KEYS.trick) force(forceTrick); else if (e.code === KEYS.power) force(forcePower);
    else if (e.code === KEYS.climb) force(forceClimb); else if (e.code === KEYS.magnet && powerEnabled('magnet')) force(forceMagnet);
  });
  function tick(now) {
    raf = 0;
    const dt = Math.min(maxFrameDt, Math.max(0, (now - last) / 1000)); last = now;
    if (!MANUAL && !document.hidden && visible && dt > 0) {
      const t0 = performance.now(); frame(dt); const cost = performance.now() - t0;
      frameCost += cost; framePeak = Math.max(framePeak, cost); frameCount++;
    }
    schedule();
  }
  function schedule() {
    if (destroyed || runtimePaused || REDUCED || document.hidden || !visible || raf) return;
    raf = requestAnimationFrame(tick);
  }
  function propsClear() {
    if (G3) for (const name of P3.keys()) G3.rig.prop(name, null);
    P3.clear();
    if (G3) G3.rig.propsOn(false);
  }
  function dispose3d() {
    if (!G3) return;
    const geometries = new Set(), materials = new Set(), textures = new Set(), skeletons = new Set(), disposed = new Set(),
      texture = value => { for (const t of [].concat(value || [])) if (t?.isTexture) textures.add(t); },
      observed = event => disposed.add(event.target);
    G3.scene.traverse(o => {
      if (o.geometry) geometries.add(o.geometry);
      if (o.material) for (const m of [].concat(o.material)) materials.add(m);
      if (o.skeleton) { skeletons.add(o.skeleton); texture(o.skeleton.boneTexture); }
    });
    for (const m of materials) {
      for (const value of Object.values(m)) texture(value);
      for (const uniform of Object.values(m.uniforms || {})) texture(uniform.value);
    }
    // Реквизит освобождает собственные панели через material.dispose: наблюдаем, чтобы не повторять dispose.
    for (const t of textures) t.addEventListener('dispose', observed);
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    for (const skeleton of skeletons) {
      if (disposed.has(skeleton.boneTexture)) skeleton.boneTexture = null;
      skeleton.dispose();
    }
    for (const t of textures) {
      if (!disposed.has(t)) t.dispose();
      t.removeEventListener('dispose', observed);
    }
    // Поздний GLB всё ещё проходит очистку scene выше. Сам renderer и его
    // приватный контекст закрываются один раз, даже если экземпляр сохранён.
    if (!G3.rendererDisposed) {
      G3.rendererDisposed = true;
      G3.ren.dispose();
      const context = G3.ren.getContext();
      if (destroyed && G3.ren.domElement === G3.cv && context.canvas === G3.cv) G3.ren.forceContextLoss?.();
    }
  }
  REDUCED ? staticPose() : begin(idle(1.2));
  schedule();
  return window.__buddy;
}
