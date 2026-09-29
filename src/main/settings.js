import { app } from 'electron';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_LOOK } from '../renderer/overlay/look.js';
import { DEFAULT_MOTION } from '../renderer/overlay/motion.js';

export const DEFAULTS = {
  name: '', // the character's name; empty until the user picks one on first run
  look: { ...DEFAULT_LOOK },
  motion: { ...DEFAULT_MOTION },
  scale: 1.4,
  audioReactions: true,
  walkOnWindows: true,
  chattiness: 'normal',
  sleepAfter: 240,
  hotkeys: { chat: 'Control+Alt+C', voice: 'Control+Alt+V', toggle: 'Control+Alt+H' },
  llm: { enabled: true, url: 'http://127.0.0.1:11434', model: 'qwen3:4b-instruct', keepAlive: '15m' },
  // Hearing you: push-to-talk, plus optional hands-free "say my name".
  voice: { enabled: true, wake: false, wakeSensitivity: 'normal', wakeInFullscreen: false },
  // Talking back. mode: off | voice (only after you spoke to it) | always
  speech: { mode: 'off', engine: 'system', voice: '', piperVoice: 'en_US-amy-medium', pitch: 1.35, rate: 1.05, volume: 0.9 },
  // What the ears listen to: everything, everything except voice-chat apps, or
  // (for watch-along) only the app that's playing the video.
  listen: { source: 'all', callApps: 'discord, teams, zoom, slack, skype' },
  focus: {
    work: 25,
    short: 5,
    long: 15,
    longEvery: 4,
    autoContinue: false,
    stretchEvery: 50,
    waterEvery: 90,
    eyeBreaks: false,
    nudge: true,
    distractions: 'youtube, reddit, twitch, netflix, tiktok, instagram, x.com, facebook',
    downloads: true,
    quietHours: false,
    quietFrom: '23:00',
    quietTo: '08:00',
  },
  notify: { enabled: true, style: 'peek', ignore: '', duringFocus: false },
  games: { fetchBest: 0, hideBest: 0, hideSeconds: 60, boxBest: 0 },
  startWithWindows: false,
  createIn: 'desktop',
  personality: 'cheerful',
  watchAlong: true,
  aiDirector: true,
};

function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? merge(base[k], v) : v;
  }
  return out;
}

export class Settings extends EventEmitter {
  constructor(file = path.join(app.getPath('userData'), 'settings.json')) {
    super();
    this.file = file;
    this.data = structuredClone(DEFAULTS);
    try {
      this.data = merge(DEFAULTS, JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch {
      // First run or unreadable file: defaults.
    }
    this.saveTimer = null;
  }

  all() {
    return this.data;
  }

  get(key) {
    return key.split('.').reduce((o, k) => o?.[k], this.data);
  }

  set(key, value) {
    const parts = key.split('.');
    let o = this.data;
    for (const p of parts.slice(0, -1)) o = o[p] ??= {};
    o[parts.at(-1)] = value;
    this.emit('change', key, value);
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 300);
  }

  /** Back to the defaults, keeping the listed keys (e.g. the character's name). */
  reset(keep = ['name']) {
    const kept = Object.fromEntries(keep.map((k) => [k, this.data[k]]));
    this.data = { ...structuredClone(DEFAULTS), ...kept };
    this.emit('change', '*', null);
    this.save();
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  /** Write any pending change now (before quitting). */
  flush() {
    if (this.saveTimer) this.save();
  }
}
