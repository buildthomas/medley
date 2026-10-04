export interface CatalogGame {
  id: string; // Wikidata QID
  title: string;
  year: number | null;
  genres: string[];
  series: string | null;
  composers: string[];
  pop: number; // Wikipedia language editions — a rough popularity signal
  steam?: number; // Steam app id
  sources?: string[]; // fixed YouTube links (own games); skips the YouTube search
  franchise?: string;
  tags?: GameTags;
  keywords?: string[]; // Steam user tags
  covers?: string[]; // portrait cover candidates, best first
  links?: { label: string; url: string }[]; // where to get the game
  roblox?: { universeId: number; placeId: number };
}

export interface GameTags {
  platform?: string[];
  genre?: string[];
  mode?: string[];
  theme?: string[];
  developer?: string[];
  publisher?: string[];
}

export interface Game {
  id: string; // Wikidata QID when matched to the catalog, otherwise "u:<slug>"
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

export interface Track {
  id: string; // videoId, or videoId@start for a slice of a long video
  gameId: string;
  videoId: string;
  title: string;
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
  kind: 'playlist' | 'video';
  title: string;
  channel: string;
  gameIds: string[];
  importedAt: number;
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
  variety: number; // 0..1 — how long a game must rest after playing
  familiarity: number; // 0..1 — 0 = discovery, 1 = favourites
}
