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

  /** Programs ignore the rotation filters, but never play banned or broken tracks. */
  const programPlayable = useCallback(
    (id: string) => {
      const t = trackMap.get(id);
      return !!t && !t.banned && !t.unavailable;
    },
    [trackMap],
  );

  // Variety and Familiarity only weight the picks (every queued track still passes), so the
  // queue below would keep its old picks. Re-pick it once the slider settles instead.
  const weights = `${filters.variety}|${filters.familiarity}`;
  const lastWeights = useRef(weights);
  useEffect(() => {
    if (weights === lastWeights.current) return;
    const timer = setTimeout(() => {
      lastWeights.current = weights;
      setQueueIds([]);
    }, 300);
    return () => clearTimeout(timer);
  }, [weights]);

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
    // queueIds too, so emptying it (reshuffle, a Variety change) refills it right away. The
    // updater returns the same array when nothing changes, so this doesn't loop.
  }, [games, tracks, filters, currentId, isPlayable, history, queueIds]);

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
      // except for tracks you banned or that can't play. With loop on it starts over (reshuffled
      // if shuffle is on); otherwise the shuffle takes over after the last track.
      let nextId: string | undefined;
      if (program) {
        let order = program.order;
        let i = order.findIndex((id, j) => j > program.pos && programPlayable(id));
        if (i < 0 && program.loop) {
          order = program.shuffle ? shuffled(program.ids) : program.ids;
          i = order.findIndex(programPlayable);
        }
        if (i >= 0) {
          nextId = order[i];
          setProgram({ ...program, order, pos: i });
        } else setProgram(null);
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
    [current, currentId, queueIds, isPlayable, games, tracks, filters, history, startTrack, program, programPlayable],
  );

  const prev = useCallback(() => {
    // In a program, previous steps back through its order (so x/y stays right).
    if (program && currentId === program.order[program.pos]) {
      const i = program.order.findLastIndex((id, j) => j < program.pos && programPlayable(id));
      if (i >= 0) {
        setProgram({ ...program, pos: i });
        setResumeAt(null);
        setCurrentId(program.order[i]);
        return;
      }
    }
    const id = backStack[backStack.length - 1];
    if (!id) return;
    setBackStack((b) => b.slice(0, -1));
    if (currentId && !program) setQueueIds((q) => [currentId, ...q]);
    setResumeAt(null);
    setCurrentId(id);
  }, [backStack, currentId, program, programPlayable]);

  const playNow = useCallback(
    async (id: string) => {
      if (currentId) setBackStack((b) => [...b.slice(-49), currentId]);
      setQueueIds((q) => q.filter((x) => x !== id));
      // Jumping to a track of the program moves its position there.
      const i = program ? program.order.indexOf(id) : -1;
      if (program && i >= 0) setProgram({ ...program, pos: i });
      await startTrack(id);
    },
    [currentId, startTrack, program],
  );

  const reroll = useCallback(() => setQueueIds([]), []);

  /** Play these tracks in this order (or shuffled) now, then return to the shuffle. */
  const playProgram = useCallback(
    async (label: string, ids: string[], opts: { shuffle?: boolean } = {}) => {
      const order = opts.shuffle ? shuffled(ids) : ids.slice();
      const first = order[0];
      if (!first) return;
      setProgram({ label, ids: ids.slice(), order, pos: 0, shuffle: !!opts.shuffle, loop: false });
      if (currentId) setBackStack((b) => [...b.slice(-49), currentId]);
      await startTrack(first);
    },
    [currentId, startTrack],
  );
  const stopProgram = useCallback(() => setProgram(null), []);
  const setProgramLoop = useCallback((loop: boolean) => setProgram((p) => p && { ...p, loop }), []);
  /** Shuffle (or restore) the tracks still to come; what has played keeps its place. */
  const setProgramShuffle = useCallback(
    (shuffle: boolean) =>
      setProgram((p) => {
        if (!p) return p;
        const played = p.order.slice(0, p.pos + 1);
        const seen = new Set(played);
        const rest = p.ids.filter((id) => !seen.has(id));
        return { ...p, shuffle, order: [...played, ...(shuffle ? shuffled(rest) : rest)] };
      }),
    [],
  );
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
      /** The tracks still to come, in play order. */
      tracks: program.order
        .slice(program.pos + 1)
        .filter(programPlayable)
        .map((id) => trackMap.get(id)!),
      /** "x of y", counting only tracks that can play. */
      position: program.order.slice(0, program.pos + 1).filter(programPlayable).length,
      total: program.order.filter(programPlayable).length,
      loop: !!program.loop,
      shuffle: !!program.shuffle,
    },
    playProgram,
    stopProgram,
    setProgramLoop,
    setProgramShuffle,
    recentPlays,
    canGoBack: backStack.length > 0 || (!!program && program.pos > 0),
    resumeAt,
    clearResume,
    next,
    prev,
    playNow,
    reroll,
  };
}

export type Session = ReturnType<typeof useSession>;

function shuffled<T>(items: T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
