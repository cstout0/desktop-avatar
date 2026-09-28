// Claude's ears: analyzes what the PC is playing (system audio loopback, which
// never leaves this machine) and streams compact features to the main process.
import { MusicAnalyzer } from './analyzer.js';
import { toWav16k } from '../chat/recorder.js';

const api = window.services;
let analyzer = null;
let ctx = null;
let stream = null;
let lastSent = 0;
let running = false;
let injected = null;
let clip = null; // { id, need, got, chunks, rate, sq }

/** Collect a few seconds of what's playing for the watch-along transcript. */
function feedClip(data, rate) {
  if (!clip) return;
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
  for (const f of frames) {
    const now = performance.now();
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
