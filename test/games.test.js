import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, step, emptyInput } from '../src/renderer/overlay/sim/index.js';
import { newBall, stepBall, throwVelocity } from '../src/renderer/overlay/sim/toys.js';
import { EventEmitter } from 'node:events';
import { Games, hideSpots, pickHideSpot, spotCovered } from '../src/main/games.js';

const W = 2560;
const H = 1440;
const world = (platforms = []) => ({
  regions: [
    { id: 'A', x: 0, y: 0, w: W, h: H },
    { id: 'B', x: W, y: 0, w: W, h: H },
  ],
  platforms,
});

function run(st, wld, secs, each) {
  for (let i = 0; i < secs * 120; i++) {
    step(st, wld, emptyInput(), 1 / 120);
    if (each?.(st)) return true;
    const c = st.char;
    for (const v of [c.x, c.y, c.vx, c.vy]) assert.ok(Number.isFinite(v), `non-finite at t=${st.t}`);
  }
  return false;
}

const pointAt = (st, x, y) => Object.assign(st.cursor, { x, y, t: st.t });

// ---- the ball ----

test('the ball bounces, rolls to a stop, and lands on window tops', () => {
  const plat = { id: 'w1', x1: 800, x2: 1400, y: 900, wx: 800 };
  const st = createState({ x: 500, y: H, scale: 1.4, seed: 2 });
  const wld = world([plat]);
  st.ball = newBall(1000, 500, 1.4);
  st.ball.vx = 100;
  let bounced = false;
  for (let i = 0; i < 600 && !st.ball.resting; i++) {
    const vy = st.ball.vy;
    stepBall(st, wld, 1 / 120);
    if (vy > 0 && st.ball.vy < 0) bounced = true;
  }
  assert.ok(bounced, 'bounced');
  assert.equal(st.ball.resting, true);
  assert.equal(st.ball.on, 'w1', 'came to rest on the window top');
  assert.ok(Math.abs(st.ball.y + st.ball.r - 900) < 1);
  // The window closes: the ball falls to the floor.
  wld.platforms = [];
  for (let i = 0; i < 600 && !(st.ball.resting && st.ball.on === 'floor'); i++) stepBall(st, wld, 1 / 120);
  assert.equal(st.ball.on, 'floor');
});

test('the ball bounces off the outer screen edge but flies across to the other monitor', () => {
  const st = createState({ x: 500, y: H, scale: 1.4, seed: 2 });
  const wld = world();
  st.ball = newBall(40, 700, 1.4);
  st.ball.vx = -900;
  for (let i = 0; i < 30; i++) stepBall(st, wld, 1 / 120);
  assert.ok(st.ball.vx > 0, 'bounced off the left edge of the desktop');
  st.ball = newBall(W - 60, 300, 1.4);
  st.ball.vx = 1500;
  for (let i = 0; i < 60; i++) stepBall(st, wld, 1 / 120);
  assert.ok(st.ball.x > W, `crossed into the second monitor (x=${Math.round(st.ball.x)})`);
});

test('throw velocity from recent cursor samples, capped', () => {
  const v = throwVelocity([{ t: 0.0, x: 0, y: 0 }, { t: 0.05, x: 60, y: -30 }], 0.06);
  assert.ok(Math.abs(v.vx - 1200) < 1 && Math.abs(v.vy + 600) < 1, JSON.stringify(v));
  const fast = throwVelocity([{ t: 0.0, x: 0, y: 0 }, { t: 0.02, x: 900, y: 0 }], 0.02, 3000);
  assert.ok(Math.abs(fast.vx - 3000) < 1);
  assert.deepEqual(throwVelocity([{ t: 0, x: 0, y: 0 }], 0.5), { vx: 0, vy: 0 }, 'a ball set down gently just drops');
});

// ---- fetch ----

test('fetch: brings the ball to you, chases the throw, catches it, and brings it back', () => {
  const st = createState({ x: 600, y: H, scale: 1.4, seed: 4 });
  const wld = world();
  run(st, wld, 0.5);
  st.commands.push({ name: 'game', game: 'fetch' });
  run(st, wld, 0.1);
  assert.equal(st.game.phase, 'bring');
  assert.equal(st.ball.carried, true);
  pointAt(st, 1400, H - 200);
  assert.ok(run(st, wld, 10, (s) => s.game.phase === 'wait'), 'dropped the ball at your feet');
  assert.ok(Math.abs(st.char.x - 1400) < 120, `came to the cursor (x=${Math.round(st.char.x)})`);
  // Throw it far to the left.
  Object.assign(st.ball, { held: false, carried: false, resting: false, x: 1400, y: H - 300, vx: -1400, vy: -900 });
  Object.assign(st.game, { phase: 'chase', thrownAt: st.t, lastThrow: st.t });
  const caught = run(st, wld, 14, (s) => s.gameEvents.some((e) => e.type === 'catch'));
  assert.ok(caught, `caught it (ball at ${Math.round(st.ball.x)}, char at ${Math.round(st.char.x)})`);
  assert.equal(st.game.streak, 1);
  assert.equal(st.game.phase, 'bring');
  assert.ok(run(st, wld, 10, (s) => s.game?.phase === 'wait'), 'and brought it back');
});

test('fetch: hops up onto a window to get the ball', () => {
  const plat = { id: 'w9', x1: 900, x2: 1500, y: 1120, wx: 900 };
  const wld = world([plat]);
  const st = createState({ x: 700, y: H, scale: 1.4, seed: 9 });
  run(st, wld, 0.5);
  st.commands.push({ name: 'game', game: 'fetch' });
  run(st, wld, 0.1);
  Object.assign(st.ball, { carried: false, held: false, resting: true, on: 'w9', x: 1200, y: 1120 - st.ball.r, vx: 0, vy: 0 });
  Object.assign(st.game, { phase: 'chase', thrownAt: st.t, lastThrow: st.t });
  const caught = run(st, wld, 14, (s) => s.gameEvents.some((e) => e.type === 'catch'));
  assert.ok(caught, `caught it up on the window (char at ${Math.round(st.char.x)},${Math.round(st.char.y)} brain=${st.brain.name})`);
  assert.equal(st.char.ground?.id ?? st.char.ground?.kind, 'w9', 'standing on the window');
});

test('fetch: gives up on an unreachable ball and it pops back', () => {
  const plat = { id: 'high', x1: 900, x2: 1500, y: 80, wx: 900 };
  const wld = world([plat]);
  const st = createState({ x: 1200, y: H, scale: 1.4, seed: 5 });
  st.settings.walkOnWindows = false; // no hopping, no rope
  run(st, wld, 0.3);
  st.commands.push({ name: 'game', game: 'fetch' });
  run(st, wld, 0.1);
  Object.assign(st.ball, { carried: false, resting: true, on: 'high', x: 1200, y: 80 - st.ball.r });
  Object.assign(st.game, { phase: 'chase', thrownAt: st.t, lastThrow: st.t, streak: 3 });
  assert.ok(run(st, wld, 18, (s) => s.game.phase === 'bring'));
  assert.equal(st.ball.carried, true);
  assert.equal(st.game.streak, 0, 'streak reset');
});

test('fetch: carried away from the ball, it goes back for it (not a catch)', () => {
  const st = createState({ x: 600, y: H, scale: 1.4, seed: 4 });
  const wld = world();
  run(st, wld, 0.5);
  st.commands.push({ name: 'game', game: 'fetch', best: 0 });
  run(st, wld, 0.1);
  pointAt(st, 1000, H - 200);
  assert.ok(run(st, wld, 10, (s) => s.game.phase === 'wait'));
  Object.assign(st.game, { streak: 2 });
  // You pick the character up and drop it on the other monitor.
  Object.assign(st.char, { x: W + 900, y: H, vx: 0, vy: 0 });
  pointAt(st, 1000, H - 200);
  const events = [];
  let went = false;
  const back = run(st, wld, 16, (s) => {
    events.push(...s.gameEvents.splice(0));
    went ||= s.game.phase === 'chase' && s.game.retrieve;
    return went && s.game.phase === 'wait';
  });
  assert.ok(back, `brought it back (phase=${st.game.phase}, char=${Math.round(st.char.x)}, ball=${Math.round(st.ball.x)})`);
  assert.equal(st.game.streak, 2, 'no free points');
  assert.ok(!events.some((e) => e.type === 'catch'));
  assert.ok(Math.abs(st.char.x - 1000) < 120);
});

test('fetch ends when told to (and the ball disappears)', () => {
  const st = createState({ x: 600, y: H, scale: 1.4, seed: 4 });
  const wld = world();
  run(st, wld, 0.3);
  st.commands.push({ name: 'game', game: 'fetch' });
  run(st, wld, 0.2);
  st.commands.push({ name: 'game-end' });
  run(st, wld, 0.1);
  assert.equal(st.game, null);
  assert.equal(st.ball, null);
  assert.ok(st.gameEvents.some((e) => e.type === 'fetch-end'));
});

// ---- hide and seek ----

test('hide spots: behind window edges with room, and past outer screen edges only', () => {
  const regions = world().regions;
  const spots = hideSpots({
    windows: [
      { hwnd: '1', x1: 400, y1: 200, x2: 1400, y2: 1300 }, // big: both sides
      { hwnd: '2', x1: 3000, y1: 500, x2: 3300, y2: 560 }, // too short to hide behind
    ],
    regions,
    scale: 1.4,
  });
  const byWin = spots.filter((s) => s.kind === 'window');
  assert.deepEqual(byWin.map((s) => [s.hwnd, s.face]).sort(), [
    ['1', -1],
    ['1', 1],
  ]);
  const left = byWin.find((s) => s.face === -1);
  assert.ok(left.x > 400 && left.x < 440, 'just inside the left edge');
  assert.ok(left.feetMax <= 1300 && left.feetMin > 200);
  const edges = spots.filter((s) => s.kind === 'edge');
  assert.deepEqual(edges.map((s) => s.face).sort(), [-1, 1], 'far left and far right of the desktop, not the seam');
  assert.ok(edges.every((s) => s.x < 0 || s.x > 2 * W));
  const pick = pickHideSpot(spots, () => 0.1);
  assert.equal(pick.kind, 'window');
  assert.ok(pick.y >= left.feetMin && pick.y <= left.feetMax);
});

test('hide spots: never behind a window on a screen it has to stay off (fullscreen game)', () => {
  // Only the right monitor is available; a fullscreen game fills the left one.
  const regions = [{ id: 'B', x: W, y: 0, w: W, h: H }];
  const spots = hideSpots({
    windows: [
      { hwnd: 'game', x1: 0, y1: 0, x2: W, y2: H },
      { hwnd: 'chat', x1: W + 400, y1: 300, x2: W + 1500, y2: 1300 },
    ],
    regions,
    scale: 1.4,
  });
  assert.ok(!spots.some((s) => s.hwnd === 'game'));
  assert.equal(spots.filter((s) => s.hwnd === 'chat').length, 2);
});

test('hide spots: only where the edge is in view, not under a window on top', () => {
  const regions = world().regions;
  const top = { hwnd: 'top', x1: 300, y1: 700, x2: 900, y2: 1400 }; // covers the lower part of back's left edge
  const back = { hwnd: 'back', x1: 400, y1: 100, x2: 1600, y2: 1300 };
  const spots = hideSpots({ windows: [top, back], regions, scale: 1.4 });
  const left = spots.find((x) => x.hwnd === 'back' && x.face === -1);
  const right = spots.find((x) => x.hwnd === 'back' && x.face === 1);
  assert.ok(left && left.feetMax <= 700, `left edge only above the top window (${left?.feetMin}..${left?.feetMax})`);
  assert.ok(right && right.feetMax > 1200, 'right edge is clear');
  // Stacked the other way round, the whole left edge is fine.
  const flipped = hideSpots({ windows: [back, top], regions, scale: 1.4 }).find((x) => x.hwnd === 'back' && x.face === -1);
  assert.ok(flipped.feetMax > 1200);
  // Fully covered edge: no spot at all.
  const cover = { hwnd: 'cover', x1: 350, y1: 50, x2: 700, y2: 1400 };
  assert.ok(!hideSpots({ windows: [cover, back], regions, scale: 1.4 }).some((x) => x.hwnd === 'back' && x.face === -1));
  assert.equal(spotCovered({ windows: [top, back], hwnd: 'back', spot: { x: 422, y: 1100, face: -1 }, scale: 1.4 }), true);
  assert.equal(spotCovered({ windows: [top, back], hwnd: 'back', spot: { x: 422, y: 600, face: -1 }, scale: 1.4 }), false);
  assert.equal(spotCovered({ windows: [back, top], hwnd: 'back', spot: { x: 422, y: 1100, face: -1 }, scale: 1.4 }), false);
});

test('hide and seek: sneaks to a new spot when a window is put on top of it', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const sent = [];
  const overlays = Object.assign(new EventEmitter(), { sendToBrain: (ch, cmd) => sent.push(cmd), regions: () => world().regions });
  const settings = { get: (k) => ({ scale: 1.4, 'games.hideSeconds': 60 })[k], set() {} };
  const back = { hwnd: 'back', x1: 400, y1: 100, x2: 1600, y2: 1300 };
  let wins = [back];
  const games = new Games({ settings, overlays, windows: () => wins, rectOf: (h) => wins.find((w) => w.hwnd === h) ?? null, log() {} });
  // Always pick a window spot on the left edge first.
  const rnd = Math.random;
  Math.random = () => 0.05;
  try {
    assert.equal(games.start('hide').ok, true);
  } finally {
    Math.random = rnd;
  }
  const spot = sent[0].spot;
  assert.equal(spot.hwnd, 'back');
  t.mock.timers.tick(600);
  assert.equal(sent.length, 1, 'nothing happens while the spot is clear');
  // You open another window right over it.
  wins = [{ hwnd: 'new', x1: spot.x - 200, y1: 0, x2: spot.x + 200, y2: 1440 }, back];
  t.mock.timers.tick(450);
  const move = sent.find((c) => c.name === 'hide-move');
  assert.ok(move, JSON.stringify(sent));
  assert.ok(!(move.spot.hwnd === 'back' && move.spot.face === spot.face), 'a different spot');
  assert.ok(!spotCovered({ windows: wins, hwnd: move.spot.hwnd ?? 'none', spot: move.spot, scale: 1.4 }));
  games.stopTracking();
});

test('hide and seek: counts, poofs into the spot, and pops out when found', () => {
  const st = createState({ x: 600, y: H, scale: 1.4, seed: 6 });
  const wld = world();
  run(st, wld, 0.4);
  const spot = { x: 416, y: 1200, face: -1, clip: { x1: 400, y1: 200, x2: 1400, y2: 1300 } };
  st.commands.push({ name: 'game', game: 'hide', spot, seconds: 60 });
  run(st, wld, 0.2);
  assert.equal(st.anim.pose, 'covereyes');
  assert.ok(run(st, wld, 3, (s) => s.char.mode === 'hidden'));
  assert.deepEqual([st.char.x, st.char.y], [416, 1200]);
  run(st, wld, 2);
  assert.deepEqual([st.char.x, st.char.y], [416, 1200], 'stays put while hidden');
  assert.equal(st.anim.pose, 'hiding');
  st.commands.push({ name: 'hide-rect', dx: 30, dy: -10, rect: { x1: 430, y1: 190, x2: 1430, y2: 1290 } });
  run(st, wld, 0.05);
  assert.deepEqual([st.char.x, st.char.y], [446, 1190], 'follows its window when you move it');
  st.commands.push({ name: 'hide-move', spot: { x: 1384, y: 1000, face: 1, clip: { x1: 430, y1: 190, x2: 1430, y2: 1290 } } });
  run(st, wld, 0.05);
  assert.deepEqual([st.char.x, st.char.y, st.char.facing, st.char.mode], [1384, 1000, 1, 'hidden'], 'sneaks over to the new spot');
  st.commands.push({ name: 'found' });
  run(st, wld, 0.05);
  assert.equal(st.game, null);
  const end = st.gameEvents.find((e) => e.type === 'hide-end');
  assert.equal(end.how, 'found');
  assert.ok(end.secs > 1.9 && end.secs < 3, `${end.secs}`);
  assert.ok(run(st, wld, 3, (s) => s.char.mode === 'ground'), 'pops out and lands');
});

test('hide and seek: giggles get more frequent as your cursor gets warmer', () => {
  const giggles = (cursorAt) => {
    const st = createState({ x: 600, y: H, scale: 1.4, seed: 6 });
    const wld = world();
    run(st, wld, 0.4);
    st.commands.push({ name: 'game', game: 'hide', spot: { x: 1416, y: 1200, face: -1, clip: { x1: 1400, y1: 200, x2: 2400, y2: 1300 } }, seconds: 120 });
    run(st, wld, 3);
    let notes = 0;
    for (let i = 0; i < 12 * 120; i++) {
      if (cursorAt) Object.assign(st.cursor, { ...cursorAt, t: st.t });
      const before = st.particles.filter((p) => p.type === 'note').length;
      step(st, wld, emptyInput(), 1 / 120);
      notes += Math.max(0, st.particles.filter((p) => p.type === 'note').length - before);
    }
    return notes;
  };
  const cold = giggles(null);
  const warm = giggles({ x: 1100, y: 1100 });
  const hot = giggles({ x: 1370, y: 1150 });
  assert.ok(cold <= 2, `cold: ${cold}`);
  assert.ok(warm > cold, `warm ${warm} > cold ${cold}`);
  assert.ok(hot > warm, `hot ${hot} > warm ${warm}`);
});

test('hide and seek: wins if you run out of time', () => {
  const st = createState({ x: 600, y: H, scale: 1.4, seed: 6 });
  const wld = world();
  run(st, wld, 0.4);
  st.commands.push({ name: 'game', game: 'hide', spot: { x: -20, y: H, face: 1, clip: null }, seconds: 2 });
  assert.ok(run(st, wld, 8, (s) => s.gameEvents.some((e) => e.type === 'hide-end')));
  assert.equal(st.gameEvents.find((e) => e.type === 'hide-end').how, 'timeout');
});
