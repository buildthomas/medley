# Finding and importing soundtracks

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
- Headless: `npx tsx scripts/import-headless.ts` (or `npm run import-all`), 6 workers, writes a
  backup (`vgm-library.json`) every 50 games and resumes from it. See [operations.md](operations.md).
- Expect ~15–20% "not found": mostly obscure/Japan-only Nintendo titles without playlists.
