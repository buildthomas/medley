// Monthly auto-update, run shortly after app start-up:
//   1. If 30+ days have passed since the last refresh, ask the local server to rebuild
//      the catalog + collections from Wikidata/SteamSpy (same method as `npm run catalog`).
//   2. Games that newly appear in a collection you've subscribed to (by pressing
//      "Add all", or "My games" by default) are imported in the background.
// Bookkeeping lives in the library database (meta table), so it travels with backups.

import { useSyncExternalStore } from 'react';
import { db, getMeta, setMeta } from '../db';
import type { CatalogGame } from '../types';
import { runBulk } from './bulk';
import { gameMetaFrom } from './importer';
import { loadCatalog, reloadCatalog, type Collections } from './catalog';

const DAY = 24 * 60 * 60 * 1000;
export const UPDATE_INTERVAL = 30 * DAY;
const RETRY_AFTER = DAY; // when the refresh itself failed (offline, Wikidata down…)

const allIds = (c: Collections) => c.groups.flatMap((g) => g.lists.flatMap((l) => l.ids));

// --- status for the UI ---------------------------------------------------------
export interface UpdateStatus {
  lastRefreshAt: number | null;
  state: 'idle' | 'refreshing' | 'error';
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

/** Copy franchise/platforms/keywords from the catalog onto library games (for the shuffle filters). */
export async function syncLibraryMeta() {
  const { byId } = await loadCatalog();
  const games = await db.games.toArray();
  const changes = [];
  for (const g of games) {
    const cat = byId.get(g.id);
    if (!cat) continue;
    const meta = gameMetaFrom(cat);
    if (JSON.stringify([g.franchise, g.platforms, g.keywords]) !== JSON.stringify([meta.franchise, meta.platforms, meta.keywords]))
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
  runBulk('My games', todo);
}

// --- the update ----------------------------------------------------------------
let running = false;

export async function monthlyUpdate(force = false) {
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
    setStatus({ state: 'refreshing', message: 'Looking for new games on Wikidata and Steam…' });
    const res = await fetch('/api/refresh', { method: 'POST' }).catch(() => null);
    if (!res?.ok) {
      const err = res ? ((await res.json().catch(() => ({}))).error ?? res.status) : 'server unreachable';
      setStatus({ state: 'error', message: `Monthly update failed (${err}); will retry tomorrow.` });
      return;
    }

    const { collections, byId } = await reloadCatalog();
    await syncLibraryMeta();
    const seen = new Set(await getMeta<string[]>('seenCollectionIds', []));
    const subs = new Set(await getSubscriptions());
    const library = new Set(await db.games.toCollection().primaryKeys());
    const fresh = [
      ...new Set(
        collections.groups.filter((g) => subs.has(g.id)).flatMap((g) => g.lists.flatMap((l) => l.ids)),
      ),
    ]
      .filter((id) => !seen.has(id) && !library.has(id))
      .map((id) => byId.get(id))
      .filter((g): g is CatalogGame => !!g);

    await setMeta('lastRefreshAt', now);
    await setMeta('seenCollectionIds', [...new Set([...seen, ...allIds(collections)])]);
    setStatus({
      lastRefreshAt: now,
      state: 'idle',
      message: fresh.length ? `Found ${fresh.length} new games; importing them.` : 'Up to date: no new games in your collections.',
    });
    if (fresh.length) runBulk('Monthly update', fresh);
  } finally {
    running = false;
  }
}
