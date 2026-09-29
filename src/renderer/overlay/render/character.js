// Procedural vector art for the character. Everything is computed from the sim state
// every frame (no sprite sheets), so poses blend smoothly with the physics.
import { BODY, CENTER_Y, PHYS } from '../sim/constants.js';
import { currentFace } from '../sim/anim.js';
import { clamp, TAU } from '../sim/util.js';
import { DEFAULT_LOOK, hatLift, headRise, paletteFor } from '../look.js';
import { bodyOf, hasLegs } from '../bodies.js';
import { bodyMotion, gaitOf, hopUp, idleHop, idleOf } from '../motion.js';
import { armBack, armFront, footOnly, leg } from './limbs.js';
import { drawGlasses, drawHat, drawNeck } from './outfit.js';

// Body/face colors are swapped in from the character's look before each draw.
export const COLORS = {
  body: '#E27A52',
  bodyLight: '#F59E76',
  bodyDark: '#C35A3A',
  belly: '#FAD2B8',
  outline: '#4A2317',
  eye: '#2A140F',
  blush: 'rgba(255, 112, 104, 0.55)',
  mouth: '#5E2217',
  tongue: '#F27C7C',
  tip: '#FFD46E',
  tipGlow: 'rgba(255, 200, 90, ',
  folder: '#F5C04E',
  folderDark: '#D99A2B',
};

const OUT = 2.6; // outline width at scale 1

/** Compute limb targets (body-local, origin at the body center) for the pose. */
export function rigFor(st) {
  const c = st.char;
  const a = st.anim;
  const t = st.t;
  const s = c.scale;
  const f = c.facing;
  const shape = bodyOf(st.look);
  const [shX, shY] = shape.shoulder;
  const r = {
    bodyDX: 0,
    bodyDY: 0,
    bodyRot: 0,
    sx: 1,
    sy: 1,
    lh: { x: -(shX + 6), y: shY + 9 },
    rh: { x: shX + 6, y: shY + 9 },
    lf: { x: -9, y: CENTER_Y },
    rf: { x: 9, y: CENTER_Y },
    lLift: 0,
    rLift: 0,
    lBend: -5,
    rBend: 5,
    legBendL: 0,
    legBendR: 0,
    faceDX: 0,
    faceDY: 0,
    lookOverride: null,
    item: null,
    grip: false,
  };
  const breath = Math.sin(a.breath * 2.1);
  const pose = a.pose;
  const k = clamp(Math.abs(c.vx) / (PHYS.walk * s), 0, 1.7);

  switch (pose) {
    case 'stand':
    case 'crouch': {
      if (pose === 'stand') idleRig(r, st, idleOf(st), breath);
      else {
        r.bodyDY = breath * 0.7;
        r.lh.y += breath * 0.8;
        r.rh.y += breath * 0.8;
      }
      if (pose === 'crouch') {
        r.bodyDY += 7;
        r.sx = 1.08;
        r.sy = 0.88;
        r.lh = { x: -26, y: 22 };
        r.rh = { x: 26, y: 22 };
      }
      break;
    }
    case 'walk':
      walkRig(r, st, gaitOf(st), a.walkPhase, k, f, t);
      break;
    case 'air': {
      if (c.tumble) {
        r.lh = { x: -33, y: -2 + Math.sin(t * 22) * 4 };
        r.rh = { x: 33, y: -2 + Math.cos(t * 19) * 4 };
        r.lf = { x: -13, y: CENTER_Y - 2 };
        r.rf = { x: 13, y: CENTER_Y - 2 };
      } else if (c.vy < -80 * s) {
        r.lh = { x: -24, y: -15 };
        r.rh = { x: 24, y: -15 };
        r.lf = { x: -8, y: CENTER_Y - 7 };
        r.rf = { x: 9, y: CENTER_Y - 4 };
      } else {
        const fall = clamp(c.vy / (1400 * s), 0, 1);
        r.lh = { x: -29 - fall * 3, y: -6 - fall * 10 + Math.sin(t * 24) * 4 * fall };
        r.rh = { x: 29 + fall * 3, y: -6 - fall * 10 + Math.cos(t * 21) * 4 * fall };
        r.lf = { x: -8, y: CENTER_Y + 1 };
        r.rf = { x: 8, y: CENTER_Y };
      }
      break;
    }
    case 'watch': {
      // Sitting with popcorn, eyes on the video; every few seconds a handful goes to the mouth.
      r.bodyDY = 12 + breath * 0.5;
      r.lf = { x: -12, y: CENTER_Y + 1 };
      r.rf = { x: 12, y: CENTER_Y + 1 };
      r.feetFront = true;
      r.lap = 'popcorn';
      const cyc = (t % 5.3) / 5.3;
      const munch = cyc < 0.22 ? Math.sin((cyc / 0.22) * Math.PI) : 0;
      const holdHand = { x: -9 * f, y: 21 };
      const eatHand = { x: (11 - munch * 8) * f, y: 17 - munch * 12 };
      if (f >= 0) {
        r.lh = holdHand;
        r.rh = eatHand;
      } else {
        r.rh = holdHand;
        r.lh = eatHand;
      }
      const at = a.watchAt;
      if (at) {
        const cy = c.y - CENTER_Y * s;
        r.lookOverride = { x: clamp((at.x - c.x) / (320 * s), -1, 1), y: clamp((at.y - cy) / (320 * s), -1, 1) };
      }
      break;
    }
    case 'covereyes': {
      // Hide and seek: hands over its eyes while you "count".
      r.lh = { x: -11, y: -5 };
      r.rh = { x: 11, y: -5 };
      r.lBend = 6;
      r.rBend = -6;
      r.bodyDY = Math.abs(Math.sin(t * 7)) * -1.2;
      break;
    }
    case 'hiding': {
      // Leaning out from behind a window edge, gripping it, eyes wide.
      r.bodyRot = f * 0.26;
      r.bodyDX = f * 2;
      r.lookOverride = { x: f, y: Math.sin(t * 0.9) * 0.4 };
      const grip = { x: 18 * f, y: -12 + Math.sin(t * 1.3) * 1.5 };
      const low = { x: 22 * f, y: 10 };
      if (f > 0) {
        r.rh = grip;
        r.lh = low;
      } else {
        r.lh = grip;
        r.rh = low;
      }
      break;
    }
    case 'work': {
      // Focus session: sitting with a laptop on its lap, typing, eyes on the screen.
      r.bodyDY = 12 + breath * 0.5;
      r.lf = { x: -12, y: CENTER_Y + 1 };
      r.rf = { x: 12, y: CENTER_Y + 1 };
      r.feetFront = true;
      r.lap = 'laptop';
      const tap = (k) => Math.max(0, Math.sin(t * 13 + k)) * 2.4;
      r.lh = { x: -14, y: 15 - tap(0) };
      r.rh = { x: 14, y: 15 - tap(2.2) };
      r.lBend = 5;
      r.rBend = -5;
      if (t % 9 > 1.2) r.lookOverride = { x: 0.1 * f, y: 0.8 }; // glances up now and then
      break;
    }
    case 'climb': {
      // Near hand grips the edge, far hand reaches up; feet push against it.
      const ph = c.climb?.phase ?? 0;
      const sw = Math.sin(ph * Math.PI);
      const idle = Math.sin(t * 2) * 1.2;
      r.bodyRot = f * 0.1;
      r.bodyDX = f * 3;
      const near = { x: 25 * f, y: -8 - sw * 10 + idle };
      const far = { x: 8 * f, y: -31 + sw * 10 - idle };
      const nearFoot = { x: 17 * f, y: CENTER_Y - 10 + sw * 6 };
      const farFoot = { x: 5 * f, y: CENTER_Y - 2 - sw * 6 };
      if (f > 0) {
        r.rh = near;
        r.lh = far;
        r.rf = nearFoot;
        r.lf = farFoot;
        r.lBend = -9;
      } else {
        r.lh = near;
        r.rh = far;
        r.lf = nearFoot;
        r.rf = farFoot;
        r.rBend = 9;
      }
      r.lookOverride = { x: 0.45 * f, y: -0.85 };
      break;
    }
    case 'wallslide': {
      const w = c.wallDir;
      r.bodyRot = -w * 0.08;
      r.lh = w < 0 ? { x: -30, y: -10 } : { x: -24, y: 16 };
      r.rh = w > 0 ? { x: 30, y: -10 } : { x: 24, y: 16 };
      r.lf = { x: -9 + w * 3, y: CENTER_Y - (w < 0 ? 8 : 0) };
      r.rf = { x: 9 + w * 3, y: CENTER_Y - (w > 0 ? 8 : 0) };
      break;
    }
    case 'held': {
      const kickL = Math.sin(t * 13) * 4;
      const kickR = Math.sin(t * 13 + 2) * 4;
      const dx = Math.sin(c.rot);
      const dy = Math.cos(c.rot);
      r.lf = { x: -8 + dx * 16 + kickL, y: 16 + dy * 18 };
      r.rf = { x: 8 + dx * 16 + kickR, y: 16 + dy * 18 };
      r.lh = { x: -31, y: -12 + Math.sin(t * 17) * 5 };
      r.rh = { x: 31, y: -12 + Math.cos(t * 15) * 5 };
      break;
    }
    case 'rope': {
      const cos = Math.cos(c.rot);
      const sin = Math.sin(c.rot);
      const vLocal = c.vx * cos + c.vy * sin;
      const trail = -clamp(vLocal / (900 * s), -1, 1) * 11;
      r.lh = { x: -3, y: shape.top - 9 };
      r.rh = { x: 3, y: shape.top - 13 };
      r.lBend = -9;
      r.rBend = 9;
      r.lf = { x: -7 + trail, y: CENTER_Y + 1 };
      r.rf = { x: 7 + trail * 1.2, y: CENTER_Y - 2 };
      r.grip = true;
      break;
    }
    case 'sit':
    case 'sleep': {
      r.bodyDY = 12;
      r.lf = { x: -12, y: CENTER_Y + 1 };
      r.rf = { x: 12, y: CENTER_Y + 1 };
      r.feetFront = true;
      r.lh = { x: -27, y: 22 };
      r.rh = { x: 27, y: 22 };
      if (pose === 'sleep') {
        const b = Math.sin(a.breath * 1.3);
        r.sy = 1 + b * 0.03;
        r.sx = 1 - b * 0.02;
        r.bodyRot = 0.16 * f + Math.sin(a.breath * 0.4) * 0.03;
        r.faceDY = 2;
      } else {
        r.bodyDY += breath * 0.6;
      }
      break;
    }
    case 'dance': {
      const bpm = st.audio.bpm > 60 ? st.audio.bpm : 118;
      const phase = st.audio.bpm > 60 ? st.audio.phase ?? (t * bpm) / 60 : (t * bpm) / 60;
      const beat = phase % 1;
      const n = Math.floor(phase);
      const pulse = Math.exp(-beat * 6);
      const move = a.danceMove;
      if (move === 'bop') {
        r.bodyDY = 3.5 * pulse;
        r.sy = 1 - 0.06 * pulse;
        r.sx = 1 + 0.05 * pulse;
        r.lh = { x: -25, y: 4 - 9 * pulse };
        r.rh = { x: 25, y: 4 - 9 * pulse };
        r.bodyRot = Math.sin(phase * Math.PI) * 0.06;
      } else if (move === 'side') {
        const side = n % 2 ? 1 : -1;
        r.bodyDX = side * 5 * (1 - pulse * 0.4);
        r.bodyRot = side * 0.1;
        r.lf = { x: -9 + side * 3, y: CENTER_Y - (side < 0 ? 5 * pulse : 0) };
        r.rf = { x: 9 + side * 3, y: CENTER_Y - (side > 0 ? 5 * pulse : 0) };
        r.lh = { x: -27, y: 8 + side * 8 };
        r.rh = { x: 27, y: 8 - side * 8 };
      } else if (move === 'arms') {
        const sway = Math.sin(phase * Math.PI) * 9;
        r.lh = { x: -17 + sway, y: -32 };
        r.rh = { x: 17 + sway, y: -32 };
        r.bodyRot = Math.sin(phase * Math.PI) * 0.12;
        r.bodyDY = 2 * pulse;
      } else if (move === 'spin') {
        const within = (phase % 4) / 4;
        r.sx = Math.cos(clamp((within - 0.75) * 4, 0, 1) * TAU);
        r.lh = { x: -28, y: -2 };
        r.rh = { x: 28, y: -2 };
        r.bodyDY = 2 * pulse;
      } else if (move === 'bounce') {
        r.bodyDY = -7 * Math.abs(Math.sin(phase * Math.PI));
        r.lf.y -= 5 * Math.abs(Math.sin(phase * Math.PI));
        r.rf.y -= 5 * Math.abs(Math.sin(phase * Math.PI));
        r.lh = { x: -18, y: 16 };
        r.rh = { x: 18, y: 16 };
      } else {
        const up = n % 2 === 0;
        r.lh = up ? { x: -24, y: -26 } : { x: -20, y: 18 };
        r.rh = up ? { x: 20, y: 18 } : { x: 24, y: -26 };
        r.bodyRot = (up ? -1 : 1) * 0.1;
        r.bodyDY = 2 * pulse;
      }
      break;
    }
    case 'guard': {
      // Boxing stance: gloves up by the face, bouncing on its toes.
      const bob = Math.sin(t * 9);
      r.bodyDY = bob * 1.2;
      r.bodyRot = f * 0.05;
      r.lh = { x: f * 5 - 17, y: 6 + bob * 1.5 };
      r.rh = { x: f * 5 + 17, y: 6 - bob * 1.5 };
      r.lBend = 7;
      r.rBend = -7;
      break;
    }
    case 'punch': {
      // Wind-up (0-0.12 s), jab (to 0.2 s), hold it (to 0.28 s), back to guard (to 0.4 s).
      const k = a.poseT;
      const out = k < 0.12 ? -0.35 * (k / 0.12) : k < 0.2 ? -0.35 + 1.35 * ((k - 0.12) / 0.08) : k < 0.28 ? 1 : Math.max(0, 1 - (k - 0.28) / 0.12);
      const hand = { x: f * (10 + out * 34), y: 3 - out * 3 };
      const guard = { x: f * 5 - f * 17, y: 6 };
      const lead = (a.punchHand ?? 1) > 0; // alternate hands
      if ((f > 0) === lead) {
        r.rh = hand;
        r.lh = { x: guard.x, y: guard.y };
      } else {
        r.lh = hand;
        r.rh = { x: -guard.x, y: guard.y };
      }
      r.lBend = 4;
      r.rBend = -4;
      r.bodyRot = f * (0.05 + Math.max(0, out) * 0.14);
      r.bodyDX = f * Math.max(0, out) * 3;
      break;
    }
    case 'wave': {
      const wv = Math.sin(t * 13) * 7;
      if (f >= 0) r.rh = { x: 27 + wv, y: -24 };
      else r.lh = { x: -27 + wv, y: -24 };
      r.bodyRot = Math.sin(t * 6.5) * 0.04;
      break;
    }
    case 'think': {
      // One hand on the "chin" (just under the mouth), the other relaxed.
      if (f >= 0) {
        r.rh = { x: 6, y: 13 };
        r.rBend = -7;
      } else {
        r.lh = { x: -6, y: 13 };
        r.lBend = 7;
      }
      r.bodyRot = Math.sin(t * 1.4) * 0.05;
      r.lookOverride = { x: 0.6 * f, y: -0.85 };
      break;
    }
    case 'listen': {
      r.lh = { x: -9, y: 17 };
      r.rh = { x: 9, y: 17 };
      r.bodyRot = 0.08 * f + Math.sin(t * 2) * 0.02;
      r.bodyDY = breath * 0.7;
      break;
    }
    case 'carry': {
      r.lh = { x: -11, y: shape.top - 11 };
      r.rh = { x: 11, y: shape.top - 11 };
      r.item = a.carry || 'folder';
      r.bodyDY = Math.sin(t * 6) * 1.2;
      break;
    }
    case 'celebrate':
    case 'jump':
    case 'flip':
    case 'startled': {
      r.lh = { x: -24, y: -28 };
      r.rh = { x: 24, y: -28 };
      break;
    }
    case 'stretch':
    case 'yawn': {
      const p = clamp(a.poseT / 1.2, 0, 1);
      const up = Math.sin(p * Math.PI);
      r.lh = { x: -14 - 10 * (1 - up), y: 10 - 46 * up };
      r.rh = { x: 14 + 10 * (1 - up), y: 10 - 46 * up };
      r.sy = 1 + 0.08 * up;
      r.sx = 1 - 0.05 * up;
      break;
    }
    case 'lookaround': {
      r.faceDX = Math.sin(a.poseT * 2.6) * 6;
      r.lookOverride = { x: Math.sin(a.poseT * 2.6), y: -0.1 };
      break;
    }
    case 'shrug': {
      const p = clamp(a.poseT / 0.35, 0, 1);
      r.lh = { x: -31, y: 4 - 12 * p };
      r.rh = { x: 31, y: 4 - 12 * p };
      r.bodyDY = -2 * p;
      break;
    }
    case 'hum':
    case 'petted': {
      r.bodyRot = Math.sin(t * 3.2) * 0.07;
      r.bodyDY = Math.abs(Math.sin(t * 6.4)) * -1.5;
      if (pose === 'petted') {
        r.lh = { x: -14, y: 16 };
        r.rh = { x: 14, y: 16 };
        r.sy = 1 - Math.abs(Math.sin(t * 8)) * 0.04;
      }
      break;
    }
    case 'laugh': {
      r.bodyDY = -Math.abs(Math.sin(t * 18)) * 2.2;
      r.lh = { x: -13, y: 15 };
      r.rh = { x: 13, y: 15 };
      r.bodyRot = Math.sin(t * 9) * 0.05;
      break;
    }
    case 'annoyed': {
      r.lh = { x: 10, y: 11 };
      r.rh = { x: -10, y: 13 };
      r.lBend = 6;
      r.rBend = -6;
      break;
    }
    case 'dizzy': {
      r.bodyRot = Math.sin(t * 5.5) * 0.16;
      r.bodyDX = Math.sin(t * 5.5 + 1) * 2;
      r.lh = { x: -30, y: 6 + Math.sin(t * 5) * 3 };
      r.rh = { x: 30, y: 6 - Math.sin(t * 5) * 3 };
      break;
    }
    default:
      break;
  }

  // Reactions (to a video, a joke...) layered on top of whatever pose this is.
  const re = a.react && t - a.react.t0 < a.react.dur ? a.react : null;
  if (re && pose !== 'held' && pose !== 'rope' && pose !== 'climb') {
    const k = (t - re.t0) / re.dur;
    switch (re.kind) {
      case 'laugh':
        r.bodyDY -= Math.abs(Math.sin(t * 17)) * 2.4;
        r.bodyRot += Math.sin(t * 8.5) * 0.05;
        break;
      case 'gasp':
        r.bodyDY -= 6 * Math.max(0, 1 - k * 3);
        r.lh = { x: -21, y: -16 };
        r.rh = { x: 21, y: -16 };
        break;
      case 'wow':
        r.sy *= 1 + 0.04 * Math.sin(t * 10);
        break;
      case 'clap': {
        const g = Math.abs(Math.sin(t * 11)) * 6;
        r.lh = { x: -4 - g, y: 6 };
        r.rh = { x: 4 + g, y: 6 };
        break;
      }
      case 'think':
        if (f >= 0) r.rh = { x: 6, y: 13 };
        else r.lh = { x: -6, y: 13 };
        r.lookOverride = { x: 0.5 * f, y: -0.8 };
        break;
      case 'nod':
        r.faceDY += Math.sin(t * 11) * 1.6;
        r.bodyRot += Math.sin(t * 11) * 0.03;
        break;
      case 'sad':
        r.bodyDY += 2;
        r.bodyRot += 0.08 * f;
        break;
      case 'dance':
        r.bodyRot += Math.sin(t * 6.5) * 0.12;
        r.bodyDX += Math.sin(t * 6.5) * 3;
        break;
      case 'peek': {
        // A notification: little hop, eyes on the app, pointing at it.
        const at = a.peekAt;
        if (at) {
          const cy = c.y - CENTER_Y * s;
          r.lookOverride = { x: clamp((at.x - c.x) / (260 * s), -1, 1), y: clamp((at.y - cy) / (260 * s), -1, 1) };
        }
        r.bodyDY -= 5 * Math.max(0, 1 - k * 4);
        if (f >= 0) r.rh = { x: 31, y: -3 };
        else r.lh = { x: -31, y: -3 };
        break;
      }
      case 'gaze':
        // Eye break: a hand shading the eyes, peering far into the distance.
        if (f >= 0) r.rh = { x: 9, y: -16 };
        else r.lh = { x: -9, y: -16 };
        r.lookOverride = { x: 0.9 * f, y: -0.45 };
        r.bodyRot += 0.04 * f;
        break;
      default:
        break;
    }
  }
  // No legs: sitting down can't push the body into the floor.
  if (!hasLegs(st.look)) r.bodyDY = Math.min(r.bodyDY, Math.max(0, CENTER_Y - shape.bottom));
  return r;
}

/** Standing around: the chosen idle style. */
function idleRig(r, st, idle, breath) {
  const t = st.t;
  switch (idle) {
    case 'bob': {
      const b = Math.sin(t * 3.2) * 0.5 + 0.5;
      r.bodyDY = b * 2.8;
      r.lh.y += b * 2.2;
      r.rh.y += b * 2.2;
      r.legBendL = -b * 3;
      r.legBendR = b * 3;
      break;
    }
    case 'sway': {
      const w = Math.sin(t * 1.7);
      r.bodyRot = w * 0.075;
      r.bodyDX = w * 1.4;
      r.lh = { x: r.lh.x + w * 2, y: r.lh.y - w * 1.5 };
      r.rh = { x: r.rh.x + w * 2, y: r.rh.y + w * 1.5 };
      break;
    }
    case 'bounce': {
      const u = (t % 1.4) / 1.4;
      const up = idleHop(t);
      if (u > 0.88) r.bodyDY = ((u - 0.88) / 0.12) * 3; // crouch before the hop
      r.lh.y -= up * 12;
      r.rh.y -= up * 12;
      r.lf.y -= up * 3;
      r.rf.y -= up * 3;
      break;
    }
    case 'wiggle': {
      const w = Math.sin(t * 6.5);
      r.sx = 1 + w * 0.04;
      r.sy = 1 - w * 0.04;
      r.bodyRot = Math.sin(t * 3.3) * 0.045;
      r.lh.y += Math.sin(t * 6.5 + 1) * 2;
      r.rh.y += Math.sin(t * 6.5 + 2.4) * 2;
      break;
    }
    case 'still':
      break;
    default:
      r.bodyDY = breath * 0.7;
      r.lh.y += breath * 0.8;
      r.rh.y += breath * 0.8;
  }
}

/** Getting around: the walk style's legs, arms and body motion (hop height and rolling come from bodyMotion). */
function walkRig(r, st, gait, p, k, f, t) {
  const c = st.char;
  const s = c.scale;
  const lp = p;
  const rp = p + Math.PI;
  const kk = Math.min(k, 1.2);
  const step = (stride, lift) => {
    r.lf = { x: -8 + Math.sin(lp) * stride * k * f, y: CENTER_Y - Math.max(0, Math.cos(lp)) * lift * kk };
    r.rf = { x: 8 + Math.sin(rp) * stride * k * f, y: CENTER_Y - Math.max(0, Math.cos(rp)) * lift * kk };
    r.lLift = Math.max(0, Math.cos(lp));
    r.rLift = Math.max(0, Math.cos(rp));
  };
  const lean = clamp(c.vx / (PHYS.run * s), -1, 1);
  switch (gait) {
    case 'hop': {
      const up = hopUp(p);
      r.lf = { x: -6 - up * 2 * f, y: CENTER_Y - up * 6 };
      r.rf = { x: 6 - up * 2 * f, y: CENTER_Y - up * 6 };
      r.lLift = up * 0.8;
      r.rLift = up * 0.8;
      r.lh = { x: r.lh.x - up * 2, y: 8 - up * 15 };
      r.rh = { x: r.rh.x + up * 2, y: 8 - up * 15 };
      r.bodyRot = f * 0.1 * up;
      break;
    }
    case 'waddle': {
      step(4, 4);
      r.bodyRot = Math.sin(p) * 0.17 * Math.min(1, k * 1.5);
      r.bodyDX = Math.sin(p) * 2.2 * Math.min(1, k * 1.5);
      r.bodyDY = -Math.abs(Math.cos(p)) * 1.5 * kk;
      r.lh = { x: r.lh.x - 4, y: 2 + Math.sin(p * 2) * 3 };
      r.rh = { x: r.rh.x + 4, y: 2 - Math.sin(p * 2) * 3 };
      r.lBend = -3;
      r.rBend = 3;
      break;
    }
    case 'strut': {
      step(11, 8);
      r.bodyDY = -Math.abs(Math.sin(p)) * 4 * Math.min(k, 1.3);
      r.faceDY = -Math.abs(Math.sin(p)) * 1.3;
      r.lh = { x: r.lh.x - Math.sin(lp) * 11 * k * f, y: 7 + Math.cos(lp) * 5 };
      r.rh = { x: r.rh.x - Math.sin(rp) * 11 * k * f, y: 7 + Math.cos(rp) * 5 };
      r.lBend = -9;
      r.rBend = 9;
      r.bodyRot = -f * 0.05 + Math.sin(p) * 0.05;
      break;
    }
    case 'tiptoe': {
      step(6, 9);
      r.bodyDY = -3 - Math.abs(Math.sin(p)) * 1.2 * kk;
      r.lh = { x: -13, y: 8 + Math.sin(lp) * 1.5 };
      r.rh = { x: 13, y: 8 + Math.sin(rp) * 1.5 };
      r.lBend = 6;
      r.rBend = -6;
      r.lookOverride = { x: Math.sin(t * 1.6) * 0.9, y: -0.15 }; // shifty eyes
      break;
    }
    case 'float': {
      const sw = Math.sin(t * 3);
      r.lf = { x: -8 - f * 3, y: CENTER_Y - 3 + sw * 1.5 };
      r.rf = { x: 8 - f * 3, y: CENTER_Y - 2 - sw * 1.5 };
      r.lh = { x: r.lh.x - f * 5, y: 7 + sw * 2 };
      r.rh = { x: r.rh.x - f * 5, y: 7 - sw * 2 };
      r.bodyRot = lean * 0.25;
      break;
    }
    case 'roll': {
      // Tucked into a ball; bodyMotion turns the whole body.
      r.lh = { x: -16, y: 9 };
      r.rh = { x: 16, y: 9 };
      r.lf = { x: -7, y: 29 };
      r.rf = { x: 7, y: 29 };
      r.lBend = 6;
      r.rBend = -6;
      break;
    }
    case 'robot': {
      // Six stiff poses per stride, straight limbs, no bounce.
      const q = Math.floor(p / (Math.PI / 3)) * (Math.PI / 3);
      r.lf = { x: -8 + Math.sin(q) * 8 * k * f, y: CENTER_Y - Math.max(0, Math.cos(q)) * 6 * kk };
      r.rf = { x: 8 + Math.sin(q + Math.PI) * 8 * k * f, y: CENTER_Y - Math.max(0, Math.cos(q + Math.PI)) * 6 * kk };
      r.lh = { x: r.lh.x - Math.sin(q) * 7 * k * f, y: r.lh.y };
      r.rh = { x: r.rh.x - Math.sin(q + Math.PI) * 7 * k * f, y: r.rh.y };
      r.lBend = 0;
      r.rBend = 0;
      r.faceDY = Math.floor(p / Math.PI) % 2 ? 0.8 : 0;
      break;
    }
    default: {
      step(9, 7);
      r.bodyDY = -Math.abs(Math.sin(p)) * 2.6 * Math.min(k, 1.3);
      r.lh = { x: r.lh.x + 1 - Math.sin(lp) * 7 * k * f * 0.6, y: r.lh.y - 1 + Math.cos(lp) * 2 };
      r.rh = { x: r.rh.x - 1 - Math.sin(rp) * 7 * k * f * 0.6, y: r.rh.y - 1 + Math.cos(rp) * 2 };
      r.bodyRot = lean * 0.13;
    }
  }
}

function drawLaptop(ctx, t) {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLORS.outline;
  // The lid (we see its back), with a softly glowing sparkle logo.
  ctx.beginPath();
  ctx.moveTo(-15, 12);
  ctx.lineTo(15, 12);
  ctx.quadraticCurveTo(17, 12, 17, 14);
  ctx.lineTo(16, 27);
  ctx.lineTo(-16, 27);
  ctx.lineTo(-17, 14);
  ctx.quadraticCurveTo(-17, 12, -15, 12);
  ctx.closePath();
  ctx.fillStyle = '#C7CCD6';
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(-13, 14, 26, 2);
  ctx.fillStyle = `rgba(255, 212, 110, ${0.65 + Math.sin(t * 2) * 0.25})`;
  sparkle(ctx, 0, 19.5, 3.4, 0);
  ctx.fill();
  // The keyboard base peeking out below.
  ctx.beginPath();
  ctx.moveTo(-19, 27);
  ctx.lineTo(19, 27);
  ctx.lineTo(18, 30.5);
  ctx.lineTo(-18, 30.5);
  ctx.closePath();
  ctx.fillStyle = '#AAB1BD';
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawPopcorn(ctx, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = COLORS.outline;
  // Puffs
  ctx.fillStyle = '#FFF6D6';
  for (const [px, py, pr] of [
    [-6, -8, 3.6],
    [0, -10, 4],
    [6, -8, 3.6],
    [-3, -12, 3],
    [3.5, -12.5, 3],
  ]) {
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, TAU);
    ctx.fill();
    ctx.stroke();
  }
  // Striped bucket
  ctx.beginPath();
  ctx.moveTo(-10, -7);
  ctx.lineTo(10, -7);
  ctx.lineTo(7, 7);
  ctx.lineTo(-7, 7);
  ctx.closePath();
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#E8455A';
  for (let i = -3; i <= 3; i += 2) ctx.fillRect(i * 3.2 - 1.6, -8, 3.2, 16);
  ctx.restore();
  ctx.stroke();
  ctx.restore();
}

function drawEyes(ctx, face, a, look, blink) {
  const ex = 10.5;
  const ey = -4;
  const lx = look.x * 1.6;
  const ly = look.y * 1.4;
  ctx.fillStyle = COLORS.eye;
  ctx.strokeStyle = COLORS.eye;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const side of [-1, 1]) {
    const x = side * ex + lx;
    const y = ey + ly;
    switch (face.eyes) {
      case 'happy':
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.arc(x, y + 2.5, 4.2, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
        break;
      case 'closed':
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(x, y - 1, 4, Math.PI * 0.2, Math.PI * 0.8);
        ctx.stroke();
        break;
      case 'squint':
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(x - 3.6 * side, y - 3.6);
        ctx.lineTo(x + 3 * side, y);
        ctx.lineTo(x - 3.6 * side, y + 3.6);
        ctx.stroke();
        break;
      case 'dizzy': {
        ctx.lineWidth = 1.7;
        ctx.beginPath();
        const rot = a.breath * 9 * side;
        for (let i = 0; i <= 26; i++) {
          const ang = rot + i * 0.55;
          const rr = 0.4 + i * 0.19;
          const px = x + Math.cos(ang) * rr;
          const py = y + Math.sin(ang) * rr;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
        break;
      }
      case 'heart': {
        ctx.fillStyle = '#E8455A';
        ctx.beginPath();
        ctx.moveTo(x, y + 4);
        ctx.bezierCurveTo(x - 6, y - 1, x - 3.5, y - 6.5, x, y - 3);
        ctx.bezierCurveTo(x + 3.5, y - 6.5, x + 6, y - 1, x, y + 4);
        ctx.fill();
        ctx.fillStyle = COLORS.eye;
        break;
      }
      default: {
        const wide = face.eyes === 'wide';
        const rx = wide ? 4.6 : 3.9;
        const ry = (wide ? 6.2 : 5.4) * (1 - blink * 0.92);
        ctx.beginPath();
        ctx.ellipse(x, y, rx, Math.max(ry, 0.6), 0, 0, TAU);
        ctx.fill();
        if (ry > 2) {
          ctx.fillStyle = '#FFFFFF';
          ctx.beginPath();
          ctx.arc(x - 1.3 + look.x * 0.6, y - ry * 0.42, wide ? 1.4 : 1.7, 0, TAU);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(x + 1.5 + look.x * 0.4, y + ry * 0.38, 0.8, 0, TAU);
          ctx.fill();
          ctx.fillStyle = COLORS.eye;
        } else {
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.arc(x, y - 1.5, 3.8, Math.PI * 0.2, Math.PI * 0.8);
          ctx.stroke();
        }
      }
    }
  }
}

function drawBrows(ctx, face, look) {
  if (!face.brows) return;
  ctx.strokeStyle = COLORS.outline;
  ctx.lineWidth = 2.1;
  ctx.lineCap = 'round';
  const lx = look.x * 1.6;
  for (const side of [-1, 1]) {
    const x = side * 10.5 + lx;
    const y = -12.5 + look.y;
    ctx.beginPath();
    if (face.brows === 'angry' || face.brows === 'determined') {
      ctx.moveTo(x - 3.6 * side, y + 2.2);
      ctx.lineTo(x + 3.4 * side, y - 1.2);
      ctx.moveTo(x - 3.6 * side, y + 2.2);
    } else {
      ctx.moveTo(x - 3.4, y - 0.5);
      ctx.quadraticCurveTo(x, y - 3, x + 3.4, y - 0.5);
    }
    ctx.stroke();
  }
}

function drawMouth(ctx, face, look, talk, t) {
  const x = look.x * 1.3;
  const y = 7 + look.y * 1.1;
  let type = face.mouth;
  if (talk > 0) type = Math.sin(t * 22) > -0.1 ? 'open' : type === 'open' ? 'smile' : type;
  ctx.strokeStyle = COLORS.mouth;
  ctx.fillStyle = COLORS.mouth;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  switch (type) {
    case 'open':
      ctx.moveTo(x - 4.2, y - 0.6);
      ctx.quadraticCurveTo(x, y - 1.4, x + 4.2, y - 0.6);
      ctx.quadraticCurveTo(x + 3.6, y + 5.6, x, y + 5.8);
      ctx.quadraticCurveTo(x - 3.6, y + 5.6, x - 4.2, y - 0.6);
      ctx.fill();
      ctx.fillStyle = COLORS.tongue;
      ctx.beginPath();
      ctx.ellipse(x, y + 4, 2.4, 1.5, 0, 0, TAU);
      ctx.fill();
      break;
    case 'o':
      ctx.ellipse(x, y + 1.5, 2.2, 2.8, 0, 0, TAU);
      ctx.fill();
      break;
    case 'flat':
      ctx.moveTo(x - 3.2, y + 1);
      ctx.lineTo(x + 3.2, y + 1);
      ctx.stroke();
      break;
    case 'wavy':
      ctx.moveTo(x - 4.5, y + 1.5);
      ctx.quadraticCurveTo(x - 3, y - 0.5, x - 1.5, y + 1.5);
      ctx.quadraticCurveTo(x, y + 3.2, x + 1.5, y + 1.5);
      ctx.quadraticCurveTo(x + 3, y - 0.5, x + 4.5, y + 1.5);
      ctx.stroke();
      break;
    case 'cat':
      ctx.moveTo(x - 4.2, y);
      ctx.quadraticCurveTo(x - 2.1, y + 3.2, x, y + 0.4);
      ctx.quadraticCurveTo(x + 2.1, y + 3.2, x + 4.2, y);
      ctx.stroke();
      break;
    default:
      ctx.moveTo(x - 3.6, y);
      ctx.quadraticCurveTo(x, y + 3.8, x + 3.6, y);
      ctx.stroke();
  }
}

function drawItem(ctx, item, t, top = -23) {
  ctx.save();
  ctx.translate(0, top - 27);
  ctx.rotate(Math.sin(t * 5) * 0.06);
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLORS.outline;
  ctx.lineJoin = 'round';
  if (item === 'folder') {
    ctx.fillStyle = COLORS.folderDark;
    ctx.beginPath();
    ctx.moveTo(-15, -9);
    ctx.lineTo(-6, -9);
    ctx.lineTo(-3, -6);
    ctx.lineTo(15, -6);
    ctx.lineTo(15, 9);
    ctx.lineTo(-15, 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = COLORS.folder;
    ctx.beginPath();
    ctx.moveTo(-15, -3);
    ctx.lineTo(15, -3);
    ctx.lineTo(15, 9);
    ctx.lineTo(-15, 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (item === 'file' || item === 'note') {
    ctx.fillStyle = item === 'note' ? '#FFE98A' : '#FFFFFF';
    ctx.beginPath();
    ctx.moveTo(-10, -13);
    ctx.lineTo(5, -13);
    ctx.lineTo(11, -7);
    ctx.lineTo(11, 13);
    ctx.lineTo(-10, 13);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(74,35,23,0.45)';
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(-6, -4 + i * 4.5);
      ctx.lineTo(7, -4 + i * 4.5);
      ctx.stroke();
    }
  } else if (item === 'timer') {
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(0, 2, 11, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillRect(-2.5, -13, 5, 4);
    ctx.strokeRect(-2.5, -13, 5, 4);
    ctx.beginPath();
    ctx.moveTo(0, 2);
    ctx.lineTo(Math.sin(t * 4) * 7, 2 - Math.cos(t * 4) * 7);
    ctx.stroke();
  } else if (item === 'globe') {
    ctx.fillStyle = '#7FC4F0';
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, 5, 12, 0, 0, TAU);
    ctx.moveTo(-12, 0);
    ctx.lineTo(12, 0);
    ctx.stroke();
  } else {
    // generic sparkle-check
    ctx.fillStyle = '#7ED492';
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-5, 0);
    ctx.lineTo(-1, 4);
    ctx.lineTo(6, -4);
    ctx.stroke();
  }
  ctx.restore();
}

function sparkle(ctx, x, y, r, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const ang = rot + (i * Math.PI) / 4;
    const rr = i % 2 === 0 ? r : r * 0.38;
    const px = x + Math.cos(ang) * rr;
    const py = y + Math.sin(ang) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** Shared body transform: rig + rotation + squash, and a body-local -> world mapper. */
export function bodyFrame(st) {
  const c = st.char;
  const a = st.anim;
  const s = c.scale;
  const rig = rigFor(st);
  const shape = bodyOf(st.look);
  const { lift, roll } = bodyMotion(st);
  const cx = c.x;
  const cy = c.y - (CENTER_Y + lift) * s;
  let rot = c.rot + rig.bodyRot + roll;
  if (c.flipT > 0) rot += (1 - clamp(c.flipT / 0.45, 0, 1)) * TAU * c.facing;
  let q = a.squash;
  if (c.mode === 'air' && !c.tumble) q += clamp(-c.vy / (5200 * s), -0.06, 0.1);
  const sy = (1 + q) * rig.sy;
  const sx = (1 - q * 0.65) * rig.sx;
  const grounded = c.mode === 'ground';
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const toWorld = (lx, ly) => {
    const px = (lx + rig.bodyDX) * sx * s;
    let py = (ly + rig.bodyDY) * s;
    if (grounded) py = (CENTER_Y + (ly + rig.bodyDY - CENTER_Y) * sy) * s;
    else py *= sy;
    return { x: cx + px * cos - py * sin, y: cy + px * sin + py * cos };
  };
  return { rig, shape, lift, cx, cy, rot, sx, sy, grounded, cos, sin, toWorld };
}

/** The grappling rope (drawn on the full-screen layer, behind the character). */
export function drawRope(ctx, st) {
  const c = st.char;
  const rope = c.rope;
  if (rope.state === 'none') return;
  Object.assign(COLORS, paletteFor(st.look));
  const s = c.scale;
  const t = st.t;
  const { cx, cy, toWorld, shape } = bodyFrame(st);
  const hp = toWorld(0, shape.top - 11);
  const hx = rope.state === 'attached' ? rope.ax : rope.hx;
  const hy = rope.state === 'attached' ? rope.ay : rope.hy;
  const slack = rope.state === 'attached' ? Math.max(0, rope.len - Math.hypot(rope.ax - cx, rope.ay - cy)) : 0;
  const midX = (hp.x + hx) / 2;
  const midY = (hp.y + hy) / 2 + Math.min(slack * 0.6, 120 * s) + (rope.state === 'shooting' ? Math.sin(t * 40) * 3 * s : 0);
  for (const [w, col] of [
    [4.2 * s, COLORS.outline],
    [2 * s, '#FFF4E6'],
  ]) {
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hp.x, hp.y);
    ctx.quadraticCurveTo(midX, midY, hx, hy);
    ctx.stroke();
  }
  ctx.fillStyle = COLORS.tip;
  ctx.strokeStyle = COLORS.outline;
  ctx.lineWidth = 1.6 * s;
  sparkle(ctx, hx, hy, 6.5 * s, t * 3);
  ctx.fill();
  ctx.stroke();
}

/**
 * Draw the character. The context must be in global screen coordinates (the caller
 * translates by the canvas origin).
 */
export function drawCharacter(ctx, st) {
  const c = st.char;
  const a = st.anim;
  const s = c.scale;
  const t = st.t;
  const face = currentFace(st);
  const { rig, shape, lift, cx, cy, rot, sx, sy, grounded, cos, sin, toWorld } = bodyFrame(st);
  const look = st.look ?? DEFAULT_LOOK;
  Object.assign(COLORS, paletteFor(look));
  const outfit = { accent: look.accent ?? DEFAULT_LOOK.accent, outline: COLORS.outline, t };

  // Shadow on the ground under the character.
  if (st.groundY != null) {
    const hgt = Math.max(0, st.groundY - c.y) + lift * s;
    const fade = clamp(1 - hgt / (380 * s), 0, 1) * (1 - clamp(lift / 60, 0, 0.5));
    if (fade > 0.02) {
      const w = (shape.hip ? 21 : shape.hw * 0.85) * s;
      ctx.fillStyle = `rgba(40, 18, 10, ${0.22 * fade})`;
      ctx.beginPath();
      ctx.ellipse(cx, st.groundY - 1.5 * s, w * (0.6 + 0.4 * fade) * Math.abs(sx), 4.2 * s * (0.6 + 0.4 * fade), 0, 0, TAU);
      ctx.fill();
    }
  }

  // Control-mode ring.
  if (a.ring > 0.02 && grounded) {
    ctx.strokeStyle = `rgba(255, 170, 110, ${0.75 * a.ring})`;
    ctx.lineWidth = 2.5 * s;
    ctx.beginPath();
    ctx.ellipse(cx, c.y - 1 * s, (28 + Math.sin(t * 4) * 2) * s, 6.5 * s, 0, 0, TAU);
    ctx.stroke();
  }

  // Antenna stalk (world space so it can lag behind with its spring). A hat
  // makes it longer so it still pokes out of the top.
  const antenna = look.antenna ?? 'sparkle';
  if (antenna !== 'none') {
    const root = toWorld(0, shape.top + 2);
    const stalk = BODY.antenna + hatLift(look);
    const ctrlX = root.x + sin * stalk * 0.55 * s;
    const ctrlY = root.y - cos * stalk * 0.55 * s;
    ctx.lineCap = 'round';
    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = 2.4 * s;
    ctx.beginPath();
    ctx.moveTo(root.x, root.y);
    ctx.quadraticCurveTo(ctrlX, ctrlY, a.antX, a.antY);
    ctx.stroke();
  }

  // Body group.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.scale(s, s);
  if (grounded) {
    ctx.translate(0, CENTER_Y);
    ctx.scale(sx, sy);
    ctx.translate(0, -CENTER_Y);
  } else {
    ctx.scale(sx, sy);
  }
  ctx.translate(rig.bodyDX, rig.bodyDY);

  // Legs (behind the body, or just the feet in front when sitting). Legless bodies glide.
  const lf = { x: rig.lf.x - rig.bodyDX, y: rig.lf.y - rig.bodyDY };
  const rf = { x: rig.rf.x - rig.bodyDX, y: rig.rf.y - rig.bodyDY };
  const hip = hasLegs(look) ? shape.hip : null;
  const legStyle = look.legs ?? 'stubby';
  const armStyle = look.arms ?? 'nubby';
  if (hip && !rig.feetFront) {
    leg(ctx, legStyle, -hip[0], hip[1], lf.x, lf.y, rig.legBendL, rig.lLift, -1, COLORS, outfit.accent);
    leg(ctx, legStyle, hip[0], hip[1], rf.x, rf.y, rig.legBendR, rig.rLift, 1, COLORS, outfit.accent);
  }
  // Arms, first pass: behind the body, so they grow out from under its outline.
  const [shX, shY] = shape.shoulder;
  const flap = c.mode === 'air' || c.mode === 'held' ? 1 : a.pose === 'walk' ? 0.45 : 0.12;
  armBack(ctx, armStyle, -shX, shY, rig.lh.x, rig.lh.y, rig.lBend, COLORS, -1, { t, flap });
  armBack(ctx, armStyle, shX, shY, rig.rh.x, rig.rh.y, rig.rBend, COLORS, 1, { t, flap });

  // Body.
  const g = ctx.createLinearGradient(0, shape.top, 0, shape.bottom);
  g.addColorStop(0, COLORS.bodyLight);
  g.addColorStop(0.55, COLORS.body);
  g.addColorStop(1, COLORS.bodyDark);
  shape.path(ctx, t);
  if (shape.outlineFirst) {
    // Overlapping puffs: a thick outline underneath, the fill hides its inner half.
    ctx.lineJoin = 'round';
    ctx.lineWidth = OUT * 2;
    ctx.strokeStyle = COLORS.outline;
    ctx.stroke();
  }
  ctx.fillStyle = g;
  ctx.fill();
  // Belly patch and shine.
  ctx.save();
  ctx.clip();
  if (shape.belly) {
    const [bx, by, brx, bry] = shape.belly;
    ctx.fillStyle = COLORS.belly;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.ellipse(bx + rig.faceDX * 0.3 + a.lookX * 1.2, by, brx, bry, 0, 0, TAU);
    ctx.fill();
  }
  const [hx, hy, hrx, hry, hrot] = shape.shine;
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.ellipse(hx, hy, hrx, hry, hrot, 0, TAU);
  ctx.fill();
  ctx.restore();
  if (!shape.outlineFirst) {
    shape.path(ctx, t);
    ctx.lineJoin = 'round';
    ctx.lineWidth = OUT;
    ctx.strokeStyle = COLORS.outline;
    ctx.stroke();
  }
  ctx.save();
  ctx.translate(0, shape.neck[0]);
  ctx.scale(shape.neck[1], 1);
  drawNeck(ctx, look.neck, outfit);
  ctx.restore();

  // Face.
  const gaze = rig.lookOverride ?? { x: a.lookX, y: a.lookY };
  ctx.save();
  ctx.translate(gaze.x * 4.8 + rig.faceDX, gaze.y * 2.6 + rig.faceDY + shape.face);
  if (face.blush > 0) {
    ctx.fillStyle = COLORS.blush;
    ctx.globalAlpha = clamp(face.blush, 0, 1);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * shape.blush[0], shape.blush[1] - shape.face, 4.6, 2.6, 0, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  drawEyes(ctx, face, a, gaze, a.blink);
  drawBrows(ctx, face, gaze);
  drawMouth(ctx, face, gaze, a.talk, t);
  drawGlasses(ctx, look.glasses, { ...outfit, lx: gaze.x * 1.6, ly: gaze.y * 1.4 });
  ctx.restore();
  ctx.save();
  ctx.translate(0, shape.top + BODY.h / 2); // hats are drawn for a head top at y = -23
  drawHat(ctx, look.hat, { ...outfit, spin: clamp(Math.abs(c.vx) / (PHYS.run * s) + (c.mode === 'air' ? 0.6 : 0), 0, 1) });
  ctx.restore();

  if (hip && rig.feetFront) {
    footOnly(ctx, legStyle, lf.x, lf.y, -1, COLORS, outfit.accent);
    footOnly(ctx, legStyle, rf.x, rf.y, 1, COLORS, outfit.accent);
  }
  if (rig.lap === 'popcorn') drawPopcorn(ctx, 2 * c.facing, 19);
  if (rig.lap === 'laptop') drawLaptop(ctx, t);

  // Arms, second pass: forearms and hands in front of the body.
  const midY = (shape.top + shape.bottom) / 2;
  const halfH = (shape.bottom - shape.top) / 2;
  const inside = (x, y) => (x / shape.hw) ** 2 + ((y - midY) / halfH) ** 2 < 0.78;
  armFront(ctx, armStyle, -shX, shY, rig.lh.x, rig.lh.y, rig.lBend, COLORS, -1, { inside });
  armFront(ctx, armStyle, shX, shY, rig.rh.x, rig.rh.y, rig.rBend, COLORS, 1, { inside });
  if (rig.item) drawItem(ctx, rig.item, t, shape.top);
  ctx.restore();

  // Antenna tip (with glow when thinking / listening / on the beat).
  const glow = a.glow;
  if (glow > 0.03) {
    const gr = ctx.createRadialGradient(a.antX, a.antY, 0, a.antX, a.antY, 18 * s);
    gr.addColorStop(0, `${COLORS.tipGlow}${0.75 * glow})`);
    gr.addColorStop(1, `${COLORS.tipGlow}0)`);
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.arc(a.antX, a.antY, 18 * s, 0, TAU);
    ctx.fill();
  }
  drawTip(ctx, antenna, a.antX, a.antY, s, t, glow, st.flags.thinking, rot);

  // Dizzy stars orbiting the head.
  if (t < a.dizzyUntil) {
    const head = toWorld(0, shape.top - 6);
    for (let i = 0; i < 3; i++) {
      const ang = t * 5 + (i * TAU) / 3;
      const px = head.x + Math.cos(ang) * 17 * s;
      const py = head.y + Math.sin(ang) * 5 * s;
      ctx.fillStyle = '#FFE37A';
      ctx.strokeStyle = COLORS.outline;
      ctx.lineWidth = 1.2 * s;
      sparkle(ctx, px, py, 4.6 * s, ang);
      ctx.fill();
      ctx.stroke();
    }
  }
}

/** Axis-aligned bounds of the character (for hit testing and culling), global coords. */
export function bounds(st, pad = 0) {
  const c = st.char;
  const s = c.scale;
  const shape = bodyOf(st.look);
  const { lift } = bodyMotion(st);
  const cy = c.y - (CENTER_Y + lift) * s;
  const r = (Math.max(headRise(st.look), shape.bottom + 8, shape.hw + 14) + 10) * s + pad;
  return { x1: c.x - r, y1: cy - r, x2: c.x + r, y2: cy + Math.max(r, (CENTER_Y + lift + 8) * s + pad) };
}

/** Is a global point on the character's body (generous circle for easy grabbing)? */
export function hitTest(st, x, y) {
  const c = st.char;
  const s = c.scale;
  const shape = bodyOf(st.look);
  const { lift } = bodyMotion(st);
  const cy = c.y - (CENTER_Y + lift) * s;
  const dx = x - c.x;
  const dy = y - cy;
  const rad = Math.max(34, shape.hw + 9, -shape.top + 9);
  return dx * dx + dy * dy <= (rad * s) ** 2 || (Math.abs(dx) < 16 * s && dy > 0 && dy < (CENTER_Y + lift) * s + 2);
}

/** The antenna tip: the classic sparkle, or a star, heart, bulb, sprout... */
function drawTip(ctx, style, x, y, s, t, glow, thinking, rot) {
  ctx.fillStyle = COLORS.tip;
  ctx.strokeStyle = COLORS.outline;
  ctx.lineWidth = 1.7 * s;
  ctx.lineJoin = 'round';
  const pulse = 1 + glow * 0.28 + Math.sin(t * 3) * 0.05;
  switch (style) {
    case 'none':
      // No antenna; a little light still shows up while it's thinking or listening.
      if (glow < 0.2) return;
      ctx.globalAlpha = glow;
      sparkle(ctx, x, y + 6 * s, 4.5 * s, t * 3);
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    case 'star': {
      ctx.beginPath();
      const r0 = 6.4 * s * pulse;
      const spin = thinking ? t * 3 : Math.sin(t * 1.2) * 0.15;
      for (let i = 0; i < 10; i++) {
        const ang = -Math.PI / 2 + spin + (i * Math.PI) / 5;
        const rr = i % 2 === 0 ? r0 : r0 * 0.47;
        const px = x + Math.cos(ang) * rr;
        const py = y + Math.sin(ang) * rr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      return;
    }
    case 'heart': {
      const w = 6.2 * s * pulse * (1 + Math.max(0, Math.sin(t * 5)) * 0.08); // a little heartbeat
      ctx.fillStyle = '#F2566B';
      ctx.beginPath();
      ctx.moveTo(x, y + w * 0.75);
      ctx.bezierCurveTo(x - w * 1.25, y - w * 0.1, x - w * 0.65, y - w * 1.05, x, y - w * 0.35);
      ctx.bezierCurveTo(x + w * 0.65, y - w * 1.05, x + w * 1.25, y - w * 0.1, x, y + w * 0.75);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      return;
    }
    case 'bulb': {
      const r0 = 5 * s * pulse;
      ctx.fillStyle = glow > 0.1 ? '#FFF1A8' : '#FFE27A';
      ctx.beginPath();
      ctx.arc(x, y, r0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(x - r0 * 0.35, y - r0 * 0.35, r0 * 0.3, 0, TAU);
      ctx.fill();
      return;
    }
    case 'sprout': {
      // Two leaves at the end of the stalk, swaying.
      const sway = Math.sin(t * 2.2) * 0.2 + rot * 0.3;
      ctx.fillStyle = '#6CC56E';
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(x, y + 2 * s);
        ctx.rotate(side * (0.85 + glow * 0.3) + sway);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(-4.2 * s, -5 * s, 0, -10.5 * s * pulse);
        ctx.quadraticCurveTo(4.2 * s, -5 * s, 0, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      return;
    }
    default:
      sparkle(ctx, x, y, (5.6 + glow * 1.6 + Math.sin(t * 3) * 0.3) * s, thinking ? t * 4 : Math.sin(t * 1.3) * 0.2);
      ctx.fill();
      ctx.stroke();
  }
}
