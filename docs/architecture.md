# Architecture

**Summary:** Medley is a single-page React app plus a tiny API that lives inside the Vite dev server. The
browser holds the user's library (IndexedDB) and plays audio through YouTube's IFrame player.
The server does what browsers can't: fetching YouTube/Steam/Wikidata pages server-side (CORS), and
rebuilding the catalog. There is no database server and no account system.

## Processes

```
Browser (React app)                           Node (Vite dev server, `npm run dev`)
──────────────────                            ───────────────────────────────────────
UI + shuffle + IndexedDB library  ── /api ──▶  server/plugin.ts
YouTube IFrame player (audio)                   ├─ youtube.ts  search / playlist / video (keyless scraping)
Wikidata SPARQL (Steam id lookups) ◀── direct   ├─ steam.ts    optional Steam Web API
                                                ├─ artists.ts  /api/artists/search (MusicBrainz)
                                                ├─ /api/refresh → scripts/build-all.mjs (all 4 builders)
                                                ├─ /api/data?name= → <data dir>/*.json (refreshed catalogs)
                                                ├─ /api/my-games → <config dir>/my-games.json
                                                └─ remote.ts   /api/remote/* relay ◀──▶ desktop companion (companion/)
```

The routes live in `server/api.ts`. In development `server/plugin.ts` mounts them in Vite; in
production `server/serve.ts` serves `dist/` plus the same API from one Node process (compression,
optional password, rate limit, weekly refresh scheduler). Data and config directories are
outside the repo (`scripts/paths.mjs`). See [hosting.md](hosting.md).

The **desktop companion** (`companion/`, Electron) is a separate process: it subscribes to the
relay with the channel key from **Add link → Desktop companion** and sends commands back; the
app side is `src/lib/remote.ts`.

`scripts/import-headless.ts` is a third mode: it runs the client's import code in Node against an
in-memory IndexedDB (`fake-indexeddb`) and the running dev server, then writes a backup file.

## Module ownership

| Module | Owns |
|---|---|
| `src/useSession.ts` | Playback session: current track, up-next queue, back stack, play/skip recording, resume state |
| `src/lib/picker.ts` | Choosing the next track (pure functions; see [shuffle.md](shuffle.md)) |
| `src/lib/importer.ts` | Turning YouTube links into works+tracks; auto-finding a soundtrack (games, film & TV incl. songs albums); dispatch per `kind` |
| `src/lib/importers/anime.ts` | Finding each OP/ED/insert song of an anime, then its OST |
| `src/lib/importers/artist.ts` | An artist's popular songs; parsing and adding a single song |
| `src/lib/sync.ts` | Weekly re-check of imported playlists (added / removed / renamed videos) |
| `src/lib/kinds.ts` | Domain kinds, icons, labels, roles, credit lines |
| `src/lib/parse.ts` | Title cleaning, track-type tagging, timestamp/chapter parsing, catalog title matching |
| `src/lib/catalog.ts` | Loading all catalogs + collections (bundled vs refreshed vs personal), `useCatalog()`, `isUpcoming` |
| `src/lib/bulk.ts` | Background bulk-import queue (survives tab switches and reloads), failures, arrivals |
| `src/lib/updater.ts` | Start-up jobs: resume interrupted imports, personal games, library metadata sync, weekly update |
| `src/lib/search.ts` | Tokenised fuzzy search used by every search box |
| `src/lib/urlState.ts` | URL (`?tab&track&t`) and localStorage persistence of session/volume |
| `src/lib/steam.ts` | Parsing pasted Steam libraries and mapping them to Wikidata |
| `src/db.ts` | Dexie schema, backup export/import, `meta` key-value helpers |
| `server/youtube.ts` | All knowledge of YouTube's page structure |
| `scripts/catalog-builder.mjs` | Which games exist and which collections they're in |
| `scripts/screen-builder.mjs`, `anime-builder.mjs`, `artist-builder.mjs` | The same for film & TV, anime, artists |
| `scripts/build-all.mjs` | Runs every builder; used by `npm run catalog` and `/api/refresh` |
| `scripts/enrich.mjs` | Covers, tags, keywords, store links for catalog entries |

## Data flow: importing a game

1. User clicks **+** on a catalog game (or a collection triggers `runBulk`).
2. `importer.autoAddGame` → `findCandidates` → `/api/search?type=playlist` → rank candidates.
3. Best candidate → `/api/playlist` → `draftFromLink` cleans titles and tags tracks.
4. `commitDraft` writes `games`, `tracks`, `sources` rows (IndexedDB).
5. `useSession`'s live queries see the new tracks; the picker can now choose them.

## Data flow: playing

`useSession` keeps a queue of 4 picks (`pickNext`), `ListenView` renders `YouTubePlayer` with the
current track. When a track ends (or a slice's `end` is reached) `next()` advances, records a
`plays` row and bumps `playCount`. Position is mirrored into the URL for resume.
