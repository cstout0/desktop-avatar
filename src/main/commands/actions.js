// What Claude can actually do on the PC. Every action is sandboxed to the
// user's folders / installed apps / http(s) links, and nothing destructive
// happens without an explicit "yes".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { isInside, sanitizeName } from './paths.js';
import { parseClock } from './parser.js';

const pickFrom = (arr, rand = Math.random) => arr[Math.floor(rand() * arr.length) % arr.length];
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export const SITES = {
  youtube: 'https://www.youtube.com',
  google: 'https://www.google.com',
  gmail: 'https://mail.google.com',
  'google drive': 'https://drive.google.com',
  drive: 'https://drive.google.com',
  'google docs': 'https://docs.google.com',
  'google maps': 'https://maps.google.com',
  maps: 'https://maps.google.com',
  reddit: 'https://www.reddit.com',
  github: 'https://github.com',
  twitter: 'https://x.com',
  x: 'https://x.com',
  facebook: 'https://www.facebook.com',
  instagram: 'https://www.instagram.com',
  twitch: 'https://www.twitch.tv',
  netflix: 'https://www.netflix.com',
  amazon: 'https://www.amazon.com',
  wikipedia: 'https://www.wikipedia.org',
  claude: 'https://claude.ai',
  'hacker news': 'https://news.ycombinator.com',
  linkedin: 'https://www.linkedin.com',
  weather: 'https://www.weather.gov',
  'youtube music': 'https://music.youtube.com',
};

const SEARCH = {
  google: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  youtube: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
  wikipedia: (q) => `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}`,
  reddit: (q) => `https://www.reddit.com/search/?q=${encodeURIComponent(q)}`,
  amazon: (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}`,
  bing: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
  duckduckgo: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
};

const JOKES = [
  'Why do programmers prefer dark mode? Because light attracts bugs.',
  'I told my computer I needed a break. It said: “No problem, I’ll go to sleep.”',
  'Why was the desktop so calm? It had great window management.',
  'I would tell you a UDP joke, but you might not get it.',
  'There are 10 kinds of people: those who understand binary and those who don’t.',
  'Why did the folder break up with the file? It needed more space.',
  'My favorite exercise? Jumping to conclusions. And onto your windows.',
  'Why don’t skeletons fight each other? They don’t have the guts.',
  'I’m reading a book about anti-gravity. It’s impossible to put down.',
  'What do you call a fake noodle? An impasta.',
  'Why did the scarecrow win an award? He was outstanding in his field.',
  'How does a computer get drunk? It takes screenshots.',
  'What’s a computer’s favorite snack? Microchips.',
  'Why was the math book sad? It had too many problems.',
  'I asked the cursor to hang out. It just kept pointing at things.',
  'Why did the PowerPoint presentation cross the road? To get to the other slide.',
  'What do you call a sleeping dinosaur? A dino-snore.',
  'Parallel lines have so much in common. It’s a shame they’ll never meet.',
];

function fmtDuration(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.round(secs % 60);
  const parts = [];
  if (h) parts.push(`${h} hour${h > 1 ? 's' : ''}`);
  if (m) parts.push(`${m} minute${m > 1 ? 's' : ''}`);
  if (s && !h) parts.push(`${s} second${s > 1 ? 's' : ''}`);
  return parts.join(' ') || '0 seconds';
}

export class Actions {
  /**
   * @param deps.paths     SafePaths
   * @param deps.shell     { openPath, openExternal, trashItem, showItemInFolder }
   * @param deps.apps      AppIndex
   * @param deps.emote     (name, extra) => void    make Claude do something
   * @param deps.media     (action) => void        press media keys
   * @param deps.timers    Timers
   * @param deps.dataDir   where memory.json lives
   * @param deps.screenshot () => Promise<void>
   */
  constructor(deps) {
    this.d = deps;
    this.rand = deps.rand ?? Math.random;
    this.now = deps.now ?? (() => new Date());
    this.memFile = path.join(deps.dataDir, 'memory.json');
  }

  notesFile() {
    return path.join(this.d.paths.folders.documents, 'Claude Notes.txt');
  }

  // ---- memory --------------------------------------------------------------------

  facts() {
    try {
      return JSON.parse(fs.readFileSync(this.memFile, 'utf8')).facts ?? [];
    } catch {
      return [];
    }
  }

  saveFacts(facts) {
    fs.mkdirSync(path.dirname(this.memFile), { recursive: true });
    fs.writeFileSync(this.memFile, JSON.stringify({ facts }, null, 2));
  }

  // ---- files & folders ---------------------------------------------------------------

  pickLocation(location, name, alt) {
    let where = this.d.paths.resolveDir(location);
    if (!location && alt) {
      // "create a folder called X in Projects": only treat "Projects" as a place if it exists.
      const altWhere = this.d.paths.resolveDir(alt.location);
      if (altWhere.dir) return { dir: altWhere.dir, name: alt.name };
    }
    if (where.error && location && /\s+folder$/i.test(location)) where = this.d.paths.resolveDir(location.replace(/\s+folder$/i, ''));
    return { ...where, name };
  }

  create_folder({ name, location, alt } = {}) {
    const loc = this.pickLocation(location, name, alt);
    if (loc.error) return { ok: false, say: loc.error, mood: 'error' };
    const clean = sanitizeName(loc.name);
    if (!clean) return { ok: false, ask: { question: 'Sure! What should I call the folder?', slot: 'name', intent: 'create_folder', base: { location } } };
    const target = path.join(loc.dir, clean);
    const where = this.d.paths.where(loc.dir);
    if (fs.existsSync(target)) {
      return { ok: true, say: `There’s already a folder called “${clean}” ${where}.`, mood: 'normal', buttons: [{ label: 'Open it', run: () => this.d.shell.openPath(target) }], data: { path: target, existed: true } };
    }
    fs.mkdirSync(target);
    return {
      ok: true,
      say: pickFrom([`Done! Made the folder “${clean}” ${where}.`, `Ta-da! “${clean}” is now ${where}.`, `Created “${clean}” ${where}.`], this.rand),
      mood: 'success',
      item: 'folder',
      buttons: [{ label: 'Open it', run: () => this.d.shell.openPath(target) }],
      data: { path: target },
    };
  }

  create_file({ name, ext = '.txt', location, content, alt } = {}) {
    const loc = this.pickLocation(location, name, alt);
    if (loc.error) return { ok: false, say: loc.error, mood: 'error' };
    let clean = sanitizeName(loc.name);
    if (!clean) return { ok: false, ask: { question: 'What should I name the file?', slot: 'name', intent: 'create_file', base: { ext, location, content } } };
    if (!path.extname(clean) || path.extname(clean).length > 6) clean += ext || '.txt';
    const target = this.d.paths.uniquePath(loc.dir, clean);
    fs.writeFileSync(target, content ? `${content}\n` : '', 'utf8');
    const where = this.d.paths.where(loc.dir);
    const renamed = path.basename(target) !== clean ? ` (“${clean}” was taken)` : '';
    return {
      ok: true,
      say: `Created “${path.basename(target)}” ${where}${renamed}${content ? ' with your text' : ''}.`,
      mood: 'success',
      item: 'file',
      buttons: [
        { label: 'Open it', run: () => this.d.shell.openPath(target) },
        { label: 'Show in folder', run: () => this.d.shell.showItemInFolder(target) },
      ],
      data: { path: target },
    };
  }

  take_note({ text } = {}) {
    if (!text) return { ok: false, ask: { question: 'What should I write down?', slot: 'text', intent: 'take_note', base: {} } };
    const file = this.notesFile();
    const stamp = this.now().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    fs.appendFileSync(file, `[${stamp}] ${text}\n`, 'utf8');
    return { ok: true, say: pickFrom(['Noted! ✍️', 'Got it, it’s in your notes.', 'Written down!'], this.rand), mood: 'success', item: 'note', buttons: [{ label: 'Open notes', run: () => this.d.shell.openPath(file) }], data: { path: file } };
  }

  read_notes() {
    let lines = [];
    try {
      lines = fs.readFileSync(this.notesFile(), 'utf8').trim().split(/\r?\n/).filter(Boolean);
    } catch {
      /* none yet */
    }
    if (!lines.length) return { ok: true, say: 'No notes yet! Say “take a note: …” and I’ll write it down.' };
    const last = lines.slice(-4).map((l) => l.replace(/^\[[^\]]+\]\s*/, '• '));
    return { ok: true, say: `Your latest notes:\n${last.join('\n')}`, buttons: [{ label: 'Open notes', run: () => this.d.shell.openPath(this.notesFile()) }] };
  }

  remember({ fact, name } = {}) {
    if (!fact) return { ok: false, say: 'What should I remember?' };
    let facts = this.facts().filter((f) => f.text.toLowerCase() !== fact.toLowerCase());
    if (name) facts = facts.filter((f) => !/^The user's name is /.test(f.text));
    facts.push({ text: fact, t: Date.now() });
    this.saveFacts(facts.slice(-50));
    if (name) return { ok: true, say: `Nice to meet you, ${name}! I’ll remember that. 👋`, mood: 'happy', emote: 'wave' };
    return { ok: true, say: pickFrom(['I’ll remember that!', 'Got it — committed to memory.', 'Remembered! 🧠'], this.rand), mood: 'success' };
  }

  recall() {
    const facts = this.facts();
    if (!facts.length) return { ok: true, say: 'Nothing yet! Tell me “remember that …” and I will.' };
    return { ok: true, say: `Here’s what I remember:\n${facts.slice(-6).map((f) => `• ${f.text}`).join('\n')}` };
  }

  forget() {
    return {
      ok: true,
      confirm: {
        question: 'Forget everything you’ve told me to remember?',
        yes: () => {
          this.saveFacts([]);
          return { ok: true, say: 'Done. Fresh start!', mood: 'success' };
        },
      },
    };
  }

  list({ location } = {}) {
    const where = this.d.paths.resolveDir(location || 'desktop');
    if (where.error) return { ok: false, say: where.error, mood: 'error' };
    let entries = [];
    try {
      entries = fs.readdirSync(where.dir, { withFileTypes: true }).filter((e) => !e.name.startsWith('.') && !/^desktop\.ini$/i.test(e.name));
    } catch (err) {
      return { ok: false, say: `I couldn’t look in there (${err.code}).`, mood: 'error' };
    }
    const folders = entries.filter((e) => e.isDirectory()).map((e) => `📁 ${e.name}`);
    const files = entries.filter((e) => !e.isDirectory()).map((e) => `📄 ${e.name}`);
    const all = [...folders, ...files];
    if (!all.length) return { ok: true, say: `${cap(this.d.paths.label(where.dir))} is empty. So tidy!` };
    const shown = all.slice(0, 8).join('\n');
    const more = all.length > 8 ? `\n…and ${all.length - 8} more` : '';
    return { ok: true, say: `${cap(this.d.paths.label(where.dir))} has ${folders.length} folder${folders.length === 1 ? '' : 's'} and ${files.length} file${files.length === 1 ? '' : 's'}:\n${shown}${more}`, buttons: [{ label: 'Open folder', run: () => this.d.shell.openPath(where.dir) }], data: { names: entries.map((e) => e.name) } };
  }

  delete({ name, location } = {}) {
    const found = location ? path.join(this.d.paths.resolveDir(location).dir ?? '', sanitizeName(name)) : this.d.paths.findEntry(name);
    if (!found || !fs.existsSync(found)) return { ok: false, say: `I couldn’t find “${name}”.`, mood: 'error' };
    if (!this.d.paths.allowed(found) || Object.values(this.d.paths.folders).some((f) => path.resolve(f) === path.resolve(found))) {
      return { ok: false, say: 'I’d rather not touch that one.', mood: 'error' };
    }
    const kind = fs.statSync(found).isDirectory() ? 'folder' : 'file';
    return {
      ok: true,
      confirm: {
        question: `Move the ${kind} “${path.basename(found)}” (${this.d.paths.where(path.dirname(found))}) to the Recycle Bin?`,
        yes: async () => {
          await this.d.shell.trashItem(found);
          return { ok: true, say: `Moved “${path.basename(found)}” to the Recycle Bin. (You can restore it from there.)`, mood: 'success' };
        },
      },
    };
  }

  rename({ from, to } = {}) {
    const found = this.d.paths.findEntry(from);
    if (!found) return { ok: false, say: `I couldn’t find “${from}”.`, mood: 'error' };
    if (!this.d.paths.allowed(found)) return { ok: false, say: 'I can only rename things in your user folders.', mood: 'error' };
    let clean = sanitizeName(to);
    if (!clean) return { ok: false, say: 'That name won’t work on Windows. Try another?', mood: 'error' };
    if (!fs.statSync(found).isDirectory() && !path.extname(clean) && path.extname(found)) clean += path.extname(found);
    const target = path.join(path.dirname(found), clean);
    if (fs.existsSync(target)) return { ok: false, say: `There’s already something called “${clean}” there.`, mood: 'error' };
    fs.renameSync(found, target);
    return { ok: true, say: `Renamed “${path.basename(found)}” to “${clean}”.`, mood: 'success', item: fs.statSync(target).isDirectory() ? 'folder' : 'file', data: { path: target } };
  }

  empty_bin() {
    return { ok: false, say: 'I’d rather not permanently delete things. You can empty the Recycle Bin yourself (right-click it → Empty).' };
  }

  // ---- apps & web -------------------------------------------------------------------------

  async open({ target } = {}) {
    if (!target) return { ok: false, ask: { question: 'What should I open?', slot: 'target', intent: 'open', base: {} } };
    const t = target.trim();
    const key = t.toLowerCase().replace(/\s+folder$/, '');
    const special = { 'recycle bin': 'shell:RecycleBinFolder', trash: 'shell:RecycleBinFolder', 'this pc': 'shell:MyComputerFolder', 'my computer': 'shell:MyComputerFolder' };
    if (special[key]) {
      await this.d.shell.openExternal(special[key]);
      return { ok: true, say: `Opening ${t}.`, item: 'folder' };
    }
    const folder = this.d.paths.resolveDir(key.replace(/^(?:my|the)\s+/, ''));
    if (!folder.error && ['desktop', 'documents', 'downloads', 'pictures', 'photos', 'music', 'videos', 'home'].some((w) => key.includes(w))) {
      await this.d.shell.openPath(folder.dir);
      return { ok: true, say: `Opening ${this.d.paths.label(folder.dir)}.`, item: 'folder' };
    }
    if (/^https?:\/\//i.test(t)) return this.openUrl(t);
    if (/^[\w-]+(\.[\w-]+)*\.[a-z]{2,}(\/\S*)?$/i.test(t)) return this.openUrl(`https://${t}`);
    await this.d.apps.load();
    const app = this.d.apps.find(t);
    const site = SITES[key];
    if (app && !(site && !app.key.startsWith(key))) {
      await this.d.apps.launch(app, this.d.shell);
      return { ok: true, say: pickFrom([`Opening ${app.name}!`, `Launching ${app.name}.`, `${app.name}, coming right up!`], this.rand), mood: 'success', item: 'check', data: { app: app.name } };
    }
    if (site) return this.openUrl(site, t);
    const entry = this.d.paths.findEntry(t);
    if (entry) {
      await this.d.shell.openPath(entry);
      return { ok: true, say: `Opening “${path.basename(entry)}”.`, item: fs.statSync(entry).isDirectory() ? 'folder' : 'file', data: { path: entry } };
    }
    return {
      ok: false,
      say: `I couldn’t find an app, website or folder called “${t}”.`,
      mood: 'error',
      buttons: [{ label: `Search the web`, run: () => this.search({ query: t, site: 'google' }) }],
    };
  }

  async openUrl(url, label) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return { ok: false, say: 'That doesn’t look like a web address.', mood: 'error' };
    }
    if (!['http:', 'https:'].includes(u.protocol)) return { ok: false, say: 'I only open http(s) links.', mood: 'error' };
    await this.d.shell.openExternal(u.toString());
    return { ok: true, say: `Opening ${label ?? u.hostname.replace(/^www\./, '')}!`, mood: 'success', item: 'globe', data: { url: u.toString() } };
  }

  async search({ query, site = 'google' } = {}) {
    if (!query) return { ok: false, ask: { question: 'What should I search for?', slot: 'query', intent: 'search', base: { site } } };
    const make = SEARCH[site] ?? SEARCH.google;
    await this.d.shell.openExternal(make(query));
    const where = site === 'google' ? '' : ` on ${site[0].toUpperCase()}${site.slice(1)}`;
    return { ok: true, say: `Searching${where} for “${query}”…`, mood: 'success', item: 'globe', data: { url: make(query) } };
  }

  // ---- media, timers, info ----------------------------------------------------------------

  media({ action } = {}) {
    const keyFor = { pause: 'playpause', play: 'playpause', next: 'next', prev: 'prev', volup: 'volup', voldown: 'voldown', mute: 'mute' };
    const k = keyFor[action];
    if (!k) return { ok: false, say: 'I don’t know that media control.' };
    this.d.media(k, k === 'volup' || k === 'voldown' ? 5 : 1);
    const say = { pause: 'Paused.', play: 'Playing!', next: 'Skipping ahead ⏭', prev: 'Going back ⏮', volup: 'Louder! 🔊', voldown: 'Quieter. 🔉', mute: 'Toggled mute.' }[action];
    return { ok: true, say, mood: 'success' };
  }

  timer({ seconds, label } = {}) {
    if (!seconds) return { ok: false, ask: { question: 'For how long?', slot: 'duration', intent: 'timer', base: { label } } };
    const t = this.d.timers.add({ seconds, label, kind: 'timer' });
    return { ok: true, say: `Timer set for ${fmtDuration(seconds)}${label ? ` (${label})` : ''}. ⏱`, mood: 'success', item: 'timer', data: { id: t.id } };
  }

  reminder({ seconds, at, text } = {}) {
    let due = null;
    if (seconds) due = new Date(this.now().getTime() + seconds * 1000);
    else if (at) due = parseClock(at, this.now());
    if (!due) return { ok: false, ask: { question: 'When should I remind you?', slot: 'duration', intent: 'reminder', base: { text } } };
    if (!text) return { ok: false, ask: { question: 'What should I remind you about?', slot: 'text', intent: 'reminder', base: { seconds, at } } };
    const secs = Math.max(1, Math.round((due - this.now()) / 1000));
    this.d.timers.add({ seconds: secs, label: text, kind: 'reminder' });
    const when = seconds ? `in ${fmtDuration(secs)}` : `at ${due.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    return { ok: true, say: `I’ll remind you ${when}: “${text}”.`, mood: 'success', item: 'timer' };
  }

  cancel_timers() {
    const n = this.d.timers.clear();
    return { ok: true, say: n ? `Cancelled ${n} timer${n > 1 ? 's' : ''}.` : 'There weren’t any timers running.' };
  }

  timers_status() {
    const list = this.d.timers.list();
    if (!list.length) return { ok: true, say: 'No timers running.' };
    return { ok: true, say: list.map((t) => `⏱ ${t.label ?? t.kind}: ${fmtDuration(Math.max(0, Math.round((t.due - Date.now()) / 1000)))} left`).join('\n') };
  }

  time() {
    return { ok: true, say: `It’s ${this.now().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` };
  }

  date() {
    return { ok: true, say: `Today is ${this.now().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.` };
  }

  async system() {
    const sample = () => os.cpus().map((c) => ({ idle: c.times.idle, total: Object.values(c.times).reduce((a, b) => a + b, 0) }));
    const a = sample();
    await new Promise((r) => setTimeout(r, 400));
    const b = sample();
    let idle = 0;
    let total = 0;
    b.forEach((x, i) => {
      idle += x.idle - a[i].idle;
      total += x.total - a[i].total;
    });
    const cpu = Math.round(100 * (1 - idle / Math.max(1, total)));
    const mem = Math.round((100 * (os.totalmem() - os.freemem())) / os.totalmem());
    const gpu = await new Promise((resolve) =>
      execFile('nvidia-smi', ['--query-gpu=utilization.gpu,name', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 3000 }, (err, out) => {
        if (err) return resolve(null);
        const [u, name] = out.trim().split(/,\s*/);
        resolve({ util: Number(u), name });
      }),
    );
    const up = os.uptime();
    const upText = up > 86400 ? `${Math.floor(up / 86400)}d ${Math.floor((up % 86400) / 3600)}h` : `${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m`;
    const vibe = cpu > 80 || mem > 90 ? 'Working hard!' : cpu > 40 ? 'Pretty busy.' : 'Running smooth.';
    const gpuText = gpu ? ` · GPU ${gpu.util}%` : '';
    return { ok: true, say: `${vibe} CPU ${cpu}% · RAM ${mem}% of ${Math.round(os.totalmem() / 2 ** 30)} GB${gpuText} · up ${upText}`, data: { cpu, mem, gpu } };
  }

  async screenshot() {
    await this.d.screenshot();
    const dir = path.join(this.d.paths.folders.pictures, 'Screenshots');
    return { ok: true, say: 'Say cheese! 📸 Saved to Pictures › Screenshots.', mood: 'success', buttons: [{ label: 'Open folder', run: () => this.d.shell.openPath(dir) }] };
  }

  // ---- personality ---------------------------------------------------------------------------

  emote({ name, which, target } = {}) {
    const override = this.d.emote(name, { which, target });
    if (override?.say) return { ok: override.ok !== false, say: override.say, mood: override.mood ?? 'normal' };
    const say = {
      dance: pickFrom(['Let’s dance! 💃', 'Watch these moves!', '🎶'], this.rand),
      flip: pickFrom(['Hup!', 'Wheee!'], this.rand),
      wave: 'Hi there! 👋',
      sleep: 'Zzz… wake me if you need me.',
      wake: 'I’m up, I’m up!',
      come: 'Coming!',
      follow: 'Right behind you!',
      stop: 'Okay, staying put.',
      sit: 'Taking a seat.',
      celebrate: '🎉 Woohoo!',
      'other-screen': 'On my way!',
      swing: pickFrom(['Wheee! 🩢', 'Tarzan mode!', 'Hold my antenna!'], this.rand),
      climb: pickFrom(['Up I go! 🧗', 'Time for some climbing!'], this.rand),
      wallclimb: 'Scaling the screen!',
      explore: 'Adventure time!',
    }[name];
    return { ok: true, say: say ?? null, mood: 'happy' };
  }

  greet() {
    const h = this.now().getHours();
    const tod = h < 5 ? 'Still up?' : h < 12 ? 'Good morning!' : h < 18 ? 'Hey there!' : 'Good evening!';
    return { ok: true, say: pickFrom([`${tod} What can I do for you?`, 'Hi! Need anything? I can make folders, open apps, set timers…', 'Hello hello! 👋'], this.rand), mood: 'happy', emote: 'wave' };
  }

  thanks() {
    return { ok: true, say: pickFrom(['Anytime! 😊', 'Happy to help!', 'You got it!', 'No problem!'], this.rand), mood: 'happy' };
  }

  help() {
    return {
      ok: true,
      say: 'Try: “create a folder named X” · “open Spotify” · “set a timer for 5 minutes” · “take a note: …” · “search for …” · “pause the music” · “dance!”. Drag me around, or click me and use the arrow keys!',
      dur: 12,
    };
  }

  joke() {
    return { ok: true, say: pickFrom(JOKES, this.rand), mood: 'happy', emote: 'laugh' };
  }

  coin() {
    return { ok: true, say: this.rand() < 0.5 ? 'Heads! 🪙' : 'Tails! 🪙', mood: 'happy', emote: 'flip' };
  }

  dice({ sides = 6 } = {}) {
    const n = Math.max(2, Math.min(1000, sides));
    return { ok: true, say: `🎲 ${1 + Math.floor(this.rand() * n)}${n !== 6 ? ` (d${n})` : ''}`, mood: 'happy', emote: 'jump' };
  }

  how_are_you() {
    return { ok: true, say: pickFrom(['Living my best desktop life! You?', 'Great! I found a nice window to sit on.', 'Pretty good! A little dizzy from earlier, but good.'], this.rand), mood: 'happy' };
  }

  who() {
    return { ok: true, say: 'I’m Claude — your little desktop buddy. I run entirely on your PC: no internet, no cost.', mood: 'happy' };
  }

  hide() {
    this.d.emote('hide');
    return { ok: true, say: 'Okay, I’ll hide for 10 minutes. 👋', mood: 'normal' };
  }
}

export { fmtDuration, isInside };
