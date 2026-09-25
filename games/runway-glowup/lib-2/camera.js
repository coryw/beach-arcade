// camera.js — camera rigs that ease between modes (follow · chase · top · side · orbit · fixed), plus trauma
// shake, FOV kick and roll layered on top. Call a mode every step (cheap; it only sets the goal), then
// rig.update(dt, t) from the loop's step with SIMULATION dt/t, so shake and kick are deterministic and a hitstop
// freezes them. Shake uses smooth sine noise, never Math.random, so it cannot disturb a seeded run.
// API and costs: kit/three/README.md (section camera.js).
import * as THREE from "three";

const V = () => new THREE.Vector3();
const pos = (o, out) => (o.isObject3D ? o.getWorldPosition(out) : Array.isArray(o) ? out.fromArray(o) : out.set(o.x || 0, o.y || 0, o.z || 0));
const yawOf = (o) => {
  if (o.isObject3D) { const d = o.getWorldDirection(V()); return Math.atan2(d.x, d.z); }
  return o.yaw ?? o.heading ?? 0;
};
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const damp = (k, dt) => (k === Infinity ? 1 : 1 - Math.exp(-k * dt));

export function createRig(camera, { portraitScale = 1.35, maxShake = 0.6, maxShakeRoll = 0.06 } = {}) {
  if (!camera || !camera.isCamera) throw new Error("createRig: camera is required (G.camera)");
  const goal = V(), look = V(), basePos = V(), baseLook = V(), tp = V(), prev = V(), tmp = V();
  let mode = null, target = null, o = {}, k = 6, started = false, yaw = null, vx = 0, dir = 1, hadPrev = false;
  let trauma = 0, hold = 0, shakeT = 0, kickAmt = 0, kickDur = 0, kickT = 0, rollGoal = 0, roll = 0;
  const persp = !!camera.isPerspectiveCamera, base = { fov: camera.fov, zoom: camera.zoom };
  const portrait = () => (persp ? camera.aspect < 1 : innerHeight > innerWidth);
  const set = (m, t, opts, def) => { if (m !== mode) { hadPrev = false; yaw = null; } mode = m; target = t; o = { ...def, ...opts }; k = o.k; return R; };

  const R = {
    get mode() { return mode; }, get trauma() { return trauma; }, base,
    follow: (t, opts) => set("follow", t, opts, { back: 10, up: 5, lookUp: 1, lookAhead: 0, yawFollow: true, k: 6 }),
    chase: (t, opts) => set("chase", t, opts, { offset: [0, 5.4, 17.5], look: [0, 0, -30], parallax: [0.6, 0.55], bank: 0.006, k: 6 }),
    top: (t, opts) => set("top", t, opts, { height: 18, back: 6, k: 5 }),
    side: (t, opts) => set("side", t, opts, { dist: 14, height: 2, lead: 2, k: 6 }),
    orbit: (c, opts) => set("orbit", c, opts, { radius: 12, height: 5, speed: 0.2, k: 2.5 }),
    fixed: (p, l, opts) => set("fixed", p, { ...opts, at: l }, { k: Infinity }),
    shake(amount = 0.4, dur = 0.3) { trauma = Math.min(1, trauma + amount); hold = Math.max(hold, dur); return R; },
    kick(fov, dur = 0.35) { kickAmt = fov; kickDur = Math.max(0.01, dur); kickT = 0; return R; },
    roll(rad) { rollGoal = rad; return R; },
    snap() { started = false; return R; },
    update(dt, t = 0) {
      if (!mode) return R;
      const P = portrait() ? portraitScale : 1;
      pos(target, tp);
      const v = hadPrev && dt > 0 ? (tp.x - prev.x) / dt : 0; prev.copy(tp); hadPrev = true;
      vx += (v - vx) * damp(10, dt); if (Math.abs(vx) > 0.5) dir = Math.sign(vx);
      if (mode === "follow") {
        const ty = o.yawFollow ? yawOf(target) : Math.PI;
        yaw = yaw === null || !started ? ty : yaw + wrap(ty - yaw) * damp(o.k, dt);
        const fx = Math.sin(yaw), fz = Math.cos(yaw), b = o.back * P;
        goal.set(tp.x - fx * b, tp.y + o.up, tp.z - fz * b);
        look.set(tp.x + fx * o.lookAhead, tp.y + o.lookUp, tp.z + fz * o.lookAhead);
      } else if (mode === "chase") {
        const [px, py] = o.parallax, lx = Math.min(1, px + 0.15), ly = Math.min(1, py + 0.15);
        goal.set(tp.x * px + o.offset[0], tp.y * py + o.offset[1], tp.z + o.offset[2] * P);
        look.set(tp.x * lx + o.look[0], tp.y * ly + o.look[1], tp.z + o.look[2]);
      } else if (mode === "top") {
        goal.set(tp.x, tp.y + o.height, tp.z + o.back * P); look.copy(tp);
      } else if (mode === "side") {
        const lead = o.lead * dir; goal.set(tp.x + lead, tp.y + o.height, tp.z + o.dist * P); look.set(goal.x, goal.y, tp.z);
      } else if (mode === "orbit") {
        const a = t * o.speed, r = o.radius * P; goal.set(tp.x + Math.cos(a) * r, tp.y + o.height, tp.z + Math.sin(a) * r); look.copy(tp);
      } else { pos(o.at, look); goal.copy(tp); }
      const kk = damp(k, dt);
      if (!started) { basePos.copy(goal); baseLook.copy(look); started = true; } else { basePos.lerp(goal, kk); baseLook.lerp(look, kk); }
      camera.position.copy(basePos); camera.up.set(0, 1, 0); camera.lookAt(baseLook);
      // bank (chase), roll, then shake: trauma² × max, smooth incommensurate sines
      roll += (rollGoal - roll) * damp(8, dt);
      let rz = roll + (mode === "chase" ? -vx * o.bank : 0);
      if (hold > 0) hold = Math.max(0, hold - dt); else trauma = Math.max(0, trauma - 1.6 * dt);
      shakeT += dt;
      if (trauma > 0) {
        const s = trauma * trauma, q = shakeT * 23;
        camera.translateX(s * maxShake * (Math.sin(q * 1.13) * 0.6 + Math.sin(q * 2.71 + 1.3) * 0.4));
        camera.translateY(s * maxShake * (Math.sin(q * 1.37 + 0.7) * 0.6 + Math.sin(q * 3.07 + 2.1) * 0.4));
        rz += s * maxShakeRoll * Math.sin(q * 1.91 + 0.4);
      }
      if (rz) camera.rotateZ(rz);
      // FOV kick: instant punch, eased back to the base over dur (ortho: zoom)
      let kick = 0;
      if (kickAmt) { kickT += dt; const u = Math.min(1, kickT / kickDur); kick = kickAmt * (1 - u) * (1 - u); if (u >= 1) kickAmt = 0; }
      if (persp) { const f = base.fov + kick; if (camera.fov !== f) { camera.fov = f; camera.updateProjectionMatrix(); } }
      else { const z = base.zoom / (1 + kick * 0.01); if (camera.zoom !== z) { camera.zoom = z; camera.updateProjectionMatrix(); } }
      return R;
    },
  };
  return R;
}
