// Character controller. Pure functions over a plain, serializable state object
// so the simulation can move between monitor windows and run headless in tests.
import { CENTER_Y, HIT, PHYS as P } from './constants.js';
import { allEdges, edgeFor, floorY, hasNeighbor, nearestRegion, platformFor, platKey, regionAt } from './world.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const approach = (v, target, delta) => (v < target ? Math.min(v + delta, target) : Math.max(v - delta, target));
export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function emit(st, type, data) {
  st.events.push({ type, ...data });
}

export function newChar(x, y, scale) {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    scale,
    mode: 'air', // ground | air | rope | held | climb
    ground: null, // { kind: 'floor' | 'platform', id }
    facing: 1,
    wallDir: 0,
    coyoteT: 0,
    jumpBufT: 0,
    jumpsLeft: 1,
    lockT: 0,
    jumpCutDone: true,
    dropId: null,
    dropT: 0,
    rot: 0,
    rotV: 0,
    airT: 0,
    tumble: false,
    flipT: 0,
    held: null,
    climb: null, // { key, face, phase, wall } while hanging on a window side / screen edge
    climbCD: 0,
    rope: { state: 'none', ax: 0, ay: 0, hx: 0, hy: 0, len: 0, t: 0, platformId: null },
  };
}

/** Wings let it fly (flap in the air, glide when falling). */
export const canFly = (st) => st.look?.arms === 'wings';

export function centerOf(c) {
  return { x: c.x, y: c.y - CENTER_Y * c.scale };
}

export function handPoint(c) {
  return { x: c.x, y: c.y - (CENTER_Y + 10) * c.scale };
}

/** Max height reachable with a full single jump (px). */
export function jumpHeight(scale) {
  return ((P.jumpVel * P.jumpVel) / (2 * P.gravity)) * scale;
}

function leaveGround(c) {
  c.mode = 'air';
  c.ground = null;
}

export function stepCharacter(st, world, input, dt) {
  const c = st.char;
  c.dropT = Math.max(0, c.dropT - dt);
  c.flipT = Math.max(0, c.flipT - dt);
  c.climbCD = Math.max(0, (c.climbCD ?? 0) - dt);
  c.flapCD = Math.max(0, (c.flapCD ?? 0) - dt);
  // A rope only stays attached while hanging from it (safety net for any path that forgets).
  if (c.rope.state === 'attached' && c.mode !== 'rope') c.rope.state = 'retracting';
  stepRopeVisual(st, dt);
  if (c.mode === 'hidden') return; // hide and seek: frozen in its hiding spot
  if (c.mode === 'held') return stepHeld(st, world, dt);
  if (c.mode === 'rope') return stepRope(st, world, input, dt);
  if (c.mode === 'climb') return stepClimb(st, world, input, dt);
  stepPlatformer(st, world, input, dt);
}

function stepPlatformer(st, world, input, dt) {
  const c = st.char;
  const s = c.scale;
  let dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (c.lockT > 0) {
    c.lockT -= dt;
    dir = 0;
  }
  const onGround = c.mode === 'ground';
  const maxSpeed = (input.run ? P.run : P.walk) * s;

  if (onGround) {
    const target = dir * maxSpeed;
    let a = P.groundAccel;
    if (dir === 0) a = P.groundDecel;
    else if (Math.sign(c.vx) === -dir && Math.abs(c.vx) > 1) a = P.turnAccel;
    c.vx = approach(c.vx, target, a * s * dt);
    c.coyoteT = P.coyote;
    c.jumpsLeft = 1;
    c.rot = wrapAngle(c.rot) * Math.exp(-16 * dt);
    c.rotV = 0;
  } else {
    c.coyoteT = Math.max(0, c.coyoteT - dt);
    if (dir !== 0) {
      const target = dir * maxSpeed;
      // Air control only pushes toward the target; it never brakes a throw.
      if ((dir > 0 && c.vx < target) || (dir < 0 && c.vx > target)) c.vx = approach(c.vx, target, P.airAccel * s * dt);
    } else {
      c.vx *= Math.exp(-P.airDrag * dt);
    }
  }
  if (dir !== 0) c.facing = dir;

  if (input.jumpPressed) {
    c.jumpBufT = P.jumpBuffer;
    input.jumpPressed = false;
  } else {
    c.jumpBufT = Math.max(0, c.jumpBufT - dt);
  }

  if (c.jumpBufT > 0) {
    if (onGround && input.down && c.ground?.kind === 'platform') {
      c.dropId = c.ground.id;
      c.dropT = 0.3;
      leaveGround(c);
      c.vy = 80 * s;
      c.jumpBufT = 0;
      emit(st, 'drop');
    } else if (onGround || c.coyoteT > 0) {
      c.vy = -P.jumpVel * s;
      leaveGround(c);
      c.coyoteT = 0;
      c.jumpBufT = 0;
      c.jumpCutDone = false;
      emit(st, 'jump');
    } else if (c.wallDir !== 0) {
      c.vx = -c.wallDir * P.wallJumpVx * s;
      c.vy = -P.wallJumpVy * s;
      c.facing = -c.wallDir;
      c.lockT = P.wallJumpLock;
      c.jumpBufT = 0;
      c.jumpCutDone = false;
      emit(st, 'walljump', { side: c.wallDir });
      c.wallDir = 0;
    } else if (canFly(st) && !c.tumble) {
      if (c.flapCD <= 0) {
        // Flap! As many times as it likes (a little cooldown so holding the key isn't a rocket).
        c.vy = Math.min(c.vy, -P.flapVel * s);
        c.flapCD = P.flapCD;
        c.jumpBufT = 0;
        c.jumpCutDone = false;
        emit(st, 'flap');
      }
    } else if (c.jumpsLeft > 0 && !c.tumble) {
      c.vy = -P.doubleJumpVel * s;
      c.jumpsLeft--;
      c.jumpBufT = 0;
      c.jumpCutDone = false;
      c.flipT = 0.42;
      emit(st, 'doublejump');
    }
  }

  // Variable jump height: letting go early cuts the rise.
  if (!input.jump && c.vy < 0 && !c.jumpCutDone) {
    c.vy *= P.jumpCut;
    c.jumpCutDone = true;
  }

  if (c.mode !== 'ground') {
    c.vy += P.gravity * s * dt;
    if (c.wallDir !== 0 && dir === c.wallDir && c.vy > 0) c.vy = Math.min(c.vy, P.wallSlideMax * s);
    c.vy = Math.min(c.vy, P.maxFall * s);
    if (canFly(st) && input.jump && c.vy > 0 && !c.tumble) c.vy = Math.min(c.vy, P.glideMax * s); // gliding
    c.airT += dt;
    c.rot += c.rotV * dt;
    c.rotV *= Math.exp(-0.5 * dt);
  } else {
    c.airT = 0;
  }

  const prevY = c.y;
  const prevX = c.x;
  c.x += c.vx * dt;
  if (c.mode !== 'ground') c.y += c.vy * dt;
  collide(st, world, prevY, true);
  if (c.mode === 'air') tryGrabEdge(st, world, prevX, dir);
}

// ---- Climbing window sides and screen edges ---------------------------------------

const handOffset = (s) => (CENTER_Y + 10) * s;

/** In the air, moving into a window side (or screen edge) grabs it. */
function tryGrabEdge(st, world, prevX, dir) {
  const c = st.char;
  const s = c.scale;
  if (dir === 0 || c.tumble || c.climbCD > 0) return;
  const hw = HIT.hw * s;
  const handY = c.y - handOffset(s);
  for (const e of allEdges(world)) {
    if (e.face !== dir) continue;
    const gx = e.x - e.face * hw;
    const crossed = e.face > 0 ? prevX <= gx + 0.5 && c.x >= gx - 0.5 : prevX >= gx - 0.5 && c.x <= gx + 0.5;
    if (!crossed || handY < e.y1 - 14 * s || handY > e.y2 - 4 * s) continue;
    c.mode = 'climb';
    c.x = gx;
    c.vx = 0;
    c.vy = 0;
    c.facing = e.face;
    c.climb = { key: e.key, face: e.face, phase: 0, wall: !!e.wall, win: e.win ?? null };
    c.jumpsLeft = 1;
    c.wallDir = 0;
    emit(st, 'grab-edge', { wall: !!e.wall });
    return;
  }
}

function stopClimbing(c, cooldown) {
  c.mode = 'air';
  c.climb = null;
  c.climbCD = cooldown;
}

function stepClimb(st, world, input, dt) {
  const c = st.char;
  const s = c.scale;
  const cl = c.climb;
  const hand = handOffset(s);
  const e = edgeFor(world, cl.key, c.y - hand);
  if (!e || (c.y - hand > e.y2 + 20 * s)) {
    stopClimbing(c, 0.3);
    emit(st, 'platform-lost');
    return;
  }
  c.x = e.x - e.face * HIT.hw * s;
  c.facing = e.face;
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (input.jumpPressed) {
    // Wall-jump away from the surface.
    input.jumpPressed = false;
    stopClimbing(c, 0.25);
    c.vx = -e.face * P.wallJumpVx * s;
    c.vy = -P.wallJumpVy * s;
    c.facing = -e.face;
    c.lockT = P.wallJumpLock;
    c.jumpCutDone = false;
    c.jumpsLeft = 1;
    emit(st, 'walljump', { side: e.face });
    return;
  }
  if (dir === -e.face) {
    stopClimbing(c, 0.35);
    c.vx = -e.face * 90 * s;
    c.vy = 0;
    emit(st, 'letgo');
    return;
  }
  const vy = input.up ? -P.climbUp * s : input.down ? P.climbDown * s : 0;
  c.vx = 0;
  c.vy = vy;
  c.y += vy * dt;
  cl.phase += (Math.abs(vy) * dt) / (16 * s);
  if (c.y - hand <= e.y1) {
    const top = e.wall ? null : platformFor(world, e.win, e.x + e.face * 40 * s);
    if (top && Math.abs(top.y - e.y1) < 3 && input.up) {
      // Pull up onto the window's title bar.
      const rise = c.y - top.y + 26 * s;
      stopClimbing(c, 0.4);
      c.vy = -Math.sqrt(2 * P.gravity * s * Math.max(rise, 10 * s));
      c.vx = e.face * 210 * s;
      c.jumpCutDone = true;
      emit(st, 'vault');
      return;
    }
    c.y = e.y1 + hand; // hang at the top
  }
  const r = regionAt(world, c.x, c.y - 2) || nearestRegion(world, c.x, c.y);
  if (r && c.y >= floorY(r)) {
    c.y = floorY(r);
    c.climb = null;
    c.climbCD = 0.3;
    c.mode = 'ground';
    c.ground = { kind: 'floor' };
    c.vy = 0;
    emit(st, 'land', { impact: 0, tumble: false, airT: 0, ground: 'floor' });
    return;
  }
  if (c.y - hand > e.y2 + 2) {
    stopClimbing(c, 0.3);
    emit(st, 'letgo');
  }
}

function collide(st, world, prevY, allowLanding) {
  const c = st.char;
  const s = c.scale;
  const hw = HIT.hw * s;
  const h = HIT.h * s;
  const r = regionAt(world, c.x, c.y - h / 2) || regionAt(world, c.x, c.y - 1) || nearestRegion(world, c.x, c.y - h / 2);
  if (!r) return;
  c.wallDir = 0;

  if (c.x - hw <= r.x + 0.5 && !hasNeighbor(world, r, 'left', c.y - h, c.y)) {
    if (c.x - hw < r.x) {
      c.x = r.x + hw;
      hitWall(st, -1);
    }
    if (c.mode !== 'ground') c.wallDir = -1;
  }
  if (c.x + hw >= r.x + r.w - 0.5 && !hasNeighbor(world, r, 'right', c.y - h, c.y)) {
    if (c.x + hw > r.x + r.w) {
      c.x = r.x + r.w - hw;
      hitWall(st, 1);
    }
    if (c.mode !== 'ground') c.wallDir = 1;
  }
  if (c.y - h < r.y && !hasNeighbor(world, r, 'top', c.x - hw, c.x + hw)) {
    c.y = r.y + h;
    if (c.vy < 0) {
      emit(st, 'bonk', { side: 'top', speed: -c.vy / s });
      c.vy = -c.vy * P.ceilingBounce;
    }
  }

  if (c.mode === 'ground') return updateGround(st, world, r);

  const fy = floorY(r);
  const floorSolid = !hasNeighbor(world, r, 'bottom', c.x - hw, c.x + hw);
  if (c.vy >= 0 || !allowLanding) {
    let best = null;
    if (c.vy >= 0) {
      for (const p of world.platforms) {
        if (platKey(p) === c.dropId && c.dropT > 0) continue;
        if (c.x < p.x1 || c.x > p.x2) continue;
        if (prevY <= p.y + 0.5 && c.y >= p.y && (!best || p.y < best.y)) best = p;
      }
    }
    if (best) {
      if (allowLanding) return land(st, best.y, { kind: 'platform', id: platKey(best) });
      c.y = best.y;
      c.vy = Math.min(c.vy, 0);
      return;
    }
    if (c.y >= fy && floorSolid) {
      if (allowLanding) return land(st, fy, { kind: 'floor' });
      c.y = fy;
      c.vy = Math.min(c.vy, 0);
    }
  }
}

function updateGround(st, world, r) {
  const c = st.char;
  if (c.ground?.kind === 'platform') {
    const p = platformFor(world, c.ground.id, c.x);
    if (!p || c.x < p.x1 - 2 || c.x > p.x2 + 2) {
      leaveGround(c);
      emit(st, p ? 'walkoff' : 'platform-lost');
      return;
    }
    c.y = p.y;
    return;
  }
  const fy = floorY(r);
  if (c.y < fy - 1) {
    leaveGround(c); // walked onto a monitor whose floor is lower
    emit(st, 'walkoff');
    return;
  }
  c.y = fy;
}

function land(st, y, ground) {
  const c = st.char;
  const s = c.scale;
  const impact = c.vy;
  c.y = y;
  if (c.tumble && impact > P.bounceMin * s) {
    c.vy = -impact * P.floorBounce;
    c.vx *= 0.75;
    c.rotV *= 0.6;
    emit(st, 'bounce', { impact: impact / s });
    return;
  }
  const tumble = c.tumble;
  c.vy = 0;
  c.mode = 'ground';
  c.ground = ground;
  c.jumpsLeft = 1;
  c.coyoteT = P.coyote;
  c.tumble = false;
  c.flipT = 0;
  emit(st, 'land', { impact: impact / s, tumble, airT: c.airT, ground: ground.kind });
  c.airT = 0;
}

function hitWall(st, side) {
  const c = st.char;
  const s = c.scale;
  const speed = Math.abs(c.vx);
  if (c.mode !== 'ground' && (c.tumble || c.mode === 'rope') && speed > P.bounceMin * s * 0.7) {
    c.vx = -c.vx * P.wallBounce;
    c.rotV = -c.rotV * 0.5 - side * 4;
    emit(st, 'bonk', { side, speed: speed / s });
  } else {
    c.vx = 0;
  }
}

// ---- Held by the mouse: a pendulum hanging from the grab point -------------

export function grab(st, px, py) {
  const c = st.char;
  const s = c.scale;
  const { x: cx, y: cy } = centerOf(c);
  let dx = cx - px;
  let dy = cy - py;
  let L = Math.hypot(dx, dy);
  const minL = 12 * s;
  if (L < minL) {
    // Grabbed near the middle: pretend it was just above the center.
    dx = 0;
    dy = minL;
    L = minL;
  }
  const phi = Math.atan2(dx, dy); // angle of grab->center from straight down
  // Grabbed almost exactly below the center (e.g. by the feet): the pendulum is
  // balanced upside-down. Real hands are never perfectly centered - nudge it.
  const omega = Math.cos(phi) < -0.97 ? (dx >= 0 ? 0.8 : -0.8) : 0;
  c.held = { px, py, tx: px, ty: py, pvx: 0, pvy: 0, phi, omega, phi0: phi + c.rot, L };
  c.mode = 'held';
  c.ground = null;
  c.tumble = false;
  if (c.rope.state !== 'none') c.rope.state = 'retracting';
  emit(st, 'grab');
}

export function moveHeld(st, px, py) {
  const h = st.char.held;
  if (!h) return;
  h.tx = px;
  h.ty = py;
}

function stepHeld(st, world, dt) {
  const c = st.char;
  const s = c.scale;
  const h = c.held;
  // Critically damped spring pulls the pivot to the cursor; gives smooth accelerations.
  const k = 1400;
  const d = 2 * Math.sqrt(k);
  const ax = clamp(k * (h.tx - h.px) - d * h.pvx, -80000, 80000);
  const ay = clamp(k * (h.ty - h.py) - d * h.pvy, -80000, 80000);
  h.pvx += ax * dt;
  h.pvy += ay * dt;
  h.px += h.pvx * dt;
  h.py += h.pvy * dt;
  const g = P.gravity * s;
  const alpha = -((g + ay) * Math.sin(h.phi) + ax * Math.cos(h.phi)) / h.L - P.heldDamping * h.omega;
  h.omega = clamp(h.omega + alpha * dt, -30, 30);
  h.phi += h.omega * dt;
  let cx = h.px + h.L * Math.sin(h.phi);
  let cy = h.py + h.L * Math.cos(h.phi);
  // Keep the body on screen.
  const r = regionAt(world, cx, cy) || nearestRegion(world, cx, cy);
  if (r) {
    const m = 22 * s;
    const nx = clamp(cx, r.x + m, r.x + r.w - m);
    const ny = clamp(cy, r.y + m, r.y + r.h - m);
    if (nx !== cx || ny !== cy) h.omega *= 0.8;
    cx = nx;
    cy = ny;
  }
  c.rot = h.phi0 - h.phi;
  c.x = cx;
  c.y = cy + CENTER_Y * s;
}

export function release(st) {
  const c = st.char;
  const h = c.held;
  if (!h) return;
  const s = c.scale;
  let vx = h.pvx + h.L * h.omega * Math.cos(h.phi);
  let vy = h.pvy - h.L * h.omega * Math.sin(h.phi);
  const sp = Math.hypot(vx, vy);
  const max = P.throwMax * s;
  if (sp > max) {
    vx *= max / sp;
    vy *= max / sp;
  }
  c.vx = vx;
  c.vy = vy;
  c.rotV = -h.omega;
  c.held = null;
  c.mode = 'air';
  c.airT = 0;
  c.jumpCutDone = true;
  c.jumpsLeft = 0;
  c.tumble = sp > 450 * s || Math.abs(wrapAngle(c.rot)) > 0.7;
  emit(st, 'throw', { speed: Math.min(sp, max) / s });
}

// ---- Grappling rope ---------------------------------------------------------

export function fireRope(st, world, tx, ty) {
  const c = st.char;
  const s = c.scale;
  if (c.mode === 'held') return false;
  const hand = handPoint(c);
  let dx = tx - hand.x;
  let dy = ty - hand.y;
  const d = Math.hypot(dx, dy);
  if (d < 24 * s) return false;
  const max = P.ropeMax * s;
  if (d > max) {
    tx = hand.x + (dx / d) * max;
    ty = hand.y + (dy / d) * max;
  }
  // Anchor on a window edge? Then reeling in all the way vaults the character onto it.
  let platformId = null;
  for (const p of world.platforms) {
    if (Math.abs(ty - p.y) <= 14 * s && tx >= p.x1 - 6 && tx <= p.x2 + 6) {
      platformId = platKey(p);
      ty = p.y;
      break;
    }
  }
  c.rope = { state: 'shooting', ax: tx, ay: ty, hx: hand.x, hy: hand.y, len: 0, t: 0, platformId };
  emit(st, 'rope-fire');
  return true;
}

function stepRopeVisual(st, dt) {
  const c = st.char;
  const r = c.rope;
  const s = c.scale;
  const hand = handPoint(c);
  if (r.state === 'shooting') {
    r.t += dt;
    const dx = r.ax - hand.x;
    const dy = r.ay - hand.y;
    const d = Math.hypot(dx, dy) || 1;
    const traveled = P.ropeShoot * s * r.t;
    if (traveled >= d) {
      r.hx = r.ax;
      r.hy = r.ay;
      if (c.mode === 'held') {
        r.state = 'retracting';
        return;
      }
      r.state = 'attached';
      const cen = centerOf(c);
      r.len = clamp(Math.hypot(cen.x - r.ax, cen.y - r.ay), P.ropeMin * s, P.ropeMax * s);
      c.mode = 'rope';
      c.ground = null;
      c.tumble = false;
      emit(st, 'rope-attach');
    } else {
      r.hx = hand.x + (dx / d) * traveled;
      r.hy = hand.y + (dy / d) * traveled;
    }
  } else if (r.state === 'retracting') {
    const k = 1 - Math.exp(-28 * dt);
    r.hx += (hand.x - r.hx) * k;
    r.hy += (hand.y - r.hy) * k;
    if (Math.hypot(hand.x - r.hx, hand.y - r.hy) < 6 * s) r.state = 'none';
  }
}

function stepRope(st, world, input, dt) {
  const c = st.char;
  const s = c.scale;
  const r = c.rope;
  if (input.jumpPressed || input.ropePressed) {
    input.jumpPressed = false;
    input.ropePressed = false;
    return releaseRope(st, true);
  }
  let { x: cx, y: cy } = centerOf(c);
  const dx = cx - r.ax;
  const dy = cy - r.ay;
  const dist = Math.hypot(dx, dy) || 1;
  const nx = dx / dist;
  const ny = dy / dist;
  let tX = ny;
  let tY = -nx;
  if (tX < 0) {
    tX = -tX;
    tY = -tY;
  }
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (dir !== 0) {
    c.vx += dir * tX * P.ropePump * s * dt;
    c.vy += dir * tY * P.ropePump * s * dt;
    c.facing = dir;
  }
  c.vy += P.gravity * s * dt;
  const drag = Math.exp(-P.ropeDrag * dt);
  c.vx *= drag;
  c.vy *= drag;
  if (input.up) r.len = Math.max(P.ropeMin * s, r.len - P.ropeReel * s * dt);
  if (input.down) r.len = Math.min(P.ropeMax * s, r.len + P.ropeReel * s * dt);

  cx += c.vx * dt;
  cy += c.vy * dt;
  const ex = cx - r.ax;
  const ey = cy - r.ay;
  const ed = Math.hypot(ex, ey) || 1;
  // Landing while roped: only when dropping onto something with the rope slack, or
  // when the rope is clearly loose (dragging the feet along the floor mid-swing is fine).
  const landable = (ed < r.len - 0.5 && c.vy > 120 * s) || ed < r.len - 20 * s;
  if (ed > r.len) {
    const ux = ex / ed;
    const uy = ey / ed;
    cx = r.ax + ux * r.len;
    cy = r.ay + uy * r.len;
    const vr = c.vx * ux + c.vy * uy;
    if (vr > 0) {
      c.vx -= vr * ux;
      c.vy -= vr * uy;
    }
  }
  const targetRot = Math.atan2(r.ax - cx, -(r.ay - cy));
  c.rot += wrapAngle(targetRot - c.rot) * (1 - Math.exp(-10 * dt));
  const prevY = c.y;
  c.x = cx;
  c.y = cy + CENTER_Y * s;
  // Swung onto a ledge (or the floor) with the rope slack: let go and stand there.
  collide(st, world, prevY, landable);
  if (c.mode !== 'rope') {
    if (r.state === 'attached') r.state = 'retracting';
    emit(st, 'rope-release');
    return;
  }
  r.hx = r.ax;
  r.hy = r.ay;

  // Reeled up to a window edge: vault onto it.
  if (r.platformId != null) {
    const p = platformFor(world, r.platformId, r.ax);
    const cen = centerOf(c);
    if (!p) {
      releaseRope(st, false);
    } else if (Math.hypot(cen.x - r.ax, cen.y - r.ay) <= 46 * s) {
      const rise = c.y - p.y + 26 * s;
      releaseRope(st, false);
      c.vy = -Math.sqrt(2 * P.gravity * s * Math.max(rise, 10 * s));
      c.vx = clamp(((p.x1 + p.x2) / 2 - c.x) * 2, -170 * s, 170 * s);
      emit(st, 'vault');
    }
  }
}

export function releaseRope(st, boost) {
  const c = st.char;
  const s = c.scale;
  if (c.mode === 'rope') c.mode = 'air';
  if (c.rope.state !== 'none') c.rope.state = 'retracting';
  c.jumpCutDone = true;
  c.jumpsLeft = 1;
  if (boost) {
    c.vy -= 260 * s;
    if (Math.hypot(c.vx, c.vy) > 950 * s) c.flipT = 0.5;
  }
  emit(st, 'rope-release');
}

/** Moving platform support: carry the character along when the window it stands on moves. */
export function carryWithPlatforms(st, oldWorld, newWorld) {
  const c = st.char;
  if (c.mode === 'hidden') return; // the hiding spot follows its window separately
  if (c.mode === 'climb' && c.climb && !c.climb.wall) {
    // Hanging on a window's side while it gets dragged around: hold on.
    const hand = handOffset(c.scale);
    const oldE = edgeFor(oldWorld, c.climb.key, c.y - hand);
    const newE = edgeFor(newWorld, c.climb.key, c.y - hand);
    if (oldE && newE && oldE.wx != null && newE.wx != null) {
      c.x += newE.wx - oldE.wx;
      c.y += newE.top - oldE.top;
    }
    return;
  }
  if (c.mode !== 'ground' || c.ground?.kind !== 'platform') return;
  const oldP = platformFor(oldWorld, c.ground.id, c.x);
  const newP = platformFor(newWorld, c.ground.id, c.x);
  if (!oldP || !newP) return;
  const dx = newP.wx - oldP.wx;
  const dy = newP.y - oldP.y;
  if (Math.abs(dy) > 60 * c.scale) {
    // Yanked away too fast to hold on.
    c.mode = 'air';
    c.ground = null;
    emit(st, 'platform-lost');
    return;
  }
  c.x += dx;
  c.y += dy;
  if (c.rope.state === 'attached' && c.rope.platformId === c.ground.id) {
    c.rope.ax += dx;
    c.rope.ay += dy;
  }
}
