// Claude's personality: a plain-English text file the AI brains follow.
// Presets live in /personalities; "custom" is /personality.md (user-editable).
import fs from 'node:fs';
import path from 'node:path';

export class Personality {
  constructor({ root, settings }) {
    this.root = root;
    this.settings = settings;
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

  file(name = this.name) {
    return name === 'custom' ? path.join(this.root, 'personality.md') : path.join(this.root, 'personalities', `${name}.md`);
  }

  /** The personality text (re-read every time, so edits apply immediately). */
  text() {
    try {
      const raw = fs.readFileSync(this.file(), 'utf8');
      // Drop the markdown title and the editing instructions in the custom file.
      return raw
        .split(/\r?\n/)
        .filter((l) => !/^#/.test(l.trim()))
        .join('\n')
        .replace(/^Edit this file[\s\S]*?no restart needed\. Presets live in the "personalities" folder\.\s*/m, '')
        .trim()
        .slice(0, 2000);
    } catch {
      return '';
    }
  }
}
