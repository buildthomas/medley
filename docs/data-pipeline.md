# Data pipeline: catalog, collections, refresh

**Summary:** `scripts/catalog-builder.mjs` queries Wikidata and SteamSpy to decide which games
exist and which collections they're in, then `scripts/enrich.mjs` adds covers, tags, keywords and
store links. The output is committed as `src/data/*.json` and refreshed monthly at runtime into
`data/*.json`. Personal games come from `config/my-games.json` and are merged in by the client.
No API keys anywhere.

## Sources

| Data | Source | Notes |
|---|---|---|
| Games, years, genres, series, franchise, composers, platforms, modes, developer/publisher, store ids | Wikidata SPARQL (`query.wikidata.org`) | Labels: take `en`, fall back to `mul` (see gotchas) |
| Popularity | Wikidata sitelink count | Number of Wikipedia language editions |
| Indie hits | SteamSpy `request=tag&tag=Indie` | Ranked by positive reviews; mapped to Wikidata via Steam app id (P1733) |
| Keywords | SteamSpy `request=appdetails` | ~1 req/s limit → cached in `data/cache/steamspy-tags.json` |
| Covers | Steam `library_600x900.jpg` CDN; Wikipedia `pageimages` (`pilicense=any` for non-free box art); Roblox thumbnails API | Stored as an ordered `covers[]` fallback list |

## Build steps (catalog-builder.mjs → buildCatalog)

1. **Base catalog:** every `wdt:P31 wd:Q7889` (video game) with ≥ 12 sitelinks (~4,000).
2. **Nintendo first-party:** publisher Nintendo (Q8093) or The Pokémon Company (Q1036616), per
   console (table `NINTENDO_CONSOLES`). Games first released before a console's launch year are
   dropped from that console's list (Virtual Console / NSO re-releases).
3. **Biggest per year:** for each year 2010 → now, top 40 by sitelinks (min 8).
4. **Indie per year:** SteamSpy indie apps with ≥ 1,500 positive reviews → Wikidata → top 15 per year.
5. **Details** for all ids in 200-id batches (title, year, genres, series, composers, steam id).
6. **Enrich** (`enrich.mjs`): tags & franchise (one batched query over many properties), store
   links + enwiki title, Wikipedia covers (50 titles per request), Roblox icons, Steam keywords.
7. Return `{ catalog, collections }`. `collections.generatedAt` is a full ISO timestamp.

Tunables are constants at the top of `catalog-builder.mjs` (`MIN_LINKS`, `PER_YEAR`, …).

## Where the output goes

| Run by | Writes | Committed? |
|---|---|---|
| `npm run catalog` (`scripts/build-catalog.mjs`) | `src/data/catalog.json`, `collections.json` | Yes: the out-of-the-box catalog |
| Monthly refresh (`POST /api/refresh`) | `data/catalog.json`, `collections.json`, `my-games.json` | No |
| `scripts/enrich-catalog.mjs` | Re-enriches an existing catalog file | Only if you copy it to `src/data` |

The client (`src/lib/catalog.ts`) loads the bundled files and asks the server for refreshed ones;
it uses the refreshed copy only if its `generatedAt` is **strictly newer**.

## Personal games (`config/my-games.json`)

Gitignored. Format: `config/my-games.example.json` (a `CatalogGame` with `sources`). Served by
`GET /api/my-games`, with Roblox covers swapped for the refreshed ones from `data/my-games.json`
(Roblox icon URLs expire after ~180 days). On start-up, `ensureMyGames()` imports each entry once.

## Monthly refresh (src/lib/updater.ts → monthlyUpdate)

Runs 4 s after app start. If 30 days have passed since `meta.lastRefreshAt` (and 1 day since the
last failed attempt): `POST /api/refresh` → reload catalog → `syncLibraryMeta()` → find ids in
subscribed collection groups that aren't in `meta.seenCollectionIds` or the library → `runBulk`.
First launch only starts the clock. **check now** under Discover → Collections forces it.

The first refresh after a clean checkout is slow (~30 min) because Steam keywords aren't cached
yet; later ones fetch only new games.
