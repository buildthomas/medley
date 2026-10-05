import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { loadSavedSession, readUrlState, saveSession, writeUrlState, type Program } from './lib/urlState';
import { gamePasses, pickNext, trackPasses, type HistoryEntry } from './lib/picker';
import type { Filters, Game, Track } from './types';

const QUEUE_SIZE = 4;
const HISTORY_WINDOW = 400;

const NO_TRACKS: Track[] = [];

export function useSession(filters: Filters) {
  // undefined until the database has answered, so views can tell "loading" from "empty".
  const loadedTracks = useLiveQuery(() => db.tracks.toArray(), []);
  const games = useLiveQuery(() => db.games.toArray(), [], [] as Game[]);
  const tracks = loadedTracks ?? NO_TRACKS;
  const loaded = loadedTracks !== undefined;
  const recentPlays = useLiveQuery(
    () => db.plays.orderBy('at').reverse().limit(HISTORY_WINDOW).toArray(),
    [],
    [],
  );

  // Restore where we left off: current track + position from the URL, queue from localStorage.
  const [initial] = useState(() => ({ url: readUrlState(), saved: loadSavedSession() }));
  const [currentId, setCurrentId] = useState<string | null>(initial.url.track ?? null);
  const [queueIds, setQueueIds] = useState<string[]>(initial.saved.queue);
  const [backStack, setBackStack] = useState<string[]>(initial.saved.back);
  const [program, setProgram] = useState<Program | null>(initial.saved.program ?? null);
  /** Set after a refresh: the restored track waits (paused, at this position) until you press play. */
  const [resumeAt, setResumeAt] = useState<number | null>(initial.url.track ? (initial.url.t ?? 0) : null);

  useEffect(() => {
    saveSession({ queue: queueIds, back: backStack.slice(-50), program });
  }, [queueIds, backStack, program]);
  useEffect(() => {
    writeUrlState({ track: currentId ?? undefined, ...(resumeAt == null ? { t: undefined } : {}) });
  }, [currentId]);
  const currentPlayId = useRef<number | null>(null);

  const trackMap = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);
  const gameMap = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);
  const current = currentId ? (trackMap.get(currentId) ?? null) : null;

  const history = useCallback(
    (extra: string[]): HistoryEntry[] => {
      const h: HistoryEntry[] = recentPlays
        .slice()
        .reverse()
        .map((p) => ({ trackId: p.trackId, gameId: p.gameId }));
      for (const id of extra) {
        const t = trackMap.get(id);
        if (t) h.push({ trackId: t.id, gameId: t.gameId });
      }
      return h;
    },
    [recentPlays, trackMap],
  );

  const isPlayable = useCallback(
    (id: string) => {
      const t = trackMap.get(id);
      const g = t && gameMap.get(t.gameId);
      return !!(t && g && gamePasses(g, filters) && trackPasses(t, filters));
    },
    [trackMap, gameMap, filters],
  );

  // Keep the up-next queue valid for the current filters and topped up.
  useEffect(() => {
    if (!tracks.length) return;
    setQueueIds((q) => {
      const kept = q.filter(isPlayable);
      const pending = currentId ? [currentId, ...kept] : [...kept];
      while (kept.length < QUEUE_SIZE) {
        const t = pickNext(games, tracks, history(pending), filters);
        if (!t || pending.includes(t.id)) break;
        kept.push(t.id);
        pending.push(t.id);
      }
      return kept.length === q.length && kept.every((id, i) => id === q[i]) ? q : kept;
    });
  }, [games, tracks, filters, currentId, isPlayable, history]);

  /**
   * Switch to a track. The UI updates immediately; bookkeeping (play row, counters, and an
   * early-skip mark on the previous track) is written afterwards in ONE transaction, because
   * every write to `tracks` makes the live query re-read the whole library (~70k rows).
   */
  const startTrack = useCallback(
    async (id: string, skipped?: Track | null) => {
      const t = trackMap.get(id);
      if (!t) return;
      setResumeAt(null);
      setCurrentId(id);
      const prevPlayId = currentPlayId.current;
      const now = Date.now();
      await db.transaction('rw', db.plays, db.tracks, async () => {
        if (skipped) {
          if (prevPlayId != null) await db.plays.update(prevPlayId, { skipped: true });
          await db.tracks.update(skipped.id, { skipCount: skipped.skipCount + 1 });
        }
        currentPlayId.current = (await db.plays.add({ trackId: t.id, gameId: t.gameId, at: now, skipped: false })) as number;
        await db.tracks.update(t.id, { playCount: t.playCount + 1, lastPlayedAt: now });
      });
    },
    [trackMap],
  );

  /** Advance. `elapsed` lets us treat early skips as a (mild) dislike. */
  const next = useCallback(
    async (opts: { skipped?: boolean; elapsed?: number } = {}) => {
      // An early skip counts as a mild dislike (recorded together with the next play).
      const early =
        current && opts.skipped && (opts.elapsed ?? 0) < Math.min(60, (current.duration ?? 180) * 0.5) ? current : null;
      // A program (whole soundtrack) plays in its own order and ignores the rotation filters,
      // except for tracks you banned or that can't play.
      let nextId: string | undefined;
      if (program) {
        const rest = program.ids.filter((id) => {
          const t = trackMap.get(id);
          return t && !t.banned && !t.unavailable;
        });
        nextId = rest[0];
        setProgram(rest.length > 1 ? { ...program, ids: rest.slice(1) } : null);
      }
      nextId ??= queueIds.find(isPlayable);
      if (!nextId) {
        const t = pickNext(games, tracks, history(currentId ? [currentId] : []), filters);
        nextId = t?.id;
      }
      if (!nextId) return;
      if (currentId) setBackStack((b) => [...b.slice(-49), currentId]);
      setQueueIds((q) => q.filter((id) => id !== nextId));
      await startTrack(nextId, early);
    },
    [current, currentId, queueIds, isPlayable, games, tracks, filters, history, startTrack, program, trackMap],
  );

  const prev = useCallback(() => {
    const id = backStack[backStack.length - 1];
    if (!id) return;
    setBackStack((b) => b.slice(0, -1));
    if (currentId) {
      if (program) setProgram({ ...program, ids: [currentId, ...program.ids] });
      else setQueueIds((q) => [currentId, ...q]);
    }
    setResumeAt(null);
    setCurrentId(id);
  }, [backStack, currentId, program]);

  const playNow = useCallback(
    async (id: string) => {
      if (currentId) setBackStack((b) => [...b.slice(-49), currentId]);
      setQueueIds((q) => q.filter((x) => x !== id));
      await startTrack(id);
    },
    [currentId, startTrack],
  );

  const reroll = useCallback(() => setQueueIds([]), []);

  /** Play these tracks in this order (or shuffled) now, then return to the shuffle. */
  const playProgram = useCallback(
    async (label: string, ids: string[], opts: { shuffle?: boolean } = {}) => {
      const order = ids.slice();
      if (opts.shuffle) {
        for (let i = order.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [order[i], order[j]] = [order[j], order[i]];
        }
      }
      const [first, ...rest] = order;
      if (!first) return;
      setProgram(rest.length ? { label, ids: rest } : null);
      if (currentId) setBackStack((b) => [...b.slice(-49), currentId]);
      await startTrack(first);
    },
    [currentId, startTrack],
  );
  const stopProgram = useCallback(() => setProgram(null), []);
  const clearResume = useCallback(() => setResumeAt(null), []);

  return {
    games,
    loaded,
    tracks,
    gameMap,
    trackMap,
    current,
    currentGame: current ? (gameMap.get(current.gameId) ?? null) : null,
    queue: queueIds.map((id) => trackMap.get(id)).filter((t): t is Track => !!t),
    program: program && {
      label: program.label,
      tracks: program.ids.map((id) => trackMap.get(id)).filter((t): t is Track => !!t),
    },
    playProgram,
    stopProgram,
    recentPlays,
    canGoBack: backStack.length > 0,
    resumeAt,
    clearResume,
    next,
    prev,
    playNow,
    reroll,
  };
}

export type Session = ReturnType<typeof useSession>;
