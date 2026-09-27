// input.js — keys, gamepad, a thumb stick, buttons, swipes and taps feed ONE model: an analog `axis` plus
// edge-triggered actions that live until the loop's endStep(). Pointer events of every type (mouse, pen, touch)
// drive the stick, swipes and buttons identically, and each touch pointer is owned by exactly one control.
// It tags its own DOM (data-arcade-control / data-arcade-drag / data-arcade-swipe) so `arcade check` can find
// and fire every visible control. Pure mechanism: every class, color and glyph belongs to the game's CSS.
// API and costs: kit/three/README.md (section input.js).

export const DEFAULT_KEYS = { ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right", ArrowUp: "up", KeyW: "up",
  ArrowDown: "down", KeyS: "down", Space: "a", KeyZ: "a", KeyX: "b", ShiftLeft: "b", KeyC: "c", Enter: "start", KeyP: "pause" };

const CONTROL = "[data-arcade-control],[data-start]";
const el = (z, what) => {
  const e = typeof z === "string" ? document.querySelector(z) : z;
  if (!e) throw new Error(`createInput: ${what} ${typeof z === "string" ? `"${z}" ` : ""}was not found in the page`);
  return e;
};
const clamp1 = (x, y) => { const d = Math.hypot(x, y); return d > 1 ? [x / d, y / d] : [x, y]; };

export function createInput({ keys = DEFAULT_KEYS, stick = null, buttons = {}, swipe = null, tap = null,
  pad = { a: [0], b: [1, 2], start: [9], deadzone: 0.2 }, startSelector = "[data-start]", guardBack = true } = {}) {
  const codes = new Set(), pressedSet = new Set(), counts = {}, btnHeld = new Map(), padHeld = new Set(), off = [];
  let enabled = true, guarded = false, padPrev = new Set();
  const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); off.push(() => t.removeEventListener(ev, fn, o)); };
  const press = (a) => { if (!enabled) return; pressedSet.add(a); counts[a] = (counts[a] || 0) + 1; if (a === "start") guard(); };
  const I = {
    axis: { x: 0, y: 0 }, tapAt: null, counts,
    isTouch: matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0,
    held: (a) => { if (padHeld.has(a)) return true; for (const c of codes) if (keys[c] === a || (a === "start" && (c === "Space" || c === "Enter"))) return true;
      for (const v of btnHeld.values()) if (v === a) return true; return false; },
    pressed: (a) => pressedSet.has(a),
    took: (a) => pressedSet.delete(a),
    poll, endStep: () => pressedSet.clear(),
    clear() { pressedSet.clear(); codes.clear(); padHeld.clear(); releaseButtons(); endStick(null); I.axis.x = I.axis.y = 0; I.tapAt = null; },
    setEnabled(b) { enabled = !!b; if (!enabled) I.clear(); },
    destroy() { I.clear(); for (const f of off.splice(0)) f(); },
  };

  // ── back-gesture guard: a stray edge swipe on the first page must not send the kid back to the hub ──
  function guard() {
    if (!guardBack || guarded) return; guarded = true;
    try { history.pushState({ arcade: 1 }, ""); } catch (_) {}
  }
  if (guardBack) on(window, "popstate", () => { if (guarded) try { history.pushState({ arcade: 1 }, ""); } catch (_) {} });

  // ── keyboard ──
  on(window, "keydown", (e) => {
    if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
    if (!enabled) return;
    const was = codes.has(e.code); codes.add(e.code);
    if (e.repeat || was) return;
    const a = keys[e.code]; if (a) press(a);
    if ((e.code === "Space" || e.code === "Enter") && a !== "start") press("start");
  });
  on(window, "keyup", (e) => codes.delete(e.code));
  on(window, "blur", () => { codes.clear(); padHeld.clear(); });

  const touchSeen = (e) => { if (e.pointerType === "touch" && !document.body.classList.contains("touch")) { I.isTouch = true; document.body.classList.add("touch"); } };
  on(window, "pointerdown", touchSeen, true);
  const capture = (t, e) => { try { t.setPointerCapture(e.pointerId); } catch (_) {} };
  // a pointer that starts on another control belongs to that control, never to a zone underneath it
  const foreign = (e, zone) => { const c = e.target.closest && e.target.closest(CONTROL); return !!c && c !== zone; };

  // ── buttons: each owns its own pointers; pointerdown fires ──
  function releaseButtons(id) {
    for (const [pid, a] of [...btnHeld]) if (id === undefined || pid === id) {
      btnHeld.delete(pid); for (const b of document.querySelectorAll(`[data-arcade-control="${a}"]`)) if (![...btnHeld.values()].includes(a)) b.classList.remove("down");
    }
  }
  for (const [sel, action] of Object.entries(buttons)) {
    const list = document.querySelectorAll(sel);
    if (!list.length) throw new Error(`createInput: button "${sel}" was not found in the page`);
    for (const b of list) {
      b.dataset.arcadeControl = action;
      on(b, "pointerdown", (e) => { if (!enabled) return; e.preventDefault(); capture(b, e); btnHeld.set(e.pointerId, action); b.classList.add("down"); press(action); });
    }
  }
  for (const ev of ["pointerup", "pointercancel"]) on(window, ev, (e) => { releaseButtons(e.pointerId); if (st && e.pointerId === st.id) endStick(); });

  // ── start: anything matching startSelector ──
  if (startSelector) on(document, "pointerdown", (e) => { if (e.target.closest && e.target.closest(startSelector)) press("start"); });

  // ── stick: float (appears under the thumb) · relative (trackpad: origin trails the thumb) · fixed (base centre) ──
  let st = null, sx = 0, sy = 0; const S = stick && { mode: "float", radius: 60, deadzone: 0.08, ...stick };
  if (S) {
    const zone = el(S.zone ?? (() => { throw new Error("createInput: stick.zone is required"); })(), "stick.zone");
    const base = S.base ? el(S.base, "stick.base") : null, knob = S.knob ? el(S.knob, "stick.knob") : null;
    zone.dataset.arcadeControl = "stick"; zone.setAttribute("data-arcade-drag", "");
    S.el = { zone, base, knob };
    const place = (x, y) => { if (!base) return; const r = (base.offsetParent || document.body).getBoundingClientRect(); base.style.left = x - r.left + "px"; base.style.top = y - r.top + "px"; };
    on(zone, "pointerdown", (e) => {
      if (!enabled || st || foreign(e, zone)) return; e.preventDefault(); capture(zone, e);
      let ox = e.clientX, oy = e.clientY;
      if (S.mode === "fixed") { const r = (base || zone).getBoundingClientRect(); ox = r.left + r.width / 2; oy = r.top + r.height / 2; }
      else place(ox, oy);
      st = { id: e.pointerId, ox, oy, counted: false }; base && base.classList.add("on"); move(e);
    });
    on(window, "pointermove", (e) => { if (st && e.pointerId === st.id) move(e); });
    on(zone, "lostpointercapture", (e) => { if (st && e.pointerId === st.id) endStick(); });
  }
  function move(e) {
    const R = S.radius; let dx = e.clientX - st.ox, dy = e.clientY - st.oy, d = Math.hypot(dx, dy);
    if (d > R) {
      if (S.mode === "relative") { st.ox += (dx / d) * (d - R); st.oy += (dy / d) * (d - R); dx = e.clientX - st.ox; dy = e.clientY - st.oy; }
      else { dx *= R / d; dy *= R / d; }
    }
    sx = dx / R; sy = -dy / R;
    if (S.el.knob) S.el.knob.style.transform = `translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px)`;
    if (!st.counted && Math.hypot(sx, sy) > 0.3) { st.counted = true; counts.stick = (counts.stick || 0) + 1; }
  }
  function endStick() {
    if (!st) return; st = null; sx = sy = 0;
    if (S.el.base) S.el.base.classList.remove("on");
    if (S.el.knob) S.el.knob.style.transform = "translate(0px,0px)";
  }

  // ── swipe: fires on move (not touchend), once per gesture; ignores touches starting in the edge bands ──
  if (swipe) {
    const W = { zone: "body", min: 30, edge: 24, ...swipe }, zone = el(W.zone === "body" ? document.body : W.zone, "swipe.zone");
    zone.setAttribute("data-arcade-swipe", "");
    const g = new Map();
    on(zone, "pointerdown", (e) => {
      if (!enabled || foreign(e, zone === document.body ? null : zone) || e.clientX < W.edge || e.clientX > innerWidth - W.edge) return;
      g.set(e.pointerId, { x: e.clientX, y: e.clientY, done: false });
    });
    on(window, "pointermove", (e) => {
      const s = g.get(e.pointerId); if (!s || s.done) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y; if (Math.hypot(dx, dy) < W.min) return;
      s.done = true; press(Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "swipeLeft" : "swipeRight") : (dy < 0 ? "swipeUp" : "swipeDown"));
    });
    for (const ev of ["pointerup", "pointercancel"]) on(window, ev, (e) => g.delete(e.pointerId));
  }

  // ── tap: pointerdown anywhere in the zone that is not a control → "tap" + tapAt in CSS px ──
  if (tap) {
    const zone = el(tap.zone ?? document.body, "tap.zone");
    on(zone, "pointerdown", (e) => { if (!enabled || foreign(e, null)) return; I.tapAt = { x: e.clientX, y: e.clientY }; press("tap"); });
  }

  // ── gamepad (polled) + the combined axis: stick beats pad beats keys; length ≤ 1, y+ = UP ──
  function poll() {
    let x = 0, y = 0;
    const k = (a) => { for (const c of codes) if (keys[c] === a) return 1; return 0; };
    x = k("right") - k("left"); y = k("up") - k("down");
    const now = new Set(); let px = 0, py = 0;
    const pads = pad && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const dz = pad.deadzone ?? 0.2, ax = p.axes[0] || 0, ay = p.axes[1] || 0, b = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
      px = Math.abs(ax) > dz ? ax : 0; py = Math.abs(ay) > dz ? -ay : 0;
      if (b(12)) py = 1; if (b(13)) py = -1; if (b(14)) px = -1; if (b(15)) px = 1;
      for (const [a, idx] of Object.entries(pad)) if (Array.isArray(idx) && idx.some(b)) now.add(a);
      break;
    }
    if (enabled) for (const a of now) if (!padPrev.has(a)) press(a);
    padPrev = now; padHeld.clear(); for (const a of now) padHeld.add(a);
    if (px || py) { x = px; y = py; }
    if (st && Math.hypot(sx, sy) > S.deadzone) { x = sx; y = sy; }
    [x, y] = clamp1(x, y); I.axis.x = enabled ? x : 0; I.axis.y = enabled ? y : 0;
  }
  return I;
}
