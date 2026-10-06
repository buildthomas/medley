// Anime: the most popular titles from AniList, with every opening/ending/insert song from
// AnimeThemes. Both APIs are public and keyless.
//
//   AniList GraphQL   titles (English + romaji), dates, genres, tags, studios, portrait covers,
//                     popularity, format (TV / movie / ONA…)
//   AnimeThemes       OP/ED/IN per anime: sequence, song title, artists, episodes

import { sleep, userAgent } from './wd.mjs';

const ANILIST = 'https://graphql.anilist.co';
const THEMES = 'https://api.animethemes.moe';
const TOTAL = 1200; // most popular titles to keep
const PER_PAGE = 50;

const QUERY = `query ($page: Int) {
  Page(page: $page, perPage: ${PER_PAGE}) {
    media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) {
      id idMal format status popularity averageScore episodes
      title { romaji english }
      synonyms
      startDate { year month day }
      genres
      tags { name rank isMediaSpoiler }
      studios(isMain: true) { nodes { name } }
      coverImage { extraLarge large }
      siteUrl
    }
  }
}`;

async function anilistPage(page, log) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(ANILIST, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': userAgent() },
      body: JSON.stringify({ query: QUERY, variables: { page } }),
    }).catch(() => null);
    if (res?.ok) return (await res.json()).data.Page.media;
    const wait = Number(res?.headers.get('retry-after') ?? 0) * 1000 || 4000 * (attempt + 1);
    log?.(`  AniList ${res?.status ?? 'network error'}, waiting ${wait / 1000}s…`);
    await sleep(wait);
  }
  throw new Error('AniList failed repeatedly');
}

async function themesFor(anilistIds, log) {
  const out = new Map();
  for (let i = 0; i < anilistIds.length; i += 50) {
    const batch = anilistIds.slice(i, i + 50);
    const params = new URLSearchParams({
      'filter[has]': 'resources',
      'filter[site]': 'AniList',
      'filter[external_id]': batch.join(','),
      include: 'animethemes.song.artists,animethemes.animethemeentries,resources',
      'fields[anime]': 'id,name',
      'page[size]': '100',
    });
    let body = null;
    for (let attempt = 0; attempt < 5 && !body; attempt++) {
      const res = await fetch(`${THEMES}/anime?${params}`, { headers: { 'User-Agent': userAgent(), Accept: 'application/json' } }).catch(() => null);
      if (res?.ok) body = await res.json();
      else await sleep(3000 * (attempt + 1));
    }
    for (const a of body?.anime ?? []) {
      const al = a.resources?.find((r) => r.site === 'AniList')?.external_id;
      if (!al) continue;
      const themes = (a.animethemes ?? [])
        .filter((t) => t.song?.title)
        .map((t) => ({
          type: t.type,
          seq: t.sequence ?? null,
          song: t.song.title,
          artists: (t.song.artists ?? []).map((ar) => ar.artistsong?.as || ar.name),
          ...(t.animethemeentries?.[0]?.episodes ? { episodes: t.animethemeentries[0].episodes } : {}),
        }))
        // Same song can appear twice (e.g. "ED1" and "ED1-TV"); keep one.
        .filter((t, idx, all) => all.findIndex((o) => o.type === t.type && o.song === t.song) === idx);
      if (themes.length) out.set(Number(al), themes);
    }
    if ((i / 50) % 5 === 4) log?.(`  themes ${Math.min(i + 50, anilistIds.length)}/${anilistIds.length}`);
    await sleep(700); // AnimeThemes allows ~90 requests/minute
  }
  return out;
}

/** "Attack on Titan Season 3 Part 2" → "Attack on Titan": groups seasons/movies into a franchise. */
function franchiseName(title) {
  let t = title.split(/:\s| - /)[0];
  t = t
    .replace(/\s+(season|part|cour)\s*\d+.*$/i, '')
    .replace(/\s+\d+(st|nd|rd|th)\s+season.*$/i, '')
    .replace(/\s+(the\s+)?(final season|movie|film|ova|specials?).*$/i, '')
    .replace(/\s+(II|III|IV|V|2|3|4|5)$/, '')
    .trim();
  return t || title;
}

const pad = (n) => String(n).padStart(2, '0');

export async function buildAnime({ log = console.log } = {}) {
  log(`Anime: top ${TOTAL} from AniList…`);
  const media = [];
  for (let page = 1; media.length < TOTAL; page++) {
    const batch = await anilistPage(page, log);
    if (!batch.length) break;
    media.push(...batch);
    await sleep(800); // AniList allows ~90 requests/minute (temporarily 30)
  }
  log(`  ${media.length} titles; songs from AnimeThemes…`);
  const themes = await themesFor(media.map((m) => m.id), log);

  const items = media.map((m) => {
    const title = m.title.english || m.title.romaji;
    const s = m.startDate ?? {};
    const date = s.year && s.month ? (s.day ? `${s.year}-${pad(s.month)}-${pad(s.day)}` : `${s.year}-${pad(s.month)}`) : null;
    const keywords = (m.tags ?? [])
      .filter((t) => !t.isMediaSpoiler && t.rank >= 70)
      .slice(0, 12)
      .map((t) => t.name);
    return {
      id: `al:${m.id}`,
      kind: 'anime',
      title,
      altTitles: [...new Set([m.title.romaji, ...(m.synonyms ?? []).filter((x) => /^[\x20-\x7e]+$/.test(x))])].filter((x) => x && x !== title).slice(0, 4),
      year: s.year ?? null,
      ...(date ? { date } : {}),
      genres: m.genres ?? [],
      series: null,
      franchise: franchiseName(title),
      composers: [],
      pop: Math.round((m.popularity ?? 0) / 5000),
      tags: {
        ...(m.studios?.nodes?.length ? { studio: m.studios.nodes.map((n) => n.name) } : {}),
        ...(m.format ? { format: [m.format === 'TV_SHORT' ? 'TV short' : m.format === 'MOVIE' ? 'Movie' : m.format] } : {}),
        genre: m.genres ?? [],
      },
      ...(keywords.length ? { keywords } : {}),
      covers: [m.coverImage?.extraLarge, m.coverImage?.large].filter(Boolean),
      links: [
        { label: 'AniList', url: m.siteUrl },
        ...(m.idMal ? [{ label: 'MyAnimeList', url: `https://myanimelist.net/anime/${m.idMal}` }] : []),
      ],
      ...(themes.get(m.id) ? { themes: themes.get(m.id) } : {}),
    };
  });

  // A franchise of one title isn't a franchise.
  const franchiseCount = new Map();
  for (const i of items) franchiseCount.set(i.franchise, (franchiseCount.get(i.franchise) ?? 0) + 1);
  for (const i of items) if (franchiseCount.get(i.franchise) < 2) delete i.franchise;

  const thisYear = new Date().getFullYear();
  const top = (pred, n) => items.filter(pred).sort((a, b) => b.pop - a.pop).slice(0, n).map((i) => i.id);
  const withSongs = (i) => i.themes?.some((t) => t.type === 'OP' || t.type === 'ED');
  const groups = [
    {
      id: 'anime',
      domain: 'anime',
      title: 'Anime',
      description: 'The most popular anime on AniList, with all their openings, endings and insert songs.',
      lists: [
        { id: 'anime-top', title: 'Most popular', ids: top(withSongs, 60) },
        { id: 'anime-films', title: 'Anime films', ids: top((i) => i.tags.format?.[0] === 'Movie', 40) },
        { id: 'anime-ghibli', title: 'Studio Ghibli', ids: top((i) => i.tags.studio?.includes('Studio Ghibli'), 30) },
        ...Array.from({ length: thisYear - 2009 }, (_, k) => thisYear - k).map((y) => ({
          id: `anime-${y}`,
          title: String(y),
          ids: top((i) => i.year === y && withSongs(i), 20),
        })),
        { id: 'anime-classics', title: 'Before 2010', ids: top((i) => i.year && i.year < 2010 && withSongs(i), 40) },
      ],
    },
  ];
  log(`Anime: ${items.length} titles, ${items.filter(withSongs).length} with OP/ED songs`);
  return { items, groups };
}
