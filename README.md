# Medley

Your own music radio for the things you love: **game soundtracks, anime openings and endings,
film & TV scores and songs**, played with your own shuffle
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

## Three kinds of music

| Domain | Catalog | What gets imported |
|---|---|---|
| 🎮 Games | ~9,100 games from Wikidata + SteamSpy | The soundtrack playlist (split by chapters if it's one long video) |
| 🌸 Anime | Top 1,200 anime from [AniList](https://anilist.co), songs from [AnimeThemes](https://animethemes.moe) | Every OP/ED/insert song by name and artist, plus the OST |
| 🎬 Film & TV | ~3,900 films and series from Wikidata: Disney, Pixar, DreamWorks, Sony, Illumination, musicals, superhero, popular series | The score album, plus a songs album for musicals and song-heavy films |

Tracks know whether they're **vocal** (sing-along) or instrumental, their **role** (opening,
ending, insert song, score, song), the performing **artist**, and their **length**. So in Listen
you can filter to e.g. *Anime → Opening only*, or *Film & TV → Vocal only* for a Disney
sing-along.

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
| Covers | Steam art, Wikipedia infobox images, AniList, Commons, Roblox icons | No |
| Playlists, video titles, durations, tracklists | YouTube pages, read by the local server (`server/youtube.ts`) | No |
| Playback | YouTube IFrame Player API | No |

Rebuild the bundled catalogs with `npm run catalog` (all domains; `--only games,anime` for a
subset). Expect ~30–40 minutes for everything, mostly Wikidata/Wikipedia pacing.

## Weekly auto-update

Shortly after the app starts it checks whether a week has passed since the last update. If so:

1. **Catalogs:** the server rebuilds all catalogs into its data folder (in the background; a
   hosted server does this on its own schedule). New titles, release dates, covers and tags. The
   app prefers these over the bundled copy.
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

The logo opens **Home** (what Medley is; on a hosted, invite-only Medley also the sign-in, with
everything else hidden until you're in). Tabs: **Discover** (where you land), **Listen**,
**Library**, **Add link**.

- **Discover:** cover-art shelves per domain (*Everything, Games, Anime, Film & TV*),
  a filterable *Browse all* grid, and *Series & franchises*. Search covers the catalogs, your
  library's tracks (with *Play all*). **+** adds a title; the title page
  has **▶ Play soundtrack** (in order), **⤮ Shuffle**, **Remove**, tags, store links, the
  openings & endings list for anime, per-track play buttons, and where the cover image comes
  from (with the photographer and license for Wikimedia photos). Games whose platforms had different
  music show each **version** separately (PC, GBA, GameCube…); *Add a version* finds another
  platform's soundtrack. Tracks play in album order.
- **Listen:** collapsible filter sections: Mix (Variety, Familiarity), Music from, Length,
  Voice, Song type, Track types, Genres, Series, Platforms, Keywords, Era, Titles. Chips have
  three states: click once for "only these", twice for "never these". Jingles (< 30 s) are
  excluded by default. Click the playing title or its cover to open its page. **⧉** pops the
  player out into a small always-on-top window (Chrome and Edge).
- **Library:** two views, *Titles* and *Tracks*, filtered by kind, status and labels (OP/ED,
  sung, liked…), sortable, with ▶ Play / ⤮ Shuffle for whatever is shown and an in-rotation switch
  per title. Click a title to open its page; *Edit* for its name, year and genres.
- **Add link:** paste YouTube playlists/videos, search YouTube playlists, import an anime list,
  back up or restore, and see whether the browser keeps your library permanently.

Medley can be installed as an app (Chrome/Edge: the install icon in the address bar). That
also makes browsers more willing to keep its storage permanently.

**On phones** everything works at phone width: a compact docked player, full-screen title pages,
and lock-screen controls. Music stops when the phone locks or you switch apps (YouTube's embedded
player does that; background play is a YouTube Premium feature) and picks up again when you come
back. On a desktop, a minimized or background browser window keeps playing.

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
- **Hosting:** `npm run build && npm run serve` runs the app and API in one Node process; for
  separate web and background processes use `docker compose up` (web + `npm run worker`) or a
  cron job running `npm run refresh`. Invite-only sign-in (`invites.json`), an optional CDN for
  the static files, compression, rate limits and a shared YouTube cache are built in. Locally
  nothing changes and nothing asks for a password. See [docs/hosting.md](docs/hosting.md).

## For contributors and AI agents

Start with [AGENTS.md](AGENTS.md), then [docs/](docs/README.md).
