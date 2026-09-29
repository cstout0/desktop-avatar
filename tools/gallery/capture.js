// electron tools/gallery/capture.js [out.png] [bg] [scale] [page.html]
// Renders the pose gallery (or looks.html) offscreen and saves the canvas as a PNG for review.
import { app, BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const all = process.argv.slice(2).filter((a) => !a.startsWith('--'));
// key=value arguments become extra query parameters (e.g. mode=gaits body=ghost).
const extra = Object.fromEntries(all.filter((a) => /^\w+=/.test(a)).map((a) => a.split(/=(.*)/s).slice(0, 2)));
const args = all.filter((a) => !/^\w+=/.test(a));
const out = path.resolve(args[0] || path.join(dir, 'gallery.png'));
const bg = args[1] || 'light';
const scale = args[2] || '1.6';
const page = args[3] || 'gallery.html';
const only = args[4]; // looks.html: comma-separated labels to render

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1360, height: 800, show: false });
  win.webContents.on('console-message', (e) => console.log(`[page:${e.level}]`, e.message, e.sourceId ? `${e.sourceId}:${e.lineNumber}` : ''));
  await win.loadFile(path.join(dir, page), { query: { bg, scale, ...(only ? { only } : {}), ...extra } });
  let done = false;
  for (let i = 0; i < 50 && !done; i++) {
    done = await win.webContents.executeJavaScript('window.galleryDone === true');
    if (!done) await new Promise((r) => setTimeout(r, 100));
  }
  if (!done) {
    console.error('gallery did not finish rendering');
    app.exit(1);
    return;
  }
  const url = await win.webContents.executeJavaScript('document.getElementById("c").toDataURL("image/png")');
  try {
    writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
    console.log('saved', out);
  } catch (err) {
    console.error(`couldn't save ${out}: ${err.message}`);
  }
  app.quit();
});
