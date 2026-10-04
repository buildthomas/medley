// Where Medley keeps things that aren't code, so the repo (and a deployed copy of it) stays
// code-only and a host can mount persistent storage:
//
//   MEDLEY_DATA_DIR    refreshed catalogs, caches, refresh state, headless-import output
//   MEDLEY_CONFIG_DIR  personal config: my-games.json
//
// Defaults are the OS's per-user app folders:
//   Windows  %LOCALAPPDATA%\Medley\data            %APPDATA%\Medley
//   macOS    ~/Library/Application Support/Medley/{data,config}
//   Linux    $XDG_DATA_HOME/medley (~/.local/share)  $XDG_CONFIG_HOME/medley (~/.config)
//
// Older checkouts kept these in ./data and ./config inside the repo; they're moved on first use.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repo / app root (where package.json lives). */
export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function defaults() {
  const home = homedir();
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
    const roaming = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
    return { data: join(local, 'Medley', 'data'), config: join(roaming, 'Medley') };
  }
  if (process.platform === 'darwin') {
    const base = join(home, 'Library', 'Application Support', 'Medley');
    return { data: join(base, 'data'), config: join(base, 'config') };
  }
  return {
    data: join(process.env.XDG_DATA_HOME || join(home, '.local', 'share'), 'medley'),
    config: join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'medley'),
  };
}

let resolved = null;

/**
 * @param {{ log?: (m: string) => void }} [opts]
 * @returns {{ dataDir: string, configDir: string }}
 */
export function medleyPaths({ log } = {}) {
  if (resolved) return resolved;
  const d = defaults();
  const dataDir = resolve(process.env.MEDLEY_DATA_DIR || d.data);
  const configDir = resolve(process.env.MEDLEY_CONFIG_DIR || d.config);
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  // One-time move from the old in-repo folders (only into empty destinations).
  migrate(join(ROOT, 'data'), dataDir, (name) => name === 'cache' || name.endsWith('.json'), log);
  migrate(join(ROOT, 'config'), configDir, (name) => !name.endsWith('.example.json'), log);
  resolved = { dataDir, configDir };
  return resolved;
}

function migrate(from, to, keep, log) {
  if (!existsSync(from) || resolve(from) === resolve(to)) return;
  const names = readdirSync(from).filter(keep);
  if (!names.length) return;
  for (const name of names) {
    const dest = join(to, name);
    if (existsSync(dest)) continue; // never overwrite what's already there
    cpSync(join(from, name), dest, { recursive: true });
    rmSync(join(from, name), { recursive: true, force: true });
    log?.(`moved ${join(from, name)} → ${dest}`);
  }
}
