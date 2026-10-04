// Source sync: re-check the YouTube playlists your library was imported from.
//   - new videos in the playlist      → new tracks (cleaned and tagged like an import)
//   - videos gone from the playlist   → tracks marked unavailable (plays/likes kept)
//   - videos renamed by the uploader  → track renamed, unless you renamed it yourself (customTitle)
// Single-video sources (full-OST videos split by timestamps) and mixed-game playlists are skipped.

import { db } from '../db';
import type { CatalogGame, Game, Source, Track } from '../types';
import { loadCatalog } from './catalog';
import { draftFromLink } from './importer';

const WEEK = 7 * 24 * 60 * 60 * 1000;

export interface SyncResult {
  checked: number;
  added: number;
  removed: number;
  renamed: number;
  newTrackIds: string[];
  gamesWithNew: string[];
}

function asCatalog(g: Game, cat: CatalogGame | undefined): CatalogGame {
  return cat ?? { ...g, franchise: g.franchise ?? undefined, pop: 0 };
}

async function syncOne(source: Source, game: CatalogGame, result: SyncResult) {
  const draft = await draftFromLink({ kind: 'playlist', id: source.id }, game);
  const fresh = new Map((draft.groups[0]?.tracks ?? []).map((t) => [t.key, t]));
  const existing = await db.tracks.where('sourceId').equals(source.id).toArray();
  const have = new Map(existing.map((t) => [t.id, t]));
  const updates: { key: string; changes: Partial<Track> }[] = [];
  const additions: Track[] = [];

  for (const t of existing) {
    const d = fresh.get(t.id);
    if (!d) {
      if (!t.unavailable) {
        updates.push({ key: t.id, changes: { unavailable: true } });
        result.removed++;
      }
    } else if (!t.customTitle && d.title !== t.title) {
      updates.push({ key: t.id, changes: { title: d.title, types: d.types } });
      result.renamed++;
    }
  }
  for (const d of fresh.values()) {
    if (have.has(d.key)) continue;
    // The same video may already be in the library via another source; leave that one alone.
    if (await db.tracks.get(d.key)) continue;
    additions.push({
      id: d.key,
      gameId: game.id,
      videoId: d.videoId,
      title: d.title,
      start: d.start,
      end: d.end,
      duration: d.duration,
      types: d.types,
      vocal: d.vocal,
      sourceId: source.id,
      liked: false,
      banned: false,
      unavailable: false,
      playCount: 0,
      skipCount: 0,
      lastPlayedAt: null,
    });
  }
  await db.transaction('rw', db.tracks, db.sources, async () => {
    if (updates.length) await db.tracks.bulkUpdate(updates);
    if (additions.length) await db.tracks.bulkAdd(additions);
    await db.sources.update(source.id, { syncedAt: Date.now() });
  });
  result.added += additions.length;
  result.newTrackIds.push(...additions.map((t) => t.id));
  if (additions.length && !result.gamesWithNew.includes(game.id)) result.gamesWithNew.push(game.id);
}

/** Sync every playlist source not checked in the last week. Runs quietly in the background. */
export async function syncSources(onProgress?: (done: number, total: number) => void): Promise<SyncResult> {
  const { byId } = await loadCatalog();
  const now = Date.now();
  const due = (await db.sources.toArray()).filter(
    (s) => s.kind === 'playlist' && s.gameIds.length === 1 && now - (s.syncedAt ?? s.importedAt) > WEEK,
  );
  const result: SyncResult = { checked: 0, added: 0, removed: 0, renamed: 0, newTrackIds: [], gamesWithNew: [] };
  let i = 0;
  const worker = async () => {
    while (i < due.length) {
      const source = due[i++];
      const game = await db.games.get(source.gameIds[0]);
      if (game) {
        try {
          await syncOne(source, asCatalog(game, byId.get(game.id)), result);
        } catch {
          /* playlist gone private/deleted or YouTube hiccup: try again next week */
          await db.sources.update(source.id, { syncedAt: Date.now() });
        }
      }
      result.checked++;
      onProgress?.(result.checked, due.length);
    }
  };
  await Promise.all([worker(), worker()]);
  return result;
}
