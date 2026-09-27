// Shark Jaws Toy Store — by The Jaws Store Experience. An arena-3d game on the kit/three toolbox (./lib-2/),
// look "Tin Shark Emporium" (glossy-toy). You walk in through a giant shark's jaws into a round toy store: wind-up
// chomper toys hop out of the displays (DASH bonks them into prizes), the arcade machine farts when you run into it,
// and the Signature is the shark tank in the middle — DIP your hand in and the little sharks come to you, but the
// store owner with the flashlight is watching for exactly that. Toolbox API: kit/three/README.md.
// Regions: STRUCTURE (from the arena-3d recipe) · ART (this game's alone) · CLIMAX (the polish layer).
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { boot, startLoop, best, M, params } from "./lib-2/core.js";
import { createShell } from "./lib-2/shell.js";
import { createInput } from "./lib-2/input.js";
import { createRig } from "./lib-2/camera.js";
import { defineSfx, song, playSong, setIntensity } from "./lib-2/audio.js";
import { Sparks, Chunks, Timeline, screenFlash } from "./lib-2/fx.js";
import { geo, mat, part, hitFlash, lights, envMap, canvasTex, skyDome } from "./lib-2/art.js";
import { InstancedPool, pushOutCircles, clampToDisc, spawnClear, steer } from "./lib-2/physics.js";
import { waterMat, tick } from "./lib-2/shaders.js";

// ── STRUCTURE ──
const PALETTE = ["#123a5c", "#2ec4b6", "#ff9f1c", "#e63946", "#ffd23f"];   // deep-sea navy · tank teal · sneaker orange · jaws red · prize gold
const SLUG = "shark-jaws-store", ORIENT = "landscape";
const ARENA = 15, HORDE = 40, HERO_R = 0.55, CHOMP_R = 0.5, OWNER_R = 0.8;
const RUN = 9, DASH = { time: 0.3, speed: 22, cool: 0.45, aimR: 6, aimCos: 0.5 };
const ACTS = [["toy-halls", 1], ["closing-time", 4]];   // [stage, first wave]; the climax layer appends its own act
const WAVE_MAX = 16;
const VAT_R = 2.6, DIP_R = VAT_R + HERO_R + 0.9, CONE_R = 6, CONE_HALF = 0.5;
const ARCADE = { x: -12.1, z: -2.2 };
const DISPLAYS = [-150, -90, -30, 30, 150].map((deg) => { const a = (deg * Math.PI) / 180; return { x: Math.cos(a) * 9, z: Math.sin(a) * 9, r: 1.5 }; });
const SOLIDS = [{ x: 0, z: 0, r: VAT_R + 0.15 }, ...DISPLAYS, { x: ARCADE.x, z: ARCADE.z, r: 1.0 }];

const G = boot({ canvas: "#view", background: PALETTE[0], bloom: null, toneMapping: "agx", shadows: true,
  camera: { fov: 55, near: 0.1, far: 260 }, errorMessage: "Uh oh, the toy store tripped over a bug! Show this to a grown-up:" });
const input = createInput({
  stick: { zone: "#stick-zone", mode: "float", radius: 60, deadzone: 0.08, base: "#stick-base", knob: "#stick-knob" },
  buttons: { "#btn-dash": "dash" } });
const shell = createShell({ screens: { title: "#title", over: "#over" }, orient: ORIENT, input,
  prompt: { el: "#prompt", text: input.isTouch ? "tap to walk in the jaws!" : "press space to walk in the jaws!" },
  onShow: (name) => { if (name === "title" || name === "over") G.quality.probeUp(); } });
shell.hubLink(); shell.rotate("#rotate");
const hudScore = shell.text("#score"), hudWave = shell.text("#wave"), finalScore = shell.text("#final"), bestScore = shell.text("#best");
const btnLabel = shell.text("#btn-dash"), bannerBig = shell.text("#banner-big"), bannerSmall = shell.text("#banner-small");
const record = best(SLUG), rig = createRig(G.camera);

const S = { screen: "title", stage: "toy-halls", startStage: "toy-halls", t: 0, score: 0, lives: 3, wave: 0, waveT: 0, gap: 0, inv: 0,
  dashT: 0, cool: 0, dipT: 0, dips: 0, farts: 0, fartCool: 0, toyT: 2, bonks: 0, toysGot: 0, banner: 0 };
const H = { x: 0, z: 11.5, vx: 0, vz: 0, dx: 0, dz: -1, ax: 0, az: -1, yaw: Math.PI };
const O = { x: 5.5, z: 0, yaw: 0, a: 0, mode: "patrol", t: 0, dx: 0, dz: 0, v: { x: 0, z: 0 } };   // the store owner
const CAM = { height: 18, back: 6, k: 5 }, camT = { x: 0, y: 0, z: 0 }, goal = { x: 0, y: 0, z: 0 };
let loop = null;
const hopSpeed = (w) => Math.min(6.4, 2.8 + 0.35 * w) * (S.stage === "closing-time" ? 1.1 : 1);
const actOf = (w) => ACTS.reduce((s, [name, from]) => (w >= from ? name : s), ACTS[0][0]);
const lives = [...document.querySelectorAll("#lives i")];
const nearVat = () => Math.hypot(H.x, H.z) < DIP_R;

function start() {
  const act = ACTS.find(([n]) => n === S.startStage) || ACTS[0];
  Object.assign(S, { screen: "play", stage: act[0], t: 0, score: 0, lives: 3, wave: act[1] - 1, waveT: 0, gap: 1.2, inv: 0,
    dashT: 0, cool: 0, dipT: 0, dips: 0, farts: 0, fartCool: 0, toyT: 2, bonks: 0, toysGot: 0, banner: 0 });
  Object.assign(H, { x: 0, z: 11.5, vx: 0, vz: 0, dx: 0, dz: -1, ax: 0, az: -1, yaw: Math.PI });
  Object.assign(O, { x: 5.5, z: 0, a: 0, mode: "patrol", t: 0 });
  chomps.clear(); rockets.clear(); robots.clear();
  lives.forEach((el) => el.classList.remove("gone")); hudScore(0); hudWave("AISLE " + (S.wave + 1));
  climaxReset(); shell.show("play"); onStart();
}
function over() {
  if (S.screen === "over") return;
  S.screen = "over"; climaxOver();
  const r = record.submit(S.score);
  finalScore(S.score); bestScore(r.best); shell.show("over"); onOver(r.isNew);
}
function beginWave(n) {
  S.wave = n; S.waveT = 0; S.stage = actOf(n); hudWave("AISLE " + n);
  if (climaxWave(n)) return;
  const want = Math.min(HORDE - chomps.count, 4 + 2 * n);
  for (let i = 0; i < want; i++) {
    const d = DISPLAYS[i % DISPLAYS.length], a = M.rand(0, Math.PI * 2);
    const p = { x: d.x + Math.cos(a) * 2, z: d.z + Math.sin(a) * 2 };
    if (Math.hypot(p.x - H.x, p.z - H.z) < 5) { const q = spawnClear({ minR: 6, maxR: 14, avoid: [{ x: H.x, z: H.z, r: 6 }, ...SOLIDS] }); if (q) { p.x = q.x; p.z = q.z; } }
    spawnChomp(p.x, p.z);
  }
  onWave(n, S.stage);
}
function endWave(cleared) {
  if (cleared) { S.score += 100 * S.wave; onClear(S.wave); }
  S.gap = cleared ? 2.2 : 0.8;
}
function spawnChomp(x, z) {
  return chomps.spawn({ x, y: 0, z, scale: 1, color: M.pick(CHOMP_TINTS), data: { v: { x: 0, z: 0 }, hop: M.rand(0, 6.28), wander: M.rand(0, 6.28) } });
}

function run(dt) {
  const ax = input.axis.x, az = -input.axis.y; const L = Math.hypot(ax, az);
  if (L > 0.1) { H.ax = ax / L; H.az = az / L; }
  const press = input.pressed("dash") || input.pressed("a") || input.pressed("b");
  if (press && S.dipT <= 0 && nearVat()) dip();
  else if (press && S.cool <= 0 && S.dipT <= 0) {
    let dx = H.ax, dz = H.az, bestD = DASH.aimR;
    chomps.each((id, r) => { const ex = r.x - H.x, ez = r.z - H.z, d = Math.hypot(ex, ez);
      if (d < bestD && d > 0.01 && (ex * H.ax + ez * H.az) / d > DASH.aimCos) { bestD = d; dx = ex / d; dz = ez / d; } });
    H.dx = dx; H.dz = dz; S.dashT = DASH.time; S.cool = DASH.cool + DASH.time; onDash();
  }
  if (S.dipT > 0) { S.dipT -= dt; H.vx = 0; H.vz = 0; }
  else if (S.dashT > 0) { S.dashT -= dt; H.vx = H.dx * DASH.speed; H.vz = H.dz * DASH.speed; }
  else { H.vx = M.damp(H.vx, ax * RUN, 12, dt); H.vz = M.damp(H.vz, az * RUN, 12, dt); }
  S.cool -= dt; H.x += H.vx * dt; H.z += H.vz * dt;
  if (pushOutCircles(H, HERO_R, SOLIDS) && S.dashT > 0) S.dashT = 0;
  clampToDisc(H, ARENA - HERO_R, (p, nx, nz) => { const vn = H.vx * nx + H.vz * nz; if (vn > 0) { H.vx -= vn * nx; H.vz -= vn * nz; } });
  if (S.dipT > 0) H.yaw = M.angleLerp(H.yaw, Math.atan2(-H.x, -H.z), 16, dt);
  else if (Math.hypot(H.vx, H.vz) > 0.5) H.yaw = M.angleLerp(H.yaw, Math.atan2(H.vx, H.vz), 14, dt);
  S.fartCool -= dt;
  if (S.fartCool <= 0 && Math.hypot(H.x - ARCADE.x, H.z - ARCADE.z) < 1.0 + HERO_R + 0.3) fart();
  btnLabel(nearVat() ? "DIP" : "DASH");
}
function dip() {   // the Signature: a hand in the shark tank
  S.dipT = 0.7; S.dips++;
  const sneaky = O.mode === "laugh";
  S.score += (sneaky ? 2 : 1) * (40 + 10 * Math.min(6, S.dips));
  if (!sneaky && O.mode !== "charge") aimOwner();
  onDip(sneaky);
}
function fart() {
  S.fartCool = 1.6; S.farts++; S.score += 5;
  if (O.mode === "patrol") { O.mode = "laugh"; O.t = 0; }
  onFart();
}
function aimOwner() { O.mode = "aim"; O.t = 0; const dx = H.x - O.x, dz = H.z - O.z, L = Math.hypot(dx, dz) || 1; O.dx = dx / L; O.dz = dz / L; onTelegraph(); }
function owner(dt) {
  O.t += dt;
  const late = S.stage !== "toy-halls";
  if (O.mode === "patrol") {
    O.a += (late ? 0.34 : 0.24) * dt;
    goal.x = Math.cos(O.a) * 5.6; goal.z = Math.sin(O.a) * 5.6;
    steer(O.v, O, goal, late ? 3.4 : 2.4, 4, dt); O.x += O.v.x * dt; O.z += O.v.z * dt;
    if (Math.hypot(O.v.x, O.v.z) > 0.3) O.yaw = M.angleLerp(O.yaw, Math.atan2(O.v.x, O.v.z), 6, dt);
    if (late && S.screen === "play" && S.inv <= 0 && O.t > 1.2 && !climaxBusy()) {   // closing time: he spots any kid in his flashlight beam
      const ex = H.x - O.x, ez = H.z - O.z, d = Math.hypot(ex, ez);
      if (d < CONE_R && (ex * Math.sin(O.yaw) + ez * Math.cos(O.yaw)) / (d || 1) > Math.cos(CONE_HALF)) aimOwner();
    }
  } else if (O.mode === "laugh") {
    O.yaw = M.angleLerp(O.yaw, Math.atan2(ARCADE.x - O.x, ARCADE.z - O.z), 8, dt);
    if (O.t > 2.4) { O.mode = "patrol"; O.t = 0; }
  } else if (O.mode === "aim") {
    O.yaw = M.angleLerp(O.yaw, Math.atan2(O.dx, O.dz), 12, dt);
    if (O.t >= 0.9) { O.mode = "charge"; O.t = 0; onCharge(); }
  } else if (O.mode === "charge") {
    const sp = late ? 15 : 13; O.x += O.dx * sp * dt; O.z += O.dz * sp * dt;
    const hit = pushOutCircles(O, OWNER_R, SOLIDS);
    if (clampToDisc(O, ARENA - OWNER_R) || hit || O.t > 1.3) { O.mode = "rest"; O.t = 0; }
  } else if (O.mode === "rest" && O.t > 1.2) { O.mode = "patrol"; O.t = 0; O.a = Math.atan2(O.z, O.x); }
  pushOutCircles(O, OWNER_R, SOLIDS); clampToDisc(O, ARENA - OWNER_R);
}
function chompers(dt, t) {
  const sp = hopSpeed(Math.max(1, S.wave)), hunting = S.screen === "play";
  chomps.each((id, r) => {
    const d = r.data;
    if (hunting) steer(d.v, r, H, sp, 2.4, dt);
    else { d.wander += dt * 0.8; goal.x = Math.cos(d.wander) * 9; goal.z = Math.sin(d.wander * 1.3) * 7; steer(d.v, r, goal, 2.5, 1.5, dt); }
    const hop = Math.max(0, Math.sin(t * 9 + d.hop));
    r.x += d.v.x * dt * (0.4 + hop); r.z += d.v.z * dt * (0.4 + hop); r.y = hop * 0.35;
    pushOutCircles(r, CHOMP_R, SOLIDS); clampToDisc(r, ARENA - CHOMP_R);
    r.rotY = Math.atan2(d.v.x, d.v.z); r.rotX = -0.25 * hop;
  });
  const list = []; chomps.each((id, r) => list.push({ x: r.x, z: r.z, r: CHOMP_R }));
  let k = 0; chomps.each((id, r) => { const me = list[k], sx = me.x; me.x = 1e9; pushOutCircles(r, CHOMP_R, list); me.x = sx; k++; });
}
function contacts(dt) {
  const dashing = S.dashT > 0;
  chomps.each((id, r) => {
    if (Math.hypot(r.x - H.x, r.z - H.z) > HERO_R + CHOMP_R + (dashing ? 0.35 : 0)) return;
    if (dashing) { bonk(r); chomps.free(id); }
    else hurt(r);
  });
  if (Math.hypot(O.x - H.x, O.z - H.z) < HERO_R + OWNER_R && O.mode !== "laugh") {
    if (dashing) { S.dashT = 0; H.vx *= -0.5; H.vz *= -0.5; onBounceOwner(); }
    else if (O.mode === "charge" || O.mode === "aim") { hurt(O, true); O.mode = "rest"; O.t = 0; }
    else pushOutCircles(H, HERO_R, [{ x: O.x, z: O.z, r: OWNER_R }]);
  }
  for (const pool of [rockets, robots]) pool.each((id, r) => {
    const d = r.data, dist = Math.hypot(r.x - H.x, r.z - H.z);
    if (dist < 2) { steer(d.v, r, H, 14, 8, dt); r.x += d.v.x * dt; r.z += d.v.z * dt; }
    if (dist < HERO_R + 0.5) { pool.free(id); S.score += 25; S.toysGot++; onToy(r); }
  });
}
function bonk(r) {
  S.bonks++; S.score += 10; loop.hitstop(70); onBonk(r);
  if (M.chance(0.5)) dropToy(r.x, r.z);
}
function hurt(from, byOwner = false) {
  if (S.inv > 0 || S.dashT > 0) return;
  const ex = H.x - from.x, ez = H.z - from.z, L = Math.hypot(ex, ez) || 1;
  H.vx = (ex / L) * 14; H.vz = (ez / L) * 14; S.inv = 1.3; S.dipT = 0;
  if (!params.god) S.lives--;
  onHurt(byOwner, S.lives);
  if (S.lives <= 0) over();
}
function waves(dt) {
  if (S.gap > 0) { S.gap -= dt; if (S.gap <= 0) beginWave(S.wave + 1); return; }
  S.waveT += dt;
  const left = chomps.count + climaxLeft();
  if (left === 0) endWave(true); else if (S.waveT > WAVE_MAX && !climaxLeft()) endWave(false);
}
function dropToy(x, z) {
  if (rockets.count + robots.count >= 10) return;
  const p = { x, z }; clampToDisc(p, ARENA - 1.5); pushOutCircles(p, 0.6, SOLIDS);
  (M.chance(0.5) ? rockets : robots).spawn({ x: p.x, y: 0.2, z: p.z, scale: 1, color: "#ffffff", data: { v: { x: 0, z: 0 }, ph: M.rand(0, 6) } });
}
function spawnToys(dt) {   // "find the coolest toys": prizes turn up in the halls between the displays
  S.toyT -= dt; if (S.toyT > 0 || rockets.count + robots.count >= 4) return;
  S.toyT = 3; const p = spawnClear({ minR: 4, maxR: ARENA - 2, avoid: [{ x: H.x, z: H.z, r: 4 }, ...SOLIDS] });
  if (p) dropToy(p.x, p.z);
}

function step(dt, t) {
  if (S.screen !== "play") {
    if (input.pressed("start") && shell.canAccept()) start();
    else { attract(dt, t); rig.orbit({ x: 0, y: 0, z: 3 }, { radius: 20, height: 15, speed: 0.1, k: 2.5 }); }
  }
  if (S.screen === "play") {
    S.t += dt; S.inv -= dt;
    run(dt); waves(dt); spawnToys(dt); climax(dt, t);
    camT.x = H.x + H.vx * 0.22; camT.z = H.z + H.vz * 0.22;
    rig.top(camT, CAM);
  }
  owner(dt);
  chompers(dt, t);
  if (S.screen === "play") contacts(dt);
  hudScore(S.score);
  art(dt, t);
  rig.update(dt, t);
}
function attract(dt, t) {   // title and over: the kid wanders past the jaws while chompers hop around the displays
  const px = H.x, pz = H.z; H.x = Math.sin(t * 0.5) * 6; H.z = 9 + Math.sin(t) * 2.5;
  H.vx = (H.x - px) / Math.max(dt, 1e-3); H.vz = (H.z - pz) / Math.max(dt, 1e-3);
  if (dt > 0) H.yaw = M.angleLerp(H.yaw, Math.atan2(H.vx, H.vz), 10, dt);
  if (chomps.count < 6) { const p = spawnClear({ minR: 5, maxR: 13, avoid: SOLIDS }); if (p) spawnChomp(p.x, p.z); }
}

const snapshot = () => ({ screen: S.screen, stage: S.stage, score: S.score, best: record.get(), lives: S.lives, wave: S.wave,
  enemies: chomps.count, toys: rockets.count + robots.count, dashing: S.dashT > 0, dipping: S.dipT > 0, dips: S.dips, farts: S.farts,
  owner: O.mode, bonks: S.bonks, entities: chomps.count + rockets.count + robots.count + 1,
  focus: { x: +H.x.toFixed(3), y: 0, z: +H.z.toFixed(3) }, ...climaxState() });
const commands = {
  die: over,
  at: (stage) => { if (ACTS.some(([n]) => n === String(stage))) S.startStage = String(stage); },
};

// ── ART ──
const scene = G.scene;
const sky = skyDome(scene, { top: "#0b2640", horizon: PALETTE[1], bottom: PALETTE[0], fog: { mode: "linear-horizon", near: 34, far: 80 } });
const light = lights(scene, { preset: "hemi+sun", sky: "#fff4dc", ground: PALETTE[0], sun: "#fff1cf", sunIntensity: 2.4, hemiIntensity: 1.3,
  shadow: { size: 1024, extent: 18 } });
light.sun.position.set(6, 16, 8);
envMap(G.renderer, scene);
const toy = (hex, o = {}) => mat.standard(hex, { metalness: o.metal ?? 0.3, roughness: o.rough ?? 0.38 });
const TIN = toy("#d9dde2", { metal: 0.5, rough: 0.3 }), WHITE = toy("#f6f1e7", { metal: 0.2 }), SKIN = toy("#f2c29b", { metal: 0.2, rough: 0.5 });
const RED = toy(PALETTE[3]), GOLD = toy(PALETTE[4], { metal: 0.5 }), ORANGE = toy(PALETTE[2]), TEAL = toy(PALETTE[1]), NAVY = toy(PALETTE[0], { metal: 0.2 });
const SHARKGREY = toy("#7d93a8", { metal: 0.35, rough: 0.35 });

// the floor: toy-store tiles in the tank's navy and teal, laid out like a big checkerboard play mat
const floorTex = canvasTex(256, 256, (c, w, h) => {
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { c.fillStyle = (x + y) % 2 ? "#0e2f4d" : "#1a5876"; c.fillRect(x * 32, y * 32, 32, 32); }
  c.strokeStyle = "rgba(255,255,255,.08)"; c.lineWidth = 2; for (let i = 0; i <= 8; i++) { c.beginPath(); c.moveTo(i * 32, 0); c.lineTo(i * 32, h); c.moveTo(0, i * 32); c.lineTo(w, i * 32); c.stroke(); }
}, { repeat: [5, 5] });
const floorMat = new THREE.MeshLambertMaterial({ map: floorTex });
const floor = new THREE.Mesh(new THREE.CircleGeometry(ARENA + 0.8, 64), floorMat); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const outside = new THREE.Mesh(new THREE.RingGeometry(ARENA + 0.8, 60, 64), mat.unlit(PALETTE[0])); outside.rotation.x = -Math.PI / 2; outside.position.y = -0.02; scene.add(outside);
// the walls: red and gold awning stripes, with a gap where the jaws are
const wallTex = canvasTex(256, 64, (c, w, h) => {
  for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? PALETTE[4] : PALETTE[3]; c.fillRect(i * 32, 0, 32, h); }
  c.fillStyle = "rgba(0,0,0,.18)"; c.fillRect(0, h - 10, w, 10);
}, { repeat: [14, 1] });
const wall = new THREE.Mesh(new THREE.CylinderGeometry(ARENA + 0.7, ARENA + 0.7, 1.6, 72, 1, true, 0.26, Math.PI * 2 - 0.52),
  new THREE.MeshStandardMaterial({ map: wallTex, side: THREE.DoubleSide, metalness: 0.2, roughness: 0.45 }));
wall.position.y = 0.8; wall.castShadow = true; scene.add(wall);

// the entrance: a giant shark lying outside the store, nose in the doorway, its open mouth the way in
const jaws = new THREE.Group(); jaws.position.set(0, 0, ARENA); scene.add(jaws);
const GUM = toy("#ff6f91", { metal: 0.1, rough: 0.5 });
const bigShark = new THREE.Mesh(new THREE.ExtrudeGeometry(new THREE.Shape([[0, 1], [0.36, 0.55], [0.34, -0.1], [0.62, -0.36], [0.26, -0.34], [0.14, -0.74], [0.46, -1.12], [0, -0.94],
  [-0.46, -1.12], [-0.14, -0.74], [-0.26, -0.34], [-0.62, -0.36], [-0.34, -0.1], [-0.36, 0.55]].map(([x, y]) => new THREE.Vector2(x, y))), { depth: 0.2, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.06, bevelSegments: 3, curveSegments: 12 }), SHARKGREY);
bigShark.rotation.set(-Math.PI / 2, 0, 0); bigShark.scale.set(9, 9, 2.4); bigShark.position.set(0, 0.05, 6.5); bigShark.castShadow = true; jaws.add(bigShark);
part(geo.extrude("M0 0 L2.6 0 L-0.4 3 Z", 0.3), SHARKGREY, [0.15, 0.6, 9.5], jaws, { rot: [0, -Math.PI / 2, 0], castShadow: true });
const mouth = new THREE.Mesh(new THREE.CircleGeometry(1, 36), toy("#4a0d1e", { metal: 0, rough: 0.8 })); mouth.rotation.x = -Math.PI / 2; mouth.scale.set(2.8, 1.7, 1); mouth.position.set(0, 0.8, 0.4); jaws.add(mouth);
part(geo.torus(1, 0.14), GUM, [0, 0.8, 0.4], jaws, { rot: [Math.PI / 2, 0, 0], scale: [2.9, 1.8, 1.4] });
for (let i = 0; i < 22; i++) {
  const a = (i / 22) * Math.PI * 2, x = Math.cos(a) * 2.55, z = 0.4 + Math.sin(a) * 1.5;
  part(geo.cone(0.26, 0.7, 6), WHITE, [x, 1.1, z], jaws, { rot: [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5] });
}
for (const s of [-1, 1]) { part(geo.sphere(0.5, 14), NAVY, [s * 2.2, 0.8, 3.6], jaws); part(geo.sphere(0.16, 8), WHITE, [s * 2.3, 1.18, 3.45], jaws); }
// the displays: round tin toy islands stacked with boxes, each crowned with a spinning top
const BOX_COLORS = ["#ff9f1c", "#e63946", "#2ec4b6", "#ffd23f", "#8e6cf0", "#4cc9f0", "#ff70a6", "#70e000"];
const tops = [];
DISPLAYS.forEach((d, i) => {
  const g = new THREE.Group(); g.position.set(d.x, 0, d.z); scene.add(g);
  part(geo.cyl(1.45, 1.55, 0.7, 28), WHITE, [0, 0.35, 0], g, { castShadow: true });
  part(geo.torus(1.5, 0.08), GOLD, [0, 0.7, 0], g, { rot: [Math.PI / 2, 0, 0] });
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + i, c = BOX_COLORS[(i * 3 + k) % BOX_COLORS.length];
    const b = part(geo.rbox(0.62, 0.5 + (k % 2) * 0.3, 0.5, 0.08), toy(c), [Math.cos(a) * 0.95, 0.95 + (k % 2) * 0.15, Math.sin(a) * 0.95], g);
    b.rotation.y = -a;
  }
  const top = new THREE.Group(); top.position.set(0, 0.75, 0); g.add(top);
  part(geo.lathe([[0.02, 0], [0.35, 0.25], [0.55, 0.5], [0.4, 0.75], [0.08, 0.85], [0.06, 1.15]], 20), toy(BOX_COLORS[(i + 4) % 8], { metal: 0.45 }), [0, 0, 0], top, { castShadow: true });
  part(geo.torus(0.5, 0.06), GOLD, [0, 0.5, 0], top, { rot: [Math.PI / 2, 0, 0] });
  tops.push(top);
});

// the arcade machine: a purple cabinet with a shark on the screen and one big red button
const arcade = new THREE.Group(); arcade.position.set(ARCADE.x, 0, ARCADE.z); arcade.rotation.y = Math.atan2(-ARCADE.x, -ARCADE.z); scene.add(arcade);
part(geo.rbox(1.6, 2.4, 1.1, 0.12), toy("#5b3fa8"), [0, 1.2, 0], arcade, { castShadow: true });
function drawScreen(c, w, h, t = 0, pfft = 0) {   // the PFFT-O-MATIC's own little game: a shark swims across, and it toots
  c.fillStyle = pfft > 0 ? "#2f5d1a" : "#0b1d2e"; c.fillRect(0, 0, w, h);
  c.fillStyle = "rgba(255,255,255,.07)"; for (let y = 24; y < h; y += 6) c.fillRect(0, y, w, 2);
  c.fillStyle = PALETTE[4]; c.font = "bold 16px sans-serif"; c.textAlign = "left"; c.fillText("PFFT-O-MATIC", 8, 18);
  if (pfft > 0) { c.fillStyle = "#c7f28a"; c.font = "bold 34px sans-serif"; c.textAlign = "center"; c.fillText("PFFT!", w / 2 + Math.sin(t * 40) * 3, 70); return; }
  const x = ((t * 40) % (w + 70)) - 50, y = 58 + Math.sin(t * 3) * 6; c.fillStyle = PALETTE[1];
  c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 40, y - 30, x + 80, y - 5); c.lineTo(x + 92, y - 18); c.lineTo(x + 88, y + 10); c.lineTo(x + 80, y + 2); c.quadraticCurveTo(x + 40, y + 20, x, y); c.fill();
  c.fillStyle = PALETTE[3]; c.beginPath(); c.arc(w - 14 - (t * 40) % 20, 84, 5, 0, 7); c.fill();
}
const screenTex = canvasTex(128, 96, (c, w, h) => drawScreen(c, w, h));
const screenCtx = screenTex.image.getContext("2d");
part(new THREE.PlaneGeometry(1.2, 0.9), new THREE.MeshBasicMaterial({ map: screenTex }), [0, 1.75, 0.56], arcade);
part(geo.rbox(1.6, 0.25, 0.6, 0.06), toy("#3a2a78"), [0, 1.05, 0.7], arcade);
const fartBtn = part(geo.cyl(0.22, 0.24, 0.16, 18), RED, [0, 1.22, 0.75], arcade);
const fartFlash = hitFlash(fartBtn);

// the shark tank in the middle: tin base, glass wall, rippling water and five little sharks
const vat = new THREE.Group(); scene.add(vat);
part(geo.cyl(VAT_R + 0.25, VAT_R + 0.35, 0.5, 40), GOLD, [0, 0.25, 0], vat, { castShadow: true });
const glass = new THREE.Mesh(new THREE.CylinderGeometry(VAT_R, VAT_R, 1.2, 40, 1, true),
  new THREE.MeshStandardMaterial({ color: "#cff6ff", transparent: true, opacity: 0.28, metalness: 0.1, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false }));
glass.position.y = 1.1; vat.add(glass);
part(geo.torus(VAT_R, 0.12), TIN, [0, 1.7, 0], vat, { rot: [Math.PI / 2, 0, 0] });
const water = new THREE.Mesh(new THREE.CircleGeometry(VAT_R - 0.05, 40), waterMat({ deep: PALETTE[0], shallow: PALETTE[1], foam: "#e6fcff", opacity: 0.6 }));
water.rotation.x = -Math.PI / 2; water.position.y = 1.45; vat.add(water);
const sharkGeo = (() => {
  const body = geo.extrude("M0 1 Q0.36 0.5 0.3 -0.2 L0.58 -0.36 L0.24 -0.36 L0.12 -0.74 L0.42 -1.1 L0 -0.94 L-0.42 -1.1 L-0.12 -0.74 L-0.24 -0.36 L-0.58 -0.36 L-0.3 -0.2 Q-0.36 0.5 0 1 Z", 0.22).clone();
  body.rotateX(Math.PI / 2); return body;
})();
const finGeo = geo.extrude("M0 0 L0.5 0 L-0.05 0.55 Z", 0.06);
const vatSharks = [];
for (let i = 0; i < 5; i++) {
  const s = new THREE.Group(); vat.add(s);
  const b = new THREE.Mesh(sharkGeo, SHARKGREY); b.scale.setScalar(0.5); s.add(b);
  const f = new THREE.Mesh(finGeo, SHARKGREY); f.rotation.y = -Math.PI / 2; f.position.set(0.02, 0.05, 0.12); s.add(f);
  vatSharks.push({ g: s, a: (i / 5) * Math.PI * 2, r: 1.1 + (i % 3) * 0.45, sp: 0.8 + (i % 2) * 0.3, leap: 0 });
}

// the hero: a kid in an orange cap and hoodie with a teal backpack
const hero = new THREE.Group(); scene.add(hero); hero.scale.setScalar(1.6);
const JEANS = toy("#35558a", { metal: 0.15, rough: 0.55 });
for (const s of [-1, 1]) part(geo.capsule(0.12, 0.3), JEANS, [s * 0.14, 0.27, 0], hero, { castShadow: true });
part(geo.lathe([[0.001, 0], [0.3, 0.05], [0.34, 0.3], [0.28, 0.55], [0.12, 0.62], [0.001, 0.62]], 18), ORANGE, [0, 0.45, 0], hero, { castShadow: true });
part(geo.sphere(0.25, 16), SKIN, [0, 1.25, 0], hero, { castShadow: true });
part(geo.lathe([[0.001, 0.2], [0.14, 0.18], [0.25, 0.08], [0.27, 0]], 18), ORANGE, [0, 1.3, 0], hero);
part(geo.extrude("M-0.22 0 Q0 0.7 0.22 0 Z", 0.04), ORANGE, [0, 1.32, 0.12], hero, { rot: [Math.PI / 2, 0, 0] });
part(geo.rbox(0.42, 0.42, 0.22, 0.07), TEAL, [0, 0.8, -0.3], hero, { castShadow: true });
const armL = new THREE.Group(), armR = new THREE.Group(); armL.position.set(-0.36, 0.98, 0); armR.position.set(0.36, 0.98, 0); hero.add(armL, armR);
for (const a of [armL, armR]) { part(geo.capsule(0.09, 0.32), ORANGE, [0, -0.2, 0], a); part(geo.sphere(0.1, 10), SKIN, [0, -0.45, 0], a); }
const heroFlash = hitFlash(hero);

// the store owner: tall, red apron, bushy mustache, flashlight beam sweeping the floor
const boss = new THREE.Group(); scene.add(boss); boss.scale.setScalar(1.8);
const SUIT = toy("#3d4450", { metal: 0.2, rough: 0.5 });
for (const s of [-1, 1]) part(geo.capsule(0.14, 0.34), SUIT, [s * 0.16, 0.3, 0], boss, { castShadow: true });
part(geo.lathe([[0.001, 0], [0.34, 0.02], [0.42, 0.3], [0.36, 0.62], [0.2, 0.72], [0.001, 0.72]], 18), SUIT, [0, 0.5, 0], boss, { castShadow: true });
part(geo.rbox(0.5, 0.55, 0.12, 0.04), RED, [0, 0.8, 0.34], boss);
part(geo.sphere(0.24, 16), SKIN, [0, 1.42, 0], boss, { castShadow: true });
part(geo.rbox(0.34, 0.08, 0.1, 0.04), toy("#4a3222"), [0, 1.36, 0.22], boss);
part(geo.cyl(0.26, 0.26, 0.06, 18), SUIT, [0, 1.6, 0], boss);
part(geo.cyl(0.08, 0.06, 0.4, 10), GOLD, [0.34, 0.9, 0.3], boss, { rot: [Math.PI / 2, 0, 0] });
const beamMat = mat.unlit(PALETTE[4], { transparent: true, opacity: 0.22 }); beamMat.depthWrite = false;
const beam = new THREE.Mesh(new THREE.CircleGeometry(CONE_R / 1.8, 20, -Math.PI / 2 - CONE_HALF, CONE_HALF * 2), beamMat);
beam.rotation.x = -Math.PI / 2; beam.position.y = 0.03; beam.renderOrder = 2; boss.add(beam);
const laneMat = mat.unlit(PALETTE[3], { transparent: true, opacity: 0.5 }); laneMat.depthWrite = false;
const lane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), laneMat); lane.rotation.x = -Math.PI / 2; lane.position.y = 0.04; lane.renderOrder = 3; lane.visible = false; boss.add(lane);
const bangTex = canvasTex(64, 96, (c) => { c.fillStyle = PALETTE[3]; c.font = "bold 88px sans-serif"; c.textAlign = "center"; c.fillText("!", 32, 82); });
const bang = new THREE.Sprite(new THREE.SpriteMaterial({ map: bangTex, depthTest: false })); bang.scale.set(0.9, 1.3, 1); bang.position.y = 2.4; bang.visible = false; boss.add(bang);
const haTex = canvasTex(160, 72, (c, w) => { c.font = "bold 50px sans-serif"; c.textAlign = "center"; c.lineWidth = 8; c.strokeStyle = PALETTE[0]; c.strokeText("HA HA!", w / 2, 56); c.fillStyle = "#c7f28a"; c.fillText("HA HA!", w / 2, 56); });
const haha = new THREE.Sprite(new THREE.SpriteMaterial({ map: haTex, depthTest: false })); haha.scale.set(1.6, 0.72, 1); haha.position.y = 2.3; haha.visible = false; boss.add(haha);

// wind-up chomper toys (instanced, vertex-painted: red gums, white teeth, gold key) and the prizes
const m4 = (x, y, z, rx = 0, ry = 0, rz = 0, s = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), Array.isArray(s) ? new THREE.Vector3(...s) : new THREE.Vector3(s, s, s));
function paint(g, hex, mx) {
  const q = g.index ? g.toNonIndexed() : g.clone();
  for (const k of Object.keys(q.attributes)) if (k !== "position" && k !== "normal") q.deleteAttribute(k);
  q.clearGroups(); if (mx) q.applyMatrix4(mx);
  const c = new THREE.Color(hex), n = q.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  q.setAttribute("color", new THREE.BufferAttribute(arr, 3)); return q;
}
const chompGeo = mergeGeometries([
  paint(geo.rbox(0.9, 0.24, 0.8, 0.1), PALETTE[3], m4(0, 0.2, 0)),
  paint(geo.rbox(0.9, 0.24, 0.8, 0.1), PALETTE[3], m4(0, 0.62, -0.1, -0.35)),
  ...[-0.3, -0.1, 0.1, 0.3].map((x) => paint(geo.rbox(0.16, 0.18, 0.14, 0.03), "#ffffff", m4(x, 0.38, 0.3))),
  ...[-0.3, -0.1, 0.1, 0.3].map((x) => paint(geo.rbox(0.16, 0.16, 0.14, 0.03), "#ffffff", m4(x, 0.5, 0.2, -0.35))),
  ...[-1, 1].map((s) => paint(geo.rbox(0.22, 0.12, 0.34, 0.04), PALETTE[2], m4(s * 0.25, 0.06, 0.05))),
  paint(geo.torus(0.16, 0.05), PALETTE[4], m4(0, 0.5, -0.55)),
  paint(geo.cyl(0.04, 0.04, 0.2, 6), PALETTE[4], m4(0, 0.45, -0.42, Math.PI / 2)),
]);
const chompMat = toy("#ffffff", { metal: 0.35, rough: 0.32 }); chompMat.vertexColors = true;
const chomps = new InstancedPool(scene, chompGeo, chompMat, { max: HORDE, colors: true, cull: false });
chomps.mesh.castShadow = true;
const CHOMP_TINTS = ["#ffffff", "#ffe3e3", "#fff0c9", "#e3fff9"];
const rocketGeo = mergeGeometries([
  paint(geo.lathe([[0.001, 0], [0.18, 0.05], [0.22, 0.4], [0.18, 0.8], [0.001, 1.05]], 16), PALETTE[4], m4(0, 0.3, 0)),
  ...[0, 1, 2].map((k) => paint(geo.box(0.04, 0.3, 0.26), PALETTE[3], m4(Math.sin(k * 2.09) * 0.2, 0.42, Math.cos(k * 2.09) * 0.2, 0, k * 2.09))),
  paint(geo.sphere(0.08, 10), PALETTE[1], m4(0, 0.85, 0.16)),
]);
const robotGeo = mergeGeometries([
  paint(geo.rbox(0.44, 0.44, 0.34, 0.06), PALETTE[4], m4(0, 0.5, 0)),
  paint(geo.rbox(0.34, 0.3, 0.3, 0.06), "#d9dde2", m4(0, 0.92, 0)),
  ...[-1, 1].map((s) => paint(geo.sphere(0.06, 8), PALETTE[1], m4(s * 0.08, 0.95, 0.15))),
  paint(geo.cyl(0.02, 0.02, 0.22, 6), PALETTE[3], m4(0, 1.17, 0)),
  ...[-1, 1].map((s) => paint(geo.rbox(0.14, 0.3, 0.14, 0.04), PALETTE[2], m4(s * 0.14, 0.15, 0))),
]);
const prizeMat = toy("#ffffff", { metal: 0.55, rough: 0.28 }); prizeMat.vertexColors = true;
const rockets = new InstancedPool(scene, rocketGeo, prizeMat, { max: 12, colors: true, cull: false });
const robots = new InstancedPool(scene, robotGeo, prizeMat, { max: 12, colors: true, cull: false });
rockets.mesh.castShadow = robots.mesh.castShadow = true;

// juice kit: tin confetti, puffs, rings, screen wash
const confetti = new Chunks(scene, { colors: [PALETTE[4], PALETTE[3], PALETTE[1], PALETTE[2]], max: 200, geometry: "cube" });
const puffs = new Sparks(scene, { colors: ["#ffffff", PALETTE[1]], max: 300, size: 0.6, blending: "normal" });
const gas = new Sparks(scene, { colors: ["#9be564", "#c7f28a"], max: 120, size: 1.1, blending: "normal" });
const fx = new Timeline(scene, { colors: [PALETTE[4], PALETTE[1], PALETTE[3]] });
const wash = screenFlash("#flash", { color: PALETTE[3] });

// sound: this store's own voice
const sfx = defineSfx({
  dash: { noise: { f0: 1800, f1: 500, dur: 0.16, vol: 0.2, q: 0.8 }, throttle: 0.05 },
  bonk: [{ tone: { type: "square", f0: 520, f1: 130, dur: 0.12, vol: 0.28 } }, { noise: { f0: 2400, f1: 900, dur: 0.08, vol: 0.2 }, at: 0.01 }, { tone: { type: "triangle", f0: 1400, f1: 1800, dur: 0.06, vol: 0.15 }, at: 0.05 }],
  toy: [{ tone: { type: "sine", f0: 880, dur: 0.07, vol: 0.25 } }, { tone: { type: "sine", f0: 1175, dur: 0.07, vol: 0.25 }, at: 0.07 }, { tone: { type: "sine", f0: 1568, dur: 0.14, vol: 0.25 }, at: 0.14 }],
  fart: [{ tone: { type: "sawtooth", f0: 95, f1: 70, dur: 0.12, vol: 0.4 } }, { tone: { type: "sawtooth", f0: 88, f1: 62, dur: 0.12, vol: 0.4 }, at: 0.11 },
    { tone: { type: "sawtooth", f0: 80, f1: 50, dur: 0.22, vol: 0.4 }, at: 0.22 }, { noise: { f0: 260, f1: 120, dur: 0.5, vol: 0.3, type: "lowpass" } }],
  splash: [{ noise: { f0: 2600, f1: 500, dur: 0.35, vol: 0.3, q: 0.7 } }, { tone: { type: "sine", f0: 300, f1: 900, dur: 0.12, vol: 0.18 }, at: 0.05 }],
  alert: [{ tone: { type: "square", f0: 988, dur: 0.1, vol: 0.22 } }, { tone: { type: "square", f0: 1319, dur: 0.18, vol: 0.22 }, at: 0.12 }],
  stomp: { tone: { type: "triangle", f0: 140, f1: 60, dur: 0.2, vol: 0.35 } },
  hurt: [{ tone: { type: "sawtooth", f0: 440, f1: 110, dur: 0.3, vol: 0.3 } }, { noise: { f0: 600, f1: 200, dur: 0.25, vol: 0.2 } }],
  clear: [0, 1, 2, 3].map((i) => ({ tone: { type: "square", f0: [523, 659, 784, 1047][i], dur: 0.1, vol: 0.2 }, at: i * 0.08 })),
  over: [{ tone: { type: "triangle", f0: 392, f1: 196, dur: 0.5, vol: 0.3 } }, { tone: { type: "triangle", f0: 294, f1: 147, dur: 0.6, vol: 0.3 }, at: 0.3 }],
}, { seed: 3 });
// the motif: "dun-dun… dun-dun" (the shark creeping in) and then the toy-store jingle skipping up
const tune = song({ bpm: 128, key: 60, scale: "major", motif: [52, 53, null, 52, 53, null, 60, 64, 67, 72, 71, 67, 64, 65, 67, null], bars: 4, seed: 7,
  voices: { lead: { wave: "square", env: [0.01, 0.1, 0.4, 0.15] }, bass: { wave: "triangle", env: [0.01, 0.2, 0.6, 0.1] }, drums: { kit: "toy", pattern: "k.h.s.h.k.hks.h." } } });

let bannerT = 0;
function banner(big, small, sec = 1.2) { bannerBig(big); bannerSmall(small); bannerT = sec; document.getElementById("banner").hidden = false; }
function onStart() { playSong(tune); setIntensity(0.6); banner("WELCOME IN!", "bonk the chompers · grab the toys", 1.6); rig.snap(); jawsSnap = 0.7; }
function onOver(isNew) { sfx.over(); setIntensity(0.3); document.querySelector("#over .kicker").textContent = isNew ? "new best!" : "kicked out of the store!"; }
function onWave(n, stage) {
  setIntensity(stage === "closing-time" ? 1 : 0.6);
  if (n === ACTS[1][1]) banner("CLOSING TIME!", "his flashlight can see you now", 1.6);
}
function onClear(n) { sfx.clear(); banner("AISLE " + n + " CLEAR!", "+" + 100 * n); fx.shockwave({ x: H.x, y: 0.1, z: H.z }, { color: PALETTE[4], size: 6, dur: 0.6, flat: true }); }
function onDash() { sfx.dash(); rig.kick(4, 0.25); for (let i = 0; i < 6; i++) puffs.emit(H.x, 0.2, H.z, -H.dx * 3 + M.rand(-1, 1), 0.8, -H.dz * 3 + M.rand(-1, 1), "#ffffff", 0.4, 3, 0); }
function onBonk(r) {
  sfx.bonk(); rig.shake(0.35, 0.25);
  confetti.burst({ x: r.x, y: 0.5, z: r.z }, { n: 14, speed: 6, up: [3, 6], life: 0.9, size: 0.18, floor: 0 });
  fx.flash({ x: r.x, y: 0.6, z: r.z }, { color: "#ffffff", size: 2.2, dur: 0.18 });
}
function onToy(r) { sfx.toy(); confetti.burst({ x: r.x, y: 0.6, z: r.z }, { colors: [PALETTE[4], "#ffffff"], n: 10, speed: 4, up: [4, 7], life: 0.8, size: 0.14, floor: 0 }); fx.shockwave({ x: r.x, y: 0.1, z: r.z }, { color: PALETTE[4], size: 2, dur: 0.35, flat: true }); }
function onHurt(byOwner, left) {
  sfx.hurt(); rig.shake(0.6, 0.4); wash.hit(0.45, PALETTE[3]);
  lives.forEach((el, i) => el.classList.toggle("gone", i >= left));
  if (byOwner) banner("CAUGHT!", "no hands in the shark tank!");
}
function onDip(sneaky) {
  sfx.splash(); fx.shockwave({ x: H.x * 0.75, y: 1.5, z: H.z * 0.75 }, { color: "#e6fcff", size: 2.4, dur: 0.5, flat: true });
  for (let i = 0; i < 16; i++) puffs.emit(H.x * 0.8, 1.5, H.z * 0.8, M.rand(-2, 2), M.rand(3, 6), M.rand(-2, 2), M.pick(["#ffffff", PALETTE[1]]), 0.7, 1, -14);
  const ha = Math.atan2(H.z, H.x); vatSharks.forEach((s, i) => { s.target = ha; if (i === S.dips % 5) s.leap = 1; });
  fx.after(0.45, () => {   // the leaping shark spits a prize out of the tank, just beside your hand
    const a = ha + M.pick([-0.5, 0.5]), x = Math.cos(a) * (DIP_R + 0.9), z = Math.sin(a) * (DIP_R + 0.9);
    confetti.burst({ x, y: 1.6, z }, { colors: ["#e6fcff", PALETTE[1], PALETTE[4]], n: 10, speed: 3, up: [3, 5], life: 0.7, size: 0.14, floor: 0 });
    dropToy(x, z); sfx.toy();
  });
  banner(sneaky ? "SNEAKY DIP!" : "SPLASH!", sneaky ? "he was laughing · double points!" : "the sharks noticed you… so did he!");
}
function onFart() {
  sfx.fart(); fartFlash.set(1, "#ffffff"); fartT = 0.4; pfftT = 1.2;
  for (let i = 0; i < 14; i++) gas.emit(ARCADE.x + M.rand(-0.5, 0.5), 1.3, ARCADE.z + M.rand(-0.5, 0.5), M.rand(-1.5, 1.5), M.rand(0.5, 2), M.rand(-1.5, 1.5), M.pick(["#9be564", "#c7f28a"]), 1.4, 1.2, 0.5);
  banner("PFFFFFT!", O.mode === "laugh" ? "the owner is laughing — dip now!" : "the arcade machine tooted", 1.3);
}
function onTelegraph() { sfx.alert(); rig.shake(0.2, 0.2); }
function onCharge() { sfx.stomp(); }
function onBounceOwner() { sfx.stomp(); rig.shake(0.3, 0.2); }
let fartT = 0, pfftT = 0, screenT = 0, jawsSnap = 0;

function art(dt, t) {
  hero.position.set(H.x, 0, H.z); hero.rotation.y = H.yaw;
  const moving = Math.hypot(H.vx, H.vz) > 0.5 && S.dipT <= 0, sw = moving ? Math.sin(t * 16) * 0.7 : 0;
  armL.rotation.x = sw; armR.rotation.x = S.dipT > 0 ? -1.5 : -sw;
  hero.position.y = moving ? Math.abs(Math.sin(t * 16)) * 0.08 : 0;
  heroFlash.set(S.screen === "play" && S.inv > 0 && Math.sin(S.inv * 30) > 0 ? 0.8 : 0, "#ffffff");
  boss.position.set(O.x, 0, O.z); boss.rotation.y = O.yaw;
  boss.position.y = O.mode === "charge" ? Math.abs(Math.sin(t * 18)) * 0.12 : O.mode === "laugh" ? Math.abs(Math.sin(t * 22)) * 0.1 : 0;
  beam.visible = O.mode === "patrol" || O.mode === "laugh";
  haha.visible = O.mode === "laugh"; if (haha.visible) { haha.position.y = 2.3 + Math.abs(Math.sin(t * 12)) * 0.25; haha.material.rotation = Math.sin(t * 9) * 0.15; }
  beamMat.opacity = S.stage === "closing-time" ? 0.34 : 0.18;
  bang.visible = O.mode === "aim"; lane.visible = O.mode === "aim";
  if (lane.visible) { const k = Math.min(1, O.t / 0.9), L = 10 * k; lane.scale.set(1, L / 1.8, 1); lane.position.z = L / 3.6; laneMat.opacity = 0.3 + 0.4 * Math.abs(Math.sin(t * 20)); }
  vatSharks.forEach((s, i) => {
    const near = S.screen === "play" && Math.hypot(H.x, H.z) < DIP_R + 2.5;
    if (s.target !== undefined && S.dipT > 0) s.a = M.angleLerp(s.a, s.target, 3, dt);
    else if (near) { s.a = M.angleLerp(s.a, Math.atan2(H.z, H.x) + (i - 2) * 0.28 + Math.sin(t * 4 + i) * 0.12, 2.2, dt); }
    else s.a += s.sp * dt;
    s.leap = Math.max(0, s.leap - dt * 1.4);
    const y = 1.44 + Math.sin(t * 2 + i) * 0.05 + Math.sin(s.leap * Math.PI) * 1.4;
    s.g.position.set(Math.cos(s.a) * s.r, y, Math.sin(s.a) * s.r);
    s.g.rotation.y = Math.atan2(-Math.sin(s.a), Math.cos(s.a)); s.g.rotation.x = s.leap > 0 ? -Math.cos(s.leap * Math.PI) * 0.8 : 0;
  });
  tops.forEach((g, i) => { g.rotation.y += dt * (3 + i * 0.4); g.rotation.z = Math.sin(t * 3 + i) * 0.06; });
  jawsSnap = Math.max(0, jawsSnap - dt); const snap = jawsSnap > 0 ? Math.abs(Math.sin(jawsSnap * 9)) : 1;
  mouth.scale.y = (1.7 + Math.sin(t * 2.2) * 0.12) * (0.15 + 0.85 * snap);
  pfftT -= dt; screenT -= dt; if (screenT <= 0) { screenT = 0.1; drawScreen(screenCtx, 128, 96, t, pfftT); screenTex.needsUpdate = true; }
  rockets.each((id, r) => { r.rotY += dt * 2; r.y = 0.2 + Math.sin(t * 3 + r.data.ph) * 0.15; });
  robots.each((id, r) => { r.rotY += dt * 2; r.y = 0.2 + Math.sin(t * 3 + r.data.ph) * 0.15; });
  fartT -= dt; if (fartT <= 0) fartFlash.set(0); fartBtn.position.y = fartT > 0 ? 1.17 : 1.22;
  bannerT -= dt; if (bannerT <= 0) document.getElementById("banner").hidden = true;
  light.follow(hero.position);
  climaxArt(dt);
  confetti.update(dt); puffs.update(dt); gas.update(dt); fx.update(dt); wash.update(dt);
}
function render(alpha, t) { tick(t); chomps.sync(); rockets.sync(); robots.sync(); }
const warmList = () => [chomps.mesh, rockets.mesh, robots.mesh, confetti, puffs, gas, bang, lane, haha];

// ── CLIMAX (polish layer) ──
// MEGA JAWS: at aisle 7 a giant tin wind-up shark rolls in through the entrance jaws. Its weak points are the three
// glowing gold wind-up keys on its back and sides: DASH into a key to knock a turn out of it. It cycles CHARGE (a red
// lane for 0.9 s) → SPIN (a red ring for 0.9 s) → SUMMON (its mouth glows, then it spits chompers). Half-wound it
// enrages: red paint, a faster cycle. The Signature joins the fight: lure its charge into the shark tank and the little
// sharks leap out and bite a key. After 2 wipe-outs on it, it rolls in already 30% unwound; the last key gets slow-mo.
const BOSS_WAVE = 7, BOSS_R = 2.0, KEY_HP = 3, SPIN_R = 4.4;
ACTS.push(["mega-jaws", BOSS_WAVE]);
const KEYS = [[0, -1.7], [-1.35, 0.1], [1.35, 0.1]];   // local [x, z] of the three wind-up keys (nose is +z)
const B = { on: false, x: 0, z: 0, yaw: 0, v: { x: 0, z: 0 }, mode: "enter", t: 0, next: 0, keys: [0, 0, 0], hp: 0, max: KEY_HP * 3,
  enraged: false, deaths: 0, dieT: 0, flashT: 0, lx: 0, lz: 0 };
const CYCLE = ["charge", "spin", "summon"];
const bossBar = document.getElementById("bossbar"), bossFill = document.getElementById("bossfill");
// the model: a tin wind-up shark with a chomping mouth, tin wheels and three gold keys
const mega = new THREE.Group(); mega.visible = false; scene.add(mega);
const megaBody = new THREE.Group(); mega.add(megaBody);
const MEGA_TIN = toy("#8ea4ba", { metal: 0.55, rough: 0.28 });
const megaSkin = new THREE.Mesh(sharkGeo, MEGA_TIN); megaSkin.scale.set(2.6, 3.4, 2.6); megaSkin.position.y = 1.6; megaSkin.castShadow = true; megaBody.add(megaSkin);
part(geo.lathe([[0.001, 0], [0.7, 0.1], [0.95, 0.5], [0.8, 0.85], [0.001, 1.0]], 20), MEGA_TIN, [0, 0.55, 0.2], megaBody, { scale: [1.2, 1, 2.1], castShadow: true });
part(finGeo, MEGA_TIN, [0.08, 1.4, -0.2], megaBody, { rot: [0, -Math.PI / 2, 0], scale: [3.2, 3.2, 3.2], castShadow: true });
const WHEEL = toy("#3a3f48", { metal: 0.3, rough: 0.6 });
for (const s of [-1, 1]) for (const z of [-1, 1]) part(geo.cyl(0.4, 0.4, 0.22, 16), WHEEL, [s * 1.05, 0.4, z * 1.1], megaBody, { rot: [0, 0, Math.PI / 2] });
const megaJaw = new THREE.Group(); megaJaw.position.set(0, 1.75, 1.7); megaBody.add(megaJaw);
const megaMouthMat = toy("#4a0d1e", { metal: 0, rough: 0.8 });
part(new THREE.CircleGeometry(1, 28), megaMouthMat, [0, 0, 0], megaJaw, { rot: [-Math.PI / 2, 0, 0], scale: [0.9, 0.62, 1] });
part(geo.torus(1, 0.1), GUM, [0, 0.02, 0], megaJaw, { rot: [Math.PI / 2, 0, 0], scale: [0.95, 0.66, 1] });
for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; part(geo.cone(0.12, 0.34, 6), WHITE, [Math.cos(a) * 0.82, 0.14, Math.sin(a) * 0.55], megaJaw); }
for (const s of [-1, 1]) { part(geo.sphere(0.26, 12), NAVY, [s * 0.75, 1.9, 0.9], megaBody); part(geo.sphere(0.09, 8), WHITE, [s * 0.8, 2.1, 0.95], megaBody); }
const KEY_MAT = mat.hot(PALETTE[4], 1.6);
const keyMeshes = KEYS.map(([x, z]) => {
  const k = new THREE.Group(); k.position.set(x, 2.1, z); megaBody.add(k);
  part(geo.cyl(0.08, 0.08, 0.5, 8), KEY_MAT, [0, 0.25, 0], k);
  for (const s of [-1, 1]) part(geo.torus(0.34, 0.12), KEY_MAT, [s * 0.4, 0.55, 0], k, { rot: [Math.PI / 2 - 0.35, 0, 0] });
  return k;
});
const stars = new THREE.Group(); stars.position.y = 3.2; mega.add(stars);
const STAR = mat.hot(PALETTE[4], 1.3);
for (let i = 0; i < 4; i++) part(geo.sphere(0.16, 8), STAR, [Math.cos(i * 1.57) * 0.9, 0, Math.sin(i * 1.57) * 0.9], stars);
const tele = mat.unlit(PALETTE[3], { transparent: true, opacity: 0.5 }); tele.depthWrite = false;
const bossLane = new THREE.Mesh(new THREE.PlaneGeometry(3, 1), tele); bossLane.rotation.x = -Math.PI / 2; bossLane.position.y = 0.05; bossLane.renderOrder = 3; bossLane.visible = false; mega.add(bossLane);
const bossRing = new THREE.Mesh(new THREE.RingGeometry(SPIN_R - 0.5, SPIN_R, 48), tele); bossRing.rotation.x = -Math.PI / 2; bossRing.position.y = 0.05; bossRing.renderOrder = 3; bossRing.visible = false; mega.add(bossRing);
const megaFlash = hitFlash(megaBody);
const RAGE = new THREE.Color(PALETTE[3]), CALM = new THREE.Color("#8ea4ba");

function keyPos(i) {
  const [lx, lz] = KEYS[i], c = Math.cos(B.yaw), s = Math.sin(B.yaw);
  return { x: B.x + lx * c + lz * s, z: B.z - lx * s + lz * c };
}
function climaxBusy() { return B.on; }
function climaxReset() {
  B.on = false; B.dieT = 0; mega.visible = false; bossBar.hidden = true; CAM.height = 18; CAM.back = 6;
}
function climaxOver() { if (B.on) B.deaths++; bossBar.hidden = true; }
function climaxWave(n) {
  if (n !== BOSS_WAVE && !(n > BOSS_WAVE && (n - BOSS_WAVE) % 6 === 0)) return false;
  const start = B.deaths >= 2 ? Math.round(B.max * 0.7) : B.max;
  B.keys = [0, 1, 2].map((i) => Math.max(0, Math.min(KEY_HP, start - (2 - i) * KEY_HP)));   // the rear key is the one already unwound
  Object.assign(B, { on: true, x: 0, z: ARENA + 3, yaw: Math.PI, mode: "enter", t: 0, next: 0, enraged: false, dieT: 0 });
  B.v.x = B.v.z = 0; syncHp();
  mega.visible = true; megaBody.rotation.set(0, 0, 0); megaBody.position.y = 0; MEGA_TIN.color.copy(CALM);
  bossBar.hidden = false; CAM.height = 23; CAM.back = 8; jawsSnap = 1.4;
  S.stage = "mega-jaws"; setIntensity(1); sfx.stomp(); rig.shake(0.5, 0.6);
  banner("MEGA JAWS!", B.hp < B.max ? "still dizzy from last time · bonk the gold keys!" : "bonk the 3 gold wind-up keys!", 2.2);
  return true;
}
function climaxLeft() { return B.on ? 1 : 0; }
function syncHp() {
  B.hp = B.keys.reduce((a, b) => a + b, 0);
  keyMeshes.forEach((k, i) => { k.visible = B.keys[i] > 0; });
  bossFill.style.width = (100 * B.hp) / B.max + "%";
}
function tellBoss(mode) {
  B.mode = mode; B.t = 0; sfx.alert();
  if (mode === "charge-tell") { const dx = H.x - B.x, dz = H.z - B.z, L = Math.hypot(dx, dz) || 1; B.lx = dx / L; B.lz = dz / L; }
}
function hitKey(i, bySharks = false) {
  B.keys[i]--; syncHp(); megaFlash.set(1, "#ffffff"); B.flashT = 0.15;
  const p = keyPos(i);
  confetti.burst({ x: p.x, y: 2.2, z: p.z }, { colors: [PALETTE[4], "#ffffff", PALETTE[2]], n: 18, speed: 7, up: [4, 8], life: 1, size: 0.2, floor: 0 });
  fx.flash({ x: p.x, y: 2.2, z: p.z }, { color: PALETTE[4], size: 3, dur: 0.2 });
  sfx.bonk(); rig.shake(0.5, 0.3); S.score += 50;
  if (B.keys[i] === 0) { sfx.clear(); banner(bySharks ? "SHARK BITE!" : "KEY POPPED!", bySharks ? "the little sharks got a key!" : B.hp > 0 ? B.hp + " turns to go" : "", 1.2); }
  else if (bySharks) banner("SHARK BITE!", "the little sharks bit his key!", 1.2);
  if (!B.enraged && B.hp <= B.max / 2 && B.hp > 0) { B.enraged = true; banner("HE'S MAD!", "faster now · keep bonking the keys", 1.3); }
  if (B.hp <= 0) beatBoss();
}
function beatBoss() {
  B.on = false; B.dieT = 1.6; B.deaths = 0; bossBar.hidden = true; loop.slowmo(0.3, 1.5);
  S.score += 1000; wash.hit(0.5, PALETTE[4]); rig.shake(0.8, 0.8);
  for (let k = 0; k < 3; k++) confetti.burst({ x: B.x + M.rand(-1.5, 1.5), y: 2, z: B.z + M.rand(-1.5, 1.5) }, { n: 22, speed: 9, up: [5, 10], life: 1.4, size: 0.24, floor: 0 });
  fx.shockwave({ x: B.x, y: 0.1, z: B.z }, { color: PALETTE[4], size: 10, dur: 0.9, flat: true });
  for (let k = 0; k < 4; k++) dropToy(B.x + M.rand(-3, 3), B.z + M.rand(-3, 3));
  banner("YOU UNWOUND MEGA JAWS!", "+1000 · the whole store is yours", 2.4);
  CAM.height = 18; CAM.back = 6;
}
function climax(dt, t) {
  if (!B.on) return;
  const k = B.enraged ? 0.7 : 1, fast = B.enraged ? 1.25 : 1;
  B.t += dt; B.flashT -= dt; if (B.flashT <= 0) megaFlash.set(0);
  if (B.mode === "enter") {   // rolls in through the entrance jaws
    B.z -= 5 * dt; if (B.z <= 9) { B.mode = "idle"; B.t = 0; }
  } else if (B.mode === "idle") {
    steer(B.v, B, H, 2.4 * fast, 3, dt); B.x += B.v.x * dt; B.z += B.v.z * dt;
    B.yaw = M.angleLerp(B.yaw, Math.atan2(H.x - B.x, H.z - B.z), 3, dt);
    if (B.t > 1.8 * k) tellBoss(CYCLE[B.next++ % 3] + "-tell");
  } else if (B.mode === "charge-tell") {
    B.yaw = M.angleLerp(B.yaw, Math.atan2(B.lx, B.lz), 10, dt);
    if (B.t >= 0.9 * k) { B.mode = "charge"; B.t = 0; sfx.stomp(); }
  } else if (B.mode === "charge") {
    const sp = 15 * fast; B.x += B.lx * sp * dt; B.z += B.lz * sp * dt;
    const hitVat = Math.hypot(B.x, B.z) < VAT_R + BOSS_R + 0.4;
    const hit = pushOutCircles(B, BOSS_R, SOLIDS);
    if (clampToDisc(B, ARENA - BOSS_R) || hit || B.t > 1.2) {
      B.mode = "dizzy"; B.t = 0; rig.shake(0.5, 0.3); sfx.stomp();
      if (hitVat) {   // the Signature joins the fight: the little sharks leap out and bite a key
        vatSharks.forEach((s) => { s.leap = 1; });
        sfx.splash(); fx.shockwave({ x: 0, y: 1.5, z: 0 }, { color: "#e6fcff", size: 5, dur: 0.6, flat: true });
        for (let i = 0; i < 20; i++) puffs.emit(B.x * 0.5, 1.6, B.z * 0.5, M.rand(-3, 3), M.rand(3, 7), M.rand(-3, 3), M.pick(["#ffffff", PALETTE[1]]), 0.8, 1, -14);
        const alive = [0, 1, 2].filter((i) => B.keys[i] > 0); if (alive.length) hitKey(M.pick(alive), true);
        if (!B.on) return;
      }
    }
  } else if (B.mode === "dizzy") {
    if (B.t > 1.5 * k) { B.mode = "idle"; B.t = 0; }
  } else if (B.mode === "spin-tell") {
    if (B.t >= 0.9 * k) { B.mode = "spin"; B.t = 0; sfx.dash(); }
  } else if (B.mode === "spin") {
    B.yaw += dt * 14;
    if (B.t > 1.2) { B.mode = "idle"; B.t = 0; }
  } else if (B.mode === "summon-tell") {
    B.yaw = M.angleLerp(B.yaw, Math.atan2(H.x - B.x, H.z - B.z), 6, dt);
    if (B.t >= 0.8 * k) {
      const n = B.enraged ? 4 : 3, mx = B.x + Math.sin(B.yaw) * 3, mz = B.z + Math.cos(B.yaw) * 3;
      for (let i = 0; i < n && chomps.count < HORDE; i++) { const p = { x: mx + M.rand(-1.2, 1.2), z: mz + M.rand(-1.2, 1.2) }; clampToDisc(p, ARENA - 1); spawnChomp(p.x, p.z); }
      confetti.burst({ x: mx, y: 1.2, z: mz }, { colors: [PALETTE[3], "#ffffff"], n: 12, speed: 5, up: [3, 6], life: 0.7, size: 0.16, floor: 0 });
      sfx.bonk(); B.mode = "idle"; B.t = 0;
    }
  }
  if (B.mode !== "enter") { pushOutCircles(B, BOSS_R, SOLIDS); clampToDisc(B, ARENA - BOSS_R); }
  // contacts with the kid: a dash into a gold key knocks a turn out of it; the body and the spin hurt
  if (S.screen === "play") {
    const d = Math.hypot(H.x - B.x, H.z - B.z);
    let keyHit = -1;
    if (S.dashT > 0) for (let i = 0; i < 3; i++) { if (B.keys[i] <= 0) continue; const p = keyPos(i); if (Math.hypot(H.x - p.x, H.z - p.z) < HERO_R + 0.95) { keyHit = i; break; } }
    if (keyHit >= 0) { S.dashT = 0; H.vx = -H.dx * 12; H.vz = -H.dz * 12; S.inv = Math.max(S.inv, 0.4); loop.hitstop(90); hitKey(keyHit); }
    else if (B.mode === "spin" && d < SPIN_R + HERO_R - 0.4) hurt(B);
    else if (d < HERO_R + BOSS_R) {
      if (B.mode === "charge") hurt(B);
      else if (S.dashT > 0) { S.dashT = 0; H.vx = -H.dx * 8; H.vz = -H.dz * 8; sfx.stomp(); rig.shake(0.25, 0.2); }
      pushOutCircles(H, HERO_R, [{ x: B.x, z: B.z, r: BOSS_R }]);
    }
  }
  if (B.on) bossArt(dt, t);
}
function bossArt(dt, t) {
  mega.position.set(B.x, 0, B.z); mega.rotation.y = B.yaw;
  MEGA_TIN.color.lerp(B.enraged ? RAGE : CALM, Math.min(1, dt * 3));
  const chomp = B.mode === "summon-tell" ? 0.6 + Math.abs(Math.sin(t * 20)) * 0.6 : 0.8 + Math.abs(Math.sin(t * 6)) * 0.3;
  megaJaw.scale.set(1, 1, chomp); megaMouthMat.emissive.set(B.mode === "summon-tell" ? PALETTE[3] : "#000000");
  megaBody.position.y = B.mode === "charge" || B.mode === "enter" ? Math.abs(Math.sin(t * 16)) * 0.15 : 0;
  megaBody.rotation.z = B.mode === "dizzy" ? Math.sin(t * 10) * 0.12 : 0;
  keyMeshes.forEach((key, i) => { key.rotation.y += dt * (B.enraged ? 9 : 5); key.scale.setScalar(0.7 + 0.1 * B.keys[i]); });
  stars.visible = B.mode === "dizzy"; stars.rotation.y += dt * 5;
  bossLane.visible = B.mode === "charge-tell"; bossRing.visible = B.mode === "spin-tell" || B.mode === "spin";
  if (bossLane.visible) { const L = 14 * Math.min(1, B.t / (0.5 * (B.enraged ? 0.7 : 1))); bossLane.scale.set(1, L, 1); bossLane.position.set(0, 0.05, L / 2); }
  tele.opacity = 0.3 + 0.4 * Math.abs(Math.sin(t * 20));
}
function climaxArt(dt) {   // the defeat tumble, then he's gone
  if (B.on || B.dieT <= 0) return;
  B.dieT -= dt; megaBody.rotation.z = Math.min(1.6, megaBody.rotation.z + dt * 3); megaBody.position.y -= dt * 1.2;
  bossLane.visible = bossRing.visible = stars.visible = false;
  if (B.dieT <= 0) mega.visible = false;
}
function climaxState() { return { boss: B.on ? B.mode : "none", bossHp: B.hp, bossKeys: B.keys.filter((n) => n > 0).length, enraged: B.enraged }; }
function climaxWarm() { mega.visible = true; mega.position.y = -50; return [mega]; }

// ── STRUCTURE ──
{ const w = chomps.spawn({ x: 0, y: -50, z: 0, color: "#ffffff", data: {} }), a = rockets.spawn({ x: 0, y: -50, z: 0, color: "#ffffff", data: { ph: 0 } }),
    b = robots.spawn({ x: 0, y: -50, z: 0, color: "#ffffff", data: { ph: 0 } });
  fx.shockwave({ x: 0, y: -50, z: 0 }, { color: PALETTE[4], flat: true }); fx.flash({ x: 0, y: -50, z: 0 }, { color: "#ffffff" }); wash.hit(0.001);
  chomps.sync(); rockets.sync(); robots.sync(); G.warm([...warmList(), ...climaxWarm()]); chomps.free(w); rockets.free(a); robots.free(b); }
shell.show("title");
loop = startLoop({ step, render, snapshot, input, G, commands });
