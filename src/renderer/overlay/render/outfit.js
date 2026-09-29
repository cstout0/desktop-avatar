// Hats, glasses and neckwear, drawn in body-local coordinates (body center at
// 0,0; the top of the head is at y = -23). They squash, tilt and flip with the
// body because they're drawn inside its transform.
import { TAU } from '../sim/util.js';

const INK = '#2B2230';
const GOLD = '#F5C04E';
const GOLD_DARK = '#C98F1E';

function outlined(ctx, fill, outline, width = 2) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = width;
  ctx.strokeStyle = outline;
  ctx.stroke();
}

function starPath(ctx, x, y, r, points = 5, inner = 0.45, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rr = i % 2 === 0 ? r : r * inner;
    const a = rot + (i * Math.PI) / points;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function heartPath(ctx, x, y, w) {
  const h = w * 0.9;
  ctx.beginPath();
  ctx.moveTo(x, y + h * 0.55);
  ctx.bezierCurveTo(x - w * 0.95, y - h * 0.05, x - w * 0.5, y - h * 0.75, x, y - h * 0.22);
  ctx.bezierCurveTo(x + w * 0.5, y - h * 0.75, x + w * 0.95, y - h * 0.05, x, y + h * 0.55);
  ctx.closePath();
}

/** Lighten/darken a #rrggbb color by `amt` (-1..1). */
export function tint(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt));
  const r = f(n >> 16);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `rgb(${r}, ${g}, ${b})`;
}

// ---- neckwear --------------------------------------------------------------------------

export function drawNeck(ctx, id, { accent, outline }) {
  if (!id || id === 'none') return;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  switch (id) {
    case 'bowtie': {
      const y = 15;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.quadraticCurveTo(side * 5, y - 7, side * 10.5, y - 5.5);
        ctx.quadraticCurveTo(side * 12, y, side * 10.5, y + 5.5);
        ctx.quadraticCurveTo(side * 5, y + 7, 0, y);
        outlined(ctx, accent, outline, 1.8);
      }
      ctx.beginPath();
      ctx.ellipse(0, y, 3, 3.6, 0, 0, TAU);
      outlined(ctx, tint(accent, -0.2), outline, 1.8);
      break;
    }
    case 'scarf': {
      ctx.beginPath();
      ctx.moveTo(-22, 9);
      ctx.quadraticCurveTo(0, 16, 22, 9);
      ctx.lineTo(22.5, 15.5);
      ctx.quadraticCurveTo(0, 23, -22.5, 15.5);
      ctx.closePath();
      outlined(ctx, accent, outline, 2);
      // Knit stripes and a dangling end.
      ctx.strokeStyle = tint(accent, 0.35);
      ctx.lineWidth = 1.4;
      for (let x = -16; x <= 16; x += 8) {
        ctx.beginPath();
        ctx.moveTo(x, 11 + Math.abs(x) * -0.12 + 2);
        ctx.lineTo(x + 1, 18 + Math.abs(x) * -0.14);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(9, 16);
      ctx.lineTo(14.5, 31);
      ctx.lineTo(7, 32);
      ctx.lineTo(3, 17.5);
      ctx.closePath();
      outlined(ctx, accent, outline, 2);
      ctx.strokeStyle = outline;
      ctx.lineWidth = 1.3;
      for (const fx of [8.5, 10.5, 12.5]) {
        ctx.beginPath();
        ctx.moveTo(fx, 31.6);
        ctx.lineTo(fx + 0.4, 34.5);
        ctx.stroke();
      }
      break;
    }
    case 'bandana': {
      ctx.beginPath();
      ctx.moveTo(-19, 10);
      ctx.quadraticCurveTo(0, 15, 19, 10);
      ctx.quadraticCurveTo(8, 18, 0, 27);
      ctx.quadraticCurveTo(-8, 18, -19, 10);
      ctx.closePath();
      outlined(ctx, accent, outline, 2);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      for (const [dx, dy] of [
        [-8, 14],
        [0, 16],
        [8, 14],
        [-3, 20.5],
        [3.5, 21],
      ]) {
        ctx.beginPath();
        ctx.arc(dx, dy, 1.1, 0, TAU);
        ctx.fill();
      }
      break;
    }
    case 'bell': {
      ctx.beginPath();
      ctx.moveTo(-21, 10.5);
      ctx.quadraticCurveTo(0, 17.5, 21, 10.5);
      ctx.lineWidth = 5.4;
      ctx.strokeStyle = outline;
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.strokeStyle = accent;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 19.5, 4.6, 0, TAU);
      outlined(ctx, GOLD, outline, 1.7);
      ctx.beginPath();
      ctx.moveTo(-3, 20);
      ctx.lineTo(3, 20);
      ctx.strokeStyle = GOLD_DARK;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 22, 1, 0, TAU);
      ctx.fillStyle = outline;
      ctx.fill();
      break;
    }
    case 'lei': {
      const cols = [accent, '#FFFFFF', GOLD, tint(accent, 0.45)];
      for (let i = 0; i <= 8; i++) {
        const x = -20 + i * 5;
        const y = 10.5 + (1 - ((x / 20) ** 2)) * 6.5;
        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = cols[i % cols.length];
        ctx.strokeStyle = outline;
        ctx.lineWidth = 1.1;
        for (let p = 0; p < 5; p++) {
          ctx.beginPath();
          ctx.ellipse(Math.cos((p * TAU) / 5) * 2, Math.sin((p * TAU) / 5) * 2, 1.9, 1.9, 0, 0, TAU);
          ctx.fill();
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(0, 0, 1.1, 0, TAU);
        ctx.fillStyle = GOLD_DARK;
        ctx.fill();
        ctx.restore();
      }
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

// ---- glasses (face-local: eye centers at (±10.5 + lx, -4 + ly)) -------------------------

export function drawGlasses(ctx, id, { accent, outline, lx = 0, ly = 0 }) {
  if (!id || id === 'none') return;
  const ex = 10.5;
  const ey = -4 + ly;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const bridge = (y = ey - 1, curve = 2) => {
    ctx.beginPath();
    ctx.moveTo(-ex + 5.2 + lx, y);
    ctx.quadraticCurveTo(lx, y - curve, ex - 5.2 + lx, y);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.8;
    ctx.stroke();
  };
  const arms = (y = ey - 1.5) => {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.6;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * (ex + 6) + lx, y);
      ctx.lineTo(side * 21.5, y - 1.5);
      ctx.stroke();
    }
  };
  switch (id) {
    case 'round': {
      arms();
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(side * ex + lx, ey, 6.2, 0, TAU);
        ctx.fillStyle = 'rgba(200, 230, 255, 0.18)';
        ctx.fill();
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.9;
        ctx.stroke();
      }
      bridge();
      break;
    }
    case 'shades': {
      arms(ey - 2.5);
      for (const side of [-1, 1]) {
        const x = side * ex + lx;
        ctx.beginPath();
        ctx.moveTo(x - 7, ey - 5);
        ctx.lineTo(x + 7, ey - 5);
        ctx.quadraticCurveTo(x + 7.2, ey + 5.5, x, ey + 5.2);
        ctx.quadraticCurveTo(x - 7.2, ey + 5.5, x - 7, ey - 5);
        ctx.closePath();
        ctx.fillStyle = '#17141C';
        ctx.fill();
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(x - 4.5, ey - 2.5);
        ctx.lineTo(x - 1.5, ey - 3.3);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(-ex + 7 + lx, ey - 4.2);
      ctx.lineTo(ex - 7 + lx, ey - 4.2);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.stroke();
      break;
    }
    case 'star':
    case 'heart': {
      arms();
      for (const side of [-1, 1]) {
        const x = side * ex + lx;
        if (id === 'star') starPath(ctx, x, ey + 0.5, 8.4, 5, 0.52, -Math.PI / 2 + side * 0.12);
        else heartPath(ctx, x, ey + 0.8, 8.2);
        ctx.fillStyle = id === 'star' ? `${accent}66` : 'rgba(232, 69, 90, 0.4)';
        ctx.fill();
        ctx.strokeStyle = id === 'star' ? accent : '#E8455A';
        ctx.lineWidth = 2.4;
        ctx.stroke();
      }
      bridge(ey - 0.5, 1);
      break;
    }
    case 'monocle': {
      const x = ex + lx;
      ctx.beginPath();
      ctx.arc(x, ey, 6.6, 0, TAU);
      ctx.fillStyle = 'rgba(200, 230, 255, 0.2)';
      ctx.fill();
      ctx.strokeStyle = GOLD_DARK;
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + 4.6, ey + 4.8);
      ctx.bezierCurveTo(x + 9, ey + 12, x + 4, ey + 17, x + 8, ey + 23);
      ctx.strokeStyle = GOLD_DARK;
      ctx.lineWidth = 1.1;
      ctx.setLineDash([1.6, 1.4]);
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

// ---- hats ---------------------------------------------------------------------------------

/**
 * @param info.accent  accessory color
 * @param info.outline outline color (matches the body)
 * @param info.t       time (s), for spinning/wobbling bits
 * @param info.spin    0..1 how fast a propeller should spin (movement)
 */
export function drawHat(ctx, id, { accent, outline, t = 0, spin = 0 }) {
  if (!id || id === 'none') return;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  switch (id) {
    case 'party': {
      // The antenna pokes out of the tip, so its sparkle is the topper.
      const cone = () => {
        ctx.beginPath();
        ctx.moveTo(-13, -18.5);
        ctx.lineTo(0, -41);
        ctx.lineTo(13, -18.5);
        ctx.quadraticCurveTo(0, -14.5, -13, -18.5);
        ctx.closePath();
      };
      cone();
      ctx.fillStyle = accent;
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 3;
      for (let k = -2; k <= 3; k++) {
        ctx.beginPath();
        ctx.moveTo(-18, -22 + k * 7);
        ctx.lineTo(18, -30 + k * 7);
        ctx.stroke();
      }
      ctx.restore();
      cone();
      ctx.lineWidth = 2;
      ctx.strokeStyle = outline;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -40.5, 2.6, 0, TAU);
      outlined(ctx, GOLD, outline, 1.4);
      break;
    }
    case 'tophat': {
      ctx.beginPath();
      ctx.ellipse(0, -18.5, 17.5, 4.2, 0, 0, TAU);
      outlined(ctx, '#26222C', outline, 2);
      ctx.beginPath();
      ctx.moveTo(-10.5, -19.5);
      ctx.lineTo(-11.5, -40);
      ctx.quadraticCurveTo(0, -42.5, 11.5, -40);
      ctx.lineTo(10.5, -19.5);
      ctx.quadraticCurveTo(0, -17.5, -10.5, -19.5);
      ctx.closePath();
      outlined(ctx, '#2F2A36', outline, 2);
      ctx.beginPath();
      ctx.moveTo(-10.8, -25.5);
      ctx.quadraticCurveTo(0, -23.5, 10.8, -25.5);
      ctx.lineTo(10.6, -21.5);
      ctx.quadraticCurveTo(0, -19.5, -10.6, -21.5);
      ctx.closePath();
      ctx.fillStyle = accent;
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(-8.5, -39, 3, 12);
      break;
    }
    case 'crown': {
      ctx.beginPath();
      ctx.moveTo(-13, -17.5);
      ctx.lineTo(-14.5, -31);
      ctx.lineTo(-7.5, -24.5);
      ctx.lineTo(0, -34);
      ctx.lineTo(7.5, -24.5);
      ctx.lineTo(14.5, -31);
      ctx.lineTo(13, -17.5);
      ctx.quadraticCurveTo(0, -15, -13, -17.5);
      ctx.closePath();
      outlined(ctx, GOLD, outline, 2);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(-11, -22, 22, 1.6);
      for (const [gx, gy, r] of [
        [0, -21, 2.4],
        [-8, -20.4, 1.7],
        [8, -20.4, 1.7],
      ]) {
        ctx.beginPath();
        ctx.arc(gx, gy, r, 0, TAU);
        outlined(ctx, accent, outline, 1.1);
      }
      for (const [px, py] of [
        [-14.5, -31],
        [0, -34],
        [14.5, -31],
      ]) {
        ctx.beginPath();
        ctx.arc(px, py, 1.9, 0, TAU);
        outlined(ctx, '#FFFFFF', outline, 1);
      }
      break;
    }
    case 'beanie': {
      ctx.beginPath();
      ctx.moveTo(-19, -13);
      ctx.bezierCurveTo(-19, -31, 19, -31, 19, -13);
      ctx.closePath();
      outlined(ctx, accent, outline, 2);
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = tint(accent, -0.18);
      ctx.lineWidth = 1.3;
      for (let x = -15; x <= 15; x += 5) {
        ctx.beginPath();
        ctx.moveTo(x, -12);
        ctx.quadraticCurveTo(x * 0.8, -22, x * 0.45, -30);
        ctx.stroke();
      }
      ctx.restore();
      ctx.beginPath();
      ctx.moveTo(-20, -16.5);
      ctx.quadraticCurveTo(0, -20.5, 20, -16.5);
      ctx.lineTo(20, -11.5);
      ctx.quadraticCurveTo(0, -15, -20, -11.5);
      ctx.closePath();
      outlined(ctx, tint(accent, -0.15), outline, 2);
      ctx.beginPath();
      ctx.arc(0, -29.5, 4.2, 0, TAU);
      outlined(ctx, tint(accent, 0.55), outline, 1.6);
      break;
    }
    case 'cowboy': {
      const brown = '#9B5E34';
      ctx.beginPath();
      ctx.moveTo(-10, -20);
      ctx.bezierCurveTo(-11, -34, -4, -31, 0, -28.5);
      ctx.bezierCurveTo(4, -31, 11, -34, 10, -20);
      ctx.closePath();
      outlined(ctx, brown, outline, 2);
      ctx.beginPath();
      ctx.moveTo(-10, -22.5);
      ctx.quadraticCurveTo(0, -20.5, 10, -22.5);
      ctx.lineTo(10.2, -19.5);
      ctx.quadraticCurveTo(0, -17.5, -10.2, -19.5);
      ctx.closePath();
      ctx.fillStyle = accent;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-25, -22.5);
      ctx.quadraticCurveTo(-20, -16, 0, -16.5);
      ctx.quadraticCurveTo(20, -16, 25, -22.5);
      ctx.quadraticCurveTo(21, -13, 0, -13);
      ctx.quadraticCurveTo(-21, -13, -25, -22.5);
      ctx.closePath();
      outlined(ctx, tint('#9B5E34', 0.12), outline, 2);
      break;
    }
    case 'wizard': {
      // Tall cone with a floppy curl; the antenna comes out of the peak.
      ctx.beginPath();
      ctx.moveTo(-13, -18.5);
      ctx.quadraticCurveTo(-5, -34, -1, -50);
      ctx.quadraticCurveTo(6, -53, 11, -47);
      ctx.quadraticCurveTo(5, -47, 3, -43);
      ctx.quadraticCurveTo(8, -28, 13.5, -18.5);
      ctx.closePath();
      outlined(ctx, accent, outline, 2);
      ctx.fillStyle = GOLD;
      for (const [sx, sy, r] of [
        [-3, -26, 2.6],
        [5, -33, 1.9],
        [2, -40, 1.5],
      ]) {
        starPath(ctx, sx, sy, r, 5, 0.45, t * 0.3);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.ellipse(0, -18, 19.5, 4, 0, 0, TAU);
      outlined(ctx, tint(accent, -0.22), outline, 2);
      break;
    }
    case 'pirate': {
      ctx.beginPath();
      ctx.moveTo(-24, -20);
      ctx.quadraticCurveTo(-18, -24, -11, -30);
      ctx.quadraticCurveTo(0, -38, 11, -30);
      ctx.quadraticCurveTo(18, -24, 24, -20);
      ctx.quadraticCurveTo(12, -14, 0, -15.5);
      ctx.quadraticCurveTo(-12, -14, -24, -20);
      ctx.closePath();
      outlined(ctx, '#23202A', outline, 2);
      ctx.beginPath();
      ctx.moveTo(-22, -20.2);
      ctx.quadraticCurveTo(-12, -16, 0, -17.2);
      ctx.quadraticCurveTo(12, -16, 22, -20.2);
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      // Skull and crossbones.
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-4.5, -21);
      ctx.lineTo(4.5, -26);
      ctx.moveTo(4.5, -21);
      ctx.lineTo(-4.5, -26);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -27, 3, 0, TAU);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.fillStyle = '#23202A';
      ctx.beginPath();
      ctx.arc(-1.1, -27.3, 0.7, 0, TAU);
      ctx.arc(1.1, -27.3, 0.7, 0, TAU);
      ctx.fill();
      break;
    }
    case 'chef': {
      ctx.beginPath();
      ctx.moveTo(-11, -18);
      ctx.lineTo(-12, -28);
      ctx.bezierCurveTo(-21, -30, -17, -44, -8, -40);
      ctx.bezierCurveTo(-7, -49, 7, -49, 8, -40);
      ctx.bezierCurveTo(17, -44, 21, -30, 12, -28);
      ctx.lineTo(11, -18);
      ctx.quadraticCurveTo(0, -16, -11, -18);
      ctx.closePath();
      outlined(ctx, '#FFFFFF', outline, 2);
      ctx.strokeStyle = 'rgba(74, 35, 23, 0.25)';
      ctx.lineWidth = 1.2;
      for (const x of [-4, 4]) {
        ctx.beginPath();
        ctx.moveTo(x, -21);
        ctx.lineTo(x * 1.2, -30);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(-11.3, -22);
      ctx.quadraticCurveTo(0, -20, 11.3, -22);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.stroke();
      break;
    }
    case 'propeller': {
      const segs = [accent, GOLD, '#3E8EDE', '#4FAE6A'];
      const dome = () => {
        ctx.beginPath();
        ctx.moveTo(-19, -14);
        ctx.bezierCurveTo(-19, -32, 19, -32, 19, -14);
        ctx.quadraticCurveTo(0, -17, -19, -14);
        ctx.closePath();
      };
      // Four colored wedges fanned out from the middle of the brim, clipped to the dome.
      dome();
      ctx.save();
      ctx.clip();
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(0, -14);
        const a0 = Math.PI + (i * Math.PI) / 4;
        const a1 = Math.PI + ((i + 1) * Math.PI) / 4;
        ctx.lineTo(Math.cos(a0) * 40, -14 + Math.sin(a0) * 40);
        ctx.lineTo(Math.cos(a1) * 40, -14 + Math.sin(a1) * 40);
        ctx.closePath();
        ctx.fillStyle = segs[i];
        ctx.fill();
      }
      ctx.restore();
      dome();
      ctx.lineWidth = 2;
      ctx.strokeStyle = outline;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(12, -15.5);
      ctx.quadraticCurveTo(22, -15, 26, -12.5);
      ctx.quadraticCurveTo(21, -11.5, 11, -12.5);
      ctx.closePath();
      outlined(ctx, accent, outline, 1.6);
      // Spinning blades: faster when moving.
      const ang = t * (3 + spin * 26);
      const w = Math.cos(ang) * 13;
      ctx.beginPath();
      ctx.moveTo(0, -30);
      ctx.lineTo(0, -34.5);
      ctx.strokeStyle = outline;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, -35, Math.abs(w) + 0.8, 2.3, 0, 0, TAU);
      outlined(ctx, w > 0 ? '#E8455A' : '#3E8EDE', outline, 1.5);
      break;
    }
    case 'headphones': {
      ctx.beginPath();
      ctx.moveTo(-23, -5);
      ctx.bezierCurveTo(-24, -33, 24, -33, 23, -5);
      ctx.lineWidth = 5.6;
      ctx.strokeStyle = outline;
      ctx.stroke();
      ctx.lineWidth = 3.2;
      ctx.strokeStyle = '#3A3542';
      ctx.stroke();
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(side * 23.5, -2, 5.2, 8, 0, 0, TAU);
        outlined(ctx, accent, outline, 2);
        ctx.beginPath();
        ctx.ellipse(side * 25.5, -2, 2, 5, 0, 0, TAU);
        ctx.fillStyle = tint(accent, -0.25);
        ctx.fill();
      }
      break;
    }
    case 'catears': {
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(side * 7, -21.5);
        ctx.lineTo(side * 16, -34);
        ctx.lineTo(side * 20, -15.5);
        ctx.closePath();
        outlined(ctx, '#4A4250', outline, 2);
        ctx.beginPath();
        ctx.moveTo(side * 10.5, -21);
        ctx.lineTo(side * 15.5, -29);
        ctx.lineTo(side * 17.5, -18.5);
        ctx.closePath();
        ctx.fillStyle = '#F7A8C4';
        ctx.fill();
      }
      break;
    }
    case 'bow': {
      ctx.save();
      ctx.translate(11.5, -20);
      ctx.rotate(0.35);
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(side * 5, -9, side * 12, -6, side * 11, 0);
        ctx.bezierCurveTo(side * 12, 6, side * 5, 9, 0, 0);
        outlined(ctx, accent, outline, 1.8);
      }
      ctx.beginPath();
      ctx.ellipse(0, 0, 2.8, 3.4, 0, 0, TAU);
      outlined(ctx, tint(accent, -0.2), outline, 1.6);
      ctx.restore();
      break;
    }
    case 'flower': {
      ctx.save();
      ctx.translate(-12, -19.5);
      ctx.rotate(Math.sin(t * 1.4) * 0.12);
      for (let p = 0; p < 6; p++) {
        const a = (p * TAU) / 6;
        ctx.beginPath();
        ctx.ellipse(Math.cos(a) * 4.6, Math.sin(a) * 4.6, 3.6, 2.4, a, 0, TAU);
        outlined(ctx, '#FFFFFF', outline, 1.3);
      }
      ctx.beginPath();
      ctx.arc(0, 0, 3, 0, TAU);
      outlined(ctx, GOLD, outline, 1.3);
      ctx.restore();
      break;
    }
    default:
      break;
  }
  ctx.restore();
}
