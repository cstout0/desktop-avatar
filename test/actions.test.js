import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SafePaths, sanitizeName } from '../src/main/commands/paths.js';
import { Actions } from '../src/main/commands/actions.js';
import { Timers } from '../src/main/commands/timers.js';
import { parse } from '../src/main/commands/parser.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-actions-'));
let calls;
let actions;
let folders;
let timers;
let charName;

function setup() {
  fs.rmSync(root, { recursive: true, force: true });
  folders = { home: root };
  for (const k of ['desktop', 'documents', 'downloads', 'pictures', 'music', 'videos']) {
    folders[k] = path.join(root, k[0].toUpperCase() + k.slice(1));
    fs.mkdirSync(folders[k], { recursive: true });
  }
  calls = [];
  timers = new Timers();
  const shell = {
    openPath: async (p) => calls.push(['openPath', p]) && '',
    openExternal: async (u) => calls.push(['openExternal', u]),
    trashItem: async (p) => {
      calls.push(['trashItem', p]);
      fs.rmSync(p, { recursive: true, force: true });
    },
    showItemInFolder: (p) => calls.push(['showItemInFolder', p]),
  };
  const apps = {
    load: async () => {},
    find: (q) => (/^spot/i.test(q) ? { name: 'Spotify', id: 'spotify', key: 'spotify' } : null),
    launch: async (a) => calls.push(['launch', a.name]),
  };
  actions = new Actions({
    paths: new SafePaths(folders),
    shell,
    apps,
    emote: (n) => calls.push(['emote', n]),
    media: (k, n) => calls.push(['media', k, n]),
    timers,
    dataDir: path.join(root, 'appdata'),
    screenshot: async () => calls.push(['screenshot']),
    getName: () => charName,
    setName: (n) => {
      charName = n;
    },
    rand: () => 0,
  });
  charName = 'Pixel';
}

beforeEach(setup);
after(() => {
  timers.clear();
  fs.rmSync(root, { recursive: true, force: true });
});

const run = (text) => {
  const p = parse(text, { names: [charName] });
  return actions[p.intent](p);
};

test('the user\u2019s example: "Pixel, create a folder named Test Folder"', () => {
  const r = run('Pixel, create a folder named Test Folder');
  assert.equal(r.ok, true);
  assert.ok(fs.statSync(path.join(folders.desktop, 'Test Folder')).isDirectory());
  assert.match(r.say, /Test Folder/);
  assert.equal(r.item, 'folder');
  const again = run('create a folder named Test Folder');
  assert.match(again.say, /already/);
});

test('folders in other places, and inside an existing folder', () => {
  run('create a folder called Photos in my documents');
  assert.ok(fs.existsSync(path.join(folders.documents, 'Photos')));
  fs.mkdirSync(path.join(folders.desktop, 'Projects'));
  run('create a folder called Stuff in Projects');
  assert.ok(fs.existsSync(path.join(folders.desktop, 'Projects', 'Stuff')), 'ambiguous "in Projects" resolved via the disk');
  run('create a folder called Rock in Roll');
  assert.ok(fs.existsSync(path.join(folders.desktop, 'Rock in Roll')), 'no "Roll" folder, so it\u2019s part of the name');
});

test('names are sanitized and paths cannot escape the user folder', () => {
  assert.equal(sanitizeName('a/b:c*?'), 'abc');
  assert.equal(sanitizeName('CON'), 'CON_');
  const r = actions.create_folder({ name: '..\\..\\..\\Windows\\evil' });
  assert.equal(r.ok, true);
  const made = fs.readdirSync(folders.desktop);
  assert.equal(made.length, 1);
  assert.ok(!made[0].includes('\\') && !made[0].includes('/'));
  const bad = actions.create_folder({ name: 'x', location: 'C:\\Windows\\System32' });
  assert.equal(bad.ok, false);
});

test('files with content never overwrite', () => {
  const r = run('create a text file called notes with the text buy milk');
  const p = path.join(folders.desktop, 'notes.txt');
  assert.equal(fs.readFileSync(p, 'utf8').trim(), 'buy milk');
  const r2 = run('create a text file called notes with the text eggs');
  assert.match(r2.say, /notes \(2\)\.txt/);
  assert.equal(fs.readFileSync(p, 'utf8').trim(), 'buy milk', 'original untouched');
  assert.equal(r.item, 'file');
});

test('missing names trigger a follow-up question', () => {
  const r = run('create a folder');
  assert.equal(r.ask.slot, 'name');
});

test('notes, memory', () => {
  run('take a note: call mom');
  run('note that the wifi password is on the router');
  const notes = fs.readFileSync(path.join(folders.documents, 'Desktop Avatar Notes.txt'), 'utf8');
  assert.match(notes, /call mom/);
  assert.match(notes, /wifi password/);
  assert.match(run('read my notes').say, /call mom/);
  run('remember that my favorite color is green');
  assert.match(run('what do you know about me').say, /green/);
});

test('delete asks first, then uses the Recycle Bin', async () => {
  fs.mkdirSync(path.join(folders.desktop, 'Old Stuff'));
  const r = run('delete the folder called Old Stuff');
  assert.ok(r.confirm, 'asks for confirmation');
  assert.ok(fs.existsSync(path.join(folders.desktop, 'Old Stuff')), 'nothing deleted yet');
  const done = await r.confirm.yes();
  assert.equal(done.ok, true);
  assert.deepEqual(calls.at(-1), ['trashItem', path.join(folders.desktop, 'Old Stuff')]);
  assert.equal(run('delete desktop').ok, false, 'refuses to delete a known folder itself');
});

test('rename keeps the extension and refuses to overwrite', () => {
  fs.writeFileSync(path.join(folders.desktop, 'draft.txt'), 'x');
  fs.writeFileSync(path.join(folders.desktop, 'final.txt'), 'y');
  assert.equal(run('rename draft to final').ok, false);
  const r = run('rename draft to ideas');
  assert.equal(r.ok, true);
  assert.ok(fs.existsSync(path.join(folders.desktop, 'ideas.txt')));
});

test('open: folders, apps, websites, domains, unknown', async () => {
  await run('open my downloads folder');
  assert.deepEqual(calls.at(-1), ['openPath', folders.downloads]);
  await run('open spotify');
  assert.deepEqual(calls.at(-1), ['launch', 'Spotify']);
  await run('open youtube');
  assert.deepEqual(calls.at(-1), ['openExternal', 'https://www.youtube.com/']);
  await run('open example.org');
  assert.deepEqual(calls.at(-1), ['openExternal', 'https://example.org/']);
  const r = await run('open zzqqxx');
  assert.equal(r.ok, false);
  assert.equal(r.buttons[0].label, 'Search the web');
});

test('search builds the right URL', async () => {
  await run('search youtube for lofi beats');
  assert.equal(calls.at(-1)[1], 'https://www.youtube.com/results?search_query=lofi%20beats');
});

test('timers and reminders are scheduled', () => {
  const r = run('set a timer for 5 minutes');
  assert.match(r.say, /5 minutes/);
  run('remind me in 20 minutes to check the oven');
  const list = timers.list();
  assert.equal(list.length, 2);
  assert.equal(list[1].label, 'check the oven');
  assert.match(run('cancel my timers').say, /Cancelled 2/);
});

test('renaming the character (and it then answers to the new name)', () => {
  const r = run('your name is bolt');
  assert.equal(r.ok, true);
  assert.equal(charName, 'Bolt', 'cleaned up and saved');
  assert.match(r.say, /Bolt/);
  assert.match(r.say, /Pixel/, 'says goodbye to the old name');
  assert.equal(r.emote, 'celebrate');
  assert.match(run('Bolt, what are you').say, /I’m Bolt/);
  assert.match(run('call yourself Bolt').say, /already my name/);
  assert.equal(run('change your name to 🎉').ask?.slot, 'name', 'asks again when nothing usable is left');
});

test('a rename suggested by the AI waits for a yes', async () => {
  const r = actions.rename_self({ name: 'Nova', confirm: true });
  assert.match(r.confirm.question, /Nova/);
  assert.equal(charName, 'Pixel', 'nothing changed yet');
  const done = await r.confirm.yes();
  assert.equal(done.ok, true);
  assert.equal(charName, 'Nova');
});

test('who() before and after the character has a name', () => {
  charName = '';
  assert.match(actions.who().say, /don’t have a name yet/);
  charName = 'Pixel';
  assert.match(actions.who().say, /^I’m Pixel/);
});

test('media keys, emotes, info', async () => {
  run('next song');
  assert.deepEqual(calls.at(-1), ['media', 'next', 1]);
  run('dance');
  assert.deepEqual(calls.at(-1), ['emote', 'dance']);
  assert.match(run('what time is it').say, /^It\u2019s /);
  const sys = await run('how is my computer doing');
  assert.match(sys.say, /CPU \d+%/);
});
