// How the character moves: its walk style, what it does while standing around,
// how jiggly it is, and an optional trail. Pure data shared by the simulation,
// the renderer and the settings window.
import { bodyOf, hasLegs, hoverOf } from './bodies.js';

export const GAITS = [
  { id: 'auto', label: 'Natural', emoji: '✨', hint: 'Whatever suits its body' },
  { id: 'walk', label: 'Walk', emoji: '🚶', hint: 'Step by step' },
  { id: 'hop', label: 'Hop', emoji: '🐰', hint: 'Boing, boing' },
  { id: 'waddle', label: 'Waddle', emoji: '🐧', hint: 'Side to side' },
  { id: 'strut', label: 'Strut', emoji: '😎', hint: 'Big steps, swinging arms' },
  { id: 'tiptoe', label: 'Tiptoe', emoji: '🤫', hint: 'Sneaky and careful' },
  { id: 'float', label: 'Float', emoji: '👻', hint: 'Drifts above the floor' },
  { id: 'roll', label: 'Roll', emoji: '🎳', hint: 'Tumbles along like a ball' },
  { id: 'robot', label: 'Robot', emoji: '🤖', hint: 'Stiff, clicky steps' },
];

export const IDLES = [
  { id: 'breathe', label: 'Breathe' },
  { id: 'bob', label: 'Bob' },
  { id: 'sway', label: 'Sway' },
  { id: 'bounce', label: 'Bounce' },
  { id: 'wiggle', label: 'Wiggle' },
  { id: 'still', label: 'Still' },
];

export const TRAILS = [
  { id: 'none', label: 'None', emoji: '🚫' },
  { id: 'sparkles', label: 'Sparkles', emoji: '✨' },
  { id: 'hearts', label: 'Hearts', emoji: '💕' },
  { id: 'bubbles', label: 'Bubbles', emoji: '🫧' },
  { id: 'notes', label: 'Music', emoji: '🎵' },
  { id: 'stars', label: 'Stars', emoji: '⭐' },
  { id: 'rainbow', label: 'Rainbow', emoji: '🌈' },
];

export const DEFAULT_MOTION = { gait: 'auto', idle: 'breathe', jiggle: 0.5, trail: 'none' };

/** Fill in defaults and drop anything unknown (settings files are hand-editable). */
export function normalizeMotion(m) {
  const o = { ...DEFAULT_MOTION, ...(m || {}) };
  if (!GAITS.some((g) => g.id === o.gait)) o.gait = DEFAULT_MOTION.gait;
  if (!IDLES.some((i) => i.id === o.idle)) o.idle = DEFAULT_MOTION.idle;
  if (!TRAILS.some((t) => t.id === o.trail)) o.trail = DEFAULT_MOTION.trail;
  const j = Number(o.jiggle);
  o.jiggle = Number.isFinite(j) ? Math.min(1, Math.max(0, j)) : DEFAULT_MOTION.jiggle;
  return o;
}

/** The walk style actually used ("Natural" picks the body's own). */
export function gaitOf(st) {
  const g = st.motion?.gait ?? 'auto';
  if (g !== 'auto') return g;
  return hasLegs(st.look) || !bodyOf(st.look).hip ? bodyOf(st.look).gait : 'float';
}

export const idleOf = (st) => st.motion?.idle ?? 'breathe';
export const jiggleOf = (st) => st.motion?.jiggle ?? 0.5;

const SITTING = new Set(['sit', 'sleep', 'watch', 'work']);

/** Hop height (0..1) at a point in the walk cycle: one hop per half turn of the slowed phase. */
export const hopPhase = (walkPhase) => walkPhase * 0.36;
export const hopUp = (walkPhase) => Math.abs(Math.sin(hopPhase(walkPhase)));

/** Idle "bounce": a little hop every 1.4 s (0..1 height). */
export function idleHop(t) {
  const u = (t % 1.4) / 1.4;
  return u < 0.3 ? Math.sin((u / 0.3) * Math.PI) : 0;
}

/**
 * How far the whole body is lifted off the floor (body units) by the walk/idle
 * style or by hovering, and how far it has rolled. Visual only: the physics
 * still puts the feet on the ground.
 */
export function bodyMotion(st) {
  const c = st.char;
  const a = st.anim;
  const shape = bodyOf(st.look);
  const hover = hoverOf(st.look);
  const grounded = c.mode === 'ground';
  let lift = 0;
  if (grounded) {
    const gait = gaitOf(st);
    const k = Math.min(1, Math.abs(c.vx) / (165 * c.scale));
    if (hover) lift += hover * (SITTING.has(a.pose) ? 0.5 : 1) + Math.sin(st.t * 2.2) * 1.6;
    if (a.pose === 'walk') {
      if (gait === 'hop') lift += hopUp(a.walkPhase) * k * (shape.hop ?? 1) * 10;
      else if (gait === 'float' && !hover) lift += k * 8 + Math.sin(st.t * 2.4) * 1.5 * k;
    }
    if (a.pose === 'stand' && idleOf(st) === 'bounce') lift += idleHop(st.t) * 5;
  } else if (hover) {
    lift += hover * 0.5;
  }
  return { lift, roll: a.roll ?? 0 };
}
