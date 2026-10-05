# Hosting Medley

**Summary:** Medley is a static React app plus a small Node API (YouTube reading, catalog
refresh). `npm run build && npm run serve` (or the Dockerfile) runs both in one
process. Data lives in a data directory outside the code; your library stays in each browser.

## What lives where

| What | Where | Notes |
|---|---|---|
| Code, bundled catalogs (`src/data/*.json`) | The app directory / image | Read-only at runtime |
| Refreshed catalogs, caches, refresh state | `MEDLEY_DATA_DIR` | Persistent volume. Rebuildable, but a rebuild takes ~30 min |
| Personal config (`my-games.json`) | `MEDLEY_CONFIG_DIR` | Persistent volume. Template: `config/my-games.example.json` |
| Your library (titles, tracks, likes, plays) | Each visitor's browser (IndexedDB, per site address) | Move it with **Add link → Backup**. A new address starts empty |

Defaults when the variables aren't set (also used by `npm run dev`; see `scripts/paths.mjs`):
Windows `%LOCALAPPDATA%\Medley\data` and `%APPDATA%\Medley`; macOS
`~/Library/Application Support/Medley/{data,config}`; Linux `~/.local/share/medley` and
`~/.config/medley`. Older checkouts' `./data` and `./config/my-games.json` are moved there on
first start.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `PORT`, `HOST` | `32123`, `0.0.0.0` | Listen address (`8080` in the Docker image) |
| `MEDLEY_DATA_DIR`, `MEDLEY_CONFIG_DIR` | OS folders above (`/data`, `/config` in Docker) | Storage |
| `MEDLEY_PASSWORD` | unset | Ask for a password (HTTP basic auth, any user name). **Set this on any public host**, or anyone can use your server to search YouTube |
| `MEDLEY_RATE_LIMIT` | `600` | YouTube/MusicBrainz API calls per minute per IP (`0` = off). Bulk imports make many calls; don't go much lower |
| `MEDLEY_ADMIN_TOKEN` | unset | Allows `POST /api/refresh?force=1` with `Authorization: Bearer <token>` from outside localhost |
| `STEAM_API_KEY` | unset | Optional: load a Steam library by profile URL |

## Run it

**Any machine with Node ≥ 22.18:**

```bash
npm ci && npm run build
MEDLEY_PASSWORD=… npm run serve       # http://localhost:32123
```

Put it behind a reverse proxy for HTTPS. Caddy example: `medley.example.com { reverse_proxy localhost:32123 }`.

**Docker** (Fly.io, Railway, Render, a VPS…):

```bash
docker build -t medley .
docker run -d --name medley -p 8080:8080 \
  -v medley-data:/data -v medley-config:/config \
  -e MEDLEY_PASSWORD=… medley
docker cp my-games.json medley:/config/   # optional, your own games
```

On Fly.io: `fly launch` (it finds the Dockerfile), `fly volumes create medley_data`, mount it at
`/data` in `fly.toml`, and `fly secrets set MEDLEY_PASSWORD=…`. One small machine (256–512 MB) is plenty.
Keep it to a single instance: refreshes are per process.

## How the hosted server behaves

- **Catalogs refresh themselves** once a week (hourly check, `startScheduler` in
  `server/api.ts`), whether or not anyone visits. Browsers can ask (`POST /api/refresh`), but a
  rebuild only starts when the catalogs are ~a week old; `?force=1` needs localhost or the admin token.
- **Static files:** hashed `/assets/*` are cached forever; everything is served brotli/gzip
  compressed (the ~9 MB of catalogs become ~1.5 MB).
- **Health check:** `GET /healthz` (no password) → `{ ok, catalogs }`.

## Caveats

- **YouTube may treat a data-center IP as a bot** and serve consent or "confirm you're not a bot"
  pages to the server's scraper, so imports fail while playback (which happens in your browser)
  keeps working. A home server, or a VPS with a residential-looking IP, avoids this. If imports
  fail only when hosted, this is why.
- **GitHub Pages / pure static hosting** can't run the API. It could be ported to serverless
  functions (each route in `server/api.ts` is stateless except the refresh, which would become a
  scheduled job writing to object storage).
- Libraries don't sync between browsers. Use Backup → Restore.
