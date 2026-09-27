// Runway Glow-Up — by Aunt Ceci. A 3d runner-3d game on the kit/three toolbox (./lib-2/), look "Blush Runway Couture".
// The model struts a pastel catwalk; every lipstick, dress and hair bow she grabs changes her look, and a full
// makeup + clothes + hair set is a "Full Look" (the Signature). Toolbox API: kit/three/README.md (r170).
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { boot, startLoop, best, M, params } from "./lib-2/core.js";
import { createShell } from "./lib-2/shell.js";
import { createInput } from "./lib-2/input.js";
import { createRig } from "./lib-2/camera.js";
import { tick } from "./lib-2/shaders.js";
import { defineSfx, song, playSong, setIntensity } from "./lib-2/audio.js";
import { mat, geo, part, deform, skyDome, lights, blobShadow, sparkleTex } from "./lib-2/art.js";
import { Sparks, Chunks, Timeline, screenFlash } from "./lib-2/fx.js";
import { body, hitSphere, ringChunks, InstancedPool } from "./lib-2/physics.js";

// ── STRUCTURE ──
const PALETTE = ["#f4d6e0", "#8e7dbe", "#e8467c", "#2b2d42", "#f2c14e"];   // blush · runway lavender · gown pink · hatbox ink · gold
const SLUG = "runway-glowup", ORIENT = "portrait";
// Acts by distance strutted; each has a speed target the ramp eases toward. `at` is where ?at=<name> drops you.
const ACTS = [{ name: "backstage", at: 0, speed: 15 }, { name: "catwalk", at: 360, speed: 21 }, { name: "spotlight", at: 820, speed: 26 },
  { name: "finale", at: 1300, speed: 26 }, { name: "encore", at: 1620, speed: 28 }];   // finale = the Photo Finale (CLIMAX), ~12 s
const LANE_X = [-2.4, 0, 2.4], CHUNK = 40, CHUNKS = 6, ROWS = [-10, -22, -34], SPEED0 = 10, RAMP = 0.8;
// The fixed chunk library: 3 rows × 3 lanes. b = hatbox (hop it) · r = clothes rack (duck it) · l = lipstick ·
// d = dress · w = hair bow · j = a random pickup up high (hop for it) · . = runway. Every row keeps a lane with no b or r.
const PATTERNS = [
  [0, ["l..", ".b.", "..d"]], [0, ["b..", "dw.", "..b"]], [0, [".w.", "..r", "l.."]], [0, ["..b", ".l.", "r.."]],
  [0, ["ldw", "...", ".b."]], [0, [".j.", ".b.", "w.d"]], [1, ["b.r", ".d.", "r.b"]], [1, ["r..", ".bj", "l.r"]],
  [1, [".b.", "w.l", "b.b"]], [1, ["bb.", "..d", "r.r"]], [2, ["b.b", "rj.", ".br"]], [2, ["r.b", "jb.", "b.r"]],
];
const SAFE = [["...", ".l.", "d.w"], ["w..", ".d.", "..l"]];
const FRENZY = [["ldw", "wld", "dwl"], ["dld", "wlw", "ldl"], ["wdw", "lwl", "dld"]];   // the Photo Finale: every lane pays

const G = boot({ canvas: "#view", background: null, bloom: null, toneMapping: "neutral", camera: { fov: 55, near: 0.1, far: 900 },
  errorMessage: "Oh no — the model broke a heel on a bug! Show this to a grown-up:" });
const input = createInput({ swipe: { zone: "#swipe", min: 30, edge: 24 } });   // the whole screen below the HUD
const shell = createShell({ screens: { title: "#title", over: "#over" }, orient: ORIENT, input,
  prompt: { el: "#prompt", text: input.isTouch ? "tap to hit the runway!" : "press space to hit the runway!" },
  onShow: (name) => { if (name === "title" || name === "over") G.quality.probeUp(); } });
shell.hubLink(); shell.rotate("#rotate");
const hud = { score: shell.text("#score"), looks: shell.text("#looks-n"), final: shell.text("#final"), best: shell.text("#best"),
  over: shell.text("#over-t"), overLooks: shell.text("#over-looks") };
const record = best(SLUG), rig = createRig(G.camera, { portraitScale: 1.35 });
const jumper = body({ gravity: -40, jumpV: 13, coyote: 0.08, buffer: 0.12, cut: 0.5 });
const feet = { x: 0, y: 0, z: 0 };   // the body's integration point (y only; x/z are the lane rules')

const S = { screen: "title", stage: "backstage", startStage: "backstage", act: 0, dist: 0, speed: SPEED0, lane: 1, x: 0, y: 0, duck: 0,
  score: 0, bonus: 0, items: 0, chain: 0, looks: 0, laneT: 9, dying: 0, cause: "", safeUntil: 80, t: 0, run: 0, book: [], bannerT: 0, pap: 0 };
let track = null;   // ringChunks, made once the art exists

const actIndex = (d) => ACTS.reduce((k, a, i) => (d >= a.at ? i : k), 0);
function freeChunk(obj) { for (const it of obj.userData.items) KINDS[it.kind].free(it); obj.userData.items.length = 0; }
function rollChunk(obj, z, k) {   // ringChunks' recycle: re-dress the chunk for its act and re-roll a pattern from the library
  freeChunk(obj);
  const start = k * CHUNK, act = actIndex(start);
  dressChunk(obj, act, k);
  const pool = PATTERNS.filter(([tier]) => tier <= Math.min(act, 2)), rows = act === 3 ? M.pick(FRENZY) : start < S.safeUntil ? M.pick(SAFE) : M.pick(pool)[1];
  rows.forEach((row, r) => [...row].forEach((ch, lane) => {
    const kind = { b: "box", r: "rack", l: "lip", d: "dress", w: "bow", j: M.pick(["lip", "dress", "bow"]) }[ch]; if (!kind) return;
    const it = { kind, lane, x: LANE_X[lane], y: ch === "j" ? 2.1 : 0, z: z + ROWS[r] + M.rand(-2, 2), passed: false, hit: false, ph: M.rand(0, 6.28) };
    KINDS[kind].spawn(it); obj.userData.items.push(it);
  }));
}
function startRun() {
  const i = Math.max(0, ACTS.findIndex((a) => a.name === S.startStage));
  Object.assign(S, { screen: "play", act: i, stage: ACTS[i].name, dist: ACTS[i].at, speed: i ? ACTS[i].speed : SPEED0, lane: 1, x: 0, y: 0, duck: 0,
    score: 0, bonus: 0, items: 0, chain: 0, looks: 0, laneT: 9, dying: 0, cause: "", safeUntil: ACTS[i].at + 80, t: 0, run: 0, book: [], bannerT: 0, pap: 0 });
  feet.y = 0; jumper.vel.set(0, 0, 0); jumper.grounded = true;
  track.reset(); track.update(S.dist);
  hud.score(0); hud.looks(0); shell.show("play"); juice.start(i);
}
function lose(cause) {   // the hit: a beat of hitstop and slow-mo in the world, then the over card
  if (S.dying || S.screen !== "play") return;
  S.dying = 0.9; S.cause = cause; loop.hitstop(90); loop.slowmo(0.35, 0.5); juice.hit(cause);
}
function over() {
  if (S.screen === "over") return;
  S.screen = "over"; S.dying = 0;
  const r = record.submit(S.score);
  hud.final(S.score); hud.best(r.best); hud.overLooks(S.looks); hud.over(S.act >= 3 ? "what a show!" : S.cause === "rack" ? "snagged!" : "tripped!");
  shell.show("over"); juice.over(r.isNew);
}
function stepPlay(dt, t) {
  S.t += dt;
  const a = actIndex(S.dist);
  if (a !== S.act) { S.act = a; S.stage = ACTS[a].name; juice.act(a); }
  S.speed = M.approach(S.speed, ACTS[S.act].speed, RAMP * dt);
  S.dist += S.speed * dt; S.run += S.speed * dt; track.update(S.dist);
  // lanes: keys and swipes share one path; the model eases to the lane centre in ~110 ms
  const left = input.pressed("left") || input.pressed("swipeLeft"), right = input.pressed("right") || input.pressed("swipeRight");
  const jump = input.pressed("up") || input.pressed("swipeUp") || input.pressed("a"), duck = input.pressed("down") || input.pressed("swipeDown");
  if (left && S.lane > 0) { S.lane--; S.laneT = 0; juice.lane(-1); }
  if (right && S.lane < 2) { S.lane++; S.laneT = 0; juice.lane(1); }
  S.laneT += dt; S.x = M.damp(S.x, LANE_X[S.lane], 18, dt);
  if (duck) { S.duck = 0.6; if (!jumper.grounded) jumper.vel.y = -30; juice.duck(); }
  S.duck = Math.max(0, S.duck - dt);
  const j = jumper.step(feet, { jump: jump && S.duck <= 0, jumpHeld: true }, dt); S.y = feet.y;
  if (j.jumped) { juice.jump(); } if (j.landed) juice.land(j.hard);
  // collisions: the model is a sphere that shrinks and sinks while she drops into a low pose
  const hz = -S.dist, me = { x: S.x, y: S.y + (S.duck > 0 ? 0.3 : 0.55), z: hz }, rMe = S.duck > 0 ? 0.35 : 0.5;
  track.each((obj) => { for (const it of obj.userData.items) {
    if (it.hit) continue;
    KINDS[it.kind].move(it, dt, t, hz);
    const c = KINDS[it.kind].sphere(it);
    if (hitSphere(me, rMe, c, c.r)) {
      if (KINDS[it.kind].pick) { it.hit = true; S.items++; S.chain++; const v = collect(it) * (S.act === 3 ? 4 : 1); S.bonus += v; KINDS[it.kind].free(it); juice.pickup(it, S.chain, v); }
      else if (!params.god) { it.hit = true; lose(it.kind); return; }
    } else if (!it.passed && it.z > hz + 0.9) {
      it.passed = true;
      if (KINDS[it.kind].pick) S.chain = 0;
      else if (Math.abs(it.x - S.x) < 1.2 || S.laneT < 0.5) { S.bonus += 5; juice.dodge(it); }
    }
  } });
  S.score = Math.floor(S.run) + S.bonus;
  hud.score(S.score); hud.looks(S.looks);
}
function step(dt, t) {
  if (S.screen === "play" && !S.dying) stepPlay(dt, t);
  else if (S.screen === "play") { S.dying -= dt; if (S.dying <= 0) over(); }
  else if (input.pressed("start") && shell.canAccept()) startRun();
  world(dt, t);   // ART: everything that moves on every screen, so the title card sits over a live world
}
const snapshot = () => ({
  screen: S.screen, stage: S.stage, frenzy: S.act === 3, lookbook: S.book.length, score: S.score, best: record.get(), speed: +S.speed.toFixed(2), items: S.items, chain: S.chain,
  looks: S.looks, look: { lip: !!LOOK.lip, dress: !!LOOK.dress, bow: !!LOOK.bow }, hair: LOOK.hair,
  entities: track ? trackCount() : 0,
  focus: { lane: S.lane, x: +S.x.toFixed(3), y: +S.y.toFixed(3), z: +(-S.dist).toFixed(3) },
});
function trackCount() { let n = 0; track.each((o) => { n += o.userData.items.length; }); return n; }
const commands = {
  die: () => { S.cause = S.cause || "box"; over(); },
  at: (stage) => { if (!ACTS.some((a) => a.name === String(stage))) return; S.startStage = String(stage); if (S.screen === "play") startRun(); },
};

// ── ART ──
const C = { blush: PALETTE[0], lav: PALETTE[1], pink: PALETTE[2], ink: PALETTE[3], gold: PALETTE[4],
  skin: "#e7b08c", hair: "#4a2a20", white: "#fff6f1", pale: "#d9ccf2", tile: "#a597d1", plum: "#5b3f7a", mint: "#9fe3cf" };
const SHADES = ["#e8467c", "#9b5de5", "#3dccc7", "#f2c14e", "#ff8a5b", "#2b2d42", "#ff5da2"];   // dress + bow colors off the rack
const HAIRS = ["#4a2a20", "#e9b949", "#ff5da2", "#7fb7ff", "#9b5de5"];                          // brunette, then a new color with every bow
const LIPS = ["#c1121f", "#e8467c", "#9d4edd", "#ff6f91", "#8a2c2c"];                           // lipstick shades, in turn
const EYES = ["#9b5de5", "#3dccc7", "#f2c14e", "#ff8a5b", "#e8467c"];                           // eyeshadow that comes with each
const scene = G.scene;
// the room: a two-stop blush → lilac sky, height fog pooling pink along the runway floor
const SKY = [{ top: "#c7b3ee", hor: "#f4d6e0", fog: "#f1d3e2" }, { top: "#6a4c93", hor: "#c9a4d8", fog: "#cdb0de" }, { top: "#2e2447", hor: "#e8467c", fog: "#b77aa6" },
  { top: "#fff1c9", hor: "#ffc2dc", fog: "#ffe0ec" }, { top: "#3a1f5c", hor: "#f2c14e", fog: "#c48ab0" }]
  .map((s) => ({ top: new THREE.Color(s.top), hor: new THREE.Color(s.hor), fog: new THREE.Color(s.fog) }));
const sky = skyDome(scene, { top: "#c7b3ee", horizon: "#f4d6e0", bottom: "#f4d6e0", fog: { mode: "height", color: "#f1d3e2", top: 16, bottom: 0, density: 0.0085 } });
const lit = lights(scene, { preset: "hemi+sun", sky: "#fff4f8", ground: C.lav, sun: "#fff0e6", sunIntensity: 2.1, hemiIntensity: 1.5 });

// vertex-coloured merged geometry: one draw call per prop set, faceted by flat shading (the lowpoly-pastel lane)
const VC = mat.lambert("#ffffff", { flat: true }); VC.vertexColors = true;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
function piece(g, hex, [x = 0, y = 0, z = 0] = [], [rx = 0, ry = 0, rz = 0] = [], sc = 1) {
  const out = g.index ? g.toNonIndexed() : g.clone(), col = new THREE.Color(hex), n = out.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
  out.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  const s3 = Array.isArray(sc) ? sc : [sc, sc, sc];
  out.applyMatrix4(_m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(s3[0], s3[1], s3[2])));
  return out;
}
const merge = (parts) => mergeGeometries(parts.map((p) => { for (const k of Object.keys(p.attributes)) if (!["position", "normal", "color"].includes(k)) p.deleteAttribute(k); return p; }));
const DRESS_PATH = "M-0.16 0.5 L0.16 0.5 L0.2 0.2 L0.13 0.05 L0.5 -0.62 L-0.5 -0.62 L-0.13 0.05 L-0.2 0.2 Z";   // a little A-line gown

// ── the runway chunk: tiled catwalk + gold edge lights + a truss arch, then two dressings (backstage / show)
function runwayGeo() {
  const p = [];
  for (let i = 0; i < 8; i++) p.push(piece(geo.box(8.4, 0.3, 5), i % 2 ? C.lav : C.tile, [0, -0.15, -2.5 - i * 5]));
  for (let i = 0; i < 16; i++) for (const sx of [-1, 1]) p.push(piece(geo.sphere(0.13, 6), C.gold, [sx * 4.05, 0.08, -1.25 - i * 2.5]));
  for (const sx of [-1, 1]) { p.push(piece(geo.box(0.12, 0.06, 40), C.white, [sx * 1.2, 0.01, -20])); p.push(piece(geo.cyl(0.14, 0.18, 6.4, 6), C.gold, [sx * 4.7, 3.2, -1])); }
  p.push(piece(geo.box(9.8, 0.35, 0.35), C.gold, [0, 6.4, -1]));
  for (const sx of [-3, -1, 1, 3]) p.push(piece(geo.cone(0.35, 0.6, 6), C.ink, [sx, 6.0, -1], [Math.PI, 0, 0]));
  return merge(p);
}
function backstageGeo() {   // vanity mirrors ringed with bulbs, dress rails, blush walls
  const p = [];
  for (const sx of [-1, 1]) {
    p.push(piece(geo.box(0.4, 7, 40), C.blush, [sx * 8.4, 3.5, -20]));
    for (const z of [-8, -28]) {
      p.push(piece(geo.box(1.4, 0.9, 2.6), C.white, [sx * 6.6, 0.45, z]));
      p.push(piece(geo.rbox(0.2, 2.2, 2.4, 0.08), C.gold, [sx * 7.3, 2.1, z]));
      p.push(piece(geo.box(0.1, 1.8, 2.0), C.pale, [sx * 7.18, 2.1, z]));
      for (let b = 0; b < 5; b++) p.push(piece(geo.sphere(0.12, 6), C.white, [sx * 7.1, 1.25 + b * 0.42, z - 1.12]), piece(geo.sphere(0.12, 6), C.white, [sx * 7.1, 1.25 + b * 0.42, z + 1.12]));
      p.push(piece(geo.lathe([[0.001, 0], [0.12, 0], [0.12, 0.3], [0.08, 0.34], [0.08, 0.5], [0.001, 0.56]], 8), SHADES[(z + 8) ? 0 : 2], [sx * 6.5, 0.9, z + 0.7]));
    }
    p.push(piece(geo.box(0.08, 0.08, 6), C.gold, [sx * 6.2, 2.5, -18]));
    for (let d = 0; d < 6; d++) p.push(piece(geo.extrude(DRESS_PATH, 0.08), SHADES[(d + (sx > 0 ? 3 : 0)) % SHADES.length], [sx * 6.2, 1.85, -15.6 - d * 0.95], [0, Math.PI / 2, 0], 1.1));
  }
  return merge(p);
}
function showGeo() {   // the fashion-show crowd: tiered risers, seated guests, photographers' pit
  const p = [];
  for (const sx of [-1, 1]) {
    for (let r = 0; r < 3; r++) {
      p.push(piece(geo.box(1.6, 0.5 + r * 0.6, 40), r % 2 ? C.plum : C.ink, [sx * (5.8 + r * 1.6), 0.25 + r * 0.3, -20]));
      for (let g = 0; g < 9; g++) {
        const z = -2.5 - g * 4.3 - r * 1.4, y = 0.5 + r * 0.6, x = sx * (5.8 + r * 1.6), c = SHADES[(g * 3 + r + (sx > 0 ? 1 : 0)) % SHADES.length];
        p.push(piece(geo.lathe([[0.001, 0], [0.34, 0], [0.26, 0.55], [0.14, 0.75], [0.001, 0.78]], 6), c, [x, y, z]));
        p.push(piece(geo.sphere(0.2, 6), (g + r) % 3 ? C.skin : "#8d5a3b", [x, y + 0.95, z]));
        if ((g + r) % 4 === 0) p.push(piece(geo.cyl(0.32, 0.32, 0.05, 8), C.ink, [x, y + 1.1, z]), piece(geo.cyl(0.16, 0.18, 0.2, 8), C.ink, [x, y + 1.2, z]));
      }
    }
  }
  return merge(p);
}
function pitGeo() {   // the Photo Finale's paparazzi pit: crouched photographers along both runway edges, cameras up
  const p = [];
  for (const sx of [-1, 1]) for (let g = 0; g < 7; g++) {
    const z = -3 - g * 5.6 - (sx > 0 ? 2.4 : 0), x = sx * 4.75;
    p.push(piece(geo.lathe([[0.001, 0], [0.3, 0], [0.26, 0.5], [0.12, 0.66], [0.001, 0.68]], 6), g % 2 ? C.ink : C.plum, [x, 0, z]));
    p.push(piece(geo.sphere(0.17, 6), g % 3 ? C.skin : "#8d5a3b", [x, 0.82, z]));
    p.push(piece(geo.box(0.34, 0.24, 0.2), C.ink, [x - sx * 0.12, 0.84, z - 0.2]), piece(geo.cyl(0.08, 0.1, 0.22, 8), C.ink, [x - sx * 0.12, 0.84, z - 0.36], [Math.PI / 2, 0, 0]));
    p.push(piece(geo.box(0.2, 0.1, 0.12), C.white, [x - sx * 0.12, 1.02, z - 0.2]));
  }
  return merge(p);
}
const G_RUN = runwayGeo(), G_BACK = backstageGeo(), G_SHOW = showGeo(), G_PIT = pitGeo();
function buildChunk() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(G_RUN, VC));
  const back = new THREE.Mesh(G_BACK, VC), show = new THREE.Mesh(G_SHOW, VC), pit = new THREE.Mesh(G_PIT, VC); g.add(back, show, pit);
  g.userData = { items: [], back, show, pit };
  scene.add(g); return g;
}
function dressChunk(obj, act) { obj.userData.back.visible = act === 0; obj.userData.show.visible = act > 0; obj.userData.pit.visible = act >= 3; }

// ── pickups and obstacles: each kind is one InstancedPool (one draw call)
const LIP_GEO = merge([piece(geo.lathe([[0.001, 0], [0.16, 0], [0.16, 0.42], [0.13, 0.44], [0.001, 0.44]], 8), C.gold),
  piece(geo.lathe([[0.001, 0.44], [0.11, 0.44], [0.11, 0.72], [0.06, 0.86], [0.001, 0.8]], 8), "#ffffff")]);
const DRESS_GEO = merge([piece(geo.extrude(DRESS_PATH, 0.14), "#ffffff", [0, 0.1, 0], [0, 0, 0], 1.25), piece(geo.torus(0.1, 0.025), "#f6e7ff", [0, 0.82, 0])]);
const BOW_GEO = merge([piece(geo.extrude("M0 0 L-0.55 0.34 L-0.48 -0.34 Z", 0.16), "#ffffff"), piece(geo.extrude("M0 0 L0.55 0.34 L0.48 -0.34 Z", 0.16), "#ffffff"),
  piece(geo.sphere(0.13, 6), "#ffe3ef", [0, 0, 0.08])]);
const BOX_GEO = merge([piece(geo.cyl(0.6, 0.6, 0.72, 10), C.ink, [0, 0.36, 0]), piece(geo.cyl(0.64, 0.64, 0.12, 10), C.pink, [0, 0.76, 0]),
  piece(geo.cyl(0.61, 0.61, 0.12, 10), C.gold, [0, 0.36, 0]), piece(geo.torus(0.14, 0.04), C.gold, [0, 0.86, 0], [Math.PI / 2, 0, 0])]);
const RACK_GEO = merge([piece(geo.cyl(0.05, 0.05, 2.1, 6), C.gold, [-1.05, 1.05, 0]), piece(geo.cyl(0.05, 0.05, 2.1, 6), C.gold, [1.05, 1.05, 0]),
  piece(geo.box(2.3, 0.08, 0.08), C.gold, [0, 2.05, 0]), piece(geo.box(0.5, 0.06, 0.4), C.ink, [-1.05, 0.03, 0]), piece(geo.box(0.5, 0.06, 0.4), C.ink, [1.05, 0.03, 0]),
  ...[-0.7, 0, 0.7].map((x, i) => piece(geo.extrude(DRESS_PATH, 0.1), [C.ink, C.pink, C.plum][i], [x, 1.62, 0], [0, 0, 0], 0.85))]);
const P = {
  lip: new InstancedPool(scene, LIP_GEO, VC, { max: 40, colors: true, cull: false }),
  dress: new InstancedPool(scene, DRESS_GEO, VC, { max: 40, colors: true, cull: false }),
  bow: new InstancedPool(scene, BOW_GEO, VC, { max: 40, colors: true, cull: false }),
  box: new InstancedPool(scene, BOX_GEO, VC, { max: 40, cull: false }),
  rack: new InstancedPool(scene, RACK_GEO, VC, { max: 40, cull: false }),
};
let lipTurn = 0;
function pickKind(name, scale, lift) {
  return { pick: true,
    spawn(it) { it.color = name === "lip" ? LIPS[lipTurn++ % LIPS.length] : M.pick(SHADES); it.id = P[name].spawn({ x: it.x, y: it.y + lift, z: it.z, scale, color: it.color }); },
    free(it) { if (it.id != null) P[name].free(it.id); it.id = null; },
    move(it, dt, t) { if (it.id != null) P[name].set(it.id, { y: it.y + lift + Math.sin(t * 3 + it.ph) * 0.12, rotY: t * 2.2 + it.ph }); },
    sphere(it) { return { x: it.x, y: it.y + 0.7, z: it.z, r: 0.6 }; } };
}
function wallKind(name, cy, r) {
  return { pick: false,
    spawn(it) { it.id = P[name].spawn({ x: it.x, y: 0, z: it.z, rotY: name === "box" ? it.ph : 0 }); },
    free(it) { if (it.id != null) P[name].free(it.id); it.id = null; },
    move() {}, sphere(it) { return { x: it.x, y: cy, z: it.z, r }; } };
}
const KINDS = { lip: pickKind("lip", 1.5, 0.25), dress: pickKind("dress", 1.2, 0.75), bow: pickKind("bow", 1.1, 0.85), box: wallKind("box", 0.4, 0.5), rack: wallKind("rack", 1.35, 0.45) };

// ── the model: a lathe gown and bodice, capsule limbs, a deformed hairdo that grows with every bow
const hero = new THREE.Group(), model = new THREE.Group(); hero.add(model); scene.add(hero);
const M_SKIN = mat.lambert(C.skin, { flat: true }), M_GOWN = mat.lambert(C.pink, { flat: true }), M_HAIR = mat.lambert(C.hair, { flat: true });
const M_LIPS = mat.lambert("#c98a78", { flat: true }), M_BOW = mat.lambert(C.pink, { flat: true }), M_SHADOW = mat.lambert(C.skin, { flat: true });
const M_INK = mat.lambert(C.ink, { flat: true }), M_GOLD = mat.lambert(C.gold, { flat: true }), M_BLUSH = mat.lambert("#f08aa0", { flat: true });
const legs = [-1, 1].map((sx) => { const g = new THREE.Group(); g.position.set(sx * 0.1, 0.98, 0); model.add(g);
  part(geo.capsule(0.075, 0.78), M_SKIN, [0, -0.47, 0], g); part(geo.rbox(0.13, 0.12, 0.3, 0.04), M_INK, [0, -0.93, -0.04], g);
  part(geo.cyl(0.02, 0.02, 0.16, 5), M_INK, [0, -0.92, 0.1], g); return g; });
const SKIRTS = [   // each dress off the rack is a new silhouette: A-line → ball gown → mermaid
  geo.lathe([[0.001, 0], [0.52, 0], [0.47, 0.12], [0.33, 0.45], [0.2, 0.72], [0.19, 0.8]], 10),
  geo.lathe([[0.001, 0], [0.72, 0], [0.74, 0.1], [0.62, 0.32], [0.38, 0.58], [0.2, 0.76], [0.19, 0.8]], 12),
  geo.lathe([[0.001, 0], [0.46, 0], [0.34, 0.1], [0.14, 0.3], [0.17, 0.55], [0.2, 0.75], [0.19, 0.8]], 10)];
let dressTurn = 0;
const skirt = part(SKIRTS[0], M_GOWN, [0, 0.5, 0], model);
part(geo.lathe([[0.19, 0], [0.24, 0.18], [0.23, 0.32], [0.15, 0.42], [0.001, 0.43]], 10), M_GOWN, [0, 1.3, 0], model);
part(geo.torus(0.2, 0.035), M_GOLD, [0, 1.31, 0], model, { rot: [Math.PI / 2, 0, 0] });
const arms = [-1, 1].map((sx) => { const g = new THREE.Group(); g.position.set(sx * 0.26, 1.66, 0); g.rotation.z = sx * 0.18; model.add(g);
  part(geo.capsule(0.055, 0.5), M_SKIN, [0, -0.3, 0], g); return g; });
part(geo.cyl(0.055, 0.06, 0.16, 6), M_SKIN, [0, 1.8, 0], model);
const head = new THREE.Group(); head.position.set(0, 2.02, 0); model.add(head);
part(geo.sphere(0.19, 10), M_SKIN, [0, 0, 0], head);
part(deform(geo.sphere(0.215, 10), { amount: 0.05, seed: 4 }), M_HAIR, [0, 0.06, 0.085], head, { scale: [1.02, 1, 0.9] });
const makeup = [];   // eyeshadow + blush: bare until her first lipstick
for (const sx of [-1, 1]) {   // the face (seen on the title and over cards): eyes, eyeshadow, blush, lips
  part(geo.sphere(0.028, 6), M_INK, [sx * 0.07, 0.03, -0.172], head);
  makeup.push(part(geo.sphere(0.04, 6), M_SHADOW, [sx * 0.07, 0.062, -0.168], head, { scale: [1.2, 0.45, 0.5] }),
    part(geo.sphere(0.045, 6), M_BLUSH, [sx * 0.11, -0.03, -0.158], head, { scale: [1, 0.55, 0.4] }));
}
part(geo.sphere(0.05, 8), M_LIPS, [0, -0.09, -0.172], head, { scale: [1.3, 0.55, 0.6] });
const hairdos = [   // tier 1: a high bun · tier 2: + a swinging ponytail · tier 3: + a big volume crown
  part(geo.sphere(0.12, 8), M_HAIR, [0, 0.2, 0.1], head),
  part(geo.capsule(0.07, 0.4), M_HAIR, [0, -0.08, 0.26], head, { rot: [0.35, 0, 0] }),
  part(deform(geo.sphere(0.28, 8), { amount: 0.08, seed: 9 }), M_HAIR, [0, 0.12, 0.1], head, { scale: [1.15, 0.9, 1] }),
];
const bow = new THREE.Group(); head.add(bow); bow.position.set(0, 0.2, 0.2);
part(geo.cone(0.09, 0.2, 5), M_BOW, [-0.1, 0, 0], bow, { rot: [0, 0, Math.PI / 2] });
part(geo.cone(0.09, 0.2, 5), M_BOW, [0.1, 0, 0], bow, { rot: [0, 0, -Math.PI / 2] });
part(geo.sphere(0.05, 6), M_BOW, [0, 0, 0], bow);
const shadow = blobShadow(scene, { radius: 0.6, opacity: 0.25 });
const GLOWING = [M_SKIN, M_GOWN, M_HAIR, M_INK, M_GOLD, M_BOW];   // her own emissive wash (pickup shimmer, the hit)
const heroGlow = (k, hex) => { for (const m of GLOWING) { m.emissive.set(hex); m.emissiveIntensity = k; } };

// ── the Signature: the Look. Makeup, clothes and hair each change the model; all three = a Full Look
const LOOK = { lip: null, dress: null, bow: null, hair: 0 };
const slotEl = { lip: document.querySelector("#s-lip"), dress: document.querySelector("#s-dress"), bow: document.querySelector("#s-bow") };
const compact = document.querySelector("#compact").getContext("2d");
const face = { lips: "#c98a78", shadow: C.skin, gown: C.pink, bow: null, hair: 0, hairc: C.hair };
function drawCompact(c = compact, f = face) {   // the mirror compact: her face, close up, wearing a look (the HUD's, or a lookbook page)
  const w = 160, cx = 80, face = f;
  c.clearRect(0, 0, w, w);
  c.fillStyle = C.gold; c.beginPath(); c.arc(cx, cx, 78, 0, 7); c.fill();
  c.fillStyle = "#fbe9ef"; c.beginPath(); c.arc(cx, cx, 68, 0, 7); c.fill();
  c.save(); c.beginPath(); c.arc(cx, cx, 68, 0, 7); c.clip();
  c.fillStyle = face.gown; c.beginPath(); c.ellipse(cx, 160, 58, 34, 0, 0, 7); c.fill();
  c.fillStyle = face.hairc; c.beginPath(); c.ellipse(cx, 74, 44 + face.hair * 5, 46 + face.hair * 4, 0, 0, 7); c.fill();
  if (face.hair >= 1) { c.beginPath(); c.arc(cx, 26 - face.hair * 2, 18 + face.hair * 3, 0, 7); c.fill(); }
  if (face.hair >= 2) { c.beginPath(); c.ellipse(cx + 44, 110, 12, 30, -0.3, 0, 7); c.fill(); }
  c.fillStyle = C.skin; c.beginPath(); c.ellipse(cx, 84, 32, 40, 0, 0, 7); c.fill(); c.fillRect(cx - 10, 118, 20, 20);
  c.fillStyle = face.shadow; for (const sx of [-1, 1]) { c.beginPath(); c.ellipse(cx + sx * 14, 74, 10, 6, 0, Math.PI, 0); c.fill(); }
  c.fillStyle = C.ink; for (const sx of [-1, 1]) { c.beginPath(); c.arc(cx + sx * 14, 78, 4, 0, 7); c.fill(); }
  if (face.shadow !== C.skin) { c.fillStyle = "rgba(240,120,150,.55)"; for (const sx of [-1, 1]) { c.beginPath(); c.arc(cx + sx * 20, 94, 7, 0, 7); c.fill(); } }
  c.fillStyle = face.lips; c.beginPath(); c.ellipse(cx, 104, 11, 5, 0, 0, 7); c.fill();
  if (face.bow) { c.fillStyle = face.bow; c.beginPath(); c.moveTo(cx + 26, 40); c.lineTo(cx + 6, 28); c.lineTo(cx + 8, 52); c.moveTo(cx + 26, 40); c.lineTo(cx + 46, 28); c.lineTo(cx + 44, 52); c.fill(); }
  c.restore();
}
function paintSlots() { for (const k of ["lip", "dress", "bow"]) slotEl[k].classList.toggle("on", !!LOOK[k]); }
function resetLook() {
  Object.assign(LOOK, { lip: null, dress: null, bow: null, hair: 0 });
  Object.assign(face, { lips: "#c98a78", shadow: C.skin, gown: C.pink, bow: null, hair: 0, hairc: C.hair });
  M_GOWN.color.set(C.pink); M_LIPS.color.set("#c98a78"); M_HAIR.color.set(C.hair); dressTurn = 0; skirt.geometry = SKIRTS[0];
  hairdos.forEach((h) => { h.visible = false; }); bow.visible = false; makeup.forEach((m) => { m.visible = false; });
  paintSlots(); drawCompact();
}
function collect(it) {   // the glow-up: returns the points this pickup is worth
  const k = it.kind; LOOK[k] = it.color;
  if (k === "lip") { const e = EYES[(lipTurn + 4) % EYES.length]; M_LIPS.color.set(it.color); M_SHADOW.color.set(e); makeup.forEach((m) => { m.visible = true; }); face.lips = it.color; face.shadow = e; }
  if (k === "dress") { M_GOWN.color.set(it.color); face.gown = it.color; pose.flare = 0.8; skirt.geometry = SKIRTS[++dressTurn % SKIRTS.length]; }
  if (k === "bow") { LOOK.hair = Math.min(3, LOOK.hair + 1); hairdos.forEach((h, i) => { h.visible = i < LOOK.hair; }); bow.visible = true; M_BOW.color.set(it.color); face.bow = it.color; face.hair = LOOK.hair;
    const hc = HAIRS[(S.items + LOOK.hair) % HAIRS.length]; M_HAIR.color.set(hc); face.hairc = hc; }
  let v = 25;
  if (LOOK.lip && LOOK.dress && LOOK.bow) { S.looks++; v += 100 * S.looks; S.book.push({ ...face }); juice.fullLook(); LOOK.lip = LOOK.dress = LOOK.bow = null; }
  paintSlots(); drawCompact();
  return v;
}

// ── juice: this game's own responses
const sparks = new Sparks(scene, { colors: [C.gold, C.white, C.pink], max: 320, size: 0.45, map: sparkleTex(), blending: "normal" });
const confetti = new Chunks(scene, { colors: SHADES, max: 160, geometry: "tetra" });
const tl = new Timeline(scene, { colors: [C.white, C.gold] });
const flash = screenFlash("#flash", { color: "#ffffff" });
const sfx = defineSfx({
  swish: { noise: { f0: 2600, f1: 900, dur: 0.12, vol: 0.12, q: 2 }, throttle: 0.07 },
  heel: [{ tone: { type: "square", f0: 1900, f1: 1500, dur: 0.03, vol: 0.07 } }, { tone: { type: "square", f0: 1600, f1: 1300, dur: 0.03, vol: 0.06 }, at: 0.09 }],
  hop: { tone: { type: "triangle", f0: 523, f1: 880, dur: 0.14, vol: 0.14 } },
  sparkle: [{ tone: { type: "sine", f0: 1568, dur: 0.06, vol: 0.18 } }, { tone: { type: "sine", f0: 2093, dur: 0.08, vol: 0.16 }, at: 0.06 }, { tone: { type: "triangle", f0: 2637, dur: 0.14, vol: 0.1 }, at: 0.12 }],
  shutter: [{ noise: { f0: 6000, f1: 2500, dur: 0.06, vol: 0.3, type: "highpass" } }, { noise: { f0: 4000, dur: 0.04, vol: 0.22, type: "highpass" }, at: 0.1 },
    { tone: { type: "sine", f0: 784, f1: 1568, dur: 0.3, vol: 0.18 }, at: 0.12 }],
  rip: [{ noise: { f0: 1400, f1: 250, dur: 0.4, vol: 0.35 } }, { tone: { type: "sawtooth", f0: 330, f1: 110, dur: 0.45, vol: 0.16 } }],
}, { seed: 3 });
// the motif: "strike a pose — make-up, fash-ion, glow-up!" on a D dorian walk, 116 bpm, 808 runway beat
const tune = song({ bpm: 116, key: 62, scale: "dorian", bars: 4, seed: 11,
  motif: [74, null, 74, 77, 76, null, 74, 72, 69, null, 72, 74, 77, 79, 77, null],
  voices: { lead: { wave: "triangle", env: [0.01, 0.1, 0.55, 0.18] }, bass: { wave: "square", env: [0.01, 0.08, 0.5, 0.1] }, drums: { kit: "808", pattern: "k.h.s.hkk.h.s.h." } } });
const pose = { flare: 0, lean: 0, fall: 0, flash: 0, spin: 0 };
const scoreEl = document.querySelector("#score"), bannerEl = document.querySelector("#banner");
function pop(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
function banner(text, sec) { bannerEl.textContent = text; bannerEl.hidden = false; pop(bannerEl, "in"); S.bannerT = sec; }
const juice = {
  start(i) { playSong(tune); setIntensity(i ? 1 : 0.55); resetLook(); pose.fall = 0; pose.flare = 0.5; sparks.clear(); confetti.clear(); },
  act(a) {
    setIntensity(1); flash.hit(0.5, C.white); sfx.shutter(); rig.kick(5, 0.4);
    if (a === 3) { banner("Photo Finale! ×4", 2.6); flash.hit(0.9, C.gold); rig.kick(12, 0.7); rig.shake(0.2, 0.3); pose.spin = 1;
      confetti.burst({ x: S.x, y: 3, z: -S.dist - 6 }, { colors: [C.gold, C.pink, C.white, C.lav], n: 60, speed: 9, up: [5, 10] }); }
    if (a === 4) { banner("Encore!", 1.8); sfx.sparkle(); }
  },
  lane(d) { pose.lean = -d * 0.22; pose.flare = Math.max(pose.flare, 0.2); sfx.swish(); },
  duck() { sfx.swish(); pose.flare = 0.3; },
  jump() { sfx.hop(); pose.flare = 0.4; },
  land(hard) { pose.flare = 0.7; sfx.heel(); rig.shake(hard ? 0.22 : 0.1, 0.15); tl.shockwave({ x: S.x, y: 0.04, z: -S.dist }, { color: C.gold, size: 1.8, dur: 0.35, flat: true }); },
  pickup(it, chain) {
    sparks.burst({ x: it.x, y: it.y + 1, z: it.z }, { colors: [it.color, C.gold, C.white], n: 18, speed: 5, up: 3, life: 0.6, grav: -4 }); sfx.sparkle();
    pose.flash = 1; pop(scoreEl, "pop");
    if (chain % 5 === 0) { rig.kick(4, 0.3); flash.hit(0.3, C.gold); }
  },
  fullLook() {   // the paparazzi moment: shutter, white flash, a twirl, confetti in the new look's colors
    pose.spin = 1; banner(`Look #${S.looks}!`, 1.2); flash.hit(0.75, C.white); sfx.shutter(); rig.kick(7, 0.45); rig.shake(0.15, 0.2);
    confetti.burst({ x: S.x, y: 2, z: -S.dist - 1 }, { colors: [LOOK.lip, LOOK.dress, LOOK.bow, C.gold], n: 44, speed: 7, up: [4, 8] });
    tl.shockwave({ x: S.x, y: 1.2, z: -S.dist }, { color: C.pink, size: 3.5, dur: 0.5 });
  },
  dodge(it) { sparks.burst({ x: it.x, y: 0.6, z: it.z }, { colors: [C.white], n: 6, speed: 3, life: 0.35 }); },
  hit() { sfx.rip(); rig.shake(0.5, 0.3); pose.fall = 1e-3; },
  over() { renderBook(); },
};

function world(dt, t) {
  const playing = S.screen === "play";
  // the strut: legs cross the centre line, hips sway, arms swing, skirt swishes and flares on every beat
  const ph = playing ? S.run * 0.9 : t * 2.2, moving = playing && !S.dying;
  const sw = moving ? Math.sin(ph) : Math.sin(t * 1.6) * 0.15;
  legs[0].rotation.x = sw * 0.55; legs[1].rotation.x = -sw * 0.55;
  arms[0].rotation.x = -sw * 0.4; arms[1].rotation.x = sw * 0.4;
  if (playing && S.y > 0.05) { legs[0].rotation.x = -0.6; legs[1].rotation.x = 0.3; }
  pose.flare = M.damp(pose.flare, 0, 5, dt); pose.lean = M.damp(pose.lean, 0, 7, dt); pose.flash = M.damp(pose.flash, 0, 6, dt);
  skirt.scale.set(1 + pose.flare * 0.35, 1 - pose.flare * 0.12, 1 + pose.flare * 0.35);
  skirt.rotation.y = Math.sin(ph * 2) * 0.25;
  model.rotation.z = sw * 0.06 + pose.lean; model.position.x = Math.sin(ph) * 0.04;
  model.scale.y = M.damp(model.scale.y, playing && S.duck > 0 ? 0.5 : 1, 20, dt);
  if (pose.fall) { pose.fall = Math.min(1, pose.fall + dt * 3); model.rotation.x = -pose.fall * 1.1; } else model.rotation.x = 0;
  pose.spin = Math.max(0, pose.spin - dt / 0.6); model.rotation.y = pose.spin > 0 ? (1 - pose.spin) * Math.PI * 2 : 0;   // the Full-Look twirl
  if (S.bannerT > 0) { S.bannerT -= dt; if (S.bannerT <= 0) bannerEl.hidden = true; }
  if (LOOK.hair >= 2) hairdos[1].rotation.z = Math.sin(ph) * 0.3;
  heroGlow(Math.max(pose.flash * 0.45, S.dying ? 0.6 : 0), S.dying ? C.pink : C.white);
  hero.position.set(S.x, S.y, -S.dist); hero.rotation.y = playing ? 0 : Math.PI;
  shadow.follow(S.x, 0.02, -S.dist, S.y);
  // camera: behind her on the runway; a slow orbit around her face on the cards
  if (playing) rig.follow(hero, { back: 6.6, up: 3.4, lookUp: 1.6, lookAhead: 6, yawFollow: false, k: 8 });
  else rig.fixed([S.x + 1.1 + Math.sin(t * 0.3) * 0.4, 2.0, -S.dist + 4.6], [S.x, 3.35, -S.dist], { k: 3 });   // her cover shot: face on, low in frame under the title
  rig.update(dt, t);
  // act colors tween (never swapped in one frame)
  const g = SKY[S.act], k = 1 - Math.exp(-1.5 * dt);
  sky.uniforms.uTop.value.lerp(g.top, k); sky.uniforms.uHorizon.value.lerp(g.hor, k); sky.uniforms.uBottom.value.lerp(g.hor, k);
  if (scene.fog) scene.fog.color.lerp(g.fog, k);
  sparks.update(dt); confetti.update(dt); tl.update(dt); flash.update(dt);
  if (playing && S.act === 3 && !S.dying) paparazzi(dt);
}

// ── CLIMAX (polish layer) ──
// The "frenzy" climax — the Photo Finale. At 1300 u (≈ 70 s in) the sky tweens to studio-white gold, the paparazzi pit
// crouches along both edges, every lane fills with makeup, gowns and bows for ~12 s at 4× value, and camera flashes
// pop all along the crowd. Then the Encore: plum night, faster, the run continues endless.
function paparazzi(dt) {
  S.pap -= dt; if (S.pap > 0) return;
  S.pap = M.rand(0.07, 0.16);
  const sx = M.pick([-1, 1]), z = -S.dist - M.rand(6, 48), x = sx * M.pick([4.75, 5.8, 7.4]);
  sparks.burst({ x, y: M.rand(0.9, 2.4), z }, { colors: [C.white, "#fffbe0"], n: 9, speed: 2.5, life: 0.22, grav: 0 });
  if (Math.random() < 0.25) flash.hit(0.1, C.white);
}
function renderBook() {   // the Lookbook on the over card: a mirror compact for every Full Look she wore this show
  const el = document.querySelector("#lookbook"); el.textContent = "";
  for (const f of S.book.slice(-6)) { const cv = document.createElement("canvas"); cv.width = cv.height = 160; el.append(cv); drawCompact(cv.getContext("2d"), f); }
  el.hidden = !S.book.length;
}

track = ringChunks({ count: CHUNKS, length: CHUNK, build: buildChunk, recycle: rollChunk });
track.reset(); track.update(0);
resetLook();
function coverLook() {   // the title card shows the goal: a finished look on the cover
  M_LIPS.color.set("#c1121f"); M_SHADOW.color.set("#9b5de5"); makeup.forEach((m) => { m.visible = true; });
  hairdos[0].visible = true; bow.visible = true; M_BOW.color.set(C.gold);
  Object.assign(face, { lips: "#c1121f", shadow: "#9b5de5", bow: C.gold, hair: 1 }); drawCompact();
}
coverLook();
G.warm([...Object.values(P).map((p) => p.mesh), sparks, confetti, tl, hero, ...hairdos, bow]);
shell.show("title");
const loop = startLoop({ step, render: (alpha, t) => { tick(t); for (const p of Object.values(P)) p.sync(); }, snapshot, input, G, commands });
