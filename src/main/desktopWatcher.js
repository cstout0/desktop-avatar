// Polls the desktop: app windows -> walkable ledges, fullscreen detection per
// monitor, the cursor, and a fast path for the window Claude is standing on.
import { screen } from 'electron';
import * as w32 from './win32.js';
import { computeEdges, computePlatforms, sameEdges, samePlatforms } from './platforms.js';
import { fullscreenMonitors } from './fullscreen.js';

const SKIP_CLASSES = new Set(['Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Progman', 'WorkerW']);

function toDip(r) {
  const d = screen.screenToDipRect(null, { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top });
  return { left: d.x, top: d.y, right: d.x + d.width, bottom: d.y + d.height };
}

export class DesktopWatcher {
  constructor(overlays, { debounceMs = 900 } = {}) {
    this.overlays = overlays;
    this.debounceMs = debounceMs;
    this.platforms = [];
    this.windows = [];
    this.lastRects = new Map();
    this.fsCandidate = null;
    this.fsSince = 0;
    this.lastCursor = { x: NaN, y: NaN };
    this.tick = 0;
    this.enabled = true;
    this.forceFullscreen = null; // test hook
  }

  start() {
    this.timers = [setInterval(() => this.poll(), 50), setInterval(() => this.pollGround(), 12), setInterval(() => this.pollCursor(), 16)];
    this.poll();
  }

  stop() {
    for (const t of this.timers || []) clearInterval(t);
  }

  poll() {
    try {
      const raw = w32.listWindows({ excludePids: [process.pid] }).filter((w) => !SKIP_CLASSES.has(w.className));
      this.windows = raw;
      this.tick++;
      if (this.tick % 5 === 0) this.checkFullscreen(raw);
      const regions = this.overlays.regions();
      const list = raw.map((w) => ({ hwnd: String(w.hwnd), ...toDip(w.rect) }));
      for (const w of list) this.lastRects.set(w.hwnd, w);
      const walkable = this.overlays.settings.get('walkOnWindows') !== false;
      const platforms = walkable ? computePlatforms(list, regions) : [];
      const edges = walkable ? computeEdges(list, regions) : [];
      if (!samePlatforms(platforms, this.platforms) || !sameEdges(edges, this.edges)) {
        this.platforms = platforms;
        this.edges = edges;
        this.overlays.setPlatforms(platforms, edges);
      }
    } catch (err) {
      this.overlays.emit('log', `watcher poll failed: ${err.stack || err}`);
    }
  }

  checkFullscreen(raw) {
    let ids;
    if (this.forceFullscreen) {
      ids = new Set(this.forceFullscreen);
    } else {
      const monitors = [...this.overlays.wins.values()].map((e) => {
        const p = screen.dipToScreenRect(null, e.display.bounds);
        return { id: e.display.id, rect: { left: p.x, top: p.y, right: p.x + p.width, bottom: p.y + p.height } };
      });
      const fg = w32.foregroundInfo();
      ids = fullscreenMonitors({
        monitors,
        windows: raw.map((w) => ({ rect: w.rect, style: w.style, exStyle: w.exStyle, className: w.className })),
        fg,
        quns: w32.notificationState(),
        ownPid: process.pid,
      });
      this.lastFg = fg && { title: fg.title, className: fg.className, rect: fg.rect, style: fg.style };
    }
    const key = [...ids].sort().join(',');
    const now = Date.now();
    if (key !== this.fsCandidate) {
      this.fsCandidate = key;
      this.fsSince = now;
      return;
    }
    // Only act once the state has been stable for a moment (screenshot tools
    // and alt-tab flashes shouldn't make Claude bounce between monitors).
    if (now - this.fsSince >= this.debounceMs) this.overlays.setFullscreen(ids);
  }

  /** Fast path: follow the window Claude stands on / hangs from as it's dragged. */
  pollGround() {
    const rep = this.overlays.lastReport;
    const id = rep?.ground?.kind === 'platform' ? rep.ground.id : rep?.climbWin;
    if (!id) return;
    let hwnd;
    try {
      hwnd = BigInt(id);
    } catch {
      return;
    }
    const r = w32.windowRect(hwnd);
    if (!r) return;
    const dip = toDip(r);
    const prev = this.lastRects.get(id);
    this.lastRects.set(id, { hwnd: id, ...dip });
    if (!prev || (prev.left === dip.left && prev.top === dip.top)) return;
    const dx = dip.left - prev.left;
    const dy = dip.top - prev.top;
    this.platforms = this.platforms.map((p) => (p.win === id ? { ...p, x1: p.x1 + dx, x2: p.x2 + dx, y: p.y + dy, wx: p.wx + dx } : p));
    this.edges = (this.edges ?? []).map((e) => (e.win === id ? { ...e, x: e.x + dx, y1: e.y1 + dy, y2: e.y2 + dy, top: e.top + dy, wx: e.wx + dx } : e));
    this.overlays.setPlatforms(this.platforms, this.edges);
  }

  /** Find a visible app window by app/process name or title words ("spotify", "discord"). */
  findWindow(target) {
    const q = String(target ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim();
    if (!q) return null;
    const scored = this.windows.map((w) => {
      const proc = w32.processName(w.pid).toLowerCase().replace(/\.exe$/, '');
      const title = w.title.toLowerCase();
      let score = 0;
      if (proc === q) score = 3;
      else if (proc.includes(q) || (proc.length > 3 && q.includes(proc))) score = 2;
      else if (title.includes(q)) score = 1;
      return { w, score };
    });
    const best = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score)[0];
    return best ? { hwnd: String(best.w.hwnd), title: best.w.title, process: w32.processName(best.w.pid) } : null;
  }

  pollCursor() {
    const p = screen.getCursorScreenPoint();
    if (p.x === this.lastCursor.x && p.y === this.lastCursor.y) return;
    this.lastCursor = p;
    this.overlays.sendToBrain('ov:cursor', p);
  }
}
