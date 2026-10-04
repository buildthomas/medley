import type { CatalogGame } from '../src/types';

export interface Collections {
  generatedAt: string;
  groups: { id: string; title: string; description: string; lists: { id: string; title: string; ids: string[] }[] }[];
}

export function buildCatalog(opts?: {
  log?: (msg: string) => void;
  enrich?: boolean;
  cacheFile?: string;
}): Promise<{ catalog: CatalogGame[]; collections: Collections }>;
