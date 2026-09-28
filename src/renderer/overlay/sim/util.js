export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
export const TAU = Math.PI * 2;

/** Seeded PRNG (mulberry32) stored in the state so runs are reproducible. */
export function rand(st) {
  let t = (st.seed = (st.seed + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const randRange = (st, a, b) => a + (b - a) * rand(st);
export const chance = (st, p) => rand(st) < p;
export function pick(st, arr) {
  return arr[Math.floor(rand(st) * arr.length) % arr.length];
}

/** Weighted choice from [[value, weight], ...]. */
export function weighted(st, pairs) {
  let total = 0;
  for (const [, w] of pairs) total += Math.max(0, w);
  if (total <= 0) return pairs[0]?.[0];
  let r = rand(st) * total;
  for (const [v, w] of pairs) {
    r -= Math.max(0, w);
    if (r <= 0) return v;
  }
  return pairs[pairs.length - 1][0];
}
