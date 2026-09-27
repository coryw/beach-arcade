// Shark Dodge 3D — "Neon Abyss". The arena-3d exemplar: a glowing reef fish in a round arena ringed by a living
// wall of minnow sharks. Waves peel off the ring to hunt you; DASH bonks them (hit-stop), and the ribbon of light
// your fish draws stuns any shark that swims through it (the Signature). Toolbox: kit/three/README.md (./lib-2/).
// Regions: STRUCTURE is what the arena-3d recipe copies; ART is this game's alone; CLIMAX is the polish layer.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { boot, startLoop, best, M, params } from "./lib-2/core.js";
import { createShell } from "./lib-2/shell.js";
import { createInput } from "./lib-2/input.js";
import { createRig } from "./lib-2/camera.js";
import { defineSfx, song, playSong, setIntensity } from "./lib-2/audio.js";
import { Sparks, Timeline, screenFlash, Trail } from "./lib-2/fx.js";
import { geo, mat, part, deform, mirror, hitFlash, starfield, heightfield, lights, scatter, canvasTex, glowTex } from "./lib-2/art.js";
import { InstancedPool, pushOutCircles, clampToDisc, spawnClear, steer } from "./lib-2/physics.js";
import { wind, rim, dissolve, tick } from "./lib-2/shaders.js";

// ── STRUCTURE ──
const PALETTE = ["#05060f", "#1b1464", "#00f5d4", "#f15bb5", "#fee440"];   // abyss · indigo · hero cyan · danger magenta · shell gold
const SLUG = "shark-dodge-3d", ORIENT = "landscape";
const ARENA = 15, RING_R = 17.2, HORDE = 150, HERO_R = 0.55, MINNOW_R = 0.42, CHARGER_R = 1.05, Y = 0.5;
const SWIM = 9, DASH = { time: 0.3, speed: 22, cool: 0.45, aimR: 6, aimCos: 0.5 };
const ACTS = [["reef", 1], ["deep", 4]];          // [stage, first wave]; the climax layer appends its own act
const WAVE_MAX = 13, RIB_N = 84, RIB_SKIP = 4;      // a wave hunts ≤ 13 s · the ribbon is 84 steps (1.4 s) long, minus the fish's own head

const G = boot({ canvas: "#view", background: PALETTE[0], bloom: { strength: 0.9, radius: 0.6, threshold: 0.85 }, toneMapping: "agx",
  camera: { fov: 55, near: 0.1, far: 220 }, errorMessage: "A bug bit the abyss! Show this to a grown-up:" });
const input = createInput({
  stick: { zone: "#stick-zone", mode: "float", radius: 60, deadzone: 0.08, base: "#stick-base", knob: "#stick-knob" },
  buttons: { "#btn-dash": "dash" } });
const shell = createShell({ screens: { title: "#title", over: "#over" }, orient: ORIENT, input,
  prompt: { el: "#prompt", text: input.isTouch ? "tap to dive in" : "press space to dive in" },
  onShow: (name) => { if (name === "title" || name === "over") G.quality.probeUp(); } });
shell.hubLink(); shell.rotate("#rotate");
const hudScore = shell.text("#score"), hudWave = shell.text("#wave"), finalScore = shell.text("#final"), bestScore = shell.text("#best");
const record = best(SLUG), rig = createRig(G.camera);

const S = { screen: "title", stage: "reef", startStage: "reef", t: 0, score: 0, lives: 3, wave: 0, waveT: 0, gap: 0, inv: 0,
  dashT: 0, cool: 0, combo: 0, comboT: 0, shellT: 2, bonks: 0, cleared: 0 };
const H = { x: 0, y: 0.5, z: 0, vx: 0, vz: 0, dx: 0, dz: -1, ax: 0, az: -1, yaw: Math.PI };   // the fish: position, velocity, facing, dash dir
const CAM = { height: 18, back: 6, k: 5 }, camT = { x: 0, y: 0, z: 0 }, goal = { x: 0, y: 0.5, z: 0 };
const hist = Array.from({ length: RIB_N }, () => ({ x: 0, z: 0 }));
let histTop = 0, histN = 0, loop = null;
const huntSpeed = (w) => Math.min(8.4, 4.2 + 0.45 * w);
const actOf = (w) => ACTS.reduce((s, [name, from]) => (w >= from ? name : s), ACTS[0][0]);
const lives = [...document.querySelectorAll("#lives i")];

function start() {
  const act = ACTS.find(([n]) => n === S.startStage) || ACTS[0];
  Object.assign(S, { screen: "play", stage: act[0], t: 0, score: 0, lives: 3, wave: act[1] - 1, waveT: 0, gap: 1.2, inv: 0,
    dashT: 0, cool: 0, combo: 0, comboT: 0, shellT: 2, bonks: 0, cleared: 0 });
  Object.assign(H, { x: 0, z: 0, vx: 0, vz: 0, dx: 0, dz: -1 });
  minnows.each((id, r) => { if (r.data.mode !== "ring") r.data.mode = "home"; });
  chargers.clear(); shells.clear(); teles.forEach((x) => { x.used = false; hideTele(x); }); histN = 0; trail.clear();
  lives.forEach((el) => el.classList.remove("gone")); hudScore(0); hudWave(`WAVE ${S.wave + 1}`);
  climaxReset(); shell.show("play"); onStart();
}
function over() {
  if (S.screen === "over") return;
  S.screen = "over"; climaxOver();
  const r = record.submit(S.score);
  finalScore(S.score); bestScore(r.best); shell.show("over"); onOver(r.isNew);
  minnows.each((id, r2) => { if (r2.data.mode === "hunt" || r2.data.mode === "stun") r2.data.mode = "home"; });
}
function beginWave(n) {
  S.wave = n; S.waveT = 0; S.stage = actOf(n); hudWave(`WAVE ${n}`);
  if (climaxWave(n)) return;   // the climax layer may take a whole wave (the boss)
  let want = 4 + 2 * n; const ring = [];
  minnows.each((id, r) => { if (r.data.mode === "ring") ring.push(r); });
  const stride = Math.max(1, Math.floor(ring.length / want));
  for (let i = 0; i < ring.length && want > 0; i += stride, want--) { ring[i].data.mode = "hunt"; ring[i].data.v.x = ring[i].data.v.z = 0; }
  const nC = n >= ACTS[1][1] ? Math.min(3, n - ACTS[1][1] + 1) : 0;
  for (let i = 0; i < nC; i++) spawnCharger(M.rand(0, Math.PI * 2));
  onWave(n, S.stage);
}
function endWave(clearedByBonks) {
  if (clearedByBonks) { S.score += 100 * S.wave; S.cleared++; onClear(S.wave); }
  minnows.each((id, r) => { if (r.data.mode === "hunt" || r.data.mode === "stun") r.data.mode = "home"; });
  chargers.each((id, r) => { r.data.mode = "leave"; hideTele(r.data.tele); });
  S.gap = clearedByBonks ? 2.2 : 1.4;
}

// the ring: every minnow lives in the pool; mode ring → hunt → (stun) → home → ring, or dies to a BONK and a new one joins
function spawnMinnow(a, r, mode) {
  const tint = minnowColor();
  return minnows.spawn({ x: Math.cos(a) * r, y: Y, z: Math.sin(a) * r, scale: 0.5, color: tint,
    data: { mode, a, tint, v: { x: 0, z: 0 }, px: 0, pz: 0, stun: 0, wob: M.rand(0, 6.28) } });
}
function spawnCharger(a) {
  const tele = teles.findIndex((t) => !t.used); if (tele < 0) return;
  teles[tele].used = true;
  chargers.spawn({ x: Math.cos(a) * 21, y: Y, z: Math.sin(a) * 21, scale: 2.1, color: PALETTE[3],
    data: { mode: "in", a, t: 0, dx: 0, dz: 0, v: { x: 0, z: 0 }, px: 0, pz: 0, hp: 2, stun: 0, tele } });
}
const obs = Array.from({ length: HORDE }, () => ({ x: 0, z: 0, r: MINNOW_R })), tmp = { x: 0, z: 0 };
function sharks(dt, t) {
  const ringW = 0.16 + 0.035 * S.wave, sp = huntSpeed(Math.max(1, S.wave));
  let n = 0;
  minnows.each((id, r) => { if (r.data.mode === "hunt") { obs[n].x = r.x; obs[n].z = r.z; n++; } });
  const o = obs.slice(0, n); let k = 0;
  minnows.each((id, r) => {
    const d = r.data; d.px = r.x; d.pz = r.z;
    if (d.mode === "ring" || d.mode === "join" || d.mode === "home") {
      d.a += ringW * dt;
      const R = RING_R + Math.sin(t * 1.3 + d.wob) * 0.45, tx = Math.cos(d.a) * R, tz = Math.sin(d.a) * R;
      if (d.mode === "ring") { r.x = tx; r.z = tz; r.rotY = -d.a; }
      else if (d.mode === "home") r.color.set(d.tint);
      else {   // home / join: swim radially to the ring, then fall into its orbit
        d.a = Math.atan2(r.z, r.x); goal.x = Math.cos(d.a) * RING_R; goal.z = Math.sin(d.a) * RING_R;
        steer(d.v, r, goal, d.mode === "home" ? 7 : 5, 3, dt); r.x += d.v.x * dt; r.z += d.v.z * dt;
        if (Math.hypot(r.x - goal.x, r.z - goal.z) < 0.6) d.mode = "ring";
        r.rotY = Math.atan2(d.v.x, d.v.z);
      }
    } else if (d.mode === "hunt") {
      steer(d.v, r, H, sp, 2.2, dt);
      const side = Math.sin(t * 3 + d.wob) * 1.4; r.x += (d.v.x + d.v.z * side * 0.3) * dt; r.z += (d.v.z - d.v.x * side * 0.3) * dt;
      tmp.x = r.x; tmp.z = r.z; const me = o[k], sx = me.x; me.x = 1e9;
      pushOutCircles(tmp, MINNOW_R, o); me.x = sx; r.x = tmp.x; r.z = tmp.z; k++;
      r.rotY = Math.atan2(d.v.x, d.v.z);
      if (crossesRibbon(d.px, d.pz, r.x, r.z)) { d.mode = "stun"; d.stun = 1; onStun(r, false); }
    } else if (d.mode === "stun") {
      d.stun -= dt; d.v.x *= 1 - 3 * dt; d.v.z *= 1 - 3 * dt; r.x += d.v.x * dt; r.z += d.v.z * dt; r.rotY += 12 * dt;
      if (d.stun <= 0) { d.mode = S.screen === "play" ? "hunt" : "home"; r.color.set(d.mode === "hunt" ? PALETTE[3] : d.tint); }
    }
    r.y = Y + (d.mode === "ring" ? Math.sin(t * 2 + d.wob) * 0.15 : 0);
  });
  if (minnows.count < HORDE && M.chance(0.5)) spawnMinnow(M.rand(0, Math.PI * 2), 25, "join");
  chargers.each((id, r) => {
    const d = r.data; d.px = r.x; d.pz = r.z; d.t += dt;
    if (d.mode === "in") {
      goal.x = Math.cos(d.a) * 11; goal.z = Math.sin(d.a) * 11;
      steer(d.v, r, goal, 7, 4, dt); r.x += d.v.x * dt; r.z += d.v.z * dt; r.rotY = Math.atan2(d.v.x, d.v.z);
      if (Math.hypot(r.x, r.z) < 11.5) aim(d, r);
    } else if (d.mode === "aim") {
      r.rotY = M.angleLerp(r.rotY, Math.atan2(d.dx, d.dz), 10, dt); showTele(d.tele, r, d, d.t / 0.9);
      if (d.t >= 0.9) { d.mode = "charge"; d.t = 0; hideTele(d.tele); r.color.set(PALETTE[3]); onCharge(r); }
    } else if (d.mode === "charge") {
      r.x += d.dx * 20 * dt; r.z += d.dz * 20 * dt;
      if (clampToDisc(r, ARENA + 0.5) || d.t > 1.4) { d.mode = "rest"; d.t = 0; d.v.x = d.dx * 3; d.v.z = d.dz * 3; }
      if (crossesRibbon(d.px, d.pz, r.x, r.z)) { d.mode = "stun"; d.stun = 1; d.v.x = d.dx * 4; d.v.z = d.dz * 4; onStun(r, true); }
    } else if (d.mode === "rest" || d.mode === "stun") {
      d.v.x *= 1 - 2.5 * dt; d.v.z *= 1 - 2.5 * dt; r.x += d.v.x * dt; r.z += d.v.z * dt; clampToDisc(r, ARENA + 0.5);
      if (d.mode === "stun") { d.stun -= dt; r.rotY += 9 * dt; if (d.stun <= 0) { r.color.set(PALETTE[3]); aim(d, r); } }
      else if (d.t > 1) aim(d, r);
    } else if (d.mode === "leave") {
      goal.x = r.x * 3; goal.z = r.z * 3; steer(d.v, r, goal, 9, 3, dt); r.x += d.v.x * dt; r.z += d.v.z * dt; r.rotY = Math.atan2(d.v.x, d.v.z);
      if (Math.hypot(r.x, r.z) > 24) { teles[d.tele].used = false; chargers.free(id); }
    }
  });
}
function aim(d, r) {
  d.mode = "aim"; d.t = 0; const dx = H.x - r.x, dz = H.z - r.z, L = Math.hypot(dx, dz) || 1;
  d.dx = dx / L; d.dz = dz / L; onTelegraph();
}
function crossesRibbon(ax, az, bx, bz) {
  if (histN < RIB_SKIP + 2) return false;
  for (let k = RIB_SKIP; k < histN - 1; k++) {
    const p = hist[(histTop - k + RIB_N) % RIB_N], q = hist[(histTop - k - 1 + RIB_N) % RIB_N];
    const rx = bx - ax, rz = bz - az, sx = q.x - p.x, sz = q.z - p.z, den = rx * sz - rz * sx;
    if (Math.abs(den) < 1e-9) continue;
    const qx = p.x - ax, qz = p.z - az, u = (qx * sz - qz * sx) / den, v = (qx * rz - qz * rx) / den;
    if (u >= 0 && u <= 1 && v >= 0 && v <= 1) return true;
  }
  return false;
}
function remember() { histTop = (histTop + 1) % RIB_N; hist[histTop].x = H.x; hist[histTop].z = H.z; histN = Math.min(RIB_N, histN + 1); }

function swim(dt) {
  let ax = input.axis.x, az = -input.axis.y; const L = Math.hypot(ax, az);
  if (L > 0.1) { H.ax = ax / L; H.az = az / L; }
  if ((input.pressed("dash") || input.pressed("a") || input.pressed("b")) && S.cool <= 0) {
    let dx = H.ax, dz = H.az, bestD = DASH.aimR;
    const look = (r) => { const ex = r.x - H.x, ez = r.z - H.z, d = Math.hypot(ex, ez);
      if (d < bestD && d > 0.01 && (ex * H.ax + ez * H.az) / d > DASH.aimCos) { bestD = d; dx = ex / d; dz = ez / d; } };
    minnows.each((id, r) => { if (r.data.mode === "hunt" || r.data.mode === "stun") look(r); });
    chargers.each((id, r) => look(r));
    H.dx = dx; H.dz = dz; S.dashT = DASH.time; S.cool = DASH.cool + DASH.time; onDash();
  }
  if (S.dashT > 0) { S.dashT -= dt; H.vx = H.dx * DASH.speed; H.vz = H.dz * DASH.speed; }
  else { H.vx = M.damp(H.vx, ax * SWIM, 12, dt); H.vz = M.damp(H.vz, az * SWIM, 12, dt); }
  S.cool -= dt; H.x += H.vx * dt; H.z += H.vz * dt;
  clampToDisc(H, ARENA - HERO_R, (p, nx, nz) => { const vn = H.vx * nx + H.vz * nz; if (vn > 0) { H.vx -= vn * nx; H.vz -= vn * nz; } });
  if (Math.hypot(H.vx, H.vz) > 0.5) H.yaw = M.angleLerp(H.yaw, Math.atan2(H.vx, H.vz), 14, dt);
}
function contacts(dt) {
  const dashing = S.dashT > 0;
  minnows.each((id, r) => {
    const d = r.data; if (d.mode !== "hunt" && d.mode !== "stun") return;
    if (Math.hypot(r.x - H.x, r.z - H.z) > HERO_R + MINNOW_R + (dashing ? 0.35 : 0)) return;
    if (dashing || d.mode === "stun") { bonk(r, d.mode === "stun"); minnows.free(id); }
    else hurt(r);
  });
  chargers.each((id, r) => {
    const d = r.data; if (d.mode === "leave") return;
    if (Math.hypot(r.x - H.x, r.z - H.z) > HERO_R + CHARGER_R + (dashing ? 0.35 : 0)) return;
    if (dashing || d.mode === "stun") {
      d.hp -= d.mode === "stun" ? 2 : 1; d.v.x = H.dx * 12; d.v.z = H.dz * 12; d.mode = "stun"; d.stun = 1.2; S.dashT = 0; H.vx *= -0.3; H.vz *= -0.3;
      bonk(r, false, true);
      if (d.hp <= 0) { teles[d.tele].used = false; hideTele(d.tele); chargers.free(id); onChargerDown(r); S.score += 30; dropShells(r.x, r.z, 2); }
    } else if (d.mode === "charge" || d.mode === "aim" || d.mode === "rest") hurt(r);
  });
  shells.each((id, r) => {
    const d = r.data, dist = Math.hypot(r.x - H.x, r.z - H.z);
    if (dist < 2.6) { steer(d.v, r, H, 16, 8, dt); r.x += d.v.x * dt; r.z += d.v.z * dt; }
    if (dist < HERO_R + 0.45) { shells.free(id); S.score += 25; onShell(r); }
  });
}
function bonk(r, stunned, big = false) {
  S.combo = S.comboT > 0 ? S.combo + 1 : 1; S.comboT = 1.5; S.bonks++;
  if (!big) S.score += (stunned ? 20 : 10) * Math.min(5, S.combo);
  loop.hitstop(70); onBonk(r, S.combo, stunned, big);
}
function hurt(r) {
  if (S.inv > 0 || S.dashT > 0) return;
  const ex = H.x - r.x, ez = H.z - r.z, L = Math.hypot(ex, ez) || 1;
  H.vx = (ex / L) * 14; H.vz = (ez / L) * 14; S.inv = 1.3; S.combo = 0;
  if (r.data.mode === "hunt") r.data.mode = "home";
  if (!params.god) S.lives--;
  onHurt(r, S.lives);
  if (S.lives <= 0) over();
}
function waves(dt) {
  if (S.gap > 0) { S.gap -= dt; if (S.gap <= 0) beginWave(S.wave + 1); return; }
  S.waveT += dt;
  let left = chargers.count + climaxLeft(); minnows.each((id, r) => { if (r.data.mode === "hunt" || r.data.mode === "stun") left++; });
  if (left === 0) endWave(true); else if (S.waveT > WAVE_MAX && !climaxLeft()) endWave(false);
}
function dropShells(x, z, n) {
  for (let i = 0; i < n && shells.count < 12; i++) { const a = M.rand(0, 6.28), r = M.rand(1, 2.5), p = { x: x + Math.cos(a) * r, z: z + Math.sin(a) * r };
    clampToDisc(p, ARENA - 1.5); shells.spawn({ x: p.x, y: Y, z: p.z, scale: 1, data: { v: { x: 0, z: 0 }, ph: M.rand(0, 6) } }); }
}
function spawnShells(dt) {
  S.shellT -= dt; if (S.shellT > 0 || shells.count >= 4) return;
  S.shellT = 3.2; const p = spawnClear({ minR: 2, maxR: ARENA - 2, avoid: [{ x: H.x, z: H.z, r: 4 }] });
  if (p) shells.spawn({ x: p.x, y: Y, z: p.z, scale: 1, data: { v: { x: 0, z: 0 }, ph: M.rand(0, 6) } });
}

function step(dt, t) {
  if (S.screen !== "play") {
    if (input.pressed("start") && shell.canAccept()) start();
    else { attract(dt, t); rig.orbit({ x: 0, y: 0, z: 0 }, { radius: 21, height: 17, speed: 0.12, k: 2.5 }); }
  }
  if (S.screen === "play") {
    S.t += dt; S.inv -= dt; S.comboT -= dt;
    swim(dt); waves(dt); spawnShells(dt); climax(dt, t);
    camT.x = H.x + H.vx * 0.22; camT.z = H.z + H.vz * 0.22;
    rig.top(camT, CAM);
  }
  if (dt > 0) remember();
  sharks(dt, t);
  if (S.screen === "play") contacts(dt);
  hudScore(S.score);
  art(dt, t);
  rig.update(dt, t);
}
function attract(dt, t) {   // the title and over screens: the fish loops a figure-eight and a few hunters chase its ribbon
  const px = H.x, pz = H.z; H.x = Math.sin(t * 0.55) * 6; H.z = Math.sin(t * 1.1) * 3.2;
  H.vx = (H.x - px) / Math.max(dt, 1e-3); H.vz = (H.z - pz) / Math.max(dt, 1e-3);
  if (dt > 0) H.yaw = M.angleLerp(H.yaw, Math.atan2(H.vx, H.vz), 10, dt);
  let hunting = 0; minnows.each((id, r) => { if (r.data.mode === "hunt" || r.data.mode === "stun") hunting++; });
  if (hunting < 5 && M.chance(0.02)) minnows.each((id, r) => { if (hunting < 5 && r.data.mode === "ring" && M.chance(0.05)) { r.data.mode = "hunt"; hunting++; } });
  S.wave = 0;
}

const snapshot = () => {
  let hunting = 0; minnows.each((id, r) => { if (r.data.mode === "hunt" || r.data.mode === "stun") hunting++; });
  return { screen: S.screen, stage: S.stage, score: S.score, best: record.get(), lives: S.lives, wave: S.wave,
    enemies: hunting + chargers.count, horde: minnows.count, shells: shells.count, dashing: S.dashT > 0, bonks: S.bonks,
    entities: minnows.count + chargers.count + shells.count, focus: { x: +H.x.toFixed(3), y: Y, z: +H.z.toFixed(3) }, ...climaxState() };
};
const commands = {
  die: over,
  at: (stage) => { if (ACTS.some(([n]) => n === String(stage))) S.startStage = String(stage); },
};

// ── ART ──
const scene = G.scene, V = new THREE.Vector3();
scene.fog = new THREE.FogExp2(PALETTE[0], 0.021);
lights(scene, { preset: "hemi+sun", sky: "#6a5cff", ground: PALETTE[0], sun: "#bff8ff", sunIntensity: 0.5, hemiIntensity: 0.6 });

// the seafloor: two dark bands, a polar neon grid drawn into its emissive map, sunk below the swimming plane
const FLOOR_Y = -2.2;
const floor = heightfield({ size: 96, seg: 72, amp: 0.9, octaves: 3, seed: 11, bands: [[-0.15, "#0a0b24"], [9, PALETTE[1]]] });
{
  const g = floor.mesh.geometry, P = g.attributes.position, uv = new Float32Array(P.count * 2);
  for (let i = 0; i < P.count; i++) { uv[i * 2] = P.getX(i) / 96 + 0.5; uv[i * 2 + 1] = 0.5 - P.getZ(i) / 96; }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  const grid = canvasTex(1024, 1024, (c, w, h) => {
    c.fillStyle = "#000"; c.fillRect(0, 0, w, h); c.translate(w / 2, h / 2); const u = w / 96;
    c.strokeStyle = "#ffffff"; c.lineWidth = 2;
    for (let r = 3; r < 48; r += 3) { c.globalAlpha = r === 15 ? 0 : 0.5 * (1 - r / 60); c.beginPath(); c.arc(0, 0, r * u, 0, Math.PI * 2); c.stroke(); }
    for (let a = 0; a < 24; a++) { c.globalAlpha = 0.3; c.beginPath(); c.moveTo(Math.cos(a * Math.PI / 12) * 3 * u, Math.sin(a * Math.PI / 12) * 3 * u);
      c.lineTo(Math.cos(a * Math.PI / 12) * 48 * u, Math.sin(a * Math.PI / 12) * 48 * u); c.stroke(); }
  });
  floor.mesh.material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: "#3f33e0", emissiveMap: grid });
  floor.mesh.position.y = FLOOR_Y; scene.add(floor.mesh);
}
const rimRing = part(new THREE.TorusGeometry(ARENA + 0.1, 0.07, 6, 160), mat.hot(PALETTE[1], 3.2), [0, Y - 0.4, 0], scene, { rot: [Math.PI / 2, 0, 0] });
const floorGlow = part(new THREE.PlaneGeometry(1, 1), mat.unlit(PALETTE[2], { opacity: 0.22 }), [0, FLOOR_Y + 1.0, 0], scene, { rot: [-Math.PI / 2, 0, 0], scale: 5 });
floorGlow.material.map = glowTex(); floorGlow.material.blending = THREE.AdditiveBlending; floorGlow.material.depthWrite = false;

// kelp that sways (wind), glowing-edged reef rocks, plankton with real parallax
const kelpMat = wind(mat.lambert("#1c7f7a", { emissive: "#06343a" }), { amp: 0.09, freq: 1.1, axis: "xz" });
scatter(scene, geo.extrude("M-0.3 0 Q-0.6 2 -0.1 4 Q0.25 6 0 7.5 Q0.5 5.5 0.3 3.5 Q0.6 1.5 0.3 0 Z", 0.1, { bevel: 0 }), kelpMat,
  { count: 46, area: [-30, 30, -30, 30], y: FLOOR_Y, scale: [0.7, 1.3], avoid: [{ x: 0, z: 0, r: 18.5 }], seed: 4 });
const rockMat = rim(mat.lambert(PALETTE[1], { flat: true }), { color: "#7d6bff", power: 2.2, strength: 0.9 });
scatter(scene, deform(geo.ico(1.3, 1), { amount: 0.35, scale: 1.4, seed: 3 }), rockMat,
  { count: 30, area: [-32, 32, -32, 32], y: FLOOR_Y + 0.3, scale: [0.6, 1.7], avoid: [{ x: 0, z: 0, r: 17 }], seed: 9 });
const plankton = starfield(scene, { n: 900, radius: 30, size: 3.4, tints: [PALETTE[2], "#8f7bff", PALETTE[4], "#ffffff"] });
plankton.onBeforeRender = () => {}; plankton.matrixAutoUpdate = true; plankton.scale.set(1, 0.32, 1); plankton.position.y = FLOOR_Y + 1;

// jellyfish drifting beyond the rim: a lathe bell and trailing lines, pulsing
const jellyBell = geo.lathe([[0, 0.9], [0.45, 0.8], [0.72, 0.45], [0.8, 0.05], [0.62, 0.02], [0.3, 0.2], [0, 0.25]], 18);
const tentGeo = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 16 }, (_, i) => new THREE.Vector3(Math.cos(i) * 0.4, -((i % 2) ? 1.8 : 0), Math.sin(i) * 0.4)));
const jellies = [0, 1, 2, 3, 4, 5].map((i) => {
  const g = new THREE.Group(), a = i * 1.05 + 0.4, r = 20 + (i % 3) * 2.2;
  part(jellyBell, mat.hot(i % 2 ? "#8f7bff" : "#ff8fd8", 0.9), [0, 0, 0], g);
  g.add(new THREE.LineSegments(tentGeo, new THREE.LineBasicMaterial({ color: "#b8a8ff", transparent: true, opacity: 0.6 })));
  g.position.set(Math.cos(a) * r, 1, Math.sin(a) * r); g.userData = { a, r, ph: i * 1.7 }; scene.add(g); return g;
});

// the hero: a neon reef fish — a lathe body, extruded tail and fins, hot stripe rings, nose +z
const hero = new THREE.Group(); hero.scale.setScalar(1.15); scene.add(hero);
const bodyMat = rim(mat.standard("#0b3a44", { emissive: PALETTE[2], emissiveIntensity: 0.45, roughness: 0.35 }), { color: "#c8fff6", power: 2, strength: 1 });
const finMat = mat.hot(PALETTE[2], 1.35);
const heroBody = new THREE.Group(); hero.add(heroBody);
part(geo.lathe([[0, -0.95], [0.2, -0.78], [0.38, -0.35], [0.46, 0.08], [0.4, 0.5], [0.24, 0.84], [0, 1.02]], 20), bodyMat, [0, 0, 0], heroBody, { rot: [Math.PI / 2, 0, 0], scale: [1, 1, 0.72] });
for (const [z, r] of [[0.28, 0.44], [-0.28, 0.4]]) part(geo.torus(r, 0.045), finMat, [0, 0, z], heroBody, { scale: [1, 0.72, 1] });
const tail = new THREE.Group(); tail.position.z = -0.85; heroBody.add(tail);
part(geo.extrude("M0 0 Q0.55 0.45 1.0 1.15 Q0.35 0.9 0 0.7 Q-0.35 0.9 -1.0 1.15 Q-0.55 0.45 0 0 Z", 0.06, { bevel: 0.02 }), finMat, [0, 0, 0], tail, { rot: [-Math.PI / 2, 0, 0] });
const finR = part(geo.extrude("M0 0 L0.75 0.3 Q0.9 0.55 0.6 0.6 L0 0.35 Z", 0.05, { bevel: 0.02 }), finMat, [0.36, -0.05, 0.3], heroBody, { rot: [-Math.PI / 2, 0, 0] });
mirror(finR, "x");
part(geo.extrude("M0 0 Q0.1 0.45 -0.45 0.6 L-0.6 0 Z", 0.05, { bevel: 0.02 }), finMat, [0, 0.3, 0.05], heroBody, { rot: [0, Math.PI / 2, 0] });
for (const s of [1, -1]) {
  part(geo.sphere(0.1, 10), mat.hot("#ffffff", 1.2), [0.27 * s, 0.1, 0.6], heroBody);
  part(geo.sphere(0.055, 8), mat.unlit(PALETTE[0]), [0.33 * s, 0.13, 0.64], heroBody);
}
const heroFlash = hitFlash(heroBody);
const trail = new Trail(scene, hero, { color: PALETTE[2], length: RIB_N, width: 0.62 });
trail.material.uniforms.uColor.value.multiplyScalar(1.35);   // the ribbon is information (it stuns), so it blooms

// the shark: ONE merged, vertex-shaded geometry for every instance (lathe body, extruded fins and tail, dark eyes)
function sharkGeometry() {
  const shade = (g, k, eye = false) => {
    g = g.index ? g.toNonIndexed() : g; const N = g.attributes.normal, c = new Float32Array(N.count * 3);
    for (let i = 0; i < N.count; i++) { const v = eye ? 0.06 : k * (0.55 + 0.45 * Math.max(0, N.getY(i))); c.set([v, v, v], i * 3); }
    g.setAttribute("color", new THREE.BufferAttribute(c, 3)); return g;
  };
  const body = geo.lathe([[0, -1.25], [0.08, -1.05], [0.2, -0.55], [0.33, 0.05], [0.36, 0.45], [0.27, 0.85], [0.1, 1.12], [0, 1.18]], 10).clone().rotateX(Math.PI / 2).scale(1, 0.72, 1);
  const finL = geo.extrude("M0 0 Q-0.5 0.35 -0.78 0.95 Q-0.45 0.75 0 0.5 Z", 0.05, { bevel: 0 }).clone().rotateX(-Math.PI / 2).translate(-0.24, -0.08, 0.38);
  const finRr = geo.extrude("M0 0 Q0.5 0.35 0.78 0.95 Q0.45 0.75 0 0.5 Z", 0.05, { bevel: 0 }).clone().rotateX(-Math.PI / 2).translate(0.24, -0.08, 0.38);
  const tailG = geo.extrude("M0 0 Q0.45 0.5 0.75 1.05 Q0.62 0.55 0.32 0.05 Q0.5 -0.25 0.55 -0.55 Q0.25 -0.35 0 -0.1 Z", 0.06, { bevel: 0 }).clone().rotateY(Math.PI / 2).rotateZ(0.45).translate(0, 0.02, -1.1);
  const dorsal = geo.extrude("M0 0 L-0.15 0.6 L-0.45 0.66 L-0.62 0 Z", 0.05, { bevel: 0 }).clone().rotateY(Math.PI / 2).translate(0, 0.16, 0.25);
  const eyes = [1, -1].map((s) => geo.sphere(0.07, 6).clone().translate(0.2 * s, 0.1, 0.62));
  return mergeGeometries([shade(body, 0.9), shade(finL, 1), shade(finRr, 1), shade(tailG, 1), shade(dorsal, 0.8), ...eyes.map((e) => shade(e, 0, true))]);
}
const sharkGeo = sharkGeometry(), sharkMat = mat.hot("#ffffff", 1.3); sharkMat.vertexColors = true;
const minnows = new InstancedPool(scene, sharkGeo, sharkMat, { max: HORDE, colors: true });
const chargerMat = mat.hot("#ffffff", 1.45); chargerMat.vertexColors = true;
const chargers = new InstancedPool(scene, sharkGeo, chargerMat, { max: 6, colors: true });
const MINNOW_TINTS = ["#b8428f", "#c94a9f", "#9a3a8a", "#d0559f"];
function minnowColor() { return M.pick(MINNOW_TINTS); }

// shells: a bumpy lathe conch with gold/cream stripes baked into vertex colours
const shellGeo = (() => {
  let g = deform(geo.lathe([[0, 0], [0.3, 0.08], [0.46, 0.26], [0.41, 0.46], [0.31, 0.63], [0.18, 0.8], [0.06, 0.96], [0, 1.02]], 14), { amount: 0.05, scale: 5, seed: 2 });
  g = g.toNonIndexed(); const P = g.attributes.position, c = new Float32Array(P.count * 3);
  for (let i = 0; i < P.count; i++) { const s = Math.sin(P.getY(i) * 19) > 0 ? 1 : 0.62; c.set([s, s * 0.95, s * 0.8], i * 3); }
  g.setAttribute("color", new THREE.BufferAttribute(c, 3)); return g.rotateZ(Math.PI / 2).translate(0.5, 0, 0);
})();
const shellMat = mat.hot(PALETTE[4], 1.2); shellMat.vertexColors = true;
const shells = new InstancedPool(scene, shellGeo, shellMat, { max: 12 });

// charger telegraphs: a dim full-length lane and a hot fill that grows for 0.9 s
const laneGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
const teles = Array.from({ length: 6 }, () => {
  const mk = (c, o) => { const m = new THREE.Mesh(laneGeo, mat.unlit(c, { opacity: o })); m.material.blending = THREE.AdditiveBlending; m.material.depthWrite = false; m.renderOrder = 3; m.visible = false; scene.add(m); return m; };
  return { lane: mk(PALETTE[3], 0.22), fill: mk("#ff3d8b", 0.7), used: false };
});
function showTele(i, r, d, k) {
  const T = teles[i], yaw = Math.atan2(d.dx, d.dz), pulse = 0.6 + 0.4 * Math.sin(k * 40);
  for (const [m, len, w] of [[T.lane, 22, 1.5], [T.fill, 22 * Math.min(1, k), 1.1]]) { m.visible = true; m.position.set(r.x, 0.05, r.z); m.rotation.y = yaw; m.scale.set(w, 1, Math.max(0.01, len)); }
  T.fill.material.opacity = 0.45 + 0.4 * pulse; r.color.set(k % 0.2 < 0.1 ? "#ffffff" : PALETTE[3]);
}
function hideTele(t) { const T = typeof t === "number" ? teles[t] : t; if (T) { T.lane.visible = T.fill.visible = false; } }

// juice objects
const sparks = new Sparks(scene, { colors: [PALETTE[3], PALETTE[4], "#ffffff"], max: 500, size: 0.55 });
const tl = new Timeline(scene, { colors: [PALETTE[4], PALETTE[2], PALETTE[3]] });
const flash = screenFlash("#flash", { color: PALETTE[3] });
const sfx = defineSfx({
  dash: [{ noise: { f0: 500, f1: 2600, dur: 0.18, vol: 0.22, q: 1.5 } }, { tone: { type: "triangle", f0: 330, f1: 740, dur: 0.12, vol: 0.14 } }],
  bonk: [{ tone: { type: "square", f0: 260, f1: 120, dur: 0.11, vol: 0.28 } }, { noise: { f0: 2000, f1: 500, dur: 0.09, vol: 0.28, q: 3 } }],
  zap: [{ tone: { type: "sawtooth", f0: 1500, f1: 2600, dur: 0.07, vol: 0.12 } }, { tone: { type: "sine", f0: 2400, f1: 800, dur: 0.16, vol: 0.12 }, at: 0.05 }],
  shell: [{ tone: { type: "sine", f0: 784, dur: 0.07, vol: 0.24 } }, { tone: { type: "sine", f0: 1175, dur: 0.12, vol: 0.2 }, at: 0.06 }, { tone: { type: "triangle", f0: 1568, dur: 0.16, vol: 0.1 }, at: 0.12 }],
  hurt: [{ tone: { type: "sawtooth", f0: 320, f1: 55, dur: 0.38, vol: 0.3 } }, { noise: { f0: 500, f1: 110, dur: 0.3, vol: 0.3, type: "lowpass" } }],
  warn: { tone: { type: "square", f0: 587, f1: 622, dur: 0.14, vol: 0.1 }, throttle: 0.25 },
  wave: [{ tone: { type: "triangle", f0: 294, dur: 0.1, vol: 0.2 } }, { tone: { type: "triangle", f0: 311, dur: 0.1, vol: 0.2 }, at: 0.1 }, { tone: { type: "triangle", f0: 440, dur: 0.22, vol: 0.2 }, at: 0.2 }],
  clear: [{ tone: { type: "sine", f0: 587, dur: 0.1, vol: 0.2 } }, { tone: { type: "sine", f0: 880, dur: 0.1, vol: 0.2 }, at: 0.09 }, { tone: { type: "sine", f0: 1175, dur: 0.3, vol: 0.2 }, at: 0.18 }],
}, { seed: 7 });
const VOICES = { lead: { wave: "square", env: [0.01, 0.12, 0.35, 0.18] }, bass: { wave: "sawtooth", env: [0.01, 0.2, 0.55, 0.12] }, drums: { kit: "808", pattern: "k.h.s.hkk.h.s.hh" } };
const reefSong = song({ bpm: 108, key: 62, scale: "phrygian", motif: [62, null, 63, 65, 69, null, 67, 65, 63, null, 62, 58, 60, 63, 62, null], voices: VOICES, bars: 4, seed: 5 });
playSong(reefSong); setIntensity(0.25);

// DOM juice: score pops that ride the world, and the wave banner
const pops = Array.from({ length: 8 }, () => { const el = document.createElement("div"); el.className = "pop"; el.hidden = true; document.querySelector("#pops").append(el); return { el, t: 0, x: 0, z: 0 }; });
let popI = 0;
function pop(x, z, text, cls = "") { const p = pops[popI++ % pops.length]; Object.assign(p, { t: 0.9, x, z }); p.el.textContent = text; p.el.className = "pop " + cls; p.el.hidden = false; }
const bannerEl = document.querySelector("#banner"), bannerBig = document.querySelector("#banner-big"), bannerSmall = document.querySelector("#banner-small");
let bannerT = 0;
function banner(big, small, cls = "") { bannerBig.textContent = big; bannerSmall.textContent = small; bannerEl.className = cls; bannerT = 2; bannerEl.hidden = false; }

function onStart() { setIntensity(0.55); rig.kick(-8, 0.5); document.querySelector("#best").parentElement.classList.remove("new"); }
function onOver(isNew) { setIntensity(0.25); rig.shake(0.5, 0.3); if (isNew) document.querySelector("#best").parentElement.classList.add("new"); }
function onWave(n, stage) {
  sfx.wave(); banner(`WAVE ${n}`, stage === "deep" && n === ACTS[1][1] ? "THE DEEP — chargers!" : n === 1 ? "the reef wakes up" : "faster…", stage);
  if (stage === "deep") setIntensity(1);
  minnows.each((id, r) => { if (r.data.mode === "hunt") r.color.set(PALETTE[3]); });
}
function onClear(n) { sfx.clear(); banner(`WAVE ${n} CLEAR`, `+${100 * n}`, "clear"); tl.shockwave([H.x, Y, H.z], { color: "#007a6c", size: 11, dur: 0.7, flat: true }); }
function onDash() {
  sfx.dash({ pitch: 1 + Math.min(4, S.combo) * 0.06 }); rig.kick(7, 0.3);
  for (let i = 0; i < 10; i++) sparks.emit(H.x, Y, H.z, -H.dx * M.rand(3, 8) + M.rand(-1.5, 1.5), M.rand(0, 1), -H.dz * M.rand(3, 8) + M.rand(-1.5, 1.5), PALETTE[2], 0.35, 3);
}
function onBonk(r, combo, stunned, big) {
  sfx.bonk({ pitch: 1 + Math.min(combo - 1, 6) * 0.12 }); rig.shake(big ? 0.5 : 0.35, 0.25);
  sparks.burst([r.x, Y, r.z], { colors: [PALETTE[3], PALETTE[4], "#ffffff"], n: big ? 34 : 22, speed: big ? 11 : 8, life: 0.5, up: 1, grav: -4 });
  tl.shockwave([r.x, Y, r.z], { color: PALETTE[4], size: big ? 5 : 3, dur: 0.35, flat: true });
  pop(r.x, r.z, big ? "BONK!!" : combo > 1 ? `BONK ×${Math.min(5, combo)}` : stunned ? "ZAP BONK!" : "BONK!", combo > 2 ? "hot" : "");
}
function onHurt(r, left) {
  sfx.hurt(); rig.shake(0.6, 0.4); flash.hit(0.45, PALETTE[3]);
  if (lives[left]) lives[left].classList.add("gone");
  sparks.burst([H.x, Y, H.z], { colors: [PALETTE[2], "#ffffff"], n: 18, speed: 7, life: 0.5 });
}
function onStun(r, big) {
  if (S.screen === "play") sfx.zap({ pitch: big ? 0.7 : 1 }); r.color.set("#c9fff7");
  tl.flash([r.x, Y + 0.3, r.z], { color: PALETTE[2], size: big ? 4 : 2.2, dur: 0.3 });
  if (S.screen === "play") pop(r.x, r.z, big ? "ZAPPED!" : "zap", "zap");
}
function onCharge(r) { sfx.warn({ pitch: 0.7 }); rig.shake(0.15, 0.2); tl.shockwave([r.x, Y, r.z], { color: PALETTE[3], size: 3, dur: 0.3, flat: true }); }
function onTelegraph() { if (S.screen === "play") sfx.warn(); }
function onChargerDown(r) { tl.shockwave([r.x, Y, r.z], { color: PALETTE[3], size: 7, dur: 0.6, flat: true }); pop(r.x, r.z, "+30 SHARK DOWN", "hot"); }
function onShell(r) {
  sfx.shell({ pitch: 1 + (S.score % 7) * 0.02 }); pop(r.x, r.z, "+25", "gold");
  sparks.burst([r.x, Y, r.z], { colors: [PALETTE[4], "#ffffff"], n: 14, speed: 5, life: 0.45, up: 2, grav: -3 });
}

function art(dt, t) {   // per-step animation of everything this game draws
  const moving = Math.min(1, Math.hypot(H.vx, H.vz) / SWIM), dashing = S.dashT > 0;
  hero.position.set(H.x, Y + Math.sin(t * 3) * 0.08, H.z); hero.rotation.y = H.yaw;
  heroBody.rotation.z = M.damp(heroBody.rotation.z, -M.clamp((H.vx * Math.cos(H.yaw) - H.vz * Math.sin(H.yaw)) * 0.03, -0.4, 0.4), 8, dt);
  tail.rotation.y = Math.sin(t * (8 + 10 * moving)) * (0.25 + 0.35 * moving);
  heroBody.scale.set(dashing ? 0.8 : 1, 1, dashing ? 1.35 : 1);
  heroFlash.set(S.inv > 0 ? (Math.floor(S.inv * 10) % 2 ? 1 : 0) : 0, PALETTE[3]);
  hero.visible = !(S.inv > 0 && Math.floor(S.inv * 20) % 3 === 0);
  floorGlow.position.set(H.x, FLOOR_Y + 1, H.z); floorGlow.scale.setScalar(dashing ? 7 : 5);
  trail.material.uniforms.uWidth.value = dashing ? 0.8 : 0.62;
  trail.update(dt); sparks.update(dt); tl.update(dt); flash.update(dt);
  shells.each((id, r) => { r.rotY += dt * 2.2; r.y = Y + 0.2 + Math.sin(t * 3 + r.data.ph) * 0.15; });
  for (const j of jellies) { const u = j.userData; u.a += dt * 0.04; j.position.set(Math.cos(u.a) * u.r, 0.6 + Math.sin(t * 0.8 + u.ph) * 0.6, Math.sin(u.a) * u.r);
    j.scale.set(1 + Math.sin(t * 2.4 + u.ph) * 0.12, 1 - Math.sin(t * 2.4 + u.ph) * 0.12, 1 + Math.sin(t * 2.4 + u.ph) * 0.12); }
  plankton.rotation.y += dt * 0.01;
  rimRing.material.color.set(PALETTE[1]).multiplyScalar(3 + Math.sin(t * 2) * 0.6);
  for (const p of pops) if (p.t > 0) { p.t -= dt; if (p.t <= 0) p.el.hidden = true; }
  if (bannerT > 0) { bannerT -= dt; const k = bannerT > 1.7 ? (2 - bannerT) / 0.3 : Math.min(1, bannerT / 0.4);
    bannerEl.style.opacity = k.toFixed(3); bannerEl.style.transform = `translate(-50%, -50%) scale(${(0.8 + 0.2 * Math.min(1, k)).toFixed(3)})`; if (bannerT <= 0) bannerEl.hidden = true; }
}
function render(alpha, t) {
  tick(t); minnows.sync(); chargers.sync(); shells.sync();
  const w = G.size.w, h = G.size.h;
  for (const p of pops) if (p.t > 0) {
    V.set(p.x, Y + 1 + (0.9 - p.t) * 2, p.z).project(G.camera);
    p.el.style.transform = `translate(${((V.x + 1) / 2 * w).toFixed(1)}px, ${((1 - V.y) / 2 * h).toFixed(1)}px) translate(-50%, -50%) scale(${(1 + p.t * 0.4).toFixed(2)})`;
    p.el.style.opacity = Math.min(1, p.t * 2.5).toFixed(2);
  }
}

function warmList() {   // every pool and fx object, drawn once on the title so the first burst never hitches
  tl.shockwave([0, Y, 0], { color: PALETTE[2], size: 6, dur: 0.6, flat: true }); tl.flash([0, Y, 0], { color: PALETTE[2], size: 2, dur: 0.2 });
  sparks.burst([0, Y, 0], { n: 4, speed: 1, life: 0.1 }); trail.update(1 / 60);
  return [minnows.mesh, chargers.mesh, shells.mesh, sparks.points, trail.mesh, ...teles.flatMap((x) => [x.lane, x.fill]), floorGlow, ...jellies];
}

// ── CLIMAX (polish layer) ──
// The Mega Shark (shape `boss`, catalog/arena-3d.md §4): wave 7, about 90 s in. Three glowing weak points (gold) take
// DASH hits; a readable 3-attack cycle (charge · tail-spin · summon), each telegraphed ≥ 0.8 s; enrage at 50 %; after two
// losses to it, it arrives already missing a weak point (67 %). The Signature deepens here too: your ribbon DAZES it
// mid-charge (weak points take double), and closing a loop with the ribbon LASSOES every shark inside it.
ACTS.push(["boss", 7], ["abyss", 8]);
const BOSS_HP = 9, BOSS_R = 1.35, SPIN_R = 6.8;
const boss = { alive: false, mode: "off", t: 0, x: 0, z: 0, v: { x: 0, z: 0 }, yaw: 0, dx: 0, dz: 1, cycle: 0, enraged: false, daze: 0, hp: 0, losses: 0 };
let lassoCool = 0, ribbonHot = 0, bubbleT = 0, lassos = 0;

// the model, in shark units (nose +z), scaled 3.4×: a dissolving body, neon stripes, teeth, and three gold weak points
const bossG = new THREE.Group(); bossG.scale.setScalar(3.4);
const bossMat = rim(mat.standard("#2a0b2c", { emissive: PALETTE[3], emissiveIntensity: 0.3, roughness: 0.45 }), { color: "#ff9ad6", power: 2, strength: 0.9 });
const burn = dissolve(bossMat, { edgeColor: PALETTE[4], edge: 0.08, glow: 2.5, scale: 1.2 });
const bossStripe = mat.hot(PALETTE[3], 1.6);
const bossBody = new THREE.Group(); bossG.add(bossBody);
part(geo.lathe([[0, -1.25], [0.1, -1.0], [0.24, -0.5], [0.38, 0.05], [0.4, 0.45], [0.3, 0.85], [0.12, 1.12], [0, 1.2]], 20), bossMat, [0, 0, 0], bossBody, { rot: [Math.PI / 2, 0, 0], scale: [1, 1, 0.7] });
for (const [z, r] of [[0.45, 0.38], [0.1, 0.4], [-0.3, 0.33]]) part(geo.torus(r, 0.025), bossStripe, [0, 0, z], bossBody, { scale: [1, 0.7, 1] });
const bFin = part(geo.extrude("M0 0 Q0.5 0.35 0.95 1.0 Q0.55 0.8 0 0.5 Z", 0.06, { bevel: 0.01 }), bossMat, [0.26, -0.06, 0.4], bossBody, { rot: [-Math.PI / 2, 0, 0] });
mirror(bFin, "x");
part(geo.extrude("M0 0 L-0.2 0.7 L-0.55 0.76 L-0.72 0 Z", 0.06, { bevel: 0.01 }), bossMat, [0, 0.22, 0.25], bossBody, { rot: [0, Math.PI / 2, 0] });
const bossTail = new THREE.Group(); bossTail.position.z = -1.15; bossBody.add(bossTail);
part(geo.extrude("M0 0 Q0.45 0.5 0.8 1.1 Q0.62 0.55 0.32 0.05 Q0.5 -0.25 0.58 -0.6 Q0.25 -0.35 0 -0.1 Z", 0.06, { bevel: 0.01 }), bossMat, [0, 0, 0], bossTail, { rot: [0, Math.PI / 2, 0.35] });
part(geo.extrude("M-0.3 0 L-0.22 0.16 L-0.14 0 L-0.05 0.16 L0.04 0 L0.13 0.16 L0.22 0 L0.3 0.16 L0.3 -0.04 L-0.3 -0.04 Z", 0.04, { bevel: 0 }), mat.hot("#ffffff", 1.4), [0, 0.02, 0.92], bossBody, { rot: [-Math.PI / 2, 0, 0], scale: 0.9 });
for (const sx of [1, -1]) part(geo.sphere(0.06, 10), mat.hot("#ff2e63", 2.2), [0.24 * sx, 0.14, 0.72], bossBody);
const weak = [[-0.95, 0.12, -0.42], [0.95, 0.12, -0.42], [0, 0.34, -0.9]].map((p, i) => {
  const g = new THREE.Group(); g.position.set(p[0], p[1], p[2]); bossBody.add(g);
  const core = part(deform(geo.ico(0.2, 1), { amount: 0.25, scale: 3, seed: 5 + i }), mat.hot(PALETTE[4], 1.8), [0, 0, 0], g);
  const halo = part(geo.torus(0.3, 0.03), mat.hot(PALETTE[4], 1.2), [0, 0, 0], g, { rot: [Math.PI / 2, 0, 0] });
  return { g, core, halo, hp: 3, wp: new THREE.Vector3() };
});
const bossLane = { lane: null, fill: null };
for (const [k, c, o] of [["lane", PALETTE[3], 0.24], ["fill", "#ff3d8b", 0.75]]) {
  const m = new THREE.Mesh(laneGeo, mat.unlit(c, { opacity: o })); m.material.blending = THREE.AdditiveBlending; m.material.depthWrite = false; m.renderOrder = 3; m.visible = false; scene.add(m); bossLane[k] = m;
}
const spinRing = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 72).rotateX(-Math.PI / 2), mat.unlit("#ff3d8b", { opacity: 0.8 }));
spinRing.material.blending = THREE.AdditiveBlending; spinRing.material.depthWrite = false; spinRing.renderOrder = 3; spinRing.visible = false; scene.add(spinRing);
const bossBar = document.querySelector("#bossbar"), bossFill = document.querySelector("#bossfill");
const bossSong = song({ bpm: 132, key: 62, scale: "phrygian", motif: [62, 62, 63, null, 62, 62, 65, 63, 62, 62, 70, 69, 67, 65, 63, null],
  voices: { lead: { wave: "sawtooth", env: [0.005, 0.1, 0.45, 0.1] }, bass: { wave: "square", env: [0.005, 0.12, 0.7, 0.08] }, drums: { kit: "808", pattern: "x.k.s.kxk.s.s.kh" } }, bars: 4, seed: 9 });
const bossSfx = defineSfx({
  roar: [{ noise: { f0: 220, f1: 90, dur: 0.8, vol: 0.35, type: "lowpass", q: 2 } }, { tone: { type: "sawtooth", f0: 110, f1: 65, dur: 0.8, vol: 0.25 } }],
  crack: [{ tone: { type: "square", f0: 880, f1: 220, dur: 0.18, vol: 0.3 } }, { noise: { f0: 3000, f1: 600, dur: 0.25, vol: 0.3, q: 2 } }, { tone: { type: "sine", f0: 1760, dur: 0.2, vol: 0.15 }, at: 0.08 }],
  clang: [{ tone: { type: "triangle", f0: 1200, f1: 1100, dur: 0.18, vol: 0.2 } }, { tone: { type: "triangle", f0: 1790, dur: 0.12, vol: 0.12 } }],
  lasso: [{ tone: { type: "sine", f0: 587, f1: 1175, dur: 0.25, vol: 0.2 } }, { tone: { type: "triangle", f0: 880, dur: 0.12, vol: 0.14 }, at: 0.1 }, { tone: { type: "triangle", f0: 1319, dur: 0.2, vol: 0.14 }, at: 0.2 }],
  down: [{ noise: { f0: 900, f1: 60, dur: 1.4, vol: 0.4, type: "lowpass" } }, { tone: { type: "sawtooth", f0: 196, f1: 49, dur: 1.2, vol: 0.28 } }],
}, { seed: 11 });

function climaxWave(n) {
  if (actOf(n) !== "boss") return false;
  const a = Math.atan2(-H.z, -H.x) + M.rand(-0.5, 0.5);
  Object.assign(boss, { alive: true, mode: "enter", t: 0, x: Math.cos(a) * 26, z: Math.sin(a) * 26, v: { x: 0, z: 0 }, cycle: 0, enraged: false, daze: 0 });
  weak.forEach((w, i) => { w.hp = boss.losses >= 2 && i === 0 ? 0 : 3; w.g.visible = w.hp > 0; });
  boss.hp = weak.reduce((s2, w) => s2 + w.hp, 0); boss.yaw = Math.atan2(-boss.x, -boss.z);
  burn.set(0); bossMat.emissive.set(PALETTE[3]); bossStripe.color.set(PALETTE[3]).multiplyScalar(1.6);
  scene.add(bossG); bossBar.hidden = false; bossBar.classList.remove("angry"); playSong(bossSong); setIntensity(0.6);
  banner("MEGA SHARK!", boss.losses >= 2 ? "it looks tired… hit the gold!" : "hit the gold weak points!", "deep"); bossSfx.roar(); rig.shake(0.5, 0.6);
  return true;
}
const climaxLeft = () => (boss.alive ? 1 : 0);
function climaxReset() {
  boss.alive = false; boss.mode = "off"; bossG.removeFromParent(); bossBar.hidden = true;
  bossLane.lane.visible = bossLane.fill.visible = spinRing.visible = false; lassoCool = 0; ribbonHot = 0;
}
function climaxOver() { if (boss.alive) boss.losses++; climaxReset(); playSong(reefSong); }
function climaxState() { return { lassos, boss: boss.alive ? { mode: boss.mode, hp: boss.hp, enraged: boss.enraged } : null }; }

function bossHurtsHero() {   // body contact: three circles along the spine, and the fish is pushed clear
  const fx = Math.sin(boss.yaw), fz = Math.cos(boss.yaw), pts = [-2.2, 0, 2.6].map((k) => ({ x: boss.x + fx * k, z: boss.z + fz * k, r: BOSS_R + (k ? 0 : 0.5) }));
  const before = { x: H.x, z: H.z };
  if (!pushOutCircles(H, HERO_R, pts)) return false;
  if (S.dashT > 0) { S.dashT = 0; H.vx = (H.x - before.x) * 60; H.vz = (H.z - before.z) * 60; bossSfx.clang(); pop(H.x, H.z, "CLANG", "zap"); rig.shake(0.2, 0.15); return false; }
  hurt({ x: boss.x, z: boss.z, data: {} }); return true;
}
function bossStrikes() {   // a DASH into a gold weak point
  if (S.dashT <= 0) return;
  for (const w of weak) {
    if (w.hp <= 0) continue; w.g.getWorldPosition(w.wp);
    if (Math.hypot(w.wp.x - H.x, w.wp.z - H.z) > HERO_R + 1.0) continue;
    S.dashT = 0; H.vx = -H.dx * 12; H.vz = -H.dz * 12; S.inv = Math.max(S.inv, 0.4);
    hitWeak(w, boss.daze > 0 ? 2 : 1); return;
  }
}
function hitWeak(w, dmg) {
  w.g.getWorldPosition(w.wp); w.hp = Math.max(0, w.hp - dmg); boss.hp = weak.reduce((s2, x) => s2 + x.hp, 0); S.score += 50 * dmg;
  loop.hitstop(90); rig.shake(0.5, 0.3); bossSfx.crack({ pitch: 1 + (BOSS_HP - boss.hp) * 0.05 });
  sparks.burst([w.wp.x, Y + 1, w.wp.z], { colors: [PALETTE[4], "#ffffff", PALETTE[3]], n: 40, speed: 12, life: 0.6, up: 2 });
  tl.shockwave([w.wp.x, Y, w.wp.z], { color: PALETTE[4], size: 6, dur: 0.45, flat: true });
  pop(w.wp.x, w.wp.z, dmg > 1 ? "DAZED ×2!" : "WEAK POINT!", "gold");
  if (w.hp <= 0) { w.g.visible = false; tl.flash([w.wp.x, Y + 1, w.wp.z], { color: PALETTE[4], size: 7, dur: 0.4 }); }
  if (!boss.enraged && boss.hp <= BOSS_HP / 2) enrage();
  if (boss.hp <= 0) bossDown();
}
commands.boss = () => { const w = weak.find((x) => x.hp > 0); if (boss.alive && boss.mode !== "dying" && w) hitWeak(w, 3); };   // test hook: break one weak point
function enrage() {
  boss.enraged = true; bossMat.emissive.set("#ff2e63"); bossStripe.color.set("#ff2e63").multiplyScalar(2);
  bossBar.classList.add("angry"); banner("IT'S ANGRY!", "faster attacks", "deep"); bossSfx.roar({ pitch: 1.3 }); flash.hit(0.35, PALETTE[3]); setIntensity(1);
}
function bossDown() {
  boss.mode = "dying"; boss.t = 0; loop.slowmo(0.3, 1.5); bossLane.lane.visible = bossLane.fill.visible = spinRing.visible = false;
  bossSfx.down(); banner("MEGA SHARK DOWN!", "+1000", "clear"); S.score += 1000; flash.hit(0.3, PALETTE[4]);
  minnows.each((id, r) => { if (r.data.mode === "hunt" || r.data.mode === "stun") r.data.mode = "home"; });
  tl.every(0.16, () => { const a = M.rand(0, 6.28), k = M.rand(0, 3);
    sparks.burst([boss.x + Math.cos(a) * k, Y + 1, boss.z + Math.sin(a) * k], { colors: [PALETTE[3], PALETTE[4], "#ffffff"], n: 24, speed: 10, life: 0.6 });
    tl.shockwave([boss.x, Y, boss.z], { color: M.pick([PALETTE[3], PALETTE[4]]), size: M.rand(5, 10), dur: 0.5, flat: true }); rig.shake(0.35, 0.2); }, 9);
}
function bossTele(k, width) {
  for (const [m, len, w] of [[bossLane.lane, 34, width], [bossLane.fill, 34 * Math.min(1, k), width * 0.75]]) {
    m.visible = true; m.position.set(boss.x, 0.06, boss.z); m.rotation.y = Math.atan2(boss.dx, boss.dz); m.scale.set(w, 1, Math.max(0.01, len)); }
  bossLane.fill.material.opacity = 0.5 + 0.35 * Math.sin(k * 45);
}
function bossStep(dt, t) {
  const B = boss; if (!B.alive) return; B.t += dt; B.daze -= dt;
  const fast = B.enraged ? 0.8 : 1, face = (x, z, k) => { B.yaw = M.angleLerp(B.yaw, Math.atan2(x - B.x, z - B.z), k, dt); };
  const next = () => { B.mode = ["chargeTel", "spinTel", "summonTel"][B.cycle++ % 3]; B.t = 0; if (B.mode === "chargeTel") { const L = Math.hypot(H.x - B.x, H.z - B.z) || 1; B.dx = (H.x - B.x) / L; B.dz = (H.z - B.z) / L; } };
  if (B.mode === "enter") {
    steer(B.v, B, { x: -H.x * 0.4, z: -H.z * 0.4 }, 9, 2, dt); B.x += B.v.x * dt; B.z += B.v.z * dt; B.yaw = Math.atan2(B.v.x, B.v.z);
    if (B.t > 2.6) { B.mode = "circle"; B.t = 0; }
  } else if (B.mode === "circle") {
    const a = Math.atan2(B.z, B.x) + dt * 0.5, R = 8; steer(B.v, B, { x: Math.cos(a) * R, z: Math.sin(a) * R }, B.enraged ? 9 : 7, 3, dt);
    B.x += B.v.x * dt; B.z += B.v.z * dt; face(H.x, H.z, 3);
    if (B.t > 1.4 * fast) next();
  } else if (B.mode === "chargeTel") {
    B.yaw = M.angleLerp(B.yaw, Math.atan2(B.dx, B.dz), 8, dt); bossTele(B.t / (1.0 * fast), 3.6);
    if (B.t % 0.25 < dt) sfx.warn({ pitch: 0.6 });
    if (B.t >= 1.0 * fast) { B.mode = "charge"; B.t = 0; bossLane.lane.visible = bossLane.fill.visible = false; rig.shake(0.3, 0.3); bossSfx.roar({ pitch: 1.6, vol: 0.6 }); }
  } else if (B.mode === "charge") {
    const px = B.x, pz = B.z, sp = B.enraged ? 23 : 18; B.x += B.dx * sp * dt; B.z += B.dz * sp * dt;
    if (crossesRibbon(px, pz, B.x, B.z) || crossesRibbon(px - B.dz * 1.5, pz + B.dx * 1.5, B.x - B.dz * 1.5, B.z + B.dx * 1.5)) {
      B.mode = "dazed"; B.t = 0; B.daze = 2; sfx.zap({ pitch: 0.5 }); pop(B.x, B.z, "DAZED!", "zap"); tl.flash([B.x, Y + 1, B.z], { color: PALETTE[2], size: 8, dur: 0.4 });
    } else if (clampToDisc(B, ARENA - 1) || B.t > 1.7) { B.mode = "circle"; B.t = 0; B.v.x = B.dx * 4; B.v.z = B.dz * 4; tl.shockwave([B.x, Y, B.z], { color: PALETTE[3], size: 5, dur: 0.4, flat: true }); rig.shake(0.4, 0.3); }
  } else if (B.mode === "spinTel") {
    const k = Math.min(1, B.t / (1.1 * fast)); B.yaw += dt * (2 + 14 * k); spinRing.visible = true; spinRing.position.set(B.x, 0.06, B.z);
    spinRing.scale.setScalar(SPIN_R * (0.3 + 0.7 * k)); spinRing.material.opacity = 0.35 + 0.5 * Math.abs(Math.sin(B.t * 18));
    if (B.t >= 1.1 * fast) {
      spinRing.visible = false; tl.shockwave([B.x, Y, B.z], { color: "#ff3d8b", size: SPIN_R, dur: 0.35, flat: true }); rig.shake(0.45, 0.3); bossSfx.roar({ pitch: 2, vol: 0.5 });
      if (Math.hypot(H.x - B.x, H.z - B.z) < SPIN_R + HERO_R && S.dashT <= 0) hurt({ x: B.x, z: B.z, data: {} });
      B.mode = "circle"; B.t = 0;
    }
  } else if (B.mode === "summonTel") {
    B.yaw += Math.sin(B.t * 40) * 0.02; bossMat.emissiveIntensity = 0.3 + 0.8 * Math.abs(Math.sin(B.t * 12));
    if (B.t < dt) { bossSfx.roar(); pop(B.x, B.z, "ROAAR", "hot"); }
    if (B.t >= 0.9) {
      bossMat.emissiveIntensity = 0.3; let want = B.enraged ? 12 : 8;
      minnows.each((id, r) => { if (want > 0 && r.data.mode === "ring" && M.chance(0.12)) { r.data.mode = "hunt"; r.color.set(PALETTE[3]); want--; } });
      B.mode = "circle"; B.t = 0;
    }
  } else if (B.mode === "dazed") {
    B.yaw += dt * 3; if (B.t > 2) { B.mode = "circle"; B.t = 0; }
  } else if (B.mode === "dying") {
    burn.set(Math.min(1, B.t / 1.4)); B.yaw += dt * 1.5;
    if (B.t > 1.6) { B.alive = false; B.mode = "off"; bossG.removeFromParent(); bossBar.hidden = true; dropShells(B.x, B.z, 8); playSong(reefSong); setIntensity(1); }
    return;
  }
  if (S.screen === "play") { bossStrikes(); if (S.inv <= 0) bossHurtsHero(); }
}
function lasso(dt) {   // the ribbon's head crossing an older piece of the ribbon closes a loop: stun everything inside it
  if ((lassoCool -= dt) > 0 || histN < 20) return;
  const a = hist[histTop], b = hist[(histTop - 1 + RIB_N) % RIB_N];
  for (let k = 14; k < histN - 1; k++) {
    const p = hist[(histTop - k + RIB_N) % RIB_N], q = hist[(histTop - k - 1 + RIB_N) % RIB_N];
    const rx = b.x - a.x, rz = b.z - a.z, sx = q.x - p.x, sz = q.z - p.z, den = rx * sz - rz * sx; if (Math.abs(den) < 1e-9) continue;
    const u = ((p.x - a.x) * sz - (p.z - a.z) * sx) / den, v = ((p.x - a.x) * rz - (p.z - a.z) * rx) / den;
    if (u < 0 || u > 1 || v < 0 || v > 1) continue;
    const poly = []; for (let j = 0; j <= k; j++) poly.push(hist[(histTop - j + RIB_N) % RIB_N]);
    const inside = (x, z) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const pi = poly[i], pj = poly[j]; if ((pi.z > z) !== (pj.z > z) && x < ((pj.x - pi.x) * (z - pi.z)) / (pj.z - pi.z) + pi.x) c = !c; } return c; };
    let n = 0, cx = 0, cz = 0; for (const pt of poly) { cx += pt.x / poly.length; cz += pt.z / poly.length; }
    minnows.each((id, r) => { if ((r.data.mode === "hunt" || r.data.mode === "stun") && inside(r.x, r.z)) { r.data.mode = "stun"; r.data.stun = 1.8; r.color.set("#c9fff7"); n++; } });
    chargers.each((id, r) => { if (r.data.mode !== "leave" && inside(r.x, r.z)) { r.data.mode = "stun"; r.data.stun = 1.8; r.color.set("#c9fff7"); hideTele(r.data.tele); n++; } });
    if (boss.alive && boss.mode !== "dying" && inside(boss.x, boss.z)) { boss.mode = "dazed"; boss.t = 0; boss.daze = 2; n += 3; }
    lassoCool = 0.6; ribbonHot = 0.5; lassos++;
    if (n) { S.score += 15 * n; bossSfx.lasso({ pitch: 1 + Math.min(n, 8) * 0.04 }); pop(cx, cz, `LASSO ×${n}!`, "zap"); tl.shockwave([cx, Y, cz], { color: PALETTE[2], size: 4, dur: 0.5, flat: true }); rig.shake(0.2, 0.2); }
    return;
  }
}
const RIB_C = new THREE.Color(PALETTE[2]).multiplyScalar(1.35), RIB_HOT = new THREE.Color("#ffffff").multiplyScalar(1.6);
function climax(dt, t) {
  lasso(dt); bossStep(dt, t); CAM.height = boss.alive ? 23 : 18; CAM.back = boss.alive ? 8 : 6;
  ribbonHot = Math.max(0, ribbonHot - dt); trail.material.uniforms.uColor.value.copy(RIB_C).lerp(RIB_HOT, Math.min(1, ribbonHot * 2.5));
  if (boss.alive) {
    bossG.position.set(boss.x, Y + 0.3, boss.z); bossG.rotation.y = boss.yaw; bossTail.rotation.y = Math.sin(t * 7) * 0.35;
    for (const w of weak) { const k = boss.daze > 0 ? 1.7 : 1; w.core.scale.setScalar(k * (1 + Math.sin(t * 8) * 0.15)); w.halo.rotation.z = t * 3; w.halo.scale.setScalar(k * (1 + Math.sin(t * 5) * 0.2)); }
    bossFill.style.transform = `scaleX(${(boss.hp / BOSS_HP).toFixed(3)})`;
  }
  if ((bubbleT -= dt) <= 0 && Math.hypot(H.vx, H.vz) > 2) {   // a wake of bubbles: something always streams past the fish
    bubbleT = 0.07; sparks.emit(H.x - Math.sin(H.yaw) * 1.2 + M.rand(-0.3, 0.3), Y + 0.2, H.z - Math.cos(H.yaw) * 1.2 + M.rand(-0.3, 0.3), M.rand(-0.4, 0.4), M.rand(1.5, 3), M.rand(-0.4, 0.4), "#bff8ff", 0.9, 0.8, 2);
  }
}
function climaxWarm() { return [bossG, bossLane.lane, bossLane.fill, spinRing]; }

// ── STRUCTURE ──
// boot: fill the ring, compile everything on the title (pools, fx, the boss), then run
for (let i = 0; i < HORDE; i++) spawnMinnow((i / HORDE) * Math.PI * 2, RING_R, "ring");
{ const w = chargers.spawn({ x: 0, y: -50, z: 0, scale: 2.1, color: PALETTE[3], data: {} }), s2 = shells.spawn({ x: 0, y: -50, z: 0, data: { ph: 0 } });
  minnows.sync(); chargers.sync(); shells.sync(); G.warm([...warmList(), ...climaxWarm()]); chargers.free(w); shells.free(s2); }
shell.show("title");
loop = startLoop({ step, render, snapshot, input, G, commands });
