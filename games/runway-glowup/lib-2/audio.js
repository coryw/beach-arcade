// audio.js — Web Audio synth with no files: one-shot tones and filtered noise, a game-defined SFX table, and a
// lookahead step sequencer that plays a tune derived from the game's own motif. The graph is
// sfxBus/musicBus → master → compressor → destination. Every waveform, motif and voice is the game's choice;
// there is no default instrument, no mood preset and no archetype table. Under ?arcade=1 the master gain is 0
// but the whole graph still runs, so audio bugs still surface in the gate.
// API and costs: kit/three/README.md (section audio.js).
import { params, registerProbe } from "./core.js";

const WAVES = ["square", "triangle", "sawtooth", "sine"];
const need = (fn, name, v) => { if (v === undefined || v === null) throw new Error(`${fn}: ${name} is required — decide it in the art direction`); return v; };
const wave = (fn, name, v) => { need(fn, name, v); if (!WAVES.includes(v)) throw new Error(`${fn}: ${name} must be one of ${WAVES.join("|")}, got "${v}"`); return v; };
const mulberry = (s) => () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const nr = mulberry(11);   // private: never consume the game's seeded Math.random
let ac = null, master = null, sfxBus = null, musicBus = null, muted = false, musicMuted = false, unlocked = false, keepAlive = null, noiseBuf = null;
const MASTER = 0.8, SFX = 0.6, MUSIC = 0.3;
const level = () => (muted || params.arcade ? 0 : MASTER);

function build() {
  if (ac) return ac;
  try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { ac = null; return null; }
  const comp = ac.createDynamicsCompressor(); comp.connect(ac.destination);
  master = ac.createGain(); master.gain.value = level(); master.connect(comp);
  sfxBus = ac.createGain(); sfxBus.gain.value = SFX; sfxBus.connect(master);
  musicBus = ac.createGain(); musicBus.gain.value = musicMuted ? 0 : MUSIC; musicBus.connect(master);
  return ac;
}
// a looping silent <audio> puts iOS into the "playback" session, so the ringer switch no longer mutes Web Audio
function silentWav() {
  const n = 4410, b = new ArrayBuffer(44 + n * 2), v = new DataView(b), w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, 44100, true); v.setUint32(28, 88200, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([b], { type: "audio/wav" }));
}
function unlock() {
  if (!build()) return;
  if (ac.state !== "running" && !document.hidden) ac.resume().catch(() => {});
  if (unlocked) return; unlocked = true;
  try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (_) {}
  try { const s = ac.createBufferSource(); s.buffer = ac.createBuffer(1, 1, ac.sampleRate); s.connect(ac.destination); s.start(0); } catch (_) {}
  try { keepAlive = new Audio(silentWav()); keepAlive.loop = true; keepAlive.setAttribute("playsinline", ""); keepAlive.play().catch(() => {}); } catch (_) { keepAlive = null; }
  if (pending) { const [d, o] = pending; pending = null; playSong(d, o); }
}
for (const ev of ["pointerdown", "touchend", "keydown"]) addEventListener(ev, (e) => { if (e.isTrusted) unlock(); }, true);   // synthetic events cannot unlock
document.addEventListener("visibilitychange", () => {
  if (!ac) return;
  if (document.hidden) { ac.suspend().catch(() => {}); keepAlive && keepAlive.pause(); }
  else { ac.resume().catch(() => {}); keepAlive && keepAlive.play().catch(() => {}); }
});
const ramp = (g, v, sec = 0.03) => { const t = ac.currentTime; g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(v, t + sec); };

export const audio = {
  unlock,
  setMuted(b) { muted = !!b; if (master) ramp(master, level()); },
  setMusicMuted(b) { musicMuted = !!b; if (musicBus) ramp(musicBus, musicMuted ? 0 : MUSIC); },
  get muted() { return muted; },
  state() { if (!ac || ac.state === "closed") return "none"; return ac.state === "running" ? "running" : "suspended"; },
  get ctx() { return ac; }, get master() { return master; }, get sfxBus() { return sfxBus; }, get musicBus() { return musicBus; },
};
registerProbe("audio", () => audio.state());

const busOf = (b) => (b === "sfx" ? sfxBus : b === "music" ? musicBus : b);
const live = () => ac && ac.state !== "closed" && sfxBus;

export function tone({ type, f0, f1 = f0, dur = 0.12, vol = 0.3, at = 0, bus = "sfx", detune = 0, attack = 0.005 } = {}) {
  wave("tone", "type", type); if (!(f0 > 0)) throw new Error("tone: f0 is required (Hz > 0)");
  if (!live()) return;
  const t = ac.currentTime + Math.max(0, at), g = ac.createGain(), o = ac.createOscillator(), a = Math.min(attack, dur * 0.5);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + Math.max(0.001, a));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.type = type; o.detune.value = detune; o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  o.connect(g).connect(busOf(bus)); o.start(t); o.stop(t + dur + 0.05); o.onended = () => g.disconnect();
}

export function noise({ f0 = 800, f1 = f0, dur = 0.2, vol = 0.3, at = 0, q = 1, type = "bandpass", bus = "sfx" } = {}) {
  if (!live()) return;
  if (!noiseBuf) { noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = noiseBuf.getChannelData(0), r = mulberry(7); for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1; }
  const t = ac.currentTime + Math.max(0, at), s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = noiseBuf; s.loop = true; f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(Math.max(1, f0), t); if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(busOf(bus)); s.start(t, nr() * 0.5); s.stop(t + dur + 0.05); s.onended = () => g.disconnect();
}

// audio-clock throttle (presentation only; never gate gameplay on it): true when `key` last passed ≥ sec ago
const last = {};
export function throttle(key, sec) {
  if (!ac) return true; const n = ac.currentTime;
  if (last[key] !== undefined && n - last[key] < sec && n >= last[key]) return false; last[key] = n; return true;
}

export function defineSfx(map, { seed = 0 } = {}) {
  if (!map || typeof map !== "object") throw new Error("defineSfx: map is required — the game's own sound specs");
  const r = seed ? mulberry(seed >>> 0 || 1) : null, sfx = {};
  const check = (name, s) => {
    if (typeof s === "function") return;
    if (Array.isArray(s)) { if (!s.length) throw new Error(`defineSfx: "${name}" is an empty layer list`); return s.forEach((x) => check(name, x)); }
    if (!s || (!s.tone && !s.noise)) throw new Error(`defineSfx: "${name}" needs {tone:{…}} or {noise:{…}} or [layers]`);
    if (s.tone) wave(`defineSfx("${name}")`, "tone.type", s.tone.type);
  };
  const play = (s, k, v, stretch, at) => {
    if (Array.isArray(s)) return s.forEach((x) => play(x, k, v, stretch, at + (x.at || 0)));
    if (s.tone) { const p = s.tone; tone({ ...p, f0: p.f0 * k, f1: (p.f1 ?? p.f0) * k, vol: (p.vol ?? 0.3) * v, dur: (p.dur ?? 0.12) * stretch, at: at + (p.at || 0) }); }
    if (s.noise) { const p = s.noise, f0 = (p.f0 ?? 800) * k; noise({ ...p, f0, f1: (p.f1 ?? p.f0 ?? 800) * k, vol: (p.vol ?? 0.3) * v, dur: (p.dur ?? 0.2) * stretch, at: at + (p.at || 0) }); }
  };
  for (const [name, s] of Object.entries(map)) {
    check(name, s);
    sfx[name] = typeof s === "function" ? s : ({ pitch = 1, vol = 1 } = {}) => {
      if (s.throttle && !throttle("sfx:" + name, s.throttle)) return;
      const k = pitch * (r ? 2 ** ((r() * 2 - 1) / 12) : 1), stretch = r ? 1 + (r() * 2 - 1) * 0.1 : 1, vv = vol * (r ? 1 + (r() * 2 - 1) * 0.1 : 1);
      play(s, k, vv, stretch, Array.isArray(s) ? 0 : s.at || 0);
    };
  }
  return sfx;
}

export const midi = (n) => 440 * 2 ** ((n - 69) / 12);
export const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11], phrygian: [0, 1, 3, 5, 7, 8, 10], pentatonic: [0, 2, 4, 7, 9], minorPent: [0, 3, 5, 7, 10], blues: [0, 3, 5, 6, 7, 10] };
const KITS = ["chip", "808", "brush", "toy", "none"];

function checkVoices(fn, v) {
  need(fn, "voices", v);
  for (const part of ["lead", "bass"]) { need(fn, `voices.${part}`, v[part]); wave(fn, `voices.${part}.wave`, v[part].wave);
    const e = v[part].env; if (!Array.isArray(e) || e.length !== 4 || e.some((x) => !(x >= 0))) throw new Error(`${fn}: voices.${part}.env must be [a, d, s, r] seconds/level ≥ 0`); }
  const d = need(fn, "voices.drums", v.drums); need(fn, "voices.drums.kit", d.kit);
  if (!KITS.includes(d.kit)) throw new Error(`${fn}: voices.drums.kit must be one of ${KITS.join("|")}`);
  if (d.kit !== "none" && !(typeof d.pattern === "string" && /^[kshox.\-]+$/.test(d.pattern))) throw new Error(`${fn}: voices.drums.pattern is required — a string of k s h o x . (kick snare hat open-hat kick+hat rest)`);
}

// the tune: lead = the motif (8ths when ≤ 8 notes, else 16ths), chords = a scale triad on each bar's most common motif degree
export function song({ bpm, key = 60, scale, motif, voices, bars = 4, seed } = {}) {
  need("song", "bpm", bpm); need("song", "scale", scale); need("song", "motif", motif); checkVoices("song", voices);
  const sc = Array.isArray(scale) ? scale : SCALES[scale]; if (!sc) throw new Error(`song: unknown scale "${scale}" — one of ${Object.keys(SCALES).join("|")} or an array`);
  if (!Array.isArray(motif) || motif.length < 8 || !motif.some((n) => typeof n === "number")) throw new Error("song: motif must be ≥ 8 note numbers or null rests, with at least one note");
  const r = mulberry((seed ?? motif.reduce((a, n) => (a * 31 + (n ?? 7)) >>> 0, bpm)) >>> 0 || 1), stride = motif.length <= 8 ? 2 : 1, N = bars * 16;
  const degree = (n) => { const pc = (((n - key) % 12) + 12) % 12; let best = 0; sc.forEach((s, i) => { if (Math.abs(s - pc) < Math.abs(sc[best] - pc)) best = i; }); return best; };
  const note = (d, oct) => key + oct * 12 + sc[((d % sc.length) + sc.length) % sc.length] + 12 * Math.floor(d / sc.length);
  const lead = Array.from({ length: N }, (_, i) => (i % stride ? null : motif[(i / stride) % motif.length] ?? null));
  const chords = [];
  for (let b = 0; b < bars; b++) {
    const seen = {}; for (let i = b * 16; i < b * 16 + 16; i++) if (lead[i] != null) { const d = degree(lead[i]); seen[d] = (seen[d] || 0) + 1; }
    const ds = Object.keys(seen).map(Number).sort((x, y) => seen[y] - seen[x] || x - y);
    let root = b === bars - 1 ? 0 : ds.length ? ds[0] : 0;
    if (b > 0 && b < bars - 1 && chords.length && root === chords[b - 1].d && ds.length > 1) root = ds[1 + Math.floor(r() * (ds.length - 1))];
    if (b === bars - 2 && bars >= 3 && root === 0) root = 4;   // V before the closing I: the tune cadences home
    chords.push({ d: root, notes: [note(root, -1), note(root + 2, -1), note(root + 4, -1)] });
  }
  return { bpm, key, scale: sc, bars, stride, lead, chords: chords.map((c) => c.notes), voices, drums: voices.drums };
}

// ── the sequencer: 16th-note steps, 40 ms tick, 0.12 s lookahead (SW/audio.js) ──
let cur = null, pending = null, timer = null, intensity = 1;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function voice(dest, w, env, n, t, dur, vol) {
  const [a, d, s, rl] = env, o = ac.createOscillator(), g = ac.createGain(), hold = Math.max(dur, a + d);
  o.type = w; o.frequency.value = midi(n);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + a); g.gain.linearRampToValueAtTime(vol * s, t + a + d);
  g.gain.setValueAtTime(vol * s, t + hold); g.gain.linearRampToValueAtTime(0, t + hold + rl);
  o.connect(g).connect(dest); o.start(t); o.stop(t + hold + rl + 0.02); o.onended = () => g.disconnect();
}
function drum(kit, hit, t, dest) {
  const T = (type, f0, f1, dur, vol) => tone({ type, f0, f1, dur, vol, at: t - ac.currentTime, bus: dest });
  const Nz = (f0, f1, dur, vol, type = "highpass", q = 0.7) => noise({ f0, f1, dur, vol, at: t - ac.currentTime, q, type, bus: dest });
  const K = { chip: { k: () => T("square", 160, 40, 0.12, 0.5), s: () => Nz(2400, 1200, 0.1, 0.35, "bandpass", 1), h: () => Nz(9000, 9000, 0.03, 0.15), o: () => Nz(8000, 8000, 0.14, 0.12) },
    "808": { k: () => T("sine", 130, 42, 0.45, 0.9), s: () => { Nz(1800, 1400, 0.18, 0.4, "bandpass", 0.8); T("triangle", 190, 160, 0.1, 0.25); }, h: () => Nz(10000, 10000, 0.04, 0.14), o: () => Nz(9000, 9000, 0.25, 0.12) },
    brush: { k: () => T("sine", 90, 50, 0.25, 0.4), s: () => Nz(3200, 2400, 0.28, 0.18, "bandpass", 0.6), h: () => Nz(6500, 6500, 0.08, 0.06), o: () => Nz(6000, 5000, 0.3, 0.07) },
    toy: { k: () => T("triangle", 320, 120, 0.08, 0.5), s: () => { T("square", 820, 700, 0.05, 0.14); Nz(4000, 4000, 0.05, 0.12, "bandpass", 2); }, h: () => T("sine", 2600, 2600, 0.03, 0.08), o: () => T("sine", 2100, 2000, 0.09, 0.08) } }[kit];
  if (hit === "x") { K.k(); K.h(); } else if (K[hit]) K[hit]();
}
function tick() {
  if (!cur || !ac || ac.state !== "running") { if (cur && ac) cur.next = Math.max(cur.next, ac.currentTime + 0.05); return; }
  const c = cur, s16 = 60 / c.bpm / 4, v = c.voices, arpW = v.arp ? v.arp.wave : v.lead.wave, arpE = v.arp ? v.arp.env : v.lead.env;
  c.arp.gain.setTargetAtTime(smooth(0.25, 0.5, intensity), ac.currentTime, 0.1); c.lead.gain.setTargetAtTime(smooth(0.75, 1, intensity), ac.currentTime, 0.1);
  if (c.next < ac.currentTime) c.next = ac.currentTime + 0.02;
  while (c.next < ac.currentTime + 0.12) {
    const i = c.step, bar = Math.floor(i / 16) % c.chords.length, ch = c.chords[bar], j = i % 16, t = c.next, ln = c.lead[i % c.lead.length];
    if (j % 8 === 0) voice(c.bass, v.bass.wave, v.bass.env, ch[0] - 12, t, s16 * 7, 0.35);
    else if (j % 4 === 0) voice(c.bass, v.bass.wave, v.bass.env, ch[j % 8 === 4 ? 2 : 0] - 12, t, s16 * 3, 0.28);
    if (j % 2 === 0) voice(c.arp, arpW, arpE, ch[(j / 2) % 3] + 12, t, s16 * 0.9, 0.07);
    if (ln != null) voice(c.lead, v.lead.wave, v.lead.env, ln, t, s16 * c.stride * 0.95, 0.13);
    if (c.drums.kit !== "none") drum(c.drums.kit, c.drums.pattern[j % c.drums.pattern.length], t, c.drumsG);
    c.next += s16; c.step++;
  }
}
function normalize(d) {
  if (!d) throw new Error("playSong: data is required — song({...}) or {bpm, chords, lead, voices, drums}");
  need("playSong", "bpm", d.bpm); checkVoices("playSong", d.drums && !d.voices?.drums ? { ...d.voices, drums: d.drums } : d.voices);
  if (!Array.isArray(d.chords) || !d.chords.length || !Array.isArray(d.lead) || !d.lead.length) throw new Error("playSong: chords and lead are required");
  return { bpm: d.bpm, chords: d.chords, lead: d.lead, voices: d.voices, drums: d.drums || d.voices.drums, stride: d.stride || 1 };
}
export function playSong(data, { fade = 0.5 } = {}) {
  const d = normalize(data);
  if (cur && cur.src === data) return;
  if (!ac || !unlocked) { pending = [data, { fade }]; return; }
  stopMusic(fade);
  const g = ac.createGain(); g.gain.setValueAtTime(0, ac.currentTime); g.gain.linearRampToValueAtTime(1, ac.currentTime + Math.max(0.01, fade)); g.connect(musicBus);
  const sub = () => { const n = ac.createGain(); n.connect(g); return n; };
  cur = { ...d, src: data, g, bass: sub(), arp: sub(), lead: sub(), drumsG: sub(), step: 0, next: ac.currentTime + 0.05 };
  if (!timer) timer = setInterval(tick, 40);
  tick();
}
export function stopMusic(fade = 0.5) {
  pending = null; if (!cur) return;
  const g = cur.g, t = ac.currentTime; g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + Math.max(0.01, fade));
  setTimeout(() => g.disconnect(), (fade + 0.5) * 1000); cur = null;
}
export function setIntensity(x) { intensity = Math.min(1, Math.max(0, +x || 0)); }
