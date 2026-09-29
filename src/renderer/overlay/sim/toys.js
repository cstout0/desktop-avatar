// The fetch ball: a bouncy circle in screen space. You grab and throw it with
// the mouse; it bounces off monitor floors, walls and ceilings and lands on
// window tops. Its gravity doesn't depend on the character's size, so throws
// feel the same whether the buddy is tiny or huge.
import { PHYS as P } from './constants.js';
import { floorY, hasNeighbor, nearestRegion, platKey, regionAt } from './world.js';
import { handPoint } from './physics.js';
import { clamp, rand } from './util.js';

const G = P.gravity * 1.4;
const BOUNCE = 0.58;

export function newBall(x, y, scale) {
  return { x, y, vx: 0, vy: 0, r: Math.max(5, 8 * scale), rot: 0, held: false, carried: false, resting: false, on: null, tx: x, ty: y };
}

/** What the ball is sitting on: a window top under it, or the monitor floor. */
function supportUnder(world, b) {
  for (const p of world.platforms) {
    if (b.x >= p.x1 && b.x <= p.x2 && Math.abs(b.y + b.r - p.y) <= 1.5) return { y: p.y, on: platKey(p) };
  }
  const r = regionAt(world, b.x, b.y) || nearestRegion(world, b.x, b.y);
  if (r && Math.abs(b.y + b.r - floorY(r)) <= 1.5) return { y: floorY(r), on: 'floor' };
  return null;
}

export function stepBall(st, world, dt) {
  const b = st.ball;
  if (!b) return;
  const s = st.char.scale;
  b.r = Math.max(5, 8 * s);
  if (b.carried) {
    const h = handPoint(st.char);
    b.x = h.x + st.char.facing * 9 * s;
    b.y = h.y + 6 * s;
    b.vx = 0;
    b.vy = 0;
    b.resting = false;
    b.on = null;
    return;
  }
  if (b.held) {
    // Follow the cursor with a stiff spring; the velocity at release is the throw.
    const k = 900;
    const d = 2 * Math.sqrt(k);
    b.vx += (k * (b.tx - b.x) - d * b.vx) * dt;
    b.vy += (k * (b.ty - b.y) - d * b.vy) * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.resting = false;
    b.on = null;
    return;
  }
  if (b.resting) {
    const sup = supportUnder(world, b);
    if (sup) {
      b.y = sup.y - b.r;
      b.on = sup.on;
      return;
    }
    b.resting = false; // its window moved or closed: fall
    b.on = null;
  }
  const prevY = b.y;
  b.vy += G * dt;
  b.vx *= Math.exp(-0.15 * dt);
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.rot += (b.vx * dt) / b.r;
  const r = regionAt(world, b.x, b.y) || nearestRegion(world, b.x, b.y);
  if (!r) return;
  // Walls only at the outer edges of the desktop (it can fly across to the other monitor).
  if (b.x - b.r < r.x && !hasNeighbor(world, r, 'left', r.y, r.y + r.h)) {
    b.x = r.x + b.r;
    b.vx = Math.abs(b.vx) * BOUNCE;
  } else if (b.x + b.r > r.x + r.w && !hasNeighbor(world, r, 'right', r.y, r.y + r.h)) {
    b.x = r.x + r.w - b.r;
    b.vx = -Math.abs(b.vx) * BOUNCE;
  }
  if (b.y - b.r < r.y) {
    b.y = r.y + b.r;
    b.vy = Math.abs(b.vy) * BOUNCE;
  }
  // Landing on a window top (one-way, from above) or on the floor.
  let ground = null;
  if (b.vy > 0) {
    for (const p of world.platforms) {
      if (b.x >= p.x1 && b.x <= p.x2 && prevY + b.r <= p.y + 1 && b.y + b.r >= p.y) {
        ground = { y: p.y, on: platKey(p) };
        break;
      }
    }
  }
  const fy = floorY(r);
  if (!ground && b.y + b.r >= fy) ground = { y: fy, on: 'floor' };
  if (ground) {
    b.y = ground.y - b.r;
    if (b.vy > 90 * Math.max(1, s)) {
      b.vy = -b.vy * BOUNCE;
      b.vx *= 0.86;
    } else {
      b.vy = 0;
      b.vx *= Math.exp(-2.2 * dt); // rolling friction
      if (Math.abs(b.vx) < 6) {
        b.vx = 0;
        b.resting = true;
        b.on = ground.on;
      }
    }
  }
}

/** Velocity of a throw from recent cursor samples [{ t (s), x, y }], capped. */
export function throwVelocity(samples, now, max = 3600) {
  const recent = samples.filter((p) => now - p.t <= 0.09);
  if (recent.length < 2) return { vx: 0, vy: 0 };
  const a = recent[0];
  const z = recent[recent.length - 1];
  const dt = Math.max(0.016, z.t - a.t);
  let vx = (z.x - a.x) / dt;
  let vy = (z.y - a.y) / dt;
  const sp = Math.hypot(vx, vy);
  if (sp > max) {
    vx *= max / sp;
    vy *= max / sp;
  }
  return { vx: clamp(vx, -max, max), vy: clamp(vy, -max, max) };
}

// ---- boxing: pretend pop-up windows -------------------------------------------------------
// Not real apps: little fake windows drawn on the overlay, for the character to punch
// around. They fall, bounce, tumble when hit, land on window tops, and break after a
// few punches.

export const TOY_KINDS = ['ad', 'error', 'update', 'spam', 'loading', 'captcha'];

export function newToyWin(st, x, y, kind) {
  const s = st.char.scale;
  return { kind, x, y, vx: 0, vy: 0, w: 96 * s, h: 64 * s, rot: 0, rotV: 0, hits: 0, hp: 3, resting: false, on: null, born: st.t, hitT: -9, ko: false, id: `${kind}-${Math.round(st.t * 1000)}-${Math.round(x)}` };
}

/** Half extents of the (rotated) box, for landing on things. */
export function toyExtents(t) {
  const c = Math.abs(Math.cos(t.rot));
  const n = Math.abs(Math.sin(t.rot));
  return { hw: (t.w / 2) * c + (t.h / 2) * n, hh: (t.w / 2) * n + (t.h / 2) * c };
}

/** Knock a toy window away from `fromX` (a punch). Returns true when that was the knockout blow. */
export function punchToy(st, t, fromX, power = 1) {
  const s = st.char.scale;
  const dir = t.x >= fromX ? 1 : -1;
  t.vx = dir * (620 + 380 * rand(st)) * s * power;
  t.vy = -(320 + 300 * rand(st)) * s * power;
  t.rotV = dir * (5 + 5 * rand(st));
  t.resting = false;
  t.on = null;
  t.hits++;
  t.hitT = st.t;
  if (t.hits >= t.hp) t.ko = true;
  return t.ko;
}

export function stepToyWins(st, world, dt) {
  const toys = st.toys;
  if (!toys?.length) return;
  const s = st.char.scale;
  for (const t of toys) {
    if (t.held) continue;
    let { hw, hh } = toyExtents(t);
    if (t.resting) {
      // Still sitting on something? (its window may have moved or closed)
      const under = world.platforms.find((p) => t.x >= p.x1 && t.x <= p.x2 && Math.abs(t.y + hh - p.y) <= 2);
      const r = regionAt(world, t.x, t.y) || nearestRegion(world, t.x, t.y);
      const floor = r ? floorY(r) : Infinity;
      if (under || Math.abs(t.y + hh - floor) <= 2) continue;
      t.resting = false;
      t.on = null;
    }
    const prevBottom = t.y + hh;
    t.vy += G * dt;
    t.x += t.vx * dt;
    t.y += t.vy * dt;
    t.rot += t.rotV * dt;
    t.rotV *= Math.exp(-1.2 * dt);
    ({ hw, hh } = toyExtents(t));
    const r = regionAt(world, t.x, t.y) || nearestRegion(world, t.x, t.y);
    if (!r) continue;
    if (t.x - hw < r.x && !hasNeighbor(world, r, 'left', r.y, r.y + r.h)) {
      t.x = r.x + hw;
      t.vx = Math.abs(t.vx) * 0.5;
      t.rotV = -t.rotV * 0.6;
    } else if (t.x + hw > r.x + r.w && !hasNeighbor(world, r, 'right', r.y, r.y + r.h)) {
      t.x = r.x + r.w - hw;
      t.vx = -Math.abs(t.vx) * 0.5;
      t.rotV = -t.rotV * 0.6;
    }
    if (t.y - hh < r.y) {
      t.y = r.y + hh;
      t.vy = Math.abs(t.vy) * 0.4;
    }
    let ground = null;
    if (t.vy > 0) {
      for (const p of world.platforms) {
        if (t.x >= p.x1 && t.x <= p.x2 && prevBottom <= p.y + 1 && t.y + hh >= p.y) {
          ground = { y: p.y, on: platKey(p) };
          break;
        }
      }
    }
    const fy = floorY(r);
    if (!ground && t.y + hh >= fy) ground = { y: fy, on: 'floor' };
    if (ground) {
      t.y = ground.y - hh;
      if (t.vy > 220 * Math.max(1, s)) {
        t.vy = -t.vy * 0.32;
        t.vx *= 0.7;
        t.rotV *= 0.5;
      } else {
        t.vy = 0;
        t.vx *= Math.exp(-7 * dt);
        // Tip over onto the nearest flat side.
        const flat = Math.round(t.rot / (Math.PI / 2)) * (Math.PI / 2);
        t.rot += (flat - t.rot) * Math.min(1, 10 * dt);
        t.rotV = 0;
        if (Math.abs(t.vx) < 8 * s && Math.abs(t.rot - flat) < 0.01) {
          t.rot = flat;
          t.vx = 0;
          t.resting = true;
          t.on = ground.on;
        }
      }
    }
  }
}
