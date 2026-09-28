import { app } from 'electron';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULTS = {
  scale: 1.4,
  audioReactions: true,
  walkOnWindows: true,
  chattiness: 'normal',
  sleepAfter: 240,
  hotkeys: { chat: 'Control+Alt+C', voice: 'Control+Alt+V', toggle: 'Control+Alt+H' },
  llm: { enabled: true, url: 'http://127.0.0.1:11434', model: 'qwen3:4b-instruct', keepAlive: '15m' },
  voice: { enabled: true },
  speakReplies: false,
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

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }
}
