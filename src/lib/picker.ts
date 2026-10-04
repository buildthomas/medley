// The shuffle. Two stages so big soundtracks don't drown out small ones:
//   1. pick a WORK (game, film, anime, artist…). The Variety knob decides how sticky the
//      current work is (play a few of its tracks in a row) vs how long a work rests after
//      playing (cooldown); series/composer repeats and likes nudge the weights;
//   2. pick a TRACK inside that work, favouring unheard or liked tracks depending on the
//      Familiarity knob, and penalising early skips.

import type { ChipState, Filters, Game, Track } from '../types';

export interface HistoryEntry {
  trackId: string;
  gameId: string;
}

export function decadeOf(year: number | null): string {
  return year ? `${Math.floor(year / 10) * 10}s` : 'Unknown';
}

// ---- derived track facets ---------------------------------------------------------------

export const LENGTHS = [
  { id: 'jingle', label: 'Jingles < 30s', max: 30 },
  { id: 'short', label: 'Short < 1:30', max: 90 },
  { id: 'standard', label: 'Standard', max: 360 },
  { id: 'long', label: 'Long > 6 min', max: Infinity },
] as const;

/** Length bucket from the playable duration. Jingles (fanfares, stingers, SFX) are excluded by default. */
export function lengthOf(t: Pick<Track, 'duration'>): string {
  if (t.duration == null) return 'standard';
  return LENGTHS.find((l) => t.duration! < l.max)!.id;
}

/** Sung or instrumental. Game tracks are instrumental unless titled as vocal; songs/OPs/EDs are vocal. */
export function isVocal(t: Pick<Track, 'vocal' | 'types' | 'role'>): boolean {
  if (t.vocal != null) return t.vocal;
  if (t.role && t.role !== 'score') return true;
  return t.types.includes('vocal');
}

export const voiceOf = (t: Track) => (isVocal(t) ? 'vocal' : 'instrumental');

// ---- filters -------------------------------------------------------------------------------

function passesChips(values: string[], chips: ChipState | undefined): boolean {
  if (!chips) return true;
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
    passesChips([game.kind ?? 'game'], filters.kinds) &&
    passesChips(game.genres, filters.genres) &&
    passesChips([decadeOf(game.year)], filters.decades) &&
    passesChips([game.franchise ?? game.series ?? ''], filters.franchises) &&
    passesChips(game.platforms ?? [], filters.platforms) &&
    passesChips(game.keywords ?? [], filters.keywords)
  );
}

export function trackPasses(track: Track, filters: Filters): boolean {
  return (
    !track.banned &&
    !track.unavailable &&
    passesChips(track.types, filters.types) &&
    passesChips([lengthOf(track)], filters.lengths) &&
    passesChips([voiceOf(track)], filters.voice) &&
    passesChips([track.role ?? (track.types.includes('vocal') ? 'song' : 'score')], filters.roles)
  );
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

/**
 * Variety knob (0..1) → behaviour:
 *   stay      chance to pick from the work that just played (0 → 75%, 0.5 → ~27%, 1 → 0%)
 *   cooldown  plays a work rests before it can come back (0 → 0, 0.5 → ~35% of max, 1 → up to 60)
 */
export function varietyParams(variety: number, eligibleWorks: number) {
  const v = Math.max(0, Math.min(1, variety));
  return {
    stay: 0.75 * Math.pow(1 - v, 1.5),
    cooldown: Math.round(Math.pow(v, 1.5) * Math.min(60, Math.max(0, eligibleWorks - 1) * 0.5)),
  };
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

  // How many plays ago each work / track last appeared (1 = just now).
  const gameAgo = new Map<string, number>();
  const trackAgo = new Map<string, number>();
  for (let i = history.length - 1, d = 1; i >= 0; i--, d++) {
    const h = history[i];
    if (!gameAgo.has(h.gameId)) gameAgo.set(h.gameId, d);
    if (!trackAgo.has(h.trackId)) trackAgo.set(h.trackId, d);
  }

  const { stay, cooldown } = varietyParams(filters.variety, gameIds.length);
  const totalEligible = [...byGame.values()].reduce((a, l) => a + l.length, 0);
  const trackCooldown = Math.min(300, Math.floor(totalEligible * 0.7));
  const fresh = (list: Track[]) => list.filter((t) => (trackAgo.get(t.id) ?? Infinity) > trackCooldown);
  const f = filters.familiarity;

  // Stage 1a: stay with the current work for another track?
  const last = history[history.length - 1];
  let gameId: string | null = null;
  if (last && byGame.has(last.gameId) && fresh(byGame.get(last.gameId)!).length && rand() < stay) {
    gameId = last.gameId;
  }

  // Stage 1b: otherwise pick a work by weight.
  if (!gameId) {
    const recentGames = history
      .slice(-Math.max(2, Math.ceil(cooldown / 2) + 1))
      .map((h) => gameMap.get(h.gameId))
      .filter((g): g is Game => !!g);
    const lastTwo = recentGames.slice(-2);
    const gameWeights = gameIds.map((id) => {
      const g = gameMap.get(id)!;
      const ago = gameAgo.get(id) ?? Infinity;
      if (ago <= cooldown || id === last?.gameId) return 0;
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
    gameId = weightedPick(gameIds, gameWeights, rand);
    // Everything is cooling down (tiny library): fall back to least recent.
    if (!gameId) gameId = weightedPick(gameIds, gameIds.map((id) => gameAgo.get(id) ?? 1000), rand)!;
  }

  // Stage 2: a track within the work.
  const candidates = byGame.get(gameId)!;
  let pool = fresh(candidates);
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
