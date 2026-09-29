// Hosts the hidden "ears" window (system-audio analysis) and forwards what it
// hears to the character's brain: music (bpm, beats), overall energy, sudden bangs.
import { BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { synthLoop } from '../renderer/services/synth.js';

export function createEars({ root, settings, overlays }) {
  let win = null;
  let markReady;
  const ready = new Promise((r) => (markReady = r));
  let status = { ok: false, error: 'not started' };
  let last = null;
  let beats = 0;
  const enabled = () => settings.get('audioReactions') !== false;

  ipcMain.on('svc:audio', (_e, a) => {
    last = a;
    if (a.beat) beats++;
    if (enabled()) overlays.sendToBrain('ov:audio', a);
  });
  ipcMain.on('svc:status', (_e, s) => {
    status = s;
    console.log('[ears]', JSON.stringify(s));
  });

  const pendingClips = new Map();
  let clipSeq = 0;
  ipcMain.on('svc:clip', (_e, { id, wav, rms }) => {
    const done = pendingClips.get(id);
    if (!done) return;
    pendingClips.delete(id);
    done({ wav: wav ? Buffer.from(wav) : null, rms });
  });

  /** A few seconds of what the PC is playing, as a 16 kHz WAV (null if silent). */
  function captureClip(secs) {
    return new Promise((resolve) => {
      if (!win || win.isDestroyed()) return resolve({ wav: null, rms: 0 });
      const id = ++clipSeq;
      pendingClips.set(id, resolve);
      win.webContents.send('svc:capture', { id, secs });
      setTimeout(() => {
        if (pendingClips.delete(id)) resolve({ wav: null, rms: 0 });
      }, (secs + 6) * 1000);
    });
  }

  /** Stream PCM through the ears in real time (tests; nothing is played aloud). */
  async function streamPcm(pcm, rate) {
    const chunk = Math.round(rate / 20);
    const t0 = Date.now();
    for (let i = 0; i < pcm.length; i += chunk) {
      win.webContents.send('svc:inject', { samples: pcm.slice(i, i + chunk).buffer, rate });
      const due = t0 + ((i + chunk) / rate) * 1000;
      await new Promise((r) => setTimeout(r, Math.max(0, due - Date.now())));
    }
    win.webContents.send('svc:inject-end');
  }

  function readWav(file) {
    const b = fs.readFileSync(file);
    const rate = b.readUInt32LE(24);
    const channels = b.readUInt16LE(22);
    let off = 12;
    while (off < b.length - 8 && b.toString('ascii', off, off + 4) !== 'data') off += 8 + b.readUInt32LE(off + 4);
    const start = off + 8;
    const n = Math.floor((b.length - start) / 2 / channels);
    const pcm = new Float32Array(n);
    for (let i = 0; i < n; i++) pcm[i] = b.readInt16LE(start + i * 2 * channels) / 32768;
    return { pcm, rate };
  }

  return {
    name: 'ears',
    async onReady() {
      win = new BrowserWindow({
        show: false,
        width: 160,
        height: 90,
        skipTaskbar: true,
        webPreferences: { preload: path.join(root, 'src/preload/services.cjs'), backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
      });
      await win.loadFile(path.join(root, 'src/renderer/services/index.html'));
      // What it listens to (and when) is decided by ListenSource (listen.js).
      markReady();
    },
    ready,
    setStatus: (s) => {
      status = s;
    },
    /** PNG data URLs (by size) of its head in `look`, drawn in the hidden window. */
    renderIcons: async (look) => {
      await ready;
      if (!win || win.isDestroyed()) return null;
      return win.webContents.executeJavaScript(`window.__renderIcons(${JSON.stringify(look)})`, true);
    },
    state: () => ({ status, last, beats }),
    captureClip,
    /** Talk to the hidden services window (it also speaks and plays the character's voice). */
    send: (ch, data) => {
      if (win && !win.isDestroyed()) win.webContents.send(`svc:${ch}`, data);
    },
    harness: {
      // Streams a synthetic drum loop through the analyzer in real time (silent).
      'ears-inject': async ({ bpm = 120, secs = 10 }) => {
        await streamPcm(synthLoop(bpm, secs, 48000), 48000);
        return { beats, last };
      },
      // Streams a WAV file through the ears as if the PC were playing it (silent).
      'ears-play-wav': async ({ file }) => {
        const { pcm, rate } = readWav(file);
        await streamPcm(pcm, rate);
        return { seconds: pcm.length / rate };
      },
      'ears-clip': async ({ secs = 5 }) => {
        const c = await captureClip(secs);
        return { bytes: c.wav?.length ?? 0, rms: c.rms };
      },
    },
  };
}
