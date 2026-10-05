// The order of a title's tracks ("album order"), used everywhere a title's tracks are listed or
// played in order (title page, ▶ Play soundtrack, Library).
//
//   1. anime songs first: openings (OP1, OP2…), then endings, then insert songs
//   2. then each source (playlist / video) in the order it was added
//   3. within a source: its playlist position (`pos`), then the slice start for chapters of one
//      long video, then the name
//
// `pos` is stored at import and kept current by the weekly sync. Libraries imported before it
// existed get it backfilled from the (cached) playlist: on start-up in the background, and right
// away when you open a title whose tracks lack it.

import { db } from '../db';
import type { Source, Track } from '../types';
import { fetchPlaylist } from './api';

const ROLE_RANK: Record<string, number> = { op: 0, ed: 1, insert: 2 };

export function albumOrder(tracks: Track[], sources: Source[] = []): Track[] {
  const added = new Map(sources.map((s) => [s.id, s.importedAt]));
  const rank = (t: Track) => ROLE_RANK[t.role ?? ''] ?? 3;
  return tracks.slice().sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (rank(a) < 3 ? (a.seq ?? 0) - (b.seq ?? 0) : 0) ||
      (added.get(a.sourceId) ?? 0) - (added.get(b.sourceId) ?? 0) ||
      a.sourceId.localeCompare(b.sourceId) ||
      (a.pos ?? Infinity) - (b.pos ?? Infinity) ||
      (a.start ?? 0) - (b.start ?? 0) ||
      a.title.localeCompare(b.title),
  );
}

/** Fill in missing playlist positions for one playlist source. */
async function fillSource(source: Source) {
  if (source.kind !== 'playlist') return;
  const tracks = await db.tracks.where('sourceId').equals(source.id).toArray();
  if (!tracks.length || tracks.every((t) => t.pos != null)) return;
  const playlist = await fetchPlaylist(source.id);
  const index = new Map<string, number>();
  playlist.items.forEach((item, i) => index.has(item.videoId) || index.set(item.videoId, i));
  const updates = tracks
    .filter((t) => t.pos == null && index.has(t.videoId))
    .map((t) => ({ key: t.id, changes: { pos: index.get(t.videoId)! } }));
  if (updates.length) await db.tracks.bulkUpdate(updates);
}

const done = new Set<string>();

/** Right away, for the title being looked at. */
export async function ensurePositions(gameId: string) {
  const sources = await db.sources.filter((s) => s.gameIds.includes(gameId)).toArray();
  for (const s of sources) {
    if (done.has(s.id)) continue;
    done.add(s.id);
    await fillSource(s).catch(() => done.delete(s.id));
  }
}

/** In the background, for the whole library (a few requests at a time; skips what's done). */
export async function backfillPositions() {
  const sources = await db.sources.toArray();
  for (const s of sources) {
    if (done.has(s.id)) continue;
    done.add(s.id);
    await fillSource(s).catch(() => done.delete(s.id));
    await new Promise((r) => setTimeout(r, 300));
  }
}
