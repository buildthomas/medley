# Developing Medley

**Summary:** how to work on this codebase: the loop, how to verify each kind of change without a
test suite, the conventions that keep the UI and data consistent, and the product decisions
already made with the owner (so you don't re-litigate them). Read this before your first change.

## The loop

1. `npm run dev` → http://localhost:32123 (never another port: browser storage is per port).
2. Change code. Vite hot-reloads the client; editing `server/*` or a script the server imports
   restarts the dev server (in-flight imports then fail; that's expected).
3. `npm run typecheck` after every change. It's the only automated check.
4. Verify the behaviour (below), at desktop width **and** at 375 px (phone).
5. Update the docs you touched (`docs/*.md`, README for user-visible features). Commit with a
   message that says what changed for the user, not just the code.

## Verifying changes (there is no test suite)

| Change | How to check it |
|---|---|
| UI | The running app at desktop width and at 375×812. Check `document.documentElement.scrollWidth === innerWidth` (no sideways scrolling) |
| Importers (`src/lib/importer.ts`, `importers/*`) | `npx tsx scripts/try-import.ts import <kind> <title>` runs the real import against an in-memory database and prints every track with role/vocal/artist. `candidates` instead of `import` ranks playlists. Needs `npm run dev` running |
| Library logic (commitDraft, migrations, repairs) | A throwaway `.mts` script that imports `fake-indexeddb/auto`, then the app modules, seeds rows and prints the result. Put it in a gitignored folder inside the repo (packages must resolve), e.g. `data/`, and delete it after |
| Catalog builders | Run one builder alone (`npm run catalog -- --only anime`) and inspect `src/data/*.json` with `node -e` |
| Server / hosting | `npm run build`, then run `node server/serve.ts` with `PORT=5190`, `MEDLEY_DATA_DIR`/`MEDLEY_CONFIG_DIR` pointing at temp folders (never the real ones), and probe with curl (`/api/session`, `/healthz`). Add an `invites.json` there to test sign-in; `MEDLEY_ROLE=web` + `node server/worker.ts` for the split setup |
| CDN builds | `MEDLEY_ASSET_URL=https://cdn.example.com/x/ npx vite build --outDir <temp>` and read the emitted `index.html` |

The Claude desktop browser pane can't open Picture-in-Picture windows and doesn't draw while
hidden (no `requestAnimationFrame`); test the pop-out in Chrome/Edge.

## Conventions

- **Words:** Medley spans games, anime, film & TV and artists. User-facing text says "title(s)",
  or the kind's own word via `kindLabel(kind).one` / `titlesLabel(works)` (`src/lib/kinds.ts`:
  "12 films", "3 anime", "30 titles"). Never "game" outside game-only places (game collections,
  Steam import). In code, `Game`/`CatalogGame`/`gameId` mean any work; that's historical, keep it.
- **Track ids** are `videoId`, `videoId@start` (a slice of a long video), or `…~<gameId>` when the
  same video belongs to a second title (an artist's song that's also an anime opening). Nothing
  may parse ids; use the track's fields.
- **Re-imports merge, never clobber:** plays, likes and user-renamed titles (`customTitle`) are
  kept; better metadata from the new import (role, seq, artist, vocal) is taken.
- **Data placement:** runtime data and personal config only through `medleyPaths()`; writes the
  server reads concurrently go through `writeFileAtomic` (`scripts/fsutil.mjs`).
- **CSS:** tokens on `:root` in `src/styles.css`; no hard-coded colours. Mobile rules:
  - grid/flex children that hold scrolling rows need `min-width: 0` (otherwise the page widens);
  - nothing hover-only: `@media (hover: none)` shows hover affordances;
  - inputs are 16 px on touch screens (iOS zooms otherwise);
  - honour `env(safe-area-inset-*)` for fixed elements;
  - the YouTube player is never smaller than 200×200 CSS px and never hidden while it plays.
- **Icons in round buttons** are SVG (`src/components/icons.tsx`), not text glyphs.
- **Escaping:** never edit regexes or template literals through `node -e`, heredocs, sed or
  Python strings in the shell; `\b` turns into a backspace (0x08). Use the editor tools, or
  write the patch script to a file first. Check: `grep -rlc $'\x08' src scripts server`.
- **Comments** explain why, not what. Small modules. No new dependencies without a strong reason
  (the server has none at runtime).

## Decisions already made (with the owner)

| Decision | Why |
|---|---|
| YouTube embedded player for all playback; scraping for metadata, **no YouTube API key** | Keyless; the API quota (≈100 searches/day) can't support bulk imports |
| Library in the browser (IndexedDB), not on a server | Personal, private, no accounts; Backup/Restore moves it |
| Code only in the repo; data in OS app folders (`MEDLEY_DATA_DIR`, `MEDLEY_CONFIG_DIR`) | Owner's explicit rule; also what hosting needs |
| Port 32123 (the logo's bar heights 3-2-1-2-3), `strictPort` | Memorable; a port change empties the library (per-origin storage) |
| Browser-native over separate apps (Document PiP pop-out, Media Session) | An Electron companion was built and removed: not worth a second install |
| Pop-out is desktop-only; phones use the OS lock-screen controls | Mobile best practice; Document PiP doesn't exist on phones |
| No background playback on phones; resume when you come back | YouTube pauses embeds when the page is hidden (background play is a Premium feature); fighting it would break their terms |
| Hosting, if ever: private / invite-only, cover images hot-linked (never re-hosted) | Copyright and YouTube terms; see hosting.md |
| Discover is the default tab; the logo opens Home (pitch + sign-in on hosted) | Owner's request |
| Mood/energy tags: not now | Owner deferred it |

## Where to add things

- **A new domain** (e.g. classical): a builder in `scripts/` returning `{ items, groups }`, wired
  into `scripts/build-all.mjs` and `DATA_FILES`; a `kind` in `src/lib/kinds.ts` and `WorkKind`;
  loading in `src/lib/catalog.ts` (`DOMAIN_FILES`); an importer in `src/lib/importers/` dispatched
  from `autoAddGame`; a Discover domain tab and shelves in `DiscoverView.tsx`.
- **A Listen filter:** the field on `Filters` (`src/types.ts`), the check in `gamePasses` /
  `trackPasses` (`src/lib/picker.ts`), a section in `FiltersPanel.tsx`.
- **An API route:** `server/api.ts` (it is behind sign-in automatically when hosted); a client
  wrapper in `src/lib/api.ts`; cache it with `cached()` if it calls YouTube/MusicBrainz.
- **A library schema change:** a new `db.version(n)` in `defineSchema` (`src/db.ts`); never edit
  old versions. Optional, unindexed fields need no version bump.
- **Start-up repairs/migrations:** `syncLibraryMeta()` (`src/lib/updater.ts`) runs on every
  start; keep repairs idempotent and cheap.
