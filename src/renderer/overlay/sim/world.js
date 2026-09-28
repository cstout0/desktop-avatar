// World geometry: the union of visible monitor work areas ("regions") plus
// one-way platforms (the top edges of app windows). All coordinates are global
// DIP screen coordinates.

const EPS = 1.5;

export function regionAt(world, x, y) {
  for (const r of world.regions) {
    if (x >= r.x - EPS && x <= r.x + r.w + EPS && y >= r.y - EPS && y <= r.y + r.h + EPS) return r;
  }
  return null;
}

export function nearestRegion(world, x, y) {
  let best = null;
  let bestD = Infinity;
  for (const r of world.regions) {
    const dx = Math.max(r.x - x, 0, x - (r.x + r.w));
    const dy = Math.max(r.y - y, 0, y - (r.y + r.h));
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}

/**
 * Is there another region glued to `side` of region r that covers the whole
 * span [a, b] (vertical span for left/right, horizontal span for top/bottom)?
 */
export function hasNeighbor(world, r, side, a, b) {
  for (const n of world.regions) {
    if (n === r) continue;
    if (side === 'right' && Math.abs(n.x - (r.x + r.w)) <= EPS && n.y <= a + EPS && n.y + n.h >= b - EPS) return true;
    if (side === 'left' && Math.abs(n.x + n.w - r.x) <= EPS && n.y <= a + EPS && n.y + n.h >= b - EPS) return true;
    if (side === 'bottom' && Math.abs(n.y - (r.y + r.h)) <= EPS && n.x <= a + EPS && n.x + n.w >= b - EPS) return true;
    if (side === 'top' && Math.abs(n.y + n.h - r.y) <= EPS && n.x <= a + EPS && n.x + n.w >= b - EPS) return true;
  }
  return false;
}

/** Floor height within region r: its work-area bottom, nudged up so feet aren't clipped. */
export function floorY(r) {
  return r.y + r.h - (r.inset ?? 0);
}

/** Platforms are pieces of a window's top edge; Claude tracks the window. */
export const platKey = (p) => p.win ?? p.id;

/** The piece of window `key`'s top edge nearest to x (any piece if x is null). */
export function platformFor(world, key, x = null) {
  if (key == null) return null;
  let best = null;
  let bestD = Infinity;
  for (const p of world.platforms) {
    if (platKey(p) !== key) continue;
    if (x == null) return p;
    const d = x < p.x1 ? p.x1 - x : x > p.x2 ? x - p.x2 : 0;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

export const platformById = (world, key) => platformFor(world, key, null);

/** Horizontal walkable span at the character's current ground. */
export function groundSpan(world, c) {
  if (c.ground?.kind === 'platform') {
    const p = platformFor(world, c.ground.id, c.x);
    if (p) return { x1: p.x1, x2: p.x2, y: p.y, platform: p };
  }
  const r = regionAt(world, c.x, c.y - 2) || nearestRegion(world, c.x, c.y);
  if (!r) return null;
  // Extend across neighbours whose floors are at the same height.
  let x1 = r.x;
  let x2 = r.x + r.w;
  for (const n of world.regions) {
    if (n === r || Math.abs(floorY(n) - floorY(r)) > EPS) continue;
    if (Math.abs(n.x + n.w - x1) <= EPS) x1 = n.x;
    if (Math.abs(n.x - x2) <= EPS) x2 = n.x + n.w;
  }
  return { x1, x2, y: floorY(r), platform: null };
}

/**
 * Every climbable vertical surface: window sides (from the desktop watcher)
 * plus the outer edges of the monitors. Cached per world object.
 * `face` = direction from the climber toward the surface.
 */
export function allEdges(world) {
  if (world.__edges) return world.__edges;
  const out = [...(world.edges ?? [])];
  for (const r of world.regions) {
    const y1 = r.y + 6;
    const y2 = floorY(r);
    if (!hasNeighbor(world, r, 'left', r.y + 20, r.y + r.h - 20)) out.push({ key: `wall:${r.id}:L`, wall: true, x: r.x, y1, y2, face: -1 });
    if (!hasNeighbor(world, r, 'right', r.y + 20, r.y + r.h - 20)) out.push({ key: `wall:${r.id}:R`, wall: true, x: r.x + r.w, y1, y2, face: 1 });
  }
  Object.defineProperty(world, '__edges', { value: out, enumerable: false });
  return out;
}

/** The segment of edge `key` nearest to height y. */
export function edgeFor(world, key, y) {
  let best = null;
  let bestD = Infinity;
  for (const e of allEdges(world)) {
    if (e.key !== key) continue;
    const d = y < e.y1 ? e.y1 - y : y > e.y2 ? y - e.y2 : 0;
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

export function regionIndex(world, r) {
  return world.regions.indexOf(r);
}
