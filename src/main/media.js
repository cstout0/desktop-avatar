// Knows what's playing on the PC (via Windows' media controls) and which window
// it's in, so the character can dance to songs and watch videos along with you.
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import * as w32 from './win32.js';

const BROWSERS = /^(chrome|msedge|firefox|brave|opera|vivaldi|arc|librewolf|waterfox|zen)(\.exe)?$/i;
const VIDEO_APPS = /(vlc|mpc-hc|mpc-be|potplayer|mpv|plex|netflix|disney|primevideo|amazon|hulu|youtube|twitch|kodi|jellyfin|wmplayer|video\.ui|zunevideo|mediaplayer|stremio)/i;
// Store/UWP apps and Firefox report odd AUMIDs; map the common ones.
const AUMID_HINTS = [
  [/^308046B0AF4A39CB$/i, 'firefox'],
  [/chrome/i, 'chrome'],
  [/msedge/i, 'msedge'],
  [/spotify/i, 'spotify'],
  [/netflix/i, 'netflix'],
  [/ZuneVideo|Microsoft\.Media/i, 'mediaplayer'],
];

export function appKey(aumid = '') {
  for (const [re, name] of AUMID_HINTS) if (re.test(aumid)) return name;
  return aumid.split(/[\\!]/).pop().replace(/\.exe$/i, '').toLowerCase();
}

/** Is this media session a video (vs. music)? */
export function isVideo(session) {
  const app = appKey(session.app);
  if (session.kind === 'Video') return true;
  if (session.kind === 'Music') return false;
  if (/spotify|music|itunes|foobar|winamp|musicbee|tidal|deezer|soundcloud/i.test(app)) return false;
  return BROWSERS.test(app) || VIDEO_APPS.test(app);
}

export class MediaWatcher extends EventEmitter {
  constructor({ root, watcher }) {
    super();
    this.root = root;
    this.watcher = watcher;
    this.sessions = [];
    this.active = null;
    this.proc = null;
    this.injected = null; // tests
  }

  start() {
    // (When installed, PowerShell needs the real file next to app.asar, not the one inside it.)
    const script = path.join(this.root, 'src', 'main', 'helpers', 'media-sessions.ps1').replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked');
    this.proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true });
    let buf = '';
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try {
          const list = JSON.parse(line);
          if (!this.injected) this.update(Array.isArray(list) ? list : [list]);
        } catch {
          /* ignore partial lines */
        }
      }
    });
    this.proc.on('exit', () => {
      this.proc = null;
      if (!this.stopped) setTimeout(() => this.start(), 5000); // restart if it dies
    });
  }

  stop() {
    this.stopped = true;
    this.proc?.kill();
  }

  inject(list) {
    this.injected = list;
    this.update(list ?? []);
    if (list === null) this.injected = null;
  }

  update(list) {
    this.sessions = list.filter(Boolean);
    const playing = this.sessions.filter((s) => s.status === 'Playing');
    // Prefer a playing video, then any playing session.
    const next = playing.find(isVideo) ?? playing[0] ?? null;
    const prev = this.active;
    const key = (s) => (s ? `${s.app}|${s.title}` : null);
    if (key(next) !== key(prev)) {
      this.active = next ? { ...next, video: isVideo(next), since: Date.now() } : null;
      this.emit('change', this.active, prev);
    } else if (next && this.active) {
      Object.assign(this.active, { pos: next.pos, dur: next.dur });
    }
  }

  /** The window showing the active media (best effort). */
  windowFor(session = this.active) {
    if (!session || !this.watcher) return null;
    const app = appKey(session.app);
    const title = String(session.title ?? '').toLowerCase();
    let best = null;
    for (const w of this.watcher.windows) {
      const proc = w32.processName(w.pid).toLowerCase().replace(/\.exe$/, '');
      if (proc !== app && !(app === 'mediaplayer' && /video|media/.test(proc))) continue;
      const score = title && w.title.toLowerCase().includes(title.slice(0, 40)) ? 2 : 1;
      if (!best || score > best.score) best = { w, score };
    }
    return best ? { hwnd: String(best.w.hwnd), rect: best.w.rect, title: best.w.title } : null;
  }

  describe() {
    const s = this.active ?? this.sessions[0];
    if (!s) return '';
    const what = s.artist ? `"${s.title}" by ${s.artist}` : `"${s.title}"`;
    return `${s.status === 'Playing' ? 'Now playing' : 'Paused'}: ${what} (${appKey(s.app)}, ${isVideo(s) ? 'video' : 'music'})`;
  }
}
