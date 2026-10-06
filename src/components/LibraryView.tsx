import { useEffect, useMemo, useState } from 'react';
import { db, deleteGame } from '../db';
import { primaryLink, useCatalog } from '../lib/catalog';
import { kindLabel, kindOf, ROLES, titlesLabel } from '../lib/kinds';
import { openTitle, openTrack } from '../lib/nav';
import { foreignTitleRatio, preferEnglishSource } from '../lib/importer';
import { TRACK_TYPES } from '../lib/parse';
import { isVocal } from '../lib/picker';
import { albumOrder } from '../lib/trackOrder';
import { buildIndex, search } from '../lib/search';
import { Cover } from './discover/Cover';
import { TrackRow } from './TrackRow';
import type { Session } from '../useSession';
import type { Game, Track, WorkKind } from '../types';
import { Empty, formatTime } from './ui';

// The Library: everything you own, in bulk (docs/ux.md). Two views over the same library:
// Titles (rotation on/off, fix names and labels, remove) and Tracks (every track, filterable by
// its labels). Both filter by kind and search; the filtered set can be played or (titles)
// switched in or out of rotation at once.

type View = 'titles' | 'tracks';
type Domain = 'all' | 'game' | 'anime' | 'screen';
type TitleSort = 'title' | 'added' | 'plays' | 'recent' | 'year' | 'tracks';
type TrackSort = 'title' | 'plays' | 'recent' | 'length' | 'work';
type Status = 'all' | 'on' | 'paused' | 'attention';
type Flag = 'any' | 'liked' | 'banned' | 'unavailable';

const DOMAINS: { id: Domain; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'game', label: '🎮 Games' },
  { id: 'anime', label: '🌸 Anime' },
  { id: 'screen', label: '🎬 Film & TV' },
];
const inDomain = (kind: WorkKind, d: Domain) => d === 'all' || (d === 'screen' ? kind === 'film' || kind === 'series' : kind === d);

// The view, kind and sorts are remembered per browser (a convenience; everything works without).
const PREFS_KEY = 'medley:library';
function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<{ view: View; domain: Domain; titleSort: TitleSort; trackSort: TrackSort }>;
  } catch {
    return {};
  }
}

// Album order between two tracks of the same title (lib/trackOrder.ts).
const albumCompare = (a: Track, b: Track) => { const [x] = albumOrder([a, b]); return x === a ? -1 : 1; };

const hours = (seconds: number) => (seconds >= 3600 ? `${Math.round(seconds / 360) / 10} h` : `${Math.round(seconds / 60)} min`);
const PAGE = 200;

export function LibraryView({ session }: { session: Session }) {
  const { games, tracks } = session;
  const cat = useCatalog();
  const prefs = useMemo(loadPrefs, []);
  const [view, setView] = useState<View>(prefs.view ?? 'titles');
  const [domain, setDomain] = useState<Domain>(prefs.domain ?? 'all');
  const [titleSort, setTitleSort] = useState<TitleSort>(prefs.titleSort ?? 'title');
  const [trackSort, setTrackSort] = useState<TrackSort>(prefs.trackSort ?? 'plays');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Status>('all');
  const [role, setRole] = useState<string>('any');
  const [voice, setVoice] = useState<'any' | 'vocal' | 'instrumental'>('any');
  const [flag, setFlag] = useState<Flag>('any');
  const [openId, setOpenId] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ view, domain, titleSort, trackSort }));
    } catch {
      /* storage unavailable */
    }
  }, [view, domain, titleSort, trackSort]);
  useEffect(() => setLimit(PAGE), [view, domain, query, role, voice, flag, trackSort]);

  const gameMap = session.gameMap;
  const byGame = useMemo(() => {
    const m = new Map<string, Track[]>();
    for (const t of tracks) {
      let l = m.get(t.gameId);
      if (!l) m.set(t.gameId, (l = []));
      l.push(t);
    }
    return m;
  }, [tracks]);
  const stats = useMemo(() => {
    const m = new Map<string, { plays: number; recent: number; unavailable: number }>();
    for (const [id, list] of byGame)
      m.set(id, {
        plays: list.reduce((a, t) => a + t.playCount, 0),
        recent: Math.max(0, ...list.map((t) => t.lastPlayedAt ?? 0)),
        unavailable: list.filter((t) => t.unavailable).length,
      });
    return m;
  }, [byGame]);
  const statOf = (id: string) => stats.get(id) ?? { plays: 0, recent: 0, unavailable: 0 };

  // Titles whose track names are mostly Japanese/Chinese/Korean, which can be swapped for an English source.
  const foreign = useMemo(
    () => new Set(games.filter((g) => foreignTitleRatio((byGame.get(g.id) ?? []).map((t) => t.title)) > 0.5).map((g) => g.id)),
    [games, byGame],
  );
  const needsAttention = (g: Game) => foreign.has(g.id) || statOf(g.id).unavailable > 0;

  // ---- counts per kind (for the chips) -------------------------------------------------
  const kindCounts = useMemo(() => {
    const c: Record<Domain, number> = { all: 0, game: 0, anime: 0, screen: 0 };
    for (const g of games) for (const d of DOMAINS) if (inDomain(kindOf(g), d.id)) c[d.id]++;
    return c;
  }, [games]);

  // ---- titles view ---------------------------------------------------------------------------
  const titleIndex = useMemo(
    () => buildIndex(games, (g) => ({ title: g.title, other: [g.series, g.franchise, ...g.composers] })),
    [games],
  );
  const shownTitles = useMemo(() => {
    const base = query.trim() ? search(titleIndex, query) : games.slice();
    const list = base.filter(
      (g) =>
        inDomain(kindOf(g), domain) &&
        (status === 'all' || (status === 'on' ? g.enabled : status === 'paused' ? !g.enabled : needsAttention(g))),
    );
    if (query.trim()) return list; // search order
    const by: Record<TitleSort, (a: Game, b: Game) => number> = {
      title: (a, b) => a.title.localeCompare(b.title),
      added: (a, b) => b.addedAt - a.addedAt,
      plays: (a, b) => statOf(b.id).plays - statOf(a.id).plays,
      recent: (a, b) => statOf(b.id).recent - statOf(a.id).recent,
      year: (a, b) => (a.year ?? 9999) - (b.year ?? 9999),
      tracks: (a, b) => (byGame.get(b.id)?.length ?? 0) - (byGame.get(a.id)?.length ?? 0),
    };
    return list.sort(by[titleSort]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games, titleIndex, query, domain, status, titleSort, stats, foreign]);

  // ---- tracks view -----------------------------------------------------------------------------
  const trackIndex = useMemo(
    () => (view === 'tracks' ? buildIndex(tracks, (t) => ({ title: t.title, other: [t.artist, gameMap.get(t.gameId)?.title] })) : null),
    [view, tracks, gameMap],
  );
  const shownTracks = useMemo(() => {
    if (view !== 'tracks' || !trackIndex) return [];
    const base = query.trim() ? search(trackIndex, query) : tracks.slice();
    const list = base.filter((t) => {
      const g = gameMap.get(t.gameId);
      if (!g || !inDomain(kindOf(g), domain)) return false;
      if (role !== 'any' && (t.role ?? (t.types.includes('vocal') ? 'song' : 'score')) !== role) return false;
      if (voice !== 'any' && (isVocal(t) ? 'vocal' : 'instrumental') !== voice) return false;
      if (flag === 'liked' && !t.liked) return false;
      if (flag === 'banned' && !t.banned) return false;
      if (flag === 'unavailable' && !t.unavailable) return false;
      return true;
    });
    if (query.trim()) return list;
    const by: Record<TrackSort, (a: Track, b: Track) => number> = {
      title: (a, b) => a.title.localeCompare(b.title),
      plays: (a, b) => b.playCount - a.playCount || a.title.localeCompare(b.title),
      recent: (a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0),
      length: (a, b) => (b.duration ?? 0) - (a.duration ?? 0),
      work: (a, b) => (gameMap.get(a.gameId)?.title ?? '').localeCompare(gameMap.get(b.gameId)?.title ?? '') || albumCompare(a, b),
    };
    return list.sort(by[trackSort]);
  }, [view, trackIndex, tracks, query, domain, role, voice, flag, trackSort, gameMap]);

  // ---- the filtered set, summarised and acted on -----------------------------------------
  const setTracks = view === 'titles' ? shownTitles.flatMap((g) => byGame.get(g.id) ?? []) : shownTracks;
  const playable = setTracks.filter((t) => !t.banned && !t.unavailable);
  const seconds = setTracks.reduce((a, t) => a + (t.duration ?? 0), 0);
  const liked = setTracks.filter((t) => t.liked).length;
  const filtered = query.trim() || domain !== 'all' || (view === 'titles' ? status !== 'all' : role !== 'any' || voice !== 'any' || flag !== 'any');
  const setLabel = filtered ? (query.trim() ? `Results for “${query.trim()}”` : 'Library selection') : 'Your library';
  const setRotation = (enabled: boolean) => db.games.bulkUpdate(shownTitles.map((g) => ({ key: g.id, changes: { enabled } })));

  const [fixing, setFixing] = useState<string | null>(null);
  async function fixForeign() {
    const list = games.filter((g) => foreign.has(g.id));
    let fixed = 0;
    for (const [i, g] of list.entries()) {
      setFixing(`Looking for English track names… ${i + 1}/${list.length}`);
      const meta = cat?.byId.get(g.id) ?? { ...g, franchise: g.franchise ?? undefined, pop: 0 };
      try {
        if (await preferEnglishSource(meta)) fixed++;
      } catch {
        /* keep the current source */
      }
    }
    setFixing(`Switched ${fixed} of ${titlesLabel(list)} to English track names; the rest only exist in their original language.`);
  }

  if (!games.length)
    return session.loaded ? <Empty>Nothing here yet. Add titles from Discover, or paste a link under Add link.</Empty> : null;

  const attentionCount = games.filter(needsAttention).length;
  const kinds = DOMAINS.filter((d) => d.id === 'all' || kindCounts[d.id] > 0);

  return (
    <div className="library">
      <header className="lib-header">
        <div className="segmented lib-views" role="tablist" aria-label="Library view">
          {(['titles', 'tracks'] as View[]).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
              {v === 'titles' ? 'Titles' : 'Tracks'}
            </button>
          ))}
        </div>
        <input
          className="search lib-search"
          type="search"
          placeholder={view === 'titles' ? 'Search your titles…' : 'Search your tracks…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="lib-selects">
          {kinds.length > 2 && (
            <select value={domain} onChange={(e) => setDomain(e.target.value as Domain)} aria-label="Kind">
              {kinds.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label} ({kindCounts[d.id]})
                </option>
              ))}
            </select>
          )}
          {view === 'titles' ? (
            <>
              <select value={status} onChange={(e) => setStatus(e.target.value as Status)} aria-label="Show">
                <option value="all">All titles</option>
                <option value="on">In rotation</option>
                <option value="paused">Paused</option>
                {attentionCount > 0 && <option value="attention">Needs attention ({attentionCount})</option>}
              </select>
              <select value={titleSort} onChange={(e) => setTitleSort(e.target.value as TitleSort)} aria-label="Sort">
                <option value="title">A–Z</option>
                <option value="added">Recently added</option>
                <option value="recent">Recently played</option>
                <option value="plays">Most played</option>
                <option value="tracks">Most tracks</option>
                <option value="year">Release year</option>
              </select>
            </>
          ) : (
            <>
              <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Song type">
                <option value="any">Any type</option>
                {ROLES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
              <select value={voice} onChange={(e) => setVoice(e.target.value as typeof voice)} aria-label="Voice">
                <option value="any">Sung or not</option>
                <option value="vocal">♪ Sung</option>
                <option value="instrumental">Instrumental</option>
              </select>
              <select value={flag} onChange={(e) => setFlag(e.target.value as Flag)} aria-label="Status">
                <option value="any">Any status</option>
                <option value="liked">♥ Liked</option>
                <option value="banned">⊘ Never played</option>
                <option value="unavailable">Unavailable</option>
              </select>
              <select value={trackSort} onChange={(e) => setTrackSort(e.target.value as TrackSort)} aria-label="Sort">
                <option value="plays">Most played</option>
                <option value="recent">Recently played</option>
                <option value="title">A–Z</option>
                <option value="work">By title</option>
                <option value="length">Longest</option>
              </select>
            </>
          )}
        </div>
      </header>

      <div className="lib-summary">
        {playable.length > 0 && (
          <>
            <button className="primary small-btn" onClick={() => session.playProgram(setLabel, playable.map((t) => t.id))} title="Play these in order, then back to the shuffle">
              ▶ Play
            </button>
            <button
              className="small-btn"
              onClick={() => session.playProgram(setLabel, playable.map((t) => t.id), { shuffle: true })}
              title="Play these in random order, then back to the shuffle"
            >
              ⤮ Shuffle
            </button>
          </>
        )}
        {view === 'titles' && filtered && shownTitles.length > 0 && (
          <span className="lib-bulk muted small">
            ·{' '}
            <button className="link inline-link" onClick={() => setRotation(true)}>
              all in rotation
            </button>{' '}
            ·{' '}
            <button className="link inline-link" onClick={() => setRotation(false)}>
              pause all
            </button>
          </span>
        )}
        <span className="spacer" />
        <span className="muted small">
          {view === 'titles' ? `${titlesLabel(shownTitles)} · ` : ''}
          {setTracks.length.toLocaleString()} tracks · {hours(seconds)}
          {liked ? ` · ♥ ${liked}` : ''}
        </span>
      </div>

      {view === 'titles' && status === 'attention' && (
        <p className="notice small">
          These titles have tracks YouTube no longer plays (open the track, then <b>Wrong video?</b>), or mostly non-English track
          names.{' '}
          {foreign.size > 0 && !fixing && (
            <button className="link inline-link" onClick={fixForeign}>
              Find English versions for {titlesLabel(games.filter((g) => foreign.has(g.id)))}
            </button>
          )}
          {fixing}
        </p>
      )}

      {view === 'titles' ? (
        <ul className="lib-titles">
          {shownTitles.map((g) => {
            const list = byGame.get(g.id) ?? [];
            const editing = openId === g.id;
            const st = statOf(g.id);
            const kind = kindLabel(kindOf(g));
            const meta = [`${kind.icon} ${kind.one.replace(/^./, (c) => c.toUpperCase())}`, g.year, g.genres.slice(0, 2).join(', ')].filter(Boolean);
            return (
              <li key={g.id} className={`lib-title-item ${g.enabled ? '' : 'paused'} ${editing ? 'editing' : ''}`}>
                <div className="lib-title-row">
                  <button className="lib-open" onClick={() => openTitle(g.id)} title={`Open this ${kind.one}`}>
                    <Cover game={{ title: g.title, year: g.year, covers: cat?.byId.get(g.id)?.covers }} className="lib-cover" />
                    <span className="lib-name">
                      <span className="lib-name-title">
                        {g.title}
                        {needsAttention(g) && (
                          <span className="lib-flag" title={st.unavailable ? `${st.unavailable} unavailable tracks` : 'Mostly non-English track names'}>
                            !
                          </span>
                        )}
                      </span>
                      <span className="muted small truncate">
                        {meta.join(' · ')}
                        <span className="show-sm"> · {list.length} tracks</span>
                      </span>
                    </span>
                  </button>
                  <span className="lib-counts muted small tabular">
                    {list.length} tracks
                    <span className="hide-sm"> · {st.plays} plays</span>
                  </span>
                  <label className="switch" title={g.enabled ? 'In rotation: plays in the shuffle' : 'Paused: left out of the shuffle'}>
                    <input type="checkbox" checked={g.enabled} onChange={(e) => db.games.update(g.id, { enabled: e.target.checked })} />
                    <span aria-hidden />
                    <span className="sr-only">In rotation</span>
                  </label>
                  <button className="link small lib-edit" onClick={() => setOpenId(editing ? null : g.id)} aria-expanded={editing}>
                    {editing ? 'Done' : 'Edit'}
                  </button>
                </div>
                {editing && <GameEditor game={g} tracks={list} session={session} link={primaryLink(cat?.byId.get(g.id))} />}
              </li>
            );
          })}
          {!shownTitles.length && <li className="muted lib-none">Nothing matches.</li>}
        </ul>
      ) : (
        <>
          <ol className="track-list lib-tracks-list">
            {shownTracks.slice(0, limit).map((t) => (
              <TrackRow key={t.id} track={t} work={gameMap.get(t.gameId)} showWork onPlay={() => session.playNow(t.id)} />
            ))}
            {!shownTracks.length && <li className="muted lib-none">Nothing matches.</li>}
          </ol>
          {shownTracks.length > limit && (
            <button className="more" onClick={() => setLimit(limit + PAGE)}>
              Show more ({(shownTracks.length - limit).toLocaleString()} left)
            </button>
          )}
        </>
      )}
    </div>
  );
}

function GameEditor({
  game,
  tracks,
  session,
  link,
}: {
  game: Game;
  tracks: Track[];
  session: Session;
  link: { label: string; url: string } | null;
}) {
  const [genres, setGenres] = useState(game.genres.join(', '));
  const sorted = albumOrder(tracks);

  function toggleType(t: Track, type: string) {
    const types = t.types.includes(type) ? t.types.filter((x) => x !== type) : [...t.types, type];
    db.tracks.update(t.id, { types });
  }

  return (
    <div className="game-editor">
      <div className="editor-fields">
        <label>
          Title
          <input defaultValue={game.title} onBlur={(e) => e.target.value.trim() && db.games.update(game.id, { title: e.target.value.trim() })} />
        </label>
        <label>
          Year
          <input
            type="number"
            defaultValue={game.year ?? ''}
            onBlur={(e) => db.games.update(game.id, { year: e.target.value ? Number(e.target.value) : null })}
          />
        </label>
        <label className="grow">
          Genres (comma separated)
          <input
            value={genres}
            onChange={(e) => setGenres(e.target.value)}
            onBlur={() =>
              db.games.update(game.id, {
                genres: genres
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
        {link && (
          <a className="store-link" href={link.url} target="_blank" rel="noreferrer">
            {link.label} ↗
          </a>
        )}
        <button
          className="danger"
          onClick={() => confirm(`Remove ${game.title} and its ${tracks.length} tracks from your library?`) && deleteGame(game.id)}
        >
          Remove {kindLabel(kindOf(game)).one}
        </button>
      </div>
      <table className="lib-tracks">
        <tbody>
          {sorted.map((t) => (
            <tr key={t.id} className={t.banned || t.unavailable ? 'excluded' : ''}>
              <td>
                <button className="icon" title="Play now" disabled={t.unavailable} onClick={() => session.playNow(t.id)}>
                  ▶
                </button>
                <button className="icon" title="Track details" onClick={() => openTrack(t.id)}>
                  ⓘ
                </button>
              </td>
              <td className="grow">
                <input
                  className="inline"
                  defaultValue={t.title}
                  onBlur={(e) => e.target.value !== t.title && db.tracks.update(t.id, { title: e.target.value, customTitle: true })}
                />
                {t.unavailable && <span className="err small"> unavailable on YouTube</span>}
              </td>
              <td className="types">
                {t.types.map((ty) => (
                  <button key={ty} className="tag toggle on" title="Remove tag" onClick={() => toggleType(t, ty)}>
                    {TRACK_TYPES.find((x) => x.id === ty)?.label ?? ty} ×
                  </button>
                ))}
                <select className="add-tag" value="" onChange={(e) => e.target.value && toggleType(t, e.target.value)}>
                  <option value="">+ tag</option>
                  {TRACK_TYPES.filter((ty) => !t.types.includes(ty.id)).map((ty) => (
                    <option key={ty.id} value={ty.id}>
                      {ty.label}
                    </option>
                  ))}
                </select>
              </td>
              <td className="muted tabular">{formatTime(t.duration)}</td>
              <td className="muted tabular" title="plays / early skips">
                {t.playCount}/{t.skipCount}
              </td>
              <td>
                <button className={`icon ${t.liked ? 'liked' : ''}`} title="Like" onClick={() => db.tracks.update(t.id, { liked: !t.liked })}>
                  {t.liked ? '♥' : '♡'}
                </button>
                <button
                  className={`icon ${t.banned ? 'on' : ''}`}
                  title={t.banned ? 'Allow again' : 'Never play'}
                  onClick={() => db.tracks.update(t.id, { banned: !t.banned, unavailable: false })}
                >
                  ⊘
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
