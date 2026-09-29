// The character's ears: analyzes what the PC is playing (system audio loopback, which
// never leaves this machine) and streams compact features to the main process.
import { MusicAnalyzer } from './analyzer.js';
import { Vad } from './vad.js';
import { toWav16k } from '../chat/recorder.js';
import { drawThumb } from '../settings/thumbs.js';

const api = window.services;
let analyzer = null;
let ctx = null;
let stream = null;
let lastSent = 0;
let running = false;
let injected = null;
let clip = null; // { id, need, got, chunks, rate, sq }
let selfUntil = 0; // while the character itself is talking (plus a moment), ignore what we hear

const hearingSelf = () => performance.now() < selfUntil;

/** Collect a few seconds of what's playing for the watch-along transcript. */
function feedClip(data, rate) {
  if (!clip) return;
  if (hearingSelf()) data = new Float32Array(data.length); // keep its own voice out of the transcript
  clip.rate ??= rate;
  clip.chunks.push(data.slice(0));
  clip.got += data.length;
  for (const v of data) clip.sq += v * v;
  if (clip.got >= clip.need * clip.rate) {
    const rms = Math.sqrt(clip.sq / clip.got);
    const wav = rms > 0.003 ? toWav16k(clip.chunks, clip.rate) : null;
    api.send('clip', { id: clip.id, wav, rms });
    clip = null;
  }
}

api.on('capture', ({ id, secs }) => {
  clip = { id, need: secs, got: 0, chunks: [], rate: null, sq: 0 };
});

function handleFrames(frames) {
  const self = hearingSelf();
  for (const f of frames) {
    const now = performance.now();
    if (self) {
      // Its own voice isn't music, and shouldn't startle it.
      f.loud = false;
      f.beat = false;
    }
    // Beats and bangs go out immediately; the rest ~20 times a second.
    if (f.beat || f.loud || now - lastSent > 50) {
      lastSent = now;
      api.send('audio', {
        energy: f.energy,
        rms: f.rms,
        bass: f.bands.bass,
        music: f.music,
        bpm: f.music ? f.bpm : 0,
        phase: f.phase,
        beat: f.music && f.beat,
        beatStrength: f.beatStrength,
        loud: f.loud,
        tempoConf: f.tempoConf,
      });
    }
  }
}

async function start() {
  if (running) return;
  running = true;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    stream.getVideoTracks().forEach((t) => t.stop()); // we only want the sound
    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error('no system audio track');
    ctx = new AudioContext();
    await ctx.audioWorklet.addModule(new URL('../chat/recorder-worklet.js', import.meta.url));
    const src = ctx.createMediaStreamSource(new MediaStream([track]));
    const tap = new AudioWorkletNode(ctx, 'pcm-tap');
    const mute = ctx.createGain();
    mute.gain.value = 0;
    src.connect(tap);
    tap.connect(mute);
    mute.connect(ctx.destination);
    analyzer = new MusicAnalyzer(ctx.sampleRate);
    tap.port.onmessage = ({ data }) => {
      if (injected) return;
      handleFrames(analyzer.push(data));
      feedClip(data, ctx.sampleRate);
    };
    track.addEventListener('ended', () => {
      running = false;
      api.send('status', { ok: false, error: 'system audio capture ended' });
    });
    api.send('status', { ok: true, rate: ctx.sampleRate, label: track.label });
  } catch (err) {
    running = false;
    api.send('status', { ok: false, error: String(err?.message ?? err) });
  }
}

function stop() {
  running = false;
  stream?.getTracks().forEach((t) => t.stop());
  ctx?.close();
  stream = null;
  ctx = null;
}

api.on('start', start);
api.on('stop', stop);

// Just one app (or everything but one): PCM from the per-app capture helper, via main.
let appAnalyzer = null;
api.on('pcm', ({ samples, rate }) => {
  if (injected) return;
  appAnalyzer ??= new MusicAnalyzer(rate);
  const data = new Float32Array(samples);
  handleFrames(appAnalyzer.push(data));
  feedClip(data, rate);
});
api.on('pcm-end', () => {
  appAnalyzer = null;
});

// Test hook: feed synthetic PCM instead of the loopback (so tests stay silent).
api.on('inject', ({ samples, rate }) => {
  injected ??= new MusicAnalyzer(rate);
  const data = new Float32Array(samples);
  handleFrames(injected.push(data));
  feedClip(data, rate);
});
api.on('inject-end', () => {
  injected = null;
});

// ---- hands-free: listening for its name -------------------------------------------------------

let wake = null; // { stream, ctx, vad, lastLevel }
let wakePaused = false;
let wakeSens = 'normal';

async function wakeStart({ sensitivity = 'normal' } = {}) {
  wakeSens = sensitivity;
  if (wake) {
    wake.vad?.setSensitivity(sensitivity); // (still starting up: picked up below)
    return;
  }
  wake = { starting: true };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const wctx = new AudioContext();
    await wctx.audioWorklet.addModule(new URL('../chat/recorder-worklet.js', import.meta.url));
    const src = wctx.createMediaStreamSource(stream);
    const tap = new AudioWorkletNode(wctx, 'pcm-tap');
    const mute = wctx.createGain();
    mute.gain.value = 0;
    src.connect(tap);
    tap.connect(mute);
    mute.connect(wctx.destination);
    const vad = new Vad(wctx.sampleRate, { sensitivity: wakeSens });
    if (!wake) {
      // Stopped while the microphone was starting up.
      stream.getTracks().forEach((t) => t.stop());
      wctx.close();
      return;
    }
    wake = { stream, ctx: wctx, vad, lastLevel: 0 };
    tap.port.onmessage = ({ data }) => {
      // Its own voice (and push-to-talk) never counts.
      const phrases = vad.push(data, { mute: wakePaused || hearingSelf() });
      const now = performance.now();
      if (now - wake.lastLevel > 100) {
        wake.lastLevel = now;
        api.send('wake', { level: Math.round(vad.level * 100) / 100 });
      }
      for (const p of phrases) api.send('wake', { wav: toWav16k([p.samples], wctx.sampleRate), secs: p.secs });
    };
    api.send('wake', { ok: true, label: stream.getAudioTracks()[0]?.label ?? 'microphone' });
  } catch (err) {
    wake = null;
    api.send('wake', { ok: false, error: String(err?.message ?? err) });
  }
}

function wakeStop() {
  wake?.stream?.getTracks().forEach((t) => t.stop());
  wake?.ctx?.close();
  wake = null;
}

api.on('wake-start', wakeStart);
api.on('wake-stop', wakeStop);
api.on('wake-pause', (on) => {
  wakePaused = !!on;
});

// ---- talking back ----------------------------------------------------------------------------

let current = null; // { id, stop }

function shush() {
  window.speechSynthesis.cancel();
  current?.stop?.();
  current = null;
}

// A Windows voice via the speech synthesis API. Word boundaries keep the mouth moving.
api.on('speak', ({ id, text, voice, pitch, rate, volume }) => {
  shush();
  const u = new SpeechSynthesisUtterance(text);
  const v = window.speechSynthesis.getVoices().find((x) => x.name === voice);
  if (v) u.voice = v;
  u.pitch = Math.min(2, Math.max(0, pitch));
  u.rate = Math.min(3, Math.max(0.3, rate));
  u.volume = Math.min(1, Math.max(0, volume));
  const done = () => {
    selfUntil = performance.now() + 500;
    if (current?.id === id) current = null;
    api.send('speech', { id, event: 'end' });
  };
  u.onstart = () => {
    selfUntil = performance.now() + 60000;
    api.send('speech', { id, event: 'start' });
  };
  u.onend = done;
  u.onerror = done;
  current = { id, stop: () => {} };
  window.speechSynthesis.speak(u);
});

// A rendered WAV (Piper). Loudness drives the mouth; playbackRate raises the pitch.
let playCtx = null;
api.on('play', async ({ id, wav, rate, volume }) => {
  shush();
  playCtx ??= new AudioContext();
  const buf = await playCtx.decodeAudioData(new Uint8Array(wav).buffer);
  const src = playCtx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const gain = playCtx.createGain();
  gain.gain.value = volume;
  const an = playCtx.createAnalyser();
  an.fftSize = 1024;
  src.connect(gain);
  gain.connect(an);
  an.connect(playCtx.destination);
  const samples = new Float32Array(an.fftSize);
  const meter = setInterval(() => {
    an.getFloatTimeDomainData(samples);
    let s = 0;
    for (const x of samples) s += x * x;
    api.send('speech', { id, event: 'level', level: Math.min(1, Math.sqrt(s / samples.length) * 6) });
  }, 60);
  const finish = () => {
    clearInterval(meter);
    selfUntil = performance.now() + 500;
    if (current?.id === id) current = null;
    api.send('speech', { id, event: 'end' });
  };
  src.onended = finish;
  current = {
    id,
    stop: () => {
      src.onended = null;
      try {
        src.stop();
      } catch {
        /* not started */
      }
      finish();
    },
  };
  selfUntil = performance.now() + 60000;
  src.start();
  api.send('speech', { id, event: 'start', ms: Math.round((buf.duration / rate) * 1000) });
});

api.on('shush', shush);

// ---- icons ------------------------------------------------------------------------------------

/** Tray/window icons of its head in the current look, as PNG data URLs by size. Called from main. */
window.__renderIcons = (look, sizes = [16, 20, 24, 32, 48, 64, 256]) => {
  const face = { eyes: 'happy', mouth: 'smile' };
  const draw = (crop) => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    drawThumb(c, look, { crop, face });
    return c;
  };
  const shrink = (src, n) => {
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, n, n);
    return c.toDataURL('image/png');
  };
  // Tiny icons: just the face, so it's recognizable at 16 px. The chat corner has room for the hat.
  const tight = draw('icon');
  const out = {};
  for (const n of sizes) out[n] = shrink(tight, n);
  out.face = shrink(draw('bust'), 64);
  return out;
};
