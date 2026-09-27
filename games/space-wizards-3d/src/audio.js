// audio.js — everything is synthesized with WebAudio (no files): a tiny orchestral-chiptune sequencer
// and a handful of sound effects. Unlocks on the first tap/key (browsers require a gesture).
let ac = null, master = null, sfxBus = null, musicBus = null, muted = false;
const last = {};
export function unlockAudio() {
  if (!ac) {
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      master = ac.createGain(); master.gain.value = 0.5; master.connect(ac.destination);
      const comp = ac.createDynamicsCompressor(); comp.connect(master);
      sfxBus = ac.createGain(); sfxBus.gain.value = 0.55; sfxBus.connect(comp);
      musicBus = ac.createGain(); musicBus.gain.value = 0.22; musicBus.connect(comp);
    } catch (e) { ac = null; return; }
  }
  if (ac.state === "suspended") ac.resume();
}
// a locked phone or a hidden tab should not keep playing music
document.addEventListener("visibilitychange", () => { if (!ac) return; if (document.hidden) ac.suspend(); else if (!muted) ac.resume(); });
export function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.5; }
export const isMuted = () => muted;

function env(g, t, a, peak, dur) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); }
function osc({ type = "square", f0 = 440, f1, dur = 0.15, vol = 0.5, at = 0, bus = sfxBus, detune = 0 }) {
  if (!ac) return; const t = ac.currentTime + at; const g = ac.createGain(); g.connect(bus); env(g, t, 0.008, vol, dur);
  const o = ac.createOscillator(); o.type = type; o.detune.value = detune; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  o.connect(g); o.start(t); o.stop(t + dur + 0.05);
}
let noiseBuf = null;
function noise({ f0 = 2000, f1 = 200, dur = 0.3, vol = 0.6, at = 0, q = 0.7, type = "lowpass" }) {
  if (!ac) return; const t = ac.currentTime + at;
  if (!noiseBuf) { noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true; const f = ac.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur); const g = ac.createGain(); env(g, t, 0.01, vol, dur);
  src.connect(f); f.connect(g); g.connect(sfxBus); src.start(t); src.stop(t + dur + 0.05);
}
const throttle = (k, s) => { const n = performance.now(); if (last[k] && n - last[k] < s * 1000) return false; last[k] = n; return true; };

export const sfx = {
  wand() { if (!throttle("wand", 0.09)) return; const f = 1300 + Math.random() * 500; osc({ type: "sine", f0: f, f1: f * 1.6, dur: 0.09, vol: 0.12 }); osc({ type: "triangle", f0: f * 2, dur: 0.06, vol: 0.05, at: 0.03 }); },
  blaster() { if (!throttle("blaster", 0.1)) return; osc({ type: "sawtooth", f0: 1100, f1: 180, dur: 0.16, vol: 0.13 }); },
  sword() { noise({ f0: 5000, f1: 600, dur: 0.28, vol: 0.35, type: "bandpass", q: 2 }); osc({ type: "sawtooth", f0: 140, f1: 90, dur: 0.3, vol: 0.12 }); },
  pop() { if (!throttle("pop", 0.05)) return; noise({ f0: 3000, f1: 150, dur: 0.35, vol: 0.45 }); [880, 1320, 1760].forEach((f, i) => osc({ type: "triangle", f0: f, dur: 0.1, vol: 0.12, at: i * 0.04 })); },
  boom() { noise({ f0: 1400, f1: 40, dur: 1.2, vol: 0.9 }); osc({ type: "sine", f0: 120, f1: 30, dur: 1.0, vol: 0.5 }); },
  hit() { noise({ f0: 1800, f1: 120, dur: 0.35, vol: 0.7 }); osc({ type: "square", f0: 220, f1: 55, dur: 0.35, vol: 0.25 }); },
  star() { if (!throttle("star", 0.04)) return; osc({ type: "sine", f0: 1568, dur: 0.07, vol: 0.2 }); osc({ type: "sine", f0: 2093, dur: 0.16, vol: 0.2, at: 0.06 }); },
  ring() { [1047, 1319, 1568, 2093].forEach((f, i) => osc({ type: "triangle", f0: f, dur: 0.18, vol: 0.18, at: i * 0.05 })); },
  heart() { [523, 659, 784, 1047, 1319].forEach((f, i) => osc({ type: "sine", f0: f, dur: 0.2, vol: 0.2, at: i * 0.06 })); },
  roll() { noise({ f0: 400, f1: 3000, dur: 0.4, vol: 0.3, type: "bandpass", q: 1.5 }); },
  swap() { osc({ type: "square", f0: 660, dur: 0.05, vol: 0.12 }); osc({ type: "square", f0: 990, dur: 0.08, vol: 0.12, at: 0.05 }); },
  select() { osc({ type: "triangle", f0: 784, dur: 0.08, vol: 0.2 }); osc({ type: "triangle", f0: 1175, dur: 0.12, vol: 0.2, at: 0.07 }); },
  warp() { noise({ f0: 200, f1: 6000, dur: 1.4, vol: 0.4, type: "bandpass", q: 3 }); osc({ type: "sawtooth", f0: 80, f1: 900, dur: 1.4, vol: 0.12 }); },
  power() { [262, 330, 392, 523, 659, 784, 1047].forEach((f, i) => osc({ type: "square", f0: f, dur: 0.22, vol: 0.14, at: i * 0.06 })); setTimeout(() => sfx.boom(), 350); },
  alarm() { for (let i = 0; i < 4; i++) { osc({ type: "square", f0: 880, f1: 440, dur: 0.35, vol: 0.14, at: i * 0.45 }); } },
  bosshit() { if (!throttle("bosshit", 0.07)) return; osc({ type: "square", f0: 180, f1: 120, dur: 0.08, vol: 0.15 }); },
  eshot() { if (!throttle("eshot", 0.12)) return; osc({ type: "sine", f0: 500, f1: 260, dur: 0.18, vol: 0.12 }); },
  win() { [523, 659, 784, 1047, 784, 1047, 1319, 1568].forEach((f, i) => { osc({ type: "triangle", f0: f, dur: 0.3, vol: 0.25, at: i * 0.14 }); osc({ type: "square", f0: f / 2, dur: 0.3, vol: 0.08, at: i * 0.14 }); }); },
  lose() { [392, 349, 311, 262].forEach((f, i) => osc({ type: "triangle", f0: f, dur: 0.4, vol: 0.25, at: i * 0.22 })); },
};

// ── music: a lookahead step sequencer (bass + arpeggio + a lead that enters later) ──
const N = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI → Hz
const SONGS = {
  title: { bpm: 96, chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], lead: [76, null, 74, 72, 71, null, 72, 74, 76, null, 79, null, 77, 76, 74, null] },
  play: { bpm: 132, chords: [[50, 53, 57], [46, 50, 53], [48, 52, 55], [45, 49, 52]], lead: [74, null, 77, 76, 74, null, 72, 69, 70, null, 74, 72, 69, null, 67, 69] },
  boss: { bpm: 150, chords: [[45, 48, 52], [46, 49, 53], [45, 48, 52], [44, 47, 51]], lead: [81, 80, 81, null, 76, null, 77, 76, 74, null, 72, 74, 76, null, 69, null] },
};
let song = null, step = 0, nextT = 0, timer = null;
export function playMusic(name) {
  if (song === SONGS[name]) return; song = SONGS[name] || null; step = 0; if (ac) nextT = ac.currentTime + 0.05;
  if (!timer) timer = setInterval(tick, 40);
}
export function stopMusic() { song = null; }
function tick() {
  if (!ac || !song || muted) { if (ac) nextT = ac.currentTime + 0.05; return; }
  const s16 = 60 / song.bpm / 4;
  while (nextT < ac.currentTime + 0.12) {
    const bar = Math.floor(step / 16) % song.chords.length, ch = song.chords[bar], i = step % 16, at = nextT - ac.currentTime;
    if (i % 4 === 0) osc({ type: "triangle", f0: N(ch[0] - 12), dur: s16 * 3.5, vol: 0.5, at, bus: musicBus });
    if (i % 2 === 0) osc({ type: "square", f0: N(ch[(i / 2) % 3] + 12), dur: s16 * 0.9, vol: 0.09, at, bus: musicBus, detune: 6 });
    const ln = song.lead[i]; if (ln && Math.floor(step / 16) % 4 >= 2) osc({ type: "sawtooth", f0: N(ln), dur: s16 * 1.8, vol: 0.07, at, bus: musicBus });
    if (i % 8 === 4) noise({ f0: 6000, f1: 3000, dur: 0.05, vol: 0.08, at, type: "highpass" });
    nextT += s16; step++;
  }
}
