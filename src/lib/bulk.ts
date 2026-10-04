// Background bulk import. Lives outside React so it keeps running while you
// switch tabs; components subscribe with useBulkJob().

import { useSyncExternalStore } from 'react';
import { db } from '../db';
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

let job: BulkJob | null = null;
let queue: CatalogGame[] = [];
let cancelled = false;
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

/** Queue games for import. If a job is already running they're appended to it. */
export function runBulk(label: string, games: CatalogGame[]) {
  const queued = new Set(queue.map((g) => g.id));
  const fresh = games.filter((g) => !queued.has(g.id));
  if (job?.running) {
    queue.push(...fresh);
    job.total += fresh.length;
    job.label = `${job.label} + ${label}`;
    emit();
    return;
  }
  queue = fresh;
  cancelled = false;
  job = { label, total: fresh.length, done: 0, added: 0, skipped: 0, failed: [], running: true };
  emit();

  const worker = async () => {
    while (queue.length && !cancelled) {
      const game = queue.shift()!;
      try {
        if (await db.games.get(game.id)) job!.skipped++;
        else {
          const r = await autoAddGame(game);
          if (r.added > 0) job!.added++;
          else job!.skipped++;
        }
      } catch (e) {
        job!.failed.push({ game, reason: (e as Error).message });
      }
      job!.done++;
      emit();
    }
  };
  Promise.all(Array.from({ length: CONCURRENCY }, worker)).then(() => {
    job!.running = false;
    job!.total = job!.done;
    queue = [];
    emit();
  });
}

export function cancelBulk() {
  cancelled = true;
  if (job) {
    job.total = job.done + CONCURRENCY; // the in-flight ones still finish
    emit();
  }
}

export function dismissBulk() {
  if (job && !job.running) {
    job = null;
    emit();
  }
}
