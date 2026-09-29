// Sets up the AI brain: makes sure Ollama (free, local) is running, downloads
// the model if it isn't there yet, and checks that it answers.
//   npm run setup:ai                 -> the model from the app's settings (qwen3:4b-instruct, ~2.5 GB)
//   npm run setup:ai -- llama3.2:3b  -> another model (then set "llm.model" in the settings file)
import fs from 'node:fs';
import path from 'node:path';
import { findOllamaDir, startOllama } from '../src/main/brain/ollama.js';

const settingsFile = path.join(process.env.APPDATA ?? '', 'Desktop Avatar', 'settings.json');
let llm = { url: 'http://127.0.0.1:11434', model: 'qwen3:4b-instruct' };
try {
  llm = { ...llm, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')).llm };
} catch {
  // no settings yet: defaults
}
const model = process.argv[2] || llm.model;
const url = llm.url.replace(/\/+$/, '');

async function running() {
  try {
    const r = await fetch(`${url}/api/version`, { signal: AbortSignal.timeout(2000) });
    return r.ok ? (await r.json()).version : null;
  } catch {
    return null;
  }
}

let version = await running();
if (!version) {
  if (!findOllamaDir()) {
    console.log('Ollama is not installed. It is free and runs on this PC:');
    console.log('  https://ollama.com/download   (or: winget install Ollama.Ollama)');
    console.log('Install it, then run "npm run setup:ai" again.');
    process.exit(1);
  }
  console.log('Starting Ollama...');
  await startOllama({ isUp: async () => !!(await running()) });
  version = await running();
  if (!version) {
    console.log(`Ollama didn't start answering at ${url}. Try opening it from the Start menu, then run this again.`);
    process.exit(1);
  }
}
console.log(`Ollama ${version} is running at ${url}`);

const tags = await (await fetch(`${url}/api/tags`)).json();
const have = (tags.models ?? []).find((m) => m.name === model || m.name === `${model}:latest`);
if (have) {
  console.log(`Model ${model} is already downloaded (${(have.size / 1e9).toFixed(1)} GB)`);
} else {
  console.log(`Downloading ${model} (this can take a while)...`);
  const res = await fetch(`${url}/api/pull`, { method: 'POST', body: JSON.stringify({ model, stream: true }) });
  if (!res.ok) throw new Error(`pull failed: HTTP ${res.status} ${await res.text()}`);
  const decoder = new TextDecoder();
  let buf = '';
  let last = '';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines.filter(Boolean)) {
      const j = JSON.parse(line);
      if (j.error) throw new Error(`pull failed: ${j.error}`);
      const pct = j.total ? Math.floor((100 * (j.completed ?? 0)) / j.total) : null;
      // Print status changes and every 10% of a layer, not every chunk.
      const key = `${j.status}|${pct === null ? '' : Math.floor(pct / 10)}`;
      if (key !== last) {
        last = key;
        console.log(`  ${j.status}${pct === null ? '' : ` ${pct}%`}`);
      }
    }
  }
}

// Same context size as the app, so this also warms the model up for it.
console.log('Asking the model to say hello...');
const t0 = Date.now();
const res = await fetch(`${url}/api/chat`, {
  method: 'POST',
  body: JSON.stringify({ model, stream: false, keep_alive: '15m', options: { num_ctx: 8192, num_predict: 20 }, messages: [{ role: 'user', content: 'Say hi in five words or fewer.' }] }),
});
if (!res.ok) throw new Error(`chat failed: HTTP ${res.status} ${await res.text()}`);
const reply = (await res.json()).message?.content?.trim();
console.log(`  "${reply}" (${((Date.now() - t0) / 1000).toFixed(1)} s, including loading the model)`);
if (model !== llm.model) console.log(`To use ${model}, set "llm": { "model": "${model}" } in ${settingsFile}`);
console.log('AI setup complete.');
