// The Settings window (the character's "room"): every option in one place, with
// a live preview of the character. Feature modules contribute actions (buttons
// like "Test voice" or "Play fetch") and status info through `extensions`.
import { BrowserWindow, ipcMain, nativeTheme } from 'electron';
import path from 'node:path';

export class SettingsWindow {
  /**
   * @param opts.root        app folder
   * @param opts.settings    Settings
   * @param opts.extensions  [{ settingsMeta?(): object|Promise, settingsActions?: { [name]: (arg) => any } }]
   */
  constructor({ root, settings, extensions }) {
    this.root = root;
    this.settings = settings;
    this.extensions = extensions;
    this.win = null;
    ipcMain.handle('set:get', async () => ({ settings: settings.all(), meta: await this.meta() }));
    ipcMain.handle('set:meta', async () => this.meta());
    ipcMain.handle('set:set', (_e, key, value) => {
      if (typeof key !== 'string' || !/^[\w.]+$/.test(key)) throw new Error('bad settings key');
      settings.set(key, value);
      return settings.get(key);
    });
    ipcMain.handle('set:action', async (_e, name, arg) => {
      const fn = this.actions()[name];
      if (!fn) throw new Error(`unknown action: ${name}`);
      return (await fn(arg)) ?? null;
    });
    settings.on('change', () => this.send('changed', settings.all()));
  }

  actions() {
    return Object.assign({}, ...this.extensions.map((e) => e.settingsActions ?? {}));
  }

  async meta() {
    const parts = await Promise.all(this.extensions.map(async (e) => (e.settingsMeta ? e.settingsMeta() : {})));
    return Object.assign({}, ...parts);
  }

  get visible() {
    return !!this.win && !this.win.isDestroyed() && this.win.isVisible();
  }

  send(ch, data) {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(`set:${ch}`, data);
  }

  /** Open (or focus) the window, optionally on a section: buddy, wardrobe, voice, senses, focus, play, brain, app. */
  /**
   * @param section  sidebar section to show
   * @param opts.inactive  show without taking focus (tests)
   * @param opts.at        { x, y } top-left position (tests)
   */
  async open(section, { inactive = false, at = null } = {}) {
    const reveal = () => {
      if (inactive) this.win.showInactive();
      else {
        this.win.show();
        this.win.focus();
      }
    };
    if (this.win && !this.win.isDestroyed()) {
      if (this.win.isMinimized()) this.win.restore();
      if (at) this.win.setPosition(at.x, at.y);
      reveal();
      if (section) this.send('section', section);
      return this.win;
    }
    const dark = nativeTheme.shouldUseDarkColors;
    this.win = new BrowserWindow({
      ...(at ? { x: at.x, y: at.y } : {}),
      width: 1080,
      height: 760,
      minWidth: 860,
      minHeight: 600,
      show: false,
      title: 'Desktop Avatar settings',
      icon: this.icon ?? path.join(this.root, 'assets', 'icon.ico'),
      backgroundColor: dark ? '#1C1816' : '#FBF4EC',
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: dark ? '#1C1816' : '#FBF4EC', symbolColor: dark ? '#F3E6DC' : '#4A2317', height: 40 },
      webPreferences: { preload: path.join(this.root, 'src/preload/settings.cjs'), spellcheck: true },
    });
    this.win.removeMenu();
    this.win.on('closed', () => {
      this.win = null;
    });
    this.win.webContents.on('console-message', (e) => {
      if (e.level === 'error' || e.level === 'warning') console.log(`[settings] ${e.message} ${e.sourceId ?? ''}:${e.lineNumber ?? ''}`);
    });
    await this.win.loadFile(path.join(this.root, 'src/renderer/settings/index.html'), { query: section ? { section } : {} });
    reveal();
    return this.win;
  }

  close() {
    if (this.win && !this.win.isDestroyed()) this.win.close();
  }

  /** The window/taskbar icon: its head in the current look (a nativeImage). */
  setIcon(img) {
    this.icon = img;
    if (this.win && !this.win.isDestroyed()) this.win.setIcon(img);
  }
}
