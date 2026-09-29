// End-to-end voice test. Start the app with a fake microphone first:
//   AVATAR_FAKE_MIC=<spoken-command.wav> npx electron . --harness
//   node test-e2e/voice.e2e.mjs "Voice Test Seven"
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { call } from '../tools/h.js';

const folderName = process.argv[2] || 'Voice Test Seven';
const desktop = path.join(os.homedir(), 'Desktop');
const target = path.join(desktop, folderName);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (fs.existsSync(target)) throw new Error(`${target} already exists; pick another name`);

await call('/open-chat', {});
await sleep(400);
const t0 = Date.now();
await call('/chat-press-mic', {});
const seen = new Set();
let last = null;
while (Date.now() - t0 < 20000) {
  const s = await call('/chat-state');
  const key = s.classes.split(/\s+/).filter((c) => ['listening', 'speaking', 'transcribing', 'heard'].includes(c)).join('+') || 'idle';
  if (!seen.has(key)) {
    seen.add(key);
    console.log(`${((Date.now() - t0) / 1000).toFixed(2)}s  state=${key}  level=${s.level.trim()}  text="${s.value}"  placeholder="${s.placeholder}"`);
  }
  last = s;
  if (fs.existsSync(target)) break;
  await sleep(40);
}
const made = fs.existsSync(target);
console.log(made ? `✔ "${folderName}" created from voice in ${((Date.now() - t0) / 1000).toFixed(1)}s` : `✖ folder not created (last state: ${JSON.stringify(last)})`);
const st = await call('/state');
console.log('It says:', st.report?.bubble);
if (made) fs.rmdirSync(target);
process.exitCode = made ? 0 : 1;
