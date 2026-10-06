# Roadmap and open ideas

**Summary:** what's deliberately not built yet, and notes for whoever picks it up.

- **IGDB keywords/themes.** IGDB has richer keywords than Steam tags (and covers non-Steam games),
  but needs Twitch developer credentials (`TWITCH_CLIENT_ID`/`TWITCH_CLIENT_SECRET`). Plan: optional
  step in `enrich.mjs`, enabled only when the env vars exist; match via Wikidata's IGDB id property
  or Steam app id (`external_games` category 1).
- **Better "not found" rate** for obscure Nintendo titles: try Japanese titles (Wikidata `ja` label)
  and YouTube Music album search (`OLAK5uy_` playlists) before giving up.
- **Track-type tagging** is keyword-based; ~half of tracks get no type. An optional LLM pass could
  tag untagged titles in batches.
- **Duplicate soundtracks** across a game and its remaster aren't merged.
- **Mobile background playback** isn't possible with the YouTube iframe (YouTube pauses hidden
  embeds; background play is a Premium feature). We resume on return instead.
- **A full static deployment** (adding music without a server) would need the `/api` functions as serverless functions. The GitHub Pages *preview* exists (hosting.md) but can't add music.
- **Mood/energy tags** (calm, intense, upbeat): skipped for now. Could come from track types +
  title keywords, or an optional LLM pass.
- **More domains** (e.g. classical, musicals as their own domain): add a builder in `scripts/`,
  a `kind` in `src/lib/kinds.ts`, and an importer in `src/lib/importers/`.
- **Wikidata series noise** for films is filtered by `NOT_A_SERIES` (catalog.ts, screen-builder);
  new list-like names may need adding.
- **Library sync across devices** (hosted): would need server-side storage per user; today
  libraries move by Backup/Restore.
- **Artists** (removed Oct 2026, in git history: `scripts/artist-builder.mjs`,
  `src/lib/importers/artist.ts`, `server/artists.ts`, the *Add a song* card). Bring back only if wanted.
- **Versions beyond platforms** (e.g. original vs remastered soundtrack) could reuse `Source.label`.
