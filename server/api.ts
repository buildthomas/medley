// The /api/* endpoints, shared by the dev server (server/plugin.ts, inside Vite) and the
// production server (server/serve.ts). Plain node:http types; no Vite at runtime.
//
//   GET    /api/session                         { required, user }: is sign-in needed (server/auth.ts)
//   POST   /api/session { code } · DELETE        sign in / out (hosted, invite-only)
//   GET    /api/search?type=playlist|video&q=   YouTube search (keyless scraping, server/youtube.ts)
//   GET    /api/playlist?id=  /api/video?id=    YouTube playlist / video details
//   GET    /api/data?name=                      refreshed catalog file from the data dir
//   GET    /api/my-games                        personal games (config dir)
//   GET    /api/refresh                         catalog refresh status
//   POST   /api/refresh[?force=1]               refresh if the catalogs are a week old (force: admins)

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { DATA_FILES } from '../scripts/build-all.mjs';
import { readJson, writeFileAtomic } from '../scripts/fsutil.mjs';
import { catalogsAreStale, readMyGames, refreshStatus, requestRefresh, runRefresh } from '../scripts/refresh.mjs';
import type { CatalogGame } from '../src/types.ts';
import { createAuth } from './auth.ts';
import { getPlaylist, getVideo, search } from './youtube.ts';

export type Next = (err?: unknown) => void;
export type Handler = (req: IncomingMessage, res: ServerResponse, next: Next) => void;

export interface ApiOptions {
  dataDir: string;
  configDir: string;
  /**
   * Who runs catalog refreshes. 'inline': this process (dev, single-process hosting).
   * 'worker': a separate `npm run worker` / cron job sharing the data dir; this process only
   * reports status and passes on admin requests.
   */
  refresh?: 'inline' | 'worker';
  /** Sign-in (hosted). Off unless invites.json or a password exist; `false` = never (dev). */
  auth?: { password?: string; secret?: string } | false;
  /** Behind a reverse proxy: trust X-Forwarded-For / -Proto. */
  trustProxy?: boolean;
  /** Per-IP requests per minute for the YouTube/MusicBrainz endpoints (0 = off). */
  rateLimit?: number;
  log?: (msg: string) => void;
}

const HOUR = 60 * 60 * 1000;
// How long YouTube/MusicBrainz answers are reused (memory, then disk). Long enough that several
// people adding the same titles don't re-scrape YouTube; the weekly playlist sync still sees
// changes within a day.
const TTL: Record<string, number> = { s: 3 * 24 * HOUR, p: 20 * HOUR, v: 7 * 24 * HOUR, a: 7 * 24 * HOUR };

export function createApi(opts: ApiOptions) {
  const { dataDir, configDir } = opts;
  const say = opts.log ?? ((m: string) => console.log(`[medley] ${m}`));
  const auth = createAuth({
    configDir,
    dataDir,
    ...(opts.auth || {}),
    disabled: opts.auth === false,
    trustProxy: opts.trustProxy,
    log: say,
  });
  const inline = (opts.refresh ?? 'inline') === 'inline';

  // ---- catalog refresh (scripts/refresh.mjs) -------------------------------------------------
  function startInline(force: boolean) {
    if (force || catalogsAreStale(dataDir)) void runRefresh({ dataDir, configDir, log: (m: string) => say(`[catalog] ${m}`) });
  }

  /** Single-process hosting: keep the catalogs fresh without anyone visiting. */
  function startScheduler() {
    const tick = () => {
      const s = refreshStatus(dataDir);
      // Back off a day after a real failure; an interrupted run (crash, redeploy) just starts over.
      if (s.state === 'error' && s.error !== 'interrupted' && Date.now() - (s.finishedAt ?? 0) < 24 * HOUR) return;
      startInline(s.requested);
    };
    setTimeout(tick, 60_000).unref();
    setInterval(tick, HOUR).unref();
  }

  // Without sign-in, only requests from this machine count as the owner.
  const isLoopback = (req: IncomingMessage) =>
    /^(::1|127\.|::ffff:127\.)/.test(req.socket.remoteAddress ?? '') && !req.headers['x-forwarded-for'];

  // ---- personal games -------------------------------------------------------------------------
  /** Your games as configured, with refreshed covers when a refresh has run. */
  function myGames(): CatalogGame[] {
    const games = readMyGames(configDir);
    const enriched = new Map<string, CatalogGame>((readJson<CatalogGame[]>(join(dataDir, 'my-games.json')) ?? []).map((g) => [g.id, g]));
    return games.map((g) => ({ ...g, covers: enriched.get(g.id)?.covers ?? g.covers }));
  }

  // ---- response cache: memory (fast) over disk (survives restarts, shared by processes) -----
  const memory = new Map<string, { at: number; value: Promise<unknown> }>();
  const cacheDir = join(dataDir, 'cache', 'api');
  const diskFile = (key: string) => {
    const h = createHash('sha1').update(key).digest('hex');
    return join(cacheDir, h.slice(0, 2), `${h}.json`);
  };
  function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const ttl = TTL[key[0]] ?? HOUR;
    const hit = memory.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.value as Promise<T>;
    if (memory.size > 5000) for (const [k, v] of memory) if (Date.now() - v.at >= (TTL[k[0]] ?? HOUR)) memory.delete(k);
    const file = diskFile(key);
    const disk = readJson<{ at: number; value: T }>(file);
    if (disk && Date.now() - disk.at < ttl) {
      const value = Promise.resolve(disk.value);
      memory.set(key, { at: disk.at, value });
      return value;
    }
    const value = fn();
    memory.set(key, { at: Date.now(), value });
    value.then(
      (v) => {
        try {
          writeFileAtomic(file, JSON.stringify({ at: Date.now(), value: v }));
        } catch {
          /* cache is best-effort */
        }
      },
      () => memory.delete(key),
    );
    return value;
  }

  // ---- per-IP rate limit (fixed one-minute windows) ------------------------------------------
  const hits = new Map<string, { window: number; n: number }>();
  function limited(req: IncomingMessage) {
    if (!opts.rateLimit) return false;
    const ip = auth.clientIp(req);
    const window = Math.floor(Date.now() / 60_000);
    const h = hits.get(ip);
    if (!h || h.window !== window) {
      if (hits.size > 10_000) hits.clear();
      hits.set(ip, { window, n: 1 });
      return false;
    }
    return ++h.n > opts.rateLimit;
  }

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
    try {
      const user = await auth.gate(req, res, url.pathname);
      if (!user) return; // answered (sign-in endpoints, or 401)
      switch (url.pathname) {
        case '/api/search':
        case '/api/playlist':
        case '/api/video':
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
        case '/api/data': {
          const name = q('name');
          if (!DATA_FILES.includes(name)) throw new Error('Unknown data file');
          const file = join(dataDir, `${name}.json`);
          // No refreshed copy yet: 204 rather than 404, so browsers don't log it as an error.
          if (!existsSync(file)) {
            res.statusCode = 204;
            res.setHeader('Cache-Control', 'no-store');
            return res.end();
          }
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(readFileSync(file));
          return;
        }
        case '/api/my-games':
          return send(200, myGames());
        case '/api/refresh': {
          if (req.method === 'POST') {
            const admin = auth.enabled() ? user.admin : isLoopback(req);
            const force = q('force') === '1' && admin;
            if (inline) startInline(force);
            else if (force) requestRefresh(dataDir); // the worker picks it up within a minute
            return send(202, refreshStatus(dataDir));
          }
          return send(200, refreshStatus(dataDir));
        }
        default:
          return send(404, { error: 'Unknown endpoint' });
      }
    } catch (e) {
      send(502, { error: e instanceof Error ? e.message : String(e) });
    }
  };

  return { handle, startScheduler, refreshStatus: () => refreshStatus(dataDir) };
}
