// Renders the character in many poses/expressions for visual review.
import { createState } from '../../src/renderer/overlay/sim/index.js';
import { drawCharacter, drawRope } from '../../src/renderer/overlay/render/character.js';
import { drawParticles } from '../../src/renderer/overlay/render/effects.js';

const params = new URLSearchParams(location.search);
const SCALE = Number(params.get('scale') || 1.6);

// Icon mode: a single happy character filling a transparent square canvas.
if (params.get('icon')) {
  const size = Number(params.get('icon'));
  const canvas = document.getElementById('c');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  // Body+antenna is ~78 units tall and ~62 wide (with hands): fit it in the square.
  const scale = size / 84;
  const st = createState({ x: size / 2, y: size - 4 * scale, scale, seed: 1 });
  st.char.mode = 'ground';
  st.char.ground = { kind: 'floor' };
  st.anim.pose = 'stand';
  st.anim.face = { eyes: size <= 32 ? 'normal' : 'happy', mouth: 'open', brows: null, blush: 0.6 };
  st.anim.lookX = 0;
  st.anim.lookY = 0.1;
  const cy = st.char.y - 35 * scale;
  st.anim.antX = st.char.x + 3 * scale;
  st.anim.antY = cy - 40 * scale;
  st.anim.antInit = true;
  st.groundY = null;
  drawCharacter(ctx, st);
  window.galleryDone = true;
  throw new Error('icon-mode-done'); // stop the gallery script here
}
const cols = 8;
const cellW = 170;
const cellH = 190;

const cases = [
  ['stand', {}],
  ['walk', { pose: 'walk', vx: 165, phase: 0.6 }],
  ['run', { pose: 'walk', vx: 430, phase: 2.2 }],
  ['jump up', { pose: 'air', mode: 'air', vy: -600 }],
  ['falling', { pose: 'air', mode: 'air', vy: 1200 }],
  ['held', { pose: 'held', mode: 'held', rot: 0.35 }],
  ['rope', { pose: 'rope', mode: 'rope', rot: -0.35, rope: true }],
  ['wall slide', { pose: 'wallslide', mode: 'air', wallDir: 1, vy: 100 }],
  ['sit', { pose: 'sit' }],
  ['sleep', { pose: 'sleep', face: { eyes: 'closed', mouth: 'o' } }],
  ['dance bop', { pose: 'dance', move: 'bop' }],
  ['dance arms', { pose: 'dance', move: 'arms', face: { eyes: 'happy', mouth: 'open' } }],
  ['dance point', { pose: 'dance', move: 'point' }],
  ['wave', { pose: 'wave' }],
  ['think', { pose: 'think', thinking: true }],
  ['carry folder', { pose: 'carry', carry: 'folder' }],
  ['carry file', { pose: 'carry', carry: 'file' }],
  ['celebrate', { pose: 'celebrate', face: { eyes: 'happy', mouth: 'open' } }],
  ['dizzy', { pose: 'dizzy', dizzy: true, face: { eyes: 'dizzy', mouth: 'wavy' } }],
  ['annoyed', { pose: 'annoyed', face: { eyes: 'squint', mouth: 'wavy', brows: 'angry' } }],
  ['petted', { pose: 'petted', face: { eyes: 'happy', mouth: 'cat', blush: 0.9 } }],
  ['surprised', { face: { eyes: 'wide', mouth: 'o', brows: 'up' } }],
  ['talking', { talk: true }],
  ['listen', { pose: 'listen', listening: true }],
  ['heart eyes', { face: { eyes: 'heart', mouth: 'open', blush: 0.8 } }],
  ['determined', { face: { eyes: 'normal', mouth: 'flat', brows: 'determined' } }],
  ['look left', { lookX: -1, lookY: 0.2 }],
  ['look up-right', { lookX: 1, lookY: -1 }],
  ['blink', { blink: 0.9 }],
  ['crouch', { pose: 'crouch' }],
  ['upside down', { pose: 'held', mode: 'held', rot: Math.PI }],
  ['stretch', { pose: 'stretch', poseT: 0.6, face: { eyes: 'closed', mouth: 'open' } }],
  ['climb (right side)', { pose: 'climb', mode: 'climb', facing: 1, climbPhase: 0.3 }],
  ['climb (left side)', { pose: 'climb', mode: 'climb', facing: -1, climbPhase: 1.2 }],
  ['watching + popcorn', { pose: 'watch', watchAt: [260, -260] }],
  ['watch: laugh', { pose: 'watch', react: 'laugh', face: { eyes: 'happy', mouth: 'open', blush: 0.7 } }],
  ['watch: gasp', { pose: 'watch', react: 'gasp', face: { eyes: 'wide', mouth: 'o', brows: 'up' } }],
  ['watch: clap', { pose: 'watch', react: 'clap', face: { eyes: 'happy', mouth: 'open' } }],
  ['watch: sad', { pose: 'watch', react: 'sad', face: { eyes: 'normal', mouth: 'wavy', brows: 'up' } }],
  ['watch: think', { pose: 'watch', react: 'think', face: { eyes: 'normal', mouth: 'flat', brows: 'determined' } }],
];

const bgs = params.get('bg') === 'dark' ? ['#1F2430'] : params.get('bg') === 'photo' ? ['photo'] : ['#FFFFFF'];
const rows = Math.ceil(cases.length / cols);
const canvas = document.getElementById('c');
canvas.width = cols * cellW;
canvas.height = rows * cellH;
const ctx = canvas.getContext('2d');

function background() {
  if (bgs[0] === 'photo') {
    const g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    g.addColorStop(0, '#3A6EA5');
    g.addColorStop(0.5, '#9FC7E8');
    g.addColorStop(1, '#E6B980');
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = bgs[0];
  }
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}
background();

cases.forEach(([label, o], i) => {
  const col = i % cols;
  const row = Math.floor(i / cols);
  const x = col * cellW + cellW / 2;
  const floor = row * cellH + cellH - 34;
  const st = createState({ x, y: floor, scale: SCALE, seed: 5 });
  const c = st.char;
  const a = st.anim;
  st.t = 1.234 + i * 0.37;
  a.breath = st.t;
  c.mode = o.mode || 'ground';
  c.ground = c.mode === 'ground' ? { kind: 'floor' } : null;
  c.vx = o.vx || 0;
  c.vy = o.vy || 0;
  c.rot = o.rot || 0;
  c.wallDir = o.wallDir || 0;
  if (c.mode !== 'ground') c.y = floor - 30;
  a.pose = o.pose || 'stand';
  a.poseT = o.poseT ?? 0.5;
  a.walkPhase = o.phase || 0;
  a.danceMove = o.move || 'bop';
  a.lookX = o.lookX ?? 0.25;
  a.lookY = o.lookY ?? 0.1;
  a.blink = o.blink || 0;
  if (o.face) a.face = { eyes: 'normal', mouth: 'smile', brows: null, blush: 0.35, ...o.face };
  if (o.carry) a.carry = o.carry;
  if (o.facing) c.facing = o.facing;
  if (o.mode === 'climb') c.climb = { key: 'k', face: o.facing ?? 1, phase: o.climbPhase ?? 0, wall: false };
  if (o.watchAt) a.watchAt = { x: x + o.watchAt[0], y: floor + o.watchAt[1] };
  if (o.react) a.react = { kind: o.react, t0: st.t - 0.2, dur: 5 };
  if (o.talk) a.talk = 1;
  if (o.dizzy) a.dizzyUntil = st.t + 5;
  st.flags.thinking = !!o.thinking;
  st.flags.listening = !!o.listening;
  a.glow = o.thinking || o.listening ? 1 : 0;
  // Settle the antenna at rest.
  a.antInit = false;
  const cy = c.y - 35 * SCALE;
  a.antX = c.x + Math.sin(c.rot) * 40 * SCALE;
  a.antY = cy - Math.cos(c.rot) * 40 * SCALE;
  a.antInit = true;
  if (o.rope) {
    c.rope = { state: 'attached', ax: x + 45, ay: row * cellH + 6, hx: 0, hy: 0, len: 200, t: 0, platformId: null };
  }
  st.groundY = c.mode === 'ground' ? floor : floor;
  drawRope(ctx, st);
  drawCharacter(ctx, st);
  drawParticles(ctx, st.particles, SCALE);
  ctx.fillStyle = bgs[0] === '#1F2430' ? '#DDD' : '#333';
  ctx.textAlign = 'center';
  ctx.font = '600 13px "Segoe UI", sans-serif';
  ctx.fillText(label, x, row * cellH + cellH - 10);
});

window.galleryDone = true;
