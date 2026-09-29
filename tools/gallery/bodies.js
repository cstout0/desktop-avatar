// Renders every body shape in a range of poses (and outfits), or every walk style
// through its cycle, for visual review:
//   bodies.html                   shapes x poses
//   bodies.html?mode=gaits&body=X walk styles x cycle phases
//   bodies.html?mode=idle&body=X  idle styles over time
//   bodies.html?mode=tips         antenna tips
import { createState } from '../../src/renderer/overlay/sim/index.js';
import { drawCharacter, drawRope } from '../../src/renderer/overlay/render/character.js';
import { drawParticles } from '../../src/renderer/overlay/render/effects.js';
import { stepAnim } from '../../src/renderer/overlay/sim/anim.js';
import { ANTENNAS, ARMS, BODIES, LEGS, normalizeLook } from '../../src/renderer/overlay/look.js';
import { GAITS, IDLES, normalizeMotion } from '../../src/renderer/overlay/motion.js';

const params = new URLSearchParams(location.search);
const SCALE = Number(params.get('scale') || 1.3);
const mode = params.get('mode') || 'poses';
const bodyId = params.get('body') || 'classic';
const cellW = Math.round(96 * SCALE);
const cellH = Math.round(118 * SCALE);

const POSES = [
  ['stand', {}],
  ['walk', { pose: 'walk', vx: 165, phase: 0.6 }],
  ['run', { pose: 'walk', vx: 430, phase: 2.2 }],
  ['jump', { pose: 'air', mode: 'air', vy: -600 }],
  ['fall', { pose: 'air', mode: 'air', vy: 1200 }],
  ['held', { pose: 'held', mode: 'held', rot: 0.35 }],
  ['rope', { pose: 'rope', mode: 'rope', rot: -0.3, rope: true }],
  ['climb', { pose: 'climb', mode: 'climb', facing: 1, climbPhase: 0.3 }],
  ['sit', { pose: 'sit' }],
  ['sleep', { pose: 'sleep', face: { eyes: 'closed', mouth: 'o' } }],
  ['dance', { pose: 'dance', move: 'arms', face: { eyes: 'happy', mouth: 'open' } }],
  ['wave', { pose: 'wave' }],
  ['carry', { pose: 'carry', carry: 'folder' }],
  ['work', { pose: 'work' }],
  ['hat+glasses', { look: { hat: 'wizard', glasses: 'round', neck: 'scarf', accent: '#8A5CD6' } }],
  ['crown+tie', { look: { hat: 'crown', glasses: 'shades', neck: 'bowtie' }, face: { eyes: 'happy', mouth: 'open', blush: 0.8 } }],
  ['tophat', { look: { hat: 'tophat', neck: 'bell' } }],
];

const COLORS = ['clay', 'sky', 'mint', 'sunflower', 'grape', 'snow', 'bubblegum', 'lime', 'tangerine', 'ocean'];

let rows;
let cols;
let cell;
if (mode === 'gaits') {
  const phases = [0, 0.8, 1.6, 2.4, 3.2, 4.0, 4.8, 5.6, 6.4, 7.2];
  rows = GAITS.slice(1).map((g) => ({ label: g.label, cells: phases.map((ph) => ({ label: `${ph}`, o: { pose: 'walk', vx: 165, phase: ph, t: ph * 0.3, motion: { gait: g.id } } })) }));
} else if (mode === 'idle') {
  const times = [0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8];
  rows = IDLES.map((i) => ({ label: i.label, cells: times.map((t) => ({ label: `${t}s`, o: { t, motion: { idle: i.id } } })) }));
} else if (mode === 'arms' || mode === 'legs') {
  const list = mode === 'arms' ? ARMS : LEGS;
  const poses = POSES.filter(([l]) => ['stand', 'walk', 'run', 'jump', 'held', 'rope', 'climb', 'sit', 'dance', 'wave', 'carry', 'work'].includes(l)).concat([
    ['think', { pose: 'think', thinking: true }],
    ['clap', { pose: 'watch', react: 'clap', face: { eyes: 'happy', mouth: 'open' } }],
    ['cover eyes', { pose: 'covereyes' }],
  ]);
  rows = list.map((it) => ({ label: it.label, cells: poses.map(([label, o]) => ({ label, o: { ...o, look: { [mode]: it.id, color: params.get('color') || 'clay', accent: '#3E8EDE' } } })) }));
} else if (mode === 'action') {
  const flyT = [0, 0.03, 0.06, 0.09, 0.12, 0.15];
  rows = [
    { label: 'Flying', cells: flyT.map((t) => ({ label: `flap ${t}`, o: { t: 2 + t, pose: 'air', mode: 'air', vy: -500, look: { arms: 'wings', color: 'sky' } } })) },
    { label: 'Gliding', cells: flyT.map((t) => ({ label: `glide ${t}`, o: { t: 3 + t * 3, pose: 'air', mode: 'air', vy: 180, vx: 200, look: { arms: 'wings', color: 'snow', body: t > 0.07 ? 'cloud' : 'classic' } } })) },
    { label: 'Boxing', cells: [['guard', 0], ['wind-up', 0.08], ['jab', 0.16], ['hold', 0.24], ['back', 0.33], ['guard', 0.5]].map(([label, pt]) => ({ label, o: { pose: label.startsWith('guard') ? 'guard' : 'punch', poseT: pt, look: { arms: 'gloves' } } })) },
  ];
} else if (mode === 'tips') {
  rows = [{ label: 'tips', cells: ANTENNAS.map((a) => ({ label: a.label, o: { look: { antenna: a.id } } })).concat(ANTENNAS.map((a) => ({ label: `${a.label} (thinking)`, o: { look: { antenna: a.id }, thinking: true } }))) }];
} else {
  rows = BODIES.map((b, i) => ({ label: b.label, cells: POSES.map(([label, o]) => ({ label, o: { ...o, look: { body: b.id, color: COLORS[i % COLORS.length], ...(o.look ?? {}) } } })) }));
}
cols = Math.max(...rows.map((r) => r.cells.length));
const LABEL = 90;
const canvas = document.getElementById('c');
canvas.width = LABEL + cols * cellW;
canvas.height = rows.length * cellH;
const ctx = canvas.getContext('2d');
ctx.fillStyle = params.get('bg') === 'dark' ? '#1F2430' : '#FFFFFF';
ctx.fillRect(0, 0, canvas.width, canvas.height);

rows.forEach((row, ri) => {
  ctx.fillStyle = '#333';
  ctx.textAlign = 'left';
  ctx.font = '700 14px "Segoe UI", sans-serif';
  ctx.fillText(row.label, 8, ri * cellH + cellH / 2);
  row.cells.forEach((cellDef, ci) => {
    const o = cellDef.o;
    const x = LABEL + ci * cellW + cellW / 2;
    const floor = ri * cellH + cellH - 26;
    const st = createState({ x, y: floor, scale: SCALE, seed: 5 });
    const c = st.char;
    const a = st.anim;
    st.look = normalizeLook({ body: bodyId, ...(o.look ?? {}) });
    st.motion = normalizeMotion(o.motion ?? {});
    st.t = o.t ?? 1.234 + ci * 0.37;
    a.breath = st.t;
    c.mode = o.mode || 'ground';
    c.ground = c.mode === 'ground' ? { kind: 'floor' } : null;
    c.vx = o.vx || 0;
    c.vy = o.vy || 0;
    c.rot = o.rot || 0;
    if (c.mode !== 'ground') c.y = floor - 24;
    a.pose = o.pose || 'stand';
    a.poseT = o.poseT ?? 0.5;
    a.walkPhase = o.phase || 0;
    a.danceMove = o.move || 'bop';
    a.lookX = 0.25;
    a.lookY = 0.1;
    a.blink = 0;
    if (o.face) a.face = { eyes: 'normal', mouth: 'smile', brows: null, blush: 0.35, ...o.face };
    if (o.carry) a.carry = o.carry;
    if (o.react) a.react = { kind: o.react, t0: st.t - 0.2, dur: 5 };
    if (o.facing) c.facing = o.facing;
    if (o.mode === 'climb') c.climb = { key: 'k', face: o.facing ?? 1, phase: o.climbPhase ?? 0, wall: false };
    st.flags.thinking = !!o.thinking;
    a.glow = o.thinking ? 1 : 0;
    if (st.motion.gait === 'roll') a.roll = (o.phase || 0) * 0.9;
    // Settle the antenna spring at its rest point.
    a.antInit = false;
    for (let k = 0; k < 90; k++) stepAnim(st, 1 / 60);
    if (st.motion.gait === 'roll') a.roll = (o.phase || 0) * 0.9;
    a.poseT = o.poseT ?? 0.5; // (settling advanced the pose clock)
    a.blink = 0;
    if (o.rope) c.rope = { state: 'attached', ax: x + 30, ay: ri * cellH + 4, hx: 0, hy: 0, len: 200, t: 0, platformId: null };
    st.groundY = floor;
    drawRope(ctx, st);
    drawCharacter(ctx, st);
    drawParticles(ctx, st.particles, SCALE);
    ctx.fillStyle = '#555';
    ctx.textAlign = 'center';
    ctx.font = '600 11px "Segoe UI", sans-serif';
    ctx.fillText(cellDef.label, x, ri * cellH + cellH - 8);
  });
});

window.galleryDone = true;
