// The character's personality: a plain-English text file the AI brains follow.
// Presets live in /personalities. "custom" is the user's own copy of
// /personality.md, kept in the app's data folder so edits survive updates.
import fs from 'node:fs';
import path from 'node:path';

export class Personality {
  constructor({ root, settings, userDir = null }) {
    this.root = root;
    this.settings = settings;
    this.userDir = userDir;
  }

  presets() {
    try {
      return fs
        .readdirSync(path.join(this.root, 'personalities'))
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.replace(/\.md$/, ''));
    } catch {
      return [];
    }
  }

  get name() {
    return this.settings.get('personality') || 'cheerful';
  }

  /** Presets for the settings window: [{ id, label, blurb }] (label from the title, blurb = first sentence). */
  describe() {
    return this.presets().map((id) => {
      const raw = fs.readFileSync(this.file(id), 'utf8');
      const title = raw.match(/^#\s*(.+)$/m)?.[1]?.replace(/\s*\(.*\)\s*$/, '') ?? id;
      const body = raw.replace(/^#.*$/gm, '').trim();
      const first = body.match(/^(.+?[.!?])(\s|$)/s)?.[1]?.replace(/\s+/g, ' ') ?? body.slice(0, 80);
      return { id, label: title, blurb: first.replace(/^You are /, '').replace(/^./, (c) => c.toUpperCase()) };
    });
  }

  /** The user's custom personality text (the whole file, for editing). */
  customText() {
    try {
      return fs.readFileSync(this.customFile(), 'utf8');
    } catch {
      return '';
    }
  }

  saveCustom(text) {
    fs.writeFileSync(this.customFile(), String(text ?? '').slice(0, 8000), 'utf8');
  }

  /** The user's editable file, created from the template the first time it's needed. */
  customFile() {
    const template = path.join(this.root, 'personality.md');
    if (!this.userDir) return template;
    const file = path.join(this.userDir, 'personality.md');
    if (!fs.existsSync(file)) {
      fs.mkdirSync(this.userDir, { recursive: true });
      fs.copyFileSync(template, file);
    }
    return file;
  }

  file(name = this.name) {
    return name === 'custom' ? this.customFile() : path.join(this.root, 'personalities', `${name}.md`);
  }

  /** The personality text (re-read every time, so edits apply immediately). */
  text() {
    try {
      const raw = fs.readFileSync(this.file(), 'utf8');
      // Drop markdown titles and the "Edit this file..." instructions paragraph.
      return raw
        .split(/\r?\n/)
        .filter((l) => !/^#/.test(l.trim()))
        .join('\n')
        .replace(/^\s*Edit this file[\s\S]*?(?:\n\s*\n|$)/, '')
        .trim()
        .slice(0, 2000);
    } catch {
      return '';
    }
  }
}
