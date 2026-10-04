// Artist import: their popular songs, found with a few YouTube searches and kept only when
// uploaded by the artist's own channels (official channel, "Artist - Topic", VEVO).
// YouTube orders search results by relevance, which for an artist's name is close to
// "most popular first".
//
// Also: turning one song link into { song, artist } for "add a single song".

import { db } from '../../db';
import type { CatalogGame } from '../../types';
import { fetchVideo, searchVideos, type VideoHit } from '../api';
import { loadCatalog } from '../catalog';
import { commitFoundTracks, type AutoAddResult, type DraftTrack } from '../importer';
import { normalize } from '../parse';

const MAX_SONGS = 30;
const BAD =
  /\blive\b|reaction|\bcover\b|karaoke|\blyrics?\b|full album|playlist|\bmix\b|medley|\bhours?\b|interview|behind the scenes|teaser|trailer|#shorts|\bconcert\b|\b8d\b|slowed|sped up|nightcore|tutorial|instrumental|\bremix\b|documentary|\bvlog\b|making of|dance (performance|practice)|choreography|performance video|relay dance|\bstage\b/i;

const CHANNEL_NOISE = /\s*(-\s*topic|vevo|official( channel)?|music|records|tv)\s*$/i;

/** Is this upload from the artist (or their label's official channel)? */
export function isArtistUpload(hit: Pick<VideoHit, 'channel' | 'channelId' | 'title'>, artist: Pick<CatalogGame, 'title'> & { ytChannel?: string }) {
  if (artist.ytChannel && hit.channelId === artist.ytChannel) return true;
  const name = normalize(artist.title);
  const channel = normalize(hit.channel.replace(CHANNEL_NOISE, '').replace(CHANNEL_NOISE, ''));
  if (!name || !channel) return false;
  if (channel === name || channel === `official ${name}` || channel.replace(/ /g, '') === name.replace(/ /g, '')) return true;
  // "YOASOBI and Echoes", "Taylor Swift Official": the channel starts with the artist's name.
  if (channel.startsWith(name + ' ') && channel.length <= name.length + 14) return true;
  // VEVO channels: "TaylorSwiftVEVO" with the artist in the title.
  return /vevo$/i.test(hit.channel) && normalize(hit.title).includes(name);
}

/** "Taylor Swift - Shake It Off (Official Video)" → "Shake It Off"; YOASOBI「勇者」Official Music Video → 勇者 */
export function cleanSongTitle(raw: string, artist: string): string {
  let t = raw;
  const jp = t.match(/[「『]([^」』]+)[」』]/);
  if (jp) return jp[1].trim();
  t = t.replace(/[([【][^)\]】]*(official|video|audio|lyric|visuali[sz]er|\bmv\b|\bm\/v\b|\bhd\b|\b4k\b|remaster|explicit|clean|color coded)[^)\]】]*[)\]】]/gi, ' ');
  t = t.replace(/\b(official (music )?(video|audio|mv)|music video|lyric video|visuali[sz]er|\bmv\b|\bm\/v\b)\b/gi, ' ');
  const parts = t.split(/\s[-–—|]\s/);
  if (parts.length > 1) {
    const a = normalize(artist);
    const idx = parts.findIndex((p) => normalize(p) === a || normalize(p).startsWith(a + ' ') || a.startsWith(normalize(p) + ' '));
    if (idx >= 0) parts.splice(idx, 1);
    t = parts.join(' - ');
  }
  t = t.replace(/\s+/g, ' ').replace(/^[\s\-–—|:]+|[\s\-–—|:]+$/g, '').trim();
  // K-pop style 'Kill This Love' / ‘GO’: drop the wrapping quotes.
  const quoted = t.match(/^['‘’"“”](.+)['‘’"“”]$/);
  if (quoted) t = quoted[1].trim();
  return t || raw.trim();
}

export async function findArtistSongs(artist: CatalogGame & { ytChannel?: string }): Promise<VideoHit[]> {
  const queries = [artist.title, `${artist.title} official music video`, `${artist.title} official audio`, `${artist.title} songs`];
  const songs: VideoHit[] = [];
  const titles = new Set<string>();
  for (const q of queries) {
    for (const hit of await searchVideos(q)) {
      const d = hit.duration ?? 0;
      if (d < 80 || d > 660 || BAD.test(hit.title) || !isArtistUpload(hit, artist)) continue;
      const key = normalize(cleanSongTitle(hit.title, artist.title));
      if (!key || titles.has(key)) continue;
      titles.add(key);
      songs.push(hit);
    }
    if (songs.length >= MAX_SONGS) break;
  }
  return songs.slice(0, MAX_SONGS);
}

export async function importArtist(artist: CatalogGame & { ytChannel?: string }): Promise<AutoAddResult> {
  const hits = await findArtistSongs(artist);
  if (!hits.length) throw new Error(`No songs from ${artist.title}'s own channels found`);
  const tracks: Omit<DraftTrack, 'include' | 'rawTitle' | 'key'>[] = hits.map((h) => ({
    videoId: h.id,
    title: cleanSongTitle(h.title, artist.title),
    duration: h.duration,
    types: ['vocal'],
    vocal: !/\binstrumental\b/i.test(h.title),
    artist: artist.title,
    role: 'song',
  }));
  const added = await commitFoundTracks(artist, `songs:${artist.id}`, `${artist.title}: popular songs`, tracks);
  return { added, sourceTitle: `${hits.length} popular songs`, sourceId: `songs:${artist.id}`, candidates: [] };
}

// ---------------------------------------------------------------------------
// A single song

export interface ParsedSong {
  videoId: string;
  song: string;
  artist: string;
  featuring: string[];
  album?: string;
  duration: number | null;
}

/**
 * Song and artist from a YouTube video. Auto-generated "Topic" uploads describe themselves
 * exactly ("Provided to YouTube by …\n\nSong · Artist · Feat\n\nAlbum"); otherwise we parse
 * "Artist - Song (Official Video)" or fall back to the channel name.
 */
export async function parseSongVideo(videoId: string): Promise<ParsedSong> {
  const v = await fetchVideo(videoId);
  const lines = v.description.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (/^provided to youtube by/i.test(lines[0] ?? '') && lines[1]?.includes(' · ')) {
    const [song, ...artists] = lines[1].split(' · ').map((s) => s.trim());
    return { videoId, song, artist: artists[0] ?? v.channel.replace(CHANNEL_NOISE, ''), featuring: artists.slice(1), album: lines[2], duration: v.duration };
  }
  const channelArtist = v.channel.replace(CHANNEL_NOISE, '').replace(CHANNEL_NOISE, '').trim();
  const { artistNames } = await loadCatalog();
  const dash = v.title.split(/\s[-–—]\s/);
  if (dash.length >= 2) {
    // "Lady Gaga, Bruno Mars - Die With A Smile": the uploading channel is the main artist
    // when it's among the credits; the others are featured.
    const credits = splitCredits(dash[0], artistNames);
    const main = credits.find((c) => normalize(c) === normalize(channelArtist)) ?? credits[0];
    const { title, featuring } = splitFeaturing(dash.slice(1).join(' - '), artistNames);
    return {
      videoId,
      song: cleanSongTitle(title, main),
      artist: main,
      featuring: unique([...credits.filter((c) => c !== main), ...featuring]),
      duration: v.duration,
    };
  }
  const { title, featuring } = splitFeaturing(v.title, artistNames);
  return { videoId, song: cleanSongTitle(title, channelArtist), artist: channelArtist, featuring, duration: v.duration };
}

const unique = (names: string[]) => [...new Map(names.map((n) => [normalize(n), n])).values()];

/** "Lady Gaga, Bruno Mars" → both; "Earth, Wind & Fire" (a known artist) stays whole. */
function splitCredits(s: string, known: Set<string>): string[] {
  const whole = s.trim();
  if (known.has(normalize(whole))) return [whole];
  return whole
    .split(/\s*,\s*|\s+&\s+|\s+x\s+|\s+(?:feat\.?|ft\.?|featuring)\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Pulls featured artists out of a song title: "Levitating Featuring DaBaby",
 * "Song (feat. A & B)", "Song [with C]". A bare "with" isn't a credit ("Die With A Smile").
 */
function splitFeaturing(title: string, known: Set<string>): { title: string; featuring: string[] } {
  const featuring: string[] = [];
  let t = title.replace(/\s*[([]\s*(?:feat\.?|ft\.?|featuring|with)\s+([^)\]]+)[)\]]/gi, (_m, names: string) => {
    featuring.push(...splitCredits(names, known));
    return '';
  });
  t = t.replace(/\s+(?:feat\.?|ft\.?|featuring)\s+(.+?)(?=\s*[([]|$)/i, (_m, names: string) => {
    featuring.push(...splitCredits(names, known));
    return '';
  });
  return { title: t.trim(), featuring };
}

/** Find (or create) the artist work for a name: catalog first, then a custom entry. */
export async function artistWork(name: string): Promise<CatalogGame> {
  const { games } = await loadCatalog();
  const n = normalize(name);
  const hit = games
    .filter((g) => g.kind === 'artist' && normalize(g.title) === n)
    .sort((a, b) => b.pop - a.pop)[0];
  if (hit) return hit;
  const existing = (await db.games.toArray()).find((g) => g.kind === 'artist' && normalize(g.title) === n);
  const id = existing?.id ?? `u:artist-${n.replace(/ /g, '-')}`;
  return { id, kind: 'artist', title: existing?.title ?? name, year: null, genres: [], series: null, composers: [], pop: 0 };
}

/** Add one song to its artist (creating the artist in your library if needed). */
export async function addSong(song: ParsedSong): Promise<{ artist: CatalogGame; added: number }> {
  const artist = await artistWork(song.artist);
  const added = await commitFoundTracks(artist, `songs:${artist.id}`, `${artist.title}: songs`, [
    {
      videoId: song.videoId,
      title: song.song + (song.featuring.length ? ` (feat. ${song.featuring.join(', ')})` : ''),
      duration: song.duration,
      types: ['vocal'],
      vocal: true,
      artist: [song.artist, ...song.featuring].join(', '),
      role: 'song',
    },
  ]);
  return { artist, added };
}
