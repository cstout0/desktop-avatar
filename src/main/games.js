// Mini-games on the real desktop: fetch (throw a ball, it chases it) and hide
// and seek (it hides behind one of your windows, or just off the edge of a
// monitor, and peeks out). The character's side lives in the overlay's
// simulation; this picks hiding spots, follows the window it hides behind, and
// keeps high scores.
import { EventEmitter } from 'node:events';
import { BODY, CENTER_Y } from '../renderer/overlay/sim/constants.js';

const charHeight = (scale, lift) => (CENTER_Y + BODY.h / 2 + BODY.antenna + lift) * scale;

/**
 * Feet heights within [lo, hi] where something `tall` standing in the strip
 * [xa, xb] isn't covered by any of the `above` windows. Returns the biggest
 * free stretch as [lo, hi], or null.
 */
function freeStretch(above, xa, xb, lo, hi, tall) {
  let spans = [[lo, hi]];
  for (const o of above) {
    if (o.x2 <= xa || o.x1 >= xb) continue;
    // Feet anywhere in (o.y1, o.y2 + tall) would overlap it.
    const a = o.y1;
    const b = o.y2 + tall;
    spans = spans.flatMap(([s, e]) => {
      if (b <= s || a >= e) return [[s, e]];
      const out = [];
      if (a > s) out.push([s, a]);
      if (b < e) out.push([b, e]);
      return out;
    });
  }
  return spans.sort((p, q) => q[1] - q[0] - (p[1] - p[0]))[0] ?? null;
}

/** The strip along a window's side edge that has to be in view for it to hide there. */
const edgeStrip = (w, face, s) => (face < 0 ? [w.x1 - 4, w.x1 + 40 * s] : [w.x2 - 40 * s, w.x2 + 4]);

/**
 * Where to hide: behind the side edge of a window (peeking out), or just past
 * the outer edge of a monitor. Coordinates are DIPs; `y` is where its feet go.
 * @param opts.windows  [{ hwnd, x1, y1, x2, y2 }] visible app windows, topmost first
 * @param opts.regions  monitor work areas [{ id, x, y, w, h, inset }]
 */
export function hideSpots({ windows, regions, scale = 1.4, lift = 0 }) {
  const s = scale;
  const tall = charHeight(s, lift);
  const out = [];
  const regionAt = (x, y) => regions.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  const outer = (r, side) => !regions.some((n) => n !== r && (side === 'left' ? Math.abs(n.x + n.w - r.x) < 2 : Math.abs(n.x - (r.x + r.w)) < 2));
  windows.forEach((w, i) => {
    if (w.y2 - w.y1 < tall + 50 || w.x2 - w.x1 < 120) return;
    if (!regionAt((w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2)) return; // on a screen it stays off (e.g. a fullscreen game)
    for (const face of [-1, 1]) {
      const edge = face < 0 ? w.x1 : w.x2;
      const r = regionAt(edge + face * 40 * s, (w.y1 + w.y2) / 2);
      if (!r) continue; // the peeking side would be off-screen
      // Only where that edge is actually in view (not under a window on top of it).
      const [xa, xb] = edgeStrip(w, face, s);
      const free = freeStretch(windows.slice(0, i), xa, xb, w.y1 + 34 + tall, Math.min(w.y2 - 6 * s, r.y + r.h - 4), tall);
      if (!free || free[1] < free[0]) continue;
      out.push({ kind: 'window', hwnd: w.hwnd, x: edge - face * 16 * s, feetMin: free[0], feetMax: free[1], face, clip: { x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 } });
    }
  });
  for (const r of regions) {
    const floor = r.y + r.h - (r.inset ?? 0);
    if (outer(r, 'left')) out.push({ kind: 'edge', x: r.x - 14 * s, feetMin: floor, feetMax: floor, face: 1, clip: null });
    if (outer(r, 'right')) out.push({ kind: 'edge', x: r.x + r.w + 14 * s, feetMin: floor, feetMax: floor, face: -1, clip: null });
  }
  return out;
}

/** Is a character hiding at `spot` (feet at spot.y) behind window `hwnd` now covered by a window on top? */
export function spotCovered({ windows, hwnd, spot, scale = 1.4, lift = 0 }) {
  const i = windows.findIndex((w) => String(w.hwnd) === String(hwnd));
  if (i < 0) return false;
  const [xa, xb] = edgeStrip(windows[i], spot.face, scale);
  return !freeStretch(windows.slice(0, i), xa, xb, spot.y, spot.y, charHeight(scale, lift));
}

export function pickHideSpot(spots, rand = Math.random) {
  if (!spots.length) return null;
  // Behind a window is more fun than the screen edge.
  const windows = spots.filter((x) => x.kind === 'window');
  const pool = windows.length && rand() < 0.8 ? windows : spots;
  const spot = pool[Math.floor(rand() * pool.length)];
  const y = spot.feetMin + (spot.feetMax - spot.feetMin) * (0.55 + rand() * 0.45);
  return { x: spot.x, y, face: spot.face, clip: spot.clip, hwnd: spot.hwnd ?? null, kind: spot.kind };
}

export class Games extends EventEmitter {
  /**
   * @param opts.settings  Settings ("games", "scale", "look")
   * @param opts.overlays  OverlayManager
   * @param opts.windows   () => [{ hwnd, x1, y1, x2, y2 }] visible windows (DIPs)
   * @param opts.rectOf    (hwnd) => { x1, y1, x2, y2 } | null   current rect, null if gone/minimized
   * @param opts.lift      () => extra antenna height for the current hat
   */
  constructor({ settings, overlays, windows, rectOf, lift = () => 0, log = () => {} }) {
    super();
    Object.assign(this, { settings, overlays, windows, rectOf, lift, log });
    this.active = null;
    overlays.on('game', (e) => this.onEvent(e));
  }

  start(kind) {
    if (kind === 'boxing' || kind === 'box') {
      // Boxing needs the cartoon gloves: put them on if they're not already.
      this.stopTracking();
      const look = this.settings.get('look') ?? {};
      const gloved = look.arms === 'gloves';
      if (!gloved) this.settings.set('look', { ...look, arms: 'gloves' });
      this.active = { kind: 'box', since: Date.now() };
      this.overlays.sendToBrain('ov:do', { name: 'game', game: 'box', total: 5 });
      return { ok: true, say: gloved ? undefined : 'Gloves on! 🥊' };
    }
    if (kind === 'fetch') {
      this.stopTracking();
      this.active = { kind, since: Date.now() };
      this.overlays.sendToBrain('ov:do', { name: 'game', game: 'fetch', best: this.settings.get('games.fetchBest') ?? 0 });
      return { ok: true };
    }
    if (kind === 'hide') {
      const spot = this.pickSpot();
      if (!spot) return { ok: false, say: 'Hmm, there’s nowhere good to hide right now!' };
      this.stopTracking();
      this.active = { kind, since: Date.now(), spot };
      this.overlays.sendToBrain('ov:do', { name: 'game', game: 'hide', spot, seconds: this.settings.get('games.hideSeconds') ?? 60 });
      if (spot.hwnd) this.track(spot);
      this.log(`[games] hiding ${spot.kind === 'window' ? `behind window ${spot.hwnd}` : 'past the screen edge'} at ${Math.round(spot.x)},${Math.round(spot.y)}`);
      return { ok: true };
    }
    throw new Error(`unknown game: ${kind}`);
  }

  pickSpot(not = null) {
    const spots = hideSpots({ windows: this.windows(), regions: this.overlays.regions(), scale: this.settings.get('scale') ?? 1.4, lift: this.lift() });
    return pickHideSpot(not ? spots.filter((x) => !(x.hwnd === not.hwnd && x.face === not.face)) : spots);
  }

  stop() {
    if (!this.active) return { ok: true, say: 'We weren’t playing anything.' };
    this.overlays.sendToBrain('ov:do', { name: 'game-end' });
    return { ok: true };
  }

  /**
   * Keep the hiding spot glued to its window. If the window goes away, you win;
   * if another window gets put on top of the spot, it sneaks off somewhere else.
   */
  track(spot) {
    let last = spot.clip;
    let missing = 0;
    let covered = 0;
    const cur = { ...spot };
    this.trackTimer = setInterval(() => {
      const r = this.rectOf(cur.hwnd);
      if (!r) {
        if (++missing >= 2) {
          this.overlays.sendToBrain('ov:do', { name: 'hide-rect', gone: true });
          this.stopTracking();
        }
        return;
      }
      missing = 0;
      const dx = r.x1 - last.x1;
      const dy = r.y1 - last.y1;
      if (dx || dy || r.x2 !== last.x2 || r.y2 !== last.y2) {
        this.overlays.sendToBrain('ov:do', { name: 'hide-rect', dx, dy, rect: r });
        cur.x += dx;
        cur.y += dy;
        last = r;
      }
      const scale = this.settings.get('scale') ?? 1.4;
      covered = spotCovered({ windows: this.windows(), hwnd: cur.hwnd, spot: cur, scale, lift: this.lift() }) ? covered + 1 : 0;
      if (covered >= 2) {
        const next = this.pickSpot(cur);
        this.stopTracking();
        if (!next) return;
        this.log(`[games] spot covered: sneaking over to ${next.kind === 'window' ? `window ${next.hwnd}` : 'the screen edge'}`);
        this.overlays.sendToBrain('ov:do', { name: 'hide-move', spot: next });
        if (this.active) this.active.spot = next;
        if (next.hwnd) this.track(next);
      }
    }, 150);
  }

  stopTracking() {
    clearInterval(this.trackTimer);
    this.trackTimer = null;
  }

  onEvent(e) {
    if (e.type === 'catch' && e.record) {
      const best = Math.max(this.settings.get('games.fetchBest') ?? 0, e.best ?? 0);
      if (best !== this.settings.get('games.fetchBest')) this.settings.set('games.fetchBest', best);
    } else if (e.type === 'fetch-end') {
      this.active = null;
    } else if (e.type === 'box-end') {
      if (!e.casual) {
        this.active = null;
        // Best = fastest full round (all five pop-ups knocked out).
        const best = this.settings.get('games.boxBest') ?? 0;
        if (e.kos >= e.total && e.total > 0 && e.secs > 0 && (!best || e.secs < best)) this.settings.set('games.boxBest', e.secs);
      }
    } else if (e.type === 'hide-end') {
      this.active = null;
      this.stopTracking();
      const best = this.settings.get('games.hideBest') ?? 0;
      if (e.how === 'found' && e.secs > 0 && (!best || e.secs < best)) this.settings.set('games.hideBest', e.secs);
    }
    this.log(`[games] ${JSON.stringify(e)}`);
    this.emit('event', e);
  }
}
