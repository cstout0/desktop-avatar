// Downloads Piper (a local natural-sounding voice engine) and a voice into
// vendor/piper. The Settings window can do the same with one click.
//   npm run setup:tts                        -> Amy (US)
//   npm run setup:tts -- en_GB-alba-medium   -> another voice (see PIPER_VOICES)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installPiper, PIPER_VOICES } from '../src/main/installers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const voice = process.argv[2] || PIPER_VOICES[0].id;
let shown = -10;
await installPiper(path.join(root, 'vendor', 'piper'), {
  voice,
  log: console.log,
  onProgress: (p) => {
    const pct = Math.floor(p * 100);
    if (pct >= shown + 10) {
      shown = pct;
      console.log(`  ${pct}%`);
    }
  },
});
console.log(`Voice ${voice} is ready. Pick "Natural voice" in Settings > Voice.`);
