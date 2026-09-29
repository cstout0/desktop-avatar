// One transparent, click-through, always-on-top window per monitor. Tracks which
// one is the "brain" (runs the character's simulation) and relays hand-offs, snapshots
// and input between them.
import { BrowserWindow, ipcMain, screen } from 'electron';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import * as w32 from './win32.js';

const BOUNCE = new Set(['ov:say', 'ov:do', 'ov:key', 'ov:control', 'ov:hide-bubble', 'ov:speaking', 'ov:focus']);

export class OverlayManager extends EventEmitter {
  constructor({ root, settings, harness }) {
    super();
    this.root = root;
    this.settings = settings;
    this.harness = harness;
    this.wins = new Map(); // displayId -> { win, display, hidden }
    this.brainId = null;
    this.brainSpawned = false;
    this.platforms = [];
    this.fullscreen = new Set();
    this.lastReport = null;
    this.hwnds = new Set();
    this.installIpc();
  }

  entryFor(wc) {
    for (const [id, e] of this.wins) if (e.win.webContents === wc) return [id, e];
    return [null, null];
  }

  regions() {
    const out = [];
    for (const [id, e] of this.wins) {
      if (e.hidden) continue;
      const a = e.display.workArea;
      out.push({ id, x: a.x, y: a.y, w: a.width, h: a.height, inset: 3 });
    }
    return out;
  }

  world() {
    return { regions: this.regions(), platforms: this.platforms, edges: this.edges ?? [] };
  }

  async build(savedState = null) {
    const primary = screen.getPrimaryDisplay();
    this.brainId = primary.id;
    this.brainSpawned = false;
    this.savedState = savedState;
    await Promise.all(screen.getAllDisplays().map((d) => this.create(d)));
    this.pushWorld();
  }

  async create(d) {
    const a = d.workArea;
    const win = new BrowserWindow({
      x: a.x,
      y: a.y,
      width: a.width,
      height: a.height,
      transparent: true,
      backgroundColor: '#00000000',
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      roundedCorners: false,
      show: false,
      focusable: true,
      title: 'Desktop Avatar overlay',
      webPreferences: {
        preload: path.join(this.root, 'src/preload/overlay.cjs'),
        backgroundThrottling: false,
        spellcheck: false,
      },
    });
    const entry = { win, display: d, hidden: false };
    this.wins.set(d.id, entry);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(true, { forward: true });
    win.on('closed', () => {
      if (this.wins.get(d.id)?.win === win) this.wins.delete(d.id);
    });
    win.webContents.on('console-message', (e) => {
      if (e.level === 'error' || e.level === 'warning') this.emit('log', `[overlay ${d.id}] ${e.message} ${e.sourceId ?? ''}:${e.lineNumber ?? ''}`);
    });
    win.webContents.on('render-process-gone', (_e, details) => this.emit('log', `[overlay ${d.id}] renderer gone: ${details.reason}`));
    await win.loadFile(path.join(this.root, 'src/renderer/overlay/index.html'), { query: { display: String(d.id) } });
    const hwnd = w32.hwndFromBuffer(win.getNativeWindowHandle());
    w32.makeToolWindow(hwnd);
    this.hwnds.add(hwnd);
    win.showInactive();
    win.setBounds({ x: a.x, y: a.y, width: a.width, height: a.height });
    return entry;
  }

  destroyAll() {
    for (const e of this.wins.values()) e.win.destroy();
    this.wins.clear();
    this.hwnds.clear();
  }

  send(id, ch, data) {
    const e = this.wins.get(id);
    if (e && !e.win.isDestroyed()) e.win.webContents.send(ch, data);
  }

  sendToBrain(ch, data) {
    this.send(this.brainId, ch, data);
  }

  broadcast(ch, data) {
    for (const id of this.wins.keys()) this.send(id, ch, data);
  }

  pushWorld() {
    this.broadcast('ov:world', this.world());
  }

  setPlatforms(platforms, edges = this.edges) {
    this.platforms = platforms;
    this.edges = edges;
    this.pushWorld();
  }

  /** Show/hide overlays for monitors that went (or left) fullscreen. */
  setFullscreen(ids) {
    const same = ids.size === this.fullscreen.size && [...ids].every((x) => this.fullscreen.has(x));
    if (same) return false;
    this.fullscreen = new Set(ids);
    const visible = [...this.wins.keys()].filter((id) => !ids.has(id));
    if (ids.has(this.brainId) && visible.length) {
      const from = this.wins.get(this.brainId).display.bounds;
      const to = this.nearest(from, visible);
      const tb = this.wins.get(to).display.bounds;
      const side = tb.x >= from.x + from.width ? 'left' : tb.x + tb.width <= from.x ? 'right' : 'middle';
      this.sendToBrain('ov:evacuate', { to, side });
      this.emit('evacuated', to);
    }
    for (const [id, e] of this.wins) {
      const hide = ids.has(id);
      if (hide && !e.hidden) {
        e.hidden = true;
        e.win.hide();
      } else if (!hide && e.hidden) {
        e.hidden = false;
        e.win.showInactive();
        e.win.setAlwaysOnTop(true, 'screen-saver');
      }
    }
    // If every monitor was fullscreen the brain sat hidden (and paused); the
    // evacuate above moves it as soon as any monitor frees up.
    this.pushWorld();
    return true;
  }

  nearest(fromBounds, ids) {
    const cx = fromBounds.x + fromBounds.width / 2;
    const cy = fromBounds.y + fromBounds.height / 2;
    let best = ids[0];
    let bestD = Infinity;
    for (const id of ids) {
      const b = this.wins.get(id).display.bounds;
      const d = Math.hypot(b.x + b.width / 2 - cx, b.y + b.height / 2 - cy);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  brainWindow() {
    return this.wins.get(this.brainId)?.win ?? null;
  }

  installIpc() {
    ipcMain.handle('ov:ready', (ev) => {
      const [id, e] = this.entryFor(ev.sender);
      if (!e) return null;
      const a = e.display.workArea;
      const isBrain = id === this.brainId && !this.brainSpawned;
      if (isBrain) this.brainSpawned = true;
      if (isBrain && this.savedState) {
        const state = this.savedState;
        this.savedState = null;
        setTimeout(() => this.send(id, 'ov:become-brain', { state }), 50);
        return { displayId: id, area: { x: a.x, y: a.y, w: a.width, h: a.height }, isBrain: false, world: this.world(), settings: this.settings.all(), harness: this.harness };
      }
      return { displayId: id, area: { x: a.x, y: a.y, w: a.width, h: a.height }, isBrain, world: this.world(), settings: this.settings.all(), harness: this.harness };
    });
    ipcMain.on('ov:ignore', (ev, v) => {
      const [, e] = this.entryFor(ev.sender);
      e?.win.setIgnoreMouseEvents(!!v, { forward: true });
    });
    ipcMain.on('ov:snapshot', (ev, snap) => {
      const [id] = this.entryFor(ev.sender);
      if (id !== this.brainId) return;
      for (const [oid, e] of this.wins) if (oid !== id && !e.hidden) e.win.webContents.send('ov:snapshot', snap);
    });
    ipcMain.on('ov:handoff', (ev, { to, state, keys }) => {
      const [from] = this.entryFor(ev.sender);
      if (from !== this.brainId) return;
      const target = this.wins.get(to);
      if (!target || target.hidden) {
        ev.sender.send('ov:become-brain', { state, keys });
        return;
      }
      this.brainId = to;
      target.win.webContents.send('ov:become-brain', { state, keys });
      this.emit('brain-changed', to, from);
    });
    ipcMain.on('ov:claim', (ev) => {
      const [id] = this.entryFor(ev.sender);
      if (id != null && id !== this.brainId) this.sendToBrain('ov:request-handoff', { to: id });
    });
    ipcMain.on('ov:armed', (ev) => {
      const [, e] = this.entryFor(ev.sender);
      if (e && !e.win.isFocused()) e.win.focus();
    });
    ipcMain.on('ov:key', (_ev, k) => this.sendToBrain('ov:key', k));
    ipcMain.on('ov:blurred', () => this.sendToBrain('ov:control', false));
    ipcMain.on('ov:release-focus', (ev) => {
      const [, e] = this.entryFor(ev.sender);
      e?.win.blur();
    });
    ipcMain.on('ov:control-changed', (_ev, on) => this.emit('control', on));
    ipcMain.on('ov:open-chat', () => this.emit('open-chat'));
    ipcMain.on('ov:context-menu', (ev, p) => {
      const [, e] = this.entryFor(ev.sender);
      this.emit('context-menu', e?.win, p);
    });
    ipcMain.on('ov:bubble-action', (_ev, id) => this.emit('bubble-action', id));
    ipcMain.on('ov:game', (ev, e) => {
      const [id] = this.entryFor(ev.sender);
      if (id === this.brainId && e && typeof e === 'object') this.emit('game', e);
    });
    ipcMain.on('ov:said', (ev, text) => {
      const [id] = this.entryFor(ev.sender);
      if (id === this.brainId && typeof text === 'string') this.emit('said', text.slice(0, 300));
    });
    ipcMain.on('ov:report', (ev, r) => {
      const [id] = this.entryFor(ev.sender);
      if (id !== this.brainId) return;
      this.lastReport = r;
      this.emit('report', r);
    });
    ipcMain.on('ov:bounce', (ev, { ch, data, hops = 1 }) => {
      // A message reached a window that just stopped being the brain: re-route it.
      const [id] = this.entryFor(ev.sender);
      if (!BOUNCE.has(ch) || hops > 4) return;
      const envelope = { __bounced: true, hops, data };
      if (id === this.brainId) setTimeout(() => this.sendToBrain(ch, envelope), 16);
      else this.sendToBrain(ch, envelope);
    });
  }
}
