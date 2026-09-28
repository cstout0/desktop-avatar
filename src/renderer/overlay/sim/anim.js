// Secondary animation: squash & stretch, blinking, eye tracking, the springy
// antenna, walk cycle, and temporary facial expressions. Stored in st.anim so
// it survives a hand-off between monitor windows.
import { BODY, CENTER_Y } from './constants.js';
import { clamp, damp, rand, randRange, TAU } from './util.js';

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
  };
}

/** Squash impulse: negative flattens, positive stretches. */
export function kick(st, amount) {
  st.anim.squashV += amount;
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

  // Squash spring (underdamped = jelly).
  const k = 260;
  const d = 13;
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

  // Antenna tip: spring toward its rest point on top of the head.
  const up = BODY.h / 2 + BODY.antenna;
  const rx = cx + Math.sin(c.rot) * up * s;
  const ry = cy - Math.cos(c.rot) * up * s;
  if (!a.antInit) {
    a.antX = rx;
    a.antY = ry;
    a.antInit = true;
  }
  const ks = 170;
  const kd = 9;
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
