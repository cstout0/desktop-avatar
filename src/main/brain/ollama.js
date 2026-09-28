// Minimal client for a local Ollama server (http://127.0.0.1:11434).
// Everything stays on this PC; nothing is sent anywhere else.

// Must be identical for warm-up and real requests, or Ollama reloads the model.
const NUM_CTX = 8192;

export class Ollama {
  constructor(getConfig) {
    this.getConfig = getConfig; // () => ({ url, model, keepAlive, enabled })
    this.status = { ok: false, checkedAt: 0, error: 'not checked', models: [] };
    this.inflight = 0;
  }

  get cfg() {
    return this.getConfig();
  }

  async check(force = false) {
    if (!force && Date.now() - this.status.checkedAt < 15000) return this.status;
    const { url, model, enabled } = this.cfg;
    if (!enabled) {
      this.status = { ok: false, checkedAt: Date.now(), error: 'disabled', models: [] };
      return this.status;
    }
    try {
      const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(2500) });
      const j = await res.json();
      const models = (j.models ?? []).map((m) => m.name);
      const has = models.some((n) => n === model || n === `${model}:latest` || n.split(':')[0] === model);
      this.status = { ok: has, checkedAt: Date.now(), error: has ? null : `model ${model} is not installed (run: ollama pull ${model})`, models };
    } catch (err) {
      this.status = { ok: false, checkedAt: Date.now(), error: `Ollama isn't running (${err.cause?.code ?? err.name})`, models: [] };
    }
    return this.status;
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
