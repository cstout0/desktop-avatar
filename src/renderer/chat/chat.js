import { VoiceRecorder } from './recorder.js';

const api = window.chat;
const body = document.body;
const root = document.documentElement;
const form = document.getElementById('pill');
const input = document.getElementById('text');
const mic = document.getElementById('mic');
const dot = document.getElementById('dot');
const statusText = document.getElementById('statusText');

const PLACEHOLDER = 'Ask Claude to do something…';
let history = [];
let hIndex = -1;
let draft = '';
let rec = null;
let cancelled = false;
let autoSend = null;
let baseStatus = null;

api.on('shown', ({ history: h, status }) => {
  history = h || [];
  hIndex = -1;
  draft = '';
  input.value = '';
  setVoice('idle');
  setStatus(status);
  requestAnimationFrame(() => body.classList.add('show'));
  setTimeout(() => input.focus(), 30);
});

api.on('hidden', () => {
  body.classList.remove('show');
  stopListening(true);
  clearTimeout(autoSend);
});
api.on('status', setStatus);
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
    state === 'listening' ? 'Listening… say something like “create a folder named Test”' : state === 'speaking' ? 'Listening…' : state === 'transcribing' ? 'Got it — turning your voice into text…' : PLACEHOLDER;
  mic.title = state === 'listening' || state === 'speaking' ? 'Stop listening' : 'Talk instead (voice)';
  if (state !== 'listening' && state !== 'speaking') root.style.setProperty('--level', '0');
}

function micError(err) {
  if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') return 'Microphone is blocked — Windows Settings › Privacy › Microphone › allow desktop apps.';
  if (err?.name === 'NotFoundError') return 'No microphone found. Is one plugged in?';
  return `Microphone error: ${err?.message ?? err}`;
}

async function toggleListening() {
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
  if (!text) return;
  api.send('submit', text);
  body.classList.remove('show', 'heard');
});

mic.addEventListener('click', () => toggleListening());

input.addEventListener('input', () => {
  clearTimeout(autoSend);
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
