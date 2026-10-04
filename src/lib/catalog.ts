import { useEffect, useState } from 'react';
import type { CatalogGame } from '../types';
import { apiUrl } from './api';
import { createCatalogMatcher, normalize } from './parse';

export interface CollectionList {
  id: string;
  title: string;
  ids: string[];
}
export interface CollectionGroup {
  id: string;
  /** game | screen | anime | artist (absent = game) */
  domain?: string;
  title: string;
  description: string;
  lists: CollectionList[];
}
export interface Collections {
  generatedAt: string;
  groups: CollectionGroup[];
}

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(apiUrl(path));
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

interface Loaded {
  games: CatalogGame[];
  /** Normalised names of all known artists, for telling "Artist - Song" from "Song - Artist". */
  artistNames: Set<string>;
  byId: Map<string, CatalogGame>;
  matcher: ReturnType<typeof createCatalogMatcher>;
  collections: Collections;
}

let loading: Promise<Loaded> | null = null;

/** The catalog files, one per domain (see scripts/build-all.mjs). */
const DOMAIN_FILES = {
  catalog: () => import('../data/catalog.json'),
  screen: () => import('../data/screen.json'),
  anime: () => import('../data/anime.json'),
  artists: () => import('../data/artists.json'),
} as const;

/**
 * Catalogs for every domain + collections. Prefers the weekly-refreshed copies from the local
 * server (data/*.json) when they're newer than the bundled ones. Your own games come from the
 * server too (config/my-games.json, personal and gitignored), so edits apply on reload.
 */
export function loadCatalog(): Promise<Loaded> {
  loading ??= (async () => {
    const names = Object.keys(DOMAIN_FILES) as (keyof typeof DOMAIN_FILES)[];
    const [bundledCollections, freshCollections, myGamesRaw, ...domains] = await Promise.all([
      import('../data/collections.json').then((m) => m.default as Collections),
      fetchJson<Collections>('/api/data?name=collections'),
      fetchJson<CatalogGame[]>('/api/my-games'),
      ...names.map(async (n) => ({
        bundled: (await DOMAIN_FILES[n]()).default as CatalogGame[],
        fresh: await fetchJson<CatalogGame[]>(`/api/data?name=${n}`),
      })),
    ]);
    const myGames = myGamesRaw ?? [];
    const useFresh = !!(freshCollections && freshCollections.generatedAt > bundledCollections.generatedAt);
    // A domain whose refresh failed has no fresh file; fall back to the bundled one for it.
    const base = domains.flatMap((d) => (useFresh && d.fresh ? d.fresh : d.bundled));
    const baseCollections = useFresh ? freshCollections! : bundledCollections;

    const mine = new Set(myGames.map((g) => g.id));
    const games = [...myGames, ...base.filter((g) => !mine.has(g.id))];
    const collections: Collections = {
      generatedAt: baseCollections.generatedAt,
      groups: [
        ...(myGames.length
          ? [
              {
                id: 'mine',
                title: 'My games',
                description: 'Your own games, with hand-picked soundtrack sources (config/my-games.json).',
                lists: [{ id: 'mine-all', title: 'All', ids: myGames.map((g) => g.id) }],
              },
            ]
          : []),
        ...baseCollections.groups.filter((g) => g.id !== 'mine'),
      ],
    };
    // Title matching (guessing which game a video belongs to) only makes sense for games:
    // films like "Up" or artists like "Queen" would match all sorts of video titles.
    const matcher = createCatalogMatcher(games.filter((g) => !g.kind || g.kind === 'game'));
    const artistNames = new Set(games.filter((g) => g.kind === 'artist').map((g) => normalize(g.title)));
    return { games, byId: new Map(games.map((g) => [g.id, g])), matcher, collections, artistNames };
  })();
  return loading;
}

/** Forget the cached catalog so the next loadCatalog() picks up refreshed data. */
export function reloadCatalog() {
  loading = null;
  return loadCatalog().then((l) => {
    publish(l);
    return l;
  });
}

// --- React access ----------------------------------------------------------------

let loaded: Loaded | null = null;
const subscribers = new Set<(l: Loaded) => void>();

/** The catalog once loaded (null while loading). Re-renders after a monthly refresh. */
export function useCatalog(): Loaded | null {
  const [state, setState] = useState<Loaded | null>(loaded);
  useEffect(() => {
    subscribers.add(setState);
    if (!loaded) loadCatalog().then(publish);
    return () => {
      subscribers.delete(setState);
    };
  }, []);
  return state;
}

function publish(l: Loaded) {
  loaded = l;
  subscribers.forEach((s) => s(l));
}

/** The best link to get a game: a store first, Wikipedia last. */
export function primaryLink(game: CatalogGame | undefined) {
  if (!game?.links?.length) return null;
  return game.links.find((l) => l.label !== 'Wikipedia') ?? game.links[0];
}

/** Not out yet: a future release date, or a future year without a date. */
export function isUpcoming(game: Pick<CatalogGame, 'date' | 'year'>, now = new Date()): boolean {
  if (game.date) return game.date > now.toISOString().slice(0, 10);
  return game.year != null && game.year > now.getFullYear();
}

/** Franchise if known, else series: the grouping used for "Series & franchises". */
export function franchiseOf(game: CatalogGame): string | null {
  return game.franchise ?? game.series ?? null;
}
