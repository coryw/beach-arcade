// input.js — keyboard, gamepad and touch feed one tiny model: an analog `axis` and edge-triggered actions.
// Touch: drag anywhere on the left side and the ship follows your thumb (relative, like a trackpad);
// the right side has two big buttons. Kids never have to find a tiny joystick.
export const input = { x: 0, y: 0, actions: new Set(), isTouch: matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0 };
const keys = new Set();
const ACT = { Space: "roll", KeyZ: "roll", KeyJ: "roll", ShiftLeft: "swap", ShiftRight: "swap", KeyX: "swap", KeyK: "swap", Enter: "ok", Escape: "back", ArrowLeft: "left", ArrowRight: "right", KeyA: "left", KeyD: "right" };
addEventListener("keydown", (e) => {
  if (e.repeat) return; keys.add(e.code);
  const a = ACT[e.code]; if (a) input.actions.add(a); if (e.code === "Space" || e.code === "Enter") input.actions.add("ok");
  if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => keys.clear());

let drag = null; const DRAG_R = 70;
export function bindTouch(zone, dot, rollBtn, swapBtn) {
  zone.addEventListener("pointerdown", (e) => { try { zone.setPointerCapture(e.pointerId); } catch (_) {} drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 }; dot.style.left = e.clientX + "px"; dot.style.top = e.clientY + "px"; dot.classList.add("on"); e.preventDefault(); });
  zone.addEventListener("pointermove", (e) => { if (!drag || e.pointerId !== drag.id) return; drag.dx = e.clientX - drag.x0; drag.dy = e.clientY - drag.y0;
    const d = Math.hypot(drag.dx, drag.dy); if (d > DRAG_R) { drag.x0 += (drag.dx / d) * (d - DRAG_R); drag.y0 += (drag.dy / d) * (d - DRAG_R); drag.dx = e.clientX - drag.x0; drag.dy = e.clientY - drag.y0; }
    dot.style.left = e.clientX + "px"; dot.style.top = e.clientY + "px"; e.preventDefault(); });
  const end = (e) => { if (drag && e.pointerId === drag.id) { drag = null; dot.classList.remove("on"); } };
  zone.addEventListener("pointerup", end); zone.addEventListener("pointercancel", end);
  for (const [btn, a] of [[rollBtn, "roll"], [swapBtn, "swap"]]) {
    btn.addEventListener("pointerdown", (e) => { input.actions.add(a); btn.classList.add("down"); e.preventDefault(); });
    for (const ev of ["pointerup", "pointercancel", "pointerleave"]) btn.addEventListener(ev, () => btn.classList.remove("down"));
  }
}
let padPrev = {};
export function pollInput() {
  let x = (keys.has("ArrowRight") || keys.has("KeyD") ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("KeyA") ? 1 : 0);
  let y = (keys.has("ArrowUp") || keys.has("KeyW") ? 1 : 0) - (keys.has("ArrowDown") || keys.has("KeyS") ? 1 : 0);
  if (drag) { x = Math.max(-1, Math.min(1, drag.dx / DRAG_R)); y = Math.max(-1, Math.min(1, -drag.dy / DRAG_R)); }
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    if (!p) continue;
    const ax = p.axes[0] || 0, ay = p.axes[1] || 0; if (Math.abs(ax) > 0.2) x = ax; if (Math.abs(ay) > 0.2) y = -ay;
    const b = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
    const now = { roll: b(0), swap: b(1) || b(2), ok: b(0) || b(9) };
    for (const k in now) if (now[k] && !padPrev[k]) input.actions.add(k);
    padPrev = now; break;
  }
  input.x = x; input.y = y;
}
export const took = (a) => { if (input.actions.has(a)) { input.actions.delete(a); return true; } return false; };
export const clearActions = () => input.actions.clear();
