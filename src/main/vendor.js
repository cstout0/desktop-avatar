// Where the downloaded engines (whisper.cpp, Piper) live: the project's vendor/
// folder when running from source, the app's data folder when installed.
import { app } from 'electron';
import path from 'node:path';

export function vendorDir(root, name) {
  const base = app.isPackaged ? path.join(app.getPath('userData'), 'vendor') : path.join(root, 'vendor');
  return path.join(base, name);
}
