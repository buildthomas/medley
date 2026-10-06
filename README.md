<p align="center">
  <img src="docs/images/home.png" alt="Medley's home page: Every story has a sound." width="100%">
</p>

<h1 align="center">Medley</h1>

<p align="center">
  <b>Your own radio for game soundtracks, anime openings and film &amp; TV scores.</b><br>
  Pick the titles you love; Medley finds their music on YouTube and shuffles it your way.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-CC%20BY--NC--SA%204.0-lightgrey" alt="License: CC BY-NC-SA 4.0"></a>
  <img src="https://img.shields.io/badge/React-19-61dafb" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-7-3178c6" alt="TypeScript">
  <img src="https://img.shields.io/badge/API%20keys-none-brightgreen" alt="No API keys">
</p>

---

Medley plays music through YouTube's official embedded player, but **you** decide what plays:
which titles are in rotation, how varied the mix is, openings only or sing-alongs only. There
are no recommendations, no account and no API keys. Your library lives in your own browser.

| | Catalog | What one click brings in |
|---|---|---|
| 🎮 **Games** | ~9,100 games, NES classics to this year's releases | The soundtrack, in album order, one per platform version where they differ |
| 🌸 **Anime** | The top 1,200 anime | Every opening, ending and insert song by name and artist, plus the score |
| 🎬 **Film & TV** | ~3,900 films and series | The score, plus the songs for musicals and sing-alongs |

## A look around

<table>
  <tr>
    <td width="50%"><img src="docs/images/discover.png" alt="Discover: shelves of games and anime, with the docked player"></td>
    <td width="50%"><img src="docs/images/title.png" alt="A title page: cover, tags, store links and the soundtrack"></td>
  </tr>
  <tr>
    <td><b>Discover</b>: shelves per domain, a filterable grid, series &amp; franchises.</td>
    <td><b>Title pages</b>: the soundtrack in album order, tags, credits and where to get it.</td>
  </tr>
  <tr>
    <td colspan="2"><img src="docs/images/listen.png" alt="Listen: the player, a soundtrack playing 1 of 47, and the shuffle filters"></td>
  </tr>
  <tr>
    <td colspan="2"><b>Listen</b>: the player, what's next, and the filters that steer the shuffle.</td>
  </tr>
</table>

## Features

- **Your own shuffle.** Filter by genre, series, platform, era, length, sung or instrumental,
  openings/endings/score. *Variety* sets how often it moves to another title; *Familiarity*
  leans towards favourites or towards things you haven't heard yet. Early skips count as a mild
  dislike; ♥ like and ⊘ never-play are yours to set.
- **Soundtracks in order.** ▶ on a title (or in Library) plays its whole soundtrack, with
  **x/y**, **shuffle** and **loop**; afterwards the radio picks up again.
- **Anime done properly.** Songs are labelled OP1, ED2, insert…, with artists, and original
  versions are preferred over live performances and covers. Import just the openings if that's
  all you want, or paste a whole list of anime.
- **Keeps itself fresh.** Once a week the catalogs update, new titles from collections you
  follow arrive, and imported playlists pick up new videos.
- **Plays anywhere.** Media keys and the OS media panel, a pop-out always-on-top mini player
  (Chrome/Edge), installable as an app, and a phone layout with a compact player.
- **Yours.** Library, likes and history stay in your browser (back them up from *Add link*).
  The current track and position live in the URL, so a reload picks up where you were.

Keys: <kbd>Space</kbd> play/pause · <kbd>N</kbd>/<kbd>→</kbd> skip · <kbd>P</kbd>/<kbd>←</kbd> back ·
<kbd>L</kbd> like · <kbd>B</kbd> never play · <kbd>↑</kbd>/<kbd>↓</kbd> volume · <kbd>M</kbd> mute

## Run it

```bash
npm install
npm run dev        # http://localhost:32123
```

That's all: no keys, no database. Medley lives at **localhost:32123** (the logo's bar heights,
3-2-1-2-3). `npm start` builds and serves a production version on the same port. The app needs
its small Node server to read YouTube pages, so it isn't a static site.

On phones everything works at phone width. Music stops when the phone locks or you switch apps
(YouTube's embedded player does that; background play is a YouTube Premium feature) and picks
up when you come back.

## How it works

**Catalogs** are built from open data and bundled in `src/data/`, so a fresh copy works
immediately; a weekly background job refreshes them into Medley's data folder.

| What | Source |
|---|---|
| Games: year, genres, series, composers, platforms, developer | [Wikidata](https://www.wikidata.org), keywords from [SteamSpy](https://steamspy.com) |
| Films & series: studio, composers, genres, network | Wikidata + Wikipedia |
| Anime: titles, studio, tags, OP/ED/insert songs with artists | [AniList](https://anilist.co) + [AnimeThemes](https://animethemes.moe) |
| Covers | Steam, Wikipedia, Wikimedia Commons, AniList (linked, not copied) |
| Playlists, track names, durations | YouTube pages, read by the local server (`server/youtube.ts`) |
| Playback | YouTube IFrame Player API |

`npm run catalog` rebuilds every catalog (about 30–40 minutes, mostly Wikidata pacing;
`--only games,anime` for a subset). A rebuild never drops a title that was in the previous
catalog. Set `MEDLEY_CONTACT` to put your email in the requests' User-Agent, as Wikimedia likes.

**The shuffle** (`src/lib/picker.ts`) first decides whether to stay with the current title or
move on (Variety; a title rests a while before it returns, and related series are spread out),
then picks a track in that title (Familiarity, minus recent plays and early skips).

**Your own games:** put them in `my-games.json` in Medley's config folder (`%APPDATA%\Medley`,
`~/.config/medley`, or `~/Library/Application Support/Medley/config`; see
`config/my-games.example.json`) with fixed YouTube sources.

## Your data and hosting

- **Your library** (titles, tracks, plays, likes) lives in the browser's IndexedDB, per browser
  and per site address. **Add link → Backup** moves it.
- **Server data** (refreshed catalogs, caches) goes to `%LOCALAPPDATA%\Medley\data`,
  `~/.local/share/medley` or `~/Library/Application Support/Medley/data`, never into the code
  folder. Override with `MEDLEY_DATA_DIR` and `MEDLEY_CONFIG_DIR`.
- **Hosting** for friends: `npm run build && npm run serve`, or `docker compose up`. Invite-only
  sign-in, rate limits, a shared YouTube cache and an optional CDN are built in. Locally nothing
  asks for a password. See [docs/hosting.md](docs/hosting.md).

## Contributing

Start with [AGENTS.md](AGENTS.md) (written for people and AI agents alike), then
[docs/](docs/README.md). `npm run typecheck` is the automated check; behaviour is verified in
the browser.

## License

The code is [CC BY-NC-SA 4.0](LICENSE): share and adapt it with credit, not commercially,
and changed versions keep the same license.
The bundled catalogs in `src/data/` are facts gathered from the sources above and keep their
terms: Wikidata is CC0, and AniList and AnimeThemes data is for non-commercial use. Covers are
links to the original images. Medley doesn't host or download any music: everything plays
through YouTube's embedded player.
