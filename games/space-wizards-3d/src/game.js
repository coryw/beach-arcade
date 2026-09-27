// game.js — the whole game: world, planets, spawning, weapons, the boss, HUD wiring and screens.
// Coordinates: the ship lives on the z=0 plane; "forward" is -z; the world streams toward +z.
import * as THREE from "three";
import { TEX, TAU, initTextures, buildShip, FOES, dragonHead, dragonSeg, starPickup, heartPickup, ringPickup, buildBoss, planetTexture, skyTexture, glow, emojiTex } from "./art.js";
import { Sparks, FX, pop } from "./fx.js";
import { sfx, playMusic, unlockAudio, setMuted, isMuted } from "./audio.js";
import { input, took, clearActions, bindTouch } from "./input.js";

const XB = 10, YLO = -4.2, YHI = 5.4, SPAWN_Z = -175, GONE_Z = 7, REACH = 95;
const SECTOR = 17, METER_MAX = 26, BASE_SPEED = 32, BOSS_Z = -78, BOSS_S = 1.35;
let BOSS_HP = 110;

export const HOUSES = [
  { name: "GRYFFINDOR", animal: "🦁", c: "#dc2626", c2: "#fbbf24", glow: "#ffd166", saber: "#ff5a5a" },
  { name: "SLYTHERIN", animal: "🐍", c: "#16a34a", c2: "#e5e7eb", glow: "#b9f6ca", saber: "#4ade80" },
  { name: "RAVENCLAW", animal: "🦅", c: "#2563eb", c2: "#cbd5e1", glow: "#bfdbfe", saber: "#60a5fa" },
  { name: "HUFFLEPUFF", animal: "🦡", c: "#eab308", c2: "#1f2937", glow: "#fff3b0", saber: "#fde047" },
];
const WEAPONS = [
  { name: "MAGIC WAND", icon: "🪄", rate: 0.12 },
  { name: "BLASTER", icon: "🔫", rate: 0.2 },
  { name: "LIGHT SWORD", icon: "⚔️", rate: 0.4 },
];
const STAGES = [
  { name: "TATOOINE", icon: "🏜️", sky: ["#1a0b2e", "#7a3514", "#f5a623"], fog: 0x6b3416, planet: "sand", pp: [-300, 110, -820], pr: 170, atmo: 0xffb454, light: 0xffd29a, suns: true, foes: ["saucer", "saucer", "fighter"], obst: ["rock"], neb: [0xff9f43, 0xff6b6b] },
  { name: "BLOCKY WORLD", icon: "🟩", sky: ["#06122b", "#0f4c75", "#7dd3fc"], fog: 0x1d5f7a, planet: "blocky", pp: [300, 90, -820], pr: 170, atmo: 0x9be36b, light: 0xfff4d6, foes: ["creeper", "creeper", "saucer"], obst: ["block", "block", "tnt"], neb: [0x22c55e, 0x38bdf8] },
  { name: "ICE PLANET", icon: "❄️", sky: ["#020617", "#1e3a8a", "#bae6fd"], fog: 0x2b4f86, planet: "ice", pp: [-290, 120, -820], pr: 150, atmo: 0xbfe9ff, light: 0xe0f2fe, rings: true, foes: ["robot", "fighter", "robot"], obst: ["crystal"], neb: [0x60a5fa, 0xe0f2fe] },
  { name: "DEMENTOR NEBULA", icon: "🌌", sky: ["#05010d", "#2e0a4f", "#8b2fc9"], fog: 0x3b0f5c, planet: "neb", pp: [290, 130, -820], pr: 150, atmo: 0xe879f9, light: 0xf0abfc, foes: ["dementor", "dementor", "dragon"], obst: [], neb: [0xa855f7, 0xec4899] },
  { name: "STAR FORTRESS", icon: "☠️", sky: ["#000000", "#210a12", "#5b0a24"], fog: 0x2a0612, planet: "dark", pp: [-420, 230, -1000], pr: 80, atmo: 0xef4444, light: 0xffc2c2, foes: ["saucer"], obst: [], neb: [0xef4444, 0x7c3aed] },
];

export function createGame({ scene, camera, rng, params }) {
  initTextures();
  const R = rng, rr = (a, b) => a + (b - a) * R(), pick = (a) => a[Math.floor(R() * a.length)], chance = (p) => R() < p;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const V3 = THREE.Vector3, _a = new V3(), _b = new V3(), UP = new V3(0, 1, 0);
  const $ = (id) => document.getElementById(id);

  // ── lights ──
  const hemi = new THREE.HemisphereLight(0xdbe7ff, 0x3a2350, 1.6); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe2b0, 2.6); sun.position.set(6, 10, 8); scene.add(sun);
  const rim = new THREE.DirectionalLight(0x9ab4ff, 1.1); rim.position.set(-8, -3, -10); scene.add(rim);

  // ── sky, stars, planet, suns, nebula clouds, speed streaks ──
  const skyMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false, depthWrite: false });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), skyMat); sky.renderOrder = -10; scene.add(sky);
  {
    const n = 1600, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * TAU, r = 1200, s = Math.sqrt(1 - u * u);
      pos.set([r * s * Math.cos(th), r * u, r * s * Math.sin(th)], i * 3); c.setHSL([0.6, 0.1, 0.75, 0.13][i % 4], 0.7, 0.7 + Math.random() * 0.3); col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 3.2, map: TEX.glow, sizeAttenuation: false, vertexColors: true, fog: false, transparent: true, depthWrite: false })));
  }
  const planetTex = {}; for (const k of ["sand", "blocky", "ice", "neb", "dark"]) planetTex[k] = planetTexture(k);
  const skyTex = STAGES.map((s) => skyTexture(...s.sky));
  const planetMat = new THREE.MeshToonMaterial({ gradientMap: TEX.toon, fog: false });
  const planet = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 40), planetMat); scene.add(planet);
  const atmo = glow(0xffffff, 1, 0.32); atmo.material.fog = false; scene.add(atmo);
  const rings = new THREE.Group(); scene.add(rings);
  for (const [a, b, col, op] of [[1.35, 1.7, 0xe0f2fe, 0.55], [1.75, 2.15, 0x93c5fd, 0.4]]) rings.add(new THREE.Mesh(new THREE.RingGeometry(a, b, 96), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, side: THREE.DoubleSide, fog: false, depthWrite: false })));
  rings.rotation.set(1.25, 0.2, 0.3);
  const suns = new THREE.Group(); scene.add(suns);
  for (const [x, y, s, c] of [[330, 150, 190, 0xfff1a8], [420, 95, 130, 0xff9f43]]) { const g1 = glow(c, s, 1); g1.position.set(x, y, -950); g1.material.fog = false; suns.add(g1); const g2 = glow(0xffffff, s * 0.35, 1); g2.position.set(x, y, -949); g2.material.fog = false; suns.add(g2); }
  const clouds = [];
  for (let i = 0; i < 7; i++) { const c = glow(0xffffff, rr(380, 720), 0.28); c.position.set(rr(-700, 700), rr(-260, 300), rr(-1100, -900)); c.material.fog = false; scene.add(c); clouds.push(c); }
  const STREAKS = 260, sPos = new Float32Array(STREAKS * 6), sXYZ = [];
  for (let i = 0; i < STREAKS; i++) sXYZ.push([rr(-70, 70), rr(-45, 50), rr(-330, 20)]);
  const streakGeo = new THREE.BufferGeometry(); const streakAttr = new THREE.BufferAttribute(sPos, 3).setUsage(THREE.DynamicDrawUsage); streakGeo.setAttribute("position", streakAttr);
  const streaks = new THREE.LineSegments(streakGeo, new THREE.LineBasicMaterial({ color: 0xdfe8ff, transparent: true, opacity: 0.55 })); streaks.frustumCulled = false; scene.add(streaks);
  scene.fog = new THREE.Fog(0x000000, 70, 260);

  function setStage(i) {
    const s = STAGES[i]; skyMat.map = skyTex[i]; skyMat.needsUpdate = true; scene.fog.color.set(s.fog);
    planetMat.map = planetTex[s.planet]; planetMat.needsUpdate = true; planet.position.set(...s.pp); planet.scale.setScalar(s.pr); planet.rotation.set(0.35, 0, 0.2);
    atmo.position.copy(planet.position); atmo.scale.setScalar(s.pr * 2.9); atmo.material.color.set(s.atmo);
    rings.visible = !!s.rings; rings.position.copy(planet.position); rings.scale.setScalar(s.pr);
    suns.visible = !!s.suns; sun.color.set(s.light);
    clouds.forEach((c, k) => c.material.color.set(s.neb[k % 2]));
    S.stageVis = i;
  }

  // ── fx + ship ──
  const sparks = new Sparks(scene, 900, 0.55), bigSparks = new Sparks(scene, 260, 1.9), fx = new FX(scene);
  const ship = buildShip(); scene.add(ship.group);
  const boltMats = { wand: glowMatFor(0xffffff, TEX.sparkle), laser: new THREE.MeshBasicMaterial({ color: 0xff5a5a }), wave: new THREE.MeshBasicMaterial({ color: 0xff5a5a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), eshot: glowMatFor(0xff3d7f), ecore: glowMatFor(0xffffff) };
  function glowMatFor(c, map = TEX.glow) { return new THREE.SpriteMaterial({ map, color: c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }); }
  const laserGeo = new THREE.BoxGeometry(0.22, 0.22, 2.8), waveGeo = new THREE.TorusGeometry(2.6, 0.26, 8, 28, Math.PI);

  // ── state ──
  const S = { screen: "title", phase: "sector", phaseT: 0, t: 0, house: 0, weapon: 0, score: 0, shields: 3, meter: 0, planet: 0, speed: BASE_SPEED, shake: 0, flashA: 0, bannerT: 0, fireT: 0, wandSide: 1, swingT: 0, kills: 0, best: 0, god: !!params.god, stageVis: -1, heartGiven: false, overT: 0, hintShown: false };
  try { S.best = +localStorage.getItem("sw3d-best") || 0; S.level = Math.max(1, +localStorage.getItem("sw3d-level") || 1); } catch (e) { S.level = 1; }
  if (params.level) S.level = Math.max(1, +params.level || 1);
  // Wizard Level: every win makes the next run tougher (the first flight is meant to be winnable)
  const LV = () => Math.min(S.level - 1, 6), hard = (base, per) => base * (1 + per * LV());
  const P = { x: 0, y: 0, vx: 0, vy: 0, rollT: 0, rollCd: 0, rollDir: 1, hurtT: 0, dead: false };
  let foes = [], bolts = [], eshots = [], items = [], boss = null;
  const Ppos = () => _a.set(P.x, P.y, 0);
  const house = () => HOUSES[S.house];
  const colorCache = new Map(); const col = (c) => { if (!colorCache.has(c)) colorCache.set(c, new THREE.Color(c)); return colorCache.get(c); };

  function applyHouse() {
    const h = house(); ship.setHouse(h);
    boltMats.wand.color.set(h.glow); boltMats.laser.color.set(h.saber); boltMats.wave.color.set(h.saber);
    const root = document.documentElement.style; root.setProperty("--house", h.c); root.setProperty("--house2", h.c2 === "#1f2937" ? "#fde047" : h.c2);
    $("meter").querySelector(".animal").textContent = h.animal;
  }

  // ── juice ──
  function burst(pos, colors, n = 36, speed = 16, big = 8) {
    for (let i = 0; i < n; i++) {
      _b.set(R() * 2 - 1, R() * 2 - 1, R() * 2 - 1).normalize().multiplyScalar(rr(speed * 0.35, speed));
      const c = col(colors[i % colors.length]);
      (i < big ? bigSparks : sparks).emit(pos.x, pos.y, pos.z, _b.x, _b.y, _b.z, c, rr(0.5, 1.0), 1.8, 4);
    }
  }
  function explode(pos, colors, scale = 1) {
    burst(pos, colors, Math.round(40 * scale), 18 * Math.sqrt(scale), Math.round(8 * scale));
    fx.shockwave(pos, colors[0], 6 * scale, 0.5); fx.flash(pos, 0xffffff, 7 * scale, 0.3);
  }
  const shake = (a) => { S.shake = Math.max(S.shake, a); };
  const flashScreen = (a, c = "#fff") => { S.flashA = Math.max(S.flashA, a); $("flash").style.background = c; };
  function banner(text, sub = "", dur = 2) {
    const b = $("banner"); b.querySelector(".big").textContent = text; b.querySelector(".sub").textContent = sub;
    b.classList.remove("on"); void b.offsetWidth; b.classList.add("on"); S.bannerT = dur;
  }

  // ── spawning ──
  function addFoe(kind, x, y, z) {
    const def = FOES[kind];
    if (kind === "dragon") {
      const head = dragonHead(); scene.add(head.obj);
      const segs = []; for (let i = 0; i < 8; i++) { const s = dragonSeg(i); scene.add(s.obj); s.obj.position.set(x, y, z - i * 2); segs.push(s); }
      foes.push({ kind, def, obj: head.obj, parts: head, hp: def.hp + 2 * LV(), r: def.r + 0.3, base: new V3(x, y, z), t: 0, ph: rr(0, TAU), shootT: 2, hist: [], segs, s0: 1, flashT: 0, aimX: 0, aimY: 1 });
      return;
    }
    const b = def.build(); scene.add(b.obj); b.obj.position.set(x, y, z);
    foes.push({ kind, def, obj: b.obj, parts: b, hp: def.hp + (def.obstacle ? 0 : Math.floor(LV() / 2)), r: b.r || def.r, base: new V3(x, y, z), t: 0, ph: rr(0, TAU), shootT: rr(1.4, 2.8), spin: new V3(rr(-1.5, 1.5), rr(-1.5, 1.5), rr(-1, 1)), s0: b.obj.scale.x, flashT: 0, aimX: rr(-4, 4), aimY: rr(-2.5, 2.5) });
  }
  function spawnWave() {
    const st = STAGES[S.planet]; let kind = pick(st.foes);
    if (kind === "dragon" && (foes.some((f) => f.kind === "dragon") || S.phaseT < 2)) kind = "dementor";
    if (kind === "dragon") { addFoe("dragon", rr(-3, 3), rr(-1, 3), SPAWN_Z - 15); banner("🐉 DRAGON!", "zap it lots of times!", 1.4); return; }
    const x = rr(-7.5, 7.5), y = rr(YLO + 0.6, YHI - 0.8);
    if (chance(0.35)) {
      const V = [[0, 0, 0], [-3.4, -0.9, -6], [3.4, -0.9, -6], [-6.8, -1.8, -12], [6.8, -1.8, -12]].slice(0, S.planet >= 2 ? 5 : 3);
      for (const [dx, dy, dz] of V) addFoe(kind, clamp(x + dx, -XB, XB), clamp(y + dy, YLO, YHI), SPAWN_Z + dz);
    } else addFoe(kind, x, y, SPAWN_Z);
  }
  function addItem(kind, x, y, z) {
    const obj = kind === "star" ? starPickup() : kind === "heart" ? heartPickup() : ringPickup();
    obj.position.set(x, y, z); scene.add(obj); items.push({ kind, obj, prevZ: z });
  }
  function starArc() { const x0 = rr(-7, 7), y0 = rr(-2.5, 4), dx = rr(-0.8, 0.8); for (let i = 0; i < 6; i++) addItem("star", clamp(x0 + dx * i + Math.sin(i * 0.9) * 1.5, -XB, XB), clamp(y0 + Math.cos(i * 0.7), YLO, YHI), SPAWN_Z - i * 5); }

  // ── weapons ──
  function addBolt(kind, x, y, z, vx, vy, vz) {
    let obj;
    if (kind === "wand") { obj = new THREE.Sprite(boltMats.wand); obj.scale.setScalar(2.2); }
    else if (kind === "laser") { obj = new THREE.Mesh(laserGeo, boltMats.laser); const g = new THREE.Sprite(boltMats.wand); g.scale.setScalar(1.6); obj.add(g); }
    else { obj = new THREE.Mesh(waveGeo, boltMats.wave); obj.rotation.z = rr(-0.35, 0.35); obj.scale.set(1.35, 1, 1); }
    obj.position.set(x, y, z); scene.add(obj);
    const vel = new V3(vx, vy, vz); if (kind === "laser") obj.quaternion.setFromUnitVectors(new V3(0, 0, 1), vel.clone().normalize());
    bolts.push({ kind, obj, vel, dmg: kind === "wave" ? 2 : 1, r: kind === "wave" ? 3.0 : kind === "laser" ? 0.9 : 1.0, life: kind === "wave" ? 0.85 : 0.7, pierce: kind === "wave", hit: new Set() });
  }
  function fire() {
    const w = S.weapon;
    if (w === 0) { S.wandSide *= -1; addBolt("wand", P.x + 3.1 * S.wandSide, P.y - 0.1, -1.2, 0, 0, -150); sfx.wand(); }
    else if (w === 1) { for (const d of [-1, 0, 1]) addBolt("laser", P.x + d * 0.9, P.y, -2.4, d * 13, 0, -175); sfx.blaster(); }
    else { S.swingT = 0.3; addBolt("wave", P.x, P.y + 0.2, -3.5, 0, 0, -120); sfx.sword(); }
  }
  function aimTarget(p) {
    let best = null, bd = 1e9;
    for (const f of foes) { const q = f.obj.position; if (q.z > p.z - 4 || q.z < -REACH) continue; const d = Math.hypot(q.x - p.x, q.y - p.y) + (p.z - q.z) * 0.05; if (d < 16 && d < bd) { bd = d; best = q; } }
    if (!best && boss && (S.phase === "boss")) { for (const t of boss.turrets) if (t.alive && Math.hypot(t.obj.position.x - p.x, t.obj.position.y - p.y) < 8) return t.obj.position; return boss.obj.position; }
    return best;
  }

  // ── damage ──
  function hitsFoe(f, p, rad) {
    if (f.obj.position.distanceTo(p) < f.r + rad) return true;
    if (f.segs) for (const s of f.segs) if (s.obj.position.distanceTo(p) < s.r + rad) return true;
    return false;
  }
  function removeFoe(f) { f.dead = true; scene.remove(f.obj); if (f.segs) f.segs.forEach((s) => scene.remove(s.obj)); }
  function damageFoe(f, dmg, at) {
    if (f.dead) return; f.hp -= dmg; f.flashT = 0.14; burst(at, ["#ffffff", house().glow], 6, 8, 0);
    if (f.hp <= 0) killFoe(f);
  }
  function killFoe(f, quiet = false) {
    if (f.dead) return; removeFoe(f); const p = f.obj.position.clone();
    S.score += f.def.score; S.kills++; S.meter += f.def.obstacle ? 0.5 : 1;
    explode(p, f.def.sparks, f.kind === "dragon" ? 2.2 : f.def.obstacle ? 0.8 : 1);
    if (f.segs) f.segs.forEach((s, i) => { const q = s.obj.position.clone(); fx.add(((t) => (dt) => { t -= dt; if (t <= 0) { explode(q, f.def.sparks, 0.8); return false; } return true; })(0.06 * i)); });
    if (!quiet) { pop("+" + f.def.score, p, camera, f.def.score >= 50 ? "gold big" : ""); sfx.pop(); }
    if (f.kind === "dragon") { shake(0.7); sfx.boom(); banner("DRAGON DOWN!", "+80", 1.4); }
    if (f.kind === "tnt") tntBoom(p);
    else if (!f.def.obstacle) { if (S.shields < 3 && chance(0.07)) addItem("heart", p.x, p.y, p.z); else if (chance(0.2)) addItem("star", p.x, p.y, p.z); }
  }
  function tntBoom(p) {
    sfx.boom(); shake(0.9); flashScreen(0.35, "#ffb347"); fx.shockwave(p, 0xff7b1a, 22, 0.7); fx.flash(p, 0xffcf5a, 30, 0.5);
    burst(p, ["#ff5a1f", "#fde047", "#ffffff", "#ff9f43"], 80, 30, 20); pop("TNT! 💥", p, camera, "gold big");
    for (const f of foes) if (!f.dead && f.obj.position.distanceTo(p) < 17) { const g = f; fx.add(((t) => (dt) => { t -= dt; if (t <= 0) { killFoe(g); return false; } return true; })(0.1 + R() * 0.2)); }
  }
  function hurt() {
    if (P.hurtT > 0 || P.rollT > 0 || S.god || P.dead) return;
    S.shields--; P.hurtT = 1.8; sfx.hit(); shake(0.9); flashScreen(0.45, "#ff2d55"); burst(Ppos(), ["#ffffff", "#ff6b6b", house().glow], 26, 14, 6);
    if (S.shields <= 0) die();
  }
  function die() {
    P.dead = true; ship.group.visible = false; S.phase = "dead"; S.phaseT = 0; sfx.boom(); shake(1.2);
    explode(new V3(P.x, P.y, 0), [house().c, house().glow, "#ffffff", "#fde047"], 2.5);
  }
  function enemyShot(from, dir, speed = 30) {
    const s = new THREE.Sprite(boltMats.eshot); s.scale.setScalar(2.6); const c = new THREE.Sprite(boltMats.ecore); c.scale.setScalar(0.45); s.add(c);
    s.position.copy(from); scene.add(s); eshots.push({ obj: s, vel: dir.clone().multiplyScalar(speed), life: 7, t: 0 });
  }

  // ── house power: your house animal charges across space and pops everything ──
  function housePower() {
    const h = house(); S.meter = 0; banner(`${h.animal} ${h.name}!`, "HOUSE POWER", 1.8); sfx.power(); flashScreen(0.5, h.glow); shake(1);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTex(h.animal), transparent: true, depthWrite: false })); spr.position.set(P.x * 0.3, 1.5, -80); spr.scale.setScalar(16); scene.add(spr);
    const halo = glow(h.glow, 40, 0.7); spr.add(halo); halo.scale.setScalar(2.2);
    let t = 0; fx.add((dt) => {
      t += dt; const k = Math.min(1, t / 1.3); spr.position.z = -80 + 88 * k * k; spr.scale.setScalar(16 + 22 * k); spr.material.opacity = k > 0.75 ? 1 - (k - 0.75) * 4 : 1;
      burst(spr.position, [h.c, h.glow, "#ffffff"], 3, 10, 1);
      if (k >= 1) { scene.remove(spr); spr.material.dispose(); return false; } return true;
    });
    for (let i = 0; i < 3; i++) fx.add(((d) => (dt) => { d -= dt; if (d <= 0) { fx.shockwave(new V3(P.x, P.y, -8), i % 2 ? h.c : h.glow, 40, 0.9); return false; } return true; })(i * 0.15));
    fx.add(((d) => (dt) => { d -= dt; if (d > 0) return true;
      for (const f of foes) if (!f.dead) killFoe(f, true);
      for (const e of eshots) { scene.remove(e.obj); burst(e.obj.position, ["#ffffff", h.glow], 4, 6, 0); } eshots = [];
      if (boss && S.phase === "boss") { boss.hp -= 14; boss.flash = 0.3; }
      pop("POWER!", new V3(0, 2, -20), camera, "gold big"); return false; })(0.45));
  }

  // ── boss ──
  function startBoss() {
    BOSS_HP = Math.round(hard(110, 0.3)); boss = buildBoss(); boss.hp = BOSS_HP; boss.t = 0; boss.shootT = 2.5; boss.ringT = 4; boss.minT = 3; boss.flash = 0; boss.starT = 4;
    boss.obj.position.set(0, 1.5, -340); boss.obj.scale.setScalar(BOSS_S); scene.add(boss.obj); boss.turrets.forEach((t) => scene.add(t.obj));
    $("bossbar").classList.remove("hidden"); $("journey").classList.add("hidden");
  }
  function updateBoss(dt) {
    const B = boss; B.t += dt; const bp = B.obj.position;
    if (S.phase === "bossIntro") { const k = Math.min(1, S.phaseT / 3.8); const e = 1 - Math.pow(1 - k, 3); bp.set(0, 1.5, -340 + (340 + BOSS_Z) * e); }
    else if (S.phase === "boss") { bp.set(Math.sin(B.t * 0.5) * 6, 1.5 + Math.sin(B.t * 0.8) * 2, BOSS_Z); }
    B.obj.rotation.y = -0.28 + Math.sin(B.t * 0.35) * 0.18; B.obj.rotation.x = Math.sin(B.t * 0.3) * 0.08;
    B.flash = Math.max(0, B.flash - dt); B.eyeMat.color.setRGB(1, 0.16 + B.flash * 2.5, 0.16 + B.flash * 2.5); B.eyeGlow.scale.setScalar(9 + Math.sin(B.t * 6) * 1.5 + B.flash * 20);
    B.turrets.forEach((t) => { if (!t.alive) return; t.a += dt * 1.1; t.obj.position.set(bp.x + Math.cos(t.a) * 17, bp.y + Math.sin(t.a) * 10, bp.z + 11); t.obj.rotation.y += dt * 2; });
    if (S.phase === "bossDeath") {
      if (R() < 0.35) { _b.set(R() * 2 - 1, R() * 2 - 1, R() * 2 - 1).normalize().multiplyScalar(9 * BOSS_S).add(bp); explode(_b.clone(), ["#ff5a1f", "#fde047", "#ffffff", "#a855f7"], 1.2); if (R() < 0.3) sfx.pop(); }
      shake(0.4); if (S.phaseT > 2.6 && B.obj.visible) { B.obj.visible = false; explode(bp.clone(), ["#ffffff", "#fde047", "#ff5a1f", "#a855f7", "#22ff88"], 6); fx.shockwave(bp.clone(), 0xffffff, 60, 1.2); flashScreen(1); sfx.boom(); }
      return;
    }
    if (S.phase !== "boss") return;
    const eye = B.obj.localToWorld(_b.copy(B.eye.position)); const phase2 = B.hp < BOSS_HP / 2;
    B.shootT -= dt;
    if (B.shootT <= 0) {
      const n = phase2 ? 7 : 5, base = Ppos().clone().sub(eye).normalize();
      for (let i = 0; i < n; i++) enemyShot(eye, base.clone().applyAxisAngle(UP, (i - (n - 1) / 2) * 0.12), 26);
      B.shootT = (phase2 ? 1.3 : 1.9) / hard(1, 0.1); sfx.eshot();
    }
    if (phase2) { B.ringT -= dt; if (B.ringT <= 0) { for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; enemyShot(bp, _a.set(Math.cos(a) * 0.42, Math.sin(a) * 0.3, 1).normalize(), 24); } B.ringT = 3.6; } }
    for (const t of B.turrets) { if (!t.alive) continue; t.shootT -= dt; if (t.shootT <= 0) { enemyShot(t.obj.position, Ppos().clone().sub(t.obj.position).normalize(), 28); t.shootT = rr(2.2, 3.2); } }
    B.minT -= dt; if (B.minT <= 0) { addFoe("saucer", clamp(bp.x + rr(-8, 8), -XB, XB), rr(YLO + 1, YHI - 1), bp.z + 10); B.minT = rr(2.6, 3.6); }
    B.starT -= dt; if (B.starT <= 0) { starArc(); B.starT = 6; }
    // player bolts vs fortress + turrets
    for (const b of bolts) {
      if (b.dead) continue; const p = b.obj.position;
      for (const t of B.turrets) if (t.alive && p.distanceTo(t.obj.position) < 2.2 + b.r * 0.4 && !b.hit.has(t)) {
        t.hp -= b.dmg; burst(p, ["#ffffff", "#d946ef"], 6, 8, 0); if (b.pierce) b.hit.add(t); else b.dead = true;
        if (t.hp <= 0) { t.alive = false; scene.remove(t.obj); explode(t.obj.position.clone(), ["#d946ef", "#a855f7", "#ffffff"], 1.5); S.score += 100; pop("+100", t.obj.position, camera, "gold big"); sfx.pop(); }
      }
      if (!b.dead && !b.hit.has(B) && p.distanceTo(bp) < 9.4 * BOSS_S) {
        B.hp -= b.dmg; B.flash = 0.1; S.meter += 0.2; burst(p, ["#ffffff", "#ff5a5a", house().glow], 5, 10, 1); sfx.bosshit();
        if (b.pierce) b.hit.add(B); else b.dead = true;
      }
    }
    if (B.hp <= 0) { B.hp = 0; S.phase = "bossDeath"; S.phaseT = 0; for (const e of eshots) scene.remove(e.obj); eshots = []; banner("YOU DID IT!", "the Star Fortress is going down…", 2.5); sfx.boom(); playMusic("title"); }
  }

  // ── the per-step simulation ──
  function stepPlay(dt) {
    S.t += dt; S.phaseT += dt;
    let mul = 1;
    if (S.phase === "warp") { const k = Math.min(1, S.phaseT / 2.0); mul = 1 + 9 * Math.pow(Math.sin(Math.PI * k), 2); }
    S.speed = BASE_SPEED * (1 + 0.07 * Math.min(S.planet, 3)) * mul;

    // flying
    if (!P.dead) {
      P.vx += (input.x * 15 - P.vx) * Math.min(1, dt * 8); P.vy += (input.y * 12 - P.vy) * Math.min(1, dt * 8);
      P.x = clamp(P.x + P.vx * dt, -XB, XB); P.y = clamp(P.y + P.vy * dt, YLO, YHI);
      if (took("roll") && P.rollCd <= 0) { P.rollT = 0.55; P.rollCd = 0.75; P.rollDir = P.vx < -0.5 ? -1 : 1; P.vx += P.rollDir * 10; sfx.roll(); burst(Ppos(), [house().glow, "#ffffff"], 14, 10, 3); }
      if (took("swap")) { S.weapon = (S.weapon + 1) % WEAPONS.length; sfx.swap(); const w = $("weapon"); w.classList.remove("bump"); void w.offsetWidth; w.classList.add("bump"); pop(WEAPONS[S.weapon].icon + " " + WEAPONS[S.weapon].name, new V3(P.x, P.y + 2.5, 0), camera, "gold"); }
    }
    P.rollT = Math.max(0, P.rollT - dt); P.rollCd = Math.max(0, P.rollCd - dt); P.hurtT = Math.max(0, P.hurtT - dt); S.swingT = Math.max(0, S.swingT - dt);
    const canFire = !params.nofire && !P.dead && (S.phase === "sector" || S.phase === "boss" || S.phase === "bossIntro");
    if (canFire) { S.fireT -= dt; if (S.fireT <= 0) { fire(); S.fireT += WEAPONS[S.weapon].rate; if (S.fireT < 0) S.fireT = 0; } }

    // spawning
    if (S.phase === "sector") {
      const st = STAGES[S.planet], open = S.phaseT < SECTOR - 3;
      S.spawnT -= dt; if (S.spawnT <= 0 && open) { spawnWave(); S.spawnT = Math.max(0.42, 1.0 - 0.14 * S.planet) * rr(0.8, 1.2) / hard(1, 0.16); }
      S.obsT -= dt; if (st.obst.length && S.obsT <= 0 && open) { addFoe(pick(st.obst), rr(-8.5, 8.5), rr(YLO, YHI), SPAWN_Z - rr(0, 20)); S.obsT = rr(1.1, 1.8); }
      S.ringT -= dt; if (S.ringT <= 0 && open) { addItem("ring", rr(-7, 7), rr(-2.5, 4), SPAWN_Z); S.ringT = 4.2; }
      S.starT -= dt; if (S.starT <= 0 && open) { starArc(); S.starT = 3.3; }
      if (!S.heartGiven && S.phaseT > 8 && S.shields < 3 && S.level <= 3) { S.heartGiven = true; addItem("heart", rr(-5, 5), rr(-1, 3), SPAWN_Z); }
      if (S.phaseT > 3 && S.phaseT < 3.1 && S.planet === 0 && !S.hintShown) { S.hintShown = true; const h = $("hint"); h.textContent = input.isTouch ? "Tap 🌀 to do a BARREL ROLL!" : "Press SPACE to do a BARREL ROLL!"; h.classList.add("on"); setTimeout(() => h.classList.remove("on"), 3500); }
      if (S.phaseT >= SECTOR) { S.score += 100; pop("PLANET CLEARED +100", new V3(0, 3, -15), camera, "gold big"); S.phase = "warp"; S.phaseT = 0; S.warped = false; sfx.warp(); for (const e of eshots) scene.remove(e.obj); eshots = []; }
    } else if (S.phase === "warp") {
      if (!S.warped && S.phaseT >= 1.0) {
        S.warped = true; flashScreen(0.9, "#ffffff");
        for (const f of foes) removeFoe(f); foes = []; for (const it of items) scene.remove(it.obj); items = [];
        if (S.planet < 3) { S.planet++; setStage(S.planet); } else { setStage(4); startBoss(); playMusic("boss"); }
      }
      if (S.phaseT >= 2.0) {
        S.phase = boss ? "bossIntro" : "sector"; S.phaseT = 0; S.heartGiven = false; S.spawnT = 0.8; S.obsT = 1.5; S.ringT = 2.5; S.starT = 1.5;
        if (boss) { banner("⚠ WARNING ⚠", "THE DARK LORD'S STAR FORTRESS", 3.2); sfx.alarm(); }
        else banner(STAGES[S.planet].name, `planet ${S.planet + 1} of 4`, 2.2);
      }
    } else if (S.phase === "bossIntro") {
      if (S.phaseT >= 3.8) { S.phase = "boss"; S.phaseT = 0; banner("ZAP THE RED EYE!", "watch out for the purple orbs", 2); }
    } else if (S.phase === "bossDeath") {
      if (S.phaseT >= 4.2) { const bonus = 1000 + S.shields * 250; S.score += bonus; endRun(true); return; }
    } else if (S.phase === "dead") {
      if (S.phaseT >= 2.2) { endRun(false); return; }
    }
    if (boss) updateBoss(dt);

    // bolts
    for (const b of bolts) {
      if (b.dead) continue; const p = b.obj.position;
      if (b.kind === "wand") { const t = aimTarget(p); if (t) { _b.copy(t).sub(p).normalize().multiplyScalar(150); b.vel.lerp(_b, Math.min(1, dt * 5)).setLength(150); } sparks.emit(p.x, p.y, p.z, rr(-1, 1), rr(-1, 1), 6, col(house().glow), 0.35, 3); }
      if (b.kind === "wave") { for (let i = 0; i < 2; i++) sparks.emit(p.x + rr(-3, 3), p.y + rr(0, 2.5), p.z, 0, 0, 20, col(house().saber), 0.3, 3); }
      p.addScaledVector(b.vel, dt); b.life -= dt;
      if (b.life <= 0 || p.z < -300) { b.dead = true; continue; }
      for (const f of foes) {
        if (f.dead || (b.pierce && b.hit.has(f))) continue;
        if (hitsFoe(f, p, b.r)) { damageFoe(f, b.dmg, p); if (b.pierce) b.hit.add(f); else { b.dead = true; break; } }
      }
      if (b.kind === "wave") for (const e of eshots) if (!e.dead && e.obj.position.distanceTo(p) < 3.2) { e.dead = true; burst(e.obj.position, ["#ffffff", house().saber], 8, 10, 1); S.score += 5; }
    }
    bolts = bolts.filter((b) => { if (b.dead) scene.remove(b.obj); return !b.dead; });

    // foes
    const pp = Ppos().clone();
    for (const f of foes) {
      if (f.dead) continue; const d = f.def; f.t += dt; f.flashT = Math.max(0, f.flashT - dt);
      f.base.z += (S.speed + d.speed) * dt;
      if (!d.obstacle && f.base.z < -30 && f.base.z > -150) { f.base.x += (clamp(P.x + f.aimX, -XB, XB) - f.base.x) * d.home * dt; f.base.y += (clamp(P.y + f.aimY, YLO, YHI) - f.base.y) * d.home * dt; }
      const o = f.obj.position.copy(f.base), t = f.t, ph = f.ph, pt = f.parts;
      switch (f.kind) {
        case "saucer": o.x += Math.sin(t * 2 + ph) * 2; pt.spin.rotation.y += dt * 3; break;
        case "fighter": o.x += Math.cos(t * 2.2 + ph) * 2.5; o.y += Math.sin(t * 2.2 + ph) * 1.4; f.obj.rotation.z = Math.sin(t * 2.2 + ph) * 0.6; break;
        case "creeper": o.y += Math.abs(Math.sin(t * 5 + ph)) * 0.9; f.obj.rotation.x = Math.sin(t * 5 + ph) * 0.15; pt.feet.forEach((ft, i) => { ft.rotation.x = Math.sin(t * 10 + i * Math.PI) * 0.5; }); break;
        case "robot": o.y += Math.sin(t * 3 + ph) * 0.5; pt.arms[0].rotation.z = -0.3 - Math.abs(Math.sin(t * 6)) * 1.3; pt.arms[1].rotation.z = 0.3 + Math.abs(Math.sin(t * 6 + 1)) * 1.3; pt.jet.scale.setScalar(2 + R() * 0.9); break;
        case "dementor": o.x += Math.sin(t * 1.3 + ph) * 2.6; o.y += Math.sin(t * 2 + ph) * 0.6; pt.cloak.scale.y = 1 + Math.sin(t * 6) * 0.08; f.obj.rotation.z = Math.sin(t * 1.3 + ph) * 0.2; break;
        case "dragon": {
          o.x += Math.sin(t * 1.5 + ph) * 6; o.y += Math.sin(t * 2.2 + ph) * 2.2; f.obj.rotation.y = Math.cos(t * 1.5 + ph) * 0.45; pt.fire.scale.setScalar(1.5 + R());
          f.hist.unshift(o.clone()); if (f.hist.length > 60) f.hist.pop();
          f.segs.forEach((s, i) => { const q = f.hist[Math.min(f.hist.length - 1, (i + 1) * 5)]; s.obj.position.set(q.x, q.y, q.z - (i + 1) * 0.6); if (s.wings) s.wings.forEach((w, k) => { w.rotation.z = (k ? -1 : 1) * Math.sin(t * 7) * 0.6; }); });
          break;
        }
        default: f.obj.rotation.x += f.spin.x * dt; f.obj.rotation.y += f.spin.y * dt; f.obj.rotation.z += f.spin.z * dt;
      }
      if (!d.obstacle) f.obj.scale.setScalar(f.s0 * (1 + f.flashT * 2));
      // enemy fire
      if ((d.shoots && (S.planet >= 1 || f.kind === "dragon" || S.level > 1) && S.phase === "sector") && o.z > -135 && o.z < -35) {
        f.shootT -= dt;
        if (f.shootT <= 0) {
          const aim = _b.set(P.x + P.vx * 0.3, P.y + P.vy * 0.3, 0).sub(o).normalize();
          if (f.kind === "dragon") { for (const a of [-0.15, 0, 0.15]) enemyShot(o, aim.clone().applyAxisAngle(UP, a), 26); f.shootT = 2.4; }
          else { enemyShot(o, aim, 30 + 3 * S.planet + 2 * LV()); if (LV() >= 3) { const a2 = aim.clone(); fx.add(((t) => (dt) => { t -= dt; if (t > 0) return true; if (!f.dead) enemyShot(f.obj.position, a2, 30 + 3 * S.planet + 2 * LV()); return false; })(0.22)); } f.shootT = (rr(2.4, 3.8) - 0.3 * S.planet) / hard(1, 0.15); }
          sfx.eshot();
        }
      }
      // ramming the ship (a barrel roll turns that into a spin attack!)
      if (!P.dead && Math.abs(o.z) < 4 && hitsFoe(f, pp, 1.0)) {
        if (P.rollT > 0) { killFoe(f); pop("SPIN ATTACK!", pp, camera, "gold"); }
        else if (P.hurtT <= 0) { hurt(); killFoe(f, true); }
      }
      if (o.z > GONE_Z) removeFoe(f);
    }
    foes = foes.filter((f) => !f.dead);

    // enemy shots
    for (const e of eshots) {
      if (e.dead) continue; e.t += dt; e.obj.position.addScaledVector(e.vel, dt); e.life -= dt; e.obj.scale.setScalar(2.6 + Math.sin(e.t * 20) * 0.4);
      if (!P.dead && P.hurtT <= 0 && e.obj.position.distanceTo(pp) < 1.35) { if (P.rollT > 0) { burst(e.obj.position, ["#ffffff", house().glow], 8, 10, 1); pop("DODGED!", pp, camera); } else hurt(); e.dead = true; }
      if (e.life <= 0 || e.obj.position.z > GONE_Z) e.dead = true;
    }
    eshots = eshots.filter((e) => { if (e.dead) scene.remove(e.obj); return !e.dead; });

    // pickups
    for (const it of items) {
      const o = it.obj.position; it.prevZ = o.z; o.z += S.speed * dt;
      if (it.kind === "star") { it.obj.rotation.y += dt * 4; const d = o.distanceTo(pp); if (d < 6.5 && !P.dead) o.lerp(pp, Math.min(1, dt * 6)); if (d < 1.9) { it.dead = true; S.score += 25; S.meter += 0.5; sfx.star(); burst(o, ["#ffd76a", "#ffffff"], 10, 8, 2); pop("+25", o, camera, "gold"); } }
      else if (it.kind === "heart") { it.obj.rotation.z = Math.sin(S.t * 4) * 0.2; const d = o.distanceTo(pp); if (d < 6) o.lerp(pp, Math.min(1, dt * 4)); if (d < 2.2 && !P.dead) { it.dead = true; S.shields = Math.min(3, S.shields + 1); sfx.heart(); pop("+🛡️", o, camera, "big"); burst(o, ["#ff6bb5", "#ffffff"], 20, 10, 4); } }
      else if (it.kind === "ring") { it.obj.rotation.z += dt; if (it.prevZ < 0 && o.z >= 0) { if (Math.hypot(o.x - P.x, o.y - P.y) < 2.7 && !P.dead) { S.score += 50; S.meter += 1; sfx.ring(); fx.shockwave(o.clone(), 0xffd76a, 9, 0.5); pop("RING! +50", o, camera, "gold big"); it.dead = true; } } }
      if (o.z > GONE_Z) it.dead = true;
    }
    items = items.filter((it) => { if (it.dead) scene.remove(it.obj); return !it.dead; });

    if (S.meter >= METER_MAX && !P.dead && (S.phase === "sector" || S.phase === "boss")) housePower();
    S.meter = Math.min(S.meter, METER_MAX);

    // ship visuals
    const h = house(), roll = P.rollT > 0 ? -P.rollDir * TAU * (1 - P.rollT / 0.55) : 0;
    ship.group.position.set(P.x, P.y, 0); ship.group.rotation.set(P.vy * 0.03, -P.vx * 0.015, -P.vx * 0.032 + roll);
    ship.group.visible = !P.dead && !(P.hurtT > 0 && Math.floor(P.hurtT * 14) % 2 === 0);
    ship.engine.scale.setScalar(2.4 + R() * 0.7 + (mul - 1) * 0.5); ship.hatStar.material.rotation += dt * 2;
    ship.saber.visible = S.swingT > 0; if (S.swingT > 0) ship.saber.rotation.y = -1.4 + 2.8 * (1 - S.swingT / 0.3);
    if (!P.dead) for (let i = 0; i < 2; i++) sparks.emit(P.x + rr(-0.3, 0.3), P.y + rr(-0.3, 0.3), 3.3, rr(-1, 1), rr(-1, 1), 16 + (mul - 1) * 8, col(h.glow), 0.35, 2);
    if (!P.dead && Math.abs(P.vx) > 7) for (const s of [-1, 1]) sparks.emit(P.x + 3.4 * s, P.y, 0.3, 0, 0, 20, col("#ffffff"), 0.25, 2);
  }

  // ── camera + world motion (runs on every screen) ──
  const camT = new V3(), lookT = new V3(), look = new V3(0, 0, -25);
  function stepWorld(dt) {
    const speed = S.screen === "play" ? S.speed : 14;
    for (let i = 0; i < STREAKS; i++) {
      const s = sXYZ[i]; s[2] += speed * dt; if (s[2] > 25) { s[0] = rr(-70, 70); s[1] = rr(-45, 50); s[2] -= 345; }
      const len = 0.3 + speed * 0.045; sPos.set([s[0], s[1], s[2], s[0], s[1], s[2] - len], i * 6);
    }
    streakAttr.needsUpdate = true;
    planet.rotation.y += dt * 0.02; sparks.update(dt); bigSparks.update(dt); fx.update(dt);
    clouds.forEach((c, i) => { c.material.rotation += dt * 0.01 * (i % 2 ? 1 : -1); });
    S.shake = Math.max(0, S.shake - dt * 1.6); S.flashA = Math.max(0, S.flashA - dt * 2.2); $("flash").style.opacity = S.flashA.toFixed(3);
    if (S.bannerT > 0) { S.bannerT -= dt; if (S.bannerT <= 0) $("banner").classList.remove("on"); }
    const k = 1 - Math.exp(-dt * 6);
    if (S.screen === "play") {
      camT.set(P.x * 0.6, P.y * 0.55 + 5.4, 17.5); lookT.set(P.x * 0.75, P.y * 0.7 + 2.6, -30); ship.group.scale.setScalar(0.8);
      const fov = S.phase === "warp" ? 64 + 30 * Math.sin(Math.PI * Math.min(1, S.phaseT / 2)) : 64; camera.fov += (fov - camera.fov) * k; camera.updateProjectionMatrix();
    } else {
      const t = S.t; camera.fov += (58 - camera.fov) * k; camera.updateProjectionMatrix();
      if (S.screen === "title") { camT.set(Math.sin(t * 0.15) * 2, 1.2, 13); lookT.set(0, 0.4, 0); ship.group.position.set(Math.sin(t * 0.7) * 7.5, Math.sin(t * 1.1) * 1.8 - 0.5, -3 + Math.cos(t * 0.7) * 3); ship.group.rotation.set(0, Math.cos(t * 0.7) * 0.9 + Math.PI * 0.15, -Math.cos(t * 0.7) * 0.8); }
      else if (S.screen === "house") { camT.set(0, 1.4, 11); lookT.set(0, 0.6, 0); ship.group.position.set(0, -3.9, 1.5); ship.group.rotation.set(0.25, t * 0.9, 0); }
      else { camT.set(Math.sin(t * 0.2) * 3, 2, 12); lookT.set(0, 0.5, -10); ship.group.position.set(0, 0.6, -2); ship.group.rotation.set(0.1, t * 0.6, Math.sin(t) * 0.2); }
      ship.group.visible = S.screen === "title" || (S.screen === "over" && S.won); ship.saber.visible = false; ship.group.scale.setScalar(1);
      ship.engine.scale.setScalar(2.4 + R() * 0.6);
      sparks.emit(ship.group.position.x, ship.group.position.y, ship.group.position.z + 3.2, rr(-1, 1), rr(-1, 1), 10, col(house().glow), 0.4, 2);
      if (S.screen === "over" && S.won && R() < 0.2) burst(new V3(rr(-14, 14), rr(-3, 8), rr(-30, -10)), ["#ffd76a", "#f472b6", "#60a5fa", "#4ade80", "#ffffff"], 30, 12, 6);
    }
    camera.position.lerp(camT, k); look.lerp(lookT, k); camera.lookAt(look);
    if (S.screen === "play") camera.rotateZ(-P.vx * 0.006);
    if (S.shake > 0) { camera.position.x += (R() - 0.5) * S.shake; camera.position.y += (R() - 0.5) * S.shake; }
  }

  // ── HUD (DOM, only touched when a value changes) ──
  const hudCache = {};
  const setIf = (k, v, fn) => { if (hudCache[k] !== v) { hudCache[k] = v; fn(v); } };
  function buildJourney() {
    const j = $("journey"); j.innerHTML = "";
    STAGES.forEach((s, i) => { if (i) { const l = document.createElement("div"); l.className = "link"; j.appendChild(l); } const d = document.createElement("div"); d.className = "stop"; d.textContent = s.icon; d.style.position = "relative"; j.appendChild(d); });
  }
  function updateHud() {
    setIf("score", S.score, (v) => { $("score").textContent = v.toLocaleString(); });
    setIf("shields", S.shields, (v) => { $("shields").innerHTML = [0, 1, 2].map((i) => `<span class="${i < v ? "" : "lost"}">🛡️</span>`).join(""); });
    setIf("weapon", S.weapon, (v) => { const w = $("weapon"); w.querySelector(".ico").textContent = WEAPONS[v].icon; w.querySelector(".nm").textContent = WEAPONS[v].name; });
    const pct = Math.round((S.meter / METER_MAX) * 100);
    setIf("meter", pct, (v) => { $("meter").querySelector(".liquid").style.width = v + "%"; $("meter").classList.toggle("full", v >= 85); });
    const stage = boss ? 4 : S.planet;
    setIf("stage", stage, (v) => {
      const stops = $("journey").querySelectorAll(".stop"), links = $("journey").querySelectorAll(".link");
      stops.forEach((s, i) => { s.className = "stop" + (i < v ? " done" : i === v ? " now" : ""); s.querySelector(".pname")?.remove(); if (i === v) { const n = document.createElement("div"); n.className = "pname"; n.textContent = STAGES[i].name; s.appendChild(n); } });
      links.forEach((l, i) => l.classList.toggle("done", i < v));
    });
    if (boss) setIf("boss", Math.max(0, Math.round((boss.hp / BOSS_HP) * 100)), (v) => { $("bossbar").querySelector(".fill").style.width = v + "%"; });
  }

  // ── screens ──
  function show(name) {
    S.screen = name; clearActions();
    for (const id of ["title", "house", "over"]) $("scr-" + id).classList.toggle("hidden", id !== name);
    $("to-arcade").style.visibility = name === "play" ? "hidden" : "";
    $("hud").classList.toggle("hidden", name !== "play"); $("touch").classList.toggle("hidden", !(name === "play" && input.isTouch));
    if (name !== "play") $("banner").classList.remove("on");
  }
  let houseSel = 0;
  function buildHouses() {
    const box = $("houses"); box.innerHTML = "";
    HOUSES.forEach((h, i) => {
      const b = document.createElement("button"); b.className = "crest"; b.style.setProperty("--c", h.c); b.style.setProperty("--c2", h.c2);
      b.innerHTML = `<div class="shape"><div class="ani">${h.animal}</div><div class="nm">${h.name}</div></div>`;
      b.addEventListener("pointerenter", () => { if (!input.isTouch) selectHouse(i); });
      b.addEventListener("click", (e) => { e.stopPropagation(); unlockAudio(); selectHouse(i); startRun(); });
      box.appendChild(b);
    });
  }
  function selectHouse(i) { houseSel = (i + HOUSES.length) % HOUSES.length; S.house = houseSel; applyHouse(); $("houses").querySelectorAll(".crest").forEach((c, k) => c.classList.toggle("sel", k === houseSel)); }

  function clearWorld() {
    for (const f of foes) removeFoe(f); for (const b of bolts) scene.remove(b.obj); for (const e of eshots) scene.remove(e.obj); for (const it of items) scene.remove(it.obj);
    foes = []; bolts = []; eshots = []; items = []; sparks.clear(); bigSparks.clear(); fx.clear();
    if (boss) { scene.remove(boss.obj); boss.turrets.forEach((t) => scene.remove(t.obj)); boss = null; }
    $("bossbar").classList.add("hidden"); $("journey").classList.remove("hidden");
  }
  function startRun() {
    unlockAudio(); clearWorld(); sfx.select();
    Object.assign(S, { phase: "sector", phaseT: 0, t: 0, weapon: 0, score: 0, shields: 3, meter: 0, planet: 0, fireT: 0.3, spawnT: 1.2, obsT: 2, ringT: 3, starT: 2, heartGiven: false, kills: 0, won: false, shake: 0 });
    Object.assign(P, { x: 0, y: 0, vx: 0, vy: 0, rollT: 0, rollCd: 0, hurtT: 0, dead: false });
    for (const k in hudCache) delete hudCache[k];
    applyHouse(); setStage(0); show("play"); playMusic("play"); buildJourney();
    const at = params.at;
    if (at === "boss") { S.planet = 3; S.phase = "warp"; S.phaseT = 0.99; S.warped = false; }
    else if (at && +at >= 1 && +at <= 3) { S.planet = +at; setStage(S.planet); }
    else if (at === "power") S.meter = METER_MAX - 0.5;
    if (S.phase === "sector") banner(STAGES[S.planet].name, `planet ${S.planet + 1} of 4`, 2.2);
  }
  function titleStats() {
    $("title-stats").textContent = (S.level > 1 ? `🧙 Wizard Level ${S.level}` : "") + (S.best ? `${S.level > 1 ? "  ·  " : ""}🏆 Best ${S.best.toLocaleString()}` : "");
  }
  function endRun(won) {
    S.won = won; S.overT = 0; const h = house();
    const lvBefore = S.level; if (won) { S.level++; try { localStorage.setItem("sw3d-level", String(S.level)); } catch (e) {} }
    $("over-level").textContent = won ? `⭐ You reached Wizard Level ${S.level}! The Dark Lord is angrier now…` : (lvBefore > 1 ? `Wizard Level ${lvBefore}` : "");
    const best = Math.max(S.best, S.score); const isBest = S.score > S.best && S.score > 0; S.best = best; try { localStorage.setItem("sw3d-best", String(best)); } catch (e) {}
    $("over-title").textContent = won ? "GALAXY SAVED!" : pick(["SHIP DOWN!", "SO CLOSE!", "OOF!"]);
    $("over-title").style.color = won ? "" : "#fca5a5";
    $("over-msg").textContent = won ? `${h.animal} ${h.name} wins the House Cup! 🏆` : `You reached ${boss ? "the Star Fortress" : STAGES[S.planet].name}. The Dark Lord is waiting — try again!`;
    $("over-score").textContent = S.score.toLocaleString(); $("over-best").textContent = best.toLocaleString() + (isBest ? " 🏆" : "");
    clearWorld(); setStage(won ? 0 : Math.min(S.planet, 4)); P.dead = false;
    show("over"); playMusic("title"); won ? sfx.win() : sfx.lose(); titleStats();
  }

  // DOM wiring
  bindTouch($("dragzone"), $("dragdot"), $("btn-roll"), $("btn-swap"));
  $("scr-title").addEventListener("click", () => { unlockAudio(); sfx.select(); playMusic("title"); show("house"); selectHouse(S.house); });
  $("go-again").addEventListener("click", (e) => { e.stopPropagation(); startRun(); });
  $("go-house").addEventListener("click", (e) => { e.stopPropagation(); sfx.select(); show("house"); selectHouse(S.house); });
  $("mute").addEventListener("click", () => { setMuted(!isMuted()); $("mute").textContent = isMuted() ? "🔇" : "🔊"; });
  document.addEventListener("pointerdown", unlockAudio, { capture: true }); document.addEventListener("keydown", unlockAudio, { capture: true });
  buildHouses(); buildJourney(); setStage(0); selectHouse(0); show("title"); titleStats();
  { const b = $("go-title"); b.disabled = false; b.textContent = "▶ PLAY"; }
  if (/\/games\/[^/]+\/?$/.test(location.pathname)) $("to-arcade").classList.remove("hidden");

  function step(dt) {
    if (S.screen === "title") { S.t += dt; if (took("ok") || took("roll")) { unlockAudio(); sfx.select(); playMusic("title"); show("house"); selectHouse(S.house); } }
    else if (S.screen === "house") { S.t += dt; if (took("left")) { selectHouse(houseSel - 1); sfx.swap(); } if (took("right")) { selectHouse(houseSel + 1); sfx.swap(); } if (took("ok")) startRun(); }
    else if (S.screen === "play") { stepPlay(dt); updateHud(); }
    else if (S.screen === "over") { S.t += dt; S.overT += dt; if (S.overT > 0.8 && took("ok")) startRun(); if (took("swap")) { show("house"); selectHouse(S.house); } }
    stepWorld(dt); clearActions();
  }
  function textState() {
    const r = (v) => Math.round(v * 10) / 10;
    return JSON.stringify({
      screen: S.screen, phase: S.phase, stage: boss ? "STAR FORTRESS" : STAGES[S.planet].name, house: house().name, weapon: WEAPONS[S.weapon].name,
      score: S.score, level: S.level, shields: S.shields, meter: r(S.meter), player: { x: r(P.x), y: r(P.y), rolling: P.rollT > 0, dead: P.dead },
      foes: foes.slice(0, 12).map((f) => ({ kind: f.kind, x: r(f.obj.position.x), y: r(f.obj.position.y), z: r(f.obj.position.z), hp: f.hp })),
      enemyShots: eshots.length, bolts: bolts.length, items: items.map((i) => i.kind), boss: boss ? { hp: boss.hp, turrets: boss.turrets.filter((t) => t.alive).length } : null, kills: S.kills, t: r(S.t),
      coords: "ship on z=0 plane; x -10..10 (right+), y -4.2..5.4 (up+); enemies approach from z=-175 toward +z",
    });
  }
  return { step, textState, S };
}
