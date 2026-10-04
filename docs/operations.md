# Operations

**Summary:** `npm run dev` runs everything locally; `npm run serve` is the production server
([hosting.md](hosting.md)). Runtime data and personal config live in OS app folders outside the
repo (`scripts/paths.mjs`); the user's library is in the browser and moves via backup files.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | App + API on http://localhost:5173 |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run serve` | Production server (`server/serve.ts`: `dist/` + API) on :5174. `npm start` = build + serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run companion:install`, `npm run companion` | Install (once) and start the desktop companion (`companion/`) |
| `npm run catalog` | Rebuild all `src/data/*.json` (≈30–40 min; +≈30 min the first time for Steam keywords) |
| `npm run catalog -- --only anime,artists` | Rebuild some domains (`games`, `screen`, `anime`, `artists`); other domains' collections are kept |
| `npm run import-all` | Headless bulk import of all collections + starter pack → `medley-library.json` in the data dir (needs `npm run dev` running) |
| `npx tsx scripts/import-headless.ts --groups mine,nintendo --out file.json` | Limit to groups; re-run to resume; `--retry-failed` retries games that found nothing |
| `npx tsx scripts/try-import.ts import anime frieren` | Try an importer on one title without touching your library (`candidates` instead of `import` lists ranked playlists) |
| `node scripts/enrich-catalog.mjs --out x.json` | Re-run only the enrichment step on the current catalog |

## Where things are stored

| What | Where (Windows · macOS · Linux) | Override |
|---|---|---|
| Refreshed catalogs, caches, headless-import output | `%LOCALAPPDATA%\Medley\data` · `~/Library/Application Support/Medley/data` · `~/.local/share/medley` | `MEDLEY_DATA_DIR` |
| `my-games.json` (your own games) | `%APPDATA%\Medley` · `~/Library/Application Support/Medley/config` · `~/.config/medley` | `MEDLEY_CONFIG_DIR` |
| Companion settings (server URL, key, window position) | `%APPDATA%\medley-companion` · `~/Library/Application Support/medley-companion` · `~/.config/medley-companion` | `MEDLEY_COMPANION_PROFILE` |
| Your library | The browser's IndexedDB (per browser, per site address) | Backup / Restore |
| Secrets for dev | `.env.local` in the repo (gitignored): optional `STEAM_API_KEY` | Env vars when hosted |

The dev server prints both directories on start. Older checkouts' `./data` and
`./config/my-games.json` are moved there automatically (never overwriting).
Template for your games: `config/my-games.example.json`.

## Moving a library

**Add link → Backup** exports/imports a JSON file containing games, tracks, sources, plays and
`meta`. The headless importer produces the same format.

## Steam library import

Keyless: open `https://steamcommunity.com/my/games/?tab=all&xml=1` while logged in, paste it (or
save and choose the file) under **Add link → Import your Steam library**. Page text or a list of
names also work. Matching: Steam app id → catalog / Wikidata P1733 → name.

## Desktop companion

1. In Medley: **Add link → Desktop companion**, tick the box, copy the code (`<site URL>#<key>`).
2. `npm run companion:install` once (downloads Electron into `companion/node_modules`), then
   `npm run companion` and paste the code. It remembers it. `npm run companion -- --connect=<code>`
   also works.
3. The window stays on top (📌 toggles), drags anywhere, and has a tray icon. Keys: Space, ←/→, L.
   Clicking the cover opens Medley in your browser.

Medley must be open in a browser tab; the companion shows and controls that tab's player.
**new code** in the card disconnects old companions.

## Troubleshooting

- *Imports all fail with "fetch failed"*: YouTube unreachable or the server restarted mid-run.
  Retry; see [gotchas.md](gotchas.md).
- *Covers missing*: the catalog in use isn't enriched. Run `npm run catalog`, or delete a stale
  `catalog.json` from the data dir so the bundled one wins.
- *Nothing plays*: check the Listen filters ("reset filters" link) and that games are enabled.
- *Companion says "Waiting for Medley"*: no browser tab has Medley open with the companion
  setting on (it's per browser), or the code was renewed.
