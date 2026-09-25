// core.js — boot (renderer, scene, camera, post, quality ladder), the fixed-step loop, the arcade test hooks
// (window.advanceTime / render_game_to_text / __arcade), seeded randomness, math helpers, the error trap,
// probes other modules register, and the best score. Mechanism only: every color, tone-mapping choice and
// visible string is passed in by the game and a missing one throws at boot.
// API, hooks contract, traps and budgets: kit/three/README.md (sections head and core.js).
import * as THREE from "three";
import { createQuality, createPost } from "./quality.js";

const need = (fn, name, v) => { if (v === undefined) throw new Error(`${fn}: ${name} is required — decide it in the art direction`); return v; };
const req = (fn, name, v) => { if (v === undefined) throw new Error(`${fn}: ${name} is required`); return v; };
const $el = (x) => (typeof x === "string" ? document.querySelector(x) : x);

// ── URL parameters (§3.1) ──
const raw = new URLSearchParams(location.search);
const num = (k) => (raw.has(k) && raw.get(k) !== "" && Number.isFinite(+raw.get(k)) ? +raw.get(k) : null);
const flag = (k) => raw.has(k) && raw.get(k) !== "0" && raw.get(k) !== "false";
const sa = raw.has("sa") ? raw.get("sa").split(",").map(Number) : null;
export const params = {
  seed: num("seed"), arcade: flag("arcade"), q: num("q"), nobloom: flag("nobloom"), god: flag("god"),
  at: raw.get("at") || null, sa: sa && sa.length === 4 && sa.every(Number.isFinite) ? sa : null, raw,
};
if (params.sa) ["t", "r", "b", "l"].forEach((k, i) => document.documentElement.style.setProperty(`--sa-${k}-override`, `${params.sa[i]}px`));

// ── randomness ──
export function rng(seed) {
  let s = (Number(seed) >>> 0) || 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
let seeded = null;
export function seedRandom() {
  if (params.seed == null) return Math.random;
  if (!seeded) { seeded = rng(params.seed); Math.random = seeded; }
  return seeded;
}
seedRandom();   // under ?seed=N every Math.random call from here on is deterministic

export const M = {
  clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
  lerp: (a, b, t) => a + (b - a) * t,
  damp: (cur, target, k, dt) => cur + (target - cur) * (1 - Math.exp(-k * dt)),
  approach: (cur, target, maxDelta) => (cur < target ? Math.min(cur + maxDelta, target) : Math.max(cur - maxDelta, target)),
  angleLerp: (a, b, k, dt) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return a + d * (1 - Math.exp(-k * dt)); },
  smoothstep: (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); },
  rand: (a = 0, b = 1) => a + Math.random() * (b - a),
  randInt: (a, b) => a + Math.floor(Math.random() * (b - a + 1)),
  pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
  chance: (p) => Math.random() < p,
  shuffle: (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; },
};

// ── probes (fx.js registers "particles", audio.js registers "audio") ──
const probes = new Map();
export function registerProbe(name, fn) { probes.set(name, fn); }
const probe = (name, fallback) => { const f = probes.get(name); if (!f) return fallback; try { return f(); } catch (e) { return fallback; } };

// ── the one global. Created at import so the error trap can write to it before startLoop runs. ──
const errState = { error: null, message: null, el: "#err", installed: false };
const A = (window.__arcade = { v: 2, ready: false, lane: "3d", engine: "three", hz: 60, stepMs: 0 });
Object.defineProperty(A, "error", { get: () => errState.error, set: (v) => { errState.error = v; }, enumerable: true });
Object.defineProperty(A, "frames", { get: () => 0, configurable: true, enumerable: true });
A.audio = () => probe("audio", "none");

function report(e) {
  const text = (e && (e.stack || e.message)) || String(e);
  if (!errState.error) errState.error = text.split("\n").slice(0, 6).join("\n");
  console.error("[arcade]", e);
  if (!errState.message) return;
  let el = $el(errState.el);
  if (!el) { el = document.createElement("div"); el.id = String(errState.el).replace(/^#/, "") || "err"; el.setAttribute("role", "alert"); document.body.appendChild(el); }
  const m = typeof errState.message === "function" ? errState.message(e) : `${errState.message}\n\n${text.split("\n")[0]}`;
  el.textContent = m; el.hidden = false; el.style.display = "";
}
export function installErrorTrap({ el = "#err", message } = {}) {
  need("installErrorTrap", "message", message);
  errState.message = message; errState.el = el;
  if (errState.installed) return;
  errState.installed = true;
  addEventListener("error", (ev) => report(ev.error || ev.message));
  addEventListener("unhandledrejection", (ev) => report(ev.reason));
}

// ── boot ──
const TONES = { neutral: THREE.NeutralToneMapping, agx: THREE.AgXToneMapping, aces: THREE.ACESFilmicToneMapping, none: THREE.NoToneMapping };
let current = null;   // the booted G (overdraw, renderInfo, viewRect read it)

export function boot(opts = {}) {
  need("boot", "canvas", opts.canvas); need("boot", "background", opts.background); need("boot", "bloom", opts.bloom);
  need("boot", "toneMapping", opts.toneMapping); need("boot", "errorMessage", opts.errorMessage);
  if (!(opts.toneMapping in TONES)) throw new Error(`boot: toneMapping must be one of ${Object.keys(TONES).join(", ")} (got "${opts.toneMapping}")`);
  const bloom = opts.bloom;
  if (bloom) for (const k of ["strength", "radius", "threshold"]) need("boot", `bloom.${k}`, bloom[k]);
  const { camera: cam = { fov: 55, near: 0.1, far: 1000 }, exposure = 1, msaa = 4, shadows = false, quality = "auto" } = opts;
  installErrorTrap({ message: opts.errorMessage });
  const canvas = $el(opts.canvas);
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error(`boot: canvas "${opts.canvas}" is not a <canvas> in the page`);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !bloom && msaa > 0, alpha: opts.background === null, powerPreference: "high-performance" });
  } catch (e) { report(e); throw e; }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = TONES[opts.toneMapping];
  renderer.toneMappingExposure = exposure;
  renderer.info.autoReset = false;
  if (shadows) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; }
  if (opts.background === null) renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  if (opts.background !== null) scene.background = new THREE.Color(opts.background);
  const ortho = cam.ortho ? { near: cam.near ?? 0.1, far: cam.far ?? 1000, ...cam.ortho } : null;
  if (ortho) need("boot", "camera.ortho.viewHeight", ortho.viewHeight);
  const camera = ortho ? new THREE.OrthographicCamera(-1, 1, 1, -1, ortho.near, ortho.far) : new THREE.PerspectiveCamera(cam.fov ?? 55, 1, cam.near ?? 0.1, cam.far ?? 1000);
  if (ortho) camera.position.set(0, 0, ortho.far / 2); else camera.position.set(0, 4, 10);
  camera.lookAt(0, 0, 0);

  const size = { w: 1, h: 1, portrait: false, dpr: 1 };
  const resizeFns = [];
  const G = { THREE, renderer, scene, camera, canvas, size, post: null, quality: null, ortho: !!ortho };
  G.post = createPost(renderer, scene, camera, { bloom, msaa });
  G.render = () => G.post.render();
  G.onResize = (fn) => { resizeFns.push(fn); return () => resizeFns.splice(resizeFns.indexOf(fn), 1); };

  function resize() {
    const r = canvas.getBoundingClientRect();
    size.w = Math.max(1, Math.round(r.width || innerWidth)); size.h = Math.max(1, Math.round(r.height || innerHeight));
    size.portrait = size.h > size.w;
    const aspect = size.w / size.h;
    if (ortho) { const hh = ortho.viewHeight / 2; camera.left = -hh * aspect; camera.right = hh * aspect; camera.top = hh; camera.bottom = -hh; }
    else camera.aspect = aspect;
    camera.updateProjectionMatrix();
    G.post.setSize(size.w, size.h, size.dpr);
    for (const fn of resizeFns) { try { fn(size); } catch (e) { report(e); } }
  }
  G.quality = createQuality(G, { bloom, ...(typeof quality === "number" && { start: quality, auto: false }) });
  resize();
  addEventListener("resize", resize);
  addEventListener("orientationchange", () => setTimeout(resize, 150));
  G.resize = resize;

  G.warm = (objects = []) => {
    const list = (Array.isArray(objects) ? objects : [objects]).filter(Boolean);
    const saved = [], added = [];
    for (const o of list) {
      if (!o.parent) { scene.add(o); added.push(o); }
      o.traverse((c) => { saved.push([c, c.visible]); c.visible = true; });
      for (let p = o.parent; p; p = p.parent) if (!p.visible) { saved.push([p, false]); p.visible = true; }   // a hidden pool container too
    }
    try { renderer.compile(scene, camera); G.render(); }
    finally { for (const [c, v] of saved) c.visible = v; for (const o of added) scene.remove(o); }
  };
  current = G;
  return G;
}

// ── __arcade probes that read the booted G ──
let lastInfo = null;
function snapInfo(G) {
  const i = G.renderer.info;
  lastInfo = { calls: i.render.calls, triangles: i.render.triangles, points: i.render.points, lines: i.render.lines };
}
function renderInfo() {
  const G = current; if (!G) return null;
  const i = G.renderer.info, li = lastInfo || { calls: 0, triangles: 0, points: 0, lines: 0 };
  const buf = G.renderer.getDrawingBufferSize(new THREE.Vector2()), px = buf.x * buf.y;
  return { ...li, programs: (i.programs || []).length, textures: i.memory.textures, geometries: i.memory.geometries,
    dpr: G.size.dpr, rung: G.quality.rung, bloom: G.post.bloomOn, particles: probe("particles", 0),
    fragments: Math.round(px + G.post.bloomPixels()) };
}
function viewRect() {
  const G = current; if (!G) return null;
  const r = G.canvas.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}
function overdraw() {
  const G = current; if (!G) return null;
  const { renderer, scene, camera } = G, one = new THREE.Color().setRGB(1 / 255, 0, 0, THREE.LinearSRGBColorSpace);
  const swaps = [], made = [];
  const counter = (m, o) => {
    const base = { color: one, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: m.depthTest, side: m.side, fog: false, toneMapped: false };
    const c = o.isPoints ? new THREE.PointsMaterial({ ...base, size: m.size ?? 1, sizeAttenuation: m.sizeAttenuation ?? true })
      : o.isSprite ? new THREE.SpriteMaterial({ ...base, sizeAttenuation: m.sizeAttenuation ?? true })
      : o.isLine ? new THREE.LineBasicMaterial(base) : new THREE.MeshBasicMaterial(base);
    c.visible = m.visible; made.push(c); return c;
  };
  scene.traverseVisible((o) => {
    if (!o.material) return;
    swaps.push([o, o.material]);
    o.material = Array.isArray(o.material) ? o.material.map((m) => counter(m, o)) : counter(o.material, o);
  });
  const buf = renderer.getDrawingBufferSize(new THREE.Vector2());
  const w = Math.max(1, Math.round(buf.x / 2)), h = Math.max(1, Math.round(buf.y / 2));
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, depthBuffer: true });
  const bg = scene.background, cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha(), prev = renderer.getRenderTarget();
  const pixels = new Uint8Array(w * h * 4);
  try {
    scene.background = null; renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, camera);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, pixels);
  } finally {
    for (const [o, m] of swaps) o.material = m;
    scene.background = bg; renderer.setClearColor(cc, ca); renderer.setRenderTarget(prev);
    made.forEach((m) => m.dispose()); rt.dispose();
  }
  let sum = 0; for (let i = 0; i < pixels.length; i += 4) sum += pixels[i];
  return sum / (w * h);
}
function focusScreen(snap) {
  const G = current, f = snap && (snap.focus || snap.player);
  if (!G || !f || !Number.isFinite(f.x) || !Number.isFinite(f.y)) return null;
  const v = new THREE.Vector3(f.x, f.y, Number.isFinite(f.z) ? f.z : 0).project(G.camera), r = G.canvas.getBoundingClientRect();
  return { x: r.x + (v.x + 1) / 2 * r.width, y: r.y + (1 - v.y) / 2 * r.height };
}

// ── the loop ──
export function startLoop({ step, render, snapshot, input = null, lane = "3d", hz = 60, maxSub = 5, commands = {}, G = null } = {}) {
  req("startLoop", "step", step); req("startLoop", "snapshot", snapshot);
  if (typeof commands.die !== "function") throw new Error("startLoop: commands.die is required — cmd(\"die\") must end the run (screen \"over\")");
  if (A.ready) throw new Error("startLoop: the loop is already running — call it once");
  const STEP = 1 / hz, STEP_MS = 1000 / hz;
  let t = 0, frames = 0, paused = false, manual = params.arcade, hidden = document.hidden, hitstop = 0, slowScale = 1, slowLeft = 0, acc = 0, last = 0;
  const draw = G || current;

  function once() {
    let dt = STEP * L.timeScale;
    if (hitstop > 0) { hitstop--; dt = 0; }
    else if (slowLeft > 0) { slowLeft -= STEP; dt *= slowScale; }
    frames++; t += dt;
    try { if (input) input.poll(); step(dt, t); } catch (e) { report(e); }
    try { if (input) input.endStep(); } catch (e) { report(e); }
  }
  function paint(alpha) {
    try {
      if (draw) draw.renderer.info.reset();
      if (render) render(alpha, t);
      if (draw) { draw.render(); snapInfo(draw); }
    } catch (e) { report(e); }
  }
  function text() {
    let s;
    try { s = snapshot() || {}; } catch (e) { report(e); s = {}; }
    return JSON.stringify({ ...s, t: Math.round(t * 10000) / 10000, frames, error: errState.error, inputs: { ...(input ? input.counts : {}) } });
  }

  const L = {
    timeScale: 1,
    get t() { return t; }, get frames() { return frames; }, get paused() { return paused; },
    pause(b = true) { paused = !!b; last = 0; },
    hitstop(ms) { hitstop = Math.max(hitstop, Math.ceil(ms / STEP_MS)); },
    slowmo(scale, sec) { slowScale = scale; slowLeft = sec; },
    release() { manual = false; last = 0; acc = 0; },
  };

  function frame(now) {
    requestAnimationFrame(frame);
    if (hidden) { last = 0; return; }
    const real = last ? Math.min(0.1, (now - last) / 1000) : STEP; last = now;
    if (!manual && !paused) {
      acc += real; let n = 0;
      while (acc >= STEP && n < maxSub) { once(); acc -= STEP; n++; }
      if (n === maxSub) acc = 0;
      if (draw && draw.quality) draw.quality.sample(real * 1000);
    }
    paint(manual || paused ? 1 : acc / STEP);
  }
  document.addEventListener("visibilitychange", () => { hidden = document.hidden; last = 0; });

  window.advanceTime = (ms) => {
    manual = true;
    const n = Math.max(1, Math.round(ms / STEP_MS));
    const t0 = performance.now();
    for (let i = 0; i < n; i++) once();
    A.stepMs = (performance.now() - t0) / n;
    paint(1);
    return text();
  };
  window.render_game_to_text = text;
  Object.defineProperty(A, "frames", { get: () => frames, configurable: true, enumerable: true });
  Object.defineProperty(A, "t", { get: () => t, configurable: true, enumerable: true });
  Object.assign(A, {
    lane, engine: "three", hz, loop: L, renderInfo, viewRect, overdraw,
    focusScreen: () => { try { return focusScreen(JSON.parse(text())); } catch (e) { return null; } },
    cmd(name, arg) {
      const fn = commands[name];
      if (typeof fn !== "function") throw new Error(`cmd: unknown command "${name}" (this game has: ${Object.keys(commands).join(", ")})`);
      try { fn(arg); } catch (e) { report(e); }
      return text();
    },
  });
  if (params.at && typeof commands.at === "function") { try { commands.at(params.at); } catch (e) { report(e); } }
  A.ready = true;
  requestAnimationFrame(frame);
  return L;
}

// ── best score: localStorage "arcade:<key>:best"; memory only under ?arcade=1 so test runs never persist ──
const memBest = new Map();
export function best(key) {
  const k = `arcade:${key}:best`;
  const read = () => { if (params.arcade) return memBest.get(k) || 0; try { return +localStorage.getItem(k) || 0; } catch (e) { return memBest.get(k) || 0; } };
  const write = (v) => { memBest.set(k, v); if (params.arcade) return; try { localStorage.setItem(k, String(v)); } catch (e) { /* private mode: memory only */ } };
  return {
    get: read,
    submit(score) { const b = read(); if (score > b) { write(score); return { best: score, isNew: true }; } return { best: b, isNew: false }; },
  };
}
