# AGENTS.md: start here

**Medley** (formerly VGM Shuffle) is a personal music radio: a local web app that plays music
through YouTube's embedded player, with its own shuffle algorithm. Four domains, each with its
own catalog and importer: **games** (~4,400, Wikidata + Steam), **anime** (1,200, AniList +
AnimeThemes OP/ED data), **film & TV** (~3,900, Wikidata) and **artists** (~1,600 + live
MusicBrainz search). Internally a "game" (`Game`, `CatalogGame`) means any *work*, whatever its
`kind`.

Storage is named `medley` (IndexedDB) and `medley:*` (localStorage). Libraries from before the
rename are copied over once on load (`src/migrate.ts`); the old `vgm-shuffle` copies stay as a backup.

This file is the 2-minute orientation. **Before your first change, read
[docs/development.md](docs/development.md)**: how to verify changes without a test suite, the
conventions (wording, track ids, mobile CSS), and the product decisions already made with the
owner. For anything user-facing, also [docs/ux.md](docs/ux.md): the pages and how they link. Then go deeper through [docs/README.md](docs/README.md), which lists every doc with a
one-line summary. Read only what your task needs.

## Run it

```bash
npm install
npm run dev          # http://localhost:32123 (Vite + a small API middleware for YouTube/Steam)
npm run typecheck    # tsc --noEmit: the only automated check; run it after every change
```

There is no test suite. Verify behaviour in the browser (the app logs nothing on success).

## Map

| Path | What lives there |
|---|---|
| `src/` | React 19 + TypeScript client. Entry `main.tsx` (storage migrations, sign-in gate) → `App.tsx` (Home via the logo; tabs: Discover, Listen, Library, Add link) |
| `src/lib/` | Logic without UI: shuffle (`picker.ts`), importing (`importer.ts`, `importers/anime.ts`, `importers/artist.ts`, `parse.ts`), catalog (`catalog.ts`), search, background jobs (`bulk.ts`, `updater.ts`, `sync.ts`) |
| `src/components/` | Views; `discover/` holds the cover-art browsing UI |
| `src/data/` | **Generated, committed** public catalogs (`catalog.json` games, `screen.json`, `anime.json`, `artists.json`, `collections.json`). Rebuilt by `npm run catalog` |
| `server/` | `/api/*` (`api.ts`: YouTube scraping + disk cache, Steam, MusicBrainz, refresh status, personal games; `auth.ts`: invite-only sign-in), mounted by `plugin.ts` in dev and `serve.ts` in production; `worker.ts` background refreshes |
| `scripts/` | `refresh.mjs` (the catalog refresh job), `paths.mjs` (data/config dirs), one builder per domain (`catalog-`, `screen-`, `anime-`, `artist-builder.mjs`, combined by `build-all.mjs`), shared Wikidata helpers (`wd.mjs`), enrichment, headless bulk importer |
| `config/` | Only templates (`my-games.example.json`, `invites.example.json`). Real personal config lives **outside the repo** (`scripts/paths.mjs`) |
| `Dockerfile`, `docker-compose.yml` | Production image; web + worker sharing a data volume. See [docs/hosting.md](docs/hosting.md) |
| `docs/` | Everything else you need to know |

## Rules that matter

1. **Never commit personal or runtime data, and don't write it into the repo.** Runtime data and
   personal config go to `medleyPaths()` (`scripts/paths.mjs`: OS app folders, or
   `MEDLEY_DATA_DIR` / `MEDLEY_CONFIG_DIR`). `config/*` (except examples), `/data/`, `.env*`,
   backups and `steam-library.*` stay gitignored as a safety net. The user's library lives in
   their browser's IndexedDB, never in the repo.
2. **No API keys are required for anything core.** Keep it that way. Optional keys go in `.env.local`
   (see `.env.example`) and features must degrade gracefully without them.
3. **The YouTube reader is scraping** (`server/youtube.ts`). It parses YouTube's embedded JSON
   structurally. If imports break, look there first: [docs/youtube-import.md](docs/youtube-import.md).
4. **Editing `server/*` or any `scripts/*.mjs` that the server imports (the builders, `wd.mjs`,
   `enrich.mjs`) restarts the dev server** (they're Vite config dependencies). In-flight imports then fail. Don't edit them while a bulk
   import runs.
5. Match the existing style: small modules, comments that explain *why*, CSS tokens in
   `src/styles.css` (`--bg`, `--accent`, …), no new dependencies without a good reason.
6. **Never edit regexes or template literals through `node -e`, heredocs or sed.** The shell
   eats backslashes and backticks. Use the Edit/Write tools.
7. Read [docs/gotchas.md](docs/gotchas.md) before debugging anything strange. Most past
   surprises are written down there.
