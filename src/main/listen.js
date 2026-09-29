// What the ears listen to: everything the PC plays, everything except voice-chat
// apps (so a Discord call doesn't make it dance or end up in its video comments),
// or only the app that's playing the video. The per-app modes use a tiny helper
// (native/AppLoopback.cs) that Windows' own C# compiler builds on first use.
import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = fileURLToPath(new URL('./native/AppLoopback.cs', import.meta.url));
const RATE = 48000;

const stem = (name) =>
  String(name ?? '')
    .toLowerCase()
    .replace(/\.exe$/, '');

/** "Discord.exe" -> "Discord", "ms-teams.exe" -> "Teams". */
export function appName(exe) {
  const s = stem(exe);
  const known = { 'ms-teams': 'Teams', msedge: 'Edge', firefox: 'Firefox', chrome: 'Chrome', discord: 'Discord', discordptb: 'Discord', discordcanary: 'Discord', zoom: 'Zoom', slack: 'Slack', skype: 'Skype', spotify: 'Spotify', vlc: 'VLC' };
  return known[s] ?? (s ? s[0].toUpperCase() + s.slice(1) : 'that app');
}

/** The topmost process of the same program (the main Discord.exe, not one of its helpers). */
export function rootOf(procs, pid) {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  let cur = byPid.get(pid);
  if (!cur) return pid;
  const seen = new Set();
  while (!seen.has(cur.pid)) {
    seen.add(cur.pid);
    const parent = byPid.get(cur.ppid);
    if (!parent || stem(parent.name) !== stem(cur.name)) break;
    cur = parent;
  }
  return cur.pid;
}

/** The first running app matching one of `keywords` ("discord, teams"), as its main process. */
export function findApp(procs, keywords) {
  const words = (Array.isArray(keywords) ? keywords : String(keywords ?? '').split(','))
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
  for (const w of words) {
    const p = procs.find((x) => stem(x.name).includes(w));
    if (!p) continue;
    const root = rootOf(procs, p.pid);
    return { pid: root, name: procs.find((x) => x.pid === root)?.name ?? p.name };
  }
  return null;
}

/** Build (once) the helper exe with the C# compiler that comes with Windows. */
export async function ensureHelper(dir, { log = () => {} } = {}) {
  const exe = path.join(dir, 'AppLoopback.exe');
  const src = fs.readFileSync(SOURCE, 'utf8');
  const hash = crypto.createHash('sha256').update(src).digest('hex').slice(0, 16);
  const stamp = path.join(dir, 'AppLoopback.version');
  if (fs.existsSync(exe) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === hash) return exe;
  fs.mkdirSync(dir, { recursive: true });
  const cs = path.join(dir, 'AppLoopback.cs');
  fs.writeFileSync(cs, src);
  const csc = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  if (!fs.existsSync(csc)) throw new Error('the C# compiler that comes with Windows (.NET Framework 4) is missing');
  await new Promise((resolve, reject) =>
    execFile(csc, ['-nologo', '-optimize+', '-target:exe', '-platform:x64', `-out:${exe}`, cs], { windowsHide: true, timeout: 60000 }, (err, stdout) =>
      err ? reject(new Error(`couldn't build the app-audio helper: ${String(stdout || err.message).trim()}`)) : resolve(),
    ),
  );
  fs.writeFileSync(stamp, hash);
  log('[listen] built the app-audio helper');
  return exe;
}

/** One running helper: emits 'pcm' (Float32Array, mono, 48 kHz), 'status', 'exit'. */
export class AppCapture extends EventEmitter {
  constructor({ exe, pid, mode }) {
    super();
    this.proc = spawn(exe, ['--pid', String(pid), '--mode', mode, '--rate', String(RATE)], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let carry = Buffer.alloc(0);
    this.proc.stdout.on('data', (d) => {
      const buf = carry.length ? Buffer.concat([carry, d]) : d;
      const whole = buf.length - (buf.length % 4);
      carry = Buffer.from(buf.subarray(whole));
      if (whole) this.emit('pcm', new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + whole)));
    });
    let err = '';
    this.proc.stderr.on('data', (d) => {
      err += d;
      let i;
      while ((i = err.indexOf('\n')) >= 0) {
        const line = err.slice(0, i).trim();
        err = err.slice(i + 1);
        try {
          if (line) this.emit('status', JSON.parse(line));
        } catch {
          this.emit('status', { ok: false, error: line });
        }
      }
    });
    this.proc.on('exit', (code) => this.emit('exit', code));
    this.proc.on('error', (e) => this.emit('status', { ok: false, error: e.message }));
    this.proc.stdin.on('error', () => {});
  }

  stop() {
    try {
      this.proc.stdin.end(); // the helper quits when its input closes
    } catch {
      // already gone
    }
    setTimeout(() => this.proc.kill(), 1500).unref?.();
  }
}

export class ListenSource extends EventEmitter {
  /**
   * @param opts.settings     Settings ("audioReactions", "listen.source", "listen.callApps")
   * @param opts.ears         the ears extension (send, setStatus, ready)
   * @param opts.media        MediaWatcher (active session, windowFor)
   * @param opts.processList  () => [{ pid, ppid, name }]
   * @param opts.windowPid    (hwnd) => pid of a window
   * @param opts.helperDir    where the helper exe lives
   */
  constructor({ settings, ears, media, processList, windowPid, helperDir, ui = () => {}, log = () => {} }) {
    super();
    Object.assign(this, { settings, ears, media, processList, windowPid, helperDir, ui, log });
    this.cur = null; // { kind: 'system'|'app'|'none'|'off', pid?, mode?, label }
    this.capture = null;
    this.failedUntil = 0;
    this.pending = null;
  }

  async start() {
    await this.ears.ready;
    this.settings.on('change', (key) => {
      if (key === '*' || key === 'audioReactions' || String(key).startsWith('listen')) this.reconcile();
    });
    this.media?.on('change', () => this.reconcile());
    this.timer = setInterval(() => this.reconcile(), 3000);
    this.reconcile();
  }

  stop() {
    clearInterval(this.timer);
    this.capture?.stop();
    this.capture = null;
  }

  /** Where it should be listening right now. */
  want() {
    if (this.settings.get('audioReactions') === false) return { kind: 'off', label: 'not listening (dancing is off)' };
    const source = this.settings.get('listen.source') ?? 'all';
    if (source === 'all' || Date.now() < this.failedUntil) return { kind: 'system', label: 'everything your PC plays' };
    const procs = this.processList();
    if (source === 'no-calls') {
      const call = findApp(procs, this.settings.get('listen.callApps') ?? 'discord, teams, zoom, slack, skype');
      if (!call) return { kind: 'system', label: 'everything (no voice-chat app is open)' };
      return { kind: 'app', mode: 'exclude', pid: call.pid, label: `everything except ${appName(call.name)}` };
    }
    // Just the video: the app whose media is playing.
    const m = this.media?.active;
    if (!m) return { kind: 'none', label: 'waiting for a video or song to play' };
    const win = this.media.windowFor?.(m);
    let pid = win ? this.windowPid(win.hwnd) : null;
    if (pid) pid = rootOf(procs, pid);
    else pid = findApp(procs, [String(m.app ?? '').split(/[\\!]/).pop().replace(/\.exe$/i, '')])?.pid ?? null;
    if (!pid) return { kind: 'none', label: 'waiting for a video or song to play' };
    const name = procs.find((p) => p.pid === pid)?.name ?? '';
    return { kind: 'app', mode: 'include', pid, label: `only ${appName(name)}` };
  }

  state() {
    return { source: this.settings.get('listen.source') ?? 'all', kind: this.cur?.kind ?? 'off', label: this.cur?.label ?? 'starting…' };
  }

  reconcile() {
    if (this.pending) return;
    const w = this.want();
    const c = this.cur;
    if (c && c.kind === w.kind && c.pid === w.pid && c.mode === w.mode) {
      if (c.label !== w.label) {
        c.label = w.label;
        this.ui({ kind: 'listen', listen: this.state() });
      }
      return;
    }
    this.pending = this.switchTo(w).finally(() => {
      this.pending = null;
    });
  }

  async switchTo(w) {
    this.capture?.stop();
    this.capture = null;
    this.ears.send('pcm-end');
    if (w.kind === 'app') {
      this.ears.send('stop');
      try {
        const exe = await ensureHelper(this.helperDir, { log: this.log });
        this.startCapture(exe, w);
      } catch (err) {
        this.log(`[listen] ${err.message}; listening to everything instead`);
        this.failedUntil = Date.now() + 10 * 60000;
        return this.switchTo({ kind: 'system', label: 'everything your PC plays' });
      }
    } else if (w.kind === 'system') {
      this.ears.send('start');
    } else {
      this.ears.send('stop');
      this.ears.setStatus?.({ ok: true, label: w.label, rate: 0 });
    }
    this.cur = w;
    this.log(`[listen] ${w.kind === 'none' || w.kind === 'off' ? w.label : `now hearing ${w.label}`}`);
    this.ui({ kind: 'listen', listen: this.state() });
    this.emit('change', this.state());
  }

  startCapture(exe, w) {
    const cap = new AppCapture({ exe, pid: w.pid, mode: w.mode });
    this.capture = cap;
    let batch = [];
    let n = 0;
    cap.on('pcm', (f) => {
      batch.push(f);
      n += f.length;
      if (n < RATE / 25) return; // ~40 ms per message
      const all = new Float32Array(n);
      let o = 0;
      for (const b of batch) {
        all.set(b, o);
        o += b.length;
      }
      batch = [];
      n = 0;
      this.ears.send('pcm', { samples: all.buffer, rate: RATE });
    });
    cap.on('status', (s) => {
      if (s.ok) this.ears.setStatus?.({ ok: true, rate: s.rate, label: w.label });
      else this.log(`[listen] helper: ${s.error}`);
    });
    cap.on('exit', (code) => {
      if (this.capture !== cap) return; // replaced on purpose
      this.capture = null;
      this.cur = null;
      // The app closed (or capture failed): go back to hearing everything for a bit.
      if (code) this.failedUntil = Date.now() + 30000;
      this.log(`[listen] helper stopped (${code})`);
      this.reconcile();
    });
  }
}
