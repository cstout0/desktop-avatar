import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePlatforms } from '../src/main/platforms.js';
import { fullscreenMonitors } from '../src/main/fullscreen.js';

const regions = [
  { id: 1, x: 0, y: 0, w: 2560, h: 1440 },
  { id: 2, x: 2560, y: 0, w: 2560, h: 1440 },
];

test('window top edges become platforms', () => {
  const p = computePlatforms([{ hwnd: 'a', left: 100, top: 300, right: 900, bottom: 800 }], regions);
  assert.deepEqual(p, [{ id: 'a#0', win: 'a', x1: 100, x2: 900, y: 300, wx: 100 }]);
});

test('a window in front hides part of the edge behind it', () => {
  const wins = [
    { hwnd: 'front', left: 400, top: 200, right: 600, bottom: 700 },
    { hwnd: 'back', left: 100, top: 300, right: 900, bottom: 800 },
  ];
  const p = computePlatforms(wins, regions);
  const back = p.filter((x) => x.win === 'back').map((x) => [x.x1, x.x2]);
  assert.deepEqual(back, [
    [100, 400],
    [600, 900],
  ]);
});

test('edges too close to the top of the screen or off-screen are ignored', () => {
  const p = computePlatforms(
    [
      { hwnd: 'max', left: -8, top: -8, right: 2568, bottom: 1448 },
      { hwnd: 'hi', left: 100, top: 40, right: 500, bottom: 400 },
      { hwnd: 'off', left: 100, top: 2000, right: 500, bottom: 2400 },
    ],
    regions,
  );
  assert.equal(p.length, 0);
});

test('a window spanning two monitors gives one merged ledge', () => {
  const p = computePlatforms([{ hwnd: 'wide', left: 2000, top: 500, right: 3200, bottom: 900 }], regions);
  assert.equal(p.length, 1);
  assert.equal(p[0].x1, 2000);
  assert.equal(p[0].x2, 3200);
});

test('hidden (fullscreen) monitors provide no ledges', () => {
  const p = computePlatforms([{ hwnd: 'w', left: 2800, top: 500, right: 3400, bottom: 900 }], [regions[0]]);
  assert.equal(p.length, 0);
});

// ---- climbable window sides ----------------------------------------------------------

import { computeEdges } from '../src/main/platforms.js';

test('both sides of a window are climbable', () => {
  const e = computeEdges([{ hwnd: 'spotify', left: 800, top: 300, right: 1800, bottom: 1100 }], regions);
  assert.equal(e.length, 2);
  const left = e.find((x) => x.face === 1);
  const right = e.find((x) => x.face === -1);
  assert.deepEqual([left.x, left.y1, left.y2], [800, 300, 1100]);
  assert.deepEqual([right.x, right.y1, right.y2], [1800, 300, 1100]);
  assert.equal(left.key, 'spotifyL');
});

test('a window in front hides part of a side', () => {
  const wins = [
    { hwnd: 'front', left: 700, top: 500, right: 1000, bottom: 700 },
    { hwnd: 'back', left: 800, top: 300, right: 1800, bottom: 1100 },
  ];
  const left = computeEdges(wins, regions).filter((x) => x.win === 'back' && x.face === 1);
  assert.deepEqual(
    left.map((x) => [x.y1, x.y2]),
    [
      [300, 500],
      [700, 1100],
    ],
  );
});

test('no side to hang on when the window touches the screen edge', () => {
  const e = computeEdges([{ hwnd: 'w', left: 0, top: 300, right: 900, bottom: 1100 }], [regions[0]]);
  assert.deepEqual(
    e.map((x) => x.face),
    [-1],
  );
});

// ---- fullscreen ------------------------------------------------------------------

const WS_CAPTION = 0x00c00000;
const WS_POPUP = 0x80000000;
const monitors = [
  { id: 1, rect: { left: 0, top: 0, right: 2560, bottom: 1440 } },
  { id: 2, rect: { left: 2560, top: 0, right: 5120, bottom: 1440 } },
];
const base = { monitors, windows: [], fg: null, quns: 5, ownPid: 999 };

test('borderless fullscreen game in the foreground on monitor 2', () => {
  const game = { pid: 5, rect: { left: 2560, top: 0, right: 5120, bottom: 1440 }, monitorRect: monitors[1].rect, style: WS_POPUP, exStyle: 0, className: 'UnityWndClass' };
  const fs = fullscreenMonitors({ ...base, fg: game, windows: [game] });
  assert.deepEqual([...fs], [2]);
});

test('a maximized normal window (auto-hide taskbar) is NOT fullscreen', () => {
  const max = { pid: 5, rect: { left: -8, top: -8, right: 2568, bottom: 1448 }, monitorRect: monitors[0].rect, style: WS_CAPTION, exStyle: 0, className: 'Chrome_WidgetWin_1', zoomed: true };
  const fs = fullscreenMonitors({ ...base, fg: max, windows: [max] });
  assert.equal(fs.size, 0);
});

test('fullscreen video stays detected after clicking a window on the other monitor', () => {
  const video = { pid: 7, rect: { left: 0, top: 0, right: 2560, bottom: 1440 }, style: WS_POPUP, exStyle: 0, className: 'Chrome_WidgetWin_1' };
  const discord = { pid: 8, rect: { left: 2800, top: 200, right: 4200, bottom: 1200 }, monitorRect: monitors[1].rect, style: WS_CAPTION, exStyle: 0, className: 'Chrome_WidgetWin_1' };
  const fs = fullscreenMonitors({ ...base, fg: discord, windows: [discord, video] });
  assert.deepEqual([...fs], [1]);
});

test('alt-tabbing to a big window on top of the game frees that monitor', () => {
  const game = { pid: 5, rect: { left: 0, top: 0, right: 2560, bottom: 1440 }, style: WS_POPUP, exStyle: 0, className: 'Game' };
  const browser = { pid: 9, rect: { left: -8, top: -8, right: 2568, bottom: 1448 }, monitorRect: monitors[0].rect, style: WS_CAPTION, exStyle: 0, className: 'Chrome_WidgetWin_1', zoomed: true };
  const fs = fullscreenMonitors({ ...base, fg: browser, windows: [browser, game] });
  assert.equal(fs.size, 0);
});

test('a small always-on-top window over a fullscreen video does not free the monitor', () => {
  const video = { pid: 7, rect: { left: 0, top: 0, right: 2560, bottom: 1440 }, style: WS_POPUP, exStyle: 0, className: 'Chrome_WidgetWin_1' };
  const pip = { pid: 3, rect: { left: 1900, top: 1000, right: 2500, bottom: 1400 }, style: WS_CAPTION, exStyle: 0x8, className: 'Pip' };
  const fs = fullscreenMonitors({ ...base, windows: [pip, video] });
  assert.deepEqual([...fs], [1]);
});

test('our own overlay windows never count', () => {
  const own = { pid: 999, rect: { left: 0, top: 0, right: 2560, bottom: 1440 }, monitorRect: monitors[0].rect, style: WS_POPUP, exStyle: 0x8, className: 'Chrome_WidgetWin_1', isShell: false };
  const fs = fullscreenMonitors({ ...base, fg: own, windows: [] });
  assert.equal(fs.size, 0);
});

test('the desktop itself is not fullscreen', () => {
  const desk = { pid: 1, rect: { left: 0, top: 0, right: 5120, bottom: 1440 }, monitorRect: monitors[0].rect, style: WS_POPUP, exStyle: 0, className: 'Progman', isShell: true };
  const fs = fullscreenMonitors({ ...base, fg: desk, windows: [desk] });
  assert.equal(fs.size, 0);
});

test('Windows reports a fullscreen app (QUNS busy) even with a caption style', () => {
  const uwp = { pid: 4, rect: { left: 2560, top: 0, right: 5120, bottom: 1440 }, monitorRect: monitors[1].rect, style: WS_CAPTION, exStyle: 0, className: 'ApplicationFrameWindow' };
  const fs = fullscreenMonitors({ ...base, fg: uwp, windows: [uwp], quns: 2 });
  assert.deepEqual([...fs], [2]);
});
