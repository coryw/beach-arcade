// Horse Failures 3D — by Sean. A kart-3d race on the kit/three toolbox (./lib-2/), look "Tin Toy Derby" (glossy-toy).
// The kart-3d exemplar: every racer lives in (s, offset) on one closed Spline; the player's arcadeCar drives in the
// straightened track frame (x = offset, z = -s). STRUCTURE is the part the kart recipe copies; ART and the failure
// traits are this game's alone; the CLIMAX region is the polish layer. Toolbox API: kit/three/README.md.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { boot, startLoop, best, M, params } from "./lib-2/core.js";
import { createShell } from "./lib-2/shell.js";
import { createInput, DEFAULT_KEYS } from "./lib-2/input.js";
import { createRig } from "./lib-2/camera.js";
import { tick } from "./lib-2/shaders.js";
import { defineSfx, song, playSong, setIntensity } from "./lib-2/audio.js";
import { Sparks, Chunks, Timeline, Trail, screenFlash } from "./lib-2/fx.js";
import { canvasTex, noiseTex, mat, geo, hitFlash, skyDome, lights, envMap, heightfield, scatter } from "./lib-2/art.js";
import { arcadeCar, Spline, InstancedPool } from "./lib-2/physics.js";
import { world } from "./lib-2/rigid.js";

// ── STRUCTURE ──
const PALETTE = ["#2b2d42", "#ef233c", "#ffd166", "#8ecae6", "#fdf0d5"];   // navy tin · toy red · brass · sky · cream
const SLUG = "horse-failures-3d", ORIENT = "landscape";
const LAPS = 3, WIDTH = 12, WALL = WIDTH / 2 - 1.1, N_AI = 5, CD = 2.4;        // countdown 3-2-1 = 2.4 s of sim time
const STAGES = ["lap1", "lap2", "lap3"];
const CURVE = 0.55, ALIGN = 2.4, MAX_HEAD = 1.0;   // how much the track's bends push the car (1 = full), self-align, heading clamp
const TRACK = new Spline([[0, 0, 40], [24, 0, 39], [44, 0, 28], [52, 0, 6], [46, 0, -16], [30, 0, -28], [14, 0, -22],
  [0, 0, -10], [-16, 0, -16], [-36, 0, -26], [-54, 0, -12], [-56, 0, 12], [-44, 0, 32], [-22, 0, 40]], { closed: true });
const L = TRACK.length;

const G = boot({ canvas: "#view", background: null, bloom: null, toneMapping: "agx", shadows: true,
  camera: { fov: 58, near: 0.1, far: 700 },
  errorMessage: "Whoa! A tin horse threw a shoe (that's a bug). Show this to a grown-up:" });
const input = createInput({
  keys: { ...DEFAULT_KEYS, Space: "boost", KeyZ: "boost", ShiftLeft: "drift", ShiftRight: "drift", KeyX: "drift" },
  stick: { zone: "#steer", mode: "relative", radius: 70, deadzone: 0.08, knob: "#steer-knob" },
  buttons: { "#btn-boost": "boost", "#btn-drift": "drift", "#pick-0": "pick0", "#pick-1": "pick1", "#pick-2": "pick2", "#pick-3": "pick3", "#btn-go": "go" },
});
const shell = createShell({ screens: { title: "#title", pick: "#pick", over: "#over" }, orient: ORIENT, input,
  prompt: { el: "#prompt", text: input.isTouch ? "tap to pick your horse!" : "press space to pick your horse!" },
  onShow: (name) => { if (name === "title" || name === "over") G.quality.probeUp(); } });
shell.hubLink(); shell.rotate("#rotate");
const hud = { place: shell.text("#place"), lap: shell.text("#lap"), crowd: shell.text("#crowd"), cd: shell.text("#cd"),
  final: shell.text("#final"), best: shell.text("#best"), overPlace: shell.text("#over-place"), overName: shell.text("#over-name"),
  overSecret: shell.text("#over-secret") };
const record = best(SLUG), rig = createRig(G.camera);
let loop = null;

// The racers. 0-3 are the pickable horses; 4-5 only race. `trait` is the secret failure, dealt again on every pick.
const TRAITS = ["sit", "sneeze", "moonwalk", "backwards"];
const racers = [];
const S = { screen: "title", stage: "lap1", startStage: "lap1", phase: "demo", cd: 0, raceT: 0, sel: 0, you: 0,
  place: 6, lastPlace: 6, lap: 0, lap0: 0, crowd: 0, tier2: 0, score: 0, finished: [], finishT: 0, fails: 0,
  final: false, photo: false, podium: [], spin: 0 };
const player = () => racers[S.you];
const ordinal = (n) => n + (["TH", "ST", "ND", "RD"][n % 10 > 3 || Math.floor(n / 10) === 1 ? 0 : n % 10] || "TH");
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const yawAt = (s) => { const t = TRACK.at(s).tangent; return Math.atan2(t.x, t.z); };

function makeRacer(i) {
  const def = HORSES[i];
  return { i, def, s: 0, offset: 0, speed: 0, yaw: 0, heading: 0, lap: 0, fail: null, nerves: 0, cool: 0, wall: false,
    base: 28.4 + (i % 5) * 0.45, phase: i * 1.7, jit: (i % 3 - 1) * 1.2, trait: TRAITS[i % 4], car: arcadeCar({ ...CAR, ...def.car }),
    done: 0, model: buildHorse(def) };
}
function gridSlot(k) { return { s: -4 - Math.floor(k / 3) * 4.5, offset: [-3.6, 0, 3.6][k % 3] }; }
function dealTraits() {
  const deck = M.shuffle(TRAITS.slice());
  racers.forEach((r, i) => { r.trait = i < 4 ? deck[i] : M.pick(TRAITS); });
}
function placeOnGrid(lapIndex) {
  const order = racers.filter((r) => r !== player()); order.splice(4, 0, player());   // you start in the back row, middle: overtaking is the fun
  order.forEach((r, k) => { const g = gridSlot(k); r.s = lapIndex * L + g.s; r.offset = g.offset; r.speed = 0; r.heading = 0; clearFail(r); r.done = 0; r.nerves = 0; r.wall = false;
    r.car.speed = 0; r.car.heading = 0; r.car.vx = r.car.vz = 0; r.car.boostT = 0; r.car.driftCharge = 0; });
}

function toTitle() { S.screen = "title"; S.phase = "demo"; shell.show("title"); setIntensity(0.4); }
function toPick() {
  S.screen = "pick"; S.phase = "pick"; S.podium = []; racers.forEach((r) => { r.podium = null; }); dealTraits(); placeOnGrid(0); onPickOpen();
  for (let k = 0; k < 4; k++) { const r = racers[k]; r.s = 3; r.offset = 4.8 - k * 3.2; }   // the camera looks back: card 0 is on the left
  for (let k = 4; k < racers.length; k++) racers[k].s = -14 - k * 3;
  showCards(); shell.show("pick"); setIntensity(0.5); onPickMoved(S.sel);
}
function startRace() {
  S.you = S.sel; const li = STAGES.indexOf(S.startStage);
  Object.assign(S, { screen: "play", phase: "countdown", cd: CD, raceT: 0, stage: S.startStage, lap: li, lap0: li, crowd: 0, tier2: 0, score: 0,
    finished: [], finishT: 0, fails: 0, place: 6, lastPlace: 6, final: false, photo: false });
  placeOnGrid(li); shell.show("play"); onRaceStart();
}
function finishRace(dnf = false) {
  if (S.screen === "over") return;
  S.screen = "over"; S.phase = "demo";
  if (dnf) S.place = racers.length;
  S.score = 1000 * (7 - S.place) + 50 * S.tier2 + S.crowd;
  const r = record.submit(S.score);
  hud.final(S.score); hud.best(r.best); hud.overPlace(dnf ? "DNF!" : ordinal(S.place) + "!");
  hud.overName(player().def.name + (S.place === 1 && !dnf ? " WINS THE DERBY" : " crossed the line"));
  hud.overSecret(`${player().def.name}'s secret: ${TRAIT_WORDS[player().trait].reveal}` + (S.fails ? ` — ${S.fails} fail${S.fails > 1 ? "s" : ""}, +${S.crowd} crowd points` : ""));
  shell.show("over"); onFinish(dnf);
}

// One racer per step. The player drives an arcadeCar in the straightened frame; AI rides s with a bounded offset.
function stepPlayer(r, dt) {
  const c = r.car, steer = M.clamp(input.axis.x, -1, 1), drift = input.held("drift");
  r.cool -= dt;
  if (input.took("boost") && r.cool <= 0) { c.boostT = Math.max(c.boostT, 0.9 * (r.def.boostT || 1)); r.cool = 0.35; r.nerves += 0.3; onBoost(r); }
  const tierBefore = c.driftCharge >= 2 ? 2 : c.driftCharge >= 1 ? 1 : 0;
  const st = { x: r.offset, z: -r.s }, s0 = r.s;
  const out = c.step(st, { steer, gas: 1, drift, boost: false }, dt);
  r.offset = st.x; r.s = -st.z; r.speed = c.speed;
  if (out.boosted) { if (tierBefore >= 2) S.tier2++; onDriftBoost(r, tierBefore); }
  const tier = c.driftCharge >= 2 ? 2 : c.driftCharge >= 1 ? 1 : 0;
  if (c.drifting && tier > tierBefore) onDriftTier(r, tier);
  c.heading -= wrapA(yawAt(r.s) - yawAt(s0)) * CURVE;                   // the bend pushes you toward the outside
  if (Math.abs(steer) < 0.1 && !c.drifting) c.heading = M.damp(c.heading, 0, ALIGN, dt);
  c.heading = M.clamp(c.heading, -MAX_HEAD, MAX_HEAD); r.heading = c.heading;
  if (Math.abs(r.offset) > WALL) {
    r.offset = Math.sign(r.offset) * WALL; c.vx = 0; c.heading *= 0.5;
    if (!r.wall) { c.speed *= 0.7; r.nerves += 0.12; onWall(r); }
    r.wall = true;
  } else r.wall = false;
  r.nerves = Math.max(0, r.nerves - 0.05 * dt);
  if (r.nerves >= 1) { r.nerves = 0; startFail(r); }
}
function stepAI(r, dt, you) {
  const band = !you ? 1 : S.final ? M.clamp(1 + (you.s - r.s) / 150, 0.92, 1.16) : M.clamp(1 + (you.s - r.s) / 400, 0.85, 1.1);   // the final lap pulls the pack to ±1 s
  const lap1 = S.phase === "race" && S.raceT < 6 ? 0.94 : 1;
  r.speed = M.approach(r.speed, r.base * band * lap1 * (r.done ? 0.6 : 1), 14 * dt);
  r.s += r.speed * dt;
  const want = 3 * Math.sin(r.s * 0.045 + r.phase) + r.jit, o0 = r.offset;
  r.offset = M.clamp(M.damp(r.offset, want, 1.6, dt), -WALL, WALL);
  r.heading = M.clamp(-Math.atan2(r.offset - o0, Math.max(0.01, r.speed * dt)) * 0.8, -0.4, 0.4);
  if (S.phase !== "pick" && !r.fail && r.s > 30 && M.chance(dt * 0.03)) startFail(r);
}
function startFail(r) { r.fail = { kind: r.trait, phase: "trait", t: 0 }; if (r === player() && S.screen === "play") { S.fails++; S.crowd += 250; } onFailStart(r); }
function clearFail(r) { if (r.fail && r.fail.phase === "tumble") onTumbleEnd(r, true); r.fail = null; }
function stepFail(r, dt) {
  const f = r.fail; f.t += dt;
  if (f.phase === "trait") {
    const k = f.kind, kick = k === "sneeze" && f.t < 0.12;
    const target = k === "sit" ? 0 : k === "sneeze" ? (kick ? -12 : 0) : k === "moonwalk" ? -5 : -9;
    r.speed = M.approach(r.speed, target, (kick ? 240 : 34) * dt); r.s += r.speed * dt;
    if (f.t >= 1.0) { f.phase = "tumble"; f.t = 0; r.speed = 0; onTumbleStart(r); }
  } else if (f.t >= 1.2) {
    onTumbleEnd(r, false); r.fail = null; r.speed = 8; r.car.speed = 8; r.car.heading = 0; r.car.vx = 0; r.car.vz = -8;
  }
  if (r === player()) r.car.speed = r.speed;
}
const touching = new Set();   // pairs in contact last step: a bump is an event on first contact, not every step
function bumps() {
  for (let a = 0; a < racers.length; a++) for (let b = a + 1; b < racers.length; b++) {
    const key = a * 8 + b;
    const A = racers[a], B = racers[b];
    if ((A.fail && A.fail.phase === "tumble") || (B.fail && B.fail.phase === "tumble")) continue;
    const ds = A.s - B.s, dof = A.offset - B.offset;
    if (Math.abs(ds) > 2.6 || Math.abs(dof) > 1.3) { touching.delete(key); continue; }
    const push = (1.3 - Math.abs(dof)) * 0.5 * (dof >= 0 ? 1 : -1);
    A.offset = M.clamp(A.offset + push, -WALL, WALL); B.offset = M.clamp(B.offset - push, -WALL, WALL);
    if (!touching.has(key) && (A === player() || B === player())) onBump(A === player() ? A : B);
    touching.add(key);
  }
}
function places() {
  const ranked = racers.slice().sort((a, b) => (b.done ? 1e9 - b.done : b.s) - (a.done ? 1e9 - a.done : a.s));
  return ranked.indexOf(player()) + 1;
}

function step(dt, t) {
  const you = player();
  if (S.screen === "title" || S.screen === "over") {
    if (input.pressed("start") && shell.canAccept()) { toPick(); return; }
    for (const r of racers) if (!r.podium) r.fail ? stepFail(r, dt) : stepAI(r, dt, null);
  } else if (S.screen === "pick") {
    for (let k = 0; k < 4; k++) if (input.took("pick" + k)) { S.sel = k; onPickMoved(k); }
    if (input.took("left")) { S.sel = (S.sel + 3) % 4; onPickMoved(S.sel); }
    if (input.took("right")) { S.sel = (S.sel + 1) % 4; onPickMoved(S.sel); }
    if ((input.took("go") || input.pressed("start")) && shell.canAccept()) { startRace(); return; }
  } else if (S.phase === "countdown") {
    const before = Math.ceil(S.cd / 0.8); S.cd -= dt;
    if (Math.ceil(S.cd / 0.8) !== before) onCountdown(Math.max(0, Math.ceil(S.cd / 0.8)));
    if (S.cd <= 0) { S.phase = "race"; onGo(); }
  } else {
    S.raceT += dt;
    for (const r of racers) {
      if (r.fail) stepFail(r, dt);
      else if (r === you && S.phase === "race") stepPlayer(r, dt);
      else stepAI(r, dt, you);
      if (!r.done && r.s >= LAPS * L) { S.finished.push(r); r.done = S.finished.length; if (r === you) { S.phase = "finish"; S.finishT = 0; onCrossLine(r); } }
    }
    bumps();
    const lap = M.clamp(Math.max(S.lap0, Math.floor(you.s / L)), 0, LAPS - 1);   // the grid sits behind the line: never count down
    if (lap !== S.lap) { S.lap = lap; onLap(lap); }
    S.stage = STAGES[S.lap];
    S.place = places(); if (S.place < S.lastPlace) onOvertake(S.place); S.lastPlace = S.place;
    climaxStep(dt, you);
    if (S.phase === "finish") { S.finishT += dt; if (S.finishT > 1.4) finishRace(); }
    S.score = 1000 * (7 - S.place) + 50 * S.tier2 + S.crowd;
  }
  drawWorld(dt, t);
  rig.update(dt, t);
}

const snapshot = () => {
  const you = player();
  return { screen: S.screen, stage: S.stage, phase: S.phase, score: S.score, best: record.get(), entities: racers.length,
    climax: S.screen === "over" && S.podium.length ? "podium" : S.photo ? "photo" : S.final ? "final" : "none",
    lap: S.lap + 1, place: S.place, speed: +you.speed.toFixed(2), pack: racers.map((r) => Math.round(r.s)), crowd: S.crowd, nerves: +you.nerves.toFixed(2), selected: S.sel,
    focus: { s: +you.s.toFixed(2), offset: +you.offset.toFixed(3), x: +you.model.root.position.x.toFixed(2), y: 1.2,
      z: +you.model.root.position.z.toFixed(2), selected: S.sel } };
};
const commands = {
  die: () => finishRace(true),
  at: (stage) => { if (STAGES.includes(String(stage))) S.startStage = String(stage); },
  fail: () => { if (S.screen === "play" && !player().fail) startFail(player()); },   // probes: show the secret now
};

// ── ART ──
// Painted tin on a felt table: every horse is ONE vertex-coloured glossy tin material (extruded side profiles, rounded
// box legs, brass mane and tail, a turning wind-up key), lit by a RoomEnvironment and one real sun shadow.
const scene = G.scene, NAVY = PALETTE[0], RED = PALETTE[1], BRASS = PALETTE[2], SKY = PALETTE[3], CREAM = PALETTE[4];
const CAR = { maxSpeed: 28, accel: 18, turn: 2.2, grip: 6, driftGrip: 1.5, boost: 1.4 };
const HORSES = [
  { name: "THUNDER BISCUIT", color: RED, mane: BRASS, stat: "★ TOP SPEED", car: { maxSpeed: 29.4 } },
  { name: "BUCKET HEAD", color: NAVY, mane: CREAM, stat: "★ ROCKET START", car: { accel: 27 } },
  { name: "SIR TOOTS-A-LOT", color: BRASS, mane: RED, stat: "★ DRIFT KING", car: { turn: 2.7, driftGrip: 2.1 } },
  { name: "NOTACATBUTALLAMA", color: SKY, mane: NAVY, stat: "★ MEGA BOOST", car: { boost: 1.58 }, boostT: 1.25 },
  { name: "POTOOOOOOOO", color: "#c9ced6", mane: RED, stat: "", car: {} },
  { name: "FLAT FLEET FEET", color: "#57cc99", mane: CREAM, stat: "", car: {} },
];
const TRAIT_WORDS = { sit: { pop: "SITS DOWN!", reveal: "sits down mid-race" }, sneeze: { pop: "ACHOO!!", reveal: "sneezes itself backwards" },
  moonwalk: { pop: "MOONWALK!", reveal: "moonwalks" }, backwards: { pop: "WRONG WAY!", reveal: "runs the wrong way" } };

G.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
envMap(G.renderer, scene); scene.environmentIntensity = 0.5;   // AgX lifts everything: keep the room reflections for the sheen, not the fill
const sky = skyDome(scene, { top: SKY, horizon: CREAM, bottom: CREAM, fog: { mode: "linear-horizon", near: 70, far: 240 } });
const sun = lights(scene, { preset: "hemi+sun", sky: SKY, ground: CREAM, sun: "#fff4dc", sunIntensity: 2.8, hemiIntensity: 0.45, shadow: { size: 1024, extent: 30 } });

// vertex-coloured merge: every static piece of a toy becomes one draw call on the one tin material
const tin = mat.standard("#ffffff", { metalness: 0.35, roughness: 0.35 }); tin.vertexColors = true;
function paint(g, hex, m4) {
  const c = (g.index ? g.toNonIndexed() : g.clone()); if (m4) c.applyMatrix4(m4);
  const col = new THREE.Color(hex), n = c.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([col.r, col.g, col.b], i * 3);
  c.setAttribute("color", new THREE.BufferAttribute(a, 3)); if (!c.attributes.uv) c.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return c;
}
const T = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s, s, s));
const merged = (parts) => { const g = mergeGeometries(parts); g.computeBoundingBox(); g.computeBoundingSphere(); return g; };

// the horse, drawn as a side profile (x forward, y up) and extruded; the rig turns +x into the travel direction +z
const BODY = "M -1.05 1.3 Q -1.12 1.64 -0.72 1.66 L 0.42 1.62 Q 0.72 1.68 0.9 2.02 L 1.12 2.32 L 1.38 2.02 Q 1.08 1.56 1.02 1.22 Q 0.98 0.9 0.6 0.88 L -0.72 0.9 Q -1.02 0.94 -1.05 1.3 Z";
const HEAD = "M 1.0 2.16 L 1.1 2.64 L 1.24 2.42 L 1.38 2.44 L 1.9 2.02 Q 2.04 1.84 1.84 1.76 L 1.52 1.84 L 1.2 1.94 Z";
const MANE = "M 0.46 1.64 L 0.6 1.9 L 0.7 1.76 L 0.82 2.04 L 0.92 1.9 L 1.0 2.26 L 1.14 2.42 L 1.06 2.1 Q 0.82 1.66 0.46 1.6 Z";
const TAIL = "M -1.0 1.52 Q -1.52 1.62 -1.6 0.98 Q -1.42 1.22 -1.0 1.36 Z";
const LEG = geo.rbox(0.2, 0.9, 0.2, 0.07), HOOF = geo.rbox(0.25, 0.16, 0.27, 0.05);
const HIPS = [[0.62, 1.0, 0.2], [0.62, 1.0, -0.2], [-0.72, 1.02, 0.2], [-0.72, 1.02, -0.2]];
function buildHorse(def) {
  const root = new THREE.Group(), rig = new THREE.Group(); rig.rotation.y = -Math.PI / 2; root.add(rig);
  const torso = new THREE.Mesh(merged([
    paint(geo.extrude(BODY, 0.66, { bevel: 0.08 }), def.color),
    paint(geo.extrude(MANE, 0.22, { bevel: 0.04 }), def.mane, T(0, 0.02, 0)),
    paint(geo.extrude(TAIL, 0.16, { bevel: 0.04 }), def.mane),
    paint(geo.rbox(0.74, 0.5, 0.9, 0.08), def.color === RED ? CREAM : RED, T(-0.12, 1.44, 0)),
    paint(geo.rbox(0.78, 0.1, 0.94, 0.04), BRASS, T(-0.12, 1.69, 0)),
  ]), tin);
  const head = new THREE.Mesh(merged([
    paint(geo.extrude(HEAD, 0.44, { bevel: 0.06 }), def.color),
    paint(geo.sphere(0.075, 10), NAVY, T(1.52, 2.12, 0.26)), paint(geo.sphere(0.075, 10), NAVY, T(1.52, 2.12, -0.26)),
    paint(geo.rbox(0.2, 0.16, 0.5, 0.05), NAVY, T(1.86, 1.86, 0)),
  ]), tin);
  const key = new THREE.Mesh(merged([
    paint(geo.cyl(0.05, 0.05, 0.42, 8), BRASS, T(0, 0, -0.21, Math.PI / 2)),
    paint(geo.torus(0.15, 0.05), BRASS, T(0, 0.17, -0.44, 0, Math.PI / 2)), paint(geo.torus(0.15, 0.05), BRASS, T(0, -0.17, -0.44, 0, Math.PI / 2)),
  ]), tin);
  key.position.set(-0.2, 1.32, -0.42); torso.add(key);
  torso.castShadow = head.castShadow = true;
  const legGeo = merged([paint(LEG, def.color, T(0, -0.45, 0)), paint(HOOF, NAVY, T(0, -0.86, 0))]);
  const legs = HIPS.map(([x, y, z]) => { const m = new THREE.Mesh(legGeo, tin); m.position.set(x, y, z); return m; });
  rig.add(torso, head, ...legs);
  const flash = hitFlash(root);
  scene.add(root);
  return { root, rig, torso, head, key, legs, flash, gait: 0, rear: 0, squash: 0, flashK: 0, trail: null, rag: null };
}

// track: a cream tin-litho ribbon with navy lane dashes, red/cream kerbs, a felt table and wooden-block hills
const trackTex = canvasTex(128, 256, (g, w, h) => {
  g.fillStyle = CREAM; g.fillRect(0, 0, w, h); g.fillStyle = BRASS; g.fillRect(0, 0, 10, h); g.fillRect(w - 10, 0, 10, h);
  g.fillStyle = RED; for (const x of [w / 3, (2 * w) / 3]) { g.fillRect(x - 2, 0, 4, h * 0.3); }
  g.fillStyle = "rgba(43,45,66,0.12)"; for (let y = 8; y < h; y += 32) for (let x = 20; x < w - 16; x += 24) { g.beginPath(); g.arc(x, y, 2, 0, 7); g.fill(); }
}, { repeat: [1, 1] });
const road = new THREE.Mesh(TRACK.ribbon({ width: WIDTH, segments: 480, uvScale: 0.06 }), mat.standard(CREAM, { metalness: 0.25, roughness: 0.45 }));
road.material.color.set("#ffffff"); road.material.map = trackTex; road.position.y = 0.03; road.receiveShadow = true; scene.add(road);
const kerbTex = canvasTex(32, 64, (g, w, h) => { g.fillStyle = RED; g.fillRect(0, 0, w, h); g.fillStyle = CREAM; g.fillRect(0, 0, w, h / 2); }, { nearest: true, repeat: [1, 1] });
const kerbs = new THREE.Mesh(mergeGeometries([TRACK.ribbon({ width: 1.3, segments: 480, uvScale: 0.5, offset: WIDTH / 2 + 0.55 }),
  TRACK.ribbon({ width: 1.3, segments: 480, uvScale: 0.5, offset: -WIDTH / 2 - 0.55 })]), mat.standard("#ffffff", { metalness: 0.3, roughness: 0.4 }));
kerbs.material.map = kerbTex; kerbs.position.y = 0.06; kerbs.receiveShadow = true; scene.add(kerbs);
const feltTex = noiseTex({ size: 128, colors: ["#23253a", "#343858"], scale: 4, seed: 7 }); feltTex.wrapS = feltTex.wrapT = THREE.RepeatWrapping; feltTex.repeat.set(24, 24);
const felt = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), mat.standard("#ffffff", { roughness: 0.95 }));
felt.material.map = feltTex; felt.rotation.x = -Math.PI / 2; felt.receiveShadow = true; scene.add(felt);
const startLine = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH, 1.4), mat.standard("#ffffff", { roughness: 0.5 }));
startLine.material.map = canvasTex(96, 12, (g, w, h) => { for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) { g.fillStyle = (x + y) % 2 ? NAVY : CREAM; g.fillRect(x * 6, y * 6, 6, 6); } }, { nearest: true });
{ const a = TRACK.at(0); startLine.position.set(a.pos.x, 0.05, a.pos.z); startLine.rotation.set(-Math.PI / 2, 0, Math.atan2(a.tangent.x, a.tangent.z)); scene.add(startLine); }

// distance to the track (grid-sampled), so the hills and blocks stay off the ribbon
const trackPts = []; for (let s = 0; s < L; s += 3) { const p = TRACK.at(s).pos; trackPts.push([p.x, p.z]); }
const trackDist = (x, z) => { let d = 1e9; for (const [px, pz] of trackPts) d = Math.min(d, (px - x) ** 2 + (pz - z) ** 2); return Math.sqrt(d); };
const hills = heightfield({ size: 300, seg: 72, amp: 12, octaves: 3, seed: 5, flat: true,
  bands: [[-99, "#3d4166"], [1.5, "#e7bf7d"], [4.5, "#d69a54"], [7.5, RED], [10.5, CREAM], [99, SKY]] });
const hillH = (x, z, h) => { const k = M.smoothstep(12, 40, trackDist(x, z)); return (Math.max(h, 0) * 1.5 + 3.5) * k - 0.6; };
{
  const P = hills.mesh.geometry.attributes.position, C = hills.mesh.geometry.attributes.color, memo = new Map();
  for (let v = 0; v < P.count; v++) { const x = P.getX(v), z = P.getZ(v), key = x.toFixed(2) + "," + z.toFixed(2);
    if (!memo.has(key)) memo.set(key, hillH(x, z, P.getY(v))); P.setY(v, memo.get(key)); }
  const band = [[0, "#3d4166"], [2.5, "#e7bf7d"], [6, "#d69a54"], [10, RED], [14, CREAM], [99, SKY]].map(([h, c]) => [h, new THREE.Color(c)]);
  for (let v = 0; v < P.count; v += 3) { const h = (P.getY(v) + P.getY(v + 1) + P.getY(v + 2)) / 3, c = (band.find((b) => h <= b[0]) || band[5])[1];
    for (let k = 0; k < 3; k++) C.setXYZ(v + k, c.r, c.g, c.b); }
  P.needsUpdate = C.needsUpdate = true; hills.mesh.geometry.computeVertexNormals(); hills.mesh.geometry.computeBoundingSphere();
  scene.add(hills.mesh);
}
const blocks = scatter(scene, geo.rbox(2.4, 2.4, 2.4, 0.3), mat.standard("#ffffff", { roughness: 0.55 }), { count: 70, area: [-140, 140, -140, 140],
  y: (x, z) => { const d = trackDist(x, z); return d < 16 ? -40 : hillH(x, z, hills.heightAt(x, z)) + 0.7; }, scale: [0.7, 1.5], seed: 11 });
{ const tints = [RED, BRASS, SKY, CREAM, "#e7bf7d", "#57cc99"], c = new THREE.Color();
  for (let i = 0; i < blocks.count; i++) blocks.setColorAt(i, c.set(tints[i % tints.length])); blocks.instanceColor.needsUpdate = true; }

// SEAN, in giant alphabet blocks on the infield
const letterBlock = (ch, bg, fg) => mat.standard("#ffffff", { roughness: 0.5 });
const seanMats = [];
[["S", RED, CREAM], ["E", BRASS, NAVY], ["A", SKY, NAVY], ["N", CREAM, RED]].forEach(([ch, bg, fg], i) => {
  const m = letterBlock(ch, bg, fg);
  const draw = (g, w, h) => { g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = NAVY; g.lineWidth = 10; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = fg; g.font = "96px Bungee, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(ch, w / 2, h / 2 + 6); };
  m.map = canvasTex(128, 128, draw); seanMats.push([m, draw]);
  const b = new THREE.Mesh(geo.rbox(3.2, 3.2, 3.2, 0.35), m); b.position.set(-16 + i * 3.6, 1.6 + (i === 2 ? 0 : 0), 22 - (i % 2) * 0.8);
  b.rotation.y = 0.12 * (i - 1.5); b.castShadow = true; scene.add(b);
});
if (document.fonts && document.fonts.load) document.fonts.load("96px Bungee").then(() => seanMats.forEach(([m, draw]) => {
  const c = m.map.image, g = c.getContext("2d"); draw(g, c.width, c.height); m.map.needsUpdate = true; })).catch(() => {});

// the grandstand: striped tin tiers under a scalloped awning, and the tin crowd (one instanced lathe skittle each)
{
  const parts = [], scal = []; for (let x = -26; x < 26; x += 4) scal.push(`Q ${x + 2} -1.9 ${x + 4} -0.9`);
  for (let k = 0; k < 3; k++) parts.push(paint(geo.rbox(52, 1.1, 3, 0.2), k % 2 ? CREAM : RED, T(0, 0.55 + k * 1.1, 51 + k * 3)));
  parts.push(paint(geo.extrude(`M -26 0 L 26 0 L 26 -0.9 ${scal.join(" ")} Z`, 0.3, { bevel: 0.05 }), RED, T(0, 8.4, 48.4)));
  parts.push(paint(geo.rbox(54, 0.4, 11, 0.15), CREAM, T(0, 8.6, 54, -0.12)));
  for (const x of [-25, -8, 8, 25]) parts.push(paint(geo.cyl(0.25, 0.25, 8.4, 8), BRASS, T(x, 4.2, 49)));
  const stand = new THREE.Mesh(merged(parts), tin); stand.castShadow = true; stand.receiveShadow = true; scene.add(stand);
}
const crowd = new InstancedPool(scene, geo.lathe([[0, 0], [0.34, 0], [0.36, 0.1], [0.3, 0.68], [0.18, 0.84], [0.12, 0.9], [0.24, 1.0],
  [0.27, 1.16], [0.2, 1.32], [0, 1.38]], 10), mat.standard("#ffffff", { metalness: 0.3, roughness: 0.4 }), { max: 60, colors: true });
const fans = [];
{ const tints = [RED, BRASS, SKY, CREAM, "#57cc99", NAVY];
  for (let k = 0; k < 3; k++) for (let j = 0; j < 17; j++) { const x = -24 + j * 3 + (k % 2) * 1.5, y = 1.1 + k * 1.1, z = 51 + k * 3;
    fans.push({ id: crowd.spawn({ x, y, z, rotY: Math.PI, scale: 1.25, color: tints[(j * 7 + k * 3) % tints.length] }), x, y, z, ph: j * 1.3 + k * 0.7 }); } }
let cheer = 0;

// a giant tin wind-up key on the infield (the derby's landmark) and a spinning top across the way
const bigKey = new THREE.Mesh(merged([paint(geo.cyl(0.6, 0.6, 9, 12), BRASS, T(0, 4.5, 0)), paint(geo.torus(2.4, 0.55), BRASS, T(-2.6, 10.6, 0, 0, 0, 0)),
  paint(geo.torus(2.4, 0.55), BRASS, T(2.6, 10.6, 0)), paint(geo.lathe([[0, 0], [1.6, 0], [1.6, 0.5], [0.9, 0.9], [0, 1]], 16), NAVY, T(0, 0, 0))]), tin);
bigKey.position.set(-22, 0, 8); bigKey.castShadow = true; scene.add(bigKey);
const top = new THREE.Mesh(merged([paint(geo.lathe([[0, 0], [0.4, 0.3], [3.2, 2.6], [3.4, 3.1], [2.6, 3.8], [0.5, 4.2], [0.4, 6.2], [0, 6.3]], 20), RED),
  paint(geo.torus(3.1, 0.28), CREAM, T(0, 3.05, 0, Math.PI / 2))]), tin);
top.position.set(24, 0, 6); top.castShadow = true; scene.add(top);

// fx: dust trails, brass sparks, clank bits, shockwave rings, a cream screen wash
const sparks = new Sparks(scene, { colors: [BRASS, CREAM, RED], max: 360, size: 0.42, blending: "normal" });
const dust = new Sparks(scene, { colors: ["#e7bf7d", "#d69a54"], max: 200, size: 0.6, blending: "normal" });
const bits = new Chunks(scene, { colors: [BRASS, RED, SKY, CREAM], max: 220, geometry: "cube" });
const tl = new Timeline(scene, { colors: [BRASS, CREAM] });
const flash = screenFlash("#flash", { color: CREAM });
const camTarget = new THREE.Object3D(); scene.add(camTarget);
const FOLLOW = { back: 7.4, up: 3.7, lookUp: 1.5, lookAhead: 5, yawFollow: true, k: 5 };   // close enough that the tin hero reads on a phone
const W = world({ fixedStep: 1 / 60, gravity: [0, -26, 0], restitution: 0.35 }); W.ground(0.05);

// sound: tin whistle lead, a toy-drum gallop, and the old Camptown Races "doo-dah" as the motif (public domain, 1850)
const sfx = defineSfx({
  giddy: [{ noise: { f0: 3200, f1: 7000, dur: 0.05, vol: 0.45, type: "highpass" } }, { tone: { type: "sawtooth", f0: 620, f1: 1180, dur: 0.16, vol: 0.16 }, at: 0.05 },
    { tone: { type: "sawtooth", f0: 1180, f1: 520, dur: 0.3, vol: 0.14, detune: 25 }, at: 0.19 }],
  clank: [{ tone: { type: "square", f0: 1480, f1: 1390, dur: 0.07, vol: 0.18 } }, { tone: { type: "square", f0: 2210, dur: 0.05, vol: 0.12 }, at: 0.02 },
    { noise: { f0: 5200, dur: 0.06, vol: 0.3, q: 9 } }, { tone: { type: "triangle", f0: 880, f1: 860, dur: 0.18, vol: 0.12 }, at: 0.06 }],
  achoo: [{ noise: { f0: 900, f1: 2400, dur: 0.22, vol: 0.2 } }, { noise: { f0: 2600, f1: 500, dur: 0.35, vol: 0.4, q: 0.7 }, at: 0.24 }],
  slide: { tone: { type: "sine", f0: 1300, f1: 260, dur: 0.6, vol: 0.2 } },
  cheer: [{ noise: { f0: 1100, f1: 1500, dur: 0.9, vol: 0.28, q: 0.6 } }, { tone: { type: "triangle", f0: 523, dur: 0.1, vol: 0.1 }, at: 0.1 },
    { tone: { type: "triangle", f0: 659, dur: 0.1, vol: 0.1 }, at: 0.2 }, { tone: { type: "triangle", f0: 784, dur: 0.2, vol: 0.1 }, at: 0.3 }],
  roar: [{ noise: { f0: 900, f1: 1700, dur: 1.4, vol: 0.45, q: 0.5 } }, { noise: { f0: 2400, dur: 0.9, vol: 0.2, q: 2 }, at: 0.3 },
    { tone: { type: "square", f0: 1046, f1: 1568, dur: 0.25, vol: 0.08 }, at: 0.15 }],
  tier1: { tone: { type: "triangle", f0: 660, f1: 700, dur: 0.12, vol: 0.2 } },
  tier2: [{ tone: { type: "triangle", f0: 880, f1: 940, dur: 0.1, vol: 0.2 } }, { tone: { type: "triangle", f0: 1175, dur: 0.14, vol: 0.2 }, at: 0.08 }],
  zoom: { noise: { f0: 400, f1: 3000, dur: 0.35, vol: 0.25, q: 1.5 } },
  bump: { noise: { f0: 260, dur: 0.1, vol: 0.45, type: "lowpass" }, throttle: 0.15 },
  beep: { tone: { type: "square", f0: 523, dur: 0.14, vol: 0.2 } },
  go: [{ tone: { type: "square", f0: 784, dur: 0.12, vol: 0.2 } }, { tone: { type: "square", f0: 1046, dur: 0.3, vol: 0.2 }, at: 0.1 }],
  bell: [{ tone: { type: "sine", f0: 1319, dur: 0.5, vol: 0.2 } }, { tone: { type: "sine", f0: 1760, dur: 0.6, vol: 0.14 }, at: 0.12 }],
  boing: { tone: { type: "sine", f0: 260, f1: 620, dur: 0.18, vol: 0.22 } },
  moon: [988, 932, 880, 831, 784, 659].map((f, i) => ({ tone: { type: "square", f0: f, dur: 0.07, vol: 0.12 }, at: i * 0.08 })),
  honk: [{ tone: { type: "sawtooth", f0: 233, f1: 220, dur: 0.16, vol: 0.2 } }, { tone: { type: "sawtooth", f0: 233, f1: 208, dur: 0.22, vol: 0.2 }, at: 0.22 }],
  ratchet: [0, 1, 2, 3, 4, 5, 6].map((i) => ({ noise: { f0: 4200 - i * 150, dur: 0.025, vol: 0.28, q: 6 }, at: i * 0.055 })),
  shutter: [{ noise: { f0: 6000, dur: 0.03, vol: 0.5, type: "highpass" } }, { noise: { f0: 3000, dur: 0.05, vol: 0.35, q: 3 }, at: 0.07 },
    { tone: { type: "sine", f0: 2400, f1: 1200, dur: 0.25, vol: 0.08 }, at: 0.1 }],
  fanfare: [[67, 0], [72, 0.14], [76, 0.28], [79, 0.42], [76, 0.62], [79, 0.76]].map(([n, at]) => ({ tone: { type: "square", f0: 440 * 2 ** ((n - 69) / 12), dur: at > 0.7 ? 0.5 : 0.13, vol: 0.14 }, at })),
}, { seed: 3 });
const DERBY = song({ bpm: 148, key: 60, scale: "major", bars: 4, seed: 9,
  motif: [67, 67, 64, 67, 69, 67, 64, null, 64, 62, null, 64, 62, null, 60, null],
  voices: { lead: { wave: "square", env: [0.005, 0.05, 0.5, 0.06] }, bass: { wave: "triangle", env: [0.005, 0.1, 0.7, 0.08] },
    drums: { kit: "toy", pattern: "k.hkk.h.k.hks.h." } } });
playSong(DERBY);

// pops: this game's own words, stamped in Bungee over the world, animated in simulation time
const popEls = [...Array(8)].map(() => { const e = document.createElement("span"); e.style.opacity = "0"; document.querySelector("#pops").append(e); return e; });
const pops = []; let popNext = 0; const _v = new THREE.Vector3();
function pop(text, at, cls = "") {
  const el = popEls[popNext++ % popEls.length]; let x = G.size.w / 2, y = G.size.h * 0.34;
  if (at) { _v.copy(at).project(G.camera); x = (_v.x * 0.5 + 0.5) * G.size.w; y = (-_v.y * 0.5 + 0.5) * G.size.h; }
  el.textContent = text; el.className = cls; const p = pops.find((q) => q.el === el) || { el }; Object.assign(p, { x, y, t: 0 });
  if (!pops.includes(p)) pops.push(p);
}
function stepPops(dt) {
  for (const p of pops) { if (p.t > 1.2) continue; p.t += dt; const k = Math.min(1, p.t / 0.12), s = 0.4 + 0.8 * k - 0.2 * Math.max(0, Math.min(1, (p.t - 0.12) / 0.15));
    p.el.style.transform = `translate(${p.x}px, ${p.y - 60 * p.t}px) translate(-50%, -50%) scale(${s.toFixed(3)})`; p.el.style.opacity = p.t > 1.2 ? "0" : String(Math.min(1, (1.2 - p.t) / 0.3)); }
}

// the game's own responses to its events (named under Juice in DESIGN.md)
const hoofPos = (r) => _v.set(r.model.root.position.x, 0.3, r.model.root.position.z);
function onBoost(r) {   // GIDDY-UP: whip-crack neigh, the horse rears, a brass hoof-spray, the camera punches in
  sfx.giddy(); rig.kick(12, 0.45); rig.shake(0.18, 0.12); r.model.rear = 1;
  sparks.burst(hoofPos(r), { n: 18, speed: 7, up: 4, life: 0.5, grav: -14 }); pop("GIDDY-UP!", r.model.root.position.clone().setY(3.2), "gold small");
}
function onDriftTier(r, tier) { sfx["tier" + tier](); r.model.flashK = tier === 2 ? 0.9 : 0.5; r.model.flashC = tier === 2 ? RED : BRASS;
  sparks.burst(hoofPos(r), { colors: tier === 2 ? [RED, BRASS] : [BRASS], n: 14, speed: 5, up: 2, life: 0.4 }); }
function onDriftBoost(r, tier) { if (!tier) return; sfx.zoom(); rig.kick(tier === 2 ? 16 : 10, 0.5); pop(tier === 2 ? "MEGA ZOOM!" : "ZOOM!", r.model.root.position.clone().setY(3), "gold"); }
function onWall(r) { sfx.bump(); rig.shake(0.3, 0.15); r.model.flashK = 0.6; r.model.flashC = CREAM; sparks.burst(hoofPos(r), { colors: [CREAM, BRASS], n: 10, speed: 5, up: 3, life: 0.35 }); }
function onBump(r) { sfx.bump(); rig.shake(0.22, 0.12); r.model.flashK = 0.35; r.model.flashC = BRASS; sparks.burst(hoofPos(r), { colors: [BRASS, CREAM], n: 8, speed: 4, up: 2, life: 0.3 }); }
function onFailStart(r) {   // the secret comes out: the word, the sound, the crowd is on its feet
  const mine = r === player() && S.screen === "play", w = TRAIT_WORDS[r.fail.kind];
  const near = mine || r.model.root.position.distanceTo(G.camera.position) < 45, p = r.model.root.position, k = r.fail.kind;
  if (near) {   // each secret has its own staging, so a kid learns them by sight
    if (k === "sneeze") { sfx.achoo(); const nose = r.model.head.getWorldPosition(new THREE.Vector3()); sparks.burst(nose, { colors: [CREAM, "#ffffff"], n: 40, speed: 10, up: 1, life: 0.7, grav: -1 });
      tl.after(0.24, () => tl.shockwave([p.x, 1.6, p.z], { color: CREAM, size: 3, dur: 0.35 })); }
    else if (k === "sit") { sfx.slide(); tl.after(0.25, () => { sfx.bump(); dust.burst([p.x, 0.3, p.z], { n: 20, speed: 5, up: 1, life: 0.6, grav: 1 }); tl.shockwave([p.x, 0.12, p.z], { color: "#e7bf7d", size: 3.2, dur: 0.4, flat: true }); }); }
    else if (k === "moonwalk") { sfx.moon(); tl.every(0.15, () => sparks.burst([r.model.root.position.x, 0.4, r.model.root.position.z], { colors: [BRASS, SKY], n: 6, speed: 4, up: 3, life: 0.45 }), 6); }
    else { sfx.honk(); }
  }
  if (S.screen === "play") pop(w.pop, r.model.root.position.clone().setY(3.4), (mine ? "" : "small") + (k === "backwards" ? " red" : ""));
  if (mine) { cheer = 1.8; sfx.roar(); flash.hit(0.35); rig.shake(0.35, 0.25); pop("+250 CROWD!", null, "gold");   // louder than any win
    tl.every(0.18, () => bits.burst([p.x + M.rand(-2, 2), 4.5, p.z + M.rand(-2, 2)], { n: 12, speed: 4, up: [1, 4], life: 1.4, grav: -9, size: 0.16, floor: 0.08 }), 5); }
  else if (S.screen === "play") { cheer = Math.max(cheer, 0.8); sfx.cheer(); }
}
function onTumbleStart(r) {   // Signature visual: the tin horse comes apart as a ragdoll for 1.2 s
  const m = r.model, side = M.chance(0.5) ? 1 : -1, fwd = _v.set(0, 0, 1).applyQuaternion(m.root.quaternion);
  m.rag = W.ragdoll(m.rig, { parts: { head: m.head, torso: m.torso, legs: m.legs }, mass: 1 });
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  m.rag.fling([right.x * side * 14 + fwd.x * 12, 46, right.z * side * 14 + fwd.z * 12], { spin: 10 });   // impulse is shared by mass (≈ 4.9)
  if (r === player()) { loop.hitstop(70); rig.shake(0.45, 0.3); }
}
function onTumbleEnd(r, quiet) {   // ...and clanks back together, key still turning
  const m = r.model; if (m.rag) { m.rag.end(); m.rag = null; } if (quiet) return;
  m.squash = 1; m.rewind = 1; const p = m.root.position;
  if (r === player() || r.model.root.position.distanceTo(G.camera.position) < 40) {
    sfx.clank(); tl.after(0.18, () => sfx.ratchet()); bits.burst([p.x, 1.2, p.z], { n: 14, speed: 5, up: [3, 6], size: 0.18, life: 0.8, floor: 0.05 });
    tl.shockwave([p.x, 0.12, p.z], { color: BRASS, size: 3.5, dur: 0.45, flat: true });
  }
}
function onCountdown(n) { if (n > 0) sfx.beep(); }
function onGo() { sfx.go(); pop("GO!", null, "gold"); flash.hit(0.25); setIntensity(1); if (S.lap === LAPS - 1) startFinal(); }
function onPickOpen() { playSong(DERBY); }
function onRaceStart() { setIntensity(0.6); cheer = 0.6; poseRacer(player(), 0, 0); camTarget.position.copy(player().model.root.position); camTarget.rotation.set(0, yawAt(player().s), 0); rig.follow(camTarget, FOLLOW); rig.snap(); }
function onLap(lap) { sfx.bell(); cheer = Math.max(cheer, 0.5); if (lap === LAPS - 1) startFinal(); else pop(`LAP ${lap + 1}!`, null, "gold"); }
function onOvertake(place) { sfx.boing(); placeKick = 1; }
function onCrossLine(r) { sfx.cheer(); cheer = 1.1; pop(ordinal(S.place) + "!", null, "gold"); if (S.photo) photoSnap(); else flash.hit(0.3); }
function onFinish(dnf) { setIntensity(0.5); playSong(DERBY); verdict(dnf); podium(); }
function onPickMoved(k) {
  document.querySelectorAll(".card").forEach((c, i) => c.classList.toggle("sel", i === k));
  const m = racers[k].model; m.rear = 1; sfx.boing(); const p = m.root.position;
  tl.shockwave([p.x, 0.1, p.z], { color: BRASS, size: 2.6, dur: 0.4, flat: true });
}
function showCards() {
  HORSES.slice(0, 4).forEach((h, i) => { const c = document.querySelector("#pick-" + i);
    c.querySelector(".name").textContent = h.name; c.querySelector(".stat").textContent = h.stat; c.querySelector(".swatch").style.background = h.color; });
}
let placeKick = 0;

// pose every horse from its (s, offset) and run its gait; ragdolling horses are left to the physics
function poseRacer(r, dt, t) {
  const m = r.model, a = TRACK.at(r.s), yaw = Math.atan2(a.tangent.x, a.tangent.z);
  if (r.podium) { posePodium(r, dt, t); }
  else if (!m.rag) {
    m.root.position.set(a.pos.x + a.normal.x * r.offset, 0.05, a.pos.z + a.normal.z * r.offset);
    const f = r.fail, turn = f && f.phase === "trait" && f.kind === "backwards" ? Math.PI * Math.min(1, f.t * 3) : 0;
    const show = S.screen === "pick" && r.i === S.sel ? S.spin : 0;   // the picked horse turns on its brass turntable
    m.root.rotation.set(0, yaw + r.heading + turn + show, 0);
    const sp = Math.abs(r.speed), gallop = Math.min(1, sp / 12);
    m.gait += dt * (4 + sp * 0.5) * (f && f.kind === "moonwalk" ? -1 : 1);
    const sitting = f && f.phase === "trait" && f.kind === "sit" ? Math.min(1, f.t * 4) : 0;
    m.legs.forEach((leg, i) => { const back = i >= 2; leg.rotation.z = back && sitting ? -1.35 * sitting : Math.sin(m.gait + (back ? Math.PI : 0) + (i % 2) * 0.9) * 0.62 * gallop; });
    m.rear = Math.max(0, m.rear - dt * 2.6); m.squash = Math.max(0, m.squash - dt * 3);
    const pitch = m.rear * 0.45 * Math.sin(Math.PI * m.rear) + sitting * 0.55;
    m.rig.rotation.set(0, -Math.PI / 2, pitch); m.rig.position.y = Math.abs(Math.sin(m.gait)) * 0.14 * gallop - sitting * 0.55;
    m.rig.scale.set(1 + m.squash * 0.2, 1 - m.squash * 0.28, 1 + m.squash * 0.2);
    const sneeze = f && f.kind === "sneeze" && f.phase === "trait" ? Math.sin(Math.min(1, f.t * 5) * Math.PI) : 0;
    m.head.rotation.z = Math.sin(m.gait * 2) * 0.05 * gallop - sneeze * 0.5; m.head.position.set(sneeze * -0.2, 0, 0);
  }
  m.rewind = Math.max(0, (m.rewind || 0) - dt * 1.2);   // after a clank the key re-winds itself, fast
  m.key.rotation.z += dt * (2 + Math.abs(r.speed) * 0.35 + (r.car.drifting && r === player() ? 10 : 0) + m.rewind * 28);
  m.flashK = Math.max(0, m.flashK - dt * 3); m.flash.set(m.flashK, m.flashC || CREAM);
  if (!m.rag && Math.abs(r.speed) > 6 && dt > 0 && (m.puff = (m.puff || 0) - dt) <= 0) {   // hoof dust: a tan puff every few strides
    m.puff = 0.12; const p = m.root.position; dust.emit(p.x + M.rand(-0.4, 0.4), 0.2, p.z + M.rand(-0.4, 0.4), M.rand(-1, 1), M.rand(0.6, 1.6), M.rand(-1, 1), undefined, 0.4, 2.6, 0.8);
  }
}

function drawWorld(dt, t) {
  const you = player();
  for (const r of racers) poseRacer(r, dt, t);
  W.step(dt);
  sparks.update(dt); dust.update(dt); bits.update(dt); tl.update(dt); flash.update(dt);
  const boosting = S.screen === "play" && you.car.boostT > 0 && !you.fail;
  if (boosting) { const m = you.model, q = m.root.quaternion; streamerAt.copy(_tail).applyQuaternion(q).add(m.root.position); streamerAt.x += Math.sin(t * 11) * 0.35 * Math.cos(m.root.rotation.y); streamerAt.z -= Math.sin(t * 11) * 0.35 * Math.sin(m.root.rotation.y); streamer.update(dt); } else streamer.clear();
  cheer = Math.max(0, cheer - dt * 0.5);
  for (const f of fans) crowd.set(f.id, { y: f.y + Math.abs(Math.sin(t * (7 + cheer * 5) + f.ph)) * (0.08 + cheer * 0.45) });
  bigKey.rotation.y = t * 0.4; top.rotation.y = t * 5; top.rotation.z = Math.sin(t * 1.3) * 0.06;
  stepPops(dt);
  if (S.screen === "play") {
    hud.place(ordinal(S.place)); hud.lap(`LAP ${S.lap + 1}/${LAPS}`); hud.crowd(String(S.crowd));
    document.querySelector("#nerves-fill").style.width = Math.round(Math.min(1, you.nerves) * 100) + "%";
    placeKick = Math.max(0, placeKick - dt * 4); document.querySelector("#place").style.transform = `scale(${(1 + placeKick * 0.35).toFixed(3)})`;
    hud.cd(S.phase === "countdown" ? String(Math.max(1, Math.ceil(S.cd / 0.8))) : "");
  } else hud.cd("");
  const p = you.model.root.position;
  S.spin = S.screen === "pick" ? S.spin + dt * 1.3 : 0; turntable.visible = S.screen === "pick";
  if (turntable.visible) { const q = racers[S.sel].model.root.position; turntable.position.set(q.x, 0.05, q.z); turntable.rotation.y = S.spin; }
  if (S.screen === "play" && S.photo) { photoCam(); }
  else if (S.screen === "over" && S.podium.length) { rig.orbit(PODIUM_AT, { radius: 12, height: 3.2, speed: 0.3, k: 3 }); sun.follow(PODIUM_AT); }
  else if (S.screen === "pick") {
    const a = TRACK.at(12), c = TRACK.at(2.6);
    rig.fixed([a.pos.x + a.normal.x * 1.2, 3.1, a.pos.z + a.normal.z * 1.2], [c.pos.x, 1.5, c.pos.z], { k: 4 });
    sun.follow(c.pos);
  } else if (S.screen === "play") {
    camTarget.position.copy(p); camTarget.rotation.set(0, yawAt(you.s) + you.heading * 0.35, 0);
    rig.follow(camTarget, FOLLOW); sun.follow(p); rig.roll(M.clamp(you.heading * 0.12, -0.09, 0.09));   // lean into bends and drifts
  } else {
    const lead = racers.reduce((a, b) => (b.s > a.s ? b : a));
    rig.orbit(lead.model.root.position, { radius: 15, height: 6, speed: 0.22, k: 2.5 }); sun.follow(lead.model.root.position);
  }
}
function render() { tick(loop ? loop.t : 0); W.sync(); crowd.sync(); }

// ── CLIMAX (polish layer) ──
// race-finish: "FINAL LAP!" stamped big, the Camptown gallop 15% faster, the pack pulled to ±1 s (stepAI's S.final band),
// a photo finish — slow motion from 14 u out, a hard cut to the trackside photographer, a shutter flash on the line —
// then the top three stand on a tin podium under confetti while the over card says GOOD HORSE or TOTAL FAILURE.
const DERBY_FINAL = { ...DERBY, bpm: Math.round(DERBY.bpm * 1.15) };
function startFinal() {
  if (S.final) return; S.final = true;
  pop("FINAL LAP!", null, "big"); playSong(DERBY_FINAL, { fade: 0.3 }); setIntensity(1); cheer = Math.max(cheer, 0.9); rig.kick(8, 0.6);
}
function climaxStep(dt, you) {
  if (!S.photo && S.phase === "race" && S.final && LAPS * L - you.s < 14) {
    S.photo = true; loop.slowmo(0.3, 1.8); photoCam(); rig.snap(); sfx.zoom(); pop("PHOTO FINISH!", null, "big");
  }
}
const LINE = TRACK.at(0), PHOTO_POS = LINE.pos.clone().addScaledVector(LINE.normal, -11.5).addScaledVector(LINE.tangent, 5.5).setY(2.0);   // past the line: they gallop at you
const PHOTO_LOOK = LINE.pos.clone().addScaledVector(LINE.normal, 0.5).addScaledVector(LINE.tangent, -2).setY(1.5);
function photoCam() { rig.fixed(PHOTO_POS, PHOTO_LOOK, { k: 8 }); sun.follow(LINE.pos); }
function photoSnap() { sfx.shutter(); flash.hit(0.95, "#ffffff"); loop.hitstop(160); rig.shake(0.2, 0.1); }

// the podium: a tin 2-1-3 with brass, silver and red tops, on the infield by the alphabet blocks
const PODIUM_AT = new THREE.Vector3(8, 3.4, 25);   // the orbit looks above the blocks, so the podium sits under the over card
const SPOTS = [[0, 2.2], [-3.4, 1.5], [3.4, 1.0]];   // x offset and top height for 1st, 2nd, 3rd
const podiumMesh = new THREE.Mesh(merged(SPOTS.map(([x, h], i) => paint(geo.rbox(3.3, h, 3.3, 0.2), [BRASS, "#c9ced6", RED][i], T(x, h / 2, 0)))
  .concat(SPOTS.map(([x, h]) => paint(geo.rbox(3.5, 0.18, 3.5, 0.06), NAVY, T(x, h, 0))))), tin);
podiumMesh.position.set(PODIUM_AT.x, 0, PODIUM_AT.z); podiumMesh.castShadow = podiumMesh.receiveShadow = true; scene.add(podiumMesh);
function podium() {
  const ranked = racers.slice().sort((a, b) => (b.done ? 1e9 - b.done : b.s) - (a.done ? 1e9 - a.done : a.s)).slice(0, 3);
  S.podium = ranked; ranked.forEach((r, i) => { clearFail(r); r.speed = 0; r.podium = { x: PODIUM_AT.x + SPOTS[i][0], y: SPOTS[i][1] + 0.05, z: PODIUM_AT.z, rank: i }; });
  rig.orbit(PODIUM_AT, { radius: 12, height: 3.2, speed: 0.3, k: 3 }); rig.snap(); sfx.fanfare(); cheer = 1.4;
  tl.every(0.45, () => bits.burst([PODIUM_AT.x + M.rand(-3.5, 3.5), 8.5, PODIUM_AT.z + M.rand(-1.5, 1.5)],
    { colors: [RED, BRASS, SKY, CREAM], n: 22, speed: 5, up: [1, 5], life: 2, grav: -7, size: 0.2, floor: 0.1 }), 10);
}
function posePodium(r, dt, t) {
  const m = r.model, P = r.podium; m.root.position.set(P.x, P.y, P.z); m.root.rotation.set(0, Math.sin(t * 0.8 + P.rank) * 0.25, 0);
  m.rear = P.rank === 0 && Math.sin(t * 2.2) > 0.96 ? 1 : Math.max(0, m.rear - dt * 2.6);   // the winner keeps rearing up
  m.rig.rotation.set(0, -Math.PI / 2, m.rear * 0.45 * Math.sin(Math.PI * m.rear)); m.rig.position.y = 0; m.rig.scale.set(1, 1, 1);
  m.legs.forEach((leg) => { leg.rotation.z = 0; });
}
// Sean's words, literally: was it a good horse, or a failure?
function verdict(dnf) {
  const f = S.fails, top = S.place <= 3 && !dnf;
  const [text, cls] = dnf ? ["TOTAL FAILURE!", "fail"] : f >= 2 ? ["CERTIFIED FAILURE!", "fail"] : f === 1 ? (top ? ["GOOD HORSE (MOSTLY)!", "good"] : ["A LITTLE BIT FAILURE", "fail"])
    : top ? ["GOOD HORSE!", "good"] : ["GOOD HORSE, SLOW LEGS", "good"];
  const el = document.querySelector("#verdict"); el.textContent = text; el.className = "verdict " + cls;
}

// a finish arch with a checkered FINISH banner, and bunting under the awning and the banner
{
  const a = LINE, side = WIDTH / 2 + 1.4, yaw = Math.atan2(a.tangent.x, a.tangent.z), posts = [];
  for (const k of [-1, 1]) posts.push(paint(geo.cyl(0.32, 0.32, 7.4, 10), BRASS, T(a.pos.x + a.normal.x * side * k, 3.7, a.pos.z + a.normal.z * side * k)));
  const arch = new THREE.Mesh(merged(posts), tin); arch.castShadow = true; scene.add(arch);
  const banner = new THREE.Mesh(geo.rbox(WIDTH + 3.6, 1.8, 0.35, 0.12), mat.standard("#ffffff", { roughness: 0.45, metalness: 0.2 }));
  const draw = (g, w, h) => { for (let x = 0; x < 32; x++) for (let y = 0; y < 2; y++) { g.fillStyle = (x + y) % 2 ? NAVY : CREAM; g.fillRect(x * 16, y * 8, 16, 8); g.fillRect(x * 16, h - 16 + y * 8, 16, 8); }
    g.fillStyle = RED; g.fillRect(0, 16, w, h - 32); g.fillStyle = CREAM; g.font = "58px Bungee, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("FINISH", w / 2, h / 2 + 3); };
  banner.material.map = canvasTex(512, 96, draw); seanMats.push([banner.material, draw]);
  banner.position.set(a.pos.x, 7.2, a.pos.z); banner.rotation.y = yaw + Math.PI / 2; banner.castShadow = true; scene.add(banner);
  const flags = [], tint = [RED, BRASS, SKY, CREAM];
  const pennant = (x, y, z, ry, i) => flags.push(paint(geo.extrude("M -0.5 0 L 0.5 0 L 0 -0.9 Z", 0.04, { bevel: 0 }), tint[i % 4], T(x, y, z, 0, ry)));
  for (let i = 0; i < 26; i++) pennant(-25 + i * 2, 7.35 - 0.35 * Math.sin((i % 4) / 4 * Math.PI), 48.3, 0, i);
  for (let i = 0; i < 9; i++) { const o = -side + 0.8 + i * ((2 * side - 1.6) / 8); pennant(a.pos.x + a.normal.x * o, 6.2, a.pos.z + a.normal.z * o, yaw + Math.PI / 2, i + 1); }
  scene.add(new THREE.Mesh(merged(flags), tin));
}
const turntable = new THREE.Mesh(merged([paint(geo.lathe([[0, 0], [2.1, 0], [2.2, 0.08], [2.05, 0.16], [0, 0.18]], 32), BRASS),
  ...[0, 1, 2, 3, 4, 5].map((i) => paint(geo.rbox(0.5, 0.06, 0.18, 0.02), RED, T(Math.cos(i * 1.047) * 1.7, 0.18, Math.sin(i * 1.047) * 1.7, 0, -i * 1.047)))]), tin);
turntable.receiveShadow = true; turntable.visible = false; scene.add(turntable);

for (let i = 0; i < 6; i++) racers.push(makeRacer(i));
const streamerAt = new THREE.Vector3(), _tail = new THREE.Vector3(0, 1.45, -1.55);   // GIDDY-UP streamer: a brass ribbon off the tail while boosting
const streamer = new Trail(scene, streamerAt, { color: BRASS, length: 22, width: 0.5, blending: "normal" });
{ let k = 0; for (const r of racers) { r.s = k * 7; r.offset = [-3, 2, 0, -1, 3, 1][k]; r.speed = r.base; k++; } }
G.warm([sparks.object, dust.object, bits.object, streamer.object, ...racers.map((r) => r.model.root)]);
toTitle();
loop = startLoop({ step, render: (alpha, t) => render(), snapshot, input, G, commands });
