// Finds where someone starts and stops talking in a microphone stream: loudness
// against a noise floor that adapts to the room. Only short phrases come out
// (a wake word plus a command); long stretches of talking, like a voice call,
// are skipped so the speech engine isn't kept busy. Pure, so it's unit-tested.

const PRESETS = {
  relaxed: { k: 4, min: 0.012 },
  normal: { k: 3, min: 0.007 },
  eager: { k: 2.2, min: 0.004 },
};

export class Vad {
  /**
   * @param rate            sample rate of what gets pushed
   * @param opts.sensitivity 'relaxed' | 'normal' | 'eager'
   */
  constructor(rate, { sensitivity = 'normal', frameMs = 20, preMs = 300, hangMs = 550, minMs = 300, maxMs = 6000 } = {}) {
    this.rate = rate;
    this.frame = Math.round((rate * frameMs) / 1000);
    this.p = PRESETS[sensitivity] ?? PRESETS.normal;
    this.preFrames = Math.ceil(preMs / frameMs);
    this.hang = Math.ceil(hangMs / frameMs);
    this.minVoiced = Math.ceil(minMs / frameMs);
    this.maxFrames = Math.ceil(maxMs / frameMs);
    this.floor = 0.002;
    this.buf = new Float32Array(this.frame);
    this.bn = 0;
    this.pre = [];
    this.state = 'idle';
    this.run = 0;
    this.quiet = 0;
    this.voiced = 0;
    this.frames = [];
    this.overlong = false;
    this.level = 0; // loudness relative to the "that's speech" threshold (1 = right at it)
  }

  setSensitivity(s) {
    this.p = PRESETS[s] ?? PRESETS.normal;
  }

  threshold() {
    return Math.max(this.floor * this.p.k, this.p.min);
  }

  /**
   * Feed samples. Returns finished phrases: [{ samples: Float32Array, secs }].
   * @param opts.mute  treat this audio as silence (while it's talking itself)
   */
  push(data, { mute = false } = {}) {
    const out = [];
    for (let i = 0; i < data.length; i++) {
      this.buf[this.bn++] = mute ? 0 : data[i];
      if (this.bn === this.frame) {
        const u = this.onFrame(this.buf.slice(0));
        if (u) out.push(u);
        this.bn = 0;
      }
    }
    return out;
  }

  onFrame(f) {
    let sq = 0;
    for (const v of f) sq += v * v;
    const r = Math.sqrt(sq / f.length);
    const thr = this.threshold();
    this.level = r / thr;
    if (this.state === 'idle') {
      // The noise floor follows quiet quickly and loud slowly (a burst of speech barely moves it).
      this.floor = Math.max(0.0003, this.floor + (r - this.floor) * (r < this.floor ? 0.2 : 0.01));
      this.pre.push(f);
      if (this.pre.length > this.preFrames) this.pre.shift();
      this.run = r > thr ? this.run + 1 : 0;
      if (this.run >= 3) {
        this.state = 'speech';
        this.frames = this.pre;
        this.pre = [];
        this.voiced = this.run;
        this.quiet = 0;
        this.overlong = false;
      }
      return null;
    }
    if (!this.overlong) this.frames.push(f);
    if (r > thr * 0.7) {
      this.quiet = 0;
      this.voiced++;
    } else this.quiet++;
    if (!this.overlong && this.frames.length > this.maxFrames) {
      // Too long for "Pixel, open Spotify": probably a conversation. Skip to the next pause.
      this.overlong = true;
      this.frames = [];
    }
    if (this.quiet < this.hang) return null;
    const done = !this.overlong && this.voiced >= this.minVoiced ? this.frames : null;
    this.state = 'idle';
    this.frames = [];
    this.run = 0;
    this.overlong = false;
    if (!done) return null;
    const keep = done.length - this.quiet + Math.min(this.quiet, 8); // drop most of the trailing silence
    const samples = new Float32Array(keep * this.frame);
    for (let i = 0; i < keep; i++) samples.set(done[i], i * this.frame);
    return { samples, secs: samples.length / this.rate };
  }
}
