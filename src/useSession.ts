import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { loadSavedSession, readUrlState, saveSession, writeUrlState } from './lib/urlState';
import { gamePasses, pickNext, trackPasses, type HistoryEntry } from './lib/picker';
import type { Filters, Game, Track } from './types';

const QUEUE_SIZE = 4;
const HISTORY_WINDOW = 400;

export function useSession(filters: Filters) {
  const games = useLiveQuery(() => db.games.toArray(), [], [] as Game[]);
  const tracks = useLiveQuery(() => db.tracks.toArray(), [], [] as Track[]);
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
  /** Set after a refresh: the restored track waits (paused, at this position) until you press play. */
  const [resumeAt, setResumeAt] = useState<number | null>(initial.url.track ? (initial.url.t ?? 0) : null);

  useEffect(() => {
    saveSession({ queue: queueIds, back: backStack.slice(-50) });
  }, [queueIds, backStack]);
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

  const startTrack = useCallback(
    async (id: string) => {
      const t = trackMap.get(id);
      if (!t) return;
      setResumeAt(null);
      setCurrentId(id);
      const now = Date.now();
      currentPlayId.current = (await db.plays.add({ trackId: t.id, gameId: t.gameId, at: now, skipped: false })) as number;
      await db.tracks.update(t.id, { playCount: t.playCount + 1, lastPlayedAt: now });
    },
    [trackMap],
  );

  /** Advance. `elapsed` lets us treat early skips as a (mild) dislike. */
  const next = useCallback(
    async (opts: { skipped?: boolean; elapsed?: number } = {}) => {
      if (current && opts.skipped) {
        const len = current.duration ?? 180;
        const early = (opts.elapsed ?? 0) < Math.min(60, len * 0.5);
        if (early) {
          if (currentPlayId.current != null) await db.plays.update(currentPlayId.current, { skipped: true });
          await db.tracks.update(current.id, { skipCount: current.skipCount + 1 });
        }
      }
      let nextId = queueIds.find(isPlayable);
      if (!nextId) {
        const t = pickNext(games, tracks, history(currentId ? [currentId] : []), filters);
        nextId = t?.id;
      }
      if (!nextId) return;
      if (currentId) setBackStack((b) => [...b.slice(-49), currentId]);
      setQueueIds((q) => q.filter((id) => id !== nextId));
      await startTrack(nextId);
    },
    [current, currentId, queueIds, isPlayable, games, tracks, filters, history, startTrack],
  );

  const prev = useCallback(() => {
    const id = backStack[backStack.length - 1];
    if (!id) return;
    setBackStack((b) => b.slice(0, -1));
    if (currentId) setQueueIds((q) => [currentId, ...q]);
    setResumeAt(null);
    setCurrentId(id);
  }, [backStack, currentId]);

  const playNow = useCallback(
    async (id: string) => {
      if (currentId) setBackStack((b) => [...b.slice(-49), currentId]);
      setQueueIds((q) => q.filter((x) => x !== id));
      await startTrack(id);
    },
    [currentId, startTrack],
  );

  const reroll = useCallback(() => setQueueIds([]), []);
  const clearResume = useCallback(() => setResumeAt(null), []);

  return {
    games,
    tracks,
    gameMap,
    trackMap,
    current,
    currentGame: current ? (gameMap.get(current.gameId) ?? null) : null,
    queue: queueIds.map((id) => trackMap.get(id)).filter((t): t is Track => !!t),
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
