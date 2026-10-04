// The /api/* endpoints, shared by the dev server (server/plugin.ts, inside Vite) and the
// production server (server/serve.ts). Plain node:http types; no Vite at runtime.
//
//   GET  /api/search?type=playlist|video&q=   YouTube search (keyless scraping, server/youtube.ts)
//   GET  /api/playlist?id=  /api/video?id=    YouTube playlist / video details
//   GET  /api/artists/search?q=               MusicBrainz artist search
//   GET  /api/steam/owned?profile=            Steam library (needs STEAM_API_KEY)
//   GET  /api/data?name=                      refreshed catalog file from the data dir
//   GET  /api/my-games                        personal games (config dir)
//   GET  /api/refresh                         catalog refresh status
//   POST /api/refresh[?force=1]               start a refresh if the catalogs are a week old
//   /api/remote/*                             relay between the app and the desktop companion

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { buildAll, DATA_FILES, keepMissingGroups } from '../scripts/build-all.mjs';
import { enrichGames } from '../scripts/enrich.mjs';
import { ROOT } from '../scripts/paths.mjs';
import type { CatalogGame } from '../src/types.ts';
import { searchArtists } from './artists.ts';
import { createRemote } from './remote.ts';
import { steamOwnedGames } from './steam.ts';
import { getPlaylist, getVideo, search } from './youtube.ts';

export type Next = (err?: unknown) => void;
export type Handler = (req: IncomingMessage, res: ServerResponse, next: Next) => void;

export interface ApiOptions {
  dataDir: string;
  configDir: string;
  steamKey?: string;
  /** Bearer token that may force a refresh from anywhere (MEDLEY_ADMIN_TOKEN). */
  adminToken?: string;
  /** Per-IP request limit for the YouTube/MusicBrainz endpoints (production). */
  rateLimit?: number;
  log?: (msg: string) => void;
}

const DAY = 24 * 60 * 60 * 1000;
/** Catalogs younger than this aren't rebuilt (a bit under a week, so a weekly schedule never skips). */
const REFRESH_AFTER = 6.5 * DAY;

export interface RefreshStatus {
  state: 'idle' | 'running' | 'error';
  /** When the catalogs in use were built (refreshed copy, else the bundled one). */
  generatedAt: string | null;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  /** Last lines of the build log, for the UI. */
  log: string[];
}

export function createApi(opts: ApiOptions) {
  const { dataDir, configDir } = opts;
  const say = opts.log ?? ((m: string) => console.log(`[medley] ${m}`));

  // ---- catalog refresh ---------------------------------------------------------------------
  const status: RefreshStatus = { state: 'idle', generatedAt: null, log: [] };
  const readGeneratedAt = (file: string): string | null => {
    try {
      return JSON.parse(readFileSync(file, 'utf8')).generatedAt ?? null;
    } catch {
      return null;
    }
  };
  const catalogAge = () => {
    const stamps = [readGeneratedAt(join(dataDir, 'collections.json')), readGeneratedAt(join(ROOT, 'src/data/collections.json'))];
    const newest = stamps.filter(Boolean).sort().pop() ?? null;
    status.generatedAt = newest;
    return newest ? Date.now() - Date.parse(newest) : Infinity;
  };
  catalogAge();

  function startRefresh() {
    if (status.state === 'running') return;
    Object.assign(status, { state: 'running', startedAt: Date.now(), finishedAt: undefined, error: undefined, log: [] });
    const log = (m: string) => {
      say(`[catalog] ${m}`);
      status.log = [...status.log.slice(-40), m];
    };
    buildAll({ log, cacheFile: join(dataDir, 'cache', 'steamspy-tags.json') })
      .then(async (files: Record<string, unknown>) => {
        mkdirSync(dataDir, { recursive: true });
        // A domain whose build failed is missing here: its previous file stays in place (the
        // client falls back to the bundled one), and its collection groups are carried over.
        const prev = [join(dataDir, 'collections.json'), join(ROOT, 'src/data/collections.json')].find((f) => existsSync(f));
        keepMissingGroups(files, prev ? JSON.parse(readFileSync(prev, 'utf8')) : null);
        for (const [name, contents] of Object.entries(files)) writeFileSync(join(dataDir, `${name}.json`), JSON.stringify(contents));
        await refreshMyGames();
        catalogAge();
        Object.assign(status, { state: 'idle', finishedAt: Date.now() });
      })
      .catch((e: Error) => Object.assign(status, { state: 'error', error: e.message, finishedAt: Date.now() }));
  }

  /** Rebuild when the catalogs are about a week old; `force` only for trusted callers. */
  function maybeRefresh(force = false) {
    if (status.state !== 'running' && (force || catalogAge() > REFRESH_AFTER)) startRefresh();
    return status;
  }

  /** Production: the server keeps its own catalogs fresh, whether or not anyone visits. */
  function startScheduler() {
    const tick = () => {
      // Back off for a day after a failed attempt.
      if (status.state === 'error' && Date.now() - (status.finishedAt ?? 0) < DAY) return;
      maybeRefresh();
    };
    setTimeout(tick, 60_000);
    setInterval(tick, 60 * 60 * 1000).unref();
  }

  const trusted = (req: IncomingMessage) => {
    const ip = req.socket.remoteAddress ?? '';
    if (/^(::1|127\.|::ffff:127\.)/.test(ip) && !req.headers['x-forwarded-for']) return true;
    return !!opts.adminToken && req.headers.authorization === `Bearer ${opts.adminToken}`;
  };

  // ---- personal games ------------------------------------------------------------------------
  function readMyGamesConfig(): CatalogGame[] {
    const file = join(configDir, 'my-games.json');
    if (!existsSync(file)) return [];
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(raw)) throw new Error(`${file} must be a JSON array`);
    return raw.map((g) => ({ pop: 0, genres: [], composers: [], year: null, series: null, ...g }));
  }

  /** Re-fetch things that expire (Roblox icon URLs) for your own games into the data dir. */
  async function refreshMyGames() {
    const games = readMyGamesConfig();
    if (!games.length) return;
    await enrichGames(games, { log: say });
    writeFileSync(join(dataDir, 'my-games.json'), JSON.stringify(games));
  }

  /** Your games as configured, with refreshed covers when a refresh has run. */
  function myGames(): CatalogGame[] {
    const games = readMyGamesConfig();
    const enrichedFile = join(dataDir, 'my-games.json');
    if (!existsSync(enrichedFile)) return games;
    const enriched = new Map<string, CatalogGame>(JSON.parse(readFileSync(enrichedFile, 'utf8')).map((g: CatalogGame) => [g.id, g]));
    return games.map((g) => ({ ...g, covers: enriched.get(g.id)?.covers ?? g.covers }));
  }

  // ---- small TTL cache so re-opening the same playlist/search is instant -------------------
  const cache = new Map<string, { at: number; value: Promise<unknown> }>();
  const TTL = 30 * 60 * 1000;
  function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit.value as Promise<T>;
    if (cache.size > 5000) for (const [k, v] of cache) if (Date.now() - v.at >= TTL) cache.delete(k);
    const value = fn();
    cache.set(key, { at: Date.now(), value });
    value.catch(() => cache.delete(key));
    return value;
  }

  // ---- per-IP rate limit (fixed one-minute windows) ------------------------------------------
  const hits = new Map<string, { window: number; n: number }>();
  function limited(req: IncomingMessage) {
    if (!opts.rateLimit) return false;
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
    const window = Math.floor(Date.now() / 60_000);
    const h = hits.get(ip);
    if (!h || h.window !== window) {
      if (hits.size > 10_000) hits.clear();
      hits.set(ip, { window, n: 1 });
      return false;
    }
    return ++h.n > opts.rateLimit;
  }

  const remote = createRemote();

  const handle: Handler = async (req, res, next) => {
    if (!req.url?.startsWith('/api/')) return next();
    const url = new URL(req.url, 'http://localhost');
    const q = (name: string) => url.searchParams.get(name)?.trim() ?? '';
    const send = (code: number, data: unknown) => {
      res.statusCode = code;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(data));
    };
    if (url.pathname.startsWith('/api/remote/')) return remote.handle(req, res, url);
    try {
      switch (url.pathname) {
        case '/api/search':
        case '/api/playlist':
        case '/api/video':
        case '/api/artists/search':
          if (limited(req)) return send(429, { error: 'Too many requests; slow down a little.' });
      }
      switch (url.pathname) {
        case '/api/search': {
          const type = q('type') === 'video' ? 'video' : 'playlist';
          if (!q('q')) throw new Error('Missing q');
          return send(200, await cached(`s:${type}:${q('q').toLowerCase()}`, () => search(q('q'), type)));
        }
        case '/api/playlist':
          return send(200, await cached(`p:${q('id')}`, () => getPlaylist(q('id'))));
        case '/api/video':
          return send(200, await cached(`v:${q('id')}`, () => getVideo(q('id'))));
        case '/api/steam/owned':
          return send(200, await steamOwnedGames(q('profile'), opts.steamKey));
        case '/api/artists/search':
          return send(200, await cached(`a:${q('q').toLowerCase()}`, () => searchArtists(q('q'))));
        case '/api/data': {
          const name = q('name');
          if (!DATA_FILES.includes(name)) throw new Error('Unknown data file');
          const file = join(dataDir, `${name}.json`);
          if (!existsSync(file)) return send(404, { error: 'No refreshed data yet' });
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(readFileSync(file));
          return;
        }
        case '/api/my-games':
          return send(200, myGames());
        case '/api/refresh':
          if (req.method === 'POST') return send(202, maybeRefresh(q('force') === '1' && trusted(req)));
          catalogAge();
          return send(200, status);
        default:
          return send(404, { error: 'Unknown endpoint' });
      }
    } catch (e) {
      send(502, { error: e instanceof Error ? e.message : String(e) });
    }
  };

  return { handle, startScheduler, refreshStatus: () => status };
}
