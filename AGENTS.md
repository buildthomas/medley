# AGENTS.md: start here

**VGM Shuffle** is a personal video game music radio: a local web app that plays game
soundtracks through YouTube's embedded player, with its own shuffle algorithm, a catalog of
~4,400 games (Wikidata + Steam data), and one-click soundtrack import from YouTube.

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
| `src/lib/` | Logic without UI: shuffle (`picker.ts`), importing (`importer.ts`, `parse.ts`), catalog (`catalog.ts`), search, background jobs |
| `src/components/` | Views; `discover/` holds the cover-art browsing UI |
| `src/data/` | **Generated, committed** public catalog (`catalog.json`, `collections.json`). Rebuilt by `npm run catalog` |
| `server/` | Vite plugin serving `/api/*`: keyless YouTube scraping, Steam, catalog refresh, personal games |
| `scripts/` | Catalog builder (Wikidata + SteamSpy + Wikipedia), enrichment, headless bulk importer |
| `config/` | **Personal, gitignored** (`my-games.json`); only `*.example.json` is committed |
| `data/` | **Runtime, gitignored**: monthly-refreshed catalog, Steam keyword cache |
| `docs/` | Everything else you need to know |

## Rules that matter

1. **Never commit personal or runtime data.** `config/*` (except examples), `/data/`, `.env*`,
   `vgm-library*.json`, `steam-library.*` are gitignored on purpose. The user's library lives in
   their browser's IndexedDB, never in the repo.
2. **No API keys are required for anything core.** Keep it that way. Optional keys go in `.env.local`
   (see `.env.example`) and features must degrade gracefully without them.
3. **The YouTube reader is scraping** (`server/youtube.ts`). It parses YouTube's embedded JSON
   structurally. If imports break, look there first: [docs/youtube-import.md](docs/youtube-import.md).
4. **Editing `server/*` or `scripts/catalog-builder.mjs` / `enrich.mjs` restarts the dev server**
   (they're Vite config dependencies). In-flight imports then fail. Don't edit them while a bulk
   import runs.
5. Match the existing style: small modules, comments that explain *why*, CSS tokens in
   `src/styles.css` (`--bg`, `--accent`, …), no new dependencies without a good reason.
6. Read [docs/gotchas.md](docs/gotchas.md) before debugging anything strange. Most past
   surprises are written down there.
