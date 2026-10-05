// Background worker for hosting with separate web and worker processes (MEDLEY_ROLE=web on the
// web side). Shares the data dir with the web process, nothing else.
//
//   npm run worker          long-running: checks every minute
//   node scripts/refresh.mjs   one-shot alternative for cron / scheduled jobs
//
// Each minute: refresh the catalogs if an admin asked (refresh.request) or they're a week old
// (backing off a day after a failure); once a day: drop expired cached API answers.

import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnvFiles, medleyPaths } from '../scripts/paths.mjs';
import { catalogsAreStale, refreshStatus, runRefresh } from '../scripts/refresh.mjs';

loadEnvFiles();
const log = (m: string) => console.log(`[worker] ${m}`);
const { dataDir, configDir } = medleyPaths({ log });
const DAY = 24 * 60 * 60 * 1000;
const CACHE_MAX_AGE = 8 * DAY; // longer than any API cache TTL (server/api.ts)

let running = false;
let stopping = false;

async function tick() {
  if (running || stopping) return;
  const s = refreshStatus(dataDir);
  if (s.state === 'running') return; // another process is on it
  // Back off a day after a real failure; an interrupted run (crash, redeploy) just starts over.
  const backingOff = s.state === 'error' && s.error !== 'interrupted' && Date.now() - (s.finishedAt ?? 0) < DAY;
  if (!s.requested && (backingOff || !catalogsAreStale(dataDir))) return;
  running = true;
  log(s.requested ? 'refresh requested' : 'catalogs are a week old; refreshing');
  try {
    await runRefresh({ dataDir, configDir, log });
  } finally {
    running = false;
  }
}

function pruneCache() {
  const root = join(dataDir, 'cache', 'api');
  let removed = 0;
  try {
    for (const shard of readdirSync(root)) {
      const dir = join(root, shard);
      for (const f of readdirSync(dir)) {
        const file = join(dir, f);
        if (Date.now() - statSync(file).mtimeMs > CACHE_MAX_AGE) {
          rmSync(file, { force: true });
          removed++;
        }
      }
    }
  } catch {
    /* no cache yet */
  }
  if (removed) log(`pruned ${removed} expired cache entries`);
}

log(`started (data: ${dataDir})`);
void tick();
pruneCache();
const timers = [setInterval(tick, 60_000), setInterval(pruneCache, DAY)];

for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => {
    stopping = true;
    timers.forEach(clearInterval);
    // A refresh in progress is abandoned; its lock goes stale and the next run starts over.
    log(`${signal}: stopping${running ? ' (abandoning the refresh in progress)' : ''}`);
    process.exit(0);
  });
