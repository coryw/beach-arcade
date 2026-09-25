// art.js — every model and texture is procedural (no image files): toon-shaded meshes with ink outlines,
// emoji and pixel-art canvases, glow sprites for the bloom pass to catch.
import * as THREE from "three";

export const TAU = Math.PI * 2;
export const TEX = {};
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ── textures ──────────────────────────────────────────────────────────────
export function canvasTex(w, h, draw, { nearest = false } = {}) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  if (nearest) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; }
  return t;
}
const emojiCache = new Map();
export function emojiTex(ch) {
  if (!emojiCache.has(ch)) emojiCache.set(ch, canvasTex(128, 128, (g) => {
    g.font = '100px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(ch, 64, 70);
  }));
  return emojiCache.get(ch);
}
function pixTex(rows, pal) {
  return canvasTex(rows[0].length, rows.length, (g) => rows.forEach((r, j) => [...r].forEach((ch, i) => { g.fillStyle = pal[ch] || "#f0f"; g.fillRect(i, j, 1, 1); })), { nearest: true });
}
function noiseRows(w, h, chars, pick) { const rows = []; for (let j = 0; j < h; j++) { let r = ""; for (let i = 0; i < w; i++) r += pick ? pick(i, j) : chars[Math.floor(Math.random() * chars.length)]; rows.push(r); } return rows; }

export function initTextures() {
  TEX.glow = canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.22, "rgba(255,255,255,0.85)"); gr.addColorStop(0.55, "rgba(255,255,255,0.2)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  });
  TEX.sparkle = canvasTex(64, 64, (g) => {
    g.globalCompositeOperation = "lighter";
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 16); gr.addColorStop(0, "#fff"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    for (const [w, h] of [[64, 5], [5, 64]]) {
      const lg = w > h ? g.createLinearGradient(0, 0, 64, 0) : g.createLinearGradient(0, 0, 0, 64);
      lg.addColorStop(0, "rgba(255,255,255,0)"); lg.addColorStop(0.5, "#fff"); lg.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = lg; g.fillRect(32 - w / 2, 32 - h / 2, w, h);
    }
  });
  const toon = new THREE.DataTexture(new Uint8Array([70, 150, 255]), 3, 1, THREE.RedFormat);
  toon.minFilter = toon.magFilter = THREE.NearestFilter; toon.needsUpdate = true; TEX.toon = toon;

  const G = { g: "#5aa845", G: "#7cc85e", d: "#79553a", D: "#5e3f2a", k: "#0c1a0c" };
  TEX.grassTop = pixTex(noiseRows(8, 8, "gggGGg"), G);
  TEX.grassSide = pixTex(noiseRows(8, 8, "", (i, j) => (j < 2 || (j === 2 && Math.random() < 0.5) ? (Math.random() < 0.4 ? "G" : "g") : Math.random() < 0.4 ? "D" : "d")), G);
  TEX.dirt = pixTex(noiseRows(8, 8, "dddD"), G);
  const C = { a: "#4f9e3c", b: "#6cc04f", c: "#3d7f2e", k: "#0b150b" };
  TEX.creeperSkin = pixTex(noiseRows(8, 8, "aabbc"), C);
  TEX.creeperFace = pixTex(["abaabcab", "akkaakka", "akkaakka", "abakkaba", "aakkkkab", "abkkkkba", "aakaakaa", "baabcaab"], C);
  TEX.tntSide = canvasTex(64, 64, (g) => {
    g.fillStyle = "#d62b20"; g.fillRect(0, 0, 64, 64);
    g.fillStyle = "#a61e16"; for (let x = 0; x < 64; x += 16) g.fillRect(x, 0, 3, 64);
    g.fillStyle = "#f5f0e6"; g.fillRect(0, 22, 64, 20);
    g.fillStyle = "#111"; g.font = "bold 17px monospace"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("TNT", 32, 33);
  }, { nearest: true });
  TEX.tntTop = canvasTex(16, 16, (g) => { g.fillStyle = "#c9a36b"; g.fillRect(0, 0, 16, 16); g.fillStyle = "#555"; g.fillRect(6, 6, 4, 4); }, { nearest: true });
  TEX.nooFace = canvasTex(64, 64, (g) => {
    g.fillStyle = "#f5cd30"; g.fillRect(0, 0, 64, 64); g.fillStyle = "#111";
    g.beginPath(); g.ellipse(22, 26, 4, 6, 0, 0, TAU); g.ellipse(42, 26, 4, 6, 0, 0, TAU); g.fill();
    g.lineWidth = 4; g.strokeStyle = "#111"; g.beginPath(); g.arc(32, 34, 13, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
  });
  TEX.fortress = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = "#4a4f5c"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) { g.fillStyle = Math.random() < 0.5 ? "#3a3e49" : "#5b6170"; g.fillRect(Math.random() * w, Math.random() * h, 4 + Math.random() * 26, 3 + Math.random() * 10); }
    g.fillStyle = "#23262e"; for (let y = 0; y < h; y += 16) g.fillRect(0, y, w, 1); for (let x = 0; x < w; x += 24) g.fillRect(x, 0, 1, h);
    for (let i = 0; i < 260; i++) { g.fillStyle = Math.random() < 0.8 ? "#ffe9a8" : "#7dd3fc"; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  });
}

// ── materials ─────────────────────────────────────────────────────────────
export const toon = (color, o = {}) => new THREE.MeshToonMaterial(Object.assign({ color, gradientMap: TEX.toon }, o));
export const glowMat = (color, opacity = 1, map = TEX.glow) => new THREE.SpriteMaterial({ map, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
export function glow(color, scale, opacity = 1, map) { const s = new THREE.Sprite(glowMat(color, opacity, map)); s.scale.setScalar(scale); return s; }
const INK = () => (TEX.ink ||= new THREE.MeshBasicMaterial({ color: 0x120a1e, side: THREE.BackSide }));
/** ink outline: an inverted hull a touch bigger than the mesh */
export function ink(mesh, s = 1.07) { const o = new THREE.Mesh(mesh.geometry, INK()); o.scale.setScalar(s); o.raycast = () => {}; mesh.add(o); return mesh; }
function mesh(geo, mat, x = 0, y = 0, z = 0, parent) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); if (parent) parent.add(m); return m; }
const geoCache = new Map();
const geo = (key, make) => { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); };

// ── the player's starship ─────────────────────────────────────────────────
export function buildShip() {
  const g = new THREE.Group();
  const white = toon(0xf4f1ea), house = toon(0xdc2626), stripe = toon(0xfbbf24), dark = toon(0x3b4252);
  const glass = new THREE.MeshToonMaterial({ color: 0x7dd3fc, gradientMap: TEX.toon, emissive: 0x1e3a8a, emissiveIntensity: 0.8 });
  const purple = toon(0x7c3aed, { emissive: 0x2e1065, emissiveIntensity: 0.6 }), gold = toon(0xffc93c, { emissive: 0x5a3c00, emissiveIntensity: 0.5 });
  const nose = ink(mesh(new THREE.ConeGeometry(0.72, 3.8, 18), white, 0, 0, -1.3, g)); nose.rotation.x = -Math.PI / 2;
  const body = ink(mesh(new THREE.CylinderGeometry(0.62, 0.8, 2.1, 18), house, 0, 0, 1.55, g)); body.rotation.x = Math.PI / 2;
  const noz = ink(mesh(new THREE.CylinderGeometry(0.5, 0.66, 0.5, 18), dark, 0, 0, 2.8, g)); noz.rotation.x = Math.PI / 2;
  const cockpit = ink(mesh(new THREE.SphereGeometry(0.55, 20, 14), glass, 0, 0.48, -0.55, g)); cockpit.scale.set(0.9, 0.75, 1.7);
  // swept wings (mirrored clone)
  const ws = new THREE.Shape(); ws.moveTo(0, -0.9); ws.lineTo(3.3, 0.9); ws.lineTo(3.3, 1.55); ws.lineTo(0, 1.65); ws.closePath();
  const wgeo = new THREE.ExtrudeGeometry(ws, { depth: 0.16, bevelEnabled: false }); wgeo.rotateX(Math.PI / 2);
  const wingR = new THREE.Group(); wingR.position.set(0.45, 0.05, 0.4); wingR.rotation.z = 0.13;
  ink(mesh(wgeo, house, 0, 0, 0, wingR), 1.04);
  const st = mesh(new THREE.BoxGeometry(3.1, 0.06, 0.28), stripe, 1.6, 0.03, 0.18, wingR); st.rotation.y = -0.5;
  const cannon = ink(mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.7, 8), dark, 3.35, 0, 0.9, wingR)); cannon.rotation.x = Math.PI / 2;
  const tip = glow(0xffe08a, 1.1); tip.position.set(3.35, 0, 0.0); wingR.add(tip);
  const wingL = wingR.clone(); wingL.scale.x = -1; wingL.rotation.z = -0.13; wingL.position.x = -0.45;
  g.add(wingR, wingL);
  // wand-fins: two purple wands angled back, each with a star on the tip
  for (const s of [-1, 1]) {
    const wand = ink(mesh(new THREE.CylinderGeometry(0.06, 0.1, 2.3, 8), purple, 0.5 * s, 1.0, 2.3, g)); wand.rotation.set(-0.95, 0, -0.3 * s);
    const sp = glow(0xe9d5ff, 1.2, 1, TEX.sparkle); sp.position.set(0.5 * s + 0.33 * s, 1.95, 2.95); g.add(sp);
  }
  // the wizard hat, of course
  const hat = new THREE.Group(); hat.position.set(0, 0.95, 0.55); hat.rotation.set(0.28, 0, 0.08); g.add(hat);
  ink(mesh(new THREE.CylinderGeometry(0.78, 0.78, 0.07, 22), purple, 0, 0, 0, hat));
  const cone = ink(mesh(new THREE.ConeGeometry(0.5, 1.35, 18), purple, 0, 0.7, 0, hat)); cone.rotation.z = 0.12;
  const band = mesh(new THREE.TorusGeometry(0.47, 0.07, 8, 22), gold, 0, 0.12, 0, hat); band.rotation.x = Math.PI / 2;
  const hatStar = glow(0xffd76a, 0.9, 1, TEX.sparkle); hatStar.position.set(0.12, 1.42, 0); hat.add(hatStar);
  // engine
  const engine = glow(0xffa94d, 2.6); engine.position.set(0, 0, 3.2); g.add(engine);
  const core = glow(0xffffff, 1.1); core.position.set(0, 0, 3.1); g.add(core);
  // light sword (hidden until swung)
  const saber = new THREE.Group(); saber.position.set(0, 0, -0.5); saber.visible = false; g.add(saber);
  const bladeMat = new THREE.MeshBasicMaterial({ color: 0xff6b6b });
  const blade = mesh(new THREE.CylinderGeometry(0.14, 0.14, 7, 10), bladeMat, 0, 0, -3.8, saber); blade.rotation.x = Math.PI / 2;
  const bladeCore = mesh(new THREE.CylinderGeometry(0.07, 0.07, 7.05, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), 0, 0, -3.8, saber); bladeCore.rotation.x = Math.PI / 2;
  function setHouse(h) {
    house.color.set(h.c); stripe.color.set(h.c2 === "#1f2937" ? "#111827" : h.c2);
    engine.material.color.set(h.glow); tip.material.color.set(h.glow); bladeMat.color.set(h.saber);
    wingL.traverse((o) => { if (o.isSprite) o.material = tip.material; });
  }
  return { group: g, setHouse, engine, core, saber, hatStar };
}

// ── enemies ───────────────────────────────────────────────────────────────
function saucer() {
  const o = new THREE.Group(), spin = new THREE.Group(); o.add(spin); o.rotation.x = 0.42;
  const metal = toon(0xc7ced8), under = toon(0x6b7280);
  ink(mesh(geo("sDisc", () => new THREE.CylinderGeometry(1.2, 2.3, 0.55, 28)), metal, 0, 0, 0, spin));
  ink(mesh(geo("sUnder", () => new THREE.CylinderGeometry(2.3, 0.9, 0.45, 28)), under, 0, -0.48, 0, spin));
  const dome = mesh(geo("sDome", () => new THREE.SphereGeometry(1.0, 20, 12, 0, TAU, 0, Math.PI / 2)), new THREE.MeshToonMaterial({ color: 0xa7f3d0, gradientMap: TEX.toon, transparent: true, opacity: 0.55 }), 0, 0.26, 0, spin);
  const alien = ink(mesh(geo("sAlien", () => new THREE.SphereGeometry(0.46, 16, 12)), toon(0x4ade80), 0, 0.5, 0, spin));
  for (const s of [-1, 1]) mesh(geo("eye", () => new THREE.SphereGeometry(0.11, 8, 6)), new THREE.MeshBasicMaterial({ color: 0x111111 }), 0.17 * s, 0.07, 0.4, alien);
  const lightGeo = geo("sLight", () => new THREE.SphereGeometry(0.17, 8, 6));
  for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; mesh(lightGeo, new THREE.MeshBasicMaterial({ color: i % 2 ? 0xfde047 : 0xf472b6 }), Math.cos(a) * 2.05, -0.2, Math.sin(a) * 2.05, spin); }
  const beam = glow(0x4ade80, 4, 0.55); beam.position.y = -1.1; o.add(beam);
  return { obj: o, spin, dome };
}
function fighter() {
  const o = new THREE.Group(); const dark = toon(0x4b5563), panel = toon(0x1f2937);
  ink(mesh(geo("fBall", () => new THREE.SphereGeometry(0.9, 20, 14)), dark, 0, 0, 0, o));
  const win = mesh(geo("fWin", () => new THREE.CircleGeometry(0.52, 20)), new THREE.MeshBasicMaterial({ color: 0xff3b3b }), 0, 0, 0.9, o);
  const strut = mesh(geo("fStrut", () => new THREE.CylinderGeometry(0.18, 0.18, 3.1, 8)), dark, 0, 0, 0, o); strut.rotation.z = Math.PI / 2;
  for (const s of [-1, 1]) {
    const p = ink(mesh(geo("fPanel", () => new THREE.CylinderGeometry(1.9, 1.9, 0.14, 6)), panel, 1.6 * s, 0, 0, o), 1.04); p.rotation.z = Math.PI / 2;
    const edge = mesh(geo("fEdge", () => new THREE.TorusGeometry(1.8, 0.09, 6, 6)), new THREE.MeshBasicMaterial({ color: 0xd946ef }), 1.62 * s, 0, 0, o); edge.rotation.y = Math.PI / 2;
  }
  const eng = glow(0xff4d6d, 1.6); o.add(eng);
  return { obj: o, win };
}
function creeper() {
  const o = new THREE.Group(); o.scale.setScalar(1.25);
  const skin = new THREE.MeshToonMaterial({ map: TEX.creeperSkin, gradientMap: TEX.toon }), face = new THREE.MeshToonMaterial({ map: TEX.creeperFace, gradientMap: TEX.toon });
  ink(mesh(geo("cHead", () => new THREE.BoxGeometry(1.2, 1.2, 1.2)), [skin, skin, skin, skin, face, skin], 0, 1.1, 0, o), 1.05);
  ink(mesh(geo("cBody", () => new THREE.BoxGeometry(0.85, 1.4, 0.6)), skin, 0, -0.2, 0, o), 1.05);
  const feet = [];
  for (const [x, z] of [[-0.25, 0.32], [0.25, 0.32], [-0.25, -0.32], [0.25, -0.32]]) feet.push(ink(mesh(geo("cFoot", () => new THREE.BoxGeometry(0.44, 0.5, 0.44)), skin, x, -1.15, z, o), 1.05));
  return { obj: o, feet };
}
function robot() {
  const o = new THREE.Group(); o.scale.setScalar(0.92);
  const yel = toon(0xf5cd30), blue = toon(0x1e6fd9), green = toon(0x4caf50), faceM = new THREE.MeshToonMaterial({ map: TEX.nooFace, gradientMap: TEX.toon });
  ink(mesh(geo("rHead", () => new THREE.BoxGeometry(1.1, 1.0, 1.0)), [yel, yel, yel, yel, faceM, yel], 0, 1.45, 0, o), 1.05);
  ink(mesh(geo("rTorso", () => new THREE.BoxGeometry(1.6, 1.6, 0.8)), blue, 0, 0.1, 0, o), 1.04);
  const arms = [];
  for (const s of [-1, 1]) { const p = new THREE.Group(); p.position.set(1.15 * s, 0.8, 0); o.add(p); ink(mesh(geo("rArm", () => new THREE.BoxGeometry(0.7, 1.5, 0.7)), yel, 0, -0.65, 0, p), 1.05); arms.push(p); }
  for (const s of [-1, 1]) ink(mesh(geo("rLeg", () => new THREE.BoxGeometry(0.72, 1.5, 0.75)), green, 0.4 * s, -1.45, 0, o), 1.05);
  const jet = glow(0xff9f1a, 2.4); jet.position.y = -2.6; o.add(jet);
  return { obj: o, arms, jet };
}
function dementor() {
  const o = new THREE.Group();
  const cloakM = toon(0x1b1830, { side: THREE.DoubleSide });
  const cloak = ink(mesh(geo("dCloak", () => new THREE.ConeGeometry(1.35, 3.4, 12, 1, true)), cloakM, 0, -0.5, 0, o), 1.04);
  ink(mesh(geo("dHood", () => new THREE.SphereGeometry(0.78, 16, 12)), cloakM, 0, 1.1, 0, o), 1.05);
  mesh(geo("dHole", () => new THREE.CircleGeometry(0.46, 16)), new THREE.MeshBasicMaterial({ color: 0x000000 }), 0, 1.05, 0.74, o);
  for (const s of [-1, 1]) { const e = glow(0xa5f3fc, 0.55); e.position.set(0.19 * s, 1.12, 0.86); o.add(e); }
  const aura = glow(0x8b5cf6, 6, 0.35); o.add(aura);
  return { obj: o, cloak };
}
export function dragonHead() {
  const o = new THREE.Group(); const grn = toon(0x16a34a), gold = toon(0xffc93c);
  ink(mesh(geo("dgHead", () => new THREE.BoxGeometry(1.5, 1.1, 1.7)), grn, 0, 0, 0, o), 1.05);
  ink(mesh(geo("dgSnout", () => new THREE.BoxGeometry(1.05, 0.72, 1.1)), grn, 0, -0.15, 1.25, o), 1.05);
  for (const s of [-1, 1]) {
    const h = ink(mesh(geo("dgHorn", () => new THREE.ConeGeometry(0.2, 0.9, 8)), gold, 0.5 * s, 0.85, -0.4, o)); h.rotation.x = -0.6;
    const e = glow(0xfde047, 0.7); e.position.set(0.45 * s, 0.3, 0.86); o.add(e);
  }
  const fire = glow(0xff7b1a, 1.8); fire.position.set(0, -0.15, 1.9); o.add(fire);
  return { obj: o, fire };
}
export function dragonSeg(i) {
  const r = 1.1 - i * 0.07; const o = ink(new THREE.Mesh(geo("dgSeg", () => new THREE.SphereGeometry(1, 14, 10)), toon(i % 2 ? 0x15803d : 0x22c55e)), 1.06); o.scale.setScalar(r);
  const spike = ink(mesh(geo("dgSpike", () => new THREE.ConeGeometry(0.28, 0.7, 6)), toon(0xffc93c), 0, 1.0, 0, o)); spike.rotation.x = -0.3;
  let wings = null;
  if (i === 1) {
    wings = [];
    for (const s of [-1, 1]) { const p = new THREE.Group(); o.add(p); const w = ink(mesh(geo("dgWing", () => new THREE.BoxGeometry(3.2, 0.08, 1.6)), toon(0xa855f7, { side: THREE.DoubleSide }), 1.7 * s, 0, 0, p), 1.03); wings.push(p); }
  }
  return { obj: o, r, wings };
}
function rock() {
  const r = 1.3 + Math.random() * 1.1; const m = ink(new THREE.Mesh(geo("rock", () => new THREE.DodecahedronGeometry(1, 0)), toon(0xc48a4f, { flatShading: true })), 1.06);
  m.scale.set(r, r * 0.8, r * 1.1); return { obj: m, r: r * 1.05 };
}
function block(tnt) {
  const T = tnt ? [TEX.tntSide, TEX.tntTop, TEX.tntTop] : [TEX.grassSide, TEX.grassTop, TEX.dirt];
  const side = new THREE.MeshToonMaterial({ map: T[0], gradientMap: TEX.toon }), top = new THREE.MeshToonMaterial({ map: T[1], gradientMap: TEX.toon }), bot = new THREE.MeshToonMaterial({ map: T[2], gradientMap: TEX.toon });
  const m = ink(new THREE.Mesh(geo("block", () => new THREE.BoxGeometry(2.5, 2.5, 2.5)), [side, side, top, bot, side, side]), 1.04);
  return { obj: m, r: 1.9 };
}
function crystal() {
  const m = ink(new THREE.Mesh(geo("crystal", () => new THREE.OctahedronGeometry(1, 0)), new THREE.MeshToonMaterial({ color: 0xbfe9ff, gradientMap: TEX.toon, emissive: 0x2563eb, emissiveIntensity: 0.35, transparent: true, opacity: 0.9, flatShading: true })), 1.05);
  m.scale.set(1.2, 2.0, 1.2); const g = glow(0x7dd3fc, 3, 0.5); m.add(g); return { obj: m, r: 1.9 };
}
export const FOES = {
  saucer: { hp: 1, r: 2.4, score: 10, speed: 8, home: 0.25, build: saucer, sparks: ["#4ade80", "#fde047", "#f472b6", "#fff"] },
  fighter: { hp: 1, r: 2.3, score: 15, speed: 12, home: 0.3, shoots: true, build: fighter, sparks: ["#d946ef", "#ff4d6d", "#e5e7eb"] },
  creeper: { hp: 2, r: 2.0, score: 15, speed: 7, home: 0.35, build: creeper, sparks: ["#4ade80", "#86efac", "#166534", "#fff"] },
  robot: { hp: 2, r: 2.1, score: 15, speed: 9, home: 0.3, shoots: true, build: robot, sparks: ["#f5cd30", "#1e6fd9", "#4caf50", "#fff"] },
  dementor: { hp: 2, r: 2.0, score: 20, speed: 10, home: 0.8, build: dementor, sparks: ["#e0f2fe", "#c4b5fd", "#ffffff", "#a5f3fc"] },
  dragon: { hp: 9, r: 1.6, score: 80, speed: 6, home: 0.15, shoots: true, sparks: ["#22c55e", "#fde047", "#a855f7", "#ff7b1a"] },
  rock: { hp: 2, score: 5, speed: 0, obstacle: true, build: rock, sparks: ["#c48a4f", "#e7b77d", "#fff"] },
  block: { hp: 1, score: 5, speed: 0, obstacle: true, build: () => block(false), sparks: ["#5aa845", "#79553a", "#7cc85e"] },
  tnt: { hp: 1, score: 25, speed: 0, obstacle: true, build: () => block(true), sparks: ["#ff5a1f", "#fde047", "#fff"] },
  crystal: { hp: 2, score: 5, speed: 0, obstacle: true, build: crystal, sparks: ["#bfe9ff", "#7dd3fc", "#fff"] },
};

// ── pickups ───────────────────────────────────────────────────────────────
export function starPickup() {
  const s = new THREE.Shape(); for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU + Math.PI / 2, r = i % 2 ? 0.36 : 0.85; i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  const m = ink(new THREE.Mesh(geo("star", () => { const g = new THREE.ExtrudeGeometry(s, { depth: 0.28, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 1 }); g.center(); return g; }), toon(0xffc93c, { emissive: 0xb45309, emissiveIntensity: 0.6 })), 1.08);
  m.add(glow(0xffd76a, 2.4, 0.6)); return m;
}
export function heartPickup() {
  const o = new THREE.Group(); const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTex("💖"), transparent: true, depthWrite: false })); s.scale.setScalar(2.4); o.add(s); o.add(glow(0xff6bb5, 4.5, 0.6)); return o;
}
export function ringPickup() {
  const m = new THREE.Mesh(geo("ring", () => new THREE.TorusGeometry(2.8, 0.26, 10, 44)), toon(0xffc93c, { emissive: 0xffa000, emissiveIntensity: 0.9 })); ink(m, 1.05); return m;
}

// ── the boss: the Dark Lord's Star Fortress ───────────────────────────────
export function buildBoss() {
  const o = new THREE.Group();
  const hull = new THREE.MeshToonMaterial({ map: TEX.fortress, gradientMap: TEX.toon });
  const core = ink(mesh(new THREE.SphereGeometry(9, 48, 28), hull, 0, 0, 0, o), 1.02);
  const trench = mesh(new THREE.TorusGeometry(9.05, 0.35, 8, 72), new THREE.MeshBasicMaterial({ color: 0x22ff88 }), 0, 0, 0, o); trench.rotation.x = Math.PI / 2;
  const dish = mesh(new THREE.SphereGeometry(2.9, 24, 16), toon(0x2d3039), 2.6, 3.2, 7.7, o); dish.scale.z = 0.35;
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
  const eye = mesh(new THREE.SphereGeometry(1.35, 20, 14), eyeMat, 2.75, 3.35, 8.55, o);
  mesh(new THREE.SphereGeometry(0.55, 14, 10), new THREE.MeshBasicMaterial({ color: 0x120000 }), 2.95, 3.5, 9.7, o);
  const eyeGlow = glow(0xff3030, 9, 0.9); eyeGlow.position.copy(eye.position); o.add(eyeGlow);
  const halo = glow(0x7c3aed, 34, 0.35); halo.position.z = -4; o.add(halo);
  const turrets = [];
  for (let i = 0; i < 3; i++) {
    const t = new THREE.Group(); const b = ink(mesh(geo("tBall", () => new THREE.SphereGeometry(1.3, 16, 12)), toon(0x6d28d9, { emissive: 0x3b0764, emissiveIntensity: 0.6 }), 0, 0, 0, t));
    const gl = glow(0xd946ef, 4, 0.8); t.add(gl);
    for (const s of [-1, 1]) { const sp = ink(mesh(geo("tSpike", () => new THREE.ConeGeometry(0.35, 1.2, 8)), toon(0x1f2937), 1.4 * s, 0, 0, t)); sp.rotation.z = -Math.PI / 2 * s; }
    turrets.push({ obj: t, hp: 5, alive: true, shootT: 1 + i * 0.7, a: (i / 3) * TAU });
  }
  return { obj: o, core, eye, eyeMat, eyeGlow, turrets };
}

// ── planet backdrops ──────────────────────────────────────────────────────
export function planetTexture(kind) {
  const lerp = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t).getStyle();
  return canvasTex(512, 256, (g, w, h) => {
    if (kind === "blocky") {
      const cs = 16; for (let y = 0; y < h; y += cs) for (let x = 0; x < w; x += cs) {
        const lat = Math.abs(y / h - 0.5) * 2; const n = Math.sin(x * 0.05) + Math.cos(y * 0.07 + x * 0.02) + Math.random() * 0.8;
        g.fillStyle = lat > 0.82 ? "#f8fafc" : n > 1.1 ? "#5aa845" : n > 0.4 ? "#7cc85e" : n > -0.2 ? "#a47148" : "#2f7fd8"; g.fillRect(x, y, cs, cs);
      }
      return;
    }
    const pal = { sand: ["#f3b457", "#c9772a", "#ffd88a"], ice: ["#e0f2fe", "#93c5fd", "#ffffff"], neb: ["#7e22ce", "#3b0764", "#e879f9"], dark: ["#3f3f46", "#18181b", "#71717a"] }[kind] || ["#888", "#444", "#ccc"];
    for (let y = 0; y < h; y++) { const t = y / h; const n = 0.5 + 0.5 * Math.sin(t * 22 + Math.sin(t * 7) * 2.2); g.fillStyle = n > 0.5 ? lerp(pal[0], pal[2], (n - 0.5) * 2) : lerp(pal[1], pal[0], n * 2); g.fillRect(0, y, w, 1); }
    for (let i = 0; i < 90; i++) { g.fillStyle = Math.random() < 0.5 ? pal[1] + "66" : pal[2] + "55"; g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, 6 + Math.random() * 30, 2 + Math.random() * 8, 0, 0, TAU); g.fill(); }
  });
}
export function skyTexture(top, mid, bot) {
  return canvasTex(8, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, top); gr.addColorStop(0.5, mid); gr.addColorStop(1, bot); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
}
export { V };
