// The AI "director": lets the local model decide what Claude does, in character.
//  - Watch-along: when a video plays, the AI decides whether to watch; while
//    watching it hears the soundtrack (local Whisper) and picks reactions.
//  - Every few minutes it chooses Claude's next activity from its personality,
//    the time, and what the user is up to.
//  - While the user is in a fullscreen game it stays quiet and frees the GPU.
import { screen } from 'electron';

const REACTIONS = ['none', 'laugh', 'gasp', 'wow', 'clap', 'think', 'nod', 'sad', 'dance'];
const ACTIVITIES = ['explore', 'climb', 'swing', 'wallclimb', 'nap', 'dance', 'sit', 'wander', 'stretch', 'follow_cursor', 'chill'];
const ACTIVITY_CMD = { explore: 'explore', climb: 'climb', swing: 'swing', wallclimb: 'wallclimb', nap: 'sleep', dance: 'dance', sit: 'sit', wander: 'wander', stretch: 'stretch', follow_cursor: 'follow', chill: 'stop' };

const schema = (props, required) => ({ type: 'object', properties: props, required });

export class Director {
  constructor({ ollama, media, ears, whisper, overlays, settings, personality, getFacts = () => [], log = () => {} }) {
    Object.assign(this, { ollama, media, ears, whisper, overlays, settings, personality, getFacts, log });
    this.watching = null;
    this.lastDecision = Date.now();
    this.recent = [];
    this.unloaded = false;
    this.lastUserActivity = Date.now();
  }

  enabled() {
    return this.settings.get('aiDirector') !== false;
  }

  say(text, mood = 'normal', dur) {
    if (text) this.overlays.sendToBrain('ov:say', { text, mood, dur });
  }

  do(cmd) {
    this.overlays.sendToBrain('ov:do', cmd);
  }

  start() {
    this.media.on('change', (now, prev) => this.onMedia(now, prev).catch((e) => this.log(`director media: ${e.message}`)));
    this.timer = setInterval(() => this.tick().catch((e) => this.log(`director tick: ${e.message}`)), 15000);
  }

  stop() {
    clearInterval(this.timer);
    this.watching = null;
  }

  persona() {
    const p = this.personality.text();
    return p ? `Your personality (stay in character):\n${p}` : '';
  }

  timeText() {
    return new Date().toLocaleString([], { weekday: 'long', hour: 'numeric', minute: '2-digit' });
  }

  async ask(system, user, format, temperature = 0.8) {
    const msg = await this.ollama.chat({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }], format, temperature, numPredict: 160, timeoutMs: 30000 });
    return JSON.parse(msg.content || '{}');
  }

  gaming() {
    return this.overlays.fullscreen.size > 0 && !this.media.active?.video;
  }

  // ---- watch-along --------------------------------------------------------------------

  async onMedia(now, prev) {
    if (this.watching && (!now || !now.video || now.title !== this.watching.session.title)) await this.endWatch(now);
    if (!now?.video || this.settings.get('watchAlong') === false || !this.enabled()) return;
    if (!(await this.ollama.check()).ok) {
      // No AI available: still watch, just without commentary.
      return this.beginWatch(now, { watch: true, comment: '' });
    }
    const d = await this.ask(
      `You are Claude, a little character living on the user's Windows desktop. ${this.persona()}\nThe user just started playing a video. Decide whether you go and watch it with them (you usually do, unless it doesn't fit your personality or mood). Optionally say something short about it (under 80 characters, or empty).`,
      `Video: "${now.title}"${now.artist ? ` from ${now.artist}` : ''}, playing in ${now.app}. It is ${this.timeText()}.`,
      schema({ watch: { type: 'boolean' }, comment: { type: 'string' } }, ['watch', 'comment']),
    ).catch(() => ({ watch: true, comment: '' }));
    this.log(`director: video "${now.title}" -> ${JSON.stringify(d)}`);
    if (d.watch) this.beginWatch(now, d);
    else if (d.comment) this.say(d.comment);
  }

  videoArea(session) {
    const win = this.media.windowFor(session);
    // A fullscreen monitor showing the video: face that monitor.
    for (const id of this.overlays.fullscreen) {
      const e = this.overlays.wins.get(id);
      if (e) return { ...boundsRect(e.display.bounds), fullscreen: true };
    }
    if (win?.rect) {
      const d = screen.screenToDipRect(null, { x: win.rect.left, y: win.rect.top, width: win.rect.right - win.rect.left, height: win.rect.bottom - win.rect.top });
      return { x1: d.x, y1: d.y, x2: d.x + d.width, y2: d.y + d.height, win: win.hwnd };
    }
    return null;
  }

  beginWatch(session, decision) {
    const area = this.videoArea(session);
    this.watching = { session, since: Date.now(), transcript: [], comments: [], lastComment: 0, area };
    this.do({ name: 'watch', area });
    if (decision.comment) this.say(decision.comment, 'happy');
    this.listenLoop(this.watching);
  }

  async endWatch(next) {
    const w = this.watching;
    this.watching = null;
    this.do({ name: 'watch-end' });
    if (w && Date.now() - w.since > 20000 && !next?.video) this.say(['That was fun!', 'Good one!', 'Aw, it’s over?'][Math.floor(Math.random() * 3)], 'happy');
  }

  async listenLoop(w) {
    while (this.watching === w) {
      const clip = await this.ears.captureClip(12);
      if (this.watching !== w) break;
      if (!clip.wav) continue; // silence
      let heard = '';
      try {
        heard = await this.whisper.transcribe(clip.wav);
      } catch {
        heard = '';
      }
      if (this.watching !== w) break;
      if (heard) w.transcript.push(heard);
      if (w.transcript.length > 4) w.transcript.shift();
      if (!(await this.ollama.check()).ok) continue;
      const chatty = this.settings.get('chattiness') ?? 'normal';
      const gap = { quiet: 120000, normal: 40000, chatty: 20000 }[chatty] ?? 40000;
      const canTalk = Date.now() - w.lastComment > gap;
      const d = await this.ask(
        `You are Claude, a little desktop character watching a video together with the user, like a friend on the couch. ${this.persona()}\nYou get the video title and a transcript of what was just said. React naturally. Usually just react with an emote and leave the comment empty. ${canTalk ? 'Only if something is genuinely funny, surprising or interesting, add ONE short comment (under 90 characters).' : 'Do NOT comment right now (leave it empty).'} Never spoil or summarize the video.`,
        `Video: "${w.session.title}". Just heard: "${heard || '(music or no speech)'}". Your recent comments: ${JSON.stringify(w.comments.slice(-3))}.`,
        schema({ react: { type: 'string', enum: REACTIONS }, comment: { type: 'string' } }, ['react', 'comment']),
      ).catch(() => null);
      if (!d || this.watching !== w) continue;
      this.log(`director: heard "${heard.slice(0, 80)}" -> ${JSON.stringify(d)}`);
      if (d.react && d.react !== 'none') this.do({ name: 'react', kind: d.react });
      if (canTalk && d.comment && d.comment.length > 2 && !w.comments.includes(d.comment)) {
        w.comments.push(d.comment);
        w.lastComment = Date.now();
        this.say(d.comment, 'normal', 6);
      }
    }
  }

  // ---- autonomous choices ------------------------------------------------------------

  intervalMs() {
    return { quiet: 8, normal: 4, chatty: 2 }[this.settings.get('chattiness') ?? 'normal'] * 60000 || 240000;
  }

  async tick() {
    if (!this.enabled() || this.watching) return;
    if (this.gaming()) {
      // Free the GPU for the game.
      if (!this.unloaded) this.unloaded = await this.ollama.unload();
      return;
    }
    this.unloaded = false;
    if (Date.now() - this.lastDecision < this.intervalMs()) return;
    const rep = this.overlays.lastReport;
    if (!rep || rep.control || ['held', 'rope', 'climb'].includes(rep.mode) || ['think', 'listen', 'carry', 'watch'].includes(rep.brain)) return;
    if (!(await this.ollama.check()).ok) return;
    this.lastDecision = Date.now();
    const d = await this.decide(rep).catch(() => null);
    if (!d) return;
    this.log(`director: decided ${JSON.stringify(d)}`);
    this.recent.push(d.activity);
    if (this.recent.length > 5) this.recent.shift();
    const cmd = ACTIVITY_CMD[d.activity];
    if (cmd && cmd !== 'wander') this.do({ name: cmd, ai: true });
    if (d.thought && this.settings.get('chattiness') !== 'quiet') this.say(d.thought, 'normal', 5);
  }

  async decide(rep) {
    const fg = this.foreground?.() ?? '';
    const where = rep.ground?.kind === 'platform' ? 'standing on top of a window' : rep.mode === 'ground' ? 'on the bottom of the screen' : 'moving around';
    const facts = this.getFacts().slice(-5).map((f) => f.text).join('; ');
    return this.ask(
      `You are the inner mind of Claude, a little character that lives on the user's Windows desktop. You can explore (hop onto windows), climb the sides of windows, swing on your grappling rope, climb the screen edge, nap, dance, sit, wander, stretch, follow the user's cursor, or just chill. ${this.persona()}\nPick what to do next so it fits your personality and the moment (e.g. sleepy late at night, quiet while the user seems busy). Vary it; don't repeat your recent activities too much. You may add a very short thought to say out loud (under 70 characters) about 1 time in 3; otherwise leave it empty.`,
      `It is ${this.timeText()}. ${fg ? `The user is using: ${fg}. ` : ''}${this.media.describe() ? `${this.media.describe()}. ` : ''}You're ${where}. Your recent activities: ${this.recent.join(', ') || 'none'}.${facts ? ` About the user: ${facts}.` : ''} What do you do next?`,
      schema({ activity: { type: 'string', enum: ACTIVITIES }, thought: { type: 'string' } }, ['activity', 'thought']),
    );
  }
}

function boundsRect(b) {
  return { x1: b.x, y1: b.y, x2: b.x + b.width, y2: b.y + b.height };
}
