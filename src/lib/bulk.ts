// Background bulk import. Lives outside React so it keeps running while you switch tabs;
// components subscribe with useBulkJob().
//
// Survives refreshes: the remaining queue is saved in the library's meta table and picked up
// again on start-up (resumeBulk). Each game is imported atomically, so an interrupted game is
// simply retried. Games that find no source are remembered (importFailures) so the weekly
// update can retry them later, e.g. after an unreleased game comes out.

import { useSyncExternalStore } from 'react';
import { db, getMeta, setMeta } from '../db';
import type { CatalogGame } from '../types';
import { autoAddGame } from './importer';

export interface BulkJob {
  label: string;
  total: number;
  done: number;
  added: number; // games that got tracks
  skipped: number; // already in library
  failed: { game: CatalogGame; reason: string }[];
  running: boolean;
}

interface SavedQueue {
  label: string;
  ids: string[];
  announce?: boolean;
}

/** Recently added titles, shown in the "new arrivals" banner until dismissed. */
export interface Arrivals {
  at: number;
  label: string;
  ids: string[]; // new titles
  newTrackIds?: string[]; // new tracks found in titles you already had (source sync)
  trackGameIds?: string[];
}

let job: BulkJob | null = null;
let queue: CatalogGame[] = [];
let cancelled = false;
let announce = false;
let addedIds: string[] = [];
const listeners = new Set<() => void>();

function emit() {
  job = job && { ...job };
  listeners.forEach((l) => l());
}

export function useBulkJob(): BulkJob | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => job,
  );
}

const CONCURRENCY = 4;

let saveTimer: number | null = null;
function persistQueue() {
  if (saveTimer != null) return;
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    const saved: SavedQueue | null =
      job?.running && queue.length ? { label: job.label, ids: queue.map((g) => g.id), announce } : null;
    void setMeta('bulkQueue', saved);
  }, 500);
}

async function recordFailure(game: CatalogGame, reason: string) {
  const failures = await getMeta<Record<string, { at: number; reason: string }>>('importFailures', {});
  failures[game.id] = { at: Date.now(), reason };
  await setMeta('importFailures', failures);
}

async function clearFailure(id: string) {
  const failures = await getMeta<Record<string, { at: number; reason: string }>>('importFailures', {});
  if (failures[id]) {
    delete failures[id];
    await setMeta('importFailures', failures);
  }
}

// Titles queued with `topUp`: imported even when already in the library (e.g. adding the
// openings of anime you already have; the anime importer skips songs you already have).
const topUpIds = new Set<string>();

/**
 * Queue games for import. If a job is already running they're appended to it.
 * `announce`: show what got added in the "new arrivals" banner (used by the weekly update).
 * `topUp`: don't skip titles that are already in the library.
 */
export function runBulk(label: string, games: CatalogGame[], opts: { announce?: boolean; topUp?: boolean } = {}) {
  if (opts.topUp) games.forEach((g) => topUpIds.add(g.id));
  const queued = new Set(queue.map((g) => g.id));
  const fresh = games.filter((g) => !queued.has(g.id));
  if (opts.announce) announce = true;
  if (job?.running) {
    queue.push(...fresh);
    job.total += fresh.length;
    if (!job.label.includes(label)) job.label = `${job.label} + ${label}`;
    emit();
    persistQueue();
    return;
  }
  queue = fresh;
  cancelled = false;
  addedIds = [];
  job = { label, total: fresh.length, done: 0, added: 0, skipped: 0, failed: [], running: true };
  emit();
  persistQueue();

  const worker = async () => {
    while (queue.length && !cancelled) {
      const game = queue.shift()!;
      persistQueue();
      try {
        if (!topUpIds.delete(game.id) && (await db.games.get(game.id))) job!.skipped++;
        else {
          const r = await autoAddGame(game);
          if (r.added > 0) {
            job!.added++;
            addedIds.push(game.id);
            void clearFailure(game.id);
          } else job!.skipped++;
        }
      } catch (e) {
        const reason = (e as Error).message;
        job!.failed.push({ game, reason });
        void recordFailure(game, reason);
      }
      job!.done++;
      emit();
    }
  };
  Promise.all(Array.from({ length: CONCURRENCY }, worker)).then(async () => {
    job!.running = false;
    job!.total = job!.done;
    queue = [];
    await setMeta('bulkQueue', null);
    if (announce && addedIds.length) {
      const prev = await getMeta<Arrivals | null>('arrivals', null);
      // Merge with an undismissed banner from earlier in the week.
      const ids = [...new Set([...(prev?.ids ?? []), ...addedIds])];
      await setMeta('arrivals', { ...prev, at: Date.now(), label: job!.label, ids } satisfies Arrivals);
    }
    announce = false;
    emit();
  });
}

/** Continue an import that was interrupted by a refresh or closed tab. */
export async function resumeBulk(byId: Map<string, CatalogGame>) {
  const saved = await getMeta<SavedQueue | null>('bulkQueue', null);
  if (!saved?.ids.length || job?.running) return;
  const games = saved.ids.map((id) => byId.get(id)).filter((g): g is CatalogGame => !!g);
  if (games.length) runBulk(saved.label.replace(/ \(resumed\)$/, '') + ' (resumed)', games, { announce: saved.announce });
}

export function cancelBulk() {
  cancelled = true;
  if (job) {
    job.total = job.done + CONCURRENCY; // the in-flight ones still finish
    emit();
  }
  void setMeta('bulkQueue', null);
}

export function dismissBulk() {
  if (job && !job.running) {
    job = null;
    emit();
  }
}
