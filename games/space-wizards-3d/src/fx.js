// fx.js — sparkle particles (one draw call per system), shockwave rings, flashes, and DOM score pops.
// No blood, ever: everything that gets zapped pops into coloured sparkles.
import * as THREE from "three";
import { TEX } from "./art.js";

export class Sparks {
  constructor(scene, n, size) {
    this.n = n; this.i = 0;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.base = new Float32Array(n * 3);
    this.life = new Float32Array(n); this.max = new Float32Array(n); this.drag = new Float32Array(n); this.grav = new Float32Array(n);
    for (let k = 0; k < n; k++) this.pos[k * 3 + 1] = -9999;
    const g = new THREE.BufferGeometry();
    this.pa = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage); this.ca = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", this.pa); g.setAttribute("color", this.ca);
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size, map: TEX.glow, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    this.points.frustumCulled = false; scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, color, life = 0.7, drag = 1.5, grav = 0) {
    const k = this.i; this.i = (this.i + 1) % this.n; const j = k * 3;
    this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z; this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
    this.base[j] = color.r; this.base[j + 1] = color.g; this.base[j + 2] = color.b; this.life[k] = life; this.max[k] = life; this.drag[k] = drag; this.grav[k] = grav;
  }
  update(dt, worldZ = 0) {
    for (let k = 0; k < this.n; k++) {
      const j = k * 3;
      if (this.life[k] <= 0) { if (this.col[j] || this.col[j + 1] || this.col[j + 2]) { this.col[j] = this.col[j + 1] = this.col[j + 2] = 0; this.pos[j + 1] = -9999; } continue; }
      this.life[k] -= dt; const f = Math.max(0, 1 - this.drag[k] * dt);
      this.vel[j] *= f; this.vel[j + 1] = this.vel[j + 1] * f - this.grav[k] * dt; this.vel[j + 2] *= f;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += (this.vel[j + 2] + worldZ) * dt;
      const a = Math.max(0, this.life[k] / this.max[k]); const b = a * a * (3 - 2 * a) * 1.15;
      this.col[j] = this.base[j] * b; this.col[j + 1] = this.base[j + 1] * b; this.col[j + 2] = this.base[j + 2] * b;
    }
    this.pa.needsUpdate = true; this.ca.needsUpdate = true;
  }
  clear() { this.life.fill(0); }
}

export class FX {
  constructor(scene) { this.scene = scene; this.list = []; this.ringGeo = new THREE.RingGeometry(0.82, 1, 48); }
  shockwave(pos, color, size = 12, dur = 0.6) {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.position.copy(pos); this.scene.add(m); let t = 0;
    this.list.push((dt) => { t += dt; const k = t / dur; m.scale.setScalar(0.5 + size * (1 - Math.pow(1 - k, 3))); m.material.opacity = 0.9 * (1 - k); if (k >= 1) { this.scene.remove(m); m.material.dispose(); return false; } return true; });
  }
  flash(pos, color, size = 8, dur = 0.35) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.position.copy(pos); this.scene.add(s); let t = 0;
    this.list.push((dt) => { t += dt; const k = t / dur; s.scale.setScalar(size * (0.4 + k)); s.material.opacity = 1 - k; if (k >= 1) { this.scene.remove(s); s.material.dispose(); return false; } return true; });
  }
  add(fn) { this.list.push(fn); }
  update(dt) { this.list = this.list.filter((f) => f(dt)); }
  clear() { for (const f of this.list) f(99); this.list = []; }
}

// DOM pops: crisp text at a projected 3D point (cheaper and sharper than text meshes)
const pops = document.getElementById("pops"); const _v = new THREE.Vector3(); let popCount = 0;
export function pop(text, pos, camera, cls = "") {
  if (popCount > 14) return; _v.copy(pos).project(camera); if (_v.z > 1) return;
  const el = document.createElement("div"); el.className = "pop " + cls; el.textContent = text;
  el.style.left = ((_v.x + 1) / 2) * innerWidth + "px"; el.style.top = ((1 - _v.y) / 2) * innerHeight + "px";
  pops.appendChild(el); popCount++; setTimeout(() => { el.remove(); popCount--; }, 900);
}
