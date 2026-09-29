// The live preview at the top of the Settings window: the character, wearing
// its current look, running the real simulation in a little room (the wall
// and window follow the time of day). You can poke it or toss it around.
import { createState, step } from '../overlay/sim/index.js';
import { emptyInput, poke } from '../overlay/sim/behavior.js';
import { grab, moveHeld, release } from '../overlay/sim/physics.js';
import { CENTER_Y } from '../overlay/sim/constants.js';
import { drawCharacter, drawRope, hitTest } from '../overlay/render/character.js';
import { drawParticles } from '../overlay/render/effects.js';
import { headRise, normalizeLook } from '../overlay/look.js';
import { bodyMotion, normalizeMotion } from '../overlay/motion.js';
import { h } from './ui.js';

const FLOOR = 34;

function skyFor(hour) {
  if (hour < 6 || hour >= 21) return { top: '#1F2747', bottom: '#3B4675', night: true, wall: ['#D9C7B8', '#CDB9A9'] };
  if (hour < 9) return { top: '#FFC9A3', bottom: '#FFF0DC', wall: ['#F8E4CF', '#F2D8BF'] };
  if (hour < 17) return { top: '#9FD3FF', bottom: '#E7F5FF', wall: ['#F8E7D6', '#F3DCC5'] };
  return { top: '#FF9F80', bottom: '#F7B3CB', wall: ['#F7DDC9', '#F0CFB5'] };
}

export class Stage {
  constructor(host) {
    this.host = host;
    this.canvas = h('canvas');
    this.bubble = h('div', { class: 'stage-bubble' });
    this.nameTag = h('div', { class: 'stage-name' });
    this.hint = h('div', { class: 'stage-hint' }, 'Poke me, or grab me and toss me around!');
    host.append(this.canvas, this.bubble, this.nameTag, this.hint);
    this.ctx = this.canvas.getContext('2d');
    this.backdrop = document.createElement('canvas');
    this.look = normalizeLook({});
    this.motion = normalizeMotion({});
    this.name = '';
    this.scale = 1.4;
    this.st = null;
    this.talkUntil = 0;
    this.bubbleUntil = 0;
    this.press = null;
    this.dragging = false;
    this.hour = -1;
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.bindMouse();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  get stageScale() {
    return Math.max(0.95, Math.min(1.55, 1.25 * (this.scale / 1.4)));
  }

  resize() {
    const r = this.host.getBoundingClientRect();
    this.W = Math.max(200, Math.round(r.width));
    this.H = Math.max(120, Math.round(r.height));
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    for (const c of [this.canvas, this.backdrop]) {
      c.width = Math.round(this.W * dpr);
      c.height = Math.round(this.H * dpr);
    }
    const floor = this.H - FLOOR + 4;
    const sx1 = Math.round(this.W * 0.56);
    this.shelf = { id: 'shelf', win: 'shelf', x1: sx1, x2: sx1 + 150, y: Math.round(floor - 92), wx: sx1 };
    this.world = { regions: [{ id: 'stage', x: 0, y: 0, w: this.W, h: floor, inset: 0 }], platforms: [this.shelf], edges: [] };
    if (!this.st) {
      this.st = createState({ x: this.W * 0.3, y: 20, scale: this.stageScale, seed: 11, settings: { name: this.name, audio: false, walkOnWindows: true, sleepAfter: 600, chattiness: 'normal' } });
      this.st.look = this.look;
      this.st.motion = this.motion;
    } else {
      const c = this.st.char;
      c.x = Math.min(Math.max(c.x, 40), this.W - 40);
      if (c.y > floor) c.y = floor;
      if (c.ground?.kind === 'platform') {
        c.mode = 'air';
        c.ground = null;
      }
    }
    this.hour = -1;
  }

  drawBackdrop() {
    const hour = new Date().getHours();
    if (hour === this.hour) return;
    this.hour = hour;
    const { W, H } = this;
    const g = this.backdrop.getContext('2d');
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const sky = skyFor(hour);
    // Wallpaper with soft stripes.
    g.fillStyle = sky.wall[0];
    g.fillRect(0, 0, W, H);
    g.fillStyle = sky.wall[1];
    for (let x = 0; x < W; x += 36) g.fillRect(x, 0, 14, H);
    // A window with the real time of day outside.
    const wx = Math.round(W * 0.8) - 60;
    const wy = 26;
    const ww = 150;
    const wh = 104;
    const grad = g.createLinearGradient(0, wy, 0, wy + wh);
    grad.addColorStop(0, sky.top);
    grad.addColorStop(1, sky.bottom);
    g.fillStyle = '#FFF8EE';
    roundRect(g, wx - 8, wy - 8, ww + 16, wh + 16, 14);
    g.fill();
    g.fillStyle = grad;
    roundRect(g, wx, wy, ww, wh, 9);
    g.fill();
    g.save();
    roundRect(g, wx, wy, ww, wh, 9);
    g.clip();
    if (sky.night) {
      g.fillStyle = '#FFF6D8';
      g.beginPath();
      g.arc(wx + ww * 0.7, wy + 32, 15, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = sky.top;
      g.beginPath();
      g.arc(wx + ww * 0.7 + 7, wy + 28, 13, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#FFFFFF';
      for (const [sx, sy] of [
        [0.15, 0.2],
        [0.32, 0.5],
        [0.5, 0.18],
        [0.25, 0.8],
        [0.88, 0.62],
        [0.6, 0.72],
      ]) g.fillRect(wx + ww * sx, wy + wh * sy, 2, 2);
    } else {
      g.fillStyle = hour < 17 ? '#FFE17A' : '#FFD08A';
      g.beginPath();
      g.arc(wx + ww * 0.72, wy + (hour < 9 || hour >= 17 ? 70 : 30), 16, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.9)';
      for (const [cx, cy, r] of [
        [0.25, 0.42, 13],
        [0.36, 0.38, 17],
        [0.47, 0.44, 12],
      ]) {
        g.beginPath();
        g.arc(wx + ww * cx, wy + wh * cy, r, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.restore();
    g.strokeStyle = '#E3CBB4';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(wx + ww / 2, wy);
    g.lineTo(wx + ww / 2, wy + wh);
    g.moveTo(wx, wy + wh / 2);
    g.lineTo(wx + ww, wy + wh / 2);
    g.stroke();
    // A frame with a little doodle, on the left.
    g.fillStyle = '#FFF8EE';
    roundRect(g, 34, 34, 66, 52, 8);
    g.fill();
    g.fillStyle = '#9CCFB0';
    g.beginPath();
    g.moveTo(40, 80);
    g.lineTo(58, 56);
    g.lineTo(72, 72);
    g.lineTo(82, 62);
    g.lineTo(94, 80);
    g.closePath();
    g.fill();
    g.fillStyle = '#FFD46E';
    g.beginPath();
    g.arc(84, 46, 5, 0, Math.PI * 2);
    g.fill();
    // Shelf (the character can hop onto it).
    const s = this.shelf;
    g.fillStyle = '#B77B52';
    roundRect(g, s.x1, s.y, s.x2 - s.x1, 10, 4);
    g.fill();
    g.fillStyle = '#9A613D';
    g.fillRect(s.x1, s.y + 7, s.x2 - s.x1, 3);
    g.fillStyle = '#8A5634';
    for (const bx of [s.x1 + 16, s.x2 - 22]) {
      g.beginPath();
      g.moveTo(bx, s.y + 10);
      g.lineTo(bx + 6, s.y + 10);
      g.lineTo(bx + 6, s.y + 26);
      g.closePath();
      g.fill();
    }
    // A potted plant at the end of the shelf.
    const px = s.x2 - 14;
    g.fillStyle = '#6FBF7E';
    for (const [dx, dy, r] of [
      [-6, -22, 7],
      [3, -27, 8],
      [8, -19, 6],
    ]) {
      g.beginPath();
      g.ellipse(px + dx, s.y + dy, r * 0.7, r, dx * 0.05, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#D9704C';
    roundRect(g, px - 9, s.y - 14, 18, 14, 3);
    g.fill();
    // Wooden floor with planks.
    const fy = H - FLOOR;
    const fl = g.createLinearGradient(0, fy, 0, H);
    fl.addColorStop(0, '#C98D62');
    fl.addColorStop(1, '#A86B45');
    g.fillStyle = fl;
    g.fillRect(0, fy, W, FLOOR);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(0, fy, W, 3);
    g.strokeStyle = 'rgba(74, 35, 23, 0.18)';
    g.lineWidth = 1;
    for (let x = 60; x < W; x += 120) {
      g.beginPath();
      g.moveTo(x, fy + 3);
      g.lineTo(x, H);
      g.stroke();
    }
    // Rug.
    g.fillStyle = 'rgba(232, 69, 90, 0.35)';
    g.beginPath();
    g.ellipse(W * 0.3, fy + 12, 120, 9, 0, 0, Math.PI * 2);
    g.fill();
  }

  bindMouse() {
    const pos = (e) => {
      const r = this.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    this.canvas.addEventListener('mousemove', (e) => {
      const p = pos(e);
      const st = this.st;
      st.cursor.x = p.x;
      st.cursor.y = p.y;
      st.cursor.t = st.t;
      if (this.press && !this.dragging && Math.hypot(p.x - this.press.x, p.y - this.press.y) > 4) {
        this.dragging = true;
        grab(st, this.press.x, this.press.y);
        this.canvas.classList.add('grabbing');
      }
      if (this.dragging) moveHeld(st, p.x, p.y);
    });
    this.canvas.addEventListener('mousedown', (e) => {
      const p = pos(e);
      if (hitTest(this.st, p.x, p.y)) this.press = p;
    });
    window.addEventListener('mouseup', () => {
      if (this.dragging) release(this.st);
      else if (this.press) poke(this.st);
      this.press = null;
      this.dragging = false;
      this.canvas.classList.remove('grabbing');
    });
  }

  setLook(look) {
    this.look = normalizeLook(look);
    this.st.look = this.look;
  }

  setMotion(motion) {
    this.motion = normalizeMotion(motion);
    this.st.motion = this.motion;
  }

  /** Show off the walk style: stroll across the room and back. */
  demo() {
    const st = this.st;
    const floor = this.H - FLOOR;
    const go = (x) => {
      st.cursor = { x, y: floor - 30, t: st.t + 30 };
      st.commands.push({ name: 'come' });
    };
    const first = st.char.x < this.W / 2 ? this.W * 0.8 : this.W * 0.2;
    go(first);
    clearTimeout(this.demoTimer);
    this.demoTimer = setTimeout(() => go(first > this.W / 2 ? this.W * 0.22 : this.W * 0.78), 2800);
  }

  setName(name) {
    this.name = name || '';
    this.st.settings.name = this.name;
    this.nameTag.textContent = this.name || 'No name yet';
  }

  setScale(scale) {
    this.scale = scale || 1.4;
    this.st.char.scale = this.stageScale;
  }

  /** During a focus session it sits at its laptop here too. */
  setFocus(f) {
    this.st.focus = f && f.phase !== 'idle' ? f : null;
  }

  /** Make it do something: 'wave', 'celebrate', 'spin', 'dance', 'flip', 'jump', 'stretch'... */
  emote(name) {
    this.st.commands.push({ name });
  }

  react(kind) {
    this.st.commands.push({ name: 'react', kind });
  }

  say(text, ms = 2600) {
    this.bubble.textContent = text;
    this.bubble.classList.add('show');
    this.bubbleUntil = performance.now() + ms;
    this.talk(Math.min(ms, 400 + text.length * 45));
  }

  talk(ms) {
    this.talkUntil = Math.max(this.talkUntil, performance.now() + ms);
  }

  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    const st = this.st;
    if (!st || document.hidden) return;
    st.clock.hour = new Date().getHours();
    step(st, this.world, emptyInput(), dt);
    while (st.say.length) {
      const m = st.say.shift();
      this.say(m.text, 2600);
    }
    if (now < this.talkUntil) st.anim.talk = 0.12;
    st.groundY = st.char.mode === 'ground' ? st.char.y : this.world.regions[0].h;
    this.drawBackdrop();
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.backdrop, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    drawRope(ctx, st);
    drawCharacter(ctx, st);
    drawParticles(ctx, st.particles, st.char.scale);
    // Speech bubble above the head.
    if (this.bubbleUntil && now > this.bubbleUntil) {
      this.bubble.classList.remove('show');
      this.bubbleUntil = 0;
    }
    const c = st.char;
    const top = c.y - (CENTER_Y + headRise(st.look) + bodyMotion(st).lift + 14) * c.scale;
    const bw = this.bubble.offsetWidth || 120;
    const bx = Math.max(bw / 2 + 8, Math.min(this.W - bw / 2 - 8, c.x));
    const by = Math.max((this.bubble.offsetHeight || 40) + 8, top);
    this.bubble.style.left = `${bx}px`;
    this.bubble.style.top = `${by}px`;
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
