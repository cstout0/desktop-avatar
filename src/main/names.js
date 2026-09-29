// The character's name: picked by the user on first run (or changed later).

// Ideas for the 🎲 button. It's a round, clay-orange little guy, so lots of orange things.
export const NAME_IDEAS = [
  'Pixel', 'Ember', 'Nugget', 'Mochi', 'Biscuit', 'Clementine', 'Sprocket', 'Pip', 'Noodle', 'Marmalade',
  'Ziggy', 'Waffles', 'Bolt', 'Peaches', 'Gizmo', 'Tangerine', 'Bean', 'Sunny', 'Pumpkin', 'Taco',
  'Button', 'Nova', 'Apricot', 'Momo', 'Sprout', 'Butterscotch', 'Chip', 'Mango', 'Pebble', 'Toffee',
];

export const MAX_NAME = 24;

/**
 * Tidy what the user typed or said into a usable name ("  pixel!" -> "Pixel",
 * "how about mr bubbles" -> "Mr Bubbles"). Returns '' if nothing usable is left.
 */
export function cleanName(raw) {
  let s = String(raw ?? '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim()
    .replace(/^(?:(?:how\s+about|maybe|let'?s\s+go\s+with|i'?ll\s+call\s+you|call\s+you|your\s+name\s+is|it'?s|you'?re)\s+)/i, '')
    .replace(/[^\p{L}\p{N}\s'.-]/gu, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s'.-]+|[\s'.-]+$/g, '');
  if (s.length > MAX_NAME) {
    // Cut at a word boundary when that leaves something.
    const cut = s.slice(0, MAX_NAME);
    s = (s[MAX_NAME] === ' ' ? cut : cut.replace(/\s+\S*$/, '') || cut).replace(/[\s'.-]+$/, '');
  }
  if (!/\p{L}/u.test(s)) return '';
  // All lowercase? Capitalize each word. Otherwise keep the user's casing ("DJ", "iBot").
  if (s === s.toLowerCase()) s = s.replace(/(^|[\s-])(\p{L})/gu, (_m, pre, ch) => pre + ch.toUpperCase());
  return s;
}

/** A few name ideas, shuffled, never repeating `avoid`. */
export function nameIdeas(count = NAME_IDEAS.length, avoid = [], rand = Math.random) {
  const skip = new Set(avoid.map((n) => String(n).toLowerCase()));
  const pool = NAME_IDEAS.filter((n) => !skip.has(n.toLowerCase()));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}
