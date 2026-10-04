# VGM Shuffle

A video game music radio with your own shuffle algorithm instead of YouTube's recommendations.
Audio plays through YouTube's official embedded player. Everything else is local: what's in
rotation, how tracks are picked, and what you've liked or skipped.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

`npm start` builds and serves a production version on port 5174. The app needs its small local
server (built into Vite) to read YouTube metadata, so it is not a static site.

## Where the data comes from

| What | Source | Key needed? |
|---|---|---|
| Game catalog (~4,400 games with year, genres, series, composers, Steam id) | [Wikidata](https://www.wikidata.org), baked into `src/data/catalog.json` | No |
| Collections (Nintendo per console, top games per year, indie hits) | Wikidata + [SteamSpy](https://steamspy.com), in `src/data/collections.json` | No |
| Covers | Steam's 600×900 library art, Wikipedia infobox images, Roblox game icons | No |
| Tags: platforms, modes, full genre list, themes, developer, publisher, franchise | Wikidata | No |
| Keywords ("Atmospheric", "Story Rich", …) | Steam user tags via SteamSpy (cached in `data/cache/`) | No |
| Store links: Steam, GOG, Epic, Nintendo eShop, PlayStation Store, itch.io, Roblox, Wikipedia | Wikidata, `my-games.json` | No |
| Your Steam library | Paste of your Steam games page, matched via Wikidata | No (optional Steam Web API key) |
| Soundtrack playlists, video titles, durations, tracklists | YouTube pages, read by the local server (`server/youtube.ts`) | No |
| Playback | YouTube IFrame Player API | No |

Rebuild the bundled catalog and collections with `npm run catalog` (about two minutes). The
sizes (games per year, indie games per year, base catalog threshold) are constants at the top of
`scripts/catalog-builder.mjs`.

## Monthly auto-update

Shortly after the app starts, it checks whether 30 days have passed since the last update. If
they have:

1. The local server reruns the same catalog build (`POST /api/refresh` → `scripts/catalog-builder.mjs`)
   and writes the result to `data/` (outside `src/`, so nothing hot-reloads). The app then
   prefers `data/*.json` over the bundled copy.
2. Games that newly appear in a collection you've subscribed to are imported in the
   background. You subscribe by pressing **Add all**, or with the **auto-add new** checkbox.
   *My games* is subscribed by default.

If the refresh fails (offline, Wikidata down), it retries the next day. **check now** under the
collections forces an update. The bookkeeping (last update, subscriptions, games already seen)
lives in the library database, so it's included in backups.

## Importing everything at once

Importing ~1,500 games in the browser works but is slow if the tab is in the background (browsers
throttle hidden tabs). With the dev server running, this does the same import from the command
line and writes a library backup:

```bash
npm run import-all
```

Then use **Add link → Backup → Restore from file…** and pick `vgm-library.json`. Re-running the
command resumes where it stopped. Use `--groups mine,nintendo` to limit it to certain collections.

## My games

Your own games go in `config/my-games.json` (gitignored; copy `config/my-games.example.json`), each with fixed YouTube sources (playlist or
video links) instead of a search. New entries are imported automatically on the next app start
(each only once, so deleting one from the library sticks). They also form the *My games*
collection and get the genre you give them (e.g. "Roblox"), so you can filter to them in Listen.

The YouTube reader parses the JSON that YouTube embeds in its own pages. If YouTube changes its
markup and imports start failing, the parser in `server/youtube.ts` is the place to look.

## Using it

- **Discover** has three views:
  - *For you*: shelves of cover art, including what's related to what you actually listen to
    (same franchise, same composer), plus the year, indie and Nintendo lists and a random
    throwback. A **Series & franchises** shelf shows fanned-out covers per series.
  - *All games*: a filterable grid. Filter by genre, platform, mode, keyword, franchise,
    developer or composer (filters combine), plus era and in/not in library.
  - *Series & franchises*: every series with 3+ games.
  Hover a cover for **+** (find and add the soundtrack) or **▶** (play a track if it's in your
  library). Click it for the game page: cover, developer and publisher, composers, all tags and
  keywords (each clickable to filter), store links, and the soundtrack with per-track play buttons
  and **Change source**. **Starter pack** imports ~35 acclaimed soundtracks in one go.
- **Collections** (bottom of Discover → For you): one-click imports, each expandable into smaller lists:
  - *My games*: your own games from `config/my-games.json` (gitignored; copy `config/my-games.example.json`) (see above).
  - *Nintendo first-party*: everything published by Nintendo or The Pokémon Company (so partner
    studios like Game Freak, Retro, Monolith, Intelligent Systems are included), per console from
    NES to Switch 2. Re-releases on later consoles are left out of those consoles' lists.
  - *Biggest games by year*: the 40 most widely covered games of each year since 2010.
  - *Popular indie games by year*: the 15 indie games with the most positive Steam reviews from
    each year since 2010 (via SteamSpy).
  Imports run in the background; progress shows under the top bar and survives switching tabs.
- **Steam library** (under Add link): open
  `https://steamcommunity.com/my/games/?tab=all&xml=1` while logged into Steam, copy everything,
  and paste it in (or save the page and pick the file). A plain list of names also works. Games
  are matched to Wikidata by Steam app id. Tools, demos and soundtrack DLC are skipped, and
  the most-played games are imported first. Alternatively put `STEAM_API_KEY=…` in `.env.local`
  and load the library by profile URL.
- **Add link:** paste any YouTube playlist or video link (several at once is fine). Full-OST
  videos with a timestamped tracklist in the description are split into separate tracks.
  Playlists that mix games are grouped per game. You review the result before saving.
- **Listen:** filter by track type (battle, boss, town, ambient…), genre, series & franchise,
  platform, keyword, era and game. The player shows the cover and a link to where you can get the
  game. Chips
  have three states: click once for "only these", twice for "never these".
- **Library:** rename tracks, fix tags, like/ban tracks, or remove games.

Keys: <kbd>Space</kbd> play/pause, <kbd>N</kbd>/<kbd>→</kbd> skip, <kbd>P</kbd>/<kbd>←</kbd> back,
<kbd>L</kbd> like, <kbd>B</kbd> never play, <kbd>↑</kbd>/<kbd>↓</kbd> volume, <kbd>M</kbd> mute.

**Picking up where you left off:** the current song, position and tab are kept in the URL
(`?track=…&t=…`), and the up-next queue and back history in the browser. After a refresh or
restart the same song is ready at the same spot; press **Resume** (browsers block sound until you
click). A bookmarked URL reopens that song too. Volume lives in our own slider (synced both ways
with YouTube's), and is remembered. Click the progress bar to jump.

## The shuffle (`src/lib/picker.ts`)

Picking happens in two stages, so a 200-track soundtrack doesn't drown out a 15-track one:

1. **Pick a game.** A game that just played rests for a while (the **Variety** slider sets for
   how long, up to 12 tracks). Its weight then recovers gradually. Games from the same series or
   by the same composer as recent picks are down-weighted. Games with liked tracks get a small
   boost.
2. **Pick a track in that game.** Tracks played recently are excluded. The **Familiarity**
   slider moves between favouring tracks you haven't heard (Discover) and favouring liked tracks
   (Favourites). Skipping a track in its first minute counts as a mild dislike; each such skip
   makes it less likely to come back, but never bans it.

Tracks that YouTube refuses to embed, or that were removed, are marked unavailable and skipped
automatically.

## Your data

Your library lives in this browser's IndexedDB. Use **Add link → Backup** to export or restore it.

## For contributors and AI agents

Start with [AGENTS.md](AGENTS.md), then [docs/](docs/README.md).
