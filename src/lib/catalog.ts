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
  /** game | screen | anime (absent = game) */
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
    // 204: the server has no refreshed copy (yet); use the bundled one.
    return res.ok && res.status !== 204 ? ((await res.json()) as T) : null;
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

/** The catalog files, one per domain (see scripts/build-all.mjs). */
const DOMAIN_FILES = {
  catalog: () => import('../data/catalog.json'),
  screen: () => import('../data/screen.json'),
  anime: () => import('../data/anime.json'),
} as const;

/**
 * Catalogs for every domain + collections. Prefers the weekly-refreshed copies from the local
 * server (its data dir) when they're newer than the bundled ones. Your own games come from the
 * server too (my-games.json in its config dir, outside the repo), so edits apply on reload.
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
                description: 'Your own games, with hand-picked soundtrack sources (my-games.json in Medley’s config folder).',
                lists: [{ id: 'mine-all', title: 'All', ids: myGames.map((g) => g.id) }],
              },
            ]
          : []),
        ...baseCollections.groups.filter((g) => g.id !== 'mine'),
      ],
    };
    // Title matching (guessing which game a video belongs to) only makes sense for games:
    // films like "Up" would match all sorts of video titles.
    const matcher = createCatalogMatcher(games.filter((g) => !g.kind || g.kind === 'game'));
    return { games, byId: new Map(games.map((g) => [g.id, g])), matcher, collections };
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
/**
 * Wikidata's "part of the series" for films is often a list, not a series ("list of Pixar films",
 * "Walt Disney Animation Studios feature film", "BBC's 100 Greatest Films…"). Those aren't
 * franchises. (scripts/screen-builder.mjs drops them too; this covers older catalogs.)
 */
export const NOT_A_SERIES = /^list of |\bfeature films?$|\bproductions$|\b(greatest|best)\b.*\bfilms?\b|\btop \d+\b/i;

export function franchiseOf(game: CatalogGame): string | null {
  const ok = (name: string | null | undefined) => (name && !NOT_A_SERIES.test(name) ? name : null);
  return ok(game.franchise) ?? ok(game.series);
}
