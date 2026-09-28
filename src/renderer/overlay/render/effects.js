import { clamp, TAU } from '../sim/util.js';
import { COLORS } from './character.js';

function star(ctx, x, y, r, rot) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = rot + (i * Math.PI) / 4;
    const rr = i % 2 === 0 ? r : r * 0.4;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function heart(ctx, x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x, y + r * 0.9);
  ctx.bezierCurveTo(x - r * 1.5, y - r * 0.2, x - r * 0.8, y - r * 1.4, x, y - r * 0.55);
  ctx.bezierCurveTo(x + r * 0.8, y - r * 1.4, x + r * 1.5, y - r * 0.2, x, y + r * 0.9);
  ctx.closePath();
}

function note(ctx, x, y, r) {
  ctx.beginPath();
  ctx.ellipse(x - r * 0.35, y + r * 0.55, r * 0.42, r * 0.32, -0.4, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + 0.02 * r, y + r * 0.5);
  ctx.lineTo(x + 0.02 * r, y - r * 0.8);
  ctx.quadraticCurveTo(x + r * 0.6, y - r * 0.5, x + r * 0.55, y - r * 0.05);
  ctx.stroke();
}

export function drawParticles(ctx, particles, scale) {
  for (const p of particles) {
    const k = p.life / p.max;
    const alpha = clamp(k < 0.15 ? k / 0.15 : 1 - (k - 0.6) / 0.4, 0, 1);
    if (alpha <= 0) continue;
    ctx.globalAlpha = alpha;
    const r = p.size;
    switch (p.type) {
      case 'dust': {
        ctx.fillStyle = 'rgba(245, 232, 220, 0.85)';
        ctx.strokeStyle = 'rgba(74, 35, 23, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * (0.6 + k * 0.8), 0, TAU);
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'spark': {
        ctx.fillStyle = '#FFF3B0';
        star(ctx, p.x, p.y, r, p.rot);
        ctx.fill();
        break;
      }
      case 'star': {
        ctx.fillStyle = '#FFE37A';
        ctx.strokeStyle = COLORS.outline;
        ctx.lineWidth = 1.3 * scale;
        star(ctx, p.x, p.y, r, p.rot);
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'heart': {
        ctx.fillStyle = '#F2566B';
        ctx.strokeStyle = COLORS.outline;
        ctx.lineWidth = 1.4 * scale;
        heart(ctx, p.x, p.y, r * (0.8 + Math.sin(k * Math.PI) * 0.3));
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'note': {
        ctx.fillStyle = `hsl(${p.hue}, 70%, 62%)`;
        ctx.strokeStyle = COLORS.outline;
        ctx.lineWidth = 1.6 * scale;
        note(ctx, p.x, p.y, r);
        break;
      }
      case 'zzz': {
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = COLORS.outline;
        ctx.lineWidth = 3 * scale;
        ctx.font = `800 ${Math.round(r * (0.8 + k * 0.7))}px "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.strokeText('z', p.x, p.y);
        ctx.fillText('z', p.x, p.y);
        break;
      }
      case 'confetti': {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = `hsl(${p.hue}, 85%, 62%)`;
        ctx.fillRect(-r * 0.5, -r * 0.25, r, r * 0.5 * Math.abs(Math.cos(p.life * 9 + p.seed)) + 1);
        ctx.restore();
        break;
      }
      case 'exclaim': {
        ctx.font = `900 ${Math.round(r * 1.2)}px "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 4 * scale;
        ctx.strokeStyle = '#FFFFFF';
        ctx.fillStyle = '#E8455A';
        ctx.strokeText('!', p.x, p.y);
        ctx.fillText('!', p.x, p.y);
        break;
      }
      case 'poof': {
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.fillStyle = 'rgba(255,240,230,0.6)';
        ctx.lineWidth = 2 * scale;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * (0.4 + k * 1.4), 0, TAU);
        ctx.fill();
        ctx.stroke();
        break;
      }
      default:
        break;
    }
  }
  ctx.globalAlpha = 1;
}

/** Bounding box of all particles (for deciding which monitor windows draw). */
export function particleBounds(particles) {
  if (!particles.length) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const p of particles) {
    x1 = Math.min(x1, p.x - p.size * 2);
    y1 = Math.min(y1, p.y - p.size * 2);
    x2 = Math.max(x2, p.x + p.size * 2);
    y2 = Math.max(y2, p.y + p.size * 2);
  }
  return { x1, y1, x2, y2 };
}
