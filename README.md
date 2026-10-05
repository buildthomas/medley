# Medley

Your own music radio for the things you love: **game soundtracks, anime openings and endings,
film & TV scores and songs, and your favourite artists**, played with your own shuffle
algorithm instead of YouTube's recommendations. Audio plays through YouTube's official embedded
player. Everything else is local: what's in rotation, how tracks are picked, and what you've
liked or skipped.

## Run it

```bash
npm install
npm run dev        # http://localhost:32123
```

Medley lives at **localhost:32123**: the logo's bar heights, 3-2-1-2-3. `npm start` builds and
serves a production version on the same port. (It used to be :5173. While `npm run dev` runs,
the old address redirects here and hands over a library saved there, once, automatically.) The app needs its small
server to read YouTube metadata, so it is not a static site (see *Your data and hosting*).

## Four kinds of music

| Domain | Catalog | What gets imported |
|---|---|---|
| 🎮 Games | ~4,400 games from Wikidata + SteamSpy | The soundtrack playlist (split by chapters if it's one long video) |
| 🌸 Anime | Top 1,200 anime from [AniList](https://anilist.co), songs from [AnimeThemes](https://animethemes.moe) | Every OP/ED/insert song by name and artist, plus the OST |
| 🎬 Film & TV | ~3,900 films and series from Wikidata: Disney, Pixar, DreamWorks, Sony, Illumination, musicals, superhero, popular series | The score album, plus a songs album for musicals and song-heavy films |
| 🎤 Artists | ~1,600 popular artists from Wikidata, plus live search on [MusicBrainz](https://musicbrainz.org) | Their ~30 best-known songs (official uploads only) |

Tracks know whether they're **vocal** (sing-along) or instrumental, their **role** (opening,
ending, insert song, score, song), the performing **artist**, and their **length**. So in Listen
you can filter to e.g. *Anime → Opening only*, or *Film & TV → Vocal only* for a Disney
sing-along.

**Add a song** (under Add link) adds one song from a YouTube link or a search, filed under its
artist.

**Just the openings:** the *Adding anime* setting (on the Anime tab, an anime's page, and the
*Add anime openings* card) picks what an anime import brings in: *Everything*, *Songs only*,
*OPs & EDs* or *Openings*. It applies to every add button and bulk import. An anime's page has
a **+** next to each opening/ending to add just that song. **Add link → Add anime openings**
takes a pasted list of anime (one per line; English or romaji titles), optionally with every
season, and imports e.g. only their openings. Songs you already have are skipped, so you can
widen an import later.

## Where the data comes from

| What | Source | Key needed? |
|---|---|---|
| Games: year, genres, series, composers, platforms, developer, Steam id | [Wikidata](https://www.wikidata.org) | No |
| Game collections (Nintendo per console, top per year, indie hits), keywords | Wikidata + [SteamSpy](https://steamspy.com) | No |
| Films & series: studio, composers, genres, network, posters | Wikidata + Wikipedia | No |
| Anime: titles (English/romaji/native), studio, format, tags, OP/ED/insert songs with artists | AniList GraphQL + AnimeThemes API | No |
| Artists: genres, country, active since, YouTube channel, Spotify; live search | Wikidata, Wikimedia Commons, MusicBrainz | No |
| Covers | Steam art, Wikipedia infobox images, AniList, Commons, Roblox icons | No |
| Playlists, video titles, durations, tracklists | YouTube pages, read by the local server (`server/youtube.ts`) | No |
| Your Steam library | Paste of your Steam games page | No (optional Steam Web API key) |
| Playback | YouTube IFrame Player API | No |

Rebuild the bundled catalogs with `npm run catalog` (all domains; `--only anime,artists` for a
subset). Expect ~30–40 minutes for everything, mostly Wikidata/Wikipedia pacing.

## Weekly auto-update

Shortly after the app starts it checks whether a week has passed since the last update. If so:

1. **Catalogs:** the local server rebuilds all catalogs (`POST /api/refresh`) into `data/`. New
   titles, release dates, covers and tags. The app prefers these over the bundled copy.
2. **New titles** in collections you subscribed to (**Add all**, or **auto-add new**) are
   imported in the background.
3. **Retries:** titles that found nothing before (e.g. unreleased at the time) are tried again
   once released, at most weekly.
4. **Source sync:** each imported playlist (checked at most weekly) is re-read: new videos
   become new tracks, removed ones are marked unavailable, renamed ones get the new name (unless
   you renamed the track yourself).
5. A **"New since…" banner** shows what arrived, with *Play what's new* and *Browse them*.

Unreleased titles are hidden from Discover by default (**Show unreleased** reveals them,
marked *Soon*). **check now** under the collections forces an update.

Reloading the page during an import is safe: each finished title is saved atomically, and the
remaining queue is stored and resumes on the next start.

## Using it

- **Discover:** cover-art shelves per domain (*Everything, Games, Anime, Film & TV, Artists*),
  a filterable *Browse all* grid, and *Series & franchises*. Search covers the catalogs, your
  library's tracks (with *Play all*), and MusicBrainz artists. **+** adds a title; the title page
  has **▶ Play soundtrack** (in order), **⤮ Shuffle**, **Remove**, tags, store links, the
  openings & endings list for anime, and per-track play buttons.
- **Listen:** collapsible filter sections: Mix (Variety, Familiarity), Music from, Length,
  Voice, Song type, Track types, Genres, Series, Platforms, Keywords, Era, Titles. Chips have
  three states: click once for "only these", twice for "never these". Jingles (< 30 s) are
  excluded by default. Click the playing title or its cover to open its page. **⧉** pops the player out into a small always-on-top window (Chrome and
  Edge).
- **Library:** rename tracks, fix tags, like/ban tracks, remove titles.
- **Add link:** paste YouTube playlists/videos, add a single song, import your Steam library,
  back up or restore.

Keys: <kbd>Space</kbd> play/pause, <kbd>N</kbd>/<kbd>→</kbd> skip, <kbd>P</kbd>/<kbd>←</kbd> back,
<kbd>L</kbd> like, <kbd>B</kbd> never play, <kbd>↑</kbd>/<kbd>↓</kbd> volume, <kbd>M</kbd> mute.
Headset and keyboard media keys work too, and the OS media panel shows the track and cover.

The current song, position and tab are kept in the URL, so a reload or bookmark resumes where
you were (press **Resume**; browsers block sound until you click).

## The shuffle (`src/lib/picker.ts`)

1. **Stay or move on.** With low **Variety**, the next track often comes from the same title
   (a mini album session). With high variety it always moves on, and a title rests for a
   while before it can return. Titles from the same series or by the same composer as recent
   picks are down-weighted; titles with liked tracks get a boost.
2. **Pick a track in that title.** Recently played tracks are excluded. **Familiarity** moves
   between favouring tracks you haven't heard and favouring liked ones. Skipping a track in its
   first minute counts as a mild dislike (×0.6 per skip, up to 5); it never bans it.

**Play soundtrack / Shuffle** on a title page, or **Play what's new**, queues an explicit
program first; the normal shuffle resumes when it's done.

## My games

Your own games go in `my-games.json` in Medley's config folder (`%APPDATA%\Medley` on Windows,
`~/.config/medley` on Linux, `~/Library/Application Support/Medley/config` on macOS; copy
`config/my-games.example.json`),
each with fixed YouTube sources. They're imported once on start-up and form the *My games*
collection.

## Your data and hosting

- **Your library** (titles, tracks, plays, likes) lives in **this browser's IndexedDB**, per
  browser and per site address. Use **Add link → Backup** to move it.
- **Server-side data** never lives in the code folder. Refreshed catalogs and caches go to
  `%LOCALAPPDATA%\Medley\data` (Windows), `~/Library/Application Support/Medley/data` (macOS),
  `~/.local/share/medley` (Linux). Your `my-games.json` goes in the config folder (`%APPDATA%\Medley`,
  `~/.config/medley`). Override them with `MEDLEY_DATA_DIR` and `MEDLEY_CONFIG_DIR`.
- **Hosting:** `npm run build && npm run serve` (or the `Dockerfile`) runs the app and API in one
  Node process, with compression, an optional password (`MEDLEY_PASSWORD`), rate limiting and
  weekly catalog refreshes. See [docs/hosting.md](docs/hosting.md). GitHub Pages alone can't run
  the API.

## For contributors and AI agents

Start with [AGENTS.md](AGENTS.md), then [docs/](docs/README.md).
