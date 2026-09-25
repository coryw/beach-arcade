// kit/three/shaders.js — onBeforeCompile material patches: wind, rim, dissolve, water, colour ramps.
// Each patch returns the material it was given (waterMat builds its own), and patches stack on one material.
// Every animated patch reads ONE shared uArcadeTime that tick(t) sets from SIMULATION time (loop.t, §3.0);
// call tick(loop.t) in render(). Colours are required (§3.0): a missing one throws when the patch is made.
// A shared material is patched for every mesh that uses it: clone() it first for per-object effects.
// Shadows and ink hulls use their own materials, so they do not sway or dissolve with the mesh.
// API, costs and examples: kit/three/README.md (fragment: README.d/shaders.md).
import * as THREE from "three";

const TIME = { value: 0 };
const PATCHES = new WeakMap();   // material → patch keys (not userData: clone() would copy the list but not the patch)

function need(fn, name, v) {
  if (v === undefined || v === null) throw new Error(`${fn}: ${name} is required — decide it in the art direction`);
  return v;
}
const col = (fn, name, v) => new THREE.Color(need(fn, name, v));

const isMesh = (m) => !!(m && (m.isMeshBasicMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial ||
  m.isMeshStandardMaterial || m.isMeshToonMaterial || m.isMeshMatcapMaterial));
const isLit = (m) => !!(m && (m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshStandardMaterial || m.isMeshToonMaterial));

// Shared GLSL: the time uniform and a cheap 3D value noise. Guarded, so stacked patches declare it once per stage.
const COMMON = `
#ifndef ARCADE_SHADERS
#define ARCADE_SHADERS
uniform float uArcadeTime;
float arcadeHash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float arcadeNoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(arcadeHash(i), arcadeHash(i + vec3(1.0, 0.0, 0.0)), f.x),
                 mix(arcadeHash(i + vec3(0.0, 1.0, 0.0)), arcadeHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(arcadeHash(i + vec3(0.0, 0.0, 1.0)), arcadeHash(i + vec3(1.0, 0.0, 1.0)), f.x),
                 mix(arcadeHash(i + vec3(0.0, 1.0, 1.0)), arcadeHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
#endif
`;

function at(src, chunk, code, where = "after") {
  const tag = `#include <${chunk}>`;
  if (!src.includes(tag)) throw new Error(`shaders: material has no <${chunk}> chunk — patch a built-in Mesh*Material`);
  return src.replace(tag, where === "after" ? `${tag}\n${code}` : `${code}\n${tag}`);
}

// Chain a patch onto mat: keeps any earlier onBeforeCompile, gives the program a distinct cache key, forces a recompile.
function patch(fn, mat, key, uniforms, apply) {
  const list = PATCHES.get(mat) || [];
  PATCHES.set(mat, list);
  if (list.includes(key)) throw new Error(`${fn}: this material already has ${key} — clone() it or patch it once`);
  list.push(key);
  const prev = mat.onBeforeCompile;
  // the stock key is onBeforeCompile's source: capture it now, before the wrapper below replaces that function
  const prevKey = mat.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey ? mat.customProgramCacheKey : () => prev.toString();
  mat.onBeforeCompile = function (shader, renderer) {
    prev.call(this, shader, renderer);
    shader.uniforms.uArcadeTime = TIME;
    Object.assign(shader.uniforms, uniforms);
    apply(shader);
    // last, so it lands directly under <common>, above the declarations apply() just placed there
    shader.vertexShader = at(shader.vertexShader, "common", COMMON);
    shader.fragmentShader = at(shader.fragmentShader, "common", COMMON);
  };
  mat.customProgramCacheKey = function () { return `${prevKey.call(this)}|arcade:${key}`; };
  mat.needsUpdate = true;
  return mat;
}

const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], xz: [Math.SQRT1_2, 0, Math.SQRT1_2] };

export function wind(mat, { amp = 0.15, freq = 1.3, axis = "x", heightMask = true } = {}) {
  if (!isMesh(mat)) throw new Error("wind: mat must be a built-in Mesh*Material");
  const dir = AXES[axis];
  if (!dir) throw new Error(`wind: axis must be one of ${Object.keys(AXES).join(", ")}`);
  const u = { uWindAmp: { value: amp }, uWindFreq: { value: freq }, uWindAxis: { value: new THREE.Vector3(...dir) },
              uWindMask: { value: heightMask ? 1 : 0 } };
  return patch("wind", mat, "wind", u, (s) => {
    s.vertexShader = at(s.vertexShader, "common", "uniform float uWindAmp, uWindFreq, uWindMask; uniform vec3 uWindAxis;");
    s.vertexShader = at(s.vertexShader, "begin_vertex", `{
  vec4 wO = vec4(0.0, 0.0, 0.0, 1.0);
  #ifdef USE_INSTANCING
    wO = instanceMatrix * wO;
  #endif
  wO = modelMatrix * wO;
  float wT = uArcadeTime * uWindFreq * 6.2831853 + wO.x * 0.37 + wO.z * 0.29 + position.y * 0.6;
  float wM = mix(1.0, max(position.y, 0.0), uWindMask);
  transformed += uWindAxis * (uWindAmp * wM * (sin(wT) + 0.35 * sin(wT * 2.3 + 1.7)));
}`);
  });
}

export function rim(mat, { color, power = 2.5, strength = 0.8 } = {}) {
  const c = col("rim", "color", color);
  if (!(isLit(mat) || (mat && mat.isMeshMatcapMaterial))) throw new Error("rim: mat must be a lit Mesh*Material (lambert, phong, standard, toon, matcap)");
  const u = { uRimColor: { value: c }, uRimPower: { value: power }, uRimStrength: { value: strength } };
  return patch("rim", mat, "rim", u, (s) => {
    s.fragmentShader = at(s.fragmentShader, "common", "uniform vec3 uRimColor; uniform float uRimPower, uRimStrength;");
    s.fragmentShader = at(s.fragmentShader, "opaque_fragment", `{
  vec3 rV = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
  outgoingLight += uRimColor * (uRimStrength * pow(1.0 - saturate(dot(normal, rV)), uRimPower));
}`, "before");
  });
}

export function dissolve(mat, { edgeColor, edge = 0.06, seed = 1, scale = 2.5, glow = 2 } = {}) {
  const c = col("dissolve", "edgeColor", edgeColor);
  if (!isMesh(mat)) throw new Error("dissolve: mat must be a built-in Mesh*Material");
  const k = { value: 0 };
  const u = { uDissolve: k, uDissolveEdge: { value: edge }, uDissolveEdgeColor: { value: c }, uDissolveGlow: { value: glow },
              uDissolveScale: { value: scale },
              uDissolveSeed: { value: new THREE.Vector3(seed * 17.13 % 97, seed * 31.7 % 89, seed * 7.31 % 83) } };
  patch("dissolve", mat, "dissolve", u, (s) => {
    s.vertexShader = at(s.vertexShader, "common", "varying vec3 vArcadeDissolve;");
    s.vertexShader = at(s.vertexShader, "begin_vertex", `vArcadeDissolve = transformed;
#ifdef USE_INSTANCING
  vArcadeDissolve = (instanceMatrix * vec4(transformed, 1.0)).xyz;
#endif`);
    s.fragmentShader = at(s.fragmentShader, "common",
      "varying vec3 vArcadeDissolve; uniform float uDissolve, uDissolveEdge, uDissolveGlow, uDissolveScale; uniform vec3 uDissolveEdgeColor, uDissolveSeed;");
    s.fragmentShader = at(s.fragmentShader, "clipping_planes_fragment", `
float dN = arcadeNoise(vArcadeDissolve * uDissolveScale + uDissolveSeed) * 0.65
         + arcadeNoise(vArcadeDissolve * uDissolveScale * 2.7 + uDissolveSeed.zxy) * 0.35;
dN = smoothstep(0.18, 0.82, dN);
if (uDissolve >= 1.0 || (uDissolve > 0.0 && dN < uDissolve)) discard;
float dEdge = uDissolve > 0.0 ? 1.0 - smoothstep(uDissolve, uDissolve + uDissolveEdge, dN) : 0.0;`);
    s.fragmentShader = at(s.fragmentShader, "opaque_fragment",
      "gl_FragColor.rgb = mix(gl_FragColor.rgb, uDissolveEdgeColor * uDissolveGlow, dEdge);");
  });
  return { material: mat, set(v) { k.value = Math.min(1, Math.max(0, +v || 0)); }, get value() { return k.value; } };
}

export function waterMat({ deep, shallow, foam, scale = 0.08, speed = 0.6, shore = 0.12, flip = false, roughness = 0.2,
                           opacity = 1 } = {}) {
  const u = { uWaterDeep: { value: col("waterMat", "deep", deep) }, uWaterShallow: { value: col("waterMat", "shallow", shallow) },
              uWaterFoam: { value: col("waterMat", "foam", foam) }, uWaterScale: { value: scale }, uWaterSpeed: { value: speed },
              uWaterShore: { value: shore }, uWaterFlip: { value: flip ? 1 : 0 } };
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness, metalness: 0, transparent: opacity < 1, opacity });
  return patch("waterMat", m, "water", u, (s) => {
    s.vertexShader = at(s.vertexShader, "common", "varying vec3 vArcadeWorld; varying vec2 vArcadeUv;");
    s.vertexShader = at(s.vertexShader, "begin_vertex", `{
  vec4 wW = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    wW = instanceMatrix * wW;
  #endif
  vArcadeWorld = (modelMatrix * wW).xyz; vArcadeUv = uv;
}`);
    s.fragmentShader = at(s.fragmentShader, "common", `varying vec3 vArcadeWorld; varying vec2 vArcadeUv;
uniform vec3 uWaterDeep, uWaterShallow, uWaterFoam; uniform float uWaterScale, uWaterSpeed, uWaterShore, uWaterFlip;
float arcadeWave(vec2 p, float t) {   // swell + chop + ripples, each drifting its own way
  return arcadeNoise(vec3(p + vec2(t * 0.6, t * 0.35), t * 0.25)) * 0.5
       + arcadeNoise(vec3(p * 3.1 - vec2(t * 0.9, -t * 0.5), 3.7 + t * 0.3)) * 0.3
       + arcadeNoise(vec3(p * 8.3 + vec2(-t * 1.3, t * 1.1), 7.1 + t * 0.5)) * 0.2;
}`);
    s.fragmentShader = at(s.fragmentShader, "color_fragment", `
vec2 wP = vArcadeWorld.xz * uWaterScale; float wT = uArcadeTime * uWaterSpeed;
float wH = arcadeWave(wP, wT);
float wV = mix(vArcadeUv.y, 1.0 - vArcadeUv.y, uWaterFlip);
diffuseColor.rgb = mix(uWaterDeep, uWaterShallow, smoothstep(0.0, 1.0, clamp(wV + (wH - 0.5) * 0.4, 0.0, 1.0)));
diffuseColor.rgb *= 0.8 + 0.4 * wH;   // mottled swell
float wFoam = max(uWaterShore > 0.0 ? smoothstep(1.0 - uWaterShore, 1.0 - uWaterShore * 0.4, wV + (wH - 0.5) * 0.25) : 0.0,
                  smoothstep(0.66, 0.7, wH));
diffuseColor.rgb = mix(diffuseColor.rgb, uWaterFoam, wFoam);`);
    s.fragmentShader = at(s.fragmentShader, "normal_fragment_maps", `{
  float wE = 0.04;
  float wDx = arcadeWave(wP + vec2(wE, 0.0), wT) - wH, wDz = arcadeWave(wP + vec2(0.0, wE), wT) - wH;
  vec3 wN = normalize(vec3(-wDx / wE * 0.12, 1.0, -wDz / wE * 0.12));
  normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
  roughnessFactor = mix(roughnessFactor, 0.95, wFoam);
}`);
  });
}

export function gradientMap(mat, stops, { gain = 1 } = {}) {
  need("gradientMap", "stops", stops);
  if (!Array.isArray(stops) || stops.length < 2) throw new Error("gradientMap: stops needs at least 2 [t, hex] pairs");
  if (!isLit(mat)) throw new Error("gradientMap: mat must be a lit Mesh*Material (lambert, phong, standard, toon)");
  const pts = stops.map(([t, h], i) => {
    if (!(t >= 0 && t <= 1) || (i && t < stops[i - 1][0])) throw new Error("gradientMap: stop t must rise from 0 to 1");
    return [t, col("gradientMap", "stop color", h)];
  });
  const N = 256, data = new Uint8Array(N * 4), c = new THREE.Color(), rgb = { r: 0, g: 0, b: 0 };
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    let j = 0;
    while (j < pts.length - 2 && t > pts[j + 1][0]) j++;
    const [t0, a] = pts[j], [t1, b] = pts[j + 1];
    c.lerpColors(a, b, t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : (t < t0 ? 0 : 1));
    c.getRGB(rgb, THREE.SRGBColorSpace);
    data.set([rgb.r * 255 + 0.5, rgb.g * 255 + 0.5, rgb.b * 255 + 0.5, 255], i * 4);
  }
  const tex = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const u = { uArcadeRamp: { value: tex }, uArcadeRampGain: { value: gain } };
  return patch("gradientMap", mat, "gradientMap", u, (s) => {
    s.fragmentShader = at(s.fragmentShader, "common", "uniform sampler2D uArcadeRamp; uniform float uArcadeRampGain;");
    s.fragmentShader = at(s.fragmentShader, "opaque_fragment", `{
  vec3 gLit = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
  vec3 gAlb = diffuseColor.rgb;
  #ifdef STANDARD
    gAlb *= 1.0 - metalnessFactor;
  #endif
  const vec3 gY = vec3(0.2126, 0.7152, 0.0722);
  float gL = clamp(dot(gLit, gY) / max(dot(gAlb, gY), 1e-4) * uArcadeRampGain, 0.0, 1.0);
  outgoingLight += gAlb * texture2D(uArcadeRamp, vec2(gL, 0.5)).rgb - gLit;
}`, "before");
  });
}

export function tick(t) {
  if (!Number.isFinite(t)) throw new Error("tick: t must be the loop's simulation time in seconds");
  TIME.value = t;
}
