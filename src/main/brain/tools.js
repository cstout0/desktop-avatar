// Tools the local model may call. Each maps onto a sandboxed Actions method, so
// the AI gets exactly the same safety rules as the built-in command engine.

import { ANTENNAS, ARMS, BODIES, LEGS } from '../../renderer/overlay/bodies.js';
import { GAITS, TRAILS } from '../../renderer/overlay/motion.js';

const str = (description) => ({ type: 'string', ...(description ? { description } : {}) });
const oneOf = (list, description) => ({ type: 'string', enum: list.map((x) => x.id), description });
const num = (description) => ({ type: 'number', ...(description ? { description } : {}) });
const LOCATION = str('Where: desktop (default), documents, downloads, pictures, music, videos, or the name of an existing folder');

function tool(name, description, properties = {}, required = []) {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } };
}

export const TOOLS = [
  tool('create_folder', 'Create a new folder (on the Desktop unless a location is given).', { name: str('Folder name'), location: LOCATION }, ['name']),
  tool('create_file', 'Create a new file with optional text content (a .txt file unless the name has another extension).', { name: str('File name, e.g. "ideas.txt"'), content: str('Text to write into the file'), location: LOCATION }, ['name']),
  tool('open', 'Open an installed app (e.g. Spotify, Notepad), a website (e.g. youtube, github.com) or a folder/file by name (e.g. downloads, "Test Folder").', { target: str('App, website/URL, or folder/file name') }, ['target']),
  tool('web_search', 'Search the web in the user’s browser.', { query: str('What to search for'), site: { type: 'string', enum: ['google', 'youtube', 'wikipedia', 'reddit', 'amazon'] } }, ['query']),
  tool('set_timer', 'Start a countdown timer.', { minutes: num('Minutes (can be fractional)'), label: str('Optional label') }, ['minutes']),
  tool('set_reminder', 'Remind the user about something later.', { text: str('What to remind them about'), minutes: num('In how many minutes'), at: str('Or a clock time like "5pm" or "17:30"') }, ['text']),
  tool('take_note', 'Append a note to the user’s notes file.', { text: str('The note') }, ['text']),
  tool('read_notes', 'Read the user’s most recent notes.'),
  tool('remember_fact', 'Remember a fact the user tells you about themselves, for future conversations.', { fact: str('The fact, e.g. "their name is Cam"') }, ['fact']),
  tool('media_control', 'Control music/video playback or the volume.', { action: { type: 'string', enum: ['pause', 'play', 'next', 'prev', 'volup', 'voldown', 'mute'] } }, ['action']),
  tool('list_folder', 'List what is inside a folder.', { location: LOCATION }),
  tool('system_status', 'Get the PC’s CPU, RAM and GPU usage.'),
  tool('move_to_recycle_bin', 'Delete a file or folder by moving it to the Recycle Bin. The user will be asked to confirm first.', { name: str('File or folder name'), location: LOCATION }, ['name']),
  tool('rename_item', 'Rename a file or folder.', { from: str('Current name'), to: str('New name') }, ['from', 'to']),
  tool('take_screenshot', 'Take a screenshot of the screen.'),
  tool('rename_yourself', 'Change YOUR OWN name (the desktop character) when the user gives you a new one. Not for the user’s name (use remember_fact for that). The user confirms first.', { name: str('Your new name') }, ['name']),
  tool('focus_timer', 'Pomodoro focus sessions: start one (you sit and work alongside the user), stop, pause, resume, or start a short break.', { action: { type: 'string', enum: ['start', 'stop', 'pause', 'resume', 'break'] }, minutes: num('Focus length in minutes (start only; default 25)') }, ['action']),
  tool(
    'change_style',
    'Change YOUR OWN body shape, arms, legs, antenna, walk style or trail when the user asks (e.g. "turn into a ghost", "walk like a penguin", "leave a trail of hearts"). Only include what they asked for.',
    {
      body: oneOf(BODIES, 'Body shape'),
      arms: oneOf(ARMS, 'Arm style'),
      legs: oneOf(LEGS, 'Leg style ("none" = it floats)'),
      antenna: oneOf(ANTENNAS, 'Antenna tip'),
      walk: oneOf(GAITS, 'How it walks: "float" if they want it to float or drift, "auto" = what suits its body'),
      trail: oneOf(TRAILS, 'What it leaves behind when it moves'),
    },
  ),
  tool('play_game', 'Play a mini-game with the user on the desktop: fetch (they throw a ball, you chase it), hide (hide and seek: you hide behind a window) or boxing (you punch pretend pop-up windows around; puts your cartoon gloves on). "stop" ends the game.', { game: { type: 'string', enum: ['fetch', 'hide', 'boxing', 'stop'] } }, ['game']),
  tool(
    'animate',
    'Make yourself (the desktop character) move or emote. swing = swing on your grappling rope; climb = climb up the side of a window onto its top; wallclimb = climb the edge of the screen; explore = hop up onto a window; fly = fly around (only if you have wings on); other_screen = walk to the other monitor; come = walk to the mouse cursor; follow = follow the cursor for a while.',
    { action: { type: 'string', enum: ['dance', 'wave', 'flip', 'jump', 'sit', 'sleep', 'celebrate', 'spin', 'come', 'follow', 'laugh', 'stretch', 'swing', 'climb', 'wallclimb', 'explore', 'fly', 'other_screen'] } },
    ['action'],
  ),
];

// Tools whose results are information the model should talk about.
export const INFO_TOOLS = new Set(['read_notes', 'list_folder', 'system_status']);

const asNum = (v) => (v == null || v === '' ? null : Number(v));

/** Run a tool call through the Actions sandbox. Returns an action result. */
export async function runTool(actions, name, args = {}) {
  switch (name) {
    case 'create_folder':
      return actions.create_folder({ name: args.name, location: args.location || null });
    case 'create_file': {
      return actions.create_file({ name: args.name, content: args.content || null, location: args.location || null, ext: '.txt' });
    }
    case 'open':
      return actions.open({ target: args.target });
    case 'web_search':
      return actions.search({ query: args.query, site: args.site || 'google' });
    case 'set_timer': {
      const secs = Math.round((asNum(args.minutes) ?? 0) * 60 + (asNum(args.seconds) ?? 0));
      return actions.timer({ seconds: secs > 0 ? secs : null, label: args.label || null });
    }
    case 'set_reminder': {
      const m = asNum(args.minutes);
      return actions.reminder({ text: args.text, seconds: m ? Math.round(m * 60) : null, at: args.at || null });
    }
    case 'take_note':
      return actions.take_note({ text: args.text });
    case 'read_notes':
      return actions.read_notes();
    case 'remember_fact':
      return actions.remember({ fact: args.fact });
    case 'media_control':
      return actions.media({ action: args.action });
    case 'list_folder':
      return actions.list({ location: args.location || 'desktop' });
    case 'system_status':
      return actions.system();
    case 'move_to_recycle_bin':
      return actions.delete({ name: args.name, location: args.location || null });
    case 'rename_item':
      return actions.rename({ from: args.from, to: args.to });
    case 'take_screenshot':
      return actions.screenshot();
    case 'rename_yourself':
      return actions.rename_self({ name: args.name, confirm: true });
    case 'change_style':
      return actions.restyle({ body: args.body, arms: args.arms, legs: args.legs, antenna: args.antenna, gait: args.walk, trail: args.trail });
    case 'play_game': {
      const r = args.game === 'stop' ? actions.stop_game() : actions.play({ game: args.game });
      return { ...r, say: r.say ?? (args.game === 'stop' ? 'Game over.' : 'Game on!') };
    }
    case 'focus_timer': {
      const fn = { start: 'focus_start', stop: 'focus_stop', pause: 'focus_pause', resume: 'focus_resume', break: 'focus_break' }[args.action];
      if (!fn) return { ok: false, say: 'I don’t know that focus action.' };
      const r = actions[fn]({ minutes: asNum(args.minutes) || null });
      return { ...r, say: r.say ?? (args.action === 'start' ? 'Focus session started.' : 'Done.') };
    }
    case 'animate':
      return actions.emote({ name: args.action === 'other_screen' ? 'other-screen' : args.action });
    default:
      return { ok: false, say: `I don’t have a tool called ${name}.` };
  }
}
