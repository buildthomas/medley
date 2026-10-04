// On-the-fly artist search for anyone not in the pre-built artist catalog. MusicBrainz is
// keyless; it asks for a descriptive User-Agent and at most ~1 request/second.

import { ARTIST_GENRES } from '../scripts/artist-builder.mjs';
import { bucket, UA } from '../scripts/wd.mjs';
import type { CatalogGame } from '../src/types.ts';

let lastRequest = 0;

interface MbArtist {
  id: string;
  name: string;
  type?: string;
  country?: string;
  area?: { name?: string };
  disambiguation?: string;
  score?: number;
  'life-span'?: { begin?: string };
  tags?: { name: string; count: number }[];
}

export async function searchArtists(query: string): Promise<CatalogGame[]> {
  const q = query.trim();
  if (!q) return [];
  const wait = lastRequest + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();
  const url = `https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(q)}&fmt=json&limit=12`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`MusicBrainz responded ${res.status}`);
  const body = (await res.json()) as { artists?: MbArtist[] };
  return (body.artists ?? [])
    .filter((a) => (a.score ?? 0) >= 60)
    .map((a) => {
      const tags = (a.tags ?? []).sort((x, y) => y.count - x.count).map((t) => t.name);
      const genres = bucket(tags, ARTIST_GENRES);
      const since = Number(a['life-span']?.begin?.slice(0, 4)) || null;
      const group = a.type === 'Group' || a.type === 'Orchestra' || a.type === 'Choir';
      return {
        id: `mb:${a.id}`,
        kind: 'artist' as const,
        title: a.name,
        year: since,
        genres: genres.length ? genres : ['Other'],
        series: null,
        composers: [],
        // MusicBrainz match score (0–100) as a weak popularity stand-in; catalog artists rank above.
        pop: Math.round((a.score ?? 0) / 10),
        artist: {
          ...(a.area?.name ? { country: a.area.name } : {}),
          ...(since ? { since } : {}),
          type: group ? ('group' as const) : ('person' as const),
        },
        tags: {
          genre: tags.slice(0, 8).map((t) => t.charAt(0).toUpperCase() + t.slice(1)),
          ...(a.area?.name ? { country: [a.area.name] } : {}),
        },
        ...(a.disambiguation ? { altTitles: [a.disambiguation] } : {}),
        links: [{ label: 'MusicBrainz', url: `https://musicbrainz.org/artist/${a.id}` }],
      };
    });
}
