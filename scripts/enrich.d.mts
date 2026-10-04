import type { CatalogGame } from '../src/types';

export function enrichGames<T extends CatalogGame>(
  games: T[],
  opts?: { log?: (msg: string) => void; cacheFile?: string },
): Promise<T[]>;
