// Secondary animation: squash & stretch, blinking, eye tracking, the springy
// antenna, walk cycle, and temporary facial expressions. Stored in st.anim so
// it survives a hand-off between monitor windows.
import { CENTER_Y } from './constants.js';
import { clamp, damp, rand, randRange, TAU } from './util.js';
import { headRise } from '../look.js';
import { bodyOf, hasLegs } from '../bodies.js';
import { bodyMotion, gaitOf, hopPhase, idleHop, idleOf, jiggleOf } from '../motion.js';
import { spawn } from './particles.js';

export function newAnim() {
  return {
    blinkT: 2,
    blink: 0,
    walkPhase: 0,
    squash: 0,
    squashV: 0,
    lookX: 0,
    lookY: 0,
    lookTX: 0,
    lookTY: 0,
    glanceT: 0,
    face: { eyes: 'normal', mouth: 'smile', brows: null, blush: 0.35 },
    faceUntil: 0,
    tempFace: null,
    pose: 'stand',
    poseT: 0,
    antX: 0,
    antY: 0,
    antVX: 0,
    antVY: 0,
    antInit: false,
    glow: 0,
    talk: 0,
    carry: null,
    carryUntil: 0,
    dizzyUntil: 0,
    beatPulse: 0,
    danceMove: 'bop',
    danceBeat: 0,
    breath: 0,
    ring: 0,
    roll: 0, // "Roll" walk style: how far it has tumbled (radians)
    hopN: 0, // hop count, to squish on each landing
    stepN: 0, // footstep count, to jiggle on each step
    trailD: 0, // distance moved since the last trail particle
  };
}

/** Squash impulse: negative flattens, positive stretches. Jiggly bodies wobble more. */
export function kick(st, amount) {
  st.anim.squashV += amount * (0.55 + 0.9 * jiggleOf(st));
}

/** Show an expression for `dur` seconds (then fall back to the mood face). */
export function express(st, face, dur = 1.2) {
  st.anim.tempFace = { eyes: 'normal', mouth: 'smile', brows: null, blush: 0.35, ...face };
  st.anim.faceUntil = st.t + dur;
}

export function currentFace(st) {
  const a = st.anim;
  if (a.tempFace && st.t < a.faceUntil) return a.tempFace;
  return a.face;
}

export function stepAnim(st, dt) {
  const a = st.anim;
  const c = st.char;
  const s = c.scale;
  a.poseT += dt;
  a.breath += dt;

  // Squash spring (underdamped = jelly). "Jiggle" goes from firm to wobbly.
  const k = 260;
  const d = 13 * 2 ** (1 - 2 * jiggleOf(st));
  a.squashV += (-k * a.squash - d * a.squashV) * dt;
  a.squash = clamp(a.squash + a.squashV * dt, -0.45, 0.45);

  // Blink.
  a.blinkT -= dt;
  if (a.blinkT <= 0) {
    a.blink = 1;
    a.blinkT = rand(st) < 0.18 ? 0.22 : randRange(st, 2.2, 5.5);
  }
  a.blink = Math.max(0, a.blink - dt * 8);

  // Walk cycle phase follows actual ground speed.
  if (c.mode === 'ground') a.walkPhase += (Math.abs(c.vx) / (26 * s)) * dt * Math.PI;
  stepMotion(st, dt);

  // Eyes: look at the cursor if it's close and recent, otherwise glance around.
  const cx = c.x;
  const cy = c.y - CENTER_Y * s;
  const cur = st.cursor;
  const cd = Math.hypot(cur.x - cx, cur.y - cy);
  const asleep = a.pose === 'sleep';
  if (!asleep && cd < 900 * s && st.t - cur.t < 6) {
    a.lookTX = clamp((cur.x - cx) / (220 * s), -1, 1);
    a.lookTY = clamp((cur.y - cy) / (260 * s), -1, 1);
  } else {
    a.glanceT -= dt;
    if (a.glanceT <= 0) {
      a.glanceT = randRange(st, 0.8, 3);
      a.lookTX = rand(st) < 0.35 ? 0 : randRange(st, -1, 1);
      a.lookTY = randRange(st, -0.5, 0.4);
    }
    if (c.mode === 'ground' && Math.abs(c.vx) > 40 * s) {
      a.lookTX = Math.sign(c.vx) * 0.8;
      a.lookTY = 0.1;
    }
  }
  a.lookX = damp(a.lookX, a.lookTX, 18, dt);
  a.lookY = damp(a.lookY, a.lookTY, 18, dt);

  // Antenna tip: spring toward its rest point on top of the head (or hat), following
  // the body when it hops, hovers or rolls.
  const bm = bodyMotion(st);
  const up = headRise(st.look);
  const rot = c.rot + bm.roll;
  const rx = cx + Math.sin(rot) * up * s;
  const ry = cy + (sitDrop(st) - bm.lift) * s - Math.cos(rot) * up * s;
  if (!a.antInit) {
    a.antX = rx;
    a.antY = ry;
    a.antInit = true;
  }
  const ks = 170;
  const kd = 9;
  if (a.roll) {
    // Rolling: the antenna turns with the body instead of whipping around.
    a.antX = rx;
    a.antY = ry;
    a.antVX = 0;
    a.antVY = 0;
  }
  a.antVX += (ks * (rx - a.antX) - kd * a.antVX) * dt;
  a.antVY += (ks * (ry - a.antY) - kd * a.antVY) * dt;
  a.antX += a.antVX * dt;
  a.antY += a.antVY * dt;
  // Keep the tip within a sane distance (fast throws).
  const ddx = a.antX - rx;
  const ddy = a.antY - ry;
  const dd = Math.hypot(ddx, ddy);
  const maxD = 14 * s;
  if (dd > maxD) {
    a.antX = rx + (ddx / dd) * maxD;
    a.antY = ry + (ddy / dd) * maxD;
  }

  const wantGlow = st.flags.thinking || st.flags.listening ? 1 : a.pose === 'dance' ? 0.35 + a.beatPulse * 0.65 : 0;
  a.glow = damp(a.glow, wantGlow, 6, dt);
  a.beatPulse = Math.max(0, a.beatPulse - dt * 4);
  a.talk = Math.max(0, a.talk - dt);
  if (a.carry && st.t > a.carryUntil) a.carry = null;
  a.ring = damp(a.ring, st.control.active ? 1 : 0, 8, dt);
}

const DROPS = { sit: 12, sleep: 12, watch: 12, work: 12, crouch: 7 };

/** How far sitting (or crouching) lowers the body, so the antenna comes down with it. */
function sitDrop(st) {
  const drop = DROPS[st.anim.pose] ?? 0;
  if (!drop || st.char.mode !== 'ground') return 0;
  return hasLegs(st.look) ? drop : Math.min(drop, Math.max(0, CENTER_Y - bodyOf(st.look).bottom));
}

/** Walk-style extras: rolling, squishy hop landings, jiggly footsteps, and trails. */
function stepMotion(st, dt) {
  const a = st.anim;
  const c = st.char;
  const s = c.scale;
  const gait = gaitOf(st);
  const walking = c.mode === 'ground' && a.pose === 'walk';
  // Roll: turn like a wheel while moving; settle upright (nearest full turn) when it stops.
  if (walking && gait === 'roll') {
    a.roll += (c.vx * dt) / (Math.max(18, bodyOf(st.look).hw) * s);
  } else if (a.roll) {
    const upright = Math.round(a.roll / TAU) * TAU;
    a.roll = damp(a.roll, upright, 9, dt);
    if (Math.abs(a.roll - upright) < 0.01) a.roll = 0;
  }
  // Hops squish on landing; jiggly bodies wobble with every step.
  if (walking && gait === 'hop') {
    const n = Math.floor(hopPhase(a.walkPhase) / Math.PI);
    if (n !== a.hopN) kick(st, -0.16);
    a.hopN = n;
  } else if (walking) {
    const n = Math.floor(a.walkPhase / Math.PI);
    if (n !== a.stepN && jiggleOf(st) > 0.55) kick(st, -0.05 * (jiggleOf(st) - 0.5) * 2);
    a.stepN = n;
  }
  if (c.mode === 'ground' && a.pose === 'stand' && idleOf(st) === 'bounce') {
    const was = idleHop(st.t - dt) > 0;
    if (was && idleHop(st.t) === 0) kick(st, -0.12);
  }
  // Trail: a particle every so often while it's on the move.
  const trail = st.motion?.trail ?? 'none';
  const speed = Math.hypot(c.vx, c.vy);
  if (trail !== 'none' && c.mode !== 'held' && speed > 60 * s) {
    a.trailD += speed * dt;
    const every = (trail === 'rainbow' ? 7 : 15) * s;
    let n = 0;
    while (a.trailD >= every && n++ < 4) {
      a.trailD -= every;
      spawnTrail(st, trail);
    }
  } else {
    a.trailD = Math.min(a.trailD, 10 * s);
  }
}

function spawnTrail(st, trail) {
  const c = st.char;
  const s = c.scale;
  const back = -Math.sign(c.vx || c.facing);
  const x = c.x + back * randRange(st, 6, 16) * s;
  const y = c.y - randRange(st, 12, CENTER_Y + 8) * s;
  const drift = { vx: back * randRange(st, 10, 40) * s, vy: -randRange(st, 10, 50) * s };
  switch (trail) {
    case 'sparkles':
      spawn(st, 'spark', x, y, { ...drift, max: randRange(st, 0.35, 0.7), size: randRange(st, 4, 7.5), rotV: randRange(st, -6, 6) });
      break;
    case 'hearts':
      spawn(st, 'heart', x, y, { ...drift, vy: -randRange(st, 30, 70) * s, max: randRange(st, 0.6, 1), size: randRange(st, 4, 6), wobble: 20 * s });
      break;
    case 'bubbles':
      spawn(st, 'bubble', x, y, { ...drift, vy: -randRange(st, 40, 90) * s, max: randRange(st, 0.8, 1.4), size: randRange(st, 3, 6.5), wobble: 26 * s });
      break;
    case 'notes':
      spawn(st, 'note', x, y, { ...drift, vy: -randRange(st, 30, 70) * s, max: randRange(st, 0.7, 1.1), size: randRange(st, 7, 10), hue: randRange(st, 0, 360), wobble: 14 * s });
      break;
    case 'stars':
      spawn(st, 'star', x, y, { ...drift, g: 260 * s, vy: -randRange(st, 60, 140) * s, max: randRange(st, 0.5, 0.9), size: randRange(st, 3.5, 6), rotV: randRange(st, -9, 9) });
      break;
    case 'rainbow':
      spawn(st, 'dot', c.x + back * 4 * s, c.y - (CENTER_Y - 4) * s, { max: 0.75, size: 4.5, hue: (st.t * 420) % 360 });
      break;
    default:
      break;
  }
}

export function setPose(st, pose) {
  if (st.anim.pose !== pose) {
    st.anim.pose = pose;
    st.anim.poseT = 0;
  }
}

/** Derive the pose name from physics when the behavior doesn't dictate one. */
export function physicalPose(c) {
  if (c.mode === 'held') return 'held';
  if (c.mode === 'rope') return 'rope';
  if (c.mode === 'climb') return 'climb';
  if (c.mode === 'air') return c.wallDir !== 0 && c.vy > 0 ? 'wallslide' : 'air';
  return Math.abs(c.vx) > 12 * c.scale ? 'walk' : 'stand';
}

export const dizzy = (st) => st.t < st.anim.dizzyUntil;
export { TAU };
