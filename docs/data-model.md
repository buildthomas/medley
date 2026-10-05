# Data model

**Summary:** two kinds of data. The **catalogs** (`CatalogGame[]`: public metadata about games,
films, series, anime and artists) are static JSON. The **library** (`Game`, `Track`, `Source`,
`Play`, `meta`) is the user's personal data in IndexedDB. Types live in `src/types.ts`; the
schema in `src/db.ts`. Historical naming: `Game`/`CatalogGame`/`gameId` mean any *work*; its
`kind` says which domain it belongs to.

## Kinds (`WorkKind`, src/lib/kinds.ts)

| `kind` | id format | Catalog file | Importer |
|---|---|---|---|
| `game` (default when absent) | Wikidata QID, or `u:<slug>` for personal games | `catalog.json` | `importer.autoAddGame` |
| `film`, `series` | Wikidata QID | `screen.json` | `autoAddGame` + `complementaryAlbum` (songs) |
| `anime` | `al:<AniList id>` | `anime.json` | `importers/anime.ts` |
| `artist` | Wikidata QID, or `mb:<MusicBrainz id>` from live search, or `u:artist-<slug>` when created by *Add a song* | `artists.json` | `importers/artist.ts` |

`KINDS` holds icons/labels; `creditLine(work)` gives the per-kind subtitle (composer / studio /
artist country & years).

## Catalog: `CatalogGame` (src/types.ts)

| Field | Notes |
|---|---|
| `id`, `kind` | See above |
| `title`, `year`, `date` | English (or `mul`) label; first release year; `date` as `YYYY-MM-DD` or `YYYY-MM` when Wikidata/AniList knows it to that precision (drives `isUpcoming`) |
| `altTitles` | Anime: romaji/native/synonyms. Used when ranking YouTube results |
| `genres` | Broad buckets per domain (RPG… / Animation, Musical… / Pop, K-pop…) |
| `series`, `franchise` | Grouping. UI groups by `franchise ?? series` (`franchiseOf()`) |
| `composers` | Games/film: Wikidata P86, max 4 |
| `pop` | Popularity used for sorting (sitelinks; AniList popularity scaled for anime) |
| `steam` | Steam app id (games) |
| `tags` | `{ platform, genre, mode, theme, developer, publisher, studio, network, format, country }`; each optional |
| `keywords` | Steam tags (games), AniList tags rank ≥ 70 (anime) |
| `covers` | Portrait image URLs, best first; the UI falls back down the list |
| `links` | `{ label, url }[]`: stores / AniList / MAL / Spotify first, Wikipedia last (`primaryLink()`) |
| `themes` | Anime only: `{ type: 'OP'|'ED'|'IN', seq, song, artists[], episodes? }[]` from AnimeThemes |
| `artist` | Artists only: `{ country, since, type: 'person'|'group' }` |
| `ytChannel` | Artists only: official YouTube channel id (recognises official uploads) |
| `sources`, `roblox` | Personal games only: fixed YouTube links; Roblox ids for icon + link |

Where it comes from: [data-pipeline.md](data-pipeline.md).

## Library (IndexedDB `medley`, Dexie)

Before the rename the database was `vgm-shuffle` (and localStorage keys `vgm-shuffle:*`).
`src/migrate.ts` copies them to the new names once, before the app renders, and leaves the old
ones as a backup. The app also moved from port 5173 to 32123, a different origin with its own
storage: `src/lib/originTransfer.ts` loads `http://localhost:5173/__medley/transfer` (served by the
dev server, `server/legacy-origin.ts`) in a hidden iframe and copies that origin's library and
settings over once, when the new one is empty (`medley:origin-transfer` records the outcome). The schema lives in `defineSchema()` so the migration can open the old database.

| Table | Key | Purpose |
|---|---|---|
| `games` | `id` (= catalog id) | A work in the library. `enabled` = in rotation. `kind`, `franchise`, `platforms`, `keywords` copied from the catalog for filtering (synced at start-up by `syncLibraryMeta`) |
| `tracks` | `id` = `videoId`, or `videoId@start` for a slice | `start`/`end` for slices, `duration`, `types`, `liked`, `banned`, `unavailable`, `playCount`, `skipCount`, plus: `vocal` (sung?), `role` (`op`/`ed`/`insert`/`score`/`song`), `seq` (OP2 → 2), `artist`, `customTitle` (user renamed; source sync won't overwrite) |
| `sources` | playlist/video id | Where tracks came from; `gameIds` it fed; `kind` `playlist`/`video`/`search` (individually found videos, e.g. anime themes); `syncedAt` |
| `plays` | auto-increment | Play history (`skipped` = skipped early). Picker reads the last 400 |
| `meta` | `key` | Durable app state (below) |

Schema versions: v1 (games/tracks/sources/plays), v2 adds `meta`. New track/game fields are
optional and unindexed, so they needed no schema bump. Add a new `db.version(n)` for index
changes; never edit old versions.

Derived, not stored: length bucket (`lengthOf`: jingle < 30 s, short < 90 s, standard, long > 6 min),
voice (`isVocal`: `vocal` ?? role ≠ score ?? `types` has `vocal`).

### `meta` keys

| Key | Value | Owner |
|---|---|---|
| `lastRefreshAt` / `lastRefreshAttemptAt` | ms timestamps for the weekly update | updater.ts |
| `subscriptions` | collection group ids that auto-add new titles (`mine` by default) | updater.ts |
| `seenCollectionIds` | catalog ids already offered, so only *new* entries are auto-added | updater.ts |
| `myGamesImported` | personal game ids imported once (deleting one sticks) | updater.ts |
| `bulkQueue` | `{ label, ids }` of a running bulk import, so a reload resumes it | bulk.ts |
| `importFailures` | `{ [id]: { at, reason } }` titles that found nothing; retried weekly once released | bulk.ts |
| `arrivals` | `{ at, label, ids, newTrackIds?, trackGameIds? }` for the New-arrivals banner; `null` when dismissed | bulk.ts, updater.ts |
| `headlessFailed` | titles the headless importer couldn't find | import-headless.ts |

Backups (`exportLibrary`) include all five tables, so bookkeeping travels with them.

## Browser-only conveniences

| Where | Key | Content |
|---|---|---|
| URL | `?tab=&track=&t=` | Current tab, track id, position (s). Written by `urlState.writeUrlState` |
| localStorage | `medley:filters` | Listen filters + sliders |
| localStorage | `medley:session` | Up-next queue, back stack, current program |
| localStorage | `medley:volume` | `{ volume, muted }` |
| localStorage | `medley:open-sections` | Which filter sections are expanded |
| localStorage | `medley:discover-domain` | Last Discover domain tab |
| localStorage | `medley:anime-scope` | What adding an anime imports: `all` / `songs` / `oped` / `op` |
| localStorage | `medley:cover-backdrops` | Cover URL → `light`/`dark`/`none` (transparent-logo analysis cache) |

All localStorage access is wrapped in try/catch; the app must work when it's unavailable.
