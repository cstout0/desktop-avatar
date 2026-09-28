// Claude's autonomous brain. Each state "presses buttons" on a virtual
// controller, so autonomous movement obeys exactly the same physics as keyboard
// control. All state lives in st.brain (plain data) to survive hand-offs.
import { BODY, CENTER_Y, HIT, PHYS as P } from './constants.js';
import { centerOf, fireRope, handPoint, jumpHeight, releaseRope } from './physics.js';
import { express, kick, physicalPose, setPose } from './anim.js';
import { burst, spawn } from './particles.js';
import { clamp, pick, rand, randRange, weighted } from './util.js';
import { allEdges, groundSpan, platformFor, platKey } from './world.js';

export function newBrain() {
  return {
    name: 'intro',
    t: 0,
    data: {},
    pokes: 0,
    pokeT: -99,
    petScore: 0,
    petDir: 0,
    petLastX: 0,
    lastPet: -99,
    lastWave: -99,
    lastStartle: -99,
    lastChatter: 0,
    nearSince: -1,
    stuckT: 0,
  };
}

export function emptyInput() {
  return { left: false, right: false, up: false, down: false, run: false, jump: false, jumpPressed: false, ropePressed: false };
}

export function say(st, text, mood = 'normal', dur) {
  st.say.push({ text, mood, dur });
}

export function goto(st, name, data = {}) {
  const b = st.brain;
  b.name = name;
  b.t = 0;
  b.data = data;
  b.stuckT = 0;
  ENTER[name]?.(st, b);
}

const ENTER = {
  idle(st, b) {
    b.data.dur ??= randRange(st, 1.8, 4.5);
  },
  sit(st, b) {
    b.data.dur ??= randRange(st, 5, 14);
  },
  sleep(st) {
    st.anim.face = { eyes: 'closed', mouth: 'o', brows: null, blush: 0.25 };
  },
};

function restFace(st) {
  st.anim.face = { eyes: 'normal', mouth: 'smile', brows: null, blush: 0.35 };
}

// ---- helpers ----------------------------------------------------------------

function walkTo(st, input, tx, run = false) {
  const c = st.char;
  const s = c.scale;
  const dx = tx - c.x;
  if (Math.abs(dx) < 7 * s) return Math.abs(c.vx) < 30 * s;
  const stopDist = (c.vx * c.vx) / (2 * P.groundDecel * s);
  if (Math.sign(c.vx) === Math.sign(dx) && Math.abs(dx) <= stopDist + 3 * s) return false;
  if (dx > 0) input.right = true;
  else input.left = true;
  input.run = run;
  return false;
}

function trackStuck(st, b, dt, trying) {
  const c = st.char;
  if (trying && Math.abs(c.vx) < 8 * c.scale && c.mode === 'ground') b.stuckT += dt;
  else b.stuckT = 0;
  return b.stuckT > 0.6;
}

function cursorRecent(st, secs = 3) {
  return st.t - st.cursor.t < secs;
}

function cursorDist(st) {
  const cen = centerOf(st.char);
  return Math.hypot(st.cursor.x - cen.x, st.cursor.y - cen.y);
}

/** Platforms Claude can reach by jumping straight up through their edge. */
function hopTargets(st, world) {
  const c = st.char;
  const s = c.scale;
  if (c.mode !== 'ground' || !st.settings.walkOnWindows) return [];
  const span = groundSpan(world, c);
  if (!span) return [];
  const single = jumpHeight(s) * 0.88;
  const dbl = single + ((P.doubleJumpVel * P.doubleJumpVel) / (2 * P.gravity)) * s * 0.8;
  const out = [];
  for (const p of world.platforms) {
    if (c.ground?.id === platKey(p)) continue;
    const rise = c.y - p.y;
    if (rise < 30 * s || rise > dbl) continue;
    const margin = 26 * s;
    if (p.x2 - p.x1 < margin * 2 + 10) continue;
    const lx = clamp(c.x, Math.max(p.x1 + margin, span.x1 + 20 * s), Math.min(p.x2 - margin, span.x2 - 20 * s));
    if (lx < p.x1 + margin - 1 || lx > p.x2 - margin + 1) continue;
    if (Math.abs(lx - c.x) > 900 * s) continue;
    out.push({ p, lx, double: rise > single });
  }
  return out;
}

function ropeTargets(st, world) {
  const c = st.char;
  const s = c.scale;
  if (c.mode !== 'ground' || !st.settings.walkOnWindows) return [];
  const span = groundSpan(world, c);
  if (!span) return [];
  const minRise = jumpHeight(s) * 0.88 + 60 * s;
  const out = [];
  for (const p of world.platforms) {
    if (c.ground?.id === platKey(p)) continue;
    const rise = c.y - p.y;
    if (rise < minRise || rise > P.ropeMax * s * 0.85) continue;
    if (p.x2 - p.x1 < 80 * s) continue;
    const ax = clamp(c.x, p.x1 + 30 * s, p.x2 - 30 * s);
    const standX = clamp(ax, span.x1 + 24 * s, span.x2 - 24 * s);
    if (Math.abs(standX - ax) > 160 * s || Math.abs(standX - c.x) > 800 * s) continue;
    out.push({ p, ax, standX });
  }
  return out;
}

/** Window sides Claude can jump onto and climb up to the title bar. */
function climbTargets(st, world) {
  const c = st.char;
  const s = c.scale;
  if (c.mode !== 'ground' || !st.settings.walkOnWindows) return [];
  const span = groundSpan(world, c);
  if (!span) return [];
  const hw = HIT.hw * s;
  const hand = (CENTER_Y + 10) * s;
  const reachTop = c.y - hand - jumpHeight(s) * 0.85;
  const out = [];
  for (const e of world.edges ?? []) {
    if (e.y2 - e.y1 < 140 * s || e.y1 > c.y - hand - 60 * s || e.y2 < reachTop + 10 * s) continue;
    const tx = e.x - e.face * (hw + 70 * s);
    if (tx < span.x1 + hw || tx > span.x2 - hw || Math.abs(tx - c.x) > 1100 * s) continue;
    const top = platformFor(world, e.win, e.x + e.face * 40 * s);
    if (!top || Math.abs(top.y - e.y1) > 3) continue;
    out.push({ e, tx });
  }
  return out;
}

function nearestWall(st, world) {
  const c = st.char;
  let best = null;
  for (const e of allEdges(world)) {
    if (!e.wall || c.y < e.y1 || c.y > e.y2 + 2) continue;
    const d = Math.abs(e.x - c.x);
    if (!best || d < best.d) best = { e, d };
  }
  return best && best.d < 1400 * c.scale ? best.e : null;
}

function swingAnchor(st, world) {
  const c = st.char;
  const s = c.scale;
  const hand = handPoint(c);
  const f = c.facing || 1;
  const max = P.ropeMax * s * 0.85;
  // Prefer a real window edge above and ahead.
  let best = null;
  for (const p of world.platforms) {
    const ax = clamp(hand.x + f * 180 * s, p.x1 + 10 * s, p.x2 - 10 * s);
    const dy = hand.y - p.y;
    const d = Math.hypot(ax - hand.x, dy);
    if (dy < 180 * s || d > max) continue;
    const score = d + Math.abs(ax - (hand.x + f * 180 * s));
    if (!best || score < best.score) best = { x: ax, y: p.y, score };
  }
  if (best) return best;
  const r = world.regions.find((q) => c.x >= q.x && c.x <= q.x + q.w) ?? world.regions[0];
  return { x: clamp(hand.x + f * randRange(st, 120, 220) * s, r.x + 40 * s, r.x + r.w - 40 * s), y: Math.max(r.y + 40 * s, hand.y - randRange(st, 300, 420) * s) };
}

function otherRegion(st, world) {
  const c = st.char;
  if (world.regions.length < 2 || c.ground?.kind !== 'floor') return null;
  const span = groundSpan(world, c);
  const mine = world.regions.find((r) => c.x >= r.x && c.x <= r.x + r.w);
  const others = world.regions.filter((r) => r !== mine && span && r.x >= span.x1 - 2 && r.x + r.w <= span.x2 + 2);
  return others.length ? pick(st, others) : null;
}

// ---- choosing what to do next -------------------------------------------------

function choose(st, world) {
  const c = st.char;
  const s = c.scale;
  if (st.audio.music && st.settings.audio) return goto(st, 'dance');
  const idleFor = st.t - st.stats.lastInteraction;
  if (idleFor > st.settings.sleepAfter && rand(st) < 0.4 && c.mode === 'ground') return goto(st, 'sleep');
  const onPlatform = c.ground?.kind === 'platform';
  const hops = hopTargets(st, world);
  const ropes = hops.length ? [] : ropeTargets(st, world);
  const climbs = climbTargets(st, world);
  const other = otherRegion(st, world);
  const next = weighted(st, [
    ['idle', 2.6],
    ['walk', 3.2],
    ['sit', onPlatform ? 2.2 : 0.9],
    ['hop', hops.length ? 2 : 0],
    ['ropeup', ropes.length ? 1 : 0],
    ['climb', climbs.length ? 1.3 : 0],
    ['wallclimb', !onPlatform ? 0.25 : 0],
    ['swing', 0.35],
    ['descend', onPlatform ? 1.3 : 0],
    ['travel', other ? 0.55 : 0],
    ['emote', 0.8],
  ]);
  if (next === 'climb') {
    const k = pick(st, climbs);
    return goto(st, 'climb', { key: k.e.key, win: k.e.win, face: k.e.face, tx: k.tx, phase: 'approach' });
  }
  if (next === 'wallclimb' || next === 'swing') return goto(st, next, { phase: next === 'swing' ? 'aim' : 'approach' });
  if (next === 'walk') {
    const span = groundSpan(world, c);
    if (!span) return goto(st, 'idle');
    const m = 40 * s;
    let tx = randRange(st, span.x1 + m, span.x2 - m);
    if (Math.abs(tx - c.x) > 1200 * s) tx = c.x + Math.sign(tx - c.x) * randRange(st, 300, 1200) * s;
    return goto(st, 'walk', { tx, run: rand(st) < 0.18 });
  }
  if (next === 'hop') {
    const h = pick(st, hops);
    return goto(st, 'hop', { pid: platKey(h.p), lx: h.lx, double: h.double, phase: 'approach' });
  }
  if (next === 'ropeup') {
    const r = pick(st, ropes);
    return goto(st, 'ropeup', { pid: platKey(r.p), ax: r.ax, standX: r.standX, phase: 'approach' });
  }
  if (next === 'travel') {
    const r = other;
    return goto(st, 'walk', { tx: randRange(st, r.x + r.w * 0.2, r.x + r.w * 0.8), run: rand(st) < 0.35, travel: true });
  }
  if (next === 'emote') {
    const kind = pick(st, ['wave', 'stretch', 'lookaround', 'flip', 'hum', 'shrug']);
    if (kind === 'wave' && !(cursorRecent(st, 5) && cursorDist(st) < 700 * s)) return goto(st, 'emote', { kind: 'lookaround', dur: 2.4 });
    return goto(st, 'emote', { kind, dur: EMOTE_DUR[kind] });
  }
  if (next === 'descend') return goto(st, 'descend', { drop: rand(st) < 0.35 });
  return goto(st, next);
}

const EMOTE_DUR = { wave: 1.7, stretch: 2.2, lookaround: 2.4, flip: 1.0, hum: 2.8, shrug: 1.4, celebrate: 1.8, jump: 0.9, spin: 1.2, yawn: 2.4, laugh: 1.6 };

// ---- states -------------------------------------------------------------------

const STATES = {
  intro(st, world, b, input) {
    const c = st.char;
    setPose(st, physicalPose(c));
    if (c.mode === 'ground' && b.t > 0.25) {
      goto(st, 'emote', { kind: 'wave', dur: 1.8 });
      st.brain.lastWave = st.t;
      say(st, greeting(st), 'happy');
    }
  },

  idle(st, world, b, input) {
    const c = st.char;
    const s = c.scale;
    setPose(st, c.mode === 'ground' ? (st.anim.pose === 'crouch' ? 'crouch' : 'stand') : physicalPose(c));
    if (st.anim.pose === 'crouch' && b.t > 0.2) setPose(st, 'stand');
    if (cursorRecent(st, 2) && cursorDist(st) < 500 * s && Math.abs(st.cursor.x - c.x) > 10 * s) c.facing = Math.sign(st.cursor.x - c.x);
    // Wave hello when the cursor comes close after a while.
    if (cursorRecent(st, 0.5) && cursorDist(st) < 260 * s && st.t - b.lastWave > 90 && c.mode === 'ground') {
      b.lastWave = st.t;
      return goto(st, 'emote', { kind: 'wave', dur: 1.6 });
    }
    maybeChatter(st);
    if (b.t > b.data.dur && c.mode === 'ground') choose(st, world);
  },

  walk(st, world, b, input, dt) {
    const c = st.char;
    const arrived = c.mode === 'ground' && walkTo(st, input, b.data.tx, b.data.run);
    setPose(st, physicalPose(c));
    const stuck = trackStuck(st, b, dt, input.left || input.right);
    if (arrived || stuck || b.t > 14) goto(st, 'idle');
    else if (c.mode === 'air' && c.airT > 0.35) goto(st, 'idle'); // walked off a ledge
  },

  sit(st, world, b) {
    const c = st.char;
    if (c.mode !== 'ground') return goto(st, 'idle');
    setPose(st, 'sit');
    if (b.t > b.data.dur) goto(st, 'idle', { dur: 0.6 });
  },

  sleep(st, world, b) {
    const c = st.char;
    if (c.mode !== 'ground') return goto(st, 'idle');
    setPose(st, 'sleep');
    st.anim.face = { eyes: 'closed', mouth: b.t % 7 < 3.5 ? 'o' : 'smile', brows: null, blush: 0.3 };
    if (b.t >= (b.data.nextZ ?? 0.8)) {
      b.data.nextZ = b.t + 1.7;
      const cen = centerOf(c);
      spawn(st, 'zzz', cen.x + 14 * c.scale * c.facing, cen.y - 24 * c.scale, { vx: 14 * c.facing, vy: -26, max: 2.6, size: 11, wobble: 10 });
    }
    if (st.audio.music && st.settings.audio && b.t > 5 && st.audio.energy > 0.35) wake(st, false);
  },

  dance(st, world, b, input, dt) {
    const c = st.char;
    if (c.mode !== 'ground') {
      setPose(st, physicalPose(c));
      return;
    }
    setPose(st, 'dance');
    st.anim.face = { eyes: st.anim.danceMove === 'arms' ? 'happy' : 'normal', mouth: 'open', brows: null, blush: 0.5 };
    if (b.data.hopT > 0) {
      input.jump = true;
      if (!b.data.hopStarted) {
        input.jumpPressed = true;
        b.data.hopStarted = true;
      }
      b.data.hopT -= dt;
    } else {
      b.data.hopStarted = false;
    }
    const forced = b.data.until && st.t < b.data.until;
    const musicGone = !st.audio.music && st.t - st.audio.lastMusic > 3;
    if ((!forced && musicGone) || (b.data.until && st.t >= b.data.until && musicGone)) {
      restFace(st);
      st.brain.lastDanceEnd = st.t;
      goto(st, 'emote', { kind: 'celebrate', dur: 1.2 });
    }
  },

  hop(st, world, b, input, dt) {
    const c = st.char;
    const s = c.scale;
    const p = platformFor(world, b.data.pid, b.data.lx);
    if (!p) return goto(st, 'idle');
    setPose(st, physicalPose(c));
    if (b.data.phase === 'approach') {
      const lx = clamp(b.data.lx, p.x1 + 20 * s, p.x2 - 20 * s);
      if (c.mode !== 'ground') return goto(st, 'idle');
      const arrived = walkTo(st, input, lx, Math.abs(lx - c.x) > 400 * s);
      if (trackStuck(st, b, dt, input.left || input.right) || b.t > 10) return goto(st, 'idle');
      if (arrived) {
        b.data.phase = 'jump';
        b.data.lx = lx;
      }
    } else if (b.data.phase === 'jump') {
      input.jumpPressed = true;
      input.jump = true;
      b.data.phase = 'air';
      b.data.airT = 0;
    } else {
      b.data.airT += dt;
      input.jump = true;
      if (c.x < b.data.lx - 5 * s) input.right = true;
      else if (c.x > b.data.lx + 5 * s) input.left = true;
      if (b.data.double && !b.data.dj && c.vy > -120 * s && c.y > p.y - 4 * s) {
        input.jumpPressed = true;
        b.data.dj = true;
      }
      if (c.mode === 'ground' && b.data.airT > 0.1) {
        if (c.ground?.id === b.data.pid) {
          if (rand(st) < 0.3) express(st, { eyes: 'happy', mouth: 'open' }, 0.8);
          goto(st, rand(st) < 0.45 ? 'sit' : 'idle');
        } else {
          goto(st, 'idle');
        }
      } else if (b.data.airT > 3) {
        goto(st, 'idle');
      }
    }
  },

  ropeup(st, world, b, input, dt) {
    const c = st.char;
    const s = c.scale;
    const p = platformFor(world, b.data.pid, b.data.ax);
    if (!p) {
      if (c.mode === 'rope') releaseRope(st, false);
      return goto(st, 'idle');
    }
    setPose(st, physicalPose(c));
    if (b.data.phase === 'approach') {
      if (c.mode !== 'ground') return goto(st, 'idle');
      const arrived = walkTo(st, input, b.data.standX, Math.abs(b.data.standX - c.x) > 400 * s);
      if (trackStuck(st, b, dt, input.left || input.right) || b.t > 10) return goto(st, 'idle');
      if (arrived) {
        c.facing = Math.sign(b.data.ax - c.x) || c.facing;
        b.data.phase = 'aim';
        b.data.aimT = 0;
      }
    } else if (b.data.phase === 'aim') {
      b.data.aimT += dt;
      express(st, { eyes: 'normal', mouth: 'flat', brows: 'determined' }, 0.6);
      if (b.data.aimT > 0.35) {
        const ok = fireRope(st, world, b.data.ax, p.y);
        b.data.phase = ok ? 'reel' : 'done';
        b.data.reelT = 0;
      }
    } else if (b.data.phase === 'reel') {
      b.data.reelT += dt;
      if (c.mode === 'rope') input.up = true;
      if (c.mode === 'ground' && c.ground?.id === b.data.pid) {
        express(st, { eyes: 'happy', mouth: 'open' }, 1);
        return goto(st, rand(st) < 0.5 ? 'sit' : 'idle');
      }
      if (b.data.reelT > 7) {
        if (c.mode === 'rope') releaseRope(st, false);
        return goto(st, 'idle');
      }
      if (c.mode === 'ground' && b.data.reelT > 1) goto(st, 'idle');
    } else {
      goto(st, 'idle');
    }
  },

  watch(st, world, b, input) {
    const c = st.char;
    const s = c.scale;
    const d = b.data;
    const a = d.area;
    if (!a) return goto(st, 'idle');
    const vx = (a.x1 + a.x2) / 2;
    const vy = (a.y1 + a.y2) / 2;
    st.anim.watchAt = { x: vx, y: vy };
    if (d.phase === 'go') {
      if (d.seatX == null) {
        const mine = world.regions.find((r) => c.x >= r.x && c.x <= r.x + r.w) ?? world.regions[0];
        if (a.fullscreen) {
          // The video fills another monitor: sit at the edge of this one, facing it.
          d.seatX = vx < mine.x ? mine.x + 70 * s : mine.x + mine.w - 70 * s;
        } else {
          const r = world.regions.find((q) => vx >= q.x && vx <= q.x + q.w) ?? mine;
          const off = (rand(st) < 0.5 ? -1 : 1) * (a.x2 - a.x1) * 0.18;
          d.seatX = clamp(vx + off, r.x + 60 * s, r.x + r.w - 60 * s);
        }
      }
      if (c.ground?.kind === 'platform' && !d.dropped) {
        // Hop down off the window we're on.
        input.down = true;
        input.jumpPressed = true;
        d.dropped = true;
      }
      setPose(st, physicalPose(c));
      const arrived = c.mode === 'ground' && walkTo(st, input, d.seatX, Math.abs(d.seatX - c.x) > 300 * s);
      if (arrived || b.t > 25) {
        d.phase = 'sit';
        c.facing = Math.sign(vx - c.x) || c.facing;
      }
    } else {
      setPose(st, c.mode === 'ground' ? 'watch' : physicalPose(c));
    }
  },

  climb(st, world, b, input, dt) {
    const c = st.char;
    const s = c.scale;
    setPose(st, physicalPose(c));
    const d = b.data;
    if (d.phase === 'approach') {
      if (c.mode !== 'ground') return goto(st, 'idle');
      const arrived = walkTo(st, input, d.tx, Math.abs(d.tx - c.x) > 400 * s);
      if (trackStuck(st, b, dt, input.left || input.right) || b.t > 10) return goto(st, 'idle');
      if (arrived) {
        d.phase = 'jump';
        c.facing = d.face;
      }
    } else if (d.phase === 'jump') {
      input.jumpPressed = true;
      input.jump = true;
      input[d.face > 0 ? 'right' : 'left'] = true;
      d.phase = 'air';
      d.airT = 0;
    } else if (d.phase === 'air') {
      d.airT += dt;
      input.jump = true;
      input[d.face > 0 ? 'right' : 'left'] = true;
      if (c.mode === 'climb') {
        d.phase = 'up';
        express(st, { eyes: 'normal', mouth: 'flat', brows: 'determined' }, 1.5);
      } else if ((c.mode === 'ground' && d.airT > 0.15) || d.airT > 2.5) {
        goto(st, 'idle');
      }
    } else if (d.phase === 'up') {
      if (c.mode === 'climb') input.up = true;
      else if (c.mode === 'ground') {
        if (c.ground?.id === d.win) {
          express(st, { eyes: 'happy', mouth: 'open' }, 1.2);
          goto(st, rand(st) < 0.5 ? 'sit' : 'idle');
        } else goto(st, 'idle');
      }
      if (b.t > 14) goto(st, 'idle');
    }
  },

  wallclimb(st, world, b, input, dt) {
    const c = st.char;
    const s = c.scale;
    setPose(st, physicalPose(c));
    const d = b.data;
    if (d.phase === 'approach') {
      const w = nearestWall(st, world);
      if (!w || c.mode !== 'ground') return goto(st, 'idle');
      d.face = w.face;
      d.climbT = d.climbT ?? randRange(st, 0.8, 2.4);
      const gx = w.x - w.face * HIT.hw * s;
      if (Math.abs(gx - c.x) > 90 * s) {
        input[w.face > 0 ? 'right' : 'left'] = true;
        input.run = Math.abs(gx - c.x) > 500 * s;
        if (trackStuck(st, b, dt, true) || b.t > 12) goto(st, 'idle');
      } else {
        input.jumpPressed = true;
        input.jump = true;
        input[w.face > 0 ? 'right' : 'left'] = true;
        d.phase = 'air';
        d.airT = 0;
      }
    } else if (d.phase === 'air') {
      d.airT += dt;
      input.jump = true;
      input[d.face > 0 ? 'right' : 'left'] = true;
      if (c.mode === 'climb') {
        d.phase = 'up';
        d.upT = 0;
      } else if ((c.mode === 'ground' && d.airT > 0.15) || d.airT > 2.5) goto(st, 'idle');
    } else if (d.phase === 'up') {
      if (c.mode !== 'climb') return c.mode === 'ground' ? goto(st, 'idle') : undefined;
      d.upT = (d.upT ?? 0) + dt;
      if (d.upT < (d.climbT ?? 1)) input.up = true;
      else if (d.upT > (d.climbT ?? 1) + 0.7) {
        input.jumpPressed = true; // wall-jump off with style
        c.flipT = 0.5;
        d.phase = 'off';
      }
    } else if (c.mode === 'ground') {
      goto(st, 'idle', { dur: 0.8 });
    }
  },

  swing(st, world, b, input, dt) {
    const c = st.char;
    const s = c.scale;
    setPose(st, physicalPose(c));
    const d = b.data;
    if (d.phase === 'aim') {
      if (c.mode !== 'ground') return goto(st, 'idle');
      const a = swingAnchor(st, world);
      if (!fireRope(st, world, a.x, a.y)) return goto(st, 'idle');
      express(st, { eyes: 'normal', mouth: 'open', brows: 'determined' }, 1.2);
      d.phase = 'wait';
      d.swingT = randRange(st, 3, 5);
    } else if (d.phase === 'wait') {
      if (c.mode === 'rope') {
        d.phase = 'swinging';
        d.t0 = b.t;
      } else if (b.t > 1.5) goto(st, 'idle');
    } else if (d.phase === 'swinging') {
      if (c.mode !== 'rope') {
        d.phase = 'flying'; // landed on something mid-swing
        return;
      }
      // Pump in the direction of motion to build the swing up.
      const dir = Math.abs(c.vx) > 30 * s ? Math.sign(c.vx) : c.facing || 1;
      input[dir > 0 ? 'right' : 'left'] = true;
      if (c.rope.len > 260 * s) input.up = true; // shorter rope, snappier swing
      const swung = b.t - d.t0;
      if ((swung > d.swingT && c.vy < 0) || swung > d.swingT + 1.5) {
        input.jumpPressed = true; // let go on an up-swing
        d.phase = 'flying';
      }
    } else if (c.mode === 'ground') {
      express(st, { eyes: 'happy', mouth: 'open' }, 1);
      goto(st, 'emote', { kind: 'celebrate', dur: 1.2 });
    }
  },

  descend(st, world, b, input, dt) {
    const c = st.char;
    if (c.ground?.kind !== 'platform') {
      setPose(st, physicalPose(c));
      if (c.mode === 'ground' && b.t > 0.2) {
        if (b.data.then) goto(st, 'walk', b.data.then);
        else goto(st, 'idle');
      }
      return;
    }
    setPose(st, physicalPose(c));
    if (b.data.drop && b.t > 0.4) {
      input.down = true;
      input.jumpPressed = true;
      b.data.drop = false;
      return;
    }
    const p = platformFor(world, c.ground.id, c.x);
    if (!p) return;
    b.data.dir ??= c.x - p.x1 < p.x2 - c.x ? -1 : 1;
    if (b.data.dir < 0) input.left = true;
    else input.right = true;
    if (trackStuck(st, b, dt, true) || b.t > 10) goto(st, 'idle');
  },

  follow(st, world, b, input) {
    const c = st.char;
    const s = c.scale;
    setPose(st, physicalPose(c));
    if (c.mode !== 'ground') return;
    const far = Math.abs(st.cursor.x - c.x) > 300 * s;
    const arrived = walkTo(st, input, st.cursor.x, far);
    if (st.t > b.data.until || (b.data.once && arrived)) {
      if (b.data.once) express(st, { eyes: 'happy', mouth: 'open' }, 1);
      goto(st, 'idle');
    }
  },

  emote(st, world, b, input) {
    const c = st.char;
    const k = b.data.kind;
    if (c.mode === 'ground' || k === 'flip' || k === 'celebrate' || k === 'jump') setPose(st, c.mode === 'ground' ? k : physicalPose(c));
    else setPose(st, physicalPose(c));
    if (b.t < 0.02 || !b.data.started) {
      b.data.started = true;
      if ((k === 'flip' || k === 'celebrate' || k === 'jump') && c.mode === 'ground') {
        input.jumpPressed = true;
        input.jump = true;
        if (k === 'flip') c.flipT = 0.55;
        if (k === 'celebrate') {
          const cen = centerOf(c);
          burst(st, 'confetti', cen.x, cen.y - 20 * c.scale, 26, { g: 500, sp0: 150, sp1: 420, a0: -Math.PI * 0.95, a1: -Math.PI * 0.05, max0: 0.9, max1: 1.6, drag: 1.2 });
        }
      }
      if (k === 'hum') express(st, { eyes: 'happy', mouth: 'o' }, b.data.dur);
      if (k === 'yawn') express(st, { eyes: 'closed', mouth: 'open' }, 1.4);
      if (k === 'laugh') express(st, { eyes: 'happy', mouth: 'open', blush: 0.7 }, b.data.dur);
      if (k === 'shrug') express(st, { eyes: 'normal', mouth: 'flat', brows: 'up' }, b.data.dur);
    }
    if ((k === 'celebrate' || k === 'flip' || k === 'jump') && b.t < 0.35) input.jump = true;
    if (k === 'hum' && b.t >= (b.data.nextNote ?? 0.2)) {
      b.data.nextNote = b.t + 0.7;
      const cen = centerOf(c);
      spawn(st, 'note', cen.x + 18 * c.scale * c.facing, cen.y - 20 * c.scale, { vx: 20 * c.facing, vy: -40, max: 1.6, size: 12, wobble: 16, hue: rand(st) * 360 });
    }
    if (b.t > (b.data.dur ?? 1.5) && c.mode === 'ground') goto(st, 'idle', { dur: 0.8 });
  },

  react(st, world, b) {
    const c = st.char;
    const k = b.data.kind;
    if (c.mode !== 'ground') {
      setPose(st, physicalPose(c));
      if (b.t > 3) goto(st, 'idle');
      return;
    }
    setPose(st, k === 'dizzy' ? 'dizzy' : k === 'petted' ? 'petted' : k === 'startled' ? 'startled' : k === 'annoyed' ? 'annoyed' : 'stand');
    if (b.t > b.data.dur) {
      if (k === 'dizzy') restFace(st);
      goto(st, b.data.resume === 'sleep' ? 'sleep' : 'idle', { dur: 0.5 });
    }
  },

  think(st, world, b) {
    const c = st.char;
    setPose(st, c.mode === 'ground' ? 'think' : physicalPose(c));
    if (!st.flags.thinking) goto(st, 'idle', { dur: 1.5 });
  },

  listen(st, world, b) {
    const c = st.char;
    setPose(st, c.mode === 'ground' ? 'listen' : physicalPose(c));
    if (st.flags.chatAt && c.mode === 'ground') c.facing = Math.sign(st.flags.chatAt.x - c.x) || c.facing;
    if (!st.flags.listening) goto(st, st.flags.thinking ? 'think' : 'idle', { dur: 1.5 });
  },

  carry(st, world, b) {
    const c = st.char;
    setPose(st, c.mode === 'ground' ? 'carry' : physicalPose(c));
    if (b.t > (b.data.dur ?? 2.4)) goto(st, 'idle', { dur: 1 });
  },

  controlled() {},
};

// ---- chatter ------------------------------------------------------------------

const CHATTER = [
  'Nice desktop you have here.',
  '*hums quietly*',
  'Double-click me if you need anything!',
  'I could get used to this monitor.',
  'Ooh, a window. I wonder what’s on top of it.',
  'Did you drink some water today?',
  'Drag me around, I don’t mind. Mostly.',
  'Right-click me for options!',
];

function maybeChatter(st) {
  const every = { quiet: Infinity, normal: 540, chatty: 160 }[st.settings.chattiness] ?? 540;
  const b = st.brain;
  if (st.t - b.lastChatter > every && rand(st) < 0.002) {
    b.lastChatter = st.t;
    say(st, pick(st, CHATTER));
  }
}

function greeting(st) {
  const h = st.clock?.hour ?? 12;
  if (h < 5) return 'Up late, huh? I’ll keep you company.';
  if (h < 12) return 'Good morning! I’m Claude. Double-click me to chat!';
  if (h < 18) return 'Hi! I’m Claude. Double-click me to chat!';
  return 'Good evening! I’m Claude. Double-click me to chat!';
}

// ---- entry points ---------------------------------------------------------------

export function think(st, world, dt) {
  const b = st.brain;
  const c = st.char;
  b.t += dt;
  while (st.commands.length) runCommand(st, world, st.commands.shift());
  cursorInteractions(st, dt);
  const input = emptyInput();
  if (c.mode === 'held') {
    setPose(st, 'held');
    return input;
  }
  if (st.control.active) return input;
  if (b.name === 'controlled') goto(st, 'idle');
  // Hanging on something without a plan (e.g. the player let go of the keys): climb a bit, then hop off.
  if (c.mode === 'climb' && b.name !== 'climb' && b.name !== 'wallclimb') goto(st, 'wallclimb', { phase: 'up', climbT: randRange(st, 0.3, 1), face: c.climb?.face });
  // Music playing for a moment and Claude is just hanging around? Dance!
  const au = st.audio;
  if (au.music && st.settings.audio && c.mode === 'ground' && DANCE_OK.has(b.name) && st.t - (au.musicSince ?? st.t) > 1 && st.t - (b.lastDanceEnd ?? -99) > 6) {
    goto(st, 'dance');
  }
  (STATES[b.name] || STATES.idle)(st, world, b, input, dt);
  return input;
}

const DANCE_OK = new Set(['idle', 'walk', 'sit', 'emote', 'descend']);

const REACT_FACES = {
  laugh: [{ eyes: 'happy', mouth: 'open', blush: 0.7 }, 1.8],
  gasp: [{ eyes: 'wide', mouth: 'o', brows: 'up' }, 1.3],
  wow: [{ eyes: 'wide', mouth: 'open', blush: 0.8 }, 1.6],
  clap: [{ eyes: 'happy', mouth: 'open', blush: 0.5 }, 1.8],
  think: [{ eyes: 'normal', mouth: 'flat', brows: 'determined' }, 2],
  nod: [{ eyes: 'happy', mouth: 'smile' }, 1.3],
  sad: [{ eyes: 'normal', mouth: 'wavy', brows: 'up', blush: 0.2 }, 2.2],
  dance: [{ eyes: 'happy', mouth: 'open' }, 2.5],
};

/** A reaction (to a video, a joke...) played on top of whatever Claude is doing. */
export function react(st, kind) {
  const f = REACT_FACES[kind];
  if (!f) return;
  express(st, f[0], f[1]);
  st.anim.react = { kind, t0: st.t, dur: f[1] };
  const cen = centerOf(st.char);
  const s = st.char.scale;
  if (kind === 'gasp') {
    kick(st, 0.3);
    spawn(st, 'exclaim', cen.x, cen.y - 48 * s, { vy: -30, max: 1, size: 16 });
  } else if (kind === 'wow') {
    burst(st, 'spark', cen.x, cen.y - 30 * s, 8, { sp0: 50, sp1: 140, max0: 0.4, max1: 0.8, size0: 3, size1: 6, drag: 3 });
  } else if (kind === 'laugh') {
    kick(st, -0.15);
  }
}

export function wake(st, grumpy) {
  if (st.brain.name !== 'sleep') return;
  restFace(st);
  st.stats.lastInteraction = st.t;
  if (grumpy) {
    express(st, { eyes: 'squint', mouth: 'wavy', brows: 'angry' }, 1.3);
    goto(st, 'react', { kind: 'annoyed', dur: 1.3 });
  } else {
    goto(st, 'emote', { kind: 'yawn', dur: 2.2 });
  }
}

function cursorInteractions(st, dt) {
  const b = st.brain;
  const c = st.char;
  const s = c.scale;
  const cen = centerOf(c);
  const cur = st.cursor;
  const d = Math.hypot(cur.x - cen.x, cur.y - cen.y);
  if (d < 34 * s && st.t - cur.t < 0.15 && c.mode !== 'held') {
    const dx = cur.x - b.petLastX;
    if (Math.abs(dx) > 1.5) {
      const dir = Math.sign(dx);
      if (b.petDir !== 0 && dir !== b.petDir) b.petScore += 1;
      b.petDir = dir;
    }
    b.petLastX = cur.x;
  }
  b.petScore = Math.max(0, b.petScore - dt * 1.1);
  if (b.petScore > 4.5 && st.t - b.lastPet > 1.1) {
    b.lastPet = st.t;
    b.petScore = 2.5;
    st.stats.lastInteraction = st.t;
    if (b.name === 'sleep') {
      // Petting a sleeping Claude keeps it asleep, just happier.
      spawn(st, 'heart', cen.x, cen.y - 30 * s, { vy: -50, max: 1.3, size: 12, wobble: 12 });
      return;
    }
    burst(st, 'heart', cen.x, cen.y - 24 * s, 3, { a0: -Math.PI * 0.8, a1: -Math.PI * 0.2, sp0: 40, sp1: 110, g: -30, max0: 0.9, max1: 1.4, size0: 9, size1: 13, drag: 1.5 });
    express(st, { eyes: 'happy', mouth: 'cat', blush: 0.9 }, 1.6);
    if (c.mode === 'ground' && !st.control.active && !['dance', 'think', 'listen', 'hop', 'ropeup'].includes(b.name)) goto(st, 'react', { kind: 'petted', dur: 1.6 });
  }
}

export function poke(st) {
  const b = st.brain;
  const c = st.char;
  st.stats.lastInteraction = st.t;
  if (b.name === 'sleep') return wake(st, true);
  if (st.t - b.pokeT > 2.5) b.pokes = 0;
  b.pokes++;
  b.pokeT = st.t;
  kick(st, -0.22);
  const n = b.pokes;
  if (n === 1) express(st, { eyes: 'happy', mouth: 'open', blush: 0.6 }, 0.7);
  else if (n === 2) {
    express(st, { eyes: 'wide', mouth: 'o' }, 0.8);
    if (rand(st) < 0.5) say(st, pick(st, ['Hey!', 'Hi!', 'Hehe', 'Boop!']), 'happy', 1.4);
  } else if (n === 3) {
    express(st, { eyes: 'happy', mouth: 'open', blush: 0.8 }, 1.1);
    if (!st.control.active && c.mode === 'ground') goto(st, 'emote', { kind: 'laugh', dur: 1.1 });
  } else if (n >= 5) {
    b.pokes = 0;
    express(st, { eyes: 'squint', mouth: 'wavy', brows: 'angry' }, 1.4);
    say(st, pick(st, ['Okay, okay!', 'That tickles!', 'Rude. (But fine.)']), 'annoyed', 1.8);
    if (!st.control.active && c.mode === 'ground') goto(st, 'react', { kind: 'annoyed', dur: 1.4 });
  } else {
    express(st, { eyes: 'squint', mouth: 'open' }, 0.6);
  }
}

export function onBeat(st, strength) {
  st.anim.beatPulse = 1;
  const b = st.brain;
  if (b.name !== 'dance' || st.char.mode !== 'ground') return;
  kick(st, -0.1 - strength * 0.08);
  b.data.beats = (b.data.beats ?? 0) + 1;
  if (b.data.beats % 8 === 0) st.anim.danceMove = pick(st, ['bop', 'side', 'arms', 'spin', 'bounce', 'point']);
  if (strength > 0.75 && rand(st) < 0.18) b.data.hopT = 0.07;
  if (rand(st) < 0.3) {
    const cen = centerOf(st.char);
    spawn(st, 'note', cen.x + randRange(st, -30, 30) * st.char.scale, cen.y - 30 * st.char.scale, { vx: randRange(st, -30, 30), vy: -60, max: 1.5, size: 12, wobble: 20, hue: rand(st) * 360 });
  }
}

export function onLoud(st) {
  const b = st.brain;
  const c = st.char;
  if (st.t - b.lastStartle < 10 || c.mode !== 'ground' || st.control.active) return;
  b.lastStartle = st.t;
  if (b.name === 'sleep') {
    wake(st, false);
    express(st, { eyes: 'wide', mouth: 'o' }, 1.4);
    return;
  }
  if (['dance', 'think', 'listen', 'hop', 'ropeup'].includes(b.name)) return;
  express(st, { eyes: 'wide', mouth: 'o', brows: 'up' }, 1.2);
  const cen = centerOf(c);
  spawn(st, 'exclaim', cen.x, cen.y - 50 * c.scale, { vy: -30, max: 1, size: 18 });
  kick(st, 0.35);
  goto(st, 'emote', { kind: 'jump', dur: 1.1 });
}

export function onEvent(st, world, e) {
  const c = st.char;
  const s = c.scale;
  const b = st.brain;
  const feetX = c.x;
  const feetY = c.y;
  switch (e.type) {
    case 'jump':
      kick(st, 0.3);
      burst(st, 'dust', feetX, feetY, 4, { a0: Math.PI * 0.9, a1: Math.PI * 1.1, sp0: 30, sp1: 90, max0: 0.25, max1: 0.45, size0: 4, size1: 7, drag: 4 });
      break;
    case 'doublejump':
      kick(st, 0.22);
      burst(st, 'spark', feetX, feetY - 6 * s, 7, { a0: Math.PI * 0.15, a1: Math.PI * 0.85, sp0: 60, sp1: 160, max0: 0.25, max1: 0.45, size0: 3, size1: 6, drag: 3 });
      break;
    case 'walljump':
      kick(st, 0.2);
      burst(st, 'dust', feetX + e.side * 18 * s, feetY - 20 * s, 5, { sp0: 30, sp1: 90, max0: 0.25, max1: 0.4, size0: 4, size1: 7, drag: 4 });
      break;
    case 'land': {
      const imp = e.impact;
      kick(st, -clamp(imp / 2300, 0.06, 0.42));
      if (imp > 650) {
        const n = Math.min(12, Math.round(imp / 250));
        burst(st, 'dust', feetX, feetY, n, { a0: Math.PI * 1.05, a1: Math.PI * 1.95, sp0: 40, sp1: 60 + imp * 0.08, max0: 0.3, max1: 0.6, size0: 4, size1: 8, drag: 5 });
      }
      if (imp > P.dizzyImpact || (e.tumble && imp > 1450)) {
        st.anim.dizzyUntil = st.t + 2.4;
        st.anim.face = { eyes: 'dizzy', mouth: 'wavy', brows: null, blush: 0.3 };
        if (!st.control.active) goto(st, 'react', { kind: 'dizzy', dur: 2.4 });
        if (rand(st) < 0.35) say(st, pick(st, ['Wheee... @_@', 'The room is spinning...', 'Again! ...wait, no.']), 'dizzy', 2);
      } else if (e.tumble) {
        express(st, { eyes: 'squint', mouth: 'open' }, 0.6);
      } else if (imp > 1250) {
        express(st, { eyes: 'squint', mouth: 'flat' }, 0.4);
      }
      break;
    }
    case 'bounce':
      kick(st, -0.3);
      burst(st, 'dust', feetX, feetY, 5, { a0: Math.PI * 1.1, a1: Math.PI * 1.9, sp0: 40, sp1: 140, max0: 0.3, max1: 0.5, size0: 4, size1: 7, drag: 5 });
      express(st, { eyes: 'squint', mouth: 'open' }, 0.5);
      break;
    case 'bonk': {
      kick(st, -0.3);
      express(st, { eyes: 'squint', mouth: 'wavy' }, 0.8);
      const cen = centerOf(c);
      burst(st, 'star', cen.x, cen.y - 20 * s, 4, { sp0: 60, sp1: 140, max0: 0.4, max1: 0.7, size0: 6, size1: 9, drag: 3 });
      if (e.speed > 2600) {
        st.anim.dizzyUntil = st.t + 2;
        st.anim.face = { eyes: 'dizzy', mouth: 'wavy', brows: null, blush: 0.3 };
      }
      break;
    }
    case 'grab':
      st.stats.lastInteraction = st.t;
      if (b.name === 'sleep') {
        restFace(st);
        express(st, { eyes: 'wide', mouth: 'o', brows: 'up' }, 1);
      } else {
        express(st, { eyes: 'wide', mouth: 'o' }, 0.35);
      }
      goto(st, 'idle', { dur: 1.5 });
      break;
    case 'throw':
      if (e.speed > 1700) express(st, { eyes: 'wide', mouth: 'open', brows: 'up' }, 1.5);
      else if (e.speed > 500) express(st, { eyes: 'happy', mouth: 'open' }, 1.2);
      break;
    case 'platform-lost':
      express(st, { eyes: 'wide', mouth: 'o', brows: 'up' }, 1.2);
      if (rand(st) < 0.4) say(st, pick(st, ['Whoa!', 'Hey, where’d my window go?!', 'Eep!']), 'surprised', 1.6);
      if (!st.control.active && b.name !== 'dance') goto(st, 'idle', { dur: 1.5 });
      break;
    case 'vault':
      kick(st, 0.25);
      break;
    case 'rope-attach':
      kick(st, 0.12);
      break;
    default:
      break;
  }
}

function runCommand(st, world, cmd) {
  const c = st.char;
  const s = c.scale;
  st.stats.lastInteraction = st.t;
  if (st.brain.name === 'sleep' && !['sleep', 'think', 'listen', 'carry'].includes(cmd.name)) wake(st, false);
  switch (cmd.name) {
    case 'dance':
      return goto(st, 'dance', { until: st.t + (cmd.dur ?? 16) });
    case 'sleep':
      return goto(st, 'sleep');
    case 'wake':
      return wake(st, false);
    case 'sit':
      return goto(st, 'sit', { dur: cmd.dur ?? 15 });
    case 'stop':
      restFace(st);
      return goto(st, 'idle');
    case 'come':
      return goto(st, 'follow', { until: st.t + 8, once: true });
    case 'follow':
      return goto(st, 'follow', { until: st.t + (cmd.dur ?? 25) });
    case 'wave':
    case 'flip':
    case 'celebrate':
    case 'jump':
    case 'spin':
    case 'stretch':
    case 'laugh':
    case 'shrug':
    case 'hum':
      return goto(st, 'emote', { kind: cmd.name, dur: cmd.dur ?? EMOTE_DUR[cmd.name] ?? 1.5 });
    case 'carry':
      st.anim.carry = cmd.item || 'folder';
      st.anim.carryUntil = st.t + (cmd.dur ?? 2.6);
      if (c.mode === 'ground' && !st.control.active) goto(st, 'carry', { dur: cmd.dur ?? 2.6 });
      {
        const cen = centerOf(c);
        burst(st, 'spark', cen.x, cen.y - 50 * s, 10, { sp0: 60, sp1: 170, max0: 0.35, max1: 0.7, size0: 3, size1: 6, drag: 3 });
      }
      return;
    case 'think':
      st.flags.thinking = !!cmd.on;
      if (cmd.on && !st.control.active && c.mode !== 'held') goto(st, 'think');
      return;
    case 'listen':
      st.flags.listening = !!cmd.on;
      st.flags.chatAt = cmd.at || null;
      if (cmd.on && !st.control.active && c.mode !== 'held') goto(st, 'listen');
      return;
    case 'rope':
      fireRope(st, world, cmd.x, cmd.y);
      return;
    case 'swing':
      if (c.mode === 'ground') return goto(st, 'swing', { phase: 'aim' });
      return;
    case 'watch':
      return goto(st, 'watch', { phase: 'go', area: cmd.area });
    case 'watch-end':
      st.anim.watchAt = null;
      if (st.brain.name === 'watch') goto(st, 'emote', { kind: 'stretch', dur: 2.2 });
      return;
    case 'react':
      return react(st, cmd.kind);
    case 'climb': {
      let targets = climbTargets(st, world);
      if (cmd.win) {
        targets = targets.filter((k) => k.e.win === cmd.win);
        if (!targets.length) {
          // Not directly reachable from here: walk over to that window's nearest side anyway.
          const sides = (world.edges ?? []).filter((e) => e.win === cmd.win);
          if (sides.length) {
            const e = sides.reduce((a, q) => (Math.abs(q.x - c.x) < Math.abs(a.x - c.x) ? q : a));
            const tx = e.x - e.face * (HIT.hw * s + 70 * s);
            if (c.ground?.kind === 'platform') return goto(st, 'descend', { drop: true, then: { tx, run: true } });
            return goto(st, 'climb', { key: e.key, win: e.win, face: e.face, tx, phase: 'approach' });
          }
        }
      }
      if (targets.length) {
        const k = targets.reduce((a, q) => (Math.abs(q.tx - c.x) < Math.abs(a.tx - c.x) ? q : a));
        return goto(st, 'climb', { key: k.e.key, win: k.e.win, face: k.e.face, tx: k.tx, phase: 'approach' });
      }
      return goto(st, 'wallclimb', { phase: 'approach', climbT: 2.2 });
    }
    case 'wallclimb':
      return goto(st, 'wallclimb', { phase: 'approach', climbT: 2.2 });
    case 'explore': {
      const hops = hopTargets(st, world);
      if (hops.length) {
        const h = pick(st, hops);
        return goto(st, 'hop', { pid: platKey(h.p), lx: h.lx, double: h.double, phase: 'approach' });
      }
      const climbs = climbTargets(st, world);
      if (climbs.length) {
        const k = pick(st, climbs);
        return goto(st, 'climb', { key: k.e.key, win: k.e.win, face: k.e.face, tx: k.tx, phase: 'approach' });
      }
      const ropes = ropeTargets(st, world);
      if (ropes.length) {
        const r = pick(st, ropes);
        return goto(st, 'ropeup', { pid: platKey(r.p), ax: r.ax, standX: r.standX, phase: 'approach' });
      }
      return goto(st, 'swing', { phase: 'aim' });
    }
    case 'travel': {
      // Walk over to another monitor (hopping down off a window first if needed).
      const r = world.regions.find((x) => x.id === cmd.to);
      if (!r) return;
      const walk = { tx: r.x + r.w * (0.35 + rand(st) * 0.3), run: true, travel: true };
      if (c.ground?.kind === 'platform') return goto(st, 'descend', { drop: true, then: walk });
      return goto(st, 'walk', walk);
    }
    case 'poke':
      return poke(st);
    default:
      return;
  }
}

// Exposed for tests.
export const _internal = { hopTargets, ropeTargets, climbTargets, choose, STATES, handPoint, CENTER_Y, BODY };
