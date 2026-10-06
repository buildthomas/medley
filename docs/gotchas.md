# Gotchas (things that already bit us)

**Summary:** read this before debugging anything odd. Each entry: symptom → cause → fix.

1. **Games missing from Wikidata results** (Hollow Knight, Persona 5, Hades…) → many items have no
   `en` label, only the language-neutral `mul` label → always `COALESCE(en, mul)` labels
   (`label()` helper in the builder/enricher).
2. **Wikipedia returns no cover image** → `pageimages` only returns free images by default; box
   art is non-free → pass `pilicense=any`. **Only ~10% of games got covers** once → Wikipedia
   rate-limits bursts and the old code skipped failed batches silently → `scripts/wiki-covers.mjs`
   paces requests and retries with backoff. Never `continue` past a failed external batch quietly.
3. **"ost" matched inside "Lost"/"Ghost"** → keyword regexes need word boundaries (`\bost\b`).
4. **"Knight" tagged ambient** → `/night/` without `\b`. Same class of bug as 3.
5. **A Steam id maps to a DLC item** (Vampire Survivors → "First Survivaton") → several Wikidata
   items share P1733; keep the one with the most sitelinks, and prefer Steam's shorter name when
   Wikidata's label is "Steam name + extra words".
6. **Bulk import crawls** → hidden/background tabs are throttled by the browser. Use
   `npm run import-all` (headless) for big batches.
7. **Server restarts during a bulk import** → `server/*`, `catalog-builder.mjs`, `enrich.mjs` are
   Vite config dependencies; editing them restarts the server and in-flight imports fail as "not
   found". Re-run with `--retry-failed`.
8. **Vite served an empty module after a file was written in two steps** → a stale transform of
   a half-written file was cached. `touch` the file to invalidate it.
9. **HMR mid-job leaves stale module state** (e.g. "FILLER is not defined") → reload the page.
10. **Shell heredocs/`node -e` with backticks** → template literals get eaten by bash. Use the
    editor/Write tool for TS/CSS with backticks.
11. **Refreshed data shadowing a newer bundled catalog** → refreshed copy is used only if its
    `generatedAt` (full ISO timestamp) is strictly newer. Delete `data/catalog.json` to force
    the bundled one.
12. **Autoplay after refresh** → browsers block sound without a user gesture; we cue the track and
    show a Resume overlay instead of trying to autoplay.
13. **`endSeconds` doesn't reliably fire ENDED** for slices → the player also checks the clock
    every 500 ms.
14. **Roblox icon URLs expire** (`180DAY-…`) → refreshed monthly into `data/my-games.json`; don't
    treat the URLs in `my-games.json` as permanent.
15. **Two "Doom"s** (1993 and 2016) share a title → anything that resolves titles must pick by
    popularity (`starterGames`, Steam name matching) and never assume titles are unique.
16. **Headset "next" did nothing** → media keys go to the frame that plays audio (YouTube's iframe),
    which ignores next/previous → the page plays a silent loop so it becomes the media session
    (`src/lib/mediaSession.ts`). If media keys stop working, check that the silent element is playing.
17. **Fire Emblem Fates, NieR, Zelda: Oracle games missing** → they aren't `P31 video game` on
    Wikidata but *paired versions of a video game* (Q116809654), remakes, remasters… → filter on
    `GAME_CLASSES` (catalog-builder.mjs), never on Q7889 alone. When a title is missing, check
    its `P31` first.
18. **"Nintendo first-party" lacked Mario Kart World / DK Bananza** → they were in the Switch 2
    list, but the home shelf only showed Switch → *Latest from Nintendo* merges both consoles by date.
19. **SPARQL "Unexpected end of JSON"** → Wikidata truncates big responses mid-stream (HTTP 200).
    `wd.sparql` retries on parse errors; split huge queries into smaller batches.
20. **Wrong studio films** (Pixar list full of unrelated films) → wrong QIDs and first-match
    assignment. Verify every QID on wikidata.org and order studios specific → general.
21. **Variety slider did nothing audible** → a cooldown capped at 12 plays is invisible among
    ~1,450 works. Variety now also controls "stay with this work" (see shuffle.md).
22. **Regex/backtick corruption** (`\b` became a backspace character) after editing through
    `node -e`/sed/heredocs → edit code with the Edit/Write tools; write multi-line patch scripts
    to a file first. Check with `grep -rnP '\x08' src scripts server`.
23. **Anime songs not found under English titles** → uploads use the romaji or Japanese title →
    `altTitles` are searched and matched too; artist + song title is the strongest signal.
24. **Discover shows "Loading catalog…" for a few seconds** → all four catalogs (~10 MB JSON)
    load on first visit to Discover. Expected.
25. **Changing the port empties the library** → browser storage is per origin, and the port is part
    of it. The dev server uses `strictPort` (fail rather than drift to another port), and the move
    from :5173 to :32123 is bridged by a one-time hand-over (`server/legacy-origin.ts`,
    `src/lib/originTransfer.ts`; same-site iframes aren't storage-partitioned). Don't change the port again
    without a similar bridge.
26. **Docked YouTube player too small** → YouTube's player must be ≥ 200×200 CSS px; a 340 px dock
    gave 320×180 (it looked like ~400×230 on a 125%-scaled screen: device pixels aren't CSS px).
27. **Pop-out windows can't be made non-resizable** → no Document PiP option exists; we snap back
    where allowed and keep the card fixed-size. The built-in browser pane can't open PiP windows
    at all ("no window"); test in Chrome/Edge.
28. **Hundreds of CORS errors from Commons photos** → `Special:FilePath` redirects without
    `Access-Control-Allow-Origin`, so the transparent-logo analysis (canvas) fails. Photos are
    never analysed (`Cover.tsx` `mayBeTransparent`).
29. **A production server and the dev server both "on" 32123** → Node binding `0.0.0.0` and Vite on
    `::1` don't conflict on Windows; `localhost` then reaches whichever matches. Use `PORT` when
    testing `npm run serve` next to `npm run dev`.
30. **Refresh stuck "running" after a crash** → the lock has a 30 s heartbeat and goes stale after
    2 minutes; an interrupted run isn't backed off like a failure.
31. **Anime OP/ED tags missing after import** → the video was already a track (often of an artist),
    and `commitDraft` used to keep the old row untouched. It now merges role/seq/artist/vocal and
    gives a second title its own `~<gameId>` row; `syncLibraryMeta` repairs older libraries.
32. **Phone page wider than the screen** → a `nowrap` scrolling row inside a grid/flex item with
    the default `min-width: auto` widens the whole layout (Chrome then zooms the page out). Give
    those containers `min-width: 0`.
33. **Film "franchises" like "list of Pixar films"** → Wikidata P179 often points at lists;
    filtered by `NOT_A_SERIES`.
34. **Anime song import picked a live performance** (Chainsaw Man's KICK BACK) → the artist's live
    upload matched as well as the music video, whose title spelled the song "KICKBACK". Song names
    are now also compared without spaces, live versions get −7, the artist's own upload +3. Wrong
    picks in existing libraries: track page → *Wrong video?*.
35. **Harry Potter games imported the film score** → game and film share the exact name and most
    playlists don't say which → name-clash scoring wants game evidence (see youtube-import.md).
36. **"Play soundtrack" played in random order** → tracks had no playlist position, and IndexedDB
    returns them sorted by video id. `pos` is stored now and backfilled for older libraries.
37. **Shantae sequels missing from the catalog** → 6–11 Wikipedia editions, below the 12 cut-off
    → series completion and Steam indie favourites (data-pipeline.md).
38. **A tiny SPARQL query returned 400 MB** → `SELECT DISTINCT ?series WHERE { VALUES ?game {…}
    ?game wdt:P179 ?series }` made Wikidata scan every series first. Read such links in the
    details query instead, and test new query shapes with `curl --max-filesize` before a build.
39. **GTA VI showed as released (2025)** → a delayed work keeps its old release targets on
    Wikidata, marked *deprecated*, and `p:P577/psv:P577` reads every rank, so "earliest date"
    picked the abandoned target. The details queries skip deprecated dates (`wdt:` already reads
    only best-rank ones). The same bug dated delayed films by their first planned release (No Time to Die as 2019).
40. **RuneScape imported fan "music videos"** (machinima with unrelated songs) → a bare "music"
    counted as much as "OST", nothing penalised fan videos, and a 9+ score skipped the second
    search. Now "music videos", GMV/MMV, fan-made, tribute, montage, mashup and machinima are
    `bad` for games, and a bare "music" earns +1.5 instead of +3.
    Then it took *The Orchestral Collection* (a re-recording): arrangement albums (orchestral
    collection/arrangement, symphonic, arranged, piano collections, concert) are `bad` too, unless
    the word is in the work's own name (*Castlevania: Symphony of the Night*), and a playlist named
    only for the work ("RuneScape Music") gets +1.5 over slices ("Fremennik - RuneScape Music").
    A leftover number cancels that ("Roblox 3008 OST"), except a "1" or the release year. Any
    ranking change: compare the top pick before/after for ~80 popular works (YouTube answers are
    cached, so it's quick).
41. **Fan remixes inside a fine-looking playlist** (Helltaker OST: 6 of 12 tracks were "[Remix]
    (NO Copyright)") → per-track `skipDerivatives`, which must not drop official remixes (League's
    Worlds remixes, Fortnite's Emote Remix lobby music): the uploader decides. And the composer's
    own "OST (Official)" video now beats a fan playlist (`officialVideo`); guard it against sequels
    ("Tetris Effect", "The Sims 4") with the playlist ranking plus a name-only rule.
