import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv, type Plugin, type Connect } from 'vite';
import { buildAll, DATA_FILES, keepMissingGroups } from '../scripts/build-all.mjs';
import { enrichGames } from '../scripts/enrich.mjs';
import type { CatalogGame } from '../src/types.ts';
import { searchArtists } from './artists.ts';
import { steamOwnedGames } from './steam.ts';
import { search, getPlaylist, getVideo } from './youtube.ts';

let steamKey: string | undefined;
// Runtime data (gitignored): weekly-refreshed catalogs, caches.
let dataDir = 'data';
// Personal config (gitignored): config/my-games.json. See config/my-games.example.json.
let configDir = 'config';

const log = (msg: string) => console.log(`[catalog] ${msg}`);

// Weekly refresh: rebuild every catalog into data/ (outside src/, so it doesn't trigger a hot
// reload). The client prefers these files over the bundled ones when they're newer.
let refreshing: Promise<{ generatedAt: string; files: string[] }> | null = null;

function refreshCatalog() {
  refreshing ??= buildAll({ log, cacheFile: join(dataDir, 'cache', 'steamspy-tags.json') })
    .then(async (files: Record<string, unknown>) => {
      mkdirSync(dataDir, { recursive: true });
      // A domain whose build failed is missing here: its previous file stays in place (the
      // client falls back to the bundled one), and its collection groups are carried over.
      const prev = [join(dataDir, 'collections.json'), 'src/data/collections.json'].find((f) => existsSync(f));
      keepMissingGroups(files, prev ? JSON.parse(readFileSync(prev, 'utf8')) : null);
      for (const [name, contents] of Object.entries(files)) writeFileSync(join(dataDir, `${name}.json`), JSON.stringify(contents));
      await refreshMyGames();
      return { generatedAt: (files.collections as { generatedAt: string }).generatedAt, files: Object.keys(files) };
    })
    .finally(() => (refreshing = null));
  return refreshing;
}

function readMyGamesConfig(): CatalogGame[] {
  const file = join(configDir, 'my-games.json');
  if (!existsSync(file)) return [];
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('config/my-games.json must be a JSON array');
  return raw.map((g) => ({ pop: 0, genres: [], composers: [], year: null, series: null, ...g }));
}

/** Re-fetch things that expire (Roblox icon URLs) for your own games into data/my-games.json. */
async function refreshMyGames() {
  const games = readMyGamesConfig();
  if (!games.length) return;
  await enrichGames(games, { log });
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, 'my-games.json'), JSON.stringify(games));
}

/** Your games as configured, with refreshed covers when a refresh has run. */
function myGames(): CatalogGame[] {
  const games = readMyGamesConfig();
  const enrichedFile = join(dataDir, 'my-games.json');
  if (!existsSync(enrichedFile)) return games;
  const enriched = new Map<string, CatalogGame>(
    JSON.parse(readFileSync(enrichedFile, 'utf8')).map((g: CatalogGame) => [g.id, g]),
  );
  return games.map((g) => ({ ...g, covers: enriched.get(g.id)?.covers ?? g.covers }));
}

// Small TTL cache so re-opening the same playlist/search is instant.

const cache = new Map<string, { at: number; value: Promise<unknown> }>();
const TTL = 30 * 60 * 1000;

function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value as Promise<T>;
  const value = fn();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  return value;
}

const handler: Connect.NextHandleFunction = async (req, res, next) => {
  if (!req.url?.startsWith('/api/')) return next();
  const url = new URL(req.url, 'http://localhost');
  const q = (name: string) => url.searchParams.get(name)?.trim() ?? '';
  try {
    let data: unknown;
    switch (url.pathname) {
      case '/api/search': {
        const type = q('type') === 'video' ? 'video' : 'playlist';
        if (!q('q')) throw new Error('Missing q');
        data = await cached(`s:${type}:${q('q').toLowerCase()}`, () => search(q('q'), type));
        break;
      }
      case '/api/playlist':
        data = await cached(`p:${q('id')}`, () => getPlaylist(q('id')));
        break;
      case '/api/video':
        data = await cached(`v:${q('id')}`, () => getVideo(q('id')));
        break;
      case '/api/steam/owned':
        data = await steamOwnedGames(q('profile'), steamKey);
        break;
      case '/api/artists/search':
        data = await cached(`a:${q('q').toLowerCase()}`, () => searchArtists(q('q')));
        break;
      case '/api/data': {
        const name = q('name');
        if (!DATA_FILES.includes(name)) throw new Error('Unknown data file');
        const file = join(dataDir, `${name}.json`);
        if (!existsSync(file)) {
          res.statusCode = 404;
          data = { error: 'No refreshed data yet' };
          break;
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(readFileSync(file));
        return;
      }
      case '/api/my-games':
        data = myGames();
        break;
      case '/api/refresh':
        if (req.method !== 'POST') throw new Error('Use POST');
        data = await refreshCatalog();
        break;
      default:
        res.statusCode = 404;
        data = { error: 'Unknown endpoint' };
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  } catch (e) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
  }
};

/** Serves /api/* (YouTube metadata) from both `vite` and `vite preview`. */
export function youtubeApi(): Plugin {
  return {
    name: 'youtube-api',
    configResolved(config) {
      dataDir = join(config.root, 'data');
      configDir = join(config.root, 'config');
      steamKey = loadEnv(config.mode, config.root, '').STEAM_API_KEY || process.env.STEAM_API_KEY;
    },
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
