// Routes what the user says/types: fast built-in rules for common commands,
// the local AI for conversation and multi-step requests, plus follow-up
// questions and yes/no confirmations.
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { normalize, parse, parseDuration } from './parser.js';

const YES = /^(?:y|yes|yeah|yep|yup|ya|sure|ok|okay|do\s+it|go\s+ahead|confirm(?:ed)?|please\s+do|affirmative|absolutely|of\s+course|correct|right)\b/i;
const NO = /^(?:n|no|nope|nah|cancel|stop|never\s*mind|nevermind|don'?t|do\s+not|abort|no\s+thanks)\b/i;
// Intents the AI answers more naturally than canned lines (when it's available).
const CHATTY = new Set(['greet', 'thanks', 'how_are_you', 'who', 'joke', 'question', 'complex']);

export class CommandCenter extends EventEmitter {
  /**
   * @param deps.actions    Actions
   * @param deps.assistant  Assistant (local LLM) or null
   * @param deps.ollama     Ollama client
   * @param deps.present    { say, carry, emote, thinking }
   * @param deps.getNames   () => the character's name(s), used as wake words
   */
  constructor({ actions, assistant, ollama, present, getNames = () => [] }) {
    super();
    this.actions = actions;
    this.assistant = assistant;
    this.ollama = ollama;
    this.present = present;
    this.getNames = getNames;
    this.pending = null;
    this.buttons = new Map();
    this.busy = false;
    this.log = [];
  }

  registerButtons(buttons = []) {
    const now = Date.now();
    for (const [id, b] of this.buttons) if (now - b.at > 10 * 60 * 1000) this.buttons.delete(id);
    return buttons.map((b) => {
      const id = crypto.randomBytes(6).toString('hex');
      this.buttons.set(id, { run: b.run, at: now });
      return { id, label: b.label };
    });
  }

  async pressButton(id) {
    const b = this.buttons.get(id);
    if (!b) return;
    this.buttons.delete(id);
    const r = await b.run();
    if (r && typeof r === 'object' && ('say' in r || 'confirm' in r)) this.show(r);
  }

  /** Present an action result: bubble, prop animation, emote, follow-ups. */
  show(r, { source } = {}) {
    if (!r) return r;
    if (r.confirm) {
      this.pending = { kind: 'confirm', yes: r.confirm.yes, at: Date.now(), source };
      const buttons = this.registerButtons([
        { label: 'Yes', run: () => this.handle('yes', { source }) },
        { label: 'No', run: () => this.handle('no', { source }) },
      ]);
      this.present.say({ text: r.confirm.question, mood: 'normal', actions: buttons, dur: 30, source });
      return r;
    }
    if (r.ask) {
      this.pending = { kind: 'slot', intent: r.ask.intent, slot: r.ask.slot, base: r.ask.base ?? {}, at: Date.now() };
      this.present.say({ text: r.ask.question, mood: 'normal', dur: 20, source });
      this.present.listenSoon?.();
      return r;
    }
    if (r.item) this.present.carry(r.item);
    if (r.emote) this.present.emote(r.emote);
    if (r.say) this.present.say({ text: r.say, mood: r.mood ?? (r.ok === false ? 'error' : 'normal'), actions: this.registerButtons(r.buttons), dur: r.dur, source });
    this.log.push({ at: Date.now(), source, say: r.say, ok: r.ok });
    return r;
  }

  slotValue(slot, raw) {
    const s = normalize(raw, { names: this.getNames() }).replace(/^(?:call\s+it|name\s+it|it'?s|its|make\s+it|how\s+about)\s+/i, '').replace(/^["']|["']$/g, '').trim();
    if (slot === 'duration') return parseDuration(s);
    return s;
  }

  /**
   * Handle one utterance. Resolves to the final action result (for tests).
   */
  async handle(text, { source = 'chat' } = {}) {
    const raw = String(text ?? '').trim();
    if (!raw) return null;
    this.emit('heard', raw, source);
    const names = { names: this.getNames() };
    const said = normalize(raw, names);

    // A yes/no for something we asked about.
    if (this.pending?.kind === 'confirm' && Date.now() - this.pending.at < 120000) {
      const p = this.pending;
      if (YES.test(said)) {
        this.pending = null;
        return this.show(await p.yes(), { source });
      }
      if (NO.test(said)) {
        this.pending = null;
        return this.show({ ok: true, say: 'Okay, I won’t.', mood: 'normal' }, { source });
      }
      this.pending = null; // anything else: drop it and treat as a new request
    }

    // The missing detail for a previous request ("What should I call it?").
    if (this.pending?.kind === 'slot' && Date.now() - this.pending.at < 120000) {
      const p = this.pending;
      this.pending = null;
      const again = parse(raw, names);
      const isNewCommand = again && !['question', 'greet', 'thanks'].includes(again.intent) && again.intent !== p.intent && !NO.test(said);
      if (NO.test(said)) return this.show({ ok: true, say: 'No worries, never mind!' }, { source });
      if (!isNewCommand) {
        const value = this.slotValue(p.slot, raw);
        const args = { ...p.base };
        if (p.slot === 'duration') args.seconds = value;
        else args[p.slot] = value;
        return this.show(await this.actions[p.intent](args), { source });
      }
    }

    const parsed = parse(raw, names);
    const brain = await this.ollama.check();
    const useRules = parsed && this.actions[parsed.intent] && !(brain.ok && CHATTY.has(parsed.intent));
    if (useRules) {
      try {
        return this.show(await this.actions[parsed.intent](parsed), { source });
      } catch (err) {
        return this.show({ ok: false, say: `Oops, that didn’t work: ${err.message}`, mood: 'error' }, { source });
      }
    }

    if (brain.ok && this.assistant) {
      this.present.thinking(true);
      try {
        const reply = await this.assistant.respond(raw);
        this.present.thinking(false);
        if (reply.pending) return this.show(reply.pending, { source });
        for (const r of reply.results) {
          if (r.item) this.present.carry(r.item);
          if (r.emote) this.present.emote(r.emote);
        }
        const buttons = this.registerButtons(reply.results.flatMap((r) => r.buttons ?? []).slice(0, 3));
        const failed = reply.results.length && reply.results.every((r) => r.ok === false);
        const ok = reply.results.some((r) => r.ok && r.item);
        this.present.say({ text: reply.text, mood: failed ? 'error' : ok ? 'success' : 'normal', actions: buttons, source });
        this.log.push({ at: Date.now(), source, say: reply.text, ok: !failed, ai: true, tools: reply.results.map((r) => r.tool) });
        return { ok: !failed, say: reply.text, results: reply.results, ai: true };
      } catch (err) {
        this.present.thinking(false);
        if (parsed && this.actions[parsed.intent]) return this.show(await this.actions[parsed.intent](parsed), { source });
        return this.show({ ok: false, say: `My brain hiccuped (${err.message.slice(0, 80)}). Try again?`, mood: 'error' }, { source });
      }
    }

    if (parsed && this.actions[parsed.intent]) return this.show(await this.actions[parsed.intent](parsed), { source });
    const why = brain.error === 'disabled' ? '' : brain.running ? ' (My AI model isn’t downloaded yet: run “npm run setup:ai”.)' : ' (My AI brain isn’t running — start Ollama and I’ll get a lot smarter!)';
    return this.show({ ok: false, say: `I’m not sure how to do that yet.${why} Say “help” to see what I can do.` }, { source });
  }
}
