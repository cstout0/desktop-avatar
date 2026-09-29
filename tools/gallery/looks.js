// Renders every color, hat, pair of glasses, neckwear and outfit for review.
import { createState } from '../../src/renderer/overlay/sim/index.js';
import { drawCharacter } from '../../src/renderer/overlay/render/character.js';
import { COLOR_PRESETS, GLASSES, HATS, NECKWEAR, OUTFITS, normalizeLook } from '../../src/renderer/overlay/look.js';
import { stepAnim } from '../../src/renderer/overlay/sim/anim.js';

const params = new URLSearchParams(location.search);
const SCALE = Number(params.get('scale') || 1.6);
const only = params.get('only')?.split(',');
const cols = only ? only.length : 10;
const cellW = Math.round(81 * SCALE);
const cellH = Math.round(106 * SCALE);

const cases = [
  ...COLOR_PRESETS.map((c) => [c.label, { color: c.id, hue: 290, shade: 55 }]),
  ...HATS.slice(1).map((h) => [h.label, { hat: h.id }]),
  ...GLASSES.slice(1).map((g) => [g.label, { glasses: g.id }]),
  ...NECKWEAR.slice(1).map((n) => [n.label, { neck: n.id }]),
  ...OUTFITS.map((o, i) => [o.label, { ...o.look, color: o.look.color ?? COLOR_PRESETS[(i * 3 + 1) % 13].id }]),
].filter(([label]) => !only || only.includes(label));

const rows = Math.ceil(cases.length / cols);
const canvas = document.getElementById('c');
canvas.width = cols * cellW;
canvas.height = rows * cellH;
const ctx = canvas.getContext('2d');
ctx.fillStyle = params.get('bg') === 'dark' ? '#1F2430' : '#FFFFFF';
ctx.fillRect(0, 0, canvas.width, canvas.height);

cases.forEach(([label, look], i) => {
  const x = (i % cols) * cellW + cellW / 2;
  const floor = Math.floor(i / cols) * cellH + cellH - 30;
  const st = createState({ x, y: floor, scale: SCALE, seed: 5 });
  st.look = normalizeLook(look);
  st.char.mode = 'ground';
  st.char.ground = { kind: 'floor' };
  st.anim.pose = 'stand';
  st.anim.lookX = 0.2;
  st.anim.lookY = 0.1;
  st.t = 0.8 + i * 0.13;
  // Let the antenna spring settle at its (hat-dependent) rest point.
  for (let k = 0; k < 120; k++) stepAnim(st, 1 / 60);
  st.anim.blink = 0;
  st.groundY = floor;
  drawCharacter(ctx, st);
  ctx.fillStyle = params.get('bg') === 'dark' ? '#DDD' : '#333';
  ctx.textAlign = 'center';
  ctx.font = '600 12px "Segoe UI", sans-serif';
  ctx.fillText(label, x, floor + 20);
});

window.galleryDone = true;
