// Desktop Claude - main process entry point.
import { app, desktopCapturer, globalShortcut, Menu, nativeImage, screen, session, shell, Tray } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Settings } from './settings.js';
import { OverlayManager } from './overlays.js';
import { DesktopWatcher } from './desktopWatcher.js';
import { startHarness } from './harness.js';
import { createAssistantHost } from './assistantHost.js';
import { createEars } from './ears.js';
import { MediaWatcher } from './media.js';
import { Director } from './brain/director.js';
import { Personality } from './brain/personality.js';
import * as w32 from './win32.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const harness = process.argv.includes('--harness') || process.env.CLAUDE_HARNESS === '1';

let settings;
let overlays;
let watcher;
let tray;
let personality;
let media;
let director;
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

app.setAppUserModelId('com.desktopclaude.app');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
if (harness && process.env.CLAUDE_FAKE_MIC) {
  // Tests only: play a WAV file as if it were the microphone.
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-file-for-fake-audio-capture', process.env.CLAUDE_FAKE_MIC);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
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

  personality = new Personality({ root, settings });
  media = new MediaWatcher({ root, watcher });
  media.start();
  const host = createAssistantHost({ root, settings, overlays, watcher, hideFor, personality, getContext: () => pcContext() });
  const ears = createEars({ root, settings, overlays });
  extensions.push(host, ears);
  director = new Director({ ollama: host.ollama, media, ears, whisper: host.whisper, overlays, settings, personality, getFacts: () => host.actions.facts(), log: (m) => console.log(m) });
  director.foreground = foregroundApp;
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
    },
  });

  tray = new Tray(nativeImage.createFromPath(path.join(root, 'assets', 'icon-32.png')).resize({ width: 16, height: 16 }));
  tray.setToolTip('Desktop Claude');
  tray.on('click', () => overlays.sendToBrain('ov:do', { name: 'wave' }));
  refreshTrayMenu();
  settings.on('change', () => {
    overlays.broadcast('ov:settings', settings.all());
    refreshTrayMenu();
  });

  registerHotkeys();
  for (const ext of extensions) await ext.onReady?.({ app, root, settings, overlays, watcher, harness });

  if (harness) {
    const handlers = { state: async () => Object.fromEntries(await Promise.all(extensions.filter((e) => e.state).map(async (e) => [e.name, await e.state()]))) };
    for (const ext of extensions) Object.assign(handlers, ext.harness || {});
    startHarness({ app, overlays, watcher, handlers });
  }
}

async function rebuildOverlays() {
  // Monitors changed: carry Claude's state over into freshly built windows.
  const brain = overlays.brainWindow();
  let state = null;
  try {
    state = brain ? await brain.webContents.executeJavaScript('window.__claudeState ? window.__claudeState() : null', true) : null;
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
        { label: 'Custom (personality.md)', type: 'radio', checked: s.personality === 'custom', click: () => setPersonality('custom') },
        { type: 'separator' },
        { label: 'Edit custom personality…', click: () => shell.openPath(path.join(root, 'personality.md')) },
      ],
    },
    {
      label: 'Size',
      submenu: [scaleItem('Small', 1.0), scaleItem('Medium', 1.4), scaleItem('Large', 1.9)],
    },
    {
      label: 'Settings',
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
          click: (i) => {
            settings.set('startWithWindows', i.checked);
            app.setLoginItemSettings({ openAtLogin: i.checked, path: process.execPath, args: app.isPackaged ? [] : [root] });
          },
        },
        { type: 'separator' },
        { label: 'Open settings file', click: () => shell.openPath(settings.file) },
      ],
    },
    { type: 'separator' },
    { label: hiddenByUser ? 'Show Claude' : 'Hide Claude', accelerator: s.hotkeys?.toggle, click: toggleVisible },
    { label: 'Quit', click: () => app.quit() },
  ];
}

function setPersonality(name) {
  settings.set('personality', name);
  const label = name === 'custom' ? 'my custom personality' : name;
  overlays.sendToBrain('ov:say', { text: `Personality: ${label}! (I’ll act the part when I talk and decide what to do.)`, mood: 'happy' });
  overlays.sendToBrain('ov:do', { name: 'spin' });
}

function refreshTrayMenu() {
  tray?.setContextMenu(Menu.buildFromTemplate(commonMenu()));
}

function showCharacterMenu(win) {
  Menu.buildFromTemplate(commonMenu()).popup({ window: win });
}

export { settings, overlays };
