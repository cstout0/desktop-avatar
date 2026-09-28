import { EventEmitter } from 'node:events';

const MAX_MS = 24 * 24 * 3600 * 1000; // setTimeout limit is ~24.8 days

export class Timers extends EventEmitter {
  constructor() {
    super();
    this.items = new Map();
    this.seq = 0;
  }

  add({ seconds, label = null, kind = 'timer' }) {
    const id = ++this.seq;
    const ms = Math.min(Math.max(1, seconds) * 1000, MAX_MS);
    const t = { id, due: Date.now() + ms, label, kind, seconds };
    t.handle = setTimeout(() => {
      this.items.delete(id);
      this.emit('fire', this.public(t));
    }, ms);
    this.items.set(id, t);
    return this.public(t);
  }

  public({ handle, ...t }) {
    return t;
  }

  list() {
    return [...this.items.values()].map((t) => this.public(t)).sort((a, b) => a.due - b.due);
  }

  clear() {
    const n = this.items.size;
    for (const t of this.items.values()) clearTimeout(t.handle);
    this.items.clear();
    return n;
  }
}
