// "Say its name": hands-free voice control. The hidden services window listens to
// the microphone and cuts out short phrases (vad.js); each one is transcribed on
// this PC by whisper, and if it starts with the character's name ("Pixel, open
// Spotify", "hey Pixel") the rest runs as a voice command. Just the name gets a
// "Yes?" and the next phrase counts as the command.
import { EventEmitter } from 'node:events';

const GREETINGS = new Set(['hey', 'hi', 'hello', 'ok', 'okay', 'yo', 'oi', 'hiya', 'heya', 'um', 'uh', 'so', 'and']);
// Things whisper "hears" in near-silence.
const NOISE = /^(?:you|thank you\.?|thanks for watching!?|bye\.?|\.+|okay\.?|uh+|um+|hmm+)$/i;

const letters = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');

function lev(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

const similar = (a, b) => (a && b ? 1 - lev(a, b) / Math.max(a.length, b.length) : 0);

/** Does `heard` sound like `name`? Short names must match exactly; longer ones may be a letter off. */
function soundsLike(heard, name) {
  if (!heard || !name) return false;
  if (heard === name) return true;
  if (name.length > 3 && heard.startsWith(name) && heard.length - name.length <= 2) return true; // "pixels"
  const need = name.length <= 4 ? 1 : name.length <= 5 ? 0.8 : 0.75;
  return similar(heard, name) >= need;
}

const trimPunct = (s) => s.replace(/^[\s,.:;!?\-–]+|[\s,.:;!?\-–]+$/g, '');

/**
 * Is the character being called?
 *   "Pixel, open Spotify" / "hey pixel open spotify" -> { hit: true, rest: 'open Spotify' }
 *   "What time is it, Pixel?"                         -> { hit: true, rest: 'What time is it' }
 *   "Hey Pixel."                                      -> { hit: true, rest: '' }
 */
export function matchName(text, name) {
  const target = letters(name);
  const words = String(text ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!target || !words.length) return { hit: false, rest: '' };
  const nw = Math.max(1, String(name).trim().split(/\s+/).length);
  let i = 0;
  while (i < words.length - 1 && i < 2 && GREETINGS.has(letters(words[i]))) i++;
  // At the start (after a greeting). Whisper sometimes splits a name in two ("Pix el").
  for (const k of [nw, nw + 1]) {
    if (i + k > words.length) continue;
    if (soundsLike(letters(words.slice(i, i + k).join('')), target)) return { hit: true, rest: trimPunct(words.slice(i + k).join(' ')) };
  }
  // At the end, after a comma: "what's the weather, Pixel?"
  const e = words.length - nw;
  if (e > i && /[,]$/.test(words[e - 1]) && soundsLike(letters(words.slice(e).join('')), target)) {
    return { hit: true, rest: trimPunct(words.slice(0, e).join(' ')) };
  }
  return { hit: false, rest: '' };
}

export class WakeWord extends EventEmitter {
  /**
   * @param opts.settings   Settings ("voice.enabled", "voice.wake", "voice.wakeSensitivity")
   * @param opts.ears       the ears extension (send)
   * @param opts.whisper    Whisper (installed, transcribe)
   * @param opts.getName    () => the character's name
   * @param opts.handle     (text) => run a voice command
   * @param opts.onCalled   () => react to just its name ("Yes?")
   * @param opts.paused     () => true while it shouldn't listen (push-to-talk, fullscreen...)
   */
  constructor({ settings, ears, whisper, getName, handle, onCalled = () => {}, paused = () => false, ui = () => {}, log = () => {} }) {
    super();
    Object.assign(this, { settings, ears, whisper, getName, handle, onCalled, paused, ui, log });
    this.on = false;
    this.isPaused = false;
    this.sensitivity = null;
    this.busy = false;
    this.followUntil = 0;
    this.error = null;
  }

  start() {
    this.settings.on('change', () => this.apply());
    this.timer = setInterval(() => this.apply(), 1500);
    this.apply();
  }

  stop() {
    clearInterval(this.timer);
    if (this.on) this.ears.send('wake-stop');
    this.on = false;
  }

  wanted() {
    return this.settings.get('voice.enabled') !== false && !!this.settings.get('voice.wake') && this.whisper.installed() && !!this.getName();
  }

  apply() {
    const on = this.wanted();
    const sens = this.settings.get('voice.wakeSensitivity') ?? 'normal';
    if (on && (!this.on || sens !== this.sensitivity)) this.ears.send('wake-start', { sensitivity: sens });
    if (!on && this.on) this.ears.send('wake-stop');
    if (on !== this.on) this.log(`[wake] ${on ? 'listening for its name' : 'stopped listening for its name'}`);
    this.on = on;
    this.sensitivity = sens;
    const p = on && !!this.paused();
    if (p !== this.isPaused) this.ears.send('wake-pause', p);
    this.isPaused = p;
  }

  state() {
    return { on: this.on, paused: this.isPaused, error: this.error, level: this.level ?? 0 };
  }

  /** A message from the services window: a level, an error, or a phrase to check. */
  async onMessage(m) {
    if (m.level != null) {
      this.level = m.level;
      this.ui({ kind: 'wake', level: m.level });
    }
    if (m.ok === false) {
      this.error = m.error;
      this.log(`[wake] microphone: ${m.error}`);
    } else if (m.ok) this.error = null;
    if (!m.wav || this.isPaused) return;
    if (this.busy) return; // still on the last phrase; this one's dropped
    this.busy = true;
    try {
      const t0 = Date.now();
      const text = await this.whisper.transcribe(Buffer.from(m.wav));
      this.ui({ kind: 'wake', heard: text || '…' });
      this.emit('heard', text);
      if (!text || NOISE.test(text.trim())) return;
      if (Date.now() < this.followUntil) {
        // It just said "Yes?": this phrase is the command.
        this.followUntil = 0;
        const again = matchName(text, this.getName());
        this.log(`[wake] command "${text}" (${Date.now() - t0} ms)`);
        await this.handle(again.hit && again.rest ? again.rest : text);
        return;
      }
      const hit = matchName(text, this.getName());
      if (!hit.hit) return;
      this.log(`[wake] called: "${text}" (${Date.now() - t0} ms)`);
      if (hit.rest) await this.handle(hit.rest);
      else {
        this.followUntil = Date.now() + 8000;
        this.onCalled();
      }
    } catch (err) {
      this.log(`[wake] ${err.message}`);
    } finally {
      this.busy = false;
    }
  }
}
