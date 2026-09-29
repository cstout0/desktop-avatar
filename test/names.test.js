import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanName, nameIdeas, NAME_IDEAS, MAX_NAME } from '../src/main/names.js';
import { Personality } from '../src/main/brain/personality.js';
import { personaPrompt } from '../src/main/brain/assistant.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('cleanName tidies what people type', () => {
  assert.equal(cleanName('  pixel!'), 'Pixel');
  assert.equal(cleanName('how about mr bubbles'), 'Mr Bubbles');
  assert.equal(cleanName('"Sprocket"'), 'Sprocket');
  assert.equal(cleanName('DJ'), 'DJ', 'keeps deliberate casing');
  assert.equal(cleanName('R2-D2'), 'R2-D2');
  assert.equal(cleanName('zoë'), 'Zoë');
  assert.equal(cleanName("o'malley"), "O'malley");
  assert.equal(cleanName('🎉 Party 🎉'), 'Party');
});

test('cleanName rejects things that are not names', () => {
  assert.equal(cleanName(''), '');
  assert.equal(cleanName('   '), '');
  assert.equal(cleanName('🎉🎉'), '');
  assert.equal(cleanName('12345'), '');
  assert.equal(cleanName('...'), '');
  const long = cleanName('Sir Reginald Fluffington the Third of Desktopia');
  assert.ok(long.length <= MAX_NAME && long.length > 0, long);
  assert.ok(!long.endsWith(' '), 'cut at a word boundary');
});

test('name ideas are shuffled and skip the current name', () => {
  const ideas = nameIdeas(12, ['Pixel']);
  assert.equal(ideas.length, 12);
  assert.ok(!ideas.includes('Pixel'));
  assert.equal(new Set(ideas).size, 12, 'no duplicates');
  assert.ok(ideas.every((n) => NAME_IDEAS.includes(n) && cleanName(n) === n), 'every idea is a valid name');
});

test('the AI is told its name (or that it has none yet)', () => {
  assert.match(personaPrompt({ name: 'Pixel' }), /^You are Pixel, a little character/);
  assert.match(personaPrompt({}), /^You are a little character .* The user hasn’t named you yet\./s);
});

test('the custom personality lives in the data folder, made from the template', () => {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-personality-'));
  try {
    const settings = { get: () => 'custom' };
    const p = new Personality({ root, settings, userDir });
    const file = p.file();
    assert.equal(file, path.join(userDir, 'personality.md'));
    assert.ok(fs.existsSync(file), 'copied from the template on first use');
    assert.doesNotMatch(p.text(), /Edit this file|^#/m, 'instructions and titles are not sent to the AI');
    assert.match(p.text(), /goofball/);
    fs.writeFileSync(file, '# Mine\n\nEdit this file in plain English.\nStill instructions.\n\nYou only speak in haiku.\n');
    assert.equal(p.text(), 'You only speak in haiku.', 'edits apply right away');
  } finally {
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});
