import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { apiUrl } from '../lib/api';
import { runBulk } from '../lib/bulk';
import { franchiseOf, isUpcoming, useCatalog } from '../lib/catalog';
import { autoAddGame } from '../lib/importer';
import { takeDiscoverIntent, useDiscoverIntent } from '../lib/intents';
import { kindOf } from '../lib/kinds';
import { normalize } from '../lib/parse';
import { decadeOf } from '../lib/picker';
import { buildIndex, gameIndex, search } from '../lib/search';
import { starterGames } from '../lib/starter';
import type { CatalogGame, Track } from '../types';
import type { Session } from '../useSession';
import { Collections } from './discover/Collections';
import { FranchiseCard, type Franchise } from './discover/FranchiseCard';
import { type FacetKind } from './discover/GameDetail';
import { TrackRow } from './TrackRow';
import { openTitle } from '../lib/nav';
import { AnimeScopePicker } from './AnimeScopePicker';
import { GameTile, type TileState } from './discover/GameTile';
import { Shelf } from './discover/Shelf';

type Mode = 'home' | 'browse' | 'franchises';
type Sort = 'popular' | 'newest' | 'oldest' | 'az';
type Facets = Partial<Record<FacetKind, string[]>>;
/** Discover's top-level sections. "screen" = films + series. */
type Domain = 'all' | 'game' | 'anime' | 'screen' | 'artist';

const DOMAINS: { id: Domain; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'game', label: '🎮 Games' },
  { id: 'anime', label: '🌸 Anime' },
  { id: 'screen', label: '🎬 Film & TV' },
  { id: 'artist', label: '🎤 Artists' },
];

const inDomain = (g: CatalogGame, d: Domain) => {
  if (d === 'all') return true;
  const k = kindOf(g);
  return d === 'screen' ? k === 'film' || k === 'series' : k === d;
};
const groupDomain = (domain: string | undefined): Domain => (domain === 'screen' ? 'screen' : ((domain as Domain) ?? 'game'));

const FACET_LABELS: [FacetKind, string][] = [
  ['genre', 'Genre'],
  ['platform', 'Platform'],
  ['studio', 'Studio'],
  ['network', 'Network'],
  ['format', 'Format'],
  ['mode', 'Mode'],
  ['keyword', 'Keyword'],
  ['franchise', 'Franchise'],
  ['developer', 'Developer / director'],
  ['composer', 'Composer'],
  ['country', 'Country'],
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
const DOMAIN_KEY = 'medley:discover-domain';

interface ShelfDef {
  key: string;
  title: string;
  subtitle?: string;
  games: CatalogGame[];
}

export function DiscoverView({ session }: { session: Session }) {
  const cat = useCatalog();
  const libraryIds = useLiveQuery(async () => new Set(await db.games.toCollection().primaryKeys()), [], new Set<string>());
  const [domain, setDomainState] = useState<Domain>(() => {
    try {
      return (localStorage.getItem(DOMAIN_KEY) as Domain) || 'all';
    } catch {
      return 'all';
    }
  });
  const [mode, setMode] = useState<Mode>('home');
  const [query, setQuery] = useState('');
  const [facets, setFacets] = useState<Facets>({});
  const [decade, setDecade] = useState('');
  const [sort, setSort] = useState<Sort>('popular');
  const [ownership, setOwnership] = useState<'all' | 'missing' | 'owned'>('all');
  const [showUpcoming, setShowUpcoming] = useState(false);
  const [focus, setFocus] = useState<{ title: string; ids: string[] } | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [status, setStatus] = useState<Record<string, 'busy' | 'failed'>>({});
  const [foundArtists, setFoundArtists] = useState<CatalogGame[]>([]);

  function setDomain(d: Domain) {
    setDomainState(d);
    if (d === 'artist') setMode((m) => (m === 'franchises' ? 'home' : m)); // artists have no series
    setFacets({});
    setFocus(null);
    try {
      localStorage.setItem(DOMAIN_KEY, d);
    } catch {
      /* ignore */
    }
  }

  // "Show these titles" requests from elsewhere (new-arrivals banner).
  const intent = useDiscoverIntent();
  useEffect(() => {
    const i = takeDiscoverIntent();
    if (!i) return;
    setDomainState('all');
    setFocus(i.facet ? null : { title: i.title, ids: i.ids });
    setFacets(i.facet ? { [i.facet.kind]: [i.facet.value] } : {});
    setQuery('');
    setMode('browse');
    setShowUpcoming(true);
  }, [intent]);

  const allGames = useMemo(() => cat?.games ?? [], [cat]);
  const byId = useMemo(() => cat?.byId ?? new Map<string, CatalogGame>(), [cat]);
  const visible = (g: CatalogGame) => showUpcoming || !isUpcoming(g) || libraryIds.has(g.id);
  const games = useMemo(() => allGames.filter((g) => inDomain(g, domain)), [allGames, domain]);
  const resolve = (ids: string[]) => ids.map((id) => byId.get(id)).filter((g): g is CatalogGame => !!g && visible(g));
  const tileState = (g: CatalogGame): TileState => ({
    inLibrary: libraryIds.has(g.id),
    busy: status[g.id] === 'busy',
    failed: status[g.id] === 'failed',
    upcoming: isUpcoming(g),
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

  const addAll = (label: string, list: CatalogGame[]) =>
    runBulk(label, list.filter((g) => !libraryIds.has(g.id) && !isUpcoming(g)));

  function goBrowse(next: { facets?: Facets; focus?: { title: string; ids: string[] } | null }) {
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
      if (!f || kindOf(g) === 'artist') continue;
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
  // While searching inside one domain, say where else the query matches ("Radiohead" in Film & TV).
  const allIndex = useMemo(() => (domain === 'all' ? null : gameIndex(allGames)), [allGames, domain]);
  const elsewhere = useMemo(() => {
    if (!allIndex || !query.trim()) return [];
    const hits = search(allIndex, query).filter(visible);
    return DOMAINS.filter((d) => d.id !== 'all' && d.id !== domain)
      .map((d) => ({ ...d, n: hits.filter((g) => inDomain(g, d.id)).length }))
      .filter((d) => d.n > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allIndex, query, domain, showUpcoming]);
  const results = useMemo(() => {
    // With a query, the search decides membership and (for the default sort) the order.
    const ranked = query.trim() ? search(index, query) : null;
    const focusSet = focus ? new Set(focus.ids) : null;
    const list = (ranked ?? games).filter((g) => {
      if (focusSet && !focusSet.has(g.id)) return false;
      if (!focusSet && !visible(g)) return false;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games, index, query, facets, decade, ownership, focus, sort, libraryIds, showUpcoming]);

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

  // ---- artists beyond the catalog (MusicBrainz), when searching artists ----------------
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || (domain !== 'artist' && domain !== 'all')) {
      setFoundArtists([]);
      return;
    }
    const known = new Set(allGames.filter((g) => kindOf(g) === 'artist').map((g) => normalize(g.title)));
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(apiUrl(`/api/artists/search?q=${encodeURIComponent(q)}`));
        const found: CatalogGame[] = res.ok ? await res.json() : [];
        setFoundArtists(found.filter((a) => !known.has(normalize(a.title))).slice(0, 12));
      } catch {
        setFoundArtists([]);
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [query, domain, allGames]);

  // ---- tracks in your library matching the search ---------------------------------------
  const trackIndex = useMemo(
    () =>
      query.trim()
        ? buildIndex(session.tracks, (t) => ({
            title: t.title,
            other: [t.artist, session.gameMap.get(t.gameId)?.title],
            pop: t.playCount + (t.liked ? 5 : 0),
          }))
        : null,
    // Rebuilt when the library grows, not on every play-count change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query.trim().length > 0, session.tracks.length],
  );
  const trackHits = useMemo(
    () => (trackIndex && query.trim() ? search(trackIndex, query).filter((t) => !t.banned).slice(0, 40) : []),
    [trackIndex, query],
  );

  // ---- home shelves -----------------------------------------------------------------------
  const shelves = useMemo<ShelfDef[]>(() => {
    if (!cat) return [];
    const thisYear = new Date().getFullYear();
    const allLists = cat.collections.groups.flatMap((g) => g.lists);
    const list = (id: string) => resolve(allLists.find((l) => l.id === id)?.ids ?? []);
    const out: ShelfDef[] = [];
    const push = (key: string, title: string, gs: CatalogGame[], subtitle?: string) => {
      if (gs.length >= 2 && !out.some((s) => s.key === key)) out.push({ key, title, subtitle, games: gs.slice(0, 40) });
    };
    const rand = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

    // What you actually listen to: plays per title in your library.
    const plays = new Map<string, number>();
    for (const t of session.tracks) plays.set(t.gameId, (plays.get(t.gameId) ?? 0) + t.playCount);
    const top = [...plays]
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => byId.get(id))
      .filter((g): g is CatalogGame => !!g && inDomain(g, domain));
    const becauseYouListen = () => {
      const f = top.map(franchiseOf).find((x) => x && franchises.some((y) => y.name === x));
      if (f) push('because', `Because you listen to ${f}`, franchises.find((x) => x.name === f)!.games.filter(visible), 'More from the series');
      const composer = top.flatMap((g) => g.composers)[0];
      if (composer)
        push('composer', `More from ${composer}`, games.filter((g) => g.composers.includes(composer) && visible(g)).sort((a, b) => b.pop - a.pop), 'Same composer');
    };

    if (domain === 'all' || domain === 'game') push('mine', 'My games', list('mine-all'), 'Your own soundtracks');

    if (domain === 'game') {
      becauseYouListen();
      push('year-now', `Biggest games of ${thisYear}`, list(`year-${thisYear}`));
      // Newest first-party Nintendo across Switch and Switch 2.
      const nintendo = [...new Set([...list('nin-switch2'), ...list('nin-switch')])].sort(
        (a, b) => (b.date ?? String(b.year ?? '')).localeCompare(a.date ?? String(a.year ?? '')),
      );
      push('nintendo', 'Latest from Nintendo', nintendo, 'Switch 2 and Switch first-party');
      push('indie-last', `Indie hits of ${thisYear - 1}`, list(`indie-${thisYear - 1}`));
      push('year-last', `Biggest games of ${thisYear - 1}`, list(`year-${thisYear - 1}`));
      const throwback = 2010 + Math.floor(Math.random() * 8);
      push('throwback', `Throwback: ${throwback}`, list(`year-${throwback}`), 'The biggest games of that year');
      const c = rand(allLists.filter((l) => /^nin-(snes|n64|gc|wii|gba|ds|3ds|nes|gb)$/.test(l.id)));
      if (c) push('console', `${c.title} classics`, resolve(c.ids), 'Nintendo first-party');
      const indieYear = 2012 + Math.floor(Math.random() * 8);
      push('indie-old', `Indie hits of ${indieYear}`, list(`indie-${indieYear}`));
    }
    if (domain === 'anime') {
      becauseYouListen();
      push('anime-top', 'Most popular anime', list('anime-top'), 'Openings, endings and soundtracks');
      push('anime-now', `Anime of ${thisYear}`, list(`anime-${thisYear}`));
      push('anime-last', `Anime of ${thisYear - 1}`, list(`anime-${thisYear - 1}`));
      push('anime-films', 'Anime films', list('anime-films'));
      push('anime-ghibli', 'Studio Ghibli', list('anime-ghibli'));
      const y = 2010 + Math.floor(Math.random() * 10);
      push('anime-throwback', `Throwback: anime of ${y}`, list(`anime-${y}`));
      push('anime-classics', 'Classics', list('anime-classics'), 'Before 2010');
    }
    if (domain === 'screen') {
      becauseYouListen();
      push('disney', 'Walt Disney Animation Studios', list('studio-disney-animation'), 'Sing-along classics and new favourites');
      push('pixar', 'Pixar', list('studio-pixar'));
      push('musicals', 'Musicals', list('films-musicals'));
      push('spiderverse', 'Sony Pictures Animation', list('studio-sony-animation'), 'Spider-Verse and more');
      push('dreamworks', 'DreamWorks Animation', list('studio-dreamworks'));
      push('superhero', 'Superhero soundtracks', list('films-superhero'));
      push('series', 'Popular TV series', list('series-top'));
      push('animated-series', 'Animated series', list('series-animated'));
      push('films-now', 'Films of the 2020s', list('films-2020s'));
      push('films-classics', 'Film classics', list('films-classics'), 'Before 1990');
    }
    if (domain === 'artist') {
      const topArtist = top[0];
      const g = topArtist?.genres.find((x) => x !== 'Other');
      if (topArtist && g)
        push('because-artist', `Because you listen to ${topArtist.title}`, games.filter((a) => a.genres.includes(g) && a.id !== topArtist.id && visible(a)).sort((a, b) => b.pop - a.pop), g);
      push('artists-top', 'Most popular artists', list('artists-top'));
      for (const [id, title] of [
        ['artists-pop', 'Pop'],
        ['artists-hip-hop', 'Hip hop'],
        ['artists-k-pop', 'K-pop'],
        ['artists-rock', 'Rock'],
        ['artists-r-b-soul', 'R&B & soul'],
        ['artists-electronic', 'Electronic'],
        ['artists-latin', 'Latin'],
        ['artists-indie-alternative', 'Indie & alternative'],
        ['artists-j-pop', 'J-pop'],
        ['artists-country', 'Country'],
      ])
        push(id, title, list(id));
    }
    if (domain === 'all') {
      becauseYouListen();
      push('year-now', `Biggest games of ${thisYear}`, list(`year-${thisYear}`));
      push('anime-top', 'Most popular anime', list('anime-top'), 'Openings, endings and soundtracks');
      push('disney', 'Disney animation', list('studio-disney-animation'));
      push('artists-top', 'Most popular artists', list('artists-top'));
      push('musicals', 'Musicals', list('films-musicals'));
      push('anime-now', `Anime of ${thisYear}`, list(`anime-${thisYear}`));
      push('indie-last', `Indie hits of ${thisYear - 1}`, list(`indie-${thisYear - 1}`));
      push('series', 'Popular TV series', list('series-top'));
    }
    return out;
    // Random picks are re-rolled only when the catalog, domain or library size changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat, domain, franchises.length, libraryIds.size > 0, showUpcoming]);

  const upcoming = useMemo(
    () => (domain === 'game' || domain === 'all' ? games.filter((g) => isUpcoming(g) && g.pop >= 8).sort((a, b) => (a.date ?? '9').localeCompare(b.date ?? '9')) : []),
    [games, domain],
  );

  const starter = useMemo(() => starterGames(allGames), [allGames]);
  const starterMissing = starter.filter((g) => !libraryIds.has(g.id));

  if (!cat) return <div className="empty">Loading catalog…</div>;

  const activeFacets = (Object.entries(facets) as [FacetKind, string[]][]).flatMap(([kind, values]) =>
    values.map((v) => [kind, v] as const),
  );
  const hasFilters = activeFacets.length > 0 || !!decade || ownership !== 'all' || !!focus || !!query;
  const missingIn = (list: CatalogGame[]) => list.filter((g) => !libraryIds.has(g.id) && !isUpcoming(g));
  const groups = cat.collections.groups.filter((g) => domain === 'all' || groupDomain(g.domain) === domain);

  const tiles = (list: CatalogGame[]) =>
    list.map((g) => (
      <GameTile key={g.id} game={g} state={tileState(g)} showKind={domain === 'all'} onOpen={(g) => openTitle(g.id)} onAdd={add} onPlay={play} />
    ));

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
        <div className="discover-top">
        <div className="domain-tabs" role="tablist">
          {DOMAINS.map((d) => (
            <button key={d.id} role="tab" aria-selected={domain === d.id} className={domain === d.id ? 'active' : ''} onClick={() => setDomain(d.id)}>
              {d.label}
            </button>
          ))}
        </div>
        <input
          className="search big"
          placeholder={
            domain === 'artist'
              ? 'Search any artist…'
              : domain === 'anime'
                ? 'Search anime, studios, songs…'
                : 'Search titles, series, composers, songs in your library…'
          }
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(PAGE);
            if (e.target.value && mode === 'home') setMode('browse');
          }}
        />
        </div>
        <div className="mode-tabs">
          {(
            [
              ['home', 'For you'],
              ['browse', 'Browse all'],
              ...(domain === 'artist' ? [] : [['franchises', 'Series & franchises']]),
            ] as [Mode, string][]
          ).map(([m, label]) => (
            <button key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>
              {label}
            </button>
          ))}
          <label className="check small" title="Titles that aren't out yet have no soundtrack to import">
            <input type="checkbox" checked={showUpcoming} onChange={(e) => setShowUpcoming(e.target.checked)} /> Show unreleased
          </label>
          <span className="spacer" />
          <span className="muted small">
            {games.length.toLocaleString()} titles · {libraryIds.size.toLocaleString()} in your library
          </span>
          {domain === 'game' && starterMissing.length > 0 && (
            <button className="primary" onClick={() => addAll('Starter pack', starter)}>
              ✨ Starter pack ({starterMissing.length})
            </button>
          )}
        </div>
        {domain === 'anime' && <AnimeScopePicker />}
      </section>

      {mode === 'home' && (
        <>
          {shelves.slice(0, 3).map(gameShelf)}
          {franchises.length > 0 && (
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
          )}
          {shelves.slice(3).map(gameShelf)}
          {upcoming.length > 0 && (
            <Shelf title="Coming soon" subtitle="Not out yet. Subscribed collections import them automatically after release.">
              {tiles(upcoming.slice(0, 30))}
            </Shelf>
          )}
          {groups.length > 0 && (
            <section className="shelf">
              <header className="shelf-head">
                <div>
                  <h2>Collections</h2>
                  <p className="muted small">Import whole lists at once. Tick “auto-add new” to keep them current every week.</p>
                </div>
              </header>
              <Collections catalog={allGames} collections={{ ...cat.collections, groups }} libraryIds={libraryIds} onAdd={addAll} />
            </section>
          )}
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
              {['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'].map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
            <select value={ownership} onChange={(e) => setOwnership(e.target.value as typeof ownership)}>
              <option value="all">All titles</option>
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
              {results.length.toLocaleString()} title{results.length === 1 ? '' : 's'} ·{' '}
              {results.filter((g) => libraryIds.has(g.id)).length} in library
            </span>
            {elsewhere.length > 0 && (
              <span className="muted small">
                Also in{' '}
                {elsewhere.map((d, i) => (
                  <span key={d.id}>
                    {i > 0 && ', '}
                    <button className="link inline-link" onClick={() => setDomain(d.id)}>
                      {d.label} ({d.n})
                    </button>
                  </span>
                ))}
              </span>
            )}
            {missingIn(results).length > 0 && results.length <= 400 && (
              <button className="link" onClick={() => addAll(focus?.title ?? 'Filtered titles', results)}>
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
          {!results.length && !foundArtists.length && !trackHits.length && <div className="empty">Nothing matches.</div>}

          {foundArtists.length > 0 && (
            <section className="shelf">
              <header className="shelf-head">
                <div>
                  <h2>More artists</h2>
                  <p className="muted small">Not in the catalog yet, found on MusicBrainz. Add one to import their popular songs.</p>
                </div>
              </header>
              <div className="tile-grid">{tiles(foundArtists)}</div>
            </section>
          )}

          {trackHits.length > 0 && <TrackResults tracks={trackHits} session={session} />}
        </>
      )}

    </div>
  );
}

/** Songs/tracks in your library that match the search, playable right here. */
function TrackResults({ tracks, session }: { tracks: Track[]; session: Session }) {
  return (
    <section className="shelf">
      <header className="shelf-head">
        <div>
          <h2>Tracks in your library</h2>
          <p className="muted small">▶ plays it now; the name opens the track.</p>
        </div>
        <button className="link" onClick={() => session.playProgram('Search results', tracks.map((t) => t.id))}>
          ▶ Play all {tracks.length}
        </button>
      </header>
      <ol className="track-list">
        {tracks.map((t) => (
          <TrackRow key={t.id} track={t} work={session.gameMap.get(t.gameId)} showWork onPlay={() => session.playNow(t.id)} />
        ))}
      </ol>
    </section>
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
              placeholder={`Filter ${label.toLowerCase()}…`}
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
