// Things drawn around the character: the pomodoro badge and toys.
import { CENTER_Y } from '../sim/constants.js';
import { bodyOf, hatLift } from '../look.js';
import { bodyMotion } from '../motion.js';

const TAU = Math.PI * 2;
const INK = '#4A2317';

/** The fetch ball: a fuzzy tennis ball that spins as it rolls. */
export function drawBall(ctx, ball) {
  if (!ball) return;
  const r = ball.r;
  ctx.save();
  ctx.translate(ball.x, ball.y);
  // Soft shadow under a resting ball.
  if (ball.resting) {
    ctx.fillStyle = 'rgba(40, 18, 10, 0.2)';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.95, r * 0.9, r * 0.28, 0, 0, TAU);
    ctx.fill();
  }
  ctx.rotate(ball.rot);
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
  g.addColorStop(0, '#F4FF8A');
  g.addColorStop(1, '#C7E03A');
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.2);
  ctx.strokeStyle = INK;
  ctx.stroke();
  // The two white seams.
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = Math.max(0.8, r * 0.16);
  ctx.beginPath();
  ctx.arc(-r * 1.05, 0, r * 0.75, -1.1, 1.1);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(r * 1.05, 0, r * 0.75, Math.PI - 1.1, Math.PI + 1.1);
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}

/** A little floating tomato (focus) or mug (break) with the minutes left. */
export function drawFocusBadge(ctx, st, nowMs = Date.now()) {
  const f = st.focus;
  if (!f || f.phase === 'idle') return;
  const c = st.char;
  const s = c.scale;
  const left = f.paused ? f.remaining : Math.max(0, f.endsAt - nowMs);
  const mins = Math.max(1, Math.ceil(left / 60000));
  const side = c.facing >= 0 ? -1 : 1; // opposite the way it faces, so it doesn't cover the face
  const x = c.x + side * 38 * s;
  const y = c.y - (CENTER_Y - bodyOf(st.look).top + 4 + hatLift(st.look) * 0.3 + bodyMotion(st).lift) * s + Math.sin(st.t * 2) * 1.6 * s;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = INK;
  if (f.phase === 'focus') {
    ctx.beginPath();
    ctx.ellipse(0, 0, 10, 9, 0, 0, TAU);
    ctx.fillStyle = f.paused ? '#C9A0A0' : '#E8455A';
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.ellipse(-4, -3, 3, 2, -0.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#4FAE6A';
    for (const a of [-0.9, -0.3, 0.3, 0.9]) {
      ctx.beginPath();
      ctx.ellipse(Math.sin(a) * 4, -9 + Math.abs(a) * 1.5, 1.8, 3.6, a, 0, TAU);
      ctx.fill();
    }
  } else {
    // Coffee mug with a wisp of steam.
    ctx.beginPath();
    ctx.moveTo(-8, -6);
    ctx.lineTo(7, -6);
    ctx.lineTo(6, 8);
    ctx.lineTo(-7, 8);
    ctx.closePath();
    ctx.fillStyle = '#FFFDF8';
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(8.5, 1, 3.6, -1.3, 1.3);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(74,35,23,0.45)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    const w = Math.sin(st.t * 3) * 1.5;
    ctx.moveTo(-2, -9);
    ctx.quadraticCurveTo(-4 + w, -13, -1, -16);
    ctx.moveTo(3, -9);
    ctx.quadraticCurveTo(1 - w, -13, 4, -16);
    ctx.stroke();
  }
  // Minutes left, in a little pill.
  const label = `${mins}m`;
  ctx.font = '700 8.5px "Segoe UI", sans-serif';
  const tw = ctx.measureText(label).width;
  const px = 12;
  ctx.beginPath();
  ctx.roundRect(px, -6, tw + 8, 12, 6);
  ctx.fillStyle = '#FFFDF8';
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.textBaseline = 'middle';
  ctx.fillText(label, px + 4, 0.5);
  ctx.restore();
}

// ---- boxing: pretend pop-up windows ---------------------------------------------------------

const TOY_STYLE = {
  ad: { title: 'CONGRATULATIONS!!!', bar: '#FF3E9A', body: ['#FFF36B', '#FFB23F'], lines: ['🎉 YOU WON!!! 🎉', 'Click to claim'], button: 'CLAIM', loud: true },
  error: { title: 'Error', bar: '#4A5568', body: ['#FFFFFF', '#EEF1F6'], lines: ['⚠️ Something went', 'wrong. Again.'], button: 'OK' },
  update: { title: 'Updates', bar: '#2F6FD6', body: ['#F4F8FF', '#E3ECFB'], lines: ['Installing update', '3 of 999…'], progress: true },
  spam: { title: 'Inbox (9,999)', bar: '#D94841', body: ['#FFFFFF', '#F6F6F6'], lines: ['💸 FREE $$$ inside', '🔥 Act now!!!', 'Re: Re: Fwd: Fwd:'], list: true },
  loading: { title: 'Please wait…', bar: '#6B5BD6', body: ['#FAF8FF', '#ECE8FF'], lines: ['Loading…', 'forever'], spinner: true },
  captcha: { title: 'Verify', bar: '#3A9D5D', body: ['#FFFFFF', '#F2FAF4'], lines: ['I’m not a robot'], checkbox: true },
};

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const hash = (str) => [...str].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);

/** A pretend pop-up window (boxing target), shaking when hit and cracking with each punch. */
export function drawToyWin(ctx, t, time) {
  const style = TOY_STYLE[t.kind] ?? TOY_STYLE.error;
  const w = t.w;
  const h = t.h;
  const k = w / 96; // its size, relative to how it's drawn below
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.rotate(t.rot);
  const since = time - t.hitT;
  if (since < 0.25) ctx.translate(Math.sin(time * 95) * (1 - since / 0.25) * 3 * k, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  rrect(ctx, -w / 2 + 3 * k, -h / 2 + 4 * k, w, h, 6 * k);
  ctx.fill();
  const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
  g.addColorStop(0, style.body[0]);
  g.addColorStop(1, style.body[1]);
  rrect(ctx, -w / 2, -h / 2, w, h, 6 * k);
  ctx.fillStyle = g;
  ctx.fill();
  // Title bar with the usual three buttons.
  ctx.save();
  rrect(ctx, -w / 2, -h / 2, w, h, 6 * k);
  ctx.clip();
  ctx.fillStyle = style.bar;
  ctx.fillRect(-w / 2, -h / 2, w, 15 * k);
  ctx.fillStyle = '#E8455A';
  ctx.fillRect(w / 2 - 15 * k, -h / 2, 15 * k, 15 * k);
  ctx.restore();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `700 ${7.2 * k}px "Segoe UI", sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(style.title, -w / 2 + 5 * k, -h / 2 + 7.8 * k, w - 44 * k);
  ctx.textAlign = 'center';
  ctx.fillText('✕', w / 2 - 7.5 * k, -h / 2 + 7.8 * k);
  ctx.fillText('—', w / 2 - 22 * k, -h / 2 + 7.2 * k);
  // Content.
  const top = -h / 2 + 15 * k;
  ctx.fillStyle = style.loud ? '#C8177A' : '#2B2230';
  if (style.list) {
    ctx.textAlign = 'left';
    ctx.font = `600 ${6.4 * k}px "Segoe UI", "Segoe UI Emoji", sans-serif`;
    style.lines.forEach((line, i) => {
      ctx.fillStyle = i % 2 ? '#F1F1F1' : '#FFFFFF';
      ctx.fillRect(-w / 2 + 3 * k, top + 3 * k + i * 14.5 * k, w - 6 * k, 13 * k);
      ctx.fillStyle = '#2B2230';
      ctx.fillText(line, -w / 2 + 7 * k, top + 9.8 * k + i * 14.5 * k, w - 14 * k);
    });
  } else {
    ctx.font = `${style.loud ? 800 : 600} ${(style.loud ? 8.6 : 7.4) * k}px "Segoe UI", "Segoe UI Emoji", sans-serif`;
    style.lines.forEach((line, i) => ctx.fillText(line, 0, top + 11 * k + i * 10.5 * k, w - 10 * k));
  }
  if (style.button) {
    ctx.fillStyle = style.loud ? '#22A95A' : '#E6E9EF';
    rrect(ctx, -15 * k, h / 2 - 15 * k, 30 * k, 10 * k, 3 * k);
    ctx.fill();
    ctx.fillStyle = style.loud ? '#FFFFFF' : '#2B2230';
    ctx.font = `800 ${6 * k}px "Segoe UI", sans-serif`;
    ctx.fillText(style.button, 0, h / 2 - 9.8 * k);
  }
  if (style.progress) {
    ctx.fillStyle = '#D5DEEE';
    rrect(ctx, -34 * k, h / 2 - 15 * k, 68 * k, 7 * k, 3.5 * k);
    ctx.fill();
    ctx.fillStyle = '#2F6FD6';
    rrect(ctx, -34 * k, h / 2 - 15 * k, 68 * k * 0.03 + 3 * k, 7 * k, 3.5 * k);
    ctx.fill();
  }
  if (style.spinner) {
    ctx.strokeStyle = '#6B5BD6';
    ctx.lineWidth = 2.4 * k;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, h / 2 - 12 * k, 5 * k, time * 6, time * 6 + 4.2);
    ctx.stroke();
  }
  if (style.checkbox) {
    ctx.strokeStyle = '#2B2230';
    ctx.lineWidth = 1.4 * k;
    ctx.strokeRect(-32 * k, top + 20 * k, 10 * k, 10 * k);
    ctx.fillStyle = '#8A93A6';
    ctx.font = `600 ${5.6 * k}px "Segoe UI", sans-serif`;
    ctx.fillText('(are you, though?)', 6 * k, top + 36 * k);
  }
  // Cracks from each punch.
  if (t.hits > 0) {
    ctx.strokeStyle = 'rgba(30, 30, 40, 0.75)';
    ctx.lineWidth = 1.3 * k;
    ctx.lineJoin = 'round';
    let seed = hash(t.id);
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) % 1000) / 1000;
    for (let i = 0; i < t.hits * 2; i++) {
      let x = (rnd() - 0.5) * w * 0.8;
      let y = (rnd() - 0.5) * h * 0.7;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let j = 0; j < 4; j++) {
        x += (rnd() - 0.5) * 18 * k;
        y += (rnd() - 0.5) * 14 * k;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  rrect(ctx, -w / 2, -h / 2, w, h, 6 * k);
  ctx.strokeStyle = '#2B2230';
  ctx.lineWidth = 1.6 * k;
  ctx.stroke();
  ctx.restore();
}

/** Is a global point on a toy window? (for clicking to punch it) */
export function toyAt(toys, x, y) {
  for (let i = (toys?.length ?? 0) - 1; i >= 0; i--) {
    const t = toys[i];
    const dx = x - t.x;
    const dy = y - t.y;
    const c = Math.cos(-t.rot);
    const n = Math.sin(-t.rot);
    const lx = dx * c - dy * n;
    const ly = dx * n + dy * c;
    if (Math.abs(lx) <= t.w / 2 + 4 && Math.abs(ly) <= t.h / 2 + 4) return t;
  }
  return null;
}
