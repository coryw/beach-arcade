// Beskar Blocks — by Alex. "Twin-Sun Blockland": a blocky armored bounty hunter and the green kid in his floating pram
// on a Minecraft-style block planet, every character a Roblox-style block avatar. Grogu is hungry: find the frogs, blast
// the Bucketheads who come to grab him, jetpack over the block cliffs, and when the kid's Force meter fills, he LIFTS
// every trooper into the sky (the Signature). Toolbox: kit/three/README.md (./lib-2/). Regions: STRUCTURE (state
// machine, loop, hooks) · ART (models, blocks, juice — this game's alone) · CLIMAX (the polish layer).
import * as THREE from "three";
import { boot, startLoop, best, M, params, rng } from "./lib-2/core.js";
import { createShell } from "./lib-2/shell.js";
import { createInput } from "./lib-2/input.js";
import { createRig } from "./lib-2/camera.js";
import { defineSfx, song, playSong, setIntensity } from "./lib-2/audio.js";
import { Sparks, Chunks, Timeline, screenFlash } from "./lib-2/fx.js";
import { geo, mat, part, pixTex, skyDome, lights, blobShadow, fbm2, glowTex } from "./lib-2/art.js";
import { InstancedPool } from "./lib-2/physics.js";
import { rim, tick } from "./lib-2/shaders.js";

// ── STRUCTURE ──
const PALETTE = ["#f3c98b", "#b8663a", "#c9d3dc", "#e0362c", "#7ccf4a"];   // twin-sun sand · sandstone · beskar · trooper red / lava · Grogu green
const SLUG = "beskar-blocks", ORIENT = "landscape";
const X0 = -30, X1 = 30, Z0 = -26, Z1 = 46, NX = X1 - X0, NZ = Z1 - Z0, WALL_Z = 14, GATE_X0 = -2, GATE_X1 = 1;
const START = { canyon: { x: 0.5, z: -15.5 }, lava: { x: 0.5, z: 22.5 } };
const WALK = 6.2, GRAV = -26, JUMP_V = 8.5, JET_V = 6.5, FUEL_S = 1.7, HERO_R = 0.3, STEP_UP = 1.05, CEIL = 16;
const FROGS_A = 5, FROGS_B = 3, TROOPS = 8, BLAST = { cool: 0.2, speed: 34, range: 17 }, FORCE_R = 11;
const ACTS = ["canyon", "lava", "golem"];

const G = boot({ canvas: "#view", background: null, bloom: { strength: 0.55, radius: 0.35, threshold: 0.92 }, toneMapping: "neutral",
  camera: { fov: 55, near: 0.1, far: 400 }, errorMessage: "Uh oh! A bug got into the beskar. Show this to a grown-up:" });
const input = createInput({
  stick: { zone: "#stick-zone", mode: "float", radius: 60, deadzone: 0.08, base: "#stick-base", knob: "#stick-knob" },
  buttons: { "#btn-jump": "jump", "#btn-blast": "blast", "#btn-force": "force" } });
const shell = createShell({ screens: { title: "#title", over: "#over" }, orient: ORIENT, input,
  prompt: { el: "#prompt", text: input.isTouch ? "tap to suit up" : "press space to suit up" },
  onShow: (name) => { if (name === "title" || name === "over") G.quality.probeUp(); } });
shell.hubLink(); shell.rotate("#rotate");
const hudScore = shell.text("#score"), hudFrogs = shell.text("#frogs"), finalScore = shell.text("#final"), bestScore = shell.text("#best"),
  ateText = shell.text("#ate"), msgText = shell.text("#msg");
const record = best(SLUG), rig = createRig(G.camera);
const hearts = [...document.querySelectorAll("#hearts i")], msgEl = document.querySelector("#msg");
const meterEl = document.querySelector("#meter"), meterFill = document.querySelector("#meter-fill"), fuelFill = document.querySelector("#fuel-fill"),
  forceBtn = document.querySelector("#btn-force");

const S = { screen: "title", stage: "canyon", startStage: "canyon", t: 0, score: 0, lives: 3, inv: 0, force: 0, eaten: 0, fuel: 1,
  spawnT: 2, gateOpen: false, cool: 0, forceT: 0, kills: 0, msgT: 0, extra: 0, gulpT: 0 };
const H = { x: 0, y: 3, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, grounded: true, walk: 0, shootT: 0, shootYaw: 0, jetting: false, modelY: 3 };
const P = { x: 0, y: 4, z: 0, yaw: 0 };   // the pram (Grogu)
const camT = { x: 0, y: 0, z: 0, yaw: 0 };
let loop = null;

// ── the block grid: column heights + top/side block types; collision reads the arrays, never meshes
const HGT = new Uint8Array(NX * NZ), TOP = new Uint8Array(NX * NZ), SIDE = new Uint8Array(NX * NZ);
const SAND = 0, SANDSTONE = 1, ROCK = 2, LAVA = 3, BASALT = 4;
const inside = (ix, iz) => ix >= X0 && ix < X1 && iz >= Z0 && iz < Z1;
const at = (ix, iz) => (ix - X0) + (iz - Z0) * NX;
const isGate = (ix, iz) => (iz === WALL_Z || iz === WALL_Z + 1) && ix >= GATE_X0 && ix <= GATE_X1;
function colTop(ix, iz) {
  if (!inside(ix, iz)) return 30;
  if (!S.gateOpen && isGate(ix, iz)) return 6;
  return HGT[at(ix, iz)];
}
const lavaAt = (x, z) => { const ix = Math.floor(x), iz = Math.floor(z); return inside(ix, iz) && TOP[at(ix, iz)] === LAVA; };
const groundAt = (x, z) => colTop(Math.floor(x), Math.floor(z));
function footMax(x, z, r) {
  return Math.max(groundAt(x - r, z - r), groundAt(x + r, z - r), groundAt(x - r, z + r), groundAt(x + r, z + r));
}
function buildGrid() {
  for (let iz = Z0; iz < Z1; iz++) for (let ix = X0; ix < X1; ix++) {
    const i = at(ix, iz); let h, top, side;
    if (ix === X0 || ix === X1 - 1 || iz === Z0 || iz === Z1 - 1) { h = 8; top = SANDSTONE; side = SANDSTONE; }
    else if (iz === WALL_Z || iz === WALL_Z + 1) { if (isGate(ix, iz)) { h = 3; top = SANDSTONE; side = SANDSTONE; } else { h = 6; top = SANDSTONE; side = SANDSTONE; } }
    else if (iz < WALL_Z) {
      const n = fbm2(ix * 0.075, iz * 0.075, { seed: 3 });
      h = M.clamp(3 + Math.round(n * 2.6), 1, 6); top = SAND; side = SANDSTONE;
      const mesa = fbm2(ix * 0.13 + 40, iz * 0.13, { seed: 7 }) > 0.36;
      const plaza = Math.hypot(ix - START.canyon.x, iz - START.canyon.z) < 5.5 || (iz >= WALL_Z - 3 && Math.abs(ix) < 5);
      if (plaza) h = 3; else if (mesa) { h += 4; top = SANDSTONE; }
    } else {
      const n = fbm2(ix * 0.11, iz * 0.11, { seed: 11 });
      const landing = (iz <= WALL_Z + 5 && Math.abs(ix) < 4) || (iz <= WALL_Z + 12 && ix >= -2 && ix <= 2);
      if (n > -0.08 || landing) { h = 2 + (n > 0.35 ? 1 : 0) + (n > 0.6 ? 1 : 0); top = BASALT; side = ROCK; }
      else { h = 1; top = LAVA; side = LAVA; }
    }
    HGT[i] = h; TOP[i] = top; SIDE[i] = side;
  }
}

function start() {
  const lava = S.startStage !== "canyon";
  Object.assign(S, { screen: "play", stage: S.startStage, t: 0, score: 0, lives: 3, inv: 0, force: 0, eaten: 0, fuel: 1,
    spawnT: 2.5, cool: 0, forceT: 0, kills: 0, msgT: 0, extra: 0, gulpT: 0 });
  const s = START[lava ? "lava" : "canyon"];
  Object.assign(H, { x: s.x, z: s.z, vx: 0, vy: 0, vz: 0, yaw: 0, grounded: true, shootT: 0, jetting: false });
  troopers.forEach(offTrooper); pBolts.clear(); eBolts.clear();
  if (lava) openGate(true); else closeGate();
  placeFrogs(lava);
  if (S.startStage === "golem") { frogs.forEach((f) => { f.st = "gone"; }); S.eaten = FROGS_A + FROGS_B; }
  H.y = H.modelY = footMax(H.x, H.z, HERO_R);
  Object.assign(P, { x: H.x - 0.9, y: H.y + 1.3, z: H.z - 1.5, yaw: 0 });
  hearts.forEach((el) => el.classList.remove("gone"));
  hudScore(0); climaxReset(); shell.show("play"); onStart();
}
function over() {
  if (S.screen === "over") return;
  S.screen = "over"; climaxOver();
  const r = record.submit(S.score);
  finalScore(S.score); bestScore(r.best); ateText(S.eaten); shell.show("over"); onOver(r.isNew);
}

function move(dt) {
  const ax = input.axis.x, az = input.axis.y;     // camera sits south looking north: screen right is world -x
  const tx = -ax * WALK, tz = az * WALK;
  H.vx = M.damp(H.vx, tx, 14, dt); H.vz = M.damp(H.vz, tz, 14, dt);
  const lim = H.y + (H.grounded ? STEP_UP : 0.35);
  let nx = H.x + H.vx * dt; if (footMax(nx, H.z, HERO_R) > lim) H.vx = 0; else H.x = nx;
  let nz = H.z + H.vz * dt; if (!S.gateOpen && nz > WALL_Z - HERO_R) nz = WALL_Z - HERO_R;
  if (footMax(H.x, nz, HERO_R) > lim) H.vz = 0; else H.z = nz;
  const jumpHeld = input.held("jump") || input.held("a"), jumpPressed = input.pressed("jump") || input.pressed("a");
  H.jetting = false;
  if (H.grounded && jumpPressed) { H.vy = JUMP_V; H.grounded = false; onJump(); }
  else if (!H.grounded && jumpHeld && S.fuel > 0 && H.vy < JET_V) { H.vy = Math.min(JET_V, H.vy + 42 * dt); S.fuel -= dt / FUEL_S; H.jetting = true; }
  const ground = footMax(H.x, H.z, HERO_R * 0.8);
  if (H.grounded && ground < H.y - 0.05) H.grounded = false;
  if (H.grounded && ground > H.y) H.y = ground;                         // auto step-up, one block
  if (!H.grounded) {
    H.vy += GRAV * dt; H.y += H.vy * dt;
    if (H.y > CEIL) { H.y = CEIL; H.vy = Math.min(0, H.vy); }
    if (H.y <= ground) { const hard = H.vy < -9; H.y = ground; H.vy = 0; H.grounded = true; onLand(hard); }
  }
  if (H.grounded) S.fuel = Math.min(1, S.fuel + dt * 0.9);
  if (H.grounded && lavaAt(H.x, H.z)) { hurt("lava"); H.vy = 11; H.grounded = false; }
  const sp = Math.hypot(H.vx, H.vz);
  if (H.shootT > 0) { H.shootT -= dt; H.yaw = M.angleLerp(H.yaw, H.shootYaw, 22, dt); }
  else if (sp > 0.6) H.yaw = M.angleLerp(H.yaw, Math.atan2(H.vx, H.vz), 12, dt);
  H.walk += sp * dt * 1.9;
}

// ── frogs: 5 in the canyon, 3 across the lava; Grogu gulps each one you walk up to
function placeFrogs(lavaStart) {
  const spots = [];
  const ok = (ix, iz, far) => spots.every((s) => Math.hypot(s.ix - ix, s.iz - iz) > far);
  const pick = (zone, far) => {
    for (let k = 0; k < 400; k++) {
      const ix = M.randInt(X0 + 3, X1 - 4), iz = zone === "a" ? M.randInt(Z0 + 3, WALL_Z - 3) : M.randInt(WALL_Z + 4, Z1 - 4);
      const i = at(ix, iz), h = HGT[i];
      if (zone === "a" && (TOP[i] !== SAND || Math.hypot(ix - START.canyon.x, iz - START.canyon.z) < 7)) continue;
      if (zone === "b" && TOP[i] !== BASALT) continue;
      if (!ok(ix, iz, far) && k < 300) continue;
      spots.push({ ix, iz, h }); return spots[spots.length - 1];
    }
    return { ix: 0, iz: zone === "a" ? 0 : 20, h: 3 };
  };
  frogs.forEach((f, n) => {
    const s = pick(n < FROGS_A ? "a" : "b", 8);
    Object.assign(f, { x: s.ix + 0.5, z: s.iz + 0.5, y: s.h, st: "idle", t: M.rand(0, 2), zone: n < FROGS_A ? "a" : "b", hop: 0 });
    if (lavaStart && n < FROGS_A) f.st = "gone";
  });
  if (lavaStart) S.eaten = FROGS_A;
}
function respawnFrogs() {   // after all 8: more frogs hop onto the lava islands (the boss replaces this in polish)
  S.extra++;
  frogs.forEach((f, n) => {
    if (n < FROGS_A) return;
    for (let k = 0; k < 200; k++) {
      const ix = M.randInt(X0 + 3, X1 - 4), iz = M.randInt(WALL_Z + 4, Z1 - 4), i = at(ix, iz);
      if (TOP[i] !== BASALT || Math.hypot(ix - H.x, iz - H.z) < 6) continue;
      Object.assign(f, { x: ix + 0.5, z: iz + 0.5, y: HGT[i], st: "idle", t: 0, hop: 0 }); break;
    }
  });
}
function frogsStep(dt) {
  for (const f of frogs) {
    f.t += dt;
    if (f.st === "idle") {
      if (f.t > 1.6) { f.t = 0; f.hop = 0.45; }
      if (f.hop > 0) f.hop -= dt;
      if (S.screen === "play" && Math.hypot(f.x - H.x, f.z - H.z) < 1.8 && Math.abs(f.y - H.y) < 2.6) { f.st = "fly"; f.t = 0; f.fx = f.x; f.fy = f.y; f.fz = f.z; }
    } else if (f.st === "fly" && f.t >= 0.32) {
      f.st = "gone"; S.eaten++; S.score += 100; S.force = Math.min(1, S.force + 0.34); S.gulpT = 0.5; onGulp(f);
      if (S.eaten === FROGS_A && !S.gateOpen) openGate(false);
      if (frogs.every((q) => q.st === "gone")) { onAllFrogs(); if (!climaxAllFrogs()) respawnFrogs(); }
    }
  }
}

// ── the Bucketheads: drop in, march on the pram, stop, glow, fire; a BLAST shatters one
function wantTroopers() { if (climaxBusy()) return 2; return S.stage === "lava" ? Math.min(5, 3 + S.extra) : 2 + Math.min(2, Math.floor(S.eaten / 2)); }
function spawnTrooper() {
  const tr = troopers.find((q) => q.st === "off"); if (!tr) return;
  const inB = H.z > WALL_Z + 1;
  for (let k = 0; k < 30; k++) {
    const a = M.rand(-0.15, 1.15) * Math.PI, d = M.rand(10, 16), x = H.x + Math.cos(a) * d, z = H.z + Math.sin(a) * d;
    const ix = Math.floor(x), iz = Math.floor(z);
    if (!inside(ix, iz) || ix <= X0 || ix >= X1 - 1 || iz <= Z0 || iz >= Z1 - 1) continue;
    if (inB ? iz < WALL_Z + 3 : iz > WALL_Z - 2) continue;
    const i = at(ix, iz); if (TOP[i] === LAVA || HGT[i] > H.y + 4 || isGate(ix, iz)) continue;
    Object.assign(tr, { st: "drop", x: ix + 0.5, z: iz + 0.5, y: HGT[i] + 14, gy: HGT[i], vy: 0, t: 0, cool: M.rand(0.8, 1.6), turn: 0, turnDir: M.chance(0.5) ? 1 : -1 });
    onTrooperIncoming(tr); return;
  }
}
function troopersStep(dt) {
  const n = troopers.filter((q) => q.st !== "off").length;
  S.spawnT -= dt;
  if (S.screen === "play" && n < wantTroopers() && S.spawnT <= 0) { spawnTrooper(); S.spawnT = S.stage === "lava" ? 1.6 : 2.4; }
  const sp = S.stage === "lava" ? 2.9 : 2.4;
  for (const tr of troopers) {
    if (tr.st === "off") continue;
    tr.t += dt; tr.cool -= dt;
    if (tr.st === "drop") {
      tr.vy += GRAV * 0.6 * dt; tr.y += tr.vy * dt;
      if (tr.y <= tr.gy) { tr.y = tr.gy; tr.st = "walk"; tr.t = 0; onTrooperLand(tr); }
    } else if (tr.st === "walk") {
      let dx = P.x - tr.x, dz = P.z - tr.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
      if (tr.turn > 0) { tr.turn -= dt; const c = Math.cos(1.2 * tr.turnDir), s = Math.sin(1.2 * tr.turnDir); [dx, dz] = [dx * c - dz * s, dx * s + dz * c]; }
      const nx = tr.x + dx * sp * dt, nz = tr.z + dz * sp * dt, ix = Math.floor(nx), iz = Math.floor(nz), h = colTop(ix, iz);
      if (h > tr.y + STEP_UP || lavaAt(nx, nz)) { tr.turn = 0.8; tr.turnDir = -tr.turnDir; }
      else { tr.x = nx; tr.z = nz; tr.y = M.damp(tr.y, h, 16, dt); }
      tr.yaw = M.angleLerp(tr.yaw, Math.atan2(dx, dz), 8, dt);
      const dh = Math.hypot(H.x - tr.x, H.z - tr.z);
      if (S.screen === "play" && dh < 9 && tr.cool <= 0 && tr.t > 1.0) { tr.st = "aim"; tr.t = 0; onTelegraph(tr); }
      if (S.screen === "play" && Math.hypot(P.x - tr.x, P.z - tr.z) < 1.2) { onGrab(tr); hurt("grab"); tr.x -= dx * 3; tr.z -= dz * 3; tr.cool = 1.5; }
    } else if (tr.st === "aim") {
      tr.yaw = M.angleLerp(tr.yaw, Math.atan2(H.x - tr.x, H.z - tr.z), 12, dt);
      if (tr.t >= 0.75) { fireAt(tr); tr.st = "walk"; tr.t = 0; tr.cool = S.stage === "lava" ? 1.7 : 2.3; }
    } else if (tr.st === "lift") {
      tr.spin += dt * 9;
      if (tr.t < 1.05) tr.y = tr.gy + M.smoothstep(0, 0.5, tr.t) * 4.2 + Math.sin(tr.t * 7) * 0.15;
      else { tr.vy = (tr.vy > 0 ? 0 : tr.vy) - 70 * dt; tr.y += tr.vy * dt; if (tr.y <= tr.gy) { tr.y = tr.gy; onSlam(tr); kill(tr, true); } }
    }
  }
}
function fireAt(tr) {
  const sx = tr.x + Math.sin(tr.yaw) * 0.5, sy = tr.y + 1.3, sz = tr.z + Math.cos(tr.yaw) * 0.5;
  const dx = H.x - sx, dy = H.y + 1.0 - sy, dz = H.z - sz, L = Math.hypot(dx, dy, dz) || 1;
  eBolts.spawn({ x: sx, y: sy, z: sz, rotY: Math.atan2(dx, dz), data: { vx: dx / L * 11, vy: dy / L * 11, vz: dz / L * 11, life: 2.5 } });
  onTrooperShot(tr);
}
function kill(tr, byForce) {
  tr.st = "off"; S.kills++; S.score += byForce ? 50 : 25; S.force = Math.min(1, S.force + 0.125);
  loop.hitstop(byForce ? 30 : 60); onShatter(tr, byForce);
}
function blast() {
  let tgt = null, bd = BLAST.range;
  for (const tr of troopers) {
    if (tr.st === "off" || tr.st === "lift") continue;
    const d = Math.hypot(tr.x - H.x, tr.z - H.z); if (d < bd) { bd = d; tgt = tr; }
  }
  const core = climaxTarget(bd); if (core) tgt = core;
  const sx = H.x, sy = H.y + 1.15, sz = H.z;
  let dx = Math.sin(H.yaw), dy = 0, dz = Math.cos(H.yaw);
  if (tgt) { dx = tgt.x - sx; dy = tgt.y + 1.0 - sy; dz = tgt.z - sz; const L = Math.hypot(dx, dy, dz) || 1; dx /= L; dy /= L; dz /= L; }
  H.shootYaw = Math.atan2(dx, dz); H.shootT = 0.3; S.cool = BLAST.cool;
  pBolts.spawn({ x: sx + dx * 0.6, y: sy, z: sz + dz * 0.6, rotY: H.shootYaw,
    data: { vx: dx * BLAST.speed, vy: dy * BLAST.speed, vz: dz * BLAST.speed, life: 0.7, tgt } });
  onBlast();
}
function boltsStep(dt) {
  pBolts.each((id, r) => {
    const d = r.data; d.life -= dt;
    if (d.tgt && d.tgt.st !== "off" && d.tgt.st !== "lift") {   // a little homing so a kid's shot lands
      const tx = d.tgt.x - r.x, ty = d.tgt.y + 1 - r.y, tz = d.tgt.z - r.z, L = Math.hypot(tx, ty, tz) || 1;
      d.vx = M.damp(d.vx, tx / L * BLAST.speed, 10, dt); d.vy = M.damp(d.vy, ty / L * BLAST.speed, 10, dt); d.vz = M.damp(d.vz, tz / L * BLAST.speed, 10, dt);
      r.rotY = Math.atan2(d.vx, d.vz);
    }
    r.x += d.vx * dt; r.y += d.vy * dt; r.z += d.vz * dt;
    for (const tr of troopers) {
      if (tr.st === "off" || tr.st === "lift") continue;
      if (Math.hypot(tr.x - r.x, tr.y + 1 - r.y, tr.z - r.z) < 0.8) { kill(tr, false); pBolts.free(id); return; }
    }
    if (climaxBolt(r)) { pBolts.free(id); return; }
    if (groundAt(r.x, r.z) > r.y || d.life <= 0) { onBoltFizz(r, false); pBolts.free(id); }
  });
  eBolts.each((id, r) => {
    const d = r.data; d.life -= dt;
    r.x += d.vx * dt; r.y += d.vy * dt; r.z += d.vz * dt;
    if (S.screen === "play" && Math.hypot(H.x - r.x, H.y + 1 - r.y, H.z - r.z) < 0.65) { hurt("bolt"); eBolts.free(id); return; }
    if (groundAt(r.x, r.z) > r.y || d.life <= 0) { onBoltFizz(r, true); eBolts.free(id); }
  });
}
function useForce() {
  if (S.force < 1) { onForceNotReady(); return; }
  S.force = 0; S.forceT = 1.5; let n = 0;
  for (const tr of troopers) {
    if (tr.st === "off" || tr.st === "lift") continue;
    if (Math.hypot(tr.x - P.x, tr.z - P.z) < FORCE_R) { tr.st = "lift"; tr.t = 0; tr.gy = tr.y; tr.spin = 0; tr.vy = 1; n++; }
  }
  n += climaxForce(); onForce(n);
}
function hurt(why) {
  if (S.inv > 0 || S.screen !== "play") return;
  S.inv = 1.4; if (why !== "lava") { H.vy = 6; H.grounded = false; }
  if (!params.god) S.lives--;
  hearts.forEach((el, i) => el.classList.toggle("gone", i >= S.lives));
  onHurt(why);
  if (S.lives <= 0) over();
}
function openGate(silent) { S.gateOpen = true; S.stage = "lava"; onGate(silent); }
function closeGate() { S.gateOpen = false; S.stage = "canyon"; rebuildGate(); }
function showMsg(text, sec) { msgText(text); msgEl.hidden = false; S.msgT = sec; }

function step(dt, t) {
  if (S.screen !== "play") {
    if (input.pressed("start") && shell.canAccept()) start();
    else rig.orbit({ x: H.x, y: H.y + 1.2, z: H.z }, { radius: 12.5, height: 6.5, speed: 0.18, k: 2.5 });
  }
  if (S.screen === "play") {
    S.t += dt; S.inv -= dt; S.cool -= dt; S.forceT -= dt; S.gulpT -= dt;
    move(dt);
    if ((input.pressed("blast") || input.pressed("b")) && S.cool <= 0) blast();
    if (input.pressed("force") || input.pressed("c")) useForce();
    climax(dt, t);
    camT.x = H.x; camT.y = H.modelY; camT.z = Math.max(H.z, Z0 + 10.5);   // the camera never backs out past the south rim
    rig.follow(camT, { back: climaxBusy() ? 10.5 : 8.5, up: 5.6, lookUp: climaxBusy() ? 3.4 : 1.9, lookAhead: 0, yawFollow: true, k: 5 });   // a fixed yaw 0 target: the camera always looks north
  }
  if (S.msgT > 0) { S.msgT -= dt; if (S.msgT <= 0 || S.screen !== "play") { msgEl.hidden = true; S.msgT = 0; } }
  pram(dt, t);
  frogsStep(dt); troopersStep(dt); boltsStep(dt);
  hud();
  art(dt, t);
  rig.update(dt, t);
}
let lastMeter = -1, lastFuel = -1, lastReady = null;
function hud() {
  hudScore(S.score);
  hudFrogs(S.eaten <= FROGS_A + FROGS_B ? `🐸 ${S.eaten}/${FROGS_A + FROGS_B}` : `🐸 ${S.eaten}`);
  const m = Math.round(S.force * 100), f = Math.round(S.fuel * 100), ready = S.force >= 1;
  if (m !== lastMeter) { meterFill.style.width = m + "%"; lastMeter = m; }
  if (f !== lastFuel) { fuelFill.style.width = f + "%"; lastFuel = f; }
  if (ready !== lastReady) { meterEl.classList.toggle("ready", ready); forceBtn.classList.toggle("ready", ready); lastReady = ready; }
}

const snapshot = () => {
  const live = troopers.filter((q) => q.st !== "off").length;
  return { screen: S.screen, stage: S.stage, score: S.score, best: record.get(), lives: S.lives, frogs: S.eaten, troopers: live,
    force: +S.force.toFixed(2), fuel: +S.fuel.toFixed(2), gate: S.gateOpen, kills: S.kills, grounded: H.grounded,
    entities: live + frogs.filter((f) => f.st !== "gone").length + pBolts.count + eBolts.count,
    focus: { x: +H.x.toFixed(3), y: +H.y.toFixed(3), z: +H.z.toFixed(3) }, ...climaxState() };
};
const commands = {
  die: over,
  at: (stage) => { if (ACTS.includes(String(stage))) S.startStage = String(stage); },
};

// ── ART ──
const scene = G.scene;
const INK = "#3a1d10";

// the sky: a twin-sun desert dome, horizon fog in the sand haze, two suns hanging north
const sky = skyDome(scene, { top: "#86c2e4", horizon: "#f6d6a0", bottom: "#e7ae70", radius: 300, fog: { mode: "linear-horizon", near: 26, far: 72 } });
sky.mesh.renderOrder = 5;   // after the blocks: the dome shades only the sky you can see (overdraw)
const L = lights(scene, { preset: "hemi+sun", sky: "#fff3dc", ground: "#c98a55", sun: "#fff0cc", sunIntensity: 2.1, hemiIntensity: 1.35 });
const suns = [["#fff2c4", 46, [-70, 58, 230]], ["#ffc98a", 30, [40, 44, 240]]].map(([c, s, off]) => {
  const m = mat.glow(c, { opacity: 0.95, map: glowTex() }); m.fog = false; m.depthWrite = false;
  const sp = new THREE.Sprite(m); sp.scale.set(s, s, 1); scene.add(sp); return { sp, off };
});

// the blocks: 16×16 pixel textures, 3–4 shades each, and per-face darkening baked into the cube's vertex colors
function blockTex(seed, pal, fn) {
  const R = rng(seed), rows = [];
  for (let y = 0; y < 16; y++) { let s = ""; for (let x = 0; x < 16; x++) s += fn(x, y, R()); rows.push(s); }
  return pixTex(rows, pal);
}
const TEX = {
  [SAND]: blockTex(1, { a: "#f3c98b", b: "#e8b675", c: "#f9dcab", d: "#d49d5c" }, (x, y, r) => (r < 0.55 ? "a" : r < 0.77 ? "b" : r < 0.92 ? "c" : "d")),
  [SANDSTONE]: blockTex(2, { a: "#b8663a", b: "#c97b47", c: "#8f4b2a", d: "#dc9459" },
    (x, y, r) => (y % 5 === 0 ? (r < 0.8 ? "c" : "a") : y % 5 === 1 ? (r < 0.6 ? "d" : "b") : r < 0.6 ? "a" : r < 0.85 ? "b" : "c")),
  [ROCK]: blockTex(3, { a: "#7a655a", b: "#655248", c: "#8d786b", d: "#4c3c35" },
    (x, y, r) => ((x * 7 + y * 3) % 11 === 0 ? "d" : r < 0.5 ? "a" : r < 0.8 ? "b" : r < 0.94 ? "c" : "d")),
  [BASALT]: blockTex(4, { a: "#4b3f3f", b: "#3a3030", c: "#5d4e4a", d: "#8a3a22" },
    (x, y, r) => (r < 0.5 ? "a" : r < 0.8 ? "b" : r < 0.96 ? "c" : "d")),
  [LAVA]: blockTex(5, { a: "#e0362c", b: "#ff6a2b", c: "#ffb13b", d: "#a8231d" },
    (x, y, r) => { const v = Math.sin(x * 0.8 + Math.sin(y * 0.6) * 2) + Math.cos(y * 0.9 - x * 0.3) + r * 0.6; return v > 1.3 ? "c" : v > 0.4 ? "b" : v > -0.6 ? "a" : "d"; }),
};
const GATE_TEX = blockTex(6, { a: "#c9d3dc", b: "#e8eef3", c: "#8d99a6", d: "#5b646e" },
  (x, y) => (x === 0 || y === 0 || x === 15 || y === 15 ? "c" : (x === 2 || x === 13) && (y === 2 || y === 13) ? "d" : y < 5 && x < 10 ? "b" : "a"));
const cube = (() => {
  const g = new THREE.BoxGeometry(1, 1, 1), shade = [0.84, 0.7, 1, 0.5, 0.92, 0.64], col = [];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) col.push(shade[f], shade[f], shade[f]);
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); return g;
})();
function blockMat(tex, hot) {
  const m = hot ? mat.hot("#ffffff", 1.35) : mat.lambert("#ffffff");
  m.map = tex; m.vertexColors = true; m.needsUpdate = true; return m;
}
const blocks = [];      // [type, x, y, z]
function gridBlocks() {
  const nh = (ix, iz) => (inside(ix, iz) ? HGT[at(ix, iz)] : 99);
  for (let iz = Z0; iz < Z1; iz++) for (let ix = X0; ix < X1; ix++) {
    const i = at(ix, iz), h = HGT[i];
    const lo = Math.min(h - 1, nh(ix - 1, iz), nh(ix + 1, iz), nh(ix, iz - 1), nh(ix, iz + 1));
    for (let k = Math.max(0, lo); k < h; k++) blocks.push([k === h - 1 ? TOP[i] : SIDE[i], ix + 0.5, k + 0.5, iz + 0.5]);
  }
}
buildGrid(); gridBlocks();
const terrain = {};     // one mesh per block type holding only the faces that touch air (Minecraft-style meshing)
{
  const pos = cube.attributes.position, nor = cube.attributes.normal, uv = cube.attributes.uv, col = cube.attributes.color, idx = cube.index.array;
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const solid = (ix, k, iz) => k < 0 || !inside(ix, iz) || k < HGT[at(ix, iz)];
  for (const type of [SAND, SANDSTONE, ROCK, BASALT, LAVA]) {
    const Pp = [], Nn = [], Uu = [], Cc = [], Ii = [];
    for (const b of blocks) {
      if (b[0] !== type) continue;
      const ix = b[1] - 0.5, k = b[2] - 0.5, iz = b[3] - 0.5;
      for (let f = 0; f < 6; f++) {
        const d = DIRS[f]; if (solid(ix + d[0], k + d[1], iz + d[2])) continue;
        const base = Pp.length / 3;
        for (let v = f * 4; v < f * 4 + 4; v++) {
          Pp.push(pos.getX(v) + b[1], pos.getY(v) + b[2], pos.getZ(v) + b[3]); Nn.push(nor.getX(v), nor.getY(v), nor.getZ(v));
          Uu.push(uv.getX(v), uv.getY(v)); Cc.push(col.getX(v), col.getY(v), col.getZ(v));
        }
        for (let q = f * 6; q < f * 6 + 6; q++) Ii.push(idx[q] - f * 4 + base);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(Pp, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(Nn, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(Uu, 2)); g.setAttribute("color", new THREE.Float32BufferAttribute(Cc, 3));
    g.setIndex(Ii); g.computeBoundingSphere();
    terrain[type] = new THREE.Mesh(g, blockMat(TEX[type], type === LAVA)); scene.add(terrain[type]);
  }
}
const gatePool = new InstancedPool(scene, cube, blockMat(GATE_TEX, false), { max: 64, cull: true });
function rebuildGate() {
  gatePool.clear();
  for (let iz = WALL_Z; iz <= WALL_Z + 1; iz++) for (let ix = GATE_X0; ix <= GATE_X1; ix++) for (let k = 3; k < 6; k++)
    gatePool.spawn({ x: ix + 0.5, y: k + 0.5, z: iz + 0.5 });
  gatePool.sync();
}

// materials shared by the avatars (block people: Roblox proportions, beskar and plastic)
const steel = rim(mat.lambert("#c9d3dc"), { color: "#fff6e4", power: 2.2, strength: 0.55 });
const suit = mat.lambert("#5b4a3d"), capeMat = mat.lambert("#8a5a2e"), black = mat.lambert("#1d1a1c"), belt = mat.lambert("#6b4a2a");
const white = rim(mat.lambert("#f4f1e8"), { color: "#ffffff", power: 2.5, strength: 0.35 }), grey = mat.lambert("#2c2b30");
const green = mat.lambert("#7ccf4a"), robe = mat.lambert("#cdb38a"), shine = mat.unlit("#ffffff");
const visorGeo = geo.extrude("M0 0.3 L0.36 0.3 L0.36 0.21 L0.23 0.21 L0.23 0 L0.13 0 L0.13 0.21 L0 0.21 Z", 0.03);
const rocketGeo = geo.lathe([[0, 0], [0.1, 0.03], [0.11, 0.3], [0.08, 0.42], [0.02, 0.5]], 10);
const earGeo = geo.extrude("M0 0 Q0.2 0.13 0.42 0.06 Q0.24 -0.04 0 -0.08 Z", 0.03);

function limb(parent, x, y, w, h, d, m) { const g = new THREE.Group(); g.position.set(x, y, 0); parent.add(g); part(geo.box(w, h, d), m, [0, -h / 2, 0], g); return g; }
function makeMando() {
  const g = new THREE.Group();
  const legL = limb(g, -0.17, 0.78, 0.26, 0.78, 0.3, suit), legR = limb(g, 0.17, 0.78, 0.26, 0.78, 0.3, suit);
  for (const leg of [legL, legR]) { part(geo.box(0.29, 0.2, 0.35), black, [0, -0.7, 0.02], leg); part(geo.box(0.22, 0.16, 0.04), steel, [0, -0.36, 0.16], leg); }
  part(geo.box(0.66, 0.66, 0.38), suit, [0, 1.12, 0], g);
  part(geo.box(0.56, 0.34, 0.06), steel, [0, 1.25, 0.2], g);
  part(geo.box(0.7, 0.11, 0.42), belt, [0, 0.85, 0], g);
  const armL = limb(g, -0.45, 1.42, 0.22, 0.64, 0.24, suit), armR = limb(g, 0.45, 1.42, 0.22, 0.64, 0.24, suit);
  for (const arm of [armL, armR]) part(geo.box(0.25, 0.24, 0.27), steel, [0, -0.46, 0], arm);
  part(geo.rbox(0.34, 0.14, 0.36, 0.05), steel, [0, 0.04, 0], armL);
  part(geo.box(0.09, 0.13, 0.44), black, [0, -0.62, 0.16], armR);
  const head = new THREE.Group(); head.position.y = 1.47; g.add(head);
  part(geo.rbox(0.52, 0.52, 0.5, 0.08), steel, [0, 0.26, 0], head);
  part(visorGeo, black, [-0.18, 0.1, 0.25], head);
  part(geo.cyl(0.02, 0.02, 0.3, 6), steel, [0.28, 0.46, 0], head);
  const cape = new THREE.Group(); cape.position.set(0, 1.45, -0.22); g.add(cape);
  part(geo.box(0.66, 0.98, 0.04), capeMat, [0, -0.49, 0], cape);
  const jet = new THREE.Group(); jet.position.set(0, 1.0, -0.34); g.add(jet);
  part(rocketGeo, steel, [-0.15, 0, -0.02], jet); part(rocketGeo, steel, [0.15, 0, -0.02], jet);
  part(geo.box(0.26, 0.22, 0.1), black, [0, 0.2, 0.06], jet);
  const flameMat = mat.hot("#ffb13b", 2.2), flames = [-0.15, 0.15].map((x) => part(geo.cone(0.09, 0.42, 8), flameMat, [x, -0.2, -0.02], jet, { rot: [Math.PI, 0, 0] }));
  g.userData = { legL, legR, armL, armR, cape, head, flames };
  return g;
}
function makePram() {
  const g = new THREE.Group();
  const bowlMat = mat.lambert("#c9d3dc"); bowlMat.side = THREE.DoubleSide;
  part(geo.lathe([[0.02, -0.24], [0.3, -0.21], [0.44, -0.06], [0.48, 0.12], [0.44, 0.17]], 18), bowlMat, [0, 0, 0], g);
  part(geo.cyl(0.24, 0.24, 0.03, 14), mat.hot("#bff4ff", 1.6), [0, -0.25, 0], g);
  const kid = new THREE.Group(); kid.position.y = -0.05; g.add(kid);
  part(geo.box(0.3, 0.26, 0.26), robe, [0, 0.12, 0], kid);
  const head = new THREE.Group(); head.position.y = 0.38; kid.add(head);
  part(geo.rbox(0.36, 0.3, 0.3, 0.09), green, [0, 0, 0], head);
  const eyes = [];
  for (const s of [-1, 1]) { const e = new THREE.Group(); e.position.set(s * 0.085, 0.02, 0.14); head.add(e); eyes.push(e);
    part(geo.sphere(0.06, 10), black, [0, 0, 0], e); part(geo.sphere(0.018, 6), shine, [0.02, 0.03, 0.055], e); }
  part(earGeo, green, [0.15, 0.03, -0.015], head);
  part(earGeo, green, [-0.15, 0.03, 0.015], head, { rot: [0, Math.PI, 0] });
  const hand = new THREE.Group(); hand.position.set(0.16, 0.2, 0.06); kid.add(hand);
  part(geo.box(0.07, 0.24, 0.07), robe, [0, 0.1, 0], hand); part(geo.box(0.08, 0.08, 0.08), green, [0, 0.25, 0], hand);
  hand.visible = false;
  g.userData = { kid, head, hand, eyes };
  return g;
}
function makeTrooper() {
  const g = new THREE.Group();
  const legL = limb(g, -0.16, 0.76, 0.25, 0.76, 0.28, white), legR = limb(g, 0.16, 0.76, 0.25, 0.76, 0.28, white);
  for (const leg of [legL, legR]) part(geo.box(0.26, 0.14, 0.3), grey, [0, -0.36, 0], leg);
  part(geo.box(0.62, 0.62, 0.36), white, [0, 1.08, 0], g);
  part(geo.box(0.64, 0.1, 0.38), grey, [0, 0.82, 0], g);
  part(geo.box(0.3, 0.18, 0.04), grey, [0, 1.2, 0.19], g);
  const armL = limb(g, -0.43, 1.36, 0.2, 0.6, 0.22, white), armR = limb(g, 0.43, 1.36, 0.2, 0.6, 0.22, white);
  part(geo.box(0.08, 0.12, 0.62), black, [0, -0.58, 0.22], armR);
  const head = new THREE.Group(); head.position.y = 1.4; g.add(head);
  part(geo.rbox(0.48, 0.48, 0.46, 0.1), white, [0, 0.24, 0], head);
  part(geo.box(0.4, 0.1, 0.04), grey, [0, 0.28, 0.23], head);
  const eyeMat = mat.hot("#e0362c", 1.1);
  part(geo.box(0.12, 0.05, 0.03), eyeMat, [-0.1, 0.28, 0.25], head); part(geo.box(0.12, 0.05, 0.03), eyeMat, [0.1, 0.28, 0.25], head);
  part(geo.box(0.16, 0.08, 0.04), grey, [0, 0.1, 0.23], head);
  g.visible = false; scene.add(g);
  return { g, legL, legR, armL, armR, eyeMat, st: "off", x: 0, y: 0, z: 0, gy: 0, vy: 0, yaw: 0, t: 0, cool: 0, turn: 0, turnDir: 1, spin: 0 };
}
function makeFrog() {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  part(geo.box(0.46, 0.26, 0.5), green, [0, 0.13, 0], body);
  part(geo.box(0.36, 0.06, 0.4), mat.lambert("#b9e67a"), [0, 0.02, 0.02], body);
  part(geo.box(0.12, 0.05, 0.1), mat.lambert("#4d8f2c"), [0.1, 0.27, -0.08], body);
  for (const s of [-1, 1]) {
    part(geo.box(0.13, 0.13, 0.13), shine, [s * 0.15, 0.3, 0.17], body); part(geo.box(0.07, 0.08, 0.02), black, [s * 0.15, 0.3, 0.24], body);
    part(geo.box(0.12, 0.14, 0.3), green, [s * 0.26, 0.07, -0.12], body);
  }
  const beamMat = mat.unlit("#c8ff9a", { transparent: true, opacity: 0.3 }); beamMat.depthWrite = false;
  const beam = part(geo.cyl(0.16, 0.16, 36, 8), beamMat, [0, 18.3, 0], g);
  scene.add(g);
  return { g, body, beam, st: "idle", x: 0, y: 0, z: 0, t: 0, hop: 0, zone: "a" };
}
const heroModel = makeMando(); scene.add(heroModel);
const pramModel = makePram(); pramModel.scale.setScalar(1.4); scene.add(pramModel);
const troopers = Array.from({ length: TROOPS }, makeTrooper);
const frogs = Array.from({ length: FROGS_A + FROGS_B }, makeFrog);
const heroShadow = blobShadow(scene, { radius: 0.55, opacity: 0.3 }), pramShadow = blobShadow(scene, { radius: 0.45, opacity: 0.22 });
const pBolts = new InstancedPool(scene, geo.box(0.09, 0.09, 0.8), mat.hot("#c8f4ff", 2.4), { max: 32, cull: false });
const eBolts = new InstancedPool(scene, geo.box(0.13, 0.13, 0.62), mat.hot("#ff4a36", 2.4), { max: 32, cull: false });
const chunks = new Chunks(scene, { colors: ["#f4f1e8", "#d8d3c8", "#2c2b30"], max: 260 });
const sparks = new Sparks(scene, { colors: ["#ffb13b", "#ff6a2b", "#fff1cf"], max: 500, size: 0.32 });
const fx = new Timeline(scene, { colors: [PALETTE[4], "#fff4df"] });
const flash = screenFlash("#flash", { color: PALETTE[3] });
function offTrooper(tr) { tr.st = "off"; tr.g.visible = false; }

// Grogu's pram floats behind Mando's shoulder
function pram(dt, t) {
  const s = Math.sin(H.yaw), c = Math.cos(H.yaw);
  const tx = H.x - s * 1.5 + c * 0.9, tz = H.z - c * 1.5 - s * 0.9;
  P.x = M.damp(P.x, tx, 4, dt); P.z = M.damp(P.z, tz, 4, dt);
  const ty = Math.max(groundAt(P.x, P.z), H.y) + 1.25 + Math.sin(t * 2.2) * 0.12 + (S.forceT > 0 ? 1.3 : 0);
  P.y = M.damp(P.y, ty, 5, dt); P.yaw = M.angleLerp(P.yaw, H.yaw, 5, dt);
}

// sound: the lonely desert whistle in A dorian, and every sound this game makes
const sfx = defineSfx({
  blast: [{ tone: { type: "sawtooth", f0: 1400, f1: 180, dur: 0.16, vol: 0.2 } }, { noise: { f0: 3200, f1: 900, dur: 0.07, vol: 0.12 } }],
  shatter: [{ noise: { f0: 900, f1: 200, dur: 0.26, vol: 0.34, q: 0.9 } }, { tone: { type: "square", f0: 240, f1: 110, dur: 0.07, vol: 0.14 } }],
  gulp: [{ tone: { type: "sine", f0: 300, f1: 900, dur: 0.18, vol: 0.3 } }, { tone: { type: "triangle", f0: 700, f1: 1300, dur: 0.08, vol: 0.2 }, at: 0.17 }],
  force: [{ tone: { type: "sine", f0: 82, f1: 55, dur: 1.3, vol: 0.42 } }, { tone: { type: "triangle", f0: 300, f1: 1250, dur: 1.0, vol: 0.12 } }],
  notyet: { tone: { type: "sine", f0: 220, f1: 180, dur: 0.1, vol: 0.12 } },
  jet: { noise: { f0: 520, f1: 300, dur: 0.12, vol: 0.12, q: 0.5 }, throttle: 0.09 },
  pew: { tone: { type: "square", f0: 900, f1: 280, dur: 0.14, vol: 0.13 } },
  charge: { tone: { type: "triangle", f0: 500, f1: 1100, dur: 0.6, vol: 0.07 } },
  thud: { noise: { f0: 320, f1: 80, dur: 0.22, vol: 0.26 } },
  hurt: [{ tone: { type: "square", f0: 320, f1: 80, dur: 0.3, vol: 0.28 } }, { noise: { f0: 700, f1: 150, dur: 0.3, vol: 0.28 } }],
  gate: [{ noise: { f0: 220, f1: 60, dur: 1.3, vol: 0.5, q: 0.6 } }, { tone: { type: "sawtooth", f0: 110, f1: 55, dur: 1.1, vol: 0.18 } }],
  jump: { tone: { type: "triangle", f0: 260, f1: 520, dur: 0.12, vol: 0.16 } },
  land: { noise: { f0: 500, f1: 150, dur: 0.1, vol: 0.14 }, throttle: 0.1 },
  clang: { tone: { type: "square", f0: 1800, f1: 1500, dur: 0.06, vol: 0.12 }, throttle: 0.05 },
  boom: [{ noise: { f0: 160, f1: 40, dur: 1.4, vol: 0.6, q: 0.5 } }, { tone: { type: "sine", f0: 70, f1: 30, dur: 1.2, vol: 0.5 } }],
  win: [{ tone: { type: "triangle", f0: 523, dur: 0.14, vol: 0.25 } }, { tone: { type: "triangle", f0: 659, dur: 0.14, vol: 0.25 }, at: 0.14 }, { tone: { type: "triangle", f0: 784, dur: 0.14, vol: 0.25 }, at: 0.28 }, { tone: { type: "triangle", f0: 1047, dur: 0.5, vol: 0.28 }, at: 0.42 }],
  fizz: { noise: { f0: 2400, f1: 1200, dur: 0.06, vol: 0.06 }, throttle: 0.05 },
}, { seed: 3 });
const TUNE = song({ bpm: 92, key: 57, scale: "dorian", motif: [57, null, 60, 62, 64, null, 62, 60, 57, 55, 57, null, 64, 62, 60, 57],
  voices: { lead: { wave: "triangle", env: [0.01, 0.2, 0.45, 0.3] }, bass: { wave: "square", env: [0.01, 0.15, 0.5, 0.2] },
    drums: { kit: "brush", pattern: "k..hs.h.k.khs.h." } }, bars: 4, seed: 4 });

// this game's own responses to each moment
function onStart() { playSong(TUNE); setIntensity(S.stage === "lava" ? 1 : 0.55); showMsg(S.stage === "lava" ? "THE LAVA FLATS!" : "GROGU IS HUNGRY! FIND FROGS", 2.4); }
function onOver() { setIntensity(0.2); }
function onJump() { sfx.jump(); }
function onLand(hard) { sfx.land(); chunks.burst([H.x, H.y + 0.05, H.z], { colors: ["#f3c98b", "#d49d5c"], n: hard ? 10 : 4, speed: 2.5, up: [1, 3], life: 0.5, grav: -14, size: 0.18, floor: H.y }); if (hard) rig.shake(0.2, 0.15); }
function onBlast() {
  sfx.blast(); const s = Math.sin(H.shootYaw), c = Math.cos(H.shootYaw);
  sparks.burst([H.x + s * 0.7, H.y + 1.15, H.z + c * 0.7], { colors: ["#c8f4ff", "#ffffff"], n: 6, speed: 3, life: 0.18, grav: 0 });
}
function onShatter(tr, byForce) {
  sfx.shatter({ pitch: byForce ? 0.8 : 1 }); tr.g.visible = false;
  chunks.burst([tr.x, tr.y + 1, tr.z], { n: byForce ? 22 : 18, speed: byForce ? 8 : 6, up: [3, 7], life: 1.1, grav: -16, spin: 9, size: 0.3, floor: groundAt(tr.x, tr.z) });
  sparks.burst([tr.x, tr.y + 1.2, tr.z], { colors: ["#ffffff", "#ff6a2b"], n: 10, speed: 5, life: 0.3, grav: 0 });
  rig.shake(byForce ? 0.25 : 0.18, 0.15);
}
function onBoltFizz(r, enemy) { sfx.fizz(); sparks.burst([r.x, r.y, r.z], { colors: enemy ? ["#ff6a2b", "#ffb13b"] : ["#c8f4ff", "#ffffff"], n: 5, speed: 2.5, life: 0.22, grav: -4 }); }
function onGulp(f) {
  sfx.gulp(); showMsg(`+100  NOM!`, 0.9);
  sparks.burst([P.x, P.y + 0.4, P.z], { colors: ["#7ccf4a", "#c8ff9a", "#ffffff"], n: 22, speed: 4, up: 2, life: 0.6, grav: -3 });
}
function onAllFrogs() { S.score += 500; showMsg("GROGU IS FULL! +500 …MORE FROGS!", 2.6); }
function onGate(silent) {
  rebuildGateOpen();
  if (silent) return;
  S.score += 250; sfx.gate(); setIntensity(1); rig.shake(0.7, 0.8); loop.slowmo(0.5, 0.6);
  for (let iz = WALL_Z; iz <= WALL_Z + 1; iz++) for (let ix = GATE_X0; ix <= GATE_X1; ix++)
    chunks.burst([ix + 0.5, 4.5, iz + 0.5], { colors: ["#c9d3dc", "#e8eef3", "#8d99a6"], n: 12, speed: 6, up: [2, 8], life: 1.4, grav: -14, spin: 7, size: 0.5, floor: 3 });
  fx.shockwave([0, 3.1, WALL_Z + 1], { color: "#fff4df", size: 14, dur: 0.8, flat: true });
  showMsg("THE BESKAR GATE IS OPEN!", 2.6);
}
function rebuildGateOpen() { gatePool.clear(); gatePool.sync(); }
function onTrooperIncoming(tr) { fx.flash([tr.x, tr.gy + 0.08, tr.z], { color: PALETTE[3], size: 1.8, dur: 0.9 }); }
function onTrooperLand(tr) { sfx.thud({ vol: 0.7 }); chunks.burst([tr.x, tr.y + 0.05, tr.z], { colors: ["#f3c98b", "#d49d5c"], n: 6, speed: 3, up: [1, 3], life: 0.5, grav: -14, size: 0.2, floor: tr.y }); }
function onTelegraph(tr) { sfx.charge(); }
function onTrooperShot(tr) { sfx.pew(); }
function onGrab(tr) { showMsg("HEY! HANDS OFF THE KID!", 1.4); }
function onHurt(why) { sfx.hurt(); flash.hit(0.45); rig.shake(0.45, 0.3); if (why === "lava") sparks.burst([H.x, H.y + 0.3, H.z], { n: 16, speed: 4, up: 5, life: 0.5, grav: -8 }); }
function onForce(n) {
  sfx.force(); rig.kick(8, 0.6); rig.shake(0.3, 0.6); loop.slowmo(0.6, 0.8);
  fx.shockwave([P.x, groundAt(P.x, P.z) + 0.1, P.z], { color: PALETTE[4], size: FORCE_R * 2, dur: 0.8, flat: true });
  fx.flash([P.x, P.y + 0.4, P.z], { color: "#c8ff9a", size: 3, dur: 0.4 });
  showMsg(n ? "THE FORCE!" : "…the kid is tired", 1.4);
}
function onForceNotReady() { sfx.notyet(); }
function onSlam(tr) { sfx.thud({ vol: 1 }); fx.shockwave([tr.x, tr.gy + 0.08, tr.z], { color: PALETTE[4], size: 3.2, dur: 0.35, flat: true }); }

function art(dt, t) {
  // Mando
  const sp = Math.hypot(H.vx, H.vz), mv = Math.min(1, sp / WALK), u = heroModel.userData;
  H.modelY = H.y > H.modelY && H.grounded ? M.damp(H.modelY, H.y, 18, dt) : H.y;
  heroModel.position.set(H.x, H.modelY, H.z); heroModel.rotation.y = H.yaw;
  const air = !H.grounded, sw = Math.sin(H.walk * 3) * 0.75 * mv;
  u.legL.rotation.x = air ? -0.35 : sw; u.legR.rotation.x = air ? 0.25 : -sw;
  u.armL.rotation.x = air ? -0.5 : -sw * 0.8;
  u.armR.rotation.x = H.shootT > 0 ? -1.45 : air ? -0.5 : sw * 0.8;
  u.cape.rotation.x = air ? 0.7 : 0.12 + mv * 0.35 + Math.sin(t * 3.1) * 0.05;
  u.flames.forEach((f, i) => { f.visible = H.jetting; f.scale.set(1, 0.8 + Math.sin(t * 60 + i * 2) * 0.35, 1); });
  heroModel.visible = S.inv <= 0 || Math.floor(S.inv * 12) % 2 === 0 || S.screen !== "play";
  heroShadow.follow(H.x, groundAt(H.x, H.z) + 0.02, H.z, H.y - groundAt(H.x, H.z));
  if (H.jetting) {
    sfx.jet();
    const s = Math.sin(H.yaw), c = Math.cos(H.yaw);
    for (const side of [-1, 1]) {
      const nx = H.x - s * 0.36 + c * 0.15 * side, nz = H.z - c * 0.36 - s * 0.15 * side;
      sparks.emit(nx, H.y + 0.95, nz, M.rand(-0.4, 0.4), -7, M.rand(-0.4, 0.4), M.chance(0.5) ? "#ffb13b" : "#fff1cf", 0.32, 1, 0);
    }
  }
  // Grogu
  pramModel.position.set(P.x, P.y, P.z); pramModel.rotation.y = P.yaw;
  const pu = pramModel.userData, lifting = S.forceT > 0;
  pu.kid.position.y = -0.05 + (lifting ? 0.18 : 0); pu.hand.visible = lifting;
  const nap = S.forceT < 0 && S.forceT > -2.2;   // the kid naps after using the Force
  pu.eyes.forEach((e) => e.scale.set(1, nap ? 0.15 : 1, 1));
  pu.head.rotation.z = nap ? 0.35 : Math.sin(t * 1.3) * 0.08; pu.head.scale.setScalar(S.gulpT > 0 ? 1 + Math.sin(S.gulpT * 25) * 0.12 : 1);
  pramShadow.follow(P.x, groundAt(P.x, P.z) + 0.02, P.z, P.y - groundAt(P.x, P.z));
  // troopers
  for (const tr of troopers) {
    const on = tr.st !== "off"; tr.g.visible = on; if (!on) continue;
    tr.g.position.set(tr.x, tr.y, tr.z); tr.g.rotation.y = tr.yaw + (tr.st === "lift" ? tr.spin : 0);
    tr.g.rotation.z = tr.st === "lift" ? Math.sin(tr.t * 5) * 0.6 : 0;
    const w = tr.st === "walk" ? Math.sin(tr.t * 9) * 0.6 : 0;
    tr.legL.rotation.x = tr.st === "drop" ? -0.4 : w; tr.legR.rotation.x = tr.st === "drop" ? 0.4 : -w;
    tr.armL.rotation.x = tr.st === "lift" ? -2.6 : -w * 0.7; tr.armR.rotation.x = tr.st === "aim" ? -1.5 : tr.st === "lift" ? -2.4 : w * 0.7;
    tr.eyeMat.color.set(PALETTE[3]).multiplyScalar(tr.st === "aim" ? 1.2 + tr.t * 5 : 1.1);
    if (tr.st === "lift" && M.chance(0.5)) {   // the green hand-beam of the Force from the kid to each floating trooper
      const k = Math.random();
      sparks.emit(M.lerp(P.x, tr.x, k), M.lerp(P.y + 0.5, tr.y + 1, k), M.lerp(P.z, tr.z, k), 0, 0.5, 0, M.chance(0.5) ? "#7ccf4a" : "#c8ff9a", 0.35, 2, 0);
    }
  }
  // frogs
  for (const f of frogs) {
    const show = f.st !== "gone"; f.g.visible = show; if (!show) continue;
    if (f.st === "fly") {   // zip into the kid's mouth
      const k = Math.min(1, f.t / 0.32);
      f.g.position.set(M.lerp(f.fx, P.x, k), M.lerp(f.fy, P.y + 0.4, k) + Math.sin(k * Math.PI) * 1.2, M.lerp(f.fz, P.z, k));
      f.body.scale.setScalar(1 - k * 0.7); f.beam.visible = false;
    } else {
      const hop = f.hop > 0 ? Math.sin((f.hop / 0.45) * Math.PI) * 0.45 : 0;
      f.g.position.set(f.x, f.y + hop, f.z); f.body.rotation.y = Math.sin(f.t * 0.7 + f.x) * 1.2; f.body.scale.setScalar(1);
      f.beam.visible = true; f.beam.material.opacity = 0.22 + Math.sin(t * 3 + f.x) * 0.08;
    }
  }
  climaxArt(t);
  sparks.update(dt); chunks.update(dt); fx.update(dt); flash.update(dt);
}
function render(a, t) {
  tick(t); pBolts.sync(); eBolts.sync();
  for (const s of suns) s.sp.position.set(G.camera.position.x + s.off[0], G.camera.position.y + s.off[1], G.camera.position.z + s.off[2]);
  L.follow(heroModel.position);
}

// ── CLIMAX (polish layer) ──
// The boss: when Grogu has eaten all 8 frogs, THE BLOCK GOLEM (a giant of dark-trooper armor blocks) crashes into the
// lava flats. It walks at you, winds up (red ring) and STOMPS a ring of force you must jump or jet over; after each
// stomp its 3 red cores glow and your blaster can crack them (4 hits each). Grogu's Force rips a core straight out.
const GOLEM_TEX = blockTex(7, { a: "#7b8290", b: "#646b78", c: "#9aa1ad", d: "#e0362c" },
  (x, y, r) => ((x + y * 3) % 13 === 0 && r < 0.5 ? "d" : r < 0.5 ? "a" : r < 0.8 ? "b" : "c"));
const golemMat = rim(blockMat(GOLEM_TEX, false), { color: "#ffd0a0", power: 2, strength: 0.6 }), faceMat = mat.lambert("#f4f1e8");
const GS = 0.9;                                                    // one golem block = 0.9 m
function blockLimb(parent, cells, px, py, m = golemMat) {
  const g = new THREE.Group(); g.position.set(px * GS, py * GS, 0); parent.add(g);
  const im = new THREE.InstancedMesh(cube, m, cells.length), o = new THREE.Object3D();
  cells.forEach(([x, y, z], i) => { o.position.set(x * GS, y * GS, z * GS); o.scale.setScalar(GS); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
  im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); g.add(im); return g;
}
const box3 = (x0, x1, y0, y1, z0, z1) => { const c = []; for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) c.push([x, y, z]); return c; };
const golem = (() => {
  const g = new THREE.Group();
  const legL = blockLimb(g, box3(0, 1, -3, -1, 0, 1), -1.5, 3.5), legR = blockLimb(g, box3(0, 1, -3, -1, 0, 1), 0.5, 3.5);
  blockLimb(g, box3(-2, 1, 3, 5, 0, 1), 0.5, 0.5);
  const head = blockLimb(g, box3(-1, 0, 0, 1, 0, 1), 0.5, 6.5);
  part(geo.box(1.7, 0.5, 0.1), faceMat, [0, 0.7, 1.45], head);
  const visor = mat.hot("#e0362c", 1.6);
  part(geo.box(0.55, 0.16, 0.06), visor, [-0.42, 0.72, 1.52], head); part(geo.box(0.55, 0.16, 0.06), visor, [0.42, 0.72, 1.52], head);
  const armL = blockLimb(g, box3(0, 0, -3, -1, 0, 1), -2.5, 6.5), armR = blockLimb(g, box3(0, 0, -3, -1, 0, 1), 2.5, 6.5);
  const cores = [[-0.9, 4.9], [0.9, 4.9], [0, 3.7]].map(([x, y]) => {
    const m = mat.hot("#e0362c", 1); const mesh = part(geo.box(0.75, 0.75, 0.2), m, [x * GS, y * GS, 1.45], g);
    return { mesh, m, st: "core", hp: 4, x: 0, y: 0, z: 0 };
  });
  g.visible = false; scene.add(g);
  return { g, legL, legR, armL, armR, head, cores };
})();
const B = { st: "off", x: 0, y: 0, z: 0, gy: 0, vy: 0, yaw: Math.PI, t: 0, ring: 0, beaten: 0 };
const golemShadow = blobShadow(scene, { radius: 2.6, opacity: 0.35 });
const wp = new THREE.Vector3();
function climaxBusy() { return B.st !== "off"; }
function climaxAllFrogs() {           // true = the climax takes over from the respawn loop
  if (B.beaten > 0 || B.st !== "off") return false;
  const gx = M.clamp(H.x, -8, 8) + 0.5, gz = Math.min(Z1 - 8, H.z + 12);
  Object.assign(B, { st: "drop", x: gx, z: gz, gy: groundAt(gx, gz), y: groundAt(gx, gz) + 26, vy: 0, t: 0, yaw: Math.PI });
  golem.cores.forEach((c) => { c.st = "core"; c.hp = 4; c.mesh.visible = true; });
  S.stage = "golem"; showMsg("THE BLOCK GOLEM IS COMING!", 2.4); sfx.charge({ pitch: 0.5, vol: 2 });
  return true;
}
function climaxTarget(range) {
  if (B.st === "off" || B.st === "drop") return null;
  let best = null, bd = range + 6;
  for (const c of golem.cores) { if (c.st !== "core") continue; const d = Math.hypot(c.x - H.x, c.z - H.z); if (d < bd) { bd = d; best = c; } }
  return best;
}
function climaxBolt(r) {
  if (B.st === "off" || B.st === "drop") return false;
  for (const c of golem.cores) {
    if (c.st !== "core" || Math.hypot(c.x - r.x, c.y + 1 - r.y, c.z - r.z) > 0.9) continue;
    if (B.st !== "open") { sfx.clang(); sparks.burst([r.x, r.y, r.z], { colors: ["#ffffff", "#c9d3dc"], n: 6, speed: 4, life: 0.2, grav: -6 }); return true; }
    c.hp--; loop.hitstop(40); sfx.shatter({ pitch: 1.5 }); sparks.burst([r.x, r.y, r.z], { colors: ["#e0362c", "#ffb13b"], n: 12, speed: 5, life: 0.3, grav: -6 });
    if (c.hp <= 0) popCore(c);
    return true;
  }
  if (Math.hypot(B.x - r.x, B.z - r.z) < 2.2 && r.y < B.y + 7) { sfx.clang(); return true; }
  return false;
}
function climaxForce() {             // the Signature, deepened: the kid rips a core out of the golem
  if (B.st === "off" || B.st === "drop" || Math.hypot(B.x - P.x, B.z - P.z) > FORCE_R * 1.6) return 0;
  const c = golem.cores.find((q) => q.st === "core"); if (!c) return 0;
  popCore(c); for (let i = 0; i < 16; i++) { const k = i / 16; sparks.emit(M.lerp(P.x, c.x, k), M.lerp(P.y + 0.5, c.y + 1, k), M.lerp(P.z, c.z, k), 0, 1, 0, "#c8ff9a", 0.6, 1, 0); }
  return 1;
}
function popCore(c) {
  c.st = "off"; c.mesh.visible = false; S.score += 300;
  chunks.burst([c.x, c.y + 1, c.z], { colors: ["#e0362c", "#ffb13b", "#7b8290"], n: 20, speed: 7, up: [3, 8], life: 1.2, grav: -14, size: 0.35, floor: B.gy });
  rig.shake(0.4, 0.3); showMsg("CORE CRACKED! +300", 1.2);
  if (golem.cores.every((q) => q.st === "off")) golemDown();
}
function golemDown() {
  B.st = "off"; B.beaten++; golem.g.visible = false; S.score += 2000; S.stage = "lava";
  sfx.boom(); sfx.win(); rig.shake(1, 1); loop.slowmo(0.35, 1.2);
  for (let i = 0; i < 6; i++) chunks.burst([B.x + M.rand(-1.5, 1.5), B.gy + 1 + i, B.z + M.rand(-1, 1)], { colors: ["#7b8290", "#646b78", "#9aa1ad", "#e0362c"], n: 24, speed: 9, up: [3, 10], life: 1.6, grav: -14, spin: 8, size: 0.6, floor: B.gy });
  fx.shockwave([B.x, B.gy + 0.1, B.z], { color: "#fff4df", size: 20, dur: 1, flat: true });
  showMsg("THE GOLEM IS SCRAP! THIS IS THE WAY. +2000", 3.2);
  respawnFrogs();
}
function climax(dt, t) {
  if (B.st === "off") return;
  B.t += dt;
  const dx = H.x - B.x, dz = H.z - B.z, d = Math.hypot(dx, dz) || 1;
  if (B.st === "drop") {
    B.vy -= 40 * dt; B.y += B.vy * dt;
    if (B.y <= B.gy) { B.y = B.gy; B.st = "walk"; B.t = 0; sfx.boom(); rig.shake(0.9, 0.6); fx.shockwave([B.x, B.gy + 0.1, B.z], { color: PALETTE[3], size: 16, dur: 0.8, flat: true });
      chunks.burst([B.x, B.gy + 0.3, B.z], { colors: ["#4b3f3f", "#ff6a2b"], n: 30, speed: 8, up: [3, 8], life: 1.2, grav: -14, size: 0.4, floor: B.gy }); showMsg("THE BLOCK GOLEM!", 1.6); }
  } else if (B.st === "walk") {
    B.yaw = M.angleLerp(B.yaw, Math.atan2(dx, dz), 3, dt);
    if (d > 4) { B.x += (dx / d) * 1.4 * dt; B.z += (dz / d) * 1.4 * dt; B.x = M.clamp(B.x, X0 + 4, X1 - 4); B.z = M.clamp(B.z, WALL_Z + 5, Z1 - 4); }
    B.gy = M.damp(B.gy, groundAt(B.x, B.z), 4, dt); B.y = B.gy;
    if (B.t > 2.6) { B.st = "wind"; B.t = 0; sfx.charge({ pitch: 0.6, vol: 2 }); fx.flash([B.x, B.gy + 0.1, B.z], { color: PALETTE[3], size: 8, dur: 0.9 }); }
  } else if (B.st === "wind" && B.t > 0.9) {
    B.st = "stomp"; B.t = 0; B.ring = 0; sfx.boom(); rig.shake(0.7, 0.4);
    fx.shockwave([B.x, B.gy + 0.15, B.z], { color: PALETTE[3], size: 28, dur: 0.9, flat: true });
  } else if (B.st === "stomp") {
    B.ring = (B.t / 0.9) * 14;
    if (H.grounded && Math.abs(Math.hypot(H.x - B.x, H.z - B.z) - B.ring) < 1.0 && H.y < B.gy + 1.5) hurt("stomp");
    if (B.t > 0.9) { B.st = "open"; B.t = 0; showMsg("BLAST THE GLOWING CORES!", 1.4); }
  } else if (B.st === "open" && B.t > 2.8) { B.st = "walk"; B.t = 0; }
  if (S.screen === "play" && d < 2.6 && H.y < B.y + 6) { hurt("golem"); H.x += (dx / d) * 1.5; H.z += (dz / d) * 1.5; }
}
function climaxArt(t) {
  const on = B.st !== "off"; golem.g.visible = on; golemShadow.mesh.visible = on; if (!on) return;
  golem.g.position.set(B.x, B.y, B.z); golem.g.rotation.y = B.yaw;
  const w = B.st === "walk" ? Math.sin(B.t * 4) * 0.35 : 0, wind = B.st === "wind" ? M.smoothstep(0, 0.9, B.t) : 0, open = B.st === "open";
  golem.legL.rotation.x = w; golem.legR.rotation.x = -w;
  golem.armL.rotation.x = -w * 0.6 - wind * 2.6; golem.armR.rotation.x = w * 0.6 - wind * 2.6;
  golem.g.position.y = B.y - (open ? 0.6 : 0) + (B.st === "wind" ? wind * 0.6 : 0);
  golem.g.updateMatrixWorld();
  for (const c of golem.cores) {
    c.m.color.set(PALETTE[3]).multiplyScalar(open ? 2.2 + Math.sin(t * 14) * 0.8 : 0.55);
    c.mesh.getWorldPosition(wp); c.x = wp.x; c.y = wp.y - 1; c.z = wp.z;
  }
  golemShadow.follow(B.x, B.gy + 0.03, B.z, B.y - B.gy);
}
function climaxReset() { B.st = "off"; B.beaten = 0; golem.g.visible = false; if (S.startStage === "golem") climaxAllFrogs(); }
function climaxOver() {}
function climaxState() { return { golem: B.st, cores: golem.cores.filter((c) => c.st === "core").length, beaten: B.beaten }; }
function climaxWarm() { golem.g.visible = true; golemShadow.mesh.visible = true; return [golem.g, golemShadow.mesh]; }

// ── STRUCTURE ──
// boot: the grid is built; place the title scene, compile everything, then run
closeGate(); placeFrogs(false);
H.x = START.canyon.x; H.z = START.canyon.z; H.y = H.modelY = footMax(H.x, H.z, HERO_R); H.yaw = 0.5;
Object.assign(P, { x: H.x - 1, y: H.y + 1.3, z: H.z - 1.3 });
{ const b1 = pBolts.spawn({ x: 0, y: -50, z: 0, data: {} }), b2 = eBolts.spawn({ x: 0, y: -50, z: 0, data: {} });
  pBolts.sync(); eBolts.sync();
  chunks.burst([0, -50, 0], { n: 2 }); sparks.burst([0, -50, 0], { n: 2 });
  chunks.burst([0, -50, 0], { colors: ["#f3c98b"], n: 2, floor: -60 }); sparks.emit(0, -50, 0, 0, 0, 0, "#ffb13b", 0.2, 1, 0);
  fx.shockwave([0, -50, 0], { color: PALETTE[4], size: 2, dur: 0.1, flat: true }); fx.flash([0, -50, 0], { color: PALETTE[3], size: 1, dur: 0.1 });
  fx.shockwave([0, -50, 0], { color: "#fff4df", size: 2, dur: 0.1, flat: true }); fx.flash([0, -50, 0], { color: "#c8ff9a", size: 1, dur: 0.1 });
  pramModel.userData.hand.visible = true; heroModel.userData.flames.forEach((f) => { f.visible = true; }); heroShadow.mesh.visible = pramShadow.mesh.visible = true;
  G.warm([heroModel, pramModel, ...troopers.map((q) => q.g), ...frogs.map((f) => f.g), ...Object.values(terrain), gatePool.mesh,
    pBolts.mesh, eBolts.mesh, chunks, sparks, fx, heroShadow.mesh, pramShadow.mesh, ...suns.map((q) => q.sp), ...climaxWarm()]);
  pBolts.free(b1); eBolts.free(b2); pramModel.userData.hand.visible = false; }
shell.show("title");
loop = startLoop({ step, render, snapshot, input, G, commands });
