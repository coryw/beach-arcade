// Dolphin Rush — by Ryan. A 3d runner-3d game on the kit/three toolbox (./lib-1/), look "Sunset Lagoon Leap".
// A dolphin races down three swim lanes at sunset: leap through golden hoops, jump the jellyfish, dive under the
// sharks, faster and faster. At 50 s the giant octopus rises behind you and tries to grab you (the CLIMAX region).
// Toolbox API: kit/three/README.md. Every three.js call must exist in r170.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { boot, startLoop, best, M, params } from "./lib-1/core.js";
import { createShell } from "./lib-1/shell.js";
import { createInput } from "./lib-1/input.js";
import { createRig } from "./lib-1/camera.js";
import { tick } from "./lib-1/shaders.js";
import { defineSfx, song, playSong, setIntensity } from "./lib-1/audio.js";
import { geo, deform, part, skyDome, lights, noise2 } from "./lib-1/art.js";
import { Sparks, Chunks, Timeline, screenFlash, Trail } from "./lib-1/fx.js";
import { ringChunks, crossedPlane } from "./lib-1/physics.js";

// ── STRUCTURE ──
const PALETTE = ["#ffc49b", "#1d5f8f", "#9cc3ea", "#ff4f9a", "#ffd23f"];   // sunset sky · lagoon · dolphin · jellyfish · hoops
const SLUG = "dolphin-rush", ORIENT = "portrait";
const STAGES = ["lagoon", "reef", "octopus"], STAGE_AT = [0, 25, 50], SPEED = [12, 18, 21], SPEED_MAX = [18, 27, 29];
const LANES = [-2.4, 0, 2.4], CHUNK = 40, DIST0 = 45, REST_Y = 0.1, DIVE_Y = -1.35, GAP0 = 13, SHARK_SWIM = 5;

const G = boot({ canvas: "#view", background: null, bloom: null, toneMapping: "neutral",
  camera: { fov: 58, near: 0.1, far: 420 },
  errorMessage: "Uh oh — the dolphin bonked into a bug. Show this to a grown-up:" });
const input = createInput({ swipe: { zone: "#swipe", min: 30, edge: 24 } });
const shell = createShell({ screens: { title: "#title", over: "#over" }, orient: ORIENT, input,
  prompt: { el: "#prompt", text: input.isTouch ? "tap to swim!" : "press space to swim!" },
  onShow: (name) => { if (name === "title" || name === "over") G.quality.probeUp(); } });
shell.hubLink(); shell.rotate("#rotate");
const overMsg = shell.text("#overmsg"), hudScore = shell.text("#score"), hudCombo = shell.text("#combo"), finalScore = shell.text("#final"), bestScore = shell.text("#best");
const record = best(SLUG), rig = createRig(G.camera, { portraitScale: 1.35 });

const S = { screen: "title", stage: "lagoon", startStage: "lagoon", t: 0, dist: 45, bonus: 0, score: 0, speed: SPEED[0],
  lane: 1, x: 0, y: REST_Y, vy: 0, air: false, dive: 0, jumpBuf: 0, dodgeT: 0, leapHoops: 0, streak: 0, streakT: 0,
  comboT: 0, dying: 0, prevZ: 0, act: 0, why: "", gap: GAP0, rise: 0, grab: 0, grabK: 0, grabT: 0, grabLane: 1, recoil: 0,
  roll: 0, arch: 0, squash: 0, pop: 0, camUp: 3.2 };

let loop = null;
function start() {
  const i = STAGES.indexOf(S.startStage);
  Object.assign(S, { screen: "play", stage: S.startStage, t: STAGE_AT[i], dist: DIST0, bonus: 0, score: 0, speed: SPEED[i],
    lane: 1, x: 0, y: REST_Y, vy: 0, air: false, dive: 0, jumpBuf: 0, dodgeT: 0, leapHoops: 0, streak: 0, streakT: 0,
    comboT: 0, dying: 0, prevZ: -DIST0, act: i, why: "", gap: GAP0, rise: 0, grab: 0, grabK: 0, grabT: 3, recoil: 0,
    roll: 0, arch: 0, squash: 0, pop: 0 });
  skyCols.from = skyCols.to = SKIES[i]; skyCols.k = 0;
  track.reset(); fx.clear(); hudScore(0); hudCombo(""); shell.show("play"); setIntensity(1);
}
function over() {
  if (S.screen === "over") return;
  S.screen = "over"; S.dying = 0;
  const r = record.submit(S.score);
  overMsg(S.why === "octopus" ? "the octopus got you!" : "splash!");
  finalScore(S.score); bestScore(r.best); shell.show("over"); setIntensity(0.4);
}
function hit(kind) {   // the run-ending bump: freeze, flash, slow, then the over card
  if (params.god || S.dying > 0) return;
  S.why = kind; S.dying = 0.5; loop.hitstop(90); loop.slowmo(0.3, 0.6);
  onHit(kind);
}

function moveHero(dt) {
  const left = input.pressed("left") || input.pressed("swipeLeft"), right = input.pressed("right") || input.pressed("swipeRight");
  const up = input.pressed("up") || input.pressed("a") || input.pressed("swipeUp"), down = input.pressed("down") || input.pressed("b") || input.pressed("swipeDown");
  if (left && S.lane > 0) { S.lane--; S.dodgeT = 0.5; onLane(-1); }
  if (right && S.lane < 2) { S.lane++; S.dodgeT = 0.5; onLane(1); }
  if (up) S.jumpBuf = 0.12;
  if (down) { S.dive = 0.6; S.jumpBuf = 0; if (S.air) S.vy = -30; onDive(); }
  S.jumpBuf = Math.max(0, S.jumpBuf - dt); S.dodgeT = Math.max(0, S.dodgeT - dt);
  S.x = M.damp(S.x, LANES[S.lane], 18, dt);
  if (!S.air && S.jumpBuf > 0 && S.y > DIVE_Y + 0.3) { S.air = true; S.vy = 13; S.dive = 0; S.jumpBuf = 0; S.leapHoops = 0; S.dodgeT = 0.5; S.squash = -1; onLeap(); }
  if (S.air) {
    S.vy -= 40 * dt; S.y += S.vy * dt;
    if (S.y <= REST_Y && S.vy < 0) { S.air = false; S.y = REST_Y; S.squash = Math.min(1, -S.vy / 16); onLand(S.vy); S.vy = 0; if (S.leapHoops === 0) S.streak = Math.min(S.streak, 0); }
  } else if (S.dive > 0) { S.dive -= dt; S.y = M.damp(S.y, DIVE_Y, 14, dt); S.vy = 0; }
  else { S.y = M.damp(S.y, REST_Y, 9, dt); }
}

function collide() {   // hazards by lane and height band, hoops by crossing their plane
  const z = -S.dist;
  track.each((chunk) => {
    for (const it of chunk.userData.items) {
      if (!it.live) continue;
      const wz = chunk.position.z + it.z, dx = Math.abs(it.x - S.x);
      if (it.kind === "hoop") {
        if (crossedPlane(S.prevZ, z, wz) && dx < 0.95 && Math.abs(S.y - it.y) < 0.9) { it.live = false; it.mesh.visible = false; takeHoop(it, wz); }
        continue;
      }
      if (Math.abs(wz - z) < 1.1 + S.speed / 60 && dx < 1.1 && S.y > it.lo && S.y < it.hi) { hit(it.kind); return; }
      if (!it.passed && wz > z + 1.2) { it.passed = true; if (dx < 2.7 && S.dodgeT > 0) { S.bonus += 5; if (S.act === 2) S.gap += 0.5; onNearMiss(it, wz); } }
    }
  });
}
function takeHoop(it, wz) {
  S.leapHoops++; S.streak = S.streakT > 0 ? S.streak + 1 : 1; S.streakT = 3;
  S.bonus += 25 * S.leapHoops;
  S.comboT = 1.2; hudCombo(S.leapHoops > 1 ? `hoop string ×${S.leapHoops}!` : "hoop!"); S.pop = 1;
  if (S.act === 2) S.gap = Math.min(16, S.gap + 1.2);
  onHoop(it, wz, S.streak);
  if (S.leapHoops === 3) {   // the whole string in one leap: the sunbow stands up over the lane and the dolphin rolls
    S.roll = 0.6; S.arch = 1; S.comboT = 1.8;
    if (S.act === 2) { S.gap = Math.min(16, S.gap + 3.5); S.recoil = 1; hudCombo("SUNBOW! the octopus flinched!"); } else hudCombo("SUNBOW! ×3");
    onSunbow(it.x, wz - it.z + it.row);
  }
}

function step(dt, t) {
  if (S.screen !== "play") {
    S.dist += dt * 6; track.update(S.dist);
    S.air = false; S.dive = 0; S.y = REST_Y + Math.sin(t * 2.2) * 0.12; S.x = M.damp(S.x, 0, 4, dt);
    if (input.pressed("start") && shell.canAccept()) start();
    rig.orbit(hero.position, { radius: 9, height: 3.2, speed: 0.22 });
    animate(dt, t); rig.update(dt, t);
    return;
  }
  if (S.dying > 0) {
    S.dying -= dt; animate(dt, t); rig.update(dt, t);
    if (S.dying <= 0) over();
    return;
  }
  S.t += dt; S.prevZ = -S.dist; S.dist += dt * S.speed;
  const si = STAGE_AT.reduce((k, at, i) => (S.t >= at ? i : k), 0);
  if (si !== S.act) { S.act = si; onAct(si); }
  S.stage = STAGES[si]; S.speed = M.approach(Math.max(S.speed, SPEED[si]), SPEED_MAX[si], 0.3 * dt);
  moveHero(dt);
  track.update(S.dist);
  swimSharks(dt);
  collide();
  if (S.act === 2 && S.dying <= 0) chaseStep(dt);
  S.roll = Math.max(0, S.roll - dt); S.arch = Math.max(0, S.arch - dt / 1.6);
  S.streakT = Math.max(0, S.streakT - dt); S.comboT -= dt; if (S.comboT <= 0) hudCombo("");
  S.score = S.bonus + Math.floor(S.dist - DIST0);
  hudScore(S.score);
  rig.follow(camTarget.set(S.x * 0.6, 0.4 + Math.max(0, S.y) * 0.35, -S.dist), { back: 7, up: (S.camUp = M.damp(S.camUp, S.act === 2 ? 3.9 : 3.2, 2, dt)), lookUp: 1.2, lookAhead: 6, yawFollow: false, k: 8 });
  animate(dt, t); rig.update(dt, t);
}
const camTarget = new THREE.Vector3();

const liveItems = () => { let n = 0; track.each((c) => { for (const it of c.userData.items) if (it.live && it.mesh.visible) n++; }); return n; };
const snapshot = () => ({
  screen: S.screen, stage: S.stage, score: S.score, best: record.get(), speed: +S.speed.toFixed(2), entities: liveItems(),
  focus: { lane: S.lane, x: +hero.position.x.toFixed(3), y: +hero.position.y.toFixed(3), z: +hero.position.z.toFixed(3) },
  gap: S.act === 2 ? +S.gap.toFixed(2) : null, grab: S.grab,
});
const commands = {
  die: over,
  at: (stage) => { const i = STAGES.indexOf(String(stage)); if (i < 0) return; S.startStage = STAGES[i];
    if (S.screen === "play") { S.t = STAGE_AT[i]; S.speed = SPEED[i]; } },
};

// ── ART ──
const scene = G.scene;
const SUNSET = { top: "#8a6fc9", horizon: PALETTE[0], bottom: "#16466b" }, DUSK = { top: "#3b2d6e", horizon: "#ff8f7a", bottom: "#0f3656" };
const INKY = { top: "#22164a", horizon: "#f07a9a", bottom: "#0b2744" }, SKIES = [SUNSET, DUSK, INKY];   // the octopus brings an ink-purple sky
const sky = skyDome(scene, { ...SUNSET, fog: { mode: "height", color: PALETTE[0], top: 7, bottom: -2, density: 0.011 } });
const L = lights(scene, { preset: "hemi+sun", sky: "#ffe6cf", ground: PALETTE[1], sun: "#ffe0bd", sunIntensity: 2.2, hemiIntensity: 1.4 });
const skyCols = { from: SUNSET, to: SUNSET, k: 1 }, tmpA = new THREE.Color(), tmpB = new THREE.Color();

// every model is one merged, vertex-coloured, flat-shaded mesh: one draw call each
const flatVC = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
function paint(g, hex, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
  const n = g.index ? g.toNonIndexed() : g.clone();
  for (const k of Object.keys(n.attributes)) if (k !== "position") n.deleteAttribute(k);
  n.applyMatrix4(_m.compose(_p.set(...pos), _q.setFromEuler(_e.set(...rot)), _s.set(...scale)));
  const c = new THREE.Color(hex), a = new Float32Array(n.attributes.position.count * 3);
  for (let i = 0; i < a.length; i += 3) { a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b; }
  n.setAttribute("color", new THREE.BufferAttribute(a, 3)); return n;
}
const merged = (parts) => { const g = mergeGeometries(parts); g.computeVertexNormals(); g.computeBoundingSphere(); return g; };

// the dolphin: a lathed torpedo body with a pale belly, extruded dorsal fin, flippers and a wagging fluke
const hero = new THREE.Group(); scene.add(hero);
const heroMat = new THREE.MeshLambertMaterial({ color: PALETTE[2], emissive: "#35587e", emissiveIntensity: 0.45, flatShading: true });
const bellyMat = new THREE.MeshLambertMaterial({ color: "#fff4ea", flatShading: true });
const darkMat = new THREE.MeshLambertMaterial({ color: "#1b2433" });
const bodyProfile = [[0, -1.35], [0.1, -1.15], [0.2, -0.8], [0.36, -0.25], [0.44, 0.1], [0.4, 0.45], [0.26, 0.78], [0.13, 0.98], [0.1, 1.28], [0, 1.36]];
const dolphin = new THREE.Group(); hero.add(dolphin);
part(geo.lathe(bodyProfile, 10), heroMat, [0, 0, 0], dolphin, { rot: [-Math.PI / 2, 0, 0] });
part(geo.lathe(bodyProfile.map(([r, y]) => [r * 0.9, y * 0.94]), 10), bellyMat, [0, -0.09, -0.02], dolphin, { rot: [-Math.PI / 2, 0, 0] });
part(geo.extrude("M0 0 L0.55 0 Q0.3 0.2 -0.2 0.62 Q-0.02 0.28 0 0 Z", 0.07), heroMat, [0, 0.34, 0.25], dolphin, { rot: [0, Math.PI / 2, 0] });
for (const s of [-1, 1]) {
  part(geo.extrude("M0 0 L0.5 -0.08 Q0.62 -0.3 0.3 -0.28 Z", 0.05), heroMat, [s * 0.32, -0.12, -0.25], dolphin, { rot: [Math.PI / 2, 0, s > 0 ? 0.35 : Math.PI - 0.35] });
  part(geo.sphere(0.07, 8), darkMat, [s * 0.24, 0.1, -0.78], dolphin);
}
const fluke = new THREE.Group(); fluke.position.set(0, 0, 1.3); dolphin.add(fluke);
part(geo.extrude("M0 0.08 Q0.35 0.12 0.62 0.42 Q0.42 0.02 0.12 -0.12 L-0.12 -0.12 Q-0.42 0.02 -0.62 0.42 Q-0.35 0.12 0 0.08 Z", 0.06), heroMat, [0, 0, 0.1], fluke, { rot: [-Math.PI / 2, 0, 0] });

// the jellyfish: a lathed pink bell with long wiggly tentacles that hang deep (so you must LEAP, not dive)
const jellyGeo = (() => {
  const parts = [paint(geo.lathe([[0, 1.0], [0.42, 0.95], [0.68, 0.7], [0.8, 0.38], [0.74, 0.18], [0.6, 0.1], [0.3, 0.22], [0, 0.26]], 10), PALETTE[3]),
    paint(geo.sphere(0.34, 8), "#ffd0e4", [0, 0.45, 0])];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2, r = i % 2 ? 0.55 : 0.35;
    parts.push(paint(deform(new THREE.CylinderGeometry(0.05, 0.02, 1.9, 4, 6), { amount: 0.09, scale: 2, seed: i + 1 }), i % 2 ? "#ffa6cb" : PALETTE[3], [Math.cos(a) * r, -0.8, Math.sin(a) * r]));
  }
  return merged(parts);
})();
// the shark: a lathed slate body swimming right at you, a tall extruded fin (too tall to leap: DIVE under it)
const sharkGeo = (() => {
  const prof = [[0, -1.6], [0.14, -1.25], [0.4, -0.55], [0.52, 0], [0.46, 0.6], [0.28, 1.15], [0, 1.5]];
  return merged([
    paint(geo.lathe(prof, 9), "#5a6d86", [0, 0, 0], [Math.PI / 2, 0, 0]),
    paint(geo.lathe(prof.map(([r, y]) => [r * 0.88, y * 0.92]), 9), "#e9eef2", [0, -0.12, 0.04], [Math.PI / 2, 0, 0]),
    paint(geo.extrude("M-0.55 0 L0.35 0 Q0.1 0.5 -0.35 1.25 Q-0.3 0.5 -0.55 0 Z", 0.1), "#4b5d75", [0.05, 0.38, 0.1], [0, Math.PI / 2, 0]),
    paint(geo.extrude("M0 0 L0.25 0.2 L0.8 0.85 Q0.5 0.25 0.55 -0.05 L0.8 -0.6 Q0.3 -0.25 0 0 Z", 0.08), "#4b5d75", [0.04, 0, -1.5], [0, Math.PI / 2, 0]),
    paint(new THREE.BoxGeometry(0.62, 0.08, 0.3), "#7a1f33", [0, -0.2, 1.08]),
    paint(geo.sphere(0.07, 6), "#10151c", [0.3, 0.12, 0.95]), paint(geo.sphere(0.07, 6), "#10151c", [-0.3, 0.12, 0.95]),
  ]);
})();
const hoopGeo = new THREE.TorusGeometry(0.95, 0.12, 6, 18), hoopMat = new THREE.MeshBasicMaterial({ color: PALETTE[4] });
// the Signature made solid: a whole hoop string raises a gold + pink sunbow arch over the lane you leapt
const archGeo = merged([paint(new THREE.TorusGeometry(3.9, 0.12, 5, 30, Math.PI), "#fff1c2"), paint(new THREE.TorusGeometry(3.55, 0.2, 5, 30, Math.PI), PALETTE[4]),
  paint(new THREE.TorusGeometry(3.15, 0.18, 5, 30, Math.PI), "#ff9a5c"), paint(new THREE.TorusGeometry(2.8, 0.18, 5, 30, Math.PI), PALETTE[3])]);
const archMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
const arch = new THREE.Mesh(archGeo, archMat); arch.rotation.y = Math.PI / 2; scene.add(arch);
const scoreEl = document.querySelector("#score");

// sea and islands, built once per chunk: faceted swell that tiles along z, sandy islands with palms
const waterGeo = (() => {
  const g = new THREE.PlaneGeometry(110, CHUNK, 24, 10).toNonIndexed(); g.rotateX(-Math.PI / 2); g.translate(0, 0, -CHUNK / 2);
  const p = g.attributes.position, col = new Float32Array(p.count * 3), a = new THREE.Color(PALETTE[1]), b = new THREE.Color("#2b7fb0"), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, -0.15 + 0.18 * Math.sin(x * 0.9 + z * 0.6) * Math.cos((z * Math.PI * 2 * 3) / CHUNK)); }
  for (let f = 0; f < p.count; f += 3) { c.copy(a).lerp(b, 0.5 + 0.5 * noise2(p.getX(f) * 0.4, p.getZ(f) * 0.4, 7)); for (let k = 0; k < 3; k++) { col[(f + k) * 3] = c.r; col[(f + k) * 3 + 1] = c.g; col[(f + k) * 3 + 2] = c.b; } }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3)); g.computeVertexNormals(); return g;
})();
const laneLineGeo = merged([-1.2, 1.2].map((x) => paint(new THREE.BoxGeometry(0.08, 0.02, CHUNK), "#9fd4ee", [x, 0.05, -CHUNK / 2])));
const islandGeos = [1, 2, 3].map((seed) => {
  const parts = [paint(deform(new THREE.IcosahedronGeometry(2.6, 1), { amount: 0.35, seed }), "#f3c99a", [0, -0.9, 0], [0, 0, 0], [1.4, 0.55, 1.2]),
    paint(deform(new THREE.IcosahedronGeometry(1.2, 0), { amount: 0.3, seed: seed + 9 }), "#c98d72", [1.2, -0.1, 0.6])];
  if (seed !== 2) {
    for (let i = 0; i < 5; i++) parts.push(paint(new THREE.CylinderGeometry(0.16 - i * 0.02, 0.2 - i * 0.02, 0.7, 5), "#9a6a4b", [-0.4 + i * 0.12, 0.6 + i * 0.62, 0], [0, 0, -0.18]));
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; parts.push(paint(new THREE.ConeGeometry(0.35, 1.9, 4), i % 2 ? "#5fb78a" : "#3f9a74", [0.2 + Math.cos(a) * 0.85, 3.5, Math.sin(a) * 0.85], [Math.sin(a) * 1.2, 0, -Math.cos(a) * 1.2])); }
  }
  return merged(parts);
});

// the chunk library: each row is 3 lanes; J jellyfish (leap it) · S shark (dive it) · H hoop string (leap through) · h low hoop · . open
const EASY = ["J.h", ".Sh", "hJ.", "H.J", "S.H", ".H.", "J.S", "hSh", "HJ."];
const HARD = ["JSh", "SHJ", "hJS", "JHS", "SJH", "S.S", "JhJ", "HSJ", "SJ."];
function build() {
  const g = new THREE.Group(), items = []; scene.add(g);
  g.add(new THREE.Mesh(waterGeo, flatVC)); g.add(new THREE.Mesh(laneLineGeo, flatVC));
  for (const side of [-1, 1]) { const m = new THREE.Mesh(islandGeos[side > 0 ? 0 : 1], flatVC); m.userData.side = side; g.add(m); g.userData["isle" + side] = m; }
  for (const rz of [-10, -30]) for (let l = 0; l < 3; l++) {
    const jelly = new THREE.Mesh(jellyGeo, flatVC), shark = new THREE.Mesh(sharkGeo, flatVC);
    items.push({ kind: "jelly", mesh: jelly, x: LANES[l], z: rz, row: rz, lo: -1.8, hi: 1.25, live: false });
    items.push({ kind: "shark", mesh: shark, x: LANES[l], z: rz, row: rz, lo: -0.62, hi: 2.4, live: false });
    for (let h = 0; h < 3; h++) { const hoop = new THREE.Mesh(hoopGeo, hoopMat); items.push({ kind: "hoop", mesh: hoop, x: LANES[l], z: rz, row: rz, lane: l, h, y: 0, live: false }); }
  }
  for (const it of items) { it.mesh.visible = false; g.add(it.mesh); }
  g.userData.items = items; return g;
}
function recycle(g, z, index) {
  g.userData.isle1.position.set(M.rand(9, 15), 0, M.rand(-34, -6)); g.userData.isle1.rotation.y = M.rand(0, 6.28);
  g.userData["isle-1"].position.set(-M.rand(9, 15), 0, M.rand(-34, -6)); g.userData["isle-1"].rotation.y = M.rand(0, 6.28);
  g.userData["isle-1"].geometry = islandGeos[M.randInt(0, 2)];
  const hard = S.screen === "play" && S.act >= 1 ? 0.6 : 0.15, rows = {};
  for (const rz of [-10, -30]) rows[rz] = index < 3 ? "..." : M.pick(M.chance(hard) ? HARD : EASY);
  for (const it of g.userData.items) {
    it.passed = false; const ch = rows[it.row][LANES.indexOf(it.x)];
    let on = (it.kind === "jelly" && ch === "J") || (it.kind === "shark" && ch === "S");
    if (it.kind === "hoop") {
      on = ch === "H" || (ch === "h" && it.h === 1);
      it.y = ch === "H" ? [1.35, 2.15, 1.35][it.h] : 0.55; it.z = it.row + (ch === "H" ? (it.h - 1) * 3.2 : 0);
      it.mesh.position.set(it.x, it.y, it.z);
    } else { it.z = it.row; it.mesh.position.set(it.x, it.kind === "shark" ? 0.3 : 0.35, it.z); }
    it.live = on; it.mesh.visible = on;
  }
}
const track = ringChunks({ count: 7, length: CHUNK, build, recycle });

// fx: sea spray, gold confetti, rings; the Signature "sunbow" is a pink + gold ribbon pair drawn only while airborne
const spray = new Sparks(scene, { colors: ["#ffffff", "#cfeeff", PALETTE[2]], max: 500, size: 0.35 });
const confetti = new Chunks(scene, { colors: [PALETTE[4], PALETTE[3], "#ffffff"], max: 160, geometry: "tetra" });
const fx = new Timeline(scene, { colors: ["#ffffff", PALETTE[4]] });
const flash = screenFlash("#flash", { color: PALETTE[3] });
const bowGold = new THREE.Object3D(), bowPink = new THREE.Object3D(); scene.add(bowGold, bowPink);
const sunbow = [new Trail(scene, bowGold, { color: PALETTE[4], length: 26, width: 0.34 }), new Trail(scene, bowPink, { color: PALETTE[3], length: 26, width: 0.3 })];
const wake = new THREE.Object3D(); scene.add(wake);
const wakeTrail = new Trail(scene, wake, { color: "#e8f7ff", length: 18, width: 0.9, blending: "normal" });
fx.clear = ((c) => () => { c(); spray.clear(); confetti.clear(); for (const tr of [...sunbow, wakeTrail]) tr.clear(); })(fx.clear.bind(fx));

const sfx = defineSfx({
  leap: [{ noise: { f0: 700, f1: 2600, dur: 0.18, vol: 0.22 } }, { tone: { type: "triangle", f0: 523, f1: 1046, dur: 0.16, vol: 0.18 } }],
  splash: [{ noise: { f0: 2200, f1: 260, dur: 0.38, vol: 0.34, type: "lowpass" } }, { tone: { type: "sine", f0: 300, f1: 90, dur: 0.2, vol: 0.2 } }],
  dive: [{ noise: { f0: 1200, f1: 180, dur: 0.3, vol: 0.24, type: "lowpass" } }, { tone: { type: "sine", f0: 660, f1: 990, dur: 0.06, vol: 0.14 }, at: 0.12 }, { tone: { type: "sine", f0: 780, f1: 1170, dur: 0.06, vol: 0.12 }, at: 0.2 }],
  swim: { noise: { f0: 1800, f1: 3200, dur: 0.09, vol: 0.1, q: 2 }, throttle: 0.06 },
  hoop: [{ tone: { type: "sine", f0: 1175, dur: 0.08, vol: 0.24 } }, { tone: { type: "sine", f0: 1568, dur: 0.18, vol: 0.24 }, at: 0.07 }],
  string: [{ tone: { type: "triangle", f0: 1047, dur: 0.07, vol: 0.2 } }, { tone: { type: "triangle", f0: 1319, dur: 0.07, vol: 0.2 }, at: 0.07 }, { tone: { type: "triangle", f0: 1568, dur: 0.07, vol: 0.2 }, at: 0.14 }, { tone: { type: "triangle", f0: 2093, dur: 0.22, vol: 0.2 }, at: 0.21 }],
  whoosh: { noise: { f0: 400, f1: 2400, dur: 0.22, vol: 0.18, q: 3 }, throttle: 0.1 },
  zap: [{ tone: { type: "square", f0: 880, f1: 110, dur: 0.42, vol: 0.22 } }, { noise: { f0: 3000, dur: 0.3, vol: 0.18, type: "highpass" } }],
  chomp: [{ tone: { type: "sawtooth", f0: 190, f1: 55, dur: 0.34, vol: 0.3 } }, { noise: { f0: 500, dur: 0.22, vol: 0.3 } }],
  sunbow: [1319, 1568, 2093, 2637, 3136].map((f, i) => ({ tone: { type: "triangle", f0: f, dur: 0.12 + i * 0.03, vol: 0.18 }, at: i * 0.06 })),
  roar: [{ tone: { type: "sawtooth", f0: 120, f1: 48, dur: 0.9, vol: 0.28 } }, { noise: { f0: 420, f1: 110, dur: 0.8, vol: 0.32, type: "lowpass" } }],
  uhoh: [{ tone: { type: "triangle", f0: 392, dur: 0.11, vol: 0.2 } }, { tone: { type: "triangle", f0: 311, dur: 0.16, vol: 0.2 }, at: 0.13 }],
  squelch: [{ tone: { type: "square", f0: 240, f1: 64, dur: 0.32, vol: 0.22 } }, { noise: { f0: 900, f1: 180, dur: 0.4, vol: 0.3, type: "lowpass" } }],
}, { seed: 7 });
// "Dol-phin rush-ing, leap through the hoops — faster, faster, splash!"
const tune = song({ bpm: 132, key: 62, scale: "pentatonic", motif: [74, 71, 74, 76, 78, null, 76, 74, 71, 69, 71, 74, 76, null, 81, 78],
  voices: { lead: { wave: "triangle", env: [0.01, 0.1, 0.45, 0.12] }, bass: { wave: "sine", env: [0.01, 0.2, 0.6, 0.1] }, drums: { kit: "toy", pattern: "k.h.s.h.k.hks.h." } } });
playSong(tune); setIntensity(0.4);

// this game's own responses to each event
function onLane(dir) { sfx.swim(); for (let i = 0; i < 6; i++) spray.emit(S.x - dir * 0.4, 0.1, -S.dist + 0.6, -dir * M.rand(2, 5), M.rand(1.5, 4), M.rand(1, 4), "#ffffff", 0.45, 1.5, -12); }
function onLeap() { sfx.leap(); spray.burst([S.x, 0.1, -S.dist + 0.4], { n: 18, speed: 4, up: 5, life: 0.6, grav: -14 }); }
function onLand(vy) {   // the landing is the big one: a flat ring, a spray crown and a thump
  const big = Math.min(1, -vy / 18);
  sfx.splash({ vol: 0.6 + big * 0.4 }); fx.shockwave([S.x, 0.05, -S.dist], { color: "#ffffff", size: 2.5 + big * 2.5, dur: 0.45, flat: true });
  for (let i = 0; i < 26; i++) { const a = (i / 26) * Math.PI * 2; spray.emit(S.x + Math.cos(a) * 0.5, 0.1, -S.dist + Math.sin(a) * 0.5, Math.cos(a) * 3.5, M.rand(4, 8) * (0.6 + big), Math.sin(a) * 3.5, i % 3 ? "#ffffff" : "#cfeeff", 0.7, 1, -16); }
  rig.shake(0.12 + big * 0.2, 0.15);
}
function onDive() { sfx.dive(); spray.burst([S.x, 0.1, -S.dist], { n: 12, speed: 3, up: 3, life: 0.5, grav: -12, colors: ["#cfeeff", "#ffffff"] }); }
function onHoop(it, wz, streak) {
  (S.leapHoops > 1 ? sfx.string : sfx.hoop)({ pitch: 2 ** (Math.min(streak - 1, 7) / 12) });
  fx.flash([it.x, it.y, wz], { color: PALETTE[4], size: 3.2, dur: 0.3 });
  confetti.burst([it.x, it.y, wz], { n: 10 + streak * 2, speed: 5, up: [2, 6], life: 0.9, grav: -10, size: 0.35 });
  if (streak > 0 && streak % 5 === 0) { rig.kick(7, 0.4); flash.hit(0.35, PALETTE[4]); hudCombo(`${streak} hoops in a row!`); S.comboT = 1.6; }
}
function onNearMiss(it, wz) { sfx.whoosh(); spray.burst([it.x, 0.4, wz], { n: 8, speed: 2.5, up: 2, life: 0.5, grav: 3, colors: ["#e8f7ff"] }); hudCombo("close one!"); S.comboT = 0.6; }
function onHit(kind) {
  (kind === "shark" ? sfx.chomp : sfx.zap)(); flash.hit(0.55, kind === "shark" ? "#ffffff" : PALETTE[3]); rig.shake(0.7, 0.35);
  spray.burst([S.x, S.y + 0.3, -S.dist], { n: 40, speed: 7, up: 4, life: 0.8, grav: -10, colors: kind === "shark" ? ["#ffffff", "#9cc3ea"] : [PALETTE[3], "#ffd0e4"] });
}
function onAct(i) {
  skyCols.from = SKIES[Math.max(0, i - 1)]; skyCols.to = SKIES[i]; skyCols.k = 0; S.comboT = 2;
  if (i === 2) { hudCombo("the GIANT OCTOPUS!"); sfx.roar(); rig.shake(0.5, 0.8); flash.hit(0.35, "#6a2a78"); }
  else { hudCombo("into the reef!"); flash.hit(0.25, "#ff8f7a"); }
}
function onSunbow(x, midZ) {
  sfx.sunbow(); rig.kick(6, 0.45); flash.hit(0.3, PALETTE[4]); arch.position.set(x, 0, midZ);
  confetti.burst([x, 3.2, midZ], { n: 34, speed: 7, up: [3, 8], life: 1.2, grav: -9, size: 0.4 });
}
function swimSharks(dt) {   // sharks don't wait for you: they swim at you, their fins throwing a spray line
  const z = -S.dist;
  track.each((c) => { for (const it of c.userData.items) {
    if (!it.live || it.kind !== "shark") continue;
    const wz = c.position.z + it.z, ahead = z - wz;
    if (ahead < -1 || ahead > 42) continue;
    it.z += SHARK_SWIM * dt; it.mesh.position.z = it.z;
    if ((it.fin = (it.fin || 0) + dt) > 0.06) { it.fin = 0; spray.emit(it.x + M.rand(-0.15, 0.15), 0.25, wz + 0.2, M.rand(-1.8, 1.8), M.rand(1, 2.6), M.rand(1, 3), "#ffffff", 0.4, 1.5, -9); }
  } });
}

function animate(dt, t) {
  hero.position.set(S.x, S.y, -S.dist);
  hero.rotation.x = M.clamp(S.air ? S.vy * 0.045 : (S.dive > 0 ? -0.35 : 0), -0.7, 0.6);
  hero.rotation.z = M.damp(hero.rotation.z, (S.x - LANES[S.lane]) * 0.35, 10, dt);
  dolphin.rotation.z = S.roll > 0 ? (1 - S.roll / 0.6) * Math.PI * 2 : 0;   // the sunbow barrel roll
  S.squash = M.damp(S.squash, 0, 9, dt); const q = S.squash;   // stretch on the leap, squash on the splash
  if (q < 0) dolphin.scale.set(1 + q * 0.16, 1 + q * 0.16, 1 - q * 0.3); else dolphin.scale.set(1 + q * 0.3, 1 - q * 0.32, 1 - q * 0.08);
  S.pop = M.damp(S.pop, 0, 7, dt); scoreEl.style.transform = `scale(${(1 + S.pop * 0.4).toFixed(3)})`;
  if (S.arch > 0) { arch.visible = true; archMat.opacity = Math.min(1, S.arch * 2.2); arch.scale.set(1, M.clamp((1 - S.arch) * 7, 0.05, 1), 1); }
  else arch.visible = false;
  drawChase(dt, t);
  fluke.rotation.x = Math.sin(t * (S.screen === "play" ? 16 : 7)) * 0.35;
  dolphin.position.y = S.air ? 0 : Math.sin(t * 5) * 0.04;
  const airborne = S.air && S.y > 0.4;
  bowGold.position.set(S.x + 0.28, airborne ? S.y + 0.35 : -3, -S.dist + 1.0);
  bowPink.position.set(S.x - 0.28, airborne ? S.y + 0.2 : -3, -S.dist + 1.0);
  wake.position.set(S.x, 0.06, -S.dist + 1.4);
  for (const tr of sunbow) tr.update(dt); wakeTrail.update(dt);
  spray.update(dt); confetti.update(dt); fx.update(dt); flash.update(dt);
  track.each((c) => { for (const it of c.userData.items) if (it.mesh.visible) {
    if (it.kind === "jelly") { const p = 1 + Math.sin(t * 4 + it.x) * 0.12; it.mesh.scale.set(p, 2 - p, p); it.mesh.position.y = 0.35 + Math.sin(t * 2 + it.z) * 0.12; }
    else if (it.kind === "shark") { it.mesh.rotation.y = Math.sin(t * 5 + it.x) * 0.18; }
    else it.mesh.rotation.z = t * 1.5 + it.h;
  } });
  if (skyCols.k < 1) {
    skyCols.k = Math.min(1, skyCols.k + dt / 2);
    for (const key of ["top", "horizon", "bottom"]) sky.uniforms["u" + key[0].toUpperCase() + key.slice(1)].value.copy(tmpA.set(skyCols.from[key])).lerp(tmpB.set(skyCols.to[key]), skyCols.k);
    scene.fog.color.copy(sky.uniforms.uHorizon.value);
  }
}

// ── CLIMAX (polish layer) ──
// The chase: at 50 s the giant octopus rises behind the dolphin. S.gap is how far back it is: it creeps closer all the
// time, every hoop pushes it back (a whole hoop string blasts it back), and every few seconds it aims a grab at your
// lane (a pink target ring, then the slam): swim away or leap before it lands, or it pulls you closer. gap 0 = grabbed.
const OCTO = { body: "#8e2f7c", band: "#b8448f", tip: "#ff8cc0", spot: "#ff7bb6", eye: "#fff6ec", pupil: "#1b1030" };
const octo = new THREE.Group(); scene.add(octo);
octo.add(new THREE.Mesh(merged((() => {   // a lumpy lathed mantle, pink spots, big eyes on top staring at the dolphin
  const parts = [paint(deform(geo.lathe([[0, -1.2], [1.5, -1], [2.2, -0.1], [2.3, 0.9], [2, 2], [1.3, 2.9], [0.5, 3.3], [0, 3.35]], 12), { amount: 0.12, seed: 4 }), OCTO.body)];
  for (let i = 0; i < 8; i++) { const a = i * 2.3 + 0.4, y = 0.5 + (i % 3) * 0.75; parts.push(paint(geo.sphere(0.26 + (i % 2) * 0.12, 6), OCTO.spot, [Math.cos(a) * 2.1, y, Math.sin(a) * 2.1])); }
  for (const s of [-1, 1]) parts.push(paint(geo.sphere(0.66, 10), OCTO.eye, [s * 0.95, 1.9, -1.35]), paint(geo.sphere(0.36, 8), OCTO.pupil, [s * 0.95, 1.85, -1.92]),
    paint(new THREE.BoxGeometry(1.1, 0.18, 0.3), OCTO.pupil, [s * 0.95, 2.62, -1.5], [0, 0, s * 0.35]));
  return parts;
})()), flatVC));
const TN = 6, TSEG = 16, TRAD = 7;   // six tentacles in ONE mesh; each is a tube bent along a curve every frame
const tentGeo = merged(Array.from({ length: TN }, () => paint(new THREE.CylinderGeometry(1, 1, 1, TRAD, TSEG, true), OCTO.body)));
const tentRest = Float32Array.from(tentGeo.attributes.position.array), tentN = tentRest.length / 3 / TN;
{ const col = tentGeo.attributes.color, a = new THREE.Color(OCTO.body), b = new THREE.Color(OCTO.band), c = new THREE.Color(OCTO.tip), k = new THREE.Color();
  for (let f = 0; f < col.count; f += 3) { const v = (tentRest[f * 3 + 1] + tentRest[f * 3 + 4] + tentRest[f * 3 + 7]) / 3 + 0.5;
    k.copy(Math.floor(v * TSEG) % 2 ? b : a).lerp(c, Math.max(0, v - 0.7) * 2.5); for (let j = 0; j < 3; j++) col.setXYZ(f + j, k.r, k.g, k.b); } }
const tent = new THREE.Mesh(tentGeo, flatVC); tent.frustumCulled = false; scene.add(tent);
const grabRing = new THREE.Mesh(new THREE.RingGeometry(0.75, 1.1, 24), new THREE.MeshBasicMaterial({ color: PALETTE[3], transparent: true, depthWrite: false }));
grabRing.rotation.x = -Math.PI / 2; scene.add(grabRing);
const inkColors = ["#2a1238", "#5b2a6e", "#8e2f7c"];

function bend(k, b, c, tp, r0) {   // quadratic bezier b→c→tp; the tube tapers to a curled tip
  const arr = tentGeo.attributes.position.array;
  for (let i = k * tentN; i < (k + 1) * tentN; i++) {
    const ox = tentRest[i * 3], v = tentRest[i * 3 + 1] + 0.5, oz = tentRest[i * 3 + 2], u = 1 - v, r = r0 * (1 - 0.85 * v);
    const ty = 2 * u * (c[1] - b[1]) + 2 * v * (tp[1] - c[1]), tz = 2 * u * (c[2] - b[2]) + 2 * v * (tp[2] - c[2]);
    const l = Math.hypot(ty, tz) || 1, ny = -tz / l, nz = ty / l;   // n2 = x × tangent keeps the tube right-side out
    arr[i * 3] = u * u * b[0] + 2 * u * v * c[0] + v * v * tp[0] + r * ox;
    arr[i * 3 + 1] = u * u * b[1] + 2 * u * v * c[1] + v * v * tp[1] + r * oz * ny;
    arr[i * 3 + 2] = u * u * b[2] + 2 * u * v * c[2] + v * v * tp[2] + r * oz * nz;
  }
}
function chaseStep(dt) {
  S.rise = Math.min(1, S.rise + dt / 1.5); S.recoil = Math.max(0, S.recoil - dt * 1.2);
  S.gap -= 0.32 * dt; S.grabT -= dt;
  if (S.grab === 0 && S.grabT <= 0) { S.grab = 1; S.grabK = 0; S.grabLane = S.lane; sfx.uhoh(); hudCombo("it's reaching for you!"); S.comboT = 0.9; }
  else if (S.grab === 1 && (S.grabK += dt / 0.9) >= 1) { S.grab = 2; S.grabK = 0; slam(); }
  else if (S.grab === 2 && (S.grabK += dt / 0.6) >= 1) { S.grab = 0; S.grabT = M.rand(2.2, 3.4); }
  if (params.god) S.gap = Math.max(S.gap, 1.5);
  if (S.gap <= 0) hit("octopus");
}
function slam() {
  const x = LANES[S.grabLane], z = -S.dist - 3.5;
  if (S.lane === S.grabLane && !(S.air && S.y > 0.8)) {   // caught: ink everywhere, the octopus hauls itself closer
    S.gap -= 3.5; sfx.squelch(); rig.shake(0.45, 0.3); flash.hit(0.45, "#3a1446"); hudCombo("GRABBED! wiggle free!"); S.comboT = 1.2;
    confetti.burst([S.x, 0.6, -S.dist], { colors: inkColors, n: 30, speed: 5, up: [2, 5], life: 1, grav: -8, size: 0.5 });
  } else { S.gap = Math.min(16, S.gap + 0.8); sfx.whoosh(); hudCombo("slipped away!"); S.comboT = 0.9; }
  spray.burst([x, 0.2, z], { n: 22, speed: 5, up: 5, life: 0.6, grav: -14 }); fx.shockwave([x, 0.06, z], { color: "#ffffff", size: 3, dur: 0.4, flat: true });
}
const _b = [0, 0, 0], _c = [0, 0, 0], _t = [0, 0, 0];
function drawChase(dt, t) {
  const on = S.act === 2 && S.screen !== "title";
  octo.visible = tent.visible = on; grabRing.visible = on && S.grab === 1;
  if (!on) return;
  const hz0 = -S.dist, lunge = S.why === "octopus" && S.screen !== "play" ? 1 : 0;
  const hz = hz0 + 4.5 + Math.min(1, Math.max(0, S.gap) / 13) * 3.5 - lunge * 2.5, hy = -1.8 - (1 - S.rise) * 6 + Math.sin(t * 1.3) * 0.2 + S.recoil * -0.8;
  octo.position.set(Math.sin(t * 0.7) * 0.6, hy, hz + S.recoil * 2); octo.rotation.y = Math.sin(t * 0.9) * 0.12; octo.scale.setScalar(1);
  const active = S.grabLane <= 1 ? 2 : 3;
  for (let k = 0; k < TN; k++) {
    const side = k < 3 ? -1 : 1, w = Math.sin(t * 1.7 + k * 1.3);
    _b[0] = (k - 2.5) * 1.1; _b[1] = hy + 0.6; _b[2] = hz - 0.6;
    if (k === 2 || k === 3) {   // the grabbers hover high, then one aims at your lane and slams
      _t[0] = side * 2.9 + w * 0.3; _t[1] = 3 + w * 0.4; _t[2] = hz0 - 2 + S.recoil * 4;
      if (k === active && S.grab) {
        const e = S.grab === 1 ? S.grabK * S.grabK * (3 - 2 * S.grabK) : 1, drop = S.grab === 2 ? Math.min(1, S.grabK * 5) * (S.grabK < 0.6 ? 1 : (1 - S.grabK) / 0.4) : 0;
        _t[0] = M.lerp(_t[0], LANES[S.grabLane], e); _t[2] = M.lerp(_t[2], hz0 - 3.5, e); _t[1] = M.lerp(_t[1], 5 + Math.sin(t * 20) * 0.15, e) - drop * 4.8;
      }
      _c[0] = (_b[0] + _t[0]) / 2; _c[1] = 6.8 + w * 0.5; _c[2] = (_b[2] + _t[2]) / 2;
      bend(k, _b, _c, _t, 0.48);
    } else {   // the outer four curl over the edges of the lanes and slap the water
      _t[0] = side * (k === 0 || k === 5 ? 5.2 : 3.9) + w * 0.4; _t[1] = 0.1 + Math.sin(t * 2.3 + k) * 0.5; _t[2] = hz - 9 - (k % 2) * 2.5 + S.recoil * 6;
      _c[0] = _b[0] * 0.5 + _t[0] * 0.5; _c[1] = 6.5 + w * 0.8 - S.recoil * 2; _c[2] = (_b[2] + _t[2]) / 2;
      bend(k, _b, _c, _t, 0.42);
    }
  }
  tentGeo.attributes.position.needsUpdate = true;
  if (S.grab === 1) { const s = 1.5 - S.grabK * 0.6; grabRing.position.set(LANES[S.grabLane], 0.08, hz0 - 3.5); grabRing.scale.set(s, s, s); grabRing.material.opacity = 0.5 + 0.4 * Math.sin(t * 18); }
}

G.warm([hero, octo, tent, grabRing, arch,new THREE.Mesh(jellyGeo, flatVC), new THREE.Mesh(sharkGeo, flatVC), new THREE.Mesh(hoopGeo, hoopMat),
  ...[spray, confetti, ...sunbow, wakeTrail].map((f) => f.object || f.mesh || f.points).filter(Boolean)]);
shell.show("title");
loop = startLoop({ step, render: (alpha, t) => tick(t), snapshot, input, G, commands });
