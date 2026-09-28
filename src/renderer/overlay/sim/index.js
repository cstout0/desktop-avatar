// Simulation entry point. `st` is a plain object: it can be cloned across IPC
// when Claude walks from one monitor's window to another's.
import { MAX_FRAME_DT, SUBSTEP } from './constants.js';
import { newAnim, physicalPose, setPose, stepAnim } from './anim.js';
import { emptyInput, newBrain, onEvent, think } from './behavior.js';
import { carryWithPlatforms, newChar, stepCharacter } from './physics.js';
import { stepParticles } from './particles.js';

export const DEFAULT_SETTINGS = {
  audio: true,
  walkOnWindows: true,
  sleepAfter: 240,
  chattiness: 'normal',
};

export function createState({ x, y, scale = 1.25, seed = Date.now() % 100000, settings = {} }) {
  return {
    t: 0,
    char: newChar(x, y, scale),
    anim: newAnim(),
    brain: newBrain(),
    particles: [],
    events: [],
    commands: [],
    say: [],
    control: { active: false, lastInput: 0 },
    audio: { music: false, lastMusic: -99, bpm: 0, energy: 0 },
    cursor: { x: -9999, y: -9999, t: -99 },
    flags: { thinking: false, listening: false, chatAt: null },
    stats: { lastInteraction: 0 },
    clock: { hour: new Date().getHours() },
    settings: { ...DEFAULT_SETTINGS, ...settings },
    seed: seed | 0 || 1,
  };
}

/**
 * Advance the world by one rendered frame. `keys` is the keyboard-driven input
 * (used while the player is controlling Claude); otherwise the brain drives.
 */
export function step(st, world, keys, frameDt) {
  const dt = Math.min(Math.max(frameDt, 0), MAX_FRAME_DT);
  st.events.length = 0;
  const ai = think(st, world, dt);
  const input = st.control.active ? keys : ai;
  const n = Math.max(1, Math.ceil(dt / SUBSTEP - 1e-9));
  const h = dt / n;
  for (let i = 0; i < n; i++) stepCharacter(st, world, input, h);
  if (st.control.active) {
    const c = st.char;
    const crouch = c.mode === 'ground' && keys.down && Math.abs(c.vx) < 20 * c.scale;
    setPose(st, crouch ? 'crouch' : physicalPose(c));
  }
  for (const e of st.events) onEvent(st, world, e);
  stepAnim(st, dt);
  stepParticles(st, dt);
  st.t += dt;
  return input;
}

/** New window/monitor geometry arrived: carry Claude along with its window. */
export function applyWorld(st, oldWorld, newWorld) {
  if (oldWorld) carryWithPlatforms(st, oldWorld, newWorld);
}

export function setControl(st, active) {
  st.control.active = active;
  st.control.lastInput = st.t;
  st.stats.lastInteraction = st.t;
  if (active) st.brain.name = 'controlled';
}

export { emptyInput };
