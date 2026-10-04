# Operations

**Summary:** everything runs locally with `npm run dev`. Personal data goes in `config/` and
`.env.local` (both gitignored); the user's library is in the browser and moves via backup files.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | App + API on http://localhost:5173 |
| `npm start` | Production build served by `vite preview` on :5174 (API included) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run catalog` | Rebuild `src/data/*.json` from Wikidata/SteamSpy (≈2 min, +≈30 min first time for Steam keywords) |
| `npm run import-all` | Headless bulk import of all collections + starter pack → `vgm-library.json` (needs `npm run dev` running) |
| `npx tsx scripts/import-headless.ts --groups mine,nintendo --out file.json` | Limit to groups; re-run to resume; `--retry-failed` retries games that found nothing |
| `node scripts/enrich-catalog.mjs --out data/x.json` | Re-run only the enrichment step on the current catalog |

## Personal configuration (never committed)

| File | Purpose | Template |
|---|---|---|
| `config/my-games.json` | Your own games with fixed YouTube sources (e.g. Roblox games) | `config/my-games.example.json` |
| `.env.local` | Optional `STEAM_API_KEY` for loading a Steam library by profile URL | `.env.example` |

## Moving a library

The library lives in the browser's IndexedDB (per browser, per origin). **Add link → Backup**
exports/imports a JSON file containing games, tracks, sources, plays and `meta`. The headless
importer produces the same format.

## Steam library import

Keyless: open `https://steamcommunity.com/my/games/?tab=all&xml=1` while logged in, paste it (or
save and choose the file) under **Add link → Import your Steam library**. Page text or a list of
names also work. Matching: Steam app id → catalog / Wikidata P1733 → name.

## Troubleshooting

- *Imports all fail with "fetch failed"*: YouTube unreachable or the server restarted mid-run.
  Retry; see [gotchas.md](gotchas.md).
- *Covers missing*: the catalog in use isn't enriched. Run `npm run catalog`, or delete stale
  `data/catalog.json` so the bundled one wins.
- *Nothing plays*: check the Listen filters ("reset filters" link) and that games are enabled.
