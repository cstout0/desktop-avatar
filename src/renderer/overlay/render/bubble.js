// Speech bubble (DOM) with a typewriter effect. Its state lives in st.ui so a
// half-typed sentence survives the character walking onto the other monitor.
import { CENTER_Y } from '../sim/constants.js';
import { headRise } from '../look.js';
import { bodyMotion } from '../motion.js';

const CPS = 55; // characters per second

export function newBubbleState() {
  return { id: 0, text: '', shown: 0, mood: 'normal', until: 0, hold: false, actions: [], dots: false, sticky: false };
}

export function queueBubble(ui, st, { text, mood = 'normal', dur, actions = [], sticky = false }) {
  const b = ui.bubble;
  b.id++;
  b.text = String(text ?? '').slice(0, 600);
  b.shown = 0;
  b.mood = mood;
  b.actions = actions;
  b.dots = mood === 'thinking';
  b.sticky = sticky;
  const read = Math.min(14, Math.max(2.6, 1.6 + b.text.length * 0.06));
  b.until = st.t + (dur ?? read) + b.text.length / CPS;
}

export function hideBubble(ui) {
  ui.bubble.until = 0;
  ui.bubble.sticky = false;
}

export class BubbleView {
  constructor(root, onAction) {
    this.el = document.createElement('div');
    this.el.id = 'bubble';
    this.text = document.createElement('div');
    this.text.className = 'bubble-text';
    this.actions = document.createElement('div');
    this.actions.className = 'bubble-actions';
    this.tail = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.tail.setAttribute('class', 'bubble-tail');
    this.tail.setAttribute('viewBox', '0 0 22 13');
    this.tail.innerHTML = '<path d="M1 0 L11 11 L21 0" fill="#FFFDF8" stroke="#4A2317" stroke-width="2" stroke-linejoin="round"/><rect x="2" y="-2" width="18" height="3" fill="#FFFDF8"/>';
    this.el.append(this.text, this.actions, this.tail);
    root.append(this.el);
    this.renderedId = -1;
    this.renderedShown = -1;
    this.visible = false;
    this.hovered = false;
    this.rect = null;
    this.el.addEventListener('mouseenter', () => (this.hovered = true));
    this.el.addEventListener('mouseleave', () => (this.hovered = false));
    this.el.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      const btn = e.target.closest('button[data-action]');
      if (btn) onAction(btn.dataset.action);
      else onAction('__dismiss');
    });
  }

  /** Advance typing and position the bubble. Returns true if the character is "talking". */
  update(st, ui, dt, origin, area) {
    const b = ui.bubble;
    const active = b.sticky || st.t < b.until || this.hovered;
    if (!active || !b.text) {
      if (this.visible) {
        this.el.classList.remove('show');
        this.visible = false;
        this.rect = null;
      }
      return false;
    }
    if (this.hovered && !b.sticky) b.until = Math.max(b.until, st.t + 1.2);
    const typing = b.shown < b.text.length;
    if (typing) b.shown = Math.min(b.text.length, b.shown + CPS * dt);
    const shownInt = Math.floor(b.shown);
    if (this.renderedId !== b.id) {
      const replacing = this.visible;
      this.renderedId = b.id;
      this.renderedShown = -1;
      // Swap only the mood class: resetting className would drop "show" and hide the bubble.
      for (const cls of [...this.el.classList]) if (cls.startsWith('mood-')) this.el.classList.remove(cls);
      this.el.classList.add(`mood-${b.mood}`);
      if (replacing) {
        // Replay the pop-in for the new message.
        this.el.classList.remove('show');
        void this.el.offsetWidth;
        this.el.classList.add('show');
      }
      this.actions.innerHTML = '';
      for (const a of b.actions || []) {
        const btn = document.createElement('button');
        btn.dataset.action = a.id;
        btn.textContent = a.label;
        this.actions.append(btn);
      }
      this.actions.style.display = 'none';
    }
    if (shownInt !== this.renderedShown) {
      this.renderedShown = shownInt;
      if (b.dots) this.text.innerHTML = '<span class="dots"><i></i><i></i><i></i></span>';
      else this.text.textContent = b.text.slice(0, shownInt) || ' ';
      if (!typing && b.actions?.length) this.actions.style.display = 'flex';
    }
    if (!this.visible) {
      this.visible = true;
      requestAnimationFrame(() => this.el.classList.add('show'));
    }
    // Position above the character's head, clamped to this monitor.
    const c = st.char;
    const s = c.scale;
    const headY = c.y - (CENTER_Y + headRise(st.look) + bodyMotion(st).lift + 12) * s;
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    const margin = 10;
    let below = false;
    let top = headY - 12 - h;
    if (top < area.y + margin) {
      below = true;
      top = c.y + 14 * s;
    }
    let left = c.x - w / 2;
    left = Math.max(area.x + margin, Math.min(area.x + area.w - w - margin, left));
    const tailX = Math.max(16, Math.min(w - 16, c.x - left));
    this.el.style.transform = `translate(${Math.round(left - origin.x)}px, ${Math.round(top - origin.y)}px)`;
    this.el.style.setProperty('--tail-x', `${tailX}px`);
    this.el.classList.toggle('below', below);
    this.rect = { x1: left, y1: top, x2: left + w, y2: top + h };
    return typing && !b.dots;
  }

  hitTest(x, y) {
    const r = this.rect;
    return !!r && x >= r.x1 && x <= r.x2 && y >= r.y1 - 4 && y <= r.y2 + 12;
  }
}
