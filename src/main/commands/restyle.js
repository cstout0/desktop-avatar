// Words people use for the character's shapes and moves, mapped to setting values
// ("turn into a blob" -> body: slime, "walk like a penguin" -> gait: waddle).
import { ANTENNAS, ARMS, BODIES, LEGS } from '../../renderer/overlay/bodies.js';
import { GAITS, TRAILS } from '../../renderer/overlay/motion.js';

const SYNONYMS = {
  body: {
    ball: 'mochi', round: 'mochi', circle: 'mochi', mochi: 'mochi', dumpling: 'mochi',
    bean: 'bean', jellybean: 'bean', pill: 'bean', capsule: 'bean',
    toast: 'box', bread: 'box', box: 'box', cube: 'box', square: 'box', block: 'box',
    pear: 'pear', heart: 'heart', star: 'star', starfish: 'star',
    ghost: 'ghost', spirit: 'ghost', spooky: 'ghost',
    slime: 'slime', blob: 'slime', jelly: 'slime', goo: 'slime', jello: 'slime',
    cloud: 'cloud', cloudy: 'cloud',
    classic: 'classic', original: 'classic', normal: 'classic', default: 'classic', regular: 'classic', yourself: 'classic', gumdrop: 'classic',
  },
  gait: {
    robot: 'robot', android: 'robot', machine: 'robot',
    penguin: 'waddle', duck: 'waddle', duckling: 'waddle', waddle: 'waddle',
    bunny: 'hop', rabbit: 'hop', frog: 'hop', kangaroo: 'hop', hop: 'hop', bounce: 'hop', bouncy: 'hop',
    ghost: 'float', float: 'float', fairy: 'float', floating: 'float',
    model: 'strut', boss: 'strut', rockstar: 'strut', superstar: 'strut', strut: 'strut', diva: 'strut',
    ninja: 'tiptoe', spy: 'tiptoe', mouse: 'tiptoe', thief: 'tiptoe', burglar: 'tiptoe', cat: 'tiptoe', tiptoe: 'tiptoe', sneak: 'tiptoe', sneaky: 'tiptoe',
    ball: 'roll', wheel: 'roll', roll: 'roll', rolling: 'roll', tumbleweed: 'roll',
    normal: 'walk', person: 'walk', human: 'walk', walk: 'walk', me: 'walk',
    yourself: 'auto', natural: 'auto', usual: 'auto',
  },
  trail: {
    sparkles: 'sparkles', sparkle: 'sparkles', glitter: 'sparkles', sparkly: 'sparkles',
    hearts: 'hearts', heart: 'hearts', love: 'hearts',
    bubbles: 'bubbles', bubble: 'bubbles',
    music: 'notes', notes: 'notes', note: 'notes', musical: 'notes',
    stars: 'stars', star: 'stars', stardust: 'stars',
    rainbow: 'rainbow', rainbows: 'rainbow',
    none: 'none', nothing: 'none', no: 'none',
  },
  arms: { wings: 'wings', wing: 'wings', gloves: 'gloves', glove: 'gloves', paws: 'paws', paw: 'paws', noodle: 'noodle', noodles: 'noodle', tiny: 'tiny', trex: 'tiny', nubby: 'nubby', chubby: 'nubby' },
  legs: { sneakers: 'sneakers', shoes: 'sneakers', trainers: 'sneakers', boots: 'boots', wellies: 'boots', paws: 'paws', stick: 'stick', noodle: 'noodle', stubby: 'stubby', none: 'none', hover: 'none' },
  antenna: { sparkle: 'sparkle', star: 'star', heart: 'heart', bulb: 'bulb', lightbulb: 'bulb', sprout: 'sprout', leaf: 'sprout', leaves: 'sprout', none: 'none' },
};

const LISTS = { body: BODIES, gait: GAITS, trail: TRAILS, arms: ARMS, legs: LEGS, antenna: ANTENNAS };

/** "a bowling ball" (gait) -> "roll"; unknown -> null. */
export function resolveStyle(kind, word) {
  const w = String(word ?? '')
    .toLowerCase()
    .replace(/[^a-z\s-]/g, '')
    .replace(/-/g, '')
    .replace(/^\s*(?:a|an|the|some|little|tiny|big)\s+/, '')
    .trim();
  if (!w) return null;
  const table = SYNONYMS[kind] ?? {};
  if (table[w]) return table[w];
  const last = w.split(/\s+/).pop(); // "bowling ball" -> "ball"
  if (table[last]) return table[last];
  const hit = (LISTS[kind] ?? []).find((x) => x.id === w || x.label.toLowerCase() === w);
  return hit?.id ?? null;
}

/** For "I can be a ghost, a slime..." replies. */
export const bodyNames = () => BODIES.filter((b) => b.id !== 'classic').map((b) => b.label.toLowerCase());
