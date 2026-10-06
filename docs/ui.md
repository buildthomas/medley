# UI

**Summary:** `App.tsx` has a Home page (the logo opens it: tagline, what Medley is, and on a
hosted Medley the sign-in form) and four tabs: Discover (the default), Listen, Library, Add link.
Every screen must work at 375 px wide; see *Phones* below. The Listen view (player) stays mounted on every tab and
docks as a mini player, so music never stops. Discover is the cover-art browser (shelves,
grid with facets, franchises, game detail modal). Styling is plain CSS with design tokens;
dark by default with a light theme via `prefers-color-scheme`.

## Tabs

| Tab | Component | Notes |
|---|---|---|
| Listen | `ListenView` + `FiltersPanel` | Player, now-playing (cover, store link), controls incl. volume, up next, recent. Filters sidebar |
| Library | `LibraryView` (see *Library* below) | Per-work rows (▶ plays its soundtrack in album order as a program, cover, enable toggle), expandable track editor (rename, tags, like/ban, remove) |
| Discover | `DiscoverView` + `discover/*` | Domain tabs (*Everything, Games, Anime, Film & TV*) × modes *For you* (shelves), *Browse all* (grid + facets), *Series & franchises*. Search also lists matching library tracks |
| Add link | `AddView`, `AnimeListImport` | Paste YouTube links (review draft before saving), search YouTube playlists, import an anime list, backup/restore |

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
- `GameTile`: cover + title (kind icon on *Everything*); hover shows
  **+** (auto-add) or **▶**. Unreleased titles get a *Soon* ribbon and no add button; they're
  hidden unless **Show unreleased** is on.
- `Shelf`: titled horizontal scroller with arrow buttons.
- `FranchiseCard`: three covers fanned like playing cards.
- `GameDetail` (the title page; opened app-wide via `lib/nav.ts`, rendered by `Overlays.tsx`):
  modal with the cover's credit under it (`lib/credits.ts`: photographer and
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

## Track pages and track rows

- `TrackDetail.tsx`: the track page (labels editable: kind/number, voice, types; facts; source;
  play/like/never/rename; links to its title and credited artists that are titles).
- `TrackRow.tsx`: every list of tracks (title pages, up next, program, recently played, search
  results): ▶ plays, the name opens the track, labels inline (`TrackLabels`), optional link to
  the title. The Library's editor keeps its table and adds ⓘ → track page and *Open page* per row.

See [ux.md](ux.md) for the navigation model.

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

## Home and sign-in

`Home.tsx` is the landing page: pitch, the four domains, features. Locally it offers *Discover
music* / *Start listening*. On a hosted Medley where `/api/session` says sign-in is required and
nobody is signed in, `main.tsx` renders only `Home` (logo, no tabs) with the sign-in form; a 401
from any API call reloads into it. The Backup card shows who's signed in and *Sign out*.

## Phones

- Docked player: a 200×200 video beside title and controls (~218 px tall); a slim bar when
  nothing is loaded. Volume slider hidden (hardware buttons), pop-out hidden (touch devices).
- Title pages are full-screen sheets; chip rows (domain tabs, view switch) scroll sideways; the
  new-arrivals banner is compact.
- Touch: hover affordances always visible, 16 px inputs, safe-area insets, no autofocus that
  would pop the keyboard.
- Playback stops when the phone locks or switches apps (YouTube's embed does that); when the page
  becomes visible again it resumes if it was playing and wasn't paused from the lock screen.

## Progress bar

The fill animates between the twice-a-second position updates, but snaps on jumps (a seek, a
new track): `transition: none` when the position moved more than 1.5 s. A click moves the bar
immediately instead of waiting for the next update.

## Library

`LibraryView.tsx`: a Titles / Tracks switch, search, and compact selects (kind, only when the
library spans several; status or labels; sort), a summary line with ▶ Play / ⤮ Shuffle for the
shown set (and, when filtered, *all in rotation* / *pause all*). Title rows: cover, name, kind ·
year · genres, track and play counts, an in-rotation switch, *Edit* (the inline editor for name,
year, genres and quick track edits). Clicking a row opens the title page. View, kind and sorts are
remembered per browser (`medley:library`).
