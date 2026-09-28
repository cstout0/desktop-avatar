// Tiny client for the test harness.
//   node tools/h.js state
//   node tools/h.js eval "<js>" [display]
//   node tools/h.js capture <file.png> [display]
//   node tools/h.js post /do '{"name":"dance"}'
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const infoFile = path.join(process.env.APPDATA, 'Desktop Claude', 'harness.json');

export function harnessInfo() {
  return JSON.parse(fs.readFileSync(infoFile, 'utf8'));
}

export async function call(route, body, method = body === undefined ? 'GET' : 'POST') {
  const { port, token } = harnessInfo();
  const res = await fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers: { 'x-token': token, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${route} -> ${res.status}: ${data?.error ?? text}`);
  return data;
}

export const evalIn = (js, display) => call('/eval', { js, display });

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, a, b] = process.argv.slice(2);
  let out;
  if (cmd === 'state') out = await call('/state');
  else if (cmd === 'eval') out = await evalIn(a, b);
  else if (cmd === 'capture') out = await call(`/capture?file=${encodeURIComponent(path.resolve(a))}${b ? `&display=${b}` : ''}`);
  // Routes may be given without the leading slash (Git Bash rewrites "/x" into a path).
  else if (cmd === 'post') out = await call(a.startsWith('/') ? a : `/${a}`, JSON.parse(b || '{}'));
  else if (cmd === 'get') out = await call(a.startsWith('/') ? a : `/${a}`);
  else throw new Error('usage: state | eval <js> [display] | capture <file> [display] | post <route> <json> | get <route>');
  console.log(JSON.stringify(out, null, 2));
}
