# Pages, primitives and links

**Summary:** Medley's user-facing model. Four primitives (title, track, list, tag), a handful of
pages, and one rule: every mention of a title or track opens its page, every tag opens Discover
filtered by it. Navigation is `src/lib/nav.ts`. Keep new features inside this model.

## Primitives

| Primitive | What it is | Its page |
|---|---|---|
| **Title** | A game, anime, film or series (`CatalogGame` / library `Game`, by `kind`) | Title page (`GameDetail.tsx`) |
| **Track** | One playable song or cue in your library (`Track`) | Track page (`TrackDetail.tsx`) |
| **List** | A curated group of titles: a collection list, a shelf, a franchise/series, "What's new" | Discover → Browse, focused on the list |
| **Tag** | A property titles share: composer, studio, developer, publisher, genre, platform, keyword, franchise | Discover → Browse, filtered by the tag |

User-facing words: "title(s)" or the kind's own word (`kindLabel`, `titlesLabel` in
`src/lib/kinds.ts`); never "game" for something that may not be one.

## Pages

| Page | Job | Reached from |
|---|---|---|
| **Home** | What Medley is; sign-in on a hosted Medley | The logo; the only page when signed out (hosted) |
| **Discover** (tab, default) | Find titles: shelves per domain, Browse with filters, Series & franchises, search (titles incl. aliases and "FFVII"-style abbreviations, your tracks) | Tab; any tag or list link |
| **Title page** (overlay) | What the title is (credits, tags, links, cover credit), its tracks *with labels*, add / play / shuffle / remove / change source; tracks grouped by version (game platforms, anime songs vs score); *Add a version*; anime songs list | Any title mention (tile, now playing, a track's "from", track rows' title, Library row, artist credits) |
| **Track page** (overlay) | Everything about one track: labels (kind & number, voice, types: editable), length, play stats, source, play / like / never / rename, *Wrong video?* (swap the upload), links to its title and credited artists | Any track name (title page, up next, recently played, program, search results, now playing, Library ⓘ) |
| **Listen** (tab) | Now playing, up next, program, recently played, filters | Tab; ⤢ on the docked player |
| **Library** (tab) | Everything you own, in bulk: Titles and Tracks views, filters, play the filtered set, rotation switches, edit details | Tab |
| **Add link** (tab) | Bring music in: YouTube links, a single song, anime openings lists, Steam; backup, storage, sign-out | Tab |

## Links (the rule)

- **Title mentions** → `openTitle(id)`. **Track names** → `openTrack(id)`. **Tags and lists** →
  `openTag(kind, value)` / Discover intents (`src/lib/intents.ts`).
- **Play is always an explicit control** (▶), never the side effect of clicking a name: names
  navigate, ▶ plays. This holds in every list (`TrackRow.tsx`).
- **Overlays stack and live in the URL:** `?open=title:Q123|track:abc` with real history entries,
  so Back / Android back closes the top page, reloading keeps it, and it can be shared. Opening a
  page already in the stack returns to it instead of looping.
- **Overlays sit over any tab** (`Overlays.tsx` in `App`), so opening a title never loses your
  place in Discover, Listen or Library, and playback continues.

## Journeys this supports

1. *Find & add:* Discover → title page → Add → ▶ Play / ⤮ Shuffle.
2. *"What is this?" while listening:* now-playing track name → track page → its title → a
   composer/series tag → more like it in Discover.
3. *Curate:* Library → a title's page (Open page) or a track (ⓘ) → fix labels / never play /
   rename.
4. *Fix a mislabelled song:* any list → track name → Labels (kind OP/ED + number, sung/instrumental,
   types). Labels drive the Listen filters.
5. *Search:* Discover search → titles (tiles), your tracks (rows: ▶ or open).
6. *Listen to part of your library:* Library → filter (kind, status, OP/ED, sung…) → ▶ Play / ⤮ Shuffle.

## Adding UI

- A new list of tracks → use `TrackRow` (labels, links and ▶ come for free).
- A new place that mentions a title or track → link it with `openTitle` / `openTrack`.
- A new page type → add it to `Page` in `nav.ts`, render it in `Overlays.tsx`, document it here.
