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
import { cleanName, nameIdeas } from './names.js';
import { installWhisper } from './installers.js';

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

export function createAssistantHost({ root, settings, overlays, watcher, hideFor, getContext = () => '', personality = null, openSettings = () => {}, speech = null, ui = () => {} }) {
  const folders = Object.fromEntries(['desktop', 'documents', 'downloads', 'pictures', 'music', 'videos', 'home'].map((k) => [k, app.getPath(k)]));
  const paths = new SafePaths(folders, settings.get('createIn') || 'desktop');
  const apps = new AppIndex();
  const timers = new Timers();
  const ollama = new Ollama(() => ({ ...settings.get('llm') }));
  const chat = new ChatWindow({ root });
  const charName = () => settings.get('name') || '';

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
    getName: charName,
    setName: (name) => settings.set('name', name),
    getLook: () => settings.get('look'),
    setLook: (look) => settings.set('look', look),
    getMotion: () => settings.get('motion'),
    setMotion: (motion) => settings.set('motion', motion),
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
    openSettings,
  });

  const assistant = new Assistant({ ollama, actions, getFacts: () => actions.facts(), getContext, getName: charName, getPersonality: () => personality?.text() ?? '' });

  const present = {
    say: ({ text, mood, actions: buttons, dur, sticky, source }) => {
      overlays.sendToBrain('ov:say', { text, mood, actions: buttons, dur, sticky });
      if (mood !== 'thinking') speech?.say(text, { source });
    },
    carry: (item) => brainDo({ name: 'carry', item }),
    emote: (name) => brainDo({ name }),
    thinking: (on) => {
      brainDo({ name: 'think', on });
      if (on) overlays.sendToBrain('ov:say', { text: '…', mood: 'thinking', sticky: true });
    },
  };
  const center = new CommandCenter({ actions, assistant, ollama, present, getNames: () => [charName()].filter(Boolean) });

  // Make the character act out what the AI said it would do.
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
      new Notification({ title: charName() || 'Desktop Avatar', body: text, icon: path.join(root, 'assets', 'icon-256.png') }).show();
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
    if (s.running) return { kind: 'warn', text: `Basic mode: the AI model isn’t downloaded (run: npm run setup:ai)` };
    return { kind: 'warn', text: 'Basic mode — start Ollama for the full AI brain' };
  }

  const whisper = new Whisper({ root, getName: charName });
  const voiceOn = () => settings.get('voice.enabled') !== false && whisper.installed();

  /** @param opts.mode 'name' asks for the character's name (always, until it has one). */
  async function openChat({ listen = false, mode } = {}) {
    const p = charPoint();
    if (!p) return false;
    if (mode === 'name' || !charName()) {
      overlays.sendToBrain('ov:hide-bubble');
      chat.show(p, { mode: 'name', name: charName(), ideas: nameIdeas(12, [charName()]) });
      return true;
    }
    chat.setStatus(await aiStatus());
    chat.show(p, { name: charName() });
    if (voiceOn()) whisper.start(); // warm the speech engine so the mic is instant
    if (listen) setTimeout(() => chat.send('listen'), 120);
    ollama.warm().then(async () => {
      if (chat.visible) chat.setStatus(await aiStatus());
    });
    return true;
  }

  /** First run: once the character has landed and said hi, ask for its name. */
  function askForNameAfterIntro() {
    const t0 = Date.now();
    const check = (r) => {
      if ((r?.brain !== 'intro' && r?.mode === 'ground') || Date.now() - t0 > 15000) {
        overlays.off('report', check);
        setTimeout(() => !charName() && openChat({ mode: 'name' }), 3000);
      }
    };
    overlays.on('report', check);
  }

  ipcMain.on('chat:voice-state', (_e, state) => {
    chat.busy = state === 'listening' || state === 'speaking' || state === 'transcribing';
    const at = charPoint();
    if (chat.busy) brainDo({ name: 'listen', on: true, at });
    if (state === 'listening') speech?.shush(); // don't talk over (or into) the microphone
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
  chat.on('closed', (reason, mode) => {
    if (reason !== 'submit') brainDo({ name: 'listen', on: false });
    if (mode === 'name' && reason !== 'named' && !charName()) {
      present.say({ text: 'No rush! Double-click me when you’ve thought of a name. 🙂', mood: 'happy' });
    }
  });
  chat.on('submit', async (text, { voice = false } = {}) => {
    brainDo({ name: 'listen', on: false });
    await center.handle(text, { source: voice ? 'voice' : 'chat' });
  });
  chat.on('name', (text) => {
    const name = cleanName(text);
    if (!name) {
      chat.send('name-error', 'That won’t work as a name. Try letters or numbers (or roll the 🎲)');
      return;
    }
    chat.hide('named');
    center.show(actions.rename_self({ name }), { source: 'naming' });
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
      if (!charName()) askForNameAfterIntro();
      // Ollama installed but not running? Start it so the AI brain is there when needed.
      ollama.ensureRunning().then((s) => console.log(`[ai] ${s.ok ? `ready (${settings.get('llm.model')})` : s.error}`));
    },
    hotkeys(bindAs) {
      this.chatKey = bindAs('chat', () => openChat());
      this.voiceKey = bindAs('voice', () => (chat.visible ? chat.send('listen') : openChat({ listen: true })));
    },
    menuItems() {
      const n = timers.list().length;
      const name = charName();
      return [
        { label: `Talk to ${name || 'me'}…`, accelerator: this.chatKey ?? undefined, click: () => openChat() },
        { label: 'Talk with your voice…', accelerator: this.voiceKey ?? undefined, enabled: voiceOn() && !!name, click: () => openChat({ listen: true }) },
        { label: name ? `Rename ${name}…` : 'Give me a name…', click: () => openChat({ mode: 'name' }) },
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
      'open-chat': async ({ mode } = {}) => {
        await openChat({ mode });
        return chat.visible;
      },
      'chat-press-mic': async () => chat.win.webContents.executeJavaScript(`document.getElementById('mic').click(), true`, true),
      'chat-roll-dice': async () => chat.win.webContents.executeJavaScript(`document.getElementById('dice').click(), document.getElementById('text').value`, true),
      'chat-state': async () =>
        chat.win.webContents.executeJavaScript(
          `({ visible: document.body.classList.contains('show'), classes: document.body.className, value: document.getElementById('text').value, placeholder: document.getElementById('text').placeholder, status: document.getElementById('statusText').textContent, keys: document.getElementById('keys').textContent, level: getComputedStyle(document.documentElement).getPropertyValue('--level'), face: (document.getElementById('face')?.src ?? '').slice(0, 30) })`,
          true,
        ),
      'chat-type': async ({ text }) => {
        // Simulates typing into the chat box and pressing Enter.
        await chat.win.webContents.executeJavaScript(`(() => { const i = document.getElementById('text'); i.value = ${JSON.stringify(text)}; document.getElementById('pill').requestSubmit(); return true; })()`);
        return true;
      },
      'chat-close': async () => {
        chat.hide('cancel');
        return true;
      },
      'find-window': async ({ target }) => watcher?.findWindow(target) ?? null,
    },
    async state() {
      return { ai: ollama.status, name: charName(), timers: timers.list(), chatVisible: chat.visible, chatMode: chat.mode, log: center.log.slice(-5) };
    },
    async settingsMeta() {
      return {
        name: charName(),
        nameIdeas: nameIdeas(24, [charName()]),
        ai: await ollama.check(true),
        facts: actions.facts(),
        whisper: { installed: whisper.installed(), model: whisper.installed() ? path.basename(whisper.modelPath()).replace(/^ggml-|\.bin$/g, '') : null },
      };
    },
    settingsActions: {
      rename: ({ name }) => {
        const r = actions.rename_self({ name });
        if (r.ask || r.ok === false) throw new Error('That won’t work as a name. Try letters or numbers.');
        center.show(r, { source: 'settings' });
        return { name: charName() };
      },
      'check-ai': () => ollama.ensureRunning(),
      'get-ollama': () => shell.openExternal('https://ollama.com/download'),
      'pull-model': async () => {
        const s = await ollama.pull({ onProgress: (pct) => ui({ kind: 'download', id: 'model', pct }) });
        return { ok: s.ok };
      },
      'install-whisper': async () => {
        await installWhisper(whisper.dir, { onProgress: (pct) => ui({ kind: 'download', id: 'whisper', pct }), log: (m) => console.log(`[voice] ${m}`) });
        return { ok: whisper.installed() };
      },
      'forget-fact': ({ index }) => {
        const facts = actions.facts();
        facts.splice(index, 1);
        actions.saveFacts(facts);
        return true;
      },
      'forget-all': () => {
        actions.saveFacts([]);
        return true;
      },
    },
  };
}
