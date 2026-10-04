// Anime import: every opening (OP), ending (ED) and insert song (IN) listed by AnimeThemes,
// each found as its own YouTube video, plus the series' score (OST playlist) as a bonus.
// What gets imported is the "Adding anime" scope (everything / songs only / OPs & EDs /
// openings only), a per-browser preference used by every add button and bulk import.
// Single songs can be added from the anime's page (importAnime with `themes`).
//
// For each song we look for the full version by the credited artist (official MV or
// "Artist - Topic" upload). If that's not found, the TV-size creditless opening/ending.

import { useSyncExternalStore } from 'react';
import { db } from '../../db';
import type { AnimeTheme, CatalogGame, TrackRole } from '../../types';
import { searchVideos, type VideoHit } from '../api';
import { commitFoundTracks, importSoundtrackPlaylist, type AutoAddResult, type DraftTrack } from '../importer';
import { normalize } from '../parse';

const BAD =
  /\bcover\b|reaction|piano|\blyrics?\b|karaoke|nightcore|slowed|sped up|\b8d\b|\bhours?\b|\bloop\b|\bamv\b|\bedit\b|fan ?made|tutorial|guitar|drum|bass cover|remix|\bmashup\b|instrumental|off vocal|8-bit|music box|orchestral/i;
const CREDITLESS = /creditless|non-?credit|\bnc(op|ed)\b|clean (opening|ending)/i;
const OFFICIAL = /official|\bmv\b|music video|- topic$/i;

const roleOf = (t: AnimeTheme['type']): TrackRole => (t === 'OP' ? 'op' : t === 'ED' ? 'ed' : 'insert');

/**
 * How likely is this video the theme song? Official uploads are often titled in Japanese
 * (紅蓮の弓矢) while AnimeThemes uses romaji (Guren no Yumiya), so the song name alone isn't
 * enough: the artist's own channel, or "<anime> Opening 1", also identify it.
 */
function scoreHit(hit: VideoHit, theme: AnimeTheme, anime: CatalogGame): number {
  const title = normalize(hit.title);
  const song = normalize(theme.song);
  const channel = normalize(hit.channel.replace(/\s*-\s*topic$/i, ''));
  const songMatch = !!song && title.includes(song);
  const artistMatch =
    !!channel && theme.artists.some((a) => { const n = normalize(a); return n && (channel.includes(n) || n.includes(channel)); });
  const animeMatch = [anime.title, ...(anime.altTitles ?? [])].some((n) => { const x = normalize(n); return x.length >= 3 && title.includes(x); });
  const word = theme.type === 'OP' ? '(opening|op)' : theme.type === 'ED' ? '(ending|ed)' : '(insert|song)';
  const typeMatch = new RegExp(`\\b${word}\\s*${theme.seq ?? ''}\\b`).test(title);
  if (!(songMatch || (artistMatch && (animeMatch || typeMatch)) || (animeMatch && typeMatch))) return -100;

  let score = 0;
  if (songMatch) score += 5;
  if (artistMatch) score += 4;
  if (animeMatch) score += 2;
  if (typeMatch) score += 3;
  if (OFFICIAL.test(hit.title) || OFFICIAL.test(hit.channel)) score += 1.5;
  if (CREDITLESS.test(hit.title)) score += 1;
  if (BAD.test(hit.title)) score -= 8;
  const d = hit.duration ?? 0;
  if (d >= 60 && d <= 480) score += 1;
  else score -= 5;
  return score;
}

async function findThemeVideo(theme: AnimeTheme, anime: CatalogGame): Promise<VideoHit | null> {
  const queries = [
    `${theme.artists[0] ?? ''} ${theme.song}`.trim(),
    `${anime.title} ${theme.type}${theme.seq ?? ''} ${theme.song}`,
  ];
  let best: { hit: VideoHit; score: number } | null = null;
  for (const q of queries) {
    for (const hit of (await searchVideos(q)).slice(0, 12)) {
      const s = scoreHit(hit, theme, anime);
      if (!best || s > best.score) best = { hit, score: s };
    }
    if (best && best.score >= 9) break; // artist's own upload found
  }
  return best && best.score >= 6 ? best.hit : null;
}

// ---- what to import ----------------------------------------------------------------------

export type AnimeScope = 'all' | 'songs' | 'oped' | 'op';
export const ANIME_SCOPES: { id: AnimeScope; label: string; hint: string; types: AnimeTheme['type'][]; ost: boolean }[] = [
  { id: 'all', label: 'Everything', hint: 'Openings, endings, insert songs and the soundtrack', types: ['OP', 'ED', 'IN'], ost: true },
  { id: 'songs', label: 'Songs only', hint: 'Openings, endings and insert songs, no soundtrack', types: ['OP', 'ED', 'IN'], ost: false },
  { id: 'oped', label: 'OPs & EDs', hint: 'Openings and endings only', types: ['OP', 'ED'], ost: false },
  { id: 'op', label: 'Openings', hint: 'Openings only', types: ['OP'], ost: false },
];
const SCOPE_KEY = 'vgm-shuffle:anime-scope';
const scopeListeners = new Set<() => void>();

export function getAnimeScope(): AnimeScope {
  try {
    const v = localStorage.getItem(SCOPE_KEY);
    if (ANIME_SCOPES.some((s) => s.id === v)) return v as AnimeScope;
  } catch {
    /* storage unavailable */
  }
  return 'all';
}

export function setAnimeScope(scope: AnimeScope) {
  try {
    localStorage.setItem(SCOPE_KEY, scope);
  } catch {
    /* storage unavailable */
  }
  scopeListeners.forEach((l) => l());
}

export function useAnimeScope(): AnimeScope {
  return useSyncExternalStore(
    (l) => {
      scopeListeners.add(l);
      return () => scopeListeners.delete(l);
    },
    getAnimeScope,
  );
}

export const scopeInfo = (scope: AnimeScope) => ANIME_SCOPES.find((s) => s.id === scope)!;

/** Same song already in the library (from an earlier, narrower import)? */
const themeKey = (role: string, seq: number | null | undefined, song: string) => `${role}${seq ?? ''}:${normalize(song)}`;

// ---- import ------------------------------------------------------------------------------------

/**
 * Imports an anime's songs and/or soundtrack. `scope` defaults to the user's "Adding anime"
 * preference; `themes` imports exactly those songs (e.g. one opening) and nothing else.
 * Songs already in the library are skipped, so a narrower import can be widened later.
 */
export async function importAnime(
  anime: CatalogGame,
  opts: { scope?: AnimeScope; themes?: AnimeTheme[] } = {},
): Promise<AutoAddResult> {
  const scope = scopeInfo(opts.scope ?? getAnimeScope());
  const wanted = opts.themes ?? (anime.themes ?? []).filter((t) => scope.types.includes(t.type)).slice(0, 24);
  const withOst = !opts.themes && scope.ost;
  if (!wanted.length && !withOst) {
    throw new Error(scope.id === 'op' ? 'No openings listed for this anime' : 'No songs listed for this anime');
  }

  const have = new Set(
    (await db.tracks.where('gameId').equals(anime.id).toArray())
      .filter((t) => t.role && t.role !== 'score')
      .map((t) => themeKey(t.role!, t.seq, t.title)),
  );
  const todo = wanted.filter((t) => !have.has(themeKey(roleOf(t.type), t.seq, t.song)));

  const found: Omit<DraftTrack, 'include' | 'rawTitle' | 'key'>[] = [];
  const seen = new Set<string>();
  for (const theme of todo) {
    const hit = await findThemeVideo(theme, anime).catch(() => null);
    if (!hit || seen.has(hit.id)) continue;
    seen.add(hit.id);
    found.push({
      videoId: hit.id,
      title: theme.song,
      duration: hit.duration,
      types: ['vocal'],
      vocal: true,
      artist: theme.artists.join(', ') || undefined,
      role: roleOf(theme.type),
      seq: theme.seq,
    });
  }
  let added = found.length
    ? await commitFoundTracks(anime, `themes:${anime.id}`, `${anime.title} openings & endings`, found)
    : 0;

  // The score is a bonus: many anime have no good OST playlist.
  let ost: AutoAddResult | null = null;
  if (withOst) {
    try {
      ost = await importSoundtrackPlaylist(anime);
      added += ost.added;
    } catch {
      /* songs only */
    }
  }
  if (!added && !(wanted.length && !todo.length)) {
    throw new Error(
      opts.themes ? `Couldn't find “${opts.themes[0].song}” on YouTube` : withOst ? 'No openings, endings or soundtrack found' : 'No matching songs found on YouTube',
    );
  }
  return {
    added,
    sourceTitle:
      [found.length && `${found.length} song${found.length === 1 ? '' : 's'}`, ost && `“${ost.sourceTitle}”`].filter(Boolean).join(' + ') ||
      'songs you already had',
    sourceId: ost?.sourceId ?? `themes:${anime.id}`,
    candidates: ost?.candidates ?? [],
  };
}
