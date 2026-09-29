// Downloads the local speech-to-text engine (whisper.cpp, CPU build) and an
// English model into vendor/whisper. Everything runs offline afterwards.
//   npm run setup:voice            -> base.en (148 MB, fast)
//   npm run setup:voice -- small   -> small.en (488 MB, more accurate)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installWhisper } from '../src/main/installers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const model = process.argv[2] === 'small' ? 'small.en' : 'base.en';
let shown = -10;
const { model: file } = await installWhisper(path.join(root, 'vendor', 'whisper'), {
  model,
  log: console.log,
  onProgress: (p) => {
    const pct = Math.floor(p * 100);
    if (pct >= shown + 10) {
      shown = pct;
      console.log(`  ${pct}%`);
    }
  },
});
console.log(`model ready: ${path.relative(root, file)}`);
console.log('Voice setup complete.');
