// Little portraits of the character in a given look, for the wardrobe tiles and icons.
import { createState } from '../overlay/sim/index.js';
import { stepAnim } from '../overlay/sim/anim.js';
import { BODY, CENTER_Y } from '../overlay/sim/constants.js';
import { drawCharacter } from '../overlay/render/character.js';
import { drawParticles } from '../overlay/render/effects.js';
import { stepParticles } from '../overlay/sim/particles.js';
import { bodyOf, headRise, hoverOf, normalizeLook } from '../overlay/look.js';

/**
 * @param canvas  target canvas (drawn at its pixel size)
 * @param look    the look to wear
 * @param opts.crop 'full' (head to toe), 'bust' (antenna to chest, for hats and glasses)
 *                  or 'icon' (just the face filling the square, for tiny tray icons)
 * @param opts.face optional expression, e.g. { eyes: 'happy', mouth: 'open' }
 * @param opts.motion optional motion settings (walk style etc.)
 */
export function drawThumb(canvas, look, { crop = 'full', face = null, seed = 3, motion = null } = {}) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const l = normalizeLook(look);
  const shape = bodyOf(l);
  const lift = hoverOf(l); // hovering bodies float this high when standing still
  const icon = crop === 'icon';
  // Distances above and below the body center that must fit in the picture.
  const top = icon ? BODY.h / 2 + 12 - shape.face : headRise(l) + lift + 9;
  const bottom = icon ? BODY.h / 2 - 2 + shape.face : crop === 'bust' ? 16 + Math.max(0, shape.face) : Math.max(CENTER_Y, shape.bottom) - lift + 5;
  const s = icon ? Math.min((W * 0.98) / 54, (H * 0.98) / (top + bottom)) : Math.min((W * 0.86) / Math.max(66, shape.hw * 2 + 12), (H * 0.92) / (top + bottom));
  const cy = (H - (top + bottom) * s) / 2 + top * s; // body center
  const st = createState({ x: W / 2, y: cy + (CENTER_Y + lift) * s, scale: s, seed });
  st.look = l;
  if (motion) st.motion = motion;
  st.char.mode = 'ground';
  st.char.ground = { kind: 'floor' };
  st.anim.pose = 'stand';
  st.anim.lookX = 0.15;
  st.anim.lookY = 0.15;
  if (face) st.anim.face = { eyes: 'normal', mouth: 'smile', brows: null, blush: 0.35, ...face };
  for (let i = 0; i < 90; i++) stepAnim(st, 1 / 60); // settle the antenna spring
  st.t = 0; // (hovering bodies bob with time: draw them at rest height)
  st.anim.blink = 0;
  st.groundY = null;
  drawCharacter(ctx, st);
}

// ---- live previews ---------------------------------------------------------------------------

const live = new Set();
let raf = 0;

/**
 * A tile that keeps moving: the character walking in place with a walk style
 * (and its trail), or standing around with an idle style. Stops by itself once
 * the canvas leaves the page.
 * @param opts.walking walk in place (otherwise it stands)
 */
export function liveThumb(canvas, look, motion, { walking = false } = {}) {
  const l = normalizeLook(look);
  const shape = bodyOf(l);
  const W = canvas.width;
  const H = canvas.height;
  const hop = walking ? 12 : 6; // headroom for hops and bounces
  const top = headRise(l) + hoverOf(l) + hop + 9;
  const bottom = Math.max(CENTER_Y, shape.bottom) + 5;
  const s = Math.min((W * 0.62) / Math.max(66, shape.hw * 2 + 12), (H * 0.9) / (top + bottom));
  const cy = (H - (top + bottom) * s) / 2 + top * s;
  const x = walking ? W * 0.56 : W / 2;
  const st = createState({ x, y: cy + CENTER_Y * s, scale: s, seed: 7 });
  st.look = l;
  st.motion = motion;
  st.char.mode = 'ground';
  st.char.ground = { kind: 'floor' };
  st.anim.pose = walking ? 'walk' : 'stand';
  st.char.vx = walking ? 150 * s : 0;
  st.groundY = st.char.y;
  st.t = Math.random() * 3;
  live.add({ canvas, st, last: performance.now(), walking });
  if (!raf) raf = requestAnimationFrame(tick);
}

function tick(now) {
  raf = 0;
  for (const e of live) {
    if (!e.canvas.isConnected) {
      live.delete(e);
      continue;
    }
    const dt = Math.min(0.05, (now - e.last) / 1000);
    if (dt < 1 / 40) continue; // ~40 fps is plenty for little tiles
    e.last = now;
    const st = e.st;
    st.t += dt;
    stepAnim(st, dt);
    stepParticles(st, dt);
    const ctx = e.canvas.getContext('2d');
    ctx.clearRect(0, 0, e.canvas.width, e.canvas.height);
    drawCharacter(ctx, st);
    drawParticles(ctx, st.particles, st.char.scale);
  }
  if (live.size) raf = requestAnimationFrame(tick);
}
