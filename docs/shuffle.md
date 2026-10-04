# Shuffle, filters and the playback session

**Summary:** `pickNext` (src/lib/picker.ts) chooses a **game** first, then a **track** within it,
so big soundtracks don't dominate. Filters decide what's eligible. `useSession` keeps a 4-track
queue, records plays/skips, and persists itself to the URL and localStorage so a refresh resumes.

## The picker (pure, src/lib/picker.ts)

1. **Eligible:** game `enabled` and passes chip filters (genre, decade, franchise, platform,
   keyword); track not `banned`/`unavailable` and passes track-type chips.
2. **Game weight:**
   - cooldown = `round(variety × min(12, games − 1))` plays; a game that played within it has weight 0, then recovers linearly;
   - ×0.35 if the same series played recently;
   - ×0.5 if it shares a composer with either of the last 2 games;
   - +25% per liked track (up to 4), scaled by familiarity;
   - mild size factor, so a 6-track game isn't drowned out by a 200-track one.
3. **Track weight:**
   - recently played tracks are excluded (last `min(300, 70% of eligible)` plays);
   - `liked` ×(1 + 4·familiarity);
   - `1/(1+playCount)^(1.2·(1−familiarity))` favours unheard tracks;
   - ×0.6 per early skip (max 5 skips counted).
4. If everything is cooling down (tiny library), fall back to the least recent.

`history` passed in = last 400 plays + queued tracks, so the queue itself respects cooldowns.

## Filters (`Filters` in src/types.ts)

Chips are tri-state: absent / `in` (only these) / `out` (never these). Within a group, any `in`
must match; any `out` excludes. Default: `types: { extended: 'out' }`. Persisted to localStorage.
Library games carry `franchise`/`platforms`/`keywords` copied from the catalog
(`gameMetaFrom`, `syncLibraryMeta`) so filtering doesn't need the catalog loaded.

## Session (src/useSession.ts)

- Live queries: all games, all tracks, last 400 plays.
- Queue effect: drops queued tracks that no longer pass filters, tops up to 4.
- `next({ skipped, elapsed })`: an early skip (< min(60 s, 50 %)) marks the play `skipped` and
  bumps `skipCount`.
- `playNow(id)`, `prev()` (back stack of 50), `reroll()`.
- **Resume:** on load, `?track=&t=` from the URL become `currentId` + `resumeAt`; the player
  *cues* (doesn't autoplay) at that offset and shows a Resume overlay. Browsers block sound
  without a user gesture. `resumeAt` clears on first PLAYING or any track change. The position
  is written to the URL every ~2 s (`ListenView.onProgress`).

## Player (src/components/YouTubePlayer.tsx)

Wraps the IFrame API. Handle: `toggle`, `play`, `seek`, `elapsed`. Slices use
`startSeconds`/`endSeconds` plus a 500 ms clock check, because `endSeconds` doesn't always
fire ENDED. Error codes 2/100/101/150 mark the track `unavailable`. Volume is ours
(`setVolume`/`mute`), and the 500 ms poll notices changes made in YouTube's UI and syncs them back.
