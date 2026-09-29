// The focus buddy: a pomodoro timer the character works alongside (it sits
// with a tiny laptop while you focus), health reminders that only count time
// you're actually at the PC, gentle distraction nudges, and a cheer when a
// download finishes.
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

// Browsers write downloads under a temporary name first, then rename.
const TEMP_DOWNLOAD = /\.(crdownload|part|partial|tmp|download|opdownload|!ut|td|bc!|filepart)$|^~\$|^\.|desktop\.ini$/i;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Is `now` inside quiet hours "HH:MM"-"HH:MM" (which may wrap past midnight)? */
/** 25 -> "25 minutes", 1 -> "1 minute", 0.5 -> "30 seconds". */
export const span = (m) => (m < 1 ? `${Math.round(m * 60)} seconds` : `${Math.round(m * 10) / 10} minute${m === 1 ? '' : 's'}`);

export function inQuietHours(from, to, now = new Date()) {
  const m = (s) => {
    const [h, mm] = String(s ?? '').split(':').map(Number);
    return Number.isFinite(h) ? h * 60 + (mm || 0) : null;
  };
  const a = m(from);
  const b = m(to);
  if (a == null || b == null || a === b) return false;
  const t = now.getHours() * 60 + now.getMinutes();
  return a < b ? t >= a && t < b : t >= a || t < b;
}

export const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export class Focus extends EventEmitter {
  /**
   * @param opts.settings  Settings (reads "focus")
   * @param opts.show      (result) => void    show a bubble (with optional buttons) and maybe speak it
   * @param opts.act       (cmd) => void       send a command to the character (ov:do)
   * @param opts.overlay   (state) => void     tell the overlays the pomodoro state
   * @param opts.ui        (status) => void    Settings window updates
   * @param opts.fullscreen () => boolean
   * @param opts.foreground () => string       "chrome (YouTube - ...)"
   * @param opts.dataDir   where focus-stats.json lives
   * @param opts.downloadsDir
   * @param opts.idleSeconds () => seconds since the last keyboard/mouse input
   * @param opts.shell     { openPath, showItemInFolder }
   */
  constructor({ settings, show, act, overlay, ui = () => {}, fullscreen = () => false, foreground = () => '', dataDir, downloadsDir, idleSeconds = () => 0, shell = null, log = () => {} }) {
    super();
    Object.assign(this, { settings, show, act, overlay, ui, fullscreen, foreground, dataDir, downloadsDir, idleSeconds, shell, log });
    this.state = { phase: 'idle', endsAt: 0, total: 0, paused: false, left: 0, round: 0 };
    this.active = { stretch: 0, water: 0, eyes: 0 };
    this.lastNudge = 0;
    this.statsFile = path.join(dataDir, 'focus-stats.json');
    this.seenDownloads = new Map();
  }

  get cfg() {
    return this.settings.get('focus') ?? {};
  }

  quiet() {
    const f = this.cfg;
    return !!f.quietHours && inQuietHours(f.quietFrom, f.quietTo);
  }

  start() {
    this.tickTimer = setInterval(() => this.tick(), 1000);
    this.careTimer = setInterval(() => this.care(30), 30000);
    this.watchDownloads();
  }

  stop() {
    clearInterval(this.tickTimer);
    clearInterval(this.careTimer);
    this.dlWatcher?.close();
  }

  // ---- pomodoro --------------------------------------------------------------------------

  remaining() {
    const s = this.state;
    if (s.phase === 'idle') return 0;
    return s.paused ? s.left : Math.max(0, s.endsAt - Date.now());
  }

  publicState() {
    const s = this.state;
    return { phase: s.phase, remaining: this.remaining(), total: s.total, paused: s.paused, endsAt: s.paused ? 0 : s.endsAt, round: s.round };
  }

  broadcast(changed) {
    const st = this.publicState();
    this.ui({ kind: 'focus', focus: st, stats: this.stats(), changed });
    if (changed) this.overlay(st);
    this.emit('change', st, changed);
  }

  enter(phase, minutes) {
    const total = Math.round(minutes * 60000);
    this.state = { ...this.state, phase, total, endsAt: Date.now() + total, paused: false, left: 0, celebrating: false };
    this.broadcast(true);
  }

  startFocus(minutes = this.cfg.work ?? 25) {
    this.enter('focus', minutes);
    this.lastNudge = Date.now();
    this.act({ name: 'work' });
    const len = span(minutes);
    this.show({ ok: true, say: pick([`Focus time! ${len}. I’ll work right here with you. 🍅`, `Let’s do this: ${len} of focus. 🍅`, `Heads down for ${len}. I’ve got my laptop too! 💻`]), mood: 'happy' });
    return this.publicState();
  }

  startBreak(long = false) {
    const f = this.cfg;
    this.enter(long ? 'long' : 'short', long ? f.long ?? 15 : f.short ?? 5);
    this.act({ name: 'routine', steps: ['stretch', 'spin', 'jump', 'stretch'] });
    this.show({ ok: true, say: long ? `🌴 Long break! ${span(f.long ?? 15)}. Stretch, walk around, grab a snack.` : `☕ Break time! ${span(f.short ?? 5)}. Stretch with me!`, mood: 'happy' });
  }

  pause() {
    if (this.state.phase === 'idle' || this.state.paused) return this.publicState();
    this.state = { ...this.state, paused: true, left: this.remaining() };
    this.broadcast(true);
    return this.publicState();
  }

  resume() {
    if (!this.state.paused) return this.publicState();
    this.state = { ...this.state, paused: false, endsAt: Date.now() + this.state.left };
    this.broadcast(true);
    return this.publicState();
  }

  /** Stop the timer. */
  end({ quietly = false } = {}) {
    const was = this.state.phase;
    this.state = { ...this.state, phase: 'idle', endsAt: 0, total: 0, paused: false, left: 0, round: 0, celebrating: false };
    this.broadcast(true);
    if (!quietly && was !== 'idle') this.show({ ok: true, say: 'Timer stopped. Nice work today!', mood: 'normal' });
    return this.publicState();
  }

  /** Jump to the next phase (a skipped focus session doesn't count). */
  skip() {
    if (this.state.phase === 'focus') this.startBreak(false);
    else if (this.state.phase !== 'idle') this.startFocus();
    return this.publicState();
  }

  tick() {
    const s = this.state;
    if (s.phase === 'idle' || s.paused || s.celebrating) return;
    if (this.remaining() > 0) {
      this.broadcast(false);
      if (s.phase === 'focus') this.nudge();
      return;
    }
    if (s.phase === 'focus') {
      const f = this.cfg;
      const round = s.round + 1;
      const long = round % (f.longEvery ?? 4) === 0;
      const stats = this.record(Math.round(s.total / 60000));
      this.state = { ...this.state, round, celebrating: true };
      this.act({ name: 'celebrate' });
      this.show({ ok: true, say: `🍅 Done! That’s ${stats.today} session${stats.today === 1 ? '' : 's'} today. ${long ? 'You earned a long break!' : 'Break time!'}`, mood: 'success' });
      // Let it celebrate for a moment, then the break starts (unless the timer was stopped).
      setTimeout(() => {
        if (this.state.celebrating) this.startBreak(long);
      }, 2500);
      return;
    }
    // A break just ended.
    if (this.cfg.autoContinue) {
      this.startFocus();
    } else {
      this.state = { ...this.state, phase: 'idle', endsAt: 0, total: 0 };
      this.broadcast(true);
      this.act({ name: 'wave' });
      this.show({ ok: true, say: 'Break’s over! Ready for another round?', mood: 'happy', dur: 60, buttons: [{ label: 'Start 🍅', run: () => (this.startFocus(), null) }, { label: 'Not now', run: () => ({ ok: true, say: 'Okay! I’ll be around.', mood: 'normal' }) }] });
    }
  }

  nudge() {
    const f = this.cfg;
    if (f.nudge === false || Date.now() - this.lastNudge < 5 * 60000) return;
    const words = String(f.distractions ?? '')
      .split(',')
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);
    const fg = this.foreground().toLowerCase();
    const hit = words.find((w) => fg.includes(w));
    if (!hit) return;
    this.lastNudge = Date.now();
    const left = Math.max(1, Math.round(this.remaining() / 60000));
    this.act({ name: 'wave' });
    this.show({ ok: true, say: pick([`Psst… ${left} more minute${left === 1 ? '' : 's'} of focus, then ${hit} is all yours. 🍅`, `Hey, focus time! Only ${left} minute${left === 1 ? '' : 's'} to go. You’ve got this!`, `Caught you! 👀 ${left} minute${left === 1 ? '' : 's'} left in this session.`]), mood: 'normal' });
  }

  // ---- stats ---------------------------------------------------------------------------------

  readStats() {
    try {
      return JSON.parse(fs.readFileSync(this.statsFile, 'utf8'));
    } catch {
      return { days: {}, total: 0 };
    }
  }

  record(minutes) {
    const data = this.readStats();
    const d = (data.days[localDay()] ??= { sessions: 0, minutes: 0 });
    d.sessions++;
    d.minutes += minutes;
    data.total = (data.total ?? 0) + 1;
    // Keep a year of history.
    for (const k of Object.keys(data.days).sort().slice(0, -366)) delete data.days[k];
    fs.mkdirSync(path.dirname(this.statsFile), { recursive: true });
    fs.writeFileSync(this.statsFile, JSON.stringify(data, null, 2));
    return this.stats();
  }

  stats() {
    const data = this.readStats();
    const d = data.days[localDay()] ?? { sessions: 0, minutes: 0 };
    return { today: d.sessions, minutes: d.minutes, total: data.total ?? 0 };
  }

  // ---- taking care of you ----------------------------------------------------------------

  /** Every 30 s: count time actually at the PC, and remind when it's time. */
  care(secs, idle = this.idleSeconds()) {
    if (idle > 300) {
      // Away for 5+ minutes: that was a break, start counting again.
      this.active = { stretch: 0, water: 0, eyes: 0 };
      return null;
    }
    if (idle < 60) for (const k of Object.keys(this.active)) this.active[k] += secs;
    if (this.quiet() || this.fullscreen() || this.state.phase === 'focus' || this.busy?.()) return null;
    const f = this.cfg;
    if (f.eyeBreaks && this.active.eyes >= 20 * 60) {
      this.active.eyes = 0;
      this.act({ name: 'react', kind: 'gaze', dur: 20 });
      this.show({ ok: true, say: '👀 Eye break! Look at something far away for 20 seconds.', mood: 'normal', dur: 20 });
      setTimeout(() => this.show({ ok: true, say: 'Ahh, much better. 😌', mood: 'happy' }), 21000);
      return 'eyes';
    }
    if (f.stretchEvery > 0 && this.active.stretch >= f.stretchEvery * 60) {
      this.active.stretch = 0;
      this.act({ name: 'routine', steps: ['stretch', 'spin', 'stretch', 'jump'] });
      this.show({ ok: true, say: pick(['Stretch break! Reach for the sky with me. 🙆', 'You’ve been at it a while. Stand up and stretch with me!', 'Time to wiggle! Shoulders, neck, back. 🙆']), mood: 'happy' });
      return 'stretch';
    }
    if (f.waterEvery > 0 && this.active.water >= f.waterEvery * 60) {
      this.active.water = 0;
      this.act({ name: 'wave' });
      this.show({ ok: true, say: pick(['💧 Water break! Grab a sip.', 'Hydration check! 💧 When did you last drink some water?', 'Psst… your water bottle misses you. 💧']), mood: 'normal' });
      return 'water';
    }
    return null;
  }

  // ---- downloads -------------------------------------------------------------------------------

  watchDownloads() {
    if (!this.downloadsDir || !fs.existsSync(this.downloadsDir)) return;
    try {
      this.dlWatcher = fs.watch(this.downloadsDir, (_event, name) => name && this.maybeDownload(String(name)));
    } catch (err) {
      this.log(`[focus] can't watch downloads: ${err.message}`);
    }
  }

  maybeDownload(name) {
    if (TEMP_DOWNLOAD.test(name) || this.cfg.downloads === false) return;
    clearTimeout(this.seenDownloads.get(name)?.timer);
    const entry = { timer: null, done: this.seenDownloads.get(name)?.done };
    // Wait until the file has stopped changing, then celebrate once.
    const check = (lastSize) => {
      const file = path.join(this.downloadsDir, name);
      let st;
      try {
        st = fs.statSync(file);
      } catch {
        return;
      }
      if (!st.isFile() || st.size === 0 || Date.now() - st.mtimeMs > 120000) return;
      if (st.size !== lastSize) {
        entry.timer = setTimeout(() => check(st.size), 1500);
        return;
      }
      if (entry.done === st.mtimeMs) return;
      entry.done = st.mtimeMs;
      this.finishedDownload(file);
    };
    entry.timer = setTimeout(() => check(-1), 1200);
    this.seenDownloads.set(name, entry);
    if (this.seenDownloads.size > 200) this.seenDownloads.delete(this.seenDownloads.keys().next().value);
  }

  finishedDownload(file) {
    if (this.quiet()) return;
    const name = path.basename(file);
    this.log(`[focus] download finished: ${name}`);
    this.emit('download', file);
    if (this.fullscreen()) return;
    this.act({ name: 'celebrate' });
    this.show({
      ok: true,
      say: pick([`📥 Your download finished: “${name}”`, `Ding! “${name}” just landed in Downloads. 📥`, `Special delivery! 📦 “${name}” is ready.`]),
      mood: 'success',
      dur: 12,
      buttons: [
        { label: 'Open', run: () => (this.shell?.openPath(file), null) },
        { label: 'Show in folder', run: () => (this.shell?.showItemInFolder(file), null) },
      ],
    });
  }
}
