// Minimal client for a local Ollama server (http://127.0.0.1:11434).
// Everything stays on this PC; nothing is sent anywhere else.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Must be identical for warm-up and real requests, or Ollama reloads the model.
const NUM_CTX = 8192;

/** Where the Windows installer put Ollama (the folder with ollama.exe), or null. */
export function findOllamaDir(env = process.env) {
  const candidates = [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs', 'Ollama'), env.ProgramFiles && path.join(env.ProgramFiles, 'Ollama')];
  return candidates.find((d) => d && fs.existsSync(path.join(d, 'ollama.exe'))) ?? null;
}

/**
 * Start an installed Ollama: its tray app first (the normal way; it runs the
 * server), then the bare server if the app doesn't bring it up (seen after
 * Ollama was killed rather than quit). Resolves true once `isUp()` says so.
 */
export async function startOllama({ isUp, launch = spawn, appWaitMs = 10000, serveWaitMs = 15000 }) {
  const dir = findOllamaDir();
  if (!dir) return false;
  const opts = { detached: true, stdio: 'ignore', windowsHide: true };
  const waitUp = async (ms) => {
    for (const t0 = Date.now(); Date.now() - t0 < ms; ) {
      await new Promise((r) => setTimeout(r, 700));
      if (await isUp()) return true;
    }
    return false;
  };
  const trayApp = path.join(dir, 'ollama app.exe');
  if (fs.existsSync(trayApp)) {
    launch(trayApp, [], opts).unref();
    if (await waitUp(appWaitMs)) return true;
  }
  launch(path.join(dir, 'ollama.exe'), ['serve'], opts).unref();
  return waitUp(serveWaitMs);
}

const isLocal = (url) => /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\/?$/i.test(url);

export class Ollama {
  constructor(getConfig) {
    this.getConfig = getConfig; // () => ({ url, model, keepAlive, enabled })
    this.status = { ok: false, running: false, checkedAt: 0, error: 'not checked', models: [] };
    this.inflight = 0;
    this.launched = false;
  }

  get cfg() {
    return this.getConfig();
  }

  async check(force = false) {
    if (!force && Date.now() - this.status.checkedAt < 15000) return this.status;
    const { url, model, enabled } = this.cfg;
    if (!enabled) {
      this.status = { ok: false, running: false, checkedAt: Date.now(), error: 'disabled', models: [] };
      return this.status;
    }
    try {
      const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(2500) });
      const j = await res.json();
      const models = (j.models ?? []).map((m) => m.name);
      const has = models.some((n) => n === model || n === `${model}:latest` || n.split(':')[0] === model);
      this.status = { ok: has, running: true, checkedAt: Date.now(), error: has ? null : `model ${model} is not downloaded yet (Settings → Brain → Download)`, models };
    } catch (err) {
      this.status = { ok: false, running: false, checkedAt: Date.now(), error: `Ollama isn't running (${err.cause?.code ?? err.name})`, models: [] };
    }
    return this.status;
  }

  /**
   * Ollama installed but not running (e.g. the user quit it)? Start it, once per
   * session, and wait for it to answer. Only for a server on this PC.
   */
  async ensureRunning({ launch = spawn } = {}) {
    const s = await this.check(true);
    if (s.running || s.error === 'disabled' || this.launched || !isLocal(this.cfg.url)) return s;
    this.launched = true;
    await startOllama({ launch, isUp: async () => (await this.check(true)).running });
    return this.status;
  }

  /**
   * Download the model into Ollama (a few GB, once). `onProgress(0..1)` follows
   * all of its parts together.
   */
  async pull({ onProgress = () => {} } = {}) {
    const { url, model } = this.cfg;
    const res = await fetch(`${url}/api/pull`, { method: 'POST', body: JSON.stringify({ model, stream: true }) });
    if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
    const decoder = new TextDecoder();
    const parts = new Map();
    let buf = '';
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines.filter(Boolean)) {
        const j = JSON.parse(line);
        if (j.error) throw new Error(j.error);
        if (j.digest && j.total) parts.set(j.digest, { total: j.total, completed: j.completed ?? 0 });
        let total = 0;
        let done = 0;
        for (const p of parts.values()) {
          total += p.total;
          done += p.completed;
        }
        if (total) onProgress(done / total, j.status);
      }
    }
    return this.check(true);
  }

  /** Load the model into memory ahead of time (first load from disk can take a while). */
  async warm() {
    const s = await this.check();
    if (!s.ok) return false;
    const { url, model, keepAlive } = this.cfg;
    try {
      await fetch(`${url}/api/chat`, { method: 'POST', body: JSON.stringify({ model, messages: [], keep_alive: keepAlive, stream: false, options: { num_ctx: NUM_CTX } }), signal: AbortSignal.timeout(120000) });
      return true;
    } catch {
      return false;
    }
  }

  /** Unload the model now (frees GPU memory, e.g. when a fullscreen game starts). */
  async unload() {
    try {
      await fetch(`${this.cfg.url}/api/generate`, { method: 'POST', body: JSON.stringify({ model: this.cfg.model, keep_alive: 0 }), signal: AbortSignal.timeout(5000) });
      return true;
    } catch {
      return false;
    }
  }

  async loaded() {
    try {
      const j = await (await fetch(`${this.cfg.url}/api/ps`, { signal: AbortSignal.timeout(2000) })).json();
      return (j.models ?? []).some((m) => m.name.split(':')[0] === this.cfg.model.split(':')[0]);
    } catch {
      return false;
    }
  }

  /**
   * One non-streaming chat turn.
   * @returns the assistant message ({ content, tool_calls? })
   */
  async chat({ messages, tools, format, temperature = 0.6, numPredict = 400, timeoutMs = 90000 }) {
    const { url, model, keepAlive } = this.cfg;
    const body = {
      model,
      messages,
      stream: false,
      keep_alive: keepAlive,
      options: { temperature, num_ctx: NUM_CTX, num_predict: numPredict },
    };
    if (tools?.length) body.tools = tools;
    if (format) body.format = format;
    this.inflight++;
    try {
      const res = await fetch(`${url}/api/chat`, { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const j = await res.json();
      return j.message ?? { content: '' };
    } finally {
      this.inflight--;
    }
  }
}
