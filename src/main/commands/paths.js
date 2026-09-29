// Safe path handling for file actions. The character may only create/open things inside
// the user's own folders, never overwrites, and sanitizes every name.
import fs from 'node:fs';
import path from 'node:path';

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

export const FOLDER_WORDS = {
  desktop: 'desktop',
  documents: 'documents',
  document: 'documents',
  docs: 'documents',
  'my documents': 'documents',
  downloads: 'downloads',
  download: 'downloads',
  pictures: 'pictures',
  photos: 'pictures',
  images: 'pictures',
  music: 'music',
  videos: 'videos',
  movies: 'videos',
  home: 'home',
  'home folder': 'home',
  'user folder': 'home',
};

/** Clean a user-supplied file/folder name. Returns '' if nothing usable is left. */
export function sanitizeName(raw) {
  let s = String(raw ?? '').trim();
  s = s.replace(/^["'\u201c\u201d\u2018\u2019`]+|["'\u201c\u201d\u2018\u2019`]+$/g, '');
  s = s.replace(/[.!?,;:]+$/g, '');
  s = s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/[. ]+$/g, '');
  if (s === '.' || s === '..') return '';
  if (RESERVED.test(s)) s = `${s}_`;
  if (s.length > 120) s = s.slice(0, 120).trim();
  return s;
}

export function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

export class SafePaths {
  /** @param folders { desktop, documents, downloads, pictures, music, videos, home } */
  constructor(folders, defaultFolder = 'desktop') {
    this.folders = folders;
    this.defaultFolder = defaultFolder;
  }

  label(dir) {
    for (const [k, v] of Object.entries(this.folders)) {
      if (path.resolve(v) === path.resolve(dir)) return k === 'home' ? 'your user folder' : `your ${k[0].toUpperCase()}${k.slice(1)}`;
    }
    const base = path.basename(dir);
    const parent = Object.entries(this.folders).find(([k, v]) => k !== 'home' && isInside(dir, v));
    return parent ? `"${base}" (in ${parent[0][0].toUpperCase()}${parent[0].slice(1)})` : `"${base}"`;
  }

  /** "on your Desktop", "in your Documents", "in "Stuff" (in Desktop)". */
  where(dir) {
    const lbl = this.label(dir);
    return lbl === 'your Desktop' ? 'on your Desktop' : `in ${lbl}`;
  }

  allowed(p) {
    return isInside(path.resolve(p), path.resolve(this.folders.home));
  }

  /**
   * Resolve a spoken location ("my desktop", "documents", "the Test Folder
   * folder", "C:\\Users\\me\\Projects") to a directory inside the user's folders.
   */
  resolveDir(loc) {
    if (!loc) return { dir: this.folders[this.defaultFolder] };
    let s = String(loc).trim().replace(/^(?:the|my|your)\s+/i, '').replace(/\s+(?:folder|directory|dir)$/i, '').trim();
    s = s.replace(/^["'\u201c\u201d]+|["'\u201c\u201d]+$/g, '');
    const key = s.toLowerCase();
    if (FOLDER_WORDS[key]) return { dir: this.folders[FOLDER_WORDS[key]] };
    if (path.isAbsolute(s)) {
      const abs = path.resolve(s);
      if (!this.allowed(abs)) return { error: `I can only work inside your user folder, not ${abs}.` };
      if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return { error: `I couldn\u2019t find the folder ${abs}.` };
      return { dir: abs };
    }
    // A folder by name: look in the default folder first, then the other known folders.
    const found = this.findEntry(s, { dirsOnly: true });
    if (found) return { dir: found };
    return { error: `I couldn\u2019t find a folder called "${s}".` };
  }

  /** Find a file or folder by (fuzzy) name in the known folders, default folder first. */
  findEntry(name, { dirsOnly = false } = {}) {
    const want = sanitizeName(name).toLowerCase();
    if (!want) return null;
    const order = [this.defaultFolder, 'desktop', 'documents', 'downloads', 'pictures', 'music', 'videos', 'home'];
    const seen = new Set();
    let loose = null;
    for (const k of order) {
      const dir = this.folders[k];
      if (!dir || seen.has(dir)) continue;
      seen.add(dir);
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (dirsOnly && !e.isDirectory()) continue;
        const n = e.name.toLowerCase();
        const stem = n.replace(/\.[^.]+$/, '');
        if (n === want || stem === want) return path.join(dir, e.name);
        if (!loose && (n.replace(/[\s_-]+/g, '') === want.replace(/[\s_-]+/g, '') || stem.replace(/[\s_-]+/g, '') === want.replace(/[\s_-]+/g, ''))) loose = path.join(dir, e.name);
      }
    }
    return loose;
  }

  /** A non-existing path for `name` in `dir` ("Name (2)" style if taken). */
  uniquePath(dir, name) {
    const ext = path.extname(name);
    const stem = ext ? name.slice(0, -ext.length) : name;
    let p = path.join(dir, name);
    for (let i = 2; fs.existsSync(p); i++) p = path.join(dir, `${stem} (${i})${ext}`);
    return p;
  }
}
