import { rand, randRange, TAU } from './util.js';

const MAX = 90;

export function spawn(st, type, x, y, opts = {}) {
  if (st.particles.length >= MAX) st.particles.shift();
  const s = st.char.scale;
  const p = {
    type,
    x,
    y,
    vx: opts.vx ?? 0,
    vy: opts.vy ?? 0,
    g: opts.g ?? 0,
    life: 0,
    max: opts.max ?? 1,
    size: (opts.size ?? 10) * s,
    rot: opts.rot ?? 0,
    rotV: opts.rotV ?? 0,
    hue: opts.hue ?? 0,
    drag: opts.drag ?? 0,
    wobble: opts.wobble ?? 0,
    seed: rand(st) * TAU,
    text: opts.text ?? null,
  };
  st.particles.push(p);
  return p;
}

export function burst(st, type, x, y, n, opts = {}) {
  const s = st.char.scale;
  for (let i = 0; i < n; i++) {
    const a = randRange(st, opts.a0 ?? 0, opts.a1 ?? TAU);
    const sp = randRange(st, opts.sp0 ?? 60, opts.sp1 ?? 200) * s;
    spawn(st, type, x, y, {
      ...opts,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      max: randRange(st, opts.max0 ?? 0.4, opts.max1 ?? 0.8),
      rotV: randRange(st, -8, 8),
      hue: opts.hue ?? rand(st) * 360,
      size: randRange(st, opts.size0 ?? 5, opts.size1 ?? 9),
    });
  }
}

export function stepParticles(st, dt) {
  const ps = st.particles;
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i];
    p.life += dt;
    if (p.life >= p.max) {
      ps.splice(i, 1);
      continue;
    }
    p.vy += p.g * dt;
    if (p.drag) {
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy *= k;
    }
    p.x += (p.vx + (p.wobble ? Math.sin(p.life * 5 + p.seed) * p.wobble : 0)) * dt;
    p.y += p.vy * dt;
    p.rot += p.rotV * dt;
  }
}
