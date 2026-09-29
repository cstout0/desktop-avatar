// The little chat box that pops up above the character's head. It also asks
// for the character's name on first run ("name" mode).
import { BrowserWindow, ipcMain, screen } from 'electron';
import { EventEmitter } from 'node:events';
import path from 'node:path';

const W = 540;
const H = 100;

export class ChatWindow extends EventEmitter {
  constructor({ root }) {
    super();
    this.root = root;
    this.win = null;
    this.history = [];
    this.visible = false;
    this.status = null;
    this.mode = 'chat';
    // Payload: the text, or { text, voice } when it came from the microphone.
    ipcMain.on('chat:submit', (_e, payload) => {
      const voice = typeof payload === 'object' && !!payload?.voice;
      const t = String((typeof payload === 'object' ? payload?.text : payload) ?? '').trim().slice(0, 500);
      if (!t) return;
      if (this.mode === 'name') {
        this.emit('name', t); // the host checks it, then hides the box
        return;
      }
      if (this.history.at(-1) !== t) this.history.push(t);
      if (this.history.length > 50) this.history.shift();
      this.hide('submit');
      this.emit('submit', t, { voice });
    });
    ipcMain.on('chat:cancel', () => this.hide('cancel'));
    ipcMain.on('chat:mic', () => this.emit('mic'));
  }

  async create() {
    this.win = new BrowserWindow({
      width: W,
      height: H,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      title: 'Desktop Avatar chat',
      webPreferences: { preload: path.join(this.root, 'src/preload/chat.cjs'), spellcheck: true, backgroundThrottling: false },
    });
    this.win.setAlwaysOnTop(true, 'screen-saver', 1);
    // Clicking elsewhere closes the box, except while listening/transcribing a voice command.
    this.win.on('blur', () => setTimeout(() => !this.busy && this.hide('blur'), 60));
    await this.win.loadFile(path.join(this.root, 'src/renderer/chat/index.html'));
  }

  setStatus(status) {
    this.status = status;
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('chat:status', status);
  }

  send(ch, data) {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(`chat:${ch}`, data);
  }

  /**
   * Show above a point (the character's head), clamped to that monitor.
   * @param opts.mode   'chat' or 'name'
   * @param opts.name   the character's current name
   * @param opts.ideas  name suggestions for the 🎲 button
   */
  /** Its face in the chat corner (a PNG data URL of the current look). */
  setFace(url) {
    this.face = url;
    this.send('face', url);
  }

  show(near, { mode = 'chat', name = '', ideas = [] } = {}) {
    if (!this.win) return;
    this.mode = mode;
    const d = screen.getDisplayNearestPoint({ x: Math.round(near.x), y: Math.round(near.y) }).workArea;
    let x = Math.round(near.x - W / 2);
    let y = Math.round(near.y - H - 8);
    x = Math.max(d.x + 8, Math.min(d.x + d.width - W - 8, x));
    y = Math.max(d.y + 8, Math.min(d.y + d.height - H - 8, y));
    this.win.setBounds({ x, y, width: W, height: H });
    this.win.show();
    this.win.focus();
    this.win.moveTop();
    this.visible = true;
    if (this.face) this.win.webContents.send('chat:face', this.face);
    this.win.webContents.send('chat:shown', { history: this.history, status: this.status, mode, name, ideas });
    this.emit('opened', { x: x + W / 2, y: y + H / 2 });
  }

  hide(reason = 'hide') {
    if (!this.visible || !this.win) return;
    this.visible = false;
    this.busy = false;
    this.win.webContents.send('chat:hidden');
    this.win.hide();
    this.emit('closed', reason, this.mode);
  }
}
