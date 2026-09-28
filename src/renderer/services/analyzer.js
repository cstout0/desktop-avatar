// Music & sound analysis on raw PCM (pure JS, no Web Audio dependency, so the
// exact same code runs in the app and in unit tests).
//   - band energies + loudness
//   - spectral-flux onsets
//   - tempo (autocorrelation of the onset envelope) + phase-locked beat tracking
//   - "is this music?" and "was that a sudden bang?"

const TAU = Math.PI * 2;

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -TAU / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

export class MusicAnalyzer {
  constructor(sampleRate = 48000, { fftSize = 2048, hop = 1024 } = {}) {
    this.rate = sampleRate;
    this.N = fftSize;
    this.hop = hop;
    this.fps = sampleRate / hop;
    this.window = new Float32Array(fftSize).map((_, i) => 0.5 - 0.5 * Math.cos((TAU * i) / (fftSize - 1)));
    this.ring = new Float32Array(fftSize);
    this.fill = 0;
    this.pending = 0;
    this.re = new Float32Array(fftSize);
    this.im = new Float32Array(fftSize);
    this.prevMag = new Float32Array(fftSize / 2);
    const bin = (hz) => Math.max(1, Math.min(fftSize / 2 - 1, Math.round((hz * fftSize) / sampleRate)));
    this.bands = { bass: [bin(35), bin(160)], lowmid: [bin(160), bin(600)], mid: [bin(600), bin(2500)], high: [bin(2500), bin(10000)] };
    // Onset envelope history for tempo estimation (~8 s).
    this.envLen = Math.round(this.fps * 8);
    this.env = new Float32Array(this.envLen);
    this.envPos = 0;
    this.frames = 0;
    this.fluxHist = [];
    this.rmsHist = [];
    this.bpm = 0;
    this.tempoConf = 0;
    this.bpmHist = [];
    this.phase = 0; // continuous beat count
    this.lastOnsetFrame = -99;
    this.loudCooldown = 0;
    this.musicScore = 0;
    this.out = null;
  }

  get t() {
    return this.frames / this.fps;
  }

  /** Feed mono samples; returns the list of frame results produced. */
  push(samples) {
    const results = [];
    for (let i = 0; i < samples.length; i++) {
      this.ring[this.fill] = samples[i];
      this.fill = (this.fill + 1) % this.N;
      if (++this.pending >= this.hop) {
        this.pending = 0;
        results.push(this.frame());
      }
    }
    return results;
  }

  frame() {
    const N = this.N;
    let sq = 0;
    for (let i = 0; i < N; i++) {
      const v = this.ring[(this.fill + i) % N];
      sq += v * v;
      this.re[i] = v * this.window[i];
      this.im[i] = 0;
    }
    const rms = Math.sqrt(sq / N);
    fft(this.re, this.im);
    const half = N / 2;
    let flux = 0;
    let bassFlux = 0;
    let tempoFlux = 0;
    const band = { bass: 0, lowmid: 0, mid: 0, high: 0 };
    const midTop = this.bands.mid[1];
    for (let k = 1; k < half; k++) {
      const mag = Math.sqrt(this.re[k] * this.re[k] + this.im[k] * this.im[k]) / N;
      const lm = Math.log1p(1000 * mag); // log compression
      const d = lm - this.prevMag[k];
      this.prevMag[k] = lm;
      if (d > 0) {
        flux += d;
        if (k <= this.bands.bass[1]) bassFlux += d;
        // Kicks/snares define the beat; hi-hats mostly add subdivisions.
        tempoFlux += d * (k <= this.bands.lowmid[1] ? 1.3 : k <= midTop ? 1 : 0.5);
      }
      for (const [name, [a, b]] of Object.entries(this.bands)) if (k >= a && k < b) band[name] += mag * mag;
    }
    for (const name of Object.keys(band)) band[name] = Math.sqrt(band[name]);
    const f = this.frames++;
    // Compressed so a snare counts nearly as much as a (much louder) kick; otherwise
    // kick-snare patterns look half-time to the autocorrelation.
    this.env[this.envPos] = Math.sqrt(tempoFlux);
    this.envPos = (this.envPos + 1) % this.envLen;

    // Adaptive onset threshold: local mean + a margin.
    this.fluxHist.push(flux);
    if (this.fluxHist.length > Math.round(this.fps * 1.5)) this.fluxHist.shift();
    const mean = this.fluxHist.reduce((a, b) => a + b, 0) / this.fluxHist.length;
    const sd = Math.sqrt(this.fluxHist.reduce((a, b) => a + (b - mean) ** 2, 0) / this.fluxHist.length);
    const onset = rms > 0.004 && flux > mean + 1.3 * sd + 0.5 && f - this.lastOnsetFrame > this.fps * 0.12;
    if (onset) this.lastOnsetFrame = f;

    if (f % Math.round(this.fps / 4) === 0 && f > this.fps * 2) this.estimateTempo();

    // Beat tracking: advance the phase with the tempo, nudge it toward onsets.
    let beat = false;
    let beatStrength = 0;
    if (this.bpm > 0) {
      const before = this.phase;
      this.phase += this.bpm / 60 / this.fps;
      if (onset) {
        const off = this.phase - Math.round(this.phase); // -0.5..0.5 beats
        if (Math.abs(off) < 0.3) this.phase -= off * 0.35;
      }
      if (Math.floor(this.phase) !== Math.floor(before)) {
        beat = true;
        beatStrength = Math.min(1, bassFlux / Math.max(1, mean * 0.6));
      }
    }

    // Loudness history and "sudden bang" detection.
    this.rmsHist.push(rms);
    if (this.rmsHist.length > Math.round(this.fps * 2)) this.rmsHist.shift();
    const avgRms = this.rmsHist.reduce((a, b) => a + b, 0) / this.rmsHist.length;
    this.loudCooldown = Math.max(0, this.loudCooldown - 1);
    const loud = rms > 0.2 && rms > avgRms * 3.5 && this.loudCooldown === 0;
    if (loud) this.loudCooldown = Math.round(this.fps * 3);

    // Music = sustained sound + a steady, confident tempo.
    const recent = this.bpmHist.slice(-4);
    const steady = recent.length >= 4 && Math.max(...recent) / Math.min(...recent) < 1.05;
    // Speech has gaps between words; music keeps going.
    const cont = this.rmsHist.filter((v) => v > avgRms * 0.3).length / this.rmsHist.length;
    const isMusicy = avgRms > 0.01 && this.tempoConf > 0.3 && steady && cont > 0.85;
    this.musicScore = Math.max(0, Math.min(1, this.musicScore + (isMusicy ? 1 : -1.2) / (this.fps * 1.2)));
    const music = this.musicScore > 0.6 || (this.out?.music && this.musicScore > 0.2);

    this.out = { t: this.t, rms, energy: Math.min(1, rms * 5), bands: band, flux, onset, beat, beatStrength, loud, bpm: this.bpm, tempoConf: this.tempoConf, phase: this.phase, music };
    return this.out;
  }

  estimateTempo() {
    const L = this.envLen;
    const x = new Float32Array(L);
    for (let i = 0; i < L; i++) x[i] = this.env[(this.envPos + i) % L];
    // Remove the local mean so the autocorrelation looks at the rhythm, not loudness.
    let m = 0;
    for (const v of x) m += v;
    m /= L;
    for (let i = 0; i < L; i++) x[i] = Math.max(0, x[i] - m);
    let zero = 0;
    for (const v of x) zero += v * v;
    if (zero <= 1e-9) {
      this.tempoConf = 0;
      return;
    }
    const lagOf = (bpm) => (60 * this.fps) / bpm;
    const minLag = Math.floor(lagOf(210));
    const maxLag = Math.ceil(lagOf(50));
    const ac = new Float32Array(maxLag * 2 + 3);
    const acAt = (lag) => {
      if (ac[lag]) return ac[lag];
      let s = 0;
      for (let i = 0; i + lag < L; i++) s += x[i] * x[i + lag];
      ac[lag] = s / (L - lag) || 1e-12;
      return ac[lag];
    };
    const isPeak = (lag) => acAt(lag) >= acAt(lag - 1) && acAt(lag) >= acAt(lag + 1);
    const peakNear = (lag) => {
      let best = Math.round(lag);
      for (let d = -2; d <= 2; d++) if (acAt(Math.round(lag) + d) > acAt(best)) best = Math.round(lag) + d;
      return best;
    };
    let best = 0;
    let bestScore = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
      if (!isPeak(lag)) continue;
      const bpm = (60 * this.fps) / lag;
      const prior = Math.exp(-0.5 * (Math.log2(bpm / 110) / 1.2) ** 2); // gentle
      const score = acAt(lag) * prior;
      if (score > bestScore) {
        bestScore = score;
        best = lag;
      }
    }
    if (!best) return;
    // Fold octave errors into the natural dance range when the rhythm supports it.
    for (let i = 0; i < 2; i++) {
      const bpm = (60 * this.fps) / best;
      if (bpm > 160 && acAt(peakNear(best * 2)) >= 0.35 * acAt(best)) best = peakNear(best * 2);
      else if (bpm < 80 && best / 2 >= minLag && acAt(peakNear(best / 2)) >= 0.35 * acAt(best)) best = peakNear(best / 2);
    }
    // Parabolic interpolation for sub-frame lag precision.
    const a = acAt(best - 1);
    const b = acAt(best);
    const c = acAt(best + 1);
    const shift = a - 2 * b + c !== 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
    const bpm = (60 * this.fps) / (best + Math.max(-0.5, Math.min(0.5, shift)));
    this.tempoConf = b / (zero / L);
    if (this.tempoConf < 0.12) {
      this.bpmHist.length = 0;
      return;
    }
    this.bpmHist.push(bpm);
    if (this.bpmHist.length > 6) this.bpmHist.shift();
    const sorted = [...this.bpmHist].sort((p, q) => p - q);
    const med = sorted[Math.floor(sorted.length / 2)];
    if (this.bpm > 0) {
      const ratio = med / this.bpm;
      // Keep the beat phase meaningful across octave jumps.
      if (Math.abs(ratio - 2) < 0.1) this.phase *= 2;
      else if (Math.abs(ratio - 0.5) < 0.05) this.phase /= 2;
    }
    this.bpm = med;
  }
}
