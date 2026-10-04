import { useMemo, useState } from 'react';
import { db } from '../db';
import { KINDS, ROLES, kindOf } from '../lib/kinds';
import { TRACK_TYPES } from '../lib/parse';
import { LENGTHS, decadeOf, lengthOf, poolStats, varietyParams, voiceOf } from '../lib/picker';
import { buildIndex, search } from '../lib/search';
import { DEFAULT_FILTERS } from '../lib/settings';
import type { ChipState, Filters, Game, Track } from '../types';
import { Section, Slider, TriChips } from './ui';

const count = (c: ChipState | undefined) => Object.keys(c ?? {}).length;

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

  const counts = useMemo(() => {
    const c = {
      genre: new Map<string, number>(),
      decade: new Map<string, number>(),
      type: new Map<string, number>(),
      franchise: new Map<string, number>(),
      platform: new Map<string, number>(),
      keyword: new Map<string, number>(),
      kind: new Map<string, number>(),
      role: new Map<string, number>(),
      voice: new Map<string, number>(),
      length: new Map<string, number>(),
    };
    const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
    for (const g of games) {
      for (const genre of g.genres) bump(c.genre, genre);
      bump(c.decade, decadeOf(g.year));
      bump(c.kind, kindOf(g));
      const f = g.franchise ?? g.series;
      if (f) bump(c.franchise, f);
      for (const p of g.platforms ?? []) bump(c.platform, p);
      for (const k of g.keywords ?? []) bump(c.keyword, k);
    }
    for (const t of tracks) {
      for (const ty of t.types) bump(c.type, ty);
      bump(c.length, lengthOf(t));
      bump(c.voice, voiceOf(t));
      if (t.role) bump(c.role, t.role);
    }
    // A franchise of one work is just that work; the list at the bottom covers it.
    for (const [k, n] of c.franchise) if (n < 2) c.franchise.delete(k);
    return c;
  }, [games, tracks]);

  const trackCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tracks) m.set(t.gameId, (m.get(t.gameId) ?? 0) + 1);
    return m;
  }, [tracks]);

  const pool = useMemo(() => poolStats(games, tracks, filters), [games, tracks, filters]);
  const variety = varietyParams(filters.variety, pool.games);

  const genres = [...counts.genre.keys()].sort().map((g) => ({ id: g, label: g }));
  const decades = [...counts.decade.keys()].sort().map((d) => ({ id: d, label: d }));
  const kinds = KINDS.filter((k) => counts.kind.has(k.id)).map((k) => ({ id: k.id, label: `${k.icon} ${k.label}` }));
  const roles = ROLES.filter((r) => counts.role.has(r.id)).map((r) => ({ id: r.id, label: r.label }));
  const gameSearch = useMemo(
    () => buildIndex(games, (g) => ({ title: g.title, other: [g.series, g.franchise, ...g.composers] })),
    [games],
  );
  const shownGames = gameQuery.trim()
    ? search(gameSearch, gameQuery)
    : games.slice().sort((a, b) => a.title.localeCompare(b.title));

  const set = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch });
  const isDefault =
    JSON.stringify({ ...filters, variety: 0, familiarity: 0 }) === JSON.stringify({ ...DEFAULT_FILTERS, variety: 0, familiarity: 0 });

  async function setAllGames(enabled: boolean) {
    await db.games.bulkUpdate(shownGames.map((g) => ({ key: g.id, changes: { enabled } })));
  }

  return (
    <aside className="filters">
      <div className="pool">
        <strong>{pool.tracks.toLocaleString()}</strong> tracks from <strong>{pool.games}</strong> titles in rotation
        {!isDefault && (
          <button className="link" onClick={() => setFilters({ ...DEFAULT_FILTERS, variety: filters.variety, familiarity: filters.familiarity })}>
            reset filters
          </button>
        )}
      </div>

      <Section title="Mix" id="mix">
        <Slider
          label="Variety"
          left="Stay a while"
          right="Always something new"
          value={filters.variety}
          onChange={(variety) => set({ variety })}
        />
        <p className="hint">
          {variety.stay > 0.05 && `${Math.round(variety.stay * 100)}% chance to stay with the same title. `}
          {variety.cooldown > 0 ? `A title rests ${variety.cooldown} tracks before it can return.` : 'No rest between returns.'}
        </p>
        <Slider
          label="Familiarity"
          left="Discover"
          right="Favourites"
          value={filters.familiarity}
          onChange={(familiarity) => set({ familiarity })}
        />
      </Section>

      {kinds.length > 1 && (
        <Section title="Music from" id="kinds" active={count(filters.kinds)}>
          <TriChips options={kinds} state={filters.kinds ?? {}} counts={counts.kind} onChange={(k) => set({ kinds: k })} />
        </Section>
      )}

      <Section title="Length" id="lengths" active={count(filters.lengths)}>
        <TriChips
          options={LENGTHS.map((l) => ({ id: l.id, label: l.label }))}
          state={filters.lengths ?? {}}
          counts={counts.length}
          onChange={(l) => set({ lengths: l })}
        />
      </Section>

      <Section title="Voice" id="voice" active={count(filters.voice)}>
        <TriChips
          options={[
            { id: 'vocal', label: 'Vocal (sing-along)' },
            { id: 'instrumental', label: 'Instrumental' },
          ]}
          state={filters.voice ?? {}}
          counts={counts.voice}
          onChange={(v) => set({ voice: v })}
        />
      </Section>

      {roles.length > 0 && (
        <Section title="Song type" id="roles" active={count(filters.roles)}>
          <TriChips options={roles} state={filters.roles ?? {}} counts={counts.role} onChange={(r) => set({ roles: r })} />
        </Section>
      )}

      <Section title="Track types" id="types" active={count(filters.types)}>
        <TriChips
          options={TRACK_TYPES.map((t) => ({ id: t.id, label: t.label }))}
          state={filters.types}
          counts={counts.type}
          onChange={(types) => set({ types })}
        />
        <p className="hint">Click once for “only”, twice to exclude.</p>
      </Section>

      {genres.length > 0 && (
        <Section title="Genres" id="genres" active={count(filters.genres)}>
          <TriChips options={genres} state={filters.genres} counts={counts.genre} onChange={(g) => set({ genres: g })} />
        </Section>
      )}

      {counts.franchise.size > 0 && (
        <Section title="Series & franchises" id="franchises" active={count(filters.franchises)}>
          <TopChips counts={counts.franchise} state={filters.franchises ?? {}} onChange={(f) => set({ franchises: f })} />
        </Section>
      )}

      {counts.platform.size > 0 && (
        <Section title="Platforms" id="platforms" active={count(filters.platforms)}>
          <TopChips counts={counts.platform} state={filters.platforms ?? {}} onChange={(p) => set({ platforms: p })} />
        </Section>
      )}

      {counts.keyword.size > 0 && (
        <Section title="Keywords" id="keywords" active={count(filters.keywords)}>
          <TopChips counts={counts.keyword} state={filters.keywords ?? {}} onChange={(k) => set({ keywords: k })} />
        </Section>
      )}

      {decades.length > 1 && (
        <Section title="Era" id="decades" active={count(filters.decades)}>
          <TriChips options={decades} state={filters.decades} counts={counts.decade} onChange={(d) => set({ decades: d })} />
        </Section>
      )}

      <Section
        title={`Titles (${games.filter((g) => g.enabled).length}/${games.length})`}
        id="titles"
        active={games.some((g) => !g.enabled) ? games.filter((g) => !g.enabled).length : 0}
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
        <input className="search" placeholder="Filter titles…" value={gameQuery} onChange={(e) => setGameQuery(e.target.value)} />
        <ul className="game-toggles">
          {shownGames.slice(0, 400).map((g) => (
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
