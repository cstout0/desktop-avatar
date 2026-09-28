// Index of the user's installed apps (the same list as the Start menu), so
// "open spotify" launches only things that are really installed.
import { execFile, spawn } from 'node:child_process';

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[®™]/g, '')
    .replace(/[^a-z0-9+#]+/g, ' ')
    .trim();

const ALIASES = {
  calc: 'calculator',
  calculator: 'calculator',
  explorer: 'file explorer',
  files: 'file explorer',
  'file manager': 'file explorer',
  edge: 'microsoft edge',
  chrome: 'google chrome',
  browser: 'microsoft edge',
  'web browser': 'microsoft edge',
  cmd: 'command prompt',
  'command line': 'command prompt',
  shell: 'terminal',
  'windows terminal': 'terminal',
  vscode: 'visual studio code',
  'vs code': 'visual studio code',
  code: 'visual studio code',
  word: 'word',
  excel: 'excel',
  powerpoint: 'powerpoint',
  outlook: 'outlook',
  mail: 'outlook',
  'snip': 'snipping tool',
  'screenshot tool': 'snipping tool',
  'text editor': 'notepad',
  store: 'microsoft store',
  'app store': 'microsoft store',
  photoshop: 'adobe photoshop',
};

// Built-in Windows tools that aren't always listed as Start apps.
const BUILTIN = {
  'task manager': { name: 'Task Manager', exe: 'taskmgr.exe' },
  'control panel': { name: 'Control Panel', exe: 'control.exe' },
  'command prompt': { name: 'Command Prompt', exe: 'cmd.exe' },
  notepad: { name: 'Notepad', exe: 'notepad.exe' },
  paint: { name: 'Paint', exe: 'mspaint.exe' },
  'file explorer': { name: 'File Explorer', exe: 'explorer.exe' },
  settings: { name: 'Settings', uri: 'ms-settings:' },
  'sound settings': { name: 'Sound settings', uri: 'ms-settings:sound' },
  'display settings': { name: 'Display settings', uri: 'ms-settings:display' },
  'bluetooth settings': { name: 'Bluetooth settings', uri: 'ms-settings:bluetooth' },
  'wifi settings': { name: 'Wi-Fi settings', uri: 'ms-settings:network-wifi' },
};

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

export class AppIndex {
  constructor() {
    this.apps = [];
    this.loading = null;
  }

  load() {
    this.loading ??= new Promise((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | ConvertTo-Json -Compress'],
        { windowsHide: true, maxBuffer: 8e6, timeout: 30000 },
        (err, stdout) => {
          try {
            const list = JSON.parse(stdout);
            this.apps = (Array.isArray(list) ? list : [list])
              .filter((a) => a?.Name && a?.AppID && !/^https?:/i.test(a.AppID))
              .map((a) => ({ name: a.Name, id: a.AppID, key: norm(a.Name) }));
          } catch {
            this.apps = [];
          }
          resolve(this.apps);
        },
      );
    });
    return this.loading;
  }

  /** Best match for a spoken app name, or null. */
  find(query) {
    let q = norm(query);
    if (!q) return null;
    q = ALIASES[q] ?? q;
    const apps = this.apps;
    const exact = apps.find((a) => a.key === q);
    if (exact) return exact;
    if (BUILTIN[q]) return { ...BUILTIN[q], key: q, builtin: true };
    const starts = apps.filter((a) => a.key.startsWith(`${q} `) || a.key.startsWith(q)).sort((a, b) => a.key.length - b.key.length);
    if (starts.length) return starts[0];
    const words = q.split(' ');
    const wordHit = apps.filter((a) => words.every((w) => a.key.split(' ').includes(w))).sort((a, b) => a.key.length - b.key.length);
    if (wordHit.length) return wordHit[0];
    if (q.length >= 4) {
      const inc = apps.filter((a) => a.key.includes(q)).sort((a, b) => a.key.length - b.key.length);
      if (inc.length) return inc[0];
      let best = null;
      let bestD = q.length <= 6 ? 1 : 2;
      for (const a of apps) {
        const d = editDistance(q, a.key);
        if (d <= bestD) {
          bestD = d;
          best = a;
        }
      }
      if (best) return best;
    }
    return null;
  }

  launch(app, shell) {
    if (app.uri) return shell.openExternal(app.uri);
    if (app.exe) {
      spawn(app.exe, [], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
      return Promise.resolve();
    }
    // Works for Store apps (AUMIDs) and regular programs alike.
    spawn('explorer.exe', [`shell:AppsFolder\\${app.id}`], { detached: true, stdio: 'ignore' }).unref();
    return Promise.resolve();
  }
}
