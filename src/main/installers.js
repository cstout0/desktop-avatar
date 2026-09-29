// Downloads the optional local engines: whisper.cpp (speech recognition) and
// Piper (natural voices). Shared by the setup scripts and the Settings window.
// No Electron imports here, so plain Node scripts can use it too.
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Stream `url` to `dest`, reporting progress; returns the file's hex digest. */
export async function download(url, dest, { onProgress = () => {}, algo = 'sha256', expectedSize = 0 } = {}) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || expectedSize;
  let got = 0;
  const hash = createHash(algo);
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    hash.update(chunk);
    got += chunk.length;
    if (total) onProgress(Math.min(1, got / total));
  });
  const part = `${dest}.part`;
  await pipeline(body, createWriteStream(part));
  renameSync(part, dest);
  return hash.digest('hex');
}

/** Unzip with Windows' own bsdtar (Git's GNU tar can't handle C:\ paths). */
export function extractZip(zip, dir) {
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  mkdirSync(dir, { recursive: true });
  execFileSync(tar, ['-xf', zip, '-C', dir]);
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

// ---- whisper.cpp -------------------------------------------------------------------------

export const WHISPER_RELEASE = 'b5130'; // whisper.cpp v1.9.4 build
const WHISPER_BIN = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_RELEASE}/whisper-bin-x64.zip`;
const whisperModelUrl = (name) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${name}.bin`;

async function publishedDigest(kind, modelName) {
  try {
    if (kind === 'bin') {
      const j = await (await fetch(`https://api.github.com/repos/ggml-org/whisper.cpp/releases/tags/${WHISPER_RELEASE}`)).json();
      return j.assets.find((x) => x.name === 'whisper-bin-x64.zip')?.digest?.replace(/^sha256:/, '') || null;
    }
    const r = await fetch(whisperModelUrl(modelName), { method: 'HEAD', redirect: 'manual' });
    const etag = (r.headers.get('x-linked-etag') || r.headers.get('etag') || '').replace(/"/g, '');
    return /^[0-9a-f]{64}$/.test(etag) ? etag : null;
  } catch {
    return null;
  }
}

export function whisperInstalled(dir) {
  const models = path.join(dir, 'models');
  return existsSync(path.join(dir, 'whisper-server.exe')) && existsSync(models) && readdirSync(models).some((f) => f.endsWith('.bin'));
}

/** Download whisper.cpp (CPU build) and an English model into `dir`. */
export async function installWhisper(dir, { model = 'base.en', onProgress = () => {}, log = () => {} } = {}) {
  mkdirSync(path.join(dir, 'models'), { recursive: true });
  const server = path.join(dir, 'whisper-server.exe');
  if (!existsSync(server)) {
    log(`Downloading whisper.cpp ${WHISPER_RELEASE} (CPU build)...`);
    const zip = path.join(dir, 'whisper-bin-x64.zip');
    const [sha, want] = await Promise.all([download(WHISPER_BIN, zip, { onProgress: (p) => onProgress(p * 0.12) }), publishedDigest('bin')]);
    if (want && want !== sha) throw new Error(`checksum mismatch for the whisper zip: ${sha} != ${want}`);
    log(`  sha256 ${sha} ${want ? '(verified)' : '(no published digest)'}`);
    const tmp = path.join(dir, '_unzip');
    rmSync(tmp, { recursive: true, force: true });
    extractZip(zip, tmp);
    // The zip nests files under Release/; keep the executables and DLLs flat.
    for (const f of walk(tmp).filter((x) => /\.(exe|dll)$/i.test(x))) {
      const dest = path.join(dir, path.basename(f));
      rmSync(dest, { force: true });
      renameSync(f, dest);
    }
    rmSync(tmp, { recursive: true, force: true });
    rmSync(zip, { force: true });
    if (!existsSync(server)) throw new Error('whisper-server.exe not found in the release zip');
  }
  const file = path.join(dir, 'models', `ggml-${model}.bin`);
  if (!existsSync(file) || statSync(file).size < 1e7) {
    log(`Downloading model ggml-${model}.bin ...`);
    const [sha, want] = await Promise.all([download(whisperModelUrl(model), file, { onProgress: (p) => onProgress(0.12 + p * 0.88) }), publishedDigest('model', model)]);
    if (want && want !== sha) {
      rmSync(file, { force: true });
      throw new Error(`checksum mismatch for the model: ${sha} != ${want}`);
    }
    log(`  sha256 ${sha} ${want ? '(verified)' : '(no published digest)'}`);
  }
  writeFileSync(path.join(dir, 'model.txt'), `ggml-${model}.bin\n`);
  onProgress(1);
  return { model: file };
}

// ---- Piper (natural voices) ------------------------------------------------------------------

const PIPER_ZIP = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip';
const VOICE_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0';

// Single-speaker "medium" voices (~63 MB each), with the md5s from Piper's voices.json.
export const PIPER_VOICES = [
  { id: 'en_US-amy-medium', label: 'Amy (US)', path: 'en/en_US/amy/medium', md5: '778d28aeb95fcdf8a882344d9df142fc', cfgMd5: '7f37dadb26340c90ebc8088e0b252310' },
  { id: 'en_US-kristin-medium', label: 'Kristin (US)', path: 'en/en_US/kristin/medium', md5: '5fed42d2296baca042e2bf74785db725', cfgMd5: '70bc97d350c796c64ea5e4d08241afac' },
  { id: 'en_GB-jenny_dioco-medium', label: 'Jenny (UK)', path: 'en/en_GB/jenny_dioco/medium', md5: 'd08f2f7edf0c858275a7eca74ff2a9e4', cfgMd5: 'e999a9c0aa535fb42e43b04cebcd65d2' },
  { id: 'en_GB-alba-medium', label: 'Alba (Scottish)', path: 'en/en_GB/alba/medium', md5: 'c07f313752bb3aba8061041666251654', cfgMd5: 'dbb6f2ede31082710665221417906e13' },
  { id: 'en_US-ryan-medium', label: 'Ryan (US)', path: 'en/en_US/ryan/medium', md5: '8f06d3aff8ded5a7f13f907e6bec32ac', cfgMd5: 'f173a2b5202b3e4128ccc3ed8195306c' },
  { id: 'en_US-joe-medium', label: 'Joe (US)', path: 'en/en_US/joe/medium', md5: '74fd6a4dc39e0aa9dce145d7f5acd4f6', cfgMd5: '811036b9c1451545f9495fdc1baa0754' },
];

export const piperExe = (dir) => path.join(dir, 'piper', 'piper.exe');
export const piperVoiceFile = (dir, id) => path.join(dir, 'voices', `${id}.onnx`);
export const piperInstalled = (dir) => existsSync(piperExe(dir));
export const piperVoiceInstalled = (dir, id) => existsSync(piperVoiceFile(dir, id)) && existsSync(`${piperVoiceFile(dir, id)}.json`);

/** Download the Piper engine (once) and one voice into `dir`. */
export async function installPiper(dir, { voice = PIPER_VOICES[0].id, onProgress = () => {}, log = () => {} } = {}) {
  const v = PIPER_VOICES.find((x) => x.id === voice);
  if (!v) throw new Error(`unknown voice: ${voice}`);
  mkdirSync(path.join(dir, 'voices'), { recursive: true });
  const engineShare = piperInstalled(dir) ? 0 : 0.26;
  if (!piperInstalled(dir)) {
    log('Downloading the Piper voice engine...');
    const zip = path.join(dir, 'piper.zip');
    await download(PIPER_ZIP, zip, { onProgress: (p) => onProgress(p * engineShare), expectedSize: 22477236 });
    extractZip(zip, dir); // -> dir/piper/piper.exe + espeak-ng-data + DLLs
    rmSync(zip, { force: true });
    if (!piperInstalled(dir)) throw new Error('piper.exe not found in the release zip');
  }
  if (!piperVoiceInstalled(dir, v.id)) {
    log(`Downloading the voice ${v.label}...`);
    const file = piperVoiceFile(dir, v.id);
    const cfgMd5 = await download(`${VOICE_BASE}/${v.path}/${v.id}.onnx.json`, `${file}.json`, { algo: 'md5' });
    const md5 = await download(`${VOICE_BASE}/${v.path}/${v.id}.onnx`, file, { algo: 'md5', onProgress: (p) => onProgress(engineShare + p * (1 - engineShare)) });
    if (md5 !== v.md5 || cfgMd5 !== v.cfgMd5) {
      rmSync(file, { force: true });
      rmSync(`${file}.json`, { force: true });
      throw new Error(`checksum mismatch for the ${v.label} voice`);
    }
    log('  md5 verified');
  }
  onProgress(1);
  return { voice: piperVoiceFile(dir, v.id) };
}
