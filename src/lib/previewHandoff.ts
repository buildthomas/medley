// Moving a library from the GitHub Pages preview to a local Medley. Browser storage belongs to
// one address, so the two can't share it; instead the preview opens the local app in a new tab
// (`?from=preview`), the local app says it's ready, and the preview posts its library over.
// The local app only accepts it from the preview's own address, and only when you opened it
// this way. (The same idea as originTransfer.ts, which moved libraries from :5173 to :32123.)

import { db } from '../db';
import type { Game, Source, Track } from '../types';
import { LOCAL_ORIGIN } from './preview';

/**
 * Addresses a preview may hand over from: the published preview, and `vite preview`'s default
 * port for testing a Pages build locally. Forks publishing their own preview add theirs.
 */
const PREVIEW_ORIGINS = ['https://buildthomas.github.io', 'http://localhost:4173'];

const RESULT_KEY = 'medley:handoff-result';

interface Payload {
  type: 'medley:handoff';
  games: Game[];
  tracks: Track[];
  sources: Source[];
  plays: { trackId: string; gameId: string; at: number; skipped: boolean }[];
  settings: Record<string, string>;
}

// ---- in the preview ------------------------------------------------------------------------

/** Opens the local Medley and sends this library to it. Resolves with an error message, or null. */
export async function sendToLocal(): Promise<string | null> {
  const win = window.open(`${LOCAL_ORIGIN}/?from=preview`, '_blank');
  if (!win) return 'The browser blocked the new tab. Allow pop-ups for this page and try again.';
  const [games, tracks, sources, plays] = await Promise.all([db.games.toArray(), db.tracks.toArray(), db.sources.toArray(), db.plays.toArray()]);
  const settings: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (k.startsWith('medley:') && !k.startsWith('medley:demo')) settings[k] = localStorage.getItem(k)!;
  }
  const payload: Payload = {
    type: 'medley:handoff',
    games,
    tracks,
    sources,
    plays: plays.map(({ trackId, gameId, at, skipped }) => ({ trackId, gameId, at, skipped })),
    settings,
  };
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish('Your local Medley didn’t answer. Is it running (npm run dev) at localhost:32123?'), 20_000);
    const finish = (err: string | null) => {
      clearTimeout(timer);
      removeEventListener('message', onMessage);
      resolve(err);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== LOCAL_ORIGIN || e.source !== win) return;
      if (e.data?.type === 'medley:handoff-ready') win.postMessage(payload, LOCAL_ORIGIN);
      else if (e.data?.type === 'medley:handoff-done') finish(null);
    };
    addEventListener('message', onMessage);
  });
}

// ---- in the local app ----------------------------------------------------------------------

/** Called on start-up: when opened by the preview, takes its library and merges it in. */
export async function receiveFromPreview(): Promise<void> {
  const url = new URL(location.href);
  if (url.searchParams.get('from') !== 'preview' || !window.opener) return;
  url.searchParams.delete('from');
  history.replaceState(null, '', url);

  const payload = await new Promise<Payload | null>((resolve) => {
    const timer = setTimeout(() => done(null), 30_000);
    const done = (p: Payload | null) => {
      clearTimeout(timer);
      removeEventListener('message', onMessage);
      resolve(p);
    };
    const onMessage = (e: MessageEvent) => {
      if (!PREVIEW_ORIGINS.includes(e.origin) || e.source !== window.opener) return;
      if (e.data?.type === 'medley:handoff') done(e.data as Payload);
    };
    addEventListener('message', onMessage);
    // Only "ready" goes out before we know who opened us; the library comes back to us.
    for (const origin of PREVIEW_ORIGINS) window.opener.postMessage({ type: 'medley:handoff-ready' }, origin);
  });
  if (!payload) return;

  const added = await mergeLibrary(payload);
  for (const origin of PREVIEW_ORIGINS) window.opener?.postMessage({ type: 'medley:handoff-done' }, origin);
  try {
    sessionStorage.setItem(RESULT_KEY, added ? `Brought over ${added} from the preview.` : 'Your preview library was already here.');
  } catch {
    /* no notice then */
  }
}

/** The one-time notice after a hand-over ("Brought over 12 titles…"), or null. */
export function takeHandoffResult(): string | null {
  try {
    const msg = sessionStorage.getItem(RESULT_KEY);
    sessionStorage.removeItem(RESULT_KEY);
    return msg;
  } catch {
    return null;
  }
}

/**
 * Adds the preview's library to this one without losing anything here: titles and sources
 * that exist stay as they are, tracks keep the local row but gain likes, bans and play counts,
 * plays are added (as new rows), and settings fill in only what isn't set locally.
 */
async function mergeLibrary(p: Payload): Promise<string | null> {
  let newTitles = 0;
  await db.transaction('rw', [db.games, db.tracks, db.sources, db.plays], async () => {
    const haveGames = new Set((await db.games.bulkGet(p.games.map((g) => g.id))).filter(Boolean).map((g) => g!.id));
    const freshGames = p.games.filter((g) => !haveGames.has(g.id));
    newTitles = freshGames.length;
    await db.games.bulkAdd(freshGames);

    const haveSources = new Set((await db.sources.bulkGet(p.sources.map((s) => s.id))).filter(Boolean).map((s) => s!.id));
    await db.sources.bulkAdd(p.sources.filter((s) => !haveSources.has(s.id)));

    // Plays already brought over (same track, same moment) aren't added twice, so handing over
    // again is harmless; counts on existing tracks grow by the genuinely new plays only.
    const seen = new Set((await db.plays.where('at').anyOf(p.plays.map((x) => x.at)).toArray()).map((x) => `${x.trackId}@${x.at}`));
    const newPlays = p.plays.filter((x) => !seen.has(`${x.trackId}@${x.at}`));
    const local = await db.tracks.bulkGet(p.tracks.map((t) => t.id));
    const rows = p.tracks.map((t, i) => {
      const l = local[i];
      if (!l) return t;
      const mine = newPlays.filter((x) => x.trackId === t.id);
      return {
        ...l,
        liked: l.liked || t.liked,
        banned: l.banned || t.banned,
        playCount: l.playCount + mine.length,
        skipCount: l.skipCount + mine.filter((x) => x.skipped).length,
        lastPlayedAt: Math.max(l.lastPlayedAt ?? 0, t.lastPlayedAt ?? 0) || null,
      };
    });
    await db.tracks.bulkPut(rows);
    await db.plays.bulkAdd(newPlays);
    p.plays = newPlays;
  });
  for (const [k, v] of Object.entries(p.settings)) {
    try {
      if (localStorage.getItem(k) == null) localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  }
  if (newTitles) return `${newTitles} title${newTitles === 1 ? '' : 's'}`;
  return p.plays.length ? `${p.plays.length} plays` : null;
}
