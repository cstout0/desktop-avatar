import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { appName, findApp, ListenSource, rootOf } from '../src/main/listen.js';

const PROCS = [
  { pid: 4, ppid: 0, name: 'System' },
  { pid: 100, ppid: 4, name: 'explorer.exe' },
  { pid: 200, ppid: 100, name: 'Discord.exe' },
  { pid: 201, ppid: 200, name: 'Discord.exe' },
  { pid: 202, ppid: 200, name: 'Discord.exe' },
  { pid: 300, ppid: 100, name: 'firefox.exe' },
  { pid: 301, ppid: 300, name: 'firefox.exe' },
  { pid: 400, ppid: 100, name: 'ms-teams.exe' },
];

test('rootOf walks up to the main process of the same program', () => {
  assert.equal(rootOf(PROCS, 202), 200);
  assert.equal(rootOf(PROCS, 301), 300);
  assert.equal(rootOf(PROCS, 200), 200, 'already the root');
  assert.equal(rootOf(PROCS, 999), 999, 'unknown pid stays as is');
  // A loop in the parent chain (pids get reused) doesn't hang.
  assert.equal(typeof rootOf([{ pid: 1, ppid: 2, name: 'a.exe' }, { pid: 2, ppid: 1, name: 'a.exe' }], 1), 'number');
});

test('findApp: first matching app in your list order, as its main process', () => {
  assert.deepEqual(findApp(PROCS, 'discord, teams'), { pid: 200, name: 'Discord.exe' });
  assert.deepEqual(findApp(PROCS, 'zoom, teams'), { pid: 400, name: 'ms-teams.exe' });
  assert.equal(findApp(PROCS, 'zoom, skype'), null);
  assert.equal(findApp(PROCS, ''), null);
  assert.equal(appName('ms-teams.exe'), 'Teams');
  assert.equal(appName('Discord.exe'), 'Discord');
  assert.equal(appName('obs64.exe'), 'Obs64');
});

function setup({ source = 'all', callApps = 'discord, teams', active = null, windowPid = 301, procs = PROCS, reactions = true } = {}) {
  const values = { audioReactions: reactions, 'listen.source': source, 'listen.callApps': callApps };
  const settings = Object.assign(new EventEmitter(), { get: (k) => values[k], set: (k, v) => ((values[k] = v), settings.emit('change', k, v)) });
  const sent = [];
  const ears = { ready: Promise.resolve(), send: (ch) => sent.push(ch), setStatus() {} };
  const media = Object.assign(new EventEmitter(), { active, windowFor: (s) => (s ? { hwnd: '55' } : null) });
  const ls = new ListenSource({ settings, ears, media, processList: () => procs, windowPid: () => windowPid, helperDir: 'unused' });
  return { ls, settings, sent, media };
}

test('want: everything, everything but the call app, or only the video app', () => {
  assert.deepEqual(setup().ls.want(), { kind: 'system', label: 'everything your PC plays' });
  assert.deepEqual(setup({ source: 'no-calls' }).ls.want(), { kind: 'app', mode: 'exclude', pid: 200, label: 'everything except Discord' });
  assert.equal(setup({ source: 'no-calls', callApps: 'zoom' }).ls.want().kind, 'system', 'no call app open: everything');
  const video = setup({ source: 'video-app', active: { app: '308046B0AF4A39CB', title: 'A video' } }).ls.want();
  assert.deepEqual(video, { kind: 'app', mode: 'include', pid: 300, label: 'only Firefox' }, 'the window’s process, walked up to the main one');
  assert.equal(setup({ source: 'video-app' }).ls.want().kind, 'none', 'nothing playing: listen to nothing (not the call)');
  // No window found: fall back to the app name from the media session.
  const byName = setup({ source: 'video-app', active: { app: 'Discord.exe' }, windowPid: null }).ls.want();
  assert.equal(byName.pid, 200);
  assert.equal(setup({ source: 'no-calls', reactions: false }).ls.want().kind, 'off');
});

test('switching sources starts and stops the right capture', async () => {
  const { ls, settings, sent } = setup();
  await ls.start();
  await ls.pending;
  assert.deepEqual(sent, ['pcm-end', 'start']);
  assert.equal(ls.state().label, 'everything your PC plays');
  sent.length = 0;
  settings.set('listen.source', 'video-app'); // nothing is playing
  await ls.pending;
  assert.deepEqual(sent, ['pcm-end', 'stop']);
  assert.equal(ls.state().kind, 'none');
  sent.length = 0;
  ls.reconcile(); // nothing changed: nothing restarts
  assert.equal(ls.pending, null);
  assert.deepEqual(sent, []);
  settings.set('audioReactions', false);
  await ls.pending;
  assert.equal(ls.state().kind, 'off');
  ls.stop();
});
