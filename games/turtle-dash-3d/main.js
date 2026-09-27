// Turtle Dash 3D — by Uncle Cory. A 3d runner-3d game on the kit/three toolbox (./lib-2/), look "Tidepool Toon".
// The exemplar lane runner: the STRUCTURE region below is what catalog/runner-3d.md tells every new runner to copy
// (loop wiring, the title → play → over machine, the chunk library, lanes, jump/duck, collisions, hooks, commands).
// ART is this game's alone (never copied). The CLIMAX region is the polish layer. API: kit/three/README.md (r170).
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { boot, startLoop, best, M, params } from "./lib-2/core.js";
import { createShell } from "./lib-2/shell.js";
import { createInput } from "./lib-2/input.js";
import { createRig } from "./lib-2/camera.js";
import { tick, waterMat, wind } from "./lib-2/shaders.js";
import { defineSfx, song, playSong, setIntensity } from "./lib-2/audio.js";
import { Sparks, Timeline, Trail, Streaks, screenFlash } from "./lib-2/fx.js";
import { mat, part, geo, deform, canvasTex, skyDome, starfield, lights, blobShadow, scatter } from "./lib-2/art.js";
import { ringChunks, InstancedPool, Pool, body, hitSphere } from "./lib-2/physics.js";

// ── STRUCTURE ──
const PALETTE = ["#1b1b3a", "#0f4c5c", "#2ec4b6", "#ff7a59", "#f6d7a7"];   // ink · deep sea · surf · sunset coral · sand
const SLUG = "turtle-dash-3d", ORIENT = "portrait";
// Acts by distance run; each has a speed target the ramp eases toward. `at` is where ?at=<name> drops you.
const ACTS = [{ name: "beach", at: 0, speed: 15 }, { name: "pier", at: 360, speed: 21 }, { name: "night", at: 820, speed: 26 }];
const LANE_X = [-2.4, 0, 2.4], CHUNK = 40, CHUNKS = 6, ROWS = [-10, -22, -34], SPEED0 = 10, RAMP = 0.8;
// The fixed chunk library: 3 rows × 3 lanes. c = crab (hop it) · g = gull (duck it) · i = ice cream · j = ice cream up high
// (hop for it) · . = sand. Every row keeps at least one lane with no c or g, so no chunk is ever unwinnable. [tier, rows]
const PATTERNS = [
  [0, ["i..", ".c.", "..i"]], [0, ["c..", "ii.", "..c"]], [0, [".i.", "..g", "i.."]], [0, ["..c", ".i.", "g.."]],
  [0, ["iii", "...", ".c."]], [0, [".j.", ".c.", "i.i"]], [1, ["c.g", ".i.", "g.c"]], [1, ["g..", ".cj", "i.g"]],
  [1, [".c.", "i.i", "c.c"]], [1, ["cc.", "..i", "g.g"]], [2, ["c.c", "gj.", ".cg"]], [2, ["g.c", "jc.", "c.g"]],
];
const SAFE = [["...", ".i.", "i.i"], ["i..", ".i.", "..i"]];

const G = boot({ canvas: "#view", background: null, bloom: { strength: 0.5, radius: 0.5, threshold: 0.92 },
  toneMapping: "neutral", camera: { fov: 55, near: 0.1, far: 1000 },
  errorMessage: "Oh no — the turtle tripped on a bug and flipped over! Show this to a grown-up:" });
const input = createInput({ swipe: { zone: "#swipe", min: 30, edge: 24 } });   // the whole screen below the HUD
const shell = createShell({ screens: { title: "#title", over: "#over" }, orient: ORIENT, input,
  prompt: { el: "#prompt", text: input.isTouch ? "swipe or tap to run!" : "press space to run!" },
  onShow: (name) => { if (name === "title" || name === "over") G.quality.probeUp(); } });
shell.hubLink(); shell.rotate("#rotate");
const hud = { score: shell.text("#score"), cones: shell.text("#cone-n"), final: shell.text("#final"), best: shell.text("#best"), over: shell.text("#over-t") };
const record = best(SLUG), rig = createRig(G.camera, { portraitScale: 1.35 });
const jumper = body({ gravity: -40, jumpV: 13, coyote: 0.08, buffer: 0.12, cut: 0.5 });
const feet = { x: 0, y: 0, z: 0 };   // the body's integration point (y only; x/z are the lane rules')

const S = { screen: "title", stage: "beach", startStage: "beach", act: 0, dist: 0, speed: SPEED0, lane: 1, x: 0, y: 0, duck: 0,
  score: 0, bonus: 0, cones: 0, chain: 0, laneT: 9, dying: 0, cause: "", safeUntil: 80, t: 0, run: 0 };
let track = null;   // ringChunks, made in init() once the art exists
const hooks = { rows: null, cone: null, save: null, jump: null, step: null, state: null };   // the polish layer plugs in here

const actIndex = (d) => ACTS.reduce((k, a, i) => (d >= a.at ? i : k), 0);
function freeChunk(obj) { for (const it of obj.userData.items) KINDS[it.kind].free(it); obj.userData.items.length = 0; }
function rollChunk(obj, z, k) {   // ringChunks' recycle: re-dress the chunk for its act and re-roll a pattern from the library
  freeChunk(obj);
  const start = k * CHUNK, act = actIndex(start);
  dressChunk(obj, act, k);
  const pool = PATTERNS.filter(([tier]) => tier <= act), rows = start < S.safeUntil ? M.pick(SAFE) : (hooks.rows && hooks.rows(act)) || M.pick(pool)[1];
  rows.forEach((row, r) => [...row].forEach((ch, lane) => {
    const kind = { c: "crab", g: "gull", i: "cone", j: "cone" }[ch]; if (!kind) return;
    const it = { kind, lane, x: LANE_X[lane], y: ch === "j" ? 2.1 : 0, z: z + ROWS[r] + M.rand(-2, 2), passed: false, hit: false, ph: M.rand(0, 6.28) };
    KINDS[kind].spawn(it); obj.userData.items.push(it);
  }));
  if (act === 0) for (let n = 0; n < 3; n++) KINDS.shell.spawn({ kind: "shell", x: M.pick([-3.9, 3.9, M.rand(-5.5, -4.5)]), y: 0, z: z - M.rand(2, 38), ph: M.rand(0, 6.28) }, obj);
}
function startRun() {
  const i = Math.max(0, ACTS.findIndex((a) => a.name === S.startStage));
  Object.assign(S, { screen: "play", act: i, stage: ACTS[i].name, dist: ACTS[i].at, speed: i ? ACTS[i].speed : SPEED0, lane: 1, x: 0, y: 0, duck: 0,
    score: 0, bonus: 0, cones: 0, chain: 0, laneT: 9, dying: 0, cause: "", safeUntil: ACTS[i].at + 80, t: 0, run: 0 });
  feet.y = 0; jumper.vel.set(0, 0, 0); jumper.grounded = true;
  track.reset(); track.update(S.dist);
  hud.score(0); hud.cones(0); shell.show("play"); juice.start(i);
}
function lose(cause) {   // the hit: a beat of hitstop and slow-mo in the world, then the over card
  if (S.dying || S.screen !== "play") return;
  S.dying = 0.9; S.cause = cause; loop.hitstop(90); loop.slowmo(0.35, 0.5); juice.hit(cause);
}
function over() {
  if (S.screen === "over") return;
  S.screen = "over"; S.dying = 0;
  const r = record.submit(S.score);
  hud.final(S.score); hud.best(r.best); hud.over(S.cause === "gull" ? "bonked!" : S.cause === "crab" ? "pinched!" : "splash!");
  shell.show("over"); juice.over(r.isNew);
}
function stepPlay(dt, t) {
  S.t += dt;
  const a = actIndex(S.dist);
  if (a !== S.act) { S.act = a; S.stage = ACTS[a].name; juice.act(a); }
  S.speed = M.approach(S.speed, ACTS[S.act].speed, RAMP * dt);
  S.dist += S.speed * dt; S.run += S.speed * dt; track.update(S.dist);
  // lanes: keys and swipes share one path; the hero eases to the lane centre in ~110 ms
  const left = input.pressed("left") || input.pressed("swipeLeft"), right = input.pressed("right") || input.pressed("swipeRight");
  const jump = input.pressed("up") || input.pressed("swipeUp") || input.pressed("a"), duck = input.pressed("down") || input.pressed("swipeDown");
  if (left && S.lane > 0) { S.lane--; S.laneT = 0; juice.lane(-1); }
  if (right && S.lane < 2) { S.lane++; S.laneT = 0; juice.lane(1); }
  S.laneT += dt; S.x = M.damp(S.x, LANE_X[S.lane], 18, dt);
  if (duck) { S.duck = 0.6; if (!jumper.grounded) jumper.vel.y = -30; juice.duck(); }
  S.duck = Math.max(0, S.duck - dt);
  const j = jumper.step(feet, { jump: jump && S.duck <= 0, jumpHeld: true }, dt); S.y = feet.y;
  if (j.jumped) { S.chain = 0; juice.jump(); if (hooks.jump) hooks.jump(); } if (j.landed) juice.land(j.hard);
  // collisions: the hero is a sphere that shrinks and sinks while ducking (the head goes in the shell)
  const hz = -S.dist, me = { x: S.x, y: S.y + (S.duck > 0 ? 0.3 : 0.55), z: hz }, rMe = S.duck > 0 ? 0.35 : 0.5;
  track.each((obj) => { for (const it of obj.userData.items) {
    if (it.hit || it.kind === "shell") continue;
    KINDS[it.kind].move(it, dt, t, hz);
    const c = KINDS[it.kind].sphere(it);
    if (hitSphere(me, rMe, c, c.r)) {
      if (it.kind === "cone") { it.hit = true; S.cones++; S.chain++; const v = hooks.cone ? hooks.cone(it) : 25; S.bonus += v; KINDS.cone.free(it); juice.pickup(it, S.chain, v); }
      else if (!params.god) { it.hit = true; if (!(hooks.save && hooks.save(it))) { lose(it.kind); return; } }
    } else if (!it.passed && it.z > hz + 0.9) {
      it.passed = true;
      if (it.kind !== "cone" && (Math.abs(it.x - S.x) < 1.2 || S.laneT < 0.5)) { S.bonus += 5; juice.dodge(it); }
    }
  } });
  S.score = Math.floor(S.run) + S.bonus;
  hud.score(S.score); hud.cones(S.cones);
  if (hooks.step) hooks.step(dt, t);
}
function step(dt, t) {
  if (S.screen === "play" && !S.dying) stepPlay(dt, t);
  else if (S.screen === "play") { S.dying -= dt; if (S.dying <= 0) over(); }
  else if (input.pressed("start") && shell.canAccept()) startRun();
  world(dt, t);   // ART: everything that moves on every screen, so the title card sits over a live world
}
const snapshot = () => ({
  screen: S.screen, stage: S.stage, score: S.score, best: record.get(), speed: +S.speed.toFixed(2), cones: S.cones, chain: S.chain,
  entities: track ? track_count() : 0,
  focus: { lane: S.lane, x: +S.x.toFixed(3), y: +S.y.toFixed(3), z: +(-S.dist).toFixed(3) },
  ...(hooks.state ? hooks.state() : {}),
});
function track_count() { let n = 0; track.each((o) => { n += o.userData.items.length; }); return n; }
const commands = {
  die: () => { S.cause = S.cause || "crab"; over(); },
  at: (stage) => { if (!ACTS.some((a) => a.name === String(stage))) return; S.startStage = String(stage); if (S.screen === "play") startRun(); },
};

// ── ART ──
// Tidepool Toon: a late-afternoon beach seen by a Wind-Waker camera. Toon 3-step ramp, 3 px ink hulls in the palette's
// ink (never black), a sunset dome fogging into the horizon, bloom only on the glowing ice-cream scoops.
const [INK, SEA, SURF, CORAL, SAND] = PALETTE;
const TINT = { wetSand: "#e2b98a", bark: "#a8743f", frond: "#1f9a86", skin: "#8fe0c9", white: "#fffaf0", waffle: "#d9a066",
  plank: "#c8925b", gullGrey: "#b9c7cc", beak: "#ffa04a", foam: "#fff6e6" };
const scene = G.scene;
const inkOpt = { px: 3, color: INK };
const toonV = (steps = 3) => { const m = mat.toon("#ffffff", { steps }); m.vertexColors = true; return m; };   // vertex-coloured merged models
const V3 = (a) => new THREE.Vector3(...a);
function build(parts) {   // [geometry, hex, pos, rot, scale] → one merged, vertex-coloured BufferGeometry (one draw call + one ink hull)
  return mergeGeometries(parts.map(([g, hex, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]]) => {
    const q = g.index ? g.toNonIndexed() : g.clone();
    for (const k of Object.keys(q.attributes)) if (k !== "position" && k !== "normal") q.deleteAttribute(k);
    q.applyMatrix4(new THREE.Matrix4().compose(V3(p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), V3(s)));
    const c = new THREE.Color(hex), n = q.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    q.setAttribute("color", new THREE.BufferAttribute(a, 3)); return q;
  }));
}

// sky, sun, light, fog — each act has its own gradient; world() eases toward it so an act change is a 2 s sunset
const SKIES = [
  { top: "#35b8c4", horizon: "#ffd3a1", bottom: SAND, sun: "#ffe0bf", sunI: 1.9, hemiS: "#e8fbff", hemiG: SAND, hemiI: 1.0, disc: "#ff9f7a", stars: false },
  { top: "#2a7f99", horizon: "#ffb08a", bottom: "#f3c79a", sun: "#ffc49c", sunI: 1.8, hemiS: "#ffe4d0", hemiG: "#e8a57f", hemiI: 1.0, disc: CORAL, stars: false },
  { top: INK, horizon: "#1f5f73", bottom: SEA, sun: "#a9c4ff", sunI: 1.1, hemiS: "#6f86c9", hemiG: INK, hemiI: 1.0, disc: SAND, stars: true },
];
const sky = skyDome(scene, { top: SKIES[0].top, horizon: SKIES[0].horizon, bottom: SKIES[0].bottom, fog: { mode: "linear-horizon", near: 45, far: 150 } });
const stars = starfield(scene, { n: 500, radius: 700, size: 2, tints: [SAND, TINT.white, SURF] }); stars.visible = false;
const light = lights(scene, { preset: "hemi+sun", sky: SKIES[0].hemiS, ground: SKIES[0].hemiG, sun: SKIES[0].sun, sunIntensity: 1.9, hemiIntensity: 1.0 });
const discMat = mat.unlit(SKIES[0].disc); discMat.fog = false;
const disc = new THREE.Mesh(new THREE.CircleGeometry(26, 40), discMat); scene.add(disc);
const skyGoal = { i: 0 };
const skyCols = { top: sky.uniforms.uTop.value, hor: sky.uniforms.uHorizon.value, bot: sky.uniforms.uBottom.value };
const _c = new THREE.Color();
function easeSky(dt) {
  const s = SKIES[skyGoal.i], k = 1 - Math.exp(-dt * 1.6);
  skyCols.top.lerp(_c.set(s.top), k); skyCols.hor.lerp(_c.set(s.horizon), k); skyCols.bot.lerp(_c.set(s.bottom), k);
  scene.fog.color.copy(skyCols.hor);
  light.sun.color.lerp(_c.set(s.sun), k); light.sun.intensity += (s.sunI - light.sun.intensity) * k;
  light.hemi.color.lerp(_c.set(s.hemiS), k); light.hemi.groundColor.lerp(_c.set(s.hemiG), k);
  discMat.color.lerp(_c.set(s.disc), k); stars.visible = s.stars;
}

// the sea: one waterMat plane with its foamy shore along the right edge of the lanes; it follows the run
const sea = new THREE.Mesh(new THREE.PlaneGeometry(420, 140).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2),
  waterMat({ deep: SEA, shallow: SURF, foam: TINT.foam, scale: 0.09, speed: 0.5, shore: 0.035, roughness: 0.5 }));
sea.position.set(4.2 + 70, -0.08, 0); scene.add(sea);

// ground textures: wet sand with shell-dotted lane grooves and foam lace; boardwalk planks for the pier and night
const sandTex = canvasTex(128, 256, (g, w, h) => {
  g.fillStyle = TINT.wetSand; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 700; i++) { g.fillStyle = i % 3 ? "#d6ab7c" : "#efcfa0"; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  g.fillStyle = "#cf9f70"; for (const x of [w / 3, (2 * w) / 3]) g.fillRect(x - 2, 0, 4, h);
  g.fillStyle = SAND; for (const x of [w / 3, (2 * w) / 3]) for (let y = 8; y < h; y += 32) { g.beginPath(); g.ellipse(x, y, 4, 3, 0, 0, 7); g.fill(); }
  g.strokeStyle = TINT.foam; g.lineWidth = 3; g.beginPath();
  for (let y = 0; y <= h; y += 4) g.lineTo(w - 6 + Math.sin(y * 0.12) * 4, y); g.stroke();
}, { repeat: [1, 2] });
const plankTex = canvasTex(128, 128, (g, w, h) => {
  const tones = [TINT.plank, "#b98450", "#d29d66", "#c08a55"];
  for (let y = 0, k = 0; y < h; y += 16, k++) { g.fillStyle = tones[k % 4]; g.fillRect(0, y, w, 16); g.fillStyle = "#4a3040"; g.fillRect(0, y + 14, w, 2);
    g.fillStyle = "#6b4a3a"; for (const x of [6, w / 3 + 4, (2 * w) / 3 + 4, w - 8]) g.fillRect(x, y + 6, 2, 2); }
  g.fillStyle = "#9c6c40"; for (const x of [w / 3, (2 * w) / 3]) g.fillRect(x - 1, 0, 2, h);
}, { repeat: [1, 5] });
const sandMat = mat.toon("#ffffff"); sandMat.map = sandTex;
const plankMat = mat.toon("#ffffff"); plankMat.map = plankTex;
const groundGeo = new THREE.PlaneGeometry(8.4, CHUNK).rotateX(-Math.PI / 2).translate(0, 0, -CHUNK / 2);

// dunes: one shared, z-periodic geometry so the chunks tile without a seam
const duneH = (x, z) => { const k = M.clamp((-x - 4.2) / 7, 0, 1), s = k * k * (3 - 2 * k);
  return s * (1.3 + 0.8 * Math.sin((z * Math.PI * 2) / CHUNK + x * 0.21) + 0.45 * Math.sin((z * Math.PI * 4) / CHUNK - x * 0.4)); };
const duneGeo = new THREE.PlaneGeometry(40, CHUNK, 22, 22).rotateX(-Math.PI / 2).translate(-24.2, 0, -CHUNK / 2);
{ const P = duneGeo.attributes.position; for (let i = 0; i < P.count; i++) P.setY(i, duneH(P.getX(i), P.getZ(i))); duneGeo.computeVertexNormals(); }
const duneMat = mat.toon(SAND);

// palms: one merged, vertex-coloured model, scattered per chunk and swaying in the wind (shaders.wind)
const palmGeo = (() => {
  const parts = [];
  for (let s = 0; s < 6; s++) { const y = s * 0.85, bend = 0.05 * y * y; parts.push([geo.cyl(0.17 - s * 0.017, 0.2 - s * 0.017, 0.9, 8), s % 2 ? TINT.bark : "#8f6134", [bend, y + 0.45, 0], [0, 0, -0.12]]); }
  const top = [0.05 * 5.1 * 5.1, 5.2, 0], leaf = geo.extrude("M0 0 Q0.9 0.42 2.1 0.05 Q1.1 0.12 0 -0.12 Z", 0.05, { bevel: 0.02 });
  for (let f = 0; f < 7; f++) parts.push([leaf, f % 2 ? TINT.frond : "#16806f", top, [Math.PI / 2 - 0.1, (f / 7) * Math.PI * 2, -0.55 - (f % 3) * 0.12]]);
  for (let c = 0; c < 3; c++) parts.push([geo.sphere(0.16, 10), "#6b4a2b", [top[0] + Math.cos(c * 2.1) * 0.25, 4.95, Math.sin(c * 2.1) * 0.25]]);
  return build(parts);
})();
const palmMat = wind(toonV(), { amp: 0.03, freq: 0.35, axis: "x" });

// beach decor (umbrellas, towels, a sandcastle) and pier decor (railing, lamp posts, a snack shack) — merged per chunk
function umbrella(parts, x, z, a, b) {
  const y0 = duneH(x, z) - 0.1;
  parts.push([geo.cyl(0.05, 0.05, 2.3, 6), TINT.white, [x, y0 + 1.15, z]]);
  for (let w = 0; w < 6; w++) parts.push([new THREE.LatheGeometry([[0, 0.55], [0.75, 0.28], [1.3, 0]].map(([r, y]) => new THREE.Vector2(r, y)), 3, (w * Math.PI) / 3, Math.PI / 3), w % 2 ? a : b, [x, y0 + 2.1, z]]);
}
function beachDecorGeo(v) {
  const p = [];
  umbrella(p, -6.4 - v, -12, CORAL, TINT.white); umbrella(p, -8.5 + v, -31, SURF, TINT.white);
  p.push([geo.box(1.1, 0.04, 1.9), v ? SURF : CORAL, [-6.1 - v, 0.05, -14.5], [0, 0.3, 0]], [geo.box(0.36, 0.05, 1.9), TINT.white, [-6.1 - v, 0.06, -14.5], [0, 0.3, 0]]);
  p.push([geo.cyl(0.55, 0.7, 0.6, 10), "#e9c48d", [-5.4, 0.3, -24 - v * 4]], [geo.cone(0.28, 0.6, 8), "#e9c48d", [-5.4, 0.9, -24 - v * 4]],
    [geo.cone(0.18, 0.4, 6), "#e9c48d", [-5.0, 0.65, -23.6 - v * 4]], [geo.box(0.03, 0.3, 0.2), CORAL, [-5.4, 1.35, -24 - v * 4]]);
  return build(p);
}
const pierDecorGeo = (() => {
  const p = [];
  for (let z = -2; z > -CHUNK; z -= 4) p.push([geo.cyl(0.09, 0.09, 1.2, 6), "#8a5a3c", [4.55, 0.6, z]]);
  p.push([geo.box(0.14, 0.12, CHUNK), "#a06a44", [4.55, 1.2, -CHUNK / 2]], [geo.box(0.08, 0.08, CHUNK), "#8a5a3c", [4.55, 0.7, -CHUNK / 2]]);
  for (const z of [-8, -28]) p.push([geo.cyl(0.045, 0.06, 3.4, 6), SEA, [-4.7, 1.7, z]], [geo.box(0.7, 0.05, 0.05), SEA, [-4.4, 3.35, z]]);
  p.push([geo.box(3, 2.2, 3.4), SAND, [-8.2, 1.1, -18]], [geo.cone(2.7, 1.3, 4), CORAL, [-8.2, 2.85, -18], [0, Math.PI / 4, 0]],
    [geo.box(3.1, 0.25, 0.5), TINT.white, [-6.6, 1.2, -18], [0, Math.PI / 2, 0]]);
  return build(p);
})();
const lampGeo = build([[geo.sphere(0.24, 10), TINT.white, [-4.1, 3.15, -8]], [geo.sphere(0.24, 10), TINT.white, [-4.1, 3.15, -28]]]);
const lampMat = mat.toon(SAND, { emissive: SAND, emissiveIntensity: 0 });
const decorMat = toonV(); decorMat.side = THREE.DoubleSide;   // umbrella canopies are open lathes
const beachDecor = [beachDecorGeo(0), beachDecorGeo(1.2)];

function buildChunk(i) {   // one chunk, built once; rollChunk/dressChunk only toggle and re-roll
  const c = new THREE.Group(); c.userData.items = [];
  c.userData.ground = part(groundGeo, sandMat, [0, 0, 0], c);
  part(duneGeo, duneMat, [0, 0, 0], c, { ink: inkOpt });
  c.userData.palms = scatter(c, palmGeo, palmMat, { count: 3, area: [-15, -6.5, -38, -2], y: (x, z) => duneH(x, z) - 0.1, scale: [0.8, 1.25], seed: 11 + i * 7 });
  c.userData.beach = part(beachDecor[i % 2], decorMat, [0, 0, 0], c, { ink: inkOpt });
  c.userData.pier = part(pierDecorGeo, decorMat, [0, 0, 0], c, { ink: inkOpt });
  c.userData.lamps = part(lampGeo, lampMat, [0, 0, 0], c);
  scene.add(c); return c;
}
function dressChunk(c, act) {
  const beach = act === 0; c.userData.ground.material = beach ? sandMat : plankMat;
  c.userData.beach.visible = beach; c.userData.pier.visible = !beach; c.userData.lamps.visible = !beach;
}

// the hero: a lathe shell deformed into lumpy scutes (with a painted scute map), capsule legs, a head that ducks INTO the
// shell, and a coral scarf whose tail streams behind as a Trail
const hero = new THREE.Group(), pose = new THREE.Group(); hero.add(pose); scene.add(hero);
const scuteTex = canvasTex(256, 128, (g, w, h) => {
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
  const r = 22, hx = r * 1.5, hy = r * Math.sqrt(3);
  for (let col = -1; col < w / hx + 1; col++) for (let row = -1; row < h / hy + 1; row++) {
    const cx = col * hx, cy = row * hy + (col % 2 ? hy / 2 : 0);
    g.beginPath(); for (let k = 0; k < 6; k++) g.lineTo(cx + r * Math.cos((k * Math.PI) / 3), cy + r * Math.sin((k * Math.PI) / 3)); g.closePath();
    g.fillStyle = (col + row) % 2 ? "#e9fffb" : "#d2f5ef"; g.fill(); g.lineWidth = 6; g.strokeStyle = "#3d6f78"; g.stroke();
  }
  g.fillStyle = "#3d6f78"; g.fillRect(0, h - 10, w, 10);
});
const shellMat = mat.toon(SURF); shellMat.map = scuteTex;
const shellGeo = deform(geo.lathe([[0, 0], [0.58, 0], [0.7, 0.1], [0.68, 0.26], [0.56, 0.44], [0.34, 0.58], [0, 0.64]], 28), { amount: 0.045, scale: 2.4, seed: 3 });
part(shellGeo, shellMat, [0, 0.26, 0.05], pose, { scale: [1, 0.95, 1.22], ink: inkOpt });
part(build([[geo.torus(0.66, 0.08), "#e9c98f", [0, 0, 0], [Math.PI / 2, 0, 0], [1, 1.22, 1]], [geo.sphere(0.6, 16), "#f2dcae", [0, 0.02, 0], [0, 0, 0], [1, 0.28, 1.2]],
  [geo.cone(0.12, 0.35, 8), TINT.skin, [0, 0.02, 0.84], [Math.PI / 2 + 0.3, 0, 0]]]), toonV(), [0, 0.28, 0.05], pose, { ink: inkOpt });
const headG = new THREE.Group(); headG.position.set(0, 0.5, -0.72); pose.add(headG);
part(build([[geo.capsule(0.16, 0.3), TINT.skin, [0, -0.02, 0.05], [Math.PI / 2 - 0.35, 0, 0]], [geo.sphere(0.28, 18), TINT.skin, [0, 0.12, -0.24], [0, 0, 0], [1, 0.9, 1.1]],
  [geo.sphere(0.1, 10), TINT.white, [0.14, 0.22, -0.43]], [geo.sphere(0.1, 10), TINT.white, [-0.14, 0.22, -0.43]],
  [geo.sphere(0.055, 8), INK, [0.15, 0.23, -0.52]], [geo.sphere(0.055, 8), INK, [-0.15, 0.23, -0.52]],
  [geo.sphere(0.06, 8), CORAL, [0.22, 0.07, -0.42], [0, 0, 0], [1, 0.6, 0.6]], [geo.sphere(0.06, 8), CORAL, [-0.22, 0.07, -0.42], [0, 0, 0], [1, 0.6, 0.6]]]),
  toonV(), [0, 0, 0], headG, { ink: inkOpt });
const scarfMat = mat.toon(CORAL);
part(geo.torus(0.2, 0.075), scarfMat, [0, -0.02, 0.1], headG, { rot: [0.35, 0, 0], ink: inkOpt });
const scarfTip = new THREE.Object3D(); scarfTip.position.set(0.12, 0.02, 0.3); headG.add(scarfTip);
const legs = [[0.5, -0.45], [-0.5, -0.45], [0.48, 0.55], [-0.48, 0.55]].map(([x, z]) =>
  part(geo.capsule(0.14, 0.2), mat.toon(TINT.skin), [x, 0.2, z], pose, { rot: [0, 0, x > 0 ? -0.7 : 0.7], ink: inkOpt }));
const heroShadow = blobShadow(scene, { radius: 1.0, opacity: 0.3 });
const scarf = new Trail(scene, scarfTip, { color: CORAL, length: 7, width: 0.2, fade: true, blending: "normal" });
let activeScarf = scarf;   // the polish layer swaps in the gold one
const look = { ripple: SURF, rings: 2 };
// footprints: two rows of little wet dents behind the turtle on the sand
const prints = new InstancedPool(scene, geo.sphere(0.5, 8).clone().scale(1, 0.06, 1.5), mat.toon("#c38d5e"), { max: 40 });
const printIds = []; let printT = 0, printSide = 1;

// crabs, ice creams and shells are instanced pools (one call each + one for their ink); gulls are a Pool of flapping groups
const crabGeo = build([
  [deform(geo.sphere(0.5, 12), { amount: 0.08, scale: 3, seed: 5 }), CORAL, [0, 0.42, 0], [0, 0, 0], [1, 0.55, 0.78]],
  ...[1, -1].flatMap((s) => [
    [geo.cyl(0.04, 0.04, 0.3, 6), "#e8603f", [s * 0.16, 0.72, 0.22]], [geo.sphere(0.1, 8), TINT.white, [s * 0.16, 0.9, 0.24]], [geo.sphere(0.055, 6), INK, [s * 0.16, 0.92, 0.32]],
    ...[-0.18, 0.02, 0.22].map((z) => [geo.cyl(0.05, 0.035, 0.5, 5), "#e8603f", [s * 0.58, 0.24, -z], [0, 0, s * 1.05]]),
    [geo.cyl(0.07, 0.06, 0.42, 6), "#e8603f", [s * 0.5, 0.55, 0.3], [-0.6, 0, s * -0.5]],
    [geo.extrude("M0 0 Q0.5 0 0.46 0.46 L0.24 0.32 L0.3 0.56 Q-0.08 0.54 0 0 Z", 0.14, { bevel: 0.03 }), CORAL, [s * 0.5, 0.66, 0.48], [0, s > 0 ? 0 : Math.PI, 0], [1.3, 1.3, 1.3]],
  ]),
]);
const crabs = new InstancedPool(scene, crabGeo, toonV(), { max: 48, ink: inkOpt });
const waffleTex = canvasTex(64, 64, (g, w, h) => { g.fillStyle = TINT.waffle; g.fillRect(0, 0, w, h); g.strokeStyle = "#a8703a"; g.lineWidth = 3;
  for (let k = -h; k < w; k += 12) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + h, h); g.stroke(); g.beginPath(); g.moveTo(k + h, 0); g.lineTo(k, h); g.stroke(); } }, { repeat: [3, 2] });
const coneMat = mat.toon("#ffffff"); coneMat.map = waffleTex;
const cones = new InstancedPool(scene, geo.lathe([[0, -0.6], [0.06, -0.5], [0.25, 0.02], [0.29, 0.07], [0.22, 0.09], [0, 0.09]], 10), coneMat, { max: 80, ink: inkOpt });
const scoopMat = mat.hot("#ffffff", 1.6); scoopMat.vertexColors = true;
const scoops = new InstancedPool(scene, build([[deform(geo.sphere(0.28, 10), { amount: 0.05, scale: 4, seed: 9 }), "#ffffff", [0, 0.3, 0]],
  [new THREE.TorusGeometry(0.25, 0.07, 5, 14), "#ffffff", [0, 0.14, 0], [Math.PI / 2, 0, 0]], [geo.sphere(0.085, 6), "#ff6a5a", [0.03, 0.62, 0]]]), scoopMat, { max: 80, colors: true, ink: inkOpt });
const FLAVORS = [SAND, "#ffb4a2", "#a6f0e3"];
const shells = new InstancedPool(scene, geo.extrude("M0 0 L-0.32 0.26 Q-0.3 0.52 0 0.58 Q0.3 0.52 0.32 0.26 Z", 0.06, { bevel: 0.02 }).clone().rotateX(-Math.PI / 2),
  mat.toon("#ffffff"), { max: 24, colors: true, ink: { color: INK, px: 2 } });
const gullBody = build([[geo.lathe([[0, -0.5], [0.15, -0.38], [0.22, -0.1], [0.2, 0.2], [0.12, 0.42], [0, 0.52]], 12), TINT.white, [0, 0, 0], [Math.PI / 2, 0, 0]],
  [geo.sphere(0.17, 12), TINT.white, [0, 0.12, 0.5]], [geo.cone(0.055, 0.24, 8), TINT.beak, [0, 0.08, 0.74], [Math.PI / 2, 0, 0]],
  [geo.sphere(0.04, 6), INK, [0.1, 0.18, 0.6]], [geo.sphere(0.04, 6), INK, [-0.1, 0.18, 0.6]], [geo.cone(0.14, 0.3, 4), TINT.gullGrey, [0, 0.02, -0.6], [-Math.PI / 2, 0, 0], [1, 0.4, 1]]]);
const gullWing = [   // an inner and an outer panel, thick enough to read head-on as the classic gull "M"
  build([[geo.extrude("M0 0.2 L0.95 0.26 L0.95 -0.16 Q0.5 -0.28 0 -0.22 Z", 0.09, { bevel: 0.02 }), "#eef3f4", [0, 0, 0], [Math.PI / 2, 0, 0]]]),
  build([[geo.extrude("M0 0.26 Q0.55 0.22 1.0 -0.06 L0.55 -0.12 L0 -0.16 Z", 0.07, { bevel: 0.015 }), "#eef3f4", [0, 0, 0], [Math.PI / 2, 0, 0]],
    [geo.extrude("M0.62 0.12 Q0.85 0.06 1.0 -0.06 L0.7 -0.1 Z", 0.08, { bevel: 0.015 }), "#3a4a5a", [0, 0, 0], [Math.PI / 2, 0, 0]]]),
];
const gullMat = toonV(); gullMat.emissive.set("#4a5560");   // lifts the underside out of the darkest toon band
const gulls = new Pool(scene, () => {
  const g = new THREE.Group(); g.scale.setScalar(1.3); part(gullBody, gullMat, [0, 0, 0], g, { ink: inkOpt });
  g.userData.wings = [1, -1].map((s) => {
    const p = new THREE.Group(), q = new THREE.Group(); p.position.set(s * 0.14, 0.1, 0); p.scale.x = s; g.add(p);
    part(gullWing[0], gullMat, [0, 0, 0], p, { ink: inkOpt }); q.position.x = 0.93; p.add(q); part(gullWing[1], gullMat, [0, 0, 0], q, { ink: inkOpt });
    return [p, q];
  });
  g.userData.shadow = blobShadow(scene, { radius: 0.9, opacity: 0.35 }); g.userData.shadow.mesh.visible = false; return g;
}, { max: 14 });
const gullY = (it, hz) => { const d = hz - it.z; return d > 34 ? 4 : d > 8 ? M.lerp(1.3, 4, M.smoothstep(8, 34, d)) : d > -2 ? 1.3 : 1.3 + (-2 - d) * 0.8; };
const KINDS = {
  crab: { spawn(it) { it.id = crabs.spawn({ x: it.x, y: 0, z: it.z, rotY: 0 }); },
    move(it, dt, t) { it.x = LANE_X[it.lane] + Math.sin(t * 3 + it.ph) * 0.28; crabs.set(it.id, { x: it.x, rotY: Math.sin(t * 6 + it.ph) * 0.25, y: Math.abs(Math.sin(t * 9 + it.ph)) * 0.06 }); },
    sphere: (it) => ({ x: it.x, y: 0.4, z: it.z, r: 0.55 }), free(it) { crabs.free(it.id); } },
  gull: { spawn(it) { it.obj = gulls.spawn({ x: it.x, y: 4, z: it.z }); it.y = 4; },
    move(it, dt, t, hz) { if (!it.obj) return; if (S.screen === "play") it.z += 4 * dt; it.y = gullY(it, hz); it.obj.position.set(it.x, it.y, it.z); it.obj.rotation.x = it.y > 1.4 && hz - it.z > 2 ? 0.55 : 0.1;
      const f = Math.sin(t * 9 + it.ph); for (const [p, q] of it.obj.userData.wings) { p.rotation.z = 0.3 + f * 0.45; q.rotation.z = -0.55 - f * 0.35; }
      const sh = it.obj.userData.shadow; sh.mesh.visible = true; sh.follow(it.x, 0.03, it.z, it.y); },
    sphere: (it) => ({ x: it.x, y: it.y, z: it.z, r: 0.45 }), free(it) { if (!it.obj) return; it.obj.userData.shadow.mesh.visible = false; gulls.free(it.obj); it.obj = null; } },
  cone: { spawn(it) { it.flavor = M.pick(FLAVORS); it.id = cones.spawn({ x: it.x, y: it.y + 0.75, z: it.z }); it.sid = scoops.spawn({ x: it.x, y: it.y + 0.75, z: it.z, color: it.flavor }); },
    move(it, dt, t) { const y = it.y + 0.75 + Math.sin(t * 3 + it.ph) * 0.12, r = t * 2.2 + it.ph; cones.set(it.id, { y, rotY: r }); scoops.set(it.sid, { y, rotY: r }); },
    sphere: (it) => ({ x: it.x, y: it.y + 0.7, z: it.z, r: 0.6 }), free(it) { cones.free(it.id); scoops.free(it.sid); } },
  shell: { spawn(it, chunk) { it.id = shells.spawn({ x: it.x, y: it.x < -4.3 ? duneH(it.x, it.z) + 0.03 : 0.03, z: it.z, rotY: it.ph, scale: 0.8, color: M.pick(["#ffd9c9", SAND, "#ffb49c"]) }); chunk.userData.items.push(it); },
    move() {}, sphere: () => ({ x: 0, y: -99, z: 0, r: 0 }), free(it) { shells.free(it.id); } },
};

// fx and sound: this game's own responses (DESIGN.md → Juice)
const sparks = new Sparks(scene, { colors: [SAND, TINT.foam, CORAL, SURF], max: 400, size: 0.32, blending: "normal" });
const glints = new Sparks(scene, { colors: [TINT.foam, SAND, "#ffb4a2", SURF], max: 200, size: 0.4 });
const rings = new Timeline(scene, { colors: [SURF, TINT.foam] });
const flash = screenFlash("#flash", { color: CORAL });
const streakL = new THREE.Group(), streakR = new THREE.Group(); scene.add(streakL, streakR);
const streaks = [new Streaks(streakL, { color: TINT.foam, n: 18, box: [0.5, 0.5, 4, -50], length: 3 }), new Streaks(streakR, { color: TINT.foam, n: 18, box: [0.5, 0.5, 4, -50], length: 3 })];
const sfx = defineSfx({
  lane: { noise: { f0: 2200, f1: 700, dur: 0.11, vol: 0.16, q: 1.4, type: "bandpass" }, throttle: 0.05 },
  jump: [{ tone: { type: "triangle", f0: 330, f1: 700, dur: 0.14, vol: 0.28 } }, { noise: { f0: 900, f1: 2400, dur: 0.08, vol: 0.08 } }],
  land: [{ noise: { f0: 1200, f1: 250, dur: 0.18, vol: 0.28, type: "lowpass" } }, { tone: { type: "sine", f0: 170, f1: 80, dur: 0.12, vol: 0.3 } }],
  duck: [{ tone: { type: "square", f0: 520, f1: 240, dur: 0.07, vol: 0.12 } }, { tone: { type: "triangle", f0: 240, f1: 180, dur: 0.08, vol: 0.2, at: 0.05 } }],
  cone: [{ tone: { type: "sine", f0: 1047, dur: 0.06, vol: 0.25 } }, { tone: { type: "sine", f0: 1319, dur: 0.06, vol: 0.25 }, at: 0.05 }, { tone: { type: "triangle", f0: 1568, dur: 0.14, vol: 0.2 }, at: 0.1 }],
  dodge: { tone: { type: "triangle", f0: 880, f1: 1320, dur: 0.09, vol: 0.12 }, throttle: 0.15 },
  gull: [{ tone: { type: "sawtooth", f0: 1500, f1: 950, dur: 0.16, vol: 0.06 } }, { tone: { type: "sawtooth", f0: 1400, f1: 850, dur: 0.2, vol: 0.05 }, at: 0.2 }],
  pinch: [{ noise: { f0: 3000, f1: 800, dur: 0.12, vol: 0.4 } }, { tone: { type: "square", f0: 260, f1: 60, dur: 0.4, vol: 0.3 } }, { noise: { f0: 600, f1: 150, dur: 0.35, vol: 0.3, type: "lowpass" }, at: 0.08 }],
  act: [0, 4, 7, 12].map((n, i) => ({ tone: { type: "triangle", f0: 392 * 2 ** (n / 12), dur: 0.16, vol: 0.2 }, at: i * 0.09 })),
}, { seed: 7 });
const tune = song({ bpm: 124, key: 62, scale: "mixolydian", motif: [74, 78, 81, 78, 76, 72, 74, null], bars: 4,
  voices: { lead: { wave: "square", env: [0.01, 0.08, 0.45, 0.12] }, bass: { wave: "triangle", env: [0.01, 0.1, 0.7, 0.1] }, drums: { kit: "toy", pattern: "k.h.s.hkk.h.s.h." } } });
setIntensity(0.25); playSong(tune);

const popEls = [...Array(8)].map(() => { const b = document.createElement("b"); document.getElementById("pops").appendChild(b); return b; });
let popN = 0; const _p = new THREE.Vector3();
function pop(text, cls, x, y, z) {   // a DOM score pop over the world point, in Lilita One
  _p.set(x, y, z).project(G.camera); const b = popEls[popN++ % popEls.length];
  b.textContent = text; b.className = cls || ""; b.style.left = ((_p.x + 1) / 2) * G.size.w + "px"; b.style.top = ((1 - _p.y) / 2) * G.size.h + "px";
  void b.offsetWidth; b.classList.add("go");
}
const newBest = document.getElementById("newbest"), bannerEl = document.getElementById("banner"), bannerT = document.getElementById("banner-t");
function banner(text) { bannerT.textContent = text; bannerEl.hidden = false; bannerEl.classList.remove("go"); void bannerEl.offsetWidth; bannerEl.classList.add("go");
  rings.after(1.6, () => { bannerEl.hidden = true; }); }
const anim = { squash: 0, flip: 0, tilt: 0, run: 0 };
const ACT_BANNERS = ["the beach!", "the pier!", "night swim!"];
const juice = {
  start(i) { sparks.clear(); glints.clear(); rings.clear(); activeScarf.clear(); prints.clear(); printIds.length = 0; bannerEl.hidden = true; skyGoal.i = i; setIntensity(0.5 + i * 0.1); anim.flip = 0; rig.kick(8, 0.4); },
  lane(dir) { sfx.lane(); anim.tilt = -dir * 0.35; if (S.y < 0.1) for (let k = 0; k < 6; k++) sparks.emit(S.x + dir * 0.4, 0.1, -S.dist + 0.4, -dir * M.rand(1, 3), M.rand(1, 3), M.rand(0, 2), M.pick([SAND, TINT.wetSand]), 0.4, 2, -9); },
  jump() { sfx.jump(); anim.squash = -0.35; },
  land(hard) { sfx.land({ vol: hard ? 1.3 : 1 }); anim.squash = hard ? 0.5 : 0.35; rig.shake(hard ? 0.25 : 0.12, 0.1);
    const p = [S.x, 0.04, -S.dist];   // the Signature visual: ripples through the wet sand
    rings.shockwave(p, { color: look.ripple, size: 3.2, dur: 0.55, flat: true }); rings.after(0.12, () => rings.shockwave(p, { color: TINT.foam, size: 2.2, dur: 0.5, flat: true }));
    if (look.rings > 2) rings.after(0.24, () => rings.shockwave(p, { color: look.ripple, size: 4.6, dur: 0.7, flat: true }));
    sparks.burst(p, { colors: [SAND, TINT.foam], n: 10, speed: 3, up: 2, life: 0.4, grav: -10 }); },
  duck() { sfx.duck(); anim.squash = 0.25; },
  pickup(it, chain, value = 25) { sfx.cone({ pitch: 1 + Math.min(chain, 8) * 0.06 }); glints.burst([it.x, it.y + 1, it.z], { colors: [it.flavor, TINT.foam, "#ffb4a2", SURF], n: 18, speed: 6, up: 2, life: 0.55, grav: -8 });
    rings.flash([it.x, it.y + 1, it.z], { color: TINT.foam, size: 2.2, dur: 0.2 }); pop("+" + value, value > 25 ? "gold" : "", it.x, it.y + 1.6, it.z); },
  dodge(it) { sfx.dodge(); pop("+5", "dodge", it.x, 2.2, it.z); },
  hit(cause) { sfx.pinch(); flash.hit(0.55); rig.shake(0.8, 0.35); anim.flip = 0.001; sparks.burst([S.x, 0.8, -S.dist], { colors: [CORAL, SAND, INK], n: 30, speed: 7, up: 4, life: 0.8, grav: -12 });
    pop(cause === "gull" ? "bonk!" : "pinch!", "hit", S.x, 1.8, -S.dist); setIntensity(0); },
  act(i) { sfx.act(); skyGoal.i = i; rig.kick(10, 0.6); rig.shake(0.2, 0.2); setIntensity(0.5 + i * 0.1); banner(ACT_BANNERS[i]); },
  over(isNew) { newBest.hidden = !isNew; },
};

let gullCry = 0;
function world(dt, t) {   // every screen: animate the hero, the gulls, the sea, the sky and the camera
  const hz = -S.dist, playing = S.screen === "play" && !S.dying;
  if (S.screen !== "play") track.each((obj) => { for (const it of obj.userData.items) if (!it.hit) KINDS[it.kind].move(it, dt, t, hz); });
  hero.position.set(S.x, S.y, hz);
  anim.run += dt * (playing ? 6 + S.speed * 0.45 : 3);
  anim.squash *= Math.exp(-dt * 9); anim.tilt *= Math.exp(-dt * 7);
  const tuck = S.duck > 0 ? 1 : 0, air = S.y > 0.05;
  headG.position.z = M.damp(headG.position.z, tuck ? -0.35 : -0.72, 20, dt); headG.position.y = M.damp(headG.position.y, tuck ? 0.35 : 0.5, 20, dt);
  pose.scale.set(1 + anim.squash * 0.5 + tuck * 0.12, 1 - anim.squash - tuck * 0.35, 1 + anim.squash * 0.3);
  pose.rotation.z = anim.tilt; pose.position.y = S.screen === "title" ? Math.abs(Math.sin(anim.run)) * 0.08 : 0;
  if (anim.flip) { anim.flip += dt; pose.rotation.z = Math.min(Math.PI, anim.flip * 9); pose.position.y = Math.min(0.8, anim.flip * 3); }
  legs.forEach((l, k) => { l.rotation.x = air ? (k < 2 ? -0.9 : 0.9) : Math.sin(anim.run + (k === 0 || k === 3 ? 0 : Math.PI)) * 0.8; });
  heroShadow.follow(S.x, 0.02, hz, S.y);
  activeScarf.update(dt);
  if (playing && S.act === 0 && S.y < 0.02 && (printT -= dt) <= 0) {   // footprints on the wet sand
    printT = 0.11; printSide = -printSide; printIds.push(prints.spawn({ x: S.x + printSide * 0.34, y: 0.012, z: hz + 0.3, rotY: printSide * 0.2, scale: 0.2 }));
    if (printIds.length > 36) prints.free(printIds.shift());
  }
  rig.base.fov = playing ? 55 + Math.max(0, S.speed - 10) * 0.3 : 55;
  // gulls cry as they start their swoop
  gullCry -= dt; if (playing) track.each((o) => { for (const it of o.userData.items) if (it.kind === "gull" && !it.cried && hz - it.z < 30) { it.cried = true; if (gullCry <= 0) { sfx.gull(); gullCry = 0.6; } } });
  sea.position.z = hz - 150; disc.position.set(-60, 40, hz - 420); disc.lookAt(G.camera.position);
  streakL.position.set(-4.3, 0.7, hz); streakR.position.set(4.3, 0.7, hz);
  for (const s of streaks) { s.visible = playing; s.update(S.speed, dt); }
  light.follow({ x: S.x, y: 0, z: hz });
  lampMat.emissiveIntensity = M.damp(lampMat.emissiveIntensity, S.act === 2 || S.act === 4 ? 0.7 : 0, 2, dt);
  easeSky(dt); sparks.update(dt); glints.update(dt); rings.update(dt); flash.update(dt);
  // camera: low follow with look-ahead while running; a slow orbit on the title and over cards
  if (S.screen === "play") rig.follow({ x: S.x * 0.7, y: S.y * 0.3, z: hz }, { back: 6, up: 2.9, lookUp: 1.1, lookAhead: 6, yawFollow: false, k: 8 });
  else rig.orbit({ x: S.x, y: 0.4, z: hz }, { radius: 5.2, height: 2.2, speed: 0.22 });
  rig.roll(anim.tilt * 0.08); rig.update(dt, t); gulls.sweep();
}
function render(alpha, t) { tick(t); crabs.sync(); cones.sync(); scoops.sync(); shells.sync(); prints.sync(); }

// ── CLIMAX (polish layer) ──
// "Golden hour" (frenzy): at 1150 m (about a minute in) the sky turns gold, every danger ahead bursts into glitter, ice
// creams rain into all three lanes for 12 s (336 m at 28 u/s, worth double) and the tune's lead voice comes in; then the
// run goes on as "endless" under a purple dusk. The Signature, deepened: 3 ice creams in a row without a hop turn the
// scarf gold — double points, a longer gold scarf trail, a third gold ripple on every landing, and the gold scarf takes
// the next hit for you instead of ending the run.
const GOLD = "#ffcf5a";
ACTS.push({ name: "golden", at: 1150, speed: 28 }, { name: "endless", at: 1150 + 28 * 12, speed: 28 });
SKIES.push(
  { top: CORAL, horizon: GOLD, bottom: "#ffe2a8", sun: "#ffd98a", sunI: 1.9, hemiS: "#fff0c8", hemiG: "#ffb070", hemiI: 1.0, disc: "#fff0b0", stars: false },
  { top: "#3b2d5c", horizon: "#ff9a6a", bottom: SEA, sun: "#ffb58a", sunI: 1.4, hemiS: "#b89ad8", hemiG: INK, hemiI: 1.0, disc: CORAL, stars: true });
ACT_BANNERS.push("golden hour!", "keep going!");
const RAIN = [["iii", "jij", "iii"], ["iji", "iii", "jij"], ["jjj", "iii", "iji"]];   // golden chunks: ice cream in every lane
const scarfGold = new Trail(scene, scarfTip, { color: GOLD, length: 12, width: 0.28, fade: true, blending: "normal" });
const goldSfx = defineSfx({
  gold: [0, 4, 7, 11, 12].map((n, i) => ({ tone: { type: "sine", f0: 784 * 2 ** (n / 12), dur: 0.12, vol: 0.18 }, at: i * 0.06 })),
  saved: [{ noise: { f0: 2400, f1: 500, dur: 0.2, vol: 0.3 } }, { tone: { type: "triangle", f0: 660, f1: 330, dur: 0.25, vol: 0.25 } }],
  plop: { tone: { type: "sine", f0: 1760, f1: 2093, dur: 0.05, vol: 0.06 }, throttle: 0.08 },
}, { seed: 11 });
const chainText = shell.text("#chain-n"), _tip = new THREE.Vector3();
function setGold(on) {
  S.gold = on; activeScarf.clear(); activeScarf = on ? scarfGold : scarf;
  scarfMat.color.set(on ? GOLD : CORAL); look.ripple = on ? GOLD : SURF; look.rings = on ? 3 : 2; document.getElementById("chain").hidden = !on;
}
hooks.cone = () => {
  if (S.chain >= 3 && !S.gold) { setGold(true); goldSfx.gold(); pop("gold scarf!", "gold", S.x, 2.8, -S.dist); rig.kick(6, 0.3); }
  return 25 * (S.gold ? 2 : 1) * (S.act === 3 ? 2 : 1);
};
hooks.save = (it) => {   // the gold scarf takes the hit: the danger bursts, the scarf goes back to coral, the run goes on
  if (!S.gold) return false;
  setGold(false); S.chain = 0; KINDS[it.kind].free(it); loop.hitstop(60); rig.shake(0.5, 0.2); flash.hit(0.35, GOLD); goldSfx.saved();
  glints.burst([it.x, 1, it.z], { colors: [GOLD, TINT.foam, CORAL], n: 30, speed: 8, up: 3, life: 0.7 }); pop("saved!", "gold", S.x, 2.2, -S.dist);
  return true;
};
hooks.state = () => ({ gold: !!S.gold });
function poofDangers() {
  track.each((o) => { for (const it of o.userData.items) if (!it.hit && (it.kind === "crab" || it.kind === "gull") && it.z < -S.dist + 5) {
    glints.burst([it.x, it.kind === "gull" ? it.y : 0.5, it.z], { colors: [GOLD, TINT.foam], n: 12, speed: 5, up: 2, life: 0.6 }); it.hit = true; KINDS[it.kind].free(it);
  } });
}
function climax(i) {
  if (i === 3) { poofDangers(); setIntensity(1); rig.kick(14, 0.8); rig.shake(0.3, 0.3); }
  else if (i === 4) setIntensity(0.85);
}
hooks.rows = (act) => (act === 3 ? M.pick(RAIN) : null);
hooks.step = (dt, t) => {
  chainText(S.act === 3 ? "x4" : "x2");
  if (S.gold && Math.random() < 0.35) { scarfTip.getWorldPosition(_tip); glints.emit(_tip.x, _tip.y, _tip.z, M.rand(-1, 1), M.rand(0.5, 2), M.rand(1, 3), GOLD, 0.5, 2, -2); }
  if (S.act !== 3) return;
  const hz = -S.dist;   // the rain: golden-hour cones fall out of the sky just ahead and plop into their lanes
  track.each((o) => { for (const it of o.userData.items) if (it.kind === "cone" && !it.hit) {
    if (it.base === undefined) { it.base = it.y; it.drop = hz - it.z > 44 ? M.rand(9, 15) : 0; }   // only cones still far ahead fall
    if (it.drop > 0 && hz - it.z < 48) { it.drop = Math.max(0, it.drop - dt * 22); if (!it.drop) { rings.flash([it.x, it.base + 0.8, it.z], { color: GOLD, size: 1.6, dur: 0.2 }); goldSfx.plop(); } }
    it.y = it.base + it.drop;
  } });
  if (Math.random() < 0.5) glints.emit(S.x + M.rand(-5, 5), M.rand(3, 7), hz - M.rand(5, 30), 0, -M.rand(1, 3), 0, M.pick([GOLD, TINT.foam]), 1.2, 0.5, -1);
};
const _start = juice.start, _act = juice.act;
juice.start = (i) => { _start(i); setGold(false); climax(i); };
juice.act = (i) => { _act(i); climax(i); };

function init() {
  track = ringChunks({ count: CHUNKS, length: CHUNK, build: buildChunk, recycle: rollChunk });
  rings.shockwave([0, -5, 0], { color: SURF, flat: true }); rings.flash([0, -5, 0], { color: TINT.foam });   // warm their programs
  const warmGull = gulls.spawn({ x: 0, y: -5, z: 0 }); warmGull.userData.shadow.mesh.visible = true;
  G.warm([hero, stars, crabs.mesh, cones.mesh, scoops.mesh, shells.mesh, warmGull]);
  warmGull.userData.shadow.mesh.visible = false; gulls.free(warmGull);
}
init();
shell.show("title");
const loop = startLoop({ step, render, snapshot, input, G, commands });
