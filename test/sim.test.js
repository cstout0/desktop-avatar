import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, step, applyWorld, setControl, emptyInput } from '../src/renderer/overlay/sim/index.js';
import { grab, moveHeld, release, fireRope, jumpHeight, centerOf } from '../src/renderer/overlay/sim/physics.js';
import { onLoud } from '../src/renderer/overlay/sim/behavior.js';
import { PHYS } from '../src/renderer/overlay/sim/constants.js';

const W = 2560;
const H = 1440;
function makeWorld(platforms = []) {
  return {
    regions: [
      { id: 'A', x: 0, y: 0, w: W, h: H },
      { id: 'B', x: W, y: 0, w: W, h: H },
    ],
    platforms,
  };
}

function run(st, world, secs, keys = emptyInput(), fps = 180, each) {
  const dt = 1 / fps;
  for (let i = 0; i < secs * fps; i++) {
    step(st, world, keys, dt);
    each?.(st, i);
    const c = st.char;
    for (const v of [c.x, c.y, c.vx, c.vy, c.rot]) assert.ok(Number.isFinite(v), `non-finite value at t=${st.t}`);
  }
}

function controlled(x, y, world) {
  const st = createState({ x, y, scale: 1, seed: 7 });
  setControl(st, true);
  return st;
}

test('falls and lands on the monitor floor', () => {
  const world = makeWorld();
  const st = controlled(500, 200, world);
  run(st, world, 2);
  assert.equal(st.char.mode, 'ground');
  assert.equal(st.char.y, H);
  assert.equal(st.char.ground.kind, 'floor');
});

test('walks right across the monitor seam and stops at the far wall', () => {
  const world = makeWorld();
  const st = controlled(2400, H, world);
  run(st, world, 0.5);
  const keys = { ...emptyInput(), right: true, run: true };
  let crossed = false;
  run(st, world, 12, keys, 144, (s) => {
    if (s.char.x > W + 50) crossed = true;
  });
  assert.ok(crossed, 'should cross into the second monitor');
  assert.ok(Math.abs(st.char.x - (2 * W - 20)) < 1, `stopped at wall, x=${st.char.x}`);
  assert.equal(st.char.mode, 'ground');
});

test('full jump reaches the expected height; a tap jump is lower', () => {
  const world = makeWorld();
  const measure = (holdSecs) => {
    const st = controlled(500, H, world);
    run(st, world, 0.3);
    let minY = st.char.y;
    const keys = { ...emptyInput(), jump: true, jumpPressed: true };
    const fps = 240;
    for (let i = 0; i < fps * 1.5; i++) {
      if (i / fps > holdSecs) keys.jump = false;
      step(st, world, keys, 1 / fps);
      minY = Math.min(minY, st.char.y);
    }
    return H - minY;
  };
  const full = measure(1);
  const tap = measure(0.05);
  const expected = jumpHeight(1);
  assert.ok(Math.abs(full - expected) < expected * 0.05, `full jump ${full.toFixed(1)} vs ${expected.toFixed(1)}`);
  assert.ok(tap < full * 0.6, `tap jump ${tap.toFixed(1)} should be much lower than ${full.toFixed(1)}`);
});

test('jumps up through a window edge and lands on top; walking off falls', () => {
  const plat = { id: 'w1', x1: 400, x2: 800, y: H - 120, wx: 400 };
  const world = makeWorld([plat]);
  const st = controlled(600, H, world);
  run(st, world, 0.3);
  const keys = { ...emptyInput(), jump: true, jumpPressed: true };
  run(st, world, 1.2, keys);
  keys.jump = false;
  run(st, world, 0.5, keys);
  assert.equal(st.char.mode, 'ground');
  assert.equal(st.char.ground.kind, 'platform');
  assert.equal(st.char.y, plat.y);
  const walk = { ...emptyInput(), right: true };
  run(st, world, 2.5, walk);
  assert.equal(st.char.ground.kind, 'floor', 'walked off the window onto the floor');
});

test('down + jump drops through a window edge', () => {
  const plat = { id: 'w1', x1: 400, x2: 800, y: 1000, wx: 400 };
  const world = makeWorld([plat]);
  const st = controlled(600, 900, world);
  run(st, world, 1);
  assert.equal(st.char.ground?.id, 'w1');
  run(st, world, 0.05, { ...emptyInput(), down: true, jumpPressed: true });
  run(st, world, 1.5);
  assert.equal(st.char.ground.kind, 'floor');
});

test('grab, drag and throw: flies, tumbles and eventually lands without NaNs', () => {
  const world = makeWorld();
  const st = createState({ x: 1000, y: H, scale: 1, seed: 3 });
  run(st, world, 0.5);
  const cen = centerOf(st.char);
  grab(st, cen.x, cen.y - 20);
  assert.equal(st.char.mode, 'held');
  // Fling right and up.
  for (let i = 0; i < 30; i++) {
    moveHeld(st, cen.x + i * 25, cen.y - 20 - i * 12);
    step(st, world, emptyInput(), 1 / 180);
  }
  release(st);
  assert.equal(st.char.mode, 'air');
  assert.ok(st.char.vx > 1500, `thrown fast to the right, vx=${st.char.vx.toFixed(0)}`);
  const events = [];
  run(st, world, 6, emptyInput(), 180, (s) => events.push(...s.events.map((e) => e.type)));
  assert.equal(st.char.mode, 'ground');
  assert.ok(events.includes('land'));
});

test('hanging by the feet turns the character upside down', () => {
  const world = makeWorld();
  const st = createState({ x: 1000, y: H, scale: 1, seed: 3 });
  run(st, world, 0.5);
  grab(st, st.char.x, st.char.y - 2); // grab at the feet
  for (let i = 0; i < 180 * 2; i++) {
    moveHeld(st, 1000, 700);
    step(st, world, emptyInput(), 1 / 180);
  }
  const rot = Math.abs(Math.atan2(Math.sin(st.char.rot), Math.cos(st.char.rot)));
  assert.ok(rot > Math.PI * 0.85, `rotation ${rot.toFixed(2)} should be ~PI`);
});

test('rope attaches, swings, and release gives a boost', () => {
  const world = makeWorld();
  const st = controlled(1000, H, world);
  run(st, world, 0.3);
  assert.ok(fireRope(st, world, 1300, 900));
  const events = [];
  run(st, world, 0.5, emptyInput(), 180, (s) => events.push(...s.events.map((e) => e.type)));
  assert.ok(events.includes('rope-attach'), 'rope attached');
  assert.equal(st.char.mode, 'rope');
  const len0 = st.char.rope.len;
  run(st, world, 1, { ...emptyInput(), up: true });
  assert.ok(st.char.rope.len < len0 - 200, `reeled in: ${len0.toFixed(0)} -> ${st.char.rope.len.toFixed(0)}`);
  const cen = centerOf(st.char);
  const d = Math.hypot(cen.x - st.char.rope.ax, cen.y - st.char.rope.ay);
  assert.ok(d <= st.char.rope.len + 1, 'rope length constraint holds');
  run(st, world, 0.05, { ...emptyInput(), jumpPressed: true });
  assert.equal(st.char.mode, 'air');
});

test('watch-along: sits down near the video, and a loud moment only makes it gasp', () => {
  const world = makeWorld();
  const st = createState({ x: 600, y: H, scale: 1, seed: 3 });
  run(st, world, 1);
  st.commands.push({ name: 'watch', area: { x1: 1400, y1: 200, x2: 2200, y2: 900 } });
  let seatedAt = null;
  run(st, world, 12, emptyInput(), 180, (s) => {
    if (seatedAt === null && s.anim.pose === 'watch') seatedAt = s.t;
  });
  assert.ok(seatedAt !== null, 'sat down to watch');
  assert.equal(st.brain.name, 'watch');
  assert.ok(Math.abs(st.char.x - 1800) < 250, `seat near the video (x=${Math.round(st.char.x)})`);
  onLoud(st); // e.g. an explosion in the movie
  run(st, world, 1);
  assert.equal(st.brain.name, 'watch', 'still watching');
  assert.equal(st.anim.react?.kind, 'gasp');
});

test('a rope never stays attached once the character is off it', () => {
  const world = makeWorld();
  const st = controlled(1000, H, world);
  run(st, world, 0.3);
  fireRope(st, world, 1300, 900);
  run(st, world, 0.5);
  assert.equal(st.char.rope.state, 'attached');
  // Knocked off the rope by something other than the rope code (e.g. a teleport).
  st.char.mode = 'air';
  run(st, world, 1);
  assert.equal(st.char.rope.state, 'none', 'rope retracted');
  assert.equal(st.char.mode, 'ground');
});

test('rope to a window edge + reel in vaults the character onto the window', () => {
  const plat = { id: 'w9', x1: 900, x2: 1500, y: 700, wx: 900 };
  const world = makeWorld([plat]);
  const st = controlled(1100, H, world);
  run(st, world, 0.3);
  assert.ok(fireRope(st, world, 1150, 705));
  const events = [];
  run(st, world, 5, { ...emptyInput(), up: true }, 180, (s) => events.push(...s.events.map((e) => e.type)));
  run(st, world, 1);
  assert.ok(events.includes('vault'), `events: ${[...new Set(events)].join(',')}`);
  assert.equal(st.char.ground?.id, 'w9');
});

test('moving window carries the character along', () => {
  const p1 = { id: 'w1', x1: 400, x2: 800, y: 1000, wx: 400 };
  const world1 = makeWorld([p1]);
  const st = controlled(600, 900, world1);
  run(st, world1, 1);
  assert.equal(st.char.ground?.id, 'w1');
  const world2 = makeWorld([{ ...p1, x1: 450, x2: 850, y: 980, wx: 450 }]);
  applyWorld(st, world1, world2);
  assert.equal(st.char.x, 650);
  assert.equal(st.char.y, 980);
});

test('state survives a structured clone (monitor hand-off) deterministically', () => {
  const world = makeWorld([{ id: 'w1', x1: 400, x2: 900, y: 1200, wx: 400 }]);
  const a = createState({ x: 700, y: 300, scale: 1.25, seed: 99 });
  run(a, world, 3);
  const b = structuredClone(a);
  run(a, world, 5);
  run(b, world, 5);
  assert.deepEqual(b.char, a.char);
  assert.equal(b.brain.name, a.brain.name);
});

test('autonomous brain: 3 minutes of life stays in bounds and does varied things', () => {
  const world = makeWorld([
    { id: 'w1', x1: 300, x2: 1200, y: 1300, wx: 300 },
    { id: 'w2', x1: 1500, x2: 2300, y: 1150, wx: 1500 },
    { id: 'w3', x1: 700, x2: 1600, y: 850, wx: 700 },
  ]);
  const st = createState({ x: 900, y: 100, scale: 1.25, seed: 4242 });
  st.cursor = { x: 1000, y: 1000, t: 0 };
  const states = new Set();
  const grounds = new Set();
  run(st, world, 180, emptyInput(), 60, (s) => {
    states.add(s.brain.name);
    if (s.char.ground) grounds.add(s.char.ground.id ?? s.char.ground.kind);
    assert.ok(s.char.x >= -1 && s.char.x <= 2 * W + 1, `x in bounds: ${s.char.x}`);
    assert.ok(s.char.y >= 0 && s.char.y <= H + 0.01, `y in bounds: ${s.char.y}`);
  });
  for (const expected of ['idle', 'walk']) assert.ok(states.has(expected), `visited ${expected}; saw ${[...states]}`);
  assert.ok(grounds.size >= 2, `stood on several surfaces: ${[...grounds]}`);
  assert.ok(states.has('hop') || states.has('ropeup'), `tried to climb windows; saw ${[...states]}`);
  console.log('  brain states seen:', [...states].join(', '), '| surfaces:', [...grounds].join(', '));
});

test('music makes an idle character dance, and it stops when the music does', () => {
  const world = makeWorld();
  const st = createState({ x: 500, y: H, scale: 1, seed: 5 });
  run(st, world, 2);
  Object.assign(st.brain, { name: 'idle', t: 0, data: { dur: 99 } });
  Object.assign(st.audio, { music: true, musicSince: st.t, lastMusic: st.t, bpm: 120 });
  let danceAt = null;
  const t0 = st.t;
  run(st, world, 3, emptyInput(), 60, (s) => {
    s.audio.lastMusic = s.t;
    if (danceAt === null && s.brain.name === 'dance') danceAt = s.t - t0;
  });
  assert.ok(danceAt !== null && danceAt < 1.5, `started dancing after ${danceAt?.toFixed(2)} s`);
  st.audio.music = false;
  run(st, world, 6);
  assert.notEqual(st.brain.name, 'dance');
});

// A "Spotify window" from x=1000..1600, y=900..1400: title bar + both sides climbable.
function spotifyWorld() {
  const world = makeWorld([{ id: 'w#0', win: 'w', x1: 1000, x2: 1600, y: 900, wx: 1000 }]);
  world.edges = [
    { id: 'wL0', key: 'wL', win: 'w', x: 1000, y1: 900, y2: 1400, face: 1, top: 900, wx: 1000 },
    { id: 'wR0', key: 'wR', win: 'w', x: 1600, y1: 900, y2: 1400, face: -1, top: 900, wx: 1000 },
  ];
  return world;
}

test('jump into a window side, climb up, and pull up onto its title bar', () => {
  const world = spotifyWorld();
  const st = controlled(880, H, world);
  run(st, world, 0.3);
  const events = [];
  run(st, world, 0.8, { ...emptyInput(), right: true, jump: true, jumpPressed: true }, 180, (s) => events.push(...s.events.map((e) => e.type)));
  assert.ok(events.includes('grab-edge'), `grabbed the side (events: ${[...new Set(events)]})`);
  assert.equal(st.char.mode, 'climb');
  assert.equal(st.char.x, 1000 - 20);
  const y0 = st.char.y;
  run(st, world, 1, { ...emptyInput(), up: true });
  assert.ok(st.char.y < y0 - 100, 'climbs up');
  run(st, world, 4, { ...emptyInput(), up: true }, 180, (s) => events.push(...s.events.map((e) => e.type)));
  run(st, world, 1);
  assert.ok(events.includes('vault'), 'pulled up at the top');
  assert.equal(st.char.ground?.id, 'w', `standing on the window (mode=${st.char.mode})`);
});

test('wall-jump off a window side, or let go by pressing away', () => {
  const world = spotifyWorld();
  const st = controlled(1690, H, world);
  run(st, world, 0.3);
  run(st, world, 0.6, { ...emptyInput(), left: true, jump: true, jumpPressed: true });
  assert.equal(st.char.mode, 'climb', 'grabbed the right side');
  run(st, world, 0.02, { ...emptyInput(), jumpPressed: true });
  assert.equal(st.char.mode, 'air');
  assert.ok(st.char.vx > 300, 'jumped away to the right');
  const st2 = controlled(1690, H, world);
  run(st2, world, 0.3);
  run(st2, world, 0.6, { ...emptyInput(), left: true, jump: true, jumpPressed: true });
  run(st2, world, 0.05, { ...emptyInput(), right: true });
  assert.equal(st2.char.mode, 'air', 'pressing away lets go');
});

test('the screen edge is climbable too', () => {
  const world = makeWorld();
  const st = controlled(90, H, world);
  run(st, world, 0.3);
  run(st, world, 0.5, { ...emptyInput(), left: true, jump: true, jumpPressed: true });
  assert.equal(st.char.mode, 'climb');
  assert.equal(st.char.climb.wall, true);
  const y0 = st.char.y;
  run(st, world, 2, { ...emptyInput(), up: true });
  assert.ok(st.char.y < y0 - 250, 'climbed the screen edge');
});

test('a window being dragged carries a climbing character along', () => {
  const world = spotifyWorld();
  const st = controlled(880, H, world);
  run(st, world, 0.3);
  run(st, world, 0.8, { ...emptyInput(), right: true, jump: true, jumpPressed: true });
  assert.equal(st.char.mode, 'climb');
  const moved = spotifyWorld();
  for (const e of moved.edges) Object.assign(e, { x: e.x + 50, y1: e.y1 - 30, y2: e.y2 - 30, top: e.top - 30, wx: e.wx + 50 });
  const x0 = st.char.x;
  const y0 = st.char.y;
  applyWorld(st, world, moved);
  assert.equal(st.char.x, x0 + 50);
  assert.equal(st.char.y, y0 - 30);
});

for (const [cmd, check] of [
  ['climb', (st) => st.char.ground?.id === 'w'],
  ['swing', (st, seen) => seen.has('rope') && st.char.mode === 'ground'],
  ['wallclimb', (st, seen) => seen.has('climb') && st.char.mode === 'ground'],
]) {
  test(`the brain can "${cmd}" on its own`, () => {
    const world = spotifyWorld();
    const st = createState({ x: 700, y: H, scale: 1, seed: 21 });
    run(st, world, 2.5);
    st.commands.push({ name: cmd });
    const seen = new Set();
    let ok = false;
    run(st, world, 14, emptyInput(), 90, (s) => {
      seen.add(s.char.mode);
      if (!ok && check(s, seen)) ok = true;
    });
    assert.ok(ok, `${cmd} finished (modes seen: ${[...seen]}, brain now: ${st.brain.name})`);
  });
}

test('physics constants sanity', () => {
  assert.ok(PHYS.jumpVel > PHYS.doubleJumpVel);
  assert.ok(jumpHeight(1) > 120 && jumpHeight(1) < 200);
});
