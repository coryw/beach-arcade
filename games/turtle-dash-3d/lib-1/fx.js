// fx.js — particles, debris, rings, flashes, trails and speed streaks for kit/three games (toolbox v1).
// Mechanisms only: every color is passed in at construction, and there is no explode()/banner()/createPops() —
// each game writes its own response to each event and names it in DESIGN.md under Juice.
// All time is simulation time: pass the loop's dt (0 during hitstop) to every update().
// API and costs: kit/three/README.md (fx section).
import * as THREE from "three";
import { registerProbe } from "./core.js";
import { glowTex } from "./art.js";

const need = (fn, name, v) => { if (v == null) throw new Error(`${fn}: ${name} is required — decide it in the art direction`); return v; };
const needColors = (fn, v) => need(fn, "colors", Array.isArray(v) && v.length ? v : null).map(col);
const col = (c) => (c && c.isColor ? c : new THREE.Color(c));
const xyz = (p) => (Array.isArray(p) ? p : [p.x, p.y, p.z]);
const rnd = (a, b) => a + (b - a) * Math.random();
const pick = (a) => a[(Math.random() * a.length) | 0];
const blendOf = (b) => (b === "normal" ? THREE.NormalBlending : THREE.AdditiveBlending);
const dyn = (a, n) => new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);

const LIVE = new Set();   // every Sparks/Chunks instance that is in a scene graph
export function liveParticles() { let n = 0; for (const s of LIVE) if (s.object.parent) n += s.live; return n; }
registerProbe("particles", liveParticles);

// ── Sparks: one THREE.Points, ring buffer ───────────────────────────────────
export class Sparks {
  constructor(scene, { colors, max = 600, size = 0.5, map = null, blending = "add", scrollZ = 0 } = {}) {
    this.colors = needColors("Sparks", colors); need("Sparks", "scene", scene);
    Object.assign(this, { max, i: 0, scrollZ, _live: 0, pos: new Float32Array(max * 3), vel: new Float32Array(max * 3), rgba: new Float32Array(max * 4),
      life: new Float32Array(max), full: new Float32Array(max), drag: new Float32Array(max), grav: new Float32Array(max) });
    for (let k = 0; k < max; k++) this.pos[k * 3 + 1] = -1e5;
    const g = new THREE.BufferGeometry(); g.setAttribute("position", (this.pa = dyn(this.pos, 3))); g.setAttribute("color", (this.ca = dyn(this.rgba, 4)));
    this.material = new THREE.PointsMaterial({ size, map: map || glowTex(), vertexColors: true, transparent: true, depthWrite: false, blending: blendOf(blending), sizeAttenuation: true });
    this.object = this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false; scene.add(this.points); LIVE.add(this);
  }
  emit(x, y, z, vx, vy, vz, color = this.colors[0], life = 0.8, drag = 1.5, grav = 0) {
    const k = this.i; this.i = (this.i + 1) % this.max; const j = k * 3, c = col(color);
    if (this.life[k] <= 0) this._live++;
    this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z; this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
    this.life[k] = this.full[k] = Math.max(1e-3, life); this.drag[k] = drag; this.grav[k] = grav;
    const q = k * 4; this.rgba[q] = c.r; this.rgba[q + 1] = c.g; this.rgba[q + 2] = c.b; this.rgba[q + 3] = 1;
    this.pa.needsUpdate = this.ca.needsUpdate = true; return k;
  }
  burst(pos, { colors = this.colors, n = 24, speed = 8, life = 0.7, up = 0, grav = -6 } = {}) {
    const [x, y, z] = xyz(pos); const cs = colors.map(col);
    for (let i = 0; i < n; i++) {
      const u = rnd(-1, 1), a = rnd(0, Math.PI * 2), r = Math.sqrt(1 - u * u), s = speed * rnd(0.35, 1);
      this.emit(x, y, z, Math.cos(a) * r * s, u * s + up, Math.sin(a) * r * s, pick(cs), life * rnd(0.7, 1.3), 1.5, grav);
    }
  }
  update(dt) {
    if (!this._live || dt <= 0) return;
    let live = 0; const P = this.pos, V = this.vel, C = this.rgba;
    for (let k = 0; k < this.max; k++) {
      if (this.life[k] <= 0) continue;
      const j = k * 3, q = k * 4; this.life[k] -= dt;
      if (this.life[k] <= 0) { P[j + 1] = -1e5; C[q + 3] = 0; continue; }
      live++; const f = Math.max(0, 1 - this.drag[k] * dt);
      V[j] *= f; V[j + 1] = V[j + 1] * f + this.grav[k] * dt; V[j + 2] *= f;
      P[j] += V[j] * dt; P[j + 1] += V[j + 1] * dt; P[j + 2] += (V[j + 2] + this.scrollZ) * dt;
      const a = this.life[k] / this.full[k]; C[q + 3] = a * a * (3 - 2 * a);
    }
    this._live = live; this.pa.needsUpdate = this.ca.needsUpdate = true;
  }
  clear() { this.life.fill(0); for (let k = 0; k < this.max; k++) { this.pos[k * 3 + 1] = -1e5; this.rgba[k * 4 + 3] = 0; } this._live = 0; this.pa.needsUpdate = this.ca.needsUpdate = true; }
  get live() { return this._live; }
  dispose() { LIVE.delete(this); this.points.removeFromParent(); this.points.geometry.dispose(); this.material.dispose(); }
}

// ── Chunks: InstancedMesh debris / confetti ─────────────────────────────────
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
export class Chunks {
  constructor(scene, { colors, max = 240, geometry = "cube", material = null } = {}) {
    this.colors = needColors("Chunks", colors); need("Chunks", "scene", scene); this.max = max;
    const geo = geometry && geometry.isBufferGeometry ? geometry : geometry === "tetra" ? new THREE.TetrahedronGeometry(0.22) : new THREE.BoxGeometry(0.25, 0.25, 0.25);
    this.material = material || new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.object = this.mesh = new THREE.InstancedMesh(geo, this.material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.mesh.frustumCulled = false; this.mesh.count = 0;
    this.mesh.setColorAt(0, this.colors[0]); this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.p = Array.from({ length: max }, () => ({ c: new THREE.Color() }));   // records, filled by burst
    this.n = 0; scene.add(this.mesh); LIVE.add(this);
  }
  burst(pos, { colors = this.colors, n = 16, speed = 6, up = [3, 7], life = 1, grav = -14, spin = 8, size = 1, floor = null } = {}) {
    const [x, y, z] = xyz(pos); const cs = colors.map(col); const [u0, u1] = Array.isArray(up) ? up : [up, up];
    for (let i = 0; i < n; i++) {
      const r = this.n < this.max ? this.p[this.n++] : this.p[(Math.random() * this.max) | 0];
      const a = rnd(0, Math.PI * 2), s = speed * rnd(0.3, 1);
      Object.assign(r, { x, y, z, vx: Math.cos(a) * s, vy: rnd(u0, u1), vz: Math.sin(a) * s, rx: rnd(0, 6.3), ry: rnd(0, 6.3), rz: rnd(0, 6.3),
        sx: rnd(-spin, spin), sy: rnd(-spin, spin), sz: rnd(-spin, spin), life: life * rnd(0.75, 1.25), grav, floor: floor ?? -Infinity, s: size * rnd(0.7, 1.3) });
      r.full = r.life; r.c.copy(pick(cs));
    }
    this._write();
  }
  update(dt) {
    if (!this.n || dt <= 0) return;
    for (let i = 0; i < this.n; i++) {
      const r = this.p[i]; r.life -= dt;
      if (r.life <= 0) { const last = this.p[--this.n]; this.p[this.n] = r; this.p[i] = last; i--; continue; }
      r.vy += r.grav * dt; r.x += r.vx * dt; r.y += r.vy * dt; r.z += r.vz * dt;
      if (r.y < r.floor) { r.y = r.floor; r.vy = Math.abs(r.vy) * 0.35; r.vx *= 0.6; r.vz *= 0.6; r.sx *= 0.5; r.sy *= 0.5; r.sz *= 0.5; }
      r.rx += r.sx * dt; r.ry += r.sy * dt; r.rz += r.sz * dt;
    }
    this._write();
  }
  _write() {
    for (let i = 0; i < this.n; i++) {
      const r = this.p[i], k = Math.min(1, (r.life / r.full) * 4), sc = r.s * k;   // shrink away in the last quarter
      _m.compose(_p.set(r.x, r.y, r.z), _q.setFromEuler(_e.set(r.rx, r.ry, r.rz)), _s.set(sc, sc, sc));
      this.mesh.setMatrixAt(i, _m); this.mesh.setColorAt(i, r.c);
    }
    this.mesh.count = this.n; this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true;
  }
  clear() { this.n = 0; this.mesh.count = 0; }
  get live() { return this.n; }
  dispose() { LIVE.delete(this); this.mesh.removeFromParent(); this.mesh.dispose(); }
}

// ── Timeline: sim-time callbacks, shockwave rings, glow flashes ─────────────
let _ringGeo = null;
const _cq = new THREE.Quaternion();
const _faceCam = function (r, s, camera) { this.quaternion.copy(camera.getWorldQuaternion(_cq)); this.updateMatrixWorld(); };   // billboard (scene-level parent)
export class Timeline {
  constructor(scene, { colors } = {}) {
    this.colors = needColors("Timeline", colors); this.scene = need("Timeline", "scene", scene);
    this.list = []; this.rings = []; this.sprites = []; this.active = new Set();
    _ringGeo ||= new THREE.RingGeometry(0.82, 1, 48);
  }
  add(fn) { this.list.push(fn); return fn; }
  after(sec, fn) { let t = 0; return this.add((dt) => { t += dt; if (t < sec) return true; fn(); return false; }); }
  every(sec, fn, count = Infinity) { let t = 0, n = 0; return this.add((dt) => { t += dt; while (t >= sec && n < count) { t -= sec; n++; fn(n); } return n < count; }); }
  _ring() {
    const m = this.rings.pop() || new THREE.Mesh(_ringGeo, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.frustumCulled = false; return m;
  }
  shockwave(pos, { color = this.colors[0], size = 4, dur = 0.5, flat = false } = {}) {
    const m = this._ring(); const [x, y, z] = xyz(pos); m.position.set(x, y, z); m.material.color.copy(col(color));
    m.quaternion.identity(); m.onBeforeRender = flat ? THREE.Object3D.prototype.onBeforeRender : _faceCam; if (flat) m.rotation.set(-Math.PI / 2, 0, 0);
    m.scale.setScalar(0.01); m.material.opacity = 0.9; this.scene.add(m); this.active.add(m); let t = 0;
    return this.add((dt) => { t += dt; const k = Math.min(1, t / dur); m.scale.setScalar(0.2 + size * (1 - (1 - k) ** 3)); m.material.opacity = 0.9 * (1 - k);
      if (k < 1) return true; m.removeFromParent(); this.active.delete(m); this.rings.push(m); return false; });
  }
  flash(pos, { color = this.colors[0], size = 3, dur = 0.25 } = {}) {
    const s = this.sprites.pop() || new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    const [x, y, z] = xyz(pos); s.position.set(x, y, z); s.material.color.copy(col(color)); s.material.opacity = 1; s.scale.setScalar(size * 0.4); this.scene.add(s); this.active.add(s); let t = 0;
    return this.add((dt) => { t += dt; const k = Math.min(1, t / dur); s.scale.setScalar(size * (0.4 + k)); s.material.opacity = 1 - k;
      if (k < 1) return true; s.removeFromParent(); this.active.delete(s); this.sprites.push(s); return false; });
  }
  update(dt) { if (!this.list.length) return; const cur = this.list; this.list = []; const keep = cur.filter((f) => f(dt)); this.list = keep.concat(this.list); }
  clear() { for (const o of this.active) { o.removeFromParent(); (o.isSprite ? this.sprites : this.rings).push(o); } this.active.clear(); this.list = []; }
}

// ── screenFlash: a full-screen DOM wash ─────────────────────────────────────
export function screenFlash(el = "#flash", { color } = {}) {
  need("screenFlash", "color", color);
  let node = typeof el === "string" ? document.querySelector(el) : el;
  if (!node) { node = document.createElement("div"); if (typeof el === "string" && el[0] === "#") node.id = el.slice(1); document.body.appendChild(node); }
  Object.assign(node.style, { position: "fixed", inset: "0", pointerEvents: "none", opacity: "0", zIndex: node.style.zIndex || "5" });
  const css = (c) => "#" + col(c).getHexString(THREE.SRGBColorSpace); const base = css(color);
  let a = 0, shown = -1;
  return {
    el: node,
    hit(alpha = 0.5, c = null) { a = Math.max(a, alpha); node.style.background = c == null ? base : css(c); if (shown !== a) { node.style.opacity = String(a); shown = a; } },
    update(dt) { if (a <= 0) return; a = Math.max(0, a - dt * 3); const r = Math.round(a * 100) / 100; if (r !== shown) { node.style.opacity = String(r); shown = r; } },
  };
}

// ── Trail: a camera-facing ribbon that follows a target ─────────────────────
const TRAIL_VS = `attribute vec3 aPrev; attribute vec3 aNext; attribute float aSide; attribute float aK;
uniform float uWidth; varying float vK;
void main(){ vK = aK; vec4 c = modelViewMatrix * vec4(position,1.0); vec4 p = modelViewMatrix * vec4(aPrev,1.0), n = modelViewMatrix * vec4(aNext,1.0);
  vec3 dir = n.xyz - p.xyz; if (dot(dir,dir) < 1e-10) dir = vec3(1.0,0.0,0.0);
  vec3 side = normalize(cross(normalize(dir), normalize(-c.xyz))); c.xyz += side * aSide * uWidth * 0.5 * aK;
  gl_Position = projectionMatrix * c; }`;
const TRAIL_FS = `uniform vec3 uColor; uniform float uFade; varying float vK;
void main(){ gl_FragColor = vec4(uColor, mix(1.0, vK, uFade));
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;
export class Trail {
  constructor(scene, target, { color, length = 20, width = 0.4, fade = true, blending = "add" } = {}) {
    need("Trail", "color", color); this.target = need("Trail", "target", target); this.n = Math.max(2, length | 0); this.filled = 0;
    const N = this.n, g = new THREE.BufferGeometry();
    this.pos = new Float32Array(N * 6); this.prev = new Float32Array(N * 6); this.next = new Float32Array(N * 6);
    const side = new Float32Array(N * 2), k = new Float32Array(N * 2), idx = [];
    for (let i = 0; i < N; i++) { side[i * 2] = 1; side[i * 2 + 1] = -1; k[i * 2] = k[i * 2 + 1] = 1 - i / (N - 1); if (i < N - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
    g.setAttribute("position", (this.aPos = dyn(this.pos, 3))); g.setAttribute("aPrev", (this.aPrev = dyn(this.prev, 3))); g.setAttribute("aNext", (this.aNext = dyn(this.next, 3)));
    g.setAttribute("aSide", new THREE.BufferAttribute(side, 1)); g.setAttribute("aK", new THREE.BufferAttribute(k, 1)); g.setIndex(idx);
    this.material = new THREE.ShaderMaterial({ vertexShader: TRAIL_VS, fragmentShader: TRAIL_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: blendOf(blending),
      uniforms: { uColor: { value: col(color).clone() }, uWidth: { value: width }, uFade: { value: fade ? 1 : 0 } } });
    this.object = this.mesh = new THREE.Mesh(g, this.material); this.mesh.frustumCulled = false; this.mesh.visible = false; scene.add(this.mesh);
    this._w = new THREE.Vector3();
  }
  _head() { const t = this.target; if (t.isObject3D) return t.getWorldPosition(this._w); return this._w.set(t.x, t.y, t.z); }
  update(dt) {
    const h = this._head(), P = this.pos, N = this.n;
    if (!this.filled) { for (let i = 0; i < N * 2; i++) { P[i * 3] = h.x; P[i * 3 + 1] = h.y; P[i * 3 + 2] = h.z; } this.filled = 1; }
    else if (dt > 0) { P.copyWithin(6, 0, (N - 1) * 6); }
    for (let s = 0; s < 2; s++) { P[s * 3] = h.x; P[s * 3 + 1] = h.y; P[s * 3 + 2] = h.z; }
    for (let i = 0; i < N; i++) {
      const a = Math.max(0, i - 1) * 6, b = Math.min(N - 1, i + 1) * 6, o = i * 6;
      for (let c = 0; c < 6; c++) { this.prev[o + c] = P[a + (c % 3)]; this.next[o + c] = P[b + (c % 3)]; }
    }
    this.aPos.needsUpdate = this.aPrev.needsUpdate = this.aNext.needsUpdate = true; this.mesh.visible = true;
  }
  clear() { this.filled = 0; this.mesh.visible = false; }
}

// ── Streaks: speed lines flying past (parent them to the camera for a warp look) ─
export class Streaks {
  constructor(scene, { color, n = 80, box = [12, 8, -10, -120], length = 4 } = {}) {
    need("Streaks", "color", color); this.n = n; this.box = box; this.length = length;
    const pos = new Float32Array(n * 6), rgb = new Float32Array(n * 6), c = col(color);
    for (let i = 0; i < n; i++) { rgb.set([c.r, c.g, c.b, 0, 0, 0], i * 6); this._place(pos, i, box[3] + Math.random() * (box[2] - box[3])); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", (this.pa = dyn(pos, 3))); g.setAttribute("color", new THREE.BufferAttribute(rgb, 3));
    this.material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.object = this.lines = new THREE.LineSegments(g, this.material); this.lines.frustumCulled = false; scene.add(this.lines);
  }
  _place(P, i, z) { const [w, h] = this.box, x = (Math.random() * 2 - 1) * w, y = (Math.random() * 2 - 1) * h; P.set([x, y, z, x, y, z - this.length], i * 6); }
  update(speed, dt) {
    if (!this.lines.visible || dt <= 0) return; const P = this.pa.array, d = speed * dt, [, , zNear, zFar] = this.box;
    for (let i = 0; i < this.n; i++) { const j = i * 6; P[j + 2] += d; P[j + 5] += d; if (P[j + 5] > zNear) this._place(P, i, zFar + (P[j + 2] - zNear)); }
    this.pa.needsUpdate = true;
  }
  get visible() { return this.lines.visible; }
  set visible(v) { this.lines.visible = !!v; }
}
