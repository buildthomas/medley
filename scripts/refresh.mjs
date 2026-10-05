// The catalog refresh job: rebuild every catalog into the data dir. One implementation, three
// ways to run it:
//   - in the web process (npm run dev, or npm run serve with MEDLEY_ROLE=all)
//   - the background worker (npm run worker: checks hourly, runs when catalogs are a week old)
//   - a one-shot for cron / scheduled jobs:  node scripts/refresh.mjs [--force]
//
// Coordination between processes goes through files in the data dir, so web and worker only need
// to share that directory:
//   refresh-status.json   state, timestamps, last log lines (what GET /api/refresh shows)
//   refresh.lock          held while a refresh runs (heartbeat every 30 s; stale after 2 min)
//   refresh.request       "please refresh now" from the web process (admin), picked up by the worker

import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAll, keepMissingGroups } from './build-all.mjs';
import { enrichGames } from './enrich.mjs';
import { readJson, writeFileAtomic } from './fsutil.mjs';
import { loadEnvFiles, medleyPaths, ROOT } from './paths.mjs';

const DAY = 24 * 60 * 60 * 1000;
/** Catalogs younger than this aren't rebuilt (a bit under a week, so a weekly schedule never skips). */
export const REFRESH_AFTER = 6.5 * DAY;
// The running process touches the lock every 30 s; silence for 2 minutes means it died.
const LOCK_STALE = 2 * 60 * 1000;

const files = (dataDir) => ({
  status: join(dataDir, 'refresh-status.json'),
  lock: join(dataDir, 'refresh.lock'),
  request: join(dataDir, 'refresh.request'),
});

/** When the catalogs in use were built: the refreshed copy if newer, else the bundled one. */
export function catalogsBuiltAt(dataDir) {
  const stamps = [join(dataDir, 'collections.json'), join(ROOT, 'src/data/collections.json')]
    .map((f) => readJson(f)?.generatedAt)
    .filter(Boolean)
    .sort();
  return stamps.at(-1) ?? null;
}

export const catalogsAreStale = (dataDir) => {
  const at = catalogsBuiltAt(dataDir);
  return !at || Date.now() - Date.parse(at) > REFRESH_AFTER;
};

/** { state: 'idle'|'running'|'error', generatedAt, startedAt?, finishedAt?, error?, log[] } */
export function refreshStatus(dataDir) {
  const f = files(dataDir);
  const status = readJson(f.status, { state: 'idle', log: [] });
  // A "running" status without a live lock means that process died mid-refresh.
  if (status.state === 'running' && !lockHeld(dataDir)) Object.assign(status, { state: 'error', error: 'interrupted' });
  return { ...status, generatedAt: catalogsBuiltAt(dataDir), requested: existsSync(f.request) };
}

function lockHeld(dataDir) {
  const { lock } = files(dataDir);
  return existsSync(lock) && Date.now() - statSync(lock).mtimeMs < LOCK_STALE;
}

/** Ask the worker to refresh soon (web process, admin "check now"). */
export function requestRefresh(dataDir) {
  writeFileSync(files(dataDir).request, new Date().toISOString());
}

/**
 * Run a refresh now, unless one is already running somewhere. Resolves when done.
 * @param {{ dataDir: string, configDir: string, log?: (m: string) => void }} opts
 * @returns {Promise<boolean>} false if another process holds the lock
 */
export async function runRefresh({ dataDir, configDir, log = console.log }) {
  const f = files(dataDir);
  if (lockHeld(dataDir)) return false;
  writeFileSync(f.lock, String(process.pid));
  rmSync(f.request, { force: true });

  const status = { state: 'running', startedAt: Date.now(), log: [] };
  const save = () => writeFileAtomic(f.status, JSON.stringify(status));
  let lastSave = 0;
  const say = (m) => {
    log(m);
    status.log = [...status.log.slice(-40), m];
    if (Date.now() - lastSave > 5000) {
      lastSave = Date.now();
      save();
    }
  };
  save();
  const heartbeat = setInterval(() => writeFileSync(f.lock, String(process.pid)), 30_000);
  try {
    const built = await buildAll({ log: say, cacheFile: join(dataDir, 'cache', 'steamspy-tags.json') });
    // A domain whose build failed is missing: its previous file stays (the client falls back to
    // the bundled one) and its collection groups are carried over.
    const prev = [join(dataDir, 'collections.json'), join(ROOT, 'src/data/collections.json')].find((p) => existsSync(p));
    keepMissingGroups(built, prev ? JSON.parse(readFileSync(prev, 'utf8')) : null);
    // Collections last: clients use the refreshed set once its generatedAt is newer.
    for (const [name, contents] of Object.entries(built).sort(([a], [b]) => (a === 'collections') - (b === 'collections')))
      writeFileAtomic(join(dataDir, `${name}.json`), JSON.stringify(contents));
    await refreshMyGames({ dataDir, configDir, log: say });
    Object.assign(status, { state: 'idle', finishedAt: Date.now() });
  } catch (e) {
    Object.assign(status, { state: 'error', error: e.message, finishedAt: Date.now() });
    log(`refresh failed: ${e.message}`);
  } finally {
    clearInterval(heartbeat);
    save();
    rmSync(f.lock, { force: true });
  }
  return true;
}

/** Your own games (config dir), with fresh covers (Roblox icon URLs expire). */
export function readMyGames(configDir) {
  const raw = readJson(join(configDir, 'my-games.json'), []);
  if (!Array.isArray(raw)) throw new Error(`${join(configDir, 'my-games.json')} must be a JSON array`);
  return raw.map((g) => ({ pop: 0, genres: [], composers: [], year: null, series: null, ...g }));
}

async function refreshMyGames({ dataDir, configDir, log }) {
  const games = readMyGames(configDir);
  if (!games.length) return;
  await enrichGames(games, { log });
  writeFileAtomic(join(dataDir, 'my-games.json'), JSON.stringify(games));
}

// ---- CLI: node scripts/refresh.mjs [--force] ----------------------------------------------
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  loadEnvFiles();
  const { dataDir, configDir } = medleyPaths({ log: console.log });
  const force = process.argv.includes('--force');
  if (!force && !catalogsAreStale(dataDir)) {
    console.log(`Catalogs are fresh (built ${catalogsBuiltAt(dataDir)}); nothing to do. --force to rebuild anyway.`);
  } else if (!(await runRefresh({ dataDir, configDir }))) {
    console.log('Another refresh is already running.');
  } else {
    const s = refreshStatus(dataDir);
    console.log(s.state === 'idle' ? `Done: catalogs built ${s.generatedAt}.` : `Failed: ${s.error}`);
    process.exitCode = s.state === 'idle' ? 0 : 1;
  }
}
