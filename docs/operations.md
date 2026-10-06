# Operations

**Summary:** `npm run dev` runs everything locally; `npm run serve` is the production server
([hosting.md](hosting.md)). Runtime data and personal config live in OS app folders outside the
repo (`scripts/paths.mjs`); the user's library is in the browser and moves via backup files.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | App + API on http://localhost:32123 (the logo: bars 3-2-1-2-3) |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run serve` | Production server (`server/serve.ts`: `dist/` + API) on :32123. `npm start` = build + serve |
| `npm run worker` | Background worker for hosting with separate processes (`server/worker.ts`) |
| `npm run refresh` | One catalog refresh if they're a week old (`--force` always); for cron |
| `npm run icons` | Regenerate the PNG app icons in `public/` from the logo geometry |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run catalog` | Rebuild all `src/data/*.json` (≈30–40 min; +≈30 min the first time for Steam keywords) |
| `npm run catalog -- --only games,anime` | Rebuild some domains (`games`, `screen`, `anime`); other domains' collections are kept |
| `npm run eval:imports` | Import quality check: imports ~80 works in memory and lists what changed since the last run (see development.md, *Import evals*; needs `npm run dev`) |
| `npm run import-all` | Headless bulk import of all collections + starter pack → `medley-library.json` in the data dir (needs `npm run dev` running) |
| `npx tsx scripts/import-headless.ts --groups mine,nintendo --out file.json` | Limit to groups; re-run to resume; `--retry-failed` retries games that found nothing |
| `npx tsx scripts/try-import.ts import anime frieren` | Try an importer on one title without touching your library (`candidates` instead of `import` lists ranked playlists) |
| `node scripts/enrich-catalog.mjs --out x.json` | Re-run only the enrichment step on the current catalog |

## Where things are stored

| What | Where (Windows · macOS · Linux) | Override |
|---|---|---|
| Refreshed catalogs, caches, headless-import output | `%LOCALAPPDATA%\Medley\data` · `~/Library/Application Support/Medley/data` · `~/.local/share/medley` | `MEDLEY_DATA_DIR` |
| `my-games.json`, `invites.json`, `medley.env` (hosting settings) | `%APPDATA%\Medley` · `~/Library/Application Support/Medley/config` · `~/.config/medley` | `MEDLEY_CONFIG_DIR` |
| Your library | The browser's IndexedDB (per browser, per site address) | Backup / Restore |
| Hosting settings for local testing | `.env.local` in the repo (gitignored) | Env vars when hosted |

The dev server prints both directories on start. Older checkouts' `./data` and
`./config/my-games.json` are moved there automatically (never overwriting).
Template for your games: `config/my-games.example.json`.

## Moving a library

**Add link → Backup** exports/imports a JSON file containing games, tracks, sources, plays and
`meta`. The headless importer produces the same format.

## Troubleshooting

- *Imports all fail with "fetch failed"*: YouTube unreachable or the server restarted mid-run.
  Retry; see [gotchas.md](gotchas.md).
- *Covers missing*: the catalog in use isn't enriched. Run `npm run catalog`, or delete a stale
  `catalog.json` from the data dir so the bundled one wins.
- *Nothing plays*: check the Listen filters ("reset filters" link) and that games are enabled.
