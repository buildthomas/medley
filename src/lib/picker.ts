// The shuffle. Two stages so big soundtracks don't drown out small ones:
//   1. pick a GAME, weighted by how long since it last played (cooldown),
//      series/composer variety, and likes;
//   2. pick a TRACK inside that game, favouring unheard or liked tracks
//      depending on the familiarity knob, and penalising skips.

import type { ChipState, Filters, Game, Track } from '../types';

export interface HistoryEntry {
  trackId: string;
  gameId: string;
}

export function decadeOf(year: number | null): string {
  return year ? `${Math.floor(year / 10) * 10}s` : 'Unknown';
}

function passesChips(values: string[], chips: ChipState): boolean {
  let hasIn = false;
  let matchedIn = false;
  for (const [key, state] of Object.entries(chips)) {
    if (state === 'out' && values.includes(key)) return false;
    if (state === 'in') {
      hasIn = true;
      if (values.includes(key)) matchedIn = true;
    }
  }
  return !hasIn || matchedIn;
}

export function gamePasses(game: Game, filters: Filters): boolean {
  return (
    game.enabled &&
    passesChips(game.genres, filters.genres) &&
    passesChips([decadeOf(game.year)], filters.decades) &&
    passesChips([game.franchise ?? game.series ?? ''], filters.franchises ?? {}) &&
    passesChips(game.platforms ?? [], filters.platforms ?? {}) &&
    passesChips(game.keywords ?? [], filters.keywords ?? {})
  );
}

export function trackPasses(track: Track, filters: Filters): boolean {
  return !track.banned && !track.unavailable && passesChips(track.types, filters.types);
}

export function eligibleByGame(games: Game[], tracks: Track[], filters: Filters): Map<string, Track[]> {
  const okGames = new Set(games.filter((g) => gamePasses(g, filters)).map((g) => g.id));
  const out = new Map<string, Track[]>();
  for (const t of tracks) {
    if (!okGames.has(t.gameId) || !trackPasses(t, filters)) continue;
    let list = out.get(t.gameId);
    if (!list) out.set(t.gameId, (list = []));
    list.push(t);
  }
  return out;
}

function weightedPick<T>(items: T[], weights: number[], rand: () => number): T | null {
  const total = weights.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return null;
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

export function pickNext(
  games: Game[],
  tracks: Track[],
  history: HistoryEntry[], // oldest first; includes already-queued tracks
  filters: Filters,
  rand: () => number = Math.random,
): Track | null {
  const byGame = eligibleByGame(games, tracks, filters);
  if (!byGame.size) return null;
  const gameMap = new Map(games.map((g) => [g.id, g]));
  const gameIds = [...byGame.keys()];

  // How many plays ago each game / track last appeared (1 = just now).
  const gameAgo = new Map<string, number>();
  const trackAgo = new Map<string, number>();
  for (let i = history.length - 1, d = 1; i >= 0; i--, d++) {
    const h = history[i];
    if (!gameAgo.has(h.gameId)) gameAgo.set(h.gameId, d);
    if (!trackAgo.has(h.trackId)) trackAgo.set(h.trackId, d);
  }

  const cooldown = Math.round(filters.variety * Math.min(12, gameIds.length - 1));
  const recentGames = history
    .slice(-Math.max(2, Math.ceil(cooldown / 2) + 1))
    .map((h) => gameMap.get(h.gameId))
    .filter((g): g is Game => !!g);
  const lastTwo = recentGames.slice(-2);
  const f = filters.familiarity;

  const gameWeights = gameIds.map((id) => {
    const g = gameMap.get(id)!;
    const ago = gameAgo.get(id) ?? Infinity;
    if (ago <= cooldown) return 0;
    let w = ago === Infinity ? 1 : Math.min(1, 0.25 + (0.75 * (ago - cooldown)) / (cooldown + 1));
    if (g.series && recentGames.some((r) => r.id !== id && r.series === g.series)) w *= 0.35;
    if (g.composers.length && lastTwo.some((r) => r.id !== id && r.composers.some((c) => g.composers.includes(c))))
      w *= 0.5;
    const list = byGame.get(id)!;
    const liked = list.filter((t) => t.liked).length;
    w *= 1 + 0.25 * Math.min(liked, 4) * f;
    w *= 0.6 + 0.4 * Math.min(1, Math.log2(1 + list.length) / 5);
    return w;
  });

  let gameId = weightedPick(gameIds, gameWeights, rand);
  // Everything is cooling down (tiny library): fall back to least recent.
  if (!gameId) gameId = weightedPick(gameIds, gameIds.map((id) => gameAgo.get(id) ?? 1000), rand)!;

  const candidates = byGame.get(gameId)!;
  const totalEligible = [...byGame.values()].reduce((a, l) => a + l.length, 0);
  const trackCooldown = Math.min(300, Math.floor(totalEligible * 0.7));
  let pool = candidates.filter((t) => (trackAgo.get(t.id) ?? Infinity) > trackCooldown);
  if (!pool.length) {
    const maxAgo = Math.max(...candidates.map((t) => trackAgo.get(t.id) ?? Infinity));
    pool = candidates.filter((t) => (trackAgo.get(t.id) ?? Infinity) === maxAgo);
  }

  const trackWeights = pool.map((t) => {
    let w = t.liked ? 1 + 4 * f : 1;
    w *= 1 / Math.pow(1 + t.playCount, 1.2 * (1 - f));
    w *= Math.pow(0.6, Math.min(t.skipCount, 5));
    return w;
  });
  return weightedPick(pool, trackWeights, rand);
}

/** Size of the current pool, for the UI. */
export function poolStats(games: Game[], tracks: Track[], filters: Filters) {
  const byGame = eligibleByGame(games, tracks, filters);
  let n = 0;
  for (const l of byGame.values()) n += l.length;
  return { games: byGame.size, tracks: n };
}
