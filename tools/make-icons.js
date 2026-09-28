// electron tools/make-icons.js  -> assets/icon-*.png and assets/icon.ico
// Renders the app icon from the real character drawing code.
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'assets');
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

function ico(pngs) {
  // ICO with PNG-compressed entries (supported since Windows Vista).
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  const win = new BrowserWindow({ show: false, width: 300, height: 300 });
  const pngs = [];
  for (const size of SIZES) {
    await win.loadFile(path.join(root, 'tools/gallery/gallery.html'), { query: { icon: String(size) } });
    for (let i = 0; i < 40 && !(await win.webContents.executeJavaScript('window.galleryDone === true')); i++) await new Promise((r) => setTimeout(r, 50));
    const url = await win.webContents.executeJavaScript('document.getElementById("c").toDataURL("image/png")');
    const data = Buffer.from(url.split(',')[1], 'base64');
    fs.writeFileSync(path.join(out, `icon-${size}.png`), data);
    pngs.push({ size, data });
  }
  fs.writeFileSync(path.join(out, 'icon.ico'), ico(pngs.filter((p) => [16, 20, 24, 32, 40, 48, 64, 256].includes(p.size))));
  console.log('icons written to', out);
  app.quit();
});
