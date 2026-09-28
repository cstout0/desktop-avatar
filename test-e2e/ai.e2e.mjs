// Live test of the command brain with the real local model (needs Ollama running).
//   node test-e2e/ai.e2e.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SafePaths } from '../src/main/commands/paths.js';
import { Actions } from '../src/main/commands/actions.js';
import { Timers } from '../src/main/commands/timers.js';
import { CommandCenter } from '../src/main/commands/center.js';
import { Ollama } from '../src/main/brain/ollama.js';
import { Assistant } from '../src/main/brain/assistant.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ai-'));
const folders = { home: root };
for (const k of ['desktop', 'documents', 'downloads', 'pictures', 'music', 'videos']) {
  folders[k] = path.join(root, k[0].toUpperCase() + k.slice(1));
  fs.mkdirSync(folders[k], { recursive: true });
}
const calls = [];
const timers = new Timers();
const actions = new Actions({
  paths: new SafePaths(folders),
  shell: {
    openPath: async (p) => calls.push(['openPath', p]),
    openExternal: async (u) => calls.push(['openExternal', u]),
    trashItem: async (p) => {
      calls.push(['trashItem', p]);
      fs.rmSync(p, { recursive: true, force: true });
    },
    showItemInFolder: (p) => calls.push(['show', p]),
  },
  apps: { load: async () => {}, find: (q) => (/spotify/i.test(q) ? { name: 'Spotify', id: 'x', key: 'spotify' } : null), launch: async (a) => calls.push(['launch', a.name]) },
  emote: (n) => calls.push(['emote', n]),
  media: (k, n) => calls.push(['media', k, n]),
  timers,
  dataDir: path.join(root, 'appdata'),
  screenshot: async () => calls.push(['screenshot']),
});
const ollama = new Ollama(() => ({ url: 'http://127.0.0.1:11434', model: 'qwen3:4b-instruct', keepAlive: '10m', enabled: true }));
const assistant = new Assistant({ ollama, actions, getFacts: () => actions.facts() });
const said = [];
const center = new CommandCenter({
  actions,
  assistant,
  ollama,
  present: {
    say: (m) => said.push(m),
    carry: (item) => calls.push(['carry', item]),
    emote: (n) => calls.push(['emote', n]),
    thinking: () => {},
  },
});

const exists = (...p) => fs.existsSync(path.join(...p));
const checks = [];
async function turn(text, check) {
  const n0 = said.length;
  const c0 = calls.length;
  const t0 = performance.now();
  const r = await center.handle(text);
  const ms = Math.round(performance.now() - t0);
  const reply = said.slice(n0).map((m) => m.text).join(' | ');
  const newCalls = calls.slice(c0);
  let ok = true;
  let why = '';
  try {
    const res = check ? await check({ r, reply, calls: newCalls }) : true;
    if (res === false) ok = false;
  } catch (err) {
    ok = false;
    why = err.message;
  }
  checks.push(ok);
  console.log(`${ok ? '✔' : '✖'} [${ms} ms${r?.ai ? ', AI' : ''}] "${text}"\n    → ${reply}${newCalls.length ? `\n    calls: ${JSON.stringify(newCalls)}` : ''}${why ? `\n    ${why}` : ''}`);
}

console.log('warming the model...');
const tw = performance.now();
await ollama.warm();
console.log(`warm in ${Math.round(performance.now() - tw)} ms\n`);

await turn('Claude, create a folder named Test Folder', () => exists(folders.desktop, 'Test Folder'));
await turn("hey, I'm planning a trip to Japan. Make a folder for it and put a file called packing list in it", () => {
  const dirs = fs.readdirSync(folders.desktop).filter((d) => /japan|trip/i.test(d));
  if (!dirs.length) throw new Error(`no trip folder: ${fs.readdirSync(folders.desktop)}`);
  const inside = fs.readdirSync(path.join(folders.desktop, dirs[0]));
  if (!inside.some((f) => /packing/i.test(f))) throw new Error(`folder contents: ${inside}`);
});
await turn("what's 17 times 23?", ({ reply }) => /391/.test(reply));
await turn("I'm bored", ({ reply }) => reply.length > 5);
await turn('remind me to drink water in half an hour', () => timers.list().some((t) => /water/i.test(t.label)));
await turn('can you make a note that I parked on level 3', () => /level 3/.test(fs.readFileSync(path.join(folders.documents, 'Claude Notes.txt'), 'utf8')));
await turn('my name is Cam, please remember that', () => actions.facts().some((f) => /cam/i.test(f.text)));
await turn("what's my name?", ({ reply }) => /cam/i.test(reply));
await turn('open spotify and turn the volume up', ({ calls: c }) => c.some((x) => x[0] === 'launch') && c.some((x) => x[0] === 'media' && x[1] === 'volup'));
await turn('make a folder', ({ reply }) => /call|name/i.test(reply));
await turn('Homework', () => exists(folders.desktop, 'Homework'));
await turn('delete Test Folder', ({ reply }) => /recycle bin/i.test(reply) && exists(folders.desktop, 'Test Folder'));
await turn('yes', () => !exists(folders.desktop, 'Test Folder'));
await turn("what's the weather like today?", ({ reply }) => /search|internet|online|web|can't|cannot|don't/i.test(reply));
await turn('dance for me!', ({ calls: c }) => c.some((x) => x[0] === 'emote' && x[1] === 'dance'));
await turn('tell me a joke', ({ reply }) => reply.length > 15);
await turn('whats on my desktop', ({ reply }) => /Homework/.test(reply));

timers.clear();
fs.rmSync(root, { recursive: true, force: true });
const passed = checks.filter(Boolean).length;
console.log(`\n${passed}/${checks.length} passed`);
process.exitCode = passed === checks.length ? 0 : 1;
