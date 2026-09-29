// Arms and legs in different styles. All drawing is in body-local units (inside
// the body transform). Arms are drawn in two passes: once behind the body (so
// they grow out from under its outline) and once more in front for the part
// that should cover it (the hand/forearm), which makes hands on the chin, crossed
// arms and typing still read correctly.
import { TAU } from '../sim/util.js';

const OUT = 2.6;

function quad(x0, y0, cx, cy, x1, y1, t) {
  const u = 1 - t;
  return {
    x: u * u * x0 + 2 * u * t * cx + t * t * x1,
    y: u * u * y0 + 2 * u * t * cy + t * t * y1,
    dx: 2 * u * (cx - x0) + 2 * t * (x1 - cx),
    dy: 2 * u * (cy - y0) + 2 * t * (y1 - cy),
  };
}

/** Control point that bows the segment sideways by `bend`. */
function bow(x0, y0, x1, y1, bend) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  return { cx: (x0 + x1) / 2 + (-dy / len) * bend, cy: (y0 + y1) / 2 + (dx / len) * bend };
}

/**
 * A tapered, round-ended tube along a bowed curve, from t0 to 1. With t0 > 0 the
 * cut end is left open (no outline across it), for the in-front pass.
 */
function taper(ctx, x0, y0, x1, y1, bend, w0, w1, t0 = 0) {
  const { cx, cy } = bow(x0, y0, x1, y1, bend);
  const n = 10;
  const L = [];
  const R = [];
  let end = null;
  let start = null;
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((1 - t0) * i) / n;
    const p = quad(x0, y0, cx, cy, x1, y1, t);
    const len = Math.hypot(p.dx, p.dy) || 1;
    const nx = -p.dy / len;
    const ny = p.dx / len;
    const w = (w0 + (w1 - w0) * t) / 2;
    L.push([p.x + nx * w, p.y + ny * w]);
    R.push([p.x - nx * w, p.y - ny * w]);
    if (i === 0) start = { a: Math.atan2(p.dy, p.dx), w, x: p.x, y: p.y };
    if (i === n) end = { a: Math.atan2(p.dy, p.dx), w, x: p.x, y: p.y };
  }
  ctx.beginPath();
  ctx.moveTo(L[0][0], L[0][1]);
  for (const [x, y] of L) ctx.lineTo(x, y);
  ctx.arc(end.x, end.y, end.w, end.a + Math.PI / 2, end.a - Math.PI / 2, true);
  for (let i = R.length - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
  if (t0 === 0) ctx.arc(start.x, start.y, start.w, start.a - Math.PI / 2, start.a + Math.PI / 2, true);
  return end;
}

function fillStroke(ctx, fill, outline, width = OUT, closed = true) {
  if (closed) ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = width;
  ctx.strokeStyle = outline;
  ctx.stroke();
}

/** Classic rubber-hose limb (constant width, outlined). */
function hose(ctx, x0, y0, x1, y1, bend, width, color, outline) {
  const { cx, cy } = bow(x0, y0, x1, y1, bend);
  ctx.lineCap = 'round';
  ctx.strokeStyle = outline;
  ctx.lineWidth = width + OUT * 1.7;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(cx, cy, x1, y1);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(cx, cy, x1, y1);
  ctx.stroke();
}

function ball(ctx, x, y, r, fill, outline) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  fillStroke(ctx, fill, outline);
}

// ---- arms ---------------------------------------------------------------------------------

/** A cartoon glove pointing along angle `a`: puffy mitten, thumb, and a rolled cuff. */
function glove(ctx, x, y, a, outline) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.beginPath();
  ctx.ellipse(2.4, 0, 5.6, 4.9, 0, 0, TAU);
  fillStroke(ctx, '#FFFFFF', outline, 2);
  ctx.beginPath();
  ctx.ellipse(1.2, -4.2, 2.2, 1.7, -0.5, 0, TAU); // thumb
  fillStroke(ctx, '#FFFFFF', outline, 1.8);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(5.4, -1.4);
  ctx.lineTo(7.2, -1.2);
  ctx.moveTo(5.4, 1.4);
  ctx.lineTo(7.2, 1.2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(-3.2, 0, 1.9, 4.4, 0, 0, TAU); // cuff
  fillStroke(ctx, '#FFFFFF', outline, 1.8);
  ctx.restore();
}

/** A round paw at the end of an arm/leg, with toe marks toward angle `a`. */
function paw(ctx, x, y, a, r, colors) {
  ball(ctx, x, y, r, colors.body, colors.outline);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.fillStyle = colors.belly;
  ctx.beginPath();
  ctx.ellipse(-0.6, 0, r * 0.42, r * 0.5, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = colors.outline;
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'round';
  for (const k of [-1, 0, 1]) {
    ctx.beginPath();
    ctx.moveTo(r * 0.55, k * r * 0.42);
    ctx.lineTo(r * 0.95, k * r * 0.5);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * A little wing on the upper back: points out and up, rises when the arms would
 * be raised, and flaps (faster in the air). `raise` 0..1, `flap` 0..1.
 */
function wing(ctx, sx, sy, side, raise, flap, t, colors) {
  const L = 24;
  const ang = -0.4 - raise * 0.85 + Math.sin(t * (5 + flap * 16) + (side > 0 ? 0 : 0.4)) * (0.1 + flap * 0.4);
  ctx.save();
  ctx.translate(side * (sx - 8), sy - 9);
  ctx.scale(side, 1); // the left wing is a mirror image
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(0, 2.5);
  ctx.bezierCurveTo(L * 0.3, -9, L * 0.8, -10.5, L, -4.5); // leading edge
  ctx.quadraticCurveTo(L * 0.99, 1, L * 0.8, 0.8); // feathered trailing edge
  ctx.quadraticCurveTo(L * 0.75, 6, L * 0.56, 4);
  ctx.quadraticCurveTo(L * 0.5, 8.5, L * 0.33, 6);
  ctx.quadraticCurveTo(L * 0.18, 9, 0, 6.5);
  fillStroke(ctx, colors.bodyLight, colors.outline);
  ctx.strokeStyle = colors.outline;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(L * 0.3, 1.5);
  ctx.quadraticCurveTo(L * 0.55, -1.5, L * 0.76, -2.2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();
}

/**
 * Arm pass behind the body.
 * @param o.t     time (wings flap)
 * @param o.flap  0..1 how hard the wings flap (in the air: a lot)
 */
export function armBack(ctx, style, sx, sy, hx, hy, bend, colors, side, o = {}) {
  switch (style) {
    case 'nubby':
    case 'paws':
      taper(ctx, sx - side * 3, sy, hx, hy, bend, 10.5, 8.5);
      fillStroke(ctx, colors.body, colors.outline);
      break;
    case 'tiny': {
      const [tx, ty] = tinyHand(sx, sy, hx, hy);
      taper(ctx, sx - side * 3, sy, tx, ty, 0, 11, 9.5);
      fillStroke(ctx, colors.body, colors.outline);
      break;
    }
    case 'gloves': {
      // Thin toon arms in the outline color.
      const { cx, cy } = bow(sx, sy, hx, hy, bend);
      ctx.lineCap = 'round';
      ctx.strokeStyle = colors.outline;
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(sx - side * 2, sy);
      ctx.quadraticCurveTo(cx, cy, hx, hy);
      ctx.stroke();
      break;
    }
    case 'wings': {
      const raise = Math.min(1, Math.max(0, (sy - hy) / 30));
      wing(ctx, Math.abs(sx), sy, side, raise, o.flap ?? 0.15, o.t ?? 0, colors);
      break;
    }
    default:
      break;
  }
}

/** A soft round hand resting on the body (so it shows up against it). */
function mitt(ctx, x, y, colors) {
  ctx.beginPath();
  ctx.arc(x, y, 5.3, 0, TAU);
  fillStroke(ctx, colors.bodyLight, colors.outline, 2.3);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.ellipse(x - 1.6, y - 1.9, 1.9, 1.2, -0.5, 0, TAU);
  ctx.fill();
}

/**
 * Arm pass in front of the body (the forearm/hand), plus the whole arm for "noodle".
 * @param o.inside (x, y) => is this point over the body? (hands there get a full outline)
 */
export function armFront(ctx, style, sx, sy, hx, hy, bend, colors, side, o = {}) {
  switch (style) {
    case 'nubby':
      if (o.inside?.(hx, hy)) mitt(ctx, hx, hy, colors);
      else {
        taper(ctx, sx - side * 3, sy, hx, hy, bend, 10.5, 8.5, 0.74);
        fillStroke(ctx, colors.body, colors.outline, OUT, false);
      }
      break;
    case 'paws': {
      const e = taper(ctx, sx - side * 3, sy, hx, hy, bend, 10.5, 8.5, 0.74);
      fillStroke(ctx, colors.body, colors.outline, OUT, false);
      paw(ctx, hx, hy, e.a, 5.4, colors);
      break;
    }
    case 'tiny': // too short to reach in front of itself
      break;
    case 'gloves': {
      const { cx, cy } = bow(sx, sy, hx, hy, bend);
      glove(ctx, hx, hy, Math.atan2(hy - cy, hx - cx), colors.outline);
      break;
    }
    case 'wings':
    case 'none':
      break;
    default:
      // noodle: the original thin arm with a ball hand
      hose(ctx, sx, sy, hx, hy, bend, 5, colors.body, colors.outline);
      ball(ctx, hx, hy, 4.6, colors.body, colors.outline);
  }
}

/** T-rex arms: pointed the right way, but they only reach so far. */
function tinyHand(sx, sy, hx, hy) {
  const dx = hx - sx;
  const dy = hy - sy;
  const len = Math.hypot(dx, dy) || 1;
  const k = Math.min(1, 9 / len);
  return [sx + dx * k, sy + dy * k];
}

/** Where a hand actually ends up for this arm style (for things held in it). */
export function handAt(style, sx, sy, hx, hy) {
  return style === 'tiny' ? tinyHand(sx, sy, hx, hy) : [hx, hy];
}

// ---- legs ---------------------------------------------------------------------------------

function shoe(ctx, x, y, dir, lift, draw) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-lift * 0.5 * dir);
  draw();
  ctx.restore();
}

/**
 * One leg from the hip (hx, hy) to the foot (fx, fy): `dir` is -1 for the left foot
 * (toes point outward), `lift` tilts the foot while stepping.
 */
export function leg(ctx, style, hx, hy, fx, fy, bend, lift, dir, colors, accent) {
  switch (style) {
    case 'stubby': {
      taper(ctx, hx, hy - 3, fx, fy - 3, bend * 0.5, 9.5, 8.5);
      fillStroke(ctx, colors.body, colors.outline);
      shoe(ctx, fx, fy, dir, lift, () => {
        ctx.beginPath();
        ctx.ellipse(dir * 1.8, -3.2, 7, 4.6, 0, 0, TAU);
        fillStroke(ctx, colors.bodyDark, colors.outline, 2.2);
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.beginPath();
        ctx.ellipse(dir * 0.5 - 1.5, -5.3, 3, 1.3, 0, 0, TAU);
        ctx.fill();
      });
      break;
    }
    case 'sneakers':
      hose(ctx, hx, hy, fx, fy - 3, bend, 4.6, colors.body, colors.outline);
      shoe(ctx, fx, fy, dir, lift, () => {
        ctx.beginPath();
        ctx.moveTo(dir * -5, -1);
        ctx.quadraticCurveTo(dir * -6, -7.5, dir * 0.5, -7);
        ctx.quadraticCurveTo(dir * 3.5, -6.8, dir * 5.5, -3.8);
        ctx.quadraticCurveTo(dir * 9, -2.6, dir * 8.4, -0.5);
        ctx.lineTo(dir * -5, -0.5);
        fillStroke(ctx, '#FFFFFF', colors.outline, 2);
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.ellipse(dir * -0.6, -4.4, 3, 1.1, dir * -0.35, 0, TAU);
        ctx.fill();
        ctx.fillStyle = colors.outline;
        ctx.fillRect(Math.min(dir * -5.4, dir * 8.8), -1.2, 14.2, 1.9); // sole
      });
      break;
    case 'boots':
      hose(ctx, hx, hy, fx, fy - 7, bend, 5, colors.body, colors.outline);
      shoe(ctx, fx, fy, dir, lift, () => {
        ctx.beginPath();
        ctx.moveTo(dir * -4.6, -11);
        ctx.lineTo(dir * 3, -11);
        ctx.lineTo(dir * 3.2, -4.6);
        ctx.quadraticCurveTo(dir * 8.6, -4.4, dir * 8.2, -0.5);
        ctx.lineTo(dir * -4.8, -0.5);
        fillStroke(ctx, accent, colors.outline, 2);
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillRect(Math.min(dir * -3, dir * -1.6), -9.6, 1.4, 5.5); // shine
        ctx.strokeStyle = colors.outline;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(dir * -4.6, -8.8);
        ctx.lineTo(dir * 3.05, -8.8);
        ctx.stroke();
      });
      break;
    case 'paws':
      taper(ctx, hx, hy - 3, fx, fy - 4, bend * 0.5, 9.5, 8.5);
      fillStroke(ctx, colors.body, colors.outline);
      shoe(ctx, fx, fy, dir, lift, () => paw(ctx, dir * 1.2, -4.4, dir > 0 ? 0 : Math.PI, 5.2, colors));
      break;
    case 'stick': {
      const { cx, cy } = bow(hx, hy, fx, fy - 2, bend);
      ctx.lineCap = 'round';
      ctx.strokeStyle = colors.outline;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.quadraticCurveTo(cx, cy, fx, fy - 2);
      ctx.stroke();
      shoe(ctx, fx, fy, dir, lift, () => {
        ctx.beginPath();
        ctx.ellipse(dir * 2, -2.2, 4.4, 2.6, 0, 0, TAU);
        ctx.fillStyle = colors.outline;
        ctx.fill();
      });
      break;
    }
    default:
      // noodle: the original thin leg with a dark oval foot
      hose(ctx, hx, hy, fx, fy - 2, bend, 5.2, colors.body, colors.outline);
      shoe(ctx, fx, fy, dir, lift, () => {
        ctx.beginPath();
        ctx.ellipse(dir * 1.5, -2.6, 6.4, 4.2, 0, 0, TAU);
        ctx.fillStyle = colors.outline;
        ctx.fill();
      });
  }
}

/** Just the foot (for sitting poses, where feet are drawn in front of the body). */
export function footOnly(ctx, style, fx, fy, dir, colors, accent) {
  // Re-use leg() with a zero-length leg hidden under the foot.
  leg(ctx, style, fx, fy - 2, fx, fy, 0, 0, dir, colors, accent);
}
