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
    `wd.sparql` retries on parse errors; split huge queries (artists are queried per occupation).
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
