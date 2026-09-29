import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, step, emptyInput } from '../src/renderer/overlay/sim/index.js';
import { stepAnim, kick } from '../src/renderer/overlay/sim/anim.js';
import { drawCharacter, bounds, hitTest } from '../src/renderer/overlay/render/character.js';
import { ANTENNAS, ARMS, BODIES, LEGS, extraHeight, hasLegs, headRise, hoverOf, normalizeLook } from '../src/renderer/overlay/look.js';
import { DEFAULT_MOTION, GAITS, IDLES, TRAILS, bodyMotion, gaitOf, normalizeMotion } from '../src/renderer/overlay/motion.js';

/** A canvas 2D context that accepts every call and remembers any non-finite number it was given. */
function mockCtx() {
  const bad = [];
  let calls = 0;
  const grad = { addColorStop() {} };
  const target = { bad, get calls() { return calls; } };
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad;
      if (k === 'measureText') return () => ({ width: 10 });
      return (...args) => {
        calls++;
        for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) bad.push(`${String(k)}(${args.join(', ')})`);
      };
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  });
}

const W = 2560;
const H = 1440;
const world = { regions: [{ id: 'A', x: 0, y: 0, w: W, h: H }], platforms: [] };

function poseState(look, motion, pose, extra = {}) {
  const st = createState({ x: 800, y: H, scale: 1.4, seed: 3 });
  st.look = normalizeLook(look);
  st.motion = normalizeMotion(motion);
  Object.assign(st.char, { mode: 'ground', ground: { kind: 'floor' }, ...extra.char });
  st.anim.pose = pose;
  st.anim.walkPhase = extra.phase ?? 1.3;
  st.t = extra.t ?? 2.1;
  st.groundY = H;
  if (extra.flags) Object.assign(st.flags, extra.flags);
  for (let i = 0; i < 10; i++) stepAnim(st, 1 / 60);
  return st;
}

test('looks: body, arms, legs and antenna are validated; tall looks report their height', () => {
  const l = normalizeLook({ body: 'nope', arms: 'tentacles', legs: 'wheels', antenna: 'laser' });
  assert.deepEqual([l.body, l.arms, l.legs, l.antenna], ['classic', 'nubby', 'stubby', 'sparkle']);
  const g = normalizeLook({ body: 'ghost', arms: 'wings', legs: 'boots', antenna: 'heart' });
  assert.deepEqual([g.body, g.arms, g.legs, g.antenna], ['ghost', 'wings', 'boots', 'heart']);
  assert.equal(extraHeight(normalizeLook({})), 0, 'the plain classic body is the baseline');
  assert.equal(headRise(normalizeLook({ body: 'bean' })) - headRise(normalizeLook({})), 8, 'the bean is 8 units taller');
  assert.ok(extraHeight(normalizeLook({ body: 'bean', hat: 'wizard' })) > 30);
  // Legs: some bodies have none, and "Hover" removes them from any body.
  assert.equal(hasLegs(normalizeLook({ body: 'classic' })), true);
  assert.equal(hasLegs(normalizeLook({ body: 'ghost' })), false);
  assert.equal(hasLegs(normalizeLook({ body: 'classic', legs: 'none' })), false);
  assert.ok(hoverOf(normalizeLook({ body: 'classic', legs: 'none' })) > 0);
  assert.equal(hoverOf(normalizeLook({ body: 'classic' })), 0);
});

test('motion settings: unknown values fall back, jiggle is clamped', () => {
  assert.deepEqual(normalizeMotion(null), DEFAULT_MOTION);
  const m = normalizeMotion({ gait: 'moonwalk', idle: 'nap', trail: 'fire', jiggle: 7 });
  assert.deepEqual([m.gait, m.idle, m.trail, m.jiggle], ['auto', 'breathe', 'none', 1]);
  assert.equal(normalizeMotion({ jiggle: 'x' }).jiggle, 0.5);
  assert.equal(normalizeMotion({ gait: 'robot', idle: 'sway', trail: 'bubbles', jiggle: 0.2 }).gait, 'robot');
});

test('"Natural" walk style follows the body', () => {
  const g = (look, gait = 'auto') => gaitOf({ look: normalizeLook(look), motion: normalizeMotion({ gait }) });
  assert.equal(g({ body: 'classic' }), 'walk');
  assert.equal(g({ body: 'ghost' }), 'float');
  assert.equal(g({ body: 'slime' }), 'hop');
  assert.equal(g({ body: 'classic', legs: 'none' }), 'float', 'no legs: it floats');
  assert.equal(g({ body: 'ghost' }, 'robot'), 'robot', 'a chosen style wins');
});

test('every body, arm style and leg style draws cleanly in every kind of pose', () => {
  const poses = [
    ['stand', {}],
    ['walk', { char: { vx: 230 } }],
    ['air', { char: { mode: 'air', ground: null, vy: -500 } }],
    ['held', { char: { mode: 'held', ground: null, rot: 0.6 } }],
    ['rope', { char: { mode: 'rope', ground: null, rot: -0.3 } }],
    ['climb', { char: { mode: 'climb', ground: null, climb: { phase: 0.4 } } }],
    ['sit', {}],
    ['work', {}],
    ['think', { flags: { thinking: true } }],
    ['carry', {}],
    ['covereyes', {}],
  ];
  let draws = 0;
  for (const b of BODIES) {
    for (const arms of ARMS) {
      for (const legs of LEGS) {
        for (const [pose, extra] of poses) {
          const st = poseState({ body: b.id, arms: arms.id, legs: legs.id, antenna: ANTENNAS[draws % ANTENNAS.length].id, hat: draws % 3 ? 'none' : 'tophat' }, {}, pose, extra);
          if (pose === 'carry') st.anim.carry = 'folder';
          const ctx = mockCtx();
          drawCharacter(ctx, st);
          assert.deepEqual(ctx.bad, [], `${b.id}/${arms.id}/${legs.id}/${pose}`);
          assert.ok(ctx.calls > 20);
          draws++;
        }
      }
    }
  }
  assert.equal(draws, BODIES.length * ARMS.length * LEGS.length * poses.length);
});

test('every walk style and idle style animates without breaking (and trails spawn)', () => {
  for (const b of BODIES) {
    for (const g of GAITS) {
      const st = poseState({ body: b.id }, { gait: g.id, trail: 'sparkles' }, 'walk', { char: { vx: 300 } });
      for (let i = 0; i < 40; i++) {
        st.t += 1 / 60;
        st.anim.walkPhase += 0.3;
        stepAnim(st, 1 / 60);
        const ctx = mockCtx();
        drawCharacter(ctx, st);
        assert.deepEqual(ctx.bad, [], `${b.id}/${g.id}`);
      }
      assert.ok(st.particles.some((p) => p.type === 'spark'), `${b.id}/${g.id} leaves sparkles`);
    }
    for (const idle of IDLES) {
      const st = poseState({ body: b.id }, { idle: idle.id }, 'stand');
      for (let i = 0; i < 30; i++) {
        st.t += 0.07;
        stepAnim(st, 1 / 60);
        const ctx = mockCtx();
        drawCharacter(ctx, st);
        assert.deepEqual(ctx.bad, [], `${b.id}/${idle.id}`);
      }
    }
  }
  for (const tr of TRAILS) {
    const st = poseState({}, { trail: tr.id }, 'walk', { char: { vx: 400 } });
    for (let i = 0; i < 60; i++) stepAnim(st, 1 / 60);
    assert.equal(st.particles.length > 0, tr.id !== 'none', tr.id);
  }
});

test('hops lift it off the floor between landings; hovering bodies float; hit testing follows', () => {
  const st = poseState({ body: 'classic' }, { gait: 'hop' }, 'walk', { char: { vx: 165 * 1.4 } });
  st.anim.walkPhase = Math.PI / 2 / 0.36; // mid-hop
  assert.ok(bodyMotion(st).lift > 5);
  st.anim.walkPhase = 0; // touching down
  assert.ok(bodyMotion(st).lift < 0.01);
  const ghost = poseState({ body: 'ghost' }, {}, 'stand', { t: 0 });
  const lift = bodyMotion(ghost).lift;
  assert.ok(lift > 4, `ghost hovers (${lift})`);
  // Clicking where the floating body is (not where it would stand) grabs it.
  const s = ghost.char.scale;
  const cy = ghost.char.y - (35 + lift) * s;
  assert.ok(hitTest(ghost, ghost.char.x, cy - 20 * s));
  const b = bounds(ghost);
  assert.ok(b.y1 < cy - 40 * s && b.y2 >= ghost.char.y);
});

test('rolling turns the body, then it settles upright when it stops', () => {
  const st = poseState({ body: 'mochi' }, { gait: 'roll' }, 'walk', { char: { vx: 300 } });
  for (let i = 0; i < 30; i++) stepAnim(st, 1 / 60);
  assert.ok(Math.abs(st.anim.roll) > 1, `rolled ${st.anim.roll}`);
  st.char.vx = 0;
  st.anim.pose = 'stand';
  for (let i = 0; i < 120; i++) stepAnim(st, 1 / 60);
  assert.equal(st.anim.roll % (2 * Math.PI), 0, 'back upright (a whole number of turns)');
});

test('jiggle: jelly bodies wobble longer than firm ones', () => {
  const wobbles = (jiggle) => {
    const st = poseState({}, { jiggle }, 'stand');
    kick(st, -0.4);
    let crossings = 0;
    let prev = st.anim.squash;
    for (let i = 0; i < 180; i++) {
      stepAnim(st, 1 / 120);
      if (Math.sign(st.anim.squash) !== Math.sign(prev) && Math.abs(st.anim.squash) > 0.004) crossings++;
      prev = st.anim.squash;
    }
    return crossings;
  };
  assert.ok(wobbles(1) > wobbles(0), `${wobbles(1)} > ${wobbles(0)}`);
});

test('sitting lowers the antenna with the body; a walking sim with new looks stays stable', () => {
  const standing = poseState({ body: 'star' }, {}, 'stand');
  const sitting = poseState({ body: 'star' }, {}, 'sit');
  for (let i = 0; i < 120; i++) {
    stepAnim(standing, 1 / 60);
    stepAnim(sitting, 1 / 60);
  }
  assert.ok(sitting.anim.antY - standing.anim.antY > 10 * 1.4, 'the antenna tip comes down when it sits');
  // The full sim (behavior + physics + animation) with a hopping, trailing slime.
  const st = createState({ x: 600, y: H, scale: 1.4, seed: 8 });
  st.look = normalizeLook({ body: 'slime', arms: 'wings', legs: 'boots' });
  st.motion = normalizeMotion({ trail: 'bubbles', jiggle: 1 });
  for (let i = 0; i < 20 * 60; i++) {
    step(st, world, emptyInput(), 1 / 60);
    for (const v of [st.char.x, st.char.y, st.anim.antX, st.anim.antY, st.anim.squash]) assert.ok(Number.isFinite(v));
  }
});
