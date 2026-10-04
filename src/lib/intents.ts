// Cross-view navigation requests ("show these titles in Discover"), e.g. from the
// new-arrivals banner. App switches tab; DiscoverView consumes the pending intent.

import { useSyncExternalStore } from 'react';

export interface DiscoverIntent {
  title: string;
  ids: string[];
  /** Instead of a list of titles: browse everything with this tag (e.g. a composer). */
  facet?: { kind: string; value: string };
  at: number;
}

let pending: DiscoverIntent | null = null;
const listeners = new Set<() => void>();

export function requestDiscover(title: string, ids: string[], facet?: DiscoverIntent['facet']) {
  pending = { title, ids, facet, at: Date.now() };
  listeners.forEach((l) => l());
}

export function takeDiscoverIntent(): DiscoverIntent | null {
  const p = pending;
  pending = null;
  return p;
}

export function useDiscoverIntent() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => pending,
  );
}
