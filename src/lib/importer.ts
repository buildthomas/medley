// Turns a YouTube playlist/video into games + tracks, and auto-finds a good
// soundtrack playlist for a catalog game.

import { db } from '../db';
import type { CatalogGame, Game, Source, Track } from '../types';
import {
  fetchPlaylist,
  fetchVideo,
  searchPlaylists,
  searchVideos,
  parseYouTubeLink,
  type ParsedLink,
  type PlaylistHit,
} from './api';
import { loadCatalog } from './catalog';
import { cleanGameName, cleanTrackTitle, detectTypes, normalize, parseChapters } from './parse';

export interface DraftTrack {
  key: string;
  videoId: string;
  rawTitle: string;
  title: string;
  start?: number;
  end?: number;
  duration: number | null;
  types: string[];
  include: boolean;
}

export interface DraftGroup {
  key: string;
  title: string;
  catalogId: string | null;
  /** Metadata for games that aren't in the bundled catalog (e.g. looked up for a Steam library). */
  meta?: CatalogGame;
  tracks: DraftTrack[];
}

export interface ImportDraft {
  source: { id: string; kind: 'playlist' | 'video'; title: string; channel: string };
  groups: DraftGroup[];
}

function makeTrack(
  videoId: string,
  rawTitle: string,
  duration: number | null,
  gameTitles: string[],
  slice?: { start: number; end: number | null },
): DraftTrack {
  const title = cleanTrackTitle(rawTitle, gameTitles);
  return {
    key: slice ? `${videoId}@${slice.start}` : videoId,
    videoId,
    rawTitle,
    title,
    start: slice?.start,
    end: slice?.end ?? undefined,
    duration: slice ? (slice.end != null ? slice.end - slice.start : null) : duration,
    types: detectTypes(rawTitle, duration, !!slice),
    include: true,
  };
}

export async function draftFromLink(link: ParsedLink, forceGame?: CatalogGame): Promise<ImportDraft> {
  const { matcher } = await loadCatalog();

  if (link.kind === 'video') {
    const v = await fetchVideo(link.id);
    const guess = forceGame ? { title: forceGame.title, catalog: forceGame } : matcher.guessGame(v.title);
    const names = [guess.title, cleanGameName(v.title), ...(guess.catalog?.composers ?? [])];
    const chapters = parseChapters(v.description, v.duration);
    const tracks = chapters.length
      ? chapters.map((c) => makeTrack(v.id, c.title, v.duration, names, { start: c.start, end: c.end }))
      : [makeTrack(v.id, v.title, v.duration, names)];
    return {
      source: { id: v.id, kind: 'video', title: v.title, channel: v.channel },
      groups: [{ key: guess.title, title: guess.title, catalogId: guess.catalog?.id ?? null, meta: forceGame, tracks }],
    };
  }

  const p = await fetchPlaylist(link.id);
  const source = { id: p.id, kind: 'playlist' as const, title: p.title, channel: p.channel };
  const cleanedPlaylist = cleanGameName(p.title);

  if (forceGame) {
    const names = [forceGame.title, cleanedPlaylist, ...forceGame.composers];
    return {
      source,
      groups: [
        {
          key: forceGame.id,
          title: forceGame.title,
          catalogId: forceGame.id,
          meta: forceGame,
          tracks: p.items.map((i) => makeTrack(i.videoId, i.title, i.duration, names)),
        },
      ],
    };
  }

  // Decide whether the playlist is one game's OST or a mix of games.
  const guesses = p.items.map((i) => matcher.guessGame(i.title));
  const counts = new Map<string, number>();
  for (const g of guesses) counts.set(g.title, (counts.get(g.title) ?? 0) + 1);
  const [topTitle, topCount] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
  const playlistMatch = matcher.match(p.title);
  const single = topCount / Math.max(1, p.items.length) >= 0.6 || (playlistMatch && counts.size <= 3) || counts.size === 1;

  if (single) {
    const topGuess = guesses.find((g) => g.title === topTitle);
    const catalog = playlistMatch ?? topGuess?.catalog ?? null;
    const title = catalog?.title ?? (cleanedPlaylist || topTitle);
    const names = [title, cleanedPlaylist, topTitle, ...(catalog?.composers ?? [])];
    return {
      source,
      groups: [
        {
          key: title,
          title,
          catalogId: catalog?.id ?? null,
          tracks: p.items.map((i) => makeTrack(i.videoId, i.title, i.duration, names)),
        },
      ],
    };
  }

  const groups = new Map<string, DraftGroup>();
  p.items.forEach((item, idx) => {
    const g = guesses[idx];
    let group = groups.get(g.title);
    if (!group) {
      group = { key: g.title, title: g.title, catalogId: g.catalog?.id ?? null, tracks: [] };
      groups.set(g.title, group);
    }
    group.tracks.push(makeTrack(item.videoId, item.title, item.duration, [g.title, ...(g.catalog?.composers ?? [])]));
  });
  return { source, groups: [...groups.values()].sort((a, b) => b.tracks.length - a.tracks.length) };
}

/** Catalog fields copied onto library games so the shuffle can filter on them. */
export function gameMetaFrom(cat: CatalogGame): Pick<Game, 'franchise' | 'platforms' | 'keywords'> {
  return { franchise: cat.franchise ?? cat.series ?? null, platforms: cat.tags?.platform ?? [], keywords: cat.keywords ?? [] };
}

function slug(s: string) {
  return normalize(s).replace(/ /g, '-') || 'game';
}

/** Saves a (possibly user-edited) draft into the library. Returns tracks added. */
export async function commitDraft(draft: ImportDraft): Promise<number> {
  const { byId } = await loadCatalog();
  let added = 0;
  const gameIds: string[] = [];

  await db.transaction('rw', db.games, db.tracks, db.sources, async () => {
    for (const group of draft.groups) {
      const included = group.tracks.filter((t) => t.include);
      if (!included.length) continue;

      const cat = (group.catalogId ? byId.get(group.catalogId) : undefined) ?? group.meta;
      const gameId = cat?.id ?? `u:${slug(group.title)}`;
      gameIds.push(gameId);
      const existingGame = await db.games.get(gameId);
      const game: Game = existingGame ?? {
        id: gameId,
        title: cat?.title ?? group.title.trim(),
        year: cat?.year ?? null,
        genres: cat?.genres ?? [],
        series: cat?.series ?? null,
        composers: cat?.composers ?? [],
        ...(cat ? gameMetaFrom(cat) : {}),
        enabled: true,
        addedAt: Date.now(),
      };
      await db.games.put(game);

      const ids = included.map((t) => t.key);
      const existing = await db.tracks.bulkGet(ids);
      const rows: Track[] = included.map((t, i) => {
        const prev = existing[i];
        if (prev) return { ...prev, gameId, title: t.title, types: t.types };
        added++;
        return {
          id: t.key,
          gameId,
          videoId: t.videoId,
          title: t.title,
          start: t.start,
          end: t.end,
          duration: t.duration,
          types: t.types,
          sourceId: draft.source.id,
          liked: false,
          banned: false,
          unavailable: false,
          playCount: 0,
          skipCount: 0,
          lastPlayedAt: null,
        };
      });
      await db.tracks.bulkPut(rows);
    }

    const prev = await db.sources.get(draft.source.id);
    const source: Source = {
      ...draft.source,
      gameIds: [...new Set([...(prev?.gameIds ?? []), ...gameIds])],
      importedAt: Date.now(),
    };
    await db.sources.put(source);
  });
  return added;
}

// ---------------------------------------------------------------------------
// Auto-discovery for catalog games

const BAD = /movie|motion picture|\bfilm\b|\banime\b|\bseries\b|remix|\bcover|piano|guitar|8.?bit|lo-?fi|chill|\bhours?\b|reaction|playthrough|walkthrough|longplay|gameplay|let'?s play|trailer|speedrun|tutorial|\bamv\b|nightcore|orchestra(l)? (cover|arrangement)|sleep|study|relax/i;
const GOOD = /\bost\b|soundtrack|sound track|\bbgm\b|original score|\bmusic\b/i;
const OFFICIAL = /- topic$|official|music channel|records|sound team/i;

const FILLER = new Set(
  ('the a of and ost original soundtrack soundtracks sound track game video music full complete official score bgm ' +
    'playlist album audio hd hq remastered remaster edition collection deluxe expanded vol volume disc cd nes snes ' +
    'n64 gamecube wii switch ps1 ps2 ps3 ps4 ps5 psx xbox pc genesis gba ds 3ds all tracks with dlc by').split(' '),
);

export interface Candidate {
  hit: PlaylistHit;
  score: number;
}

export async function rankPlaylistCandidates(game: CatalogGame, hits: PlaylistHit[]): Promise<Candidate[]> {
  const { matcher } = await loadCatalog();
  const target = ` ${normalize(game.title)} `;
  return hits
    .map((hit) => {
      const t = ` ${normalize(hit.title)} `;
      let score = 0;
      if (t.includes(target)) score += 6;
      else return { hit, score: -100 };
      // Words that aren't the game name or OST boilerplate suggest a different
      // product ("Saint Seiya Hades OST" when looking for "Hades").
      const before = t.slice(0, t.indexOf(target)).trim().split(' ').filter((w) => w && !FILLER.has(w));
      const after = t.slice(t.indexOf(target) + target.length).trim().split(' ').filter((w) => w && !FILLER.has(w) && !/^\d+$/.test(w));
      score -= 2.5 * Math.min(before.length, 3) + 0.75 * Math.min(after.length, 4);
      const matched = matcher.match(hit.title);
      // e.g. searching "Final Fantasy VII" but the playlist is "Final Fantasy VII Remake".
      if (matched && matched.id !== game.id && normalize(matched.title).length > target.trim().length) score -= 7;
      if (GOOD.test(hit.title)) score += 3;
      if (BAD.test(hit.title)) score -= 6;
      if (OFFICIAL.test(hit.channel)) score += 1.5;
      if (hit.title.startsWith('Album - ') || hit.id.startsWith('OLAK5uy_')) score += 1.5;
      const n = hit.videoCount ?? 0;
      if (n < 4) score -= 6;
      else if (n < 8) score -= 1;
      else if (n <= 250) score += 2;
      else score -= 1; // giant "every track + remixes" dumps
      return { hit, score };
    })
    .filter((c) => c.score > -100)
    .sort((a, b) => b.score - a.score);
}

export async function findCandidates(game: CatalogGame): Promise<Candidate[]> {
  const queries = [`${game.title} OST`, `${game.title} original soundtrack`];
  const seen = new Set<string>();
  const hits: PlaylistHit[] = [];
  for (const q of queries) {
    for (const h of await searchPlaylists(q)) {
      if (!seen.has(h.id)) {
        seen.add(h.id);
        hits.push(h);
      }
    }
    // The first query is usually enough.
    const ranked = await rankPlaylistCandidates(game, hits);
    if (ranked[0]?.score >= 9) return ranked;
  }
  return rankPlaylistCandidates(game, hits);
}

export interface AutoAddResult {
  added: number;
  sourceTitle: string;
  sourceId: string;
  candidates: Candidate[];
}

/** Finds the best soundtrack source for a catalog game and imports it. */
export async function autoAddGame(game: CatalogGame, pick?: PlaylistHit): Promise<AutoAddResult> {
  // Games with hand-picked sources (my-games.json) skip the search entirely.
  if (!pick && game.sources?.length) {
    let added = 0;
    let last = { title: '', id: '' };
    for (const src of game.sources) {
      const link = parseYouTubeLink(src);
      if (!link) continue;
      const draft = await draftFromLink(link, game);
      added += await commitDraft(draft);
      last = { title: draft.source.title, id: draft.source.id };
    }
    return { added, sourceTitle: last.title, sourceId: last.id, candidates: [] };
  }

  if (pick) {
    const draft = await draftFromLink({ kind: 'playlist', id: pick.id }, game);
    const added = await commitDraft(draft);
    return { added, sourceTitle: pick.title, sourceId: pick.id, candidates: [] };
  }

  const candidates = await findCandidates(game);
  // Try the top few; reject playlists that turn out to be mostly 30-minute
  // loops ("extended") or that have almost nothing playable.
  for (const c of candidates.filter((c) => c.score >= 5).slice(0, 3)) {
    const draft = await draftFromLink({ kind: 'playlist', id: c.hit.id }, game);
    const tracks = draft.groups[0]?.tracks ?? [];
    const normal = tracks.filter((t) => !t.types.includes('extended'));
    if (normal.length < 3 || normal.length < tracks.length * 0.5) continue;
    const added = await commitDraft(draft);
    return { added, sourceTitle: c.hit.title, sourceId: c.hit.id, candidates };
  }

  // No decent playlist: look for a single full-OST video with a timestamped tracklist.
  const videos = await searchVideos(`${game.title} full soundtrack`);
  const target = ` ${normalize(game.title)} `;
  for (const v of videos.slice(0, 8)) {
    if (!(v.duration && v.duration > 15 * 60)) continue;
    if (!` ${normalize(v.title)} `.includes(target) || BAD.test(v.title)) continue;
    const draft = await draftFromLink({ kind: 'video', id: v.id }, game);
    if (draft.groups[0].tracks.length < 4) continue;
    const added = await commitDraft(draft);
    return { added, sourceTitle: v.title, sourceId: v.id, candidates };
  }
  throw Object.assign(new Error('No good soundtrack source found'), { candidates });
}

/** Swap a game's tracks from one source for another. */
export async function replaceSource(game: CatalogGame, oldSourceId: string, pick: PlaylistHit) {
  await db.tracks
    .where('gameId')
    .equals(game.id)
    .filter((t) => t.sourceId === oldSourceId)
    .delete();
  const s = await db.sources.get(oldSourceId);
  if (s) {
    const rest = s.gameIds.filter((g) => g !== game.id);
    if (rest.length) await db.sources.update(s.id, { gameIds: rest });
    else await db.sources.delete(s.id);
  }
  return autoAddGame(game, pick);
}
