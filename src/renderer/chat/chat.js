import { VoiceRecorder } from './recorder.js';

const api = window.chat;
const body = document.body;
const root = document.documentElement;
const form = document.getElementById('pill');
const input = document.getElementById('text');
const mic = document.getElementById('mic');
const dice = document.getElementById('dice');
const dot = document.getElementById('dot');
const statusText = document.getElementById('statusText');
const keysHint = document.getElementById('keys');

let placeholder = 'Ask me to do something…';
let naming = false;
let ideas = [];
let history = [];
let hIndex = -1;
let draft = '';
let rec = null;
let cancelled = false;
let autoSend = null;
let baseStatus = null;
let fromVoice = false; // the text in the box came from the microphone

// mode 'chat' (talk to the character) or 'name' (pick its name; first run or "Rename…")
api.on('shown', ({ history: h, status, mode = 'chat', name = '', ideas: idea = [] }) => {
  naming = mode === 'name';
  ideas = idea;
  history = naming ? [] : h || [];
  hIndex = -1;
  draft = '';
  input.value = '';
  fromVoice = false;
  input.maxLength = naming ? 24 : 500;
  body.classList.toggle('naming', naming);
  placeholder = naming ? (name ? `A new name for ${name}…` : 'Type a name for me…') : `Ask ${name || 'me'} to do something…`;
  keysHint.textContent = naming ? 'Enter to confirm · Esc for later' : 'Enter send · Esc close · ↑ history';
  setVoice('idle');
  setStatus(naming ? { kind: 'ok', text: name ? 'What should I be called instead? 🎲 for ideas' : 'What should I be called? 🎲 for ideas' } : status);
  requestAnimationFrame(() => body.classList.add('show'));
  setTimeout(() => input.focus(), 30);
});

api.on('name-error', (text) => {
  flashStatus('warn', text, 3500);
  input.focus();
  input.select();
});

dice.addEventListener('click', () => {
  if (!ideas.length) return;
  const next = ideas.shift();
  ideas.push(next);
  input.value = next;
  input.focus();
  input.select();
  dice.classList.remove('rolled');
  void dice.offsetWidth; // restart the roll animation
  dice.classList.add('rolled');
});

api.on('hidden', () => {
  body.classList.remove('show');
  stopListening(true);
  clearTimeout(autoSend);
});
api.on('status', (s) => !naming && setStatus(s));
api.on('listen', () => toggleListening());

function setStatus(s) {
  if (!s) return;
  baseStatus = s;
  dot.className = s.kind || '';
  statusText.textContent = s.text || '';
}

function flashStatus(kind, text, ms = 4000) {
  dot.className = kind;
  statusText.textContent = text;
  setTimeout(() => baseStatus && setStatus(baseStatus), ms);
}

function setVoice(state) {
  body.classList.toggle('listening', state === 'listening' || state === 'speaking');
  body.classList.toggle('speaking', state === 'speaking');
  body.classList.toggle('transcribing', state === 'transcribing');
  input.placeholder =
    state === 'listening' ? 'Listening… say something like “create a folder named Test”' : state === 'speaking' ? 'Listening…' : state === 'transcribing' ? 'Got it — turning your voice into text…' : placeholder;
  mic.title = state === 'listening' || state === 'speaking' ? 'Stop listening' : 'Talk instead (voice)';
  if (state !== 'listening' && state !== 'speaking') root.style.setProperty('--level', '0');
}

function micError(err) {
  if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') return 'Microphone is blocked — Windows Settings › Privacy › Microphone › allow desktop apps.';
  if (err?.name === 'NotFoundError') return 'No microphone found. Is one plugged in?';
  return `Microphone error: ${err?.message ?? err}`;
}

async function toggleListening() {
  if (naming) return;
  if (rec?.active) {
    rec.stop(); // finish now and transcribe what we have
    return;
  }
  clearTimeout(autoSend);
  cancelled = false;
  setVoice('listening');
  api.send('voice-state', 'listening');
  rec = new VoiceRecorder({
    onLevel: (l) => root.style.setProperty('--level', l.toFixed(3)),
    onSpeech: () => {
      setVoice('speaking');
      api.send('voice-state', 'speaking');
    },
  });
  let result;
  try {
    result = await rec.start();
  } catch (err) {
    setVoice('idle');
    api.send('voice-state', 'idle');
    flashStatus('warn', micError(err), 8000);
    return;
  }
  if (cancelled) {
    setVoice('idle');
    api.send('voice-state', 'idle');
    return;
  }
  if (!result?.wav) {
    setVoice('idle');
    api.send('voice-state', 'idle');
    flashStatus('warn', 'I didn’t hear anything. Click the mic and speak.');
    return;
  }
  setVoice('transcribing');
  api.send('voice-state', 'transcribing');
  api.send('audio', result.wav);
}

function stopListening(discard) {
  if (!rec?.active) return;
  cancelled = !!discard;
  rec.stop();
}

api.on('transcript', ({ text, error }) => {
  setVoice('idle');
  if (error || !text) {
    flashStatus('warn', error || 'Sorry, I didn’t catch that. Try again?');
    return;
  }
  input.value = text;
  fromVoice = true;
  input.focus();
  body.classList.add('heard');
  // Send automatically in a moment; typing or Esc cancels.
  autoSend = setTimeout(() => {
    body.classList.remove('heard');
    form.requestSubmit();
  }, 1100);
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  clearTimeout(autoSend);
  const text = input.value.trim();
  if (!text) {
    if (naming) flashStatus('warn', 'Type a name (or roll the 🎲)', 3000);
    return;
  }
  api.send('submit', fromVoice ? { text, voice: true } : text);
  fromVoice = false;
  // A name is checked first; the box closes once it's accepted.
  if (!naming) body.classList.remove('show', 'heard');
});

mic.addEventListener('click', () => toggleListening());

input.addEventListener('input', () => {
  clearTimeout(autoSend);
  fromVoice = false; // edited by hand
  body.classList.remove('heard');
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    clearTimeout(autoSend);
    stopListening(true);
    api.send('cancel');
    body.classList.remove('show', 'heard');
  } else if (e.key === 'ArrowUp' && history.length) {
    e.preventDefault();
    if (hIndex === -1) draft = input.value;
    hIndex = Math.min(history.length - 1, hIndex + 1);
    input.value = history[history.length - 1 - hIndex];
  } else if (e.key === 'ArrowDown' && hIndex >= 0) {
    e.preventDefault();
    hIndex--;
    input.value = hIndex === -1 ? draft : history[history.length - 1 - hIndex];
  }
});

// Its face in the corner matches its current look (hat, colors...).
api.on('face', (url) => {
  const img = document.getElementById('face');
  if (img && url) img.src = url;
});
