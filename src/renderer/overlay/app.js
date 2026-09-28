// Overlay runtime: one of these runs in each monitor's transparent window.
// The window whose monitor Claude is on is the "brain": it runs the simulation.
// Neighbouring windows are "viewers" that draw snapshots while Claude straddles
// the bezel. Walking across hands the whole (plain-object) state to the next one.
import { createState, step, applyWorld, setControl, emptyInput } from './sim/index.js';
import { centerOf, fireRope, grab, moveHeld, release, releaseRope } from './sim/physics.js';
import { onBeat, onLoud, poke, goto } from './sim/behavior.js';
import { burst } from './sim/particles.js';
import { CENTER_Y } from './sim/constants.js';
import { nearestRegion, regionAt } from './sim/world.js';
import { bounds, drawCharacter, drawRope, hitTest } from './render/character.js';
import { drawParticles } from './render/effects.js';
import { BubbleView, hideBubble, newBubbleState, queueBubble } from './render/bubble.js';

const api = window.overlay;
const CHAR_SIZE = 720;
const charCanvas = document.getElementById('char');
const fxCanvas = document.getElementById('fx');
const hintEl = document.getElementById('hint');
const cctx = charCanvas.getContext('2d');
const fctx = fxCanvas.getContext('2d');
const dpr = window.devicePixelRatio || 1;

let info = null; // { displayId, area }
let area = { x: 0, y: 0, w: 1, h: 1 };
let role = 'viewer';
let st = null; // brain: live sim state. viewer: null
let snap = null; // viewer: last snapshot from the brain
let snapDirty = false;
let drewSomething = false;
let fxDirty = false;
let world = { regions: [], platforms: [] };
let keys = emptyInput();
let settings = {};
let sharing = false;
let handingOff = false;
let lastReport = 0;
let hintUntil = 0;
let hintsShown = 0;

const bubble = new BubbleView(document.body, (id) => {
  if (id === '__dismiss') {
    if (st) hideBubble(st.ui);
  } else {
    api.send('bubble-action', id);
    if (st) hideBubble(st.ui);
  }
});

function simSettings(s) {
  return {
    audio: s.audioReactions !== false,
    walkOnWindows: s.walkOnWindows !== false,
    sleepAfter: s.sleepAfter ?? 240,
    chattiness: s.chattiness ?? 'normal',
  };
}

function setupCanvases() {
  charCanvas.width = CHAR_SIZE * dpr;
  charCanvas.height = CHAR_SIZE * dpr;
  charCanvas.style.width = `${CHAR_SIZE}px`;
  charCanvas.style.height = `${CHAR_SIZE}px`;
  fxCanvas.width = Math.round(area.w * dpr);
  fxCanvas.height = Math.round(area.h * dpr);
  fxCanvas.style.width = `${area.w}px`;
  fxCanvas.style.height = `${area.h}px`;
}

function spawnState(fromTop = true) {
  const x = area.x + area.w * (0.3 + Math.random() * 0.4);
  const s = createState({ x, y: fromTop ? area.y + 40 : area.y + area.h, scale: settings.scale ?? 1.4, settings: simSettings(settings) });
  s.ui = { bubble: newBubbleState() };
  return s;
}

// ---- rendering ------------------------------------------------------------------

function groundBelow(s) {
  const c = s.char;
  if (c.mode === 'ground') return c.y;
  let best = null;
  for (const p of world.platforms) {
    if (c.x >= p.x1 && c.x <= p.x2 && p.y >= c.y - 1 && (best === null || p.y < best)) best = p.y;
  }
  const r = regionAt(world, c.x, c.y - 2) || nearestRegion(world, c.x, c.y);
  const floor = r ? r.y + r.h : null;
  if (best === null) return floor;
  return floor === null ? best : Math.min(best, floor);
}

function render(s) {
  const c = s.char;
  const cx = c.x;
  const cy = c.y - CENTER_Y * c.scale;
  const ox = Math.round(cx - CHAR_SIZE / 2);
  const oy = Math.round(cy - CHAR_SIZE / 2);
  charCanvas.style.transform = `translate(${ox - area.x}px, ${oy - area.y}px)`;
  cctx.setTransform(dpr, 0, 0, dpr, -ox * dpr, -oy * dpr);
  cctx.clearRect(ox, oy, CHAR_SIZE, CHAR_SIZE);
  drawCharacter(cctx, s);
  drawParticles(cctx, s.particles, c.scale);
  const ropeOn = c.rope.state !== 'none';
  if (ropeOn || fxDirty) {
    fctx.setTransform(dpr, 0, 0, dpr, -area.x * dpr, -area.y * dpr);
    fctx.clearRect(area.x, area.y, area.w, area.h);
    if (ropeOn) drawRope(fctx, s);
    fxDirty = ropeOn;
  }
  drewSomething = true;
}

function clearAll() {
  cctx.setTransform(1, 0, 0, 1, 0, 0);
  cctx.clearRect(0, 0, charCanvas.width, charCanvas.height);
  fctx.setTransform(1, 0, 0, 1, 0, 0);
  fctx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
  drewSomething = false;
  fxDirty = false;
}

function visualBounds(s) {
  const b = bounds(s, 30 * s.char.scale);
  const r = s.char.rope;
  if (r.state !== 'none') {
    b.x1 = Math.min(b.x1, r.ax, r.hx);
    b.x2 = Math.max(b.x2, r.ax, r.hx);
    b.y1 = Math.min(b.y1, r.ay, r.hy);
    b.y2 = Math.max(b.y2, r.ay, r.hy);
  }
  return b;
}

const intersects = (b, a) => b.x2 >= a.x && b.x1 <= a.x + a.w && b.y2 >= a.y && b.y1 <= a.y + a.h;

// ---- brain ----------------------------------------------------------------------

function packSnapshot(s) {
  return { char: s.char, anim: s.anim, particles: s.particles, t: s.t, flags: s.flags, audio: s.audio, groundY: s.groundY, control: s.control };
}

function shareWithNeighbors() {
  const b = visualBounds(st);
  const others = world.regions.some((r) => r.id !== info.displayId && intersects(b, r));
  if (others) {
    api.send('snapshot', packSnapshot(st));
    sharing = true;
  } else if (sharing) {
    api.send('snapshot', null);
    sharing = false;
  }
}

function maybeHandoff() {
  const c = st.char;
  if (c.mode === 'held' || handingOff) return;
  const cen = centerOf(c);
  const m = 8;
  const inMine = cen.x >= area.x - m && cen.x <= area.x + area.w + m && cen.y >= area.y - m && cen.y <= area.y + area.h + m;
  if (inMine) return;
  const target = world.regions.find((r) => r.id !== info.displayId && cen.x >= r.x + m && cen.x <= r.x + r.w - m && cen.y >= r.y - 400 && cen.y <= r.y + r.h + m);
  if (target) handoffTo(target.id);
}

function handoffTo(displayId, extra = {}) {
  handingOff = true;
  const state = st;
  const k = keys;
  becomeViewer();
  api.send('handoff', { to: displayId, state, keys: k, ...extra });
}

function becomeViewer() {
  role = 'viewer';
  st = null;
  snap = null;
  clearAll();
  bubble.update({ t: 0, char: { x: 0, y: 0, scale: 1 } }, { bubble: { text: '', until: 0 } }, 0, area, area);
  showHint(false);
}

function becomeBrain(state, k) {
  role = 'brain';
  handingOff = false;
  st = state || spawnState(true);
  st.ui ??= { bubble: newBubbleState() };
  keys = k || emptyInput();
  snap = null;
  st.settings = { ...st.settings, ...simSettings(settings) };
  if (pendingPress && !dragging && performance.now() - pendingPress.t0 < 1500) press = pendingPress;
  pendingPress = null;
}

function reportState(now) {
  if (now - lastReport < 250) return;
  lastReport = now;
  const c = st.char;
  api.send('report', {
    displayId: info.displayId,
    x: Math.round(c.x),
    y: Math.round(c.y),
    mode: c.mode,
    ground: c.ground,
    brain: st.brain.name,
    pose: st.anim.pose,
    control: st.control.active,
    rope: c.rope.state,
    climbWin: c.mode === 'climb' && c.climb && !c.climb.wall ? c.climb.win : null,
    bubble: st.ui.bubble.until > st.t || st.ui.bubble.sticky ? st.ui.bubble.text : null,
    t: Math.round(st.t * 10) / 10,
    dancing: st.brain.name === 'dance',
    face: st.anim.tempFace && st.t < st.anim.faceUntil ? st.anim.tempFace.eyes : st.anim.face.eyes,
  });
}

// ---- main loop ------------------------------------------------------------------

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;
  if (role === 'brain' && st) {
    if (press && !dragging && now - press.t0 > 170) startDrag();
    if (st.control.active && st.t - st.control.lastInput > 45) setControlMode(false);
    st.clock.hour = new Date().getHours();
    if (st.audio.bpm > 0) st.audio.phase = (st.audio.phase ?? 0) + (dt * st.audio.bpm) / 60;
    step(st, world, keys, dt);
    while (st.say.length) queueBubble(st.ui, st, st.say.shift());
    st.groundY = groundBelow(st);
    if (bubble.update(st, st.ui, dt, area, area)) st.anim.talk = 0.12;
    render(st);
    positionHint();
    shareWithNeighbors();
    maybeHandoff();
    if (st) reportState(now);
  } else if (role === 'viewer') {
    if (snap && snapDirty) {
      render(snap);
      snapDirty = false;
    } else if (!snap && drewSomething) {
      clearAll();
    }
  }
}

// ---- input ----------------------------------------------------------------------

let ignoring = true;
let hovering = false;
let press = null;
let pendingPress = null;
let dragging = false;
let lastPokeAt = 0;
let lastMove = { x: 0, y: 0 };

function setIgnore(v) {
  if (v !== ignoring) {
    ignoring = v;
    api.send('ignore', v);
  }
}

function toGlobal(e) {
  return { x: e.clientX + area.x, y: e.clientY + area.y };
}

function currentView() {
  return role === 'brain' ? st : snap;
}

function updateHover(p) {
  const s = currentView();
  const onChar = !!s && hitTest(s, p.x, p.y);
  const onBubble = role === 'brain' && bubble.hitTest(p.x, p.y);
  hovering = onChar;
  setIgnore(!(onChar || onBubble || dragging || press));
  document.body.classList.toggle('grab', onChar && !dragging);
}

function startDrag() {
  if (!press || dragging || role !== 'brain') return;
  dragging = true;
  grab(st, press.x, press.y);
  moveHeld(st, lastMove.x, lastMove.y);
  document.body.classList.remove('grab');
  document.body.classList.add('grabbing');
}

window.addEventListener('mousemove', (e) => {
  const p = toGlobal(e);
  lastMove = p;
  if (role === 'brain' && st) {
    st.cursor.x = p.x;
    st.cursor.y = p.y;
    st.cursor.t = st.t;
  }
  if (press) {
    if (!dragging && Math.hypot(p.x - press.x, p.y - press.y) > 5) startDrag();
    if (dragging && role === 'brain') moveHeld(st, p.x, p.y);
    return;
  }
  updateHover(p);
});

window.addEventListener('mousedown', (e) => {
  const p = toGlobal(e);
  lastMove = p;
  updateHover(p);
  if (!hovering) return;
  if (e.button === 2) {
    api.send('context-menu', p);
    return;
  }
  if (e.button !== 0) return;
  const pr = { x: p.x, y: p.y, t0: performance.now() };
  setIgnore(false);
  if (role === 'brain') press = pr;
  else {
    pendingPress = pr;
    api.send('claim');
  }
  api.send('armed'); // clicking Claude selects it for keyboard control
});

window.addEventListener('mouseup', (e) => {
  if (e.button !== 0) return;
  const p = toGlobal(e);
  if (press) {
    if (dragging) {
      if (role === 'brain') release(st);
    } else if (role === 'brain') {
      poke(st);
      const now = performance.now();
      if (now - lastPokeAt < 400) {
        api.send('open-chat');
        lastPokeAt = 0;
      } else {
        lastPokeAt = now;
      }
    }
  }
  press = null;
  pendingPress = null;
  dragging = false;
  document.body.classList.remove('grabbing');
  updateHover(p);
});

window.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  if (e.code !== 'F12') e.preventDefault();
  api.send('key', { code: e.code, down: true, repeat: e.repeat });
});
window.addEventListener('keyup', (e) => api.send('key', { code: e.code, down: false }));
window.addEventListener('blur', () => api.send('blurred'));

const JUMP_KEYS = new Set(['Space', 'KeyW', 'ArrowUp']);
const GAME_KEYS = new Set(['ArrowLeft', 'KeyA', 'ArrowRight', 'KeyD', 'ArrowUp', 'KeyW', 'ArrowDown', 'KeyS', 'ShiftLeft', 'ShiftRight', 'Space', 'KeyE', 'KeyF']);

function setControlMode(on) {
  if (!st) return;
  if (on === st.control.active) return;
  setControl(st, on);
  keys = emptyInput();
  if (on) {
    goto(st, 'controlled');
    if (hintsShown < 3) {
      hintsShown++;
      showHint(true);
    }
  } else {
    showHint(false);
    goto(st, 'idle');
  }
  api.send('control-changed', on);
}

function handleKey({ code, down, repeat }) {
  if (!st) return;
  if (down && !st.control.active) {
    if (!GAME_KEYS.has(code)) {
      if (code === 'Enter' || code === 'KeyT') api.send('open-chat');
      return;
    }
    setControlMode(true);
  }
  if (!st.control.active) return;
  st.control.lastInput = st.t;
  if (down && code === 'Escape') {
    setControlMode(false);
    api.send('release-focus');
    return;
  }
  if (down && (code === 'Enter' || code === 'KeyT')) {
    api.send('open-chat');
    return;
  }
  const held = new Set(keys.held || []);
  if (down) held.add(code);
  else held.delete(code);
  keys.held = [...held];
  // On the rope or hanging on a wall, W/Up climbs instead of jumping.
  const onRope = st.char.mode === 'rope' || st.char.mode === 'climb';
  keys.left = held.has('ArrowLeft') || held.has('KeyA');
  keys.right = held.has('ArrowRight') || held.has('KeyD');
  keys.up = held.has('ArrowUp') || held.has('KeyW');
  keys.down = held.has('ArrowDown') || held.has('KeyS');
  keys.run = held.has('ShiftLeft') || held.has('ShiftRight');
  // On the rope, W/Up climbs instead of letting go; Space always jumps/releases.
  keys.jump = held.has('Space') || (!onRope && keys.up);
  if (down && !repeat && JUMP_KEYS.has(code) && (code === 'Space' || !onRope)) keys.jumpPressed = true;
  if (down && !repeat && (code === 'KeyE' || code === 'KeyF')) {
    const r = st.char.rope.state;
    if (r === 'attached' || r === 'shooting') releaseRope(st, r === 'attached');
    else if (!fireRope(st, world, st.cursor.x, st.cursor.y)) {
      const cen = centerOf(st.char);
      fireRope(st, world, cen.x + st.char.facing * 260, cen.y - 380);
    }
  }
}

function showHint(on) {
  if (on) {
    hintEl.innerHTML = '<kbd>←</kbd><kbd>→</kbd> move · <kbd>Space</kbd> jump · jump into a window side to climb · <kbd>E</kbd> rope to cursor · <kbd>Esc</kbd> done';
    hintUntil = performance.now() + 6000;
    hintEl.classList.add('show');
  } else {
    hintEl.classList.remove('show');
    hintUntil = 0;
  }
}

function positionHint() {
  if (!hintUntil) return;
  if (performance.now() > hintUntil) return showHint(false);
  const c = st.char;
  const w = hintEl.offsetWidth;
  const x = Math.max(area.x + 8, Math.min(area.x + area.w - w - 8, c.x - w / 2));
  const y = Math.min(area.y + area.h - 40, c.y + 14);
  hintEl.style.transform = `translate(${Math.round(x - area.x)}px, ${Math.round(y - area.y)}px)`;
}

// ---- messages from the main process ---------------------------------------------------

api.on('world', (w) => {
  if (role === 'brain' && st) applyWorld(st, world, w);
  world = w;
});
api.on('become-brain', ({ state, keys: k }) => becomeBrain(state, k));
api.on('become-viewer', () => becomeViewer());
api.on('snapshot', (s) => {
  if (role !== 'viewer') return;
  snap = s;
  snapDirty = true;
});
api.on('request-handoff', ({ to }) => {
  if (role === 'brain' && st && to !== info.displayId) handoffTo(to);
});
api.on('evacuate', ({ to, side }) => {
  if (role !== 'brain' || !st) return;
  const r = world.regions.find((x) => x.id === to);
  if (!r) return;
  const c = st.char;
  const s = c.scale;
  c.x = side === 'left' ? r.x + 50 * s : side === 'right' ? r.x + r.w - 50 * s : r.x + r.w / 2;
  c.y = r.y + r.h;
  c.vx = side === 'left' ? 260 * s : side === 'right' ? -260 * s : 0;
  c.vy = 0;
  c.mode = 'ground';
  c.ground = { kind: 'floor' };
  c.held = null;
  if (c.rope.state !== 'none') c.rope.state = 'none';
  const cen = centerOf(c);
  burst(st, 'poof', cen.x, cen.y, 5, { sp0: 20, sp1: 80, max0: 0.4, max1: 0.6, size0: 12, size1: 18 });
  handoffTo(to);
});
// Messages meant for the brain that arrive here after a hand-off get re-routed.
function forBrain(ch, fn) {
  api.on(ch, (msg) => {
    const bounced = msg && typeof msg === 'object' && msg.__bounced;
    const data = bounced ? msg.data : msg;
    if (role === 'brain' && st) fn(data);
    else api.send('bounce', { ch: `ov:${ch}`, data, hops: (bounced ? msg.hops : 0) + 1 });
  });
}
forBrain('say', (m) => queueBubble(st.ui, st, m));
forBrain('hide-bubble', () => hideBubble(st.ui));
forBrain('do', (cmd) => st.commands.push(cmd));
api.on('cursor', (p) => {
  if (role !== 'brain' || !st) return;
  if (p.x !== st.cursor.x || p.y !== st.cursor.y) {
    st.cursor.x = p.x;
    st.cursor.y = p.y;
    st.cursor.t = st.t;
  }
});
forBrain('key', handleKey);
forBrain('control', (on) => setControlMode(!!on));
api.on('audio', (a) => {
  if (role !== 'brain' || !st || !st.settings.audio) return;
  const au = st.audio;
  au.energy = a.energy;
  if (a.bpm > 0) {
    au.bpm = a.bpm;
    if (a.phase != null) {
      const cur = au.phase ?? a.phase;
      let d = a.phase - cur;
      d -= Math.round(d);
      au.phase = cur + d * 0.25;
    }
  }
  const wasMusic = au.music;
  au.music = !!a.music;
  if (a.music) au.lastMusic = st.t;
  if (a.music && !wasMusic) au.musicSince = st.t;
  if (a.beat) onBeat(st, a.beatStrength ?? 0.5);
  if (a.loud) onLoud(st);
});
api.on('settings', (s) => {
  settings = s;
  if (st) {
    st.settings = { ...st.settings, ...simSettings(s) };
    if (s.scale && Math.abs(st.char.scale - s.scale) > 0.001) st.char.scale = s.scale;
  }
});
// ---- boot ---------------------------------------------------------------------------

const init = await api.invoke('ready');
info = init;
area = init.area;
world = init.world;
settings = init.settings;
setupCanvases();
if (init.isBrain) becomeBrain(null);
requestAnimationFrame(frame);

// Lets the main process carry Claude over when monitors are added/removed.
window.__claudeState = () => (role === 'brain' && st ? st : null);

if (init.harness) {
  // Test-harness handle, read via webContents.executeJavaScript (harness mode only).
  window.__claude = {
    get st() {
      return st;
    },
    get role() {
      return role;
    },
    get world() {
      return world;
    },
    get keys() {
      return keys;
    },
    info,
    grab,
    moveHeld,
    release,
    fireRope,
    poke,
    goto,
    centerOf,
    handleKey,
    setControlMode,
  };
}
