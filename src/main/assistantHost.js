// Wires the command engine, the local AI, timers, voice and the chat box into the app.
import { app, ipcMain, Notification, shell } from 'electron';
import path from 'node:path';
import * as w32 from './win32.js';
import { AppIndex } from './commands/apps.js';
import { Actions } from './commands/actions.js';
import { CommandCenter } from './commands/center.js';
import { SafePaths } from './commands/paths.js';
import { Timers } from './commands/timers.js';
import { Assistant } from './brain/assistant.js';
import { Ollama } from './brain/ollama.js';
import { ChatWindow } from './chat.js';
import { Whisper } from './voice.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// If the AI says it's doing something physical but forgot to call the tool, do it anyway.
const SAID_EMOTES = [
  [/\b(?:danc(?:e|ing)|boogie)\b/i, 'dance'],
  [/\b(?:back\s*flip|flip)\b/i, 'flip'],
  [/\bspin(?:ning)?\b/i, 'spin'],
  [/\bwav(?:e|ing)\b/i, 'wave'],
  [/\bcelebrat/i, 'celebrate'],
  [/\bswing(?:ing)?\b/i, 'swing'],
  [/\bclimb(?:ing)?\b/i, 'climb'],
  [/\bjump(?:ing)?\b/i, 'jump'],
];

export function createAssistantHost({ root, settings, overlays, watcher, hideFor, getContext = () => '', personality = null }) {
  const folders = Object.fromEntries(['desktop', 'documents', 'downloads', 'pictures', 'music', 'videos', 'home'].map((k) => [k, app.getPath(k)]));
  const paths = new SafePaths(folders, settings.get('createIn') || 'desktop');
  const apps = new AppIndex();
  const timers = new Timers();
  const ollama = new Ollama(() => ({ ...settings.get('llm') }));
  const chat = new ChatWindow({ root });

  const brainDo = (cmd) => overlays.sendToBrain('ov:do', cmd);
  const charPoint = () => {
    const r = overlays.lastReport;
    if (!r) return null;
    const s = settings.get('scale') ?? 1.4;
    return { x: r.x, y: r.y - 120 * s };
  };

  const actions = new Actions({
    paths,
    shell,
    apps,
    timers,
    dataDir: app.getPath('userData'),
    media: (key, times) => w32.pressMediaKey(key, times),
    emote: (name, extra = {}) => {
      if (name === 'hide') return hideFor(10 * 60 * 1000);
      if (name === 'other-screen') {
        const regions = overlays.regions();
        const here = regions.find((r) => r.id === overlays.brainId);
        let targets = regions.filter((r) => r.id !== overlays.brainId);
        if (extra.which === 'left' && here) targets = targets.filter((r) => r.x < here.x);
        if (extra.which === 'right' && here) targets = targets.filter((r) => r.x > here.x);
        if (targets.length) brainDo({ name: 'travel', to: targets[0].id });
        return;
      }
      if (name === 'climb' && extra.target) {
        const w = watcher?.findWindow(extra.target);
        if (!w) {
          brainDo({ name: 'climb' });
          return { ok: false, say: `I don’t see a ${extra.target} window, so I’ll climb something else!` };
        }
        brainDo({ name: 'climb', win: w.hwnd });
        return { ok: true, say: `Climbing ${w.process.replace(/\.exe$/i, '') || 'that window'}! 🧗`, mood: 'happy' };
      }
      brainDo({ name });
    },
    screenshot: async () => {
      brainDo({ name: 'celebrate' });
      await sleep(650);
      w32.screenshotKey();
      await sleep(300);
    },
  });

  const assistant = new Assistant({ ollama, actions, getFacts: () => actions.facts(), getContext, getPersonality: () => personality?.text() ?? '' });

  const present = {
    say: ({ text, mood, actions: buttons, dur, sticky }) => overlays.sendToBrain('ov:say', { text, mood, actions: buttons, dur, sticky }),
    carry: (item) => brainDo({ name: 'carry', item }),
    emote: (name) => brainDo({ name }),
    thinking: (on) => {
      brainDo({ name: 'think', on });
      if (on) overlays.sendToBrain('ov:say', { text: '…', mood: 'thinking', sticky: true });
    },
  };
  const center = new CommandCenter({ actions, assistant, ollama, present });

  // Make Claude act out what the AI said it would do.
  const origHandle = center.handle.bind(center);
  center.handle = async (text, opts) => {
    const r = await origHandle(text, opts);
    if (r?.ai && !r.results?.some((x) => x.tool === 'animate')) {
      const hit = SAID_EMOTES.find(([re]) => re.test(r.say ?? ''));
      if (hit) brainDo({ name: hit[1] });
    }
    return r;
  };

  timers.on('fire', (t) => {
    const text = t.kind === 'reminder' ? `⏰ Reminder: ${t.label}` : `⏰ Time’s up!${t.label ? ` (${t.label})` : ''}`;
    brainDo({ name: 'wake' });
    brainDo({ name: 'jump' });
    center.show({ ok: true, say: text, mood: 'normal', dur: 25, buttons: [{ label: 'Thanks!', run: () => ({ ok: true, say: 'Anytime! 😊', mood: 'happy' }) }] }, { source: 'timer' });
    try {
      new Notification({ title: 'Claude', body: text, icon: path.join(root, 'assets', 'icon-256.png') }).show();
    } catch {
      /* notifications unavailable */
    }
  });

  async function aiStatus() {
    const s = await ollama.check();
    if (s.ok) {
      const warm = await ollama.loaded();
      return { kind: warm ? 'ok' : 'busy', text: warm ? `AI brain ready · ${settings.get('llm.model')}` : 'Waking up the AI brain… (basic commands work instantly)' };
    }
    if (s.error === 'disabled') return { kind: '', text: 'Basic mode (AI brain turned off)' };
    return { kind: 'warn', text: 'Basic mode — start Ollama for the full AI brain' };
  }

  const whisper = new Whisper({ root });
  const voiceOn = () => settings.get('voice.enabled') !== false && whisper.installed();

  async function openChat({ listen = false } = {}) {
    const p = charPoint();
    if (!p) return;
    chat.setStatus(await aiStatus());
    chat.show(p);
    if (voiceOn()) whisper.start(); // warm the speech engine so the mic is instant
    if (listen) setTimeout(() => chat.send('listen'), 120);
    ollama.warm().then(async () => {
      if (chat.visible) chat.setStatus(await aiStatus());
    });
  }

  ipcMain.on('chat:voice-state', (_e, state) => {
    chat.busy = state === 'listening' || state === 'speaking' || state === 'transcribing';
    const at = charPoint();
    if (chat.busy) brainDo({ name: 'listen', on: true, at });
  });

  ipcMain.on('chat:audio', async (_e, bytes) => {
    chat.busy = true;
    try {
      if (!voiceOn()) throw new Error('voice is not set up (run: npm run setup:voice)');
      const t0 = Date.now();
      const text = await whisper.transcribe(Buffer.from(bytes));
      center.emit('transcribed', text, Date.now() - t0);
      console.log(`[voice] heard "${text}" (${bytes.length} bytes, transcribed in ${Date.now() - t0} ms)`);
      chat.send('transcript', { text });
    } catch (err) {
      chat.send('transcript', { error: `Couldn’t understand that (${err.message})` });
    } finally {
      chat.busy = false;
    }
  });
  app.on('before-quit', () => whisper.stop());

  chat.on('opened', (at) => brainDo({ name: 'listen', on: true, at }));
  chat.on('closed', (reason) => {
    if (reason !== 'submit') brainDo({ name: 'listen', on: false });
  });
  chat.on('submit', async (text) => {
    brainDo({ name: 'listen', on: false });
    await center.handle(text, { source: 'chat' });
  });

  overlays.on('open-chat', () => openChat());
  overlays.on('bubble-action', (id) => center.pressButton(id));

  return {
    name: 'assistant',
    center,
    chat,
    actions,
    ollama,
    timers,
    whisper,
    openChat,
    async onReady() {
      await chat.create();
      apps.load();
      ollama.check(true);
    },
    hotkeys(bindAs) {
      this.chatKey = bindAs('chat', () => openChat());
      this.voiceKey = bindAs('voice', () => (chat.visible ? chat.send('listen') : openChat({ listen: true })));
    },
    menuItems() {
      const n = timers.list().length;
      return [
        { label: 'Talk to Claude…', accelerator: this.chatKey ?? undefined, click: () => openChat() },
        { label: 'Talk with your voice…', accelerator: this.voiceKey ?? undefined, enabled: voiceOn(), click: () => openChat({ listen: true }) },
        ...(n ? [{ label: `${n} timer${n > 1 ? 's' : ''} running`, click: () => center.show(actions.timers_status()) }] : []),
        { label: 'Open my notes', click: () => shell.openPath(actions.notesFile()) },
        { label: ollama.status.ok ? `AI brain: ${settings.get('llm.model')}` : 'AI brain: off (start Ollama)', enabled: false },
      ];
    },
    harness: {
      chat: async ({ text }) => {
        const r = await center.handle(text, { source: 'test' });
        return { ok: r?.ok ?? null, say: r?.say ?? r?.confirm?.question ?? r?.ask?.question ?? null, ai: !!r?.ai, tools: r?.results?.map((x) => x.tool) ?? [], data: r?.data ?? null };
      },
      'open-chat': async () => {
        await openChat();
        return chat.visible;
      },
      'chat-press-mic': async () => chat.win.webContents.executeJavaScript(`document.getElementById('mic').click(), true`, true),
      'chat-state': async () =>
        chat.win.webContents.executeJavaScript(
          `({ classes: document.body.className, value: document.getElementById('text').value, placeholder: document.getElementById('text').placeholder, status: document.getElementById('statusText').textContent, level: getComputedStyle(document.documentElement).getPropertyValue('--level') })`,
          true,
        ),
      'chat-type': async ({ text }) => {
        // Simulates typing into the chat box and pressing Enter.
        await chat.win.webContents.executeJavaScript(`(() => { const i = document.getElementById('text'); i.value = ${JSON.stringify(text)}; document.getElementById('pill').requestSubmit(); return true; })()`);
        return true;
      },
      'find-window': async ({ target }) => watcher?.findWindow(target) ?? null,
    },
    async state() {
      return { ai: ollama.status, timers: timers.list(), chatVisible: chat.visible, log: center.log.slice(-5) };
    },
  };
}
