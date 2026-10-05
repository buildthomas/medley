import { useMemo, useState } from 'react';
import { db, deleteGame } from '../db';
import { primaryLink, useCatalog } from '../lib/catalog';
import { kindLabel, kindOf, titlesLabel } from '../lib/kinds';
import { foreignTitleRatio, preferEnglishSource } from '../lib/importer';
import { TRACK_TYPES } from '../lib/parse';
import { buildIndex, search } from '../lib/search';
import { Cover } from './discover/Cover';
import type { Session } from '../useSession';
import type { Game, Track } from '../types';
import { Empty, formatTime } from './ui';

type Sort = 'title' | 'added' | 'plays' | 'year';

export function LibraryView({ session }: { session: Session }) {
  const { games, tracks } = session;
  const cat = useCatalog();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('title');
  const [openId, setOpenId] = useState<string | null>(null);

  const byGame = useMemo(() => {
    const m = new Map<string, Track[]>();
    for (const t of tracks) {
      let l = m.get(t.gameId);
      if (!l) m.set(t.gameId, (l = []));
      l.push(t);
    }
    return m;
  }, [tracks]);

  const plays = (g: Game) => (byGame.get(g.id) ?? []).reduce((a, t) => a + t.playCount, 0);

  const index = useMemo(
    () => buildIndex(games, (g) => ({ title: g.title, other: [g.series, g.franchise, ...g.composers] })),
    [games],
  );
  // While searching, show best matches first; otherwise the chosen sort.
  const shown = query.trim()
    ? search(index, query)
    : games.slice().sort((a, b) =>
      sort === 'title'
        ? a.title.localeCompare(b.title)
        : sort === 'added'
          ? b.addedAt - a.addedAt
          : sort === 'year'
            ? (a.year ?? 9999) - (b.year ?? 9999)
            : plays(b) - plays(a),
    );

  // Games whose track names are mostly Japanese/Chinese/Korean, which can be swapped for an English source.
  const foreign = useMemo(
    () => games.filter((g) => foreignTitleRatio((byGame.get(g.id) ?? []).map((t) => t.title)) > 0.5),
    [games, byGame],
  );
  const [fixing, setFixing] = useState<string | null>(null);

  async function fixForeign() {
    let fixed = 0;
    for (const [i, g] of foreign.entries()) {
      setFixing(`Looking for English track names… ${i + 1}/${foreign.length}`);
      const meta = cat?.byId.get(g.id) ?? { ...g, franchise: g.franchise ?? undefined, pop: 0 };
      try {
        if (await preferEnglishSource(meta)) fixed++;
      } catch {
        /* keep the current source */
      }
    }
    setFixing(`Switched ${fixed} of ${titlesLabel(foreign)} to English track names; the rest only exist in their original language.`);
  }

  if (!games.length) return <Empty>Nothing here yet. Add titles from Discover, or paste a link under Add link.</Empty>;

  return (
    <div className="library">
      <div className="toolbar">
        <input className="search grow" placeholder="Search library…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="title">A–Z</option>
          <option value="added">Recently added</option>
          <option value="plays">Most played</option>
          <option value="year">Release year</option>
        </select>
        <span className="muted">
          {titlesLabel(games)} · {tracks.length.toLocaleString()} tracks
        </span>
        {foreign.length > 0 && !fixing && (
          <button className="link" onClick={fixForeign} title={foreign.map((g) => g.title).join(', ')}>
            {titlesLabel(foreign)} {foreign.length === 1 ? 'has' : 'have'} non-English track names: find English versions
          </button>
        )}
        {fixing && <span className="small">{fixing}</span>}
      </div>

      <ul className="lib-games">
        {shown.map((g) => {
          const list = byGame.get(g.id) ?? [];
          const open = openId === g.id;
          return (
            <li key={g.id} className={g.enabled ? '' : 'disabled'}>
              <div className="lib-row" onClick={() => setOpenId(open ? null : g.id)}>
                <input
                  type="checkbox"
                  checked={g.enabled}
                  title="In rotation"
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => db.games.update(g.id, { enabled: e.target.checked })}
                />
                <span className="caret">{open ? '▾' : '▸'}</span>
                <Cover game={{ title: g.title, year: g.year, covers: cat?.byId.get(g.id)?.covers }} className="lib-cover" />
                <span className="lib-title truncate">
                  {g.title} {g.year && <span className="muted">{g.year}</span>}
                </span>
                <span className="muted small truncate hide-sm">{g.genres.join(', ')}</span>
                <span className="muted small tabular">{list.length} tracks</span>
                <span className="muted small tabular hide-sm">{plays(g)} plays</span>
              </div>
              {open && <GameEditor game={g} tracks={list} session={session} link={primaryLink(cat?.byId.get(g.id))} />}
            </li>
          );
        })}
      </ul>
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
  const sorted = tracks.slice().sort((a, b) => a.sourceId.localeCompare(b.sourceId) || (a.start ?? 0) - (b.start ?? 0));

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
