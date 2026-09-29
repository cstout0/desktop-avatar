// Desktop Avatar - main process entry point.
import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, Menu, nativeImage, powerMonitor, screen, session, shell, Tray } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFileLog } from './log.js';
import { Settings } from './settings.js';
import { OverlayManager } from './overlays.js';
import { DesktopWatcher } from './desktopWatcher.js';
import { startHarness } from './harness.js';
import { createAssistantHost } from './assistantHost.js';
import { createEars } from './ears.js';
import { MediaWatcher } from './media.js';
import { Director } from './brain/director.js';
import { Personality } from './brain/personality.js';
import { SettingsWindow } from './settingsWindow.js';
import { Speech } from './speech.js';
import { Focus } from './focus.js';
import { NotifyWatcher, createNotifyReactions } from './notify.js';
import { Games, hideSpots } from './games.js';
import { ListenSource } from './listen.js';
import { WakeWord } from './wake.js';
import { extraHeight, normalizeLook } from '../renderer/overlay/look.js';
import { vendorDir } from './vendor.js';
import * as w32 from './win32.js';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const harness = process.argv.includes('--harness') || process.env.AVATAR_HARNESS === '1';
// Tests can run a throwaway copy of the app (own settings, own single-instance lock).
if (harness && process.env.AVATAR_USER_DATA) app.setPath('userData', process.env.AVATAR_USER_DATA);
if (harness && process.env.AVATAR_DOWNLOADS) app.setPath('downloads', process.env.AVATAR_DOWNLOADS);
let logFile = null;
const displayName = () => settings?.get('name') || 'Desktop Avatar';

let settings;
let overlays;
let watcher;
let tray;
let personality;
let media;
let director;
let settingsUI;
let host;
let quitting = false;

/** "Spotify (Spotify Premium)" - what the user is doing right now (stays on this PC). */
function foregroundApp() {
  try {
    const fg = w32.foregroundInfo();
    if (!fg || fg.pid === process.pid || fg.isShell) return '';
    const proc = w32.processName(fg.pid).replace(/\.exe$/i, '');
    return fg.title ? `${proc} ("${fg.title.slice(0, 80)}")` : proc;
  } catch {
    return '';
  }
}

/** Context for the chat AI: what's playing and what app is in front. */
function pcContext() {
  const lines = [];
  const m = media?.describe();
  if (m) lines.push(`- ${m}`);
  const fg = foregroundApp();
  if (fg) lines.push(`- The user's active app: ${fg}`);
  return lines.join('\n');
}
const extensions = []; // later phases register { onReady, menuItems, state }

export function registerExtension(ext) {
  extensions.push(ext);
}

app.setAppUserModelId('com.desktopavatar.app');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
if (harness && process.env.AVATAR_FAKE_MIC) {
  // Tests only: play a WAV file as if it were the microphone.
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-file-for-fake-audio-capture', process.env.AVATAR_FAKE_MIC);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  logFile = startFileLog(app.getPath('userData'));
  app.on('second-instance', () => overlays?.sendToBrain('ov:say', { text: 'I’m already here! 👋', mood: 'happy' }));
  app.whenReady().then(boot).catch((err) => {
    console.error('boot failed', err);
    app.exit(1);
  });
}

app.on('window-all-closed', () => {
  // Overlays are recreated on display changes; don't quit when they close.
  if (quitting) app.quit();
});

app.on('before-quit', () => {
  quitting = true;
  globalShortcut.unregisterAll();
  watcher?.stop();
  media?.stop();
  director?.stop();
  settings?.flush();
});

async function boot() {
  const ses = session.defaultSession;
  // Mic (voice commands) and system-audio loopback (music reactions) only.
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media' || permission === 'display-capture'));
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'media' || permission === 'display-capture');
  ses.setDisplayMediaRequestHandler((_req, cb) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => cb({ video: sources[0], audio: 'loopback' }))
      .catch(() => cb({}));
  });

  settings = new Settings();
  overlays = new OverlayManager({ root, settings, harness });
  overlays.on('log', (m) => console.log(m));
  await overlays.build();

  watcher = new DesktopWatcher(overlays);
  watcher.start();

  overlays.on('evacuated', () => {
    setTimeout(() => overlays.sendToBrain('ov:say', { text: 'Ooh, fullscreen! I’ll hang out over here.', mood: 'happy' }), 400);
  });
  overlays.on('context-menu', (win, p) => showCharacterMenu(win, p));

  let rebuildTimer = null;
  const rebuild = () => {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(rebuildOverlays, 600);
  };
  screen.on('display-added', rebuild);
  screen.on('display-removed', rebuild);
  screen.on('display-metrics-changed', rebuild);

  personality = new Personality({ root, settings, userDir: app.getPath('userData') });
  media = new MediaWatcher({ root, watcher });
  media.start();
  const ears = createEars({ root, settings, overlays });
  const ui = (status) => settingsUI?.send('status', status);
  const speech = new Speech({ settings, piperDir: vendorDir(root, 'piper'), send: (ch, d) => ears.send(ch, d), onTalk: (t) => overlays.sendToBrain('ov:speaking', t), ui });
  overlays.on('said', (text) => speech.say(text, { source: 'chatter' }));
  host = createAssistantHost({ root, settings, overlays, watcher, hideFor, personality, getContext: () => pcContext(), openSettings: (s) => settingsUI?.open(s), speech, ui });
  extensions.push(host, ears, {
    name: 'speech',
    settingsMeta: () => speech.meta(),
    settingsActions: {
      'test-voice': ({ text }) => speech.say(text, { force: true }),
      'install-piper': ({ voice }) => speech.installPiper(voice),
      shush: () => speech.shush(),
    },
    harness: {
      speak: async ({ text, source = 'app', force = false }) => speech.say(text, { source, force }),
    },
  });
  // Hands-free: say its name ("Pixel, open Spotify").
  const wake = new WakeWord({
    settings,
    ears,
    whisper: host.whisper,
    getName: () => settings.get('name'),
    handle: (text) => host.center.handle(text, { source: 'voice' }),
    onCalled: () => {
      const lines = ['Yes? 👂', 'I’m listening! 👂', 'Hmm? What’s up? 👂'];
      host.center.show({ ok: true, say: lines[Math.floor(Math.random() * lines.length)], mood: 'happy', dur: 8 }, { source: 'voice' });
      overlays.sendToBrain('ov:do', { name: 'listen', on: true });
      setTimeout(() => overlays.sendToBrain('ov:do', { name: 'listen', on: false }), 8000);
    },
    // Not while you're using push-to-talk, or (unless you want it) during a fullscreen game or video.
    paused: () => host.chat.busy || (settings.get('voice.wakeInFullscreen') !== true && overlays.fullscreen.size > 0),
    ui,
    log: (m) => console.log(m),
  });
  ipcMain.on('svc:wake', (_e, m) => wake.onMessage(m));
  extensions.push({
    name: 'wake',
    onReady: () => {
      ears.ready.then(() => wake.start());
    },
    state: () => wake.state(),
    settingsMeta: () => ({ wakeState: wake.state() }),
    harness: {
      'wake-state': async () => wake.state(),
      // Check a recorded phrase as if the microphone had just heard it.
      'wake-phrase': async ({ file }) => {
        let heard = null;
        const got = new Promise((r) => wake.once('heard', r));
        await wake.onMessage({ wav: fs.readFileSync(file) });
        heard = await Promise.race([got, new Promise((r) => setTimeout(() => r(null), 100))]);
        return { heard };
      },
    },
  });

  // What the ears hear: everything, everything but voice chat, or just the video's app.
  const listen = new ListenSource({
    settings,
    ears,
    media,
    processList: () => w32.processList(),
    windowPid: (hwnd) => w32.windowInfo(BigInt(hwnd))?.pid ?? null,
    helperDir: vendorDir(root, 'apploopback'),
    ui,
    log: (m) => console.log(m),
  });
  extensions.push({
    name: 'listen',
    onReady: () => {
      listen.start(); // (not awaited: it waits for the ears window)
    },
    state: () => listen.state(),
    settingsMeta: () => ({ listen: listen.state() }),
    harness: {
      'listen-state': async () => ({ ...listen.state(), want: listen.want() }),
    },
  });
  director = new Director({ ollama: host.ollama, media, ears, whisper: host.whisper, overlays, settings, personality, speech, getFacts: () => host.actions.facts(), log: (m) => console.log(m) });
  director.foreground = foregroundApp;

  const focus = new Focus({
    settings,
    show: (r) => host.center.show(r, { source: 'focus' }),
    act: (cmd) => overlays.sendToBrain('ov:do', cmd),
    overlay: (f) => overlays.sendToBrain('ov:focus', f),
    ui,
    fullscreen: () => overlays.fullscreen.size > 0,
    foreground: foregroundApp,
    dataDir: app.getPath('userData'),
    downloadsDir: app.getPath('downloads'),
    idleSeconds: () => powerMonitor.getSystemIdleTime(),
    shell,
    log: (m) => console.log(m),
  });
  host.actions.attach({ focus });
  extensions.push({
    name: 'focus',
    onReady: () => focus.start(),
    state: () => ({ ...focus.publicState(), stats: focus.stats(), active: focus.active }),
    settingsMeta: () => ({ focus: focus.publicState(), focusStats: focus.stats() }),
    settingsActions: {
      'focus-start': () => focus.startFocus(),
      'focus-stop': () => focus.end(),
      'focus-pause': () => focus.pause(),
      'focus-resume': () => focus.resume(),
      'focus-skip': () => focus.skip(),
    },
    menuItems: () => {
      const f = focus.publicState();
      if (f.phase === 'idle') return [{ label: `🍅 Start focusing (${settings.get('focus.work') ?? 25} min)`, click: () => focus.startFocus() }];
      const left = Math.ceil(f.remaining / 60000);
      return [
        {
          label: `${f.phase === 'focus' ? '🍅 Focus' : '☕ Break'}: ${left} min left${f.paused ? ' (paused)' : ''}`,
          submenu: [
            f.paused ? { label: 'Resume', click: () => focus.resume() } : { label: 'Pause', click: () => focus.pause() },
            { label: f.phase === 'focus' ? 'Skip to break' : 'Skip break', click: () => focus.skip() },
            { label: 'Stop', click: () => focus.end() },
          ],
        },
      ];
    },
    harness: {
      'focus-start': async ({ minutes } = {}) => focus.startFocus(minutes),
      'focus-state': async () => focus.publicState(),
      'focus-care': async ({ secs = 30, idle = 0 } = {}) => focus.care(secs, idle),
      'focus-download': async ({ file }) => focus.maybeDownload(file),
    },
  });
  // The tray shows the minutes left.
  focus.on('change', (_f, changed) => (changed ? refreshTrayMenu() : refreshTrayMenuSoon()));

  // Mini-games (fetch, hide and seek).
  const games = new Games({
    settings,
    overlays,
    windows: () =>
      watcher.windows
        .map((w) => ({ hwnd: String(w.hwnd), ...watcher.lastRects.get(String(w.hwnd)) }))
        .filter((w) => w.left != null)
        .map((w) => ({ hwnd: w.hwnd, x1: w.left, y1: w.top, x2: w.right, y2: w.bottom })),
    rectOf: (hwnd) => {
      const info = w32.windowInfo(BigInt(hwnd));
      const r = watcher.lastRects.get(String(hwnd));
      return info && !info.minimized && r && watcher.windows.some((w) => String(w.hwnd) === String(hwnd)) ? { x1: r.left, y1: r.top, x2: r.right, y2: r.bottom } : null;
    },
    lift: () => extraHeight(normalizeLook(settings.get('look'))),
    log: (m) => console.log(m),
  });
  host.actions.attach({ games });
  // Games and focus sessions keep the AI (and the health reminders) from barging in.
  director.busy = () => focus.state.phase === 'focus' || focus.quiet() || !!games.active;
  focus.busy = () => !!games.active;
  extensions.push({
    name: 'games',
    state: () => ({ active: games.active }),
    settingsActions: {
      play: ({ game }) => games.start(game),
      'stop-game': () => games.stop(),
    },
    menuItems: () => [
      {
        label: '🎮 Play',
        submenu: [
          { label: 'Fetch 🎾', click: () => games.start('fetch') },
          { label: 'Hide and seek 🙈', click: () => games.start('hide') },
          { label: 'Boxing pop-ups 🥊', click: () => games.start('boxing') },
          ...(games.active ? [{ type: 'separator' }, { label: 'Stop the game', click: () => games.stop() }] : []),
        ],
      },
    ],
    harness: {
      'game-start': async ({ game }) => games.start(game),
      'game-stop': async () => games.stop(),
      'hide-spots': async () => hideSpots({ windows: games.windows(), regions: overlays.regions(), scale: settings.get('scale') ?? 1.4, lift: games.lift() }),
    },
  });

  // Apps that want your attention (taskbar flash, unread counts).
  const notifyWatcher = new NotifyWatcher({
    watcher,
    makeWindow: () => new BrowserWindow({ show: false, width: 1, height: 1, skipTaskbar: true, focusable: false, webPreferences: { sandbox: true } }),
    log: (m) => console.log(m),
  });
  const reactToPing = createNotifyReactions({
    settings,
    overlays,
    show: (r) => host.center.show(r, { source: 'notify' }),
    focusActive: () => focus.state.phase === 'focus',
    quiet: () => focus.quiet(),
    isForeground: (pid) => w32.foregroundInfo()?.pid === pid,
    windowRect: (hwnd) => {
      const info = w32.windowInfo(BigInt(hwnd));
      const r = watcher.lastRects.get(String(hwnd));
      return info && !info.minimized && r ? { x1: r.left, y1: r.top, x2: r.right, y2: r.bottom } : null;
    },
  });
  notifyWatcher.on('ping', (p) => {
    const style = reactToPing(p);
    console.log(`[notify] ${p.kind} from ${p.app}${p.count ? ` (${p.count})` : ''} -> ${style ?? 'ignored'}`);
  });
  extensions.push({
    name: 'notify',
    onReady: () => notifyWatcher.start(),
    settingsActions: {
      'test-notify': () => reactToPing({ hwnd: '0', pid: 0, process: 'Discord.exe', app: 'Discord', title: 'Discord', kind: 'flash' }, { force: true }),
    },
    harness: {
      'notify-ping': async (p) => reactToPing(p, { force: !!p.force }),
      'notify-window': async ({ hwnd, kind = 'flash' }) => notifyWatcher.fromWindow(BigInt(hwnd), kind),
    },
  });
  extensions.push({
    name: 'director',
    onReady: () => director.start(),
    state: () => ({ watching: director.watching ? { title: director.watching.session.title, transcript: director.watching.transcript, comments: director.watching.comments, area: director.watching.area } : null, media: media.active, sessions: media.sessions, recent: director.recent }),
    harness: {
      'media-inject': async ({ sessions }) => {
        media.inject(sessions);
        return media.active;
      },
      'director-decide': async () => director.decide(overlays.lastReport ?? {}),
      'director-tick': async () => {
        // Run the "what do I do next?" loop now instead of in a few minutes.
        director.lastDecision = 0;
        await director.tick();
        return director.recent.at(-1) ?? null;
      },
      'settings-set': async ({ key, value }) => {
        settings.set(key, value);
        return settings.get(key);
      },
      'set-personality': async ({ name }) => {
        setPersonality(name);
        return { personality: settings.get('personality'), text: personality.text().slice(0, 160), file: personality.file() };
      },
      'tray-menu': async () => commonMenu().map((i) => i.label ?? i.type),
      'start-with-windows': async ({ on }) => setStartWithWindows(!!on),
      'open-settings': async ({ section, inactive = false, x, y } = {}) => {
        await settingsUI.open(section, { inactive, at: x != null ? { x, y } : null });
        return true;
      },
      'close-settings': async () => settingsUI.close(),
      'settings-eval': async ({ js }) => settingsUI.win?.webContents.executeJavaScript(js, true),
      // Run a Settings-window button without the window (same handlers).
      'settings-action': async ({ name, arg }) => settingsUI.actions()[name]?.(arg),
      'settings-capture': async ({ file }) => {
        const img = await settingsUI.win.webContents.capturePage();
        fs.writeFileSync(file, img.toPNG());
        return img.getSize();
      },
    },
  });
  extensions.push(coreExtension());
  settingsUI = new SettingsWindow({ root, settings, extensions });

  tray = new Tray(nativeImage.createFromPath(path.join(root, 'assets', 'icon-32.png')).resize({ width: 16, height: 16 }));
  tray.on('click', () => overlays.sendToBrain('ov:do', { name: 'wave' }));
  tray.on('double-click', () => settingsUI.open());
  refreshTrayMenu();
  settings.on('change', () => {
    overlays.broadcast('ov:settings', settings.all());
    refreshTrayMenu();
  });

  registerHotkeys();
  for (const ext of extensions) await ext.onReady?.({ app, root, settings, overlays, watcher, harness });

  // The tray icon, chat face and Settings window icon wear its current look.
  let lastIcons = null;
  const refreshIcons = async () => {
    try {
      const urls = await ears.renderIcons(normalizeLook(settings.get('look')));
      if (!urls) return;
      const img = nativeImage.createEmpty();
      for (const [scaleFactor, size] of [[1, 16], [1.25, 20], [1.5, 24], [2, 32]]) img.addRepresentation({ scaleFactor, dataURL: urls[size] });
      tray.setImage(img);
      host.chat.setFace(urls.face);
      settingsUI.setIcon(nativeImage.createFromDataURL(urls[256]));
      lastIcons = urls;
    } catch (err) {
      console.log(`[icons] ${err.message}`);
    }
  };
  let iconTimer = null;
  settings.on('change', (key) => {
    if (key !== '*' && !String(key).startsWith('look')) return;
    clearTimeout(iconTimer);
    iconTimer = setTimeout(refreshIcons, 300);
  });
  refreshIcons();
  registerExtension({ name: 'icons', harness: { icons: async () => (await refreshIcons(), lastIcons) } });

  if (harness) {
    const handlers = { state: async () => Object.fromEntries(await Promise.all(extensions.filter((e) => e.state).map(async (e) => [e.name, await e.state()]))) };
    for (const ext of extensions) Object.assign(handlers, ext.harness || {});
    startHarness({ app, overlays, watcher, handlers });
  }
}

async function rebuildOverlays() {
  // Monitors changed: carry the character's state over into freshly built windows.
  const brain = overlays.brainWindow();
  let state = null;
  try {
    state = brain ? await brain.webContents.executeJavaScript('window.__avatarState ? window.__avatarState() : null', true) : null;
  } catch {
    state = null;
  }
  overlays.destroyAll();
  await overlays.build(state);
}

// If a hotkey is already taken by another app, fall back to the next free one.
const HOTKEY_FALLBACKS = {
  chat: ['Control+Alt+C', 'Control+Shift+Space', 'Control+Alt+K'],
  voice: ['Control+Alt+V', 'Control+Alt+J', 'Control+Alt+Q'],
  toggle: ['Control+Alt+H'],
};
export const activeHotkeys = {};

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const hk = settings.get('hotkeys') || {};
  const bindAs = (name, fn) => {
    const tries = [hk[name], ...(HOTKEY_FALLBACKS[name] ?? [])].filter((x, i, a) => x && a.indexOf(x) === i);
    for (const accel of tries) {
      try {
        if (globalShortcut.register(accel, fn)) {
          activeHotkeys[name] = accel;
          if (accel !== hk[name]) console.log(`hotkey ${hk[name]} is taken by another app; using ${accel} for ${name}`);
          return accel;
        }
      } catch (err) {
        console.log(`bad hotkey ${accel}: ${err.message}`);
      }
    }
    console.log(`no free hotkey for ${name}`);
    return null;
  };
  bindAs('toggle', toggleVisible);
  for (const ext of extensions) ext.hotkeys?.(bindAs);
}

let hiddenByUser = false;
let unhideTimer = null;
function setHidden(hide) {
  hiddenByUser = hide;
  clearTimeout(unhideTimer);
  for (const e of overlays.wins.values()) {
    if (hiddenByUser) e.win.hide();
    else if (!e.hidden) e.win.showInactive();
  }
  refreshTrayMenu();
}
function toggleVisible() {
  setHidden(!hiddenByUser);
}
function hideFor(ms) {
  setTimeout(() => {
    setHidden(true);
    unhideTimer = setTimeout(() => {
      setHidden(false);
      overlays.sendToBrain('ov:say', { text: 'I’m back! 👋', mood: 'happy' });
    }, ms);
  }, 1800);
}

function scaleItem(label, value) {
  return { label, type: 'radio', checked: Math.abs((settings.get('scale') ?? 1.4) - value) < 0.01, click: () => settings.set('scale', value) };
}

function commonMenu() {
  const s = settings.all();
  const extItems = extensions.flatMap((e) => e.menuItems?.() ?? []);
  return [
    ...extItems,
    ...(extItems.length ? [{ type: 'separator' }] : []),
    {
      label: 'Do something',
      submenu: [
        { label: 'Dance', click: () => overlays.sendToBrain('ov:do', { name: 'dance' }) },
        { label: 'Wave', click: () => overlays.sendToBrain('ov:do', { name: 'wave' }) },
        { label: 'Backflip', click: () => overlays.sendToBrain('ov:do', { name: 'flip' }) },
        { label: 'Come here', click: () => overlays.sendToBrain('ov:do', { name: 'come' }) },
        { label: 'Follow my cursor', click: () => overlays.sendToBrain('ov:do', { name: 'follow' }) },
        { label: 'Sit', click: () => overlays.sendToBrain('ov:do', { name: 'sit' }) },
        { label: 'Take a nap', click: () => overlays.sendToBrain('ov:do', { name: 'sleep' }) },
      ],
    },
    {
      label: 'Personality',
      submenu: [
        ...(personality?.presets() ?? []).map((name) => ({
          label: name[0].toUpperCase() + name.slice(1),
          type: 'radio',
          checked: (s.personality || 'cheerful') === name,
          click: () => setPersonality(name),
        })),
        { label: 'Custom (your own)', type: 'radio', checked: s.personality === 'custom', click: () => setPersonality('custom') },
        { type: 'separator' },
        { label: 'Edit custom personality…', click: () => shell.openPath(personality.file('custom')) },
      ],
    },
    {
      label: 'Size',
      submenu: [scaleItem('Small', 1.0), scaleItem('Medium', 1.4), scaleItem('Large', 1.9)],
    },
    { type: 'separator' },
    { label: 'Settings…', click: () => settingsUI.open() },
    { label: 'Wardrobe…', click: () => settingsUI.open('wardrobe') },
    {
      label: 'Quick settings',
      submenu: [
        { label: 'React to music & sounds', type: 'checkbox', checked: s.audioReactions, click: (i) => settings.set('audioReactions', i.checked) },
        { label: 'Watch videos with me', type: 'checkbox', checked: s.watchAlong !== false, click: (i) => settings.set('watchAlong', i.checked) },
        { label: 'Let the AI decide what I do', type: 'checkbox', checked: s.aiDirector !== false, click: (i) => settings.set('aiDirector', i.checked) },
        { label: 'Climb on windows', type: 'checkbox', checked: s.walkOnWindows, click: (i) => settings.set('walkOnWindows', i.checked) },
        {
          label: 'Chattiness',
          submenu: ['quiet', 'normal', 'chatty'].map((v) => ({ label: v[0].toUpperCase() + v.slice(1), type: 'radio', checked: s.chattiness === v, click: () => settings.set('chattiness', v) })),
        },
        {
          label: 'Start with Windows',
          type: 'checkbox',
          checked: s.startWithWindows,
          click: (i) => setStartWithWindows(i.checked),
        },
        { type: 'separator' },
        { label: 'Open settings file', click: () => shell.openPath(settings.file) },
        { label: 'Open log file', click: () => logFile && shell.openPath(logFile) },
      ],
    },
    { type: 'separator' },
    { label: `${hiddenByUser ? 'Show' : 'Hide'} ${displayName()}`, accelerator: s.hotkeys?.toggle, click: toggleVisible },
    { label: 'Quit', click: () => app.quit() },
  ];
}

/** Settings-window hooks that belong to the app itself (files, hotkeys, startup...). */
function coreExtension() {
  const pathFor = (what) => {
    if (what === 'settings') return settings.file;
    if (what === 'log') return logFile;
    if (what === 'data') return app.getPath('userData');
    if (what === 'notes') {
      const f = host.actions.notesFile();
      if (!fs.existsSync(f)) fs.writeFileSync(f, `Notes from ${displayName()}\n\n`, 'utf8');
      return f;
    }
    if (what === 'personality') return personality.file('custom');
    throw new Error(`unknown file: ${what}`);
  };
  return {
    name: 'core',
    settingsMeta: () => ({
      version: app.getVersion(),
      packaged: app.isPackaged,
      hotkeys: { ...activeHotkeys },
      personalities: personality.describe(),
      customPersonality: personality.customText(),
    }),
    settingsActions: {
      'set-personality': ({ name }) => setPersonality(name),
      'save-custom-personality': ({ text }) => {
        personality.saveCustom(text);
        if (settings.get('personality') !== 'custom') settings.set('personality', 'custom');
        return true;
      },
      open: ({ what }) => shell.openPath(pathFor(what)),
      'set-hotkey': ({ name, accel }) => setHotkey(name, accel),
      'start-with-windows': ({ on }) => setStartWithWindows(!!on),
      'reset-settings': () => {
        settings.reset(['name']);
        registerHotkeys();
        return true;
      },
    },
  };
}

/** Change a global shortcut; refuses ones another app already owns. */
function setHotkey(name, accel) {
  if (!['chat', 'voice', 'toggle'].includes(name)) throw new Error(`unknown shortcut: ${name}`);
  const hk = { ...settings.get('hotkeys') };
  const prev = hk[name];
  if (Object.entries(hk).some(([k, v]) => k !== name && v === accel)) throw new Error('That shortcut is already used for something else here.');
  settings.set('hotkeys', { ...hk, [name]: accel });
  registerHotkeys();
  if (activeHotkeys[name] !== accel) {
    settings.set('hotkeys', { ...hk, [name]: prev });
    registerHotkeys();
    throw new Error(`${accel.replace(/Control/g, 'Ctrl')} is taken by another app. Try another one.`);
  }
  refreshTrayMenu();
  return { accel };
}

const LOGIN_ITEM = () => ({ name: 'Desktop Avatar', path: process.execPath, args: app.isPackaged ? [] : [root] });

function setStartWithWindows(on) {
  settings.set('startWithWindows', on);
  app.setLoginItemSettings({ ...LOGIN_ITEM(), openAtLogin: on });
  return on;
}

function setPersonality(name) {
  if (name !== 'custom' && !personality.presets().includes(name)) throw new Error(`unknown personality: ${name}`);
  settings.set('personality', name);
  const label = name === 'custom' ? 'my custom personality' : name;
  overlays.sendToBrain('ov:say', { text: `Personality: ${label}! (I’ll act the part when I talk and decide what to do.)`, mood: 'happy' });
  overlays.sendToBrain('ov:do', { name: 'spin' });
}

// Rebuilding the tray menu every second would be wasteful; once a minute is plenty for "12 min left".
let trayRefreshAt = 0;
function refreshTrayMenuSoon() {
  if (Date.now() - trayRefreshAt > 30000) refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray) return;
  trayRefreshAt = Date.now();
  tray.setToolTip(settings.get('name') ? `${settings.get('name')} · Desktop Avatar` : 'Desktop Avatar');
  tray.setContextMenu(Menu.buildFromTemplate(commonMenu()));
}

function showCharacterMenu(win) {
  Menu.buildFromTemplate(commonMenu()).popup({ window: win });
}

export { settings, overlays };
