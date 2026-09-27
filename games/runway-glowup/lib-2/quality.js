// quality.js — the adaptive quality ladder (device-pixel-ratio cap + bloom on/off) and the post chain
// (RenderPass → UnrealBloomPass → OutputPass, MSAA render targets, never FXAA). The ladder steps DOWN only on
// missed frames, never on a slow but steady vsync cadence, and never steps UP during play: the shell probes a
// rung up on the title and over screens, where a hitch is invisible. boot() wires both; games rarely call them.
// API and costs: kit/three/README.md (section quality.js).
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { params } from "./core.js";

export const LADDER = [[2, true], [1.5, true], [1.25, true], [1, true], [1, false], [0.75, false]]; // [dprCap, bloomOn]
const WINDOW = 90, MISSES = 20, PROBE_FRAMES = 120, CADENCES = [1000 / 60, 1000 / 30];

const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const stddev = (a) => { const mu = a.reduce((s, x) => s + x, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - mu) ** 2, 0) / a.length); };
const cadenceOf = (ms) => CADENCES.reduce((b, c) => (Math.abs(c - ms) < Math.abs(b - ms) ? c : b));

export function createQuality(G, { bloom, start = matchMedia("(pointer: coarse)").matches ? 3 : 0, auto = true } = {}) {
  const noBloom = !bloom || params.nobloom;
  if (params.q != null) { start = params.q; auto = false; }
  else if (params.arcade) auto = false;
  const buf = [];
  let probe = null;   // {from, frames, cadence} while a probeUp() trial runs

  const Q = {
    rung: 0, auto,
    get probing() { return !!probe; },
    set(i) {
      Q.rung = Math.max(0, Math.min(LADDER.length - 1, Math.round(i)));
      buf.length = 0;   // a new rung is measured afresh
      const [cap, bloomOn] = LADDER[Q.rung];
      const dpr = Math.min(window.devicePixelRatio || 1, cap);
      G.size.dpr = dpr;
      if (G.post) { G.post.setBloom(bloomOn && !noBloom); G.post.setSize(G.size.w, G.size.h, dpr); }
      return Q.rung;
    },
    sample(frameMs) {
      if (!Q.auto || !(frameMs > 0)) return;
      if (probe) {   // trial of one rung up: any missed frame reverts it, 120 clean frames keep it
        if (frameMs > 1.5 * probe.cadence) { Q.set(probe.from); probe = null; buf.length = 0; }
        else if (++probe.frames >= PROBE_FRAMES) { probe = null; buf.length = 0; }
        return;
      }
      buf.push(frameMs); if (buf.length > WINDOW) buf.shift();
      if (buf.length < WINDOW) return;
      const med = median(buf);
      const steady = CADENCES.some((c) => Math.abs(med - c) <= 2) && stddev(buf) < 3;
      if (steady) return;   // a slow but steady cadence (iOS Low Power Mode = 30 Hz) is not a problem to fix
      const missed = buf.reduce((n, x) => n + (x > 1.5 * med ? 1 : 0), 0);
      if (missed >= MISSES && Q.rung < LADDER.length - 1) { Q.set(Q.rung + 1); buf.length = 0; }
    },
    probeUp() {
      if (!Q.auto || probe || Q.rung === 0) return false;
      probe = { from: Q.rung, frames: 0, cadence: cadenceOf(buf.length ? median(buf) : CADENCES[0]) };
      Q.set(Q.rung - 1);
      return true;
    },
  };
  Q.set(start);
  return Q;
}

export function createPost(renderer, scene, camera, { bloom, msaa = 4 } = {}) {
  if (!bloom) {
    return { composer: null, bloomPass: null, passes: [], bloomOn: false, setBloom() {}, bloomPixels: () => 0,
      setSize(w, h, dpr) { renderer.setPixelRatio(dpr); renderer.setSize(w, h, false); },
      render() { renderer.render(scene, camera); } };
  }
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: msaa });
  const composer = new EffectComposer(renderer, rt);
  const renderPass = new RenderPass(scene, camera);
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), bloom.strength, bloom.radius, bloom.threshold);
  const outputPass = new OutputPass();
  composer.addPass(renderPass); composer.addPass(bloomPass); composer.addPass(outputPass);
  const P = {
    composer, bloomPass, passes: [renderPass, bloomPass, outputPass], bloomOn: true,
    setBloom(on) { P.bloomOn = !!on; bloomPass.enabled = P.bloomOn; },
    setSize(w, h, dpr) {
      renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
      composer.setPixelRatio(dpr); composer.setSize(w, h);
      bloomPass.setSize(w, h);   // UnrealBloomPass halves what it is given: 0.5 × the CSS canvas, independent of DPR
    },
    // pixels the bloom pass shades per frame: the high-pass, 2 blurs per mip, and the composite (0 when bloom is off)
    bloomPixels() {
      if (!P.bloomOn) return 0;
      const px = (t) => t.width * t.height;
      let n = px(bloomPass.renderTargetBright) + px(bloomPass.renderTargetsHorizontal[0]);
      for (let i = 0; i < bloomPass.nMips; i++) n += px(bloomPass.renderTargetsHorizontal[i]) + px(bloomPass.renderTargetsVertical[i]);
      return n;
    },
    render() { composer.render(); },
  };
  return P;
}
