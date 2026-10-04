# UI

**Summary:** four tabs in `App.tsx`. The Listen view (player) stays mounted on every tab and
docks as a mini player, so music never stops. Discover is the cover-art browser (shelves,
grid with facets, franchises, game detail modal). Styling is plain CSS with design tokens;
dark by default with a light theme via `prefers-color-scheme`.

## Tabs

| Tab | Component | Notes |
|---|---|---|
| Listen | `ListenView` + `FiltersPanel` | Player, now-playing (cover, store link), controls incl. volume, up next, recent. Filters sidebar |
| Library | `LibraryView` | Per-game rows (cover, enable toggle), expandable track editor (rename, tags, like/ban) |
| Discover | `DiscoverView` + `discover/*` | Modes: *For you* (shelves), *All games* (grid + facets), *Series & franchises* |
| Add link | `AddView`, `SteamImport` | Paste YouTube links (review draft before saving), search playlists, Steam library import, backup/restore |

`BulkStatus` sits under the top bar on all tabs while a bulk import runs.

## Discover building blocks (src/components/discover/)

- `Cover`: portrait 2:3 image; walks `covers[]` on error; square art gets `fit-contain` with a
  blurred backdrop; no image → deterministic gradient placeholder with the title.
- `GameTile`: cover + title; hover shows **+** (auto-add) or **▶** (play a random track).
- `Shelf`: titled horizontal scroller with arrow buttons.
- `FranchiseCard`: three covers fanned like playing cards.
- `GameDetail`: modal with tags (clickable → browse filter), keywords, store links, soundtrack
  list, change source.
- `Collections`: collection groups with per-list chips and the monthly auto-add checkbox.

Shelves on *For you* are computed once per catalog load (random throwback year / console),
not on every render.

## Styling

- Tokens on `:root` in `src/styles.css`: `--bg`, `--bg-raised`, `--bg-sunken`, `--line`, `--text`,
  `--muted`, `--accent` (amber), `--accent-soft`, `--good`, `--bad`. Use them; don't hard-code colours.
- `src/discover.css` holds Discover/tile/modal styles; `src/styles.css` everything else.
- Layout must work at 375 px wide (16 px gutters); media queries at 1000/760/700 px.

## Keyboard (ListenView)

Space play/pause · N/→ skip · P/← back · L like · B never · ↑/↓ volume (Listen tab only) ·
M mute. Ignored while typing in inputs.
