// Push-to-talk recorder with voice activity detection: starts on click, stops
// by itself ~1 s after you finish speaking, returns a 16 kHz mono WAV for Whisper.

const CHUNK = 2048;

export function toWav16k(chunks, rate) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const src = new Float32Array(total);
  let o = 0;
  for (const c of chunks) {
    src.set(c, o);
    o += c.length;
  }
  // Resample to 16 kHz (box filter + linear interpolation is plenty for speech).
  const ratio = rate / 16000;
  const n = Math.floor(src.length / ratio);
  const out = new Float32Array(n);
  const box = Math.max(1, Math.round(ratio));
  for (let i = 0; i < n; i++) {
    const center = i * ratio;
    let acc = 0;
    let cnt = 0;
    for (let k = -Math.floor(box / 2); k <= Math.floor(box / 2); k++) {
      const j = Math.round(center) + k;
      if (j >= 0 && j < src.length) {
        acc += src[j];
        cnt++;
      }
    }
    out[i] = cnt ? acc / cnt : 0;
  }
  // Normalize quiet recordings.
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 0.001 ? Math.min(8, 0.9 / peak) : 1;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (off, s) => [...s].forEach((ch, i) => v.setUint8(off + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true);
  v.setUint32(28, 32000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, out[i] * gain)) * 32767, true);
  return new Uint8Array(buf);
}

export class VoiceRecorder {
  constructor({ onLevel = () => {}, onSpeech = () => {} } = {}) {
    this.onLevel = onLevel;
    this.onSpeech = onSpeech;
    this.active = false;
  }

  /** Resolves with { wav, heardSpeech, seconds } when recording ends. */
  async start({ maxSeconds = 15, silenceSeconds = 1.1, waitSeconds = 7 } = {}) {
    if (this.active) return null;
    this.active = true;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    this.ctx = new AudioContext();
    await this.ctx.audioWorklet.addModule(new URL('./recorder-worklet.js', import.meta.url));
    const src = this.ctx.createMediaStreamSource(this.stream);
    const tap = new AudioWorkletNode(this.ctx, 'pcm-tap');
    const mute = this.ctx.createGain();
    mute.gain.value = 0; // keep the graph running without playing the mic back
    src.connect(tap);
    tap.connect(mute);
    mute.connect(this.ctx.destination);
    const rate = this.ctx.sampleRate;
    const chunkSec = CHUNK / rate;
    const pre = [];
    const kept = [];
    let floor = null;
    let loudRun = 0;
    let quietFor = 0;
    let speaking = false;
    let elapsed = 0;
    return new Promise((resolve) => {
      this.finish = () => {
        if (!this.active) return;
        this.active = false;
        tap.port.onmessage = null;
        this.stream.getTracks().forEach((t) => t.stop());
        this.ctx.close();
        const chunks = speaking ? kept : [];
        resolve({ wav: chunks.length ? toWav16k(chunks, rate) : null, heardSpeech: speaking, seconds: kept.length * chunkSec });
      };
      tap.port.onmessage = ({ data }) => {
        elapsed += chunkSec;
        let s = 0;
        for (const x of data) s += x * x;
        const rms = Math.sqrt(s / data.length);
        if (floor === null) floor = rms;
        const thresh = Math.max(0.012, floor * 2.6);
        this.onLevel(Math.min(1, rms / Math.max(thresh * 3, 0.05)));
        if (!speaking) {
          floor = floor * 0.93 + Math.min(rms, thresh) * 0.07; // adapt to room noise
          pre.push(data);
          if (pre.length > 8) pre.shift(); // ~0.35 s of pre-roll
          loudRun = rms > thresh ? loudRun + 1 : 0;
          if (loudRun >= 2) {
            speaking = true;
            kept.push(...pre);
            this.onSpeech(true);
          } else if (elapsed > waitSeconds) {
            this.finish();
          }
          return;
        }
        kept.push(data);
        quietFor = rms < thresh * 0.8 ? quietFor + chunkSec : 0;
        if (quietFor >= silenceSeconds || kept.length * chunkSec >= maxSeconds) this.finish();
      };
    });
  }

  stop() {
    this.finish?.();
  }
}
