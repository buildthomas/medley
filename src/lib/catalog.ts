import { useEffect, useState } from 'react';
import type { CatalogGame } from '../types';
import { apiUrl } from './api';
import { createCatalogMatcher } from './parse';

export interface CollectionList {
  id: string;
  title: string;
  ids: string[];
}
export interface CollectionGroup {
  id: string;
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
  byId: Map<string, CatalogGame>;
  matcher: ReturnType<typeof createCatalogMatcher>;
  collections: Collections;
}

let loading: Promise<Loaded> | null = null;

/**
 * Catalog + collections. Prefers the monthly-refreshed copy from the local server
 * (data/*.json) when it's newer than the bundled one. Your own games come from the
 * server too (config/my-games.json, personal and gitignored), so edits apply on reload.
 */
export function loadCatalog(): Promise<Loaded> {
  loading ??= (async () => {
    const [bundledGames, bundledCollections, freshGames, freshCollections, myGamesRaw] = await Promise.all([
      import('../data/catalog.json').then((m) => m.default as CatalogGame[]),
      import('../data/collections.json').then((m) => m.default as Collections),
      fetchJson<CatalogGame[]>('/api/data/catalog'),
      fetchJson<Collections>('/api/data/collections'),
      fetchJson<CatalogGame[]>('/api/my-games'),
    ]);
    const myGames = myGamesRaw ?? [];
    const useFresh = !!(freshGames && freshCollections && freshCollections.generatedAt > bundledCollections.generatedAt);
    const base = useFresh ? freshGames! : bundledGames;
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
    return { games, byId: new Map(games.map((g) => [g.id, g])), matcher: createCatalogMatcher(games), collections };
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

/** Franchise if known, else series: the grouping used for "Series & franchises". */
export function franchiseOf(game: CatalogGame): string | null {
  return game.franchise ?? game.series ?? null;
}
