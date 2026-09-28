// electron tools/gallery/capture.js [out.png] [bg] [scale]
// Renders the pose gallery offscreen and saves the canvas as a PNG for review.
import { app, BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const out = path.resolve(args[0] || path.join(dir, 'gallery.png'));
const bg = args[1] || 'light';
const scale = args[2] || '1.6';

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1360, height: 800, show: false });
  win.webContents.on('console-message', (e) => console.log(`[page:${e.level}]`, e.message, e.sourceId ? `${e.sourceId}:${e.lineNumber}` : ''));
  await win.loadFile(path.join(dir, 'gallery.html'), { query: { bg, scale } });
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
  writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
  console.log('saved', out);
  app.quit();
});
