// The Settings window: navigation, sections, and live reactions on the stage.
import { h, section, card, row, toggle, segmented, slider, textInput, select, button, pill, swatches, tiles, toast } from './ui.js';
import { Stage } from './stage.js';
import { drawThumb, liveThumb } from './thumbs.js';
import { ACCENTS, ANTENNAS, ARMS, BODIES, COLOR_PRESETS, GLASSES, HATS, LEGS, NECKWEAR, OUTFITS, normalizeLook, swatchFor } from '../overlay/look.js';
import { GAITS, IDLES, TRAILS, normalizeMotion } from '../overlay/motion.js';

const api = window.avatar;
const state = { settings: {}, meta: {}, section: new URLSearchParams(location.search).get('section') || 'buddy' };
const $ = (id) => document.getElementById(id);
const get = (key) => key.split('.').reduce((o, k) => o?.[k], state.settings);
const nameOf = () => state.settings.name || '';
const buddy = () => nameOf() || 'your buddy';
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

let stage;
let savedTimer;

function flashSaved() {
  const el = $('saved');
  el.textContent = 'Saved ✓';
  el.classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => el.classList.remove('show'), 1400);
}

/** Change a setting here and in the app. */
async function set(key, value) {
  const parts = key.split('.');
  let o = state.settings;
  for (const p of parts.slice(0, -1)) o = o[p] ??= {};
  o[parts.at(-1)] = value;
  await api.set(key, value);
  flashSaved();
  syncStage();
}

async function act(name, arg) {
  try {
    return await api.action(name, arg);
  } catch (err) {
    toast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    return null;
  }
}

function syncStage() {
  stage.setLook(state.settings.look);
  stage.setMotion(state.settings.motion);
  stage.setName(nameOf());
  stage.setScale(state.settings.scale);
  $('roomTitle').textContent = nameOf() ? `${nameOf()}’s room` : 'My buddy’s room';
  document.title = nameOf() ? `${nameOf()} — Desktop Avatar settings` : 'Desktop Avatar settings';
}

// ---- sections -------------------------------------------------------------------------

const SECTIONS = [
  { id: 'buddy', emoji: '🧸', label: 'Buddy', sub: 'Name, personality', render: renderBuddy },
  { id: 'wardrobe', emoji: '🎨', label: 'Wardrobe', sub: 'Body, colors, outfits', render: renderWardrobe },
  { id: 'moves', emoji: '🕺', label: 'Moves', sub: 'Walk, idle, trails', render: renderMoves },
  { id: 'voice', emoji: '🔊', label: 'Voice', sub: 'Talking & listening', render: renderVoice },
  { id: 'senses', emoji: '🎧', label: 'Senses', sub: 'Music, videos, pings', render: renderSenses },
  { id: 'focus', emoji: '🍅', label: 'Focus', sub: 'Pomodoro & breaks', render: renderFocus },
  { id: 'play', emoji: '🎾', label: 'Play', sub: 'Mini-games', render: renderPlay },
  { id: 'brain', emoji: '🧠', label: 'Brain', sub: 'Local AI & memory', render: renderBrain },
  { id: 'app', emoji: '⚙️', label: 'App', sub: 'Hotkeys & startup', render: renderApp },
];

function renderNav() {
  const nav = $('nav');
  nav.replaceChildren(
    ...SECTIONS.map((s) =>
      h(
        'button',
        { class: `nav-item${s.id === state.section ? ' active' : ''}`, onClick: () => go(s.id), 'aria-current': s.id === state.section ? 'page' : null },
        h('span', { class: 'emoji' }, s.emoji),
        h('span', {}, s.label, h('span', { class: 'sub' }, s.sub)),
      ),
    ),
    h('div', { class: 'spacer' }),
    h('div', { class: 'local-badge' }, h('strong', {}, '● 100% on this PC'), 'No accounts, no cloud, no cost. Everything you see here stays on your computer.'),
  );
}

function go(id) {
  if (!SECTIONS.some((s) => s.id === id)) return;
  state.section = id;
  renderNav();
  render({ keepScroll: false });
}

function render({ keepScroll = true } = {}) {
  const main = document.querySelector('.main');
  const y = main.scrollTop;
  const s = SECTIONS.find((x) => x.id === state.section) ?? SECTIONS[0];
  $('content').replaceChildren(s.render());
  main.scrollTop = keepScroll ? y : 0;
}

// ---- Buddy ----------------------------------------------------------------------------------

const PERSONA_EMOJI = { cheerful: '😄', chill: '😌', sassy: '😏', pirate: '🏴‍☠️', shy: '🥺', hype: '🤩', custom: '✍️' };
const PERSONA_LINE = {
  cheerful: 'Yay! Let’s have a great day!',
  chill: 'Mm. Nice and easy.',
  sassy: 'Oh, *now* you want my opinion?',
  pirate: 'Arr! Hoist the windows, matey!',
  shy: 'Oh… um… hi… 👉👈',
  hype: 'LET’S GOOOO!!! 🔥',
  custom: 'Being my own unique self!',
};

function renderBuddy() {
  const m = state.meta;
  const nameInput = textInput({ value: nameOf(), placeholder: 'Give me a name…', maxlength: 24, width: '190px', onChange: () => {} });
  const doRename = async () => {
    const r = await act('rename', { name: nameInput.value });
    if (r?.name) {
      state.settings.name = r.name;
      nameInput.value = r.name;
      syncStage();
      stage.emote('celebrate');
      stage.say(`${r.name}! I love it! 🎉`);
      flashSaved();
    }
  };
  nameInput.addEventListener('keydown', (e) => e.key === 'Enter' && doRename());
  const personas = [...(m.personalities ?? []), { id: 'custom', label: 'Custom', blurb: 'Your own words, written below.' }];
  const current = state.settings.personality || 'cheerful';
  const personaGrid = h('div', { class: 'persona' });
  for (const p of personas) {
    const b = h('button', { type: 'button', class: p.id === current ? 'on' : '' }, h('b', {}, h('i', {}, PERSONA_EMOJI[p.id] ?? '🙂'), p.label), h('small', {}, p.blurb));
    b.addEventListener('click', async () => {
      for (const x of personaGrid.children) x.classList.remove('on');
      b.classList.add('on');
      await act('set-personality', { name: p.id });
      state.settings.personality = p.id;
      stage.emote('spin');
      stage.say(PERSONA_LINE[p.id] ?? 'How do I look?');
      flashSaved();
      if (p.id === 'custom') render();
    });
    personaGrid.append(b);
  }
  const editor = h('textarea', { class: 'text', spellcheck: 'true' }, m.customPersonality ?? '');
  return section(
    '🧸',
    nameOf() ? `Meet ${nameOf()}` : 'Meet your buddy',
    'Who they are and how they act. Everything here changes the character on your desktop right away.',
    card(
      'Name',
      'It answers to this name, even by voice ("Pixel, open Spotify").',
      row('Name', 'Letters, numbers, spaces and dashes (up to 24).', h('div', { class: 'btn-row' }, nameInput, button('🎲', () => (nameInput.value = pick(m.nameIdeas ?? ['Pixel'])), { title: 'Suggest a name', small: true }), button('Rename', doRename, { kind: 'primary', small: true })), { stack: true }),
    ),
    card(
      'Size & energy',
      null,
      row('Size', 'From a speck (0.01%) to a giant (500%). Very small sizes are hard to see and click.', sizeControl(), { stack: true }),
      row('Chattiness', 'How often it talks on its own.', segmented([{ value: 'quiet', label: 'Quiet' }, { value: 'normal', label: 'Normal' }, { value: 'chatty', label: 'Chatty' }], state.settings.chattiness ?? 'normal', (v) => set('chattiness', v))),
      row('Naps', 'Falls asleep after this long with nothing going on.', slider({ min: 60, max: 1200, step: 60, value: state.settings.sleepAfter ?? 240, format: (v) => `${Math.round(v / 60)} min`, onChange: (v) => set('sleepAfter', v) })),
      row('Climb on windows', 'Hops onto and climbs your app windows.', toggle(state.settings.walkOnWindows !== false, (v) => set('walkOnWindows', v))),
    ),
    card({ title: 'Personality', wide: true }, 'The local AI stays in character when it talks and when it decides what to do.', personaGrid),
    current === 'custom'
      ? card(
          { title: '✍️ Custom personality', wide: true },
          'Describe it in plain English. Changes apply instantly.',
          editor,
          h('div', { class: 'btn-row', style: { margin: '10px 0 6px' } }, button('Save personality', async () => {
            await act('save-custom-personality', { text: editor.value });
            stage.emote('celebrate');
            stage.say('New me, who dis? ✨');
            flashSaved();
          }, { kind: 'primary' })),
        )
      : null,
  );
}

// Size runs from 0.01% to 500% of normal (scale 1.4 = 100%) on a log scale, so
// both the tiny and the huge end get plenty of slider travel.
const BASE_SCALE = 1.4;
const MIN_PCT = 0.01;
const MAX_PCT = 500;
const STEPS = 1000;
const pctToStep = (pct) => Math.round((Math.log(pct / MIN_PCT) / Math.log(MAX_PCT / MIN_PCT)) * STEPS);
function stepToPct(u) {
  const pct = MIN_PCT * (MAX_PCT / MIN_PCT) ** (u / STEPS);
  return Math.abs(pct - 100) < 4 ? 100 : pct; // a little notch at normal size
}
const fmtPct = (pct) => (pct < 1 ? `${pct.toFixed(2)}%` : pct < 10 ? `${pct.toFixed(1)}%` : `${Math.round(pct)}%`);

function sizeControl() {
  const pct = ((state.settings.scale ?? BASE_SCALE) / BASE_SCALE) * 100;
  const apply = (p) => set('scale', +((p / 100) * BASE_SCALE).toPrecision(4));
  return h(
    'div',
    { class: 'btn-row', style: { alignItems: 'center', width: '100%' } },
    h('div', { style: { flex: '1' } }, slider({ min: 0, max: STEPS, step: 1, value: pctToStep(Math.min(MAX_PCT, Math.max(MIN_PCT, pct))), format: (u) => fmtPct(stepToPct(u)), onChange: (u) => apply(stepToPct(u)) })),
    button('100%', async () => {
      await apply(100);
      render();
    }, { small: true, title: 'Back to normal size' }),
  );
}

// ---- Wardrobe ---------------------------------------------------------------------------------

const QUIPS = {
  party: 'Party time! 🎉',
  tophat: 'Most distinguished. 🎩',
  crown: 'Bow before me! 👑',
  beanie: 'Cozy mode: on.',
  cowboy: 'Yeehaw! 🤠',
  wizard: 'You shall not… close that window! 🧙',
  pirate: 'Arr, a fine hat! 🏴‍☠️',
  chef: 'Something smells great! 🍳',
  propeller: 'Wheee, liftoff!',
  headphones: 'Drop the beat! 🎧',
  catears: 'Nya~ 🐱',
  bow: 'Cute, right? 🎀',
  flower: 'I feel so fresh 🌼',
  round: 'I can see clearly now.',
  shades: 'Too cool. 😎',
  star: 'Starstruck! ⭐',
  heart: 'Love it! 💖',
  monocle: 'Quite, quite.',
  bowtie: 'Dapper!',
  scarf: 'Toasty!',
  bandana: 'Adventure ready!',
  bell: 'Jingle jingle!',
  lei: 'Aloha! 🌺',
  none: 'Back to basics.',
};

const BODY_QUIPS = {
  classic: 'The original! 🍬',
  mochi: 'Squishy and round! 🍡',
  bean: 'Tall and lean. 🫘',
  box: 'Toasty! 🍞',
  pear: 'Pear-fectly shaped. 🍐',
  heart: 'All heart! 💗',
  star: 'Born to shine! ⭐',
  ghost: 'Boo! 👻',
  slime: 'Blorp! 🟢',
  cloud: 'Floating on cloud nine! ☁️',
};
const ARM_QUIPS = { nubby: 'Hugs available! 🤗', noodle: 'Noodly!', tiny: 'I can almost reach…', gloves: 'Very old-school!', paws: 'Paws up! 🐾', wings: 'Maybe I can fly? 🪽', none: 'Look, no hands!' };
const LEG_QUIPS = { stubby: 'Stompy!', noodle: 'Wobbly legs!', sneakers: 'Ready to run! 👟', boots: 'Splish splash! 🥾', paws: 'Pitter-patter 🐾', stick: 'Light on my feet.', none: 'Who needs legs? I float! 🛸' };
const ANTENNA_QUIPS = { sparkle: 'Sparkly! ✨', star: 'Star power! ⭐', heart: 'Love antenna! 💗', bulb: 'Bright idea! 💡', sprout: 'Growing up! 🌱', none: 'Incognito mode.' };
const GAIT_QUIPS = { auto: 'My own way!', walk: 'Step by step.', hop: 'Boing boing!', waddle: 'Waddle waddle 🐧', strut: 'Watch me strut 😎', tiptoe: 'Shhh… 🤫', float: 'Wooo, I’m floating! 👻', roll: 'Wheee! 🎳', robot: 'BEEP. BOOP. WALKING. 🤖' };
const IDLE_QUIPS = { breathe: 'In… and out.', bob: 'Bobbing along 🎶', sway: 'Swaying in the breeze.', bounce: 'Can’t stay still!', wiggle: 'Wiggle wiggle!', still: '… (statue mode)' };
const TRAIL_QUIPS = { none: 'No trail.', sparkles: 'Sparkly! ✨', hearts: 'Spreading the love 💕', bubbles: 'Bloop bloop 🫧', notes: 'La la la 🎵', stars: 'Stardust ⭐', rainbow: 'Rainbow road! 🌈' };

// A whole character in one click: body, colors, limbs and moves.
const COMBOS = [
  { id: 'ghostie', label: 'Spooky ghost', look: { body: 'ghost', color: 'snow', arms: 'nubby', antenna: 'none' }, motion: { gait: 'auto', idle: 'sway', trail: 'none', jiggle: 0.5 } },
  { id: 'slime', label: 'Bouncy slime', look: { body: 'slime', color: 'lime', arms: 'nubby', antenna: 'bulb' }, motion: { gait: 'hop', idle: 'wiggle', trail: 'bubbles', jiggle: 1 } },
  { id: 'robo', label: 'Robo toast', look: { body: 'box', color: 'slate', arms: 'gloves', legs: 'stick', antenna: 'bulb' }, motion: { gait: 'robot', idle: 'still', trail: 'none', jiggle: 0.1 } },
  { id: 'superstar', label: 'Superstar', look: { body: 'star', color: 'sunflower', arms: 'nubby', legs: 'sneakers', antenna: 'star', glasses: 'shades' }, motion: { gait: 'strut', idle: 'bob', trail: 'sparkles', jiggle: 0.5 } },
  { id: 'cloud', label: 'Cloud nine', look: { body: 'cloud', color: 'snow', arms: 'wings', antenna: 'sparkle' }, motion: { gait: 'float', idle: 'breathe', trail: 'rainbow', jiggle: 0.6 } },
  { id: 'love', label: 'Love bug', look: { body: 'heart', color: 'bubblegum', arms: 'paws', legs: 'stubby', antenna: 'heart' }, motion: { gait: 'hop', idle: 'bounce', trail: 'hearts', jiggle: 0.7 } },
  { id: 'mochi', label: 'Rolling mochi', look: { body: 'mochi', color: 'snow', arms: 'tiny', legs: 'stubby', antenna: 'sprout' }, motion: { gait: 'roll', idle: 'wiggle', trail: 'none', jiggle: 0.9 } },
  { id: 'sneaky', label: 'Sneaky bean', look: { body: 'bean', color: 'mint', arms: 'nubby', legs: 'sneakers', glasses: 'shades' }, motion: { gait: 'tiptoe', idle: 'sway', trail: 'none', jiggle: 0.4 } },
  { id: 'penguin', label: 'Penguin pal', look: { body: 'pear', color: 'slate', arms: 'wings', legs: 'stubby', neck: 'scarf' }, motion: { gait: 'waddle', idle: 'bob', trail: 'none', jiggle: 0.5 } },
  { id: 'original', label: 'The original', look: { body: 'classic', color: 'clay', arms: 'nubby', legs: 'stubby', antenna: 'sparkle', hat: 'none', glasses: 'none', neck: 'none' }, motion: { gait: 'auto', idle: 'breathe', trail: 'none', jiggle: 0.5 } },
];

function renderWardrobe() {
  const look = normalizeLook(state.settings.look);
  const setLook = async (patch, { emote = 'spin', line } = {}) => {
    const next = normalizeLook({ ...normalizeLook(state.settings.look), ...patch });
    await set('look', next);
    stage.emote(emote);
    if (line) stage.say(line, 2200);
  };
  const colorItems = COLOR_PRESETS.map((c) => ({ value: c.id, label: c.label, color: swatchFor(c.id, look), rainbow: c.id === 'custom' }));
  const thumb = (patch, crop = 'bust') => (canvas) => drawThumb(canvas, { ...look, ...patch }, { crop });
  const surprise = () => {
    const presets = COLOR_PRESETS.filter((c) => c.id !== 'custom');
    return {
      body: Math.random() < 0.6 ? pick(BODIES).id : look.body,
      color: pick(presets).id,
      hat: pick(HATS).id,
      glasses: Math.random() < 0.55 ? 'none' : pick(GLASSES).id,
      neck: Math.random() < 0.5 ? 'none' : pick(NECKWEAR).id,
      arms: Math.random() < 0.5 ? pick(ARMS.filter((a) => a.id !== 'none')).id : look.arms,
      legs: Math.random() < 0.5 ? pick(LEGS).id : look.legs,
      antenna: Math.random() < 0.4 ? pick(ANTENNAS).id : look.antenna,
      accent: pick(ACCENTS),
    };
  };
  return section(
    '🎨',
    'Wardrobe',
    `Dress ${buddy()} up. The icon in your tray and the chat box match the look too.`,
    card(
      { title: '✨ Outfits', wide: true },
      'One click, whole new look. Or roll the dice.',
      tiles(
        OUTFITS.map((o) => ({ value: o.id, label: o.label, draw: thumb({ ...o.look, color: o.look.color ?? look.color }, 'full') })),
        null,
        (id) => {
          const o = OUTFITS.find((x) => x.id === id);
          setLook({ hat: 'none', glasses: 'none', neck: 'none', ...o.look }, { emote: 'celebrate', line: `${o.label}! How do I look?` });
        },
      ),
      h('div', { class: 'btn-row', style: { margin: '12px 0 6px' } }, button('🎲 Surprise me', async () => {
        await setLook(surprise(), { emote: 'flip', line: pick(['Ta-da!', 'Fashion!', 'Is this me? I love it!', 'Strike a pose!']) });
        render();
      }, { kind: 'primary' }), button('Reset look', async () => {
        await setLook({ body: 'classic', color: 'clay', hat: 'none', glasses: 'none', neck: 'none', accent: '#E8455A', arms: 'nubby', legs: 'stubby', antenna: 'sparkle' }, { emote: 'wave', line: 'The classic me!' });
        render();
      })),
    ),
    card(
      { title: '🧸 Body shape', wide: true },
      'Some shapes float instead of walking (and they all keep their hats on).',
      tiles(
        BODIES.map((b) => ({ value: b.id, label: `${b.emoji} ${b.label}`, draw: thumb({ body: b.id, hat: 'none' }, 'full') })),
        look.body,
        async (v) => {
          await setLook({ body: v }, { emote: 'flip', line: BODY_QUIPS[v] });
          render();
        },
      ),
    ),
    card('💪 Arms', null, tiles(ARMS.map((x) => ({ value: x.id, label: x.label, hint: x.hint, draw: thumb({ arms: x.id, hat: 'none' }, 'full') })), look.arms, (v) => setLook({ arms: v }, { emote: 'wave', line: ARM_QUIPS[v] }))),
    card('🦵 Legs', null, tiles(LEGS.map((x) => ({ value: x.id, label: x.label, hint: x.hint, draw: thumb({ legs: x.id, hat: 'none' }, 'full') })), look.legs, (v) => setLook({ legs: v }, { emote: 'jump', line: LEG_QUIPS[v] }))),
    card(
      '🎨 Color',
      null,
      swatches(colorItems, look.color, async (v) => {
        await setLook({ color: v }, { emote: 'jump', line: v === 'custom' ? 'Mix me a color!' : `${COLOR_PRESETS.find((c) => c.id === v).label}!` });
        render();
      }),
      look.color === 'custom'
        ? h(
            'div',
            {},
            row('Hue', null, slider({ min: 0, max: 360, step: 1, value: look.hue, format: (v) => `${v}°`, onInput: (v) => stage.setLook({ ...look, hue: v }), onChange: (v) => setLook({ hue: v }, { emote: 'jump' }) })),
            row('Shade', null, slider({ min: 38, max: 82, step: 1, value: look.shade, format: (v) => (v < 50 ? 'deep' : v > 70 ? 'pastel' : 'bright'), onInput: (v) => stage.setLook({ ...look, shade: v }), onChange: (v) => setLook({ shade: v }, { emote: 'jump' }) })),
          )
        : null,
      h('div', { class: 'row stack' }, h('div', { class: 'label' }, h('strong', {}, 'Accessory color'), h('small', {}, 'Used by bows, scarves, beanies and friends.')), swatches(ACCENTS.map((c) => ({ value: c, label: c, color: c })), look.accent, async (v) => {
        await setLook({ accent: v }, { emote: 'spin' });
        render();
      })),
    ),
    card('🎩 Hats', null, tiles(HATS.map((x) => ({ value: x.id, label: x.label, draw: thumb({ hat: x.id }) })), look.hat, (v) => setLook({ hat: v }, { line: QUIPS[v] }))),
    card('👓 Glasses', null, tiles(GLASSES.map((x) => ({ value: x.id, label: x.label, draw: thumb({ glasses: x.id }) })), look.glasses, (v) => setLook({ glasses: v }, { line: QUIPS[v] }))),
    card('🎀 Neckwear', null, tiles(NECKWEAR.map((x) => ({ value: x.id, label: x.label, draw: thumb({ neck: x.id }, 'full') })), look.neck, (v) => setLook({ neck: v }, { line: QUIPS[v] }))),
    card('📡 Antenna', 'It glows when it’s thinking or listening.', tiles(ANTENNAS.map((x) => ({ value: x.id, label: x.label, draw: thumb({ antenna: x.id }) })), look.antenna, (v) => setLook({ antenna: v }, { emote: 'think', line: ANTENNA_QUIPS[v] }))),
  );
}

// ---- Moves ------------------------------------------------------------------------------------

function renderMoves() {
  const look = normalizeLook(state.settings.look);
  const motion = normalizeMotion(state.settings.motion);
  const setMotion = async (patch, { line, demo = false, emote = null } = {}) => {
    await set('motion', normalizeMotion({ ...normalizeMotion(state.settings.motion), ...patch }));
    if (demo) stage.demo();
    if (emote) stage.emote(emote);
    if (line) stage.say(line, 2200);
  };
  // A combo is a whole character: accessories come off unless it names them.
  const comboLook = (c) => normalizeLook({ ...look, hat: 'none', glasses: 'none', neck: 'none', legs: 'stubby', arms: 'nubby', antenna: 'sparkle', ...c.look });
  const walking = (m, l = look) => (canvas) => liveThumb(canvas, l, normalizeMotion({ ...motion, ...m }), { walking: true });
  const standing = (m) => (canvas) => liveThumb(canvas, look, normalizeMotion({ ...motion, ...m }), { walking: false });
  return section(
    '🕺',
    'Moves',
    `How ${buddy()} gets around, what it does while standing still, and a little something it can leave behind.`,
    card(
      { title: '🎭 Try a whole character', wide: true },
      'Body, colors, arms, legs and moves in one click.',
      tiles(
        COMBOS.map((c) => ({ value: c.id, label: c.label, draw: walking(c.motion, comboLook(c)) })),
        null,
        async (id) => {
          const c = COMBOS.find((x) => x.id === id);
          await set('look', comboLook(c));
          await setMotion(c.motion, { line: `${c.label}! ✨`, demo: true });
          render();
        },
      ),
    ),
    card(
      { title: '🚶 Walk style', wide: true },
      '“Natural” lets its body decide: ghosts and clouds float, slimes hop.',
      tiles(
        GAITS.map((g) => ({ value: g.id, label: `${g.emoji} ${g.label}`, hint: g.hint, draw: walking({ gait: g.id }) })),
        motion.gait,
        (v) => setMotion({ gait: v }, { line: GAIT_QUIPS[v], demo: true }),
      ),
      h('div', { class: 'btn-row', style: { margin: '12px 0 4px' } }, button('▶ Show me', () => stage.demo(), { small: true })),
    ),
    card(
      '🧍 Standing around',
      null,
      tiles(
        IDLES.map((i) => ({ value: i.id, label: i.label, draw: standing({ idle: i.id }) })),
        motion.idle,
        (v) => setMotion({ idle: v }, { line: IDLE_QUIPS[v] }),
      ),
    ),
    card(
      '✨ Trail',
      'Leaves a little something behind as it moves.',
      tiles(
        TRAILS.map((t) => ({ value: t.id, label: `${t.emoji} ${t.label}`, draw: walking({ trail: t.id }) })),
        motion.trail,
        (v) => setMotion({ trail: v }, { line: TRAIL_QUIPS[v], demo: v !== 'none' }),
      ),
    ),
    card(
      '🍮 Jiggle',
      'How squishy it is when it lands, bumps into things or gets poked.',
      row(
        'Jiggle',
        null,
        slider({
          min: 0,
          max: 100,
          step: 5,
          value: Math.round(motion.jiggle * 100),
          format: (v) => (v < 25 ? 'firm' : v < 60 ? 'springy' : v < 85 ? 'squishy' : 'jelly!'),
          onInput: (v) => stage.setMotion({ ...motion, jiggle: v / 100 }),
          onChange: (v) => setMotion({ jiggle: v / 100 }, { emote: 'jump' }),
        }),
      ),
    ),
  );
}

// ---- Voice ------------------------------------------------------------------------------------

let systemVoices = [];
function loadVoices() {
  systemVoices = window.speechSynthesis?.getVoices?.() ?? [];
}
window.speechSynthesis?.addEventListener?.('voiceschanged', () => {
  loadVoices();
  if (state.section === 'voice') render();
});

function renderVoice() {
  const sp = state.settings.speech ?? {};
  const v = state.settings.voice ?? {};
  const m = state.meta;
  const piper = m.piper ?? { installed: false, voices: [] };
  const whisper = m.whisper ?? { installed: false };
  const engineRow = row(
    'Voice engine',
    'Windows voices work right away. Natural voices sound more human (a free one-time download).',
    segmented(
      [
        { value: 'system', label: 'Windows voice' },
        { value: 'piper', label: 'Natural voice' },
      ],
      sp.engine ?? 'system',
      async (val) => {
        await set('speech.engine', val);
        render();
      },
    ),
  );
  const voiceChoice =
    (sp.engine ?? 'system') === 'system'
      ? row('Voice', null, select([{ value: '', label: 'Default' }, ...systemVoices.filter((x) => /^en/i.test(x.lang)).map((x) => ({ value: x.name, label: x.name.replace(/^Microsoft /, '').replace(/ - .*$/, '') }))], sp.voice ?? '', (val) => set('speech.voice', val)))
      : row(
          'Natural voice',
          piper.installed ? null : 'Download the voice engine first (about 80 MB, one time).',
          h(
            'div',
            { class: 'btn-row' },
            select((piper.voices ?? []).map((x) => ({ value: x.id, label: `${x.label}${x.installed ? '' : ' (download)'}` })), sp.piperVoice, async (val) => {
              await set('speech.piperVoice', val);
              render();
            }),
            !(piper.voices ?? []).find((x) => x.id === sp.piperVoice)?.installed
              ? button('Download', async (b) => {
                  b.textContent = 'Downloading…';
                  const r = await act('install-piper', { voice: sp.piperVoice });
                  if (r?.ok) {
                    toast('Natural voice ready!');
                    state.meta = await api.meta();
                    render();
                  }
                }, { kind: 'primary', small: true })
              : null,
            h('div', { class: 'bar', style: { width: '90px' } }, h('span', { id: 'dl-piper' })),
          ),
        );
  return section(
    '🔊',
    'Voice',
    `How ${buddy()} talks back, and how it hears you. Speech never leaves your PC.`,
    card(
      '🗣️ Talking back',
      null,
      row('Speak replies', 'Read replies out loud.', segmented([{ value: 'off', label: 'Off' }, { value: 'voice', label: 'When I talk to it' }, { value: 'always', label: 'Always' }], sp.mode ?? 'off', (val) => set('speech.mode', val))),
      engineRow,
      voiceChoice,
      row('Pitch', 'Higher = squeakier.', slider({ min: 0.5, max: 2, step: 0.05, value: sp.pitch ?? 1.35, format: (x) => `${x.toFixed(2)}×`, onChange: (x) => set('speech.pitch', x) })),
      row('Speed', null, slider({ min: 0.6, max: 1.8, step: 0.05, value: sp.rate ?? 1.05, format: (x) => `${x.toFixed(2)}×`, onChange: (x) => set('speech.rate', x) })),
      row('Volume', null, slider({ min: 0.1, max: 1, step: 0.05, value: sp.volume ?? 0.9, format: (x) => `${Math.round(x * 100)}%`, onChange: (x) => set('speech.volume', x) })),
      h('div', { class: 'btn-row', style: { margin: '10px 0 6px' } }, button('▶ Test voice', async () => {
        const line = `Hi! I’m ${buddy()}. ${pick(['How do I sound?', 'Is this thing on?', 'Testing, testing, one, two!', 'I sound great, right?'])}`;
        stage.say(line, 3500);
        const r = await act('test-voice', { text: line });
        if (r?.ms) stage.talk(r.ms);
      }, { kind: 'primary' })),
    ),
    card(
      '👂 Hands-free',
      `Say its name to start talking, no hotkey needed (“${nameOf() || 'Pixel'}, what time is it?”). The microphone stays on while this is enabled, and the speech is processed on this PC only.`,
      row('Listen for my name', whisper.installed ? null : 'Needs speech recognition (below).', toggle(!!v.wake, async (val) => {
        await set('voice.wake', val);
        render();
      }), { disabled: !whisper.installed }),
      row('Sensitivity', 'Eager hears quieter voices, but might react to the TV.', segmented([{ value: 'relaxed', label: 'Relaxed' }, { value: 'normal', label: 'Normal' }, { value: 'eager', label: 'Eager' }], v.wakeSensitivity ?? 'normal', (val) => set('voice.wakeSensitivity', val)), { disabled: !v.wake }),
      row('Also during fullscreen', 'Keep listening during fullscreen videos and games (off saves a little CPU while gaming).', toggle(!!v.wakeInFullscreen, (val) => set('voice.wakeInFullscreen', val)), { disabled: !v.wake }),
      v.wake ? row('Microphone', null, h('div', { class: 'meter' }, h('span', { id: 'wakeMeter' }))) : null,
      v.wake ? h('div', { class: 'row stack' }, h('div', { class: 'label' }, h('strong', {}, 'Last heard'), h('small', {}, 'What the speech engine understood (only kept in this window).')), h('div', { class: 'heard', id: 'wakeHeard' }, state.meta.wake?.heard || '…')) : null,
    ),
    card(
      '🎙️ Speech recognition',
      'Turns your voice into text with Whisper, right here on your PC.',
      row('Status', null, whisper.installed ? pill('good', `Ready · ${whisper.model ?? 'base.en'}`) : pill('warn', 'Not downloaded')),
      !whisper.installed
        ? h('div', { class: 'btn-row', style: { margin: '6px 0' } }, button('Download speech recognition (≈150 MB)', async (b) => {
            b.textContent = 'Downloading…';
            const r = await act('install-whisper');
            if (r?.ok) {
              toast('Speech recognition ready!');
              state.meta = await api.meta();
              render();
            }
          }, { kind: 'primary' }), h('div', { class: 'bar', style: { flex: 1, alignSelf: 'center' } }, h('span', { id: 'dl-whisper' })))
        : null,
      row('Push-to-talk', 'Press it, speak, and it listens until you pause.', h('span', { class: 'keycap' }, prettyKey(state.meta.hotkeys?.voice ?? state.settings.hotkeys?.voice))),
    ),
  );
}

// ---- Senses -----------------------------------------------------------------------------------

const listenLine = (st) => (st ? `👂 Hearing ${st.label} right now.` : '');

function renderSenses() {
  const s = state.settings;
  const n = s.notify ?? {};
  const l = s.listen ?? {};
  return section(
    '🎧',
    'Senses',
    `What ${buddy()} notices: music, videos, and apps trying to get your attention.`,
    card(
      '🎵 Music & sounds',
      null,
      row('Dance to music', 'Listens to what your PC plays and dances on the beat.', toggle(s.audioReactions !== false, (v) => set('audioReactions', v))),
      row('Watch videos with me', 'Grabs popcorn and reacts to what it hears.', toggle(s.watchAlong !== false, (v) => set('watchAlong', v))),
      row(
        'Listen to',
        'Only hearing the video keeps voice calls out of its reactions.',
        segmented(
          [
            { value: 'all', label: 'Everything' },
            { value: 'no-calls', label: 'All but calls' },
            { value: 'video-app', label: 'Just the video' },
          ],
          l.source ?? 'all',
          (v) => set('listen.source', v),
        ),
      ),
      h('div', { class: 'hint', id: 'listenNow' }, listenLine(state.meta.listen)),
      row('Voice-chat apps', 'Left out when listening to “all but calls”.', textInput({ value: l.callApps ?? '', width: '220px', onChange: (v) => set('listen.callApps', v) })),
    ),
    card(
      '🔔 Notifications',
      'Notices when an app flashes in the taskbar or its unread count goes up (like “(3) Discord”). It never reads your messages.',
      row('React to notifications', null, toggle(n.enabled !== false, async (v) => {
        await set('notify.enabled', v);
        render();
      })),
      row(
        'How',
        null,
        segmented(
          [
            { value: 'peek', label: 'Peek 👀' },
            { value: 'walk', label: 'Walk over' },
            { value: 'say', label: 'Just say it' },
          ],
          n.style ?? 'peek',
          (v) => set('notify.style', v),
        ),
        { disabled: n.enabled === false },
      ),
      row('Ignore these apps', 'Comma-separated, e.g. “outlook, teams”.', textInput({ value: n.ignore ?? '', width: '220px', placeholder: 'none', onChange: (v) => set('notify.ignore', v) }), { disabled: n.enabled === false }),
      row('Also during focus sessions', null, toggle(!!n.duringFocus, (v) => set('notify.duringFocus', v)), { disabled: n.enabled === false }),
      h('div', { class: 'btn-row', style: { margin: '10px 0 6px' } }, button('Try it', () => act('test-notify'), { small: true })),
    ),
  );
}

// ---- Focus ------------------------------------------------------------------------------------

function fmtClock(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const PHASES = { focus: '🍅 Focusing', short: '☕ Short break', long: '🌴 Long break', idle: 'Ready when you are' };

/** The pomodoro ring (SVG needs its own namespace, so no h() here). */
function buildRing(f) {
  const C = 2 * Math.PI * 50;
  const frac = f?.total ? Math.max(0, Math.min(1, f.remaining / f.total)) : 1;
  const phase = PHASES[f?.phase ?? 'idle'];
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'ring');
  svg.setAttribute('viewBox', '0 0 120 120');
  for (const [cls, off] of [
    ['track', 0],
    ['fill', C * (1 - frac)],
  ]) {
    const c = document.createElementNS(svgNS, 'circle');
    c.setAttribute('cx', '60');
    c.setAttribute('cy', '60');
    c.setAttribute('r', '50');
    c.setAttribute('class', cls);
    if (cls === 'fill') {
      c.setAttribute('stroke-dasharray', String(C));
      c.setAttribute('stroke-dashoffset', String(off));
      c.id = 'focusRing';
    }
    svg.append(c);
  }
  return h('div', { class: 'clock' }, svg, h('div', {}, h('div', { class: 'time', id: 'focusTime' }, f?.phase && f.phase !== 'idle' ? fmtClock(f.remaining) : `${state.settings.focus?.work ?? 25}:00`), h('div', { class: 'phase', id: 'focusPhase' }, f?.paused ? `${phase} (paused)` : phase)));
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const stat = (n, one, many) => h('div', { class: 'stat' }, h('b', {}, n), h('span', {}, n === 1 ? one : many));

function renderFocus() {
  const fo = state.settings.focus ?? {};
  const f = state.meta.focus ?? { phase: 'idle' };
  const running = f.phase && f.phase !== 'idle';
  const stats = state.meta.focusStats ?? { today: 0, minutes: 0, streak: 0 };
  const minutes = (key, min, max, step = 1) => slider({ min, max, step, value: fo[key], format: (v) => `${v} min`, onChange: (v) => set(`focus.${key}`, v) });
  const every = (key, max) => slider({ min: 0, max, step: 5, value: fo[key] ?? 0, format: (v) => (v ? `every ${v} min` : 'off'), onChange: (v) => set(`focus.${key}`, v) });
  return section(
    '🍅',
    'Focus buddy',
    `${buddy()} keeps you company while you work: quiet during focus, stretches with you on breaks, and cheers when you finish.`,
    card(
      'Pomodoro',
      null,
      buildRing(f),
      h(
        'div',
        { class: 'btn-row', style: { marginBottom: '8px' } },
        !running ? button('▶ Start focusing', async () => {
          await act('focus-start');
          stage.say('Let’s do this! 🍅');
        }, { kind: 'primary' }) : null,
        running ? button(f.paused ? '▶ Resume' : '⏸ Pause', () => act(f.paused ? 'focus-resume' : 'focus-pause')) : null,
        running ? button('⏭ Skip', () => act('focus-skip')) : null,
        running ? button('⏹ Stop', () => act('focus-stop'), { kind: 'danger' }) : null,
      ),
      h(
        'div',
        { class: 'stats' },
        stat(stats.today, 'session today', 'sessions today'),
        stat(Math.round(stats.minutes), 'focus minute today', 'focus minutes today'),
        stat(stats.total ?? 0, 'session ever', 'sessions ever'),
      ),
      row('Focus length', null, minutes('work', 5, 90, 5)),
      row('Short break', null, minutes('short', 1, 30)),
      row('Long break', null, minutes('long', 5, 60, 5)),
      row('Long break every', null, slider({ min: 2, max: 8, step: 1, value: fo.longEvery ?? 4, format: (v) => `${v} sessions`, onChange: (v) => set('focus.longEvery', v) })),
      row('Keep going automatically', 'Start the next session or break without asking.', toggle(!!fo.autoContinue, (v) => set('focus.autoContinue', v))),
    ),
    card(
      '🧘 Take care of yourself',
      'Reminders count only the time you’re actually at the PC, and never interrupt fullscreen games or videos.',
      row('Stretch breaks', 'It stretches with you.', every('stretchEvery', 120)),
      row('Water reminders', null, every('waterEvery', 180)),
      row('Eye rest (20-20-20)', 'Every 20 minutes, look 20 feet away for 20 seconds.', toggle(!!fo.eyeBreaks, (v) => set('focus.eyeBreaks', v))),
    ),
    card(
      '🎯 Staying on track',
      null,
      row('Distraction nudges', 'A gentle reminder if you wander off during a focus session.', toggle(fo.nudge !== false, (v) => set('focus.nudge', v))),
      row('Distracting sites and apps', 'Matched against window titles.', textInput({ value: fo.distractions ?? '', width: '240px', onChange: (v) => set('focus.distractions', v) }), { disabled: fo.nudge === false }),
      row('Celebrate finished downloads', 'Cheers (with an Open button) when a download lands in Downloads.', toggle(fo.downloads !== false, (v) => set('focus.downloads', v))),
      row('Quiet hours', 'No chatter or reminders at night.', toggle(!!fo.quietHours, async (v) => {
        await set('focus.quietHours', v);
        render();
      })),
      fo.quietHours ? row('From / to', null, h('div', { class: 'btn-row' }, textInput({ type: 'time', value: fo.quietFrom ?? '23:00', onChange: (v) => set('focus.quietFrom', v) }), textInput({ type: 'time', value: fo.quietTo ?? '08:00', onChange: (v) => set('focus.quietTo', v) }))) : null,
    ),
  );
}

// ---- Play -------------------------------------------------------------------------------------

function renderPlay() {
  const g = state.settings.games ?? {};
  return section(
    '🎾',
    'Play',
    `Mini-games on your real desktop. ${buddy()} takes them very seriously.`,
    card(
      '🎾 Fetch',
      'A ball appears. Grab it with the mouse and throw it anywhere; it runs, jumps and climbs to catch it, then brings it back.',
      row('Best streak', null, h('b', {}, plural(g.fetchBest ?? 0, 'catch', 'catches'))),
      h('div', { class: 'btn-row', style: { margin: '8px 0 6px' } }, button('Play fetch', async () => {
        await act('play', { game: 'fetch' });
        stage.say('Ooh! Throw it! Throw it!');
      }, { kind: 'primary' })),
    ),
    card(
      '🙈 Hide and seek',
      'It hides behind one of your windows or off the edge of the screen, peeking out a tiny bit. Click it to win. Hints get warmer as your cursor gets closer.',
      row('Time limit', null, slider({ min: 20, max: 180, step: 10, value: g.hideSeconds ?? 60, format: (v) => `${v} s`, onChange: (v) => set('games.hideSeconds', v) })),
      row('Fastest find', null, h('b', {}, g.hideBest ? `${g.hideBest.toFixed(1)} s` : '—')),
      h('div', { class: 'btn-row', style: { margin: '8px 0 6px' } }, button('Play hide and seek', async () => {
        await act('play', { game: 'hide' });
        stage.say('Close your eyes and count to three! 🙈');
      }, { kind: 'primary' })),
    ),
    card(
      '🥊 Boxing pop-ups',
      'Pretend pop-up windows (never your real apps) drop onto your desktop, and it punches them around until they break. Click them to throw a punch yourself! Needs the cartoon gloves, so it puts them on.',
      row('Fastest five knockouts', null, h('b', {}, g.boxBest ? `${g.boxBest.toFixed(1)} s` : '—')),
      h('div', { class: 'btn-row', style: { margin: '8px 0 6px' } }, button('Play boxing', async () => {
        await act('play', { game: 'boxing' });
        stage.setLook({ ...normalizeLook(state.settings.look), arms: 'gloves' });
        stage.say('Ding ding! 🥊');
      }, { kind: 'primary' })),
    ),
  );
}

// ---- Brain ------------------------------------------------------------------------------------

function renderBrain() {
  const s = state.settings;
  const ai = state.meta.ai ?? {};
  const facts = state.meta.facts ?? [];
  const models = ai.models ?? [];
  const status = ai.ok ? pill('good', `Ready · ${s.llm?.model}`) : ai.running ? pill('warn', 'Ollama is running, but the model isn’t downloaded') : s.llm?.enabled === false ? pill('', 'Turned off') : pill('bad', 'Ollama isn’t running');
  return section(
    '🧠',
    'Brain',
    `${buddy()} thinks with a local AI model in Ollama. No internet needed, and nothing you say leaves this PC.`,
    card(
      '🤖 Local AI',
      null,
      row('Status', null, h('div', { class: 'btn-row' }, status, button('Check', async () => {
        await act('check-ai');
        state.meta = await api.meta();
        render();
      }, { small: true }))),
      // Setting up the brain: get Ollama (free), then download the model from right here.
      !ai.running && s.llm?.enabled !== false
        ? row(
            'Get Ollama',
            'The free app that runs the AI on your PC. Install it, then press Check.',
            button('Open ollama.com', () => act('get-ollama'), { small: true }),
          )
        : null,
      ai.running && !ai.ok
        ? row(
            'Download the AI model',
            `${s.llm?.model ?? 'The model'} is a one-time download of about 2.5 GB.`,
            h(
              'div',
              { class: 'btn-row' },
              button('Download', async (b) => {
                b.textContent = 'Downloading…';
                const r = await act('pull-model');
                if (r?.ok) {
                  toast('The AI brain is ready! 🧠');
                  state.meta = await api.meta();
                  render();
                }
              }, { kind: 'primary', small: true }),
              h('div', { class: 'bar', style: { width: '120px', alignSelf: 'center' } }, h('span', { id: 'dl-model' })),
            ),
          )
        : null,
      row('Use the AI brain', 'Without it, built-in commands still work.', toggle(s.llm?.enabled !== false, (v) => set('llm.enabled', v))),
      row('Model', 'Any model you have in Ollama.', select((models.length ? models : [s.llm?.model]).map((x) => ({ value: x, label: x })), s.llm?.model, (v) => set('llm.model', v))),
      row('Keep it loaded', 'Longer = faster replies, but uses GPU memory while idle.', segmented([{ value: '5m', label: '5 min' }, { value: '15m', label: '15 min' }, { value: '1h', label: '1 hour' }], s.llm?.keepAlive ?? '15m', (v) => set('llm.keepAlive', v))),
      row('Let the AI decide what I do', 'Every few minutes it picks an activity that fits its personality.', toggle(s.aiDirector !== false, (v) => set('aiDirector', v))),
    ),
    card(
      '💭 Memories',
      `Things you asked ${buddy()} to remember.`,
      facts.length
        ? h(
            'ul',
            { class: 'memories' },
            facts.map((f, i) =>
              h('li', {}, h('span', {}, f.text), button('Forget', async () => {
                await act('forget-fact', { index: i });
                state.meta = await api.meta();
                render();
              }, { small: true })),
            ),
          )
        : h('div', { class: 'empty' }, 'Nothing yet. Tell it “remember that…”.'),
      h('div', { class: 'btn-row', style: { margin: '8px 0 6px' } }, button('Open my notes', () => act('open', { what: 'notes' }), { small: true }), facts.length ? button('Forget everything', async () => {
        if (!confirm(`Make ${buddy()} forget everything you told it?`)) return;
        await act('forget-all');
        state.meta = await api.meta();
        render();
      }, { small: true, kind: 'danger' }) : null),
    ),
  );
}

// ---- App ---------------------------------------------------------------------------------------

function prettyKey(accel) {
  return accel ? accel.replace(/Control/g, 'Ctrl').replace(/\+/g, ' + ') : 'none';
}

function hotkeyField(name) {
  const current = state.meta.hotkeys?.[name] ?? state.settings.hotkeys?.[name];
  const el = h('button', { type: 'button', class: 'keycap' }, prettyKey(current));
  el.addEventListener('click', () => {
    el.classList.add('recording');
    el.textContent = 'Press keys…';
    const onKey = async (e) => {
      e.preventDefault();
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      window.removeEventListener('keydown', onKey, true);
      el.classList.remove('recording');
      if (e.key === 'Escape') {
        el.textContent = prettyKey(current);
        return;
      }
      const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
      const key = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.key.length === 1 ? e.key.toUpperCase() : e.code;
      if (!mods.length) {
        toast('Use at least one of Ctrl, Alt or Shift');
        el.textContent = prettyKey(current);
        return;
      }
      const r = await act('set-hotkey', { name, accel: [...mods, key].join('+') });
      state.meta = await api.meta();
      el.textContent = prettyKey(r?.accel ?? current);
      if (r?.accel) flashSaved();
    };
    window.addEventListener('keydown', onKey, true);
  });
  return el;
}

function renderApp() {
  const m = state.meta;
  return section(
    '⚙️',
    'App',
    'Shortcuts, startup and where things are kept.',
    card(
      '⌨️ Hotkeys',
      'Click a shortcut, then press the new keys (Esc cancels).',
      row('Open the chat', null, hotkeyField('chat')),
      row('Talk with your voice', null, hotkeyField('voice')),
      row('Hide / show', null, hotkeyField('toggle')),
    ),
    card(
      '🚀 Startup',
      null,
      row('Start with Windows', `${buddy()} shows up when you sign in.`, toggle(!!state.settings.startWithWindows, (v) => act('start-with-windows', { on: v }))),
      row('Version', m.packaged ? 'Installed app' : 'Running from the project folder', h('b', {}, m.version ?? '')),
    ),
    card(
      '📁 Files',
      'Everything is stored on this PC.',
      h('div', { class: 'btn-row', style: { margin: '6px 0 10px' } }, button('Settings file', () => act('open', { what: 'settings' }), { small: true }), button('Log file', () => act('open', { what: 'log' }), { small: true }), button('Data folder', () => act('open', { what: 'data' }), { small: true }), button('Notes', () => act('open', { what: 'notes' }), { small: true })),
      row('Reset everything', 'Back to defaults. Your notes and memories are kept.', button('Reset settings', async () => {
        if (!confirm('Reset all settings (name, look, voice, everything) to the defaults?')) return;
        await act('reset-settings');
        await load();
      }, { small: true, kind: 'danger' })),
    ),
  );
}

// ---- live status from the app -------------------------------------------------------------

api.on('status', (s) => {
  if (s.kind === 'focus') {
    state.meta.focus = s.focus;
    if (s.stats) state.meta.focusStats = s.stats;
    stage.setFocus(s.focus);
    if (state.section !== 'focus') return;
    // A new phase (or start/stop/pause) rebuilds the card; ticks just update the clock.
    if (s.changed) return render();
    const t = $('focusTime');
    const ring = $('focusRing');
    if (t && s.focus.phase !== 'idle') t.textContent = fmtClock(s.focus.remaining);
    if (ring && s.focus.total) ring.setAttribute('stroke-dashoffset', String(2 * Math.PI * 50 * (1 - s.focus.remaining / s.focus.total)));
  } else if (s.kind === 'download') {
    const bar = $(`dl-${s.id}`);
    if (bar) bar.style.width = `${Math.round(s.pct * 100)}%`;
  } else if (s.kind === 'wake') {
    const meter = $('wakeMeter');
    if (meter && s.level != null) meter.style.width = `${Math.round(Math.min(1, s.level) * 100)}%`;
    if (s.heard != null) {
      state.meta.wake = { heard: s.heard };
      const el = $('wakeHeard');
      if (el) el.textContent = s.heard || '…';
    }
  } else if (s.kind === 'listen') {
    state.meta.listen = s.listen;
    const el = $('listenNow');
    if (el) el.textContent = listenLine(s.listen);
  } else if (s.kind === 'speaking') {
    if (s.on) stage.talk(s.ms ?? 1500);
  } else if (s.kind === 'meta') {
    state.meta = { ...state.meta, ...s.meta };
    render();
  }
});

api.on('changed', (settings) => {
  const before = JSON.stringify(state.settings);
  state.settings = settings;
  if (JSON.stringify(settings) === before) return;
  syncStage();
  // Don't yank the page from under a slider/text field being edited.
  const active = document.activeElement;
  if (active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) return;
  render();
});

api.on('section', (id) => go(id));

async function load() {
  const { settings, meta } = await api.get();
  state.settings = settings;
  state.meta = meta;
  syncStage();
  stage.setFocus(meta.focus);
  renderNav();
  render({ keepScroll: false });
}

stage = new Stage($('stage'));
loadVoices();
load();
