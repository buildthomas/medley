# AGENTS.md: start here

**Medley** (formerly VGM Shuffle) is a personal music radio: a local web app that plays music
through YouTube's embedded player, with its own shuffle algorithm. Four domains, each with its
own catalog and importer: **games** (~4,400, Wikidata + Steam), **anime** (1,200, AniList +
AnimeThemes OP/ED data), **film & TV** (~3,900, Wikidata) and **artists** (~1,600 + live
MusicBrainz search). Internally a "game" (`Game`, `CatalogGame`) means any *work*, whatever its
`kind`.

Storage keys still say `vgm-shuffle` (IndexedDB name, `vgm-shuffle:*` localStorage keys) on
purpose: renaming them would orphan existing libraries.

This file is the 2-minute orientation. Go deeper through [docs/README.md](docs/README.md), which
lists every doc with a one-line summary. Read only what your task needs.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173 (Vite + a small API middleware for YouTube/Steam)
npm run typecheck    # tsc --noEmit: the only automated check; run it after every change
```

There is no test suite. Verify behaviour in the browser (the app logs nothing on success).

## Map

| Path | What lives there |
|---|---|
| `src/` | React 19 + TypeScript client. Entry `main.tsx` → `App.tsx` (tabs: Listen, Library, Discover, Add link) |
| `src/lib/` | Logic without UI: shuffle (`picker.ts`), importing (`importer.ts`, `importers/anime.ts`, `importers/artist.ts`, `parse.ts`), catalog (`catalog.ts`), search, background jobs (`bulk.ts`, `updater.ts`, `sync.ts`) |
| `src/components/` | Views; `discover/` holds the cover-art browsing UI |
| `src/data/` | **Generated, committed** public catalogs (`catalog.json` games, `screen.json`, `anime.json`, `artists.json`, `collections.json`). Rebuilt by `npm run catalog` |
| `server/` | Vite plugin serving `/api/*`: keyless YouTube scraping, Steam, MusicBrainz artist search, catalog refresh, personal games |
| `scripts/` | One builder per domain (`catalog-`, `screen-`, `anime-`, `artist-builder.mjs`, combined by `build-all.mjs`), shared Wikidata helpers (`wd.mjs`), enrichment, headless bulk importer |
| `config/` | **Personal, gitignored** (`my-games.json`); only `*.example.json` is committed |
| `data/` | **Runtime, gitignored**: weekly-refreshed catalogs, Steam keyword cache |
| `docs/` | Everything else you need to know |

## Rules that matter

1. **Never commit personal or runtime data.** `config/*` (except examples), `/data/`, `.env*`,
   `vgm-library*.json`, `steam-library.*` are gitignored on purpose. The user's library lives in
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
