// Test harness: a localhost-only control server, enabled only with --harness.
// Lets automated tests inspect state, inject input, and capture the overlays.
import { desktopCapturer, screen } from 'electron';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as w32 from './win32.js';

function readBody(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (d) => (s += d));
    req.on('end', () => {
      try {
        resolve(s ? JSON.parse(s) : {});
      } catch {
        resolve({});
      }
    });
  });
}

export function startHarness({ app, overlays, watcher, handlers = {}, port = Number(process.env.AVATAR_HARNESS_PORT) || 47821 }) {
  const token = crypto.randomBytes(12).toString('hex');
  const server = http.createServer(async (req, res) => {
    if (req.headers['x-token'] !== token) {
      res.writeHead(403).end();
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    const body = await readBody(req);
    try {
      let out;
      switch (url.pathname) {
        case '/state':
          out = {
            report: overlays.lastReport,
            brainId: overlays.brainId,
            displays: [...overlays.wins.entries()].map(([id, e]) => ({ id, hidden: e.hidden, bounds: e.display.bounds, workArea: e.display.workArea, scale: e.display.scaleFactor, visible: e.win.isVisible(), focused: e.win.isFocused() })),
            fullscreen: [...overlays.fullscreen],
            platforms: overlays.platforms,
            windows: watcher.windows.map((w) => ({ hwnd: String(w.hwnd), title: w.title, className: w.className, rect: w.rect, zoomed: w.zoomed })),
            foreground: watcher.lastFg ?? null,
            extra: handlers.state ? await handlers.state() : null,
          };
          break;
        case '/eval': {
          const id = body.display != null ? Number(body.display) : overlays.brainId;
          const e = overlays.wins.get(id);
          if (!e) throw new Error(`no overlay for display ${id}`);
          out = await e.win.webContents.executeJavaScript(body.js, true);
          break;
        }
        case '/capture': {
          const id = url.searchParams.get('display') ? Number(url.searchParams.get('display')) : overlays.brainId;
          const e = overlays.wins.get(id);
          const img = await e.win.webContents.capturePage();
          const file = url.searchParams.get('file');
          if (file) fs.writeFileSync(file, img.toPNG());
          out = { size: img.getSize(), file };
          break;
        }
        case '/overlay-info':
          out = [...overlays.wins.entries()].map(([id, e]) => {
            const ex = w32.exStyleOf(w32.hwndFromBuffer(e.win.getNativeWindowHandle()));
            return { id, exStyle: ex, clickThrough: !!(ex & 0x20), visible: e.win.isVisible(), focused: e.win.isFocused(), brain: id === overlays.brainId };
          });
          break;
        case '/screen-crop': {
          // The real composited screen (the character over the user's windows), cropped to a
          // small box so tests only ever look at the area around the character.
          const { x, y, w, h, file } = body;
          const displays = screen.getAllDisplays();
          const d = displays.find((dd) => x >= dd.bounds.x && x < dd.bounds.x + dd.bounds.width) || displays[0];
          const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: d.bounds.width, height: d.bounds.height } });
          const src = sources.find((s) => String(s.display_id) === String(d.id)) || sources[0];
          const crop = src.thumbnail.crop({ x: Math.max(0, Math.round(x - d.bounds.x)), y: Math.max(0, Math.round(y - d.bounds.y)), width: Math.round(w), height: Math.round(h) });
          fs.writeFileSync(file, crop.toPNG());
          out = { file, display: d.id, size: crop.getSize() };
          break;
        }
        case '/do':
          overlays.sendToBrain('ov:do', body);
          out = true;
          break;
        case '/say':
          overlays.sendToBrain('ov:say', body);
          out = true;
          break;
        case '/fullscreen':
          watcher.forceFullscreen = body.ids ?? null;
          out = true;
          break;
        case '/quit':
          setTimeout(() => app.quit(), 50);
          out = true;
          break;
        default:
          if (handlers[url.pathname.slice(1)]) {
            out = await handlers[url.pathname.slice(1)](body);
            break;
          }
          res.writeHead(404).end();
          return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out ?? null, (_k, v) => (typeof v === 'bigint' ? String(v) : v)));
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: String(err?.stack || err) }));
    }
  });
  server.listen(port, '127.0.0.1');
  const info = path.join(app.getPath('userData'), 'harness.json');
  fs.mkdirSync(path.dirname(info), { recursive: true });
  fs.writeFileSync(info, JSON.stringify({ port, token, pid: process.pid }));
  console.log(`[harness] listening on 127.0.0.1:${port} (info: ${info})`);
  return server;
}
