// The character's customizable look: body shape and color, hat, glasses,
// neckwear, antenna tip and an accent color for the accessories. Pure data +
// color math, shared by the simulation (antenna height), the renderer and the
// settings window.
import { ANTENNAS, ARMS, BODIES, bodyOf, hasLegs, hoverOf, LEGS } from './bodies.js';
import { BODY } from './sim/constants.js';

export { ANTENNAS, ARMS, BODIES, bodyOf, hasLegs, hoverOf, LEGS };

export const DEFAULT_LOOK = {
  body: 'classic',
  color: 'clay',
  hue: 16,
  shade: 60,
  accent: '#E8455A',
  hat: 'none',
  glasses: 'none',
  neck: 'none',
  antenna: 'sparkle',
  arms: 'nubby',
  legs: 'stubby',
};

// `clay` is the original hand-picked palette; the others are generated from HSL.
export const COLOR_PRESETS = [
  { id: 'clay', label: 'Clay', swatch: '#E27A52' },
  { id: 'tangerine', label: 'Tangerine', h: 30, s: 88, l: 58 },
  { id: 'sunflower', label: 'Sunflower', h: 45, s: 88, l: 57 },
  { id: 'lime', label: 'Lime', h: 86, s: 52, l: 54 },
  { id: 'mint', label: 'Mint', h: 158, s: 46, l: 58 },
  { id: 'sky', label: 'Sky', h: 200, s: 70, l: 62 },
  { id: 'ocean', label: 'Ocean', h: 216, s: 58, l: 55 },
  { id: 'grape', label: 'Grape', h: 268, s: 46, l: 62 },
  { id: 'bubblegum', label: 'Bubblegum', h: 330, s: 72, l: 72 },
  { id: 'cherry', label: 'Cherry', h: 356, s: 68, l: 58 },
  { id: 'cocoa', label: 'Cocoa', h: 24, s: 36, l: 46 },
  { id: 'snow', label: 'Snow', h: 205, s: 22, l: 90 },
  { id: 'slate', label: 'Slate', h: 222, s: 18, l: 52 },
  { id: 'custom', label: 'Custom' },
];

export const ACCENTS = ['#E8455A', '#F2A93B', '#4FAE6A', '#3E8EDE', '#8A5CD6', '#F07AB5', '#2B2B33', '#FFFFFF'];

// `lift`: how far the antenna has to rise to poke out of the hat (body units).
export const HATS = [
  { id: 'none', label: 'None', lift: 0 },
  { id: 'party', label: 'Party hat', lift: 17 },
  { id: 'tophat', label: 'Top hat', lift: 19 },
  { id: 'crown', label: 'Crown', lift: 6 },
  { id: 'beanie', label: 'Beanie', lift: 6 },
  { id: 'cowboy', label: 'Cowboy hat', lift: 10 },
  { id: 'wizard', label: 'Wizard hat', lift: 26 },
  { id: 'pirate', label: 'Pirate hat', lift: 11 },
  { id: 'chef', label: 'Chef hat', lift: 18 },
  { id: 'propeller', label: 'Propeller cap', lift: 8 },
  { id: 'headphones', label: 'Headphones', lift: 3 },
  { id: 'catears', label: 'Cat ears', lift: 0 },
  { id: 'bow', label: 'Hair bow', lift: 0 },
  { id: 'flower', label: 'Flower', lift: 0 },
];

export const GLASSES = [
  { id: 'none', label: 'None' },
  { id: 'round', label: 'Round glasses' },
  { id: 'shades', label: 'Sunglasses' },
  { id: 'star', label: 'Star glasses' },
  { id: 'heart', label: 'Heart glasses' },
  { id: 'monocle', label: 'Monocle' },
];

export const NECKWEAR = [
  { id: 'none', label: 'None' },
  { id: 'bowtie', label: 'Bow tie' },
  { id: 'scarf', label: 'Scarf' },
  { id: 'bandana', label: 'Bandana' },
  { id: 'bell', label: 'Bell collar' },
  { id: 'lei', label: 'Flower lei' },
];

// One-click outfits for the settings window.
export const OUTFITS = [
  { id: 'classic', label: 'Classic', look: { color: 'clay', hat: 'none', glasses: 'none', neck: 'none' } },
  { id: 'party', label: 'Party animal', look: { hat: 'party', glasses: 'star', neck: 'bowtie', accent: '#F07AB5' } },
  { id: 'rockstar', label: 'Rock star', look: { hat: 'headphones', glasses: 'shades', neck: 'bandana', accent: '#2B2B33' } },
  { id: 'captain', label: 'Captain', look: { hat: 'pirate', glasses: 'none', neck: 'bandana', accent: '#E8455A' } },
  { id: 'wizard', label: 'Wizard', look: { hat: 'wizard', glasses: 'round', neck: 'scarf', accent: '#8A5CD6' } },
  { id: 'chef', label: 'Chef', look: { hat: 'chef', glasses: 'none', neck: 'scarf', accent: '#E8455A' } },
  { id: 'royal', label: 'Royalty', look: { hat: 'crown', glasses: 'monocle', neck: 'bowtie', accent: '#8A5CD6' } },
  { id: 'cozy', label: 'Cozy', look: { hat: 'beanie', glasses: 'round', neck: 'scarf', accent: '#3E8EDE' } },
  { id: 'cowpoke', label: 'Cowpoke', look: { hat: 'cowboy', glasses: 'none', neck: 'bandana', accent: '#E8455A' } },
  { id: 'kitty', label: 'Kitty', look: { hat: 'catears', glasses: 'heart', neck: 'bell', accent: '#F07AB5' } },
];

const byId = (list, id) => list.find((x) => x.id === id) ?? list[0];

/** Fill in defaults and drop anything unknown (settings files are hand-editable). */
export function normalizeLook(look) {
  const l = { ...DEFAULT_LOOK, ...(look || {}) };
  if (!COLOR_PRESETS.some((c) => c.id === l.color)) l.color = DEFAULT_LOOK.color;
  if (!HATS.some((x) => x.id === l.hat)) l.hat = 'none';
  if (!GLASSES.some((x) => x.id === l.glasses)) l.glasses = 'none';
  if (!NECKWEAR.some((x) => x.id === l.neck)) l.neck = 'none';
  if (!BODIES.some((x) => x.id === l.body)) l.body = DEFAULT_LOOK.body;
  if (!ANTENNAS.some((x) => x.id === l.antenna)) l.antenna = DEFAULT_LOOK.antenna;
  if (!ARMS.some((x) => x.id === l.arms)) l.arms = DEFAULT_LOOK.arms;
  if (!LEGS.some((x) => x.id === l.legs)) l.legs = DEFAULT_LOOK.legs;
  l.hue = Math.round(Math.min(360, Math.max(0, Number(l.hue) || 0)));
  l.shade = Math.round(Math.min(82, Math.max(38, Number(l.shade) || 60)));
  if (!/^#[0-9a-f]{6}$/i.test(l.accent)) l.accent = DEFAULT_LOOK.accent;
  return l;
}

/** Extra antenna height for the current hat, in body units. */
export function hatLift(look) {
  return byId(HATS, look?.hat).lift;
}

/** From the body center up to the antenna tip (body units): body shape + hat. */
export function headRise(look) {
  return -bodyOf(look).top + BODY.antenna + hatLift(look);
}

/** How much taller than the plain classic body this look is (hats, tall shapes), in body units. */
export function extraHeight(look) {
  return headRise(look) - (BODY.h / 2 + BODY.antenna);
}

export const hsl = (h, s, l, a = 1) => `hsla(${Math.round(h)}, ${Math.round(Math.min(100, Math.max(0, s)))}%, ${Math.round(Math.min(98, Math.max(2, l)))}%, ${a})`;

const CLAY = {
  body: '#E27A52',
  bodyLight: '#F59E76',
  bodyDark: '#C35A3A',
  belly: '#FAD2B8',
  outline: '#4A2317',
  eye: '#2A140F',
  blush: 'rgba(255, 112, 104, 0.55)',
  mouth: '#5E2217',
  tongue: '#F27C7C',
};

const cache = new Map();

/** Colors for the body and face. Hands, feet and the antenna reuse these. */
export function paletteFor(look) {
  const l = look || DEFAULT_LOOK;
  const key = l.color === 'custom' ? `custom:${l.hue}:${l.shade}` : l.color;
  let p = cache.get(key);
  if (p) return p;
  if (l.color === 'clay' || !l.color) {
    p = CLAY;
  } else {
    const preset = l.color === 'custom' ? { h: l.hue, s: 66, l: l.shade } : byId(COLOR_PRESETS, l.color);
    const { h, s } = preset;
    const lt = preset.l;
    const pale = lt > 80; // "Snow": keep the outline and face a touch softer
    p = {
      body: hsl(h, s, lt),
      bodyLight: hsl(h, s + 6, lt + (pale ? 5 : 11)),
      bodyDark: hsl(h, s + 4, lt - (pale ? 12 : 15)),
      belly: hsl(h, s * 0.85, Math.min(95, lt + 24)),
      outline: hsl(h, Math.min(48, s * 0.7 + 8), pale ? 22 : 15),
      eye: hsl(h, 30, 9),
      blush: 'rgba(255, 112, 104, 0.55)',
      mouth: hsl(h, 45, 20),
      tongue: '#F27C7C',
    };
  }
  cache.set(key, p);
  return p;
}

/** The swatch color shown for a preset in the settings window. */
export function swatchFor(presetId, look = DEFAULT_LOOK) {
  if (presetId === 'custom') return paletteFor({ ...look, color: 'custom' }).body;
  return paletteFor({ color: presetId }).body;
}
