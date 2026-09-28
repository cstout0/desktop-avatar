import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MusicAnalyzer } from '../src/renderer/services/analyzer.js';

const SR = 48000;

function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A simple drum loop: kick on 1&3, snare on 2&4, hats on 8ths, plus a bassline. */
function drumLoop(bpm, secs, seed = 1) {
  const r = rng(seed);
  const n = Math.round(secs * SR);
  const out = new Float32Array(n);
  const beat = 60 / bpm;
  const kicks = [];
  for (let b = 0; b * beat < secs; b++) {
    const t0 = b * beat;
    const i0 = Math.round(t0 * SR);
    if (b % 2 === 0) {
      kicks.push(t0);
      for (let i = 0; i < SR * 0.18 && i0 + i < n; i++) {
        const t = i / SR;
        const f = 45 + 70 * Math.exp(-t * 30);
        out[i0 + i] += 0.7 * Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 18);
      }
    } else {
      kicks.push(t0);
      for (let i = 0; i < SR * 0.12 && i0 + i < n; i++) out[i0 + i] += 0.3 * (r() * 2 - 1) * Math.exp((-i / SR) * 30);
    }
    for (const half of [0, 0.5]) {
      const j0 = Math.round((t0 + half * beat) * SR);
      let prev = 0;
      for (let i = 0; i < SR * 0.03 && j0 + i < n; i++) {
        const w = r() * 2 - 1;
        out[j0 + i] += 0.08 * (w - prev) * Math.exp((-i / SR) * 120);
        prev = w;
      }
    }
    const note = [55, 55, 73.4, 65.4][b % 4];
    for (let i = 0; i < beat * SR * 0.9 && i0 + i < n; i++) {
      const t = i / SR;
      out[i0 + i] += 0.15 * Math.sin(2 * Math.PI * note * t) * Math.min(1, t * 40) * Math.exp(-t * 3);
    }
  }
  return { samples: out, kicks };
}

function speechLike(secs, seed = 7) {
  const r = rng(seed);
  const out = new Float32Array(Math.round(secs * SR));
  let t = 0.2;
  while (t < secs - 0.3) {
    const dur = 0.08 + r() * 0.2;
    const amp = 0.05 + r() * 0.12;
    const f0 = 110 + r() * 90;
    const i0 = Math.round(t * SR);
    for (let i = 0; i < dur * SR && i0 + i < out.length; i++) {
      const tt = i / SR;
      const env = Math.sin((Math.PI * tt) / dur);
      out[i0 + i] += amp * env * (0.6 * Math.sin(2 * Math.PI * f0 * tt) + 0.3 * Math.sin(2 * Math.PI * f0 * 2.1 * tt) + 0.15 * (r() * 2 - 1));
    }
    t += dur + 0.04 + r() * 0.45;
  }
  return out;
}

function run(samples) {
  const a = new MusicAnalyzer(SR);
  const frames = [];
  for (let i = 0; i < samples.length; i += 4800) frames.push(...a.push(samples.subarray(i, Math.min(samples.length, i + 4800))));
  return { a, frames };
}

test('silence: no music, no beats, no bangs', () => {
  const { frames } = run(new Float32Array(SR * 6));
  assert.ok(!frames.some((f) => f.music || f.beat || f.loud));
});

for (const bpm of [95, 120, 140]) {
  test(`drum loop at ${bpm} BPM is recognized as music with the right tempo`, () => {
    const { samples } = drumLoop(bpm, 12);
    const { frames, a } = run(samples);
    const firstMusic = frames.find((f) => f.music);
    assert.ok(firstMusic, 'music detected');
    assert.ok(firstMusic.t < 7, `music detected within 7 s (at ${firstMusic.t.toFixed(1)} s)`);
    assert.ok(Math.abs(a.bpm - bpm) / bpm < 0.03, `tempo ${a.bpm.toFixed(1)} vs ${bpm}`);
    const lastBeats = frames.filter((f) => f.beat && f.t > 8);
    const expected = ((12 - 8) * bpm) / 60;
    assert.ok(Math.abs(lastBeats.length - expected) <= 1.5, `${lastBeats.length} beats in the last 4 s, expected ~${expected.toFixed(1)}`);
  });
}

test('kick + snare only (no hi-hats) still gets the right tempo', async () => {
  const { synthLoop } = await import('../src/renderer/services/synth.js');
  const pcm = synthLoop(120, 12, SR);
  const { frames, a } = run(pcm);
  assert.ok(frames.some((f) => f.music), 'music detected');
  assert.ok(Math.abs(a.bpm - 120) < 3, `tempo ${a.bpm.toFixed(1)}`);
  const first = frames.find((f) => f.music);
  assert.ok(first.t < 5.5, `detected at ${first.t.toFixed(1)} s`);
});

test('beats land on the drum hits once locked in', () => {
  const { samples, kicks } = drumLoop(120, 14, 3);
  const { frames } = run(samples);
  const beats = frames.filter((f) => f.beat && f.t > 7).map((f) => f.t);
  assert.ok(beats.length >= 10);
  // Frame times mark the END of each analysis window (~43 ms), so allow for that latency.
  const errs = beats.map((t) => Math.min(...kicks.map((k) => Math.abs(t - k))));
  const good = errs.filter((e) => e < 0.08).length;
  assert.ok(good / errs.length > 0.8, `${good}/${errs.length} beats within 80 ms of a hit (median ${errs.sort()[Math.floor(errs.length / 2)].toFixed(3)} s)`);
});

test('speech-like sound is not mistaken for music', () => {
  const { frames } = run(speechLike(12));
  const musicFrames = frames.filter((f) => f.music).length;
  assert.ok(musicFrames / frames.length < 0.05, `music flagged in ${((100 * musicFrames) / frames.length).toFixed(1)}% of frames`);
});

test('a sudden bang after quiet is reported once', () => {
  const r = rng(11);
  const s = new Float32Array(SR * 5);
  for (let i = 0; i < s.length; i++) s[i] = 0.004 * (r() * 2 - 1);
  const i0 = SR * 3;
  for (let i = 0; i < SR * 0.25; i++) s[i0 + i] += 0.9 * (r() * 2 - 1) * Math.exp((-i / SR) * 12);
  const { frames } = run(s);
  const bangs = frames.filter((f) => f.loud);
  assert.equal(bangs.length, 1);
  assert.ok(Math.abs(bangs[0].t - 3) < 0.15, `bang at ${bangs[0].t.toFixed(2)} s`);
});
