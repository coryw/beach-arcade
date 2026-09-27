// Jaws Toy Hunt — by Cory. A 3d island-3d game on the kit/three toolbox (./lib-2/), look "Big Blue Boardwalk".
// The real Jaws Resortwear in Murrells Inlet, SC: a 50-foot blue fiberglass shark you walk into through its open mouth,
// a 5,000-gallon shark tank in the middle of the store, $1.99 shark tooth necklaces, hermit crabs, NeeDoh squishies,
// MB hoodies, a "PARENTS PLEASE WATCH YOUR CHILDREN AROUND THE SHARK TANK" sign — and (the kid's addition) a fart machine.
// Toolbox API: kit/three/README.md. Every three.js call must exist in r170.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { boot, startLoop, best, M, params } from "./lib-2/core.js";
import { createShell } from "./lib-2/shell.js";
import { createInput } from "./lib-2/input.js";
import { createRig } from "./lib-2/camera.js";
import { tick, waterMat } from "./lib-2/shaders.js";
import { defineSfx, song, playSong, stopMusic, setIntensity, SCALES, throttle } from "./lib-2/audio.js";
import { Sparks, Timeline, screenFlash } from "./lib-2/fx.js";
import { canvasTex, mat, part, geo, deform, skyDome, lights, blobShadow, hitFlash } from "./lib-2/art.js";
import { body, InstancedPool } from "./lib-2/physics.js";

// ── STRUCTURE ──
const PALETTE = ["#16213e", "#2f8fd6", "#ffb703", "#e63946", "#f4f1ea"];   // ink navy · shark blue · sunny yellow · lifeguard red · sand white
const SLUG = "jaws-toy-hunt", ORIENT = "landscape";
const ACTS = ["front", "back", "closing"];            // the front of the store, the back opens, then CLOSING TIME (the climax)
const CLOSE = { sec: 28, guard: [0, 19.5], outZ: 31.5 };
const RUN = 7, HERO_R = 0.5, REACH = 1.6, STRIKES = 3;
const VAT = { x: 0, z: 2, r: 4.2, rim: 5.0, h: 1.0 };   // the 5,000-gallon shark tank in the middle of the store
const ARCADE = { x: -19.4, z: 20.5, r: 3.4 };          // the fart machine, front-left corner
const OWNER = { patrol: 3.1, curious: 4.6, chase: 6.4, see: 10.5, seeCos: 0.72, tell: 0.8, chaseMax: 5 };
const START = { x: 0, z: 34, yaw: Math.PI };           // outside, in the parking lot, facing the open jaws

const G = boot({ canvas: "#view", background: PALETTE[1], bloom: { strength: 0.5, radius: 0.5, threshold: 0.92 }, toneMapping: "neutral",
  camera: { fov: 55, near: 0.1, far: 240 }, errorMessage: "Uh oh — a shark bit the game. Show this to a grown-up:" });
const input = createInput({
  stick: { zone: "#stick-zone", mode: "float", radius: 60, deadzone: 0.08, base: "#stick-base", knob: "#stick-knob" },
  buttons: { "#btn-jump": "jump", "#btn-action": "action" } });
const shell = createShell({ screens: { title: "#title", over: "#over" }, orient: ORIENT, input,
  prompt: { el: "#prompt", text: input.isTouch ? "tap to run in!" : "press space to run in!" },
  onShow: (name) => { if (name === "title" || name === "over") G.quality.probeUp(); } });
shell.hubLink(); shell.rotate("#rotate");
const hudScore = shell.text("#score"), hudToys = shell.text("#toy-n"), finalScore = shell.text("#final"), bestScore = shell.text("#best"),
  overT = shell.text("#over-t"), overWhy = shell.text("#over-why");
const record = best(SLUG), rig = createRig(G.camera);
const strikeEls = [...document.querySelectorAll("#strikes i")], handsEl = document.querySelector("#hands"), newBestEl = document.querySelector("#newbest");
const stickZone = document.querySelector("#stick-zone");

const S = { screen: "title", stage: "front", startStage: "front", t: 0, score: 0, strikes: 0, found: 0, foundFront: 0, gate: false, inv: 0,
  hands: false, dunkT: 0, dunkBest: 0, frenzy: false, fartCool: 0, bannerT: 0, won: false, land: 0, closeT: 0, shut: false };
const H = { x: START.x, y: 0, z: START.z, vx: 0, vz: 0, yaw: START.yaw, squash: 0, run: 0 };
const O = { x: -12.5, z: 22, yaw: 0, wp: 1, mode: "patrol", t: 0, tx: 0, tz: 0, seen: false, cool: 0, bob: 0 };
const ROUTE = [[-12.5, 22], [12.5, 22], [12.5, -10], [7, -10], [7, 6.5], [-7, 6.5], [-7, -10], [-12.5, -10]];
let loop = null;

function start() {
  Object.assign(S, { screen: "play", stage: S.startStage, t: 0, score: 0, strikes: 0, found: 0, foundFront: 0, gate: false, inv: 0,
    hands: false, dunkT: 0, dunkBest: 0, frenzy: false, fartCool: 0, bannerT: 0, won: false, closeT: 0, shut: false });
  Object.assign(H, { x: START.x, y: 0, z: START.z, vx: 0, vz: 0, yaw: START.yaw, squash: 0 });
  Object.assign(O, { x: ROUTE[0][0], z: ROUTE[0][1], wp: 1, mode: "patrol", t: 0, seen: false, cool: 0 });
  toys.forEach((t) => { t.found = false; t.group.visible = true; });
  if (S.stage === "back") { toys.filter((t) => t.zone === "front").forEach((t) => { t.found = true; t.group.visible = false; }); S.found = S.foundFront = 4; openGate(true); Object.assign(H, { x: -12.5, z: -10, yaw: Math.PI }); }
  else if (S.stage === "closing") { toys.forEach((t) => { t.found = true; t.group.visible = false; }); S.found = 8; S.foundFront = 4; openGate(true); Object.assign(H, { x: -12.5, z: -10, yaw: Math.PI }); }
  else closeGate();
  climaxReset(); if (S.stage === "closing") startClosing();
  strikeEls.forEach((el) => el.classList.remove("gone")); hudScore(0); hudToys(S.found); handsEl.hidden = true;
  rig.snap(); shell.show("play"); onStart();
}
function over(why = "the owner marched you out the shark's mouth!", win = false) {
  if (S.screen === "over") return;
  S.screen = "over"; S.hands = false; handsEl.hidden = true; S.won = win;
  const r = record.submit(S.score);
  overT(win ? "YOU FOUND THEM ALL!" : "KICKED OUT!"); overWhy(why); document.querySelector("#over-t").classList.toggle("win", win);
  finalScore(S.score); bestScore(r.best); newBestEl.hidden = !r.isNew; shell.show("over"); onOver(win);
}
function strike(why, from) {
  if (S.inv > 0) return;
  S.inv = 1.6; S.hands = false; handsEl.hidden = true;
  if (!params.god) S.strikes++;
  strikeEls.forEach((el, i) => el.classList.toggle("gone", i < S.strikes));
  if (from) { const dx = H.x - from.x, dz = H.z - from.z, L = Math.hypot(dx, dz) || 1; H.vx = (dx / L) * 12; H.vz = (dz / L) * 12; }
  onStrike(why);
  if (S.strikes >= STRIKES) over(why);
}

// the store as solids: axis-aligned boxes the kid runs around or climbs on (the heightfield of this island is shelving)
const solids = [];   // {x0, x1, z0, z1, h}
const addSolid = (x, z, w, d, h) => solids.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h });
function heightAt(x, z) {
  let g = 0;
  for (const b of solids) if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && H.y >= b.h - 0.4 && b.h > g) g = b.h;
  const d = Math.hypot(x - VAT.x, z - VAT.z);
  if (d < VAT.r) return -0.9;
  if (d < VAT.rim && H.y >= VAT.h - 0.4) return Math.max(g, VAT.h);
  return g;
}
function pushOut() {
  for (const b of solids) {
    if (H.y >= b.h - 0.4) continue;
    if (H.x + HERO_R <= b.x0 || H.x - HERO_R >= b.x1 || H.z + HERO_R <= b.z0 || H.z - HERO_R >= b.z1) continue;
    const px = Math.min(H.x + HERO_R - b.x0, b.x1 - (H.x - HERO_R)), pz = Math.min(H.z + HERO_R - b.z0, b.z1 - (H.z - HERO_R));
    if (px < pz) { H.x += H.x < (b.x0 + b.x1) / 2 ? -px : px; H.vx = 0; } else { H.z += H.z < (b.z0 + b.z1) / 2 ? -pz : pz; H.vz = 0; }
  }
  const dx = H.x - VAT.x, dz = H.z - VAT.z, d = Math.hypot(dx, dz);
  if (H.y < VAT.h - 0.4 && d > VAT.r && d < VAT.rim + HERO_R) { H.x = VAT.x + (dx / d) * (VAT.rim + HERO_R); H.z = VAT.z + (dz / d) * (VAT.rim + HERO_R); }
  H.x = M.clamp(H.x, -21.3, 21.3); H.z = M.clamp(H.z, -25.3, 41);
}
const jumper = body({ gravity: -28, jumpV: 11, coyote: 0.1, buffer: 0.12, cut: 0.5, ground: heightAt });
const fwd = { x: 0, z: -1 };
function run(dt) {
  // camera-relative: stick up = away from the camera
  fwd.x = H.x - G.camera.position.x; fwd.z = H.z - G.camera.position.z; const L = Math.hypot(fwd.x, fwd.z) || 1; fwd.x /= L; fwd.z /= L;
  let ax = input.axis.x, ay = input.axis.y;
  if (!ax && !ay) { ax = (input.held("right") ? 1 : 0) - (input.held("left") ? 1 : 0); ay = (input.held("up") ? 1 : 0) - (input.held("down") ? 1 : 0); }
  const mag = Math.min(1, Math.hypot(ax, ay)), mx = -fwd.z * ax + fwd.x * ay, mz = fwd.x * ax + fwd.z * ay;
  const speed = S.hands ? 0 : RUN * (mag > 1 ? 1 : mag);
  const ml = Math.hypot(mx, mz) || 1;
  H.vx = M.damp(H.vx, (mx / ml) * speed, 18, dt); H.vz = M.damp(H.vz, (mz / ml) * speed, 18, dt);
  H.x += H.vx * dt; H.z += H.vz * dt;
  const jump = !S.hands && (input.pressed("jump") || input.pressed("a")), jumpHeld = input.held("jump") || input.held("a");
  const r = jumper.step(H, { jump, jumpHeld }, dt);
  if (r.jumped) onJump(); if (r.landed) onLand(r.hard);
  pushOut();
  H.run = M.damp(H.run, Math.hypot(H.vx, H.vz) / RUN, 10, dt);
  if (Math.hypot(H.vx, H.vz) > 0.6 && !S.hands) H.yaw = M.angleLerp(H.yaw, Math.atan2(H.vx, H.vz), 14, dt);
  if (H.y < -0.3) { const dx = H.x - VAT.x, dz = H.z - VAT.z, d = Math.hypot(dx, dz) || 1; onSplash();
    H.x = VAT.x + (dx / d) * (VAT.rim + 1.2); H.z = VAT.z + (dz / d) * (VAT.rim + 1.2); H.y = 0.2; jumper.vel.y = 6; strike("the sharks nibbled your toes!"); }
}
function action(dt) {
  const dv = Math.hypot(H.x - VAT.x, H.z - VAT.z), atVat = dv > VAT.r && dv < VAT.rim + 2.4 && H.y < VAT.h + 0.5;
  const held = input.held("action") || input.held("b"), pressed = input.pressed("action") || input.pressed("b");
  // the arcade machine: run up, push the button, FART
  S.fartCool -= dt;
  if (pressed && Math.hypot(H.x - ARCADE.x, H.z - ARCADE.z) < ARCADE.r && S.fartCool <= 0) { S.fartCool = 0.45; S.score += 50; fart(); }
  // the tank: hold to stick your hands in; the sharks come, the points tick, the owner had better not see you
  const want = held && atVat;
  if (want && !S.hands) { S.hands = true; S.dunkT = 0; S.frenzy = false; handsEl.hidden = false; H.yaw = Math.atan2(VAT.x - H.x, VAT.z - H.z); onDunk(); }
  if (!want && S.hands) { S.hands = false; handsEl.hidden = true; }
  if (S.hands) {
    S.dunkT += dt;
    const swarm = sharks.reduce((n, s) => n + (s.mode === "swarm" ? 1 : 0), 0);
    if (Math.floor(S.dunkT * 2) !== Math.floor((S.dunkT - dt) * 2) && swarm > 0) { S.score += 5 * swarm; onTick(swarm); }
    if (swarm >= sharks.length && !S.frenzy) { S.frenzy = true; S.score += 100; onFrenzy(); }
  }
  // grabbing toys: walk into one, or GRAB within reach
  for (const t of toys) {
    if (t.found || !t.group.visible) continue;
    const d = Math.hypot(t.x - H.x, t.z - H.z);
    if (d < HERO_R + 0.9 || (pressed && d < REACH + 0.6)) grab(t);
  }
}
function grab(t) {
  t.found = true; t.group.visible = false; S.found++; S.score += 100; hudToys(S.found);
  if (t.zone === "front") S.foundFront++;
  onGrab(t);
  if (!S.gate && S.foundFront >= toys.filter((x) => x.zone === "front").length) { openGate(false); S.stage = "back"; onGate(); }
  if (S.found >= toys.length) { S.score += 500; startClosing(); }
}
function owner(dt) {
  // the store owner patrols a loop, looks where he walks, and only cares about kids with their hands in the tank
  const dx = H.x - O.x, dz = H.z - O.z, d = Math.hypot(dx, dz), fx = Math.sin(O.yaw), fz = Math.cos(O.yaw);
  const sees = d < OWNER.see && (dx * fx + dz * fz) / (d || 1) > OWNER.seeCos && (S.screen === "play");
  O.seen = sees && S.hands; O.cool -= dt; O.t += dt;
  const goTo = (x, z, sp) => { const ex = x - O.x, ez = z - O.z, L = Math.hypot(ex, ez); if (L < 0.3) return true;
    O.x += (ex / L) * sp * dt; O.z += (ez / L) * sp * dt; O.yaw = M.angleLerp(O.yaw, Math.atan2(ex, ez), 8, dt); O.bob += sp * dt; return false; };
  if (O.mode === "guard") {   // closing time: he stands by the door and chases any kid he sees
    if (sees && O.cool <= 0 && d < OWNER.see * 0.8) { O.mode = "tell"; O.t = 0; onHey(); }
    else if (goTo(CLOSE.guard[0], CLOSE.guard[1], OWNER.curious)) O.yaw = M.angleLerp(O.yaw, Math.atan2(dx, dz), 4, dt);
  } else if (O.mode === "patrol") {
    if (O.seen && O.cool <= 0) { O.mode = "tell"; O.t = 0; onHey(); }
    else if (goTo(ROUTE[O.wp][0], ROUTE[O.wp][1], OWNER.patrol)) O.wp = (O.wp + 1) % ROUTE.length;
  } else if (O.mode === "curious") {
    if (O.seen && O.cool <= 0) { O.mode = "tell"; O.t = 0; onHey(); }
    else if (goTo(O.tx, O.tz, OWNER.curious) || O.t > 7) { O.mode = "patrol"; O.wp = nearestWp(); }
  } else if (O.mode === "tell") {
    O.yaw = M.angleLerp(O.yaw, Math.atan2(dx, dz), 10, dt);
    if (O.t >= OWNER.tell) { O.mode = "chase"; O.t = 0; }
  } else if (O.mode === "chase") {
    goTo(H.x, H.z, OWNER.chase);
    const home = S.stage === "closing" ? "guard" : "patrol";
    if (d < 1.25 && S.inv <= 0) { strike(S.stage === "closing" ? "WE ARE CLOSED, KID!" : "HEY! NO HANDS IN THE SHARK TANK!", O); O.mode = home; O.cool = 2.5; O.wp = nearestWp(); }
    else if (O.t > OWNER.chaseMax) { O.mode = home; O.cool = 1.5; O.wp = nearestWp(); }
  }
}
const nearestWp = () => ROUTE.reduce((b, p, i) => (Math.hypot(p[0] - O.x, p[1] - O.z) < Math.hypot(ROUTE[b][0] - O.x, ROUTE[b][1] - O.z) ? i : b), 0);
function fart() {
  onFart();
  if (O.mode === "patrol" || O.mode === "curious") { O.mode = "curious"; O.t = 0; O.tx = ARCADE.x + 2.6; O.tz = ARCADE.z - 0.5; }
}
function tank(dt, t) {
  // the small sharks circle the tank; with hands in, they peel off one by one to the hand
  const hx = VAT.x + Math.sin(Math.atan2(H.x - VAT.x, H.z - VAT.z)) * (VAT.r - 0.6), hz = VAT.z + Math.cos(Math.atan2(H.x - VAT.x, H.z - VAT.z)) * (VAT.r - 0.6);
  sharks.forEach((s, i) => {
    if (S.hands && S.dunkT > 0.35 + i * 0.55) s.mode = "swarm"; else if (!S.hands) s.mode = "circle";
    if (s.mode === "circle") { s.a += s.w * dt; s.r = M.damp(s.r, s.r0, 2, dt); s.x = VAT.x + Math.cos(s.a) * s.r; s.z = VAT.z + Math.sin(s.a) * s.r; s.yaw = -s.a; }
    else { s.a += (s.w * 3.2) * dt; const rr = 0.9 + (i % 3) * 0.35; const tx = hx + Math.cos(s.a) * rr, tz = hz + Math.sin(s.a) * rr;
      s.x = M.damp(s.x, tx, 6, dt); s.z = M.damp(s.z, tz, 6, dt); s.yaw = -s.a; }
    s.y = -0.35 + Math.sin(t * 2.2 + i) * 0.08;
  });
}

function step(dt, t) {
  if (S.screen !== "play") {
    if (input.pressed("start") && shell.canAccept()) start();
    else { attract(dt, t); rig.orbit({ x: 0, y: 3.5, z: 30 }, { radius: 23, height: 8.5, speed: 0.12, k: 2.5 }); }
  }
  if (S.screen === "play") {
    S.t += dt; S.inv -= dt;
    run(dt); action(dt); owner(dt); climax(dt);
    rig.follow(heroObj, { back: 9.5, up: 5, lookUp: 1.2, lookAhead: 1.5, yawFollow: false, k: 5 });
  }
  tank(dt, t); banner(dt);
  hudScore(S.score);
  art(dt, t);
  rig.update(dt, t);
}
function attract(dt, t) {   // on the title the kid jogs in front of the jaws and the owner keeps his patrol
  H.x = Math.sin(t * 0.6) * 5; H.z = 33 + Math.cos(t * 0.6) * 1.5; H.y = 0; H.yaw = Math.atan2(Math.cos(t * 0.6) * 5, -Math.sin(t * 0.6) * 1.5); H.run = M.damp(H.run, 0.6, 5, dt);
  O.bob += OWNER.patrol * dt; const p = ROUTE[O.wp]; const ex = p[0] - O.x, ez = p[1] - O.z, L = Math.hypot(ex, ez);
  if (L < 0.3) O.wp = (O.wp + 1) % ROUTE.length; else { O.x += (ex / L) * OWNER.patrol * dt; O.z += (ez / L) * OWNER.patrol * dt; O.yaw = M.angleLerp(O.yaw, Math.atan2(ex, ez), 8, dt); }
}
const snapshot = () => ({
  screen: S.screen, stage: S.stage, score: S.score, best: record.get(), strikes: S.strikes, found: S.found, zone: S.stage, hands: S.hands,
  owner: O.mode, gate: S.gate, won: S.won, closeT: +S.closeT.toFixed(1), entities: sharks.length + toys.filter((x) => !x.found).length + 1,
  focus: { x: +H.x.toFixed(3), y: +H.y.toFixed(3), z: +H.z.toFixed(3) },
});
const commands = {
  die: () => over("the owner marched you out the shark's mouth!"),
  at: (stage) => { if (ACTS.includes(String(stage))) S.startStage = String(stage); },
};

// ── ART ──
// Big Blue Boardwalk: a Wind-Waker camera inside a beach souvenir store. Toon 3-step ramp, 3 px navy ink hulls (never black),
// a store-ceiling sky dome fogging into the wall blue, bloom only on the toy beacons. Every prop is a merged, vertex-coloured
// geometry (one draw call + one ink hull) built from the real store: the 50-foot shark, the rope fence, the red chairs,
// the shark-silhouette pavement, the pylon sign, the tank with its rock waterfall and its PARENTS PLEASE WATCH sign.
const [INK, BLUE, SUN, RED, SAND] = PALETTE;
const T = { belly: "#fbfaf5", mouth: "#5a1420", tooth: "#ffffff", eye: "#111111", skin: "#f1c27d", khaki: "#d9c39a", hair: "#4a2c1a",
  shelf: "#e8e2d5", shelfEnd: "#2f8fd6", rope: "#e7c96a", post: "#5a3a22", mulch: "#7a2e1e", asphalt: "#6d7079", pad: "#2a7fc4",
  rock: "#7d7f86", rockDark: "#55575e", water: "#39b6e8", shallow: "#8fe3ff", foam: "#ffffff", sharkGrey: "#8fa3b5", sharkBelly: "#e9eef2",
  cabinet: "#20a39e", cabinetDark: "#123f4a", button: "#e63946", green: "#8ac926", purple: "#8e44ad", orange: "#ff7f11", pink: "#ff5da2",
  teal: "#2ec4b6", black: "#222222", glass: "#bfe7ff" };
const MERCH = [RED, SUN, T.teal, T.purple, T.green, T.orange, T.pink, SAND, BLUE, "#ffffff"];
const scene = G.scene, inkOpt = { px: 3, color: INK };
let sharkBody = null, sharkHead = null;
const V3 = (a) => new THREE.Vector3(...a), _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _c = new THREE.Color();
function weld(bits) {   // [hex, geometry, pos, rot, scale] → one vertex-coloured BufferGeometry
  const out = bits.map(([hex, g, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]]) => {
    const q = (g.index ? g.toNonIndexed() : g.clone());
    for (const k of Object.keys(q.attributes)) if (k !== "position" && k !== "normal") q.deleteAttribute(k);
    q.applyMatrix4(_m4.compose(V3(p), _q.setFromEuler(_e.set(...r)), V3(s)));
    _c.set(hex); const n = q.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
    q.setAttribute("color", new THREE.BufferAttribute(col, 3)); return q;
  });
  return mergeGeometries(out);
}
const toonV = () => { const m = mat.toon("#ffffff", { steps: 3 }); m.vertexColors = true; return m; };
const propMat = toonV(), propMatDS = toonV(); propMatDS.side = THREE.DoubleSide;
const prop = (bits, pos = [0, 0, 0], parent = scene, opt = {}) => part(weld(bits), opt.ds ? propMatDS : propMat, pos, parent, { ink: inkOpt, ...opt });

// the store's light: a skylit ceiling (top navy → wall blue), warm sun, linear fog into the wall colour
const sky = skyDome(scene, { top: "#1b3a6b", horizon: "#78c4f0", bottom: "#d9ecf7", fog: { mode: "linear-horizon", near: 34, far: 110 } });
const light = lights(scene, { preset: "hemi+sun", sky: "#e6f4ff", ground: "#7fa2c4", sun: "#fff3d9", sunIntensity: 1.9, hemiIntensity: 1.15 });

// floors: blue-and-white checker tile inside, grey asphalt with the painted blue pad and white shark silhouettes outside
const tileTex = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = SAND; g.fillRect(0, 0, w, h); g.fillStyle = "#9fd0f0"; g.fillRect(0, 0, w / 2, h / 2); g.fillRect(w / 2, h / 2, w / 2, h / 2);
  g.strokeStyle = "#6fa9d0"; g.lineWidth = 4; g.strokeRect(0, 0, w / 2, h / 2); g.strokeRect(w / 2, h / 2, w / 2, h / 2); g.strokeRect(w / 2, 0, w / 2, h / 2); g.strokeRect(0, h / 2, w / 2, h / 2);
}, { repeat: [11, 13] });
const lotTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = T.asphalt; g.fillRect(0, 0, w, h);
  g.fillStyle = T.pad; g.fillRect(0, 0, w, h * 0.45);
  g.fillStyle = "#ffffff"; for (let i = 0; i < 3; i++) g.fillRect(20 + i * 80, h * 0.6, 8, h * 0.4);
  g.fillStyle = "#ffffff"; g.beginPath(); g.moveTo(40, 60); g.quadraticCurveTo(120, 20, 200, 60); g.lineTo(230, 40); g.lineTo(220, 75); g.quadraticCurveTo(140, 100, 60, 80); g.lineTo(90, 30); g.closePath(); g.fill();
}, { repeat: [3, 1] });
const floorMat = mat.toon("#ffffff"); floorMat.map = tileTex;
const lotMat = mat.toon("#ffffff"); lotMat.map = lotTex;
part(new THREE.PlaneGeometry(44, 52).rotateX(-Math.PI / 2), floorMat, [0, 0, -2], scene);
part(new THREE.PlaneGeometry(72, 20).rotateX(-Math.PI / 2), lotMat, [0, -0.01, 34], scene);
part(new THREE.PlaneGeometry(200, 120).rotateX(-Math.PI / 2), mat.toon("#6f9b5c"), [0, -0.05, 84], scene);   // the grass beyond the lot

// walls + the glass curtain-wall front with its diagonal-glazing peak over the mouth
const wallMat = mat.toon("#ffffff"); wallMat.vertexColors = true;
{
  const wall = [];
  wall.push(["#3f8fcf", geo.box(1, 8, 52), [-22.5, 4, -2]], ["#3f8fcf", geo.box(1, 8, 52), [22.5, 4, -2]], ["#3f8fcf", geo.box(46, 8, 1), [0, 4, -26.5]]);
  wall.push(["#ffffff", geo.box(0.3, 0.5, 52), [-22.4, 5.5, -2]], ["#ffffff", geo.box(0.3, 0.5, 52), [22.4, 5.5, -2]], ["#ffffff", geo.box(46, 0.5, 0.3), [0, 5.5, -26.4]]);
  wall.push([T.glass, geo.box(46, 1.2, 1), [0, 8.6, 24]]);
  const glassMat = mat.unlit(T.glass, { transparent: true, opacity: 0.22 });
  part(new THREE.PlaneGeometry(15.6, 8), glassMat, [-11.8, 4, 24.5], scene); part(new THREE.PlaneGeometry(15.6, 8), glassMat, [11.8, 4, 24.5], scene);
  for (const x of [-18, -14, -10, -6, 6, 10, 14, 18]) wall.push(["#ffffff", geo.box(0.22, 8, 1.1), [x, 4, 24]]);
  for (const y of [2, 4.5, 7]) wall.push(["#ffffff", geo.box(15.6, 0.16, 1.1), [-11.8, y, 24]], ["#ffffff", geo.box(15.6, 0.16, 1.1), [11.8, y, 24]]);
  wall.push(["#ffffff", geo.cone(6.5, 6, 4), [0, 12, 24], [0, Math.PI / 4, 0], [1, 1, 0.25]]);   // the glazing peak over the jaws
  wall.push(["#1f3d6b", geo.box(46, 0.5, 51), [0, 9.4, -1.5]]);   // the ceiling slab, well above the camera
  part(weld(wall), wallMat, [0, 0, 0], scene);
  addSolid(-22.4, -2, 1.4, 52, 8); addSolid(22.4, -2, 1.4, 52, 8); addSolid(0, -26.4, 46, 1.4, 8);
  addSolid(-11.8, 24, 15.8, 1.4, 8); addSolid(11.8, 24, 15.8, 1.4, 8);
}

// THE SHARK: 50 feet of blue fiberglass lying along the storefront, its open jaws around the door (upper jaw torus, teeth, the maroon mouth)
{
  const s = [];
  const bodyProfile = [[0, 0], [2.6, 0.8], [3.6, 3], [3.9, 7], [3.5, 12], [2.6, 17], [1.5, 21], [0.9, 24], [0, 25]].map(([r, y]) => [r, y]);
  const b = [];
  b.push([BLUE, geo.lathe(bodyProfile, 22), [-3.5, 3.4, 27.5], [0, 0, Math.PI / 2], [1, 1, 1]]);            // the body runs west along the wall
  b.push([BLUE, geo.extrude("M0 0 L3 0 L1.4 5.2 Z", 0.5, { bevel: 0.05 }), [-13, 6.6, 27.4], [0, Math.PI / 2, 0]]);   // dorsal fin
  b.push([BLUE, geo.extrude("M0 0 L2.6 4.4 L1.6 4.6 L0.4 1.4 L-1.2 4 L-2.2 3.6 Z", 0.5, { bevel: 0.05 }), [-27.8, 3.2, 27.5], [0, Math.PI / 2, 0]]);   // tail
  b.push([BLUE, geo.extrude("M0 0 L4.2 -1.2 L4.6 -0.4 L1.2 1.4 Z", 0.4, { bevel: 0.05 }), [-8, 2.2, 30.5], [-0.3, 0, 0]]);   // pectoral fin
  s.push([BLUE, geo.sphere(1, 24), [0, 9.2, 27.5], [0, 0, 0], [5.4, 3.3, 5.6]]);      // the skull over the jaws
  s.push([BLUE, geo.sphere(1, 20), [0, 8, 31.6], [0, 0, 0], [3.2, 2.2, 2.6]]);        // snout
  s.push([T.belly, geo.torus(4.8, 1.35), [0, 3.5, 27.6], [0, 0, 0]]);                // the open jaws are a white-lipped arch
  s.push([T.mouth, geo.torus(4.8, 1.0), [0, 3.5, 26.2], [0, 0, 0]]);                 // maroon inside the lips
  for (let i = 0; i < 9; i++) { const a = Math.PI * (0.12 + (i / 8) * 0.76), x = Math.cos(a) * 4.2, y = 3.5 + Math.sin(a) * 4.2;
    s.push([T.tooth, geo.cone(0.34, 1.1, 6), [x, y - 0.3, 27.9], [Math.PI, 0, 0]]); }
  for (let i = 0; i < 7; i++) { const x = -3.9 + i * 1.3; s.push([T.tooth, geo.cone(0.3, 0.8, 6), [x, 0.35, 28.3]]); }
  s.push([T.eye, geo.sphere(0.55, 12), [-4.6, 9.6, 30.2]], [T.eye, geo.sphere(0.55, 12), [4.6, 9.6, 30.2]]);
  s.push(["#ffffff", geo.sphere(0.18, 8), [-4.4, 9.8, 30.7]], ["#ffffff", geo.sphere(0.18, 8), [4.8, 9.8, 30.7]]);
  for (let i = 0; i < 4; i++) b.push([INK, geo.box(0.12, 1.6, 0.3), [-8.5 - i * 0.7, 4.2, 30.8]]);   // gill slits
  sharkHead = prop(s, [0, 0, 0], scene, { ds: true }); sharkBody = prop(b, [0, 0, 0], scene, { ds: true });
  addSolid(-4.9, 26.8, 1.6, 3, 5); addSolid(4.9, 26.8, 1.6, 3, 5);
}
// the parking lot from the photo: red mulch bed, yellow rope on posts, two red Adirondack chairs, the pylon sign, a flagpole
{
  const p = [];
  p.push([T.mulch, geo.box(30, 0.16, 5), [-14, 0.06, 29.5]]);
  for (let i = 0; i < 8; i++) { const x = -30 + i * 4.2; p.push([T.post, geo.cyl(0.14, 0.16, 1.1, 8), [x, 0.55, 32.4]]);
    if (i < 7) p.push([T.rope, geo.cyl(0.07, 0.07, 4.2, 6), [x + 2.1, 0.85, 32.4], [0, 0, Math.PI / 2]]); }
  for (const cx of [-7.5, 7.5]) { p.push([RED, geo.box(1.6, 0.14, 1.4), [cx, 0.55, 30.8]], [RED, geo.box(1.6, 1.6, 0.14), [cx, 1.3, 30.1], [-0.25, 0, 0]],
    [RED, geo.box(0.12, 0.55, 1.4), [cx - 0.75, 0.27, 30.8]], [RED, geo.box(0.12, 0.55, 1.4), [cx + 0.75, 0.27, 30.8]], [RED, geo.box(0.16, 0.16, 1.4), [cx - 0.8, 0.9, 30.8]], [RED, geo.box(0.16, 0.16, 1.4), [cx + 0.8, 0.9, 30.8]]); }
  p.push(["#ffffff", geo.cyl(0.08, 0.1, 9, 8), [-24, 4.5, 33]], [RED, geo.box(0.06, 1, 1.6), [-24, 8.4, 33.8]], ["#ffffff", geo.box(0.06, 0.35, 1.6), [-24, 8.4, 33.8]]);
  prop(p);
  const signTex = canvasTex(256, 384, (g, w, h) => {
    g.fillStyle = "#4aa9e8"; g.fillRect(0, 0, w, h); g.fillStyle = "#ffffff"; g.fillRect(12, 12, w - 24, 150);
    g.fillStyle = RED; g.font = "900 78px sans-serif"; g.textAlign = "center"; g.fillText("JAWS", w / 2, 90); g.font = "900 30px sans-serif"; g.fillText("RESORT WEAR", w / 2, 140);
    g.fillStyle = "#ffffff"; g.beginPath(); g.ellipse(w / 2, 215, 105, 42, 0, 0, 7); g.fill(); g.fillStyle = RED; g.font = "900 40px sans-serif"; g.fillText("LIVE SHARKS", w / 2, 229);
    g.fillStyle = "#ffffff"; g.fillRect(12, 268, w - 24, 104); g.fillStyle = INK; g.font = "700 22px sans-serif";
    ["MB HOODIES", "BUY 1 GET 1 FREE", "SHARK TOOTH", "NECKLACE $1.99"].forEach((l, i) => g.fillText(l, w / 2, 294 + i * 24));
  });
  const signMat = mat.toon("#ffffff"); signMat.map = signTex;
  part(geo.cyl(0.3, 0.35, 7, 8), mat.toon("#4aa9e8"), [22, 3.5, 40], scene, { ink: inkOpt });
  part(geo.box(5.2, 7.8, 0.4), signMat, [22, 9, 40], scene, { ink: inkOpt });
  const back = mat.toon("#4aa9e8"); part(geo.box(5.0, 7.6, 0.2), back, [22, 9, 40.31]);
}

// the shelving: front and back halves, each one merged geometry of gondolas stacked with folded towels, hoodies, boogie boards
function gondola(bits, x, z, len, seed) {
  const r = (n) => { seed = (seed * 9301 + 49297) % 233280; return (seed / 233280) * n; };
  bits.push([T.shelf, geo.box(1.5, 1.9, len), [x, 0.95, z]], [T.shelfEnd, geo.box(1.7, 2.0, 0.3), [x, 1, z - len / 2]], [T.shelfEnd, geo.box(1.7, 2.0, 0.3), [x, 1, z + len / 2]]);
  for (const side of [-1, 1]) for (const lvl of [0.55, 1.15, 1.75]) for (let k = 0; k < len / 1.05; k++) {
    const kind = r(3) | 0, c = MERCH[r(MERCH.length) | 0], zz = z - len / 2 + 0.6 + k * 1.05;
    if (kind === 0) bits.push([c, geo.box(0.5, 0.42, 0.85), [x + side * 0.85, lvl - 0.1, zz]]);
    else if (kind === 1) bits.push([c, geo.box(0.36, 0.5, 0.9), [x + side * 0.9, lvl - 0.05, zz]]);
    else bits.push([c, geo.cyl(0.2, 0.2, 0.7, 8), [x + side * 0.85, lvl - 0.05, zz], [Math.PI / 2, 0, 0]]);
  }
  addSolid(x, z, 1.5, len, 1.9);
}
function rack(bits, x, z, n, seed, alongX) {   // slatwall of hanging tees and towels along a wall
  for (let k = 0; k < n; k++) { const c = MERCH[(seed + k * 7) % MERCH.length], px = alongX ? x + k * 1.2 : x, pz = alongX ? z : z + k * 1.2;
    bits.push([c, geo.box(alongX ? 0.9 : 0.12, 1.1, alongX ? 0.12 : 0.9), [px, 2.9 + (k % 2) * 0.5, pz]], ["#ffffff", geo.box(alongX ? 0.5 : 0.08, 0.08, alongX ? 0.08 : 0.5), [px, 3.5 + (k % 2) * 0.5, pz]]); }
}
{
  const f = [], b = [];
  for (const x of [-16, -9, 9, 16]) gondola(f, x, 14, 12, 11 + x);
  for (const x of [-16, -9, 9, 16]) gondola(b, x, -18, 12, 31 + x);
  rack(f, -21.6, 0, 18, 3, false); rack(f, 21.6, 0, 18, 5, false); rack(b, -20, -25.6, 34, 2, true);
  prop(f); prop(b);
}
// pennant strings across the ceiling, so something colourful always passes over the camera
{
  const fl = [], tri = geo.extrude("M0 0 L0.5 0 L0.25 -0.7 Z", 0.03);
  for (const x of [-12.5, 0, 12.5]) for (let z = -24; z < 23; z += 1.1) fl.push([MERCH[((z + 24) / 1.1 | 0) % MERCH.length], tri, [x - 0.25, 6.6 + Math.sin(z * 0.4) * 0.25, z], [0, Math.PI / 2, 0]]);
  for (const x of [-12.5, 0, 12.5]) fl.push([INK, geo.cyl(0.03, 0.03, 48, 4), [x, 6.65, -0.5], [Math.PI / 2, 0, 0]]);
  part(weld(fl), propMatDS, [0, 0, 0], scene);
}

// THE TANK: a round 5,000-gallon vat with a rock rim, a faux-rock waterfall wall behind it, and the PARENTS PLEASE WATCH sign
const vat = new THREE.Group(); vat.position.set(VAT.x, 0, VAT.z); scene.add(vat);
{
  const r = [];
  r.push([T.rock, geo.lathe([[VAT.r, 0], [VAT.rim + 0.3, 0], [VAT.rim, VAT.h], [VAT.r, VAT.h], [VAT.r, 0]], 28), [0, 0, 0]]);
  r.push(["#1d6fa8", geo.cyl(VAT.r + 0.05, VAT.r + 0.05, 0.12, 28), [0, 0.1, 0]]);   // the tank floor, deep blue
  for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2, rr = VAT.rim - 0.15; r.push([i % 2 ? T.rock : T.rockDark, deform(geo.sphere(0.5, 8), { amount: 0.18, scale: 2, seed: i }), [Math.cos(a) * rr, VAT.h + 0.1, Math.sin(a) * rr], [0, a, 0], [1.1, 0.7, 0.9]]); }
  for (let i = 0; i < 7; i++) r.push([i % 2 ? T.rockDark : T.rock, deform(geo.sphere(1, 10), { amount: 0.25, scale: 1.5, seed: 20 + i }), [-3.3 + i * 1.1, 1.2 + (i % 3) * 0.9, -5.6 - (i % 2) * 0.5], [0, i, 0], [1.2, 1 + (i % 2) * 0.6, 1]]);
  r.push([T.shallow, geo.box(1.1, 2.6, 0.3), [-0.3, 2.3, -5.3]]);   // the waterfall sheet
  r.push([T.sharkGrey, geo.lathe([[0, 0], [0.5, 0.3], [0.7, 1.4], [0.5, 2.6], [0.2, 3.2], [0, 3.4]], 12), [-2.6, 1.6, -4.4], [0.3, 0, 0.5]]);   // Duato's concrete shark sculpture
  r.push([T.sharkGrey, geo.lathe([[0, 0], [0.5, 0.3], [0.7, 1.4], [0.5, 2.6], [0.2, 3.2], [0, 3.4]], 12), [-1.4, 1.2, -4.6], [-0.4, 0, -0.6]]);
  prop(r, [0, 0, 0], vat, { ds: true });
  const water = new THREE.Mesh(new THREE.CircleGeometry(VAT.r + 0.1, 40).rotateX(-Math.PI / 2),
    waterMat({ deep: T.water, shallow: T.shallow, foam: T.foam, scale: 0.35, speed: 0.7, shore: 0.1, roughness: 0.3 }));
  water.position.y = VAT.h - 0.35; vat.add(water);
  const signTex = canvasTex(256, 192, (g, w, h) => {
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h); g.strokeStyle = RED; g.lineWidth = 8; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = RED; g.textAlign = "center"; g.font = "900 34px sans-serif"; g.fillText("PARENTS", w / 2, 50);
    g.font = "700 22px sans-serif"; ["PLEASE WATCH", "YOUR CHILDREN", "AROUND THE", "SHARK TANK"].forEach((l, i) => g.fillText(l, w / 2, 84 + i * 26));
  });
  const signMat = mat.toon("#ffffff"); signMat.map = signTex;
  part(geo.box(2.2, 1.65, 0.1), signMat, [-2.1, 2.9, -3.6], vat, { ink: inkOpt });
  part(geo.box(2.0, 1.5, 0.06), mat.toon("#dddddd"), [-2.1, 2.9, -3.66], vat);
  addSolid(0, -3.4, 8, 2.2, 3);   // the rock wall is solid
}
{ // LIVE SHARKS oval over the tank, and Bella the iguana's terrarium in the back-right corner (both on the real store's sign)
  const ovalTex = canvasTex(256, 128, (g, w, h) => { g.fillStyle = "#4aa9e8"; g.fillRect(0, 0, w, h); g.fillStyle = "#ffffff"; g.beginPath(); g.ellipse(w / 2, h / 2, 120, 56, 0, 0, 7); g.fill();
    g.fillStyle = RED; g.textAlign = "center"; g.font = "900 44px sans-serif"; g.fillText("LIVE SHARKS", w / 2, h / 2 + 16); });
  const om = mat.toon("#ffffff"); om.map = ovalTex; part(geo.box(4.4, 2.2, 0.12), om, [0, 5.6, -5.4], vat, { ink: inkOpt });
  part(geo.cyl(0.04, 0.04, 3.2, 4), mat.toon(INK), [0, 8.0, -5.4], vat);
  const ig = []; ig.push([T.rockDark, geo.box(3.2, 0.5, 1.8), [0, 0.25, 0]], [T.rockDark, geo.box(3.2, 0.12, 1.8), [0, 2.1, 0]]);
  for (const [x, z] of [[-1.55, -0.85], [1.55, -0.85], [-1.55, 0.85], [1.55, 0.85]]) ig.push([INK, geo.box(0.1, 1.7, 0.1), [x, 1.2, z]]);
  ig.push(["#6b4a2b", geo.cyl(0.14, 0.18, 1.6, 6), [0.6, 0.9, 0.2], [0, 0, 0.9]]);   // her branch
  ig.push([T.green, geo.lathe([[0, 0], [0.16, 0.1], [0.22, 0.5], [0.2, 0.9], [0.1, 1.3], [0.05, 1.9], [0, 2.2]], 10), [-0.9, 0.9, 0.1], [0, 0, -Math.PI / 2 + 0.2]],
    [T.green, geo.sphere(0.2, 10), [0.35, 1.05, 0.1], [0, 0, 0], [1.3, 0.8, 1]], [T.eye, geo.sphere(0.05, 6), [0.5, 1.12, 0.22]], [T.eye, geo.sphere(0.05, 6), [0.5, 1.12, -0.02]]);
  for (let i = 0; i < 6; i++) ig.push(["#4c8c2a", geo.cone(0.05, 0.16, 4), [0.2 - i * 0.22, 1.3, 0.1]]);   // her spines
  for (const [x, z] of [[0.15, 0.3], [0.15, -0.1], [-0.55, 0.3], [-0.55, -0.1]]) ig.push([T.green, geo.capsule(0.05, 0.25), [x, 0.75, z], [0.6, 0, 0]]);
  const terr = new THREE.Group(); terr.position.set(19.5, 0, -22.5); terr.rotation.y = -Math.PI / 2; scene.add(terr); prop(ig, [0, 0, 0], terr);
  const glass2 = mat.unlit(T.glass, { transparent: true, opacity: 0.2 }); part(new THREE.PlaneGeometry(3.1, 1.6), glass2, [0, 1.2, 0.91], terr);
  const bt = canvasTex(256, 96, (g, w, h) => { g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h); g.fillStyle = T.green; g.textAlign = "center"; g.font = "900 40px sans-serif"; g.fillText("BELLA", w / 2, 42); g.fillStyle = INK; g.font = "700 26px sans-serif"; g.fillText("the friendly iguana", w / 2, 78); });
  const bm = mat.toon("#ffffff"); bm.map = bt; part(geo.box(2.4, 0.9, 0.08), bm, [0, 2.8, 0.2], terr, { ink: inkOpt });
  addSolid(19.5, -22.5, 1.9, 3.3, 2.2);
}
// the small sharks: nurse and bamboo sharks, one instanced geometry with its own ink hull
const sharkGeo = weld([[T.sharkGrey, geo.lathe([[0, 0], [0.22, 0.25], [0.3, 0.7], [0.24, 1.3], [0.1, 1.7], [0, 1.85]], 10), [0, 0, 0], [Math.PI / 2, 0, 0]],
  [T.sharkBelly, geo.lathe([[0, 0], [0.2, 0.25], [0.27, 0.7], [0.2, 1.3], [0, 1.6]], 10), [0, -0.08, 0.05], [Math.PI / 2, 0, 0]],
  [T.sharkGrey, geo.extrude("M0 0 L0.5 0 L0.15 0.45 Z", 0.06), [-0.03, 0.2, 0.5], [0, Math.PI / 2, 0]],
  [T.sharkGrey, geo.extrude("M0 0 L0.35 0.55 L0.2 0.6 L0 0.2 L-0.25 0.5 L-0.35 0.45 Z", 0.05), [-0.02, 0.05, 1.75], [0, Math.PI / 2, 0], [0.8, 0.8, 0.8]],
  [T.sharkGrey, geo.extrude("M0 0 L0.55 -0.25 L0.5 -0.05 Z", 0.05), [0.25, -0.05, 0.7], [Math.PI / 2, 0, 0]],
  [T.sharkGrey, geo.extrude("M0 0 L-0.55 -0.25 L-0.5 -0.05 Z", 0.05), [-0.25, -0.05, 0.7], [Math.PI / 2, 0, 0]],
  [T.eye, geo.sphere(0.05, 6), [0.16, 0.1, 0.35]], [T.eye, geo.sphere(0.05, 6), [-0.16, 0.1, 0.35]]]);
sharkGeo.rotateY(Math.PI);   // built nose at +z; rotY = -angle then faces along the circle
const sharkPool = new InstancedPool(vat, sharkGeo, propMat, { max: 8, ink: { color: INK, px: 2 }, cull: false });
const sharks = Array.from({ length: 6 }, (_, i) => ({ id: 0, a: (i / 6) * Math.PI * 2, r0: 1.6 + (i % 3) * 0.8, r: 1.6 + (i % 3) * 0.8, w: 0.7 + (i % 2) * 0.25, x: 0, y: -0.35, z: 0, yaw: 0, mode: "circle" }));
sharks.forEach((s) => { s.id = sharkPool.spawn({ x: VAT.x, y: 0.5, z: VAT.z, scale: 1, data: {} }); });

// THE ARCADE MACHINE: a teal cabinet with a marquee, a screen, and one big red FART button
const cabinet = new THREE.Group(); cabinet.position.set(ARCADE.x, 0, ARCADE.z); cabinet.rotation.y = Math.PI / 2; scene.add(cabinet);
{
  const c = [];
  c.push([T.cabinet, geo.box(1.6, 2.4, 1.2), [0, 1.2, 0]], [T.cabinetDark, geo.box(1.7, 0.6, 1.3), [0, 2.55, 0]], [SUN, geo.box(1.4, 0.4, 0.05), [0, 2.55, 0.68]]);
  c.push([T.cabinetDark, geo.box(1.3, 0.9, 0.06), [0, 1.75, 0.63]], [T.green, geo.box(1.1, 0.7, 0.04), [0, 1.75, 0.66]]);
  c.push([T.cabinetDark, geo.box(1.6, 0.35, 0.7), [0, 1.15, 0.7], [-0.5, 0, 0]]);
  prop(c, [0, 0, 0], cabinet);
  const btn = part(geo.cyl(0.24, 0.26, 0.16, 16), mat.toon(T.button), [0, 1.36, 0.92], cabinet, { rot: [-0.5, 0, 0], ink: inkOpt });
  cabinet.userData.btn = btn;
  addSolid(ARCADE.x, ARCADE.z, 1.3, 1.7, 2.4);
}
// the rope gate to the back of the store
const gate = new THREE.Group(); gate.position.set(0, 0, -8); scene.add(gate);
{
  const gb = [];
  for (let i = 0; i < 12; i++) { const x = -22 + i * 4; gb.push([T.post, geo.cyl(0.1, 0.12, 1.0, 8), [x, 0.5, 0]]); if (i < 11) gb.push([RED, geo.cyl(0.06, 0.06, 4, 6), [x + 2, 0.85, 0], [0, 0, Math.PI / 2]]); }
  prop(gb, [0, 0, 0], gate);
  const signTex = canvasTex(256, 128, (g, w, h) => { g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h); g.fillStyle = RED; g.textAlign = "center"; g.font = "900 44px sans-serif"; g.fillText("BACK OF STORE", w / 2, 56); g.font = "700 30px sans-serif"; g.fillText("find 4 toys first!", w / 2, 100); });
  const sm = mat.toon("#ffffff"); sm.map = signTex; part(geo.box(2.4, 1.2, 0.08), sm, [0, 1.6, 0.05], gate, { ink: inkOpt });
}
const gateSolid = { x0: -22, x1: 22, z0: -8.5, z1: -7.5, h: 1.6 };
function closeGate() { S.gate = false; gate.visible = true; if (!solids.includes(gateSolid)) solids.push(gateSolid); }
function openGate(silent) { S.gate = true; gate.visible = false; const i = solids.indexOf(gateSolid); if (i >= 0) solids.splice(i, 1); }

// THE TOYS: eight real things from the store, each a drawn model under a glowing beacon
const beaconMat = mat.hot(SAND, 1.7), ringMat = mat.hot(SUN, 1.5);
function toyGeo(kind) {
  switch (kind) {
    case "boogie": return weld([[BLUE, geo.extrude("M-0.5 0 L0.5 0 Q0.62 0.5 0.5 1.4 Q0 1.6 -0.5 1.4 Q-0.62 0.5 -0.5 0 Z", 0.08, { bevel: 0.02 }), [0, 0, 0], [0, 0, 0.15]], ["#ffffff", geo.box(0.9, 0.18, 0.1), [0, 0.6, 0.04], [0, 0, 0.15]], [SUN, geo.box(0.2, 1.2, 0.1), [0.1, 0.7, 0.05], [0, 0, 0.15]]]);
    case "tooth": return weld([[T.black, geo.torus(0.5, 0.03), [0, 0.7, 0]], ["#fff6d8", geo.extrude("M-0.22 0 L0.22 0 L0.03 -0.62 Z", 0.06, { bevel: 0.01 }), [0, 0.3, 0]], [T.khaki, geo.box(0.28, 0.08, 0.08), [0, 0.28, 0]]]);
    case "crab": return weld([[T.orange, deform(geo.lathe([[0, 0], [0.35, 0.05], [0.42, 0.3], [0.3, 0.55], [0.1, 0.7], [0, 0.72]], 12), { amount: 0.05, scale: 2, seed: 4 }), [0.1, 0.1, 0], [0.4, 0, 0.5]],
      [RED, geo.sphere(0.2, 10), [-0.25, 0.2, 0.05]], [RED, geo.capsule(0.05, 0.3), [-0.35, 0.1, 0.25], [1.2, 0, 0.4]], [RED, geo.capsule(0.05, 0.3), [-0.35, 0.1, -0.25], [-1.2, 0, 0.4]], [RED, geo.capsule(0.05, 0.25), [-0.15, 0.08, 0.35], [1.4, 0, 0]], [RED, geo.capsule(0.05, 0.25), [-0.15, 0.08, -0.35], [-1.4, 0, 0]],
      [T.eye, geo.sphere(0.05, 6), [-0.42, 0.34, 0.08]], [T.eye, geo.sphere(0.05, 6), [-0.42, 0.34, -0.08]]]);
    case "needoh": return weld([[T.green, deform(geo.sphere(0.42, 14), { amount: 0.08, scale: 1.6, seed: 9 }), [0, 0.4, 0], [0, 0, 0], [1.15, 0.8, 1.15]], [T.eye, geo.sphere(0.06, 6), [0.15, 0.5, 0.36]], [T.eye, geo.sphere(0.06, 6), [-0.15, 0.5, 0.36]]]);
    case "ball": return weld([["#ffffff", geo.sphere(0.45, 18), [0, 0.45, 0]], [RED, geo.torus(0.45, 0.06), [0, 0.45, 0], [0, 0.6, 0]], [BLUE, geo.torus(0.45, 0.06), [0, 0.45, 0], [0, 1.65, 0]], [SUN, geo.torus(0.45, 0.06), [0, 0.45, 0], [0, 2.7, 0]]]);
    case "floatie": return weld([[BLUE, geo.torus(0.5, 0.2), [0, 0.2, 0], [Math.PI / 2, 0, 0]], [BLUE, geo.lathe([[0, 0], [0.28, 0.25], [0.3, 0.6], [0, 0.9]], 10), [0, 0.35, 0.65], [-1.9, 0, 0]], [T.belly, geo.sphere(0.2, 8), [0, 0.25, 0.75]], [BLUE, geo.extrude("M0 0 L0.4 0 L0.1 0.45 Z", 0.05), [-0.03, 0.4, -0.2], [0, Math.PI / 2, 0]], [T.eye, geo.sphere(0.05, 6), [0.15, 0.5, 0.9]], [T.eye, geo.sphere(0.05, 6), [-0.15, 0.5, 0.9]]]);
    case "mega": return weld([[T.rockDark, geo.box(0.7, 0.35, 0.7), [0, 0.17, 0]], ["#3b3a3f", geo.extrude("M-0.42 0 L0.42 0 L0.05 -1.05 Z", 0.1, { bevel: 0.02 }), [0, 1.4, 0]], ["#d9cfa8", geo.box(0.86, 0.14, 0.14), [0, 1.42, 0]]]);
    default: return weld([[T.green, geo.cyl(0.11, 0.11, 1.3, 10), [0, 0.6, 0], [0, 0, Math.PI / 2]], [T.orange, geo.cyl(0.15, 0.15, 0.5, 10), [-0.2, 0.6, 0], [0, 0, Math.PI / 2]], [T.orange, geo.box(0.16, 0.34, 0.14), [0.15, 0.4, 0]], [T.green, geo.cyl(0.14, 0.14, 0.45, 10), [0.3, 0.62, 0], [0, 0, Math.PI / 2]], [T.green, geo.box(0.12, 0.28, 0.16), [-0.45, 0.4, 0]]]);
  }
}
const TOY_KINDS = [["boogie", "BOOGIE BOARD!"], ["tooth", "SHARK TOOTH NECKLACE $1.99!"], ["crab", "HERMIT CRAB!"], ["needoh", "NEEDOH SQUISHY!"],
  ["ball", "BEACH BALL!"], ["floatie", "SHARK FLOATIE!"], ["mega", "MEGALODON TOOTH!"], ["soaker", "SUPER SOAKER!"]];
const FRONT_SPOTS = [[-12.5, 9], [12.5, 19], [-4.5, 20.5], [5, 8], [-20, 12], [20, 16], [12.5, 9], [-12.5, 19]];
const BACK_SPOTS = [[-12.5, -14], [12.5, -23], [0, -24], [-20, -11], [20, -20], [5, -12], [-12.5, -23], [12.5, -14]];
const toys = [];
{
  const kinds = M.shuffle([...TOY_KINDS]), fs = M.shuffle([...FRONT_SPOTS]).slice(0, 4), bs = M.shuffle([...BACK_SPOTS]).slice(0, 4);
  [...fs.map((p) => ["front", p]), ...bs.map((p) => ["back", p])].forEach(([zone, [x, z]], i) => {
    const [kind, name] = kinds[i], group = new THREE.Group(); group.position.set(x, 0, z); scene.add(group);
    const model = new THREE.Group(); group.add(model); part(toyGeo(kind), propMat, [0, 0.25, 0], model, { ink: inkOpt });
    const beam = part(geo.cyl(0.1, 0.16, 7, 8), beaconMat, [0, 4.2, 0], group), ring = part(geo.torus(0.7, 0.06), ringMat, [0, 0.9, 0], group, { rot: [Math.PI / 2, 0, 0] });
    toys.push({ kind, name, zone, x, z, group, model, beam, ring, found: false, ph: i * 0.8 });
  });
}

// THE KID: big head under a red cap, sunny yellow tee (lathe), blue shorts, swinging capsule arms with real hands, sandals
const heroObj = new THREE.Group(); heroObj.position.set(H.x, 0, H.z); scene.add(heroObj);
const pose = new THREE.Group(); heroObj.add(pose);
{
  const torso = prop([[SUN, geo.lathe([[0, 0], [0.34, 0.02], [0.4, 0.3], [0.36, 0.62], [0.12, 0.7], [0, 0.7]], 14), [0, 0.55, 0]],
    [BLUE, geo.lathe([[0, 0], [0.36, 0.02], [0.36, 0.28], [0, 0.3]], 12), [0, 0.32, 0]], [T.skin, geo.cyl(0.1, 0.12, 0.18, 8), [0, 1.24, 0]]], [0, 0, 0], pose);
  const headG = new THREE.Group(); headG.position.set(0, 1.65, 0); pose.add(headG); pose.userData.head = headG;
  prop([[T.skin, geo.sphere(0.42, 18), [0, 0, 0], [0, 0, 0], [1, 0.95, 1]], [T.hair, geo.sphere(0.43, 14), [0, 0.06, -0.06], [0, 0, 0], [1, 0.6, 1]],
    [RED, geo.sphere(0.45, 14), [0, 0.12, 0], [0, 0, 0], [1, 0.55, 1]], [RED, geo.box(0.6, 0.06, 0.4), [0, 0.12, 0.42]],
    ["#ffffff", geo.sphere(0.1, 8), [0.16, 0.02, 0.38]], ["#ffffff", geo.sphere(0.1, 8), [-0.16, 0.02, 0.38]], [T.eye, geo.sphere(0.05, 6), [0.16, 0.02, 0.46]], [T.eye, geo.sphere(0.05, 6), [-0.16, 0.02, 0.46]],
    [RED, geo.torus(0.1, 0.03), [0, -0.18, 0.4], [0.3, 0, 0], [1, 0.5, 1]]], [0, 0, 0], headG);
  const limb = (x, y, len, c, hand) => { const g = new THREE.Group(); g.position.set(x, y, 0); pose.add(g);
    prop([[c, geo.capsule(0.09, len), [0, -len / 2 - 0.05, 0]], hand ? [T.skin, geo.sphere(0.13, 10), [0, -len - 0.12, 0]] : [T.hair, geo.box(0.22, 0.08, 0.34), [0, -len - 0.12, 0.05]]], [0, 0, 0], g); return g; };
  pose.userData.arms = [limb(0.46, 1.15, 0.5, SUN, true), limb(-0.46, 1.15, 0.5, SUN, true)];
  pose.userData.legs = [limb(0.17, 0.34, 0.28, T.skin, false), limb(-0.17, 0.34, 0.28, T.skin, false)];
}
const heroShadow = blobShadow(scene, { radius: 0.55, opacity: 0.28 });
const heroHit = hitFlash(pose);

// THE OWNER: a big guy in a lifeguard-red polo, khaki shorts, sunglasses, a white visor and a mustache; his look is drawn on the floor
const ownerObj = new THREE.Group(); scene.add(ownerObj);
const opose = new THREE.Group(); ownerObj.add(opose);
{
  prop([[RED, geo.lathe([[0, 0], [0.5, 0.02], [0.58, 0.5], [0.5, 1.0], [0.16, 1.1], [0, 1.1]], 14), [0, 0.95, 0]], [T.khaki, geo.lathe([[0, 0], [0.5, 0.02], [0.5, 0.45], [0, 0.48]], 12), [0, 0.55, 0]],
    ["#ffffff", geo.box(0.5, 0.2, 0.05), [0, 1.65, 0.5]], [T.skin, geo.cyl(0.13, 0.15, 0.2, 8), [0, 2.05, 0]]], [0, 0, 0], opose);
  const headG = new THREE.Group(); headG.position.set(0, 2.5, 0); opose.add(headG); opose.userData.head = headG;
  prop([[T.skin, geo.sphere(0.4, 16), [0, 0, 0]], [T.black, geo.box(0.5, 0.12, 0.2), [0, 0.06, 0.34]], ["#ffffff", geo.box(0.9, 0.08, 0.5), [0, 0.24, 0.2]], ["#ffffff", geo.torus(0.4, 0.06), [0, 0.22, 0], [Math.PI / 2, 0, 0]],
    [T.hair, geo.box(0.34, 0.08, 0.1), [0, -0.14, 0.4]], [RED, geo.sphere(0.06, 6), [0, -0.28, 0.4]], [T.eye, geo.box(0.05, 0.3, 0.1), [0, 0.45, 0.05]]], [0, 0, 0], headG);
  const limb = (x, y, len, c, hand) => { const g = new THREE.Group(); g.position.set(x, y, 0); opose.add(g);
    prop([[c, geo.capsule(0.12, len), [0, -len / 2 - 0.05, 0]], hand ? [T.skin, geo.sphere(0.15, 10), [0, -len - 0.14, 0]] : [T.black, geo.box(0.28, 0.1, 0.42), [0, -len - 0.12, 0.06]]], [0, 0, 0], g); return g; };
  opose.userData.arms = [limb(0.7, 1.85, 0.75, T.skin, true), limb(-0.7, 1.85, 0.75, T.skin, true)];
  opose.userData.legs = [limb(0.24, 0.6, 0.5, T.skin, false), limb(-0.24, 0.6, 0.5, T.skin, false)];
}
const coneMat = mat.unlit(RED, { transparent: true, opacity: 0.16, side: THREE.DoubleSide });
const cone = new THREE.Mesh(new THREE.CircleGeometry(OWNER.see, 24, Math.PI / 2 - 0.77, 1.54).rotateX(-Math.PI / 2), coneMat);
cone.position.y = 0.04; ownerObj.add(cone);
const bang = part(geo.extrude("M-0.12 0 L0.12 0 L0.08 0.8 L-0.08 0.8 Z", 0.06), mat.hot(RED, 1.6), [0, 3.2, 0], ownerObj); bang.visible = false;
part(geo.sphere(0.12, 8), mat.hot(RED, 1.6), [0, -0.2, 0], bang);
const ownerShadow = blobShadow(scene, { radius: 0.7, opacity: 0.28 });

// this game's own responses to its events: sparks, floor rings, flashes, pops, sound
const sparks = new Sparks(scene, { colors: [SAND, SUN, T.teal], max: 500, size: 0.42, blending: "normal" });
const fartCloud = new Sparks(scene, { colors: [T.green, "#b5e48c", "#6a994e"], max: 200, size: 0.9, blending: "normal" });
const timeline = new Timeline(scene, { colors: [SUN, SAND, RED, T.teal] });
const flash = screenFlash("#flash", { color: RED });
const popEls = Array.from({ length: 12 }, () => { const b = document.createElement("b"); document.querySelector("#pops").appendChild(b); return b; });
let popI = 0; const _pv = new THREE.Vector3();
function pop(text, x, y, z, cls = "") {
  const el = popEls[popI++ % popEls.length]; _pv.set(x, y, z).project(G.camera);
  el.style.left = `${(_pv.x * 0.5 + 0.5) * G.size.w}px`; el.style.top = `${(-_pv.y * 0.5 + 0.5) * G.size.h}px`;
  el.textContent = text; el.className = cls; void el.offsetWidth; el.classList.add("go");
}
const bannerEl = document.querySelector("#banner"), bannerT = document.querySelector("#banner-t");
function showBanner(text, cls = "", sec = 1.8) { bannerT.textContent = text; bannerEl.className = cls; bannerEl.hidden = false; void bannerEl.offsetWidth; bannerEl.classList.add("go"); S.bannerT = sec; }
function banner(dt) { if (S.bannerT > 0) { S.bannerT -= dt; if (S.bannerT <= 0) bannerEl.hidden = true; } }

const sfx = defineSfx({
  fart: [{ noise: { f0: 170, f1: 60, dur: 0.6, vol: 0.55, q: 4, type: "lowpass" } }, { tone: { type: "sawtooth", f0: 92, f1: 44, dur: 0.55, vol: 0.3 } },
    { tone: { type: "square", f0: 58, f1: 36, dur: 0.4, vol: 0.14, at: 0.08 } }, { noise: { f0: 120, f1: 50, dur: 0.25, vol: 0.3, q: 6, type: "lowpass" }, at: 0.3 }],
  toy: [{ tone: { type: "sine", f0: 784, dur: 0.08, vol: 0.3 } }, { tone: { type: "sine", f0: 988, dur: 0.08, vol: 0.3 }, at: 0.08 }, { tone: { type: "sine", f0: 1319, dur: 0.18, vol: 0.3 }, at: 0.16 }, { tone: { type: "triangle", f0: 1568, dur: 0.35, vol: 0.25 }, at: 0.26 }],
  jump: { tone: { type: "triangle", f0: 300, f1: 640, dur: 0.13, vol: 0.2 } },
  land: { noise: { f0: 500, f1: 200, dur: 0.07, vol: 0.14, type: "lowpass" } },
  dunk: [{ noise: { f0: 900, f1: 350, dur: 0.3, vol: 0.35, q: 1.5 } }, { tone: { type: "sine", f0: 240, f1: 110, dur: 0.25, vol: 0.15 } }],
  tickle: { tone: { type: "sine", f0: 880, f1: 1100, dur: 0.05, vol: 0.12 } },
  frenzy: [{ noise: { f0: 2200, f1: 600, dur: 0.35, vol: 0.3 } }, { tone: { type: "square", f0: 440, f1: 880, dur: 0.3, vol: 0.2 } }, { tone: { type: "square", f0: 660, f1: 1320, dur: 0.3, vol: 0.18 }, at: 0.15 }],
  hey: [{ tone: { type: "sawtooth", f0: 330, f1: 250, dur: 0.18, vol: 0.32 } }, { tone: { type: "sawtooth", f0: 260, f1: 180, dur: 0.28, vol: 0.32 }, at: 0.2 }],
  strike: [{ tone: { type: "square", f0: 220, f1: 70, dur: 0.32, vol: 0.3 } }, { noise: { f0: 300, f1: 100, dur: 0.25, vol: 0.3, q: 1, type: "lowpass" } }],
  splash: [{ noise: { f0: 1400, f1: 300, dur: 0.45, vol: 0.4, q: 1.2 } }, { tone: { type: "square", f0: 180, f1: 120, dur: 0.07, vol: 0.15 }, at: 0.2 }, { tone: { type: "square", f0: 180, f1: 120, dur: 0.07, vol: 0.15 }, at: 0.32 }],
  gate: [{ tone: { type: "sine", f0: 523, dur: 0.1, vol: 0.3 } }, { tone: { type: "sine", f0: 659, dur: 0.1, vol: 0.3 }, at: 0.1 }, { tone: { type: "sine", f0: 784, dur: 0.1, vol: 0.3 }, at: 0.2 }, { tone: { type: "sine", f0: 1047, dur: 0.4, vol: 0.3 }, at: 0.3 }],
  bell: [{ tone: { type: "square", f0: 880, dur: 0.25, vol: 0.28 } }, { tone: { type: "square", f0: 660, dur: 0.25, vol: 0.28 }, at: 0.3 }, { tone: { type: "square", f0: 880, dur: 0.25, vol: 0.28 }, at: 0.6 }, { tone: { type: "square", f0: 660, dur: 0.5, vol: 0.28 }, at: 0.9 }],
  chomp: [{ tone: { type: "square", f0: 140, f1: 50, dur: 0.35, vol: 0.4 } }, { noise: { f0: 400, f1: 80, dur: 0.3, vol: 0.4, q: 1, type: "lowpass" } }],
  win: [{ tone: { type: "square", f0: 523, dur: 0.12, vol: 0.25 } }, { tone: { type: "square", f0: 659, dur: 0.12, vol: 0.25 }, at: 0.12 }, { tone: { type: "square", f0: 784, dur: 0.12, vol: 0.25 }, at: 0.24 }, { tone: { type: "square", f0: 1047, dur: 0.5, vol: 0.28 }, at: 0.36 }, { tone: { type: "sine", f0: 1319, dur: 0.6, vol: 0.2 }, at: 0.5 }],
}, { seed: 7 });
// the tune: a surf-rock riff in E mixolydian — "big-blue-shark, jaws-jaws-jaws, run-in-side, find-the-toys"
const TUNE = song({ bpm: 128, key: 64, scale: SCALES.mixolydian, motif: [64, 64, 67, 69, 71, 69, 67, 64, 62, 64, null, 64, 67, 69, 71, 72],
  voices: { lead: { wave: "square", env: [0.01, 0.1, 0.5, 0.15] }, bass: { wave: "triangle", env: [0.01, 0.15, 0.6, 0.1] }, drums: { kit: "toy", pattern: "k.h.s.h.k.hks.h." } }, bars: 4, seed: 3 });

function onStart() { playSong(TUNE); setIntensity(S.stage === "back" ? 1 : 0.6); showBanner(S.stage === "back" ? "BACK OF THE STORE" : "RUN IN!", "", 1.2); }
function onOver(win) { stopMusic(0.8); if (win) sfx.win(); flash.hit(win ? 0.35 : 0.5, win ? T.green : RED); rig.shake(win ? 0.2 : 0.5, 0.4); }
function onJump() { sfx.jump(); H.squash = -0.35; }
function onLand(hard) { sfx.land(); H.squash = hard ? 0.45 : 0.3; sparks.burst([H.x, H.y + 0.05, H.z], { colors: ["#cfe6f5", SAND], n: hard ? 14 : 8, speed: 3, life: 0.4, up: 1, grav: -8 }); if (hard) rig.shake(0.15, 0.2); }
function onGrab(t) {
  sfx.toy({ pitch: 1 + S.found * 0.04 }); loop.hitstop(50); rig.kick(6, 0.35);
  sparks.burst([t.x, 0.8, t.z], { colors: [SUN, SAND, T.teal, T.pink], n: 40, speed: 7, life: 0.8, up: 3, grav: -10 });
  timeline.shockwave([t.x, 0.05, t.z], { color: SUN, size: 4, dur: 0.5, flat: true });
  pop(t.name, t.x, 1.6, t.z, "toy"); pop("+100", t.x, 2.6, t.z, "");
}
function onGate() { sfx.gate(); setIntensity(1); showBanner("BACK OF THE STORE IS OPEN!", "win", 2.2); rig.shake(0.2, 0.3);
  timeline.shockwave([0, 0.05, -8], { color: T.green, size: 26, dur: 0.9, flat: true }); }
function onFart() {
  sfx.fart({ pitch: M.rand(0.8, 1.25) }); loop.hitstop(40); rig.shake(0.3, 0.25); rig.kick(-4, 0.3);
  const cx = ARCADE.x + 0.9, cz = ARCADE.z;
  for (let i = 0; i < 22; i++) fartCloud.emit(cx + M.rand(-0.4, 0.4), 1.2 + M.rand(0, 0.6), cz + M.rand(-0.5, 0.5), M.rand(-1.5, 1.5), M.rand(0.6, 1.8), M.rand(-1.5, 1.5), M.pick([T.green, "#b5e48c", "#6a994e"]), 1.4, 1.2, 0.6);
  timeline.shockwave([cx, 0.05, cz], { color: T.green, size: 3, dur: 0.45, flat: true });
  pop(M.pick(["PFFFRRT!", "BRAAAP!", "PLBBBT!", "FRRRAP!", "TOOOT!"]), cx, 2.6, cz, "fart"); pop("+50", H.x, 2.2, H.z, "");
  cabinet.userData.btn.position.y = 1.28;
}
function onDunk() { sfx.dunk(); pop("hands in!", H.x, 2.0, H.z, "shark"); }
function onTick(n) { if (throttle("tickle", 0.4)) sfx.tickle({ pitch: 1 + n * 0.1 }); pop(`+${5 * n}`, H.x, 2.2, H.z, "shark"); }
function onFrenzy() { sfx.frenzy(); showBanner("SHARK FRENZY! +100", "", 1.4); rig.shake(0.3, 0.3); rig.kick(8, 0.4);
  timeline.shockwave([VAT.x, VAT.h - 0.3, VAT.z], { color: T.shallow, size: 9, dur: 0.6, flat: true }); }
function onHey() { sfx.hey(); bang.visible = true; showBanner("HEY!! NO HANDS IN THE TANK!", "angry", 1.4); rig.shake(0.25, 0.3); coneMat.opacity = 0.45; }
function onStrike(why) {
  sfx.strike(); loop.hitstop(90); rig.shake(0.6, 0.4); flash.hit(0.45, RED); heroHit.set(1, RED);
  pop("STRIKE!", H.x, 2.4, H.z, "hurt"); showBanner(why.toUpperCase(), "angry", 1.6);
  sparks.burst([H.x, 1.2, H.z], { colors: [RED, SAND], n: 20, speed: 5, life: 0.5, up: 2, grav: -6 });
}
function onSplash() { sfx.splash(); sparks.burst([H.x, VAT.h - 0.2, H.z], { colors: [T.shallow, T.foam, T.water], n: 45, speed: 6, life: 0.7, up: 5, grav: -12 });
  timeline.shockwave([H.x, VAT.h - 0.3, H.z], { color: T.foam, size: 3, dur: 0.5, flat: true }); }

const _v = new THREE.Vector3();
function art(dt, t) {
  // the kid: run cycle, squash on jump/land, arms forward when the hands go in
  heroObj.position.set(H.x, H.y, H.z); heroObj.rotation.y = H.yaw;
  H.squash = M.damp(H.squash, 0, 9, dt);
  pose.scale.set(1 + H.squash * 0.5, 1 - H.squash, 1 + H.squash * 0.5);
  const sw = Math.sin(t * 13) * H.run, { arms, legs, head } = pose.userData;
  legs[0].rotation.x = sw * 0.9; legs[1].rotation.x = -sw * 0.9;
  if (S.hands) { arms[0].rotation.x = M.damp(arms[0].rotation.x, -1.9, 12, dt); arms[1].rotation.x = M.damp(arms[1].rotation.x, -1.9, 12, dt); pose.rotation.x = M.damp(pose.rotation.x, 0.35, 8, dt); }
  else { arms[0].rotation.x = M.damp(arms[0].rotation.x, -sw * 0.9, 12, dt); arms[1].rotation.x = M.damp(arms[1].rotation.x, sw * 0.9, 12, dt); pose.rotation.x = M.damp(pose.rotation.x, 0, 8, dt); }
  head.rotation.z = Math.sin(t * 6.5) * 0.06 * H.run; heroObj.visible = !(S.inv > 0 && Math.floor(S.inv * 12) % 2 === 0) || S.screen !== "play";
  heroShadow.follow(H.x, heightAt(H.x, H.z) > -0.5 ? heightAt(H.x, H.z) : VAT.h - 0.35, H.z, Math.max(0, H.y - heightAt(H.x, H.z)));
  if (S.inv > 1.2) heroHit.set((S.inv - 1.2) * 2.5, RED); else heroHit.set(0);
  // the owner: waddle, his look painted on the floor, an exclamation mark while he tells you off
  ownerObj.position.set(O.x, 0, O.z); ownerObj.rotation.y = O.yaw;
  const ow = Math.sin(O.bob * 2.2) * (O.mode === "chase" ? 1 : 0.6), oa = opose.userData;
  oa.legs[0].rotation.x = ow; oa.legs[1].rotation.x = -ow; oa.arms[0].rotation.x = O.mode === "tell" ? -2.4 : -ow * 0.8; oa.arms[1].rotation.x = O.mode === "tell" ? -0.5 : ow * 0.8;
  oa.head.rotation.x = O.mode === "tell" ? -0.2 : 0; opose.position.y = Math.abs(Math.sin(O.bob * 2.2)) * 0.08;
  bang.visible = O.mode === "tell" || O.mode === "chase"; bang.position.y = 3.2 + Math.sin(t * 20) * 0.08;
  coneMat.opacity = M.damp(coneMat.opacity, O.mode === "chase" || O.mode === "tell" ? 0.42 : O.mode === "curious" ? 0.26 : 0.16, 6, dt);
  coneMat.color.set(O.mode === "curious" ? SUN : RED);
  ownerShadow.follow(O.x, 0, O.z, 0);
  // the tank's sharks, the beacons, the fart button, the pennants
  sharks.forEach((s) => sharkPool.set(s.id, { x: s.x, y: s.y + VAT.h, z: s.z, rotY: s.yaw + (s.mode === "swarm" ? Math.sin(t * 9) * 0.3 : Math.sin(t * 3 + s.a) * 0.15) }));
  if (S.hands && S.dunkT > 0.3 && Math.floor(t * 12) % 2 === 0) { const a = Math.atan2(H.x - VAT.x, H.z - VAT.z);
    sparks.emit(VAT.x + Math.sin(a) * (VAT.r - 0.6) + M.rand(-0.5, 0.5), VAT.h - 0.3, VAT.z + Math.cos(a) * (VAT.r - 0.6) + M.rand(-0.5, 0.5), M.rand(-1, 1), M.rand(1.5, 3), M.rand(-1, 1), T.foam, 0.5, 2, -9); }
  toys.forEach((ty) => { if (ty.found) return; ty.model.position.y = 0.3 + Math.sin(t * 2.4 + ty.ph) * 0.18; ty.model.rotation.y = t * 1.4 + ty.ph;
    ty.ring.position.y = 0.9 + Math.sin(t * 2.4 + ty.ph) * 0.18; ty.ring.rotation.z = t * 2; ty.beam.scale.x = ty.beam.scale.z = 1 + Math.sin(t * 5 + ty.ph) * 0.25; });
  if (S.screen === "play" && H.run > 0.45 && jumper.grounded && Math.floor(t * 9) !== Math.floor((t - dt) * 9))
    sparks.emit(H.x - Math.sin(H.yaw) * 0.35, 0.08, H.z - Math.cos(H.yaw) * 0.35, M.rand(-0.6, 0.6), M.rand(0.8, 1.6), M.rand(-0.6, 0.6), "#d9d3c4", 0.35, 3, -2);
  climaxArt(dt, t);
  cabinet.userData.btn.position.y = M.damp(cabinet.userData.btn.position.y, 1.36, 10, dt);
  sharkBody.visible = !(S.screen === "play" && H.z < 23.6 && G.camera.position.z > 23.6 && Math.abs(H.x) > 2);
  sparks.update(dt); fartCloud.update(dt); timeline.update(dt); flash.update(dt); sharkPool.sync();
}
function render(alpha, t) { tick(t); }

// ── CLIMAX (polish layer) ──
// CLOSING TIME (escape): the eighth toy trips the closing bell. The lights go amber, a 28 s clock hangs in the HUD, the owner
// walks to the door and chases any kid he sees, and the shark's whole head sinks over the doorway until the jaws are shut.
// Get out past the teeth before the clock runs out: +20 a second left. The fart machine still pulls him away.
const hudTimer = shell.text("#timer"), timerEl = document.querySelector("#timer");
const doorSolid = { x0: -4, x1: 4, z0: 23.3, z1: 24.7, h: 8 };
const AMBER = { top: "#4a2a12", horizon: "#f0a24a", bottom: "#ffd9a0", sun: "#ffb060", hemi: "#ffd2a0", ground: "#9a5a2a" };
const DAY = { top: "#1b3a6b", horizon: "#78c4f0", bottom: "#d9ecf7", sun: "#fff3d9", hemi: "#e6f4ff", ground: "#7fa2c4" };
const _ac = new THREE.Color();
function startClosing() {
  S.stage = "closing"; S.closeT = CLOSE.sec; S.shut = false; timerEl.hidden = false;
  O.mode = "guard"; O.cool = 1.5; setIntensity(1);
  sfx.bell(); showBanner("CLOSING TIME! RUN OUT THE MOUTH!", "angry", 2.6); rig.shake(0.3, 0.4); rig.kick(10, 0.5); flash.hit(0.3, AMBER.horizon);
}
function climax(dt) {
  if (S.stage !== "closing") return;
  S.closeT -= dt;
  const p = M.clamp(1 - S.closeT / CLOSE.sec, 0, 1);
  if (p > 0.72 && !solids.includes(doorSolid)) { solids.push(doorSolid); sfx.chomp(); rig.shake(0.5, 0.4); showBanner("CHOMP!", "angry", 1.2); }
  if (H.z > CLOSE.outZ) { const bonus = Math.max(0, Math.floor(S.closeT) * 20); S.score += bonus; pop(`+${bonus}`, H.x, 2.4, H.z, "toy"); over("you ran out the shark's mouth with every toy!", true); return; }
  if (S.closeT <= 0 && !params.god) { over("the jaws shut with you inside!"); }
}
function climaxReset() { timerEl.hidden = true; if (solids.includes(doorSolid)) solids.splice(solids.indexOf(doorSolid), 1); }
function climaxArt(dt, t) {
  const closing = S.stage === "closing" && S.screen === "play", p = closing ? M.clamp(1 - S.closeT / CLOSE.sec, 0, 1) : 0;
  sharkHead.position.y = M.damp(sharkHead.position.y, -7.4 * p * p, 6, dt);
  const w = closing ? AMBER : DAY, k = 1 - Math.exp(-dt * 1.5);
  sky.uniforms.uTop.value.lerp(_ac.set(w.top), k); sky.uniforms.uHorizon.value.lerp(_ac.set(w.horizon), k); sky.uniforms.uBottom.value.lerp(_ac.set(w.bottom), k);
  light.sun.color.lerp(_ac.set(w.sun), k); light.hemi.color.lerp(_ac.set(w.hemi), k); light.hemi.groundColor.lerp(_ac.set(w.ground), k);
  if (scene.fog) scene.fog.color.copy(sky.uniforms.uHorizon.value);
  if (closing) { hudTimer(`${Math.max(0, Math.ceil(S.closeT))}`); timerEl.classList.toggle("hurry", S.closeT < 8); }
}

G.warm([heroObj, ownerObj, vat, cabinet, gate, sparks, fartCloud, timeline, bang, ...toys.map((x) => x.group)]);
shell.show("title");
loop = startLoop({ step, render, snapshot, input, G, commands });
