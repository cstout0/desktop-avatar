import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, step, emptyInput } from '../src/renderer/overlay/sim/index.js';
import { newToyWin, stepToyWins, TOY_KINDS } from '../src/renderer/overlay/sim/toys.js';
import { drawToyWin, toyAt } from '../src/renderer/overlay/render/props.js';
import { normalizeLook } from '../src/renderer/overlay/look.js';
import { jumpHeight } from '../src/renderer/overlay/sim/physics.js';

const W = 2560;
const H = 1440;
const world = (platforms = []) => ({ regions: [{ id: 'A', x: 0, y: 0, w: W, h: H }], platforms });

function run(st, wld, secs, each, input) {
  for (let i = 0; i < secs * 120; i++) {
    step(st, wld, input?.(st) ?? emptyInput(), 1 / 120);
    if (each?.(st)) return true;
    for (const v of [st.char.x, st.char.y, st.char.vx, st.char.vy]) assert.ok(Number.isFinite(v));
  }
  return false;
}

function winged(look = {}) {
  const st = createState({ x: 900, y: H, scale: 1.4, seed: 3 });
  st.look = normalizeLook({ arms: 'wings', ...look });
  return st;
}

test('wings: every jump press in the air is another flap; without wings only one double jump', () => {
  const peak = (st) => {
    const wld = world();
    run(st, wld, 0.4);
    st.control.active = true;
    let top = st.char.y;
    for (let i = 0; i < 3 * 120; i++) {
      const input = { ...emptyInput(), jump: true, jumpPressed: i % 20 === 0 };
      step(st, wld, input, 1 / 120);
      top = Math.min(top, st.char.y);
    }
    return H - top;
  };
  const withWings = peak(winged());
  const without = peak(createState({ x: 900, y: H, scale: 1.4, seed: 3 }));
  assert.ok(withWings > without * 2, `flies higher: ${Math.round(withWings)} vs ${Math.round(without)}`);
});

test('wings: holding jump glides down slowly', () => {
  const st = winged();
  const wld = world();
  Object.assign(st.char, { mode: 'air', ground: null, y: 300, vy: 0 });
  st.control.active = true; // the keys drive it (holding jump)
  let maxFall = 0;
  for (let i = 0; i < 120; i++) {
    step(st, wld, { ...emptyInput(), jump: true }, 1 / 120);
    maxFall = Math.max(maxFall, st.char.vy);
  }
  assert.ok(maxFall <= 190 * 1.4 + 1, `glides at ${Math.round(maxFall)}`);
});

test('fly: takes off and lands on a window far too high to jump to', () => {
  const s = 1.4;
  const high = { id: 'high', x1: 1300, x2: 1900, y: H - jumpHeight(s) * 3, wx: 1300 };
  const wld = world([high]);
  const st = winged();
  run(st, wld, 0.5);
  st.commands.push({ name: 'fly' });
  // The "fly" command picks any window top; make sure this one is the target.
  run(st, wld, 0.05);
  if (st.brain.data?.pid !== 'high') {
    st.brain.name = 'fly';
    st.brain.data = { pid: 'high', x: 1600 };
  }
  const landed = run(st, wld, 12, (s2) => s2.char.mode === 'ground' && s2.char.ground?.id === 'high');
  assert.ok(landed, `landed up there (at ${Math.round(st.char.x)},${Math.round(st.char.y)}, ${st.brain.name})`);
});

test('fly: asked to fly without wings, it just shrugs', () => {
  const st = createState({ x: 900, y: H, scale: 1.4, seed: 3 });
  const wld = world();
  run(st, wld, 0.5);
  st.commands.push({ name: 'fly' });
  run(st, wld, 0.2);
  assert.equal(st.brain.name, 'emote');
  assert.equal(st.char.mode, 'ground');
});

test('fetch with wings: flies up to a ball stuck high on a window', () => {
  const s = 1.4;
  const high = { id: 'shelf', x1: 1500, x2: 2000, y: H - jumpHeight(s) * 2.6, wx: 1500 };
  const wld = world([high]);
  const st = winged();
  st.settings.walkOnWindows = true;
  run(st, wld, 0.4);
  st.commands.push({ name: 'game', game: 'fetch' });
  run(st, wld, 0.1);
  Object.assign(st.ball, { carried: false, held: false, resting: true, on: 'shelf', x: 1750, y: high.y - st.ball.r, vx: 0, vy: 0 });
  Object.assign(st.game, { phase: 'chase', thrownAt: st.t, lastThrow: st.t });
  const caught = run(st, wld, 14, (s2) => s2.gameEvents.some((e) => e.type === 'catch'));
  assert.ok(caught, `caught it (char ${Math.round(st.char.x)},${Math.round(st.char.y)} brain=${st.brain.name})`);
});

test('pop-up windows fall, land on window tops, tumble when hit, and settle flat', () => {
  const plat = { id: 'w', x1: 800, x2: 1400, y: 900, wx: 800 };
  const wld = world([plat]);
  const st = createState({ x: 300, y: H, scale: 1.4, seed: 3 });
  st.toys = [newToyWin(st, 1100, 300, 'ad')];
  for (let i = 0; i < 600 && !st.toys[0].resting; i++) stepToyWins(st, wld, 1 / 120);
  const t = st.toys[0];
  assert.equal(t.resting, true);
  assert.equal(t.on, 'w');
  assert.ok(Math.abs(t.y + t.h / 2 - 900) < 1.5, 'sitting on the window top');
  // Knocked off the edge: it flies, spins, and lands on the floor on a flat side.
  Object.assign(t, { vx: 900, vy: -500, rotV: 7, resting: false, on: null });
  for (let i = 0; i < 1200 && !t.resting; i++) stepToyWins(st, wld, 1 / 120);
  assert.equal(t.on, 'floor');
  assert.ok(Math.abs(Math.sin(t.rot * 2)) < 0.02, `flat (rot ${t.rot.toFixed(2)})`);
  assert.ok(t.x < W, 'stayed on the desktop');
});

test('boxing: pop-ups drop in, it punches each one until it breaks, and the round ends', () => {
  const st = createState({ x: 900, y: H, scale: 1.4, seed: 5 });
  st.look = normalizeLook({ arms: 'gloves' });
  const wld = world();
  run(st, wld, 0.5);
  st.commands.push({ name: 'game', game: 'box', total: 2 });
  const events = [];
  let punches = 0;
  const done = run(st, wld, 60, (s2) => {
    for (const e of s2.gameEvents.splice(0)) events.push(e);
    if (s2.anim.pose === 'punch' && s2.anim.poseT === 0) punches++;
    return events.some((e) => e.type === 'box-end');
  });
  assert.ok(done, `round finished (events: ${events.map((e) => e.type).join(',')}, toys: ${st.toys.length}, brain: ${st.brain.name})`);
  const end = events.find((e) => e.type === 'box-end');
  assert.equal(end.kos, 2);
  assert.equal(events.filter((e) => e.type === 'box-ko').length, 2);
  assert.equal(st.toys.length, 0);
  assert.equal(st.game, null);
});

test('boxing: clicking a pop-up punches it (and three hits break it)', () => {
  const st = createState({ x: 300, y: H, scale: 1.4, seed: 5 });
  const wld = world();
  run(st, wld, 0.3);
  st.commands.push({ name: 'game', game: 'box', total: 1 });
  run(st, wld, 2.5);
  const t = st.toys[0];
  assert.ok(t, 'a pop-up dropped in');
  assert.ok(toyAt(st.toys, t.x, t.y) === t, 'hit test finds it');
  const before = t.hits;
  st.commands.push({ name: 'toy-hit', id: t.id, x: t.x - 10 });
  step(st, wld, emptyInput(), 1 / 120);
  assert.equal(t.hits, before + 1);
  assert.ok(t.vx > 0, 'knocked away from the click');
  assert.ok(st.particles.some((p) => p.type === 'pow'), 'POW!');
});

test('pop-up windows draw cleanly (every kind, cracked and spinning)', () => {
  const bad = [];
  const grad = { addColorStop() {} };
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'createLinearGradient') return () => grad;
      return (...args) => args.forEach((a) => typeof a === 'number' && !Number.isFinite(a) && bad.push(`${String(k)}(${args})`));
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  });
  const st = createState({ x: 300, y: H, scale: 1.4, seed: 5 });
  for (const kind of TOY_KINDS) {
    for (const hits of [0, 1, 2]) {
      const t = newToyWin(st, 500, 500, kind);
      Object.assign(t, { hits, rot: hits * 0.7, hitT: 0 });
      drawToyWin(ctx, t, 0.1);
    }
  }
  assert.deepEqual(bad, []);
});
