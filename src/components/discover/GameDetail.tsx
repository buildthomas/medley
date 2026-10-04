import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, deleteGame } from '../../db';
import { franchiseOf } from '../../lib/catalog';
import { autoAddGame, findCandidates, replaceSource, type Candidate } from '../../lib/importer';
import { kindLabel, kindOf } from '../../lib/kinds';
import { importAnime, useAnimeScope, type AnimeScope } from '../../lib/importers/anime';
import type { AnimeTheme, CatalogGame, GameTags } from '../../types';
import { AnimeScopePicker } from '../AnimeScopePicker';
import type { Session } from '../../useSession';
import { formatTime } from '../ui';
import { Cover } from './Cover';

export type FacetKind = keyof GameTags | 'keyword' | 'franchise' | 'composer';

const TAG_GROUPS: [keyof GameTags, string][] = [
  ['genre', 'Genres'],
  ['platform', 'Platforms'],
  ['studio', 'Studios'],
  ['network', 'Network'],
  ['format', 'Format'],
  ['mode', 'Modes'],
  ['theme', 'Themes & setting'],
  ['country', 'Country'],
];

const THEME_LABEL = { OP: 'Opening', ED: 'Ending', IN: 'Insert song' } as const;
const ANIME_ADD_LABEL: Record<AnimeScope, string> = {
  all: '+ Add OP/ED & soundtrack',
  songs: '+ Add songs (no OST)',
  oped: '+ Add OPs & EDs',
  op: '+ Add openings',
};
const themeId = (th: AnimeTheme) => th.type + (th.seq ?? '') + th.song;

export function GameDetail({
  game,
  session,
  onClose,
  onFacet,
}: {
  game: CatalogGame;
  session: Session;
  onClose(): void;
  onFacet(kind: FacetKind, value: string): void;
}) {
  const tracks = useLiveQuery(() => db.tracks.where('gameId').equals(game.id).toArray(), [game.id], []);
  const sources = useLiveQuery(() => db.sources.filter((s) => s.gameIds.includes(game.id)).toArray(), [game.id], []);
  const inLibrary = tracks.length > 0;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const animeScope = useAnimeScope();
  const [addingTheme, setAddingTheme] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sorted = useMemo(
    () => tracks.slice().sort((a, b) => a.sourceId.localeCompare(b.sourceId) || (a.start ?? 0) - (b.start ?? 0)),
    [tracks],
  );
  const franchise = franchiseOf(game);
  const kind = kindOf(game);
  const isArtist = kind === 'artist';
  const dev = game.tags?.developer?.slice(0, 2).join(', ');
  const pub = game.tags?.publisher?.slice(0, 2).join(', ');
  // The credit line under the title, worded per kind of work.
  const people = isArtist
    ? [
        game.artist?.type === 'group' ? 'Group' : 'Artist',
        game.artist?.country,
        game.artist?.since && `since ${game.artist.since}`,
        pub && `on ${pub}`,
      ].filter(Boolean)
    : [
        kindLabel(kind).one !== 'game' && kindLabel(kind).one.replace(/^./, (c) => c.toUpperCase()),
        game.year,
        dev && (kind === 'film' ? `directed by ${dev}` : `by ${dev}`),
        pub && `published by ${pub}`,
      ].filter(Boolean);
  // Which of the anime's songs are in the library already.
  const themeTrack = (th: AnimeTheme) =>
    tracks.find((t) => t.role === (th.type === 'IN' ? 'insert' : th.type.toLowerCase()) && t.title === th.song);
  const missingThemes = (game.themes ?? []).filter((th) => !themeTrack(th));
  async function addTheme(th: AnimeTheme) {
    setAddingTheme(themeId(th));
    setMessage(null);
    try {
      const r = await importAnime(game, { themes: [th] });
      setMessage(r.added ? `Added “${th.song}”.` : `“${th.song}” is already in your library.`);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setAddingTheme(null);
    }
  }
  const playLabel = isArtist ? 'songs' : kind === 'anime' ? 'songs & soundtrack' : 'soundtrack';

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // The whole soundtrack, in album order (or shuffled), then back to the regular shuffle.
  const playable = sorted.filter((t) => !t.banned && !t.unavailable);
  const playAll = (shuffle: boolean) =>
    session.playProgram(`${game.title}${shuffle ? ' (shuffled)' : ''}`, playable.map((t) => t.id), { shuffle });

  async function remove() {
    if (!confirm(`Remove ${game.title} and its ${tracks.length} tracks from your library?`)) return;
    await deleteGame(game.id);
    setMessage('Removed from your library.');
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <article className="detail" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={game.title}>
        <button className="detail-close icon-round" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <div className="detail-hero">
          <Cover game={game} className="detail-cover" />
          <div className="detail-info">
            {franchise && (
              <button className="eyebrow link" onClick={() => onFacet('franchise', franchise)}>
                {franchise}
              </button>
            )}
            <h1>{game.title}</h1>
            <p className="muted">
              {people.join(' · ')}
            </p>
            {game.composers.length > 0 && (
              <p className="composers">
                ♪{' '}
                {game.composers.map((c, i) => (
                  <span key={c}>
                    {i > 0 && ', '}
                    <button className="link inline-link" onClick={() => onFacet('composer', c)}>
                      {c}
                    </button>
                  </span>
                ))}
              </p>
            )}

            <div className="detail-actions">
              {inLibrary ? (
                <>
                  <button className="primary" onClick={() => playAll(false)} title="Play every track in album order, then back to shuffle">
                    ▶ Play {playLabel}
                  </button>
                  <button onClick={() => playAll(true)} title="Play every track in random order, then back to shuffle">
                    ⤮ Shuffle
                  </button>
                  {!isArtist && (
                    <button
                      disabled={busy}
                      onClick={() => run(async () => setCandidates(candidates ? null : await findCandidates(game)))}
                    >
                      {candidates ? 'Hide sources' : 'Change source'}
                    </button>
                  )}
                  {kind === 'anime' && missingThemes.length > 0 && (
                    <button
                      disabled={busy}
                      title="Find the openings, endings and insert songs you don't have yet"
                      onClick={() =>
                        run(async () => {
                          const r = await importAnime(game, { scope: 'songs' });
                          setMessage(`Added ${r.added} songs.`);
                        })
                      }
                    >
                      {busy ? 'Searching…' : `+ Add ${missingThemes.length} missing song${missingThemes.length === 1 ? '' : 's'}`}
                    </button>
                  )}
                  <button className="danger" onClick={remove} title="Remove this title and its tracks from your library">
                    Remove
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const r = await autoAddGame(game);
                        setMessage(`Added ${r.added} tracks from “${r.sourceTitle}”.`);
                      })
                    }
                  >
                    {busy ? 'Searching…' : isArtist ? '+ Add popular songs' : kind === 'anime' ? ANIME_ADD_LABEL[animeScope] : '+ Add soundtrack'}
                  </button>
                  {!isArtist && (
                    <button disabled={busy} onClick={() => run(async () => setCandidates(await findCandidates(game)))}>
                      Pick a source
                    </button>
                  )}
                </>
              )}
              {game.links?.map((l) => (
                <a key={l.url} className="store-link" href={l.url} target="_blank" rel="noreferrer">
                  {l.label} ↗
                </a>
              ))}
            </div>
            {kind === 'anime' && !inLibrary && game.themes?.length ? <AnimeScopePicker label="Add" /> : null}
            {message && <p className="small">{message}</p>}

            {candidates && (
              <ul className="candidates">
                {candidates.slice(0, 8).map((c) => (
                  <li key={c.hit.id}>
                    <a href={`https://www.youtube.com/playlist?list=${c.hit.id}`} target="_blank" rel="noreferrer">
                      {c.hit.title}
                    </a>
                    <span className="muted small">
                      {c.hit.channel} · {c.hit.videoCount ?? '?'} videos
                    </span>
                    <button
                      className="small-btn"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          const r = sources[0]
                            ? await replaceSource(game, sources[0].id, c.hit)
                            : await autoAddGame(game, c.hit);
                          setMessage(`Now using “${r.sourceTitle}” (${r.added} tracks).`);
                          setCandidates(null);
                        })
                      }
                    >
                      Use this
                    </button>
                  </li>
                ))}
                {!candidates.length && <li className="muted">No matching playlists found.</li>}
              </ul>
            )}
          </div>
        </div>

        <div className="detail-body">
          <div className="detail-tags">
            {TAG_GROUPS.map(([kind, label]) =>
              game.tags?.[kind]?.length ? (
                <div key={kind} className="tag-group">
                  <h3>{label}</h3>
                  <div className="pill-row">
                    {game.tags[kind]!.map((v) => (
                      <button key={v} className="pill" onClick={() => onFacet(kind, v)}>
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null,
            )}
            {game.themes?.length ? (
              <div className="tag-group">
                <h3>Openings & endings</h3>
                <ol className="theme-list">
                  {game.themes.map((th) => {
                    const track = themeTrack(th);
                    return (
                      <li key={themeId(th)} className={track ? 'has-track' : ''}>
                        <span className="theme-tag">
                          {th.type}
                          {th.seq ?? ''}
                        </span>
                        <span className="truncate" title={THEME_LABEL[th.type]}>
                          <b>{th.song}</b>
                          {th.artists.length > 0 && <span className="muted"> · {th.artists.join(', ')}</span>}
                        </span>
                        {track ? (
                          <button className="icon" onClick={() => session.playNow(track.id)} title="Play">
                            ▶
                          </button>
                        ) : (
                          <button
                            className="icon"
                            disabled={addingTheme != null}
                            onClick={() => addTheme(th)}
                            title={`Add just this ${THEME_LABEL[th.type].toLowerCase()}${th.episodes ? ` (episodes ${th.episodes})` : ''}`}
                          >
                            {addingTheme === themeId(th) ? '…' : '+'}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>
            ) : null}
            {game.keywords?.length ? (
              <div className="tag-group keywords">
                <h3>Keywords</h3>
                <p>
                  {game.keywords.map((k, i) => (
                    <span key={k}>
                      {i > 0 && ', '}
                      <button className="link inline-link" onClick={() => onFacet('keyword', k)}>
                        {k.toLowerCase()}
                      </button>
                    </span>
                  ))}
                </p>
              </div>
            ) : null}
          </div>

          <div className="detail-tracks">
            <h3>
              {isArtist ? 'Songs' : 'Soundtrack'} {inLibrary && <span className="muted">· {tracks.length} tracks</span>}
            </h3>
            {!inLibrary && <p className="muted">Not in your library yet.</p>}
            {sources.length > 0 && (
              <p className="muted small">
                From{' '}
                {sources.map((s, i) => (
                  <span key={s.id}>
                    {i > 0 && ', '}
                    <a
                      href={s.kind === 'playlist' ? `https://www.youtube.com/playlist?list=${s.id}` : `https://www.youtube.com/watch?v=${s.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {s.title}
                    </a>
                    {s.channel && ` (${s.channel})`}
                  </span>
                ))}
              </p>
            )}
            <ol className="detail-tracklist">
              {sorted.map((t) => (
                <li key={t.id} className={t.banned || t.unavailable ? 'excluded' : ''}>
                  <button className="icon" disabled={t.unavailable} onClick={() => session.playNow(t.id)} title="Play">
                    ▶
                  </button>
                  <span className="truncate">
                    {t.role && t.role !== 'score' && t.role !== 'song' && <span className="theme-tag">{t.role.toUpperCase()}{t.seq ?? ''}</span>}
                    {t.title}
                    {t.artist && !isArtist && <span className="muted"> · {t.artist}</span>}
                  </span>
                  <span className="muted tabular">{formatTime(t.duration)}</span>
                  {t.liked && <span className="liked">♥</span>}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </article>
    </div>
  );
}
