# UI

**Summary:** four tabs in `App.tsx`: Discover (default; the logo links to it), Listen, Library,
Add link. The Listen view (player) stays mounted on every tab and
docks as a mini player, so music never stops. Discover is the cover-art browser (shelves,
grid with facets, franchises, game detail modal). Styling is plain CSS with design tokens;
dark by default with a light theme via `prefers-color-scheme`.

## Tabs

| Tab | Component | Notes |
|---|---|---|
| Listen | `ListenView` + `FiltersPanel` | Player, now-playing (cover, store link), controls incl. volume, up next, recent. Filters sidebar |
| Library | `LibraryView` | Per-work rows (cover, enable toggle), expandable track editor (rename, tags, like/ban, remove) |
| Discover | `DiscoverView` + `discover/*` | Domain tabs (*Everything, Games, Anime, Film & TV, Artists*) × modes *For you* (shelves), *Browse all* (grid + facets), *Series & franchises*. Search also lists matching library tracks and MusicBrainz artists |
| Add link | `AddView`, `SongImport`, `SteamImport` | Paste YouTube links (review draft before saving), add a single song, Steam library import, backup/restore |

In Listen, the playing work's title and cover open its `GameDetail` in place (tags inside it
jump to Discover via a facet intent, `requestDiscover(…, facet)`).
`NewArrivals` (banner on Listen and Discover) shows `meta.arrivals` until dismissed.
`PopOutPlayer` provides the ⧉ Document Picture-in-Picture mini player.

`BulkStatus` sits under the top bar on all tabs while a bulk import runs.

## Discover building blocks (src/components/discover/)

- `Cover`: portrait 2:3 image; walks `covers[]` on error; square art gets `fit-contain` with a
  blurred backdrop; no image → deterministic gradient placeholder with the title. PNG/GIF/WebP/SVG
  and Roblox covers are sampled on a 48 px canvas (`analyseBackdrop`): if > 15% is transparent,
  the opaque pixels' brightness picks a light (`logo-on-light`) or dark backdrop, cached in
  localStorage.
- `GameTile`: cover + title (kind icon on *Everything*; artists get a round photo); hover shows
  **+** (auto-add) or **▶**. Unreleased titles get a *Soon* ribbon and no add button; they're
  hidden unless **Show unreleased** is on.
- `Shelf`: titled horizontal scroller with arrow buttons.
- `FranchiseCard`: three covers fanned like playing cards.
- `GameDetail`: modal with the cover's credit under it (`lib/credits.ts`: photographer and
  license for Commons photos from the catalog's `coverCredit`, otherwise the source from the URL), ▶ Play (in order) / ⤮ Shuffle (a session *program*), Remove, a
  per-kind credit line, tags (clickable → browse filter), keywords, links, the anime
  *Openings & endings* list, the track list with role tags, change source.
- `Collections`: collection groups (filtered by domain tab) with per-list chips and the weekly
  auto-add checkbox.

Shelves on *For you* are computed once per catalog load (random throwback year / console),
not on every render.

## Styling

- Brand: **Medley**. Logo = `components/Logo.tsx` (five equalizer bars tracing an "M", with
  the brand gradient; they bounce while `<html data-playing>`), favicon = `public/favicon.svg`
  (same drawing, keep in sync). Wordmark: lowercase "medley", 800 weight, tight tracking.
- Tokens on `:root` in `src/styles.css`: `--bg` (aubergine ink), `--bg-raised`, `--bg-sunken`,
  `--line`, `--text`, `--muted`, `--accent` (coral), `--accent-ink`, `--accent-soft`,
  `--brand-1..3` + `--brand-gradient` (coral → magenta → violet), `--good`, `--bad`. Light theme
  via `prefers-color-scheme`. Use them; don't hard-code colours.
- `src/discover.css` holds Discover/tile/modal styles; `src/styles.css` everything else.
- Layout must work at 375 px wide (16 px gutters); media queries at 1000/760/700 px.

## Keyboard (ListenView)

Space play/pause · N/→ skip · P/← back · L like · B never · ↑/↓ volume (Listen tab only) ·
M mute. Ignored while typing in inputs. Headset/keyboard media keys (play/pause, next, previous)
work through the Media Session API; see [shuffle.md](shuffle.md).

## Discover header

One row: domain tabs + search; below it the view switch (For you / Browse all / Series),
*Show unreleased* and the title count. No hero text: shelves start above the fold.

## Player details

- The YouTube iframe runs with `controls: 0, fs: 0, disablekb: 1, iv_load_policy: 3`: our own
  controls replace YouTube's. Its title bar and logo can't be hidden any more.
- The docked mini player keeps the video at least 200×200 CSS px (YouTube's minimum): 376 px
  wide on desktop; full width with a 200 px floor on phones (volume slider and duplicate cover
  hidden there to keep it to one row).
- The pop-out (`PopOutPlayer.tsx`) is a fixed 360×132 card with SVG icons (`icons.tsx`; text
  glyphs never centre). Browsers don't allow non-resizable PiP windows: it snaps back where
  allowed, and the card stays centred at its size otherwise.

## Installable app and storage

`public/manifest.webmanifest` + icons (`npm run icons`) make Medley installable. On start-up it
asks for persistent storage once a library exists (`lib/storage.ts`); the Backup card shows the
status and usage, with a button to ask again.

## Sign-in (hosted only)

`SignIn.tsx` replaces the app when `/api/session` says sign-in is required and nobody is signed
in; a 401 from any API call reloads into it. The Backup card shows who's signed in and *Sign out*.
