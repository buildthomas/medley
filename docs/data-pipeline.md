# Data pipeline: catalogs, collections, weekly update

**Summary:** one builder per domain decides which titles exist and which collections they're
in. `scripts/build-all.mjs` runs them all (each independently: a failing domain keeps its old
data). Output is committed as `src/data/*.json` and refreshed weekly at runtime into
the server's data dir (`MEDLEY_DATA_DIR`, outside the repo; see `scripts/paths.mjs`). Personal
games come from `my-games.json` in the config dir. No API keys anywhere.

## Builders

| Builder | Output | Sources | Time |
|---|---|---|---|
| `catalog-builder.mjs` (+ `enrich.mjs`, `wiki-covers.mjs`) | `catalog.json`, game collections | Wikidata, SteamSpy, Wikipedia, Steam CDN, Roblox | ~10 min (+30 min first time for Steam keywords) |
| `screen-builder.mjs` | `screen.json` (films + series), groups `studios`, `films`, `series` | Wikidata, Wikipedia posters | ~15 min |
| `anime-builder.mjs` | `anime.json`, group `anime` | AniList GraphQL (top 1,200 by popularity), AnimeThemes (songs, batched 50 AniList ids) | ~4 min |

`scripts/wd.mjs` holds the shared Wikidata helpers: `sparql` (retries, including on truncated
JSON), `label` (en → mul), `datePart` (respects date precision), `commonsThumb`, `inBatches`.

### Games (catalog-builder.mjs → buildCatalog)

0. **Which games:** base = ≥ 12 Wikipedia editions, plus Nintendo first-party, the biggest per year,
   every indie game with ≥ 1,500 positive Steam reviews (SteamSpy), and **series completion**:
   every other game of a series that has a game in the catalog, down to 3 editions (the Shantae
   sequels have 6–11). English Wikidata aliases become `altTitles` ("FF7R").
   **Nothing is ever dropped:** every game of the previous catalog stays (`keep`, passed in by
   `build-catalog.mjs` and `refresh.mjs`), since people have it in their library. Without it a
   game that slipped under a cut-off (Mixtape, 9 editions) vanished on the next rebuild.
1. **What counts as a game:** `P31` in `GAME_CLASSES`: video game, *paired versions of a video
   game* (Fire Emblem Fates, Pokémon pairs), video game remake/remaster, expansion-like
   standalone releases, and more. Cancelled games (Q61475894) are excluded. Base catalog = ≥ 12 sitelinks.
2. **Nintendo first-party:** publisher Nintendo or The Pokémon Company, per console
   (`NINTENDO_CONSOLES`, NES → Switch 2). Re-releases before a console's launch are dropped.
3. **Biggest per year** (top 40 by sitelinks, 2010 → now) and **indie per year** (SteamSpy).
4. **Details** in 200-id batches, including the release date with its precision (`date`).
5. **Enrich:** tags & franchise, store links, covers, Roblox icons, Steam keywords.

### Film & TV (screen-builder.mjs)

- Films: `FILM_CLASSES` (film, animated feature, live-action/animated hybrids), shorts excluded.
- **Studios** (checked in this order; the first match wins): Walt Disney Animation (Q1047410),
  Pixar (Q127552), DreamWorks Animation (Q500088), Sony Pictures Animation (Q1416835),
  Illumination (Q1189512), then other Disney live action. Studio films need ≥ 15 sitelinks.
- **Musicals** (genre Q842256, ≥ 15), films by notable composers (≥ 40), superhero, per decade.
- **Series:** ≥ 25 sitelinks, *excluding anime* (Q63952888; anime comes from AniList).
  Japanese animated films are also excluded for the same reason.

### Anime (anime-builder.mjs)

AniList gives titles (English, romaji, native, synonyms → `altTitles`), dates, genres, tags
(→ `keywords`), studio, format, covers, AniList/MAL links. AnimeThemes gives each OP/ED/insert
song with sequence number and artists (→ `themes`). Each AniList *season* is its own entry
with its own songs (AoT S1 has 4 themes; S2 its own). Franchise = shared title stem.
Groups: most popular, films, Ghibli, per year 2010 → now, classics.

## Where the output goes

| Run by | Writes | Committed? |
|---|---|---|
| `npm run catalog` (`scripts/build-catalog.mjs`, `--only games,screen,anime`) | `src/data/*.json` | Yes: the out-of-the-box catalogs |
| Weekly refresh (`server/api.ts` → `buildAll`) | `<data dir>/*.json` (only the domains that succeeded) + `my-games.json` covers | No (outside the repo) |

The client (`src/lib/catalog.ts`) loads the bundled files and asks the server
(`/api/data?name=…`, whitelist `DATA_FILES`) for refreshed ones; it uses the refreshed set only if
its `collections.generatedAt` is **strictly newer**. A partial `--only` build keeps the other
domains' collection groups.

## Weekly update (src/lib/updater.ts → runUpdate)

Runs a few seconds after start-up if 7 days have passed since `meta.lastRefreshAt` (1 day after
a failed attempt); **check now** forces it.

1. `POST /api/refresh` asks the server to rebuild; it only starts if its catalogs are ≥ 6.5 days
   old (or `?force=1` from localhost / with `MEDLEY_ADMIN_TOKEN`), runs in the background, and
   the client polls `GET /api/refresh` every 15 s. A hosted server also rebuilds on its own
   schedule. Then: reload catalogs → `syncLibraryMeta()` (kind, franchise, tags…).
2. New ids in subscribed collection groups (not seen before, not in the library). Unreleased
   ones stay "unseen" and are imported in the first update after their release date.
3. `importFailures` older than 7 days whose title is now released (`!isUpcoming`).
4. `runBulk(…, { announce: true })` imports 2 + 3 and records `meta.arrivals`.
5. `syncSources()` (src/lib/sync.ts): playlist sources of single-work imports not synced in
   7 days are re-read. New videos → new tracks; vanished → `unavailable`; renamed → retitled
   unless `customTitle`. New tracks are added to `arrivals`.

Unreleased titles: Discover hides them by default, and subscriptions wait for the release. If
you add one by hand anyway, whatever's on YouTube is used, and the weekly source sync adds the
playlist's new videos as it fills in. If nothing was found, it's retried weekly once released.
