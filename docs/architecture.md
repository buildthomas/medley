# Architecture

**Summary:** a single-page React app plus a tiny API that lives inside the Vite dev server. The
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
                                                ├─ /api/refresh → scripts/catalog-builder.mjs (+ enrich.mjs)
                                                ├─ /api/data/* → data/*.json (refreshed catalog)
                                                └─ /api/my-games → config/my-games.json
```

`npm start` (build + `vite preview`) serves the same API, so a production build still needs Node.
A purely static deploy would lose importing and refresh, but playback of an existing library works.

`scripts/import-headless.ts` is a third mode: it runs the client's import code in Node against an
in-memory IndexedDB (`fake-indexeddb`) and the running dev server, then writes a backup file.

## Module ownership

| Module | Owns |
|---|---|
| `src/useSession.ts` | Playback session: current track, up-next queue, back stack, play/skip recording, resume state |
| `src/lib/picker.ts` | Choosing the next track (pure functions; see [shuffle.md](shuffle.md)) |
| `src/lib/importer.ts` | Turning YouTube links into games+tracks; auto-finding a soundtrack for a game |
| `src/lib/parse.ts` | Title cleaning, track-type tagging, timestamp/chapter parsing, catalog title matching |
| `src/lib/catalog.ts` | Loading catalog + collections (bundled vs refreshed vs personal), `useCatalog()` hook |
| `src/lib/bulk.ts` | Background bulk-import queue (module-level store; survives tab switches) |
| `src/lib/updater.ts` | Start-up jobs: personal games import, library metadata sync, monthly refresh |
| `src/lib/search.ts` | Tokenised fuzzy search used by every search box |
| `src/lib/urlState.ts` | URL (`?tab&track&t`) and localStorage persistence of session/volume |
| `src/lib/steam.ts` | Parsing pasted Steam libraries and mapping them to Wikidata |
| `src/db.ts` | Dexie schema, backup export/import, `meta` key-value helpers |
| `server/youtube.ts` | All knowledge of YouTube's page structure |
| `scripts/catalog-builder.mjs` | Which games exist and which collections they're in |
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
