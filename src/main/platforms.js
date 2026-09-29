// Turns the z-ordered list of app windows into walkable one-way platforms: the
// visible parts of each window's top edge. Pure function (unit tested).

function subtract(segs, a, b) {
  const out = [];
  for (const [x1, x2] of segs) {
    if (b <= x1 || a >= x2) out.push([x1, x2]);
    else {
      if (a > x1) out.push([x1, a]);
      if (b < x2) out.push([b, x2]);
    }
  }
  return out;
}

/**
 * @param wins    windows in z-order (topmost first): { hwnd, left, top, right, bottom }
 * @param regions visible monitor work areas: { x, y, w, h }
 * @param opts.minWidth  shortest usable ledge
 * @param opts.headroom  space needed above a ledge for the character to stand on it
 */
export function computePlatforms(wins, regions, { minWidth = 40, headroom = 90 } = {}) {
  const out = [];
  for (let i = 0; i < wins.length; i++) {
    const w = wins[i];
    const y = w.top;
    let segs = [];
    for (const r of regions) {
      if (y < r.y + headroom || y > r.y + r.h - 24) continue;
      const x1 = Math.max(w.left, r.x);
      const x2 = Math.min(w.right, r.x + r.w);
      if (x2 > x1) segs.push([x1, x2]);
    }
    // Hide the parts of the edge covered by windows in front of this one.
    for (let j = 0; j < i && segs.length; j++) {
      const o = wins[j];
      if (o.top <= y && o.bottom > y) segs = subtract(segs, o.left, o.right);
    }
    segs.sort((p, q) => p[0] - q[0]);
    let k = 0;
    for (let s = 0; s < segs.length; s++) {
      let [x1, x2] = segs[s];
      while (s + 1 < segs.length && segs[s + 1][0] <= x2 + 0.5) x2 = Math.max(x2, segs[++s][1]);
      if (x2 - x1 >= minWidth) out.push({ id: `${w.hwnd}#${k++}`, win: w.hwnd, x1, x2, y, wx: w.left });
    }
  }
  return out;
}

/**
 * Climbable window sides: the visible parts of each window's left/right edge.
 * `face` is the direction from the climber toward the window (+1: it hangs
 * on the left side facing right; -1: on the right side facing left).
 */
export function computeEdges(wins, regions, { minHeight = 80, reach = 36, topGap = 20 } = {}) {
  const out = [];
  for (let i = 0; i < wins.length; i++) {
    const w = wins[i];
    for (const [x, face] of [
      [w.left, 1],
      [w.right, -1],
    ]) {
      const body = x - face * reach; // where the character's body hangs, outside the window
      let segs = [];
      for (const r of regions) {
        if (body < r.x + 4 || body > r.x + r.w - 4) continue;
        const y1 = Math.max(w.top, r.y + topGap);
        const y2 = Math.min(w.bottom, r.y + r.h);
        if (y2 - y1 >= minHeight) segs.push([y1, y2]);
      }
      // Windows in front that cover this line hide those stretches of the edge.
      for (let j = 0; j < i && segs.length; j++) {
        const o = wins[j];
        if (o.left < x - 1 && o.right > x + 1) segs = subtract(segs, o.top, o.bottom);
      }
      let k = 0;
      for (const [y1, y2] of segs.sort((a, b) => a[0] - b[0])) {
        if (y2 - y1 >= minHeight) out.push({ id: `${w.hwnd}${face > 0 ? 'L' : 'R'}${k++}`, key: `${w.hwnd}${face > 0 ? 'L' : 'R'}`, win: w.hwnd, x, y1, y2, face, top: w.top, wx: w.left });
      }
    }
  }
  return out;
}

export function sameEdges(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    const q = b[i];
    if (p.id !== q.id || p.x !== q.x || p.y1 !== q.y1 || p.y2 !== q.y2) return false;
  }
  return true;
}

export function samePlatforms(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    const q = b[i];
    if (p.id !== q.id || p.x1 !== q.x1 || p.x2 !== q.x2 || p.y !== q.y || p.wx !== q.wx) return false;
  }
  return true;
}
