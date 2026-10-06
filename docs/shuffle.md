# Shuffle, filters and the playback session

**Summary:** `pickNext` (src/lib/picker.ts) chooses a **work** (game, film, series, anime) first,
then a **track** within it, so big soundtracks don't dominate. Filters decide what's eligible.
`useSession` keeps a 4-track queue (or plays an explicit *program* first), records plays/skips,
and persists itself to the URL and localStorage so a reload resumes.

## The picker (pure, src/lib/picker.ts)

1. **Eligible:** work `enabled` and passes its chips (kind, genre, decade, franchise, platform,
   keyword); track not `banned`/`unavailable` and passes its chips (track type, length bucket,
   voice, role).
2. **Variety → `varietyParams(v, works)`:**
   - `stay = 0.75·(1−v)^1.5`: chance the next track comes from the same work (v=0 → ~4 tracks
     per visit on average; v=0.5 → ~27%; v=1 → never);
   - `cooldown = round(v^1.5 · min(60, (works−1)/2))` plays a work rests before returning.
   Simulated with ~1,450 works: v=1 gives a minimum return gap of ~60 plays.
   The old design (cooldown only, capped at 12 out of ~1,450 works) had no audible effect; see git history.
3. **Stay:** if `rand() < stay` and the last work still has fresh tracks, use it.
4. **Otherwise weight every other work** (the last one gets 0):
   - 0 inside the cooldown, then recovers linearly from 0.25 to 1;
   - ×0.35 if the same series played recently; ×0.5 if it shares a composer with the last 2;
   - +25% per liked track (up to 4), scaled by Familiarity;
   - mild size factor `0.6 + 0.4·min(1, log2(1+n)/5)`.
   If everything is cooling down (tiny library), fall back to the least recent work.
5. **Track weight** within the work:
   - tracks played within the last `min(300, 70% of eligible)` plays are excluded;
   - `liked` ×(1 + 4·familiarity);
   - `1/(1+playCount)^(1.2·(1−familiarity))` favours unheard tracks;
   - ×0.6 per early skip (max 5 counted).

`history` passed in = last 400 plays + queued tracks, so the queue itself respects cooldowns.

**Skips:** skipping before `min(60 s, 50% of the track)` marks that play `skipped` and bumps
`skipCount` (→ ×0.6 per skip next time). It does not ban or change the work's weight. A later
skip is just a normal play. Both are written in one transaction with the next play.

## Derived facets

| Facet | Values | Rule |
|---|---|---|
| Length (`lengthOf`) | `jingle` < 30 s, `short` < 1:30, `standard`, `long` > 6 min | Default filter: `lengths: { jingle: 'out' }` (fanfares, stingers) |
| Voice (`voiceOf`) | `vocal`, `instrumental` | `track.vocal` ?? role ≠ `score` ?? `types` has `vocal` |
| Role | `op`, `ed`, `insert`, `score`, `song` | `track.role` ?? (`vocal` type → song, else score) |
| Kind | `game`, `film`, `series`, `anime` | From the work |

## Filters (`Filters` in src/types.ts)

Chips are tri-state: absent / `in` (only these) / `out` (never these). Within a group, any `in`
must match; any `out` excludes. Defaults: `types: { extended: 'out' }`, `lengths: { jingle: 'out' }`.
Persisted to localStorage. Sections in `FiltersPanel` are collapsible (collapsed by default;
open state in `medley:open-sections`) and show how many chips are active. **Reset** clears
chips but keeps the sliders.

## Session (src/useSession.ts)

- Live queries: all works, all tracks, last 400 plays.
- Queue effect: drops queued tracks that no longer pass filters, tops up to 4 (also right after
  the queue is emptied). Variety and Familiarity only weight picks, so a change to either
  re-picks the whole queue once the slider settles (300 ms). Programs ignore both.
- **Program:** `playProgram(label, ids, { shuffle })` plays an explicit list first (in album order
  from title pages, `lib/trackOrder.ts`) (title page
  ▶ Play / ⤮ Shuffle, *Play what's new*, track search *Play all*). It ignores filters except
  banned/unavailable. A program keeps its whole list (`ids`), the play order (`order`) and the
  position (`pos`), so the players show *x/y* and `prev()` steps back through it. While one runs,
  both players (main and pop-out) show shuffle and loop toggles: `setProgramShuffle` reorders only
  the tracks still to come (off restores their own order); `setProgramLoop` starts over after the
  last track (reshuffled if shuffle is on) instead of returning to the radio. `playNow` on a track
  of the program moves the position there; `stopProgram()` returns to the shuffle. Persisted with
  the session.
- `next({ skipped, elapsed })`, `playNow(id)`, `prev()` (back stack of 50), `reroll()`.
- **Resume:** on load, `?track=&t=` become `currentId` + `resumeAt`; the player *cues* at that
  offset and shows a Resume overlay (browsers block sound without a gesture).

## Player (src/components/YouTubePlayer.tsx)

Wraps the IFrame API. Handle: `toggle`, `play`, `pause`, `seek`, `elapsed`. Slices use
`startSeconds`/`endSeconds` plus a 500 ms clock check, because `endSeconds` doesn't always
fire ENDED. Error codes 2/100/101/150 mark the track `unavailable`. Volume is ours
(`setVolume`/`mute`), and the 500 ms poll notices changes made in YouTube's UI and syncs them back.

## Media keys and the OS now-playing panel (src/lib/mediaSession.ts)

Audio comes from YouTube's cross-origin iframe, so browsers route hardware media keys (headset
next/previous, keyboard play/pause) to that frame, and the embedded player ignores next/previous.
`useMediaSession` loops a generated silent WAV in the top page while music plays, which makes the
page the routed media session, and registers `navigator.mediaSession` handlers (play, pause,
nexttrack → skip, previoustrack → back) plus metadata (track, game, composers, cover). Playing the
silent element needs a prior click on the page (always true once you've pressed play).

## Pop-out player (src/components/PopOutPlayer.tsx)

The ⧉ button opens a 360×132 always-on-top window via the Document Picture-in-Picture API
(Chrome/Edge 116+; hidden elsewhere). Audio stays in the main tab's YouTube iframe; the pop-out
has its own React root (events don't cross documents through portals), the app's stylesheets
copied in, and calls back into the session for play/pause, next, previous, like (and, during a
program, shuffle and loop). Its title bar shows the page's origin (e.g. `localhost:32123`): Chrome
always shows the origin there, to stop spoofing, and ignores `document.title`.
