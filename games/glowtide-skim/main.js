// Glowtide Skim — by Uncle Cory. A 3d runner-3d game on the kit/three toolbox (./lib-2/), look "Moonwash Glowtide".
// A skimboarder races the shoreline at night; the wash rolls up the sand glowing with plankton, and the board flies
// (and scores double) while it rides the glowing film. STRUCTURE follows catalog/runner-3d.md; ART is this game's own;
// the CLIMAX region is the polish layer. API: kit/three/README.md (r170).
import * as THREE from "three";
import { boot, startLoop, best, M, params } from "./lib-2/core.js";
import { createShell } from "./lib-2/shell.js";
import { createInput } from "./lib-2/input.js";
import { createRig } from "./lib-2/camera.js";
import { tick, waterMat, rim } from "./lib-2/shaders.js";
import { defineSfx, song, playSong, setIntensity } from "./lib-2/audio.js";
import { Sparks, Timeline, Trail, Streaks, screenFlash } from "./lib-2/fx.js";
import { mat, part, geo, deform, canvasTex, skyDome, starfield, glowTex } from "./lib-2/art.js";
import { ringChunks, InstancedPool, Pool, body, hitSphere } from "./lib-2/physics.js";

// ── STRUCTURE ──
const PALETTE = ["#0a0f2c", "#1e4f8a", "#ffb347", "#ff4f7b", "#3dfbd6"];   // night · moon-sea · board amber · jelly pink · plankton glow
const SLUG = "glowtide-skim", ORIENT = "portrait";
// Acts by distance skimmed; each has a speed target the ramp eases toward. `at` is where ?at=<name> drops you.
const ACTS = [{ name: "moonrise", at: 0, speed: 15 }, { name: "glowtide", at: 380, speed: 22 }, { name: "rescue", at: 900, speed: 22 }];
const LANE_X = [-2.4, 0, 2.4], CHUNK = 40, CHUNKS = 6, ROWS = [-10, -22, -34], SPEED0 = 10, RAMP = 0.8;
// The chunk library: 3 rows × 3 lanes. j = jellyfish washed up (hop it) · f = fishing line (duck it) · g = sea glass ·
// h = sea glass up high (hop for it) · . = sand. Every row keeps a lane with no j or f, so no chunk is unwinnable. [tier, rows]
const PATTERNS = [
  [0, ["g..", ".j.", "..g"]], [0, ["j..", "gg.", "..j"]], [0, [".g.", "..f", "g.."]], [0, ["..j", ".g.", "f.."]],
  [0, ["ggg", "...", ".j."]], [0, [".h.", ".j.", "g.g"]], [1, ["j.f", ".g.", "f.j"]], [1, ["f..", ".jh", "g.f"]],
  [1, [".j.", "g.g", "j.j"]], [1, ["jj.", "..g", "f.f"]], [1, ["f.j", "hj.", "j.f"]], [1, [".fj", "g..", "jh."]],
];
const SAFE = [["...", ".g.", "g.g"], ["g..", ".g.", "..g"]];

const G = boot({ canvas: "#view", background: null, bloom: { strength: 0.8, radius: 0.5, threshold: 0.88 },
  toneMapping: "agx", camera: { fov: 55, near: 0.1, far: 600 },
  errorMessage: "Wipeout! The board hit a bug in the game. Show this to a grown-up:" });
const input = createInput({ swipe: { zone: "#swipe", min: 30, edge: 24 } });
const shell = createShell({ screens: { title: "#title", over: "#over" }, orient: ORIENT, input,
  prompt: { el: "#prompt", text: input.isTouch ? "tap to drop in!" : "press space to drop in!" },
  onShow: (name) => { if (name === "title" || name === "over") G.quality.probeUp(); } });
shell.hubLink(); shell.rotate("#rotate");
const hud = { score: shell.text("#score"), glass: shell.text("#glass-n"), final: shell.text("#final"), best: shell.text("#best"), over: shell.text("#over-t") };
const record = best(SLUG), rig = createRig(G.camera, { portraitScale: 1.35 });
const jumper = body({ gravity: -40, jumpV: 13, coyote: 0.08, buffer: 0.12, cut: 0.5 });
const feet = { x: 0, y: 0, z: 0 };

const S = { screen: "title", stage: "moonrise", startStage: "moonrise", act: 0, dist: 0, speed: SPEED0, lane: 1, x: 0, y: 0, duck: 0,
  score: 0, bonus: 0, glass: 0, chain: 0, laneT: 9, dying: 0, cause: "", safeUntil: 80, t: 0, run: 0, wet: false, edge: 0, glowRun: 0 };
let track = null;
const hooks = { rows: null, glass: null, save: null, jump: null, step: null, state: null, start: null };   // the polish layer plugs in here

const actIndex = (d) => ACTS.reduce((k, a, i) => (d >= a.at ? i : k), 0);
function freeChunk(obj) { for (const it of obj.userData.items) KINDS[it.kind].free(it); obj.userData.items.length = 0; }
function rollChunk(obj, z, k) {
  freeChunk(obj);
  const start = k * CHUNK, act = actIndex(start);
  dressChunk(obj, act, k);
  const pool = PATTERNS.filter(([tier]) => tier <= act), rows = start < S.safeUntil ? M.pick(SAFE) : (hooks.rows && hooks.rows(act)) || M.pick(pool)[1];
  rows.forEach((row, r) => [...row].forEach((ch, lane) => {
    const kind = { j: "jelly", f: "line", g: "glass", h: "glass" }[ch]; if (!kind) return;
    const it = { kind, lane, x: LANE_X[lane], y: ch === "h" ? 2.1 : 0, z: z + ROWS[r] + M.rand(-2, 2), passed: false, hit: false, ph: M.rand(0, 6.28) };
    KINDS[kind].spawn(it); obj.userData.items.push(it);
  }));
}
function startRun() {
  const i = Math.max(0, ACTS.findIndex((a) => a.name === S.startStage));
  Object.assign(S, { screen: "play", act: i, stage: ACTS[i].name, dist: ACTS[i].at, speed: i ? ACTS[i].speed : SPEED0, lane: 1, x: 0, y: 0, duck: 0,
    score: 0, bonus: 0, glass: 0, chain: 0, laneT: 9, dying: 0, cause: "", safeUntil: ACTS[i].at + 80, t: 0, run: 0, wet: false, glowRun: 0 });
  feet.y = 0; jumper.vel.set(0, 0, 0); jumper.grounded = true;
  track.reset(); track.update(S.dist);
  hud.score(0); hud.glass(0); shell.show("play"); juice.start(i); if (hooks.start) hooks.start();
}
function lose(cause) {
  if (S.dying || S.screen !== "play") return;
  S.dying = 0.9; S.cause = cause; loop.hitstop(90); loop.slowmo(0.35, 0.5); juice.hit(cause);
}
function over() {
  if (S.screen === "over") return;
  S.screen = "over"; S.dying = 0;
  const r = record.submit(S.score);
  hud.final(S.score); hud.best(r.best); hud.over(S.cause === "line" ? "snagged!" : S.cause === "jelly" ? "zapped!" : "wipeout!");
  shell.show("over"); juice.over(r.isNew);
}
function stepPlay(dt, t) {
  S.t += dt;
  const a = actIndex(S.dist);
  if (a !== S.act) { S.act = a; S.stage = ACTS[a].name; juice.act(a); }
  // the Signature: the board rides faster and scores double while it is on the glowing film the wash leaves behind
  const wasWet = S.wet;
  S.wet = S.x > S.edge - 0.3 && S.y < 0.2;
  if (S.wet && !wasWet && S.t > 0.5) juice.film();
  const target = ACTS[S.act].speed * (S.wet ? 1.12 : 1);
  S.speed = M.approach(S.speed, target, (S.wet ? 2.5 : RAMP) * dt);
  S.dist += S.speed * dt; S.run += S.speed * dt * (S.wet ? 2 : 1); track.update(S.dist);
  S.glowRun = S.wet ? S.glowRun + dt : 0;
  const left = input.pressed("left") || input.pressed("swipeLeft"), right = input.pressed("right") || input.pressed("swipeRight");
  const jump = input.pressed("up") || input.pressed("swipeUp") || input.pressed("a"), duck = input.pressed("down") || input.pressed("swipeDown");
  if (left && S.lane > 0) { S.lane--; S.laneT = 0; juice.lane(-1); }
  if (right && S.lane < 2) { S.lane++; S.laneT = 0; juice.lane(1); }
  S.laneT += dt; S.x = M.damp(S.x, LANE_X[S.lane], 18, dt);
  if (duck) { S.duck = 0.6; if (!jumper.grounded) jumper.vel.y = -30; juice.duck(); }
  S.duck = Math.max(0, S.duck - dt);
  const j = jumper.step(feet, { jump: jump && S.duck <= 0, jumpHeld: true }, dt); S.y = feet.y;
  if (j.jumped) { S.chain = 0; S.spin = 0; juice.jump(); if (hooks.jump) hooks.jump(); }
  if (!jumper.grounded) S.spin = Math.min(Math.PI * 2, (S.spin || 0) + dt * Math.PI * 2 / 0.5);
  if (j.landed) { if (S.spin >= Math.PI * 2 - 0.01) { S.bonus += 15; juice.shuvit(); } S.spin = 0; juice.land(j.hard); }
  const hz = -S.dist, me = { x: S.x, y: S.y + (S.duck > 0 ? 0.3 : 0.55), z: hz }, rMe = S.duck > 0 ? 0.35 : 0.5;
  track.each((obj) => { for (const it of obj.userData.items) {
    if (it.hit) continue;
    KINDS[it.kind].move(it, dt, t, hz);
    const c = KINDS[it.kind].sphere(it);
    if (hitSphere(me, rMe, c, c.r)) {
      if (it.kind === "glass") { it.hit = true; S.glass++; S.chain++; const v = hooks.glass ? hooks.glass(it) : (S.wet ? 50 : 25); S.bonus += v; KINDS.glass.free(it); juice.pickup(it, S.chain, v); }
      else if (!params.god) { it.hit = true; if (!(hooks.save && hooks.save(it))) { lose(it.kind); return; } }
    } else if (!it.passed && it.z > hz + 0.9) {
      it.passed = true;
      if (it.kind !== "glass" && (Math.abs(it.x - S.x) < 1.2 || S.laneT < 0.5)) { S.bonus += 5; juice.dodge(it); }
    }
  } });
  S.score = Math.floor(S.run) + S.bonus;
  hud.score(S.score); hud.glass(S.glass);
  if (hooks.step) hooks.step(dt, t);
}
function step(dt, t) {
  if (S.screen === "play" && !S.dying) stepPlay(dt, t);
  else if (S.screen === "play") { S.dying -= dt; if (S.dying <= 0) over(); }
  else if (input.pressed("start") && shell.canAccept()) startRun();
  world(dt, t);
}
const snapshot = () => ({
  screen: S.screen, stage: S.stage, score: S.score, best: record.get(), speed: +S.speed.toFixed(2), glass: S.glass, chain: S.chain,
  wet: S.wet, edge: +S.edge.toFixed(2),
  entities: track ? trackCount() : 0,
  focus: { lane: S.lane, x: +S.x.toFixed(3), y: +S.y.toFixed(3), z: +(-S.dist).toFixed(3) },
  ...(hooks.state ? hooks.state() : {}),
});
function trackCount() { let n = 0; track.each((o) => { n += o.userData.items.length; }); return n; }
const commands = {
  die: () => { S.cause = S.cause || "jelly"; over(); },
  at: (stage) => { if (!ACTS.some((a) => a.name === String(stage))) return; S.startStage = String(stage); if (S.screen === "play") startRun(); },
};

// ── ART ──
const scene = G.scene;
const SEA_X = 5.6;   // where the open surf starts; the sand runs from the dunes at x ≈ -9 down to the surf on the right
// The night: a deep-indigo dome with a moon-sea horizon, exp2 fog swallowing the far beach, stars overhead.
const sky = skyDome(scene, { top: "#04061a", horizon: "#16386a", bottom: PALETTE[0], fog: { mode: "exp2", color: "#0c1a3e", density: 0.021 } });
starfield(scene, { n: 900, radius: 700, size: 1.6, tints: ["#ffffff", "#bfe9ff", "#ffe3b0"] });
scene.add(new THREE.HemisphereLight("#6f8fd6", PALETTE[0], 0.9));
const moonLight = new THREE.DirectionalLight("#cfe0ff", 0.9); moonLight.position.set(20, 18, -30); scene.add(moonLight);
// the moon over the sea, dead ahead and right, with its halo; it rides with the camera so it never gets closer
const moon = new THREE.Group(); scene.add(moon);
part(geo.sphere(14, 32), mat.hot("#fff4dc", 1.6), [0, 0, 0], moon);
const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(128), color: "#7fb6ff", transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
halo.scale.set(60, 60, 1); moon.add(halo);
moon.children[0].material.fog = false;

// sand: dark moonlit sand with wind ripples and the wrack line drawn into one tiling texture
const sandTex = canvasTex(256, 256, (c, w, h) => {
  c.fillStyle = "#1b2a52"; c.fillRect(0, 0, w, h);
  for (let i = 0; i < 26; i++) { c.strokeStyle = i % 2 ? "rgba(120,150,210,0.10)" : "rgba(5,8,25,0.22)"; c.lineWidth = 3;
    c.beginPath(); const y = i * 10 + 3; c.moveTo(0, y); for (let x = 0; x <= w; x += 16) c.lineTo(x, y + Math.sin(x * 0.05 + i) * 3); c.stroke(); }
  for (let i = 0; i < 160; i++) { c.fillStyle = `rgba(200,220,255,${0.05 + (i % 5) * 0.03})`; c.fillRect((i * 97) % w, (i * 53) % h, 2, 2); }
}, { repeat: [3, 4] });
const sandMat = new THREE.MeshLambertMaterial({ map: sandTex });
const dune = mat.lambert("#101c3c", { flat: true }), oat = mat.lambert("#20355f", { flat: true });
const fenceMat = mat.lambert("#2a3350"), lanternMat = mat.hot(PALETTE[2], 2.2);
const duneGeo = deform(new THREE.SphereGeometry(3, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), { amount: 0.5, scale: 0.6, seed: 4 });
function buildChunk(i) {
  const g = new THREE.Group(); g.userData.items = []; scene.add(g);
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(26, CHUNK), sandMat); sand.rotation.x = -Math.PI / 2; sand.position.set(-4, 0, -CHUNK / 2); g.add(sand);
  // dunes, sea oats and a beach fence along the land side
  for (let d = 0; d < 3; d++) part(duneGeo, dune, [-11 - (d % 2) * 2.5, -0.4, -6 - d * 13], g, { scale: [1.4, 0.7 + d * 0.15, 1.2] });
  for (let s = 0; s < 7; s++) part(geo.cone(0.12, 1.6, 4), oat, [-7.6 - (s % 3) * 0.7, 0.8, -3 - s * 5.4], g, { rot: [0.25 * Math.sin(s), 0, 0.3 * Math.cos(s)] });
  const fence = new THREE.Group(); g.add(fence); fence.position.set(-6.4, 0, -20);
  for (let p = 0; p < 6; p++) part(geo.box(0.12, 1.1, 0.12), fenceMat, [0, 0.55, -p * 1.6], fence);
  part(geo.box(0.05, 0.08, 8.2), fenceMat, [0, 0.9, -4], fence); part(geo.box(0.05, 0.08, 8.2), fenceMat, [0, 0.5, -4], fence);
  // a boardwalk lantern every other chunk: amber glow poles that give the speed cue at night
  const post = new THREE.Group(); g.add(post); post.position.set(-4.9, 0, -30);
  part(geo.cyl(0.07, 0.09, 2.4, 6), fenceMat, [0, 1.2, 0], post); part(geo.sphere(0.2, 10), lanternMat, [0, 2.5, 0], post);
  g.userData.post = post; g.userData.fence = fence;
  return g;
}
function dressChunk(obj, act, k) { obj.userData.post.visible = k % 2 === 0; obj.userData.fence.visible = k % 3 !== 1; obj.userData.fence.position.z = -12 - (k % 3) * 6; }

// the sea: one moonlit water plane on the right that rides along with the hero
const sea = new THREE.Mesh(new THREE.PlaneGeometry(90, 260), waterMat({ deep: "#040a22", shallow: "#0d2f5e", foam: "#2bbfa6", scale: 0.07, speed: 0.5, shore: 0.1, flip: false, roughness: 0.4 }));
sea.rotation.x = -Math.PI / 2; scene.add(sea);
// the Signature's visual: the glowing wash. A sheet of plankton light that rolls up the sand and sinks back, a hot
// leading edge that blooms, and a scatter of glints on the film. Its edge x is S.edge.
const washTex = canvasTex(64, 256, (c, w, h) => {
  const gr = c.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, "rgba(61,251,214,0.95)"); gr.addColorStop(0.18, "rgba(61,251,214,0.35)"); gr.addColorStop(1, "rgba(30,120,200,0.12)");
  c.fillStyle = gr; c.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) { c.fillStyle = `rgba(190,255,245,${0.2 + (i % 4) * 0.12})`; c.fillRect((i * 37) % w, (i * 71) % h, 1, 2); }
}, { repeat: [1, 14] });
const washMat = new THREE.MeshBasicMaterial({ map: washTex, color: "#ffffff", transparent: true, opacity: 0.34, blending: THREE.AdditiveBlending, depthWrite: false });
const wash = new THREE.Mesh(new THREE.PlaneGeometry(1, 220), washMat); wash.rotation.x = -Math.PI / 2; wash.position.y = 0.03; scene.add(wash);
const washEdge = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 220), mat.hot(PALETTE[4], 1.25)); washEdge.rotation.x = -Math.PI / 2; washEdge.position.y = 0.05; scene.add(washEdge);

// the hero: a skimboarder, low and wide, on an amber board with a glowing rail
const hero = new THREE.Group(); scene.add(hero);
const boardShape = "M0 -1.05 Q0.55 -1.0 0.55 -0.2 L0.55 0.35 Q0.5 1.05 0 1.1 Q-0.5 1.05 -0.55 0.35 L-0.55 -0.2 Q-0.55 -1.0 0 -1.05 Z";
const board = new THREE.Group(); hero.add(board);
part(geo.extrude(boardShape, 0.07, { bevel: 0.02 }), mat.standard(PALETTE[2], { roughness: 0.35, emissive: "#6a3200", emissiveIntensity: 0.6 }), [0, 0.06, 0], board, { rot: [Math.PI / 2, 0, 0] });
part(geo.extrude(boardShape, 0.03), mat.hot("#ffcf7a", 1.8), [0, 0.02, 0], board, { rot: [Math.PI / 2, 0, 0], scale: [1.06, 1.04, 1] });
const rider = new THREE.Group(); hero.add(rider);
const suit = rim(mat.standard("#15224d", { roughness: 0.6 }), { color: PALETTE[2], power: 2.2, strength: 1.1 });
const skin = rim(mat.standard("#c98a62", { roughness: 0.7 }), { color: "#ffd9a0", power: 2.4, strength: 0.7 });
const shorts = rim(mat.standard(PALETTE[3], { roughness: 0.5 }), { color: "#ffc2d1", power: 2.2, strength: 0.8 });
const legL = part(geo.capsule(0.11, 0.5), skin, [-0.22, 0.42, 0.12], rider, { rot: [0, 0, 0.18] });
const legR = part(geo.capsule(0.11, 0.5), skin, [0.22, 0.42, -0.1], rider, { rot: [0, 0, -0.18] });
part(geo.lathe([[0.01, 0], [0.26, 0.05], [0.3, 0.2], [0.27, 0.3], [0.01, 0.32]], 12), shorts, [0, 0.66, 0], rider);
const torso = part(geo.lathe([[0.01, 0], [0.24, 0.02], [0.27, 0.3], [0.3, 0.5], [0.14, 0.62], [0.01, 0.64]], 12), suit, [0, 0.9, 0], rider);
const head = part(geo.sphere(0.2, 16), skin, [0, 1.72, 0], rider);
part(deform(geo.sphere(0.215, 12), { amount: 0.08, scale: 3, seed: 9 }), mat.standard("#2b1a10", { roughness: 0.9 }), [0, 1.78, 0.04], rider, { scale: [1, 0.75, 1.05] });
const armL = new THREE.Group(), armR = new THREE.Group(); armL.position.set(-0.3, 1.42, 0); armR.position.set(0.3, 1.42, 0); rider.add(armL, armR);
part(geo.capsule(0.08, 0.55), suit, [-0.32, -0.05, 0], armL, { rot: [0, 0, 1.25] }); part(geo.capsule(0.08, 0.55), suit, [0.32, -0.05, 0], armR, { rot: [0, 0, -1.25] });
const heroShadow = new THREE.Mesh(new THREE.CircleGeometry(0.9, 20), new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.35, depthWrite: false }));
heroShadow.rotation.x = -Math.PI / 2; heroShadow.position.y = 0.02; scene.add(heroShadow);

// the jellyfish: moon jellies stranded by the tide, pink and pulsing
const jellyBell = geo.lathe([[0.01, 0.42], [0.22, 0.4], [0.38, 0.3], [0.46, 0.12], [0.44, 0.02], [0.3, 0.05], [0.01, 0.06]], 16);
const jellyMat = new THREE.MeshBasicMaterial({ color: PALETTE[3], transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
const jellyCore = mat.hot("#ff9ab4", 1.8), tentMat = mat.hot(PALETTE[3], 1.3);
const jellies = new Pool(scene, () => {
  const g = new THREE.Group(); const bell = part(jellyBell, jellyMat, [0, 0.1, 0], g);
  part(geo.sphere(0.13, 8), jellyCore, [0, 0.28, 0], bell);
  for (let k = 0; k < 5; k++) { const a = k * 1.256; part(geo.cyl(0.02, 0.01, 0.5, 4), tentMat, [Math.cos(a) * 0.3, 0.02, Math.sin(a) * 0.3], g, { rot: [Math.PI / 2 + 0.2 * Math.sin(a), 0, 0.2 * Math.cos(a)] }); }
  g.scale.setScalar(1.3); g.userData.bell = bell; return g;
}, { max: 40 });
// the fishing line: two surf-rod poles with a glowing pink line and bobbers across one lane, at chest height
const rodMat = mat.lambert("#3a4466"), lineMat = mat.hot(PALETTE[3], 2), bobMat = mat.hot("#ffd1dc", 2.2);
const lines = new Pool(scene, () => {
  const g = new THREE.Group();
  part(geo.cyl(0.05, 0.07, 1.6, 6), rodMat, [-1.05, 0.8, 0], g, { rot: [0, 0, 0.15] }); part(geo.cyl(0.05, 0.07, 1.6, 6), rodMat, [1.05, 0.8, 0], g, { rot: [0, 0, -0.15] });
  part(geo.box(2.3, 0.05, 0.05), lineMat, [0, 1.3, 0], g);
  part(geo.sphere(0.12, 10), bobMat, [-0.45, 1.2, 0], g); part(geo.sphere(0.12, 10), bobMat, [0.45, 1.2, 0], g);
  return g;
}, { max: 30 });
// sea glass: tumbled glowing shards, one instanced draw
const glassPool = new InstancedPool(scene, geo.ico(0.28, 0), mat.hot(PALETTE[4], 2.1), { max: 90, cull: false });

const KINDS = {
  jelly: { spawn: (it) => { it.obj = jellies.spawn({ x: it.x, y: 0, z: it.z }); }, free: (it) => { jellies.free(it.obj); it.obj = null; },
    move: (it, dt, t) => { if (!it.obj) return; const p = 1 + 0.12 * Math.sin(t * 4 + it.ph); it.obj.userData.bell.scale.set(p, 2 - p, p); },
    sphere: (it) => ({ x: it.x, y: 0.35, z: it.z, r: 0.45 }) },
  line: { spawn: (it) => { it.obj = lines.spawn({ x: it.x, y: 0, z: it.z }); }, free: (it) => { lines.free(it.obj); it.obj = null; },
    move: () => {}, sphere: (it) => ({ x: it.x, y: 1.25, z: it.z, r: 0.35 }) },
  glass: { spawn: (it) => { it.id = glassPool.spawn({ x: it.x, y: it.y + 0.6, z: it.z, rotY: it.ph }); },
    free: (it) => { if (it.id != null) glassPool.free(it.id); it.id = null; },
    move: (it, dt, t, hz) => { if (it.id == null) return;
      // the Signature, deeper: glass lying on the glowing film drifts across it to a board that is riding the film
      if (S.wet && it.x > S.edge - 0.3 && it.z < hz && it.z > hz - 16) { it.x = M.damp(it.x, S.x, 2.6, dt); it.carried = true; }
      glassPool.set(it.id, { x: it.x, y: it.y + 0.6 + 0.15 * Math.sin(t * 3 + it.ph), rotY: t * (it.carried ? 6 : 2) + it.ph, rotX: 0.5, scale: it.carried ? 1.25 : 1 }); },
    sphere: (it) => ({ x: it.x, y: it.y + 0.6, z: it.z, r: 0.45 }) },
};

track = ringChunks({ count: CHUNKS, length: CHUNK, build: buildChunk, recycle: rollChunk });

// fx: plankton spray, a glowing wake behind the board, speed streaks along the shore
const spray = new Sparks(scene, { colors: [PALETTE[4], "#b8fff2", "#7fd4ff"], max: 500, size: 0.35 });
const wakeHead = { x: 0, y: 0.08, z: 0 };
const wake = new Trail(scene, wakeHead, { color: PALETTE[4], length: 26, width: 0.55 });
const streaks = new Streaks(scene, { color: "#7fb6ff", n: 60, box: [7, 2.5, 4, 70], length: 5 });
const tl = new Timeline(scene, { colors: [PALETTE[4], PALETTE[3], PALETTE[2]] });
const flash = screenFlash("#flash", { color: PALETTE[3] });

// sound: glassy plucks and surf hiss; the motif climbs like a wave and falls back like the wash
const sfx = defineSfx({
  swish: { noise: { f0: 2400, f1: 900, dur: 0.12, vol: 0.18, q: 0.8 }, throttle: 0.05 },
  ollie: [{ tone: { type: "triangle", f0: 330, f1: 660, dur: 0.12, vol: 0.22 } }, { noise: { f0: 3000, f1: 1500, dur: 0.1, vol: 0.12 } }],
  land: { noise: { f0: 1400, f1: 300, dur: 0.22, vol: 0.3, q: 0.7 } },
  glass: [{ tone: { type: "sine", f0: 1568, dur: 0.07, vol: 0.2 } }, { tone: { type: "sine", f0: 2093, dur: 0.16, vol: 0.18 }, at: 0.06 }],
  zap: [{ tone: { type: "sawtooth", f0: 880, f1: 110, dur: 0.35, vol: 0.3 } }, { noise: { f0: 600, f1: 120, dur: 0.5, vol: 0.35 } }],
  splash: { noise: { f0: 700, f1: 2600, dur: 0.28, vol: 0.2, q: 0.6 }, throttle: 0.3 },
  shuv: [{ tone: { type: "triangle", f0: 523, f1: 784, dur: 0.08, vol: 0.18 } }, { tone: { type: "triangle", f0: 784, f1: 1175, dur: 0.12, vol: 0.18 }, at: 0.08 }],
  rescue: [{ tone: { type: "triangle", f0: 440, dur: 0.12, vol: 0.22 } }, { tone: { type: "triangle", f0: 554, dur: 0.12, vol: 0.22 }, at: 0.1 },
    { tone: { type: "triangle", f0: 659, dur: 0.12, vol: 0.22 }, at: 0.2 }, { tone: { type: "sine", f0: 880, f1: 1320, dur: 0.5, vol: 0.24 }, at: 0.3 }],
  tick: { tone: { type: "sine", f0: 988, dur: 0.06, vol: 0.16 } },
  glow: { tone: { type: "sine", f0: 523, f1: 1046, dur: 0.25, vol: 0.14 }, throttle: 0.8 },
  act: [{ tone: { type: "triangle", f0: 392, dur: 0.12, vol: 0.2 } }, { tone: { type: "triangle", f0: 523, dur: 0.12, vol: 0.2 }, at: 0.12 }, { tone: { type: "triangle", f0: 784, dur: 0.3, vol: 0.22 }, at: 0.24 }],
}, { seed: 3 });
const tune = song({ bpm: 104, key: 57, scale: "dorian",
  motif: [0, 2, 4, 7, 9, 7, null, 4, 2, 4, 0, null, -3, 0, 2, null],
  voices: { lead: { wave: "triangle", env: [0.01, 0.12, 0.4, 0.25] }, bass: { wave: "sine", env: [0.01, 0.2, 0.6, 0.2] }, drums: { kit: "808", pattern: "k.h.s.hkk.h.s.ho" } }, seed: 7 });

// the game's own responses to each moment
const pops = document.getElementById("pops");
function pop(text, cls) { const el = document.createElement("div"); el.className = "pop " + (cls || ""); el.textContent = text; pops.appendChild(el); popList.push({ el, life: 0.8 }); }
const popList = [];
const juice = {
  start(i) { playSong(tune); setIntensity(i ? 1 : 0.5); rig.snap(); wake.clear(); spray.clear(); },
  lane(d) { sfx.swish(); S.roll = -0.06 * d; for (let n = 0; n < 6; n++) spray.emit(S.x, 0.1, -S.dist, -d * M.rand(2, 5), M.rand(1, 3), M.rand(0, 3), S.wet ? PALETTE[4] : "#9fb3e0", 0.45); },
  jump() { sfx.ollie(); spray.burst([S.x, 0.1, -S.dist], { n: 14, speed: 4, up: 3, life: 0.5, colors: [PALETTE[4], "#b8fff2"] }); },
  land(hard) { sfx.land(); squash = hard ? 1 : 0.7; rig.shake(hard ? 0.35 : 0.18, 0.15); tl.shockwave([S.x, 0.06, -S.dist], { color: S.wet ? PALETTE[4] : "#7fb6ff", size: hard ? 3.2 : 2.2, dur: 0.4, flat: true });
    spray.burst([S.x, 0.1, -S.dist], { n: 22, speed: 6, up: 2, life: 0.6, colors: [PALETTE[4], "#ffffff"] }); },
  duck() { sfx.swish({ pitch: -5 }); },
  film() { sfx.splash(); rig.kick(5, 0.45); tl.shockwave([S.x, 0.06, -S.dist], { color: PALETTE[4], size: 2.6, dur: 0.35, flat: true });
    for (let n = 0; n < 14; n++) spray.emit(S.x + M.rand(-0.5, 0.5), 0.1, -S.dist, M.rand(-3, 3), M.rand(1.5, 4), M.rand(0, 3), PALETTE[4], 0.5); },
  shuvit() { sfx.shuv(); pop("shuv-it! +15", "near"); squash = 0.4; },
  pickup(it, chain, v) { sfx.glass({ pitch: Math.min(chain, 8) }); tl.flash([it.x, it.y + 0.6, it.z], { color: PALETTE[4], size: 1.6, dur: 0.2 });
    spray.burst([it.x, it.y + 0.6, it.z], { n: 12, speed: 5, life: 0.5, colors: [PALETTE[4], "#ffffff"] }); pop("+" + v, S.wet ? "glow" : ""); },
  dodge(it) { if (it.kind === "line") pop("limbo!", "near"); else pop("close!", "near"); },
  act(a) { sfx.act(); setIntensity(1); if (a === 1) pop("GLOWTIDE!", "big"); rig.kick(8, 0.6); },
  hit(cause) { sfx.zap(); flash.hit(0.55, cause === "line" ? PALETTE[3] : "#ff9ab4"); rig.shake(0.9, 0.3);
    spray.burst([S.x, 0.6, -S.dist], { n: 40, speed: 9, up: 4, life: 0.9, colors: [PALETTE[3], PALETTE[4], "#ffffff"] }); },
  over(isNew) { setIntensity(0); document.getElementById("newbest").hidden = !isNew; },
};

let squash = 0;
const skyTop = new THREE.Color(), skyHor = new THREE.Color();
const ACT_SKY = [["#04061a", "#16386a"], ["#12052a", "#3a1a6e"], ["#050a26", "#0f4a66"]];
function world(dt, t) {
  // the tide: the wash rolls up across the lanes and sinks back, a slow set of swells with a quick run-up
  const ph = S.screen === "play" ? S.t : t;
  const swell = Math.sin(ph * 0.9) * 0.6 + Math.sin(ph * 0.37 + 1.3) * 0.4;
  S.edge = 1.2 - swell * 3.6;   // −2.4 … 4.8: sometimes every lane is glowing, sometimes only the surf lane
  const hz = -S.dist;
  const width = SEA_X + 1 - S.edge;
  wash.scale.x = Math.max(0.01, width); wash.position.set(S.edge + width / 2, 0.03, hz - 70);
  washEdge.position.set(S.edge, 0.05, hz - 70);
  washTex.offset.y = -((-hz) / 36) % 1;
  sea.position.set(SEA_X + 44, -0.02, hz - 70);
  moon.position.set(G.camera.position.x + 120, 70, G.camera.position.z - 420);
  // hero pose
  if (S.screen === "title") { S.x = M.damp(S.x, 0, 4, dt); S.dist += 8 * dt; track.update(S.dist); }
  const lean = M.clamp((LANE_X[S.lane] - S.x) * 0.25, -0.35, 0.35);
  hero.position.set(S.x, S.y, hz);
  // squash on landing, stretch in the air; the board spins a shove-it under the rider on every ollie
  squash = M.damp(squash, 0, 9, dt);
  const air = S.y > 0.15 ? 0.1 : 0, sq = squash * 0.3;
  hero.scale.set(1 + sq - air * 0.5, 1 - sq + air, 1 + sq - air * 0.5);
  board.rotation.y = S.screen === "play" && S.y > 0.02 ? (S.spin || 0) : 0;
  hero.rotation.set(0, 0, lean); rider.rotation.set(0, Math.PI / 2, 0);
  const crouch = S.duck > 0 ? 0.55 : 1;
  rider.scale.set(1, M.damp(rider.scale.y, crouch, 20, dt), 1);
  armL.rotation.z = 0.35 * Math.sin(t * 3) - (S.y > 0.2 ? 0.6 : 0); armR.rotation.z = -0.35 * Math.sin(t * 3 + 1) + (S.y > 0.2 ? 0.6 : 0);
  heroShadow.position.set(S.x, 0.02, hz); heroShadow.scale.setScalar(1 - Math.min(0.6, S.y * 0.25));
  // the glowing wake: bright cyan on the film, a faint moon-blue scratch on dry sand
  wakeHead.x = S.x + 0.18 * Math.sin(t * 9); wakeHead.y = S.y + 0.08; wakeHead.z = hz + 0.9;
  if (S.screen === "play" && S.wet && S.y < 0.2 && Math.random() < 0.8) spray.emit(S.x + M.rand(-0.4, 0.4), 0.08, hz + 0.9, M.rand(-1.5, 1.5), M.rand(0.5, 2), M.rand(2, 5), PALETTE[4], 0.5);
  // the wash's leading edge fizzes: a lace of plankton foam kicks up along the hot line ahead of the board
  if (S.screen === "play" && S.edge < SEA_X && Math.random() < 0.7) spray.emit(S.edge + M.rand(-0.12, 0.12), 0.06, hz - M.rand(3, 30), M.rand(-0.4, 0.4), M.rand(0.4, 1.4), 0, "#b8fff2", 0.45);
  if (S.screen === "play" && S.glowRun > 1.5 && Math.floor(S.glowRun / 1.5) !== Math.floor((S.glowRun - dt) / 1.5)) { sfx.glow(); pop("GLOW x2", "glow"); }
  document.body.classList.toggle("wet", S.screen === "play" && S.wet);
  // act colors ease in over ~2 s
  const k = Math.min(1, dt * 1.2), a = ACT_SKY[S.screen === "play" ? S.act : 0];
  skyTop.set(a[0]).convertSRGBToLinear(); skyHor.set(a[1]).convertSRGBToLinear();
  sky.uniforms.uTop.value.lerp(skyTop, k); sky.uniforms.uHorizon.value.lerp(skyHor, k);
  jellies.sweep(); lines.sweep();
  spray.update(dt); wake.update(dt); streaks.update(S.screen === "play" ? S.speed : 6, dt); tl.update(dt); flash.update(dt);
  for (let i = popList.length - 1; i >= 0; i--) { const p = popList[i]; p.life -= dt; p.el.style.opacity = Math.min(1, p.life * 3); p.el.style.transform = `translate(-50%, ${-40 * (0.8 - p.life)}px)`;
    if (p.life <= 0) { p.el.remove(); popList.splice(i, 1); } }
  // camera: low and behind on play; a slow drift over the glowing shore on the title
  if (S.screen === "play" || S.dying) rig.follow(hero, { back: 7, up: 3.2, lookUp: 1.2, lookAhead: 6, yawFollow: false, k: 8 });
  else rig.follow(hero, { back: 9, up: 3.8, lookUp: 1.4, lookAhead: 10, yawFollow: false, k: 3 });
  S.roll = M.damp(S.roll || 0, 0, 6, dt); rig.roll(S.roll); rig.update(dt, t);
  streaks.object.position.set(G.camera.position.x, 1.2, G.camera.position.z - 2);
}
function render() { glassPool.sync(); }

// ── CLIMAX (polish layer) ──
// timed-rescue, "the hatchling run": at 900 m a loggerhead hatchling is tumbling down the backwash ahead of you, lost
// on the dark sand. A 20 s clock hangs over it in the world; every sea glass adds a second, and riding the glowing film is
// the only way to close the gap in time. Catch it (reach its distance) → a slow-motion scoop and it arcs into the surf.
const RESCUE = { gap: 130, speed: 15, time: 20, every: 700, bonus: 500 };
const R = { on: false, d: 0, time: 0, next: 900, saved: 0, fly: 0, fx: 0, secs: -1 };
const hatch = new THREE.Group(); scene.add(hatch); hatch.visible = false;
const turtle = new THREE.Group(); hatch.add(turtle); turtle.scale.setScalar(2.4);
const shellMat = rim(mat.standard("#8a6a3a", { roughness: 0.5, emissive: "#2a1a08", emissiveIntensity: 0.8 }), { color: PALETTE[4], power: 1.8, strength: 1.7 });
const flipMat = rim(mat.standard("#5a4a2e", { roughness: 0.6 }), { color: "#b8fff2", power: 2.2, strength: 1.3 });
part(geo.lathe([[0.01, 0.2], [0.14, 0.19], [0.26, 0.13], [0.32, 0.05], [0.3, 0], [0.01, 0.01]], 14), shellMat, [0, 0.08, 0], turtle, { scale: [1, 1, 1.25] });
const scuteMat = mat.hot("#b8fff2", 1.4);
for (let r = 0; r < 5; r++) part(geo.ico(0.05, 0), scuteMat, [0, 0.28 - Math.abs(r - 2) * 0.012, -0.24 + r * 0.12], turtle);
part(geo.sphere(0.1, 12), flipMat, [0, 0.14, -0.42], turtle, { scale: [1, 0.85, 1.2] });
const flipShape = "M0 0 Q0.18 -0.04 0.36 0.1 Q0.2 0.1 0 0.12 Z", flippers = [];
for (let f = 0; f < 4; f++) { const side = f % 2 ? 1 : -1, front = f < 2;
  const fl = new THREE.Group(); fl.position.set(side * 0.22, 0.1, front ? -0.18 : 0.22); turtle.add(fl);
  part(geo.extrude(flipShape, 0.02), flipMat, [0, 0, 0], fl, { rot: [Math.PI / 2, 0, 0], scale: [side * (front ? 1 : 0.6), front ? 1 : 0.6, 1] });
  flippers.push({ g: fl, side, front }); }
const beaconMat = new THREE.MeshBasicMaterial({ color: PALETTE[4], transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
const beacon = part(geo.cyl(0.35, 0.6, 9, 12), beaconMat, [0, 4.5, 0], hatch);
const ringMat = new THREE.MeshBasicMaterial({ color: PALETTE[4], transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.15, 32), ringMat);
ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; hatch.add(ring);
// the clock, big and in the world: a Righteous numeral on a sprite that hangs over the hatchling, redrawn once a second
const clockTex = canvasTex(256, 128, () => {});
const clock = new THREE.Sprite(new THREE.SpriteMaterial({ map: clockTex, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
clock.scale.set(4.4, 2.2, 1); clock.position.y = 3.4; hatch.add(clock);
function drawClock(n) {
  const c = clockTex.image.getContext("2d"), w = 256, h = 128, hot = n <= 5;
  c.clearRect(0, 0, w, h); c.font = "96px Righteous, ui-rounded, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
  c.shadowColor = hot ? PALETTE[3] : PALETTE[2]; c.shadowBlur = 18; c.fillStyle = hot ? PALETTE[3] : PALETTE[2]; c.fillText(n + "s", w / 2, h / 2 + 6);
  clockTex.needsUpdate = true;
}
const hudTimer = document.getElementById("rescue-t");
drawClock(RESCUE.time);
function startRescue() {
  Object.assign(R, { on: true, d: S.dist + RESCUE.gap, time: RESCUE.time, secs: -1, fly: 0 });
  S.stage = "rescue"; hatch.visible = true; clock.visible = true; ring.visible = true; beacon.visible = true; turtle.position.set(0, 0, 0); turtle.rotation.set(0, 0, 0);
  sfx.act(); setIntensity(1); rig.kick(8, 0.6); pop("SAVE THE HATCHLING!", "big"); document.body.classList.add("rescue");
}
function endRescue(saved) {
  R.on = false; R.next = S.dist + RESCUE.every; S.stage = "glowtide"; document.body.classList.remove("rescue");
  if (saved) {
    R.saved++; S.bonus += RESCUE.bonus; loop.slowmo(0.35, 1); rig.kick(10, 0.8); rig.shake(0.3, 0.2); sfx.rescue();
    flash.hit(0.35, PALETTE[4]); pop("SAVED! +" + RESCUE.bonus, "big");
    tl.shockwave([S.x, 0.08, -S.dist], { color: PALETTE[4], size: 5, dur: 0.6, flat: true });
    spray.burst([S.x, 0.8, -S.dist], { n: 40, speed: 7, up: 5, life: 0.9, colors: [PALETTE[4], PALETTE[2], "#ffffff"] });
    Object.assign(R, { fly: 1.3, fx: S.x });
  } else { pop("it swam off on its own!", "near"); Object.assign(R, { fly: 1.3, fx: hatch.position.x }); }
}
hooks.start = () => { Object.assign(R, { on: false, next: ACTS[2].at, saved: 0, fly: 0 }); hatch.visible = false; document.body.classList.remove("rescue"); };
hooks.glass = () => { if (R.on) { R.time += 1; pop("+1s", "near"); } return S.wet ? 50 : 25; };
hooks.step = (dt, t) => {
  if (!R.on && !R.fly && S.act >= 2 && S.dist >= R.next) startRescue();
  if (R.on) {
    R.d += RESCUE.speed * dt; R.time -= dt;
    const gap = R.d - S.dist, secs = Math.max(0, Math.ceil(R.time));
    if (secs !== R.secs) { R.secs = secs; drawClock(secs); hudTimer.textContent = secs + "s"; if (secs <= 5 && secs > 0) sfx.tick(); }
    // it tumbles down the middle of the beach, paddling harder and glancing back the closer you get
    const near = M.clamp(1 - gap / 40, 0, 1);
    hatch.position.set(2.1 * Math.sin(t * 0.55), 0, -R.d);
    turtle.rotation.y = Math.sin(t * 1.3) * 0.3 + near * Math.sin(t * 7) * 0.5; turtle.position.y = Math.abs(Math.sin(t * (6 + near * 8))) * (0.08 + near * 0.12);
    for (const f of flippers) f.g.rotation.y = f.side * Math.sin(t * (10 + near * 8) + (f.front ? 0 : 1.6)) * 0.7;
    ring.scale.setScalar(1 + 0.15 * Math.sin(t * 6)); beaconMat.opacity = 0.18 + 0.08 * Math.sin(t * 4) + near * 0.1;
    if (gap <= 1) endRescue(true); else if (R.time <= 0) endRescue(false);
  } else if (R.fly > 0) {
    // the release: the hatchling arcs off the board into the glowing surf and splashes in
    R.fly = Math.max(0, R.fly - dt); const p = 1 - R.fly / 1.3;
    // it stays ahead of the board the whole way, so the kid watches it go home
    const sz = -S.dist - 5 - 14 * p, sx = M.lerp(R.fx, SEA_X + 1.8, p);
    hatch.position.set(sx, 2.4 * Math.sin(Math.PI * p), sz);
    turtle.rotation.x = -p * 6.28; clock.visible = false; ring.visible = false; beacon.visible = false;
    if (R.fly === 0) { hatch.visible = false; tl.shockwave([sx, 0.05, sz], { color: PALETTE[4], size: 3.5, dur: 0.5, flat: true });
      spray.burst([sx, 0.2, sz], { n: 26, speed: 5, up: 4, life: 0.7, colors: [PALETTE[4], "#ffffff"] }); }
  }
};
hooks.state = () => ({ rescue: { on: R.on, time: +R.time.toFixed(2), gap: R.on ? +(R.d - S.dist).toFixed(2) : 0, saved: R.saved } });

tl.shockwave([0, -30, 0], { color: PALETTE[4], size: 1, dur: 0.05, flat: true }); tl.flash([0, -30, 0], { color: PALETTE[4], size: 1, dur: 0.05 });
spray.burst([0, -30, 0], { n: 2, life: 0.05 });
G.warm([hero, glassPool.mesh, spray, wake, streaks, tl, wash, washEdge, sea, moon, hatch]);
shell.show("title");
const loop = startLoop({ step, render: (alpha, t) => { tick(t); render(); }, snapshot, input, G, commands });
