// shell.js — the DOM around the world: which screen shows (title / over / the game's own), when a screen may
// accept input (simulation time, never the wall clock), text that writes only on change, the hub link, and
// the rotate overlay. It draws nothing and ships no strings: every screen, prompt and overlay is the game's.
// API and costs: kit/three/README.md (section shell.js).

const q = (fn, sel) => {
  const e = typeof sel === "string" ? document.querySelector(sel) : sel;
  if (!e) throw new Error(`${fn}: ${typeof sel === "string" ? `"${sel}"` : "element"} was not found in the page`);
  return e;
};
const need = (fn, name, v) => { if (v === undefined || v === null || v === "") throw new Error(`${fn}: ${name} is required — decide it in the art direction`); return v; };
// simulation seconds, counted in fixed steps from core's loop (0 before startLoop): hitstop and advanceTime safe
const simNow = () => { const a = window.__arcade; return a && a.frames ? a.frames / (a.hz || 60) : 0; };

export function createShell({ screens, hud = "#hud", controls = "#controls", startDelay = 0.6, orient, prompt, onShow = null, input = null } = {}) {
  need("createShell", "screens", screens);
  if (orient !== "landscape" && orient !== "portrait") throw new Error(`createShell: orient is required — "landscape" or "portrait" (got ${JSON.stringify(orient)})`);
  need("createShell", "prompt", prompt);
  const promptEl = q("createShell prompt.el", prompt.el), promptText = need("createShell", "prompt.text", prompt.text);
  const els = {};
  for (const [name, sel] of Object.entries(screens)) els[name] = q(`createShell screen "${name}"`, sel);
  for (const [name, e] of Object.entries(els)) e.dataset.screen = name;
  promptEl.textContent = promptText;
  const opt = (sel) => (sel ? document.querySelector(sel) : null);
  const hudEl = opt(hud), controlsEl = opt(controls);
  let shownAt = 0, delay = 0;   // the first screen (the boot title) accepts at once: nothing came before it to mis-tap

  const S = {
    screen: null,
    show(name) {
      delay = S.screen === null ? 0 : startDelay;
      S.screen = name; shownAt = simNow();
      const overlay = name in els;   // a registered screen is an overlay; anything else ("play", "pick"...) is play
      for (const [n, e] of Object.entries(els)) e.hidden = n !== name;
      document.body.dataset.screen = name;
      if (hudEl) hudEl.hidden = overlay;
      if (controlsEl) controlsEl.hidden = overlay;
      if (input && input.clear) input.clear();
      if (onShow) onShow(name);
      return S;
    },
    canAccept: () => simNow() - shownAt >= delay - 1e-9,
    text(sel) {
      const e = q("shell.text", sel); let last;
      return (v) => { const s = String(v); if (s !== last) { e.textContent = s; last = s; } };
    },
    hubLink(sel = "#hub") {
      const e = q("shell.hubLink", sel);
      e.hidden = !/\/games\/[^/]+\/?$/.test(location.pathname);
      if (e.tagName === "A" && !e.getAttribute("href")) e.setAttribute("href", "../../");
      for (const ev of ["pointerdown", "touchstart", "mousedown", "click", "keydown"]) e.addEventListener(ev, (x) => x.stopPropagation());
      return e;
    },
    rotate(el) {
      const e = q("shell.rotate", el);
      if (!e.textContent.trim() && !e.children.length) throw new Error("shell.rotate: the overlay element is empty — write its content in the game's voice");
      const touch = () => matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
      const update = () => {
        const wrong = touch() && (innerWidth > innerHeight ? "landscape" : "portrait") !== orient;
        e.hidden = !wrong; document.body.classList.toggle("rotate", wrong);
      };
      addEventListener("resize", update); addEventListener("orientationchange", () => setTimeout(update, 150));
      update();
      return e;
    },
  };
  return S;
}
