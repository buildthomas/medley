import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv, type Plugin, type Connect } from 'vite';
import { buildCatalog } from '../scripts/catalog-builder.mjs';
import { enrichGames } from '../scripts/enrich.mjs';
import type { CatalogGame } from '../src/types.ts';
import { steamOwnedGames } from './steam.ts';
import { search, getPlaylist, getVideo } from './youtube.ts';

let steamKey: string | undefined;
// Runtime data (gitignored): monthly-refreshed catalog, caches.
let dataDir = 'data';
// Personal config (gitignored): config/my-games.json. See config/my-games.example.json.
let configDir = 'config';

const log = (msg: string) => console.log(`[catalog] ${msg}`);

// Monthly refresh: rebuild catalog + collections into data/ (outside src/, so it
// doesn't trigger a hot reload). The client prefers these files over the bundled ones.
let refreshing: Promise<{ generatedAt: string; games: number }> | null = null;

function refreshCatalog() {
  refreshing ??= buildCatalog({ log, cacheFile: join(dataDir, 'cache', 'steamspy-tags.json') })
    .then(async ({ catalog, collections }) => {
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(join(dataDir, 'catalog.json'), JSON.stringify(catalog));
      writeFileSync(join(dataDir, 'collections.json'), JSON.stringify(collections));
      await refreshMyGames();
      return { generatedAt: collections.generatedAt, games: catalog.length };
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
      case '/api/data/catalog':
      case '/api/data/collections': {
        const file = join(dataDir, url.pathname.endsWith('catalog') ? 'catalog.json' : 'collections.json');
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
