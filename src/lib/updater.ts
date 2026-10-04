// Weekly update, run shortly after app start-up (and on demand via "check now").
//
//   1. Catalog: the local server rebuilds catalog + collections from Wikidata/SteamSpy/AniList
//      (same method as `npm run catalog`). New titles, release dates, covers, tags.
//   2. New titles: anything newly in a collection you subscribed to ("Add all", or the
//      "auto-add new" checkbox; "My games" by default) is imported in the background.
//   3. Retries: titles that found no soundtrack before (e.g. unreleased then) are tried again
//      once they're out, at most weekly.
//   4. Source sync: every imported playlist is re-checked for added / removed / renamed videos.
//   5. What changed is shown in the "new arrivals" banner.
//
// Bookkeeping lives in the library database (meta table), so it travels with backups.

import { useSyncExternalStore } from 'react';
import { db, getMeta, setMeta } from '../db';
import type { CatalogGame } from '../types';
import { resumeBulk, runBulk, type Arrivals } from './bulk';
import { gameMetaFrom } from './importer';
import { isUpcoming, loadCatalog, reloadCatalog, type Collections } from './catalog';
import { syncSources } from './sync';

const DAY = 24 * 60 * 60 * 1000;
export const UPDATE_INTERVAL = 7 * DAY;
const RETRY_AFTER = DAY; // when the refresh itself failed (offline, Wikidata down…)
const RETRY_FAILED_AFTER = 7 * DAY;

/** Server-side catalog refresh status (server/api.ts). */
interface RefreshStatus {
  state: 'idle' | 'running' | 'error';
  generatedAt: string | null;
  startedAt?: number;
  error?: string;
  log: string[];
}

async function refreshCall(method: 'GET' | 'POST', force = false): Promise<RefreshStatus | null> {
  try {
    const res = await fetch(`/api/refresh${force ? '?force=1' : ''}`, { method });
    return res.ok ? ((await res.json()) as RefreshStatus) : null;
  } catch {
    return null;
  }
}

const allIds = (c: Collections) => c.groups.flatMap((g) => g.lists.flatMap((l) => l.ids));

// --- status for the UI ---------------------------------------------------------
export interface UpdateStatus {
  lastRefreshAt: number | null;
  state: 'idle' | 'refreshing' | 'syncing' | 'error';
  message?: string;
}
let status: UpdateStatus = { lastRefreshAt: null, state: 'idle' };
const listeners = new Set<() => void>();
function setStatus(patch: Partial<UpdateStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
}
export function useUpdateStatus() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
}

// --- subscriptions -------------------------------------------------------------
export function getSubscriptions() {
  return getMeta<string[]>('subscriptions', ['mine']);
}

export async function setSubscribed(groupId: string, on: boolean, currentIds: string[] = []) {
  const subs = new Set(await getSubscriptions());
  if (on) subs.add(groupId);
  else subs.delete(groupId);
  await setMeta('subscriptions', [...subs]);
  // What's in the group right now is handled by the "Add all" import itself.
  const seen = new Set(await getMeta<string[]>('seenCollectionIds', []));
  for (const id of currentIds) seen.add(id);
  await setMeta('seenCollectionIds', [...seen]);
}

/** Copy franchise/platforms/keywords/kind from the catalog onto library games (for the shuffle filters). */
export async function syncLibraryMeta() {
  const { byId } = await loadCatalog();
  const games = await db.games.toArray();
  const changes = [];
  for (const g of games) {
    const cat = byId.get(g.id);
    if (!cat) continue;
    const meta = gameMetaFrom(cat);
    if (JSON.stringify([g.franchise, g.platforms, g.keywords, g.kind]) !== JSON.stringify([meta.franchise, meta.platforms, meta.keywords, meta.kind]))
      changes.push({ key: g.id, changes: meta });
  }
  if (changes.length) await db.games.bulkUpdate(changes);
}

/** Import entries from my-games.json that haven't been imported before (once each, so deleting one sticks). */
export async function ensureMyGames() {
  const { collections, byId } = await loadCatalog();
  const mine = collections.groups.find((g) => g.id === 'mine')?.lists.flatMap((l) => l.ids) ?? [];
  const done = new Set(await getMeta<string[]>('myGamesImported', []));
  const todo = mine.filter((id) => !done.has(id)).map((id) => byId.get(id)).filter((g): g is CatalogGame => !!g);
  if (!todo.length) return;
  await setMeta('myGamesImported', [...done, ...todo.map((g) => g.id)]);
  runBulk('My games', todo, { announce: true });
}

/** Start-up: resume an interrupted bulk import. */
export async function resumeInterrupted() {
  const { byId } = await loadCatalog();
  await resumeBulk(byId);
}

async function announceTracks(newTrackIds: string[], gamesWithNew: string[]) {
  if (!newTrackIds.length) return;
  const prev = await getMeta<Arrivals | null>('arrivals', null);
  await setMeta('arrivals', {
    at: Date.now(),
    label: prev?.label ?? 'Weekly update',
    ids: prev?.ids ?? [],
    newTrackIds: [...(prev?.newTrackIds ?? []), ...newTrackIds].slice(-1000),
    trackGameIds: [...new Set([...(prev?.trackGameIds ?? []), ...gamesWithNew])],
  } satisfies Arrivals);
}

// --- the update ----------------------------------------------------------------
let running = false;

export async function runUpdate(force = false) {
  if (running) return;
  running = true;
  try {
    const now = Date.now();
    const last = await getMeta<number>('lastRefreshAt', 0);
    setStatus({ lastRefreshAt: last || null });

    if (!last && !force) {
      // First launch: start the clock and remember what the collections hold today.
      const { collections } = await loadCatalog();
      await setMeta('lastRefreshAt', now);
      await setMeta('seenCollectionIds', allIds(collections));
      setStatus({ lastRefreshAt: now });
      return;
    }
    const lastAttempt = await getMeta<number>('lastRefreshAttemptAt', 0);
    if (!force && (now - last < UPDATE_INTERVAL || now - lastAttempt < RETRY_AFTER)) return;

    await setMeta('lastRefreshAttemptAt', now);

    // 1. Catalogs. The server rebuilds them in the background when they're about a week old
    //    (a hosted server also does this on its own schedule); we wait for it to finish.
    setStatus({ state: 'refreshing', message: 'Looking for new titles on Wikidata, Steam and AniList…' });
    let refresh = await refreshCall('POST', force);
    const startedWaiting = Date.now();
    while (refresh?.state === 'running' && Date.now() - startedWaiting < 3 * 60 * 60 * 1000) {
      const minutes = Math.round((Date.now() - (refresh.startedAt ?? Date.now())) / 60000);
      setStatus({ message: `Rebuilding the catalogs (${minutes} min so far, usually ~30)… ${refresh.log.at(-1) ?? ''}` });
      await new Promise((r) => setTimeout(r, 15_000));
      refresh = await refreshCall('GET');
    }
    if (!refresh || refresh.state !== 'idle') {
      const err = refresh?.error ?? (refresh ? 'still running' : 'server unreachable');
      setStatus({ state: 'error', message: `Update failed (${err}); will retry tomorrow.` });
      return;
    }
    const { collections, byId } = await reloadCatalog();
    await syncLibraryMeta();

    // 2. New titles in subscribed collections. 3. Released titles that found nothing before.
    const seen = new Set(await getMeta<string[]>('seenCollectionIds', []));
    const subs = new Set(await getSubscriptions());
    const library = new Set(await db.games.toCollection().primaryKeys());
    const candidates = [...new Set(collections.groups.filter((g) => subs.has(g.id)).flatMap((g) => g.lists.flatMap((l) => l.ids)))]
      .filter((id) => !seen.has(id) && !library.has(id))
      .map((id) => byId.get(id))
      .filter((g): g is CatalogGame => !!g);
    // Unreleased titles wait (left "unseen") until they're out; until then YouTube only has trailers.
    const fresh = candidates.filter((g) => !isUpcoming(g));
    const waiting = new Set(candidates.filter((g) => isUpcoming(g)).map((g) => g.id));
    const failures = await getMeta<Record<string, { at: number }>>('importFailures', {});
    const retries = Object.entries(failures)
      .filter(([id, f]) => !library.has(id) && now - f.at > RETRY_FAILED_AFTER)
      .map(([id]) => byId.get(id))
      .filter((g): g is CatalogGame => !!g && !isUpcoming(g));

    await setMeta('lastRefreshAt', now);
    await setMeta('seenCollectionIds', [...new Set([...seen, ...allIds(collections).filter((id) => !waiting.has(id))])]);
    const toImport = [...fresh, ...retries.filter((r) => !fresh.includes(r))];
    if (toImport.length) runBulk('Weekly update', toImport, { announce: true });

    // 4. Source sync (background; can take a while for big libraries).
    setStatus({ lastRefreshAt: now, state: 'syncing', message: 'Checking your playlists for new and changed tracks…' });
    const sync = await syncSources((done, total) =>
      setStatus({ message: `Checking your playlists for new and changed tracks… ${done}/${total}` }),
    );
    await announceTracks(sync.newTrackIds, sync.gamesWithNew);

    setStatus({
      state: 'idle',
      message:
        [
          toImport.length ? `${toImport.length} new titles importing` : 'no new titles',
          sync.added ? `${sync.added} new tracks` : null,
          sync.removed ? `${sync.removed} tracks removed upstream` : null,
          sync.renamed ? `${sync.renamed} renamed` : null,
        ]
          .filter(Boolean)
          .join(' · ') + '.',
    });
  } finally {
    running = false;
  }
}
