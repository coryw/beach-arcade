// physics.js — hand-rolled arcade physics: overlap tests, jump body, arcade car, spline tracks, pools, chain bodies,
// runner chunk recycler (toolbox v1). Tuned for feel, not realism; everything steps inside startLoop's fixed step,
// so ?seed + advanceTime replays it exactly. Positions are {x, y, z} (a Vector3 works); the ground plane is x/z.
// Models face -z: set mesh.rotation.y = car.heading. Rigid bodies live in rigid.js (cannon-es), not here.
// API and costs: kit/three/README.md (physics section).
import * as THREE from "three";
import { ink as inkApi } from "./art.js";

const need = (fn, name, v) => { if (v == null) throw new Error(`${fn}: ${name} is required — decide it in the art direction`); return v; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ── overlap & placement ─────────────────────────────────────────────────────
export function hitSphere(a, ra, b, rb) { const dx = a.x - b.x, dy = (a.y || 0) - (b.y || 0), dz = (a.z || 0) - (b.z || 0), r = ra + rb; return dx * dx + dy * dy + dz * dz <= r * r; }
export function overlapAABB(a, b) {
  return a.min.x <= b.max.x && a.max.x >= b.min.x && a.min.y <= b.max.y && a.max.y >= b.min.y &&
    (a.min.z === undefined || b.min.z === undefined || (a.min.z <= b.max.z && a.max.z >= b.min.z));
}
export function pushOutCircles(pos, r, obstacles) {   // → number of obstacles pushed out of (0 = clear)
  let hits = 0;
  for (const o of obstacles) {
    const dx = pos.x - o.x, dz = pos.z - o.z, min = r + o.r, d2 = dx * dx + dz * dz;
    if (d2 >= min * min) continue; const d = Math.sqrt(d2); hits++;
    if (d < 1e-6) { pos.x = o.x + min; continue; }
    pos.x = o.x + (dx / d) * min; pos.z = o.z + (dz / d) * min;
  }
  return hits;
}
export function clampToDisc(pos, R, onEdge = null) {
  const d = Math.hypot(pos.x, pos.z); if (d <= R) return false;
  const nx = pos.x / d, nz = pos.z / d; pos.x = nx * R; pos.z = nz * R; if (onEdge) onEdge(pos, nx, nz); return true;
}
export function spawnClear({ minR = 0, maxR, avoid = [], tries = 40, center = [0, 0] } = {}) {
  need("spawnClear", "maxR", maxR);
  for (let t = 0; t < tries; t++) {
    const r = Math.sqrt(minR * minR + Math.random() * (maxR * maxR - minR * minR)), a = Math.random() * Math.PI * 2;
    const x = center[0] + Math.cos(a) * r, z = center[1] + Math.sin(a) * r;
    if (avoid.every((o) => (x - o.x) ** 2 + (z - o.z) ** 2 >= (o.r || 0) ** 2)) return { x, z };
  }
  return null;
}
export function crossedPlane(prevZ, z, planeZ) { return (prevZ < planeZ && z >= planeZ) || (prevZ > planeZ && z <= planeZ); }
export function steer(vel, from, to, speed, k, dt) {   // eases vel toward `speed` along from→to (homing, magnets)
  const dx = to.x - from.x, dy = (to.y || 0) - (from.y || 0), dz = (to.z || 0) - (from.z || 0), d = Math.hypot(dx, dy, dz) || 1, f = 1 - Math.exp(-k * dt);
  vel.x += ((dx / d) * speed - vel.x) * f; if (vel.y !== undefined) vel.y += ((dy / d) * speed - vel.y) * f; if (vel.z !== undefined) vel.z += ((dz / d) * speed - vel.z) * f;
  return vel;
}

// ── movement models ─────────────────────────────────────────────────────────
export function body({ gravity = -22, jumpV = 9, coyote = 0.1, buffer = 0.12, cut = 0.5, ground = 0 } = {}) {
  const groundAt = (p) => (typeof ground === "function" ? ground(p.x, p.z) : ground);
  return {
    vel: new THREE.Vector3(), grounded: false, _coy: 0, _buf: 0, _cut: false,
    step(pos, { jump = false, jumpHeld = true } = {}, dt) {
      const out = { jumped: false, landed: false, hard: false }; if (dt <= 0) return out;
      this._buf = jump ? buffer : Math.max(0, this._buf - dt);
      this._coy = this.grounded ? coyote : Math.max(0, this._coy - dt);
      if (this._buf > 0 && (this.grounded || this._coy > 0)) { this.vel.y = jumpV; this.grounded = false; this._coy = this._buf = 0; this._cut = false; out.jumped = true; }
      else if (!jumpHeld && !this._cut && !this.grounded && this.vel.y > 0) { this.vel.y *= cut; this._cut = true; }   // variable height
      const wasGrounded = this.grounded; this.vel.y += gravity * dt;
      pos.x += this.vel.x * dt; pos.y += this.vel.y * dt; pos.z += this.vel.z * dt;
      const g = groundAt(pos), snap = Math.max(0.05, Math.hypot(this.vel.x, this.vel.z) * dt * 1.2);   // stick to downhill slopes
      if (pos.y <= g || (wasGrounded && !out.jumped && pos.y - g < snap)) {
        if (!wasGrounded) { out.landed = true; out.hard = this.vel.y < -jumpV * 1.25; }
        pos.y = g; this.vel.y = 0; this.grounded = true; this._cut = false;
      } else this.grounded = false;
      return out;
    },
  };
}
export function arcadeCar({ maxSpeed = 28, accel = 18, turn = 2.2, grip = 6, driftGrip = 1.5, boost = 1.4 } = {}) {
  return {
    speed: 0, heading: 0, driftCharge: 0, drifting: false, vx: 0, vz: 0, boostT: 0, _held: false,
    step(state, { steer = 0, gas = 1, drift = false, boost: boostIn = false } = {}, dt) {
      const out = { boosted: false }; if (dt <= 0) return out;
      if (this.drifting && !drift) { if (this.driftCharge >= 1) { this.boostT = 0.5 + 0.5 * Math.min(1, this.driftCharge - 1); out.boosted = true; } this.driftCharge = 0; }
      if (boostIn && !this._held) out.boosted = true; this._held = boostIn;
      this.drifting = drift && Math.abs(this.speed) > maxSpeed * 0.3; this.boostT = Math.max(0, this.boostT - dt);
      const boosting = boostIn || this.boostT > 0, top = maxSpeed * (boosting ? boost : 1);
      const target = clamp(gas, -0.4, 1) * top, a = accel * (boosting ? 2 : 1) * (Math.sign(target) !== Math.sign(this.speed) && this.speed ? 2 : 1);
      this.speed += clamp(target - this.speed, -a * dt, a * dt);
      const tr = turn * clamp(Math.abs(this.speed) / (maxSpeed * 0.25), 0, 1) * Math.sign(this.speed) * (this.drifting ? 1.35 : 1);
      this.heading -= clamp(steer, -1, 1) * tr * dt;
      if (this.drifting) this.driftCharge += Math.abs(steer) * dt * 1.5;
      const fx = -Math.sin(this.heading), fz = -Math.cos(this.heading), k = 1 - Math.exp(-(this.drifting ? driftGrip : grip) * dt);
      this.vx += (fx * this.speed - this.vx) * k; this.vz += (fz * this.speed - this.vz) * k;
      state.x += this.vx * dt; state.z += this.vz * dt; return out;
    },
  };
}

// ── spline track: (s, offset) coordinates ───────────────────────────────────
const UP = new THREE.Vector3(0, 1, 0);
export class Spline {
  constructor(points, { closed = true, tension = 0.5 } = {}) {
    need("Spline", "points", points); if (points.length < 2) throw new Error("Spline: needs at least 2 points");
    this.closed = closed; this.curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), closed, "catmullrom", tension);
    this.curve.arcLengthDivisions = Math.max(200, points.length * 40); this._len = this.curve.getLength();
    const n = (this._n = Math.max(64, Math.ceil(this._len / 0.5))), v = new THREE.Vector3(); this._pts = new Float32Array((n + 1) * 3);
    for (let i = 0; i <= n; i++) { this.curve.getPointAt(i / n, v); this._pts.set([v.x, v.y, v.z], i * 3); }
    this._v = new THREE.Vector3();
  }
  get length() { return this._len; }
  _u(s) { const L = this._len; return (this.closed ? ((s % L) + L) % L : clamp(s, 0, L)) / L; }
  at(s) {
    const u = this._u(s), pos = this.curve.getPointAt(u), tangent = this.curve.getTangentAt(u).normalize();
    const normal = new THREE.Vector3().crossVectors(tangent, UP); if (normal.lengthSq() < 1e-8) normal.set(1, 0, 0); normal.normalize();
    return { pos, tangent, normal };   // normal = the right-hand side of travel: pos + normal * offset
  }
  _d2(s, p) { this.curve.getPointAt(this._u(s), this._v); return this._v.distanceToSquared(p); }
  nearest(pos) {
    const P = this._pts, n = this._n; let best = 0, bd = Infinity;
    for (let i = 0; i <= n; i++) { const dx = P[i * 3] - pos.x, dy = P[i * 3 + 1] - (pos.y || 0), dz = P[i * 3 + 2] - (pos.z || 0), d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; best = i; } }
    const ds = this._len / n, q = { x: pos.x, y: pos.y || 0, z: pos.z || 0 }; let a = (best - 1) * ds, b = (best + 1) * ds;
    if (!this.closed) { a = Math.max(0, a); b = Math.min(this._len, b); }
    for (let k = 0; k < 24; k++) { const m1 = a + (b - a) / 3, m2 = b - (b - a) / 3; if (this._d2(m1, q) < this._d2(m2, q)) b = m2; else a = m1; }
    const s = (a + b) / 2; return this.closed ? ((s % this._len) + this._len) % this._len : clamp(s, 0, this._len);
  }
  ribbon({ width = 10, segments = 400, uvScale = 0.1, offset = 0 } = {}) {
    const pos = [], uv = [], idx = [], L = this._len;
    for (let i = 0; i <= segments; i++) {
      const s = (i / segments) * L, { pos: p, normal: nm } = this.at(this.closed && i === segments ? 0 : s);
      for (const side of [-0.5, 0.5]) { const o = offset + side * width; pos.push(p.x + nm.x * o, p.y, p.z + nm.z * o); uv.push(side + 0.5, s * uvScale); }
      if (i < segments) { const l = i * 2, r = l + 1; idx.push(l, r, l + 2, r, r + 2, l + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere(); return g;
  }
}

// ── pools ───────────────────────────────────────────────────────────────────
export class Pool {
  constructor(scene, factory, { max = 64 } = {}) { this.scene = need("Pool", "scene", scene); this.factory = need("Pool", "factory", factory); this.max = max; this.live = []; this.spare = []; this.made = 0; }
  spawn(init) {
    let o = this.spare.pop(); if (!o) { if (this.made >= this.max) return null; o = this.factory(); this.made++; }
    o.userData.dead = false; o.visible = true; this.scene.add(o); this.live.push(o);
    if (typeof init === "function") init(o); else if (init) { if (init.x !== undefined) o.position.set(init.x, init.y || 0, init.z || 0); Object.assign(o.userData, init); }
    return o;
  }
  free(obj) { if (obj) obj.userData.dead = true; }
  each(fn) { for (const o of this.live) if (!o.userData.dead) fn(o); }
  sweep() { let w = 0; for (const o of this.live) { if (o.userData.dead) { this.scene.remove(o); this.spare.push(o); } else this.live[w++] = o; } this.live.length = w; }
  clear() { for (const o of this.live) o.userData.dead = true; this.sweep(); }
  get count() { let n = 0; for (const o of this.live) if (!o.userData.dead) n++; return n; }
}
const _m4 = new THREE.Matrix4(), _qt = new THREE.Quaternion(), _eu = new THREE.Euler(), _p3 = new THREE.Vector3(), _s3 = new THREE.Vector3();
export class InstancedPool {
  constructor(scene, geometry, material, { max = 256, colors = false, ink = null, cull = false } = {}) {
    need("InstancedPool", "scene", scene); this.max = max; this.colors = colors; this.cull = cull; this.recs = new Map(); this.list = []; this.nextId = 1;
    const m = (this._mesh = new THREE.InstancedMesh(need("InstancedPool", "geometry", geometry), need("InstancedPool", "material", material), max));
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.count = 0; m.frustumCulled = !!cull; m.computeBoundingSphere();
    if (colors) { m.setColorAt(0, new THREE.Color(1, 1, 1)); m.instanceColor.setUsage(THREE.DynamicDrawUsage); }
    if (ink) {   // same hull + material as art.ink; shares instanceMatrix, so it costs one extra draw call and no extra upload
      const im = (this.inkMesh = new THREE.InstancedMesh(inkApi.hull(geometry), inkApi.material(need("InstancedPool", "ink.color", ink.color), ink.px ?? 3), max));
      im.instanceMatrix = m.instanceMatrix; im.count = 0; im.frustumCulled = !!cull; im.boundingSphere = m.boundingSphere;
      im.onBeforeRender = inkApi.onBeforeRender; im.raycast = () => {}; im.userData.inkHull = true; m.add(im);
    }
    scene.add(m);
  }
  get mesh() { return this._mesh; }
  get count() { return this.recs.size; }
  spawn({ x = 0, y = 0, z = 0, rotY = 0, scale = 1, color, data } = {}) {
    if (this.recs.size >= this.max) return null;
    if (this.colors && (color === undefined || color === null)) throw new Error("InstancedPool.spawn: color is required — decide it in the art direction");
    const rec = { id: this.nextId++, x, y, z, rotY, scale, color: color == null ? null : new THREE.Color(color), data, dead: false };
    this.recs.set(rec.id, rec); this.list.push(rec); return rec.id;
  }
  get(id) { return this.recs.get(id); }
  set(id, patch) { const r = this.recs.get(id); if (!r) return false; Object.assign(r, patch); if (patch.color != null) r.color = new THREE.Color(patch.color); return true; }
  free(id) { const r = this.recs.get(id); if (!r) return false; r.dead = true; this.recs.delete(id); return true; }
  each(fn) { for (const r of this.list) if (!r.dead) fn(r.id, r); }
  sync() {
    let w = 0; const m = this._mesh;
    for (const r of this.list) {
      if (r.dead) continue; this.list[w] = r;
      const s = r.scale; _m4.compose(_p3.set(r.x, r.y, r.z), _qt.setFromEuler(_eu.set(r.rotX || 0, r.rotY, r.rotZ || 0)), typeof s === "number" ? _s3.set(s, s, s) : _s3.set(s[0], s[1], s[2]));
      m.setMatrixAt(w, _m4); if (this.colors) m.setColorAt(w, r.color); w++;
    }
    this.list.length = w; m.count = w; m.instanceMatrix.needsUpdate = true; if (this.colors) m.instanceColor.needsUpdate = true;
    if (this.inkMesh) this.inkMesh.count = w;
    if (this.cull) m.computeBoundingSphere();   // updates the sphere object the ink mesh shares
  }
  clear() { for (const r of this.list) r.dead = true; this.recs.clear(); this.list.length = 0; this._mesh.count = 0; if (this.inkMesh) this.inkMesh.count = 0; }
}

// ── chains & chunk recycling ────────────────────────────────────────────────
export function trailChain(head, segments, { spacing = 1.2, historyLen = 200 } = {}) {
  need("trailChain", "head", head); need("trailChain", "segments", segments);
  const H = Array.from({ length: historyLen }, () => new THREE.Vector3()), look = new THREE.Vector3(), tmp = new THREE.Vector3();
  let n = 0, top = 0;   // H[top] is the newest point; ring of historyLen
  const hp = () => head.position || head, P = (o) => o.position || o, get = (k) => H[(top - k + historyLen) % historyLen];
  const api = {
    update() {
      const p = hp();
      if (!n || get(0).distanceToSquared(tmp.set(p.x, p.y, p.z)) >= (spacing * 0.2) ** 2) { top = (top + 1) % historyLen; H[top].set(p.x, p.y, p.z); n = Math.min(historyLen, n + 1); }
      let k = 0, acc = 0, len = 0; const a = tmp.set(p.x, p.y, p.z), nd = (j) => (j ? get(j - 1) : a);   // path: head, newest … oldest
      for (let i = 0; i < segments.length; i++) {
        const want = spacing * (i + 1), q = P(segments[i]);
        while (k < n - 1 && acc + (len = nd(k).distanceTo(get(k))) < want) { acc += len; k++; }
        const from = nd(k), to = get(k), L = from.distanceTo(to), f = L > 1e-6 ? clamp((want - acc) / L, 0, 1) : 1;
        q.x = from.x + (to.x - from.x) * f; q.y = from.y + (to.y - from.y) * f; q.z = from.z + (to.z - from.z) * f;
        const s = segments[i]; if (s.isObject3D) { const prev = i ? P(segments[i - 1]) : p; look.set(2 * q.x - prev.x, 2 * q.y - prev.y, 2 * q.z - prev.z); if (look.distanceToSquared(q) > 1e-8) s.lookAt(look); }   // -z faces the segment ahead
      }
    },
    reset() { n = 0; },
    get length() { return n; },
  };
  return api;
}
export function ringChunks({ count = 8, length = 40, build, recycle } = {}) {
  need("ringChunks", "build", build); need("ringChunks", "recycle", recycle);
  const slots = []; let first = 0;
  const place = (slot, index) => { slot.index = index; const z = -index * length; if (slot.obj.position) slot.obj.position.z = z; recycle(slot.obj, z, index); };
  for (let i = 0; i < count; i++) { const slot = { obj: build(i), index: i }; slots.push(slot); place(slot, i); }
  return {
    update(distance) { const want = Math.max(0, Math.floor(distance / length) - 1); while (first < want) { place(slots[first % count], first + count); first++; } },   // chunk index k covers z ∈ [-(k+1)·length, -k·length]
    each(fn) { for (const s of slots) fn(s.obj, s.index); },
    reset() { first = 0; for (let i = 0; i < count; i++) place(slots[i], i); },
  };
}
