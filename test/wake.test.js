import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Vad } from '../src/renderer/services/vad.js';
import { matchName, WakeWord } from '../src/main/wake.js';

const RATE = 16000;

/** Room noise, then "speech" (a wobbly mix of tones), then noise again. */
function clip(parts) {
  const out = [];
  let seed = 7;
  const noise = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31 - 0.5) * 0.002;
  for (const [kind, secs, amp = 0.1] of parts) {
    const n = Math.round(secs * RATE);
    for (let i = 0; i < n; i++) {
      const t = i / RATE;
      const env = 0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t); // syllables
      out.push(noise() + (kind === 'talk' ? amp * env * (Math.sin(2 * Math.PI * 180 * t) + 0.5 * Math.sin(2 * Math.PI * 720 * t)) / 1.5 : 0));
    }
  }
  return Float32Array.from(out);
}

function phrases(vad, data, opts) {
  const out = [];
  for (let i = 0; i < data.length; i += 2048) out.push(...vad.push(data.subarray(i, i + 2048), opts));
  return out;
}

test('vad: cuts out a spoken phrase (with a little lead-in)', () => {
  const got = phrases(new Vad(RATE), clip([['quiet', 1.5], ['talk', 1.2], ['quiet', 1.5]]));
  assert.equal(got.length, 1);
  assert.ok(got[0].secs > 1.3 && got[0].secs < 1.9, `${got[0].secs}`);
});

test('vad: ignores clicks, long conversations, and its own voice', () => {
  assert.equal(phrases(new Vad(RATE), clip([['quiet', 1], ['talk', 0.12], ['quiet', 1]])).length, 0, 'a click');
  assert.equal(phrases(new Vad(RATE), clip([['quiet', 1], ['talk', 8], ['quiet', 1]])).length, 0, 'someone talking on and on');
  assert.equal(phrases(new Vad(RATE), clip([['quiet', 1], ['talk', 1.2], ['quiet', 1]]), { mute: true }).length, 0, 'muted');
  // ...and a short phrase right after a long one is still heard.
  assert.equal(phrases(new Vad(RATE), clip([['quiet', 1], ['talk', 8], ['quiet', 1], ['talk', 1], ['quiet', 1]])).length, 1);
});

test('vad: sensitivity decides how quiet a voice it hears', () => {
  const soft = clip([['quiet', 1.5], ['talk', 1.2, 0.009], ['quiet', 1.5]]);
  assert.equal(phrases(new Vad(RATE, { sensitivity: 'relaxed' }), soft).length, 0);
  assert.equal(phrases(new Vad(RATE, { sensitivity: 'eager' }), soft).length, 1);
});

test('matchName: its name first (after a greeting) or last after a comma', () => {
  const m = (t, n = 'Pixel') => matchName(t, n);
  assert.deepEqual(m('Pixel, open Spotify.'), { hit: true, rest: 'open Spotify' });
  assert.deepEqual(m('Hey Pixel open spotify'), { hit: true, rest: 'open spotify' });
  assert.deepEqual(m('Hey, Pixel.'), { hit: true, rest: '' });
  assert.deepEqual(m('Okay pixel!'), { hit: true, rest: '' });
  assert.deepEqual(m('What time is it, Pixel?'), { hit: true, rest: 'What time is it' });
  assert.equal(m('Pixels, dance!').hit, true);
  assert.equal(m('Pixil, dance!').hit, true, 'one letter off');
  assert.equal(m('Pix el, open notepad').rest, 'open notepad', 'split in two');
  assert.equal(m('Pickle, dance').hit, false);
  assert.equal(m('I love pixel art').hit, false);
  assert.equal(m('The pixel is broken').hit, false);
  assert.equal(m('turn it up to max', 'Max').hit, false, 'a name at the end needs a comma');
  assert.deepEqual(m('Captain Bob, jump', 'Captain Bob'), { hit: true, rest: 'jump' });
  assert.equal(m('Bo, dance', 'Bo').hit, true);
  assert.equal(m('Go dance', 'Bo').hit, false, 'short names must match exactly');
  assert.equal(m('', 'Pixel').hit, false);
});

function setup(heard) {
  const values = { 'voice.enabled': true, 'voice.wake': true, 'voice.wakeSensitivity': 'normal', name: 'Pixel' };
  const settings = Object.assign(new EventEmitter(), { get: (k) => values[k], set: (k, v) => ((values[k] = v), settings.emit('change', k, v)) });
  const sent = [];
  const handled = [];
  let called = 0;
  let paused = false;
  const queue = [...heard];
  const whisper = { installed: () => true, transcribe: async () => queue.shift() ?? '' };
  const w = new WakeWord({
    settings,
    ears: { send: (ch, d) => sent.push([ch, d]) },
    whisper,
    getName: () => values.name,
    handle: async (t) => handled.push(t),
    onCalled: () => called++,
    paused: () => paused,
  });
  return { w, settings, sent, handled, called: () => called, pause: (p) => (paused = p) };
}

test('wake: a phrase with its name runs the rest as a command', async () => {
  const { w, handled } = setup(['Pixel, open Notepad.', 'Thank you.', 'I love pixel art']);
  await w.onMessage({ wav: new Uint8Array(10) });
  await w.onMessage({ wav: new Uint8Array(10) });
  await w.onMessage({ wav: new Uint8Array(10) });
  assert.deepEqual(handled, ['open Notepad']);
});

test('wake: just its name gets a "Yes?", then the next phrase is the command', async () => {
  const { w, handled, called } = setup(['Hey Pixel.', 'What time is it?']);
  await w.onMessage({ wav: new Uint8Array(10) });
  assert.equal(called(), 1);
  assert.deepEqual(handled, []);
  await w.onMessage({ wav: new Uint8Array(10) });
  assert.deepEqual(handled, ['What time is it?']);
});

test('wake: turns the microphone on and off with the setting, pauses for push-to-talk', () => {
  const { w, settings, sent, pause } = setup([]);
  w.start();
  assert.deepEqual(sent.shift(), ['wake-start', { sensitivity: 'normal' }]);
  settings.set('voice.wakeSensitivity', 'eager');
  assert.deepEqual(sent.shift(), ['wake-start', { sensitivity: 'eager' }]);
  pause(true);
  w.apply();
  assert.deepEqual(sent.shift(), ['wake-pause', true]);
  settings.set('voice.wake', false);
  assert.deepEqual(sent.shift(), ['wake-stop', undefined]);
  w.stop();
});

test('wake: drops phrases while paused or still busy with the last one', async () => {
  const { w, handled, pause } = setup(['Pixel, dance', 'Pixel, jump']);
  pause(true);
  w.apply();
  await w.onMessage({ wav: new Uint8Array(10) });
  assert.deepEqual(handled, []);
  pause(false);
  w.apply();
  const a = w.onMessage({ wav: new Uint8Array(10) });
  const b = w.onMessage({ wav: new Uint8Array(10) }); // arrives while the first is being transcribed
  await Promise.all([a, b]);
  assert.deepEqual(handled, ['dance']);
});
