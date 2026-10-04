import { useMemo, useState } from 'react';
import { db } from '../db';
import { TRACK_TYPES } from '../lib/parse';
import { buildIndex, search } from '../lib/search';
import { decadeOf, poolStats } from '../lib/picker';
import { DEFAULT_FILTERS } from '../lib/settings';
import type { ChipState, Filters, Game, Track } from '../types';
import { Section, Slider, TriChips } from './ui';

export function FiltersPanel({
  filters,
  setFilters,
  games,
  tracks,
}: {
  filters: Filters;
  setFilters(f: Filters): void;
  games: Game[];
  tracks: Track[];
}) {
  const [gameQuery, setGameQuery] = useState('');

  const { genreCounts, decadeCounts, typeCounts, franchiseCounts, platformCounts, keywordCounts } = useMemo(() => {
    const genreCounts = new Map<string, number>();
    const decadeCounts = new Map<string, number>();
    const typeCounts = new Map<string, number>();
    const franchiseCounts = new Map<string, number>();
    const platformCounts = new Map<string, number>();
    const keywordCounts = new Map<string, number>();
    const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
    for (const g of games) {
      for (const genre of g.genres) bump(genreCounts, genre);
      bump(decadeCounts, decadeOf(g.year));
      const f = g.franchise ?? g.series;
      if (f) bump(franchiseCounts, f);
      for (const p of g.platforms ?? []) bump(platformCounts, p);
      for (const k of g.keywords ?? []) bump(keywordCounts, k);
    }
    for (const t of tracks) for (const ty of t.types) bump(typeCounts, ty);
    // A franchise of one game is just that game; the Games list covers it.
    for (const [k, n] of franchiseCounts) if (n < 2) franchiseCounts.delete(k);
    return { genreCounts, decadeCounts, typeCounts, franchiseCounts, platformCounts, keywordCounts };
  }, [games, tracks]);

  const trackCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tracks) m.set(t.gameId, (m.get(t.gameId) ?? 0) + 1);
    return m;
  }, [tracks]);

  const pool = useMemo(() => poolStats(games, tracks, filters), [games, tracks, filters]);

  const genres = [...genreCounts.keys()].sort().map((g) => ({ id: g, label: g }));
  const decades = [...decadeCounts.keys()].sort().map((d) => ({ id: d, label: d }));
  const gameSearch = useMemo(
    () => buildIndex(games, (g) => ({ title: g.title, other: [g.series, g.franchise, ...g.composers] })),
    [games],
  );
  const shownGames = gameQuery.trim()
    ? search(gameSearch, gameQuery)
    : games.slice().sort((a, b) => a.title.localeCompare(b.title));

  const set = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch });

  async function setAllGames(enabled: boolean) {
    await db.games.bulkUpdate(shownGames.map((g) => ({ key: g.id, changes: { enabled } })));
  }

  return (
    <aside className="filters">
      <div className="pool">
        <strong>{pool.tracks.toLocaleString()}</strong> tracks from <strong>{pool.games}</strong> games in rotation
        {JSON.stringify({ ...filters, variety: 0, familiarity: 0 }) !==
          JSON.stringify({ ...DEFAULT_FILTERS, variety: 0, familiarity: 0 }) && (
          <button
            className="link"
            onClick={() =>
              set({ genres: {}, types: DEFAULT_FILTERS.types, decades: {}, franchises: {}, platforms: {}, keywords: {} })
            }
          >
            reset filters
          </button>
        )}
      </div>

      <Section title="Mix">
        <Slider
          label="Variety"
          left="Stay a while"
          right="Always a new game"
          value={filters.variety}
          onChange={(variety) => set({ variety })}
        />
        <Slider
          label="Familiarity"
          left="Discover"
          right="Favourites"
          value={filters.familiarity}
          onChange={(familiarity) => set({ familiarity })}
        />
      </Section>

      <Section title="Track types">
        <TriChips
          options={TRACK_TYPES.map((t) => ({ id: t.id, label: t.label }))}
          state={filters.types}
          counts={typeCounts}
          onChange={(types) => set({ types })}
        />
        <p className="hint">Click once for “only”, twice to exclude.</p>
      </Section>

      {genres.length > 0 && (
        <Section title="Genres">
          <TriChips options={genres} state={filters.genres} counts={genreCounts} onChange={(g) => set({ genres: g })} />
        </Section>
      )}

      {franchiseCounts.size > 0 && (
        <Section title="Series & franchises">
          <TopChips counts={franchiseCounts} state={filters.franchises ?? {}} onChange={(f) => set({ franchises: f })} />
        </Section>
      )}

      {platformCounts.size > 0 && (
        <Section title="Platforms">
          <TopChips counts={platformCounts} state={filters.platforms ?? {}} onChange={(p) => set({ platforms: p })} />
        </Section>
      )}

      {keywordCounts.size > 0 && (
        <Section title="Keywords">
          <TopChips counts={keywordCounts} state={filters.keywords ?? {}} onChange={(k) => set({ keywords: k })} />
        </Section>
      )}

      {decades.length > 1 && (
        <Section title="Era">
          <TriChips options={decades} state={filters.decades} counts={decadeCounts} onChange={(d) => set({ decades: d })} />
        </Section>
      )}

      <Section
        title={`Games (${games.filter((g) => g.enabled).length}/${games.length})`}
        aside={
          <span className="row-actions">
            <button className="link" onClick={() => setAllGames(true)}>
              all
            </button>
            <button className="link" onClick={() => setAllGames(false)}>
              none
            </button>
          </span>
        }
      >
        <input
          className="search"
          placeholder="Filter games…"
          value={gameQuery}
          onChange={(e) => setGameQuery(e.target.value)}
        />
        <ul className="game-toggles">
          {shownGames.map((g) => (
            <li key={g.id}>
              <label>
                <input
                  type="checkbox"
                  checked={g.enabled}
                  onChange={(e) => db.games.update(g.id, { enabled: e.target.checked })}
                />
                <span className="truncate">{g.title}</span>
                <span className="muted">{trackCounts.get(g.id) ?? 0}</span>
              </label>
            </li>
          ))}
        </ul>
      </Section>
    </aside>
  );
}

/** Tri-state chips for long lists: the most common values first, the rest behind a filter box. */
function TopChips({
  counts,
  state,
  onChange,
}: {
  counts: Map<string, number>;
  state: ChipState;
  onChange(next: ChipState): void;
}) {
  const [all, setAll] = useState(false);
  const [q, setQ] = useState('');
  const sorted = [...counts].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const selected = sorted.filter((k) => state[k]);
  const pool = all ? sorted.filter((k) => !q || k.toLowerCase().includes(q.toLowerCase())) : sorted.slice(0, 14);
  const shown = [...selected, ...pool.filter((k) => !state[k])].slice(0, all ? 200 : 14 + selected.length);
  return (
    <>
      {all && <input className="search" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />}
      <TriChips options={shown.map((k) => ({ id: k, label: k }))} state={state} counts={counts} onChange={onChange} />
      {sorted.length > 14 && (
        <button className="link" onClick={() => setAll(!all)}>
          {all ? 'show fewer' : `show all ${sorted.length}`}
        </button>
      )}
    </>
  );
}
