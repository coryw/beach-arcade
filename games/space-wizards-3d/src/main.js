// main.js — renderer + bloom, a fixed-step loop, adaptive quality for phones, and the test hooks
// (window.advanceTime / window.render_game_to_text) that let a headless browser play the game deterministically.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { createGame } from "./game.js";
import { pollInput } from "./input.js";

const params = Object.fromEntries(new URLSearchParams(location.search));
// seeded RNG (mulberry32) so a test run with ?seed=N replays exactly
let seed = (+params.seed || (Date.now() & 0xffffffff)) >>> 0;
const rng = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const canvas = document.getElementById("view");
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
} catch (e) {
  document.body.insertAdjacentHTML("beforeend", `<div class="screen"><h2>No 3D here 😢</h2><p class="by">This browser can't do WebGL. Try Safari or Chrome!</p></div>`);
  throw e;
}
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 3200);
camera.position.set(0, 1.2, 13);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.75, 0.55, 0.72);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// quality ladder: [pixelRatio cap, bloom on]. Starts high, steps down if frames run slow.
const LADDER = [[2, true], [1.5, true], [1.25, true], [1, true], [1, false], [0.75, false]];
let q = params.q ? +params.q : (matchMedia("(pointer: coarse)").matches ? 2 : 0);
if (params.nobloom) q = Math.max(q, 4);
function applyQuality() {
  const [pr, bl] = LADDER[q]; const dpr = Math.min(window.devicePixelRatio || 1, pr);
  renderer.setPixelRatio(dpr); composer.setPixelRatio(dpr); bloom.enabled = bl;
  renderer.setSize(innerWidth, innerHeight, false); composer.setSize(innerWidth, innerHeight);
}
function resize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); applyQuality(); }
addEventListener("resize", resize); addEventListener("orientationchange", () => setTimeout(resize, 150)); resize();

const game = createGame({ scene, camera, rng, params });

const STEP = 1 / 60; let acc = 0, last = 0, manual = false, slow = 0, fast = 0, frames = 0;
function render() { if (bloom.enabled) composer.render(); else renderer.render(scene, camera); frames++; }
function frame(now) {
  requestAnimationFrame(frame);
  if (manual) return;                                  // a test driver owns time
  const dtReal = last ? Math.min(0.1, (now - last) / 1000) : STEP; last = now;
  if (document.hidden) return;
  pollInput(); acc += dtReal; let n = 0;
  while (acc >= STEP && n < 5) { game.step(STEP); acc -= STEP; n++; }
  if (n === 5) acc = 0;
  render();
  // adaptive quality: sustained >22ms frames → step down; sustained <12ms → step back up
  if (!params.q) {
    if (dtReal > 0.022) { slow++; fast = 0; } else if (dtReal < 0.012) { fast++; slow = 0; } else { slow = Math.max(0, slow - 1); }
    if (slow > 90 && q < LADDER.length - 1) { q++; slow = 0; applyQuality(); }
    if (fast > 600 && q > 0) { q--; fast = 0; applyQuality(); }
  }
}
requestAnimationFrame(frame);

// ── test hooks (OpenAI develop-web-game convention) ──
window.advanceTime = (ms) => { manual = true; const n = Math.max(1, Math.round(ms / (1000 * STEP))); for (let i = 0; i < n; i++) { pollInput(); game.step(STEP); } render(); return game.textState(); };
window.render_game_to_text = () => game.textState();
window.__sw = { game, scene, camera, renderer, bloom, quality: () => LADDER[q], frames: () => frames, release: () => { manual = false; } };
