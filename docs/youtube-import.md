# Finding and importing music

**Summary:** the server reads YouTube's own pages (no API key) for search results, playlists and
video descriptions. The client ranks candidate playlists for a game, imports the best one, cleans
every video title into a track name, and tags track types by keyword. Full-OST videos with a
timestamped tracklist become per-track slices.

## Server: `server/youtube.ts`

- Fetches `youtube.com/results`, `/playlist`, `/watch` with a desktop UA and consent cookies
  (`SOCS=CAI`) to skip the EU consent page.
- Extracts `ytInitialData` / `ytInitialPlayerResponse` by brace-matching (not regex), then **walks
  the whole JSON tree** for known shapes, both legacy `*Renderer` objects and the newer
  `lockupViewModel` (`contentType: LOCKUP_CONTENT_TYPE_PLAYLIST|VIDEO`). Structural walking is
  what keeps this working through YouTube's layout changes.
- Playlists over ~100 items: follows `continuationCommand.token` via `POST /youtubei/v1/browse`.
- `fetchRetry`: 4 attempts with backoff on network errors / 429 / 5xx, 15 s timeout each.
- `server/plugin.ts` caches responses for 30 min.

If imports start failing, save a page with curl and inspect it with a small walker script first;
the shapes are the only YouTube-specific knowledge in the codebase.

## Ranking candidates: `importer.rankPlaylistCandidates`

Must contain the normalised game title, otherwise discarded. Then:
+6 base, −7 if the title matches a *different, longer* catalog game ("Final Fantasy VII Remake"
when looking for "Final Fantasy VII"), −2.5 per extra word before the title and −0.75 per extra
word after it (ignoring OST boilerplate, `FILLER`), +3 for OST words (`GOOD`), −6 for covers,
remixes, movies, gameplay, hour-long loops (`BAD`), +1.5 official-looking channels / YouTube Music
albums (`OLAK5uy_`), +2 for 8–250 videos, penalties for tiny or giant playlists. A number
right after the title is another installment (−6: "Mamma Mia 2 Soundtrack", "Doom 2 OST",
"… Season 2"); "1 & 2" playlists that mix in the sequel get −3.

`autoAddGame` → `bestPlaylistDraft` tries the top 4 with score ≥ 5, rejects a playlist where under half
the tracks are normal length (mostly "extended" loops), and **prefers English track names**: a playlist
whose titles are ≥ 30% Japanese/Chinese/Korean script (`foreignTitleRatio`) is only used if no English
one passes. Requests use `hl=en`, so uploader-provided English title translations come through.
`preferEnglishSource` re-checks library games (> 50% foreign titles) and swaps the source; exposed
as a Library button and `import-headless --fix-foreign`. Fallback: a full-soundtrack *video* with a
timestamped tracklist. Personal games with `sources` skip all of this.

**The official upload wins** (`officialVideo`): when the best playlist isn't official (publisher,
label, composer channel, YouTube Music album: `officialPlaylist`), the importer also searches
"<title> OST official" for one video with a timestamped tracklist. It must be named for the work
and nothing else (only boilerplate and the release year, so not "Tetris Effect" or "The Sims 4"),
score ≥ 9 under the playlist ranking, be marked official (title, official/composer channel, or
"official upload" in the description) and have at least half as many tracks as the playlist.
("Helltaker OST (Official)" by Mittsies beat a fan playlist with remixes mixed in.) On 80 popular
works it changed 4 picks, all to the real soundtrack.

**Derivative tracks** (`skipDerivatives`, in `draftFromLink` so pasted links, auto-imports and
sync all get it) are unticked: `FAN_EDIT` (no copyright, fan-made, nightcore, slowed, sped up,
8D) always; `VARIANT` (remix, cover, lo-fi, mashup, hour-long loops) only when unofficial: not
when the title says "official", the uploader is official or uploaded ≥ 2 of the playlist's plain
tracks, or a composer is named (Riot's Worlds remixes, Fortnite's "Emote Remix" lobby music and
Cyberpunk's "SAMURAI Cover" stay). Nothing is skipped when the word is in the work's name or ≥ 75%
of the playlist is like that (a remix album, e.g. Celeste's B-Sides). Pasted links show skipped
tracks unticked in the review. "Unofficial soundtrack" (in-game music without an album release)
and "(Extended)" loops are the real music and stay.

## Cleaning titles: `parse.ts`

- `cleanTrackTitle(raw, names)`: removes game-name variants (roman ↔ arabic numerals,
  diacritics, the parts around a colon), composer names, OST noise words, noise in brackets
  (`[HD]`, `(Original Soundtrack)`, platform names, years), leading track numbers (repeatedly:
  "1 - … - 01 Title Theme"), trailing two/three-digit numbers, leftover punctuation. If only a
  bracketed remark is left it's unwrapped; a bare qualifier like "(Looped)" falls back to the raw title.
- `cleanGameName`: the same idea for playlist titles.
- `detectTypes`: keyword regexes in `TRACK_TYPES` (battle, boss, town, overworld, dungeon, theme,
  menu, ambient, emotional, victory, credits, character, vocal, arrangement, extended). Unslice
  videos over 25 min are tagged `extended` (excluded from rotation by default).
- `parseChapters`: timestamp lines at the start or end of a line; tolerates a few out-of-order
  entries but gives up if under 80% are ascending.
- `createCatalogMatcher`: longest-catalog-title-contained matching, used to guess which game a
  video belongs to in mixed playlists.

Test cleaning changes against real titles. The cases in git history (Ocarina "1 - … - 01 Title
Theme", `[Okami] - Rising Sun (HD)`, "Terraria Music - Day", "Persona 5 OST 23 - Last Surprise")
are a good regression set.

## Bulk import

- In the app: `src/lib/bulk.ts`, 4 concurrent workers, progress bar under the top bar, survives
  tab switches. Background tabs are throttled by the browser, so it's slow unless visible.
- **Reload-safe:** each title is committed in one IndexedDB transaction; the remaining queue is
  saved to `meta.bulkQueue` and `resumeInterrupted()` restarts it on the next start-up (titles
  already in the library are skipped). Titles that found nothing go to `meta.importFailures`.
- `runBulk(label, works, { announce: true })` records what arrived in `meta.arrivals` for the
  *New since…* banner (`NewArrivals.tsx`).
- Headless: `npx tsx scripts/import-headless.ts` (or `npm run import-all`), 6 workers, writes a
  backup (`medley-library.json` in the data dir) every 50 games and resumes from it. See [operations.md](operations.md).
- Expect ~15–20% "not found": mostly obscure/Japan-only Nintendo titles without playlists.

## Per-domain importers

`autoAddGame(work)` dispatches on `kind`. Search vocabulary (`VOCAB`: queries, good and bad
words) differs per domain: games search "OST"/"soundtrack", film/series also "score"/"songs",
anime "OST"/"opening". Ranking also checks `altTitles` and penalises a year mismatch
(−6, so *Moana* 2016 doesn't pick *Moana 2*).

### Film & TV (`importer.ts`)

- Best score playlist as for games, then `complementaryAlbum`: for films with songs (musicals,
  Disney/Pixar, etc.) it searches for a *songs* album (+8 for "songs"/"soundtrack" words), tries the
  top 4 and keeps it only if ≥ 40% of its tracks classify as vocal. (Spider-Verse → the Metro
  Boomin album; Moana → the deluxe soundtrack with songs.)
- `classifyScreenTrack(rawTitle, channel, ctx)` decides `vocal`/`role`/`artist` per track:
  explicit "instrumental"/"score" wins; uploads by a performer's *Topic* channel or a known artist
  are songs (unless the performer is the film's composer → score); titles like "(From "Frozen")",
  "feat.", "- Lyrics", or a bracketed work name → song; "Song – Artist" splits when one side lists
  several performers. (Known-artist names came from the removed artists catalog; that list is now
  empty.) In a **musical**, a track with no other clue is a song unless it looks like a
  score cue ("Overture", "Main Title"…).

### Anime (`importers/anime.ts`)

Every theme from the catalog (`themes`) is searched individually (`rankThemeVideos`): first
`${artist} ${song}`, then `${anime} ${OP|ED}${seq} ${song}` (skipped when the first search already
found the artist's own upload). `scoreHit` prefers **the original**, i.e. the music video on the artist's
channel, over the studio's TV-size opening and fans' re-uploads:

| Signal | Score |
|---|---|
| Song name in the title (also compared without spaces: "KICKBACK" = "KICK BACK") | +5 |
| Uploaded by the credited artist (channel name) | +4, and +3 more when the song matches too |
| Anime name / "Opening 1"-style type in the title | +2 / +3 |
| Official channel or title, music video / MV / PV / clip, creditless | +1.5, +1, +1 |
| 60–480 s (else −5); full length ≥ 150 s | +1; +0.5 |
| Covers, reactions, lyrics videos, nightcore, loops, instrument covers (piano, lyre, ocarina…), sheet music, fan animations, game footage (Beat Saber, osu!, Roblox…), 歌ってみた/弾いてみた/カバー/切り抜き… | −8 |
| Live performances (live, concert, tour, THE FIRST TAKE, acoustic, unplugged, ライブ…) unless the song's own name says so | −7 |
| Translated versions ("English Version", "Eng Ver.", "English Cover", "(English)", "Español Latino Cover", "sung in English"…), unless the song is listed in that language. "English sub(titles)" doesn't count | −8 |

A song is imported when the best candidate scores ≥ 6; otherwise it's skipped rather than taking
something wrong. Check a title's choices with `npx tsx scripts/try-import.ts songs anime <title>`.
If a pick is still wrong, the track page's **Wrong video?** lists the other candidates (or takes a
pasted link) and swaps the video, keeping name, labels, likes and plays (`replaceTrackVideo`).
Found tracks get `role` op/ed/insert, `seq`, `vocal: true`, `artist`, and are stored under a
`search` source.
Then the OST playlist is imported like a game soundtrack (instrumental, role `score`).

What gets imported is the **scope** (`AnimeScope`: `all` | `songs` | `oped` | `op`), a per-browser
preference (`getAnimeScope`, localStorage `medley:anime-scope`, picked with
`AnimeScopePicker`) used by every add path, or passed explicitly (`importAnime(work, { scope })`).
`importAnime(work, { themes: [theme] })` imports exactly one song (the **+** in the anime page's
theme list). Songs already in the library (same role + seq + normalised title) are skipped, so
narrow imports can be widened. `AnimeListImport` matches pasted titles against the anime
catalog (titles + `altTitles`), optionally expands to every season (`franchiseOf`), and queues
them with `runBulk(…, { topUp: true })`, which doesn't skip titles already in the library.

### Games that share a name with a film, and platform versions

- **Name clash** (`nameClash` / `clashScore`): when a game has the same name as a film or series in
  Medley ("Harry Potter and the Chamber of Secrets"), a playlist must show which one it is. For the
  game: +4 with game evidence (a platform, "video game", "OST"), −6 with film evidence ("film",
  "movie", "motion picture", "FilmScore…" channels, the film's composer), −2 with neither. The
  reverse for the film.
- **Versions** (`src/lib/platforms.ts`): when the chosen game soundtrack names a platform
  ("(PC) - OST"), the importer looks for the game's other platforms' soundtracks
  (`findVersionCandidates`: must name the platform, say it's music, no walkthroughs) and imports up
  to three more, each a source with `label` ("GBA", "GBC"). The title page groups tracks by
  version; *Add a version* searches one platform and, when no playlist names it, offers unlabelled
  game soundtracks (with game evidence) to label by hand.

### Album order (`src/lib/trackOrder.ts`)

Tracks store their playlist position (`pos`) at import and in the weekly sync. `albumOrder`: anime
songs first (OP1, OP2…, ED…, insert), then sources in the order they were added, then `pos`, then
the slice start (chapters of one long video). Older libraries get `pos` backfilled from the
(cached) playlists: in the background after start-up, and immediately when a title page opens.

### Saving (`commitDraft`)

Re-importing a video that's already a track of this title keeps plays, likes and a user-given
title, and takes the new import's role, seq, artist and vocal flag. A video that's already a track
of a *different* title (LiSA's "Gurenge" as an artist song and as Demon Slayer's opening) gets a
second row `videoId~<gameId>`, so both titles keep it. `syncLibraryMeta` also repairs anime
tracks whose title matches a listed theme but lack the role (older imports).

### Source sync (`src/lib/sync.ts`)

Weekly: playlist sources of single-work imports are re-read (cached `draftFromLink`). New videos
become tracks, missing ones `unavailable`, changed titles rename tracks unless `customTitle`.
Multi-work playlists and `search` sources are left alone.
