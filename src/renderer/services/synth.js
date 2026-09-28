// Kick + snare + bassline loop (no hi-hats). Used for silent tests of the ears.
/** Synthetic drum loop for silent end-to-end tests. */
export function synthLoop(bpm, secs, rate = 48000) {
  const n = Math.round(secs * rate);
  const out = new Float32Array(n);
  const beat = 60 / bpm;
  let seed = 1;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  for (let b = 0; b * beat < secs; b++) {
    const i0 = Math.round(b * beat * rate);
    if (b % 2 === 0) {
      for (let i = 0; i < rate * 0.18 && i0 + i < n; i++) {
        const t = i / rate;
        out[i0 + i] += 0.7 * Math.sin(2 * Math.PI * (45 + 70 * Math.exp(-t * 30)) * t) * Math.exp(-t * 18);
      }
    } else {
      for (let i = 0; i < rate * 0.12 && i0 + i < n; i++) out[i0 + i] += 0.3 * rnd() * Math.exp((-i / rate) * 30);
    }
    const note = [55, 55, 73.4, 65.4][b % 4];
    for (let i = 0; i < beat * rate * 0.9 && i0 + i < n; i++) {
      const t = i / rate;
      out[i0 + i] += 0.15 * Math.sin(2 * Math.PI * note * t) * Math.min(1, t * 40) * Math.exp(-t * 3);
    }
  }
  return out;
}
