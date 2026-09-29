// The app normally runs without a console, so console output also goes to a
// small log file in its data folder (the previous run's log is kept as app.old.log).
import fs from 'node:fs';
import path from 'node:path';
import { inspect } from 'node:util';

export function startFileLog(dir) {
  const file = path.join(dir, 'app.log');
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(file)) fs.renameSync(file, path.join(dir, 'app.old.log'));
  } catch {
    /* keep going without rotation */
  }
  let bytes = 0;
  const write = (level, args) => {
    if (bytes > 2_000_000) return; // runaway logging: stop rather than fill the disk
    const line = `${new Date().toISOString()} ${level.padEnd(5)} ${args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 3 }))).join(' ')}\n`;
    bytes += line.length;
    try {
      fs.appendFileSync(file, line);
    } catch {
      /* disk full or locked: ignore */
    }
  };
  for (const level of ['log', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      write(level, args);
    };
  }
  process.on('unhandledRejection', (err) => console.error('unhandled rejection:', err));
  return file;
}
