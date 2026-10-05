# Hosting Medley

**Summary:** Medley is a static React app plus a small Node API (YouTube reading, catalog
refresh, sign-in). In production `server/serve.ts` serves both; the weekly catalog refresh runs
either inside it or in a separate worker. Data lives in a data directory outside the code; each
person's library stays in their own browser. Sign-in is invite-only and off unless configured.

## Processes

| Process | Command | Does |
|---|---|---|
| **web** | `npm run serve` (`server/serve.ts`) | The page, assets (unless on a CDN) and `/api/*`. With `MEDLEY_ROLE=all` (default) it also runs the weekly refresh |
| **worker** | `npm run worker` (`server/worker.ts`) | Checks every minute: refreshes the catalogs when they're a week old or an admin asked; prunes the API cache daily. Use with `MEDLEY_ROLE=web` |
| **cron one-shot** | `npm run refresh` (`scripts/refresh.mjs`, `--force` to ignore age) | The same refresh, for platforms with scheduled jobs instead of always-on workers |

Web and worker coordinate only through files in the shared data dir (`refresh-status.json`,
`refresh.lock` with a 30 s heartbeat, `refresh.request`), so they need one shared volume and
nothing else. Platforms that can't share a volume between services (Fly machines, Railway
services, Render cron jobs): run a single web process with `MEDLEY_ROLE=all`.

Locally nothing changes: `npm run dev` runs everything in one process, never asks for sign-in.

## What lives where

| What | Where | Notes |
|---|---|---|
| Code, bundled catalogs (`src/data/*.json`) | The app directory / image | Read-only at runtime |
| Hashed JS/CSS (incl. the catalogs as chunks) | `dist/assets/`, or a CDN | See *CDN* below |
| Refreshed catalogs, API cache, refresh state, session secret | `MEDLEY_DATA_DIR` | Persistent volume. Losing it costs a ~30 min rebuild and a cold YouTube cache |
| Personal config: `my-games.json`, `invites.json`, `medley.env` | `MEDLEY_CONFIG_DIR` | Persistent volume. Templates in `config/` and `.env.example` |
| Each person's library (titles, tracks, likes, plays) | Their browser (IndexedDB, per site address) | Backup / Restore to move it. Medley asks the browser to keep it permanently |

Defaults without the variables (also used by `npm run dev`; `scripts/paths.mjs`): Windows
`%LOCALAPPDATA%\Medley\data` and `%APPDATA%\Medley`; macOS
`~/Library/Application Support/Medley/{data,config}`; Linux `~/.local/share/medley` and
`~/.config/medley`. On Linux servers, prefer `/var/lib/medley` and `/etc/medley` (systemd:
`StateDirectory=medley`, `ConfigurationDirectory=medley`). Run as a normal user; only these two
directories need to be writable.

## Settings

Environment variables, or `medley.env` in the config dir (KEY=value lines; real environment
variables win; `.env.local` in the repo also works for local testing):

| Variable | Default | Purpose |
|---|---|---|
| `PORT`, `HOST` | `32123`, `0.0.0.0` | Listen address |
| `MEDLEY_ROLE` | `all` | `web`: leave refreshes to the worker / cron |
| `MEDLEY_DATA_DIR`, `MEDLEY_CONFIG_DIR` | OS folders above (`/data`, `/config` in Docker) | Storage |
| `MEDLEY_PASSWORD` | unset | A shared invite code (signs in as "guest"), in addition to `invites.json` |
| `MEDLEY_SECRET` | random, kept in the data dir | Signs session cookies. Set it if the data dir isn't persistent |
| `MEDLEY_TRUST_PROXY` | off | `1` behind a reverse proxy: use `X-Forwarded-For` (rate limits) and `X-Forwarded-Proto` (secure cookies) |
| `MEDLEY_RATE_LIMIT` | `600` | YouTube/MusicBrainz API calls per minute per IP (`0` = off) |
| `MEDLEY_ASSET_URL` | unset | **Build time**: CDN base URL for the hashed assets |
| `STEAM_API_KEY` | unset | Optional: load a Steam library by profile URL |

## Sign-in (invite-only)

Off unless `invites.json` (in the config dir) or `MEDLEY_PASSWORD` exists. Then the page shows
a sign-in screen and `/api/*` answers 401 without a session.

```json
[
  { "name": "Sam", "code": "a-long-random-code", "admin": true },
  { "name": "Alex", "code": "another-long-random-code" }
]
```

- Codes need 8+ characters; use long random ones (`node -e "console.log(crypto.randomUUID())"`).
- Signing in sets an HttpOnly, SameSite=Lax cookie for 180 days (Secure over HTTPS). Removing
  someone or changing their code signs them out everywhere; the file is re-read on change, no
  restart needed. 10 attempts per 10 minutes per IP.
- Admins can force a catalog refresh (**check now**); everyone else only sees the status.
- The page and its JS are public (they're just code and public catalog data); everything
  personal or costly sits behind `/api`.

## Run it

**Single machine, one process** (Node ≥ 22.18):

```bash
npm ci && npm run build
npm run serve            # http://localhost:32123
```

**Docker, web + worker** (`docker-compose.yml`): `docker compose up -d --build`, then copy your
config in: `docker compose cp invites.json web:/config/` (and `my-games.json`). Single process
instead: delete the `worker` service and the `MEDLEY_ROLE` line.

**HTTPS** is required on a real domain (the pop-out player, persistent storage and secure
cookies need a secure context; `localhost` counts as secure, a plain-http domain doesn't). Put
Caddy in front: `medley.example.com { reverse_proxy localhost:32123 }`, and set
`MEDLEY_TRUST_PROXY=1`.

## CDN for the static assets

```bash
MEDLEY_ASSET_URL=https://cdn.example.com/medley/ npm run build
# then upload dist/assets/ to that location, e.g.:
rclone copy dist/assets r2:my-bucket/medley/assets --header-upload "Cache-Control: public, max-age=31536000, immutable"
aws s3 sync dist/assets s3://my-bucket/medley/assets --cache-control "public, max-age=31536000, immutable"
```

- Only content-hashed files go to the CDN, so they can be cached forever; upload before
  deploying the new web build (old files can stay; they're never overwritten).
- `index.html`, `manifest.webmanifest`, the icons and `/api` stay on the app's domain (the
  manifest must be same-origin for installing, and the API is same-origin by design).
- The CDN must send `Access-Control-Allow-Origin: https://your-domain` (or `*`): the entry
  script is loaded with `crossorigin`. Enable compression (brotli) on the CDN; the catalogs are
  ~9 MB raw, ~1.5 MB compressed.
- Docker: `docker build --build-arg MEDLEY_ASSET_URL=… .`
- The page loads its code from the CDN only, so a missed upload or a CDN outage means a blank
  page: upload first, deploy second. (The web server also keeps serving `dist/assets/`, which
  doesn't help the page but makes switching the CDN off a rebuild without `MEDLEY_ASSET_URL`.)

## How the hosted server behaves

- **Static files:** hashed `/assets/*` cached forever; everything served brotli/gzip compressed.
- **YouTube reading is cached on disk** in the data dir (searches 3 days, playlists 20 h, videos
  7 days), shared by everyone, so ten people adding the same title cost YouTube one request.
- **Health check:** `GET /healthz` → `{ ok, role, catalogs }` (no sign-in).
- **Shutdown:** SIGTERM finishes open requests (10 s max). A worker killed mid-refresh leaves a
  lock that goes stale after 2 minutes; the next run starts over.

## YouTube

- **The embedded player** must stay visible and at least 200×200 CSS px (YouTube's player
  rules). The docked mini player is sized for that (`.listen-layout.compact`).
- **Referer:** YouTube rejects embeds without one ("error 153"). `index.html` sets
  `Referrer-Policy: strict-origin-when-cross-origin` and the player passes `origin`; don't let a
  proxy add `Referrer-Policy: no-referrer`.
- **Data-center IPs** sometimes get YouTube's "confirm you're not a bot" pages, which breaks
  importing (playback, in the visitor's browser, is unaffected). The disk cache reduces how often
  the server asks. If it happens, route the server's YouTube requests through another
  connection: Node 24 honours `HTTPS_PROXY` with `NODE_USE_ENV_PROXY=1`.
- No API key is used on purpose (quota too small for bulk imports).

## Caveats

- **GitHub Pages / pure static hosting** can't run the API.
- Libraries don't sync between browsers (Backup → Restore). A new domain starts empty.
- Keep it private (sign-in on): cover art and YouTube's terms make a public catalog site a different, riskier thing.
