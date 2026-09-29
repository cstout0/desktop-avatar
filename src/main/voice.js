// Local speech-to-text: runs whisper.cpp's server (downloaded by
// `npm run setup:voice`) and sends it short WAV clips. Nothing leaves the PC.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { vendorDir } from './vendor.js';

// Biases recognition toward the character's name and typical commands.
const PROMPT = 'Create a folder named Test Folder. Open Spotify. Set a timer for 5 minutes. Take a note.';
const promptFor = (name) => (name ? `${name}, ${PROMPT[0].toLowerCase()}${PROMPT.slice(1)}` : PROMPT);

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

export class Whisper {
  constructor({ root, getName = () => '' }) {
    this.getName = getName;
    this.dir = vendorDir(root, 'whisper');
    this.proc = null;
    this.port = null;
    this.starting = null;
  }

  installed() {
    return fs.existsSync(path.join(this.dir, 'whisper-server.exe')) && !!this.modelPath();
  }

  modelPath() {
    let name = 'ggml-base.en.bin';
    try {
      name = fs.readFileSync(path.join(this.dir, 'model.txt'), 'utf8').trim() || name;
    } catch {
      /* default */
    }
    const p = path.join(this.dir, 'models', name);
    return fs.existsSync(p) ? p : null;
  }

  /** Start the server (once) and wait until it accepts connections. */
  start() {
    if (this.proc && !this.proc.killed) return this.starting ?? Promise.resolve(true);
    if (!this.installed()) return Promise.resolve(false);
    this.starting = (async () => {
      this.port = await freePort();
      const args = ['-m', this.modelPath(), '--host', '127.0.0.1', '--port', String(this.port), '-t', '8', '-nt', '-l', 'en'];
      this.proc = spawn(path.join(this.dir, 'whisper-server.exe'), args, { cwd: this.dir, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      this.proc.stderr.on('data', () => {}); // drain
      this.proc.on('exit', () => {
        this.proc = null;
        this.starting = null;
      });
      for (let i = 0; i < 100; i++) {
        if (!this.proc) return false;
        const ok = await new Promise((resolve) => {
          const s = net.connect(this.port, '127.0.0.1', () => {
            s.destroy();
            resolve(true);
          });
          s.on('error', () => resolve(false));
        });
        if (ok) return true;
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    })();
    return this.starting;
  }

  stop() {
    this.proc?.kill();
    this.proc = null;
    this.starting = null;
  }

  /**
   * @param wav Buffer/Uint8Array with a 16 kHz mono 16-bit WAV.
   * @param opts.commands  bias toward spoken commands (off for video soundtracks)
   * @returns text
   */
  async transcribe(wav, { commands = true } = {}) {
    const ok = await this.start();
    if (!ok) throw new Error('speech engine not available (run: npm run setup:voice)');
    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav');
    form.append('temperature', '0.0');
    form.append('response_format', 'json');
    if (commands) form.append('prompt', promptFor(this.getName()));
    const res = await fetch(`http://127.0.0.1:${this.port}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`speech engine HTTP ${res.status}`);
    const j = await res.json();
    return cleanTranscript(j.text ?? '');
  }
}

/** Remove whisper's non-speech markers and tidy whitespace. */
export function cleanTranscript(text) {
  return String(text)
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, ' ') // [BLANK_AUDIO], (music), *laughs*
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-–,.\s]+/, '');
}
