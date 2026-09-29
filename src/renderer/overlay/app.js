// Overlay runtime: one of these runs in each monitor's transparent window.
// The window whose monitor the character is on is the "brain": it runs the simulation.
// Neighbouring windows are "viewers" that draw snapshots while the character straddles
// the bezel. Walking across hands the whole (plain-object) state to the next one.
import { createState, step, applyWorld, setControl, emptyInput } from './sim/index.js';
import { centerOf, fireRope, grab, moveHeld, release, releaseRope } from './sim/physics.js';
import { onBeat, onLoud, poke, goto } from './sim/behavior.js';
import { burst } from './sim/particles.js';
import { CENTER_Y } from './sim/constants.js';
import { nearestRegion, regionAt } from './sim/world.js';
import { bounds, drawCharacter, drawRope, hitTest } from './render/character.js';
import { drawParticles, particleBounds } from './render/effects.js';
import { BubbleView, hideBubble, newBubbleState, queueBubble } from './render/bubble.js';
import { drawBall, drawFocusBadge, drawToyWin, toyAt } from './render/props.js';
import { throwVelocity } from './sim/toys.js';
import { normalizeLook } from './look.js';
import { normalizeMotion } from './motion.js';

const api = window.overlay;
// The character is drawn on its own canvas that follows it around. It grows
// for big sizes (up to 500%) so tall hats and raised arms never get clipped.
let charSize = 720;
const charSizeFor = (scale) => Math.max(720, Math.ceil((90 * scale + 80) * 2));
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
    name: s.name || '',
    audio: s.audioReactions !== false,
    walkOnWindows: s.walkOnWindows !== false,
    sleepAfter: s.sleepAfter ?? 240,
    chattiness: s.chattiness ?? 'normal',
  };
}

function sizeCharCanvas(scale) {
  const size = charSizeFor(scale);
  if (size === charSize && charCanvas.width === Math.round(size * dpr)) return;
  charSize = size;
  charCanvas.width = Math.round(size * dpr);
  charCanvas.height = Math.round(size * dpr);
  charCanvas.style.width = `${size}px`;
  charCanvas.style.height = `${size}px`;
}

function setupCanvases() {
  charSize = 0;
  sizeCharCanvas(settings.scale ?? 1.4);
  fxCanvas.width = Math.round(area.w * dpr);
  fxCanvas.height = Math.round(area.h * dpr);
  fxCanvas.style.width = `${area.w}px`;
  fxCanvas.style.height = `${area.h}px`;
}

function spawnState(fromTop = true) {
  const x = area.x + area.w * (0.3 + Math.random() * 0.4);
  const scale = settings.scale ?? 1.4;
  // Physics scales with size, so a speck-sized buddy would take ages to fall: start it on the floor.
  const top = fromTop && scale >= 0.3;
  const s = createState({ x, y: top ? area.y + 40 : area.y + area.h, scale, settings: simSettings(settings) });
  s.ui = { bubble: newBubbleState() };
  s.look = normalizeLook(settings.look);
  s.motion = normalizeMotion(settings.motion);
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
  sizeCharCanvas(c.scale);
  const ox = Math.round(cx - charSize / 2);
  const oy = Math.round(cy - charSize / 2);
  charCanvas.style.transform = `translate(${ox - area.x}px, ${oy - area.y}px)`;
  cctx.setTransform(dpr, 0, 0, dpr, -ox * dpr, -oy * dpr);
  cctx.clearRect(ox, oy, charSize, charSize);
  // Hide and seek: the overlay sits on top of every window, so "behind a window"
  // means cutting that window's rectangle out of the drawing.
  const clip = hidingClip(s);
  if (clip) {
    cctx.save();
    cctx.beginPath();
    cctx.rect(ox, oy, charSize, charSize);
    cctx.rect(clip.x1, clip.y1, clip.x2 - clip.x1, clip.y2 - clip.y1);
    cctx.clip('evenodd');
  }
  drawCharacter(cctx, s);
  if (clip) cctx.restore();
  else drawFocusBadge(cctx, s);
  if (s.ball?.carried) drawBall(cctx, s.ball); // in its hand, in front of the body
  // Rope, loose ball and particles go on the full-screen layer (behind the character):
  // particles left behind while it runs would get cut off by the small character canvas.
  const ropeOn = c.rope.state !== 'none';
  const loose = s.ball && !s.ball.carried;
  const sparks = s.particles.length > 0;
  const toys = s.toys?.length > 0;
  if (ropeOn || loose || sparks || toys || fxDirty) {
    fctx.setTransform(dpr, 0, 0, dpr, -area.x * dpr, -area.y * dpr);
    fctx.clearRect(area.x, area.y, area.w, area.h);
    if (ropeOn) drawRope(fctx, s);
    if (toys) for (const t of s.toys) drawToyWin(fctx, t, s.t);
    if (loose) drawBall(fctx, s.ball);
    if (sparks) drawParticles(fctx, s.particles, c.scale);
    fxDirty = ropeOn || !!loose || sparks || toys;
  }
  drewSomething = true;
}

const hidingClip = (s) => (s?.game?.kind === 'hide' && s.char.mode === 'hidden' ? s.game.clip : null);
const inRect = (p, r) => p.x >= r.x1 && p.x <= r.x2 && p.y >= r.y1 && p.y <= r.y2;

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
  // Pop-up windows and a trail that drift onto the next monitor are drawn there too.
  for (const t of s.toys ?? []) {
    b.x1 = Math.min(b.x1, t.x - t.w);
    b.x2 = Math.max(b.x2, t.x + t.w);
    b.y1 = Math.min(b.y1, t.y - t.w);
    b.y2 = Math.max(b.y2, t.y + t.w);
  }
  const p = particleBounds(s.particles);
  if (p) {
    b.x1 = Math.min(b.x1, p.x1);
    b.x2 = Math.max(b.x2, p.x2);
    b.y1 = Math.min(b.y1, p.y1);
    b.y2 = Math.max(b.y2, p.y2);
  }
  return b;
}

const intersects = (b, a) => b.x2 >= a.x && b.x1 <= a.x + a.w && b.y2 >= a.y && b.y1 <= a.y + a.h;

// ---- brain ----------------------------------------------------------------------

function packSnapshot(s) {
  const game = s.game && { kind: s.game.kind, phase: s.game.phase, clip: s.game.clip ?? null };
  return { char: s.char, anim: s.anim, particles: s.particles, t: s.t, flags: s.flags, audio: s.audio, groundY: s.groundY, control: s.control, look: s.look, motion: s.motion, focus: s.focus, ball: s.ball, toys: s.toys, game };
}

function shareWithNeighbors() {
  const b = visualBounds(st);
  const ball = st.ball;
  const others = world.regions.some((r) => r.id !== info.displayId && (intersects(b, r) || (ball && ball.x >= r.x && ball.x <= r.x + r.w && ball.y >= r.y && ball.y <= r.y + r.h)));
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
  // (Holding the ball on this screen keeps the brain here until you let go.)
  if (c.mode === 'held' || handingOff || ballGrab) return;
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
  if (ballGrab) throwBall(); // let go of the ball before handing the character over
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
  st.look = normalizeLook(settings.look);
  st.motion = normalizeMotion(settings.motion);
  if (pendingPress && !dragging && performance.now() - pendingPress.t0 < 1500) press = pendingPress;
  pendingPress = null;
  if (pendingBall && performance.now() - pendingBall.t0 < 1500 && st.ball && !st.ball.carried) grabBall(lastMove);
  pendingBall = null;
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
    while (st.say.length) {
      const m = st.say.shift();
      queueBubble(st.ui, st, m);
      api.send('said', m.text); // its own chatter; spoken aloud if "always" is on
    }
    while (st.gameEvents?.length) api.send('game', st.gameEvents.shift());
    st.groundY = groundBelow(st);
    if (bubble.update(st, st.ui, dt, area, area)) st.anim.talk = 0.12;
    if (now < speakingUntil) st.anim.talk = 0.12; // mouth moves while the voice plays
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
let hoverBall = false;
let hoverToy = null; // a boxing pop-up under the cursor (click to punch it)
let ballGrab = null; // { samples: [{ t, x, y }] } while you're holding the fetch ball
let pendingBall = null; // grabbed the ball on a screen the character isn't on: waiting to take over
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
  // While hiding, only the part peeking out from behind the window is clickable.
  const clip = hidingClip(s);
  const onChar = !!s && hitTest(s, p.x, p.y) && !(clip && inRect(p, clip));
  const onBubble = role === 'brain' && bubble.hitTest(p.x, p.y);
  const ball = s?.ball;
  hoverBall = !!ball && !ball.carried && Math.hypot(p.x - ball.x, p.y - ball.y) <= ball.r + 10;
  hoverToy = role === 'brain' ? toyAt(st?.toys, p.x, p.y) : null;
  hovering = onChar;
  setIgnore(!(onChar || onBubble || hoverBall || hoverToy || dragging || press || ballGrab || pendingBall));
  document.body.classList.toggle('grab', (onChar || hoverBall || !!hoverToy) && !dragging && !ballGrab);
}

function grabBall(p) {
  const ball = st.ball;
  ball.held = true;
  ball.resting = false;
  ball.tx = p.x;
  ball.ty = p.y;
  ballGrab = { samples: [{ t: performance.now() / 1000, x: p.x, y: p.y }] };
  if (st.game?.kind === 'fetch') Object.assign(st.game, { phase: 'wait', retrieve: false });
  setIgnore(false);
  document.body.classList.add('grabbing');
}

function throwBall() {
  const ball = st?.ball;
  if (ball) {
    const v = throwVelocity(ballGrab.samples, performance.now() / 1000);
    ball.held = false;
    ball.vx = v.vx;
    ball.vy = v.vy;
    const g = st.game;
    if (g?.kind === 'fetch') Object.assign(g, { phase: 'chase', retrieve: false, thrownAt: st.t, lastThrow: st.t });
  }
  ballGrab = null;
  document.body.classList.remove('grabbing');
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
  if (ballGrab && st?.ball) {
    st.ball.tx = p.x;
    st.ball.ty = p.y;
    ballGrab.samples.push({ t: performance.now() / 1000, x: p.x, y: p.y });
    if (ballGrab.samples.length > 12) ballGrab.samples.shift();
    return;
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
  if (hoverToy && e.button === 0 && !hovering && !hoverBall) {
    // Punch the pop-up yourself!
    st.commands.push({ name: 'toy-hit', id: hoverToy.id, x: p.x });
    return;
  }
  if (hoverBall && e.button === 0 && !hovering) {
    if (role === 'brain') grabBall(p);
    else {
      // The ball is on this screen but the character is on another: take over, then grab it.
      pendingBall = { t0: performance.now() };
      setIgnore(false);
      api.send('claim');
    }
    return;
  }
  if (!hovering) return;
  if (e.button === 2) {
    api.send('context-menu', p);
    return;
  }
  if (e.button !== 0) return;
  // Hide and seek: clicking the bit that peeks out means you found it!
  if (role === 'brain' && st.game?.kind === 'hide' && st.char.mode === 'hidden') {
    st.commands.push({ name: 'found' });
    return;
  }
  const pr = { x: p.x, y: p.y, t0: performance.now() };
  setIgnore(false);
  if (role === 'brain') press = pr;
  else {
    pendingPress = pr;
    api.send('claim');
  }
  api.send('armed'); // clicking the character selects it for keyboard control
});

window.addEventListener('mouseup', (e) => {
  if (e.button !== 0) return;
  const p = toGlobal(e);
  pendingBall = null;
  if (ballGrab) {
    throwBall();
    updateHover(p);
    return;
  }
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
forBrain('focus', (f) => {
  st.focus = f?.phase && f.phase !== 'idle' ? f : null;
});
let speakingUntil = 0;
forBrain('speaking', ({ on, ms, level }) => {
  if (!on) speakingUntil = 0;
  else if (level != null) speakingUntil = Math.max(speakingUntil, performance.now() + 250);
  else speakingUntil = performance.now() + (ms ?? 30000); // until the "end" arrives
});
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
    st.look = normalizeLook(s.look);
    st.motion = normalizeMotion(s.motion);
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

// Lets the main process carry the character over when monitors are added/removed.
window.__avatarState = () => (role === 'brain' && st ? st : null);

if (init.harness) {
  // Test-harness handle, read via webContents.executeJavaScript (harness mode only).
  window.__avatar = {
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
