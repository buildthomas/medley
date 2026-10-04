import Dexie, { type EntityTable } from 'dexie';
import type { Game, Play, Source, Track } from './types';

export const db = new Dexie('vgm-shuffle') as Dexie & {
  games: EntityTable<Game, 'id'>;
  tracks: EntityTable<Track, 'id'>;
  sources: EntityTable<Source, 'id'>;
  plays: EntityTable<Play, 'id'>;
  meta: EntityTable<{ key: string; value: unknown }, 'key'>;
};

db.version(1).stores({
  games: 'id, title, addedAt',
  tracks: 'id, gameId, videoId, sourceId',
  sources: 'id, importedAt',
  plays: '++id, at, trackId, gameId',
});

// v2: key/value store for app state that must survive (monthly update bookkeeping).
db.version(2).stores({ meta: 'key' });

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  return ((await db.meta.get(key))?.value as T) ?? fallback;
}

export function setMeta(key: string, value: unknown) {
  return db.meta.put({ key, value });
}

export async function deleteGame(gameId: string) {
  await db.transaction('rw', db.games, db.tracks, db.sources, async () => {
    await db.tracks.where('gameId').equals(gameId).delete();
    await db.games.delete(gameId);
    const sources = await db.sources.toArray();
    for (const s of sources) {
      if (!s.gameIds.includes(gameId)) continue;
      const rest = s.gameIds.filter((g) => g !== gameId);
      if (rest.length) await db.sources.update(s.id, { gameIds: rest });
      else await db.sources.delete(s.id);
    }
  });
}

export async function exportLibrary(): Promise<string> {
  const [games, tracks, sources, plays, meta] = await Promise.all([
    db.games.toArray(),
    db.tracks.toArray(),
    db.sources.toArray(),
    db.plays.toArray(),
    db.meta.toArray(),
  ]);
  return JSON.stringify({ version: 1, exportedAt: Date.now(), games, tracks, sources, plays, meta });
}

export async function importLibrary(json: string) {
  const data = JSON.parse(json);
  if (data?.version !== 1) throw new Error('Unrecognised backup file');
  await db.transaction('rw', [db.games, db.tracks, db.sources, db.plays, db.meta], async () => {
    await db.games.bulkPut(data.games ?? []);
    await db.tracks.bulkPut(data.tracks ?? []);
    await db.sources.bulkPut(data.sources ?? []);
    await db.plays.bulkPut(data.plays ?? []);
    await db.meta.bulkPut(data.meta ?? []);
  });
}
