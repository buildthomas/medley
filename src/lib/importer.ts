// Turns YouTube playlists/videos into works + tracks, and auto-finds a good source for a
// catalog work. Games, films and series import a soundtrack playlist; anime import their
// OP/ED songs (plus the OST) via importers/anime.ts.

import { db } from '../db';
import type { CatalogGame, Game, Source, Track, TrackRole, WorkKind } from '../types';
import {
  fetchPlaylist,
  fetchVideo,
  searchPlaylists,
  searchVideos,
  parseYouTubeLink,
  type ParsedLink,
  type PlaylistHit,
} from './api';
import { gamePlatforms, platformsIn } from './platforms';
import { loadCatalog } from './catalog';
import { kindOf } from './kinds';
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
  vocal?: boolean;
  artist?: string;
  role?: TrackRole;
  seq?: number | null;
  /** Who uploaded the video (not stored; tells a fan's remix from the soundtrack's own uploads). */
  uploader?: string;
}

export interface DraftGroup {
  key: string;
  title: string;
  catalogId: string | null;
  /** Metadata for works that aren't in the bundled catalog (e.g. a Steam library lookup). */
  meta?: CatalogGame;
  tracks: DraftTrack[];
}

export interface ImportDraft {
  source: { id: string; kind: Source['kind']; title: string; channel: string; label?: string };
  groups: DraftGroup[];
}

// ---- vocal / score detection for film & TV soundtracks ----------------------------------------

const VOCAL_TITLE = /\b(feat\.?|ft\.|featuring)\s|\bsings?\b|\bsong\b|\breprise\b|\bduet\b|\bvocal\b|\blyrics?\b/i;
const VARIOUS = /^various artists?$/i;
// Songs on a soundtrack album are usually annotated with where they're from.
const FROM_WORK = /[([]\s*from (the )?(series|film|movie|motion picture|netflix|disney|original)/i;
// Score cues often look like "Main Title - …" or "Suite - …"; those aren't artists.
const SCORE_CUE = /\b(theme|title|suite|main|end|opening|prologue|finale|overture|credits|interlude|part|act|chapter|scene|cue)\b|^\d/i;

interface ClassifyCtx {
  kind: WorkKind;
  composers: string[];
  workNames: string[];
  artistNames: Set<string>;
  musical?: boolean;
}

/**
 * Is a film/series soundtrack track a song or score? Clues, strongest first:
 *   - "(Instrumental)", "Score" in the title → score
 *   - uploaded by "<Performer> - Topic" or a known artist's channel: the composer → score,
 *     anyone else → a song by them (Let It Go → Idina Menzel; Annihilate → Metro Boomin)
 *   - vocal words (feat., reprise, song) or a soundtrack-album annotation: "(from the film …)",
 *     or the film's own name in brackets: "Calling (Spider-Man: Across the Spider-Verse)"
 *   - "Artist - Song" / "Song - Artist" where one side is a known artist or lists several
 *     ("Metro Boomin, Coi Leray - Self Love"); in musicals any "Song - Performer"
 */
function classifyScreenTrack(rawTitle: string, channel: string | undefined, ctx: ClassifyCtx) {
  const { composers, workNames } = ctx;
  const song = (artist?: string) => ({ vocal: true, role: 'song' as const, ...(artist ? { artist } : {}) });
  const score = { vocal: false, role: 'score' as const };
  // An instrumental/karaoke version is never a sung track, whoever uploaded it.
  if (/\b(instrumental|karaoke|off vocal|score)\b/i.test(rawTitle)) return score;
  // Anime OST playlists are the composer's score (AniList doesn't list composers, so the
  // performer rules can't tell); its songs come from AnimeThemes. Only explicit vocal hints count.
  if (ctx.kind === 'anime') return VOCAL_TITLE.test(rawTitle) ? song() : score;

  const isComposer = (p: string) =>
    composers.some((c) => {
      const a = normalize(c);
      const b = normalize(p);
      return a && b && (a.includes(b) || b.includes(a));
    });
  const known = (p: string) => ctx.artistNames.has(normalize(p));
  const performer = channel?.replace(/\s*-\s*topic$/i, '').trim();
  if (performer && !VARIOUS.test(performer) && (/-\s*topic$/i.test(channel ?? '') || known(performer))) {
    return isComposer(performer) ? score : song(performer);
  }
  if (VOCAL_TITLE.test(rawTitle) || FROM_WORK.test(rawTitle)) return song();
  const brackets = [...rawTitle.matchAll(/[([]([^)\]]+)[)\]]/g)].map((m) => m[1]);
  if (brackets.some((b) => !/soundtrack|\bost\b|score|intro|outro/i.test(b) && workNames.some((w) => w.length > 3 && normalize(b).includes(w)))) {
    return song();
  }

  const parts = rawTitle.split(/\s[-–—]\s/);
  if (parts.length === 2) {
    const [left, right] = parts.map((p) => p.replace(/[([][^)\]]*[)\]]/g, '').trim());
    const several = (p: string) => /,|&|\bfeat\b|\band\b/i.test(p);
    const usable = (p: string) => p && !isComposer(p) && !SCORE_CUE.test(p) && !workNames.some((w) => normalize(p).includes(w));
    if ((known(left) || several(left)) && usable(left)) return song(left);
    if ((known(right) || several(right)) && usable(right)) return song(right);
    // In a musical, "Song - Performer" is a sung number even when the performer is an actor.
    if (ctx.musical && usable(left) && usable(right)) return song();
  }
  // A musical's soundtrack is mostly its numbers: without other clues, a track that doesn't
  // look like a score cue is sung ("Honey, Honey", "Dancing Queen").
  if (ctx.musical && !SCORE_CUE.test(rawTitle.replace(/^\s*\d+\s*[-.):]?\s*/, ''))) return song();
  return { vocal: undefined, role: undefined };
}

function makeTrack(
  videoId: string,
  rawTitle: string,
  duration: number | null,
  names: string[],
  slice?: { start: number; end: number | null },
  ctx?: { kind?: WorkKind; channel?: string; composers?: string[]; artistNames?: Set<string>; musical?: boolean },
): DraftTrack {
  // The uploader of an album track ("Hiroyuki Sawano - Topic") often repeats in its title.
  const performer = ctx?.channel && /-\s*topic$/i.test(ctx.channel) ? ctx.channel.replace(/\s*-\s*topic$/i, '') : null;
  const title = cleanTrackTitle(rawTitle, performer ? [...names, performer] : names);
  const types = detectTypes(rawTitle, duration, !!slice);
  const track: DraftTrack = {
    key: slice ? `${videoId}@${slice.start}` : videoId,
    videoId,
    rawTitle,
    title,
    start: slice?.start,
    end: slice?.end ?? undefined,
    duration: slice ? (slice.end != null ? slice.end - slice.start : null) : duration,
    types,
    include: true,
    ...(ctx?.channel ? { uploader: ctx.channel } : {}),
  };
  const kind = ctx?.kind ?? 'game';
  if (kind === 'film' || kind === 'series' || kind === 'anime') {
    const c = classifyScreenTrack(rawTitle, ctx?.channel, {
      kind,
      composers: ctx?.composers ?? [],
      workNames: names.map(normalize).filter(Boolean),
      artistNames: ctx?.artistNames ?? new Set(),
      musical: ctx?.musical,
    });
    if (c.vocal != null) track.vocal = c.vocal;
    if (c.role) track.role = c.role;
    if ('artist' in c && c.artist) track.artist = c.artist;
    if (track.vocal && !types.includes('vocal')) track.types = [...types, 'vocal'];
  }
  return track;
}

// ---- derivative tracks: fan remixes, covers, slowed/nightcore edits, loops -------------------------

/**
 * Uploads that aren't the work's own music. Playlists that are fine by title still carry them
 * ("Helltaker OST": half its tracks are "SayMaxWell - Luminescent [Remix] (NO Copyright)").
 */
// Always a fan's edit, whoever uploaded it. ("Unofficial soundtrack" is not one: uploaders call
// in-game music that never got an album release that, like The Witcher 3's cemetery ambience.
// "(Extended)" loops are the real music too.)
const FAN_EDIT = /no copyright|copyright free|fan ?-?made|\bnightcore\b|\bslowed\b|\bsped up\b|\b8d audio\b/i;
// Often a fan's, but games and their studios publish these too (Riot's Worlds remixes,
// Fortnite's "Emote Remix" lobby tracks, Cyberpunk's "SAMURAI Cover"): only when unofficial.
const VARIANT = /\bremix(ed)?\b|\brmx\b|\bcover\b|\blo-?fi\b|\bmashup\b|\bbootleg\b|\b\d+\s*hours?\b/i;

/**
 * Unticks derivative tracks (pasted links show them unticked in the review; auto-imports skip
 * them). FAN_EDIT always; VARIANT unless it looks official: an official channel uploaded it,
 * it says "official", it's by one of the work's composers, or it comes from the same uploader
 * as the rest of the playlist. Not when the word is in the work's own name, and not when nearly
 * the whole playlist is like that: then it's a remix album someone chose (Celeste's B-Sides).
 */
function skipDerivatives(draft: ImportDraft, composersOf: (g: DraftGroup) => string[]): ImportDraft {
  const all = draft.groups.flatMap((g) => g.tracks);
  const variant = (t: DraftTrack) => FAN_EDIT.test(t.rawTitle) || VARIANT.test(t.rawTitle);
  // Who uploaded the plain tracks; a remix from them is part of the same collection.
  const uploads = new Map<string, number>();
  for (const t of all) if (t.uploader && !variant(t)) uploads.set(t.uploader, (uploads.get(t.uploader) ?? 0) + 1);
  const isDerivative = (t: DraftTrack, g: DraftGroup) => {
    const raw = t.rawTitle;
    if (FAN_EDIT.test(g.title) || VARIANT.test(g.title)) return false;
    if (FAN_EDIT.test(raw)) return true;
    if (!VARIANT.test(raw)) return false;
    const official =
      /\bofficial\b/i.test(raw) ||
      (!!t.uploader && (OFFICIAL.test(t.uploader) || (uploads.get(t.uploader) ?? 0) >= 2)) ||
      composersOf(g).some((c) => c.length > 2 && normalize(raw).includes(normalize(c)));
    return !official;
  };
  const flagged = draft.groups.flatMap((g) => g.tracks.filter((t) => isDerivative(t, g)));
  // A remix album is (nearly) all remixes; half is a soundtrack with fan uploads mixed in.
  if (!flagged.length || flagged.length >= all.length * 0.75) return draft;
  const skip = new Set(flagged);
  return { ...draft, groups: draft.groups.map((g) => ({ ...g, tracks: g.tracks.map((t) => (skip.has(t) ? { ...t, include: false } : t)) })) };
}

export async function draftFromLink(link: ParsedLink, forceGame?: CatalogGame): Promise<ImportDraft> {
  const draft = await buildDraft(link, forceGame);
  const { byId } = await loadCatalog();
  return skipDerivatives(draft, (g) => forceGame?.composers ?? (g.catalogId ? (byId.get(g.catalogId)?.composers ?? []) : []));
}

async function buildDraft(link: ParsedLink, forceGame?: CatalogGame): Promise<ImportDraft> {
  const { matcher } = await loadCatalog();
  // Known performers: none since the artists catalog was removed; Topic channels, "feat." and
  // soundtrack annotations still identify songs.
  const artistNames = new Set<string>();
  const ctx = forceGame
    ? {
        kind: kindOf(forceGame),
        composers: forceGame.composers,
        artistNames,
        musical: forceGame.keywords?.includes('Musical') || forceGame.genres.includes('Musical'),
      }
    : undefined;
  const altNames = forceGame?.altTitles ?? [];

  if (link.kind === 'video') {
    const v = await fetchVideo(link.id);
    const guess = forceGame ? { title: forceGame.title, catalog: forceGame } : matcher.guessGame(v.title);
    const names = [guess.title, ...altNames, cleanGameName(v.title), ...(guess.catalog?.composers ?? [])];
    const chapters = parseChapters(v.description, v.duration);
    const tracks = chapters.length
      ? chapters.map((c) => makeTrack(v.id, c.title, v.duration, names, { start: c.start, end: c.end }, ctx))
      : [makeTrack(v.id, v.title, v.duration, names, undefined, { ...ctx, channel: v.channel })];
    return {
      source: { id: v.id, kind: 'video', title: v.title, channel: v.channel },
      groups: [{ key: guess.title, title: guess.title, catalogId: guess.catalog?.id ?? null, meta: forceGame, tracks }],
    };
  }

  const p = await fetchPlaylist(link.id);
  const source = { id: p.id, kind: 'playlist' as const, title: p.title, channel: p.channel };
  const cleanedPlaylist = cleanGameName(p.title);

  if (forceGame) {
    const names = [forceGame.title, ...altNames, cleanedPlaylist, ...forceGame.composers];
    return {
      source,
      groups: [
        {
          key: forceGame.id,
          title: forceGame.title,
          catalogId: forceGame.id,
          meta: forceGame,
          tracks: p.items.map((i) => makeTrack(i.videoId, i.title, i.duration, names, undefined, { ...ctx, channel: i.channel })),
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
          tracks: p.items.map((i) => makeTrack(i.videoId, i.title, i.duration, names, undefined, { channel: i.channel })),
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
    group.tracks.push(makeTrack(item.videoId, item.title, item.duration, [g.title, ...(g.catalog?.composers ?? [])], undefined, { channel: item.channel }));
  });
  return { source, groups: [...groups.values()].sort((a, b) => b.tracks.length - a.tracks.length) };
}

/** Catalog fields copied onto library works so the shuffle can filter on them. */
export function gameMetaFrom(cat: CatalogGame): Pick<Game, 'franchise' | 'platforms' | 'keywords' | 'kind'> {
  return {
    kind: kindOf(cat),
    franchise: cat.franchise ?? cat.series ?? null,
    platforms: cat.tags?.platform ?? [],
    keywords: cat.keywords ?? [],
  };
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

      // A video already filed under another title (an artist's song that is also an anime's
      // opening, a song on two soundtracks) gets its own row for this title, `<key>~<gameId>`,
      // so both titles keep it.
      const first = await db.tracks.bulkGet(included.map((t) => t.key));
      const ids = included.map((t, i) => (first[i] && first[i]!.gameId !== gameId ? `${t.key}~${gameId}` : t.key));
      const existing = await db.tracks.bulkGet(ids);
      const rows: Track[] = included.map((t, i) => {
        const prev = existing[i];
        // Re-importing keeps plays/likes and a name you gave the track yourself, and takes what
        // the new import knows better (an anime theme's role and number, the performer).
        if (prev)
          return {
            ...prev,
            title: prev.customTitle ? prev.title : t.title,
            types: t.types,
            ...(t.role ? { role: t.role } : {}),
            ...(t.seq != null ? { seq: t.seq } : {}),
            ...(t.vocal != null ? { vocal: t.vocal } : {}),
            ...(t.artist ? { artist: t.artist } : {}),
            ...(prev.sourceId === draft.source.id ? { pos: i } : {}),
          };
        added++;
        return {
          id: ids[i],
          gameId,
          videoId: t.videoId,
          title: t.title,
          ...(t.artist ? { artist: t.artist } : {}),
          ...(t.role ? { role: t.role } : {}),
          ...(t.seq != null ? { seq: t.seq } : {}),
          pos: i,
          ...(t.vocal != null ? { vocal: t.vocal } : {}),
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
// Auto-discovery: finding a soundtrack playlist for a catalog work

interface Vocab {
  queries: (w: CatalogGame) => string[];
  good: RegExp;
  bad: RegExp;
}

const COMMON_BAD =
  /remix|\bcover|piano|guitar|8.?bit|lo-?fi|chill|\bhours?\b|reaction|trailer|speedrun|tutorial|\bamv\b|nightcore|sleep|study|relax|\bslowed\b|sped up|\b8d\b|karaoke/i;

const VOCAB: Record<'game' | 'screen' | 'anime', Vocab> = {
  game: {
    queries: (g) => [`${g.title} OST`, `${g.title} original soundtrack`],
    good: /\bost\b|soundtrack|sound track|\bbgm\b|original score|\bmusic\b/i,
    // Fan-made videos set to music ("Runescape Music Videos": machinima with random songs).
    bad: new RegExp(`${COMMON_BAD.source}|movie|motion picture|\\bfilm\\b|\\banime\\b|\\bseries\\b|playthrough|walkthrough|longplay|gameplay|let'?s play|orchestra(l)? (cover|arrangement)|music videos?|\\b[gm]?mv\\b|fan ?made|tribute|montage|mashup|machinima` +
        // Re-recordings, not the music you hear in the game ("RuneScape: The Orchestral Collection").
        `|orchestral (collection|arrangements?|versions?|edition|suite)|\\bsymphon(y|ic)\\b|\\barranged\\b|arrangements?\\b|piano collections?|\\bconcert\\b`, 'i'),
  },
  screen: {
    queries: (w) =>
      kindOf(w) === 'series'
        ? [`${w.title} soundtrack`, `${w.title} original series soundtrack`, `${w.title} OST`]
        : [`${w.title} soundtrack`, `${w.title} original motion picture soundtrack`, `${w.title} songs`],
    good: /soundtrack|\bost\b|\bscore\b|motion picture|music from|\bsongs\b|original series/i,
    bad: new RegExp(`${COMMON_BAD.source}|video ?game|gameplay|full movie|movie clip|\\bscenes?\\b|explained|\\breview\\b|tiktok|instrumental version`, 'i'),
  },
  anime: {
    queries: (a) => [`${a.title} OST`, ...(a.altTitles?.[0] ? [`${a.altTitles[0]} OST`] : []), `${a.title} original soundtrack`],
    good: /\bost\b|soundtrack|\bbgm\b|original score|\bmusic\b|サウンドトラック/i,
    bad: new RegExp(`${COMMON_BAD.source}|video ?game|gameplay|opening|ending|\\bop\\b|\\bed\\b|amv`, 'i'),
  },
};

const vocabFor = (w: CatalogGame) => {
  const k = kindOf(w);
  return k === 'film' || k === 'series' ? VOCAB.screen : k === 'anime' ? VOCAB.anime : VOCAB.game;
};

const STRONG_GOOD = /\bost\b|soundtrack|sound track|\bbgm\b|original score|\bscore\b|サウンドトラック/i;

const OFFICIAL = /- topic$|official|music channel|records|sound team|\bvevo\b|disney|pixar|netflix|hbo|sony|warner|universal|lakeshore|milan|walt disney records/i;

const FILLER = new Set(
  ('the a of and ost original soundtrack soundtracks sound track game video music full complete official score bgm ' +
    'playlist album audio hd hq remastered remaster edition collection deluxe expanded vol volume disc cd nes snes ' +
    'n64 gamecube wii switch ps1 ps2 ps3 ps4 ps5 psx xbox pc genesis gba ds 3ds all tracks with dlc by ' +
    'motion picture picture songs song from series season netflix tv television film movie anime').split(' '),
);

export interface Candidate {
  hit: PlaylistHit;
  score: number;
}

// ---- same name, different kind of work -------------------------------------------------------

const GAME_EVIDENCE =
  /\b(video ?game|game|gameplay|pc|windows|ps[1-5]|playstation|xbox|gamecube|gcn|wii|switch|n64|snes|nes|sega|genesis|mega ?drive|game ?boy|gba|gbc|nds|3ds|psp|vita|8-?bit|16-?bit|chiptune|vgm)\b/i;
// (\bfilm ?score without a closing boundary: channel names run words together, "FilmScoreBuff".)
const FILM_EVIDENCE = /\b(film|movie|motion picture|cinema|score|soundtrack from the film|the film)\b|\bfilm ?score|\bmovie ?music/i;

interface Clash {
  kinds: Set<string>;
  composers: string[]; // the other works' composers ("John Williams"): their names mean "that one"
}

function nameClash(work: CatalogGame, all: CatalogGame[]): Clash | null {
  const name = normalize(work.title);
  const kind = kindOf(work);
  const others = all.filter((g) => g.id !== work.id && kindOf(g) !== kind && normalize(g.title) === name);
  if (!others.length) return null;
  return { kinds: new Set(others.map(kindOf)), composers: others.flatMap((g) => g.composers) };
}

function clashScore(work: CatalogGame, clash: Clash, text: string): number {
  const otherComposer = clash.composers.some((c) => c && normalize(text).includes(normalize(c)));
  if (kindOf(work) === 'game') {
    if (otherComposer || FILM_EVIDENCE.test(text)) return -6;
    return GAME_EVIDENCE.test(text) ? 4 : -2; // no evidence either way: probably the better-known film
  }
  // A film/series that shares its name with a game.
  if (clash.kinds.has('game') && GAME_EVIDENCE.test(text)) return -6;
  return FILM_EVIDENCE.test(text) ? 2 : 0;
}

export async function rankPlaylistCandidates(game: CatalogGame, hits: PlaylistHit[]): Promise<Candidate[]> {
  const { matcher, games } = await loadCatalog();
  const vocab = vocabFor(game);
  const names = [game.title, ...(game.altTitles ?? [])].map((n) => ` ${normalize(n)} `).filter((n) => n.trim());
  // A game and a film with the same name ("Harry Potter and the Chamber of Secrets"): playlists
  // must show which one they are, or they're as likely the other's soundtrack.
  const clash = nameClash(game, games);
  const ownBad = [game.title, ...(game.altTitles ?? [])].some((n) => vocab.bad.test(n));
  return hits
    .map((hit) => {
      const t = ` ${normalize(hit.title)} `;
      const target = names.find((n) => t.includes(n));
      if (!target) return { hit, score: -100 };
      let score = 6;
      // Words that aren't the title or OST boilerplate suggest a different product
      // ("Saint Seiya Hades OST" when looking for "Hades").
      const before = t.slice(0, t.indexOf(target)).trim().split(' ').filter((w) => w && !FILLER.has(w));
      const afterAll = t
        .slice(t.indexOf(target) + target.length)
        .trim()
        .split(' ')
        .filter((w) => w && !FILLER.has(w));
      const after = afterAll.filter((w) => !/^\d+$/.test(w));
      score -= 2.5 * Math.min(before.length, 3) + 0.75 * Math.min(after.length, 4);
      // Nothing but the name and boilerplate ("RuneScape Music", "Celeste OST"): the whole
      // soundtrack, not one area's or one mood's slice of it ("Fremennik - RuneScape Music").
      // A leftover number other than the release year (or a "1": "Mafia 1 OST") is something
      // else ("Roblox 3008 OST").
      const sameWork = (w: string) => w === '1' || (!!game.year && Math.abs(Number(w) - game.year) <= 1);
      if (!before.length && afterAll.every(sameWork)) score += 1.5;
      // A number right after the title is another installment ("Mamma Mia 2 Soundtrack",
      // "Doom 2 OST", "… Season 2"); "1 & 2" playlists mix the sequel in.
      const next = t.slice(t.indexOf(target) + target.length).trim();
      if (/(^|\s)(1|i)( and)? (2|ii)\b/.test(next)) score -= 3;
      else if (/^(part |season |s)?([2-9]|ii|iii|iv|vi)\b/.test(next)) score -= 6;
      if (kindOf(game) === 'game') {
        const matched = matcher.match(hit.title);
        // e.g. searching "Final Fantasy VII" but the playlist is "Final Fantasy VII Remake".
        if (matched && matched.id !== game.id && normalize(matched.title).length > target.trim().length) score -= 7;
      }
      // "Moana (2026)" when looking for the 2016 Moana: a different year means a different work.
      const years = [...hit.title.matchAll(/\b(19[5-9]\d|20[0-4]\d)\b/g)].map((m) => Number(m[1]));
      if (game.year && years.length) score += years.some((y) => Math.abs(y - game.year!) <= 1) ? 1 : -6;
      if (clash) score += clashScore(game, clash, `${hit.title} ${hit.channel}`);
      // "OST" / "soundtrack" say what it is; a bare "music" ("RuneScape Music") is weaker evidence.
      if (vocab.good.test(hit.title)) score += STRONG_GOOD.test(hit.title) ? 3 : 1.5;
      // When the work's own name has a "bad" word (Castlevania: Symphony of the Night), only the
      // rest of the playlist title counts.
      if (ownBad ? vocab.bad.test(t.replace(target, ' ')) : vocab.bad.test(hit.title)) score -= 6;
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
  const seen = new Set<string>();
  const hits: PlaylistHit[] = [];
  for (const q of vocabFor(game).queries(game)) {
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

/** Finds the best music source for a catalog work and imports it. */
export async function autoAddGame(game: CatalogGame, pick?: PlaylistHit): Promise<AutoAddResult> {
  const kind = kindOf(game);
  if (!pick && kind === 'anime') return (await import('./importers/anime')).importAnime(game);

  // Works with hand-picked sources (my-games.json) skip the search entirely.
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

  return importSoundtrackPlaylist(game);
}

/** The playlist route (games, films, series, anime OSTs), with a full-OST-video fallback. */
export async function importSoundtrackPlaylist(game: CatalogGame): Promise<AutoAddResult> {
  const candidates = await findCandidates(game);
  const best = await bestPlaylistDraft(game, candidates);
  // A fan's playlist loses to the composer's own upload when there is one ("Helltaker OST
  // (Official)" by Mittsies: one video, its tracks as chapters).
  if (!best || !officialPlaylist(game, best.hit)) {
    const included = best?.draft.groups[0]?.tracks.filter((t) => t.include).length ?? 0;
    const official = await officialVideo(game, Math.ceil(included / 2));
    if (official) {
      const added = await commitDraft(official.draft);
      return { added, sourceTitle: official.video.title, sourceId: official.video.id, candidates };
    }
  }
  if (best) {
    const k = kindOf(game);
    // A platform-specific soundtrack is labelled as that version ("PC").
    if (k === 'game' && platformsIn(best.hit.title).length) best.draft.source.label = platformsIn(best.hit.title).join(' / ');
    let added = await commitDraft(best.draft);
    let sourceTitle = best.hit.title;
    if (k === 'game') {
      const versions = await importOtherVersions(game, best.hit);
      added += versions.added;
      if (versions.labels.length) sourceTitle += ` + ${versions.labels.join(', ')} versions`;
    }
    // Films often have two albums: the score and the songs ("Across the Spider-Verse (Original
    // Score)" vs "(Soundtrack from and Inspired by…)"). Take the other one too when it exists.
    if (k === 'film' || k === 'series') {
      const extra = await complementaryAlbum(game, candidates, best.hit, best.draft);
      if (extra) {
        added += await commitDraft(extra.draft);
        sourceTitle += ` + “${extra.hit.title}”`;
      }
    }
    return { added, sourceTitle, sourceId: best.hit.id, candidates };
  }

  // No decent playlist: look for a single full-OST video with a timestamped tracklist.
  const videos = await searchVideos(`${game.title} full soundtrack`);
  const target = ` ${normalize(game.title)} `;
  const bad = vocabFor(game).bad;
  for (const v of videos.slice(0, 8)) {
    if (!(v.duration && v.duration > 15 * 60)) continue;
    if (!` ${normalize(v.title)} `.includes(target) || bad.test(v.title)) continue;
    const draft = await draftFromLink({ kind: 'video', id: v.id }, game);
    if (draft.groups[0].tracks.length < 4) continue;
    const added = await commitDraft(draft);
    return { added, sourceTitle: v.title, sourceId: v.id, candidates };
  }
  throw Object.assign(new Error('No good soundtrack source found'), { candidates });
}

const isComposerChannel = (game: CatalogGame, channel: string) =>
  game.composers.some((c) => c.length > 2 && normalize(channel.replace(/\s*-\s*topic$/i, '')) === normalize(c));

/** A playlist from the publisher, a label, a composer, or a YouTube Music album. */
function officialPlaylist(game: CatalogGame, hit: PlaylistHit) {
  return OFFICIAL.test(hit.channel) || isComposerChannel(game, hit.channel) || hit.id.startsWith('OLAK5uy_') || hit.title.startsWith('Album - ');
}

/**
 * The work's official soundtrack as one video with a timestamped tracklist: named for the work,
 * marked official (title, uploader, or "official upload" in the description), at least 8
 * minutes, and at least `minTracks` chapters (so a short sampler can't replace a full playlist).
 */
async function officialVideo(game: CatalogGame, minTracks: number) {
  if (kindOf(game) === 'anime') return null; // anime songs come from AnimeThemes
  const names = [game.title, ...(game.altTitles ?? [])].map((n) => ` ${normalize(n)} `).filter((n) => n.trim());
  const videos = await searchVideos(`${game.title} OST official`);
  for (const v of videos.slice(0, 6)) {
    if (!(v.duration && v.duration >= 8 * 60)) continue;
    // Only the work's own name plus boilerplate, so not a sequel or spin-off ("Tetris Effect",
    // "The Sims 4", "Doom: The Dark Ages"), then the playlist checks (years, bad words, other
    // catalog titles) must pass as well.
    const t = ` ${normalize(v.title)} `;
    const target = names.find((n) => t.includes(n));
    if (!target) continue;
    const rest = (t.slice(0, t.indexOf(target)) + ' ' + t.slice(t.indexOf(target) + target.length)).split(' ').filter((w) => w && !FILLER.has(w));
    if (rest.some((w) => !(/^(19|20)\d\d$/.test(w) && game.year && Math.abs(Number(w) - game.year) <= 1))) continue;
    const [ranked] = await rankPlaylistCandidates(game, [{ kind: 'playlist', id: v.id, title: v.title, channel: v.channel, videoCount: 20 }]);
    if (!ranked || ranked.score < 9) continue;
    const markedOfficial = /\bofficial\b/i.test(v.title) || OFFICIAL.test(v.channel) || isComposerChannel(game, v.channel);
    const draft = await draftFromLink({ kind: 'video', id: v.id }, game);
    const tracks = draft.groups[0]?.tracks ?? [];
    if (tracks.length < Math.max(3, minTracks) || tracks.some((t) => t.start == null)) continue;
    if (!markedOfficial && !/official (upload|soundtrack|release)/i.test((await fetchVideo(v.id)).description)) continue;
    return { draft, video: v };
  }
  return null;
}

/**
 * The other album of a film/series: songs if we got the score, or the score if we got songs.
 * Songs albums are often titled after their curator ("Metro Boomin Presents Spider-Man: Across
 * the Spider-Verse"), so the usual "extra words before the title" penalty is relaxed, and the
 * album must really be mostly songs (≥ 40% vocal tracks) to count.
 */
async function complementaryAlbum(game: CatalogGame, candidates: Candidate[], main: PlaylistHit, mainDraft: ImportDraft) {
  const tracks = mainDraft.groups[0]?.tracks ?? [];
  const mainIsSongs = tracks.filter((t) => t.vocal).length / Math.max(1, tracks.length) >= 0.4;
  const SONGS = /presents|inspired by|\bsongs\b|music from|soundtrack from/i;
  const ranked = candidates
    .filter((c) => c.hit.id !== main.id && c.score >= 0 && (c.hit.videoCount ?? 0) >= 5)
    .map((c) => ({ ...c, score: c.score + (mainIsSongs ? (/\bscore\b/i.test(c.hit.title) ? 4 : 0) : SONGS.test(c.hit.title) ? 8 : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
  for (const c of ranked) {
    try {
      const draft = await draftFromLink({ kind: 'playlist', id: c.hit.id }, game);
      const t = draft.groups[0]?.tracks ?? [];
      const vocalShare = t.filter((x) => x.vocal).length / Math.max(1, t.length);
      if (mainIsSongs ? vocalShare < 0.3 : vocalShare >= 0.4) return { draft, hit: c.hit };
    } catch {
      /* try the next one */
    }
  }
  return null;
}

// Japanese kana, CJK ideographs, half-width katakana, Hangul.
const CJK = /[぀-ヿ㐀-鿿豈-﫿ｦ-ﾟ가-힯]/;

/** Share of track titles written (partly) in Japanese/Chinese/Korean script. */
export function foreignTitleRatio(titles: string[]): number {
  return titles.length ? titles.filter((t) => CJK.test(t)).length / titles.length : 0;
}

/**
 * Try the top candidates in order and return the first usable one, preferring English track
 * names: a playlist whose titles are mostly Japanese/Chinese/Korean is only used if no
 * English one passes. "Usable" = enough normal-length tracks (not mostly 30-minute loops).
 * (YouTube already returns uploader-provided English titles because we request hl=en.)
 */
async function bestPlaylistDraft(game: CatalogGame, candidates: Candidate[], exclude?: string) {
  let fallback: { draft: ImportDraft; hit: PlaylistHit } | null = null;
  for (const c of candidates.filter((c) => c.score >= 5 && c.hit.id !== exclude).slice(0, 4)) {
    const draft = await draftFromLink({ kind: 'playlist', id: c.hit.id }, game);
    const tracks = draft.groups[0]?.tracks ?? [];
    const normal = tracks.filter((t) => !t.types.includes('extended'));
    if (normal.length < 3 || normal.length < tracks.length * 0.5) continue;
    if (foreignTitleRatio(tracks.map((t) => t.title)) < 0.3) return { draft, hit: c.hit };
    fallback ??= { draft, hit: c.hit };
  }
  return fallback;
}

/**
 * For a library work whose track names are mostly non-English: look for an English source and
 * switch to it. Returns the new source title, or null when nothing better exists.
 */
export async function preferEnglishSource(game: CatalogGame): Promise<string | null> {
  const tracks = await db.tracks.where('gameId').equals(game.id).toArray();
  if (foreignTitleRatio(tracks.map((t) => t.title)) <= 0.5) return null;
  const current = tracks[0]?.sourceId;
  const candidates = await findCandidates(game);
  for (const c of candidates.filter((c) => c.score >= 5 && c.hit.id !== current).slice(0, 5)) {
    const draft = await draftFromLink({ kind: 'playlist', id: c.hit.id }, game);
    const titles = draft.groups[0]?.tracks.map((t) => t.title) ?? [];
    if (titles.length >= 3 && foreignTitleRatio(titles) < 0.3) {
      if (current) await replaceSource(game, current, c.hit);
      else await commitDraft(draft);
      return c.hit.title;
    }
  }
  return null;
}

/** Swap a work's tracks from one source for another. */
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

// ---------------------------------------------------------------------------
// Tracks found one video at a time (anime OP/EDs)

/** Save individually found videos as tracks of `work`, under one pseudo-source. */
export async function commitFoundTracks(
  work: CatalogGame,
  sourceId: string,
  sourceTitle: string,
  tracks: Omit<DraftTrack, 'include' | 'rawTitle' | 'key'>[],
): Promise<number> {
  return commitDraft({
    source: { id: sourceId, kind: 'search', title: sourceTitle, channel: '' },
    groups: [
      {
        key: work.id,
        title: work.title,
        catalogId: work.id,
        meta: work,
        tracks: tracks.map((t) => ({ ...t, key: t.start != null ? `${t.videoId}@${t.start}` : t.videoId, rawTitle: t.title, include: true })),
      },
    ],
  });
}

/**
 * Swap the video behind a track (a live version picked instead of the music video, a removed
 * upload): a new track for `videoId` in the same title that keeps the name, labels, likes and
 * play counts, replacing the old one. Returns the new track id.
 */
export async function replaceTrackVideo(track: Track, videoId: string, duration?: number | null): Promise<string> {
  if (videoId === track.videoId && track.start == null) return track.id;
  const length = duration !== undefined ? duration : (await fetchVideo(videoId).catch(() => null))?.duration ?? null;
  return db.transaction('rw', db.tracks, async () => {
    const taken = await db.tracks.get(videoId);
    const id = taken && taken.gameId !== track.gameId ? `${videoId}~${track.gameId}` : videoId;
    const { start: _start, end: _end, ...rest } = track;
    await db.tracks.put({ ...rest, id, videoId, duration: length, unavailable: false });
    if (id !== track.id) await db.tracks.delete(track.id);
    return id;
  });
}

// ---- versions: one game, different soundtracks per platform ----------------------------------

/**
 * Playlists for one platform's version of a game ("… (GBA) Soundtrack"), best first. `named`:
 * false when no playlist names that platform and these are game soundtracks that don't say which
 * version they are (the person picking knows).
 */
export async function findVersionCandidates(
  game: CatalogGame,
  platform: string,
  exclude: string[] = [],
): Promise<{ candidates: Candidate[]; named: boolean }> {
  const hits = await searchPlaylists(`${game.title} ${platform} soundtrack`);
  const vocab = vocabFor(game);
  // Strict: it must say it's music, and nothing like a walkthrough or gameplay video.
  const music = (await rankPlaylistCandidates(game, hits)).filter(
    (c) => c.score >= 5 && !exclude.includes(c.hit.id) && vocab.good.test(c.hit.title) && !vocab.bad.test(c.hit.title),
  );
  const named = music.filter((c) => platformsIn(c.hit.title).includes(platform));
  if (named.length) return { candidates: named, named: true };
  // Unlabelled ones must at least say they're from a game (not the film of the same name).
  return {
    candidates: music.filter((c) => !platformsIn(c.hit.title).length && GAME_EVIDENCE.test(`${c.hit.title} ${c.hit.channel}`)),
    named: false,
  };
}

/** Add a playlist as another version of a game (kept next to the existing tracks, not replacing them). */
export async function importVersion(game: CatalogGame, hit: PlaylistHit, label?: string): Promise<number> {
  const draft = await draftFromLink({ kind: 'playlist', id: hit.id }, game);
  draft.source.label = label ?? (platformsIn(hit.title).join(' / ') || undefined);
  return commitDraft(draft);
}

/**
 * The soundtrack just imported names a platform ("(PC) - OST"): the game's other platforms may
 * have had different music (Harry Potter on PC vs GameCube vs GBA), so import those too, each as
 * its own labelled version. At most three more.
 */
async function importOtherVersions(game: CatalogGame, first: PlaylistHit): Promise<{ added: number; labels: string[] }> {
  const covered = new Set(platformsIn(first.title));
  const used = [first.id];
  const out = { added: 0, labels: [] as string[] };
  if (!covered.size) return out;
  for (const platform of gamePlatforms(game.tags?.platform)) {
    if (covered.has(platform) || out.labels.length >= 3) continue;
    // Automatically only playlists that name the platform; unlabelled ones need a person.
    const found = await findVersionCandidates(game, platform, used).catch(() => ({ candidates: [], named: false }));
    const best = found.named ? await bestPlaylistDraft(game, found.candidates) : null;
    if (!best) continue;
    best.draft.source.label = platformsIn(best.hit.title).join(' / ');
    out.added += await commitDraft(best.draft);
    out.labels.push(best.draft.source.label);
    used.push(best.hit.id);
    for (const p of platformsIn(best.hit.title)) covered.add(p);
  }
  return out;
}
