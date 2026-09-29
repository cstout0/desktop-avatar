import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NotifyWatcher, appLabel, createNotifyReactions, unreadCount } from '../src/main/notify.js';

test('unread counts in window titles', () => {
  assert.equal(unreadCount('(3) Discord'), 3);
  assert.equal(unreadCount('Inbox (12) - you@mail.com - Mail'), 12);
  assert.equal(unreadCount('#general | (2) Server - Discord'), 2);
  assert.equal(unreadCount('Discord'), null);
  assert.equal(unreadCount('Report (2019).pdf - Acrobat'), null, 'years are not counts');
  assert.equal(unreadCount('Untitled (1).txt - Notepad'), null, 'file copies are not counts');
});

test('app labels', () => {
  assert.equal(appLabel('Discord.exe'), 'Discord');
  assert.equal(appLabel('msedge.exe'), 'Edge');
  assert.equal(appLabel('mytool.exe'), 'Mytool');
});

test('a rising unread count pings once; the first sighting does not', () => {
  const windows = [{ hwnd: 11n, title: '(1) Discord' }];
  const pings = [];
  const w = new NotifyWatcher({ watcher: { windows }, ownPid: 1, windowInfo: (h) => ({ pid: 42, title: 'x', process: 'Discord.exe' }) });
  w.on('ping', (p) => pings.push(p));
  w.pollTitles();
  assert.equal(pings.length, 0, 'already had 1 unread when we started');
  windows[0].title = '(3) Discord';
  w.pollTitles();
  assert.equal(pings.length, 1);
  assert.deepEqual({ app: pings[0].app, kind: pings[0].kind, count: pings[0].count }, { app: 'Discord', kind: 'badge', count: 3 });
  windows[0].title = '(2) Discord';
  w.pollTitles();
  windows[0].title = 'Discord';
  w.pollTitles();
  assert.equal(pings.length, 1, 'reading messages (count going down) is not a ping');
});

test('our own windows never ping', () => {
  const pings = [];
  const w = new NotifyWatcher({ watcher: { windows: [] }, ownPid: 7, windowInfo: () => ({ pid: 7, title: 'me', process: 'electron.exe' }) });
  w.on('ping', (p) => pings.push(p));
  w.fromWindow(5n, 'flash');
  assert.equal(pings.length, 0);
});

function reactor(over = {}) {
  const log = { shown: [], sent: [] };
  const cfg = { enabled: true, style: 'peek', ignore: 'outlook', duringFocus: false, ...over.cfg };
  const react = createNotifyReactions({
    settings: { get: (k) => (k === 'notify' ? cfg : undefined) },
    overlays: { fullscreen: new Set(over.fullscreen ?? []), sendToBrain: (ch, d) => log.sent.push([ch, d]) },
    show: (r) => log.shown.push(r),
    focusActive: () => !!over.focus,
    isForeground: (pid) => pid === over.fgPid,
    windowRect: () => ({ x1: 100, y1: 100, x2: 500, y2: 400 }),
  });
  return { react, log, cfg };
}

const ping = (app = 'Discord', pid = 42) => ({ hwnd: '11', pid, process: `${app}.exe`, app, title: app, kind: 'flash' });

test('peek: looks at the window and points it out, with a button to show it', () => {
  const { react, log } = reactor();
  assert.equal(react(ping()), 'peek');
  assert.deepEqual(log.sent[0], ['ov:do', { name: 'peek', x: 300, y: 140 }]);
  assert.match(log.shown[0].say, /Discord/);
  assert.equal(log.shown[0].buttons[0].label, 'Show Discord');
});

test('walk over, or just say it', () => {
  const walk = reactor({ cfg: { style: 'walk' } });
  walk.react(ping());
  assert.equal(walk.log.sent[0][1].name, 'visit');
  const say = reactor({ cfg: { style: 'say' } });
  say.react(ping());
  assert.equal(say.log.sent.length, 0);
  assert.equal(say.log.shown.length, 1);
});

test('stays quiet when it should', () => {
  assert.equal(reactor({ cfg: { enabled: false } }).react(ping()), null, 'turned off');
  assert.equal(reactor().react(ping('Outlook')), null, 'ignored app');
  assert.equal(reactor({ focus: true }).react(ping()), null, 'during focus');
  assert.equal(reactor({ focus: true, cfg: { duringFocus: true } }).react(ping()), 'peek', 'unless allowed during focus');
  assert.equal(reactor({ fullscreen: [1] }).react(ping()), null, 'fullscreen game or video');
  assert.equal(reactor({ fgPid: 42 }).react(ping()), null, 'you are already looking at it');
  const r = reactor();
  assert.equal(r.react(ping()), 'peek');
  assert.equal(r.react(ping()), null, 'not twice in a row');
  assert.equal(r.react(ping('Slack', 43)), null, 'at most one reaction every 15 s');
});
