# Data model

**Summary:** two kinds of data. The **catalog** (`CatalogGame`, public metadata about ~4,400 games)
is static JSON. The **library** (`Game`, `Track`, `Source`, `Play`, `meta`) is the user's personal
data in IndexedDB. Types live in `src/types.ts`; the schema in `src/db.ts`.

## Catalog: `CatalogGame` (src/types.ts)

| Field | Notes |
|---|---|
| `id` | Wikidata QID (`Q29300592`), or `u:<slug>` for personal games |
| `title`, `year` | English (or language-neutral `mul`) label; first release year |
| `genres` | Broad buckets (RPG, Platformer, …) derived from Wikidata genres |
| `series`, `franchise` | Wikidata P179 / P8345. UI groups by `franchise ?? series` (`franchiseOf()`) |
| `composers` | Wikidata P86, max 4 |
| `pop` | Wikipedia language editions: rough popularity, used for sorting |
| `steam` | Steam app id (Wikidata P1733) |
| `tags` | `{ platform, genre (full list), mode, theme, developer, publisher }` |
| `keywords` | Steam user tags (SteamSpy), top 15 |
| `covers` | Portrait image URLs, best first; the UI falls back down the list |
| `links` | `{ label, url }[]`: stores first, Wikipedia last (`primaryLink()`) |
| `sources` | Personal games only: fixed YouTube links that bypass search |
| `roblox` | Personal games only: `{ universeId, placeId }` for icon + link |

Where it comes from: [data-pipeline.md](data-pipeline.md).

## Library (IndexedDB `vgm-shuffle`, Dexie)

| Table | Key | Purpose |
|---|---|---|
| `games` | `id` (= catalog id) | A game in the library. `enabled` = in rotation. Copies `franchise`, `platforms`, `keywords` from the catalog for filtering (synced at start-up by `syncLibraryMeta`) |
| `tracks` | `id` = `videoId`, or `videoId@start` for a slice of a long video | `start`/`end` seconds for slices, `types` (battle, town, …), `liked`, `banned`, `unavailable`, `playCount`, `skipCount` |
| `sources` | playlist/video id | Where tracks came from; `gameIds` it fed |
| `plays` | auto-increment | Play history (`skipped` = skipped early). Picker reads the last 400 |
| `meta` | `key` | Durable app state (below) |

Schema versions: v1 (games/tracks/sources/plays), v2 adds `meta`. Add a new `db.version(n)` for
changes; never edit old versions.

### `meta` keys (src/lib/updater.ts, scripts/import-headless.ts)

| Key | Value |
|---|---|
| `lastRefreshAt` / `lastRefreshAttemptAt` | ms timestamps for the monthly refresh |
| `subscriptions` | collection group ids that auto-add new games (`mine` by default) |
| `seenCollectionIds` | catalog ids already offered, so only *new* entries are auto-added |
| `myGamesImported` | personal game ids imported once (deleting one sticks) |
| `headlessFailed` | titles the headless importer couldn't find (skipped unless `--retry-failed`) |

Backups (`exportLibrary`) include all five tables, so bookkeeping travels with them.

## Browser-only conveniences

| Where | Key | Content |
|---|---|---|
| URL | `?tab=&track=&t=` | Current tab, track id, position (s). Written by `urlState.writeUrlState` |
| localStorage | `vgm-shuffle:filters` | Listen filters + sliders |
| localStorage | `vgm-shuffle:session` | Up-next queue and back stack |
| localStorage | `vgm-shuffle:volume` | `{ volume, muted }` |

All localStorage access is wrapped in try/catch; the app must work when it's unavailable.
