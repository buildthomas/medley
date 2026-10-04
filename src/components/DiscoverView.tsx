import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { runBulk } from '../lib/bulk';
import { franchiseOf, useCatalog } from '../lib/catalog';
import { autoAddGame } from '../lib/importer';
import { buildIndex, gameIndex, search } from '../lib/search';
import { decadeOf } from '../lib/picker';
import { starterGames } from '../lib/starter';
import type { CatalogGame } from '../types';
import type { Session } from '../useSession';
import { Collections } from './discover/Collections';
import { FranchiseCard, type Franchise } from './discover/FranchiseCard';
import { GameDetail, type FacetKind } from './discover/GameDetail';
import { GameTile, type TileState } from './discover/GameTile';
import { Shelf } from './discover/Shelf';

type Mode = 'home' | 'browse' | 'franchises';
type Sort = 'popular' | 'newest' | 'oldest' | 'az';
type Facets = Partial<Record<FacetKind, string[]>>;

const FACET_LABELS: [FacetKind, string][] = [
  ['genre', 'Genre'],
  ['platform', 'Platform'],
  ['mode', 'Mode'],
  ['keyword', 'Keyword'],
  ['franchise', 'Franchise'],
  ['developer', 'Developer'],
  ['composer', 'Composer'],
];

function facetValues(g: CatalogGame, kind: FacetKind): string[] {
  switch (kind) {
    case 'genre':
      return [...new Set([...g.genres, ...(g.tags?.genre ?? [])])];
    case 'keyword':
      return g.keywords ?? [];
    case 'franchise': {
      const f = franchiseOf(g);
      return f ? [f] : [];
    }
    case 'composer':
      return g.composers;
    default:
      return g.tags?.[kind] ?? [];
  }
}

const PAGE = 72;

interface ShelfDef {
  key: string;
  title: string;
  subtitle?: string;
  games: CatalogGame[];
}

export function DiscoverView({ session }: { session: Session }) {
  const cat = useCatalog();
  const libraryIds = useLiveQuery(async () => new Set(await db.games.toCollection().primaryKeys()), [], new Set<string>());
  const [mode, setMode] = useState<Mode>('home');
  const [query, setQuery] = useState('');
  const [facets, setFacets] = useState<Facets>({});
  const [decade, setDecade] = useState('');
  const [sort, setSort] = useState<Sort>('popular');
  const [ownership, setOwnership] = useState<'all' | 'missing' | 'owned'>('all');
  const [focus, setFocus] = useState<{ title: string; ids: string[] } | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [detail, setDetail] = useState<CatalogGame | null>(null);
  const [status, setStatus] = useState<Record<string, 'busy' | 'failed'>>({});

  const games = useMemo(() => cat?.games ?? [], [cat]);
  const byId = useMemo(() => cat?.byId ?? new Map<string, CatalogGame>(), [cat]);
  const resolve = (ids: string[]) => ids.map((id) => byId.get(id)).filter((g): g is CatalogGame => !!g);
  const tileState = (g: CatalogGame): TileState => ({
    inLibrary: libraryIds.has(g.id),
    busy: status[g.id] === 'busy',
    failed: status[g.id] === 'failed',
  });

  async function add(g: CatalogGame) {
    setStatus((s) => ({ ...s, [g.id]: 'busy' }));
    try {
      await autoAddGame(g);
      setStatus(({ [g.id]: _done, ...rest }) => rest);
    } catch {
      setStatus((s) => ({ ...s, [g.id]: 'failed' }));
    }
  }

  function play(g: CatalogGame) {
    const ok = session.tracks.filter((t) => t.gameId === g.id && !t.banned && !t.unavailable);
    if (ok.length) session.playNow(ok[Math.floor(Math.random() * ok.length)].id);
  }

  const addAll = (label: string, list: CatalogGame[]) => runBulk(label, list.filter((g) => !libraryIds.has(g.id)));

  function goBrowse(next: { facets?: Facets; focus?: { title: string; ids: string[] } | null }) {
    setDetail(null);
    setFocus(next.focus ?? null);
    setFacets(next.facets ?? {});
    setQuery('');
    setMode('browse');
    setLimit(PAGE);
    window.scrollTo({ top: 0 });
  }
  const openFacet = (kind: FacetKind, value: string) => goBrowse({ facets: { [kind]: [value] } });
  const seeAll = (title: string, list: CatalogGame[]) => goBrowse({ focus: { title, ids: list.map((g) => g.id) } });

  // ---- series & franchises ---------------------------------------------------------
  const franchises = useMemo<Franchise[]>(() => {
    const map = new Map<string, CatalogGame[]>();
    for (const g of games) {
      const f = franchiseOf(g);
      if (!f) continue;
      let list = map.get(f);
      if (!list) map.set(f, (list = []));
      list.push(g);
    }
    return [...map]
      .filter(([, list]) => list.length >= 3)
      .map(([name, list]) => ({
        name,
        games: list.sort((a, b) => b.pop - a.pop),
        owned: list.filter((g) => libraryIds.has(g.id)).length,
      }))
      .sort((a, b) => b.games.reduce((s, g) => s + g.pop, 0) - a.games.reduce((s, g) => s + g.pop, 0));
  }, [games, libraryIds]);

  const franchiseIndex = useMemo(
    () => buildIndex(franchises, (f) => ({ title: f.name, other: f.games.slice(0, 5).map((g) => g.title), pop: f.games.length })),
    [franchises],
  );

  // ---- browse results ----------------------------------------------------------------
  const index = useMemo(() => gameIndex(games), [games]);
  const results = useMemo(() => {
    // With a query, the search decides membership and (for the default sort) the order.
    const ranked = query.trim() ? search(index, query) : null;
    const focusSet = focus ? new Set(focus.ids) : null;
    const list = (ranked ?? games).filter((g) => {
      if (focusSet && !focusSet.has(g.id)) return false;
      if (ownership === 'owned' && !libraryIds.has(g.id)) return false;
      if (ownership === 'missing' && libraryIds.has(g.id)) return false;
      if (decade && decadeOf(g.year) !== decade) return false;
      for (const [kind, values] of Object.entries(facets) as [FacetKind, string[]][]) {
        const have = facetValues(g, kind);
        if (!values.every((v) => have.includes(v))) return false;
      }
      return true;
    });
    if (ranked && sort === 'popular') return list;
    const order = focus && sort === 'popular' ? new Map(focus.ids.map((id, i) => [id, i])) : null;
    return list.sort((a, b) =>
      order
        ? order.get(a.id)! - order.get(b.id)!
        : sort === 'popular'
          ? b.pop - a.pop
          : sort === 'newest'
            ? (b.year ?? 0) - (a.year ?? 0)
            : sort === 'oldest'
              ? (a.year ?? 9999) - (b.year ?? 9999)
              : a.title.localeCompare(b.title),
    );
  }, [games, index, query, facets, decade, ownership, focus, sort, libraryIds]);

  // Facet suggestions, counted over the current results.
  const facetOptions = useMemo(() => {
    const out = {} as Record<FacetKind, [string, number][]>;
    for (const [kind] of FACET_LABELS) {
      const counts = new Map<string, number>();
      for (const g of results) for (const v of facetValues(g, kind)) counts.set(v, (counts.get(v) ?? 0) + 1);
      out[kind] = [...counts].filter(([v]) => !facets[kind]?.includes(v)).sort((a, b) => b[1] - a[1]);
    }
    return out;
  }, [results, facets]);

  // ---- home shelves -----------------------------------------------------------------------
  // Recomputed when the catalog or library size changes, so random picks don't reshuffle on every render.
  const shelves = useMemo<ShelfDef[]>(() => {
    if (!cat) return [];
    const thisYear = new Date().getFullYear();
    const allLists = cat.collections.groups.flatMap((g) => g.lists);
    const list = (id: string) => resolve(allLists.find((l) => l.id === id)?.ids ?? []);
    const out: ShelfDef[] = [];
    const push = (key: string, title: string, gs: CatalogGame[], subtitle?: string) => {
      if (gs.length >= 2) out.push({ key, title, subtitle, games: gs.slice(0, 40) });
    };
    const rand = (n: number) => Math.floor(Math.random() * n);

    push('mine', 'My games', list('mine-all'), 'Your own soundtracks');

    // What you actually listen to: plays per game in your library.
    const plays = new Map<string, number>();
    for (const t of session.tracks) plays.set(t.gameId, (plays.get(t.gameId) ?? 0) + t.playCount);
    const top = [...plays]
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => byId.get(id))
      .filter((g): g is CatalogGame => !!g);
    const topFranchise = top.map(franchiseOf).find((f) => f && franchises.some((x) => x.name === f));
    if (topFranchise)
      push('because', `Because you listen to ${topFranchise}`, franchises.find((f) => f.name === topFranchise)!.games, 'More from the series');
    const topComposer = top.flatMap((g) => g.composers)[0];
    if (topComposer)
      push(
        'composer',
        `More from ${topComposer}`,
        games.filter((g) => g.composers.includes(topComposer)).sort((a, b) => b.pop - a.pop),
        'Same composer, different games',
      );

    push('year-now', `Biggest games of ${thisYear}`, list(`year-${thisYear}`));
    push('indie-last', `Indie hits of ${thisYear - 1}`, list(`indie-${thisYear - 1}`));
    push('switch', 'Nintendo Switch first-party', list('nin-switch'));
    push('year-last', `Biggest games of ${thisYear - 1}`, list(`year-${thisYear - 1}`));
    const throwback = 2010 + rand(8);
    push('throwback', `Throwback: ${throwback}`, list(`year-${throwback}`), 'The biggest games of that year');
    const consoles = allLists.filter((l) => /^nin-(snes|n64|gc|wii|gba|ds|3ds|nes|gb)$/.test(l.id));
    const c = consoles[rand(consoles.length)];
    if (c) push('console', `${c.title} classics`, resolve(c.ids), 'Nintendo first-party');
    const indieYear = 2012 + rand(8);
    push('indie-old', `Indie hits of ${indieYear}`, list(`indie-${indieYear}`));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat, franchises.length, libraryIds.size > 0]);

  const starter = useMemo(() => starterGames(games), [games]);
  const starterMissing = starter.filter((g) => !libraryIds.has(g.id));

  if (!cat) return <div className="empty">Loading catalog…</div>;

  const activeFacets = (Object.entries(facets) as [FacetKind, string[]][]).flatMap(([kind, values]) =>
    values.map((v) => [kind, v] as const),
  );
  const hasFilters = activeFacets.length > 0 || !!decade || ownership !== 'all' || !!focus || !!query;
  const missingIn = (list: CatalogGame[]) => list.filter((g) => !libraryIds.has(g.id));

  const tiles = (list: CatalogGame[]) =>
    list.map((g) => <GameTile key={g.id} game={g} state={tileState(g)} onOpen={setDetail} onAdd={add} onPlay={play} />);

  const gameShelf = (s: ShelfDef) => (
    <Shelf
      key={s.key}
      title={s.title}
      subtitle={s.subtitle}
      actions={
        <>
          <button className="link" onClick={() => seeAll(s.title, s.games)}>
            See all
          </button>
          {missingIn(s.games).length > 0 && (
            <button className="link" onClick={() => addAll(s.title, s.games)}>
              Add {missingIn(s.games).length}
            </button>
          )}
        </>
      }
    >
      {tiles(s.games)}
    </Shelf>
  );

  return (
    <div className="discover2">
      <section className="discover-hero">
        <p className="eyebrow">Explore the soundtrack catalog</p>
        <h1>
          Every game has <span className="dim">a sound.</span>
        </h1>
        <p className="muted">
          {games.length.toLocaleString()} games · {libraryIds.size.toLocaleString()} in your library · {franchises.length}{' '}
          series & franchises
        </p>
        <input
          className="search big"
          placeholder="Search games, series, composers, developers…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(PAGE);
            if (e.target.value && mode === 'home') setMode('browse');
          }}
        />
        <div className="mode-tabs">
          {(
            [
              ['home', 'For you'],
              ['browse', 'All games'],
              ['franchises', 'Series & franchises'],
            ] as [Mode, string][]
          ).map(([m, label]) => (
            <button key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>
              {label}
            </button>
          ))}
          <span className="spacer" />
          {starterMissing.length > 0 && (
            <button className="primary" onClick={() => addAll('Starter pack', starter)}>
              ✨ Starter pack ({starterMissing.length})
            </button>
          )}
        </div>
      </section>

      {mode === 'home' && (
        <>
          {shelves.slice(0, 3).map(gameShelf)}
          <Shelf
            title="Series & franchises"
            subtitle="Jump into a whole series"
            actions={
              <button className="link" onClick={() => setMode('franchises')}>
                All series
              </button>
            }
          >
            {franchises.slice(0, 24).map((f) => (
              <FranchiseCard key={f.name} franchise={f} onOpen={(x) => openFacet('franchise', x.name)} />
            ))}
          </Shelf>
          {shelves.slice(3).map(gameShelf)}
          <section className="shelf">
            <header className="shelf-head">
              <div>
                <h2>Collections</h2>
                <p className="muted small">Import whole lists at once. Tick “auto-add new” to keep them current every month.</p>
              </div>
            </header>
            <Collections catalog={games} collections={cat.collections} libraryIds={libraryIds} onAdd={addAll} />
          </section>
        </>
      )}

      {mode === 'franchises' && (
        <div className="franchise-grid">
          {(query.trim() ? search(franchiseIndex, query) : franchises).map((f) => (
              <FranchiseCard key={f.name} franchise={f} onOpen={(x) => openFacet('franchise', x.name)} />
            ))}
        </div>
      )}

      {mode === 'browse' && (
        <>
          <div className="browse-bar">
            {FACET_LABELS.map(([kind, label]) => (
              <FacetPicker
                key={kind}
                label={label}
                options={facetOptions[kind]}
                onPick={(v) => {
                  setFacets((f) => ({ ...f, [kind]: [...(f[kind] ?? []), v] }));
                  setLimit(PAGE);
                }}
              />
            ))}
            <select value={decade} onChange={(e) => setDecade(e.target.value)}>
              <option value="">Any era</option>
              {['1980s', '1990s', '2000s', '2010s', '2020s'].map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
            <select value={ownership} onChange={(e) => setOwnership(e.target.value as typeof ownership)}>
              <option value="all">All games</option>
              <option value="missing">Not in library</option>
              <option value="owned">In library</option>
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="popular">{query.trim() ? 'Best match' : focus ? 'List order' : 'Most popular'}</option>
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="az">A–Z</option>
            </select>
          </div>
          {hasFilters && (
            <div className="active-filters">
              {focus && (
                <button className="pill active" onClick={() => setFocus(null)}>
                  {focus.title} ✕
                </button>
              )}
              {activeFacets.map(([kind, v]) => (
                <button
                  key={kind + v}
                  className="pill active"
                  onClick={() => setFacets((f) => ({ ...f, [kind]: f[kind]!.filter((x) => x !== v) }))}
                >
                  <span className="muted">{FACET_LABELS.find(([k]) => k === kind)?.[1] ?? kind}:</span> {v} ✕
                </button>
              ))}
              <button
                className="link"
                onClick={() => {
                  setFacets({});
                  setDecade('');
                  setOwnership('all');
                  setFocus(null);
                  setQuery('');
                }}
              >
                clear all
              </button>
            </div>
          )}
          <div className="browse-summary">
            <span className="muted">
              {results.length.toLocaleString()} game{results.length === 1 ? '' : 's'} · {results.filter((g) => libraryIds.has(g.id)).length} in library
            </span>
            {missingIn(results).length > 0 && results.length <= 400 && (
              <button className="link" onClick={() => addAll(focus?.title ?? 'Filtered games', results)}>
                Add all {missingIn(results).length}
              </button>
            )}
          </div>
          <div className="tile-grid">{tiles(results.slice(0, limit))}</div>
          {results.length > limit && (
            <button className="more" onClick={() => setLimit(limit + PAGE)}>
              Show more ({(results.length - limit).toLocaleString()} left)
            </button>
          )}
          {!results.length && <div className="empty">No games match these filters.</div>}
        </>
      )}

      {detail && <GameDetail game={detail} session={session} onClose={() => setDetail(null)} onFacet={openFacet} />}
    </div>
  );
}

function FacetPicker({ label, options, onPick }: { label: string; options: [string, number][]; onPick(value: string): void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  if (!options.length) return null;
  const shown = options.filter(([v]) => !q || v.toLowerCase().includes(q.toLowerCase())).slice(0, 80);
  return (
    <div className="facet">
      <button className={open ? 'active' : ''} onClick={() => setOpen(!open)}>
        {label} ▾
      </button>
      {open && (
        <>
          <div className="facet-scrim" onClick={() => setOpen(false)} />
          <div className="facet-menu">
            <input
              className="search"
              autoFocus
              placeholder={`Filter ${label.toLowerCase()}s…`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="facet-options">
              {shown.map(([v, n]) => (
                <button
                  key={v}
                  className="pill"
                  onClick={() => {
                    onPick(v);
                    setOpen(false);
                    setQ('');
                  }}
                >
                  {v} <span className="chip-count">{n}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
