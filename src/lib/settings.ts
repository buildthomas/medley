import type { Filters } from '../types';

const KEY = 'medley:filters';

export const DEFAULT_FILTERS: Filters = {
  genres: {},
  types: { extended: 'out' },
  // Fanfares, stingers and sound effects under 30 s aren't really listening material.
  lengths: { jingle: 'out' },
  decades: {},
  variety: 0.7,
  familiarity: 0.35,
};

export function loadFilters(): Filters {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_FILTERS, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable — fall back to defaults */
  }
  return DEFAULT_FILTERS;
}

export function saveFilters(f: Filters) {
  try {
    localStorage.setItem(KEY, JSON.stringify(f));
  } catch {
    /* ignore */
  }
}
