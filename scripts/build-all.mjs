// Builds every catalog: games, films & series, anime, artists, plus the combined collections.
// Used by `npm run catalog` (writes src/data/) and the weekly in-app refresh (writes data/).
//
// Each domain is built independently; if one source is down, the others still refresh and the
// failed domain keeps its previous file (the caller only writes what came back).

import { buildAnime } from './anime-builder.mjs';
import { buildArtists } from './artist-builder.mjs';
import { buildCatalog } from './catalog-builder.mjs';
import { buildScreen } from './screen-builder.mjs';

export const DATA_FILES = ['catalog', 'screen', 'anime', 'artists', 'collections'];
const FILE_OF_DOMAIN = { game: 'catalog', screen: 'screen', anime: 'anime', artist: 'artists' };

/**
 * Adds the previous collection groups of every domain that wasn't rebuilt (skipped or failed)
 * to `files.collections`, so a partial or failed build never drops a domain's shelves.
 * @param {Record<string, any>} files result of buildAll
 * @param {{ groups: { domain?: string }[] } | null} prev the collections file being replaced
 */
export function keepMissingGroups(files, prev) {
  if (!prev) return files;
  const kept = prev.groups.filter((g) => !(FILE_OF_DOMAIN[g.domain ?? 'game'] in files));
  files.collections.groups = [...kept, ...files.collections.groups];
  return files;
}

/**
 * @param {{ log?: (m: string) => void, cacheFile?: string, only?: string[] }} opts
 * @returns {Promise<Record<string, unknown>>} file name (without .json) → contents
 */
export async function buildAll({ log = console.log, cacheFile, only } = {}) {
  const want = (d) => !only || only.includes(d);
  const out = {};
  const groups = [];
  const step = async (name, fn) => {
    if (!want(name)) return null;
    const t = Date.now();
    try {
      const r = await fn();
      log(`✓ ${name} (${Math.round((Date.now() - t) / 1000)}s)`);
      return r;
    } catch (e) {
      log(`✗ ${name} failed: ${e.message}. Keeping the previous ${name} data.`);
      return null;
    }
  };

  const games = await step('games', () => buildCatalog({ log, cacheFile }));
  if (games) {
    out.catalog = games.catalog;
    groups.push(...games.collections.groups.map((g) => ({ ...g, domain: 'game' })));
  }
  const screen = await step('screen', () => buildScreen({ log }));
  if (screen) {
    out.screen = screen.items;
    groups.push(...screen.groups);
  }
  const anime = await step('anime', () => buildAnime({ log }));
  if (anime) {
    out.anime = anime.items;
    groups.push(...anime.groups);
  }
  const artists = await step('artists', () => buildArtists({ log }));
  if (artists) {
    out.artists = artists.items;
    groups.push(...artists.groups);
  }
  out.collections = { generatedAt: new Date().toISOString(), groups };
  return out;
}
