// Downloads the local speech-to-text engine (whisper.cpp, CPU build) and an
// English model into vendor/whisper. Everything runs offline afterwards.
//   npm run setup:voice            -> base.en (148 MB, fast)
//   npm run setup:voice -- small   -> small.en (488 MB, more accurate)
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'vendor', 'whisper');
const RELEASE = 'b5130'; // whisper.cpp v1.9.4 build
const BIN_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${RELEASE}/whisper-bin-x64.zip`;
const modelName = process.argv[2] === 'small' ? 'small.en' : 'base.en';
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${modelName}.bin`;

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let got = 0;
  let lastPct = -10;
  const hash = createHash('sha256');
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    hash.update(chunk);
    got += chunk.length;
    const pct = total ? Math.floor((got / total) * 100) : 0;
    if (pct >= lastPct + 10) {
      lastPct = pct;
      process.stdout.write(`  ${path.basename(dest)}: ${pct}% (${(got / 1e6).toFixed(1)} MB)\n`);
    }
  });
  await pipeline(body, createWriteStream(dest));
  return hash.digest('hex');
}

async function expectedSha(kind) {
  try {
    if (kind === 'bin') {
      const r = await fetch(`https://api.github.com/repos/ggml-org/whisper.cpp/releases/tags/${RELEASE}`);
      const j = await r.json();
      const a = j.assets.find((x) => x.name === 'whisper-bin-x64.zip');
      return a?.digest?.replace(/^sha256:/, '') || null;
    }
    const r = await fetch(MODEL_URL, { method: 'HEAD', redirect: 'manual' });
    const etag = r.headers.get('x-linked-etag') || r.headers.get('etag');
    return etag ? etag.replace(/"/g, '') : null;
  } catch {
    return null;
  }
}

mkdirSync(path.join(dir, 'models'), { recursive: true });

const server = path.join(dir, 'whisper-server.exe');
if (!existsSync(server)) {
  console.log(`Downloading whisper.cpp ${RELEASE} (CPU build)...`);
  const zip = path.join(dir, 'whisper-bin-x64.zip');
  const [sha, want] = await Promise.all([download(BIN_URL, zip), expectedSha('bin')]);
  if (want && want !== sha) throw new Error(`checksum mismatch for whisper zip: ${sha} != ${want}`);
  console.log(`  sha256 ${sha} ${want ? '(verified)' : '(no published digest)'}`);
  const tmp = path.join(dir, '_unzip');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp);
  // Windows' own bsdtar (Git for Windows puts a GNU tar on PATH that can't handle C:\ paths).
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  execFileSync(tar, ['-xf', zip, '-C', tmp]);
  // The zip nests files under Release/; flatten the executables and DLLs we need.
  const found = execFileSync('cmd', ['/c', 'dir', '/s', '/b', tmp]).toString().split(/\r?\n/).filter(Boolean);
  for (const f of found) {
    if (/\.(exe|dll)$/i.test(f)) {
      const dest = path.join(dir, path.basename(f));
      rmSync(dest, { force: true });
      execFileSync('cmd', ['/c', 'move', '/y', f, dest]);
    }
  }
  rmSync(tmp, { recursive: true, force: true });
  rmSync(zip, { force: true });
  if (!existsSync(server)) throw new Error('whisper-server.exe not found in the release zip');
}
console.log('whisper-server.exe ready');

const model = path.join(dir, 'models', `ggml-${modelName}.bin`);
if (!existsSync(model) || statSync(model).size < 1e7) {
  console.log(`Downloading model ggml-${modelName}.bin ...`);
  const tmp = model + '.part';
  const [sha, want] = await Promise.all([download(MODEL_URL, tmp), expectedSha('model')]);
  if (want && /^[0-9a-f]{64}$/.test(want) && want !== sha) throw new Error(`checksum mismatch for model: ${sha} != ${want}`);
  console.log(`  sha256 ${sha} ${want === sha ? '(verified)' : '(no published digest)'}`);
  execFileSync('cmd', ['/c', 'move', '/y', tmp, model]);
}
console.log(`model ready: ${path.relative(root, model)} (${(statSync(model).size / 1e6).toFixed(0)} MB)`);

// Record which model to use so the app picks it up.
writeFileSync(path.join(dir, 'model.txt'), `ggml-${modelName}.bin\n`);
console.log('Voice setup complete.');
