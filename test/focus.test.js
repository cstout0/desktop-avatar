import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Focus, inQuietHours } from '../src/main/focus.js';

let dir;
let calls;
let cfg;

function makeFocus(extra = {}) {
  calls = { show: [], act: [], overlay: [] };
  return new Focus({
    settings: { get: (k) => (k === 'focus' ? cfg : undefined) },
    show: (r) => calls.show.push(r),
    act: (c) => calls.act.push(c),
    overlay: (s) => calls.overlay.push(s),
    dataDir: dir,
    downloadsDir: path.join(dir, 'Downloads'),
    ...extra,
  });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-focus-'));
  fs.mkdirSync(path.join(dir, 'Downloads'));
  cfg = { work: 25, short: 5, long: 15, longEvery: 4, autoContinue: false, stretchEvery: 50, waterEvery: 90, eyeBreaks: false, nudge: true, distractions: 'youtube, reddit', downloads: true };
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: new Date(2026, 8, 28, 14, 0).getTime() });
});

afterEach(() => {
  mock.timers.reset();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('quiet hours, including ones that wrap past midnight', () => {
  const at = (h, m = 0) => new Date(2026, 8, 28, h, m);
  assert.equal(inQuietHours('23:00', '08:00', at(23, 30)), true);
  assert.equal(inQuietHours('23:00', '08:00', at(7, 59)), true);
  assert.equal(inQuietHours('23:00', '08:00', at(8, 0)), false);
  assert.equal(inQuietHours('23:00', '08:00', at(14)), false);
  assert.equal(inQuietHours('09:00', '17:00', at(12)), true);
  assert.equal(inQuietHours('09:00', '09:00', at(9)), false, 'empty range');
});

test('a pomodoro: focus -> celebrate -> break -> "ready for another?"', () => {
  const f = makeFocus();
  f.startFocus(1);
  assert.equal(f.state.phase, 'focus');
  assert.deepEqual(calls.act.at(-1), { name: 'work' }, 'the character sits down to work');
  assert.equal(calls.overlay.at(-1).phase, 'focus');
  mock.timers.tick(30000);
  f.tick();
  assert.ok(Math.abs(f.remaining() - 30000) < 5);
  mock.timers.tick(30001);
  f.tick();
  assert.equal(f.state.celebrating, true);
  assert.deepEqual(calls.act.at(-1), { name: 'celebrate' });
  assert.match(calls.show.at(-1).say, /1 session today/);
  mock.timers.tick(2600);
  assert.equal(f.state.phase, 'short', 'the break starts after the celebration');
  assert.equal(calls.act.at(-1).name, 'routine', 'stretches on the break');
  mock.timers.tick(5 * 60000 + 10);
  f.tick();
  assert.equal(f.state.phase, 'idle');
  assert.match(calls.show.at(-1).say, /another round/);
  assert.equal(calls.show.at(-1).buttons[0].label, 'Start 🍅');
  assert.deepEqual(f.stats(), { today: 1, minutes: 1, total: 1 });
});

test('every 4th session earns a long break; pause freezes the clock; stop ends it', () => {
  const f = makeFocus();
  f.state.round = 3;
  f.startFocus(1);
  f.pause();
  mock.timers.tick(10 * 60000);
  assert.equal(f.remaining(), 60000, 'paused clock does not move');
  f.resume();
  mock.timers.tick(60001);
  f.tick();
  mock.timers.tick(2600);
  assert.equal(f.state.phase, 'long');
  f.end();
  assert.equal(f.state.phase, 'idle');
  mock.timers.tick(20 * 60000);
  f.tick();
  assert.equal(f.state.phase, 'idle', 'nothing fires after stopping');
});

test('reminders count only time at the PC, and never during focus or fullscreen', () => {
  let full = false;
  const f = makeFocus({ fullscreen: () => full });
  cfg.stretchEvery = 1;
  assert.equal(f.care(30, 5), null);
  assert.equal(f.care(30, 5), 'stretch', 'one active minute -> stretch');
  assert.equal(calls.act.at(-1).name, 'routine');
  f.care(30, 120); // at the PC but idle 2 minutes: doesn't count
  f.care(30, 120);
  assert.equal(f.active.stretch, 0);
  f.care(30, 5);
  f.care(30, 400); // away 5+ minutes = a real break: start over
  assert.equal(f.active.stretch, 0);
  full = true;
  f.care(30, 5);
  assert.equal(f.care(30, 5), null, 'not during fullscreen games or videos');
  full = false;
  f.startFocus(25);
  assert.equal(f.care(30, 5), null, 'not during a focus session');
});

test('eye breaks every 20 minutes, with a 20 second gaze', () => {
  const f = makeFocus();
  cfg.stretchEvery = 0;
  cfg.waterEvery = 0;
  cfg.eyeBreaks = true;
  let r = null;
  for (let i = 0; i < 40 && !r; i++) r = f.care(30, 1);
  assert.equal(r, 'eyes');
  assert.deepEqual(calls.act.at(-1), { name: 'react', kind: 'gaze', dur: 20 });
});

test('a gentle nudge when a distracting app is in front during focus', () => {
  let fg = 'code ("focus.js - Desktop Character")';
  const f = makeFocus({ foreground: () => fg });
  f.startFocus(25);
  const n0 = calls.show.length;
  mock.timers.tick(6 * 60000);
  f.tick();
  assert.equal(calls.show.length, n0, 'working app: no nudge');
  fg = 'chrome ("Funny cats - YouTube")';
  f.tick();
  assert.match(calls.show.at(-1).say, /minutes?/);
  const n1 = calls.show.length;
  mock.timers.tick(60000);
  f.tick();
  assert.equal(calls.show.length, n1, 'at most one nudge per 5 minutes');
});

test('celebrates a finished download once, ignoring browser temp files', () => {
  const f = makeFocus();
  const dl = path.join(dir, 'Downloads');
  fs.writeFileSync(path.join(dl, 'song.mp3.crdownload'), 'x');
  f.maybeDownload('song.mp3.crdownload');
  mock.timers.tick(5000);
  assert.equal(calls.show.length, 0, 'temp file ignored');
  fs.writeFileSync(path.join(dl, 'song.mp3'), 'x'.repeat(1000));
  f.maybeDownload('song.mp3');
  f.maybeDownload('song.mp3'); // watchers fire several times per file
  mock.timers.tick(1300); // first look
  mock.timers.tick(1600); // size unchanged -> done
  assert.equal(calls.show.length, 1);
  assert.match(calls.show[0].say, /song\.mp3/);
  assert.deepEqual(calls.show[0].buttons.map((b) => b.label), ['Open', 'Show in folder']);
  f.maybeDownload('song.mp3');
  mock.timers.tick(5000);
  assert.equal(calls.show.length, 1, 'not twice for the same file');
});
