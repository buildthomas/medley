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
albums (`OLAK5uy_`), +2 for 8–250 videos, penalties for tiny or giant playlists.

`autoAddGame` → `bestPlaylistDraft` tries the top 4 with score ≥ 5, rejects a playlist where under half
the tracks are normal length (mostly "extended" loops), and **prefers English track names**: a playlist
whose titles are ≥ 30% Japanese/Chinese/Korean script (`foreignTitleRatio`) is only used if no English
one passes. Requests use `hl=en`, so uploader-provided English title translations come through.
`preferEnglishSource` re-checks library games (> 50% foreign titles) and swaps the source; exposed
as a Library button and `import-headless --fix-foreign`. Fallback: a full-soundtrack *video* with a
timestamped tracklist. Personal games with `sources` skip all of this.

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
  backup (`vgm-library.json`) every 50 games and resumes from it. See [operations.md](operations.md).
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
  "feat.", "- Lyrics", or a bracketed work name → song; "Song – Artist" splits when one side is a
  known artist.

### Anime (`importers/anime.ts`)

Every theme from the catalog (`themes`) is searched individually: first `${artist} ${song}`,
then `${anime} ${OP|ED}${seq} ${song}`. `scoreHit` adds up song-title match (+5), artist match
(+4), anime-name match (+2), OP/ED type match (+3), official/creditless uploads; covers, nightcore,
reactions, "1 hour" etc. are −8; duration must be 60–480 s; threshold 6. Found tracks get
`role` op/ed/insert, `seq`, `vocal: true`, `artist`, and are stored under a `search` source.
Then the OST playlist is imported like a game soundtrack (instrumental, role `score`).

What gets imported is the **scope** (`AnimeScope`: `all` | `songs` | `oped` | `op`), a per-browser
preference (`getAnimeScope`, localStorage `vgm-shuffle:anime-scope`, picked with
`AnimeScopePicker`) used by every add path, or passed explicitly (`importAnime(work, { scope })`).
`importAnime(work, { themes: [theme] })` imports exactly one song (the **+** in the anime page's
theme list). Songs already in the library (same role + seq + normalised title) are skipped, so
narrow imports can be widened. `AnimeListImport` matches pasted titles against the anime
catalog (titles + `altTitles`), optionally expands to every season (`franchiseOf`), and queues
them with `runBulk(…, { topUp: true })`, which doesn't skip titles already in the library.

### Artists (`importers/artist.ts`)

- `findArtistSongs(artist)`: 4 searches (name, "official music video", "official audio", "topic"),
  keeps uploads by the artist (`isArtistUpload`: catalog `ytChannel`, channel name match, VEVO,
  "- Topic"), 80–660 s, no live/cover/dance-practice/stage videos. Max 30 songs, deduped by
  cleaned title (`cleanSongTitle`: strips "Official Video", the artist prefix, quotes, 「」).
- `parseSongVideo(videoId)` for *Add a song*: reads "Provided to YouTube by" descriptions
  (song · artist · featured), else "Artist - Song", else the channel name.
- `addSong(song)` files it under the artist (`artistWork`: a catalog artist when the name
  matches, else a new `u:artist-<slug>` work).

### Source sync (`src/lib/sync.ts`)

Weekly: playlist sources of single-work imports are re-read (cached `draftFromLink`). New videos
become tracks, missing ones `unavailable`, changed titles rename tracks unless `customTitle`.
Multi-work playlists and `search` sources are left alone.
