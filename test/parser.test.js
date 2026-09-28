import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, parse, parseClock, parseDuration } from '../src/main/commands/parser.js';

const cases = [
  // The user's own example.
  ['Claude, create a folder named Test Folder', { intent: 'create_folder', name: 'Test Folder', location: null }],
  ['claude create a folder named Test Folder.', { intent: 'create_folder', name: 'Test Folder' }],
  ['Hey Claude, could you please make a new folder on my desktop called Projects', { intent: 'create_folder', name: 'Projects', location: 'my desktop' }],
  ['create a folder called Photos in my documents', { intent: 'create_folder', name: 'Photos', location: 'my documents' }],
  ['make a folder called "Q3 Reports" in downloads', { intent: 'create_folder', name: 'Q3 Reports', location: 'downloads' }],
  ['new folder Stuff', { intent: 'create_folder', name: 'Stuff' }],
  ['create a folder', { intent: 'create_folder', name: null, missing: 'name' }],
  ['create a folder called Drafts in the Test Folder folder', { intent: 'create_folder', name: 'Drafts', location: 'Test Folder folder' }],
  ['create a folder called Rock and Roll', { intent: 'create_folder', name: 'Rock and Roll' }],
  ['make a directory named backups', { intent: 'create_folder', name: 'backups' }],
  // Files
  ['create a text file called notes with the text buy milk', { intent: 'create_file', name: 'notes', ext: '.txt', content: 'buy milk' }],
  ['make a file named todo.md on my desktop', { intent: 'create_file', name: 'todo.md', location: 'my desktop' }],
  ['create a python file called hello saying print("hi")', { intent: 'create_file', name: 'hello', ext: '.py', content: 'print("hi")' }],
  ['create a note called groceries', { intent: 'create_file', name: 'groceries', ext: '.txt' }],
  // Notes & memory
  ['take a note: call mom tomorrow', { intent: 'take_note', text: 'call mom tomorrow' }],
  ['write a note saying the wifi password is on the router', { intent: 'take_note', text: 'the wifi password is on the router' }],
  ['note that the meeting moved to 3', { intent: 'take_note', text: 'the meeting moved to 3' }],
  ['read my notes', { intent: 'read_notes' }],
  ['remember that my favorite color is green', { intent: 'remember', fact: 'my favorite color is green' }],
  // Timers & reminders
  ['set a timer for 5 minutes', { intent: 'timer', seconds: 300 }],
  ['set a 10 minute timer', { intent: 'timer', seconds: 600 }],
  ['start a timer for an hour and a half', { intent: 'timer', seconds: 5400 }],
  ['timer 90 seconds', { intent: 'timer', seconds: 90 }],
  ['set a timer for half an hour called laundry', { intent: 'timer', seconds: 1800, label: 'laundry' }],
  ['remind me in 20 minutes to check the oven', { intent: 'reminder', seconds: 1200, text: 'check the oven' }],
  ['remind me to stretch in 1 hour', { intent: 'reminder', seconds: 3600, text: 'stretch' }],
  ['remind me at 5pm to call the dentist', { intent: 'reminder', at: '5pm', text: 'call the dentist' }],
  ['set a timer', { intent: 'timer', missing: 'duration' }],
  // Open
  ['open notepad', { intent: 'open', target: 'notepad' }],
  ['Claude, launch spotify', { intent: 'open', target: 'spotify' }],
  ['open youtube.com', { intent: 'open', target: 'youtube.com' }],
  ['open my downloads folder', { intent: 'open', target: 'downloads folder' }],
  ['open up the calculator app', { intent: 'open', target: 'calculator' }],
  ['go to reddit', { intent: 'open', target: 'reddit' }],
  // Search
  ['search for best pizza near me', { intent: 'search', query: 'best pizza near me', site: 'google' }],
  ['look up how tall is mount everest', { intent: 'search', query: 'how tall is mount everest' }],
  ['search youtube for lofi beats', { intent: 'search', query: 'lofi beats', site: 'youtube' }],
  ['play never gonna give you up on youtube', { intent: 'search', query: 'never gonna give you up', site: 'youtube' }],
  // Media
  ['pause the music', { intent: 'media', action: 'pause' }],
  ['next song', { intent: 'media', action: 'next' }],
  ['turn the volume up', { intent: 'media', action: 'volup' }],
  ['mute', { intent: 'media', action: 'mute' }],
  // Info
  ['what time is it?', { intent: 'time' }],
  ["what's the date today", { intent: 'date' }],
  ["how's my computer doing", { intent: 'system' }],
  ['take a screenshot', { intent: 'screenshot' }],
  ["what's on my desktop", { intent: 'list', location: 'desktop' }],
  // Emotes
  ['dance!', { intent: 'emote', name: 'dance' }],
  ['do a backflip', { intent: 'emote', name: 'flip' }],
  ['come here', { intent: 'emote', name: 'come' }],
  ['go to the other screen', { intent: 'emote', name: 'other-screen', which: 'other' }],
  ['take a nap', { intent: 'emote', name: 'sleep' }],
  ['swing on your rope', { intent: 'emote', name: 'swing' }],
  ['climb the Spotify window', { intent: 'emote', name: 'climb', target: 'Spotify' }],
  ['climb a window', { intent: 'emote', name: 'climb' }],
  ['climb up the wall', { intent: 'emote', name: 'wallclimb' }],
  ['go explore', { intent: 'emote', name: 'explore' }],
  ['jump on a window', { intent: 'emote', name: 'explore' }],
  // Destructive (confirmed later)
  ['delete the folder called Test Folder', { intent: 'delete', name: 'Test Folder' }],
  ['rename notes.txt to ideas.txt', { intent: 'rename', from: 'notes.txt', to: 'ideas.txt' }],
  // Small talk
  ['hi', { intent: 'greet' }],
  ['thanks!', { intent: 'thanks' }],
  ['tell me a joke', { intent: 'joke' }],
  ['roll a d20', { intent: 'dice', sides: 20 }],
  ['flip a coin', { intent: 'coin' }],
  // Found in live testing
  ['open spotify and turn the volume up', { intent: 'complex' }],
  ['whats on my desktop', { intent: 'list', location: 'desktop' }],
  ['my name is Cam, please remember that', { intent: 'remember', name: 'Cam' }],
  ['call me Cam', { intent: 'remember', name: 'Cam' }],
  // Leave these to the AI
  ['create a folder called Trip and put a file called plan.txt in it', { intent: 'complex' }],
  ['why is the sky blue', { intent: 'question' }],
];

for (const [input, expected] of cases) {
  test(`parse: ${input}`, () => {
    const r = parse(input);
    assert.ok(r, 'should match something');
    for (const [k, v] of Object.entries(expected)) assert.deepEqual(r[k], v, `${k}: got ${JSON.stringify(r[k])} (full: ${JSON.stringify(r)})`);
  });
}

test('unmatched chatter returns null (goes to the AI)', () => {
  assert.equal(parse('I had a rough day at work'), null);
});

test('normalize strips wake words and politeness', () => {
  assert.equal(normalize('Hey Claude, can you please open notepad for me?'), 'open notepad');
  assert.equal(normalize('Cloud, dance please'), 'dance');
});

test('durations', () => {
  assert.equal(parseDuration('5 minutes'), 300);
  assert.equal(parseDuration('1h 30m'), 5400);
  assert.equal(parseDuration('two hours'), 7200);
  assert.equal(parseDuration('a minute and 30 seconds'), 90);
  assert.equal(parseDuration('twenty five minutes'), 1500);
  assert.equal(parseDuration('half an hour'), 1800);
  assert.equal(parseDuration('banana'), null);
});

test('clock times resolve to the next occurrence', () => {
  const now = new Date(2026, 8, 27, 14, 0);
  assert.equal(parseClock('5pm', now).getHours(), 17);
  assert.equal(parseClock('5:30 pm', now).getMinutes(), 30);
  const morning = parseClock('9am', now);
  assert.equal(morning.getDate(), 28, '9am already passed today -> tomorrow');
  assert.equal(parseClock('noon', now).getHours(), 12);
});
