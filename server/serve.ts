// Production server: the built app (dist/) plus /api, in one Node process without Vite.
//
//   npm run build && npm run serve        (Node ≥ 22.18 runs this TypeScript file directly)
//
// Environment (see docs/hosting.md):
//   PORT, HOST              default 32123 (the logo's bar heights; same as `npm run dev`), 0.0.0.0
//   MEDLEY_ROLE             all (default): also runs the weekly catalog refresh in this process
//                           web: leave refreshes to `npm run worker` / a cron job sharing the data dir
//   MEDLEY_DATA_DIR         refreshed catalogs, caches, sign-in secret (scripts/paths.mjs)
//   MEDLEY_CONFIG_DIR       my-games.json, invites.json
//   MEDLEY_PASSWORD         a shared invite code (in addition to invites.json); sign-in is off
//                           unless one of the two is set
//   MEDLEY_SECRET           signs session cookies (default: a random secret kept in the data dir)
//   MEDLEY_TRUST_PROXY      1 behind a reverse proxy (X-Forwarded-For/-Proto)
//   MEDLEY_RATE_LIMIT       YouTube/MusicBrainz API calls per minute per IP (default 600; 0 = off)
//   STEAM_API_KEY           optional, for loading a Steam library by profile URL

import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { loadEnvFiles, medleyPaths, ROOT } from '../scripts/paths.mjs';
import { createApi } from './api.ts';

loadEnvFiles();
const env = process.env;
const log = (m: string) => console.log(`[medley] ${m}`);
const { dataDir, configDir } = medleyPaths({ log });
const DIST = join(ROOT, 'dist');
if (!existsSync(join(DIST, 'index.html'))) {
  console.error('No build found. Run `npm run build` first.');
  process.exit(1);
}
const role = env.MEDLEY_ROLE === 'web' ? 'web' : 'all';

const api = createApi({
  dataDir,
  configDir,
  steamKey: env.STEAM_API_KEY,
  refresh: role === 'all' ? 'inline' : 'worker',
  auth: { password: env.MEDLEY_PASSWORD || undefined, secret: env.MEDLEY_SECRET || undefined },
  trustProxy: env.MEDLEY_TRUST_PROXY === '1',
  rateLimit: env.MEDLEY_RATE_LIMIT ? Number(env.MEDLEY_RATE_LIMIT) : 600,
  log,
});
if (role === 'all') api.startScheduler();

// ---- static files (precompressed in memory on first request) -------------------------------
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt', '.webmanifest']);
const files = new Map<string, { raw: Buffer; br?: Buffer; gz?: Buffer; mtime: number }>();

function load(file: string) {
  const mtime = statSync(file).mtimeMs;
  let f = files.get(file);
  if (!f || f.mtime !== mtime) {
    const raw = readFileSync(file);
    f = { raw, mtime };
    if (COMPRESSIBLE.has(extname(file)) && raw.length > 1024) {
      f.br = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } });
      f.gz = gzipSync(raw, { level: 9 });
    }
    files.set(file, f);
  }
  return f;
}

function serveStatic(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    return res.end();
  }
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  let file = normalize(join(DIST, path));
  if (!file.startsWith(DIST + sep) && file !== DIST) {
    res.statusCode = 403;
    return res.end();
  }
  // Single-page app: unknown paths get index.html (assets 404 normally).
  if (!existsSync(file) || statSync(file).isDirectory()) {
    if (path.startsWith('/assets/')) {
      res.statusCode = 404;
      return res.end('Not found');
    }
    file = join(DIST, 'index.html');
  }
  const f = load(file);
  const ext = extname(file);
  res.setHeader('Content-Type', TYPES[ext] ?? 'application/octet-stream');
  // Vite's hashed assets never change; everything else must be revalidated.
  res.setHeader('Cache-Control', path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
  res.setHeader('Vary', 'Accept-Encoding');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  const accept = String(req.headers['accept-encoding'] ?? '');
  let body = f.raw;
  if (f.br && /\bbr\b/.test(accept)) {
    body = f.br;
    res.setHeader('Content-Encoding', 'br');
  } else if (f.gz && /\bgzip\b/.test(accept)) {
    body = f.gz;
    res.setHeader('Content-Encoding', 'gzip');
  }
  res.setHeader('Content-Length', body.length);
  res.end(req.method === 'HEAD' ? undefined : body);
}

// ---- server --------------------------------------------------------------------------------
const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (path === '/healthz') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: true, role, catalogs: api.refreshStatus().generatedAt }));
  }
  // /api/* checks sign-in itself (server/auth.ts); the page and assets are public code.
  api.handle(req, res, () => serveStatic(req, res));
});

const port = Number(env.PORT ?? 32123);
server.listen(port, env.HOST ?? '0.0.0.0', () => {
  log(`http://localhost:${port}  (role: ${role}, data: ${dataDir}, config: ${configDir})`);
});

// Containers stop with SIGTERM: finish open requests, then exit.
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => {
    log(`${signal}: shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  });
