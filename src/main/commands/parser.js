// Rule-based understanding of common requests. Pure (no I/O), fast, and works
// with no AI model at all. Anything it isn't sure about goes to the local LLM.

const WAKE = /^\s*(?:(?:hey|hi|hello|ok|okay|yo|oi|dear)\s+)?cl(?:au|ou|aw)de?\b[\s,:;!.\-]*/i;
const POLITE_PREFIX =
  /^(?:(?:please|pls|plz|kindly)\s+|(?:can|could|would|will|wanna)\s+you\s+(?:please\s+)?|(?:would|could)\s+you\s+mind\s+|i\s+(?:want|need|would\s+like)\s+(?:you\s+)?to\s+|i'?d\s+like\s+(?:you\s+)?to\s+|go\s+ahead\s+and\s+|quickly\s+|just\s+)/i;
const POLITE_SUFFIX = /[\s,]*(?:please|pls|plz|for\s+me|thanks|thank\s+you|thx|real\s+quick|if\s+you\s+can|if\s+you\s+could)[\s.!?]*$/i;

export function normalize(text) {
  let s = String(text ?? '')
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .trim();
  s = s.replace(WAKE, '');
  for (let i = 0; i < 4; i++) {
    const next = s.replace(POLITE_PREFIX, '').replace(POLITE_SUFFIX, '').trim();
    if (next === s || !next.replace(/[?.!\s]+/g, '')) break; // keep "thanks!" when it's all there is
    s = next;
  }
  return s.replace(/[?.!]+$/, '').trim();
}

const unquote = (s) => String(s ?? '').trim().replace(/^["'`]+|["'`]+$/g, '').trim();

// ---- durations & clock times ---------------------------------------------------

const NUMS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90, couple: 2, few: 3, half: 0.5,
};

function num(w) {
  w = w.toLowerCase().replace(/\s+of$/, '').trim();
  if (/^\d+(\.\d+)?$/.test(w)) return parseFloat(w);
  const parts = w.split(/[\s-]+/);
  let n = 0;
  for (const p of parts) {
    if (!(p in NUMS)) return NaN;
    n += NUMS[p];
  }
  return n;
}

const NUM_RE = '\\d+(?:\\.\\d+)?|(?:twenty|thirty|forty|fifty)[\\s-](?:one|two|three|four|five|six|seven|eight|nine)|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|ninety|couple(?:\\s+of)?|few';
const UNIT_RE = 'hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s';

/** "5 minutes", "an hour and a half", "1h 30m", "half an hour" -> seconds (or null). */
export function parseDuration(text) {
  let s = ` ${String(text).toLowerCase().replace(/-/g, ' ')} `.replace(/\s+/g, ' ');
  if (/\bhalf an? hour\b/.test(s)) return 1800 + (parseDuration(s.replace(/half an? hour/, '')) ?? 0);
  if (/\ba quarter (of an )?hour\b/.test(s)) return 900;
  let total = 0;
  let found = false;
  const re = new RegExp(`(${NUM_RE})\\s*(${UNIT_RE})\\b(\\s+and\\s+a\\s+half)?`, 'g');
  for (const m of s.matchAll(re)) {
    let n = num(m[1]);
    if (Number.isNaN(n)) continue;
    if (m[3]) n += 0.5;
    const u = m[2][0];
    total += n * (u === 'h' ? 3600 : u === 'm' ? 60 : 1);
    found = true;
  }
  if (!found) {
    const bare = s.trim().match(/^(\d+(?:\.\d+)?)$/);
    if (bare) return parseFloat(bare[1]) * 60; // "timer 5" = 5 minutes
  }
  return found && total > 0 ? Math.round(total) : null;
}

/** "5pm", "5:30 pm", "17:45", "noon", "midnight" -> the next such Date after `now`. */
export function parseClock(text, now = new Date()) {
  const s = String(text).toLowerCase().trim().replace(/\./g, '');
  let h;
  let m = 0;
  if (s === 'noon') h = 12;
  else if (s === 'midnight') h = 0;
  else {
    const r = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/);
    if (!r) return null;
    h = parseInt(r[1], 10);
    m = r[2] ? parseInt(r[2], 10) : 0;
    const ap = r[3]?.[0];
    if (h > 23 || m > 59) return null;
    if (ap === 'p' && h < 12) h += 12;
    if (ap === 'a' && h === 12) h = 0;
    if (!ap && h < 12 && h <= now.getHours() - 1 && h + 12 > now.getHours()) h += 12; // "at 5" in the afternoon
  }
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  if (d <= now) d.setDate(d.getDate() + 1);
  return d;
}

// ---- names & locations ------------------------------------------------------------

const KNOWN_LOC = '(?:my\\s+|the\\s+|your\\s+)?(?:desktop|documents|downloads|pictures|photos|music|videos|home\\s+folder)';

function splitNameLocation(rest, { content = false } = {}) {
  let r = ` ${String(rest ?? '').trim()} `;
  let text = null;
  if (content) {
    const cm = r.match(/\s(?:with|containing|that\s+says|saying|which\s+says|and\s+(?:write|put|type|add))\s+(?:the\s+)?(?:(?:text|words?|contents?|message|line)\s+)?(?::\s*|that\s+says\s+|saying\s+)?(?<c>.+)$/i);
    if (cm) {
      text = unquote(cm.groups.c);
      r = `${r.slice(0, cm.index)} `;
    }
  }
  let location = null;
  // Leading location: "on my desktop called X"
  const lead = r.match(new RegExp(`^\\s+(?:on|in|inside|into|under|to)\\s+(?<loc>${KNOWN_LOC})\\b`, 'i'));
  if (lead) {
    location = lead.groups.loc;
    r = ` ${r.slice(lead[0].length)} `;
  }
  // Trailing location: "... in my documents", "... in the Test Folder folder", "... in C:\\x"
  if (!location) {
    const trail =
      r.match(new RegExp(`\\s(?:on|in|inside|into|under|to)\\s+(?<loc>${KNOWN_LOC})\\s*$`, 'i')) ||
      r.match(/\s(?:on|in|inside|into|under|to)\s+(?:the\s+|my\s+)?(?<loc>"[^"]+"|'[^']+')(?:\s+(?:folder|directory))?\s*$/i) ||
      r.match(/\s(?:on|in|inside|into|under|to)\s+(?:the\s+|my\s+)?(?<loc>[a-z]:\\.+?)\s*$/i) ||
      r.match(/\s(?:in|inside|into|under)\s+(?:the\s+|my\s+)(?<loc>[^"']+?\s+(?:folder|directory))\s*$/i);
    if (trail) {
      location = unquote(trail.groups.loc);
      r = ` ${r.slice(0, trail.index)} `;
    }
  }
  let name = null;
  const named = r.match(/\s(?:called|named|titled|entitled|with\s+the\s+name|name\s+it|call\s+it|and\s+call\s+it|and\s+name\s+it)\s+(?<n>.+?)\s*$/i);
  if (named) name = unquote(named.groups.n);
  else {
    const bare = r.trim().replace(/^(?:for\s+(?:my\s+|the\s+)?|of\s+)/i, '');
    if (bare) name = unquote(bare);
  }
  // Ambiguous "X in Y" (Y might be a folder): let the executor check the disk.
  let alt = null;
  if (name && !location) {
    const m = name.match(/^(?<n>.+?)\s+(?:in|inside|into)\s+(?<l>[^\s].*)$/i);
    if (m) alt = { name: unquote(m.groups.n), location: unquote(m.groups.l) };
  }
  return { name: name || null, location, content: text, alt };
}

const FILE_KINDS = {
  text: '.txt', txt: '.txt', note: '.txt', notes: '.txt', markdown: '.md', md: '.md', python: '.py', py: '.py',
  javascript: '.js', js: '.js', typescript: '.ts', ts: '.ts', html: '.html', css: '.css', json: '.json', csv: '.csv',
  yaml: '.yaml', yml: '.yaml', xml: '.xml', batch: '.bat', bat: '.bat', powershell: '.ps1', ps1: '.ps1', log: '.log', rtf: '.rtf',
};

// ---- rules -------------------------------------------------------------------------------

const VERB_CREATE = '(?:create|make|add|build|set\\s+up|setup|generate|new|start|write)';

const RULES = [
  // Emotes / behaviours first (short, unambiguous).
  (s) => {
    const t = s.toLowerCase();
    const table = [
      [/^(?:dance|do\s+a\s+(?:little\s+)?dance|(?:show|bust)\s+(?:me\s+)?(?:a\s+|your\s+|some\s+)?(?:dance\s+)?moves?|let'?s\s+dance|boogie)$/, 'dance'],
      [/^(?:do\s+a\s+)?(?:back\s*flip|front\s*flip|flip|somersault)$|^do\s+a\s+(?:back\s*)?flip$/, 'flip'],
      [/^(?:wave|wave\s+(?:at\s+me|hello|hi)|say\s+(?:hi|hello)(?:\s+to\s+me)?)$/, 'wave'],
      [/^(?:jump|hop|jump\s+up(?:\s+and\s+down)?)$/, 'jump'],
      [/^(?:sit|sit\s+down|have\s+a\s+seat|take\s+a\s+seat)$/, 'sit'],
      [/^(?:go\s+to\s+sleep|sleep|take\s+a\s+nap|nap|go\s+to\s+bed|rest)$/, 'sleep'],
      [/^(?:wake\s+up|wakey\s+wakey|rise\s+and\s+shine)$/, 'wake'],
      [/^(?:come\s+(?:here|over\s+here|to\s+me|back)|get\s+over\s+here|over\s+here)$/, 'come'],
      [/^(?:follow\s+me|follow\s+(?:my\s+)?(?:cursor|mouse|pointer))$/, 'follow'],
      [/^(?:stop|stay|freeze|stay\s+there|sit\s+still|chill|calm\s+down)$/, 'stop'],
      [/^(?:spin|do\s+a\s+spin|twirl)$/, 'spin'],
      [/^(?:celebrate|party|yay|woo+|let'?s\s+go+)$/, 'celebrate'],
      [/^(?:laugh|lol|haha+)$/, 'laugh'],
      [/^(?:stretch)$/, 'stretch'],
      [/^(?:swing|(?:do\s+a\s+|go\s+for\s+a\s+)?swing|swing\s+(?:on|with|from)\s+(?:your|a|the)\s+(?:rope|grapple|grappling\s+hook)|use\s+your\s+(?:rope|grapple|grappling\s+hook)|grapple|tarzan)$/, 'swing'],
      [/^(?:climb|climb\s+up|go\s+climb(?:ing)?|climb\s+something|climb\s+(?:up\s+)?(?:the\s+side\s+of\s+)?(?:a\s+|the\s+|that\s+|this\s+|my\s+)?window)$/, 'climb'],
      [/^(?:climb\s+(?:up\s+)?(?:the\s+)?(?:wall|side\s+of\s+the\s+screen|screen(?:\s+edge)?))$/, 'wallclimb'],
      [/^(?:explore|go\s+explore|go\s+exploring|(?:jump|hop|get)\s+(?:up\s+)?on(?:to)?\s+(?:a|the|that|my)\s+window|go\s+(?:up\s+)?on\s+top\s+of\s+(?:a|the)\s+window)$/, 'explore'],
    ];
    for (const [re, name] of table) if (re.test(t)) return { intent: 'emote', name };
    // "climb (up) the spotify window" -> climb that specific app's window
    const cw = s.match(/^(?:go\s+)?climb\s+(?:up\s+)?(?:the\s+side\s+of\s+)?(?:(?:the|my|that|this)\s+)?(?<app>[\w .'-]+?)\s+(?:window|app)$/i);
    if (cw) return { intent: 'emote', name: 'climb', target: cw.groups.app.trim() };
    const other = t.match(/^(?:go|move|run|walk)\s+(?:over\s+)?to\s+(?:the\s+)?(?<which>other|left|right|first|second|main|primary)\s+(?:screen|monitor|display)$/);
    if (other) return { intent: 'emote', name: 'other-screen', which: other.groups.which };
    if (/^(?:hide|go\s+away|disappear|leave\s+me\s+alone|shoo)$/.test(t)) return { intent: 'hide' };
    return null;
  },

  // Timers & reminders
  (s) => {
    let m = s.match(/^(?:set|start|create|make|put\s+on)\s+(?:me\s+)?(?:a\s+|an\s+)?(?<dur>.+?)\s+timer(?:\s+(?:for|called|named|labeled)\s+(?<label>.+))?$/i);
    if (m) {
      const secs = parseDuration(m.groups.dur);
      if (secs) return { intent: 'timer', seconds: secs, label: m.groups.label ? unquote(m.groups.label) : null };
    }
    m = s.match(/^(?:set|start|create|make)\s+(?:me\s+)?(?:a\s+|an\s+)?timer(?:\s+(?:for|of))?\s+(?<dur>.+?)(?:\s+(?:for|called|named|labeled|to)\s+(?<label>[a-z].*))?$/i) || s.match(/^timer\s+(?:for\s+)?(?<dur>.+)$/i);
    if (m) {
      const secs = parseDuration(m.groups.dur);
      if (secs) return { intent: 'timer', seconds: secs, label: m.groups.label ? unquote(m.groups.label) : null };
      return { intent: 'timer', seconds: null, missing: 'duration' };
    }
    if (/^(?:set|start)\s+(?:a\s+)?timer$/i.test(s)) return { intent: 'timer', seconds: null, missing: 'duration' };
    m = s.match(/^remind\s+me\s+in\s+(?<dur>.+?)\s+(?:to|that|about|of)\s+(?<what>.+)$/i) || s.match(/^in\s+(?<dur>.+?),?\s+remind\s+me\s+(?:to|that|about|of)\s+(?<what>.+)$/i);
    if (m) {
      const secs = parseDuration(m.groups.dur);
      if (secs) return { intent: 'reminder', seconds: secs, text: unquote(m.groups.what) };
    }
    m = s.match(/^remind\s+me\s+(?:to|that|about|of)\s+(?<what>.+?)\s+in\s+(?<dur>[^,]+)$/i);
    if (m) {
      const secs = parseDuration(m.groups.dur);
      if (secs) return { intent: 'reminder', seconds: secs, text: unquote(m.groups.what) };
    }
    m = s.match(/^remind\s+me\s+(?:at|by)\s+(?<clock>[\d:]+\s*(?:am|pm|a\.m\.|p\.m\.)?|noon|midnight)\s+(?:to|that|about|of)\s+(?<what>.+)$/i) || s.match(/^remind\s+me\s+(?:to|that|about|of)\s+(?<what>.+?)\s+at\s+(?<clock>[\d:]+\s*(?:am|pm|a\.m\.|p\.m\.)?|noon|midnight)$/i);
    if (m) return { intent: 'reminder', at: m.groups.clock.trim(), text: unquote(m.groups.what) };
    if (/^remind\s+me\b/i.test(s)) return { intent: 'reminder', missing: 'when' };
    if (/^(?:cancel|stop|clear)\s+(?:the\s+|my\s+|all\s+(?:my\s+)?)?(?:timers?|reminders?|alarms?)$/i.test(s)) return { intent: 'cancel_timers' };
    if (/^(?:how\s+(?:much|long)\s+(?:time\s+)?(?:is\s+)?(?:left|remaining)|time\s+left|what\s+timers?)/i.test(s)) return { intent: 'timers_status' };
    return null;
  },

  // Folders
  (s) => {
    const m = s.match(new RegExp(`^${VERB_CREATE}\\s+(?:me\\s+)?(?:a\\s+|an\\s+|another\\s+|one\\s+)?(?:new\\s+)?(?:empty\\s+|blank\\s+)?(?:folder|directory|dir)\\b\\s*(?<rest>.*)$`, 'i'));
    if (!m) return null;
    const { name, location, alt } = splitNameLocation(m.groups.rest);
    return { intent: 'create_folder', name, location, alt, ...(name ? {} : { missing: 'name' }) };
  },

  // Files ("create a note called X" makes a file; "take a note ..." appends to notes)
  (s) => {
    const m = s.match(new RegExp(`^${VERB_CREATE}\\s+(?:me\\s+)?(?:a\\s+|an\\s+|another\\s+)?(?:new\\s+)?(?:empty\\s+|blank\\s+)?(?:(?<kind>${Object.keys(FILE_KINDS).join('|')})\\s+)?(?:file|document|doc|note)\\b\\s*(?<rest>.*)$`, 'i'));
    if (!m) return null;
    const isNoteWord = /\bnote\b/i.test(s.slice(0, s.length - m.groups.rest.length)) && !/\b(?:file|document|doc)\b/i.test(s.slice(0, s.length - m.groups.rest.length));
    if (isNoteWord && !/\b(?:called|named|titled)\b/i.test(m.groups.rest)) return null; // "write a note saying..." -> take_note
    const { name, location, content, alt } = splitNameLocation(m.groups.rest, { content: true });
    const ext = m.groups.kind ? FILE_KINDS[m.groups.kind.toLowerCase()] : '.txt';
    return { intent: 'create_file', name, ext, location, content, alt, ...(name ? {} : { missing: 'name' }) };
  },

  // Notes & memory
  (s) => {
    let m = s.match(/^(?:take|make|write|jot(?:\s+down)?|add|leave)\s+(?:a\s+|me\s+a\s+)?(?:quick\s+)?note(?:\s+(?:that|saying|to\s+say|:)|\s*:)?\s+(?<t>.+)$/i) || s.match(/^(?:note(?:\s+down)?|jot\s+down|write\s+down)\s*(?:that|:)?\s+(?<t>.+)$/i);
    if (m) return { intent: 'take_note', text: unquote(m.groups.t) };
    if (/^(?:read|show|open|what(?:'s|\s+is|\s+are))\s+(?:me\s+)?(?:in\s+)?(?:my\s+|the\s+)?notes?$/i.test(s)) return { intent: 'read_notes' };
    m = s.match(/^(?:remember|don'?t\s+forget)\s+(?:that\s+)?(?<t>.+)$/i) || s.match(/^(?<t>.+?)[,.;]?\s+(?:please\s+)?(?:remember|don'?t\s+forget)\s+(?:that|this|it)$/i);
    if (m) {
      const fact = unquote(m.groups.t);
      const nm = fact.match(/^(?:my\s+name\s+is|my\s+name'?s|call\s+me|i'?m\s+called)\s+(?<n>[a-z][\w' -]{0,30})$/i);
      return nm ? { intent: 'remember', fact: `The user's name is ${nm.groups.n}`, name: nm.groups.n } : { intent: 'remember', fact };
    }
    m = s.match(/^(?:my\s+name\s+is|my\s+name'?s|call\s+me|i'?m\s+called)\s+(?<n>[a-z][\w' -]{0,30})$/i);
    if (m) return { intent: 'remember', fact: `The user's name is ${unquote(m.groups.n)}`, name: unquote(m.groups.n) };
    if (/^what\s+do\s+you\s+(?:remember|know)\s+about\s+me$/i.test(s)) return { intent: 'recall' };
    if (/^forget\s+(?:everything|all\s+(?:that|of\s+it)|what\s+i\s+told\s+you)$/i.test(s)) return { intent: 'forget' };
    return null;
  },

  // Web search
  (s) => {
    let m = s.match(/^(?:search|look\s*up|google|research)\s+(?:(?:on\s+)?(?<site1>google|youtube|the\s+web|the\s+internet|online|wikipedia|reddit|amazon|bing|duckduckgo)\s+)?(?:for\s+)?(?<q>.+?)(?:\s+(?:on|in|using)\s+(?<site2>google|youtube|wikipedia|reddit|amazon|bing|duckduckgo|the\s+web|the\s+internet))?$/i);
    if (m) {
      const site = (m.groups.site2 || m.groups.site1 || 'google').toLowerCase().replace(/^the\s+(?:web|internet)$|^online$/, 'google');
      return { intent: 'search', query: unquote(m.groups.q), site };
    }
    m = s.match(/^(?:youtube|play)\s+(?<q>.+?)(?:\s+on\s+youtube)?$/i);
    if (m && (/^youtube/i.test(s) || /\s+on\s+youtube$/i.test(s))) return { intent: 'search', query: unquote(m.groups.q), site: 'youtube' };
    return null;
  },

  // Media keys
  (s) => {
    const t = s.toLowerCase();
    if (/^(?:pause|stop)(?:\s+(?:the|my|this))?(?:\s+(?:music|song|video|playback|media|spotify|youtube|it))?$/.test(t)) return { intent: 'media', action: 'pause' };
    if (/^(?:play|resume|unpause|continue|keep\s+playing)(?:\s+(?:the|my))?(?:\s+(?:music|song|video|playback|media|spotify|it))?$/.test(t)) return { intent: 'media', action: 'play' };
    if (/^(?:next|skip)(?:\s+(?:the|this))?(?:\s+(?:song|track|video|one))?$|^(?:play\s+the\s+)?next\s+(?:song|track|video)$/.test(t)) return { intent: 'media', action: 'next' };
    if (/^(?:previous|prev|last|go\s+back)(?:\s+(?:song|track|video|one))?$|^play\s+the\s+(?:previous|last)\s+(?:song|track|video)$/.test(t)) return { intent: 'media', action: 'prev' };
    if (/^(?:turn\s+(?:the\s+)?(?:volume|it|music)\s+up|volume\s+up|louder|turn\s+it\s+up|raise\s+(?:the\s+)?volume|increase\s+(?:the\s+)?volume)$/.test(t)) return { intent: 'media', action: 'volup' };
    if (/^(?:turn\s+(?:the\s+)?(?:volume|it|music)\s+down|volume\s+down|quieter|turn\s+it\s+down|lower\s+(?:the\s+)?volume|decrease\s+(?:the\s+)?volume)$/.test(t)) return { intent: 'media', action: 'voldown' };
    if (/^(?:mute|unmute|mute\s+(?:the\s+)?(?:sound|audio|volume|music)|unmute\s+(?:the\s+)?(?:sound|audio|volume))$/.test(t)) return { intent: 'media', action: 'mute' };
    return null;
  },

  // Time, date, system, screenshot, listing
  (s) => {
    const t = s.toLowerCase();
    if (/^(?:what(?:'s|\s+is)?\s+(?:the\s+)?(?:current\s+)?time(?:\s+(?:is\s+it|now|right\s+now))?|what\s+time\s+is\s+it(?:\s+now)?|time)$/.test(t)) return { intent: 'time' };
    if (/^(?:what(?:'s|\s+is)?\s+(?:the\s+|today'?s\s+)?date(?:\s+today)?|what\s+day\s+is\s+(?:it|today)|what(?:'s|\s+is)\s+today|date)$/.test(t)) return { intent: 'date' };
    if (/^(?:how(?:'s|\s+is)\s+my\s+(?:computer|pc|system|machine)(?:\s+doing)?|(?:cpu|ram|memory)\s+usage|how\s+much\s+(?:ram|memory)(?:\s+am\s+i\s+using)?|system\s+(?:status|info)|battery(?:\s+level)?|how\s+much\s+battery)/.test(t)) return { intent: 'system' };
    if (/^(?:take|grab|capture|snap|make)\s+(?:a\s+)?screen\s*shot|^screen\s*shot$/.test(t)) return { intent: 'screenshot' };
    const m =
      t.match(/^what(?:'s|s|\s+is|\s+do\s+i\s+have)\s+(?:on|in)\s+(?:my\s+|the\s+)?(?<loc>desktop|documents|downloads|pictures|photos|music|videos)(?:\s+folder)?$/) ||
      t.match(/^(?:list|show(?:\s+me)?)\s+(?:the\s+|my\s+|all\s+)?(?:files|stuff|things|folders)\s+(?:on|in)\s+(?:my\s+|the\s+)?(?<loc>.+)$/);
    if (m) return { intent: 'list', location: m.groups.loc };
    return null;
  },

  // Delete / rename (always confirmed before doing anything)
  (s) => {
    let m = s.match(/^(?:delete|remove|trash|throw\s+away|get\s+rid\s+of|bin)\s+(?:the\s+)?(?:(?:file|folder)\s+)?(?:called\s+|named\s+)?(?<n>.+?)(?:\s+(?:from|on|in)\s+(?:my\s+|the\s+)?(?<loc>desktop|documents|downloads|pictures|music|videos))?$/i);
    if (m) return { intent: 'delete', name: unquote(m.groups.n), location: m.groups.loc || null };
    m = s.match(/^rename\s+(?:the\s+)?(?:(?:file|folder)\s+)?(?<from>.+?)\s+to\s+(?<to>.+)$/i);
    if (m) return { intent: 'rename', from: unquote(m.groups.from), to: unquote(m.groups.to) };
    if (/^empty\s+(?:the\s+)?recycl(?:e|ing)\s+bin$/i.test(s)) return { intent: 'empty_bin' };
    return null;
  },

  // Open apps / websites / folders (after timers so "start a timer" isn't "open")
  (s) => {
    const m = s.match(/^(?:open|launch|start|run|load|bring\s+up|pull\s+up|fire\s+up|boot\s+up|show\s+me|go\s+to|navigate\s+to|visit|browse\s+to|take\s+me\s+to)\s+(?:up\s+)?(?<target>.+)$/i);
    if (!m) return null;
    let target = m.groups.target.trim();
    target = target.replace(/^(?:the|my|a|an)\s+/i, '').replace(/\s+(?:app|application|program|website|web\s*site|site|page|for\s+me)$/i, '');
    return { intent: 'open', target: unquote(target) };
  },

  // Small talk & fun (used when no AI model is available, or as a fast path)
  (s) => {
    const t = s.toLowerCase();
    if (/^(?:hi|hello|hey|heya|hiya|yo|sup|what'?s\s+up|howdy|good\s+(?:morning|afternoon|evening)|greetings)(?:\s+(?:there|buddy|friend|pal))?$/.test(t) || t === '') return { intent: 'greet' };
    if (/^(?:thanks|thank\s+you|thank\s+u|ty|thx|cheers|appreciate\s+it|nice\s+one|good\s+job|well\s+done|awesome|perfect|great)(?:\s+(?:so\s+much|a\s+lot|buddy|man))?$/.test(t)) return { intent: 'thanks' };
    if (/^(?:help|what\s+can\s+you\s+do|what\s+do\s+you\s+do|commands|what\s+are\s+your\s+commands|how\s+do\s+(?:i|you)\s+(?:use|work)\s+(?:you|this))$/.test(t)) return { intent: 'help' };
    if (/^(?:tell\s+me\s+a\s+joke|(?:say\s+)?something\s+funny|make\s+me\s+laugh|joke|another\s+(?:one|joke))$/.test(t)) return { intent: 'joke' };
    if (/^(?:flip|toss)\s+a\s+coin$|^coin\s+(?:flip|toss)$|^heads\s+or\s+tails$/.test(t)) return { intent: 'coin' };
    const d = t.match(/^roll\s+(?:a\s+|the\s+|me\s+a\s+)?(?:(?<n>\d+)\s+)?(?:dice|die|d(?<sides>\d+))$/);
    if (d) return { intent: 'dice', sides: d.groups.sides ? parseInt(d.groups.sides, 10) : 6 };
    if (/^how\s+are\s+you(?:\s+doing)?(?:\s+today)?$|^how'?s\s+it\s+going$/.test(t)) return { intent: 'how_are_you' };
    if (/^(?:who|what)\s+are\s+you$/.test(t)) return { intent: 'who' };
    return null;
  },
];

const COMPOUND =
  /(?:\s|,\s*)(?:and|then|and\s+then|also|after\s+that|plus)\s+(?:also\s+)?(?:please\s+)?(?:create|make|open|put|add|move|write|search|set|remind|play|pause|resume|skip|mute|unmute|turn|raise|lower|increase|decrease|delete|rename|close|start|launch|tell|show|find|copy|go|save|name|type|paste|list|take|note|check|look|dance|jump|wave|flip|sit|sleep|come|follow|remember|read)\b/i;
const QUESTION = /^(?:what|why|how|who|when|where|which|is|are|do|does|did|can|could|should|would|will|explain|describe|tell\s+me\s+about)\b/i;

/**
 * @returns {object|null} `{ intent, ...slots }`, `{ intent: 'complex' }` for
 * multi-step requests (best left to the AI), or null when nothing matched.
 */
export function parse(text) {
  const s = normalize(text);
  if (!s) return { intent: 'greet', input: s };
  if (COMPOUND.test(s)) return { intent: 'complex', input: s };
  for (const rule of RULES) {
    const r = rule(s);
    if (r) return { ...r, input: s };
  }
  return QUESTION.test(s) ? { intent: 'question', input: s } : null;
}
