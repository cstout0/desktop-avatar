// Body shapes. Each one is an outline plus the spots where everything attaches
// (arms, legs, face, hat, neckwear), all in body-local units: the body center is
// at 0,0, y points down, and the feet touch the ground at y = 35 (CENTER_Y).
// The classic gumdrop spans x -25..25, y -23..23; hats and neckwear are drawn for
// that one and get moved/stretched to fit the others.
import { TAU } from './sim/util.js';

/** A polygon with rounded corners (r: one radius, or a list repeated around the corners). */
function roundedPoly(ctx, pts, r) {
  const n = pts.length;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(pts[n - 1], pts[0]);
  ctx.beginPath();
  ctx.moveTo(start[0], start[1]);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const m = mid(p, pts[(i + 1) % n]);
    ctx.arcTo(p[0], p[1], m[0], m[1], Array.isArray(r) ? r[i % r.length] : r);
  }
  ctx.closePath();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** A mirror-symmetric outline from its right half: [x, y] anchors joined by cubic curves. */
function symmetric(ctx, top, right) {
  // `right` is a list of [c1x, c1y, c2x, c2y, x, y] curve segments from the top center
  // down the right side to the bottom center; the left side is the mirror image.
  ctx.beginPath();
  ctx.moveTo(0, top);
  for (const [a, b, c, d, x, y] of right) ctx.bezierCurveTo(a, b, c, d, x, y);
  for (let i = right.length - 1; i >= 0; i--) {
    const [a, b, c, d] = right[i];
    const [px, py] = i > 0 ? right[i - 1].slice(4) : [0, top];
    ctx.bezierCurveTo(-c, d, -a, b, -px, py);
  }
  ctx.closePath();
}

const STAR = (() => {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 30 : 17;
    pts.push([Math.cos(a) * r, 3 + Math.sin(a) * r]);
  }
  return pts;
})();

/**
 * @typedef Shape
 * @property top      head top (antenna root, hats sit here)
 * @property bottom   lowest point of the body
 * @property hw       half width at the widest
 * @property shoulder [x, y] arm roots (mirrored)
 * @property hip      [x, y] leg roots (mirrored), or null: no legs (it glides or hops)
 * @property face     vertical offset of eyes and mouth
 * @property belly    [x, y, rx, ry] lighter tummy patch, or null
 * @property shine    [x, y, rx, ry, rotation] glossy highlight
 * @property blush    [x, y] cheek position
 * @property neck     [dy, sx] move/stretch neckwear
 * @property float    hovers this far above the ground (legless ghosts and clouds)
 * @property gait     how it gets around when the walk style is "Natural"
 */
export const BODIES = [
  {
    id: 'classic',
    label: 'Classic',
    emoji: '🍬',
    top: -23,
    bottom: 23,
    hw: 25,
    shoulder: [22, 3],
    hip: [8, 17],
    face: 0,
    belly: [0, 15, 15, 10],
    shine: [-12, -13, 7, 4.2, -0.5],
    blush: [16.5, 4.5],
    neck: [0, 1],
    float: 0,
    gait: 'walk',
    path(ctx) {
      symmetric(ctx, -23, [
        [18.5, -23, 25, -10.6, 25, 2.8],
        [25, 16.6, 15.5, 23, 0, 23],
      ]);
    },
  },
  {
    id: 'mochi',
    label: 'Mochi',
    emoji: '🍡',
    top: -23,
    bottom: 24,
    hw: 25.5,
    shoulder: [23, 4],
    hip: [8.5, 19],
    face: 1,
    belly: [0, 13, 16, 10],
    shine: [-12, -12, 7, 4.5, -0.6],
    blush: [17, 5.5],
    neck: [1, 1.02],
    float: 0,
    gait: 'walk',
    path(ctx) {
      ctx.beginPath();
      ctx.ellipse(0, 0.5, 25.5, 23.5, 0, 0, TAU);
      ctx.closePath();
    },
  },
  {
    id: 'bean',
    label: 'Bean',
    emoji: '🫘',
    top: -31,
    bottom: 26,
    hw: 20,
    shoulder: [18, 3],
    hip: [7, 22],
    face: -4,
    belly: [0, 13, 12, 10],
    shine: [-10, -17, 4, 7.5, 0.1],
    blush: [14, 1],
    neck: [-1, 0.84],
    float: 0,
    gait: 'walk',
    path(ctx) {
      roundRect(ctx, -20, -31, 40, 57, 20);
    },
  },
  {
    id: 'box',
    label: 'Toast',
    emoji: '🍞',
    top: -26,
    bottom: 22,
    hw: 27,
    shoulder: [23, 4],
    hip: [10, 18],
    face: 0,
    belly: [0, 12.5, 15, 8],
    shine: [-15, -15, 6, 3, -0.2],
    blush: [16.5, 5],
    neck: [0, 1.04],
    float: 0,
    gait: 'walk',
    path(ctx) {
      // A slice of toast: a puffy top crust over a square body.
      ctx.beginPath();
      ctx.moveTo(-22, -9);
      ctx.bezierCurveTo(-29, -12, -29, -24, -17, -24);
      ctx.bezierCurveTo(-9, -26.5, 9, -26.5, 17, -24);
      ctx.bezierCurveTo(29, -24, 29, -12, 22, -9);
      ctx.lineTo(23, 15);
      ctx.arcTo(23, 22, 16, 22, 7);
      ctx.lineTo(-16, 22);
      ctx.arcTo(-23, 22, -23, 15, 7);
      ctx.closePath();
    },
  },
  {
    id: 'pear',
    label: 'Pear',
    emoji: '🍐',
    top: -24,
    bottom: 24,
    hw: 27,
    shoulder: [20, 4],
    hip: [9, 19],
    face: 0,
    belly: [0, 13, 17, 9],
    shine: [-8, -16, 4, 5.5, -0.4],
    blush: [16, 5.5],
    neck: [3, 1.1],
    float: 0,
    gait: 'walk',
    path(ctx) {
      symmetric(ctx, -24, [
        [9, -24, 15, -18, 16, -10],
        [17, -3, 27, 1, 27, 11],
        [27, 20, 16, 24, 0, 24],
      ]);
    },
  },
  {
    id: 'heart',
    label: 'Heart',
    emoji: '💗',
    top: -13,
    bottom: 26,
    hw: 27,
    shoulder: [23, 2],
    hip: [6, 19],
    face: 0,
    belly: [0, 8, 11, 8],
    shine: [-16, -12, 5, 3.4, -0.7],
    blush: [17, 3],
    neck: [0, 0.72],
    float: 0,
    gait: 'walk',
    path(ctx) {
      ctx.beginPath();
      ctx.moveTo(0, -12);
      ctx.bezierCurveTo(4, -22, 27, -27, 27, -6);
      ctx.bezierCurveTo(27, 8, 10, 17, 0, 26);
      ctx.bezierCurveTo(-10, 17, -27, 8, -27, -6);
      ctx.bezierCurveTo(-27, -27, -4, -22, 0, -12);
      ctx.closePath();
    },
  },
  {
    id: 'star',
    label: 'Star',
    emoji: '⭐',
    top: -27,
    bottom: 27,
    hw: 29,
    shoulder: [22, -3],
    hip: [12, 21],
    face: 3,
    belly: null,
    shine: [-7, -13, 3, 5, -0.4],
    blush: [13.5, 7.5],
    neck: [3, 0.8],
    float: 0,
    gait: 'walk',
    path(ctx) {
      roundedPoly(ctx, STAR, [5, 3.5]);
    },
  },
  {
    id: 'ghost',
    label: 'Ghost',
    emoji: '👻',
    top: -27,
    bottom: 29,
    hw: 24,
    shoulder: [21, 6],
    hip: null,
    face: -4,
    belly: null,
    shine: [-12, -17, 6, 4, -0.6],
    blush: [15, 0.5],
    neck: [0, 1],
    float: 6,
    gait: 'float',
    path(ctx, t = 0) {
      // A dome with a wavy hem that ripples as it drifts.
      ctx.beginPath();
      ctx.moveTo(-24, 26);
      ctx.lineTo(-24, -3);
      ctx.arc(0, -3, 24, Math.PI, 0);
      ctx.lineTo(24, 26);
      const n = 4;
      const w = 48 / n;
      for (let i = 0; i < n; i++) {
        const x0 = 24 - i * w;
        const wave = Math.sin(t * 3.2 + i * 1.7) * 1.8;
        ctx.quadraticCurveTo(x0 - w * 0.25, 30.5 + wave, x0 - w * 0.5, 26.5 + wave * 0.4);
        ctx.quadraticCurveTo(x0 - w * 0.75, 23 - wave * 0.4, x0 - w, 26);
      }
      ctx.closePath();
    },
  },
  {
    id: 'slime',
    label: 'Slime',
    emoji: '🟢',
    top: -19,
    bottom: 35,
    hw: 31,
    shoulder: [21, 11],
    hip: null,
    face: 5,
    belly: [0, 21, 19, 10],
    shine: [-10, -8, 6, 4.2, -0.7],
    blush: [16.5, 11],
    neck: [6, 1.12],
    float: 0,
    gait: 'hop',
    hop: 0.55, // low, squishy hops
    path(ctx, t = 0) {
      // A jelly dome with a wide base that spreads over the floor; the top sways a little.
      const sway = Math.sin(t * 2.3) * 1.2;
      ctx.beginPath();
      ctx.moveTo(sway, -19);
      ctx.bezierCurveTo(15 + sway, -19, 21, -7, 23, 7);
      ctx.bezierCurveTo(25, 19, 32, 26, 31, 31);
      ctx.bezierCurveTo(30.5, 34.5, 27, 35, 22, 35);
      ctx.lineTo(-22, 35);
      ctx.bezierCurveTo(-27, 35, -30.5, 34.5, -31, 31);
      ctx.bezierCurveTo(-32, 26, -25, 19, -23, 7);
      ctx.bezierCurveTo(-21, -7, -15 + sway, -19, sway, -19);
      ctx.closePath();
    },
  },
  {
    id: 'cloud',
    label: 'Cloud',
    emoji: '☁️',
    top: -18,
    bottom: 24,
    hw: 31,
    shoulder: [25, 11],
    hip: null,
    face: 4,
    belly: null,
    shine: [-15, -3, 5, 3, -0.5],
    blush: [15, 9],
    neck: [4, 1],
    float: 3,
    gait: 'float',
    // Puffs overlap, so the outline is drawn first (thick) and the fill covers the inside lines.
    outlineFirst: true,
    path(ctx, t = 0) {
      const b = (k) => Math.sin(t * 1.6 + k) * 0.6; // the puffs breathe a little
      ctx.beginPath();
      for (const [x, y, r, k] of [
        [-15, 3, 13, 0],
        [1, -3, 15, 1.3],
        [16, 4, 12.5, 2.6],
        [-25, 13, 9, 3.9],
        [25.5, 13.5, 9, 5.2],
      ]) {
        ctx.moveTo(x + r + b(k), y);
        ctx.arc(x, y, r + b(k), 0, TAU);
      }
      ctx.moveTo(-26, 22);
      ctx.arcTo(-26, 9, 0, 9, 3);
      ctx.lineTo(26, 9);
      ctx.arcTo(28, 9, 28, 22, 3);
      ctx.arcTo(28, 24, 0, 24, 3);
      ctx.lineTo(-24, 24);
      ctx.arcTo(-26, 24, -26, 22, 2);
      ctx.closePath();
    },
  },
];

export const bodyOf = (look) => BODIES.find((b) => b.id === look?.body) ?? BODIES[0];

/** Does it walk on legs? (Some bodies have none; "Hover" legs hide them.) */
export const hasLegs = (look) => !!bodyOf(look).hip && look?.legs !== 'none';

/** How high it floats above the floor when it has no legs to stand on (body units). */
export function hoverOf(look) {
  const b = bodyOf(look);
  if (b.float) return b.float;
  return b.hip && look?.legs === 'none' ? 7 : 0;
}

export const ARMS = [
  { id: 'nubby', label: 'Nubby', emoji: '🤲', hint: 'Chubby little arms' },
  { id: 'noodle', label: 'Noodle', emoji: '🍜', hint: 'Thin and bendy' },
  { id: 'tiny', label: 'Tiny', emoji: '🦖', hint: 'T-rex arms' },
  { id: 'gloves', label: 'Cartoon gloves', emoji: '🧤', hint: 'Old-school toon' },
  { id: 'paws', label: 'Paws', emoji: '🐾', hint: 'Soft paws' },
  { id: 'wings', label: 'Wings', emoji: '🪽', hint: 'Little wings' },
  { id: 'none', label: 'None', emoji: '🫥', hint: 'No arms at all' },
];

export const LEGS = [
  { id: 'stubby', label: 'Stubby', emoji: '🦶', hint: 'Short and chunky' },
  { id: 'noodle', label: 'Noodle', emoji: '🍜', hint: 'Thin and bendy' },
  { id: 'sneakers', label: 'Sneakers', emoji: '👟', hint: 'Ready to run' },
  { id: 'boots', label: 'Boots', emoji: '🥾', hint: 'Rain boots (accent color)' },
  { id: 'paws', label: 'Paws', emoji: '🐾', hint: 'Soft paws' },
  { id: 'stick', label: 'Stick', emoji: '🖊️', hint: 'Thin lines' },
  { id: 'none', label: 'Hover', emoji: '🛸', hint: 'No legs: it floats' },
];

// Antenna tips (the glowing bit on top).
export const ANTENNAS = [
  { id: 'sparkle', label: 'Sparkle' },
  { id: 'star', label: 'Star' },
  { id: 'heart', label: 'Heart' },
  { id: 'bulb', label: 'Bulb' },
  { id: 'sprout', label: 'Sprout' },
  { id: 'none', label: 'None' },
];
