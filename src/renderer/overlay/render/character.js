// Procedural vector art for Claude. Everything is computed from the sim state
// every frame (no sprite sheets), so poses blend smoothly with the physics.
import { BODY, CENTER_Y, PHYS } from '../sim/constants.js';
import { currentFace } from '../sim/anim.js';
import { clamp, TAU } from '../sim/util.js';

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

function bodyPath(ctx, w, h) {
  const hw = w / 2;
  const hh = h / 2;
  ctx.beginPath();
  ctx.moveTo(0, -hh);
  ctx.bezierCurveTo(hw * 0.74, -hh, hw, -hh * 0.46, hw, hh * 0.12);
  ctx.bezierCurveTo(hw, hh * 0.72, hw * 0.62, hh, 0, hh);
  ctx.bezierCurveTo(-hw * 0.62, hh, -hw, hh * 0.72, -hw, hh * 0.12);
  ctx.bezierCurveTo(-hw, -hh * 0.46, -hw * 0.74, -hh, 0, -hh);
  ctx.closePath();
}

function limb(ctx, x0, y0, x1, y1, bend, width) {
  // Rubber-hose limb: a quadratic curve bowed sideways by `bend`.
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const cx = mx + (-dy / len) * bend;
  const cy = my + (dx / len) * bend;
  ctx.lineCap = 'round';
  ctx.strokeStyle = COLORS.outline;
  ctx.lineWidth = width + OUT * 1.7;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(cx, cy, x1, y1);
  ctx.stroke();
  ctx.strokeStyle = COLORS.body;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(cx, cy, x1, y1);
  ctx.stroke();
}

function hand(ctx, x, y, r = 4.6) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = COLORS.body;
  ctx.fill();
  ctx.lineWidth = OUT;
  ctx.strokeStyle = COLORS.outline;
  ctx.stroke();
}

function foot(ctx, x, y, dir, lift = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-lift * 0.5 * dir);
  ctx.beginPath();
  ctx.ellipse(dir * 1.5, -2.6, 6.4, 4.2, 0, 0, TAU);
  ctx.fillStyle = COLORS.outline;
  ctx.fill();
  ctx.restore();
}

/** Compute limb targets (body-local, origin at the body center) for the pose. */
export function rigFor(st) {
  const c = st.char;
  const a = st.anim;
  const t = st.t;
  const s = c.scale;
  const f = c.facing;
  const r = {
    bodyDX: 0,
    bodyDY: 0,
    bodyRot: 0,
    sx: 1,
    sy: 1,
    lh: { x: -28, y: 12 },
    rh: { x: 28, y: 12 },
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
      r.bodyDY = breath * 0.7;
      r.lh.y += breath * 0.8;
      r.rh.y += breath * 0.8;
      if (pose === 'crouch') {
        r.bodyDY += 7;
        r.sx = 1.08;
        r.sy = 0.88;
        r.lh = { x: -26, y: 22 };
        r.rh = { x: 26, y: 22 };
      }
      break;
    }
    case 'walk': {
      const p = a.walkPhase;
      const lp = p;
      const rp = p + Math.PI;
      r.lf = { x: -8 + Math.sin(lp) * 9 * k * f, y: CENTER_Y - Math.max(0, Math.cos(lp)) * 7 * Math.min(k, 1.2) };
      r.rf = { x: 8 + Math.sin(rp) * 9 * k * f, y: CENTER_Y - Math.max(0, Math.cos(rp)) * 7 * Math.min(k, 1.2) };
      r.lLift = Math.max(0, Math.cos(lp));
      r.rLift = Math.max(0, Math.cos(rp));
      r.bodyDY = -Math.abs(Math.sin(p)) * 2.6 * Math.min(k, 1.3);
      r.lh = { x: -27 - Math.sin(lp) * 7 * k * f * 0.6, y: 11 + Math.cos(lp) * 2 };
      r.rh = { x: 27 - Math.sin(rp) * 7 * k * f * 0.6, y: 11 + Math.cos(rp) * 2 };
      r.bodyRot = clamp(c.vx / (PHYS.run * s), -1, 1) * 0.13;
      break;
    }
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
      r.lh = { x: -3, y: -BODY.h / 2 - 9 };
      r.rh = { x: 3, y: -BODY.h / 2 - 13 };
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
      r.lh = { x: -11, y: -34 };
      r.rh = { x: 11, y: -34 };
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
      default:
        break;
    }
  }
  return r;
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

function drawItem(ctx, item, t) {
  ctx.save();
  ctx.translate(0, -50);
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
  const cx = c.x;
  const cy = c.y - CENTER_Y * s;
  let rot = c.rot + rig.bodyRot;
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
  return { rig, cx, cy, rot, sx, sy, grounded, cos, sin, toWorld };
}

/** The grappling rope (drawn on the full-screen layer, behind Claude). */
export function drawRope(ctx, st) {
  const c = st.char;
  const rope = c.rope;
  if (rope.state === 'none') return;
  const s = c.scale;
  const t = st.t;
  const { cx, cy, toWorld } = bodyFrame(st);
  const hp = toWorld(0, -BODY.h / 2 - 11);
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
 * Draw Claude. The context must be in global screen coordinates (the caller
 * translates by the canvas origin).
 */
export function drawCharacter(ctx, st) {
  const c = st.char;
  const a = st.anim;
  const s = c.scale;
  const t = st.t;
  const face = currentFace(st);
  const { rig, cx, cy, rot, sx, sy, grounded, cos, sin, toWorld } = bodyFrame(st);

  // Shadow on the ground under Claude.
  if (st.groundY != null) {
    const hgt = Math.max(0, st.groundY - c.y);
    const fade = clamp(1 - hgt / (380 * s), 0, 1);
    if (fade > 0.02) {
      ctx.fillStyle = `rgba(40, 18, 10, ${0.22 * fade})`;
      ctx.beginPath();
      ctx.ellipse(cx, st.groundY - 1.5 * s, 21 * s * (0.6 + 0.4 * fade) * Math.abs(sx), 4.2 * s * (0.6 + 0.4 * fade), 0, 0, TAU);
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

  // Antenna stalk (world space so it can lag behind with its spring).
  const root = toWorld(0, -BODY.h / 2 + 2);
  const upX = sin;
  const upY = -cos;
  const ctrlX = root.x + upX * BODY.antenna * 0.55 * s;
  const ctrlY = root.y + upY * BODY.antenna * 0.55 * s;
  ctx.lineCap = 'round';
  ctx.strokeStyle = COLORS.outline;
  ctx.lineWidth = 2.4 * s;
  ctx.beginPath();
  ctx.moveTo(root.x, root.y);
  ctx.quadraticCurveTo(ctrlX, ctrlY, a.antX, a.antY);
  ctx.stroke();

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

  // Legs (behind the body, or in front when sitting).
  const hipY = BODY.h / 2 - 6;
  const lf = { x: rig.lf.x - rig.bodyDX, y: rig.lf.y - rig.bodyDY };
  const rf = { x: rig.rf.x - rig.bodyDX, y: rig.rf.y - rig.bodyDY };
  const drawLegs = () => {
    limb(ctx, -8, hipY, lf.x, lf.y - 2, rig.legBendL, 5.2);
    limb(ctx, 8, hipY, rf.x, rf.y - 2, rig.legBendR, 5.2);
    foot(ctx, lf.x, lf.y, -1, rig.lLift);
    foot(ctx, rf.x, rf.y, 1, rig.rLift);
  };
  if (!rig.feetFront) drawLegs();

  // Body.
  bodyPath(ctx, BODY.w, BODY.h);
  const g = ctx.createLinearGradient(0, -BODY.h / 2, 0, BODY.h / 2);
  g.addColorStop(0, COLORS.bodyLight);
  g.addColorStop(0.55, COLORS.body);
  g.addColorStop(1, COLORS.bodyDark);
  ctx.fillStyle = g;
  ctx.fill();
  // Belly patch.
  ctx.save();
  ctx.clip();
  ctx.fillStyle = COLORS.belly;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.ellipse(rig.faceDX * 0.3 + a.lookX * 1.2, 15, 15, 10, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.ellipse(-12, -13, 7, 4.2, -0.5, 0, TAU);
  ctx.fill();
  ctx.restore();
  bodyPath(ctx, BODY.w, BODY.h);
  ctx.lineWidth = OUT;
  ctx.strokeStyle = COLORS.outline;
  ctx.stroke();

  // Face.
  const look = rig.lookOverride ?? { x: a.lookX, y: a.lookY };
  ctx.save();
  ctx.translate(look.x * 4.8 + rig.faceDX, look.y * 2.6 + rig.faceDY);
  if (face.blush > 0) {
    ctx.fillStyle = COLORS.blush;
    ctx.globalAlpha = clamp(face.blush, 0, 1);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * 16.5, 4.5, 4.6, 2.6, 0, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  drawEyes(ctx, face, a, look, a.blink);
  drawBrows(ctx, face, look);
  drawMouth(ctx, face, look, a.talk, t);
  ctx.restore();

  if (rig.feetFront) {
    foot(ctx, lf.x, lf.y, -1, 0);
    foot(ctx, rf.x, rf.y, 1, 0);
  }
  if (rig.lap === 'popcorn') drawPopcorn(ctx, 2 * c.facing, 19);

  // Arms (in front of the body).
  const sh = 3;
  limb(ctx, -BODY.w / 2 + 3, sh, rig.lh.x, rig.lh.y, rig.lBend, 5);
  limb(ctx, BODY.w / 2 - 3, sh, rig.rh.x, rig.rh.y, rig.rBend, 5);
  if (rig.item) drawItem(ctx, rig.item, t);
  hand(ctx, rig.lh.x, rig.lh.y);
  hand(ctx, rig.rh.x, rig.rh.y);
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
  ctx.fillStyle = COLORS.tip;
  ctx.strokeStyle = COLORS.outline;
  ctx.lineWidth = 1.7 * s;
  sparkle(ctx, a.antX, a.antY, (5.6 + glow * 1.6 + Math.sin(t * 3) * 0.3) * s, st.flags.thinking ? t * 4 : Math.sin(t * 1.3) * 0.2);
  ctx.fill();
  ctx.stroke();

  // Dizzy stars orbiting the head.
  if (t < a.dizzyUntil) {
    const head = toWorld(0, -BODY.h / 2 - 6);
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

/** Axis-aligned bounds of Claude (for hit testing and culling), global coords. */
export function bounds(st, pad = 0) {
  const c = st.char;
  const s = c.scale;
  const cy = c.y - CENTER_Y * s;
  const r = (BODY.h / 2 + BODY.antenna + 10) * s + pad;
  return { x1: c.x - r, y1: cy - r, x2: c.x + r, y2: cy + r };
}

/** Is a global point on Claude's body (generous circle for easy grabbing)? */
export function hitTest(st, x, y) {
  const c = st.char;
  const s = c.scale;
  const cy = c.y - CENTER_Y * s;
  const dx = x - c.x;
  const dy = y - cy;
  return dx * dx + dy * dy <= (34 * s) ** 2 || (Math.abs(dx) < 16 * s && dy > 0 && dy < CENTER_Y * s + 2);
}
