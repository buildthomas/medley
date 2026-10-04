// Naming note: "game" is historical. A CatalogGame / Game is any *work* whose music we play:
// a video game, film, TV series, anime, or a music artist. `kind` says which (absent = game).

export type WorkKind = 'game' | 'film' | 'series' | 'anime' | 'artist';

export interface CatalogGame {
  id: string; // Wikidata QID (games, films, series, artists), "al:<AniList id>" (anime), or "u:<slug>" (personal/custom)
  kind?: WorkKind;
  title: string;
  altTitles?: string[]; // e.g. an anime's romaji title; used for search and YouTube matching
  year: number | null;
  date?: string; // first release YYYY-MM-DD when known (day precision); drives "unreleased"
  genres: string[]; // broad buckets
  series: string | null;
  composers: string[]; // score composers (games/screen); for artists: unused
  pop: number; // popularity signal: Wikipedia language editions, or AniList popularity / 1000
  steam?: number; // Steam app id
  sources?: string[]; // fixed YouTube links (own games); skips the YouTube search
  franchise?: string;
  tags?: GameTags;
  keywords?: string[]; // Steam user tags / AniList tags
  covers?: string[]; // portrait cover candidates, best first
  links?: { label: string; url: string }[]; // where to get / watch / listen
  roblox?: { universeId: number; placeId: number };
  /** Anime: opening/ending/insert songs (AnimeThemes). */
  themes?: AnimeTheme[];
  /** Artists: where they're from and when they started. */
  artist?: { country?: string; since?: number; type?: 'person' | 'group' };
  /** Artists: their official YouTube channel id (helps recognise their uploads). */
  ytChannel?: string;
}

export interface AnimeTheme {
  type: 'OP' | 'ED' | 'IN';
  seq: number | null; // OP1 → 1
  song: string;
  artists: string[];
  episodes?: string;
}

/** Facet tags. Keys vary by kind (platform for games, studio/network for screen, …). */
export interface GameTags {
  platform?: string[];
  genre?: string[];
  mode?: string[];
  theme?: string[];
  developer?: string[];
  publisher?: string[];
  studio?: string[]; // film/anime studios
  network?: string[]; // TV networks / streaming services
  format?: string[]; // TV, Movie, ONA…
  country?: string[];
}

export interface Game {
  id: string; // = catalog id
  kind?: WorkKind;
  title: string;
  year: number | null;
  genres: string[];
  series: string | null;
  composers: string[];
  franchise?: string | null;
  platforms?: string[];
  keywords?: string[];
  enabled: boolean;
  addedAt: number;
}

/** What a track is, beyond its genre-ish `types` (anime/screen songs). */
export type TrackRole = 'op' | 'ed' | 'insert' | 'score' | 'song';

export interface Track {
  id: string; // videoId, or videoId@start for a slice of a long video
  gameId: string;
  videoId: string;
  title: string;
  /** Set when you renamed it in Library, so source syncs don't overwrite your name. */
  customTitle?: boolean;
  artist?: string; // performer, when known (songs, OPs/EDs, artist tracks)
  role?: TrackRole;
  seq?: number | null; // OP/ED number
  /** Has singing. Undefined = unknown (treated as instrumental for game tracks, see isVocal). */
  vocal?: boolean;
  start?: number;
  end?: number;
  duration: number | null;
  types: string[];
  sourceId: string;
  liked: boolean;
  banned: boolean;
  unavailable: boolean;
  playCount: number;
  skipCount: number;
  lastPlayedAt: number | null;
}

export interface Source {
  id: string; // playlist or video id
  /** search = tracks found one video at a time (anime OP/EDs, an artist's songs) */
  kind: 'playlist' | 'video' | 'search';
  title: string;
  channel: string;
  gameIds: string[];
  importedAt: number;
  syncedAt?: number; // last time the playlist was re-checked for added/removed/renamed videos
}

export interface Play {
  id?: number;
  trackId: string;
  gameId: string;
  at: number;
  skipped: boolean;
}

/** Tri-state chip filter: absent = neutral, 'in' = require, 'out' = exclude. */
export type ChipState = Record<string, 'in' | 'out'>;

export interface Filters {
  genres: ChipState;
  types: ChipState;
  decades: ChipState;
  franchises?: ChipState;
  platforms?: ChipState;
  keywords?: ChipState;
  kinds?: ChipState; // Games / Film / Series / Anime / Artists
  roles?: ChipState; // OP / ED / Insert / Score / Song
  voice?: ChipState; // vocal / instrumental
  lengths?: ChipState; // jingle / short / standard / long
  variety: number; // 0..1: 0 = several tracks from the same work in a row, 1 = always something new
  familiarity: number; // 0..1: 0 = discovery, 1 = favourites
}
