import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { parse } from '../src/main/commands/parser.js';
import { resolveStyle } from '../src/main/commands/restyle.js';
import { Actions } from '../src/main/commands/actions.js';
import { runTool, TOOLS } from '../src/main/brain/tools.js';

test('style words resolve, synonyms included', () => {
  assert.equal(resolveStyle('body', 'a ghost'), 'ghost');
  assert.equal(resolveStyle('body', 'blob'), 'slime');
  assert.equal(resolveStyle('body', 'Toast'), 'box');
  assert.equal(resolveStyle('body', 'a pair of pajamas'), null);
  assert.equal(resolveStyle('gait', 'a penguin'), 'waddle');
  assert.equal(resolveStyle('gait', 'a bowling ball'), 'roll');
  assert.equal(resolveStyle('gait', 'a ninja'), 'tiptoe');
  assert.equal(resolveStyle('trail', 'glitter'), 'sparkles');
  assert.equal(resolveStyle('arms', 'wings'), 'wings');
  assert.equal(resolveStyle('legs', 'hover'), 'none');
});

test('chat and voice phrases for shapes, walks and trails', () => {
  const p = (t) => parse(t, { names: ['Pixel'] });
  assert.equal(p('turn into a ghost').body, 'a ghost');
  assert.equal(p('Pixel, become a slime!').body, 'slime');
  assert.equal(p('walk like a penguin').gait, 'a penguin');
  assert.equal(p('hop around').gait, 'hop');
  assert.equal(p('leave a trail of hearts').trail, 'hearts');
  assert.equal(p('rainbow trail').trail, 'rainbow');
  assert.equal(p('no trail').trail, 'none');
  assert.equal(p('give yourself wings').arms, 'wings');
  assert.equal(p('put on some sneakers').legs, 'sneakers');
  // Words it doesn't know go to the AI instead of a canned "I can't".
  assert.equal(p('turn into pajamas'), null);
  assert.equal(p('walk like an egyptian'), null);
  assert.equal(p('a paper trail'), null);
  // ...and existing commands still win.
  assert.equal(p('walk to the other screen').intent, 'emote');
  assert.equal(p('turn the volume up').intent, 'media');
});

function actions(look = {}, motion = {}) {
  const saved = { look: { ...look }, motion: { ...motion } };
  const a = new Actions({
    dataDir: path.join(os.tmpdir(), 'avatar-restyle-test'),
    getLook: () => saved.look,
    setLook: (l) => (saved.look = l),
    getMotion: () => saved.motion,
    setMotion: (m) => (saved.motion = m),
    rand: () => 0,
  });
  return { a, saved };
}

test('restyle changes only what was asked, and says so', () => {
  const { a, saved } = actions({ body: 'classic', hat: 'crown' }, { gait: 'auto', trail: 'none' });
  let r = a.restyle({ body: 'a ghost' });
  assert.equal(r.ok, true);
  assert.match(r.say, /Boo/);
  assert.equal(saved.look.body, 'ghost');
  assert.equal(saved.look.hat, 'crown', 'the hat stays on');
  r = a.restyle({ gait: 'a penguin', trail: 'hearts' });
  assert.deepEqual([saved.motion.gait, saved.motion.trail], ['waddle', 'hearts']);
  assert.equal(r.emote, 'come', 'it walks over to show off');
  r = a.restyle({ body: 'toaster oven' });
  assert.equal(r.ok, false);
  assert.match(r.say, /ghost/);
  assert.equal(saved.look.body, 'ghost', 'nothing changed');
  assert.ok(a.restyle({}).ask, 'asks what to turn into');
});

test('the AI can restyle too (tool with the real option lists)', () => {
  const tool = TOOLS.find((t) => t.function.name === 'change_style');
  assert.ok(tool.function.parameters.properties.body.enum.includes('cloud'));
  assert.ok(tool.function.parameters.properties.walk.enum.includes('robot'));
  const { a, saved } = actions();
  const r = runTool(a, 'change_style', { body: 'star', walk: 'strut', trail: 'sparkles' });
  return Promise.resolve(r).then((res) => {
    assert.equal(res.ok, true);
    assert.deepEqual([saved.look.body, saved.motion.gait, saved.motion.trail], ['star', 'strut', 'sparkles']);
  });
});
