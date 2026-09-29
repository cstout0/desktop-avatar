// Talking back: reads the character's lines out loud with a voice on this PC.
//  - "system": a Windows voice, spoken by the hidden services window (speechSynthesis).
//  - "piper":  a natural neural voice (Piper) rendered here; the WAV plays in the
//              services window, which reports loudness so the mouth moves with it.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { ipcMain } from 'electron';
import { PIPER_VOICES, installPiper, piperExe, piperInstalled, piperVoiceFile, piperVoiceInstalled } from './installers.js';

/** Make a speech-bubble line sayable: no emoji, markdown or raw links. */
export function speakable(text) {
  return String(text ?? '')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}️‍⃣]/gu, '')
    .replace(/[•·]/g, ', ')
    .replace(/[*_#`~<>|]/g, ' ')
    .replace(/\s*\n+\s*/g, '. ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/^[\s,.]+|[\s,]+$/g, '')
    .slice(0, 400);
}

/** Rough speaking time, for mouth animation before the real "end" arrives. */
export function estimateMs(text, rate = 1) {
  return Math.round((350 + text.length * 62) / Math.max(0.3, rate));
}

function wavFromPcm16(pcm, sampleRate) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export class Speech {
  /**
   * @param opts.settings  Settings (reads "speech")
   * @param opts.piperDir  where Piper and its voices are (vendor/piper)
   * @param opts.send      (channel, data) => void   to the services window ("speak", "play", "shush")
   * @param opts.onTalk    ({ on, ms, level }) => void   mouth animation
   * @param opts.ui        (status) => void   progress for the Settings window
   */
  constructor({ settings, piperDir, send, onTalk = () => {}, ui = () => {} }) {
    Object.assign(this, { settings, piperDir, send, onTalk, ui });
    this.seq = 0;
    this.current = 0;
    this.talking = false;
    this.sampleRates = new Map();
    ipcMain.on('svc:speech', (_e, m) => {
      if (m.id !== this.current) return;
      if (m.event === 'start') this.setTalking(true, m.ms);
      else if (m.event === 'end') this.setTalking(false);
      else if (m.event === 'level') this.onTalk({ on: true, level: m.level });
    });
  }

  get cfg() {
    return this.settings.get('speech') ?? {};
  }

  setTalking(on, ms) {
    this.talking = on;
    this.onTalk({ on, ms });
    this.ui({ kind: 'speaking', on, ms });
  }

  /** Should a line from `source` be spoken? voice = only replies to things you said out loud. */
  wants(source) {
    const mode = this.cfg.mode ?? 'off';
    if (mode === 'always') return true;
    if (mode === 'voice') return source === 'voice';
    return false;
  }

  piperReady(voice = this.cfg.piperVoice) {
    return piperInstalled(this.piperDir) && piperVoiceInstalled(this.piperDir, voice);
  }

  /**
   * Say a line (if the settings allow it for this source).
   * @returns {Promise<{ id, ms, engine } | null>}
   */
  async say(text, { source = 'app', force = false } = {}) {
    if (!force && !this.wants(source)) return null;
    const line = speakable(text);
    if (!line) return null;
    const cfg = this.cfg;
    const id = ++this.seq;
    this.current = id;
    if (cfg.engine === 'piper' && this.piperReady()) {
      try {
        const wav = await this.renderPiper(line, cfg);
        if (this.current !== id) return null; // something newer started meanwhile
        this.send('play', { id, wav, rate: cfg.pitch ?? 1, volume: cfg.volume ?? 0.9 });
        return { id, ms: Math.round(((wav.length - 44) / 2 / this.sampleRate(cfg.piperVoice)) * 1000 / (cfg.pitch ?? 1)), engine: 'piper' };
      } catch (err) {
        console.log(`[speech] Piper failed (${err.message}); using the Windows voice`);
      }
    }
    this.send('speak', { id, text: line, voice: cfg.voice || '', pitch: cfg.pitch ?? 1.35, rate: cfg.rate ?? 1.05, volume: cfg.volume ?? 0.9 });
    return { id, ms: estimateMs(line, cfg.rate ?? 1.05), engine: 'system' };
  }

  /** Stop talking now (e.g. the user started speaking). */
  shush() {
    this.current = ++this.seq;
    this.send('shush', {});
    if (this.talking) this.setTalking(false);
  }

  sampleRate(voice) {
    if (!this.sampleRates.has(voice)) {
      let rate = 22050;
      try {
        rate = JSON.parse(fs.readFileSync(`${piperVoiceFile(this.piperDir, voice)}.json`, 'utf8')).audio?.sample_rate ?? rate;
      } catch {
        /* default */
      }
      this.sampleRates.set(voice, rate);
    }
    return this.sampleRates.get(voice);
  }

  /** Piper -> 16-bit mono WAV. Pitch is applied at playback, so slow the speech to compensate. */
  renderPiper(line, cfg) {
    const exe = piperExe(this.piperDir);
    const model = piperVoiceFile(this.piperDir, cfg.piperVoice);
    const lengthScale = Math.min(2.5, Math.max(0.4, (cfg.pitch ?? 1) / (cfg.rate ?? 1)));
    return new Promise((resolve, reject) => {
      const p = spawn(exe, ['--model', model, '--output_raw', '--length_scale', lengthScale.toFixed(3), '--sentence_silence', '0.12'], { windowsHide: true, cwd: this.piperDir });
      const chunks = [];
      const errs = [];
      p.stdout.on('data', (d) => chunks.push(d));
      p.stderr.on('data', (d) => errs.push(d));
      p.on('error', reject);
      p.on('close', (code) => {
        const pcm = Buffer.concat(chunks);
        if (code === 0 && pcm.length > 1000) resolve(wavFromPcm16(pcm, this.sampleRate(cfg.piperVoice)));
        else reject(new Error(`piper exited with ${code}: ${Buffer.concat(errs).toString().trim().split('\n').pop()}`));
      });
      p.stdin.end(`${line}\n`);
    });
  }

  meta() {
    return {
      piper: {
        installed: piperInstalled(this.piperDir),
        voices: PIPER_VOICES.map((v) => ({ id: v.id, label: v.label, installed: piperVoiceInstalled(this.piperDir, v.id) })),
      },
    };
  }

  async installPiper(voice) {
    await installPiper(this.piperDir, { voice, onProgress: (pct) => this.ui({ kind: 'download', id: 'piper', pct }), log: (m) => console.log(`[speech] ${m}`) });
    return { ok: true };
  }
}
