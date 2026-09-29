// Notices when an app wants your attention, without reading anything private:
//  - its taskbar button flashes (Discord, Teams, installers finishing...), via a
//    shell hook on a hidden window;
//  - the unread count in its window title goes up ("(3) Discord", "Inbox (5)").
// Then the character peeks, walks over, or just tells you.
import { EventEmitter } from 'node:events';
import * as w32 from './win32.js';

/** "(3) Discord" -> 3, "Inbox (12) - Mail" -> 12, "Report (2019).pdf" -> null. */
export function unreadCount(title) {
  const m = String(title ?? '').match(/(?:^|\s)[([](\d{1,3})[)\]](?=\s|$)/);
  return m ? Number(m[1]) : null;
}

/** "Discord.exe" -> "Discord", "msedge.exe" -> "Edge". */
export function appLabel(proc) {
  const base = String(proc ?? '').replace(/\.exe$/i, '');
  const known = { msedge: 'Edge', chrome: 'Chrome', firefox: 'Firefox', 'ms-teams': 'Teams', teams: 'Teams', olk: 'Outlook', outlook: 'Outlook', whatsapp: 'WhatsApp', slack: 'Slack', telegram: 'Telegram', signal: 'Signal', steamwebhelper: 'Steam', steam: 'Steam', discord: 'Discord', spotify: 'Spotify', code: 'VS Code' };
  return known[base.toLowerCase()] ?? (base ? base[0].toUpperCase() + base.slice(1) : 'An app');
}

export class NotifyWatcher extends EventEmitter {
  /**
   * @param opts.watcher    DesktopWatcher (for window titles)
   * @param opts.makeWindow () => a hidden BrowserWindow to receive shell-hook messages
   * @param opts.ownPid     our process id (our own windows never count)
   */
  constructor({ watcher, makeWindow = null, ownPid = process.pid, windowInfo = w32.windowInfo, log = () => {} }) {
    super();
    Object.assign(this, { watcher, makeWindow, ownPid, windowInfo, log });
    this.counts = new Map(); // hwnd -> last unread count
  }

  start() {
    this.timer = setInterval(() => this.pollTitles(), 1000);
    this.listenForFlashes();
  }

  stop() {
    clearInterval(this.timer);
    this.hookWin?.destroy();
  }

  /** A hidden window that Windows tells about taskbar flashes. */
  listenForFlashes() {
    if (!this.makeWindow) return;
    try {
      this.hookWin = this.makeWindow();
      const hwnd = w32.hwndFromBuffer(this.hookWin.getNativeWindowHandle());
      const msg = w32.registerShellHook(hwnd);
      if (!msg) throw new Error('RegisterShellHookWindow failed');
      this.hookWin.hookWindowMessage(msg, (wParam, lParam) => {
        const code = wParam.readInt32LE(0);
        if (code !== w32.HSHELL_FLASH) return;
        const target = lParam.length >= 8 ? lParam.readBigUInt64LE(0) : BigInt(lParam.readUInt32LE(0));
        this.fromWindow(target, 'flash');
      });
      this.log('[notify] listening for taskbar flashes');
    } catch (err) {
      this.log(`[notify] no taskbar flash events: ${err.message}`);
    }
  }

  fromWindow(hwnd, kind, count = null) {
    const info = this.windowInfo(hwnd);
    if (!info || info.pid === this.ownPid) return;
    this.emit('ping', { hwnd: String(hwnd), pid: info.pid, process: info.process, app: appLabel(info.process), title: info.title, kind, count });
  }

  pollTitles() {
    const seen = new Set();
    for (const w of this.watcher.windows ?? []) {
      const key = String(w.hwnd);
      seen.add(key);
      const n = unreadCount(w.title) ?? 0;
      const prev = this.counts.get(key);
      this.counts.set(key, n);
      if (prev != null && n > prev) this.fromWindow(w.hwnd, 'badge', n);
    }
    for (const k of this.counts.keys()) if (!seen.has(k)) this.counts.delete(k);
  }
}

/**
 * Decides whether and how to react to a ping (settings, focus, fullscreen,
 * rate limits), then makes the character do it.
 */
export function createNotifyReactions({ settings, overlays, show, focusActive = () => false, quiet = () => false, isForeground = () => false, windowRect = () => null }) {
  const lastByApp = new Map();
  let last = 0;
  const lines = {
    flash: (a) => [`👀 ${a} wants your attention!`, `Psst! ${a} is waving at you.`, `Ooh, something’s up in ${a}!`],
    badge: (a, n) => [`📬 New in ${a}${n ? ` (${n} unread)` : ''}!`, `${a} has something new for you! 👀`, `Ding! ${a}${n ? `: ${n} unread` : ''}.`],
  };
  return function react(ping, { force = false } = {}) {
    const n = settings.get('notify') ?? {};
    if (!force) {
      if (n.enabled === false || quiet() || overlays.fullscreen.size > 0) return null;
      if (focusActive() && !n.duringFocus) return null;
      const ignore = String(n.ignore ?? '')
        .split(',')
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean);
      const proc = String(ping.process).toLowerCase().replace(/\.exe$/, '');
      if (ignore.some((x) => proc.includes(x) || ping.app.toLowerCase().includes(x))) return null;
      if (isForeground(ping.pid)) return null; // you're already looking at it
      const now = Date.now();
      if (now - last < 15000 || now - (lastByApp.get(proc) ?? 0) < 60000) return null;
      last = now;
      lastByApp.set(proc, now);
    }
    const rect = windowRect(ping.hwnd);
    const style = n.style ?? 'peek';
    const target = rect ? { x: (rect.x1 + rect.x2) / 2, y: rect.y1 + 40 } : null;
    if (style === 'walk' && target) overlays.sendToBrain('ov:do', { name: 'visit', x: target.x, y: target.y });
    else if (style !== 'say') overlays.sendToBrain('ov:do', { name: 'peek', x: target?.x ?? null, y: target?.y ?? null });
    const opts = lines[ping.kind === 'badge' ? 'badge' : 'flash'](ping.app, ping.count);
    show({
      ok: true,
      say: opts[Math.floor(Math.random() * opts.length)],
      mood: 'happy',
      dur: 6,
      buttons: [{ label: `Show ${ping.app}`, run: () => (w32.bringToFront(BigInt(ping.hwnd)), null) }],
    });
    return style;
  };
}
