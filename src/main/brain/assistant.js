// The conversational brain: persona + tool-calling loop on the local model.
import { runTool, TOOLS } from './tools.js';

const MAX_STEPS = 6;

export function personaPrompt({ facts = [], now = new Date(), context = '', personality = '' } = {}) {
  const when = now.toLocaleString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const known = facts.length ? facts.map((f) => `- ${f.text}`).join('\n') : '- (nothing yet)';
  return `You are Claude, a little character who lives on the user's Windows desktop: a round, clay-orange buddy with big eyes and a sparkly antenna. You walk, jump, climb up the sides of windows, and swing on a grappling rope. You run 100% offline on the user's own PC.
${personality ? `\nYour personality (stay in character in everything you say and choose):\n${personality}\n` : ''}
How to reply:
- You talk in a small speech bubble: 1-2 short sentences, under 200 characters. Plain text only (no markdown, no bullet lists).
- Be genuinely helpful. At most one emoji.
- To move around or show off (dance, swing on your rope, climb a window, explore), call the animate tool.
- If a tool can do what the user asks, call the tool. Never claim you did something unless a tool result says it worked.
- Use tools to find things out instead of asking (e.g. list_folder to see what's on the Desktop).
- When the user tells you something about themselves to remember (name, likes, plans), call remember_fact.
- For multi-step requests, call the tools one after another (e.g. create_folder, then create_file with that folder as the location).
- If a request is unclear, ask one short question.
- You have no internet access. For news, weather or facts you're unsure about, offer to search the web.
- New files and folders go on the Desktop unless the user says otherwise.

What you know about the user:
${known}
${context ? `\nWhat's happening on the PC right now:\n${context}\n` : ''}
Right now it is ${when}.`;
}

/** Strip anything that doesn't belong in a speech bubble. */
export function cleanReply(text) {
  return String(text ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toolSummary(r) {
  const out = { ok: !!r.ok, message: r.say ?? r.confirm?.question ?? r.ask?.question ?? null };
  if (r.data) out.data = r.data;
  if (r.confirm) out.status = 'waiting for the user to confirm';
  if (r.ask) out.status = 'need more info from the user';
  return out;
}

export class Assistant {
  constructor({ ollama, actions, getFacts = () => [], getContext = () => '', getPersonality = () => '' }) {
    this.getPersonality = getPersonality;
    this.ollama = ollama;
    this.actions = actions;
    this.getFacts = getFacts;
    this.getContext = getContext;
    this.history = [];
  }

  remember(role, content) {
    this.history.push({ role, content });
    if (this.history.length > 16) this.history.splice(0, this.history.length - 16);
  }

  /**
   * @returns {{ text: string, results: object[], pending?: object }}
   */
  async respond(userText) {
    const messages = [{ role: 'system', content: personaPrompt({ facts: this.getFacts(), context: this.getContext(), personality: this.getPersonality() }) }, ...this.history, { role: 'user', content: userText }];
    const results = [];
    for (let step = 0; step < MAX_STEPS; step++) {
      const msg = await this.ollama.chat({ messages, tools: TOOLS });
      const calls = msg.tool_calls ?? [];
      if (!calls.length) {
        const text = cleanReply(msg.content) || (results.length ? results.map((r) => r.say).filter(Boolean).join(' ') : 'Hmm, I’m not sure what to say!');
        this.remember('user', userText);
        this.remember('assistant', text);
        return { text, results };
      }
      messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: calls });
      for (const call of calls) {
        const name = call.function?.name;
        let args = call.function?.arguments ?? {};
        if (typeof args === 'string') {
          try {
            args = JSON.parse(args);
          } catch {
            args = {};
          }
        }
        let r;
        try {
          r = await runTool(this.actions, name, args);
        } catch (err) {
          r = { ok: false, say: `That didn’t work: ${err.message}`, mood: 'error' };
        }
        r.tool = name;
        results.push(r);
        messages.push({ role: 'tool', tool_name: name, content: JSON.stringify(toolSummary(r)) });
        if (r.confirm || r.ask) {
          // Hand control back to the user (yes/no, or a missing detail).
          const text = r.confirm?.question ?? r.ask.question;
          this.remember('user', userText);
          this.remember('assistant', text);
          return { text, results, pending: r };
        }
      }
      // Loop again: the model may chain more tools (e.g. make a folder, then a file inside it)
      // before giving its final answer.
    }
    const text = results.map((r) => r.say).filter(Boolean).join(' ') || 'Phew, that was a lot. Anything else?';
    this.remember('user', userText);
    this.remember('assistant', text);
    return { text, results };
  }
}
