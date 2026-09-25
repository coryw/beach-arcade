// art.js — procedural textures, materials, geometry, screen-space ink, sky/fog, lights, terrain, scatter (toolbox v1).
// Mechanisms only: every color, palette, sky, fog and outline color is a required argument — nothing here has a look.
// Geometry from geo.* is cached and shared: never dispose it. Noise is seeded, so ?seed makes worlds repeatable.
// API and costs: kit/three/README.md (art section).
import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const need = (fn, name, v) => { if (v == null) throw new Error(`${fn}: ${name} is required — decide it in the art direction`); return v; };
const col = (c) => (c && c.isColor ? c.clone() : new THREE.Color(c));
const css = (c) => "#" + col(c).getHexString();
const cache = (map, key, make) => { let v = map.get(key); if (v === undefined) { v = make(); map.set(key, v); } return v; };
const TEX = new Map(), GEO = new Map();

// ── seeded noise (value noise; hashes, never Math.random) ───────────────────
function hash(x, y, z, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177) ^ Math.imul(s | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const fade = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
function vnoise(x, y, seed, px = 0) {   // → [-1, 1]; px > 0 makes it tile with that period
  const x0 = Math.floor(x), y0 = Math.floor(y), u = fade(x - x0), v = fade(y - y0);
  const w = (i) => (px ? ((i % px) + px) % px : i);
  const a = hash(w(x0), w(y0), 0, seed), b = hash(w(x0 + 1), w(y0), 0, seed), c = hash(w(x0), w(y0 + 1), 0, seed), d = hash(w(x0 + 1), w(y0 + 1), 0, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v) * 2 - 1;
}
export function noise2(x, y, seed = 1) { return vnoise(x, y, seed); }
export function fbm2(x, y, { octaves = 4, seed = 1, lacunarity = 2, gain = 0.5 } = {}) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let o = 0; o < octaves; o++) { sum += amp * vnoise(x * f, y * f, seed + o * 101); norm += amp; amp *= gain; f *= lacunarity; }
  return sum / norm;
}
function noise3(x, y, z, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z), u = fade(x - x0), v = fade(y - y0), w = fade(z - z0);
  const h = (i, j, k) => hash(x0 + i, y0 + j, z0 + k, seed);
  const a = lerp(lerp(h(0, 0, 0), h(1, 0, 0), u), lerp(h(0, 1, 0), h(1, 1, 0), u), v);
  const b = lerp(lerp(h(0, 0, 1), h(1, 0, 1), u), lerp(h(0, 1, 1), h(1, 1, 1), u), v);
  return lerp(a, b, w) * 2 - 1;
}
const mulberry = (a) => () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// ── textures ────────────────────────────────────────────────────────────────
export function canvasTex(w, h, draw, { nearest = false, repeat = null } = {}) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  if (nearest) { t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; }
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
export function pixTex(rows, palette, { scale = 1 } = {}) {
  need("pixTex", "rows", rows); need("pixTex", "palette", palette); const W = Math.max(...rows.map((r) => r.length));
  const pal = Object.fromEntries(Object.entries(palette).map(([k, v]) => [k, css(v)]));
  return canvasTex(W * scale, rows.length * scale, (g) => rows.forEach((r, j) => [...r].forEach((ch, i) => { if (pal[ch]) { g.fillStyle = pal[ch]; g.fillRect(i * scale, j * scale, scale, scale); } })), { nearest: true });
}
export function noiseTex({ size = 128, colors, scale = 4, seed = 1 } = {}) {
  need("noiseTex", "colors", colors); const [a, b] = colors.map(col);
  const t = canvasTex(size, size, (g) => {
    const img = g.createImageData(size, size), d = img.data;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let n = 0, amp = 0.5, f = scale; for (let o = 0; o < 4; o++) { n += amp * vnoise((x / size) * f, (y / size) * f, seed + o, f); amp *= 0.5; f *= 2; }
      const k = Math.min(1, Math.max(0, n / 0.9375 * 0.5 + 0.5)), c = a.clone().lerp(b, k).convertLinearToSRGB(), i = (y * size + x) * 4;
      d[i] = c.r * 255; d[i + 1] = c.g * 255; d[i + 2] = c.b * 255; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
export function gradientTex(stops, { size = 256, vertical = true } = {}) {
  need("gradientTex", "stops", stops);
  return canvasTex(vertical ? 4 : size, vertical ? size : 4, (g, w, h) => {
    const gr = vertical ? g.createLinearGradient(0, 0, 0, h) : g.createLinearGradient(0, 0, w, 0);
    for (const [t, c] of stops) gr.addColorStop(t, css(need("gradientTex", "stop color", c)));
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
}
const radial = (g, w, rgb, stops, r = w / 2) => { const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, r); for (const [t, a] of stops) gr.addColorStop(t, `rgba(${rgb},${a})`); g.fillStyle = gr; g.fillRect(0, 0, w, w); };
export function glowTex(size = 64) { return cache(TEX, "glow" + size, () => canvasTex(size, size, (g, w) => radial(g, w, "255,255,255", [[0, 1], [0.22, 0.85], [0.55, 0.2], [1, 0]]))); }
export function sparkleTex(size = 64) {
  return cache(TEX, "sparkle" + size, () => canvasTex(size, size, (g, w) => {
    const r = w / 2, t = Math.max(2, w / 13); g.globalCompositeOperation = "lighter"; radial(g, w, "255,255,255", [[0, 1], [1, 0]], r / 2);
    for (const h of [1, 0]) { const lg = g.createLinearGradient(0, 0, h * w, (1 - h) * w); lg.addColorStop(0, "rgba(255,255,255,0)"); lg.addColorStop(0.5, "#fff"); lg.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = lg; h ? g.fillRect(0, r - t / 2, w, t) : g.fillRect(r - t / 2, 0, t, w); }
  }));
}
export function emojiTex(ch, size = 128) {
  return cache(TEX, "emoji" + ch + size, () => canvasTex(size, size, (g, w) => {
    g.font = `${Math.round(w * 0.78)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(ch, w / 2, w * 0.55);
  }));
}
export function toonRamp(steps = 3) {
  return cache(TEX, "toon" + steps, () => {
    const n = Math.max(2, steps | 0), d = new Uint8Array(n);
    for (let i = 0; i < n; i++) d[i] = Math.round(255 * (0.28 + (0.72 * i) / (n - 1)));
    const t = new THREE.DataTexture(d, n, 1, THREE.RedFormat); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t;
  });
}

// ── materials ───────────────────────────────────────────────────────────────
export const mat = {
  toon: (color, { steps = 3, emissive = 0x000000, emissiveIntensity = 0 } = {}) =>
    new THREE.MeshToonMaterial({ color: need("mat.toon", "color", color), gradientMap: toonRamp(steps), emissive, emissiveIntensity }),
  lambert: (color, { flat = false, emissive = 0x000000 } = {}) => new THREE.MeshLambertMaterial({ color: need("mat.lambert", "color", color), flatShading: flat, emissive }),
  standard: (color, { metalness = 0, roughness = 0.5, emissive = 0x000000, emissiveIntensity = 0 } = {}) =>
    new THREE.MeshStandardMaterial({ color: need("mat.standard", "color", color), metalness, roughness, emissive, emissiveIntensity }),
  unlit: (color, { transparent = false, opacity = 1, side = THREE.FrontSide } = {}) =>
    new THREE.MeshBasicMaterial({ color: need("mat.unlit", "color", color), transparent: transparent || opacity < 1, opacity, side }),
  hot: (color, intensity = 2) => new THREE.MeshBasicMaterial({ color: col(need("mat.hot", "color", color)).multiplyScalar(intensity), toneMapped: false }),
  glow: (color, { opacity = 1, map = glowTex() } = {}) =>
    new THREE.SpriteMaterial({ color: need("mat.glow", "color", color), map, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }),
};

// ── ink: screen-space outline hull ──────────────────────────────────────────
// Hull = mergeVertices + smooth normals over DISTINCT face planes (exact box diagonals, no cracks); inkMiter = 1/min(n·face)
// so a corner reaches px from every face. The shader pushes px CSS px along the screen normal × clip.w: same width anywhere.
const HULLS = new WeakMap(), INK_MATS = new Map(), INK_RES = { value: new THREE.Vector2(1, 1) };
function hullGeometry(src) {
  return cache(HULLS, src, () => {
    const g0 = new THREE.BufferGeometry(); g0.setAttribute("position", src.attributes.position.clone()); if (src.index) g0.setIndex(src.index.clone());
    const g = mergeVertices(g0, 1e-4), P = g.attributes.position, I = g.index, n = P.count, planes = Array.from({ length: n }, () => []);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let t = 0; t < I.count; t += 3) {
      const ia = I.getX(t), ib = I.getX(t + 1), ic = I.getX(t + 2);
      a.fromBufferAttribute(P, ia); b.fromBufferAttribute(P, ib); c.fromBufferAttribute(P, ic);
      const f = b.sub(a).cross(c.sub(a)); if (f.lengthSq() < 1e-14) continue; f.normalize();
      for (const v of [ia, ib, ic]) if (!planes[v].some((p) => p.dot(f) > 0.999)) planes[v].push(f.clone());
    }
    const N = new Float32Array(n * 3), M = new Float32Array(n), s = new THREE.Vector3();
    for (let v = 0; v < n; v++) {
      s.set(0, 0, 0); for (const p of planes[v]) s.add(p);
      if (s.lengthSq() < 1e-10) { if (planes[v][0]) s.copy(planes[v][0]); else s.set(0, 1, 0); }
      s.normalize(); let m = 1; for (const p of planes[v]) m = Math.max(m, 1 / Math.max(0.4, s.dot(p)));
      N[v * 3] = s.x; N[v * 3 + 1] = s.y; N[v * 3 + 2] = s.z; M[v] = m;
    }
    g.setAttribute("normal", new THREE.BufferAttribute(N, 3)); g.setAttribute("inkMiter", new THREE.BufferAttribute(M, 1));
    g.computeBoundingSphere(); g0.dispose(); return g;
  });
}
const INK_VS = `{
  vec3 inkN = normal;
#ifdef USE_INSTANCING
  inkN = mat3(instanceMatrix) * inkN;
#endif
  vec3 nv = normalize(normalMatrix * inkN) * inkMiter;
  vec3 ray = isOrthographic ? vec3(0.0, 0.0, -1.0) : normalize(mvPosition.xyz);
  vec3 perp = nv - dot(nv, ray) * ray;
  float pl = min(length(perp), 2.5);
  vec4 q = projectionMatrix * vec4(mvPosition.xyz + perp * (0.002 * max(1.0, abs(mvPosition.z))), 1.0);
  vec2 d = (q.xy / q.w - gl_Position.xy / gl_Position.w) * uInkRes;
  float dl = length(d);
  if (dl > 1e-7) gl_Position.xy += (d / dl) * pl * uInkPx * 2.0 / uInkRes * gl_Position.w;
}`;
const setInkRes = (r) => r.getSize(INK_RES.value);
function inkMaterial(color, px) {
  need("ink", "color", color);
  return cache(INK_MATS, css(color) + "|" + px, () => {
    const m = new THREE.MeshBasicMaterial({ color: col(color), side: THREE.BackSide }), uPx = { value: px };
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uInkPx = uPx; sh.uniforms.uInkRes = INK_RES;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float inkMiter;\nuniform float uInkPx;\nuniform vec2 uInkRes;")
        .replace("#include <project_vertex>", "#include <project_vertex>\n" + INK_VS);
    };
    m.customProgramCacheKey = () => "kit-ink-1"; m.userData.inkPx = uPx; return m;
  });
}
export function ink(mesh, { px = 3, color } = {}) {
  need("ink", "color", color); need("ink", "mesh", mesh);
  if (!mesh.isMesh) { const out = []; mesh.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && !o.userData.inkHull && !o.children.some((k) => k.userData.inkHull)) out.push(o); }); return out.map((o) => ink(o, { px, color })); }
  const hull = new THREE.Mesh(hullGeometry(mesh.geometry), inkMaterial(color, px));
  hull.userData.inkHull = true; hull.raycast = () => {}; hull.onBeforeRender = setInkRes; hull.renderOrder = mesh.renderOrder; mesh.add(hull); return hull;
}
ink.hull = hullGeometry; ink.material = inkMaterial; ink.onBeforeRender = setInkRes;   // for physics.InstancedPool {ink}

// ── geometry ────────────────────────────────────────────────────────────────
export function part(geometry, material, pos = [0, 0, 0], parent = null, { rot, scale, ink: inkOpt = null, castShadow = false } = {}) {
  const m = new THREE.Mesh(geometry, material); m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  if (scale != null) Array.isArray(scale) ? m.scale.set(scale[0], scale[1], scale[2]) : m.scale.setScalar(scale);
  m.castShadow = castShadow; if (inkOpt) ink(m, inkOpt); if (parent) parent.add(m); return m;
}
function svgShape(d) {
  const TOK = /[MLHVQCZmlhvqcz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g, junk = d.replace(TOK, "").replace(/[\s,]/g, "");
  if (junk) throw new Error(`geo.extrude: unsupported path command "${junk[0]}" (use M L H V Q C Z)`);
  const tok = d.match(TOK) || [];
  let i = 0, cmd = "", x = 0, y = 0, sx = 0, sy = 0, shape = null, cur = null; const holes = [];
  const num = () => { const v = parseFloat(tok[i++]); if (!Number.isFinite(v)) throw new Error(`geo.extrude: "${cmd}" is missing a number`); return v; };
  while (i < tok.length) {
    if (/[a-z]/i.test(tok[i])) cmd = tok[i++];
    const rel = cmd === cmd.toLowerCase(), ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case "M": x = ox + num(); y = oy + num(); sx = x; sy = y; cur = shape ? new THREE.Path() : (shape = new THREE.Shape()); if (cur !== shape) holes.push(cur); cur.moveTo(x, y); cmd = rel ? "l" : "L"; break;
      case "L": x = ox + num(); y = oy + num(); cur.lineTo(x, y); break;
      case "H": x = ox + num(); cur.lineTo(x, y); break;
      case "V": y = oy + num(); cur.lineTo(x, y); break;
      case "Q": { const cx = ox + num(), cy = oy + num(); x = ox + num(); y = oy + num(); cur.quadraticCurveTo(cx, cy, x, y); break; }
      case "C": { const c1x = ox + num(), c1y = oy + num(), c2x = ox + num(), c2y = oy + num(); x = ox + num(); y = oy + num(); cur.bezierCurveTo(c1x, c1y, c2x, c2y, x, y); break; }
      case "Z": cur.closePath(); x = sx; y = sy; if (i < tok.length && !/[a-z]/i.test(tok[i])) throw new Error("geo.extrude: numbers after Z need a command"); break;
      default: throw new Error(`geo.extrude: unsupported path command "${cmd}" (use M L H V Q C Z)`);
    }
  }
  if (!shape) throw new Error("geo.extrude: path has no M command");
  shape.holes.push(...holes); return shape;
}
const cg = (k, make) => (...a) => cache(GEO, k + JSON.stringify(a), () => make(...a));   // cached by call arguments
export const geo = {
  box: cg("box", (w = 1, h = w, d = w) => new THREE.BoxGeometry(w, h, d)),
  sphere: cg("sph", (r = 0.5, seg = 16) => new THREE.SphereGeometry(r, seg, Math.max(4, Math.round(seg * 0.75)))),
  cyl: cg("cyl", (rt = 0.5, rb = rt, h = 1, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg)),
  cone: cg("cone", (r = 0.5, h = 1, seg = 12) => new THREE.ConeGeometry(r, h, seg)),
  capsule: cg("cap", (r = 0.4, len = 1) => new THREE.CapsuleGeometry(r, len, 4, 12)),
  torus: cg("tor", (r = 0.5, t = 0.15) => new THREE.TorusGeometry(r, t, 10, 28)),
  ico: cg("ico", (r = 0.5, detail = 0) => new THREE.IcosahedronGeometry(r, detail)),
  rbox: cg("rbox", (w = 1, h = w, d = w, radius = 0.1) => new RoundedBoxGeometry(w, h, d, 3, Math.min(radius, Math.min(w, h, d) / 2 - 1e-4))),
  lathe: cg("lathe", (profile, seg = 16) => new THREE.LatheGeometry(need("geo.lathe", "profile", profile).map(([r, y]) => new THREE.Vector2(r, y)), seg)),
  extrude: cg("ext", (svgPath, depth = 0.3, { bevel = 0.05 } = {}) => new THREE.ExtrudeGeometry(svgShape(need("geo.extrude", "svgPath", svgPath)),
    { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 10 }).translate(0, 0, -depth / 2)),
};
export function deform(geometry, { amount = 0.1, scale = 1, seed = 1 } = {}) {
  const g = geometry.clone(), P = g.attributes.position, c = new THREE.Vector3(), p = new THREE.Vector3(), dir = new THREE.Vector3();
  g.computeBoundingBox(); g.boundingBox.getCenter(c);
  for (let i = 0; i < P.count; i++) {
    p.fromBufferAttribute(P, i); dir.subVectors(p, c); if (dir.lengthSq() < 1e-12) dir.set(0, 1, 0); dir.normalize();
    p.addScaledVector(dir, amount * noise3(p.x * scale, p.y * scale, p.z * scale, seed)); P.setXYZ(i, p.x, p.y, p.z);
  }
  g.computeVertexNormals(); g.computeBoundingSphere(); g.computeBoundingBox(); return g;
}
export function mirror(group, axis = "x") {
  if (!"xyz".includes(axis) || axis.length !== 1) throw new Error(`mirror: axis "${axis}" is not x|y|z`);
  const m = group.clone(true); m.scale[axis] *= -1; m.position[axis] *= -1; if (group.parent) group.parent.add(m); return m;
}
export function hitFlash(object3d) {
  const made = new Map(), list = [];
  object3d.traverse((o) => {
    if (!o.isMesh || o.userData.inkHull) return;
    const swap = (m) => { if (!m || !m.emissive) return m; return cache(made, m, () => {
      const c = m.clone(); c.onBeforeCompile = m.onBeforeCompile; c.customProgramCacheKey = m.customProgramCacheKey;
      list.push({ m: c, e: c.emissive.clone(), i: c.emissiveIntensity }); return c; }); };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
  const tmp = new THREE.Color();
  return { materials: list.map((x) => x.m), set(k, color = 0xffffff) { tmp.set(color); for (const x of list) { x.m.emissive.copy(x.e).lerp(tmp, k); x.m.emissiveIntensity = x.i + (Math.max(1, x.i) - x.i) * k; } } };
}

// ── sky, fog, stars ─────────────────────────────────────────────────────────
const followCam = function (r, s, camera) { this.matrixWorld.makeTranslation(camera.matrixWorld.elements[12], camera.matrixWorld.elements[13], camera.matrixWorld.elements[14]); };
const HFOG = { value: new THREE.Vector2(1e9, 2e9) }; let hfogOn = false; const HF_DONE = new WeakSet();
function heightFogPatch(m) {   // world-y blend on top of FogExp2: thick below `bottom`, gone above `top`
  if (!hfogOn || !m || m.fog !== true || m.isShaderMaterial || HF_DONE.has(m)) return; HF_DONE.add(m);
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = function (sh, r) {
    prev.call(this, sh, r); sh.uniforms.uHFog = HFOG; const src = sh.vertexShader.includes("#include <begin_vertex>") ? "transformed" : "vec3(0.0)";
    sh.vertexShader = sh.vertexShader.replace("#include <fog_pars_vertex>", "#include <fog_pars_vertex>\nvarying float vHFogY;").replace("#include <fog_vertex>",
      `#include <fog_vertex>\n#ifdef USE_INSTANCING\n vHFogY = (modelMatrix * instanceMatrix * vec4(${src}, 1.0)).y;\n#else\n vHFogY = (modelMatrix * vec4(${src}, 1.0)).y;\n#endif`);
    sh.fragmentShader = sh.fragmentShader.replace("#include <fog_pars_fragment>", "#include <fog_pars_fragment>\nuniform vec2 uHFog; varying float vHFogY;").replace("#include <fog_fragment>",
      `#ifdef USE_FOG\n#ifdef FOG_EXP2\n float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);\n#else\n float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);\n#endif\n fogFactor *= 1.0 - smoothstep(uHFog.x, uHFog.y, vHFogY);\n gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);\n#endif`);
  };
  m.customProgramCacheKey = function () { return prevKey.call(this) + "|kit-hfog"; }; m.needsUpdate = true;
}
const SKY_VS = `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = vec4(p.xy, p.w * 0.999999, p.w); }`;
const SKY_FS = `uniform vec3 uTop, uHorizon, uBottom; varying vec3 vDir;
void main(){ float y = normalize(vDir).y; vec3 c = y >= 0.0 ? mix(uHorizon, uTop, pow(y, 0.6)) : mix(uHorizon, uBottom, pow(-y, 0.45));
  gl_FragColor = vec4(c, 1.0);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;
export function skyDome(scene, { top, horizon, bottom, radius = 900, fog } = {}) {
  need("skyDome", "top", top); need("skyDome", "horizon", horizon); need("skyDome", "bottom", bottom); need("skyDome", "fog", fog);
  const f = (k) => need("skyDome", `fog.${k}`, fog[k]), mode = f("mode");   // validate everything before touching the scene
  const made = { "linear-horizon": () => new THREE.Fog(col(horizon), f("near"), f("far")), exp2: () => new THREE.FogExp2(col(f("color")), f("density")),
    height: () => new THREE.FogExp2(col(f("color")), f("density")), none: () => null }[mode];
  if (!made) throw new Error(`skyDome: fog.mode "${mode}" is not linear-horizon|exp2|height|none`);
  const sceneFog = made(), band = mode === "height" ? [f("bottom"), f("top")] : [1e9, 2e9];
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), new THREE.ShaderMaterial({ vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide,
    depthWrite: false, fog: false, toneMapped: false, uniforms: { uTop: { value: col(top) }, uHorizon: { value: col(horizon) }, uBottom: { value: col(bottom) } } }));
  m.renderOrder = -10; m.frustumCulled = false; m.matrixAutoUpdate = false; m.onBeforeRender = followCam; m.raycast = () => {}; scene.add(m);
  scene.fog = sceneFog; HFOG.value.set(band[0], band[1]); hfogOn = mode === "height";
  if (hfogOn) {
    const prev = scene.onBeforeRender, walk = (o) => { const mm = o.material; if (mm) Array.isArray(mm) ? mm.forEach(heightFogPatch) : heightFogPatch(mm); };
    scene.traverse(walk); scene.onBeforeRender = function (...a) { prev.apply(this, a); if (hfogOn) this.traverseVisible(walk); };
  }
  return { mesh: m, fog: scene.fog, uniforms: m.material.uniforms };
}
export function starfield(scene, { n = 1200, radius = 800, size = 1.5, tints } = {}) {
  need("starfield", "tints", tints); if (!tints.length) need("starfield", "tints", null);
  const pos = new Float32Array(n * 3), rgb = new Float32Array(n * 3), cs = tints.map(col);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u), c = cs[i % cs.length], k = 0.55 + 0.45 * Math.random();
    pos.set([Math.cos(a) * r * radius, u * radius, Math.sin(a) * r * radius], i * 3); rgb.set([c.r * k, c.g * k, c.b * k], i * 3);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.BufferAttribute(rgb, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, map: glowTex(), transparent: true, depthWrite: false, fog: false }));
  p.renderOrder = -9; p.frustumCulled = false; p.matrixAutoUpdate = false; p.onBeforeRender = followCam; scene.add(p); return p;
}

// ── light ───────────────────────────────────────────────────────────────────
export function lights(scene, { preset = "hemi+sun", sky, ground, sun, sunIntensity = 2, hemiIntensity = 1.5, rim = null, shadow = null } = {}) {
  need("lights", "sky", sky); need("lights", "ground", ground); need("lights", "sun", sun);
  if (!["hemi+sun", "hemi", "sun"].includes(preset)) throw new Error(`lights: preset "${preset}" is not hemi+sun|hemi|sun`);
  const out = { hemi: null, sun: null, rim: null }, off = new THREE.Vector3(12, 20, 8);
  if (preset.includes("hemi")) { out.hemi = new THREE.HemisphereLight(col(sky), col(ground), hemiIntensity); scene.add(out.hemi); }
  if (preset.includes("sun")) {
    const s = out.sun = new THREE.DirectionalLight(col(sun), sunIntensity); s.position.copy(off); scene.add(s, s.target);
    if (shadow) {
      const { size = 1024, extent = 20 } = shadow; s.castShadow = true; s.shadow.mapSize.set(size, size);
      Object.assign(s.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 0.5, far: off.length() + extent * 3 });
      s.shadow.camera.updateProjectionMatrix(); s.shadow.bias = -0.0005; s.shadow.normalBias = 0.02;
    }
  }
  const ro = new THREE.Vector3(...((rim && rim.dir) || [-8, 6, -12]));
  if (rim) { out.rim = new THREE.DirectionalLight(col(need("lights", "rim.color", rim.color)), rim.intensity ?? 1.5); out.rim.position.copy(ro); scene.add(out.rim, out.rim.target); }
  const snap = shadow ? ((shadow.extent ?? 20) * 2) / (shadow.size ?? 1024) : 0;
  out.follow = (pos) => {   // texel-snapped, so the shadow edge does not shimmer as the player moves
    if (!out.sun) return; const x = snap ? Math.round(pos.x / snap) * snap : pos.x, z = snap ? Math.round(pos.z / snap) * snap : pos.z, y = pos.y || 0;
    for (const [l, o] of [[out.sun, off], [out.rim, ro]]) if (l) { l.target.position.set(x, y, z); l.position.set(x, y, z).add(o); }
  };
  return out;
}
export function blobShadow(parent, { radius = 0.6, opacity = 0.25 } = {}) {
  const tex = cache(TEX, "blob", () => canvasTex(64, 64, (g, w) => radial(g, w, "0,0,0", [[0, 1], [0.55, 0.75], [1, 0]])));
  const pg = cache(GEO, "blobplane", () => new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2));
  const mesh = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  mesh.scale.setScalar(radius); mesh.renderOrder = 1; mesh.raycast = () => {}; parent.add(mesh);
  return { mesh, follow(x, groundY, z, height = 0) { const k = Math.min(1, Math.max(0.35, 1 - height / 6)); mesh.position.set(x, groundY + 0.02, z); mesh.scale.setScalar(radius * k); mesh.material.opacity = opacity * (0.4 + 0.6 * k); } };
}
export function envMap(renderer, scene) {
  const pm = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
  const tex = pm.fromScene(room, 0.04).texture; scene.environment = tex; pm.dispose(); room.dispose(); return tex;
}

// ── terrain & scatter ───────────────────────────────────────────────────────
export function heightfield({ size = 200, seg = 96, amp = 8, octaves = 4, seed = 1, bands, flat = true, island = false } = {}) {
  need("heightfield", "bands", bands); if (!bands.length) need("heightfield", "bands", null);
  const B = bands.map(([h, c]) => [h, col(c)]).sort((a, b) => a[0] - b[0]), colorAt = (h) => (B.find((b) => h <= b[0]) || B[B.length - 1])[1];
  const n = seg + 1, cell = size / seg, H = new Float32Array(n * n), half = size / 2;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -half + i * cell, z = -half + j * cell; let h = amp * fbm2((x / size) * 3, (z / size) * 3, { octaves, seed });
    if (island) { const k = 1 - Math.min(1, Math.max(0, (Math.hypot(x, z) / half - 0.55) / 0.45)); h = lerp(-amp * 0.6, h * 0.8 + amp * 0.35, k * k * (3 - 2 * k)); }
    H[j * n + i] = h;
  }
  const at = (i, j) => H[j * n + i], pos = new Float32Array(n * n * 3), idx = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pos.set([-half + i * cell, at(i, j), -half + j * cell], (j * n + i) * 3);
  for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) { const a = j * n + i; idx.push(a, a + n, a + 1, a + n, a + n + 1, a + 1); }   // cell (a, b, d) + (b, c, d)
  let g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setIndex(idx);
  if (flat) g = g.toNonIndexed();   // faceted: one colour per face, from its mean height
  const P = g.attributes.position, rgb = new Float32Array(P.count * 3);
  for (let v = 0; v < P.count; v += flat ? 3 : 1) { const c = colorAt(flat ? (P.getY(v) + P.getY(v + 1) + P.getY(v + 2)) / 3 : P.getY(v)); for (let k = 0; k < (flat ? 3 : 1); k++) rgb.set([c.r, c.g, c.b], (v + k) * 3); }
  g.setAttribute("color", new THREE.BufferAttribute(rgb, 3));
  g.computeVertexNormals(); g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: flat })); mesh.receiveShadow = true;
  const heightAt = (x, z) => {   // exact: the same two triangles per cell the mesh uses
    const fx = Math.min(seg - 1e-6, Math.max(0, (x + half) / cell)), fz = Math.min(seg - 1e-6, Math.max(0, (z + half) / cell));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, ha = at(i, j), hb = at(i, j + 1), hc = at(i + 1, j + 1), hd = at(i + 1, j);
    return u + v <= 1 ? ha + u * (hd - ha) + v * (hb - ha) : hc + (1 - u) * (hb - hc) + (1 - v) * (hd - hc);
  };
  return { mesh, heightAt };
}
export function scatter(scene, geometry, material, { count, area, y = 0, scale = [0.8, 1.2], avoid = [], seed = 1 } = {}) {
  need("scatter", "count", count); need("scatter", "area", area);
  const R = mulberry(seed >>> 0), mesh = new THREE.InstancedMesh(geometry, material, count), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), s = new THREE.Vector3();
  const [x0, x1, z0, z1] = area; let placed = 0;
  for (let i = 0; i < count; i++) {
    let x = 0, z = 0, ok = false;
    for (let t = 0; t < 30 && !ok; t++) { x = lerp(x0, x1, R()); z = lerp(z0, z1, R()); ok = avoid.every((a) => Math.hypot(x - a.x, z - a.z) >= (a.r ?? 0)); }
    if (!ok) continue; const k = lerp(scale[0], scale[1], R());
    m4.compose(p.set(x, typeof y === "function" ? y(x, z) : y, z), q.setFromAxisAngle(up, R() * Math.PI * 2), s.set(k, k, k)); mesh.setMatrixAt(placed++, m4);
  }
  mesh.count = placed; mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); scene.add(mesh); return mesh;
}
