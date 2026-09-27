// Puppy Adventures — a 3D island game designed by the Beach Crew (voice memo, 2026-09-24), built by Claude.
// Their rules: a puppy adventure · three-dimensional · birds are the baddies · no blood · no bad words ·
// ice cream cones for health · pizza for lunch · "take you away when you die" · puppy love.
import * as THREE from "./vendor/three/three.module.js";

// ───────────────────────── helpers ─────────────────────────
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a), pick = (a) => a[Math.floor(Math.random() * a.length)], chance = (p) => Math.random() < p;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, t) => a + (b - a) * t, approach = (v, t, s) => (v < t ? Math.min(v + s, t) : Math.max(v - s, t));
const $ = (s) => document.querySelector(s);
const SEED = new URLSearchParams(location.search).get("seed");
if (SEED) { let s = ((parseInt(SEED, 10) || 1) >>> 0); Math.random = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }  // mulberry32
const ISLAND_R = 33, WALK_R = 37, LUNCHES_TO_WIN = 3, PIZZAS_PER_LUNCH = 8;
const BEST_KEY = "puppy-adventures-best";
const getBest = () => { try { return parseInt(localStorage.getItem(BEST_KEY) || "0", 10) || 0; } catch (e) { return 0; } };
const setBest = (s) => { try { localStorage.setItem(BEST_KEY, String(s)); } catch (e) {} };
window.__puppy = { frames: 0, ready: false, gl: false, mode: "title", error: null };   // what tests/check.py reads
function fail(e) { const m = (e && e.stack) || String(e); if (!window.__puppy.error) window.__puppy.error = m; console.error("[puppy]", e); const el = $("#err"); el.textContent = "Uh oh — the game hit a bug. Tell Uncle Cory:\n" + m.split("\n").slice(0, 4).join("\n"); el.style.display = "block"; }
window.addEventListener("error", (ev) => fail(ev.error || ev.message));
window.addEventListener("unhandledrejection", (ev) => fail(ev.reason));

// ───────────────────────── sound: a tiny synth, no files ─────────────────────────
const Sfx = (() => {
  let ac = null;
  const ctx = () => { if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; } } if (ac && ac.state === "suspended") ac.resume().catch(() => {}); return ac; };
  function tone(f0, f1, dur, type = "square", gain = 0.1, when = 0) {
    const c = ctx(); if (!c) return; const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + when;
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, gain = 0.08, when = 0, hp = 800) {
    const c = ctx(); if (!c) return; const n = Math.floor(c.sampleRate * dur), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = c.createBufferSource(); s.buffer = b; const f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = hp; const g = c.createGain(); g.gain.value = gain;
    s.connect(f).connect(g).connect(c.destination); s.start(c.currentTime + when);
  }
  return {
    unlock: ctx,
    jump: () => tone(320, 720, 0.14, "square", 0.07),
    coin: () => { tone(880, 880, 0.07, "sine", 0.1); tone(1320, 1320, 0.12, "sine", 0.1, 0.07); },
    hit: () => { tone(220, 60, 0.28, "sawtooth", 0.1); noise(0.15, 0.07); },
    bark: () => { tone(190, 95, 0.09, "square", 0.13); tone(170, 80, 0.1, "square", 0.13, 0.11); },
    powerup: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.12, "triangle", 0.1, i * 0.08)),
    win: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, f * 1.01, 0.24, "triangle", 0.12, i * 0.13)),
    lose: () => [440, 392, 330, 262].forEach((f, i) => tone(f, f * 0.98, 0.3, "sine", 0.09, i * 0.22)),
    tick: () => tone(1400, 1400, 0.04, "sine", 0.05),
    swoop: () => tone(900, 300, 0.35, "sawtooth", 0.035),
    splash: () => noise(0.3, 0.09, 0, 400),
    boop: () => tone(400, 900, 0.12, "sine", 0.11),
    select: () => tone(660, 990, 0.08, "square", 0.05),
  };
})();

// ───────────────────────── input: keyboard + a thumb joystick + two buttons ─────────────────────────
const Input = (() => {
  const down = new Set(), just = new Set();
  const map = { ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right", ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down",
    Space: "jump", KeyZ: "jump", KeyJ: "jump", KeyX: "bark", ShiftLeft: "bark", ShiftRight: "bark", KeyK: "bark", KeyB: "bark", Enter: "start" };
  window.addEventListener("keydown", (e) => { const n = map[e.code]; if (!n) return; e.preventDefault(); if (!down.has(n)) just.add(n); down.add(n); Sfx.unlock(); });
  window.addEventListener("keyup", (e) => { const n = map[e.code]; if (n) down.delete(n); });
  window.addEventListener("blur", () => down.clear());
  const stick = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0 };
  const zone = $("#stick-zone"), base = $("#stick"), knob = $("#knob");
  zone.addEventListener("pointerdown", (e) => {
    if (stick.active) return; stick.active = true; stick.id = e.pointerId; stick.ox = e.clientX; stick.oy = e.clientY; stick.x = stick.y = 0;
    try { zone.setPointerCapture(e.pointerId); } catch (err) {}
    base.style.left = e.clientX + "px"; base.style.top = e.clientY + "px"; base.classList.add("on"); knob.style.transform = "translate(0,0)"; Sfx.unlock(); e.preventDefault();
  });
  zone.addEventListener("pointermove", (e) => {
    if (!stick.active || e.pointerId !== stick.id) return;
    let dx = e.clientX - stick.ox, dy = e.clientY - stick.oy; const d = Math.hypot(dx, dy), R = 54;
    if (d > R) { dx *= R / d; dy *= R / d; }
    stick.x = dx / R; stick.y = dy / R; knob.style.transform = `translate(${dx}px,${dy}px)`;
  });
  const end = (e) => { if (e.pointerId !== stick.id) return; stick.active = false; stick.id = null; stick.x = stick.y = 0; base.classList.remove("on"); };
  zone.addEventListener("pointerup", end); zone.addEventListener("pointercancel", end); zone.addEventListener("lostpointercapture", end);
  for (const [sel, name] of [["#btn-jump", "jump"], ["#btn-bark", "bark"]]) {
    const b = $(sel);
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (err) {} b.classList.add("down"); if (!down.has(name)) just.add(name); down.add(name); Sfx.unlock(); });
    const up = () => { b.classList.remove("down"); down.delete(name); };
    b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up); b.addEventListener("lostpointercapture", up);
  }
  const isTouch = matchMedia("(pointer: coarse)").matches || "ontouchstart" in window || navigator.maxTouchPoints > 0;
  if (isTouch) document.body.classList.add("touch");
  return {
    isTouch,
    axis() { if (stick.active && Math.hypot(stick.x, stick.y) > 0.08) return { x: stick.x, y: stick.y }; return { x: (down.has("right") ? 1 : 0) - (down.has("left") ? 1 : 0), y: (down.has("down") ? 1 : 0) - (down.has("up") ? 1 : 0) }; },
    pressed: (n) => just.has(n), held: (n) => down.has(n), tick: () => just.clear(),
  };
})();

// ───────────────────────── the world ─────────────────────────
const glCanvas = $("#gl");
let renderer = null;
try { renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, powerPreference: "high-performance" }); renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5)); window.__puppy.gl = true; }
catch (e) { renderer = null; console.warn("[puppy] WebGL unavailable", e); }
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fd3ff); scene.fog = new THREE.Fog(0x8fd3ff, 60, 140);
const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 400);
scene.add(new THREE.HemisphereLight(0xffffff, 0x5aa83c, 1.9));
const sun = new THREE.DirectionalLight(0xfff1cf, 2.2); sun.position.set(25, 45, 15); scene.add(sun);

const mat = (color, extra) => new THREE.MeshLambertMaterial(Object.assign({ color }, extra || {}));
const box = (w, h, d, color) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
const ball = (r, color, seg = 10) => new THREE.Mesh(new THREE.SphereGeometry(r, seg, seg), mat(color));
const blobGeo = new THREE.CircleGeometry(1, 16), blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false });
function blob(r) { const m = new THREE.Mesh(blobGeo, blobMat); m.rotation.x = -Math.PI / 2; m.scale.set(r, r, 1); m.position.y = 0.02; scene.add(m); return m; }

const water = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), mat(0x38a3e6)); water.rotation.x = -Math.PI / 2; water.position.y = -0.08; scene.add(water);
const foam = new THREE.Mesh(new THREE.RingGeometry(WALK_R + 2.2, WALK_R + 3.4, 64), new THREE.MeshBasicMaterial({ color: 0xe8f7ff, transparent: true, opacity: 0.7 })); foam.rotation.x = -Math.PI / 2; foam.position.y = -0.05; scene.add(foam);
const sand = new THREE.Mesh(new THREE.CircleGeometry(WALK_R + 2.5, 64), mat(0xf6e2aa)); sand.rotation.x = -Math.PI / 2; sand.position.y = -0.03; scene.add(sand);
const grass = new THREE.Mesh(new THREE.CircleGeometry(ISLAND_R, 64), mat(0x6cc04a)); grass.rotation.x = -Math.PI / 2; scene.add(grass);
const sunBall = new THREE.Mesh(new THREE.SphereGeometry(6, 12, 12), new THREE.MeshBasicMaterial({ color: 0xfff3a0, fog: false })); sunBall.position.set(-70, 60, -110); scene.add(sunBall);
const clouds = [];
for (let i = 0; i < 7; i++) {
  const g = new THREE.Group(), cm = new THREE.MeshLambertMaterial({ color: 0xffffff });
  for (let j = 0; j < 4; j++) { const p = new THREE.Mesh(new THREE.SphereGeometry(rand(1.6, 3), 8, 8), cm); p.position.set(j * 2.2 - 3.3, rand(-0.4, 0.6), rand(-0.8, 0.8)); g.add(p); }
  g.userData = { ang: rand(0, TAU), rad: rand(45, 80), h: rand(16, 28), spd: rand(0.015, 0.03) }; scene.add(g); clouds.push(g);
}

const obstacles = [];
function palm(x, z, s = 1) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rand(0, TAU);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * s, 0.34 * s, 4.4 * s, 7), mat(0xa9713e)); trunk.position.set(0.25 * s, 2.2 * s, 0); trunk.rotation.z = -0.11; g.add(trunk);
  const top = new THREE.Group(); top.position.set(0.5 * s, 4.35 * s, 0); g.add(top);
  for (let i = 0; i < 6; i++) { const pv = new THREE.Group(); pv.rotation.y = i * TAU / 6; const f = box(2.6 * s, 0.09, 0.7 * s, i % 2 ? 0x2f9e44 : 0x3cb54a); f.position.x = 1.2 * s; f.rotation.z = -0.5; pv.add(f); top.add(pv); }
  for (let i = 0; i < 3; i++) { const c = ball(0.22 * s, 0x6b4a2b, 6); c.position.set(Math.cos(i * 2.1) * 0.3, -0.25, Math.sin(i * 2.1) * 0.3); top.add(c); }
  scene.add(g); obstacles.push({ x, z, r: 0.55 * s });
}
function bush(x, z, r, color) { const b = ball(r, color, 9); b.position.set(x, r * 0.65, z); b.scale.y = 0.8; scene.add(b); obstacles.push({ x, z, r: r * 0.9 }); }
function rock(x, z, r) { const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), mat(0x9aa7ad)); m.position.set(x, r * 0.55, z); m.scale.y = 0.7; m.rotation.set(rand(0, 1), rand(0, 3), 0); scene.add(m); obstacles.push({ x, z, r: r * 0.95 }); }
function umbrella(x, z, color) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), mat(0xeeeeee)); pole.position.y = 1.3; g.add(pole);
  const top = new THREE.Mesh(new THREE.ConeGeometry(1.6, 0.8, 8), mat(color)); top.position.y = 2.6; g.add(top);
  const trim = new THREE.Mesh(new THREE.ConeGeometry(1.62, 0.3, 8), mat(0xffffff)); trim.position.y = 2.35; g.add(trim);
  scene.add(g); obstacles.push({ x, z, r: 0.2 });
}
function doghouse(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const body = box(2.6, 1.9, 2.4, 0xd9483a); body.position.y = 0.95; g.add(body);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1.3, 4), mat(0x7a2f26)); roof.position.y = 2.5; roof.rotation.y = Math.PI / 4; g.add(roof);
  const door = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.2, 12), mat(0x3b1f1a)); door.rotation.x = Math.PI / 2; door.position.set(0, 0.7, 1.25); g.add(door);
  const step = box(1.8, 0.12, 0.6, 0xf6e2aa); step.position.set(0, 0.06, 1.55); g.add(step);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.35, 0.22, 12), mat(0x3d8bfd)); bowl.position.set(1.9, 0.11, 1.4); g.add(bowl);
  scene.add(g); obstacles.push({ x, z, r: 1.8 });
}
doghouse(0, -7);
[[-10, -12, 1.2], [12, -14, 1], [-16, 4, 1.1], [17, 6, 1.3], [-6, 18, 1], [8, 20, 1.15], [22, -4, 0.9], [-22, -6, 1], [3, -24, 1.1], [-13, 24, 0.95], [25, 14, 1], [-26, 12, 1.05]].forEach(([x, z, s]) => palm(x, z, s));
[[-5, -14, 1.1, 0x3fae4c], [6, -2, 0.9, 0x36a34a], [-12, 10, 1.2, 0x3fae4c], [14, 12, 1, 0x2f9e44], [-20, -16, 1, 0x36a34a], [20, -20, 1.1, 0x3fae4c], [0, 26, 1.3, 0x2f9e44], [-27, 0, 1, 0x36a34a]].forEach(([x, z, r, c]) => bush(x, z, r, c));
[[9, 6, 1.1], [-8, -4, 0.9], [-18, -24, 1.4], [16, 24, 1.2], [26, -12, 1], [-3, 12, 0.8]].forEach(([x, z, r]) => rock(x, z, r));
[[30, 8, 0xff5f6d], [-30, -10, 0xffd23f], [6, 32, 0x2ec4b6], [-14, -31, 0xff9f1c]].forEach(([x, z, c]) => umbrella(x, z, c));
for (let i = 0; i < 28; i++) { const a = rand(0, TAU), r = rand(3, 30); const f = ball(0.16, pick([0xff6b8a, 0xffd23f, 0xffffff, 0xb388ff]), 6); f.position.set(Math.cos(a) * r, 0.25, Math.sin(a) * r); scene.add(f); const st = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 4), mat(0x2f9e44)); st.position.set(f.position.x, 0.12, f.position.z); scene.add(st); }

function makePup(P) {
  const g = new THREE.Group(), mats = [];
  const add = (m) => { g.add(m); m.traverse((o) => { if (o.material) mats.push(o.material); }); return m; };
  const body = add(box(1.15, 0.62, 0.6, P.fur)); body.position.y = 0.72;
  const tummy = add(box(1.05, 0.22, 0.64, P.light)); tummy.position.y = 0.5;
  const head = add(box(0.6, 0.58, 0.6, P.fur)); head.position.set(0.72, 1.14, 0);
  const snout = add(box(0.34, 0.28, 0.36, P.light)); snout.position.set(1.06, 1.0, 0);
  const nose = add(ball(0.09, 0x222222, 6)); nose.position.set(1.24, 1.07, 0);
  for (const s of [-1, 1]) {
    const eyeW = add(ball(0.095, 0xffffff, 6)); eyeW.position.set(1.0, 1.26, 0.19 * s);
    const eye = add(ball(0.05, 0x111111, 6)); eye.position.set(1.08, 1.27, 0.2 * s);
    const ear = add(box(0.22, 0.44, 0.12, P.ear)); ear.position.set(0.62, 1.06, 0.35 * s); ear.rotation.x = 0.28 * s;
  }
  const collar = add(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.12, 12), mat(P.collar))); collar.rotation.z = Math.PI / 2; collar.position.set(0.44, 0.92, 0);
  const tag = add(ball(0.08, 0xffd23f, 6)); tag.position.set(0.5, 0.68, 0);
  const tailPivot = new THREE.Group(); tailPivot.position.set(-0.58, 0.95, 0); tailPivot.rotation.z = 0.8;
  const tail = box(0.5, 0.12, 0.12, P.fur); tail.position.x = -0.25; tailPivot.add(tail); add(tailPivot);
  const legs = [];
  for (const [lx, lz] of [[0.4, 0.2], [0.4, -0.2], [-0.4, 0.2], [-0.4, -0.2]]) {
    const pv = new THREE.Group(); pv.position.set(lx, 0.46, lz);
    const leg = box(0.2, 0.46, 0.2, P.fur); leg.position.y = -0.2; pv.add(leg);
    const paw = box(0.24, 0.1, 0.22, P.light); paw.position.set(0.03, -0.42, 0); pv.add(paw);
    add(pv); legs.push(pv);
  }
  if (P.bow) { for (const s of [-1, 1]) { const b = add(box(0.24, 0.2, 0.14, P.bow)); b.position.set(0.6, 1.5, 0.15 * s); b.rotation.x = 0.5 * s; } const knot = add(ball(0.08, P.bow, 6)); knot.position.set(0.6, 1.5, 0); }
  g.userData = { tailPivot, legs, head, mats }; scene.add(g); return g;
}
const PUPPY = { fur: 0xe2a75a, light: 0xf7dfae, ear: 0x8a5a2b, collar: 0xe63946 };
const POPPY = { fur: 0xf7b7c8, light: 0xfff0f4, ear: 0xd98aa3, collar: 0x7c3aed, bow: 0xff3d8a };

function makeBird(color) {
  const g = new THREE.Group();
  const body = ball(0.36, color, 8); body.scale.set(1, 0.75, 1.5); g.add(body);
  const head = ball(0.22, color, 8); head.position.set(0, 0.2, 0.55); g.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.34, 6), mat(0xff9f1c)); beak.rotation.x = Math.PI / 2; beak.position.set(0, 0.18, 0.84); g.add(beak);
  for (const s of [-1, 1]) { const eye = ball(0.05, 0x111111, 5); eye.position.set(0.12 * s, 0.3, 0.68); g.add(eye); }
  const wings = [];
  for (const s of [-1, 1]) { const pv = new THREE.Group(); pv.position.set(0.15 * s, 0.12, 0); const w = box(1.3, 0.06, 0.55, color); w.position.x = 0.65 * s; const tip = box(0.4, 0.06, 0.45, 0x5d6d7e); tip.position.x = 1.35 * s; pv.add(w, tip); g.add(pv); wings.push({ pv, s }); }
  const tail = box(0.3, 0.05, 0.45, 0x8a9bab); tail.position.set(0, 0.05, -0.68); g.add(tail);
  g.userData.wings = wings; scene.add(g); return g;
}

const texCache = {};
function emojiSprite(ch, size, add = true) {
  if (!texCache[ch]) {
    const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d");
    x.font = "100px 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', system-ui, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(ch, 64, 72);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearFilter; texCache[ch] = t;
  }
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: texCache[ch], transparent: true, depthWrite: false })); sp.scale.set(size, size, 1); if (add) scene.add(sp); return sp;
}

// ───────────────────────── fx: 3D confetti + floating words ─────────────────────────
const _v = new THREE.Vector3();
function project(x, y, z) { _v.set(x, y, z).project(camera); return { x: (_v.x + 1) / 2 * window.innerWidth, y: (1 - _v.y) / 2 * window.innerHeight, front: _v.z < 1 }; }
const popsEl = $("#pops");
function pop(text, x, y, z, cls = "") { const s = project(x, y, z); if (!s.front) return; const p = document.createElement("div"); p.className = "pop " + cls; p.textContent = text; p.style.left = s.x + "px"; p.style.top = s.y + "px"; popsEl.appendChild(p); setTimeout(() => p.remove(), 1000); }
const FX = (() => {
  const pool = [], geo = new THREE.BoxGeometry(0.16, 0.16, 0.16), mats = {};
  const cm = (c) => mats[c] || (mats[c] = new THREE.MeshBasicMaterial({ color: c }));
  function burst(x, y, z, o = {}) {
    if (pool.length > 260) return;
    for (let i = 0; i < (o.count || 12); i++) {
      let m; if (o.emoji) m = emojiSprite(o.emoji, o.size || 0.75, false); else { m = new THREE.Mesh(geo, cm(pick(o.colors || [0xffffff]))); m.scale.setScalar(rand(0.6, 1.4)); }
      m.position.set(x, y, z); const a = rand(0, TAU), sp = (o.speed || 6) * rand(0.35, 1);
      m.userData = { v: new THREE.Vector3(Math.cos(a) * sp, rand(o.upMin ?? 3, o.upMax ?? 7), Math.sin(a) * sp), life: o.life || 0.8, max: o.life || 0.8, g: o.gravity ?? 16, spin: rand(-7, 7), s0: m.scale.x };
      scene.add(m); pool.push(m);
    }
  }
  function tick(dt) {
    for (let i = pool.length - 1; i >= 0; i--) {
      const m = pool[i], u = m.userData; u.life -= dt;
      if (u.life <= 0) { scene.remove(m); if (m.isSprite) m.material.dispose(); pool.splice(i, 1); continue; }
      u.v.y -= u.g * dt; m.position.addScaledVector(u.v, dt); const k = clamp(u.life / u.max, 0, 1);
      if (m.isSprite) m.material.opacity = k; else { m.rotation.x += u.spin * dt; m.rotation.y += u.spin * dt; m.scale.setScalar(u.s0 * (0.3 + 0.7 * k)); }
    }
  }
  return { burst, tick };
})();
let shakeT = 0, shakeAmt = 0;
function shake(a = 0.25, t = 0.3) { shakeAmt = Math.max(shakeAmt, a); shakeT = Math.max(shakeT, t); }

// ───────────────────────── game state ─────────────────────────
const pup = { g: makePup(PUPPY), x: 0, z: 4, y: 0, vx: 0, vz: 0, vy: 0, face: -Math.PI / 2, phase: 0, shadow: blob(0.75), wet: false };
const G = { mode: "title", t: 0, hearts: 3, score: 0, lunch: 1, pizzas: [], birds: [], cones: [], rings: [], coneT: 6, barkCd: 0, invuln: 0, flash: 0, aggro: 0, carry: null, carryT: 0, poppy: null, winT: 0, overT: 0 };
const camGoal = new THREE.Vector3(0, 6, 14), camLook = new THREE.Vector3(0, 1, 0);

const msgEl = $("#msg"); let msgTimer = 0;
function say(text) { msgEl.textContent = text; msgEl.classList.add("show"); clearTimeout(msgTimer); msgTimer = setTimeout(() => msgEl.classList.remove("show"), 2600); }
function randSpot(minR, maxR, clearOf = 2.5) {
  for (let tries = 0; tries < 40; tries++) {
    const a = rand(0, TAU), r = rand(minR, maxR), x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x - pup.x, z - pup.z) < 4) continue;
    if (obstacles.some((o) => Math.hypot(x - o.x, z - o.z) < o.r + clearOf)) continue;
    if (G.pizzas.some((p) => Math.hypot(x - p.x, z - p.z) < 4)) continue;
    return { x, z };
  }
  return { x: rand(-20, 20), z: rand(-20, 20) };
}
function spawnPizzas() { for (let i = 0; i < PIZZAS_PER_LUNCH; i++) { const s = randSpot(3, ISLAND_R - 3); G.pizzas.push({ x: s.x, z: s.z, sp: emojiSprite("🍕", 1.5), sh: blob(0.45), ph: rand(0, TAU) }); } }
function spawnCone() { const s = randSpot(3, ISLAND_R - 3); G.cones.push({ x: s.x, z: s.z, sp: emojiSprite("🍦", 1.5), sh: blob(0.4), ph: 0, life: 14 }); say("🍦 Ice cream! Eat it to heal!"); }
function spawnBird() {
  const b = { g: makeBird(pick([0xf8f9fa, 0xf8f9fa, 0xd8e2ea, 0x9c7b62])), st: "circle", ang: rand(0, TAU), rad: rand(9, 26), h: rand(6, 10), dir: chance(0.5) ? 1 : -1, spd: rand(0.32, 0.55), timer: rand(2.5, 6), x: 0, y: 8, z: 0, vx: 0, vy: 0, vz: 0, tx: 0, tz: 0, flap: rand(0, TAU), shadow: blob(0.6) };
  b.x = Math.cos(b.ang) * b.rad; b.z = Math.sin(b.ang) * b.rad; b.y = b.h; G.birds.push(b);
}
function removeAll(list) { for (const e of list) for (const k of ["g", "sp", "sh", "shadow"]) if (e[k]) scene.remove(e[k]); list.length = 0; }
function resetWorld() {
  removeAll(G.pizzas); removeAll(G.birds); removeAll(G.cones); removeAll(G.rings);
  if (G.poppy) { scene.remove(G.poppy.g); scene.remove(G.poppy.shadow); G.poppy = null; }
  if (G.carry) { scene.remove(G.carry.g); G.carry = null; }
  Object.assign(G, { t: 0, hearts: 3, score: 0, lunch: 1, coneT: 6, barkCd: 0, invuln: 0, flash: 0, aggro: 0, winT: 0, carryT: 0 });
  Object.assign(pup, { x: 0, z: 4, y: 0, vx: 0, vz: 0, vy: 0, face: -Math.PI / 2, wet: false }); pup.g.visible = true; pup.g.rotation.set(0, pup.face, 0);
  for (let i = 0; i < 3; i++) spawnBird();
  spawnPizzas();
}
resetWorld();

// ───────────────────────── screens ─────────────────────────
const hud = $("#hud"), titleEl = $("#title"), overEl = $("#over"), hintEl = $("#hint");
function setMode(m) { G.mode = m; window.__puppy.mode = m; document.body.classList.toggle("playing", m === "play" || m === "carried" || m === "win"); }
function startGame() {
  resetWorld(); setMode("play"); Sfx.select();
  titleEl.classList.add("hide"); overEl.classList.add("hide"); hud.classList.remove("hide");
  camera.position.set(pup.x, 7.2, pup.z + 10.5);
  hintEl.textContent = Input.isTouch ? "🕹️ left thumb: run · JUMP · BARK!" : "arrows / WASD: run · Space: jump · X: BARK!"; hintEl.classList.remove("hide");
  say("Eat all the pizza! Watch out for the birds!");
}
function showOver(won, title, message) {
  setMode("over"); G.overT = 0; const best = Math.max(getBest(), G.score); setBest(best);
  $("#over-emoji").textContent = won ? "💕" : "💤"; const h = $("#over-title"); h.textContent = title; h.className = won ? "love" : "nap";
  $("#over-msg").textContent = message; $("#over-score").textContent = G.score; $("#over-best").textContent = `best ${best}${G.score >= best && G.score > 0 ? " · 🏆 NEW BEST!" : ""}`;
  $("#title-best").textContent = best; hud.classList.add("hide"); hintEl.classList.add("hide"); overEl.classList.remove("hide");
}
$("#title-best").textContent = getBest();
if (/\/games\/[^/]+\/?$/.test(location.pathname)) for (const a of document.querySelectorAll(".hub-link")) { a.classList.remove("hide"); a.addEventListener("click", (e) => e.stopPropagation()); a.addEventListener("pointerdown", (e) => e.stopPropagation()); }
$("#play").addEventListener("click", (e) => { e.stopPropagation(); startGame(); });
titleEl.addEventListener("click", startGame);
$("#again").addEventListener("click", (e) => { e.stopPropagation(); if (G.overT > 0.5) startGame(); });
overEl.addEventListener("click", () => { if (G.overT > 0.5) startGame(); });
document.addEventListener("visibilitychange", () => { paused = document.hidden; });

// ───────────────────────── gameplay ─────────────────────────
function hurt(b) {
  G.hearts--; G.invuln = 1.6; G.flash = 1; shake(0.35, 0.3); Sfx.hit();
  const away = Math.atan2(pup.z - b.z, pup.x - b.x); pup.vx = Math.cos(away) * 9; pup.vz = Math.sin(away) * 9; pup.vy = Math.max(pup.vy, 4);
  pop("OUCH!", pup.x, pup.y + 1.8, pup.z, "red"); FX.burst(pup.x, pup.y + 1, pup.z, { count: 10, colors: [0xffffff, 0xfde68a], speed: 5 });
  b.st = "flee"; b.timer = 1.4; b.vx = -Math.cos(away) * 6; b.vz = -Math.sin(away) * 6; b.vy = 7;
  const hs = $("#hearts").children; if (hs[G.hearts]) { hs[G.hearts].classList.add("lost"); }
  if (G.hearts <= 0) startCarry();
}
function boop(b) {
  G.score += 25; Sfx.boop(); b.st = "flee"; b.timer = 1.6; b.vy = 9; b.vx = (b.x - pup.x) * 3; b.vz = (b.z - pup.z) * 3;
  pop("BOOP! +25", b.x, b.y + 0.8, b.z, "gold"); FX.burst(b.x, b.y, b.z, { count: 14, colors: [0xfde68a, 0xffffff, 0x93c5fd], speed: 7 });
  pup.vy = 6;
}
function startCarry() {
  setMode("carried"); G.carryT = 0; Sfx.lose();
  const c = { g: makeBird(0xffffff), x: pup.x + 6, y: pup.y + 10, z: pup.z - 4, flap: 0 }; c.g.scale.setScalar(1.7); G.carry = c;
  say("Whoops! A friendly birdie is taking Puppy home for a nap…");
}
function bark() {
  G.barkCd = 0.75; Sfx.bark();
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.85, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(pup.x, 0.4, pup.z); scene.add(ring); G.rings.push({ g: ring, life: 0.45 });
  pop("BARK!", pup.x + Math.cos(pup.face) * 0.9, pup.y + 1.9, pup.z - Math.sin(pup.face) * 0.9, "gold");
  let scared = 0;
  for (const b of G.birds) {
    const d = Math.hypot(b.x - pup.x, b.y - pup.y - 1, b.z - pup.z);
    if (d < 7.5 && b.st !== "flee") { if (b.st === "dive" || b.st === "aim") { scared++; G.score += 5; } const a = Math.atan2(b.z - pup.z, b.x - pup.x); b.st = "flee"; b.timer = 1.5; b.vx = Math.cos(a) * 7; b.vz = Math.sin(a) * 7; b.vy = 7; }
  }
  if (scared) pop(`SCARED ${scared > 1 ? scared + " BIRDS" : "IT"} +${scared * 5}`, pup.x, pup.y + 2.8, pup.z, "mint");
}
function updateBirds(dt) {
  const alive = G.mode === "play";
  for (const b of G.birds) {
    if (b.st === "circle") {
      b.ang += b.dir * b.spd * dt; const tx = Math.cos(b.ang) * b.rad, tz = Math.sin(b.ang) * b.rad, ty = b.h + Math.sin(b.ang * 3) * 0.6;
      b.vx = (tx - b.x) * 6; b.vy = (ty - b.y) * 4; b.vz = (tz - b.z) * 6;
      if (alive) { b.timer -= dt * (1 + G.aggro); if (b.timer <= 0) { b.st = "aim"; b.timer = 0.7; Sfx.tick(); } }
    } else if (b.st === "aim") {
      b.vx *= 0.9; b.vz *= 0.9; b.vy = Math.sin(b.timer * 30) * 1.5; b.timer -= dt;
      if (Math.floor(b.timer * 10) % 3 === 0 && chance(0.5)) pop("!", b.x, b.y + 1.1, b.z, "red");
      if (b.timer <= 0) { b.st = "dive"; b.tx = pup.x + pup.vx * 0.45; b.tz = pup.z + pup.vz * 0.45; b.timer = 3; Sfx.swoop(); }
    } else if (b.st === "dive") {
      const dx = b.tx - b.x, dy = 0.9 - b.y, dz = b.tz - b.z, d = Math.hypot(dx, dy, dz), sp = 10.5 + G.aggro * 3;
      if (d < 0.6 || b.timer <= 0 || !alive) { b.st = "flee"; b.timer = 1.2; b.vy = 7; } else { b.vx = dx / d * sp; b.vy = dy / d * sp; b.vz = dz / d * sp; }
      b.timer -= dt;
      if (alive && G.invuln <= 0 && Math.hypot(b.x - pup.x, b.y - (pup.y + 0.8), b.z - pup.z) < 1.05) { if (pup.vy > 1.5 && pup.y > 0.3) boop(b); else hurt(b); }
    } else if (b.st === "flee") {
      b.vy = approach(b.vy, 3, 8 * dt); b.timer -= dt;
      if (b.timer <= 0) { b.st = "circle"; b.rad = clamp(Math.hypot(b.x, b.z), 8, 27); b.ang = Math.atan2(b.z, b.x); b.h = rand(6, 10); b.timer = rand(2.5, 6) / (1 + G.aggro * 0.6); }
    }
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    if (b.y < 0.7) b.y = 0.7; if (b.y > 16) b.y = 16;
    const r = Math.hypot(b.x, b.z); if (r > 42) { b.x *= 42 / r; b.z *= 42 / r; }
  }
}
function updatePup(dt) {
  const s = Input.axis(), len = Math.hypot(s.x, s.y);
  if (len > 0.06) { const n = Math.min(1, len); pup.vx = approach(pup.vx, s.x / len * 7 * n, 45 * dt); pup.vz = approach(pup.vz, s.y / len * 7 * n, 45 * dt); pup.face = Math.atan2(-s.y, s.x); }
  else { pup.vx = approach(pup.vx, 0, 30 * dt); pup.vz = approach(pup.vz, 0, 30 * dt); }
  if (Input.pressed("jump") && pup.y <= 0.001) { pup.vy = 8; Sfx.jump(); }
  if (Input.pressed("bark") && G.barkCd <= 0) bark();
  pup.vy -= 22 * dt; pup.y += pup.vy * dt; pup.x += pup.vx * dt; pup.z += pup.vz * dt;
  if (pup.y <= 0) { if (pup.vy < -6) FX.burst(pup.x, 0.1, pup.z, { count: 8, colors: [0xf6e2aa, 0xffffff], speed: 3, upMin: 1, upMax: 3, life: 0.45 }); pup.y = 0; pup.vy = 0; }
  for (const o of obstacles) { const dx = pup.x - o.x, dz = pup.z - o.z, d = Math.hypot(dx, dz), min = o.r + 0.5; if (d < min && d > 0.0001) { pup.x = o.x + dx / d * min; pup.z = o.z + dz / d * min; } }
  const r = Math.hypot(pup.x, pup.z);
  if (r > WALK_R) { pup.x *= WALK_R / r; pup.z *= WALK_R / r; if (!pup.wet) { pup.wet = true; Sfx.splash(); FX.burst(pup.x, 0.2, pup.z, { count: 12, colors: [0xbae6fd, 0xffffff], speed: 4, life: 0.5 }); pop("splash!", pup.x, 1.2, pup.z, "blue"); } } else if (r < WALK_R - 1.5) pup.wet = false;
  let diff = (pup.face - pup.g.rotation.y) % TAU; if (diff > Math.PI) diff -= TAU; if (diff < -Math.PI) diff += TAU;
  pup.g.rotation.y += diff * (1 - Math.exp(-dt * 14));
  if (G.invuln > 0) { G.invuln -= dt; pup.g.visible = Math.floor(G.invuln * 14) % 2 === 0; } else pup.g.visible = true;
}
function updatePickups(dt) {
  for (let i = G.pizzas.length - 1; i >= 0; i--) {
    const p = G.pizzas[i];
    if (Math.hypot(p.x - pup.x, p.z - pup.z) < 1.25 && pup.y < 1.6) {
      scene.remove(p.sp); scene.remove(p.sh); G.pizzas.splice(i, 1); G.score += 10; Sfx.coin();
      pop("+10", p.x, 1.6, p.z, "gold"); FX.burst(p.x, 1, p.z, { count: 12, colors: [0xffd23f, 0xff5f6d, 0xffffff], speed: 5 });
      if (G.pizzas.length === 0) lunchServed();
    }
  }
  for (let i = G.cones.length - 1; i >= 0; i--) {
    const c = G.cones[i]; c.life -= dt;
    if (Math.hypot(c.x - pup.x, c.z - pup.z) < 1.25 && pup.y < 1.6) {
      scene.remove(c.sp); scene.remove(c.sh); G.cones.splice(i, 1); G.hearts = Math.min(3, G.hearts + 1); G.score += 5; Sfx.powerup();
      pop("YUM! ❤️", c.x, 1.8, c.z, "pink"); FX.burst(c.x, 1, c.z, { count: 14, colors: [0xfbcfe8, 0xffffff, 0xf9a8d4], speed: 5 });
      const hs = $("#hearts").children; for (let k = 0; k < 3; k++) { hs[k].classList.toggle("lost", k >= G.hearts); } if (hs[G.hearts - 1]) { hs[G.hearts - 1].classList.remove("pulse"); void hs[G.hearts - 1].offsetWidth; hs[G.hearts - 1].classList.add("pulse"); }
    } else if (c.life <= 0) { scene.remove(c.sp); scene.remove(c.sh); G.cones.splice(i, 1); }
  }
  if (G.hearts < 3 && G.cones.length === 0) { G.coneT -= dt; if (G.coneT <= 0) { G.coneT = 9; spawnCone(); } }
  if (G.poppy && Math.hypot(G.poppy.x - pup.x, G.poppy.z - pup.z) < 1.6) winGame();
}
function lunchServed() {
  G.score += 50; Sfx.powerup(); shake(0.15, 0.2);
  pop(`LUNCH ${G.lunch} SERVED! +50`, pup.x, pup.y + 2.4, pup.z, "gold big");
  FX.burst(pup.x, pup.y + 1.5, pup.z, { count: 26, emoji: "🍕", speed: 7, upMin: 5, upMax: 10, life: 1.3, gravity: 12 });
  G.lunch++;
  if (G.lunch > LUNCHES_TO_WIN) {
    const P = { g: makePup(POPPY), x: 0, y: 0, z: -4.6, shadow: blob(0.75) }; P.g.rotation.y = -Math.PI / 2; G.poppy = P;
    say("Poppy is at the doghouse! Go say hi 💕"); G.aggro += 0.3;
  } else { spawnPizzas(); spawnBird(); spawnBird(); G.aggro += 0.35; say(`Lunch ${G.lunch}: more 🍕 and more birds!`); }
}
function winGame() {
  setMode("win"); G.winT = 0; const bonus = Math.max(0, Math.round((150 - G.t) * 2)); G.score += bonus; Sfx.win();
  FX.burst(0, 2.4, -3.5, { count: 40, emoji: "💕", speed: 6, upMin: 4, upMax: 9, life: 1.8, gravity: 4 });
  say(bonus ? `PUPPY LOVE! Speedy bonus +${bonus}` : "PUPPY LOVE!");
}

// ───────────────────────── update (fixed step) ─────────────────────────
function update(dt) {
  if (G.mode === "title") { updateBirds(dt); if (Input.pressed("jump") || Input.pressed("start")) startGame(); return; }
  if (G.mode === "over") { G.overT += dt; updateBirds(dt); if (G.overT > 0.5 && (Input.pressed("jump") || Input.pressed("start"))) startGame(); return; }
  G.t += dt; if (G.barkCd > 0) G.barkCd -= dt;
  if (G.mode === "play") { updatePup(dt); updateBirds(dt); updatePickups(dt); }
  else if (G.mode === "carried") {
    G.carryT += dt; const c = G.carry; updateBirds(dt);
    if (G.carryT < 1.1) { const k = 1 - Math.exp(-dt * 6); c.x = lerp(c.x, pup.x, k); c.y = lerp(c.y, pup.y + 2.0, k); c.z = lerp(c.z, pup.z, k); }
    else { c.x += 3.5 * dt; c.y += 3.2 * dt; c.z -= 2.5 * dt; pup.x = c.x; pup.y = c.y - 1.9; pup.z = c.z; pup.g.rotation.z = Math.sin(G.carryT * 5) * 0.25; pup.g.visible = true; }
    c.g.position.set(c.x, c.y, c.z); c.g.lookAt(c.x + 3.5, c.y + 1, c.z - 2.5); c.flap += dt * 12; for (const w of c.g.userData.wings) w.pv.rotation.z = Math.sin(c.flap) * 0.7 * w.s;
    if (G.carryT > 3.4) { pup.g.rotation.z = 0; showOver(false, "NAP TIME", "A friendly birdie carried Puppy home for a nap. Try again!"); }
  } else if (G.mode === "win") {
    G.winT += dt; pup.vx = pup.vz = 0; pup.y = Math.abs(Math.sin(G.winT * 6)) * 0.9; if (G.poppy) G.poppy.y = Math.abs(Math.sin(G.winT * 6 + 1)) * 0.9;
    pup.g.rotation.y += dt * 4; if (chance(0.08)) FX.burst(pup.x, 2.5, pup.z, { count: 4, emoji: "💕", speed: 3, upMin: 2, upMax: 5, life: 1.1, gravity: 2 });
    if (G.winT > 2.8) showOver(true, "PUPPY LOVE", "Puppy and Poppy had pizza for lunch! Play again?");
  }
}

// ───────────────────────── animate + render (every frame) ─────────────────────────
const hudCache = {};
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
function updateHud() {
  setText("#pizzas", String(G.pizzas.length)); setText("#lunch", G.poppy ? "💕 FIND POPPY!" : `LUNCH ${Math.min(G.lunch, LUNCHES_TO_WIN)} of ${LUNCHES_TO_WIN}`);
  setText("#score", String(G.score)); setText("#best", String(Math.max(getBest(), G.score)));
  const meter = $("#bark-meter"); meter.classList.toggle("on", G.barkCd > 0); meter.firstElementChild.style.width = `${clamp(1 - G.barkCd / 0.75, 0, 1) * 100}%`;
  if (G.t > 6 && !hintEl.classList.contains("hide")) hintEl.classList.add("hide");
  const hs = $("#hearts").children; for (let k = 0; k < 3; k++) hs[k].classList.toggle("lost", k >= G.hearts);
}
let fitW = 0, fitH = 0;
function fit() { const w = window.innerWidth, h = window.innerHeight; if (w !== fitW || h !== fitH) { fitW = w; fitH = h; if (renderer) renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); } }
function animate(dt) {
  const t = performance.now() / 1000, playing = G.mode === "play", portrait = window.innerHeight > window.innerWidth;
  for (const c of clouds) { const u = c.userData; u.ang += u.spd * dt; c.position.set(Math.cos(u.ang) * u.rad, u.h, Math.sin(u.ang) * u.rad); }
  water.position.y = -0.08 + Math.sin(t * 1.3) * 0.03; foam.material.opacity = 0.5 + Math.sin(t * 1.3) * 0.2;
  const u = pup.g.userData, speed = Math.hypot(pup.vx, pup.vz), runF = clamp(speed / 7, 0, 1);
  pup.phase += dt * (4 + speed * 2.2);
  u.tailPivot.rotation.y = Math.sin(t * (playing ? 12 : 9)) * (0.55 + 0.3 * runF);
  u.legs.forEach((pv, i) => { pv.rotation.z = pup.y > 0.05 ? (i < 2 ? -0.6 : 0.5) : Math.sin(pup.phase + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI : 0)) * 0.75 * runF; });
  u.head.rotation.z = playing ? Math.sin(pup.phase) * 0.05 * runF : Math.sin(t * 1.7) * 0.12;
  pup.g.position.set(pup.x, pup.y + Math.abs(Math.sin(pup.phase)) * 0.07 * runF, pup.z);
  pup.shadow.position.set(pup.x, 0.02, pup.z); const sh = clamp(1 - pup.y / 6, 0.35, 1); pup.shadow.scale.set(0.75 * sh, 0.75 * sh, 1);
  if (G.flash > 0) G.flash = Math.max(0, G.flash - dt * 3); for (const m of u.mats) if (m.emissive) m.emissive.setRGB(G.flash, G.flash * 0.15, G.flash * 0.2);
  for (const b of G.birds) {
    b.flap += dt * (b.st === "dive" ? 4 : b.st === "circle" ? 9 : 14);
    for (const w of b.g.userData.wings) w.pv.rotation.z = Math.sin(b.flap) * 0.65 * w.s;
    b.g.position.set(b.x, b.y, b.z);
    if (Math.hypot(b.vx, b.vy, b.vz) > 0.05) b.g.lookAt(b.x + b.vx, b.y + b.vy * 0.5, b.z + b.vz);
    b.shadow.position.set(b.x, 0.03, b.z); const k = clamp(1 - b.y / 14, 0.15, 0.7); b.shadow.scale.set(k, k, 1);
  }
  for (const p of G.pizzas) { p.ph += dt * 2; p.sp.position.set(p.x, 1.0 + Math.sin(p.ph) * 0.18, p.z); p.sp.material.rotation = Math.sin(p.ph * 0.7) * 0.25; p.sh.position.set(p.x, 0.02, p.z); }
  for (const c of G.cones) { c.ph += dt * 2.5; c.sp.position.set(c.x, 1.0 + Math.sin(c.ph) * 0.2, c.z); c.sh.position.set(c.x, 0.02, c.z); c.sp.visible = c.life > 3 || Math.floor(c.life * 6) % 2 === 0; }
  if (G.poppy) { const P = G.poppy; P.g.userData.tailPivot.rotation.y = Math.sin(t * 13) * 0.8; P.g.position.set(P.x, P.y, P.z); P.shadow.position.set(P.x, 0.02, P.z); }
  for (let i = G.rings.length - 1; i >= 0; i--) { const r = G.rings[i]; r.life -= dt; const s = 1 + (0.45 - Math.max(0, r.life)) * 16; r.g.scale.set(s, s, 1); r.g.material.opacity = Math.max(0, r.life / 0.45) * 0.85; if (r.life <= 0) { scene.remove(r.g); G.rings.splice(i, 1); } }
  // camera: behind Puppy while playing, a slow orbit on the title and game-over screens
  const back = portrait ? 15 : 10.5, up = portrait ? 10 : 7.2;
  if (playing || G.mode === "win") { camGoal.set(pup.x, up + pup.y * 0.3, pup.z + back); camLook.set(pup.x, pup.y * 0.5 + 0.9, pup.z); }
  else if (G.mode === "carried" && G.carry) { camGoal.set(pup.x + 4, pup.y + 3, pup.z + 12); camLook.set(pup.x, pup.y + 1, pup.z); }
  else { const a = t * 0.22, rr = portrait ? 12 : 9.5; camGoal.set(pup.x + Math.cos(a) * rr, portrait ? 6 : 4.2, pup.z + Math.sin(a) * rr); camLook.set(pup.x, 1.1, pup.z); }
  camera.position.lerp(camGoal, 1 - Math.exp(-dt * (playing ? 7 : 2.5)));
  if (shakeT > 0) { shakeT -= dt; camera.position.x += rand(-shakeAmt, shakeAmt); camera.position.y += rand(-shakeAmt, shakeAmt); if (shakeT <= 0) shakeAmt = 0; }
  camera.lookAt(camLook);
  if (G.mode !== "title" && G.mode !== "over") updateHud();
}

let last = 0, acc = 0, paused = false, driven = false; const STEP = 1 / 60;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(last ? (now - last) / 1000 : 0.016, 0.1); last = now; if (paused) dt = 0;
  acc += dt; let steps = 0;
  if (driven) acc = 0; else while (acc >= STEP && steps < 4) { try { update(STEP); } catch (e) { fail(e); } acc -= STEP; steps++; }
  if (steps) Input.tick();
  try { fit(); animate(dt); FX.tick(dt); if (renderer) renderer.render(scene, camera); } catch (e) { fail(e); }
  window.__puppy.frames++; window.__puppy.ready = true;
}
// ── test hooks (the arcade contract): a JSON snapshot of the game, and a deterministic step ──
function snapshot() {
  return { screen: G.mode, t: +G.t.toFixed(2), score: G.score, hearts: G.hearts, lunch: G.lunch, pizzasLeft: G.pizzas.length, cones: G.cones.length, poppy: !!G.poppy,
    puppy: { x: +pup.x.toFixed(2), y: +pup.y.toFixed(2), z: +pup.z.toFixed(2) }, birds: G.birds.map((b) => ({ st: b.st, x: +b.x.toFixed(1), y: +b.y.toFixed(1), z: +b.z.toFixed(1) })), error: window.__puppy.error };
}
window.render_game_to_text = () => JSON.stringify(snapshot());
window.advanceTime = (ms) => {
  driven = true; const n = Math.max(1, Math.round((ms / 1000) / STEP));
  for (let i = 0; i < n; i++) { try { update(STEP); } catch (e) { fail(e); } if (i === 0) Input.tick(); }
  try { fit(); animate(n * STEP); FX.tick(n * STEP); if (renderer) renderer.render(scene, camera); } catch (e) { fail(e); }
  return JSON.stringify(snapshot());
};
if (!renderer) { $("#err").textContent = "This device can't draw 3D 😢 — try another phone or computer!"; $("#err").style.display = "block"; }
requestAnimationFrame(frame);
